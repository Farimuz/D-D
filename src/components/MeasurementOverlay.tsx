import type { Point } from '../state/model'
import type { Measurement } from '../map/measurement'
import { distanceLabel } from '../map/measurement'
import { cellCenter, worldToScreen } from '../map/geometry'

interface Props { measurement: Measurement; size: Point; camera: Point; zoom: number }
export default function MeasurementOverlay({ measurement, size, camera, zoom }: Props) {
  const from = worldToScreen(cellCenter(measurement.from), size, camera, zoom)
  const to = worldToScreen(cellCenter(measurement.to), size, camera, zoom)
  const left = Math.max(45, Math.min(size.x - 45, (from.x + to.x) / 2))
  const top = Math.max(25, Math.min(size.y - 25, (from.y + to.y) / 2 - 24))
  return <div className="measurement">
    <svg width="100%" height="100%" aria-hidden="true">
      <line className="measurement-shadow" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      <circle cx={from.x} cy={from.y} r="5" /><circle cx={to.x} cy={to.y} r="5" />
    </svg>
    <output className="distance" aria-label="Distancia" aria-live="polite" style={{ left, top }}>{distanceLabel(measurement)}</output>
  </div>
}
