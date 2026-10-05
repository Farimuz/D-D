import { CELL_SIZE, MAX_CELL, MAX_CAMERA, MIN_ZOOM, MAX_ZOOM } from '../state/model.ts'
import type { MapAsset, Point, Token } from '../state/model.ts'

export interface View { camera: Point; zoom: number }
export const limitCamera = (value: number) => Math.max(-MAX_CAMERA, Math.min(MAX_CAMERA, value))

// Preserve the world point under anchor, optionally moving it with a pinch midpoint.
export function zoomAt(anchor: Point, size: Point, view: View, requested: number, destination = anchor): View {
  const world = screenToWorld(anchor, size, view.camera, view.zoom)
  const zoom = clampZoom(requested)
  return { zoom, camera: {
    x: limitCamera(world.x - (destination.x - size.x / 2) / zoom),
    y: limitCamera(world.y - (destination.y - size.y / 2) / zoom),
  } }
}

export function buttonZoom(zoom: number, direction: -1 | 1): number {
  return clampZoom(direction < 0 ? (zoom <= 0.5 ? zoom * 0.8 : zoom - 0.25) : (zoom < 0.5 ? zoom * 1.25 : zoom + 0.25))
}

export function fitMap(map: MapAsset, size: Point, view: View, top = 48, bottom = 160): View {
  const available = { x: Math.max(1, size.x - 32), y: Math.max(1, size.y - top - bottom - 32) }
  const zoom = Math.min(available.x / (map.width * map.scale), available.y / (map.height * map.scale))
  const center = { x: map.x + map.width * map.scale / 2, y: map.y + map.height * map.scale / 2 }
  return zoomAt(worldToScreen(center, size, view.camera, view.zoom), size, view, zoom, { x: size.x / 2, y: (top + size.y - bottom) / 2 })
}

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

export function snapCell(value: number): number {
  return Math.max(-MAX_CELL, Math.min(MAX_CELL, Math.round(value)))
}

export function cellCenter(cell: Point): Point {
  return { x: (cell.x + 0.5) * CELL_SIZE, y: (cell.y + 0.5) * CELL_SIZE }
}

export function screenToWorld(point: Point, size: Point, camera: Point, zoom: number): Point {
  return { x: (point.x - size.x / 2) / zoom + camera.x, y: (point.y - size.y / 2) / zoom + camera.y }
}

export function worldToScreen(point: Point, size: Point, camera: Point, zoom: number): Point {
  return { x: (point.x - camera.x) * zoom + size.x / 2, y: (point.y - camera.y) * zoom + size.y / 2 }
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return (words.length === 1 ? Array.from(words[0])[0] : Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toLocaleUpperCase('es')
}

// Prefer an empty cell near the visible center, without an unbounded search.
export function spawnCell(tokens: Token[], camera: Point, zoom: number, size: Point): Point {
  const center = { x: snapCell(camera.x / CELL_SIZE - 0.5), y: snapCell(camera.y / CELL_SIZE - 0.5) }
  const occupied = new Set(tokens.map(token => `${token.x},${token.y}`))
  const radius = Math.max(0, Math.min(8, Math.floor((Math.min(size.x, size.y) / 2 - 80) / (CELL_SIZE * zoom))))
  for (let ring = 0; ring <= radius; ring++) {
    for (let y = -ring; y <= ring; y++) {
      for (let x = -ring; x <= ring; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue
        const cell = { x: snapCell(center.x + x), y: snapCell(center.y + y) }
        if (!occupied.has(`${cell.x},${cell.y}`)) return cell
      }
    }
  }
  return center
}

export function nearbyCell(tokens: Token[], origin: Point): Point {
  const occupied = new Set(tokens.map(token => `${token.x},${token.y}`))
  // Even at a board corner this radius contains more candidates than occupied cells.
  const radius = Math.ceil(Math.sqrt(tokens.length + 1)) + 1
  for (let ring = 1; ring <= radius; ring++) {
    for (let y = -ring; y <= ring; y++) {
      for (let x = -ring; x <= ring; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue
        const cell = { x: origin.x + x, y: origin.y + y }
        if (Math.abs(cell.x) <= MAX_CELL && Math.abs(cell.y) <= MAX_CELL && !occupied.has(`${cell.x},${cell.y}`)) return cell
      }
    }
  }
  // The finite occupancy bound above makes this unreachable for valid board data.
  throw new Error('No free nearby cell')
}
