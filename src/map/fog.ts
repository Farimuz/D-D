import { CELL_SIZE, MAX_CAMERA } from '../state/model.ts'
import type { BoardState, FogRegion, Point, Rectangle, Token } from '../state/model.ts'
import { cellCenter, screenToWorld } from './geometry.ts'

// Maps may start at a camera boundary and extend beyond it.
const FOG_LIMIT = MAX_CAMERA * 2
const limit = (value: number) => Math.max(-FOG_LIMIT, Math.min(FOG_LIMIT, value))

export function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Rectangle
  return [r.x, r.y, r.width, r.height].every(Number.isFinite)
    && r.width > 0 && r.height > 0 && Math.abs(r.x) <= FOG_LIMIT && Math.abs(r.y) <= FOG_LIMIT
    && r.x + r.width > r.x && r.y + r.height > r.y
    && Math.abs(r.x + r.width) <= FOG_LIMIT && Math.abs(r.y + r.height) <= FOG_LIMIT
}

export function rectangleBetween(a: Point, b: Point): Rectangle | null {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null
  const x = Math.min(limit(a.x), limit(b.x)), y = Math.min(limit(a.y), limit(b.y))
  const r = { x, y, width: Math.abs(limit(a.x) - limit(b.x)), height: Math.abs(limit(a.y) - limit(b.y)) }
  return isRectangle(r) ? r : null
}

// Half-open bounds give shared edges one owner. Visibility uses the cell center.
export function contains(r: Rectangle, point: Point): boolean {
  return point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height
}

// Four disjoint strips around the intersection; never rasterize or mutate inputs.
export function subtractRectangle(region: Rectangle, cut: Rectangle): Rectangle[] {
  const left = Math.max(region.x, cut.x), top = Math.max(region.y, cut.y)
  const right = Math.min(region.x + region.width, cut.x + cut.width), bottom = Math.min(region.y + region.height, cut.y + cut.height)
  if (right <= left || bottom <= top) return [region]
  const result = [
    { x: region.x, y: region.y, width: region.width, height: top - region.y },
    { x: region.x, y: bottom, width: region.width, height: region.y + region.height - bottom },
    { x: region.x, y: top, width: left - region.x, height: bottom - top },
    { x: right, y: top, width: region.x + region.width - right, height: bottom - top },
  ]
  return result.filter(isRectangle)
}

export function revealFog(regions: FogRegion[], cut: Rectangle, identity: () => string): FogRegion[] {
  return regions.flatMap(region => subtractRectangle(region, cut).map(part => part === region ? region : { ...part, id: identity() }))
}

export function visibleToPlayers(token: Token, regions: FogRegion[] = []): boolean {
  return token.visible !== false && !regions.some(region => contains(region, cellCenter(token)))
}

export function usedArea(board: BoardState, size: Point): Rectangle {
  if (board.map) return { x: board.map.x, y: board.map.y, width: board.map.width * board.map.scale, height: board.map.height * board.map.scale }
  const a = screenToWorld({ x: 0, y: 0 }, size, board.camera, board.zoom)
  const b = screenToWorld(size, size, board.camera, board.zoom)
  let left = Math.min(a.x, board.camera.x - CELL_SIZE * 5), top = Math.min(a.y, board.camera.y - CELL_SIZE * 5)
  let right = Math.max(b.x, board.camera.x + CELL_SIZE * 5), bottom = Math.max(b.y, board.camera.y + CELL_SIZE * 5)
  for (const token of board.tokens) {
    const center = cellCenter(token)
    left = Math.min(left, center.x - CELL_SIZE * 2); top = Math.min(top, center.y - CELL_SIZE * 2)
    right = Math.max(right, center.x + CELL_SIZE * 2); bottom = Math.max(bottom, center.y + CELL_SIZE * 2)
  }
  return rectangleBetween({ x: left, y: top }, { x: right, y: bottom })!
}
