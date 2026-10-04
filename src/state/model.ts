export interface Point { x: number; y: number }

// Token coordinates are integer cell indices; camera coordinates are world pixels.
export interface Token extends Point { id: string; name: string }
export interface BoardState {
  version: 1
  tokens: Token[]
  camera: Point
  zoom: number
}

export const CELL_SIZE = 64
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5
export const MAX_NAME_LENGTH = 60
export const MAX_CELL = 1_000_000
export const MAX_CAMERA = (MAX_CELL + 1) * CELL_SIZE

export function emptyBoard(): BoardState {
  return { version: 1, tokens: [], camera: { x: 32, y: 32 }, zoom: 1 }
}
