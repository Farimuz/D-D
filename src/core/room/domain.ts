import type { MapAsset } from '../../state/model.ts'
import { emptyBoard } from '../../state/model.ts'
import { visibleToPlayers } from '../../map/fog.ts'
import { MAX_PLAYERS, MAX_TOKENS } from './types.ts'
import type { Actor, Presence, RoomProjection, RoomState, SharedBoard } from './types.ts'
import { id, name, shared, validAction, validShared } from './validation.ts'

export class RoomError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

// The adapter supplies authenticated actors and fresh IDs; clients never choose them.
function requireActor(state: RoomState, actor: Actor) {
  if (actor.role === 'dm' && actor.id === null) return
  if (actor.role === 'player' && state.participants.some(p => p.id === actor.id)) return
  throw new RoomError('PERMISSION', 'El actor no pertenece a esta sala.')
}
function freshId(identity: () => string, existing: string[]): string {
  const next = identity()
  if (!id(next) || existing.includes(next)) throw new RoomError('INVALID_ID', 'No se pudo generar una identidad nueva.')
  return next
}

export function createRoomState(roomId: string, initial: SharedBoard, identity: () => string): RoomState {
  if (!id(roomId) || !validShared(initial)) throw new RoomError('INVALID_BOARD', 'La mesa inicial no tiene una forma válida.')
  const tokenIds: string[] = [], fogIds: string[] = []
  const board: SharedBoard = { version: 1, map: null,
    tokens: initial.tokens.map(t => {
      const next = freshId(identity, tokenIds); tokenIds.push(next)
      return { id: next, name: t.name, x: t.x, y: t.y, visible: t.visible !== false, ownerId: null }
    }),
    fog: initial.fog.map(r => {
      const next = freshId(identity, fogIds); fogIds.push(next)
      return { ...r, id: next }
    }) }
  return { id: roomId, board, revision: 0, participants: [] }
}

export function registerParticipant(state: RoomState, participant: { id: string; name: string }): RoomState {
  if (!id(participant.id) || !name(participant.name)) throw new RoomError('INVALID_MESSAGE', 'La identificación de sala no es válida.')
  const known = state.participants.some(p => p.id === participant.id)
  if (!known && state.participants.length >= MAX_PLAYERS) throw new RoomError('LIMIT', 'La sala admite un máximo de 10 jugadores.')
  return { ...state, participants: known
    ? state.participants.map(p => p.id === participant.id ? { ...participant } : p)
    : [...state.participants, { ...participant }] }
}

export function applyAction(state: RoomState, actor: Actor, action: unknown, identity: () => string): { state: RoomState; tokenId?: string } {
  if (!validAction(action)) throw new RoomError('INVALID_MESSAGE', 'La acción no tiene una forma válida.')
  requireActor(state, actor)
  if (actor.role !== 'dm') {
    if (action.type !== 'token.update' || Object.keys(action.changes).some(k => k !== 'x' && k !== 'y')) throw new RoomError('PERMISSION', 'Solo el DM puede realizar esta acción.')
    const token = state.board.tokens.find(t => t.id === action.id)
    if (!token || token.ownerId !== actor.id || !visibleToPlayers(token, state.board.fog)) throw new RoomError('PERMISSION', 'Solo puedes mover una ficha visible asignada a ti.')
  }
  let board = state.board, tokenId: string | undefined
  switch (action.type) {
    case 'token.create': {
      if (board.tokens.length >= MAX_TOKENS) throw new RoomError('LIMIT', 'La sala admite un máximo de 200 fichas.')
      const token = { id: freshId(identity, board.tokens.map(t => t.id)), name: action.name, x: action.x, y: action.y, visible: action.visible !== false, ownerId: null }
      board = { ...board, tokens: [...board.tokens, token] }
      tokenId = token.id
      break
    }
    case 'token.update': {
      if (!board.tokens.some(t => t.id === action.id)) throw new RoomError('TOKEN_NOT_FOUND', 'La ficha ya no existe.')
      if (action.changes.ownerId && !state.participants.some(p => p.id === action.changes.ownerId)) throw new RoomError('PARTICIPANT_NOT_FOUND', 'El jugador no pertenece a esta sala.')
      board = { ...board, tokens: board.tokens.map(t => t.id === action.id ? { ...t, ...action.changes } : t) }
      break
    }
    case 'token.delete': {
      if (!board.tokens.some(t => t.id === action.id)) throw new RoomError('TOKEN_NOT_FOUND', 'La ficha ya no existe.')
      board = { ...board, tokens: board.tokens.filter(t => t.id !== action.id) }
      break
    }
    case 'fog.set': {
      const ids: string[] = []
      board = { ...board, fog: action.regions.map(r => { const next = freshId(identity, ids); ids.push(next); return { ...r, id: next } }) }
      break
    }
    case 'map.update': {
      const map = board.map
      if (!map || action.map.id !== map.id || action.map.width !== map.width || action.map.height !== map.height) throw new RoomError('MAP_CHANGED', 'El mapa cambió. Reintenta el ajuste sobre el mapa actual.')
      board = { ...board, map: { ...action.map } }
      break
    }
    case 'map.delete': board = { ...board, map: null }; break
    case 'board.reset': board = shared(emptyBoard()); break
  }
  return { state: { ...state, board, revision: state.revision + 1 }, ...(tokenId ? { tokenId } : {}) }
}

// Internal metadata operation after the adapter has authenticated and validated bytes.
export function replaceMap(state: RoomState, actor: Actor, map: MapAsset): RoomState {
  requireActor(state, actor)
  if (actor.role !== 'dm') throw new RoomError('PERMISSION', 'Solo el DM puede importar un mapa.')
  if (!map || !validShared({ ...state.board, map })) throw new RoomError('INVALID_BOARD', 'La posición o escala del mapa no son válidas.')
  return { ...state, board: { ...state.board, map: { ...map } }, revision: state.revision + 1 }
}

export function projectRoom(state: RoomState, actor: Actor, presence: Presence): RoomProjection {
  requireActor(state, actor)
  return { roomId: state.id, revision: state.revision, role: actor.role, selfId: actor.id,
    board: { version: state.board.version,
      tokens: state.board.tokens.filter(t => actor.role === 'dm' || visibleToPlayers(t, state.board.fog)).map(t => ({
        id: t.id, name: t.name, x: t.x, y: t.y,
        ...(t.visible === undefined ? {} : { visible: t.visible }), ...(t.ownerId === undefined ? {} : { ownerId: t.ownerId }),
      })),
      map: state.board.map ? { id: state.board.map.id, x: state.board.map.x, y: state.board.map.y,
        width: state.board.map.width, height: state.board.map.height, scale: state.board.map.scale } : null,
      fog: state.board.fog.map(r => ({ id: r.id, x: r.x, y: r.y, width: r.width, height: r.height })) },
    participants: actor.role === 'dm' ? state.participants.map(p => ({ id: p.id, name: p.name, connected: presence.connectedIds.has(p.id) })) : [],
    dmConnected: presence.dmConnected }
}
