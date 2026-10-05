import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { emptyBoard } from '../src/state/model.ts'
import { visibleToPlayers } from '../src/map/fog.ts'
import { MAX_PLAYERS, MAX_TOKENS, shared, validAction, validShared } from '../src/online/protocol.ts'
import type { Action, Join, Participant, SharedBoard, Snapshot } from '../src/online/protocol.ts'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const roomId = () => [...randomBytes(12)].map(byte => ALPHABET[byte & 31]).join('')
const digest = (s: string) => createHash('sha256').update(s).digest()
export class RoomError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
export interface Actor { role: 'dm' | 'player'; id: string | null }
interface Member extends Participant { identityHash: string; connections: number }
export interface ImageAsset { id: string; bytes: Buffer; type: string }
export interface Room {
  id: string; credentialHash: Buffer; board: SharedBoard; revision: number; members: Map<string, Member>
  dmConnections: number; lastActive: number; image: ImageAsset | null; uploading: boolean
}
export class Rooms {
  readonly rooms = new Map<string, Room>()
  create(initial: SharedBoard = shared(emptyBoard())) {
    if (!validShared(initial)) throw new RoomError('INVALID_BOARD', 'La mesa inicial no tiene una forma válida.')
    this.sweep()
    if (this.rooms.size >= 10) throw new RoomError('LIMIT', 'El servidor admite un máximo de 10 salas activas.')
    let code: string
    do { code = roomId() } while (this.rooms.has(code))
    const credential = randomBytes(32).toString('base64url')
    // Client IDs and assignments cannot create authority. All new identities are server-owned.
    const board: SharedBoard = { version: 1, map: null,
      tokens: initial.tokens.map(t => ({ id: randomUUID(), name: t.name, x: t.x, y: t.y, visible: t.visible !== false, ownerId: null })),
      fog: initial.fog.map(r => ({ ...r, id: randomUUID() })) }
    const room: Room = { id: code, credentialHash: digest(credential), board, revision: 0, members: new Map(), dmConnections: 0, lastActive: Date.now(), image: null, uploading: false }
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
    let member = [...room.members.values()].find(m => m.identityHash === hash)
    if (!member) {
      if (room.members.size >= MAX_PLAYERS) throw new RoomError('LIMIT', 'La sala admite un máximo de 10 jugadores.')
      member = { id: randomUUID(), identityHash: hash, name: join.name, connected: false, connections: 0 }
      room.members.set(member.id, member)
    }
    if (member.connections >= 4) throw new RoomError('LIMIT', 'Este jugador ya tiene cuatro conexiones abiertas.')
    member.name = join.name
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
    return { type: 'state', roomId: room.id, revision: room.revision, role: actor.role, selfId: actor.id,
      board: actor.role === 'dm' ? room.board : { ...room.board, tokens: room.board.tokens.filter(t => visibleToPlayers(t, room.board.fog)) },
      participants: actor.role === 'dm' ? [...room.members.values()].map(({ id, name, connected }) => ({ id, name, connected })) : [],
      dmConnected: room.dmConnections > 0 }
  }
  apply(room: Room, actor: Actor, action: Action): { tokenId?: string } {
    if (!validAction(action)) throw new RoomError('INVALID_MESSAGE', 'La acción no tiene una forma válida.')
    if (actor.role !== 'dm') {
      if (action.type !== 'token.update' || Object.keys(action.changes).some(k => k !== 'x' && k !== 'y')) throw new RoomError('PERMISSION', 'Solo el DM puede realizar esta acción.')
      const token = room.board.tokens.find(t => t.id === action.id)
      if (!token || token.ownerId !== actor.id || !visibleToPlayers(token, room.board.fog)) throw new RoomError('PERMISSION', 'Solo puedes mover una ficha visible asignada a ti.')
    }
    let result: { tokenId?: string } = {}
    switch (action.type) {
      case 'token.create': {
        if (room.board.tokens.length >= MAX_TOKENS) throw new RoomError('LIMIT', 'La sala admite un máximo de 200 fichas.')
        const token = { id: randomUUID(), name: action.name, x: action.x, y: action.y, visible: action.visible !== false, ownerId: null }
        room.board = { ...room.board, tokens: [...room.board.tokens, token] }
        result = { tokenId: token.id }
        break
      }
      case 'token.update': {
        if (!room.board.tokens.some(t => t.id === action.id)) throw new RoomError('TOKEN_NOT_FOUND', 'La ficha ya no existe.')
        if (action.changes.ownerId && !room.members.has(action.changes.ownerId)) throw new RoomError('PARTICIPANT_NOT_FOUND', 'El jugador no pertenece a esta sala.')
        room.board = { ...room.board, tokens: room.board.tokens.map(t => t.id === action.id ? { ...t, ...action.changes } : t) }
        break
      }
      case 'token.delete': {
        if (!room.board.tokens.some(t => t.id === action.id)) throw new RoomError('TOKEN_NOT_FOUND', 'La ficha ya no existe.')
        room.board = { ...room.board, tokens: room.board.tokens.filter(t => t.id !== action.id) }
        break
      }
      case 'fog.set': room.board = { ...room.board, fog: action.regions.map(r => ({ ...r, id: randomUUID() })) }; break
      case 'map.update': {
        const map = room.board.map
        if (!map || action.map.id !== map.id || action.map.width !== map.width || action.map.height !== map.height) throw new RoomError('MAP_CHANGED', 'El mapa cambió. Reintenta el ajuste sobre el mapa actual.')
        room.board = { ...room.board, map: { ...action.map } }
        break
      }
      case 'map.delete': room.board = { ...room.board, map: null }; room.image = null; break
      case 'board.reset': room.board = shared(emptyBoard()); room.image = null; break
    }
    room.revision++
    room.lastActive = Date.now()
    return result
  }
  sweep(now = Date.now()) {
    for (const [id, room] of this.rooms) if (!room.dmConnections && ![...room.members.values()].some(m => m.connected) && !room.uploading && now - room.lastActive > 30 * 60_000) this.rooms.delete(id)
  }
}
