import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { FilesystemAssetStore } from '../../src/infrastructure/node/filesystem/assetStore.ts'
import { Rooms } from '../../server/rooms.ts'
import { createRoomServer } from '../../server/app.ts'
import { OnlinePeer } from '../fixtures/online-peer.ts'
import { shared } from '../../src/online/protocol.ts'
import { emptyBoard } from '../../src/state/model.ts'

async function fixture(t: TestContext, fault: (point: string) => void, maps = false) {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-transport-')), path = join(directory, 'rooms.sqlite')
  const store = new SQLiteRoomStore(path, { fault }), assetPath = join(directory, 'assets')
  const assets = maps ? new FilesystemAssetStore(assetPath, store.storageIdentity, fault) : undefined
  const app = createRoomServer({ roomStore: store, assetStore: assets })
  await new Promise<void>(accept => app.http.listen(0, '127.0.0.1', accept))
  const port = (app.http.address() as { port: number }).port, url = `http://127.0.0.1:${port}`
  t.after(async () => { await app.close(); assets?.close(); store.close(); rmSync(directory, { recursive: true, force: true }) })
  return { store, assets, assetPath, app, url, path, socketUrl: `ws://127.0.0.1:${port}/socket` }
}

test('durable confirmed commit publishes once even when the post-commit hook fails', async t => {
  let armed = false
  const { app, socketUrl } = await fixture(t, p => { if (armed && p === 'sqlite.afterCommit') { armed = false; throw new Error('Failure after commit') } })
  const access = app.rooms.create(), dm = await new OnlinePeer(socketUrl).join({ type: 'join', ...access, role: 'dm' })
  armed = true
  assert.equal((await dm.action({ type: 'token.create', name: 'Committed', x: 0, y: 0 })).ok, true)
  assert.equal(dm.latest!.revision, 1); assert.equal(dm.latest!.board.tokens.length, 1)
  assert.equal(app.rooms.read(app.rooms.get(access.roomId)).revision, 1)
})

test('durable uncertain commit sends uncertainty and disconnects without a definitive negative result', async t => {
  let armed = false
  const { app, store, path, socketUrl } = await fixture(t, p => { if (armed && ['sqlite.afterCommit', 'sqlite.reconcile'].includes(p)) throw new Error('Uncertain commit') })
  const access = app.rooms.create(), dm = await new OnlinePeer(socketUrl).join({ type: 'join', ...access, role: 'dm' })
  armed = true
  const closed = once(dm.socket, 'close')
  dm.socket.send(JSON.stringify({ type: 'action', requestId: 'uncertain', action: { type: 'token.create', name: 'Durable', x: 0, y: 0 } }))
  const message = await dm.wait(v => v.type === 'error' && v.code === 'COMMIT_UNCERTAIN')
  assert.equal(message.type, 'error'); assert.equal((await closed)[0], 1013)
  assert.equal(dm.frames.some(text => JSON.parse(text).type === 'result'), false)
  assert.throws(() => store.load(access.roomId), /COMMIT_UNCERTAIN/)
  store.close()
  const restored = new SQLiteRoomStore(path)
  try { assert.equal(restored.load(access.roomId)!.revision, 1); assert.equal(restored.load(access.roomId)!.board.tokens.length, 1) } finally { restored.close() }
})

test('durable pre-commit rollback rejects a command without publishing or changing private/state records', async t => {
  let armed = false
  const { app, store, socketUrl } = await fixture(t, p => { if (armed && p === 'sqlite.commit') { armed = false; throw new Error('Commit denied') } })
  const access = app.rooms.create(), dm = await new OnlinePeer(socketUrl).join({ type: 'join', ...access, role: 'dm' })
  const before = store.records(), count = dm.frames.length
  armed = true
  assert.equal((await dm.action({ type: 'token.create', name: 'Rejected', x: 0, y: 0 })).ok, false)
  assert.deepEqual(store.records(), before)
  assert.equal(dm.frames.length, count + 1)
  assert.equal(dm.latest!.revision, 0)
})

test('durable HTTP room creation reports an uncertain result as 503 without claiming rollback', async t => {
  let armed = false
  const { url } = await fixture(t, p => { if (armed && ['sqlite.afterCommit', 'sqlite.reconcile'].includes(p)) throw new Error('Uncertain creation') })
  armed = true
  const res = await fetch(url + '/api/rooms', { method: 'POST', body: JSON.stringify(shared(emptyBoard())) })
  assert.equal(res.status, 503); assert.equal((await res.json()).code, 'COMMIT_UNCERTAIN')
})

const mapBytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
const layout = { x: -80, y: 90, scale: 2, width: 857, height: 1081 }

test('durable binary HTTP maps confirm files and projections; a failed replacement keeps the old served bytes', async t => {
  let armed = false
  const { app, store, url, socketUrl } = await fixture(t, p => { if (armed && p === 'asset.publish') { armed = false; throw new Error('Publish denied') } }, true)
  const access = app.rooms.create(), dm = await new OnlinePeer(socketUrl).join({ type: 'join', ...access, role: 'dm' })
  const a = await new OnlinePeer(socketUrl).join({ type: 'join', roomId: access.roomId, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' })
  const endpoint = url + '/api/rooms/' + access.roomId + '/map', headers = { Authorization: 'Bearer ' + access.credential, 'X-Map-Layout': JSON.stringify(layout) }
  assert.equal((await fetch(endpoint, { method: 'PUT', headers: { ...headers, Authorization: 'Bearer ' + 'x'.repeat(43) }, body: mapBytes })).status, 403)
  const first = await fetch(endpoint, { method: 'PUT', headers, body: mapBytes })
  assert.equal(first.status, 200)
  const metadata = (await first.json()).map
  await a.wait(v => v.type === 'state' && v.revision === 1)
  assert.deepEqual(a.latest!.board.map, metadata); assert.deepEqual(dm.latest!.board.map, metadata)
  assert.deepEqual(Buffer.from(await (await fetch(endpoint + '/' + metadata.id)).arrayBuffer()), mapBytes)
  const before = store.records()
  armed = true
  assert.equal((await fetch(endpoint, { method: 'PUT', headers, body: mapBytes })).status, 500)
  assert.equal(armed, false); assert.deepEqual(store.records(), before)
  assert.equal(app.rooms.get(access.roomId).uploading, false)
  assert.deepEqual(Buffer.from(await (await fetch(endpoint + '/' + metadata.id)).arrayBuffer()), mapBytes)
  assert.equal((await fetch(endpoint, { method: 'PUT', headers, body: mapBytes })).status, 200)
  assert.equal((await fetch(endpoint + '/' + metadata.id)).status, 404)
})

test('durable HTTP map commit remains successful when old-file cleanup is denied', async t => {
  let armed = false
  const { app, url, assetPath } = await fixture(t, p => { if (armed && p === 'asset.delete') { armed = false; throw new Error('Old asset deletion denied') } }, true)
  const access = app.rooms.create(), endpoint = url + '/api/rooms/' + access.roomId + '/map', headers = { Authorization: 'Bearer ' + access.credential, 'X-Map-Layout': JSON.stringify(layout) }
  const first = (await (await fetch(endpoint, { method: 'PUT', headers, body: mapBytes })).json()).map
  armed = true
  const response = await fetch(endpoint, { method: 'PUT', headers, body: mapBytes })
  assert.equal(response.status, 200)
  const current = (await response.json()).map
  assert.ok(readdirSync(assetPath).includes(first.id + '.asset')); assert.ok(app.rooms.maintenanceError)
  assert.equal(app.rooms.get(access.roomId).revision, 2)
  assert.deepEqual(Buffer.from(await (await fetch(endpoint + '/' + current.id)).arrayBuffer()), mapBytes)
})

test('durable uncertain HTTP map commit preserves both files until reopening confirms the reference', async t => {
  let armed = false
  const { app, url, store, path, assetPath } = await fixture(t, p => { if (armed && ['sqlite.afterCommit', 'sqlite.reconcile'].includes(p)) throw new Error('Map outcome uncertain') }, true)
  const access = app.rooms.create(), endpoint = url + '/api/rooms/' + access.roomId + '/map', headers = { Authorization: 'Bearer ' + access.credential, 'X-Map-Layout': JSON.stringify(layout) }
  const old = (await (await fetch(endpoint, { method: 'PUT', headers, body: mapBytes })).json()).map
  armed = true
  const response = await fetch(endpoint, { method: 'PUT', headers, body: mapBytes })
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'COMMIT_UNCERTAIN')
  assert.equal(readdirSync(assetPath).filter(name => name.endsWith('.asset')).length, 2)
  store.close()
  const restoredStore = new SQLiteRoomStore(path), restoredAssets = new FilesystemAssetStore(assetPath, restoredStore.storageIdentity), restored = new Rooms(restoredStore, restoredAssets)
  try {
    const state = restoredStore.load(access.roomId)!
    assert.equal(state.revision, 2); assert.notEqual(state.board.map!.id, old.id)
    restored.recoverAssets()
    assert.deepEqual(restored.get(access.roomId).image!.bytes, mapBytes)
    assert.equal(readdirSync(assetPath).filter(name => name.endsWith('.asset')).length, 1)
  } finally { restored.releaseRuntime(); restoredAssets.close(); restoredStore.close() }
})
