import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { createRoomServer } from '../../server/app.ts'
import { OnlinePeer } from '../fixtures/online-peer.ts'
import { shared } from '../../src/online/protocol.ts'
import { emptyBoard } from '../../src/state/model.ts'

async function fixture(t: TestContext, fault: (point: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-transport-')), path = join(directory, 'rooms.sqlite')
  const store = new SQLiteRoomStore(path, { fault }), app = createRoomServer({ roomStore: store })
  await new Promise<void>(accept => app.http.listen(0, '127.0.0.1', accept))
  const port = (app.http.address() as { port: number }).port, url = `http://127.0.0.1:${port}`
  t.after(async () => { await app.close(); store.close(); rmSync(directory, { recursive: true, force: true }) })
  return { store, app, url, path, socketUrl: `ws://127.0.0.1:${port}/socket` }
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
