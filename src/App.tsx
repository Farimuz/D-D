import { useRef, useState } from 'react'
import Board from './components/Board'
import NameDialog from './components/NameDialog'
import MapControls from './components/MapControls'
import { cellCenter, clampZoom, nearbyCell, spawnCell } from './map/geometry'
import { emptyBoard } from './state/model'
import type { BoardMode, Point, Token } from './state/model'
import { useBoard } from './state/useBoard'
import { newId } from './state/id'
import { initialMap, validateImage } from './map/mapAsset'
import { useMapImage } from './map/useMapImage'
import { clearMaps, deleteMap, storeMap } from './storage/mapAssets'

export default function App() {
  const { board, warning, change, getBoard } = useBoard()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Token | null>(null)
  const [gesturing, setGesturing] = useState(false)
  const [size, setSize] = useState<Point>({ x: 0, y: 0 })
  const [announcement, setAnnouncement] = useState('')
  const [mode, setMode] = useState<BoardMode>('normal')
  const [mapMenu, setMapMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mapWarning, setMapWarning] = useState<string | null>(null)
  const processing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const mapImage = useMapImage(board.map?.id)
  const createButton = useRef<HTMLButtonElement>(null)
  const selected = board.tokens.find(token => token.id === selectedId)

  function closeDialog() {
    setCreating(false)
    setRenaming(null)
    createButton.current?.focus()
  }

  function rename(name: string) {
    if (!renaming) return
    change(previous => ({ ...previous, tokens: previous.tokens.map(token => token.id === renaming.id ? { ...token, name } : token) }))
    closeDialog()
    setAnnouncement(`Ficha renombrada: ${name}.`)
  }

  function duplicate(token: Token) {
    const id = newId()
    change(previous => ({ ...previous, tokens: [...previous.tokens, { id, name: token.name, ...nearbyCell(previous.tokens, token) }] }))
    setSelectedId(id)
    setAnnouncement(`Ficha ${token.name} duplicada.`)
  }

  function create(name: string) {
    const id = newId()
    change(previous => ({ ...previous, tokens: [...previous.tokens, { id, name, ...spawnCell(previous.tokens, previous.camera, previous.zoom, size) }] }))
    closeDialog()
    setSelectedId(id)
    setAnnouncement(`Ficha ${name} creada.`)
  }

  function remove(token: Token) {
    if (!window.confirm(`¿Eliminar la ficha «${token.name}»?`)) return
    change(previous => ({ ...previous, tokens: previous.tokens.filter(item => item.id !== token.id) }))
    setSelectedId(null)
    setAnnouncement(`Ficha ${token.name} eliminada.`)
    createButton.current?.focus()
  }

  async function reset() {
    if (processing.current || !window.confirm('¿Limpiar la mesa? Se eliminarán todas las fichas y el mapa guardados en este navegador.')) return
    const hadMap = Boolean(getBoard().map)
    if (!change(() => emptyBoard(), true, hadMap) && hadMap) return
    setSelectedId(null)
    setMode('normal')
    setMapMenu(false)
    setMapWarning(null)
    setAnnouncement('Mesa vacía. Vista restablecida.')
    processing.current = true
    setBusy(true)
    try { await clearMaps() }
    catch { setMapWarning('La mesa está vacía, pero no se pudo borrar la imagen almacenada. Usa «Limpiar» para reintentar.') }
    finally { processing.current = false; setBusy(false) }
  }

  async function importMap(file: File) {
    if (processing.current) return
    processing.current = true
    setBusy(true)
    setMapWarning(null)
    let candidate: string | null = null
    let committed = false
    try {
      const valid = await validateImage(file)
      candidate = newId()
      await storeMap(candidate, valid.blob)
      const previous = getBoard()
      const map = initialMap(candidate, valid.width, valid.height, previous.camera, previous.zoom, size)
      if (!change(state => ({ ...state, map }), false, true)) throw new Error('No se pudo guardar la referencia del mapa. El mapa anterior se conservó; comprueba el almacenamiento de la mesa.')
      committed = true
      setMode('map')
      setMapMenu(false)
      setSelectedId(null)
      setAnnouncement('Mapa importado. Ajusta su posición y escala; después pulsa Listo.')
      if (previous.map) {
        try { await deleteMap(previous.map.id) }
        catch { setMapWarning('El nuevo mapa está guardado, pero no se pudo borrar la imagen anterior. Usa «Limpiar» cuando ya no necesites la mesa.') }
      }
    } catch (error) {
      setMapWarning(error instanceof Error ? error.message : 'No se pudo importar el mapa.')
    } finally {
      if (candidate && !committed) {
        try { await deleteMap(candidate) }
        catch { setMapWarning('La importación falló y no se pudo borrar su imagen. El mapa anterior se conservó; usa «Limpiar» cuando ya no necesites la mesa.') }
      }
      processing.current = false
      setBusy(false)
    }
  }

  async function removeMap() {
    const map = getBoard().map
    if (!map || processing.current || !window.confirm('¿Eliminar el mapa? Las fichas se conservarán.')) return
    if (!change(previous => ({ ...previous, map: null }), false, true)) return
    setMode('normal')
    setMapMenu(false)
    setMapWarning(null)
    processing.current = true
    setBusy(true)
    try { await deleteMap(map.id); setAnnouncement('Mapa eliminado. Las fichas se conservaron.') }
    catch { setMapWarning('El mapa se retiró, pero no se pudo borrar la imagen almacenada. Usa «Limpiar» para reintentar.') }
    finally { processing.current = false; setBusy(false) }
  }

  function center() {
    change(previous => ({ ...previous, camera: selected ? cellCenter(selected) : emptyBoard().camera, zoom: 1 }))
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand"><h1>D&D</h1><span>Mesa local <span className="version">· v0.0.2</span></span></div>
        <button className="quiet" onClick={() => void reset()} disabled={gesturing || busy}>Limpiar</button>
      </header>
      <main className="table">
        <Board board={board} selectedId={selectedId} onSelect={id => { setSelectedId(id); if (id) setMapMenu(false) }} onChange={change} onSize={setSize} onGesture={setGesturing} onDelete={remove} mode={mode} mapUrl={mapImage.url} disabled={busy} onDone={() => setMode('normal')} />
        <div className="map-info" aria-hidden="true">1 casilla = 5 pies</div>
        {board.tokens.length === 0 && !board.map && mode === 'normal' && <div className="empty-hint"><span className="empty-symbol" aria-hidden="true">＋</span><strong>Tu mesa empieza aquí</strong><span>Crea una ficha o importa un mapa.</span></div>}
        <div className="bottom-controls">
          {(warning || mapWarning || mapImage.warning) && <p className="storage-warning" role="alert">{[warning, mapWarning, mapImage.warning].filter(Boolean).join(' ')}</p>}
          {busy && <p className="board-hint" role="status">Procesando mapa…</p>}
          {mode === 'map' && board.map && <MapControls map={board.map} disabled={gesturing || busy} onDone={() => setMode('normal')} onScale={scale => change(previous => ({ ...previous, map: previous.map ? { ...previous.map, scale } : null }))} />}
          {mode === 'measure' && <section className="map-panel" aria-label="Medir distancias"><div className="panel-heading"><strong>Medir</strong><button onClick={() => setMode('normal')} disabled={gesturing || busy}>Listo</button></div><p>Arrastra de una casilla a otra · 5 pies por casilla</p></section>}
          {mapMenu && board.map && mode === 'normal' && <section className="map-panel map-actions" aria-label="Opciones del mapa">
            <button disabled={gesturing || busy} onClick={() => { setMode('map'); setMapMenu(false); setSelectedId(null) }}>Ajustar mapa</button>
            <button disabled={gesturing || busy} onClick={() => fileInput.current?.click()}>Reemplazar</button>
            <button className="danger" disabled={gesturing || busy} onClick={() => void removeMap()}>Eliminar mapa</button>
          </section>}
          {selected && mode === 'normal' && <section className="selection" aria-label="Ficha seleccionada">
            <div className="selection-name"><span>Ficha seleccionada</span><strong>{selected.name}</strong></div>
            <div className="selection-actions">
            <button onClick={() => setRenaming(selected)} disabled={gesturing || busy} aria-label={`Editar nombre de ${selected.name}`}>Nombre</button>
            <button onClick={() => duplicate(selected)} disabled={gesturing || busy} aria-label={`Duplicar ${selected.name}`}>Duplicar</button>
            <button className="danger" onClick={() => remove(selected)} disabled={gesturing || busy} aria-label={`Eliminar ${selected.name}`}>Eliminar</button>
            </div>
          </section>}
          <div className="toolbar" role="group" aria-label="Controles de la mesa">
            <div className="main-actions">
              <button ref={createButton} className="primary create-button" onClick={() => { setMode('normal'); setMapMenu(false); setCreating(true) }} disabled={gesturing || busy}>＋ Ficha</button>
              <button aria-pressed={mapMenu || mode === 'map'} onClick={() => { if (board.map) { setMode('normal'); setSelectedId(null); setMapMenu(!mapMenu) } else fileInput.current?.click() }} disabled={gesturing || busy}>Mapa</button>
              <button aria-pressed={mode === 'measure'} onClick={() => { setMode(mode === 'measure' ? 'normal' : 'measure'); setMapMenu(false); setSelectedId(null) }} disabled={gesturing || busy}>Medir</button>
            </div>
            <div className="camera-actions">
            <div className="zoom-controls" role="group" aria-label="Zoom">
              <button aria-label="Alejar" onClick={() => change(previous => ({ ...previous, zoom: clampZoom(Number((previous.zoom - 0.25).toFixed(2))) }))} disabled={gesturing || busy || board.zoom <= 0.5}>−</button>
              <output aria-label="Nivel de zoom">{Math.round(board.zoom * 100)}%</output>
              <button aria-label="Acercar" onClick={() => change(previous => ({ ...previous, zoom: clampZoom(Number((previous.zoom + 0.25).toFixed(2))) }))} disabled={gesturing || busy || board.zoom >= 2.5}>＋</button>
            </div>
            <button className="center-button" aria-label="Centrar vista" title="Centrar la ficha seleccionada o volver al inicio · 100%" onClick={center} disabled={gesturing || busy}>⌖</button>
            </div>
          </div>
          <p id="board-hint" className="board-hint">{mode === 'map' ? 'Ajustando mapa · Las fichas están bloqueadas' : mode === 'measure' ? 'Midiendo · Las fichas y la cámara están bloqueadas' : 'Arrastra una ficha para moverla · Arrastra el fondo para explorar'}</p>
        </div>
      </main>
      <div className="sr-only" aria-live="polite">{announcement}</div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Archivo del mapa" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importMap(file) }} />
      {(creating || renaming) && <NameDialog onCreate={renaming ? rename : create} onClose={closeDialog} initialName={renaming?.name} title={renaming ? 'Editar nombre' : undefined} submitLabel={renaming ? 'Guardar nombre' : undefined} />}
    </div>
  )
}
