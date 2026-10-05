import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import WebSocket from 'ws'
import { createRoomServer } from '../../server/app.ts'
import { roomId } from '../../server/rooms.ts'
import { emptyBoard } from '../../src/state/model.ts'
import { MAX_IMAGE_BYTES } from '../../src/map/mapAsset.ts'
import { MAX_MESSAGE_BYTES, shared } from '../../src/online/protocol.ts'
import type { Action, Join, ServerMessage, Snapshot } from '../../src/online/protocol.ts'
import { FailingRoomStore } from '../fixtures/failing-room-store.ts'
import { ReadFaultRoomStore } from '../fixtures/read-fault-room-store.ts'

class Peer {
  socket: WebSocket
  frames: string[] = []
  latest: Snapshot | null = null
  queue: ServerMessage[] = []
  waiters: Array<{ match(v: ServerMessage): boolean; accept(v: ServerMessage): void }> = []
  sequence = 0
  constructor(url: string, options: WebSocket.ClientOptions = {}) {
    this.socket = new WebSocket(url, options)
    this.socket.on('error', () => {})
    this.socket.on('message', bytes => {
      const text = bytes.toString(); this.frames.push(text)
      const message = JSON.parse(text) as ServerMessage
      if (message.type === 'state') this.latest = message
      const index = this.waiters.findIndex(w => w.match(message))
      if (index >= 0) this.waiters.splice(index, 1)[0].accept(message)
      else this.queue.push(message)
    })
  }
  wait(match: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    const index = this.queue.findIndex(match)
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0])
    return new Promise((accept, reject) => {
      const waiter = { match, accept: (v: ServerMessage) => { clearTimeout(timer); accept(v) } }
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(w => w !== waiter); reject(new Error('Timed out waiting for a real server message')) }, 4000)
      this.waiters.push(waiter)
    })
  }
  async join(join: Join) {
    await once(this.socket, 'open')
    this.socket.send(JSON.stringify(join))
    await this.wait(m => m.type === 'state')
    return this
  }
  async action(action: Action) {
    const requestId = String(++this.sequence)
    this.socket.send(JSON.stringify({ type: 'action', requestId, action }))
    return await this.wait(m => m.type === 'result' && m.requestId === requestId) as Extract<ServerMessage, { type: 'result' }>
  }
  async state(revision: number) {
    if (this.latest && this.latest.revision >= revision) return this.latest
    return await this.wait(m => m.type === 'state' && m.revision >= revision) as Snapshot
  }
  async close() { const closed = once(this.socket, 'close'); this.socket.close(); await closed }
}
async function server(t: TestContext, options: Parameters<typeof createRoomServer>[0] = {}) {
  const app = createRoomServer(options)
  await new Promise<void>(accept => app.http.listen(0, '127.0.0.1', accept))
  t.after(() => app.close())
  const port = (app.http.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}`, socketUrl = `ws://127.0.0.1:${port}/socket`
  const res = await fetch(url + '/api/rooms', { method: 'POST', body: JSON.stringify(shared(emptyBoard())) })
  assert.equal(res.status, 201)
  const access = await res.json() as { roomId: string; credential: string }
  return { app, url, socketUrl, access }
}
const player = (room: string, name: string, identity = randomBytes(32).toString('hex')): Join => ({ type: 'join', roomId: room, role: 'player', name, identity })
const success = (result: Extract<ServerMessage, { type: 'result' }>) => { assert.equal(result.ok, true); return result }
async function until(predicate: () => boolean) {
  const end = Date.now() + 2000
  while (!predicate()) { if (Date.now() > end) throw new Error('Server state did not reach expected condition'); await new Promise<void>(accept => setImmediate(accept)) }
}

test('real DM + A + B synchronize, enforce ownership, filter fog/secrets and restore participant/DM access', async t => {
  const { url, socketUrl, access } = await server(t)
  const dmJoin: Join = { type: 'join', role: 'dm', roomId: access.roomId, credential: access.credential }
  const aJoin = player(access.roomId, 'Carlos'), bJoin = player(access.roomId, 'Ana')
  const dm = await new Peer(socketUrl).join(dmJoin), a = await new Peer(socketUrl).join(aJoin), b = await new Peer(socketUrl).join(bJoin)
  const aId = a.latest!.selfId!, bId = b.latest!.selfId!
  await dm.wait(m => m.type === 'state' && m.participants.length === 2)
  const created = success(await dm.action({ type: 'token.create', name: 'Arannis', x: 0, y: 0 }))
  assert.ok(created.ok && created.tokenId)
  const id = created.ok ? created.tokenId! : ''
  success(await dm.action({ type: 'token.update', id, changes: { ownerId: aId } }))
  await a.state(dm.latest!.revision); await b.state(dm.latest!.revision)
  success(await a.action({ type: 'token.update', id, changes: { x: -2, y: 4 } }))
  const moved = a.latest!.revision
  assert.equal((await dm.state(moved)).board.tokens[0].x, -2)
  assert.equal((await b.state(moved)).board.tokens[0].y, 4)
  assert.equal((await b.action({ type: 'token.update', id, changes: { x: 100, y: 100 } })).ok, false)
  assert.equal((await b.action({ type: 'token.update', id, changes: { ownerId: bId } })).ok, false)
  success(await dm.action({ type: 'token.update', id, changes: { x: 2, y: -1 } }))
  success(await dm.action({ type: 'token.create', name: 'Secreto irrepetible', x: 9, y: 9, visible: false }))
  success(await dm.action({ type: 'fog.set', regions: [{ id: 'temporary', x: 128, y: -64, width: 64, height: 64 }] }))
  const covered = dm.latest!.revision
  assert.equal((await a.state(covered)).board.tokens.length, 0)
  assert.equal((await b.state(covered)).board.tokens.length, 0)
  assert.equal(dm.latest!.board.tokens.length, 2)
  for (const peer of [a, b]) for (const privateValue of [access.credential, 'Secreto irrepetible', aJoin.role === 'player' ? aJoin.identity : '', bJoin.role === 'player' ? bJoin.identity : '']) assert.ok(!peer.frames.join('').includes(privateValue))
  assert.equal((await a.action({ type: 'token.update', id, changes: { x: 0, y: 0 } })).ok, false)
  success(await dm.action({ type: 'fog.set', regions: [] }))
  await a.close()
  await dm.wait(m => m.type === 'state' && m.participants.some(p => p.id === aId && !p.connected))
  const restored = await new Peer(socketUrl).join(aJoin)
  assert.equal(restored.latest!.selfId, aId)
  success(await restored.action({ type: 'token.update', id, changes: { x: 3, y: 3 } }))
  await dm.close()
  await b.wait(m => m.type === 'state' && !m.dmConnected)
  assert.equal((await b.action({ type: 'board.reset' })).ok, false)
  const recoveredDM = await new Peer(socketUrl).join(dmJoin)
  assert.equal(recoveredDM.latest!.role, 'dm')
  assert.equal(recoveredDM.latest!.participants.length, 2)
  assert.equal((await fetch(url + '/api/health')).status, 200)
})

test('binary HTTP maps preserve exact bytes, geometry and old assets after failed uploads; players cannot upload', async t => {
  const { app, url, socketUrl, access } = await server(t)
  const dm = await new Peer(socketUrl).join({ type: 'join', roomId: access.roomId, role: 'dm', credential: access.credential })
  const a = await new Peer(socketUrl).join(player(access.roomId, 'Carlos'))
  const bytes = await readFile(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
  const endpoint = `${url}/api/rooms/${access.roomId}/map`
  const layout = { x: -80, y: 90, scale: 2, width: 857, height: 1081 }
  const headers = { Authorization: `Bearer ${access.credential}`, 'X-Map-Layout': JSON.stringify(layout) }
  assert.equal((await fetch(endpoint, { method: 'PUT', headers: { ...headers, Authorization: 'Bearer ' + 'a'.repeat(43) }, body: bytes })).status, 403)
  const uploaded = await fetch(endpoint, { method: 'PUT', headers, body: bytes })
  assert.equal(uploaded.status, 200)
  const map = (await uploaded.json()).map
  await a.state(dm.latest!.revision)
  assert.deepEqual(a.latest!.board.map, map)
  const image = await fetch(endpoint + '/' + map.id)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes)
  assert.ok(!a.frames.join('').includes('iVBORw'))
  for (const attempt of [
    { body: Buffer.from('<svg/>'), headers }, { body: Buffer.alloc(MAX_IMAGE_BYTES + 1), headers },
    { body: bytes, headers: { ...headers, 'X-Map-Layout': JSON.stringify({ ...layout, width: 100 }) } },
  ]) {
    assert.ok([400, 413].includes((await fetch(endpoint, { method: 'PUT', ...attempt })).status))
    assert.equal(app.rooms.get(access.roomId).board.map!.id, map.id)
  }
  const tooManyPixels = Buffer.from(bytes); tooManyPixels.writeUInt32BE(8000, 16); tooManyPixels.writeUInt32BE(8000, 20)
  assert.equal((await fetch(endpoint, { method: 'PUT', headers: { ...headers, 'X-Map-Layout': JSON.stringify({ ...layout, width: 8000, height: 8000 }) }, body: tooManyPixels })).status, 400)
  success(await dm.action({ type: 'map.update', map: { ...map, x: 64, y: -128, scale: 4 } }))
  assert.equal((await a.state(dm.latest!.revision)).board.map!.scale, 4)
  const replacement = await fetch(endpoint, { method: 'PUT', headers, body: bytes })
  assert.equal(replacement.status, 200)
  const newer = (await replacement.json()).map
  assert.notEqual(newer.id, map.id)
  assert.equal((await dm.action({ type: 'map.update', map })).ok, false)
  success(await dm.action({ type: 'map.delete' }))
  assert.equal((await a.state(dm.latest!.revision)).board.map, null)
  assert.equal((await fetch(endpoint + '/' + newer.id)).status, 404)
})

test('interrupted HTTP uploads release the import lock and retain the previous map', async t => {
  const { app, url, access } = await server(t)
  const bytes = await readFile(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
  const endpoint = `${url}/api/rooms/${access.roomId}/map`
  const headers = { Authorization: `Bearer ${access.credential}`, 'X-Map-Layout': JSON.stringify({ x: 0, y: 0, scale: 1, width: 857, height: 1081 }) }
  const res = await fetch(endpoint, { method: 'PUT', headers, body: bytes }); assert.equal(res.status, 200)
  const before = app.rooms.get(access.roomId).image
  const req = httpRequest(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Length': bytes.length } })
  req.on('error', () => {})
  req.write(bytes.subarray(0, 20))
  await until(() => app.rooms.get(access.roomId).uploading)
  req.destroy()
  await until(() => !app.rooms.get(access.roomId).uploading)
  assert.equal(app.rooms.get(access.roomId).image, before)
  assert.equal((await fetch(endpoint, { method: 'PUT', headers, body: bytes })).status, 200)
})

test('raw malformed, binary, forged-authority and oversized WebSocket messages never change authoritative state', async t => {
  const { app, socketUrl, access } = await server(t)
  const peer = await new Peer(socketUrl).join(player(access.roomId, 'Carlos'))
  const before = JSON.stringify(app.rooms.get(access.roomId).board), revision = app.rooms.get(access.roomId).revision
  for (const raw of ['{bad', JSON.stringify({ type: 'action', requestId: '1', role: 'dm', action: { type: 'board.reset' } }), JSON.stringify({ type: 'action', requestId: '2', action: { type: 'token.update', id: 'guessed', changes: { x: .5, y: 0 } } }), Buffer.from('binary')]) {
    peer.socket.send(raw)
    assert.equal((await peer.wait(m => m.type === 'error')).type, 'error')
    assert.equal(JSON.stringify(app.rooms.get(access.roomId).board), before)
    assert.equal(app.rooms.get(access.roomId).revision, revision)
  }
  const closed = once(peer.socket, 'close')
  peer.socket.send('x'.repeat(MAX_MESSAGE_BYTES + 1))
  assert.equal((await closed)[0], 1009)
  assert.equal(JSON.stringify(app.rooms.get(access.roomId).board), before)
})

test('missing rooms, wrong DM credentials, cross-origin requests and idle unidentified sockets are rejected', async t => {
  const { url, socketUrl, access } = await server(t, { joinTimeoutMs: 100 })
  for (const join of [player(roomId(), 'Carlos'), { type: 'join', role: 'dm', roomId: access.roomId, credential: 'a'.repeat(43) } as Join]) {
    const peer = new Peer(socketUrl); await once(peer.socket, 'open'); peer.socket.send(JSON.stringify(join))
    const message = await peer.wait(m => m.type === 'error')
    assert.ok(message.type === 'error' && ['ROOM_NOT_FOUND', 'ACCESS'].includes(message.code))
  }
  assert.equal((await fetch(url + '/api/rooms', { method: 'POST', headers: { Origin: 'https://unrelated.example' }, body: JSON.stringify(shared(emptyBoard())) })).status, 403)
  assert.equal((await fetch(url + '/api/rooms', { method: 'POST', body: JSON.stringify({ ...shared(emptyBoard()), camera: { x: 0, y: 0 } }) })).status, 400)
  const idle = new Peer(socketUrl), closed = once(idle.socket, 'close')
  await once(idle.socket, 'open')
  assert.equal((await closed)[0], 1008)
})

test('heartbeat detects a broken peer and disconnects it without removing assigned tokens', async t => {
  const { socketUrl, access } = await server(t, { heartbeatMs: 100 })
  const dm = await new Peer(socketUrl).join({ type: 'join', role: 'dm', roomId: access.roomId, credential: access.credential })
  const a = await new Peer(socketUrl, { autoPong: false }).join(player(access.roomId, 'Carlos'))
  const id = a.latest!.selfId
  const created = success(await dm.action({ type: 'token.create', name: 'Arannis', x: 0, y: 0 }))
  const tokenId = created.ok ? created.tokenId! : ''
  success(await dm.action({ type: 'token.update', id: tokenId, changes: { ownerId: id } }))
  await dm.wait(m => m.type === 'state' && m.participants.some(p => p.id === id && !p.connected))
  assert.equal(dm.latest!.board.tokens[0].ownerId, id)
})

test('production file serving is confined to its directory and does not expose repository files', async t => {
  const { url } = await server(t, { dist: fileURLToPath(new URL('../fixtures/', import.meta.url)) })
  assert.equal((await fetch(url + '/grid-16px-margins.png')).status, 200)
  for (const path of ['/..%5C..%5Cpackage.json', '/package.json', '/server/rooms.ts']) assert.ok([403, 404].includes((await fetch(url + path)).status))
})

test('a failed store write rejects a real WebSocket action without advancing state and permits retry', async t => {
  const store = new FailingRoomStore()
  const { app, socketUrl, access } = await server(t, { roomStore: store })
  const dm = await new Peer(socketUrl).join({ type: 'join', roomId: access.roomId, role: 'dm', credential: access.credential })
  const a = await new Peer(socketUrl).join(player(access.roomId, 'Carlos'))
  const before = store.load(access.roomId)!, frames = a.frames.length
  store.failNextSave = true
  const rejected = await dm.action({ type: 'token.create', name: 'Arannis', x: 0, y: 0 })
  assert.deepEqual(rejected, { type: 'result', requestId: '1', ok: false, message: 'No se pudo aplicar la acción.' })
  assert.deepEqual(store.load(access.roomId), before)
  assert.equal(app.rooms.get(access.roomId).revision, before.revision)
  assert.equal(a.frames.length, frames)
  success(await dm.action({ type: 'token.create', name: 'Arannis', x: 0, y: 0 }))
  assert.equal((await a.state(before.revision + 1)).board.tokens[0].name, 'Arannis')
})

test('a failed map metadata save retains served bytes and revision, releases the lock and permits replacement', async t => {
  const store = new FailingRoomStore()
  const { app, url, access } = await server(t, { roomStore: store })
  const bytes = await readFile(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
  const endpoint = `${url}/api/rooms/${access.roomId}/map`
  const headers = { Authorization: `Bearer ${access.credential}`, 'X-Map-Layout': JSON.stringify({ x: 0, y: 0, scale: 1, width: 857, height: 1081 }) }
  const first = await fetch(endpoint, { method: 'PUT', headers, body: bytes })
  assert.equal(first.status, 200)
  const original = (await first.json()).map, before = store.load(access.roomId), image = app.rooms.get(access.roomId).image
  store.failNextSave = true
  const failed = await fetch(endpoint, { method: 'PUT', headers, body: bytes })
  assert.equal(failed.status, 500); assert.deepEqual(await failed.json(), { message: 'No se pudo completar la operación.' })
  assert.deepEqual(store.load(access.roomId), before)
  assert.equal(app.rooms.get(access.roomId).image, image); assert.equal(app.rooms.get(access.roomId).uploading, false)
  const retained = await fetch(endpoint + '/' + original.id)
  assert.equal(retained.status, 200); assert.deepEqual(Buffer.from(await retained.arrayBuffer()), bytes)
  const retry = await fetch(endpoint, { method: 'PUT', headers, body: bytes })
  assert.equal(retry.status, 200); assert.notEqual((await retry.json()).map.id, original.id)
  assert.equal(app.rooms.get(access.roomId).revision, before!.revision + 1)
  assert.equal((await fetch(endpoint + '/' + original.id)).status, 404)
})

test('audit: read failure after committed action cannot produce a false rejection or stale broadcast', async t => {
  const store = new ReadFaultRoomStore()
  const { socketUrl, access } = await server(t, { roomStore: store })
  const dm = await new Peer(socketUrl).join({ type: 'join', roomId: access.roomId, role: 'dm', credential: access.credential })
  const a = await new Peer(socketUrl).join(player(access.roomId, 'A'))
  store.failReadAfterSave = true
  const result = await dm.action({ type: 'token.create', name: 'Committed', x: 0, y: 0 })
  store.failReadAfterSave = false; store.failNextLoad = false
  success(result)
  const view = await a.state(1)
  assert.equal(view.revision, 1); assert.equal(view.board.tokens[0].name, 'Committed')
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'requestId', 'tokenId', 'type'])
  assert.deepEqual(Object.keys(view).sort(), ['board', 'dmConnected', 'participants', 'revision', 'role', 'roomId', 'selfId', 'type'])
})

test('audit: read failure after committed HTTP map cannot return false 500 or lose bytes', async t => {
  const store = new ReadFaultRoomStore()
  const { app, url, access } = await server(t, { roomStore: store })
  const bytes = await readFile(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
  store.failReadAfterSave = true
  const endpoint = `${url}/api/rooms/${access.roomId}/map`
  const response = await fetch(endpoint, { method: 'PUT', body: bytes,
    headers: { Authorization: `Bearer ${access.credential}`, 'X-Map-Layout': JSON.stringify({ x: 0, y: 0, scale: 1, width: 857, height: 1081 }) } })
  store.failReadAfterSave = false; store.failNextLoad = false
  assert.equal(response.status, 200)
  const map = (await response.json()).map
  assert.equal(app.rooms.get(access.roomId).revision, 1)
  assert.deepEqual(Buffer.from(await (await fetch(endpoint + '/' + map.id)).arrayBuffer()), bytes)
})

test('audit: failed DM reads grant no presence; committed player joins and failed disconnect reads remain recoverable', async t => {
  const store = new ReadFaultRoomStore()
  const { app, socketUrl, access } = await server(t, { roomStore: store })
  const dmJoin: Join = { type: 'join', roomId: access.roomId, role: 'dm', credential: access.credential }
  const rejected = new Peer(socketUrl)
  await once(rejected.socket, 'open')
  store.failNextLoad = true
  rejected.socket.send(JSON.stringify(dmJoin))
  await rejected.wait(m => m.type === 'error')
  await until(() => rejected.socket.readyState === WebSocket.CLOSED)
  const room = app.rooms.get(access.roomId)
  assert.equal(room.dmConnections, 0)
  const dm = await new Peer(socketUrl).join(dmJoin)
  store.failReadAfterSave = true
  const a = await new Peer(socketUrl).join(player(access.roomId, 'A'))
  assert.equal(store.failNextLoad, true) // Confirmed join never re-reads storage to publish.
  store.failReadAfterSave = false; store.failNextLoad = false
  const before = store.load(room.id)
  store.failNextLoad = true
  await a.close()
  await dm.wait(m => m.type === 'error' && m.code === 'STORAGE')
  assert.deepEqual(store.load(room.id), before)
  assert.equal(room.dmConnections, 1)
  success(await dm.action({ type: 'token.create', name: 'Recovered', x: 0, y: 0 }))
  assert.equal(dm.latest!.revision, 1)
  assert.equal(dm.latest!.participants[0].connected, false)
})

test('audit: a failed expiry deletion does not crash heartbeat or release the domain record', async t => {
  class DeleteFaultStore extends ReadFaultRoomStore {
    failed = false
    override delete(id: string) { this.failed = true; throw new Error(`Injected deletion failure: ${id}`) }
  }
  const store = new DeleteFaultStore()
  const { app, url, access } = await server(t, { roomStore: store, heartbeatMs: 20 })
  const room = app.rooms.get(access.roomId), before = store.load(room.id)
  room.lastActive = Date.now() - 31 * 60_000
  await until(() => store.failed)
  assert.equal(app.rooms.get(room.id), room)
  assert.deepEqual(store.load(room.id), before)
  assert.equal((await fetch(url + '/api/health')).status, 200)
})
