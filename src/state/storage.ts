import { emptyBoard } from './model.ts'
import type { BoardState } from './model.ts'
import { isBoardState } from './validation.ts'
export { isBoardState } from './validation.ts'

export const STORAGE_KEY = 'dnd.local-board.v1'
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface LoadedBoard { board: BoardState; warning: string | null; blocked: boolean }

export function loadBoard(storage: Pick<StorageLike, 'getItem'>): LoadedBoard {
  try {
    const saved = storage.getItem(STORAGE_KEY)
    if (saved === null) return { board: emptyBoard(), warning: null, blocked: false }
    const parsed: unknown = JSON.parse(saved)
    if (!isBoardState(parsed)) throw new Error('Invalid board')
    // Explicit, read-only migration: existing tokens/camera are retained; no write on load.
    return { board: { ...parsed, map: parsed.map ?? null }, warning: null, blocked: false }
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
