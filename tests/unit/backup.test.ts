import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createBackup, restoreBackup } from '../../src/infrastructure/node/backup.ts'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { FilesystemAssetStore } from '../../src/infrastructure/node/filesystem/assetStore.ts'
import { Rooms } from '../../server/rooms.ts'
import { createDurableRoomServer } from '../../server/durable.ts'

const bytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url)), dm = { role: 'dm', id: null } as const
function fixture(t: TestContext, fault: (point: string) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-backup-')), path = join(root, 'rooms.sqlite'), assetPath = join(root, 'assets'), backupPath = join(root, 'backups')
  const store = new SQLiteRoomStore(path, { fault }), assets = new FilesystemAssetStore(assetPath, store.storageIdentity), rooms = new Rooms(store, assets)
  const access = rooms.create(), room = rooms.get(access.roomId), image = { id: randomUUID(), x: 0, y: 0, scale: 1, width: 857, height: 1081 }
  rooms.replaceMap(room, dm, image, { id: image.id, bytes, type: 'image/png' })
  const orphan = assets.prepare(randomUUID(), bytes, 'image/png')
  t.after(() => { rooms.releaseRuntime(); assets.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, path, assetPath, backupPath, store, assets, rooms, room, access, image, orphan }
}
test('backup includes exactly referenced images, private state and a standalone consistent database', async t => {
  const f = fixture(t), before = f.store.records(), lease = f.store.claimRuntime()
  const path = await createBackup(f.store, f.assetPath, f.backupPath)
  const manifest = JSON.parse(readFileSync(join(path, 'backup.json'), 'utf8'))
  assert.equal(manifest.version, 1); assert.equal(manifest.schemaVersion, 3); assert.equal(manifest.roomCount, 1)
  assert.deepEqual(manifest.assets.map((v: { id: string }) => v.id), [f.image.id])
  assert.deepEqual(readdirSync(join(path, 'assets')).sort(), ['assets-owner.json', f.image.id + '.asset'].sort())
  assert.equal(readFileSync(join(path, 'backup.json'), 'utf8').includes(f.access.credential), false)
  assert.deepEqual(f.store.records(), before)
  const db = new DatabaseSync(join(path, 'rooms.sqlite'), { readOnly: true })
  try { assert.equal(db.prepare('SELECT 1 FROM runtime_lease').get(), undefined); assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode, 'delete') } finally { db.close() }
  const target = await restoreBackup(path, join(f.root, 'restored')), restored = new SQLiteRoomStore(join(target, 'rooms.sqlite'))
  try { assert.deepEqual(restored.records(), before); restored.releaseRuntime(restored.claimRuntime()) } finally { restored.close() }
  f.store.releaseRuntime(lease)
  assert.ok(existsSync(join(f.assetPath, f.orphan.id + '.asset')))
})
test('backup excludes competing writers until all files are copied and never replays them', async t => {
  let f: ReturnType<typeof fixture>, attempted = 0
  f = fixture(t, point => {
    if (point !== 'backup.copy') return
    assert.throws(() => f.store.transaction(() => { attempted++; f.store.delete(f.room.id) }), /BUSY/)
    assert.throws(() => f.store.save(f.store.load(f.room.id)!), /BUSY/)
    const writer = new SQLiteRoomStore(f.path)
    try { assert.throws(() => writer.transaction(() => { attempted++; writer.delete(f.room.id) }), /BUSY/) } finally { writer.close() }
  })
  const before = f.store.records(), path = await createBackup(f.store, f.assetPath, f.backupPath)
  assert.equal(attempted, 0); assert.deepEqual(f.store.records(), before)
  const snapshot = new SQLiteRoomStore(join(path, 'rooms.sqlite'), { readOnly: true })
  try { assert.deepEqual(snapshot.records(), before) } finally { snapshot.close() }
  f.rooms.apply(f.room, dm, { type: 'token.create', name: 'Later', x: 1, y: 2 }); assert.equal(f.room.revision, 2)
})
for (const point of ['backup.snapshot', 'backup.copy', 'backup.asset', 'backup.publish']) {
  test(`${point} disk-full failure preserves source and leaves an explicitly incomplete backup`, async t => {
    let armed = false
    const fault = (p: string) => { if (armed && p === point) { armed = false; throw Object.assign(new Error('Backup disk full'), { code: 'ENOSPC' }) } }
    const f = fixture(t, fault), before = f.store.records(); armed = true
    await assert.rejects(createBackup(f.store, f.assetPath, f.backupPath, fault)); assert.equal(armed, false)
    assert.deepEqual(f.store.records(), before); assert.deepEqual(f.assets.read(f.store.loadAsset(f.image.id)!), bytes)
    const partial = join(f.backupPath, readdirSync(f.backupPath)[0])
    assert.ok(existsSync(join(partial, 'backup-in-progress')))
    await assert.rejects(restoreBackup(partial, join(f.root, 'restored')), /BACKUP_INCOMPLETE/)
    assert.equal(existsSync(join(f.root, 'restored')), false)
    assert.ok(await createBackup(f.store, f.assetPath, f.backupPath))
  })
}
for (const point of ['restore.snapshot', 'restore.asset', 'restore.verify', 'restore.publish']) {
  test(`${point} permission failure leaves a protected incomplete target and never mutates the backup`, async t => {
    const f = fixture(t), backup = await createBackup(f.store, f.assetPath, f.backupPath), target = join(f.root, 'restored')
    const original = readFileSync(join(backup, 'rooms.sqlite')), manifest = readFileSync(join(backup, 'backup.json'))
    let injected = false
    await assert.rejects(restoreBackup(backup, target, p => { if (p === point) { injected = true; throw Object.assign(new Error('Permission denied'), { code: 'EACCES' }) } }))
    assert.ok(injected); assert.ok(existsSync(join(target, 'restore-in-progress')))
    assert.throws(() => createDurableRoomServer({ databasePath: join(target, 'rooms.sqlite'), assetsDirectory: join(target, 'assets') }), /RESTORE_INCOMPLETE/)
    assert.deepEqual(readFileSync(join(backup, 'rooms.sqlite')), original); assert.deepEqual(readFileSync(join(backup, 'backup.json')), manifest)
    await assert.rejects(restoreBackup(backup, target), /RESTORE_TARGET_EXISTS/)
    assert.ok(await restoreBackup(backup, join(f.root, 'restored-again')))
  })
}
test('restore refuses existing targets, invalid manifests, missing/corrupt images and changed SQLite before writing any target', async t => {
  const f = fixture(t), path = await createBackup(f.store, f.assetPath, f.backupPath), target = join(f.root, 'valuable')
  mkdirSync(target); writeFileSync(join(target, 'original.txt'), 'Preserve me')
  await assert.rejects(restoreBackup(path, target), /RESTORE_TARGET_EXISTS/)
  assert.equal(readFileSync(join(target, 'original.txt'), 'utf8'), 'Preserve me')
  const manifestPath = join(path, 'backup.json'), manifest = readFileSync(manifestPath)
  for (const change of [{ version: 99 }, { assets: [{ ...JSON.parse(manifest.toString()).assets[0], id: '../../foreign' }] }]) {
    writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(manifest.toString()), ...change }))
    await assert.rejects(restoreBackup(path, join(f.root, 'invalid')), /BACKUP_FORMAT/)
    assert.equal(existsSync(join(f.root, 'invalid')), false)
  }
  writeFileSync(manifestPath, manifest)
  const imagePath = join(path, 'assets', f.image.id + '.asset'); unlinkSync(imagePath)
  await assert.rejects(restoreBackup(path, join(f.root, 'missing'))); assert.equal(existsSync(join(f.root, 'missing')), false)
  writeFileSync(imagePath, Buffer.alloc(bytes.length)); await assert.rejects(restoreBackup(path, join(f.root, 'corrupt')), /CORRUPT_ASSET/)
  assert.equal(existsSync(join(f.root, 'corrupt')), false); writeFileSync(imagePath, bytes)
  const db = new DatabaseSync(join(path, 'rooms.sqlite')); db.exec('PRAGMA user_version=99'); db.close()
  await assert.rejects(restoreBackup(path, join(f.root, 'changed')), /BACKUP_CHECKSUM/)
  assert.equal(existsSync(join(f.root, 'changed')), false)
})
test('read-only adapters never create missing paths or markers and reject writes', t => {
  const f = fixture(t), missing = join(f.root, 'missing')
  assert.throws(() => new SQLiteRoomStore(join(missing, 'rooms.sqlite'), { readOnly: true }), /DIRECTORY_MISSING/)
  assert.throws(() => new FilesystemAssetStore(missing, f.store.storageIdentity, undefined, { readOnly: true }), /DIRECTORY_MISSING/)
  assert.equal(existsSync(missing), false)
  mkdirSync(missing)
  assert.throws(() => new FilesystemAssetStore(missing, f.store.storageIdentity, undefined, { readOnly: true }), /ASSET_DIRECTORY_OWNER/)
  assert.deepEqual(readdirSync(missing), [])
  const reader = new FilesystemAssetStore(f.assetPath, f.store.storageIdentity, undefined, { readOnly: true })
  try { assert.throws(() => reader.delete(f.image.id), /READ_ONLY/); assert.throws(() => reader.recover(new Map()), /READ_ONLY/); assert.throws(() => reader.prepare(randomUUID(), bytes, 'image/png'), /READ_ONLY/) } finally { reader.close() }
})
