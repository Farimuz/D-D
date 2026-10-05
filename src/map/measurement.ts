import { CELL_SIZE, MAX_CELL } from '../state/model.ts'
import type { Point } from '../state/model.ts'

export interface Measurement { from: Point; to: Point }
export function worldCell(point: Point): Point {
  const cell = (value: number) => Math.max(-MAX_CELL, Math.min(MAX_CELL, Math.floor(value / CELL_SIZE)))
  return { x: cell(point.x), y: cell(point.y) }
}
export function distanceFeet(measurement: Measurement): number {
  return 5 * Math.hypot(measurement.to.x - measurement.from.x, measurement.to.y - measurement.from.y)
}
export function distanceLabel(measurement: Measurement): string {
  return `${Number(distanceFeet(measurement).toFixed(1))} ft`
}
