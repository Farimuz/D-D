import { useEffect, useRef, useState } from 'react'
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
import RoomPanel from './components/RoomPanel'
import { useRoom } from './online/useRoom'
import type { OnlineRoom } from './online/useRoom'
import { createRoom, dmKey, identity, nameKey, remember, stored } from './online/session'
import { CREDENTIAL_PATTERN, ROOM_PATTERN, name as validName } from './online/protocol'
import type { Join } from './online/protocol'

export default function App() {
  const [session, setSession] = useState(resolveRoute)
  useEffect(() => { const update = () => setSession(resolveRoute()); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update) }, [])
  function enter(code: string) { history.pushState(null, '', `/room/${code}`); setSession(resolveRoute()) }
  function local() { history.pushState(null, '', '/'); setSession({ code: null, join: null, notice: null }) }
  async function online(board: BoardState) {
    const room = await createRoom(board)
    history.pushState(null, '', `/room/${room.roomId}`)
    setSession({ code: room.roomId, join: { type: 'join', role: 'dm', roomId: room.roomId, credential: room.credential }, notice: room.warning })
  }
  if (session.join) return <ConnectedTable key={session.join.roomId} join={session.join} initialNotice={session.notice} onLocal={local} onEnter={enter} onCreateRoom={online} />
  if (session.code) return <JoinScreen code={session.code} onLocal={local} onJoin={(name) => {
    const own = identity(), saved = remember(nameKey(session.code!), name)
    setSession({ code: session.code, join: { type: 'join', role: 'player', roomId: session.code!, identity: own.value, name }, notice: own.saved && saved ? null : 'No se pudo guardar tu identidad. Al recargar podrías perder la asignación; pide al DM que la restaure.' })
  }} />
  return <LocalTable onLocal={local} onEnter={enter} onCreateRoom={online} />
}
function resolveRoute(): { code: string | null; join: Join | null; notice: string | null } {
  const code = /^\/room\/([^/]+)\/?$/.exec(location.pathname)?.[1]?.toUpperCase() ?? null
  if (!code || !ROOM_PATTERN.test(code)) return { code, join: null, notice: null }
  const credential = stored(dmKey(code))
  if (credential && CREDENTIAL_PATTERN.test(credential)) return { code, join: { type: 'join', role: 'dm', roomId: code, credential }, notice: null }
  const name = stored(nameKey(code))
  if (name && validName(name)) return { code, join: { type: 'join', role: 'player', roomId: code, name, identity: identity().value }, notice: null }
  return { code, join: null, notice: null }
}
function JoinScreen({ code, onLocal, onJoin }: { code: string; onLocal(): void; onJoin(name: string): void }) {
  const [name, setName] = useState('')
  return <div className="app"><header className="header"><h1>D&D</h1><button onClick={onLocal}>Mesa local</button></header><main className="join-page">
    <form className="name-dialog" onSubmit={event => { event.preventDefault(); if (validName(name.trim()) && ROOM_PATTERN.test(code)) onJoin(name.trim()) }}>
      <h2>Entrar a la sala</h2><p>{code}</p>
      {!ROOM_PATTERN.test(code) ? <p role="alert">El código de sala no es válido.</p> : <><label htmlFor="player-name">Nombre</label><input id="player-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} autoComplete="nickname" autoFocus /><button className="primary" type="submit" disabled={!validName(name.trim())}>Entrar</button></>}
    </form>
  </main></div>
}
interface TableProps { room?: OnlineRoom; store: ReturnType<typeof useBoard>; initialNotice?: string | null; onLocal(): void; onEnter(code: string): void; onCreateRoom(board: BoardState): Promise<void> }
type NavigationProps = Pick<TableProps, 'onLocal' | 'onEnter' | 'onCreateRoom' | 'initialNotice'>
function LocalTable(props: NavigationProps) { const store = useBoard(); return <Table {...props} store={store} /> }
function ConnectedTable({ join, ...props }: NavigationProps & { join: Join }) { const room = useRoom(join); return <Table {...props} room={room} store={room.store} /> }
function Table({ room, store, initialNotice, onLocal, onEnter, onCreateRoom }: TableProps) {
  const { board, warning, change, getBoard } = store
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
  const [mapWarning, setMapWarning] = useState<string | null>(initialNotice ?? null)
  const [roomMenu, setRoomMenu] = useState(room?.join.role === 'dm')
  const processing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const mapImage = useMapImage(board.map?.id, room?.mapUrl)
  const createButton = useRef<HTMLButtonElement>(null)
  const selectionHeight = useRef(140)
  const selected = board.tokens.find(token => token.id === selectedId)
  const preview = playerView !== null
  const connectedPlayer = room?.join.role === 'player'
  const player = preview || connectedPlayer
  const canMeasure = !preview
  const boardMode: BoardMode = connectedPlayer ? (mode === 'measure' ? 'measure' : 'normal') : preview ? 'normal' : mode
  const offline = Boolean(room && room.connection !== 'connected')
  const editDisabled = gesturing || busy || offline
  const displayedBoard = playerView ? { ...board, ...playerView } : board
  const canMove = (token: Token) => !preview && !offline && (!room || room.join.role === 'dm' || token.ownerId === room.snapshot?.selfId)
  useEffect(() => { if (offline) { setMode('normal'); setMapMenu(false); setAligning(false); setCreating(false); setRenaming(null) } }, [offline])

  function changeView(update: (previous: BoardState) => BoardState) {
    if (!preview) { change(update); return }
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
    if (room) {
      if (processing.current) return
      processing.current = true; setBusy(true)
      void room.createToken({ name: token.name, ...nearbyCell(getBoard().tokens, token) }).then(setSelectedId).catch(error => setMapWarning(error.message)).finally(() => { processing.current = false; setBusy(false) })
      return
    }
    const id = newId()
    change(previous => ({ ...previous, tokens: [...previous.tokens, { id, name: token.name, ...nearbyCell(previous.tokens, token) }] }))
    setSelectedId(id)
    setAnnouncement(`Ficha ${token.name} duplicada.`)
  }

  function create(name: string) {
    if (room) {
      if (processing.current) return
      processing.current = true; setBusy(true)
      const current = getBoard()
      void room.createToken({ name, ...spawnCell(current.tokens, current.camera, current.zoom, size) }).then(id => { closeDialog(); setSelectedId(id); setAnnouncement(`Ficha ${name} creada.`) }).catch(error => setMapWarning(error.message)).finally(() => { processing.current = false; setBusy(false) })
      return
    }
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
    if (processing.current || !window.confirm(room ? '¿Limpiar la sala? Se eliminarán todas las fichas, el mapa y la niebla de esta partida para todos.' : '¿Limpiar la mesa? Se eliminarán todas las fichas, el mapa y la niebla guardados en este navegador.')) return
    if (room) {
      processing.current = true; setBusy(true)
      try { await room.command({ type: 'board.reset' }); setSelectedId(null); setMode('normal'); setMapMenu(false); setMapWarning(null) }
      catch (error) { setMapWarning(error instanceof Error ? error.message : 'No se pudo limpiar la sala.') }
      finally { processing.current = false; setBusy(false) }
      return
    }
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
      if (room) {
        const previous = getBoard(), map = initialMap('', valid.width, valid.height, previous.camera, previous.zoom, size)
        await room.importMap(valid.blob, { x: map.x, y: map.y, width: map.width, height: map.height, scale: map.scale })
        setMode('map'); setMapMenu(false); setAnnouncement('Mapa importado en la sala. Ajusta su posición y escala; después pulsa Listo.')
        return
      }
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
    if (room) {
      processing.current = true; setBusy(true)
      try { await room.command({ type: 'map.delete' }); setMode('normal'); setMapMenu(false); setMapWarning(null) }
      catch (error) { setMapWarning(error instanceof Error ? error.message : 'No se pudo eliminar el mapa.') }
      finally { processing.current = false; setBusy(false) }
      return
    }
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
    <div className="app" data-room-revision={room?.snapshot?.revision} onKeyDown={event => { if (event.key === 'Escape' && !creating && !renaming) { if (preview) setPlayerView(null); else { setSelectedId(null); setMode('normal'); setMapMenu(false) } } }}>
      <header className="header">
        <div className="brand"><h1>D&D</h1>{room ? <span role="status" aria-label="Estado de conexión" className="connection-status">{room.connection === 'connected' ? 'Conectado' : room.connection === 'disconnected' ? 'Desconectado' : 'Reconectando…'}</span> : <span>{player ? 'Vista jugadores' : 'Mesa local'} <span className="version">· v0.0.4</span></span>}</div>
        <div className="header-actions">
          {room?.join.role !== 'player' && <ActionButton className="quiet" onPress={() => preview ? setPlayerView(null) : previewPlayers()} disabled={gesturing || busy || aligning}>{preview ? 'Volver a DM' : 'Vista jugadores'}</ActionButton>}
          {!player && <button className="quiet" onClick={() => void reset()} disabled={editDisabled || aligning}>Limpiar</button>}
          <ActionButton className="quiet session-button" aria-label="Opciones de partida" onPress={() => setRoomMenu(true)} disabled={gesturing || busy || aligning}>☰</ActionButton>
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
        <Board board={displayedBoard} selectedId={selectedId} onSelect={id => { if (!preview) { setSelectedId(id); if (id) setMapMenu(false) } }} onChange={changeView} onSize={setSize} onGesture={setGesturing} onDelete={remove} mode={boardMode} mapUrl={mapImage.url} disabled={busy} onDone={() => preview ? setPlayerView(null) : setMode('normal')} player={player} fogAction={fogAction} onFog={editFog} canMoveToken={canMove} onMapError={room ? () => setMapWarning('No se pudo abrir el mapa online. Pide al DM que lo reimporte.') : undefined} />
        <div className="map-info" aria-hidden="true">1 casilla = 5 pies</div>
        {!player && mode === 'map' && board.map && <div className="map-tools"><MapControls map={board.map} disabled={editDisabled} canAlign={Boolean(mapImage.url)} onAlign={() => setAligning(true)} onDone={() => setMode('normal')} onScale={scale => change(previous => ({ ...previous, map: previous.map ? { ...previous.map, scale } : null }))} /></div>}
        {!player && board.tokens.length === 0 && !board.map && mode === 'normal' && <div className="empty-hint"><span className="empty-symbol" aria-hidden="true">＋</span><strong>Tu mesa empieza aquí</strong><span>Crea una ficha o importa un mapa.</span></div>}
        {!player && mode === 'fog' && <div className="map-tools fog-tools"><FogControls action={fogAction} disabled={editDisabled} onAction={setFogAction} onHideAll={() => change(previous => ({ ...previous, fog: [{ ...usedArea(previous, size), id: newId() }] }))} onShowAll={() => change(previous => ({ ...previous, fog: [] }))} onDone={() => setMode('normal')} /></div>}
        <div className="bottom-controls">
          {(warning || mapWarning || mapImage.warning) && <p className="storage-warning" role="alert">{[warning, mapWarning, mapImage.warning].filter(Boolean).join(' ')}</p>}
          {busy && <p className="board-hint" role="status">Procesando mapa…</p>}
          {canMeasure && mode === 'measure' && <section className="map-panel" aria-label="Medir distancias"><div className="panel-heading"><strong>Medir</strong><button onClick={() => setMode('normal')} disabled={editDisabled}>Listo</button></div><p>Arrastra de una casilla a otra · 5 pies por casilla</p></section>}
          {!player && mapMenu && board.map && mode === 'normal' && <section className="map-panel map-actions" aria-label="Opciones del mapa">
            <button disabled={editDisabled} onClick={() => { setMode('map'); setMapMenu(false) }}>Ajustar mapa</button>
            <button disabled={editDisabled} onClick={showMap}>Ver mapa completo</button>
            <button disabled={editDisabled} onClick={() => fileInput.current?.click()}>Reemplazar</button>
            <button className="danger" disabled={editDisabled} onClick={() => void removeMap()}>Eliminar mapa</button>
          </section>}
          {!player && selected && mode === 'normal' && !mapMenu && <section className="selection" aria-label="Ficha seleccionada">
            <div className="selection-heading"><div className="selection-name"><span>Ficha seleccionada</span><strong>{selected.name}</strong></div><label className="token-visibility"><input type="checkbox" checked={selected.visible !== false} disabled={editDisabled} onChange={event => { const visible = event.target.checked; change(previous => ({ ...previous, tokens: previous.tokens.map(token => token.id === selected.id ? { ...token, visible } : token) })) }} />Visible para jugadores</label><button className="quiet" aria-label="Deseleccionar ficha" onClick={() => setSelectedId(null)} disabled={editDisabled}>×</button></div>
            <div className="selection-actions">
              <button onClick={() => setRenaming(selected)} disabled={editDisabled} aria-label={`Editar nombre de ${selected.name}`}>Nombre</button>
              <button onClick={() => duplicate(selected)} disabled={editDisabled} aria-label={`Duplicar ${selected.name}`}>Duplicar</button>
              <button className="danger" onClick={() => remove(selected)} disabled={editDisabled} aria-label={`Eliminar ${selected.name}`}>Eliminar</button>
            </div>
            {room && <label className="token-owner">Controlada por<select aria-label="Controlada por" value={selected.ownerId ?? ''} disabled={editDisabled} onChange={event => { const ownerId = event.target.value || null; change(previous => ({ ...previous, tokens: previous.tokens.map(t => t.id === selected.id ? { ...t, ownerId } : t) })) }}><option value="">DM</option>{room.snapshot?.participants.map(p => <option key={p.id} value={p.id} disabled={!p.connected && selected.ownerId !== p.id}>{p.name}{p.connected ? '' : ' (desconectado)'}</option>)}</select></label>}
          </section>}
          <div className="toolbar" role="group" aria-label="Controles de la mesa">
            {canMeasure && <div className="main-actions">
              {!connectedPlayer && <button ref={createButton} className="primary create-button" onClick={() => { setMode('normal'); setMapMenu(false); setCreating(true) }} disabled={editDisabled}>＋ Ficha</button>}
              {!connectedPlayer && <button aria-pressed={mapMenu || mode === 'map'} onClick={() => { if (board.map) { selectionHeight.current = document.querySelector('.selection')?.getBoundingClientRect().height ?? selectionHeight.current; setMode('normal'); setMapMenu(!mapMenu) } else fileInput.current?.click() }} disabled={editDisabled}>Mapa</button>}
              <button aria-pressed={mode === 'measure'} onClick={() => { setMode(mode === 'measure' ? 'normal' : 'measure'); setMapMenu(false) }} disabled={editDisabled}>Medir</button>
              {!connectedPlayer && <button aria-pressed={mode === 'fog'} onClick={() => { setMode(mode === 'fog' ? 'normal' : 'fog'); setFogAction('hide'); setMapMenu(false) }} disabled={editDisabled}>Niebla</button>}
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
          <p id="board-hint" className="board-hint">{room?.join.role === 'player' ? (mode === 'measure' ? 'Midiendo · Arrastra de una casilla a otra · Dos dedos para navegar' : room.snapshot?.dmConnected ? 'Mueve tus fichas · Navega con el fondo y dos dedos' : 'DM desconectado · Puedes seguir navegando') : player ? 'Vista jugadores · Solo navegación · No se guardan cambios' : mode === 'fog' ? (fogAction === 'navigate' ? 'Arrastra el fondo para navegar · Dos dedos o rueda para zoom' : `${fogAction === 'hide' ? 'Ocultar' : 'Revelar'} · Arrastra un rectángulo · Dos dedos para navegar`) : mode === 'map' ? 'Ajustando mapa · Las fichas están bloqueadas' : mode === 'measure' ? 'Midiendo · Dos dedos para navegar' : 'Arrastra una ficha para moverla · Arrastra el fondo para explorar'}</p>
        </div>
        </>}
      </main>
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {!player && <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Archivo del mapa" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importMap(file) }} />}
      {!player && (creating || renaming) && <NameDialog onCreate={renaming ? rename : create} onClose={closeDialog} initialName={renaming?.name} title={renaming ? 'Editar nombre' : undefined} submitLabel={renaming ? 'Guardar nombre' : undefined} />}
      {roomMenu && <RoomPanel room={room} warning={mapWarning || warning} busy={busy} board={getBoard()} onCreate={onCreateRoom} onEnter={onEnter} onLocal={onLocal} onClose={() => setRoomMenu(false)} />}
    </div>
  )
}
