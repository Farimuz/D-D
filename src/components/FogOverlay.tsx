import type { FogAction, FogRegion, Point, Rectangle } from '../state/model'
import { worldToScreen } from '../map/geometry'

interface Props { regions: FogRegion[]; draft?: Rectangle; action: FogAction; player: boolean; size: Point; camera: Point; zoom: number }
export default function FogOverlay({ regions, draft, action, player, size, camera, zoom }: Props) {
  function path(r: Rectangle): string {
    const point = worldToScreen(r, size, camera, zoom)
    // Clip huge world coordinates before sending them to SVG, retaining exact state.
    const x = Math.max(-1, point.x), y = Math.max(-1, point.y)
    const right = Math.min(size.x + 1, point.x + r.width * zoom), bottom = Math.min(size.y + 1, point.y + r.height * zoom)
    return right > x && bottom > y ? `M${x},${y}h${right - x}v${bottom - y}h${x - right}Z` : ''
  }
  return <svg className={`fog${player ? ' player-fog' : ''}`} width="100%" height="100%" aria-hidden="true" data-region-count={regions.length}>
    {/* One nonzero path keeps overlapping regions uniformly translucent in DM view. */}
    <path className="fog-cover" d={regions.map(path).join('')} />
    {!player && draft && <path className={`fog-draft ${action}`} d={path(draft)} />}
  </svg>
}
