import { useRef, useState } from 'react'
import Board from './components/Board'
import NameDialog from './components/NameDialog'
import { cellCenter, clampZoom, spawnCell } from './map/geometry'
import { emptyBoard } from './state/model'
import type { Point, Token } from './state/model'
import { useBoard } from './state/useBoard'

export default function App() {
  const { board, warning, change } = useBoard()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [gesturing, setGesturing] = useState(false)
  const [size, setSize] = useState<Point>({ x: 0, y: 0 })
  const [announcement, setAnnouncement] = useState('')
  const createButton = useRef<HTMLButtonElement>(null)
  const selected = board.tokens.find(token => token.id === selectedId)

  function closeDialog() {
    setCreating(false)
    createButton.current?.focus()
  }

  function create(name: string) {
    // randomUUID is unavailable on plain HTTP on some phones; randomness is local identity only.
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
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

  function reset() {
    if (!window.confirm('¿Limpiar la mesa? Se eliminarán todas las fichas guardadas en este navegador.')) return
    change(() => emptyBoard(), true)
    setSelectedId(null)
    setAnnouncement('Mesa vacía. Vista restablecida.')
  }

  function center() {
    change(previous => ({ ...previous, camera: selected ? cellCenter(selected) : emptyBoard().camera, zoom: 1 }))
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand"><h1>D&D</h1><span>Mesa local <span className="version">· v0.0.1</span></span></div>
        <button className="quiet" onClick={reset} disabled={gesturing}>Limpiar</button>
      </header>
      <main className="table">
        <Board board={board} selectedId={selectedId} onSelect={setSelectedId} onChange={change} onSize={setSize} onGesture={setGesturing} onDelete={remove} />
        <div className="map-info" aria-hidden="true">1 casilla = 5 pies</div>
        {board.tokens.length === 0 && <div className="empty-hint"><span className="empty-symbol" aria-hidden="true">＋</span><strong>Tu mesa empieza aquí</strong><span>Crea una ficha y arrástrala.</span></div>}
        <div className="bottom-controls">
          {warning && <p className="storage-warning" role="alert">{warning}</p>}
          {selected && <section className="selection" aria-label="Ficha seleccionada">
            <div className="selection-name"><span>Ficha seleccionada</span><strong>{selected.name}</strong></div>
            <button className="danger" onClick={() => remove(selected)} disabled={gesturing} aria-label={`Eliminar ${selected.name}`}>Eliminar</button>
          </section>}
          <div className="toolbar" role="group" aria-label="Controles de la mesa">
            <button ref={createButton} className="primary create-button" onClick={() => setCreating(true)} disabled={gesturing}>＋ Ficha</button>
            <div className="zoom-controls" role="group" aria-label="Zoom">
              <button aria-label="Alejar" onClick={() => change(previous => ({ ...previous, zoom: clampZoom(Number((previous.zoom - 0.25).toFixed(2))) }))} disabled={gesturing || board.zoom <= 0.5}>−</button>
              <output aria-label="Nivel de zoom">{Math.round(board.zoom * 100)}%</output>
              <button aria-label="Acercar" onClick={() => change(previous => ({ ...previous, zoom: clampZoom(Number((previous.zoom + 0.25).toFixed(2))) }))} disabled={gesturing || board.zoom >= 2.5}>＋</button>
            </div>
            <button className="center-button" aria-label="Centrar vista" title="Centrar la ficha seleccionada o volver al inicio · 100%" onClick={center} disabled={gesturing}>⌖</button>
          </div>
          <p id="board-hint" className="board-hint">Arrastra una ficha para moverla · Arrastra el fondo para explorar</p>
        </div>
      </main>
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {creating && <NameDialog onCreate={create} onClose={closeDialog} />}
    </div>
  )
}
