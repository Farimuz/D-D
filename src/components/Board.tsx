import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { CELL_SIZE, MAX_CAMERA } from '../state/model'
import type { BoardMode, BoardState, MapAsset, Point, Token } from '../state/model'
import { cellCenter, initials, screenToWorld, snapCell, worldToScreen } from '../map/geometry'
import { worldCell } from '../map/measurement'
import type { Measurement } from '../map/measurement'
import MeasurementOverlay from './MeasurementOverlay'

interface Props {
  board: BoardState
  selectedId: string | null
  onSelect(id: string | null): void
  onChange(update: (previous: BoardState) => BoardState): void
  onSize(size: Point): void
  onGesture(active: boolean): void
  onDelete(token: Token): void
  mode: BoardMode
  mapUrl: string | null
  disabled: boolean
  onDone(): void
}

interface Gesture {
  pointerId: number
  start: Point
  camera: Point
  zoom: number
  token: Token | null
  map: MapAsset | null
  measure: Measurement | null
  moved: boolean
}
interface Preview { camera?: Point; token?: Token; map?: MapAsset; measure?: Measurement }
const limitCamera = (value: number) => Math.max(-MAX_CAMERA, Math.min(MAX_CAMERA, value))

export default function Board({ board, selectedId, onSelect, onChange, onSize, onGesture, onDelete, mode, mapUrl, disabled, onDone }: Props) {
  const surface = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [size, setSize] = useState<Point>({ x: 0, y: 0 })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [measurement, setMeasurement] = useState<Measurement | null>(null)

  useEffect(() => {
    const element = surface.current!
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect()
      const next = { x: width, y: height }
      setSize(next)
      onSize(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [onSize])

  function cancel() {
    const active = gesture.current
    gesture.current = null
    setPreview(null)
    if (active?.measure) setMeasurement(null)
    onGesture(false)
    if (active && surface.current?.hasPointerCapture(active.pointerId)) surface.current.releasePointerCapture(active.pointerId)
  }

  useEffect(() => { cancel(); setMeasurement(null) }, [mode])

  function pointerCell(event: PointerEvent<HTMLDivElement>, camera: Point, zoom: number): Point {
    const box = surface.current!.getBoundingClientRect()
    return worldCell(screenToWorld({ x: event.clientX - box.x, y: event.clientY - box.y }, { x: box.width, y: box.height }, camera, zoom))
  }

  useEffect(() => {
    function interrupted() {
      if (gesture.current) cancel()
    }
    function visibility() { if (document.hidden) interrupted() }
    window.addEventListener('blur', interrupted)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('blur', interrupted)
      document.removeEventListener('visibilitychange', visibility)
    }
  })

  function down(event: PointerEvent<HTMLDivElement>) {
    if (disabled || gesture.current || !event.isPrimary || event.button !== 0) return
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-token-id]')
    const token = mode === 'normal' ? board.tokens.find(item => item.id === button?.dataset.tokenId) ?? null : null
    onSelect(token?.id ?? null)
    if (button && mode === 'normal') button.focus({ preventScroll: true })
    else surface.current?.focus({ preventScroll: true })
    const cell = mode === 'measure' ? pointerCell(event, board.camera, board.zoom) : null
    const measure = cell ? { from: cell, to: cell } : null
    if (measure) setMeasurement(measure)
    gesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, camera: board.camera, zoom: board.zoom, token, map: mode === 'map' ? board.map ?? null : null, measure, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    onGesture(true)
    event.preventDefault()
  }

  function position(event: PointerEvent<HTMLDivElement>, active: Gesture): Preview {
    if (active.measure) return { measure: { ...active.measure, to: pointerCell(event, active.camera, active.zoom) } }
    const dx = event.clientX - active.start.x
    const dy = event.clientY - active.start.y
    if (Math.hypot(dx, dy) > 4) active.moved = true
    if (!active.moved) return {}
    if (active.map) return { map: { ...active.map, x: limitCamera(active.map.x + dx / active.zoom), y: limitCamera(active.map.y + dy / active.zoom) } }
    return active.token
      ? { token: { ...active.token, x: active.token.x + dx / active.zoom / CELL_SIZE, y: active.token.y + dy / active.zoom / CELL_SIZE } }
      : { camera: { x: limitCamera(active.camera.x - dx / active.zoom), y: limitCamera(active.camera.y - dy / active.zoom) } }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    setPreview(position(event, active))
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const final = position(event, active)
    gesture.current = null
    setPreview(null)
    onGesture(false)
    if (final.measure) {
      setMeasurement(final.measure)
    } else if (final.map) {
      onChange(previous => ({ ...previous, map: final.map! }))
    } else if (final.token) {
      const moved = { ...final.token, x: snapCell(final.token.x), y: snapCell(final.token.y) }
      onChange(previous => ({ ...previous, tokens: previous.tokens.map(token => token.id === moved.id ? moved : token) }))
    } else if (final.camera) {
      onChange(previous => ({ ...previous, camera: final.camera! }))
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { cancel(); onSelect(null); onDone(); return }
    if (disabled || gesture.current || mode !== 'normal') return
    const token = board.tokens.find(item => item.id === selectedId)
    const directions: Record<string, Point> = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } }
    const step = directions[event.key]
    if (step) {
      event.preventDefault()
      if (token) onChange(previous => ({ ...previous, tokens: previous.tokens.map(item => item.id === token.id ? { ...item, x: snapCell(item.x + step.x), y: snapCell(item.y + step.y) } : item) }))
      else onChange(previous => ({ ...previous, camera: { x: limitCamera(previous.camera.x + step.x * CELL_SIZE), y: limitCamera(previous.camera.y + step.y * CELL_SIZE) } }))
    }
    if (token && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); onDelete(token) }
  }

  const camera = preview?.camera ?? board.camera
  const spacing = CELL_SIZE * board.zoom
  const style = {
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${size.x / 2 - camera.x * board.zoom}px ${size.y / 2 - camera.y * board.zoom}px`,
  } satisfies CSSProperties
  const map = preview?.map ?? board.map
  const mapPosition = map ? worldToScreen(map, size, camera, board.zoom) : null

  return (
    <div ref={surface} className={`board${preview ? ' dragging' : ''}${mode === 'map' ? ' adjusting' : ''}${mode === 'measure' ? ' measuring' : ''}`} tabIndex={0} role="region" aria-label="Mesa cuadriculada" aria-describedby="board-hint"
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={event => { if (gesture.current?.pointerId === event.pointerId) cancel() }}
      onLostPointerCapture={event => { if (gesture.current?.pointerId === event.pointerId) cancel() }}
      onKeyDown={key} onContextMenu={event => event.preventDefault()}>
      {map && mapPosition && mapUrl && <img className="map-image" src={mapUrl} alt="Mapa importado" draggable={false}
        style={{ left: mapPosition.x, top: mapPosition.y, width: map.width * map.scale * board.zoom, height: map.height * map.scale * board.zoom }} />}
      <div className={`grid${map ? ' over-map' : ''}`} style={style} aria-hidden="true" />
      {mode === 'measure' && (preview?.measure ?? measurement) && <MeasurementOverlay measurement={(preview?.measure ?? measurement)!} size={size} camera={camera} zoom={board.zoom} />}
      {board.tokens.map(token => {
        const displayed = preview?.token?.id === token.id ? preview.token : token
        const point = worldToScreen(cellCenter(displayed), size, camera, board.zoom)
        const diameter = Math.max(44, spacing * 0.8)
        return (
          <button key={token.id} type="button" className={`token${selectedId === token.id ? ' selected' : ''}`}
            data-token-id={token.id} data-cell-x={token.x} data-cell-y={token.y}
            style={{ left: point.x, top: point.y, width: diameter, height: diameter, fontSize: Math.max(14, Math.min(28, spacing * 0.3)) }}
            aria-label={`Ficha ${token.name}`} aria-pressed={selectedId === token.id} title={token.name}
            disabled={disabled} onFocus={() => { if (mode === 'normal') onSelect(token.id) }} onClick={() => { if (mode === 'normal') onSelect(token.id) }}>
            {initials(token.name)}
          </button>
        )
      })}
    </div>
  )
}
