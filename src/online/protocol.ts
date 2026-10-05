import type { BoardState, FogRegion, MapAsset, Token } from '../state/model.ts'
import { emptyBoard, MAX_CELL, MAX_NAME_LENGTH } from '../state/model.ts'
import { isBoardState } from '../state/storage.ts'

export const MAX_PLAYERS = 10
export const MAX_TOKENS = 200
export const MAX_FOG = 1000
export const MAX_MESSAGE_BYTES = 256 * 1024
export const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/
export const IDENTITY_PATTERN = /^[a-f0-9]{64}$/
export const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/

// Shared state deliberately has no camera, zoom, selection or temporary tools.
export interface SharedBoard { version: 1; tokens: Token[]; map: MapAsset | null; fog: FogRegion[] }
export interface Participant { id: string; name: string; connected: boolean }
export type Role = 'dm' | 'player'
export type Join = { type: 'join'; roomId: string; role: 'dm'; credential: string }
  | { type: 'join'; roomId: string; role: 'player'; identity: string; name: string }
export type Changes = Partial<Pick<Token, 'x' | 'y' | 'name' | 'visible' | 'ownerId'>>
export type Action = { type: 'token.create'; name: string; x: number; y: number; visible?: boolean }
  | { type: 'token.update'; id: string; changes: Changes }
  | { type: 'token.delete'; id: string }
  | { type: 'fog.set'; regions: FogRegion[] }
  | { type: 'map.update'; map: MapAsset }
  | { type: 'map.delete' }
  | { type: 'board.reset' }
export interface ActionMessage { type: 'action'; requestId: string; action: Action }
export interface Snapshot {
  type: 'state'; roomId: string; revision: number; role: Role; selfId: string | null
  board: SharedBoard; participants: Participant[]; dmConnected: boolean
}
export type ServerMessage = Snapshot
  | { type: 'result'; requestId: string; ok: true; tokenId?: string }
  | { type: 'result'; requestId: string; ok: false; message: string }
  | { type: 'error'; code: string; message: string }

export const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128
export const name = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_NAME_LENGTH && v === v.trim() && !/[<>\x00-\x1f\x7f]/.test(v)
export const cell = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= MAX_CELL
export function keys(v: Record<string, unknown>, allowed: string[], required: string[] = allowed): boolean {
  return Object.keys(v).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(v, key))
}
export function shared(board: BoardState): SharedBoard {
  return { version: 1, tokens: board.tokens, map: board.map ?? null, fog: board.fog ?? [] }
}
export function validShared(v: unknown): v is SharedBoard {
  if (!record(v) || !keys(v, ['version', 'tokens', 'map', 'fog']) || !Array.isArray(v.tokens) || v.tokens.length > MAX_TOKENS || !Array.isArray(v.fog) || v.fog.length > MAX_FOG) return false
  if (!isBoardState({ ...v, camera: emptyBoard().camera, zoom: 1 })) return false
  return v.tokens.every(t => record(t) && keys(t, ['id', 'name', 'x', 'y', 'visible', 'ownerId'], ['id', 'name', 'x', 'y']) && id(t.id) && name(t.name))
    && v.fog.every(r => record(r) && keys(r, ['id', 'x', 'y', 'width', 'height']))
    && (v.map === null || (record(v.map) && keys(v.map, ['id', 'x', 'y', 'width', 'height', 'scale'])))
}
export function validJoin(v: unknown): v is Join {
  if (!record(v) || v.type !== 'join' || typeof v.roomId !== 'string' || !ROOM_PATTERN.test(v.roomId)) return false
  return v.role === 'dm'
    ? keys(v, ['type', 'roomId', 'role', 'credential']) && typeof v.credential === 'string' && CREDENTIAL_PATTERN.test(v.credential)
    : v.role === 'player' && keys(v, ['type', 'roomId', 'role', 'identity', 'name']) && typeof v.identity === 'string' && IDENTITY_PATTERN.test(v.identity) && name(v.name)
}
export function validAction(v: unknown): v is Action {
  if (!record(v)) return false
  switch (v.type) {
    case 'token.create': return keys(v, ['type', 'name', 'x', 'y', 'visible'], ['type', 'name', 'x', 'y']) && name(v.name) && cell(v.x) && cell(v.y) && (v.visible === undefined || typeof v.visible === 'boolean')
    case 'token.update': {
      if (!keys(v, ['type', 'id', 'changes']) || !id(v.id) || !record(v.changes)) return false
      const c = v.changes
      return keys(c, ['x', 'y', 'name', 'visible', 'ownerId'], []) && Object.keys(c).length > 0
        && (c.x === undefined && c.y === undefined || cell(c.x) && cell(c.y))
        && (c.name === undefined || name(c.name)) && (c.visible === undefined || typeof c.visible === 'boolean')
        && (c.ownerId === undefined || c.ownerId === null || id(c.ownerId))
    }
    case 'token.delete': return keys(v, ['type', 'id']) && id(v.id)
    case 'fog.set': return keys(v, ['type', 'regions']) && validShared({ ...shared(emptyBoard()), fog: v.regions })
    case 'map.update': return keys(v, ['type', 'map']) && v.map !== null && validShared({ ...shared(emptyBoard()), map: v.map })
    case 'map.delete': case 'board.reset': return keys(v, ['type'])
    default: return false
  }
}
export function validActionMessage(v: unknown): v is ActionMessage {
  return record(v) && keys(v, ['type', 'requestId', 'action']) && v.type === 'action' && typeof v.requestId === 'string' && v.requestId.length > 0 && v.requestId.length <= 64 && validAction(v.action)
}
export function validSnapshot(v: unknown): v is Snapshot {
  return record(v) && v.type === 'state' && typeof v.roomId === 'string' && ROOM_PATTERN.test(v.roomId)
    && typeof v.revision === 'number' && Number.isSafeInteger(v.revision) && v.revision >= 0 && (v.role === 'dm' || v.role === 'player')
    && (v.selfId === null || id(v.selfId)) && typeof v.dmConnected === 'boolean' && validShared(v.board)
    && Array.isArray(v.participants) && v.participants.length <= MAX_PLAYERS && v.participants.every(p => record(p) && keys(p, ['id', 'name', 'connected']) && id(p.id) && name(p.name) && typeof p.connected === 'boolean')
}
