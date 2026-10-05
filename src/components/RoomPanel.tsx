import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '../state/model'
import type { OnlineRoom } from '../online/useRoom'
import { ROOM_PATTERN } from '../online/protocol'
import ActionButton from './ActionButton'

interface Props { room?: OnlineRoom; busy: boolean; warning?: string | null; board: BoardState; onCreate(board: BoardState): Promise<void>; onEnter(code: string): void; onLocal(): void; onClose(): void }
export default function RoomPanel({ room, busy, warning, board, onCreate, onEnter, onLocal, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const link = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState('')
  useEffect(() => { const d = dialog.current!; d.showModal(); return () => d.close() }, [])
  async function create() {
    setCreating(true); setError(null)
    try { await onCreate(board) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear la sala.') }
    finally { setCreating(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link.current!.value); setCopied('Enlace copiado.') }
    catch { link.current?.focus(); link.current?.select(); setCopied('Enlace seleccionado. Puedes copiarlo.') }
  }
  return <dialog ref={dialog} className="name-dialog room-dialog" aria-labelledby="room-title" onCancel={event => { if (creating) event.preventDefault(); else onClose() }}>
    <div className="panel-heading"><h2 id="room-title">Partida</h2><ActionButton aria-label="Cerrar opciones de partida" disabled={creating} onPress={onClose}>×</ActionButton></div>
    {(error || warning) && <p role="alert">{[error, warning].filter(Boolean).join(' ')}</p>}
    {room ? <>
      <p>{room.join.role === 'dm' ? 'Eres el DM de esta sala.' : 'Sala de jugadores. Solo puedes mover tus fichas asignadas.'}</p>
      <label>Código de sala <output aria-label="Código de sala">{room.join.roomId}</output></label>
      <label htmlFor="player-link">Enlace para jugadores</label>
      <input ref={link} id="player-link" readOnly value={`${location.origin}/room/${room.join.roomId}`} onFocus={event => event.currentTarget.select()} />
      <ActionButton onPress={() => void copy()}>Copiar enlace</ActionButton>
      <p role="status">{copied}</p>
      {room.join.role === 'dm' && <><h3>Participantes</h3><ul aria-label="Participantes">{room.snapshot?.participants.length ? room.snapshot.participants.map(p => <li key={p.id}>{p.name} — {p.connected ? 'conectado' : 'desconectado'}</li>) : <li>Todavía no hay jugadores.</li>}</ul></>}
      {room.join.role === 'player' && <p>{room.snapshot?.dmConnected ? 'DM conectado' : 'DM desconectado'}</p>}
      <p className="room-note">La sala vive en memoria. Reiniciar el servidor la elimina. Volver a la mesa local no borra tus datos locales.</p>
      <ActionButton disabled={busy || creating} onPress={onLocal}>Mesa local</ActionButton>
    </> : <>
      <p>Mesa local: tus datos permanecen en este navegador.</p>
      <ActionButton className="primary" disabled={busy || creating} onPress={() => void create()}>{creating ? 'Creando sala…' : 'Crear partida online'}</ActionButton>
      <p className="room-note">La sala comenzará con tus fichas, mapa y niebla actuales. La mesa local se conserva.</p>
      <form onSubmit={event => { event.preventDefault(); if (ROOM_PATTERN.test(code)) onEnter(code) }}>
        <label htmlFor="room-code">Código de sala</label>
        <input id="room-code" value={code} onChange={event => setCode(event.target.value.trim().toUpperCase())} maxLength={12} autoComplete="off" autoCapitalize="characters" />
        <button type="submit" disabled={creating || !ROOM_PATTERN.test(code)}>Entrar con código</button>
      </form>
      <ActionButton disabled={creating} onPress={onClose}>Mesa local</ActionButton>
    </>}
  </dialog>
}
