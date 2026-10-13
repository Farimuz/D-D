import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { FilesystemAssetStore } from '../../src/infrastructure/node/filesystem/assetStore.ts'
import { Rooms } from '../../server/rooms.ts'
import { createBackup } from '../../src/infrastructure/node/backup.ts'
import type { ResourceLimits } from '../../src/infrastructure/node/resourceLimits.ts'
import { directoryBytes } from '../../src/infrastructure/node/resourceLimits.ts'
import { ManagedDirectory } from '../../src/infrastructure/node/filesystem/managedDirectory.ts'

const bytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
const dm = { role: 'dm', id: null } as const
function fixture(t: TestContext, limits: Partial<ResourceLimits>, fault = (_point: string) => {}) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-limits-')), path = join(root, 'rooms.sqlite'), assetsPath = join(root, 'assets')
  const store = new SQLiteRoomStore(path, { limits, fault })
  const assets = new FilesystemAssetStore(assetsPath, store.storageIdentity, fault, { limits }), rooms = new Rooms(store, assets)
  t.after(() => { rooms.releaseRuntime(); assets.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const upload = (id: string) => {
    const map = { id: randomUUID(), x: 0, y: 0, scale: 1, width: 857, height: 1081 }
    rooms.replaceMap(rooms.get(id), dm, map, { id: map.id, bytes, type: 'image/png' })
    return map
  }
  return { root, path, assetsPath, store, assets, rooms, upload }
}

test('durable room admission is bounded independently of runtime eviction and preserves existing campaigns', t => {
  const { rooms, store } = fixture(t, { maxRooms: 2 })
  const first = rooms.create().roomId; rooms.releaseRuntime()
  rooms.create(); rooms.releaseRuntime()
  const before = store.records()
  assert.throws(() => rooms.create(), /RESOURCE_LIMIT_ROOMS/)
  assert.deepEqual(store.records(), before)
  rooms.apply(rooms.get(first), dm, { type: 'token.create', name: 'Still usable', x: 0, y: 0 })
  assert.equal(store.load(first)!.revision, 1)
  rooms.delete(first); rooms.releaseRuntime(); rooms.create()
  assert.equal(store.records().length, 2)
})

test('SQLite FULL under a tiny page budget rolls back without losing existing private/state records', t => {
  const { rooms, store, path } = fixture(t, { maxDatabaseBytes: 64 * 1024 })
  let failed = false, count = 0
  for (; count < 200; count++) {
    rooms.releaseRuntime()
    const before = store.records()
    try { rooms.create() } catch (error) {
      assert.match(String(error), /WRITE/); assert.equal((error as Error).cause && ((error as Error).cause as { errcode: number }).errcode, 13)
      assert.deepEqual(store.records(), before); failed = true; break
    }
  }
  assert.ok(failed); assert.ok(count > 0)
  const db = new DatabaseSync(path, { readOnly: true })
  try { assert.equal(db.prepare('PRAGMA quick_check').get()!.quick_check, 'ok') } finally { db.close() }
})

test('a pinned SQLite reader blocks WAL growth admission; release makes the existing campaign writable again', t => {
  const { rooms, store, path } = fixture(t, { maxWalBytes: 1 })
  const id = rooms.create().roomId, before = store.records(), reader = new DatabaseSync(path, { readOnly: true })
  try {
    reader.exec('BEGIN'); reader.prepare('SELECT * FROM rooms').all()
    assert.throws(() => rooms.apply(rooms.get(id), dm, { type: 'token.create', name: 'Blocked', x: 0, y: 0 }), /RESOURCE_LIMIT_WAL/)
    assert.deepEqual(store.records(), before)
    reader.exec('ROLLBACK')
    rooms.apply(rooms.get(id), dm, { type: 'token.create', name: 'Recovered', x: 0, y: 0 })
    assert.equal(store.load(id)!.revision, 1)
  } finally { reader.close() }
})

test('a receipt pruned by another writer after COMMIT reports uncertainty rather than a false rejection', t => {
  let armed = false, other: SQLiteRoomStore | undefined
  const { rooms, store, path } = fixture(t, { maxCommitReceipts: 1 }, point => {
    if (armed && point === 'sqlite.afterCommit') { armed = false; other!.delete('absent-room'); throw new Error('late failure') }
  })
  const id = rooms.create().roomId
  other = new SQLiteRoomStore(path, { limits: { maxCommitReceipts: 1 } })
  try {
    armed = true
    assert.throws(() => rooms.apply(rooms.get(id), dm, { type: 'token.create', name: 'Committed', x: 0, y: 0 }), /COMMIT_UNCERTAIN/)
    assert.throws(() => store.load(id), /COMMIT_UNCERTAIN/)
    assert.equal(other.load(id)!.revision, 1)
  } finally { other.close() }
})

test('backup quota includes an interrupted retained bundle and allows recovery without deleting it', async t => {
  const { root, rooms, store, assetsPath } = fixture(t, { maxBackupBytes: 125_000 })
  const id = rooms.create().roomId, pool = join(root, 'backups')
  const complete = await createBackup(store, assetsPath, pool)
  await assert.rejects(createBackup(store, assetsPath, pool, p => { if (p === 'backup.publish') throw new Error('interrupt') }), /interrupt/)
  const retained = readdirSync(pool)
  assert.equal(retained.length, 2)
  await assert.rejects(createBackup(store, assetsPath, pool), /RESOURCE_LIMIT_BACKUPS/)
  assert.deepEqual(readdirSync(pool), retained)
  assert.ok(complete); assert.ok(store.load(id))
})

test('referenced byte quota rejects a new map before preparing files but permits replacing an existing map', t => {
  const { rooms, store, assetsPath, upload } = fixture(t, { maxReferencedAssetBytes: bytes.length })
  const first = rooms.create().roomId, second = rooms.create().roomId
  upload(first); const before = store.records(), names = readdirSync(assetsPath)
  assert.throws(() => upload(second), /RESOURCE_LIMIT_REFERENCED_ASSETS/)
  assert.deepEqual(store.records(), before); assert.deepEqual(readdirSync(assetsPath), names)
  upload(first); assert.equal(store.load(first)!.revision, 2)
})

test('physical asset quota includes retained orphans after failed cleanup and never discards a confirmed map', t => {
  let deny = false
  const { rooms, store, assetsPath, upload } = fixture(t, { maxAssetStorageBytes: bytes.length * 2 + 512 }, point => { if (deny && point === 'asset.cleanup') throw new Error('cleanup unavailable') })
  const id = rooms.create().roomId
  upload(id); deny = true; upload(id)
  const before = store.records(), names = readdirSync(assetsPath)
  assert.throws(() => upload(id), /RESOURCE_LIMIT_ASSET_STORAGE/)
  assert.deepEqual(store.records(), before); assert.deepEqual(readdirSync(assetsPath), names)
  assert.deepEqual(rooms.get(id).image!.bytes, bytes)
  deny = false; rooms.recoverAssets(); upload(id)
})

test('commit receipts stay bounded while the current receipt still reconciles a confirmed commit', t => {
  let armed = false
  const { rooms, store, path } = fixture(t, { maxCommitReceipts: 3 }, point => { if (armed && point === 'sqlite.afterCommit') { armed = false; throw new Error('after commit') } })
  const id = rooms.create().roomId, room = rooms.get(id)
  for (let i = 0; i < 9; i++) { armed = true; rooms.apply(room, dm, { type: 'token.create', name: String(i), x: 0, y: 0 }) }
  assert.equal(store.load(id)!.revision, 9)
  const db = new DatabaseSync(path, { readOnly: true })
  try { assert.ok(Number(db.prepare('SELECT COUNT(*) AS n FROM commit_receipts').get()!.n) <= 3) } finally { db.close() }
})

test('backup admission counts retained bundles and rejects before creating another bundle', async t => {
  const { root, rooms, store, assetsPath } = fixture(t, { maxBackupBytes: 1 })
  rooms.create()
  await assert.rejects(createBackup(store, assetsPath, join(root, 'backups')), /RESOURCE_LIMIT_BACKUPS/)
  assert.deepEqual(readdirSync(join(root, 'backups')), [])
  assert.equal(store.records().length, 1)
})

test('recursive quota scanning opens checked child directories independently of descriptor-style file paths', t => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-directory-quota-')), pool = join(root, 'pool'), anchor = join(root, 'anchor')
  mkdirSync(pool); mkdirSync(join(pool, 'bundle')); writeFileSync(join(pool, 'bundle', 'snapshot.bin'), '1234567')
  symlinkSync(pool, anchor, process.platform === 'win32' ? 'junction' : 'dir')
  const directory = new ManagedDirectory(pool, () => {}, false)
  t.after(() => { directory.close(); rmSync(root, { recursive: true, force: true }) })
  // Linux file() returns an fd anchor, whereas path retains checked ancestors.
  // This facade exercises that distinction on Windows without claiming Linux execution.
  const checkedFile = directory.file.bind(directory)
  directory.file = name => { checkedFile(name); return join(anchor, name) }
  assert.equal(directoryBytes(directory, true), 7)
})
