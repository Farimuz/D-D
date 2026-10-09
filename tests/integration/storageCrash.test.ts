import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, linkSync, writeFileSync, lstatSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { FilesystemAssetStore } from '../../src/infrastructure/node/filesystem/assetStore.ts'
import { createBackup, restoreBackup } from '../../src/infrastructure/node/backup.ts'
import { createDurableRoomServer } from '../../server/durable.ts'
import { Rooms } from '../../server/rooms.ts'
import { createRoomState } from '../../src/core/room/domain.ts'
import { shared } from '../../src/core/room/validation.ts'
import { emptyBoard } from '../../src/state/model.ts'
import { storageConfiguration } from '../../server/storageConfig.ts'

const bytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
function root(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-storage-crash-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}
function setup(directory: string) {
  const store = new SQLiteRoomStore(join(directory, 'rooms.sqlite'))
  const assets = new FilesystemAssetStore(join(directory, 'assets'), store.storageIdentity), rooms = new Rooms(store, assets)
  const access = rooms.create(), room = rooms.get(access.roomId)
  rooms.join({ type: 'join', roomId: room.id, role: 'player', identity: 'a'.repeat(64), name: 'Persisted' })
  const map = { id: randomUUID(), x: 0, y: 0, scale: 1, width: 857, height: 1081 }
  rooms.replaceMap(room, { role: 'dm', id: null }, map, { id: map.id, bytes, type: 'image/png' })
  const records = store.records()
  rooms.releaseRuntime(); assets.close(); store.close()
  return { records, access, map }
}
async function killAt(mode: string, directory: string, point: string, source = '') {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/storage-crash-worker.ts', import.meta.url)), mode, directory, point, source], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = ''
  child.stderr.on('data', data => { errors += String(data) })
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()))
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Crash gate timeout: ' + errors)) }, 8000)
      const receive = (data: Buffer) => { output += String(data); if (output.includes('DND_STORAGE_CRASH:' + point + '\n')) { cleanup(); resolve() } }
      const early = () => { cleanup(); reject(new Error('Worker exited before gate: ' + errors)) }
      function cleanup() { clearTimeout(timer); child.stdout.off('data', receive); child.off('exit', early) }
      child.stdout.on('data', receive); child.once('exit', early); child.once('error', reject)
    })
  } finally { child.kill('SIGKILL'); await exited }
}
function verify(directory: string, expected: ReturnType<typeof setup>) {
  const store = new SQLiteRoomStore(join(directory, 'rooms.sqlite')), assets = new FilesystemAssetStore(join(directory, 'assets'), store.storageIdentity)
  try {
    assert.deepEqual(store.records(), expected.records)
    assert.deepEqual(assets.read(store.loadAsset(expected.map.id)!), bytes)
    new Rooms(store, assets).recoverAssets()
  } finally { assets.close(); store.close() }
}
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

test('restore failure immediately after target mkdir cannot start an empty installation as a completed restore', async t => {
  const directory = root(t), expected = setup(directory), store = new SQLiteRoomStore(join(directory, 'rooms.sqlite'))
  let complete: string
  try { complete = await createBackup(store, join(directory, 'assets'), join(directory, 'backups')) } finally { store.close() }
  const target = join(directory, 'interrupted-long-target')
  let opens = 0
  await assert.rejects(restoreBackup(complete!, target, point => { if (point === 'directory.open' && ++opens === 3) throw new Error('target-open-denied') }), /target-open-denied/)
  assert.ok(existsSync(target))
  let unexpected: ReturnType<typeof createDurableRoomServer> | undefined
  try {
    assert.throws(() => { unexpected = createDurableRoomServer({ databasePath: join(target, 'rooms.sqlite'), assetsDirectory: join(target, 'assets') }) }, /RESTORE_INCOMPLETE/)
  } finally { await unexpected?.close() }
  if (process.platform === 'win32') {
    const listing = spawnSync('cmd.exe', ['/d', '/c', 'dir', '/x', directory], { encoding: 'utf8', windowsHide: true })
    assert.equal(listing.status, 0, listing.stderr)
    const short = /<DIR>\s+(\S+)\s+interrupted-long-target\s*$/mi.exec(listing.stdout)?.[1]
    if (short) {
      const alias = join(directory, short)
      assert.equal(lstatSync(alias, { bigint: true }).ino, lstatSync(target, { bigint: true }).ino)
      let aliasStartup: ReturnType<typeof createDurableRoomServer> | undefined
      try {
        assert.throws(() => { aliasStartup = createDurableRoomServer({ databasePath: join(alias, 'rooms.sqlite'), assetsDirectory: join(alias, 'assets') }) }, /RESTORE_INCOMPLETE/)
      } finally { await aliasStartup?.close() }
    } else t.diagnostic('8.3 aliases are disabled; the real short-name case was not exercised on this host.')
  }
  verify(directory, expected)
})

test('backup quota scanning tolerates the retained hard-link manifest pair from interrupted publication', async t => {
  const directory = root(t), expected = setup(directory), store = new SQLiteRoomStore(join(directory, 'rooms.sqlite'))
  try {
    const pool = join(directory, 'backups'), incomplete = await createBackup(store, join(directory, 'assets'), pool)
    writeFileSync(join(incomplete, 'backup-in-progress'), 'Interrupted publication\n')
    linkSync(join(incomplete, 'backup.json'), join(incomplete, 'backup.partial.json'))
    const next = await createBackup(store, join(directory, 'assets'), pool)
    assert.ok(next); assert.ok(existsSync(join(incomplete, 'backup-in-progress')))
    assert.ok(existsSync(join(incomplete, 'backup.partial.json')))
    await assert.rejects(restoreBackup(incomplete, join(directory, 'refused')), /BACKUP_INCOMPLETE/)
  } finally { store.close() }
  verify(directory, expected)
})

test('Windows short-name aliases cannot place backups physically inside the asset directory', async t => {
  if (process.platform !== 'win32') { t.skip('Windows 8.3 alias test'); return }
  const directory = root(t); setup(directory)
  const assets = join(directory, 'image-asset-directory')
  renameSync(join(directory, 'assets'), assets)
  const listing = spawnSync('cmd.exe', ['/d', '/c', 'dir', '/x', directory], { encoding: 'utf8', windowsHide: true })
  assert.equal(listing.status, 0, listing.stderr)
  const short = /<DIR>\s+(\S+)\s+image-asset-directory\s*$/mi.exec(listing.stdout)?.[1]
  if (!short) { t.skip('8.3 aliases are disabled on this volume'); return }
  const alias = join(directory, short), pool = join(alias, 'copies')
  assert.equal(lstatSync(alias, { bigint: true }).ino, lstatSync(assets, { bigint: true }).ino)
  assert.throws(() => storageConfiguration(['--database', join(directory, 'rooms.sqlite'), '--assets-dir', assets, '--backup-dir', pool], {}, directory), /fuera/)
  const store = new SQLiteRoomStore(join(directory, 'rooms.sqlite'))
  try { await assert.rejects(createBackup(store, assets, pool), /BACKUP_PATH/) } finally { store.close() }
  assert.equal(existsSync(pool), false)
})

test('Windows short-name aliases cannot restore physically inside the immutable backup bundle', async t => {
  if (process.platform !== 'win32') { t.skip('Windows 8.3 alias test'); return }
  const directory = root(t); setup(directory)
  const pool = join(directory, 'backups'), store = new SQLiteRoomStore(join(directory, 'rooms.sqlite'))
  let complete: string
  try { complete = await createBackup(store, join(directory, 'assets'), pool) } finally { store.close() }
  const listing = spawnSync('cmd.exe', ['/d', '/c', 'dir', '/x', pool], { encoding: 'utf8', windowsHide: true })
  assert.equal(listing.status, 0, listing.stderr)
  const line = listing.stdout.split(/\r?\n/).find(line => line.trimEnd().endsWith(basename(complete!)))
  const short = line && /<DIR>\s+(\S+)\s+/i.exec(line)?.[1]
  if (!short?.includes('~')) { t.skip('8.3 aliases are disabled on this volume'); return }
  const alias = join(pool, short), target = join(alias, 'restored-inside')
  assert.equal(lstatSync(alias, { bigint: true }).ino, lstatSync(complete!, { bigint: true }).ino)
  const before = [hash(join(complete!, 'rooms.sqlite')), hash(join(complete!, 'backup.json'))]
  await assert.rejects(restoreBackup(complete!, target), /RESTORE_PATH/)
  assert.equal(existsSync(target), false)
  assert.deepEqual([hash(join(complete!, 'rooms.sqlite')), hash(join(complete!, 'backup.json'))], before)
})

for (const point of ['backup.snapshot', 'backup.copy', 'backup.asset', 'backup.publish', 'backup.manifestLinked']) {
  test(`actual Node termination at ${point} preserves source and refuses the incomplete bundle`, { timeout: 20000 }, async t => {
    const directory = root(t), expected = setup(directory)
    await killAt('backup', directory, point)
    verify(directory, expected)
    const bundles = readdirSync(join(directory, 'backups')); assert.equal(bundles.length, 1)
    await assert.rejects(restoreBackup(join(directory, 'backups', bundles[0]), join(directory, 'refused')), /BACKUP_INCOMPLETE/)
    assert.equal(existsSync(join(directory, 'refused')), false)
    const store = new SQLiteRoomStore(join(directory, 'rooms.sqlite'))
    let complete: string
    try { complete = await createBackup(store, join(directory, 'assets'), join(directory, 'backups')) } finally { store.close() }
    await restoreBackup(complete!, join(directory, 'restored')); verify(join(directory, 'restored'), expected)
  })
}
for (const point of ['restore.created', 'restore.snapshot', 'restore.asset', 'restore.verify', 'restore.publish']) {
  test(`actual Node termination at ${point} blocks startup and preserves an independently restorable backup`, { timeout: 20000 }, async t => {
    const directory = root(t), expected = setup(directory), store = new SQLiteRoomStore(join(directory, 'rooms.sqlite'))
    let complete: string
    try { complete = await createBackup(store, join(directory, 'assets'), join(directory, 'backups')) } finally { store.close() }
    const files = ['backup.json', 'rooms.sqlite', 'assets/' + expected.map.id + '.asset'], before = files.map(file => hash(join(complete!, file)))
    await killAt('restore', directory, point, complete!)
    const target = join(directory, 'interrupted')
    if (point !== 'restore.created') assert.equal(existsSync(join(target, 'restore-in-progress')), true)
    assert.throws(() => createDurableRoomServer({ databasePath: join(target, 'rooms.sqlite'), assetsDirectory: join(target, 'assets') }), /RESTORE_INCOMPLETE/)
    await assert.rejects(restoreBackup(complete!, target), /RESTORE_TARGET_EXISTS/)
    assert.deepEqual(files.map(file => hash(join(complete!, file))), before)
    await restoreBackup(complete!, join(directory, 'fresh')); verify(join(directory, 'fresh'), expected)
  })
}
for (const version of [1, 2]) {
  test(`actual Node termination during V${version} migration leaves the old schema/data recoverable`, { timeout: 20000 }, async t => {
    const directory = root(t), path = join(directory, 'rooms.sqlite'), state = createRoomState('LEGACY', shared(emptyBoard()), randomUUID)
    if (version === 2) {
      const store = new SQLiteRoomStore(path); store.transaction(() => { store.save(state); store.saveAccess(state.id, { dmHash: 'a'.repeat(64), identities: [], lastActive: 123 }) }); store.close()
      const db = new DatabaseSync(path); try { db.exec('DROP TABLE storage_identity; PRAGMA user_version=2') } finally { db.close() }
    } else {
      const db = new DatabaseSync(path)
      try { db.exec('CREATE TABLE rooms(id TEXT PRIMARY KEY,state_json TEXT NOT NULL,storage_version INTEGER NOT NULL CHECK(storage_version>0)) STRICT; PRAGMA user_version=1'); db.prepare('INSERT INTO rooms VALUES(?,?,1)').run(state.id, JSON.stringify(state)) } finally { db.close() }
    }
    await killAt('migrate', directory, 'sqlite.migrate')
    const db = new DatabaseSync(path)
    try {
      assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, version)
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='storage_identity'").get(), undefined)
      assert.deepEqual(JSON.parse(String(db.prepare('SELECT state_json FROM rooms').get()!.state_json)), state)
      assert.equal(db.prepare('PRAGMA quick_check').get()!.quick_check, 'ok')
    } finally { db.close() }
    const recovered = new SQLiteRoomStore(path)
    try { assert.deepEqual(recovered.load(state.id), state); if (version === 2) assert.equal(recovered.loadAccess(state.id)!.lastActive, 123) } finally { recovered.close() }
  })
}
