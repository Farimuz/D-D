import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, KeyboardEvent } from 'react'
import type { MapAsset, Point } from '../state/model'
import { CELL_SIZE } from '../state/model'
import { clampZoom, limitCamera, screenToWorld, worldToScreen } from '../map/geometry'
import type { View } from '../map/geometry'
import { alignMap, imageToWorld, insideImage, inspectZoom, MAX_INSPECTION_ZOOM, MIN_INSPECTION_ZOOM, worldToImage } from '../map/alignment'

interface Props { map: MapAsset; url: string; initialView: View; onCancel(): void; onApply(map: MapAsset, view: View): boolean }
interface Drag { id: number; start: Point; view: View; handle: number; points: Point[]; moved: boolean }
interface Pinch { ids: number[]; center: Point; distance: number; view: View }
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export default function MapAlignment({ map, url, initialView, onCancel, onApply }: Props) {
  const [method, setMethod] = useState<'cell' | 'size' | null>(null)
  const [columns, setColumns] = useState('')
  const [rows, setRows] = useState('')
  const [points, setPoints] = useState<Point[]>([])
  const [size, setSize] = useState<Point>({ x: 0, y: 0 })
  const [view, setView] = useState<View>(() => ({ camera: worldToImage(initialView.camera, map), zoom: Math.max(MIN_INSPECTION_ZOOM, Math.min(MAX_INSPECTION_ZOOM, initialView.zoom * map.scale)) }))
  const [active, setActive] = useState(false)
  const [notice, setNotice] = useState('')
  const surface = useRef<HTMLDivElement>(null)
  const current = useRef(view)
  const chosen = useRef(points)
  const drag = useRef<Drag | null>(null)
  const pinch = useRef<Pinch | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const countValid = method !== 'size' || [Number(columns), Number(rows)].every(value => Number.isSafeInteger(value) && value > 0)
  const result = points.length === 2 ? alignMap(map, points[0], points[1], method === 'size' ? Number(columns) : 1, method === 'size' ? Number(rows) : 1) : null
  const proposal = result?.map

  function showView(next: View) { current.current = next; setView(next) }
  function choose(next: Point[]) { chosen.current = next; setPoints(next); setNotice('') }
  function chooseMethod(next: 'cell' | 'size') { setMethod(next); surface.current?.focus() }
  function release(id: number) { if (surface.current?.hasPointerCapture(id)) surface.current.releasePointerCapture(id) }
  function cancelGesture() {
    if (drag.current && drag.current.handle >= 0) choose(drag.current.points)
    const ids = [...pointers.current.keys()]
    pointers.current.clear(); drag.current = null; pinch.current = null; setActive(false)
    ids.forEach(release)
  }
  useEffect(() => {
    const element = surface.current!
    const observer = new ResizeObserver(([entry]) => setSize({ x: entry.contentRect.width, y: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = surface.current!
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (pointers.current.size) return
      const rect = element.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      showView(inspectZoom({ x: event.clientX - rect.x, y: event.clientY - rect.y }, size, current.current, current.current.zoom * Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002)))
    }
    const hidden = () => { if (document.hidden) cancelGesture() }
    element.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('blur', cancelGesture)
    window.addEventListener('pagehide', cancelGesture)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      element.removeEventListener('wheel', wheel)
      window.removeEventListener('blur', cancelGesture)
      window.removeEventListener('pagehide', cancelGesture)
      document.removeEventListener('visibilitychange', hidden)
    }
  })
  function local(event: PointerEvent): Point {
    const rect = surface.current!.getBoundingClientRect()
    return { x: event.clientX - rect.x, y: event.clientY - rect.y }
  }
  function startPinch() {
    if (drag.current?.handle !== undefined && drag.current.handle >= 0) choose(drag.current.points)
    drag.current = null
    const entries = [...pointers.current.entries()].slice(0, 2)
    pinch.current = { ids: entries.map(([id]) => id), center: midpoint(entries[0][1], entries[1][1]), distance: Math.max(1, distance(entries[0][1], entries[1][1])), view: current.current }
  }
  function updatePinch() {
    const gesture = pinch.current!
    const a = pointers.current.get(gesture.ids[0])!, b = pointers.current.get(gesture.ids[1])!
    showView(inspectZoom(gesture.center, size, gesture.view, gesture.view.zoom * distance(a, b) / gesture.distance, midpoint(a, b)))
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (pointers.current.size && event.pointerType !== 'touch')) return
    event.preventDefault()
    const point = local(event)
    pointers.current.set(event.pointerId, point)
    surface.current!.setPointerCapture(event.pointerId)
    setActive(true)
    if (pointers.current.size >= 2) { if (!pinch.current) startPinch(); return }
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')
    if (handle) handle.focus(); else surface.current!.focus()
    drag.current = { id: event.pointerId, start: point, view: current.current, handle: handle ? Number(handle.dataset.handle) : -1, points: chosen.current, moved: false }
  }
  function bounded(point: Point): Point { return { x: Math.max(0, Math.min(map.width, point.x)), y: Math.max(0, Math.min(map.height, point.y)) } }
  function moveDrag(point: Point) {
    const gesture = drag.current
    if (!gesture) return
    const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y
    if (Math.hypot(dx, dy) > 4) gesture.moved = true
    if (!gesture.moved) return
    if (gesture.handle >= 0) {
      const origin = gesture.points[gesture.handle]
      choose(gesture.points.map((p, i) => i === gesture.handle ? bounded({ x: origin.x + dx / gesture.view.zoom, y: origin.y + dy / gesture.view.zoom }) : p))
    } else showView({ zoom: gesture.view.zoom, camera: { x: limitCamera(gesture.view.camera.x - dx / gesture.view.zoom), y: limitCamera(gesture.view.camera.y - dy / gesture.view.zoom) } })
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, local(event))
    if (pinch.current) updatePinch()
    else if (drag.current?.id === event.pointerId) moveDrag(local(event))
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    const point = local(event)
    pointers.current.set(event.pointerId, point)
    if (pinch.current) {
      updatePinch(); pointers.current.delete(event.pointerId); pinch.current = null
      if (pointers.current.size >= 2) startPinch()
      else if (pointers.current.size) {
        const [id, start] = [...pointers.current.entries()][0]
        // A remaining finger can pan but must never become a new selection tap.
        drag.current = { id, start, view: current.current, handle: -1, points: chosen.current, moved: true }
      }
    } else {
      moveDrag(point)
      if (drag.current && !drag.current.moved && drag.current.handle < 0 && method && countValid && chosen.current.length < 2) {
        const image = screenToWorld(point, size, current.current.camera, current.current.zoom)
        if (insideImage(image, map)) choose([...chosen.current, image])
        else setNotice('Marca una intersección dentro de la imagen.')
      }
      pointers.current.delete(event.pointerId); drag.current = null
    }
    if (!pointers.current.size) { drag.current = null; setActive(false) }
    release(event.pointerId)
  }
  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
    if (!delta[event.key] || active) return
    event.preventDefault(); event.stopPropagation()
    const step = event.shiftKey ? 1 : 0.25, direction = delta[event.key]
    choose(chosen.current.map((point, i) => i === index ? bounded({ x: point.x + direction.x * step, y: point.y + direction.y * step }) : point))
  }
  function fit() {
    showView({ camera: { x: map.width / 2, y: map.height / 2 }, zoom: Math.max(MIN_INSPECTION_ZOOM, Math.min(MAX_INSPECTION_ZOOM, (size.x - 48) / map.width, (size.y - 48) / map.height)) })
  }
  function apply() {
    if (!proposal || active) return
    const camera = imageToWorld(current.current.camera, proposal)
    if (!onApply(proposal, { camera: { x: limitCamera(camera.x), y: limitCamera(camera.y) }, zoom: clampZoom(current.current.zoom / proposal.scale) })) setNotice('No se pudo guardar la alineación. La configuración anterior se conserva; puedes reintentar o cancelar.')
  }
  const imagePosition = worldToScreen({ x: 0, y: 0 }, size, view.camera, view.zoom)
  // This is the world grid under the proposed transform, expressed in image space.
  // Keeping the image-space camera fixed avoids moving handles when their scale changes.
  const gridOrigin = proposal ? worldToScreen(worldToImage({ x: 0, y: 0 }, proposal), size, view.camera, view.zoom) : null
  const spacing = proposal ? CELL_SIZE / proposal.scale * view.zoom : 0
  return <section className="alignment" aria-label="Alinear cuadrícula" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}>
    <div className="alignment-heading">
      <strong>Alinear cuadrícula{method ? ` · ${method === 'cell' ? 'Marcar una casilla' : 'Sé el tamaño'}` : ''}</strong>
      {!method ? <div className="alignment-actions"><button className="primary" autoFocus onClick={() => chooseMethod('cell')}>Marcar una casilla</button><button onClick={() => chooseMethod('size')}>Sé el tamaño</button></div> : <>
        {method === 'size' && <div className="alignment-counts">
          <label>Columnas <input type="number" min="1" step="1" value={columns} disabled={active} onChange={event => setColumns(event.target.value)} /></label>
          <label>Filas <input type="number" min="1" step="1" value={rows} disabled={active} onChange={event => setRows(event.target.value)} /></label>
        </div>}
        <p>{points.length < 2 ? (method === 'cell' ? 'Marca dos esquinas opuestas de una casilla del mapa.' : 'Marca dos esquinas opuestas de toda la cuadrícula útil, sin márgenes.') : 'Arrastra los puntos para afinar. La cuadrícula clara muestra la alineación propuesta.'}</p>
        <span className="alignment-progress">{points.length < 2 ? `Punto ${points.length + 1} de 2 · Arrastra el fondo para navegar` : 'Vista previa · Aún sin guardar'}</span>
      </>}
    </div>
    <div ref={surface} className="alignment-surface board" tabIndex={0} aria-label="Mapa para alinear" data-zoom={view.zoom} data-camera-x={view.camera.x} data-camera-y={view.camera.y}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={event => { if (pointers.current.has(event.pointerId)) cancelGesture() }} onLostPointerCapture={event => { if (pointers.current.has(event.pointerId)) cancelGesture() }} onContextMenu={event => event.preventDefault()}>
      <img className="map-image" src={url} alt="Mapa en alineación" draggable={false} style={{ left: imagePosition.x, top: imagePosition.y, width: map.width * view.zoom, height: map.height * view.zoom }} />
      {gridOrigin && spacing >= 8 && <div className="grid over-map alignment-grid" aria-hidden="true" data-scale={proposal!.scale} data-map-x={proposal!.x} data-map-y={proposal!.y} style={{ backgroundSize: `${spacing}px ${spacing}px`, backgroundPosition: `${gridOrigin.x}px ${gridOrigin.y}px` }} />}
      {points.map((point, index) => {
        const screen = worldToScreen(point, size, view.camera, view.zoom)
        return <button key={index} className="alignment-handle" data-handle={index} data-image-x={point.x} data-image-y={point.y} disabled={points.length < 2} aria-label={`Punto ${index + 1}`} title="Arrastra para ajustar; flechas: 0.25 px, Mayús + flechas: 1 px" style={{ left: screen.x, top: screen.y }} onKeyDown={event => handleKey(event, index)}><span aria-hidden="true">{index + 1}</span></button>
      })}
    </div>
    <div className="alignment-footer">
      {method && <output className="alignment-result" aria-label="Resultado de alineación">{result?.width !== undefined ? <>Casilla detectada: {result.width.toFixed(1)} × {result.height!.toFixed(1)} px<br />Escala resultante: {proposal ? `${(proposal.scale * 100).toFixed(1)} %` : '—'}</> : 'Marca los dos puntos para ver la alineación.'}</output>}
      {(notice || result?.error || !countValid) && <p className="alignment-error" role="alert">{notice || result?.error || 'Introduce columnas y filas enteras, mayores que cero.'}</p>}
      <div className="alignment-navigation" role="group" aria-label="Navegar durante alineación">
        <button aria-label="Alejar para alinear" disabled={active || view.zoom <= MIN_INSPECTION_ZOOM} onClick={() => showView(inspectZoom({ x: size.x / 2, y: size.y / 2 }, size, view, view.zoom / 2))}>−</button>
        <button aria-label="Acercar para alinear" disabled={active || view.zoom >= MAX_INSPECTION_ZOOM} onClick={() => showView(inspectZoom({ x: size.x / 2, y: size.y / 2 }, size, view, view.zoom * 2))}>＋</button>
        <button disabled={active} onClick={fit}>Ver mapa</button><span>Rueda o dos dedos para zoom</span>
      </div>
      <div className="alignment-actions">
        {method && <><button className="primary" disabled={!proposal || active} onClick={apply}>Aplicar</button><button disabled={active} onClick={() => choose([])}>Reintentar</button></>}
        <button onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  </section>
}
