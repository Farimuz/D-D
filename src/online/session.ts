import type { BoardState, MapAsset } from '../state/model'
import { shared } from './protocol'
import { readMap } from '../storage/mapAssets'
import { validateImage } from '../map/mapAsset'

export const IDENTITY_KEY = 'dnd.online.identity.v1'
export const dmKey = (room: string) => `dnd.online.dm.${room}`
export const nameKey = (room: string) => `dnd.online.name.${room}`
export function stored(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
export function remember(key: string, value: string): boolean { try { localStorage.setItem(key, value); return true } catch { return false } }
export function identity(): { value: string; saved: boolean } {
  const existing = stored(IDENTITY_KEY)
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return { value: existing, saved: true }
  const value = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
  return { value, saved: remember(IDENTITY_KEY, value) }
}
async function response<T>(res: Response): Promise<T> {
  const data = await res.json()
  if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : 'No se pudo comunicar con el servidor.')
  return data as T
}
export async function uploadMap(room: string, credential: string, blob: Blob, layout: Omit<MapAsset, 'id'>) {
  return response<{ map: MapAsset }>(await fetch(`/api/rooms/${room}/map`, {
    method: 'PUT', headers: { Authorization: `Bearer ${credential}`, 'X-Map-Layout': JSON.stringify(layout) }, body: blob,
    signal: AbortSignal.timeout(60_000),
  }))
}
export async function createRoom(board: BoardState) {
  const initial = shared(board)
  // Local assignments have no authority in a new room. The server creates fresh IDs.
  const payload = { ...initial, map: null, tokens: initial.tokens.map(t => ({ id: t.id, name: t.name, x: t.x, y: t.y, visible: t.visible !== false })) }
  const room = await response<{ roomId: string; credential: string }>(await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) }))
  const saved = remember(dmKey(room.roomId), room.credential)
  let warning = saved ? null : 'No se pudo guardar tu acceso de DM. No cierres esta página si quieres conservar el control.'
  if (board.map) {
    try {
      const blob = await readMap(board.map.id)
      if (!blob) throw new Error('No se encontró la imagen local.')
      const valid = await validateImage(blob)
      await uploadMap(room.roomId, room.credential, valid.blob, { x: board.map.x, y: board.map.y, scale: board.map.scale, width: valid.width, height: valid.height })
    } catch { warning = [warning, 'La sala está creada, pero su mapa no pudo transferirse. Puedes volver a importarlo online; la mesa local se conservó.'].filter(Boolean).join(' ') }
  }
  return { ...room, warning }
}
