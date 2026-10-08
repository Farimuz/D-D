import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { SCHEMA_VERSION } from '../../src/infrastructure/node/sqlite/schema.ts'
import { CommitUncertainError, PersistenceError } from '../../src/infrastructure/node/persistence.ts'
import { applyAction, createRoomState, registerParticipant } from '../../src/core/room/domain.ts'
import { shared } from '../../src/core/room/validation.ts'
import { emptyBoard } from '../../src/state/model.ts'

const initial = () => createRoomState('ROOM', shared(emptyBoard()), () => 'token')
const dm = { role: 'dm', id: null } as const
function fixture(t: TestContext, fault: (point: string) => void = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-sqlite-')), path = join(directory, 'rooms.sqlite')
  const store = new SQLiteRoomStore(path, { fault })
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
  return { store, path, directory }
}
const access = () => ({ dmHash: 'a'.repeat(64), identities: [] as Array<{ id: string; identityHash: string }>, lastActive: 123 })
const corrupt = (error: unknown) => error instanceof PersistenceError && error.code.startsWith('CORRUPT')

test('SQLite persists detached neutral JSON, revisions and explicit deletion across connections', t => {
  const { store, path } = fixture(t), state = initial()
  store.save(state); state.revision = 100
  const other = new SQLiteRoomStore(path)
  try {
    assert.equal(other.load('ROOM')!.revision, 0)
    const loaded = other.load('ROOM')!; loaded.participants.push({ id: 'a', name: 'Carlos' })
    assert.equal(other.load('ROOM')!.participants.length, 0)
    other.save(loaded)
    assert.equal(store.load('ROOM')!.participants[0].name, 'Carlos')
    assert.equal(store.records()[0].storageVersion, 2)
    assert.deepEqual(Object.keys(store.load('ROOM')!).sort(), ['board', 'id', 'participants', 'revision'])
    store.delete('ROOM'); assert.equal(other.load('ROOM'), null)
  } finally { other.close() }
})

test('SQLite independent stale writers conflict even when participant changes keep board revision zero', t => {
  const { store, path } = fixture(t); store.save(initial())
  const other = new SQLiteRoomStore(path)
  try {
    const first = store.load('ROOM')!, second = other.load('ROOM')!
    first.participants.push({ id: 'a', name: 'Carlos' }); second.participants.push({ id: 'b', name: 'Ana' })
    store.save(first)
    assert.throws(() => other.save(second), (e: unknown) => e instanceof PersistenceError && e.code === 'CONFLICT')
    assert.equal(other.load('ROOM')!.revision, 0); assert.deepEqual(other.load('ROOM')!.participants, first.participants)
    assert.throws(() => other.save({ ...other.load('ROOM')! }), /CONFLICT/)
  } finally { other.close() }
})

test('SQLite transactions exclude a second writer and retain ordered patches without automatic retry', t => {
  const { store, path } = fixture(t); store.save(initial())
  const other = new SQLiteRoomStore(path)
  try {
    store.transaction(() => {
      assert.throws(() => other.transaction(() => other.delete('ROOM')), /BUSY/)
      store.save(applyAction(store.load('ROOM')!, dm, { type: 'token.create', name: 'T', x: 0, y: 0 }, () => 't').state)
    })
    other.transaction(() => other.save(applyAction(other.load('ROOM')!, dm, { type: 'token.update', id: 't', changes: { name: 'Renamed' } }, () => 'x').state))
    store.transaction(() => store.save(applyAction(store.load('ROOM')!, dm, { type: 'token.update', id: 't', changes: { x: 3, y: 4 } }, () => 'x').state))
    assert.deepEqual(store.load('ROOM')!.board.tokens[0], { id: 't', name: 'Renamed', x: 3, y: 4, visible: true, ownerId: null })
    assert.equal(store.load('ROOM')!.revision, 3)
  } finally { other.close() }
})

for (const point of ['sqlite.read', 'sqlite.begin', 'sqlite.writeState', 'sqlite.writePrivate', 'sqlite.commit']) {
  test(`SQLite injected ${point} preserves state, private identity and storage version`, t => {
    let armed = false
    const { store } = fixture(t, p => { if (armed && p === point) { armed = false; throw Object.assign(new Error('Injected disk/permission failure'), { code: point === 'sqlite.writeState' ? 'ENOSPC' : 'EACCES' }) } })
    store.transaction(() => { store.save(initial()); store.saveAccess('ROOM', access()) })
    const before = store.records()
    armed = true
    assert.throws(() => store.transaction(() => {
      const current = store.load('ROOM')!, privateData = store.loadAccess('ROOM')!
      store.save(registerParticipant(current, { id: 'p', name: 'Carlos' }))
      store.saveAccess('ROOM', { ...privateData, identities: [{ id: 'p', identityHash: 'b'.repeat(64) }] })
    }), PersistenceError)
    assert.equal(armed, false)
    assert.deepEqual(store.records(), before)
  })
}

test('SQLite confirms a commit despite an exception immediately after COMMIT, without replay', t => {
  let armed = false
  const { store } = fixture(t, p => { if (armed && p === 'sqlite.afterCommit') { armed = false; throw new Error('Post-commit failure') } })
  store.save(initial()); armed = true
  const result = store.transaction(() => { const state = applyAction(store.load('ROOM')!, dm, { type: 'token.create', name: 'Committed', x: 0, y: 0 }, () => 't').state; store.save(state); return state })
  assert.equal(result.revision, 1); assert.equal(store.load('ROOM')!.board.tokens.length, 1)
})

test('SQLite uncertain commit quarantines reads/writes; reopening reconciles durable authority', t => {
  let armed = false
  const { store, path } = fixture(t, p => { if (armed && ['sqlite.afterCommit', 'sqlite.reconcile'].includes(p)) throw new Error('Uncertain storage') })
  store.save(initial()); armed = true
  assert.throws(() => store.transaction(() => store.save(applyAction(store.load('ROOM')!, dm, { type: 'token.create', name: 'Once', x: 0, y: 0 }, () => 't').state)), CommitUncertainError)
  assert.throws(() => store.load('ROOM'), CommitUncertainError)
  assert.throws(() => store.save(initial()), CommitUncertainError)
  store.close()
  const reopened = new SQLiteRoomStore(path)
  try { assert.equal(reopened.load('ROOM')!.revision, 1); assert.equal(reopened.load('ROOM')!.board.tokens.length, 1) } finally { reopened.close() }
})

test('SQLite state and access are atomic; invalid associations and asynchronous work roll back', t => {
  const { store } = fixture(t)
  store.transaction(() => { store.save(initial()); store.saveAccess('ROOM', access()) })
  const before = store.records()
  assert.throws(() => store.transaction(() => store.save(registerParticipant(store.load('ROOM')!, { id: 'p', name: 'P' }))), /CORRUPT_ACCESS/)
  assert.deepEqual(store.records(), before)
  assert.throws(() => store.transaction(async () => { store.delete('ROOM') }), /ASYNC_TRANSACTION/)
  assert.deepEqual(store.records(), before)
})

test('SQLite corrupt state is detected and never silently replaced', t => {
  const { store, path } = fixture(t); store.save(initial())
  const raw = new DatabaseSync(path)
  try { raw.prepare('UPDATE rooms SET state_json = ? WHERE id = ?').run('{invalid', 'ROOM') } finally { raw.close() }
  assert.throws(() => store.load('ROOM'), corrupt)
  assert.throws(() => store.save(initial()), corrupt)
  store.close(); assert.throws(() => new SQLiteRoomStore(path), corrupt)
})

test('SQLite corrupt private associations are rejected without altering persisted domain data', t => {
  const { store, path } = fixture(t)
  store.transaction(() => { store.save(initial()); store.saveAccess('ROOM', access()) })
  const raw = new DatabaseSync(path)
  try { raw.prepare('UPDATE room_access SET identities_json = ?').run(JSON.stringify([{ id: 'foreign', identityHash: 'b'.repeat(64) }])) } finally { raw.close() }
  assert.throws(() => store.loadAccess('ROOM'), corrupt)
  assert.deepEqual(store.load('ROOM'), initial())
  assert.throws(() => store.transaction(() => store.save(store.load('ROOM')!)), corrupt)
  assert.deepEqual(store.load('ROOM'), initial())
})

test('SQLite v1 migration preserves data; injected migration failure leaves version/data unchanged', t => {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-migration-')), path = join(directory, 'rooms.sqlite')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const raw = new DatabaseSync(path)
  raw.exec('CREATE TABLE rooms(id TEXT PRIMARY KEY, state_json TEXT NOT NULL, storage_version INTEGER NOT NULL) STRICT; PRAGMA user_version=1;')
  raw.prepare('INSERT INTO rooms VALUES(?, ?, ?)').run('ROOM', JSON.stringify(initial()), 7); raw.close()
  assert.throws(() => new SQLiteRoomStore(path, { fault: p => { if (p === 'sqlite.migrate') throw new Error('Injected migration interruption') } }), /MIGRATION/)
  const unchanged = new DatabaseSync(path)
  try { assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version, 1); assert.equal(unchanged.prepare('SELECT storage_version FROM rooms').get()!.storage_version, 7); assert.equal(unchanged.prepare("SELECT name FROM sqlite_master WHERE name='room_access'").get(), undefined) } finally { unchanged.close() }
  const migrated = new SQLiteRoomStore(path)
  try { assert.deepEqual(migrated.load('ROOM'), initial()); assert.equal(migrated.records()[0].storageVersion, 7); assert.equal(migrated.loadAccess('ROOM'), null) } finally { migrated.close() }
})

test('SQLite future schema is rejected without modifying its original database bytes', t => {
  const { store, path } = fixture(t); store.save(initial()); store.close()
  const raw = new DatabaseSync(path); raw.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`); raw.close()
  const before = readFileSync(path)
  assert.throws(() => new SQLiteRoomStore(path), /SCHEMA_VERSION/)
  assert.deepEqual(readFileSync(path), before)
})

test('SQLite runtime lease excludes another server and only its current owner releases it', t => {
  const { store, path } = fixture(t), nonce = store.claimRuntime(), other = new SQLiteRoomStore(path)
  try {
    assert.throws(() => other.claimRuntime(), /RUNTIME_ACTIVE/)
    store.releaseRuntime('foreign'); assert.throws(() => other.claimRuntime(), /RUNTIME_ACTIVE/)
    store.releaseRuntime(nonce)
    const second = other.claimRuntime()
    store.releaseRuntime(nonce); assert.throws(() => store.claimRuntime(), /RUNTIME_ACTIVE/)
    other.releaseRuntime(second)
  } finally { other.close() }
})

test('SQLite failed rollback quarantines the connection and close rolls back unfinished state', t => {
  let armed = false
  const { store, path } = fixture(t, p => { if (armed && ['sqlite.commit', 'sqlite.rollback'].includes(p)) throw new Error('Rollback unavailable') })
  store.save(initial()); armed = true
  assert.throws(() => store.transaction(() => store.save(applyAction(store.load('ROOM')!, dm, { type: 'token.create', name: 'Uncommitted', x: 0, y: 0 }, () => 't').state)), CommitUncertainError)
  assert.throws(() => store.load('ROOM'), CommitUncertainError)
  store.close()
  const restored = new SQLiteRoomStore(path)
  try { assert.deepEqual(restored.load('ROOM'), initial()) } finally { restored.close() }
})
