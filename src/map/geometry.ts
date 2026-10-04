import { CELL_SIZE, MAX_CELL, MIN_ZOOM, MAX_ZOOM } from '../state/model.ts'
import type { Point, Token } from '../state/model.ts'

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
