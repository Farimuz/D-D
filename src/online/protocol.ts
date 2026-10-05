import type { Action, RoomProjection } from '../core/room/types.ts'
import { MAX_PLAYERS } from '../core/room/types.ts'
import { record, id, name, keys, validAction, validShared } from '../core/room/validation.ts'
export { MAX_PLAYERS, MAX_TOKENS, MAX_FOG } from '../core/room/types.ts'
export type { Action, Changes, SharedBoard, Participant, Role } from '../core/room/types.ts'
export { record, id, name, cell, keys, shared, validAction, validShared } from '../core/room/validation.ts'

export const MAX_MESSAGE_BYTES = 256 * 1024
export const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/
export const IDENTITY_PATTERN = /^[a-f0-9]{64}$/
export const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type Join = { type: 'join'; roomId: string; role: 'dm'; credential: string }
  | { type: 'join'; roomId: string; role: 'player'; identity: string; name: string }
export interface ActionMessage { type: 'action'; requestId: string; action: Action }
export interface Snapshot extends RoomProjection { type: 'state' }
export type ServerMessage = Snapshot
  | { type: 'result'; requestId: string; ok: true; tokenId?: string }
  | { type: 'result'; requestId: string; ok: false; message: string }
  | { type: 'error'; code: string; message: string }

export function validJoin(v: unknown): v is Join {
  if (!record(v) || v.type !== 'join' || typeof v.roomId !== 'string' || !ROOM_PATTERN.test(v.roomId)) return false
  return v.role === 'dm'
    ? keys(v, ['type', 'roomId', 'role', 'credential']) && typeof v.credential === 'string' && CREDENTIAL_PATTERN.test(v.credential)
    : v.role === 'player' && keys(v, ['type', 'roomId', 'role', 'identity', 'name']) && typeof v.identity === 'string' && IDENTITY_PATTERN.test(v.identity) && name(v.name)
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
