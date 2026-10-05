import { useRef, useState } from 'react'
import Board from './components/Board'
import NameDialog from './components/NameDialog'
import MapControls from './components/MapControls'
import MapAlignment from './components/MapAlignment'
import FogControls from './components/FogControls'
import ActionButton from './components/ActionButton'
import { buttonZoom, cellCenter, fitMap, nearbyCell, spawnCell } from './map/geometry'
import type { View } from './map/geometry'
import { revealFog, usedArea } from './map/fog'
import { emptyBoard, MIN_ZOOM } from './state/model'
import type { BoardMode, BoardState, FogAction, Point, Rectangle, Token } from './state/model'
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
  const [fogAction, setFogAction] = useState<FogAction>('hide')
  // Only preview navigation is separate. Map, tokens and fog share one BoardState.
  const [playerView, setPlayerView] = useState<View | null>(null)
  const [mapMenu, setMapMenu] = useState(false)
  const [aligning, setAligning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mapWarning, setMapWarning] = useState<string | null>(null)
  const processing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const mapImage = useMapImage(board.map?.id)
  const createButton = useRef<HTMLButtonElement>(null)
  const selectionHeight = useRef(140)
  const selected = board.tokens.find(token => token.id === selectedId)
  const player = playerView !== null
  const displayedBoard = playerView ? { ...board, ...playerView } : board

  function changeView(update: (previous: BoardState) => BoardState) {
    if (!player) { change(update); return }
    // This boundary accepts only ephemeral camera/zoom, never saves an edit.
    setPlayerView(current => {
      if (!current) return null
      const next = update({ ...getBoard(), ...current })
      return { camera: next.camera, zoom: next.zoom }
    })
  }

  function editFog(rectangle: Rectangle) {
    if (player) return
    change(previous => ({ ...previous, fog: fogAction === 'hide'
      ? [...(previous.fog ?? []), { ...rectangle, id: newId() }]
      : revealFog(previous.fog ?? [], rectangle, newId) }))
  }

  function previewPlayers() {
    setMode('normal')
    setMapMenu(false)
    setPlayerView({ camera: board.camera, zoom: board.zoom })
    setAnnouncement('Vista jugadores. Solo navegación.')
  }

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
    if (processing.current || !window.confirm('¿Limpiar la mesa? Se eliminarán todas las fichas, el mapa y la niebla guardados en este navegador.')) return
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
    changeView(previous => ({ ...previous, ...(player && previous.map ? fitMap(previous.map, size, previous, 48, 120) : { camera: !player && selected ? cellCenter(selected) : emptyBoard().camera, zoom: 1 }) }))
  }

  function showMap() {
    if (!board.map) return
    const controls = document.querySelector('.toolbar')?.getBoundingClientRect()
    const surface = document.querySelector('.board')?.getBoundingClientRect()
    const bottom = controls && surface ? surface.bottom - controls.top + (selected ? selectionHeight.current + 8 : 0) : 160
    change(previous => ({ ...previous, ...fitMap(board.map!, size, previous, 48, bottom) }))
    setMapMenu(false)
  }

  return (
    <div className="app" onKeyDown={event => { if (event.key === 'Escape' && !creating && !renaming) { if (player) setPlayerView(null); else { setSelectedId(null); setMode('normal'); setMapMenu(false) } } }}>
      <header className="header">
        <div className="brand"><h1>D&D</h1><span>{player ? 'Vista jugadores' : 'Mesa local'} <span className="version">· v0.0.3</span></span></div>
        <div className="header-actions">
          <ActionButton className="quiet" onPress={() => player ? setPlayerView(null) : previewPlayers()} disabled={gesturing || busy || aligning}>{player ? 'Volver a DM' : 'Vista jugadores'}</ActionButton>
          {!player && <button className="quiet" onClick={() => void reset()} disabled={gesturing || busy || aligning}>Limpiar</button>}
        </div>
      </header>
      <main className="table">
        {aligning && board.map && mapImage.url ? <MapAlignment map={board.map} url={mapImage.url} initialView={board} onCancel={() => setAligning(false)} onApply={(map, view) => {
          if (!change(previous => ({ ...previous, map, ...view }), false, true)) return false
          setAligning(false)
          setMode('normal')
          setAnnouncement('Cuadrícula alineada. Escala y posición guardadas.')
          return true
        }} /> : <>
        <Board board={displayedBoard} selectedId={selectedId} onSelect={id => { if (!player) { setSelectedId(id); if (id) setMapMenu(false) } }} onChange={changeView} onSize={setSize} onGesture={setGesturing} onDelete={remove} mode={player ? 'normal' : mode} mapUrl={mapImage.url} disabled={busy} onDone={() => player ? setPlayerView(null) : setMode('normal')} player={player} fogAction={fogAction} onFog={editFog} />
        <div className="map-info" aria-hidden="true">1 casilla = 5 pies</div>
        {!player && mode === 'map' && board.map && <div className="map-tools"><MapControls map={board.map} disabled={gesturing || busy} canAlign={Boolean(mapImage.url)} onAlign={() => setAligning(true)} onDone={() => setMode('normal')} onScale={scale => change(previous => ({ ...previous, map: previous.map ? { ...previous.map, scale } : null }))} /></div>}
        {!player && board.tokens.length === 0 && !board.map && mode === 'normal' && <div className="empty-hint"><span className="empty-symbol" aria-hidden="true">＋</span><strong>Tu mesa empieza aquí</strong><span>Crea una ficha o importa un mapa.</span></div>}
        {!player && mode === 'fog' && <div className="map-tools fog-tools"><FogControls action={fogAction} disabled={gesturing || busy} onAction={setFogAction} onHideAll={() => change(previous => ({ ...previous, fog: [{ ...usedArea(previous, size), id: newId() }] }))} onShowAll={() => change(previous => ({ ...previous, fog: [] }))} onDone={() => setMode('normal')} /></div>}
        <div className="bottom-controls">
          {(warning || mapWarning || mapImage.warning) && <p className="storage-warning" role="alert">{[warning, mapWarning, mapImage.warning].filter(Boolean).join(' ')}</p>}
          {busy && <p className="board-hint" role="status">Procesando mapa…</p>}
          {!player && mode === 'measure' && <section className="map-panel" aria-label="Medir distancias"><div className="panel-heading"><strong>Medir</strong><button onClick={() => setMode('normal')} disabled={gesturing || busy}>Listo</button></div><p>Arrastra de una casilla a otra · 5 pies por casilla</p></section>}
          {!player && mapMenu && board.map && mode === 'normal' && <section className="map-panel map-actions" aria-label="Opciones del mapa">
            <button disabled={gesturing || busy} onClick={() => { setMode('map'); setMapMenu(false) }}>Ajustar mapa</button>
            <button disabled={gesturing || busy} onClick={showMap}>Ver mapa completo</button>
            <button disabled={gesturing || busy} onClick={() => fileInput.current?.click()}>Reemplazar</button>
            <button className="danger" disabled={gesturing || busy} onClick={() => void removeMap()}>Eliminar mapa</button>
          </section>}
          {!player && selected && mode === 'normal' && !mapMenu && <section className="selection" aria-label="Ficha seleccionada">
            <div className="selection-heading"><div className="selection-name"><span>Ficha seleccionada</span><strong>{selected.name}</strong></div><label className="token-visibility"><input type="checkbox" checked={selected.visible !== false} disabled={gesturing || busy} onChange={event => { const visible = event.target.checked; change(previous => ({ ...previous, tokens: previous.tokens.map(token => token.id === selected.id ? { ...token, visible } : token) })) }} />Visible para jugadores</label><button className="quiet" aria-label="Deseleccionar ficha" onClick={() => setSelectedId(null)} disabled={gesturing || busy}>×</button></div>
            <div className="selection-actions">
              <button onClick={() => setRenaming(selected)} disabled={gesturing || busy} aria-label={`Editar nombre de ${selected.name}`}>Nombre</button>
              <button onClick={() => duplicate(selected)} disabled={gesturing || busy} aria-label={`Duplicar ${selected.name}`}>Duplicar</button>
              <button className="danger" onClick={() => remove(selected)} disabled={gesturing || busy} aria-label={`Eliminar ${selected.name}`}>Eliminar</button>
            </div>
          </section>}
          <div className="toolbar" role="group" aria-label="Controles de la mesa">
            {!player && <div className="main-actions">
              <button ref={createButton} className="primary create-button" onClick={() => { setMode('normal'); setMapMenu(false); setCreating(true) }} disabled={gesturing || busy}>＋ Ficha</button>
              <button aria-pressed={mapMenu || mode === 'map'} onClick={() => { if (board.map) { selectionHeight.current = document.querySelector('.selection')?.getBoundingClientRect().height ?? selectionHeight.current; setMode('normal'); setMapMenu(!mapMenu) } else fileInput.current?.click() }} disabled={gesturing || busy}>Mapa</button>
              <button aria-pressed={mode === 'measure'} onClick={() => { setMode(mode === 'measure' ? 'normal' : 'measure'); setMapMenu(false) }} disabled={gesturing || busy}>Medir</button>
              <button aria-pressed={mode === 'fog'} onClick={() => { setMode(mode === 'fog' ? 'normal' : 'fog'); setFogAction('hide'); setMapMenu(false) }} disabled={gesturing || busy}>Niebla</button>
            </div>}
            <div className="camera-actions">
              <div className="zoom-controls" role="group" aria-label="Zoom">
                <button aria-label="Alejar" onClick={() => changeView(previous => ({ ...previous, zoom: buttonZoom(previous.zoom, -1) }))} disabled={gesturing || busy || displayedBoard.zoom <= MIN_ZOOM}>−</button>
                <output aria-label="Nivel de zoom">{displayedBoard.zoom < 0.00001 ? '<0.001' : Number((displayedBoard.zoom * 100).toFixed(3))}%</output>
                <button aria-label="Acercar" onClick={() => changeView(previous => ({ ...previous, zoom: buttonZoom(previous.zoom, 1) }))} disabled={gesturing || busy || displayedBoard.zoom >= 2.5}>＋</button>
              </div>
              <button className="center-button" aria-label="Centrar vista" title="Centrar la ficha seleccionada o volver al inicio · 100%" onClick={center} disabled={gesturing || busy}>⌖</button>
            </div>
          </div>
          <p id="board-hint" className="board-hint">{player ? 'Vista jugadores · Solo navegación · No se guardan cambios' : mode === 'fog' ? (fogAction === 'navigate' ? 'Arrastra el fondo para navegar · Dos dedos o rueda para zoom' : `${fogAction === 'hide' ? 'Ocultar' : 'Revelar'} · Arrastra un rectángulo · Dos dedos para navegar`) : mode === 'map' ? 'Ajustando mapa · Las fichas están bloqueadas' : mode === 'measure' ? 'Midiendo · Dos dedos para navegar' : 'Arrastra una ficha para moverla · Arrastra el fondo para explorar'}</p>
        </div>
        </>}
      </main>
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {!player && <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Archivo del mapa" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importMap(file) }} />}
      {!player && (creating || renaming) && <NameDialog onCreate={renaming ? rename : create} onClose={closeDialog} initialName={renaming?.name} title={renaming ? 'Editar nombre' : undefined} submitLabel={renaming ? 'Guardar nombre' : undefined} />}
    </div>
  )
}
