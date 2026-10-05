import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { CELL_SIZE } from '../state/model'
import type { BoardMode, BoardState, FogAction, MapAsset, Point, Rectangle, Token } from '../state/model'
import { cellCenter, initials, limitCamera, screenToWorld, snapCell, worldToScreen, zoomAt } from '../map/geometry'
import type { View } from '../map/geometry'
import { worldCell } from '../map/measurement'
import type { Measurement } from '../map/measurement'
import MeasurementOverlay from './MeasurementOverlay'
import FogOverlay from './FogOverlay'
import { rectangleBetween, visibleToPlayers } from '../map/fog'

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
  player?: boolean
  fogAction?: FogAction
  onFog?(rectangle: Rectangle): void
}
interface Gesture extends View {
  pointerId: number
  start: Point
  token: Token | null
  map: MapAsset | null
  measure: Measurement | null
  fog: Point | null
  moved: boolean
}
interface Pinch { ids: [number, number]; midpoint: Point; distance: number; view: View }
interface Preview { camera?: Point; zoom?: number; token?: Token; map?: MapAsset; measure?: Measurement; fog?: Rectangle }
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export default function Board({ board, selectedId, onSelect, onChange, onSize, onGesture, onDelete, mode, mapUrl, disabled, onDone, player = false, fogAction = 'hide', onFog }: Props) {
  const surface = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<Pinch | null>(null)
  const view = useRef<View>({ camera: board.camera, zoom: board.zoom })
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelFrame = useRef<number | null>(null)
  const wheelDelta = useRef(0)
  const wheelAnchor = useRef<Point>({ x: 0, y: 0 })
  const suppressClick = useRef(false)
  const [size, setSize] = useState<Point>({ x: 0, y: 0 })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [measurement, setMeasurement] = useState<Measurement | null>(null)

  useEffect(() => {
    if (!pointers.current.size && !wheelTimer.current && wheelFrame.current === null) view.current = { camera: board.camera, zoom: board.zoom }
  }, [board.camera, board.zoom])
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

  function release(id: number) {
    if (surface.current?.hasPointerCapture(id)) surface.current.releasePointerCapture(id)
  }
  function cancel() {
    const ids = [...pointers.current.keys()]
    pointers.current.clear()
    gesture.current = null
    pinch.current = null
    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    wheelTimer.current = null
    if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current)
    wheelFrame.current = null
    wheelDelta.current = 0
    view.current = { camera: board.camera, zoom: board.zoom }
    setPreview(null)
    setMeasurement(null)
    onGesture(false)
    ids.forEach(release)
  }
  useEffect(() => { cancel() }, [mode, disabled, player, fogAction])
  useEffect(() => () => { if (wheelTimer.current) clearTimeout(wheelTimer.current); if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current) }, [])

  function commitView() {
    const next = view.current
    onChange(previous => ({ ...previous, ...next }))
    setPreview(null)
  }
  function finishWheel() {
    if (!wheelTimer.current && wheelFrame.current === null) return
    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    wheelTimer.current = null
    if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current)
    wheelFrame.current = null
    wheelDelta.current = 0
    commitView()
    onGesture(false)
  }
  function local(point: Point): Point {
    const box = surface.current!.getBoundingClientRect()
    return { x: point.x - box.x, y: point.y - box.y }
  }
  function pointerCell(point: Point, camera: Point, zoom: number): Point {
    return worldCell(screenToWorld(local(point), size, camera, zoom))
  }
  function showView(next: View) {
    view.current = next
    setPreview(next)
  }
  useEffect(() => {
    const element = surface.current!
    function wheel(event: WheelEvent) {
      event.preventDefault()
      if (disabled || pointers.current.size || event.deltaY === 0) return
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.y : 1)
      wheelDelta.current += delta
      wheelAnchor.current = local({ x: event.clientX, y: event.clientY })
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
      wheelTimer.current = null
      function frame() {
        const step = Math.max(-120, Math.min(120, wheelDelta.current))
        wheelDelta.current -= step
        showView(zoomAt(wheelAnchor.current, size, view.current, view.current.zoom * Math.exp(-step * 0.002)))
        if (Math.abs(wheelDelta.current) > 0.01) wheelFrame.current = requestAnimationFrame(frame)
        else {
          wheelFrame.current = null
          wheelDelta.current = 0
          wheelTimer.current = setTimeout(finishWheel, 150)
        }
      }
      if (wheelFrame.current === null) wheelFrame.current = requestAnimationFrame(frame)
      onGesture(true)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  })
  useEffect(() => {
    function interrupted() { if (pointers.current.size) cancel(); else finishWheel() }
    function visibility() { if (document.hidden) interrupted() }
    window.addEventListener('blur', interrupted)
    window.addEventListener('pagehide', interrupted)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('blur', interrupted)
      window.removeEventListener('pagehide', interrupted)
      document.removeEventListener('visibilitychange', visibility)
    }
  })

  function beginPinch() {
    const entries = [...pointers.current.entries()]
    const [a, b] = entries
    const active = gesture.current
    // Keep a camera pan's preview; roll back token, map and measurement previews.
    if (active?.token || active?.map || active?.measure || active?.fog) view.current = { camera: active.camera, zoom: active.zoom }
    gesture.current = null
    setMeasurement(null)
    suppressClick.current = true
    surface.current?.focus({ preventScroll: true })
    pinch.current = { ids: [a[0], b[0]], midpoint: local(midpoint(a[1], b[1])), distance: Math.max(1, distance(a[1], b[1])), view: view.current }
    setPreview(view.current)
  }
  function updatePinch() {
    const active = pinch.current!
    const a = pointers.current.get(active.ids[0])!
    const b = pointers.current.get(active.ids[1])!
    showView(zoomAt(active.midpoint, size, active.view, active.view.zoom * distance(a, b) / active.distance, local(midpoint(a, b))))
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || (!event.isPrimary && !pointers.current.size)) return
    if (pointers.current.size && event.pointerType !== 'touch') return
    finishWheel()
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    if (pointers.current.size >= 2) {
      if (!pinch.current) beginPinch()
      return
    }
    suppressClick.current = false
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-token-id]')
    const token = !player && mode === 'normal' ? board.tokens.find(item => item.id === button?.dataset.tokenId) ?? null : null
    if (token) onSelect(token.id)
    if (button && !player && mode === 'normal') button.focus({ preventScroll: true })
    else surface.current?.focus({ preventScroll: true })
    const cell = mode === 'measure' ? pointerCell(point, view.current.camera, view.current.zoom) : null
    const measure = cell ? { from: cell, to: cell } : null
    if (measure) setMeasurement(measure)
    const fog = !player && mode === 'fog' && fogAction !== 'navigate' ? screenToWorld(local(point), size, view.current.camera, view.current.zoom) : null
    gesture.current = { pointerId: event.pointerId, start: point, ...view.current, token, map: !player && mode === 'map' ? board.map ?? null : null, measure, fog, moved: false }
    onGesture(true)
  }
  function position(point: Point, active: Gesture): Preview {
    if (active.measure) return { measure: { ...active.measure, to: pointerCell(point, active.camera, active.zoom) } }
    const dx = point.x - active.start.x
    const dy = point.y - active.start.y
    if (Math.hypot(dx, dy) > 4) active.moved = true
    if (!active.moved) return {}
    suppressClick.current = true
    if (active.fog) return { fog: rectangleBetween(active.fog, screenToWorld(local(point), size, active.camera, active.zoom)) ?? undefined }
    if (active.map) return { map: { ...active.map, x: limitCamera(active.map.x + dx / active.zoom), y: limitCamera(active.map.y + dy / active.zoom) } }
    return active.token
      ? { token: { ...active.token, x: active.token.x + dx / active.zoom / CELL_SIZE, y: active.token.y + dy / active.zoom / CELL_SIZE } }
      : { camera: { x: limitCamera(active.camera.x - dx / active.zoom), y: limitCamera(active.camera.y - dy / active.zoom) } }
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    if (pinch.current) { updatePinch(); return }
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const next = position(point, active)
    if (next.camera) view.current = { camera: next.camera, zoom: active.zoom }
    setPreview(next)
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    if (pinch.current) {
      updatePinch()
      pointers.current.delete(event.pointerId)
      pinch.current = null
      commitView()
      if (pointers.current.size >= 2) beginPinch()
      else if (pointers.current.size === 1) {
        const [id, start] = [...pointers.current.entries()][0]
        // The remaining finger navigates; never resume an interrupted token/edit/measure drag.
        gesture.current = { pointerId: id, start, ...view.current, token: null, map: null, measure: null, fog: null, moved: false }
      } else onGesture(false)
      release(event.pointerId)
      return
    }
    const active = gesture.current
    pointers.current.delete(event.pointerId)
    if (!active || active.pointerId !== event.pointerId) { release(event.pointerId); return }
    const final = position(point, active)
    gesture.current = null
    setPreview(null)
    onGesture(false)
    if (final.fog && !player) onFog?.(final.fog)
    else if (final.measure) setMeasurement(final.measure)
    else if (final.map) onChange(previous => ({ ...previous, map: final.map! }))
    else if (final.token) {
      const moved = { ...final.token, x: snapCell(final.token.x), y: snapCell(final.token.y) }
      onChange(previous => ({ ...previous, tokens: previous.tokens.map(token => token.id === moved.id ? moved : token) }))
    } else if (final.camera) {
      view.current = { camera: final.camera, zoom: active.zoom }
      commitView()
    }
    release(event.pointerId)
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { cancel(); if (!player) onSelect(null); onDone(); return }
    if (disabled || pointers.current.size || wheelTimer.current || wheelFrame.current !== null || mode !== 'normal') return
    if (player && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); return }
    const token = !player ? board.tokens.find(item => item.id === selectedId) : undefined
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
  const zoom = preview?.zoom ?? board.zoom
  const spacing = CELL_SIZE * zoom
  const style = {
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${size.x / 2 - camera.x * zoom}px ${size.y / 2 - camera.y * zoom}px`,
    visibility: spacing < 8 ? 'hidden' : 'visible',
  } satisfies CSSProperties
  const map = preview?.map ?? board.map
  const mapPosition = map ? worldToScreen(map, size, camera, zoom) : null
  return (
    <div ref={surface} className={`board${preview ? ' dragging' : ''}${mode === 'map' ? ' adjusting' : ''}${mode === 'measure' || (mode === 'fog' && fogAction !== 'navigate') ? ' measuring' : ''}`} tabIndex={0} role="region" aria-label="Mesa cuadriculada" aria-describedby="board-hint" data-player={player} data-camera-x={camera.x} data-camera-y={camera.y} data-zoom={zoom}
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={event => { if (pointers.current.has(event.pointerId)) cancel() }}
      onLostPointerCapture={event => { if (pointers.current.has(event.pointerId)) cancel() }}
      onKeyDown={key} onContextMenu={event => event.preventDefault()}>
      {map && mapPosition && mapUrl && <img className="map-image" src={mapUrl} alt="Mapa importado" draggable={false}
        style={{ left: mapPosition.x, top: mapPosition.y, width: map.width * map.scale * zoom, height: map.height * map.scale * zoom }} />}
      <div className={`grid${map ? ' over-map' : ''}`} style={style} aria-hidden="true" />
      <FogOverlay regions={board.fog ?? []} draft={preview?.fog} action={fogAction} player={player} size={size} camera={camera} zoom={zoom} />
      {mode === 'measure' && (preview?.measure ?? measurement) && <MeasurementOverlay measurement={(preview?.measure ?? measurement)!} size={size} camera={camera} zoom={zoom} />}
      {board.tokens.filter(token => !player || visibleToPlayers(token, board.fog)).map(token => {
        const displayed = preview?.token?.id === token.id ? preview.token : token
        const point = worldToScreen(cellCenter(displayed), size, camera, zoom)
        const diameter = Math.max(2, spacing * 0.8)
        const tokenStyle = { left: point.x, top: point.y, width: Math.max(12, diameter), height: Math.max(12, diameter), '--token-size': `${diameter}px` } as CSSProperties
        if (player) return <div key={token.id} className="token player-token" role="img" aria-label={`Ficha ${token.name}`} data-token-id={token.id} style={tokenStyle}>
          <span className="token-face" aria-hidden="true" style={{ fontSize: Math.min(28, spacing * 0.3) }}>{diameter >= 14 ? initials(token.name) : ''}</span>
        </div>
        return (
          <button key={token.id} type="button" className={`token${selectedId === token.id ? ' selected' : ''}${token.visible === false ? ' dm-only' : ''}`}
            data-token-id={token.id} data-cell-x={token.x} data-cell-y={token.y}
            style={tokenStyle}
            aria-label={`Ficha ${token.name}`} aria-pressed={selectedId === token.id} title={token.visible === false ? `${token.name} · Solo DM` : token.name} aria-description={token.visible === false ? 'Solo DM' : undefined}
            disabled={disabled} onFocus={() => { if (mode === 'normal' && !pinch.current && pointers.current.size <= 1) onSelect(token.id) }} onClick={event => { if (mode === 'normal' && !pinch.current && (!suppressClick.current || event.detail === 0)) onSelect(token.id) }}>
            <span className="token-face" aria-hidden="true" style={{ fontSize: Math.min(28, spacing * 0.3) }}>{diameter >= 14 ? initials(token.name) : ''}</span>
          </button>
        )
      })}
    </div>
  )
}
