import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { Rooms } from '../../server/rooms.ts'

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-transaction-audit-'))
  const store = new SQLiteRoomStore(join(root, 'rooms.sqlite')), rooms = new Rooms(store)
  const id = rooms.create().roomId
  t.after(() => { rooms.releaseRuntime(); store.close(); rmSync(root, { recursive: true, force: true }) })
  // Runtime probes deliberately bypass the static synchronous contract.
  const transaction = store.transaction.bind(store) as (work: () => unknown) => unknown
  return { store, rooms, id, transaction }
}

test('audit: declared async transaction is rejected before any callback execution', t => {
  const { store, id, transaction } = fixture(t), before = store.records()
  let called = false
  assert.throws(() => transaction(async () => { called = true; store.delete(id) }), /ASYNC_TRANSACTION/)
  assert.equal(called, false)
  assert.deepEqual(store.records(), before)
})

test('audit: rejected ordinary Promise callback cannot mutate after rollback or a later legitimate commit', async t => {
  const { store, id, transaction } = fixture(t)
  let resume!: () => void, late!: Promise<void>
  const gate = new Promise<void>(resolve => { resume = resolve })
  const before = store.records()
  assert.throws(() => transaction(() => {
    store.delete(id)
    late = gate.then(() => { store.delete(id) })
    return late
  }), /ASYNC_TRANSACTION/)
  assert.deepEqual(store.records(), before)
  store.transaction(() => { const state = store.load(id)!; state.revision = 7; store.save(state) })
  const confirmed = store.records()
  resume()
  await assert.rejects(late, /ASYNC_TRANSACTION/)
  assert.deepEqual(store.records(), confirmed)
  store.transaction(() => { const state = store.load(id)!; state.revision = 8; store.save(state) })
  assert.equal(store.load(id)!.revision, 8)
})

test('audit: callbacks scheduled by an otherwise synchronous transaction lose write authority when it returns', async t => {
  const { store, id, transaction } = fixture(t)
  let finish!: (error: unknown) => void
  const late = new Promise<unknown>(resolve => { finish = resolve })
  assert.equal(transaction(() => {
    queueMicrotask(() => { try { store.delete(id); finish(null) } catch (error) { finish(error) } })
    return 42
  }), 42)
  const error = await late
  assert.match(String(error), /ASYNC_TRANSACTION/)
  assert.ok(store.load(id))
})

test('audit: exception revokes delayed work; synchronous rollback and subsequent transactions remain usable', async t => {
  const { store, id, transaction } = fixture(t), before = store.records()
  let finish!: (error: unknown) => void
  const late = new Promise<unknown>(resolve => { finish = resolve })
  assert.throws(() => transaction(() => {
    store.delete(id)
    setImmediate(() => { try { store.delete(id); finish(null) } catch (error) { finish(error) } })
    throw new Error('abort-before-commit')
  }), /WRITE/)
  assert.deepEqual(store.records(), before)
  assert.match(String(await late), /ASYNC_TRANSACTION/)
  store.transaction(() => store.delete(id))
  assert.equal(store.load(id), null)
})

test('audit: callable thenables are rejected and cannot continue outside the transaction', async t => {
  const { store, id, transaction } = fixture(t), before = store.records()
  let finish!: (error: unknown) => void
  const late = new Promise<unknown>(resolve => { finish = resolve })
  const thenable = Object.assign(() => {}, { then(resolve: () => void) {
    try { store.delete(id); finish(null) } catch (error) { finish(error) }
    resolve()
  } })
  assert.throws(() => transaction(() => thenable), /ASYNC_TRANSACTION/)
  assert.match(String(await late), /ASYNC_TRANSACTION/)
  assert.deepEqual(store.records(), before)
})

test('audit: delayed work cannot escape through another SQLite connection or close it', async t => {
  const { store, id, transaction } = fixture(t)
  const other = new SQLiteRoomStore(store.path)
  try {
  let finish!: (errors: unknown[]) => void
  const late = new Promise<unknown[]>(resolve => { finish = resolve })
  transaction(() => {
    setImmediate(() => {
      const errors = [() => other.delete(id), () => other.close(), () => new SQLiteRoomStore(store.path)].map(work => {
        try { work(); return null } catch (error) { return error }
      })
      finish(errors)
    })
  })
  for (const error of await late) assert.match(String(error), /ASYNC_TRANSACTION/)
  assert.ok(other.load(id))
  } finally { other.close() }
})
