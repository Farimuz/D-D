import type { BoardState } from '../../state/model.ts'
import { emptyBoard, MAX_CELL, MAX_NAME_LENGTH } from '../../state/model.ts'
import { isBoardState } from '../../state/validation.ts'
import { MAX_TOKENS, MAX_FOG } from './types.ts'
import type { Action, SharedBoard } from './types.ts'

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
