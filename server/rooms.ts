import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { emptyBoard } from '../src/state/model.ts'
import type { MapAsset } from '../src/state/model.ts'
import { applyAction, createRoomState, projectRoom, registerParticipant, replaceMap, RoomError } from '../src/core/room/domain.ts'
import { shared, validShared } from '../src/core/room/validation.ts'
import type { Actor, RoomState, SharedBoard } from '../src/core/room/types.ts'
import type { RoomStore } from '../src/core/room/store.ts'
import { MemoryRoomStore } from '../src/infrastructure/memory/roomStore.ts'
import { isDurable, PersistenceError } from '../src/infrastructure/node/persistence.ts'
import type { DurableRoomStore, PrivateAccess } from '../src/infrastructure/node/persistence.ts'
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
  private readonly durableStore: DurableRoomStore | null
  constructor(store: RoomStore = new MemoryRoomStore()) { this.store = store; this.durableStore = isDurable(store) ? store : null }
  private coordinate<T>(work: () => T): T { return this.durableStore ? this.durableStore.transaction(work) : work() }
  private privateAccess(room: Room): PrivateAccess | null {
    if (!this.durableStore) return null
    const access = this.durableStore.loadAccess(room.id)
    if (!access) throw new PersistenceError('CORRUPT_ACCESS', 'unchanged')
    return access
  }
  private saveActive(state: RoomState, access: PrivateAccess | null) {
    this.store.save(state)
    if (this.durableStore && access) this.durableStore.saveAccess(state.id, { ...access, lastActive: Date.now() })
  }
  private runtime(id: string, credentialHash: Buffer, lastActive: number, identities: PrivateAccess['identities']): Room {
    const owner = this
    const room: Room = { id, credentialHash,
      // These are views of the store, never a second authoritative board.
      get board() { return owner.read(room).board }, get revision() { return owner.read(room).revision },
      members: new Map(identities.map(identity => [identity.id, { ...identity, connected: false, connections: 0 }])),
      dmConnections: 0, lastActive, image: null, uploading: false }
    this.rooms.set(id, room)
    return room
  }
  read(room: Room): RoomState {
    if (this.rooms.get(room.id) !== room) throw new RoomError('ROOM_NOT_FOUND', 'La sala ya no está activa en este servidor.')
    const state = this.store.load(room.id)
    if (!state) throw new RoomError('ROOM_NOT_FOUND', 'La sala ya no existe. El servidor pudo haberse reiniciado.')
    return state
  }
  create(initial: SharedBoard = shared(emptyBoard())) {
    if (!validShared(initial)) throw new RoomError('INVALID_BOARD', 'La mesa inicial no tiene una forma válida.')
    this.sweep()
    if (this.rooms.size >= 10) throw new RoomError('LIMIT', 'El servidor admite un máximo de 10 salas activas.')
    let code: string
    do { code = roomId() } while (this.rooms.has(code) || this.store.load(code))
    const credential = randomBytes(32).toString('base64url')
    this.coordinate(() => {
      if (this.store.load(code)) throw new PersistenceError('CONFLICT', 'unchanged')
      this.store.save(createRoomState(code, initial, randomUUID))
      this.durableStore?.saveAccess(code, { dmHash: digest(credential).toString('hex'), identities: [], lastActive: Date.now() })
    })
    this.runtime(code, digest(credential), Date.now(), [])
    return { roomId: code, credential }
  }
  get(id: string): Room {
    let room = this.rooms.get(id)
    if (!room && this.durableStore && this.store.load(id)) {
      this.sweep()
      if (this.rooms.size >= 10) throw new RoomError('LIMIT', 'El servidor admite un máximo de 10 salas activas.')
      const access = this.durableStore.loadAccess(id)
      if (!access) throw new PersistenceError('CORRUPT_ACCESS', 'unchanged')
      room = this.runtime(id, Buffer.from(access.dmHash, 'hex'), access.lastActive, access.identities)
    }
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'La sala ya no existe. El servidor pudo haberse reiniciado.')
    return room
  }
  authenticateDM(room: Room, credential: string): boolean {
    const access = this.privateAccess(room)
    return timingSafeEqual(access ? Buffer.from(access.dmHash, 'hex') : room.credentialHash, digest(credential))
  }
  join(join: Join): { room: Room; actor: Actor; state: RoomState } {
    const room = this.get(join.roomId)
    if (join.role === 'dm') {
      const state = this.coordinate(() => {
        if (!this.authenticateDM(room, join.credential)) throw new RoomError('ACCESS', 'La credencial del DM no es válida.')
        if (room.dmConnections >= 4) throw new RoomError('LIMIT', 'El DM ya tiene cuatro conexiones abiertas.')
        const current = this.read(room)
        if (this.durableStore) this.saveActive(current, this.privateAccess(room))
        return current
      })
      room.dmConnections++
      room.lastActive = Date.now()
      return { room, actor: { role: 'dm', id: null }, state }
    }
    const hash = digest(join.identity).toString('hex')
    let member!: Member
    const state = this.coordinate(() => {
      const access = this.privateAccess(room)
      const known = (access?.identities ?? [...room.members.values()]).find(m => m.identityHash === hash)
      member = known ? room.members.get(known.id) ?? { ...known, connected: false, connections: 0 }
        : { id: randomUUID(), identityHash: hash, connected: false, connections: 0 }
      if (member.connections >= 4) throw new RoomError('LIMIT', 'Este jugador ya tiene cuatro conexiones abiertas.')
      const next = registerParticipant(this.read(room), { id: member.id, name: join.name })
      this.saveActive(next, access ? { ...access, identities: known ? access.identities : [...access.identities, { id: member.id, identityHash: hash }] } : null)
      return next
    })
    room.members.set(member.id, member)
    member.connections++
    member.connected = true
    room.lastActive = Date.now()
    return { room, actor: { role: 'player', id: member.id }, state }
  }
  leave(room: Room, actor: Actor) {
    if (actor.role === 'dm') room.dmConnections = Math.max(0, room.dmConnections - 1)
    else {
      const member = room.members.get(actor.id!)
      if (member) { member.connections = Math.max(0, member.connections - 1); member.connected = member.connections > 0 }
    }
    room.lastActive = Date.now()
  }
  snapshot(room: Room, actor: Actor, state = this.read(room)): Snapshot {
    return { type: 'state', ...projectRoom(state, actor, {
      connectedIds: new Set([...room.members.values()].filter(m => m.connected).map(m => m.id)), dmConnected: room.dmConnections > 0,
    }) }
  }
  apply(room: Room, actor: Actor, action: Action): { state: RoomState; tokenId?: string } {
    const result = this.coordinate(() => {
      const access = this.privateAccess(room)
      const next = applyAction(this.read(room), actor, action, randomUUID)
      this.saveActive(next.state, access)
      return next
    })
    if (!result.state.board.map) room.image = null
    room.lastActive = Date.now()
    return result
  }
  replaceMap(room: Room, actor: Actor, map: MapAsset, image: ImageAsset) {
    if (image.id !== map.id) throw new Error('Asset reference mismatch')
    if (this.durableStore) throw new PersistenceError('ASSETS_REQUIRED', 'unchanged')
    const next = replaceMap(this.read(room), actor, map)
    // Synchronous memory commit: failed save retains the old metadata and bytes.
    this.store.save(next)
    room.image = image
    room.lastActive = Date.now()
    return next
  }
  sweep(now = Date.now()) {
    for (const [id, room] of this.rooms) if (!room.dmConnections && ![...room.members.values()].some(m => m.connected) && !room.uploading && now - room.lastActive > 30 * 60_000) {
      if (this.durableStore) { room.image = null; room.members.clear(); this.rooms.delete(id) }
      else this.delete(id)
    }
  }
  delete(id: string) {
    this.store.delete(id)
    this.rooms.delete(id)
  }
  releaseRuntime() {
    // Shutdown releases this runtime's access/presence/bytes, never domain records.
    for (const room of this.rooms.values()) { room.image = null; room.members.clear(); room.dmConnections = 0 }
    this.rooms.clear()
  }
}
