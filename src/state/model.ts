export interface Point { x: number; y: number }

// Token coordinates are integer cell indices; camera coordinates are world pixels.
// Missing visibility in v0.0.1/v0.0.2 means public; loading does not rewrite data.
export interface Token extends Point { id: string; name: string; visible?: boolean; ownerId?: string | null }
export interface MapAsset extends Point { id: string; width: number; height: number; scale: number }
export interface Rectangle extends Point { width: number; height: number }
export interface FogRegion extends Rectangle { id: string }
export type FogAction = 'hide' | 'reveal' | 'navigate'
export type BoardMode = 'normal' | 'map' | 'measure' | 'fog'
export interface BoardState {
  version: 1
  tokens: Token[]
  camera: Point
  zoom: number
  // Optional only for the saved v0.0.1 schema; loadBoard normalizes it to null.
  map?: MapAsset | null
  // Missing fog in older saves means no covered regions.
  fog?: FogRegion[]
}

export const CELL_SIZE = 64
export const MIN_ZOOM = 1e-9
export const MAX_ZOOM = 2.5
export const MAX_NAME_LENGTH = 60
export const MAX_CELL = 1_000_000
// Leave room for cursor anchoring at the numerical zoom floor.
export const MAX_CAMERA = 1e15

export function emptyBoard(): BoardState {
  return { version: 1, tokens: [], camera: { x: 32, y: 32 }, zoom: 1, map: null }
}
