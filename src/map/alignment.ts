import { CELL_SIZE, MAX_CAMERA } from '../state/model.ts'
import type { MapAsset, Point } from '../state/model.ts'
import { MIN_MAP_SCALE, MAX_MAP_SCALE } from './mapAsset.ts'
import { limitCamera, screenToWorld } from './geometry.ts'
import type { View } from './geometry.ts'

// Relative difference against the mean treats both axes symmetrically.
export const SQUARE_TOLERANCE = 0.06
export const MIN_SOURCE_CELL = 1
export const MAX_INSPECTION_ZOOM = 32
export const MIN_INSPECTION_ZOOM = 1e-9
export type AlignmentResult = { width: number; height: number; map: MapAsset; error?: never } | { error: string; width?: number; height?: number; map?: never }

export function imageToWorld(point: Point, map: MapAsset): Point {
  return { x: map.x + point.x * map.scale, y: map.y + point.y * map.scale }
}
export function worldToImage(point: Point, map: MapAsset): Point {
  return { x: (point.x - map.x) / map.scale, y: (point.y - map.y) / map.scale }
}
export function insideImage(point: Point, map: MapAsset): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x <= map.width && point.y <= map.height
}

export function alignMap(map: MapAsset, first: Point, second: Point, columns = 1, rows = 1): AlignmentResult {
  if (![map.x, map.y, map.scale, map.width, map.height].every(Number.isFinite) || map.scale <= 0 ||
      !insideImage(first, map) || !insideImage(second, map)) return { error: 'Marca los puntos dentro de la imagen.' }
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 1 || rows < 1) return { error: 'Introduce columnas y filas enteras, mayores que cero.' }
  const width = Math.abs(second.x - first.x) / columns
  const height = Math.abs(second.y - first.y) / rows
  if (Math.min(width, height) < MIN_SOURCE_CELL) return { width, height, error: 'Los puntos están demasiado cerca. Amplía la imagen y ajusta los puntos.' }
  if (Math.abs(width - height) / ((width + height) / 2) > SQUARE_TOLERANCE) return { width, height, error: 'La selección no parece corresponder a una casilla cuadrada. Ajusta los puntos.' }
  // Geometric mean: equal relative influence for width and height, no axis distortion.
  const scale = CELL_SIZE / Math.sqrt(width * height)
  if (!Number.isFinite(scale) || scale < MIN_MAP_SCALE || scale > MAX_MAP_SCALE) return { width, height, error: 'La escala calculada está fuera del rango del mapa (0.5–1600 %). Ajusta los puntos.' }
  const projected = imageToWorld(first, { ...map, scale })
  const x = Math.round(projected.x / CELL_SIZE) * CELL_SIZE - first.x * scale
  const y = Math.round(projected.y / CELL_SIZE) * CELL_SIZE - first.y * scale
  if (![x, y].every(value => Number.isFinite(value) && Math.abs(value) <= MAX_CAMERA)) return { width, height, error: 'La posición calculada excede los límites de la mesa.' }
  return { width, height, map: { ...map, scale, x, y } }
}

// Inspection uses image pixels, independently of the saved board zoom limits.
export function inspectZoom(anchor: Point, size: Point, view: View, requested: number, destination = anchor): View {
  const point = screenToWorld(anchor, size, view.camera, view.zoom)
  const zoom = Math.max(MIN_INSPECTION_ZOOM, Math.min(MAX_INSPECTION_ZOOM, requested))
  return { zoom, camera: {
    x: limitCamera(point.x - (destination.x - size.x / 2) / zoom),
    y: limitCamera(point.y - (destination.y - size.y / 2) / zoom),
  } }
}
