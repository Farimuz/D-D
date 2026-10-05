import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { imageSize } from 'image-size'
import { imageType, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from '../src/map/mapAsset.ts'
import { CREDENTIAL_PATTERN, MAX_MESSAGE_BYTES, keys, record, validActionMessage, validJoin, validShared } from '../src/online/protocol.ts'
import type { ServerMessage } from '../src/online/protocol.ts'
import { Rooms, RoomError } from './rooms.ts'
import type { Actor, Room } from './rooms.ts'
import type { RoomStore } from '../src/core/room/store.ts'

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
function body(req: IncomingMessage, maximum: number): Promise<Buffer> {
  return new Promise((accept, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > maximum) { req.resume(); reject(new HttpError(413, 'El archivo o mensaje supera el límite permitido.')); return }
    let size = 0, finished = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      if (finished) return
      size += chunk.length
      if (size > maximum) { finished = true; chunks.length = 0; reject(new HttpError(413, 'El archivo o mensaje supera el límite permitido.')) }
      else chunks.push(chunk)
    })
    req.on('end', () => { if (!finished) { finished = true; accept(Buffer.concat(chunks)) } })
    req.on('error', () => { if (!finished) { finished = true; reject(new HttpError(400, 'La transferencia se interrumpió.')) } })
    req.on('aborted', () => { if (!finished) { finished = true; reject(new HttpError(400, 'La transferencia se interrumpió.')) } })
  })
}
const originAllowed = (req: IncomingMessage) => {
  if (!req.headers.origin) return true
  try { return new URL(req.headers.origin).host === req.headers.host }
  catch { return false }
}
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}
const parseJSON = (s: string) => { try { return JSON.parse(s) as unknown } catch { throw new HttpError(400, 'JSON no válido.') } }

export function createRoomServer(options: { dist?: string; heartbeatMs?: number; joinTimeoutMs?: number; roomStore?: RoomStore } = {}) {
  const rooms = new Rooms(options.roomStore)
  const sessions = new Map<WebSocket, { room: Room; actor: Actor }>()
  const alive = new Set<WebSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })
  function send(socket: WebSocket, data: ServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > MAX_MESSAGE_BYTES * 2) { socket.close(1013, 'Conexión demasiado lenta'); return }
    socket.send(JSON.stringify(data))
  }
  function broadcast(room: Room) {
    for (const [socket, session] of sessions) if (session.room === room) send(socket, rooms.snapshot(room, session.actor))
  }
  async function request(req: IncomingMessage, res: ServerResponse) {
    try {
      if (!originAllowed(req)) throw new HttpError(403, 'Origen no permitido.')
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      if (path === '/api/health' && req.method === 'GET') { json(res, 200, { status: 'ok' }); return }
      if (path === '/api/rooms' && req.method === 'POST') {
        const initial = parseJSON((await body(req, MAX_MESSAGE_BYTES)).toString('utf8'))
        if (!validShared(initial)) throw new HttpError(400, 'La mesa inicial no es válida o supera los límites de sala.')
        json(res, 201, rooms.create(initial))
        return
      }
      const mapPath = /^\/api\/rooms\/([A-HJ-NP-Z2-9]{12})\/map(?:\/([a-f0-9-]{36}))?$/.exec(path)
      if (mapPath) {
        const room = rooms.get(mapPath[1])
        if (req.method === 'GET' && mapPath[2]) {
          const image = room.image
          if (!image || image.id !== mapPath[2]) throw new HttpError(404, 'El mapa ya no está disponible.')
          res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
          res.end(image.bytes)
          return
        }
        if (req.method !== 'PUT' || mapPath[2]) throw new HttpError(405, 'Operación no permitida.')
        const credential = req.headers.authorization?.replace(/^Bearer /, '')
        if (!credential || !CREDENTIAL_PATTERN.test(credential) || !rooms.authenticateDM(room, credential)) throw new HttpError(403, 'Solo el DM puede importar un mapa.')
        if (room.uploading) throw new HttpError(409, 'Ya hay una importación de mapa en curso.')
        room.uploading = true
        try {
          const bytes = await body(req, MAX_IMAGE_BYTES)
          const type = imageType(bytes)
          if (!type) throw new HttpError(400, 'El mapa debe ser PNG, JPEG o WebP.')
          let dimensions: ReturnType<typeof imageSize>
          try { dimensions = imageSize(bytes) } catch { throw new HttpError(400, 'No se pudieron leer las dimensiones del mapa.') }
          const layout = parseJSON(String(req.headers['x-map-layout'] ?? ''))
          if (!record(layout) || !keys(layout, ['x', 'y', 'scale', 'width', 'height'])) throw new HttpError(400, 'La posición y dimensiones del mapa no son válidas.')
          // Browsers apply EXIF orientation. Either header orientation has the same
          // verified pixel count; no arbitrary client-provided dimensions are accepted.
          const matching = layout.width === dimensions.width && layout.height === dimensions.height
            || layout.width === dimensions.height && layout.height === dimensions.width
          if (!matching || !dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) throw new HttpError(400, 'El mapa debe tener como máximo 32 millones de píxeles y dimensiones verificables.')
          const candidate = { ...room.board, map: { ...layout, id: randomUUID() } }
          if (!validShared(candidate)) throw new HttpError(400, 'La posición o escala del mapa no son válidas.')
          // Commit bytes and metadata together, then broadcast. A failed upload retains both.
          rooms.replaceMap(room, { role: 'dm', id: null }, candidate.map, { id: candidate.map.id, bytes, type })
          broadcast(room)
          json(res, 200, { map: room.board.map })
        } finally { room.uploading = false }
        return
      }
      if (path.startsWith('/api/')) throw new HttpError(404, 'La dirección solicitada no existe.')
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Operación no permitida.')
      if (!options.dist) throw new HttpError(404, 'El frontend se ejecuta mediante el servidor de desarrollo.')
      const root = resolve(options.dist)
      const decoded = decodeURIComponent(path)
      const target = resolve(root, '.' + decoded)
      if (target !== root && !target.startsWith(root + sep)) throw new HttpError(403, 'Dirección no permitida.')
      let file = target
      if (path === '/' || /^\/room\/[^/]+\/?$/.test(path)) file = resolve(root, 'index.html')
      let bytes: Buffer
      try { bytes = await readFile(file) } catch { throw new HttpError(404, 'El recurso no está disponible. Ejecuta el build antes de iniciar el servidor.') }
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : bytes)
    } catch (error) {
      if (res.destroyed || res.headersSent) return
      if (error instanceof HttpError) json(res, error.status, { message: error.message })
      else if (error instanceof RoomError) json(res, error.code === 'ROOM_NOT_FOUND' ? 404 : 409, { message: error.message, code: error.code })
      else json(res, 500, { message: 'No se pudo completar la operación.' })
    }
  }
  const http = createServer({ requestTimeout: 60_000, headersTimeout: 15_000 }, (req, res) => { void request(req, res) })
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/socket' || !originAllowed(req) || wss.clients.size >= 512) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })
  wss.on('connection', (socket: WebSocket) => {
    alive.add(socket)
    socket.on('error', () => { /* Invalid/oversized frames close their own connection; never log secrets. */ })
    socket.on('pong', () => alive.add(socket))
    const joinTimer = setTimeout(() => socket.close(1008, 'No se recibió identificación'), options.joinTimeoutMs ?? 5000)
    socket.on('message', (bytes, binary) => {
      try {
        if (binary) throw new RoomError('INVALID_MESSAGE', 'El estado WebSocket debe usar mensajes JSON, sin imágenes binarias.')
        let message: unknown
        try { message = JSON.parse(bytes.toString()) } catch { throw new RoomError('INVALID_MESSAGE', 'Mensaje JSON no válido.') }
        const session = sessions.get(socket)
        if (!session) {
          if (!validJoin(message)) throw new RoomError('INVALID_MESSAGE', 'La identificación de sala no es válida.')
          const next = rooms.join(message)
          sessions.set(socket, next)
          clearTimeout(joinTimer)
          broadcast(next.room)
          return
        }
        if (!validActionMessage(message)) throw new RoomError('INVALID_MESSAGE', 'La acción no tiene una forma válida.')
        try {
          const result = rooms.apply(session.room, session.actor, message.action)
          broadcast(session.room)
          send(socket, { type: 'result', requestId: message.requestId, ok: true, ...result })
        } catch (error) {
          send(socket, { type: 'result', requestId: message.requestId, ok: false, message: error instanceof RoomError ? error.message : 'No se pudo aplicar la acción.' })
        }
      } catch (error) {
        send(socket, { type: 'error', code: error instanceof RoomError ? error.code : 'INVALID_MESSAGE', message: error instanceof RoomError ? error.message : 'Mensaje no válido.' })
        if (!sessions.has(socket)) socket.close(1008, 'Identificación rechazada')
      }
    })
    socket.on('close', () => {
      clearTimeout(joinTimer)
      alive.delete(socket)
      const session = sessions.get(socket)
      sessions.delete(socket)
      if (session) { rooms.leave(session.room, session.actor); broadcast(session.room) }
    })
  })
  const timer = setInterval(() => {
    rooms.sweep()
    for (const socket of wss.clients) {
      if (!alive.has(socket)) { socket.terminate(); continue }
      alive.delete(socket)
      if (socket.readyState === WebSocket.OPEN) socket.ping()
    }
  }, options.heartbeatMs ?? 30_000)
  timer.unref()
  return {
    http, rooms,
    async close() {
      clearInterval(timer)
      for (const socket of wss.clients) socket.terminate()
      await new Promise<void>(accept => wss.close(() => accept()))
      http.closeAllConnections()
      await new Promise<void>(accept => http.close(() => accept()))
      rooms.clear()
    },
  }
}
