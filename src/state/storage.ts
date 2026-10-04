import { emptyBoard, MAX_CELL, MAX_CAMERA, MAX_NAME_LENGTH, MAX_ZOOM, MIN_ZOOM } from './model.ts'
import type { BoardState } from './model.ts'

export const STORAGE_KEY = 'dnd.local-board.v1'
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface LoadedBoard { board: BoardState; warning: string | null; blocked: boolean }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function isBoardState(value: unknown): value is BoardState {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.tokens) || !record(value.camera)) return false
  if (!finite(value.zoom) || value.zoom < MIN_ZOOM || value.zoom > MAX_ZOOM) return false
  if (!finite(value.camera.x) || !finite(value.camera.y) || Math.abs(value.camera.x) > MAX_CAMERA || Math.abs(value.camera.y) > MAX_CAMERA) return false
  const ids = new Set<string>()
  return value.tokens.every(token => {
    if (!record(token) || typeof token.id !== 'string' || !token.id || ids.has(token.id)) return false
    if (typeof token.name !== 'string' || !token.name.trim() || token.name.length > MAX_NAME_LENGTH) return false
    if (!finite(token.x) || !finite(token.y) || !Number.isInteger(token.x) || !Number.isInteger(token.y) || Math.abs(token.x) > MAX_CELL || Math.abs(token.y) > MAX_CELL) return false
    ids.add(token.id)
    return true
  })
}

export function loadBoard(storage: Pick<StorageLike, 'getItem'>): LoadedBoard {
  try {
    const saved = storage.getItem(STORAGE_KEY)
    if (saved === null) return { board: emptyBoard(), warning: null, blocked: false }
    const parsed: unknown = JSON.parse(saved)
    if (!isBoardState(parsed)) throw new Error('Invalid board')
    return { board: parsed, warning: null, blocked: false }
  } catch {
    return {
      board: emptyBoard(), blocked: true,
      warning: 'No se pudo leer la mesa guardada. Los datos anteriores se conservaron. Usa «Limpiar» para empezar y volver a guardar.',
    }
  }
}

export function saveBoard(storage: Pick<StorageLike, 'setItem'>, board: BoardState): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(board))
    return true
  } catch {
    return false
  }
}
