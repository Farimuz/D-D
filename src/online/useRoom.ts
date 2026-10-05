import { useEffect, useRef, useState } from 'react'
import type { BoardState, MapAsset, Token } from '../state/model'
import { emptyBoard } from '../state/model'
import type { View } from '../map/geometry'
import { MAX_MESSAGE_BYTES, record, shared, validAction, validSnapshot } from './protocol'
import type { Action, Changes, Join, ServerMessage, Snapshot } from './protocol'
import { uploadMap } from './session'

interface Pending { resolve(message: Extract<ServerMessage, { type: 'result'; ok: true }>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
export function useRoom(join: Join) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const latest = useRef<Snapshot | null>(null)
  const [view, setView] = useState<View>(() => ({ camera: emptyBoard().camera, zoom: 1 }))
  const currentView = useRef(view)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [warning, setWarning] = useState<string | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const pending = useRef(new Map<string, Pending>())
  const sequence = useRef(0)
  useEffect(() => {
    let disposed = false, fatal = false, attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let handshake: ReturnType<typeof setTimeout> | null = null
    function rejectPending() {
      for (const request of pending.current.values()) { clearTimeout(request.timer); request.reject(new Error('La conexión se interrumpió. El cambio no quedó confirmado; comprueba la mesa al reconectar.')) }
      pending.current.clear()
    }
    function connect() {
      if (disposed || fatal) return
      setConnection(attempts ? 'reconnecting' : 'connecting')
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`)
      socket.current = ws
      handshake = setTimeout(() => ws.close(), 7000)
      ws.onopen = () => { if (!disposed) ws.send(JSON.stringify(join)) }
      ws.onmessage = event => {
        if (disposed || socket.current !== ws) return
        let message: unknown
        try { message = JSON.parse(String(event.data)) } catch { setWarning('El servidor envió un mensaje no válido.'); ws.close(); return }
        if (validSnapshot(message)) {
          if (message.roomId !== join.roomId || message.role !== join.role) { fatal = true; setWarning('La sesión recibida no corresponde a esta sala.'); ws.close(); return }
          if (handshake) clearTimeout(handshake)
          attempts = 0
          latest.current = message
          setSnapshot(message)
          setConnection('connected')
        } else if (record(message) && message.type === 'result' && typeof message.requestId === 'string' && typeof message.ok === 'boolean') {
          const request = pending.current.get(message.requestId)
          if (!request) return
          pending.current.delete(message.requestId)
          clearTimeout(request.timer)
          if (message.ok) request.resolve(message as Extract<ServerMessage, { type: 'result'; ok: true }>)
          else request.reject(new Error(typeof message.message === 'string' ? message.message : 'El servidor rechazó el cambio.'))
        } else if (record(message) && message.type === 'error' && typeof message.message === 'string') {
          setWarning(message.message)
          if (!latest.current || ['ROOM_NOT_FOUND', 'ACCESS', 'LIMIT'].includes(String(message.code))) { fatal = true; ws.close() }
        } else { setWarning('El servidor envió datos con una forma no válida.'); ws.close() }
      }
      ws.onerror = () => { /* Browser network failures are represented in connection status, without logging credentials. */ }
      ws.onclose = () => {
        if (handshake) clearTimeout(handshake)
        if (disposed || socket.current !== ws) return
        socket.current = null
        rejectPending()
        setConnection(fatal ? 'disconnected' : 'reconnecting')
        if (!fatal) timer = setTimeout(connect, Math.min(5000, 500 * 2 ** Math.min(attempts++, 4)))
      }
    }
    // StrictMode's setup/cleanup probe must not open and immediately abort a socket.
    timer = setTimeout(connect, 0)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (handshake) clearTimeout(handshake)
      const ws = socket.current
      socket.current = null
      if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.close() }
      rejectPending()
    }
  }, [join])
  function command(action: Action): Promise<Extract<ServerMessage, { type: 'result'; ok: true }>> {
    if (!validAction(action)) return Promise.reject(new Error('El cambio contiene datos no válidos o supera los límites de la sala.'))
    const ws = socket.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !latest.current || connection !== 'connected') return Promise.reject(new Error('La conexión no está disponible. Espera a que se restablezca.'))
    if (pending.current.size >= 32) return Promise.reject(new Error('Hay demasiados cambios pendientes. Espera un momento.'))
    const requestId = String(++sequence.current), message = JSON.stringify({ type: 'action', requestId, action })
    if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) return Promise.reject(new Error('El cambio supera el límite permitido.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error('El cambio no quedó confirmado a tiempo. Comprueba la mesa antes de repetirlo.')) }, 8000)
      pending.current.set(requestId, { resolve, reject, timer })
      try { ws.send(message) } catch { clearTimeout(timer); pending.current.delete(requestId); reject(new Error('No se pudo enviar el cambio.')) }
    })
  }
  function getBoard(): BoardState { return { ...(latest.current?.board ?? shared(emptyBoard())), ...currentView.current } }
  function change(update: (previous: BoardState) => BoardState): boolean {
    const previous = getBoard(), next = update(previous)
    currentView.current = { camera: next.camera, zoom: next.zoom }
    setView(currentView.current)
    const actions: Action[] = []
    for (const t of next.tokens) {
      const old = previous.tokens.find(o => o.id === t.id)
      if (!old) { setWarning('La creación de fichas debe confirmarse en el servidor.'); return false }
      const changes: Changes = {}
      if (old.x !== t.x || old.y !== t.y) { changes.x = t.x; changes.y = t.y }
      for (const key of ['name', 'visible', 'ownerId'] as const) if (old[key] !== t[key]) Object.assign(changes, { [key]: t[key] })
      if (Object.keys(changes).length) actions.push({ type: 'token.update', id: t.id, changes })
    }
    for (const t of previous.tokens) if (!next.tokens.some(n => n.id === t.id)) actions.push({ type: 'token.delete', id: t.id })
    if (JSON.stringify(previous.fog) !== JSON.stringify(next.fog)) actions.push({ type: 'fog.set', regions: next.fog ?? [] })
    if (JSON.stringify(previous.map) !== JSON.stringify(next.map)) actions.push(next.map ? { type: 'map.update', map: next.map } : { type: 'map.delete' })
    if (!actions.length) return true
    if (connection !== 'connected') { setWarning('La conexión no está disponible. No se guardó el cambio.'); return false }
    for (const action of actions) void command(action).catch(error => setWarning(error.message))
    return true
  }
  async function createToken(token: Omit<Token, 'id' | 'ownerId'>) {
    const result = await command({ type: 'token.create', ...token })
    if (!result.tokenId) throw new Error('El servidor no confirmó la identidad de la ficha.')
    return result.tokenId
  }
  async function importMap(blob: Blob, map: Omit<MapAsset, 'id'>) {
    if (join.role !== 'dm' || connection !== 'connected') throw new Error('Solo un DM conectado puede importar mapas.')
    return uploadMap(join.roomId, join.credential, blob, map)
  }
  return {
    store: { board: { ...(snapshot?.board ?? shared(emptyBoard())), ...view }, warning, change, getBoard },
    join, snapshot, connection, createToken, importMap, command, setWarning,
    mapUrl: snapshot?.board.map ? `/api/rooms/${join.roomId}/map/${snapshot.board.map.id}` : null,
  }
}
export type OnlineRoom = ReturnType<typeof useRoom>
