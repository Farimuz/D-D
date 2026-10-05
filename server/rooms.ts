import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { emptyBoard } from '../src/state/model.ts'
import type { MapAsset } from '../src/state/model.ts'
import { applyAction, createRoomState, projectRoom, registerParticipant, replaceMap, RoomError } from '../src/core/room/domain.ts'
import { shared, validShared } from '../src/core/room/validation.ts'
import type { Actor, RoomState, SharedBoard } from '../src/core/room/types.ts'
import type { RoomStore } from '../src/core/room/store.ts'
import { MemoryRoomStore } from '../src/infrastructure/memory/roomStore.ts'
import type { Action, Join, Snapshot } from '../src/online/protocol.ts'
export { RoomError } from '../src/core/room/domain.ts'
export type { Actor } from '../src/core/room/types.ts'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const roomId = () => [...randomBytes(12)].map(byte => ALPHABET[byte & 31]).join('')
const digest = (s: string) => createHash('sha256').update(s).digest()
interface Member { id: string; identityHash: string; connected: boolean; connections: number }
export interface ImageAsset { id: string; bytes: Buffer; type: string }
export interface Room {
  id: string; credentialHash: Buffer; readonly board: SharedBoard; readonly revision: number; members: Map<string, Member>
  dmConnections: number; lastActive: number; image: ImageAsset | null; uploading: boolean
}
export class Rooms {
  readonly rooms = new Map<string, Room>()
  private readonly store: RoomStore
  constructor(store: RoomStore = new MemoryRoomStore()) { this.store = store }
  private state(room: Pick<Room, 'id'>): RoomState {
    const state = this.store.load(room.id)
    if (!state) throw new RoomError('ROOM_NOT_FOUND', 'La sala ya no existe. El servidor pudo haberse reiniciado.')
    return state
  }
  create(initial: SharedBoard = shared(emptyBoard())) {
    if (!validShared(initial)) throw new RoomError('INVALID_BOARD', 'La mesa inicial no tiene una forma válida.')
    this.sweep()
    if (this.rooms.size >= 10) throw new RoomError('LIMIT', 'El servidor admite un máximo de 10 salas activas.')
    let code: string
    do { code = roomId() } while (this.rooms.has(code))
    const credential = randomBytes(32).toString('base64url')
    this.store.save(createRoomState(code, initial, randomUUID))
    const owner = this
    const room: Room = { id: code, credentialHash: digest(credential),
      // These are views of the store, never a second authoritative board.
      get board() { return owner.state(room).board }, get revision() { return owner.state(room).revision },
      members: new Map(), dmConnections: 0, lastActive: Date.now(), image: null, uploading: false }
    this.rooms.set(code, room)
    return { roomId: code, credential }
  }
  get(id: string): Room {
    const room = this.rooms.get(id)
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'La sala ya no existe. El servidor pudo haberse reiniciado.')
    return room
  }
  authenticateDM(room: Room, credential: string): boolean {
    return timingSafeEqual(room.credentialHash, digest(credential))
  }
  join(join: Join): { room: Room; actor: Actor } {
    const room = this.get(join.roomId)
    if (join.role === 'dm') {
      if (!this.authenticateDM(room, join.credential)) throw new RoomError('ACCESS', 'La credencial del DM no es válida.')
      if (room.dmConnections >= 4) throw new RoomError('LIMIT', 'El DM ya tiene cuatro conexiones abiertas.')
      room.dmConnections++
      room.lastActive = Date.now()
      return { room, actor: { role: 'dm', id: null } }
    }
    const hash = digest(join.identity).toString('hex')
    const known = [...room.members.values()].find(m => m.identityHash === hash)
    const member = known ?? { id: randomUUID(), identityHash: hash, connected: false, connections: 0 }
    if (member.connections >= 4) throw new RoomError('LIMIT', 'Este jugador ya tiene cuatro conexiones abiertas.')
    // Persist the domain change before granting or changing connection authority.
    this.store.save(registerParticipant(this.state(room), { id: member.id, name: join.name }))
    if (!known) room.members.set(member.id, member)
    member.connections++
    member.connected = true
    room.lastActive = Date.now()
    return { room, actor: { role: 'player', id: member.id } }
  }
  leave(room: Room, actor: Actor) {
    if (actor.role === 'dm') room.dmConnections = Math.max(0, room.dmConnections - 1)
    else {
      const member = room.members.get(actor.id!)
      if (member) { member.connections = Math.max(0, member.connections - 1); member.connected = member.connections > 0 }
    }
    room.lastActive = Date.now()
  }
  snapshot(room: Room, actor: Actor): Snapshot {
    return { type: 'state', ...projectRoom(this.state(room), actor, {
      connectedIds: new Set([...room.members.values()].filter(m => m.connected).map(m => m.id)), dmConnected: room.dmConnections > 0,
    }) }
  }
  apply(room: Room, actor: Actor, action: Action): { tokenId?: string } {
    const result = applyAction(this.state(room), actor, action, randomUUID)
    this.store.save(result.state)
    if (!result.state.board.map) room.image = null
    room.lastActive = Date.now()
    return result.tokenId ? { tokenId: result.tokenId } : {}
  }
  replaceMap(room: Room, actor: Actor, map: MapAsset, image: ImageAsset) {
    if (image.id !== map.id) throw new Error('Asset reference mismatch')
    const next = replaceMap(this.state(room), actor, map)
    // Synchronous memory commit: failed save retains the old metadata and bytes.
    this.store.save(next)
    room.image = image
    room.lastActive = Date.now()
  }
  sweep(now = Date.now()) {
    for (const [id, room] of this.rooms) if (!room.dmConnections && ![...room.members.values()].some(m => m.connected) && !room.uploading && now - room.lastActive > 30 * 60_000) {
      this.store.delete(id)
      this.rooms.delete(id)
    }
  }
  clear() {
    for (const id of this.rooms.keys()) this.store.delete(id)
    this.rooms.clear()
  }
}
