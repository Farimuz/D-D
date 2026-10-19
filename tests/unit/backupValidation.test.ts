import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { restoreBackup } from '../../src/infrastructure/node/backup.ts'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { FilesystemAssetStore } from '../../src/infrastructure/node/filesystem/assetStore.ts'
import { createRoomState, applyAction } from '../../src/core/room/domain.ts'
import { shared } from '../../src/core/room/validation.ts'
import { emptyBoard } from '../../src/state/model.ts'
import { createDurableRoomServer } from '../../server/durable.ts'

// Frozen v3 DDL from a70014a, deliberately independent of initializeSchema().
// A v1-migrated rooms table can lack its CHECK; application data validation
// remains responsible for positive storage_version in that historical layout.
const historicalSchema = `
CREATE TABLE rooms(id TEXT PRIMARY KEY, state_json TEXT NOT NULL, storage_version INTEGER NOT NULL CHECK(storage_version > 0)) STRICT;
CREATE TABLE room_access(room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE, dm_hash TEXT NOT NULL CHECK(length(dm_hash)=64), identities_json TEXT NOT NULL, last_active INTEGER NOT NULL CHECK(last_active>=0)) STRICT;
CREATE TABLE assets(id TEXT PRIMARY KEY, content_type TEXT NOT NULL, byte_length INTEGER NOT NULL, sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL) STRICT;
CREATE TABLE commit_receipts(operation_id TEXT PRIMARY KEY, committed_at INTEGER NOT NULL) STRICT;
CREATE TABLE runtime_lease(id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, nonce TEXT NOT NULL) STRICT;
CREATE TABLE storage_identity(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL) STRICT;
PRAGMA user_version=3;
`
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const imageBytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
function fixture(t: TestContext, ddl = historicalSchema) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-backup-validation-')), backup = join(root, 'historical'), target = join(root, 'target')
  mkdirSync(backup)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(backup, 'rooms.sqlite'), identity = randomUUID()
  const assets = new FilesystemAssetStore(join(backup, 'assets'), identity)
  let meta: ReturnType<typeof assets.prepare>
  try { meta = assets.prepare(randomUUID(), imageBytes, 'image/png') } finally { assets.close() }
  const state = applyAction(createRoomState('HISTORICAL', shared(emptyBoard()), randomUUID), { role: 'dm', id: null }, { type: 'token.create', name: 'Historical', x: 3, y: 4 }, randomUUID).state
  state.participants = [{ id: 'player', name: 'P' }]; state.board.tokens[0].ownerId = 'player'; state.revision = 7
  state.board.map = { id: meta.id, width: meta.width, height: meta.height, x: -5, y: 10, scale: 1 }
  const access = { dmHash: 'a'.repeat(64), identities: [{ id: 'player', identityHash: 'b'.repeat(64) }], lastActive: 123 }
  const db = new DatabaseSync(path)
  try {
    db.exec(ddl)
    db.prepare('INSERT INTO rooms VALUES(?,?,?)').run(state.id, JSON.stringify(state), 11)
    db.prepare('INSERT INTO room_access VALUES(?,?,?,?)').run(state.id, access.dmHash, JSON.stringify(access.identities), access.lastActive)
    db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?)').run(meta.id, meta.type, meta.byteLength, meta.sha256, meta.width, meta.height)
    db.prepare('INSERT INTO storage_identity VALUES(1,?)').run(identity)
  } finally { db.close() }
  const manifest = { format: 'dnd-backup', version: 1, schemaVersion: 3, storageIdentity: identity, createdAt: '2026-10-17T00:00:00.000Z', databaseSha256: hash(readFileSync(path)), roomCount: 1, assets: [meta] }
  writeFileSync(join(backup, 'backup.json'), JSON.stringify(manifest))
  return { root, backup, target, path, identity, manifest, state, access, meta }
}
function tree(directory: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), stat = lstatSync(path)
    if (stat.isSymbolicLink()) result[name] = 'link:' + readlinkSync(path)
    else if (stat.isDirectory()) {
      result[name + '/'] = 'directory'
      for (const [child, value] of Object.entries(tree(path))) result[name + '/' + child] = value
    } else result[name] = hash(readFileSync(path))
  }
  return result
}
function reseal(f: ReturnType<typeof fixture>) {
  writeFileSync(join(f.backup, 'backup.json'), JSON.stringify({ ...f.manifest, databaseSha256: hash(readFileSync(f.path)) }))
}
async function rejectedIntact(f: ReturnType<typeof fixture>, pattern: RegExp) {
  const before = tree(f.backup), names = readdirSync(f.root).sort()
  await assert.rejects(restoreBackup(f.backup, f.target), pattern)
  assert.equal(existsSync(f.target), false)
  assert.deepEqual(readdirSync(f.root).sort(), names, 'no target or restore intent may be created')
  assert.deepEqual(tree(f.backup), before, 'all source files and links must remain unchanged')
}
function rebuild(db: DatabaseSync, table: string, ddl: string) {
  // All inputs below are test constants. Keep child FK references at their
  // original table names while deliberately constructing invalid schemas.
  db.exec(`PRAGMA legacy_alter_table=ON; ALTER TABLE ${table} RENAME TO held_${table}; ${ddl}; INSERT INTO ${table} SELECT * FROM held_${table}; DROP TABLE held_${table};`)
}

const mutations: Array<[string, (db: DatabaseSync) => void]> = [
  ...['rooms', 'room_access', 'assets', 'runtime_lease', 'storage_identity'].map(name => [`missing ${name} table`, (db: DatabaseSync) => { db.exec(`DROP TABLE ${name}`) }] as [string, (db: DatabaseSync) => void]),
  ['missing receipts table', db => db.exec('DROP TABLE commit_receipts')],
  ['empty runtime table with wrong columns', db => db.exec('DROP TABLE runtime_lease; CREATE TABLE runtime_lease(unexpected TEXT) STRICT')],
  ['access FK absent even without orphans', db => rebuild(db, 'room_access', 'CREATE TABLE room_access(room_id TEXT PRIMARY KEY, dm_hash TEXT NOT NULL, identities_json TEXT NOT NULL, last_active INTEGER NOT NULL) STRICT')],
  ['access FK absent with an orphan', db => {
    rebuild(db, 'room_access', 'CREATE TABLE room_access(room_id TEXT PRIMARY KEY, dm_hash TEXT NOT NULL, identities_json TEXT NOT NULL, last_active INTEGER NOT NULL) STRICT')
    db.prepare('INSERT INTO room_access VALUES(?,?,?,?)').run('ORPHAN', 'a'.repeat(64), '[]', 1)
  }],
  ['access FK loses delete cascade', db => rebuild(db, 'room_access', 'CREATE TABLE room_access(room_id TEXT PRIMARY KEY REFERENCES rooms(id), dm_hash TEXT NOT NULL, identities_json TEXT NOT NULL, last_active INTEGER NOT NULL) STRICT')],
  ['rooms primary key absent', db => rebuild(db, 'rooms', 'CREATE TABLE rooms(id TEXT NOT NULL, state_json TEXT NOT NULL, storage_version INTEGER NOT NULL) STRICT')],
  ['receipts have no rowid', db => db.exec('DROP TABLE commit_receipts; CREATE TABLE commit_receipts(operation_id TEXT PRIMARY KEY,committed_at INTEGER NOT NULL) STRICT, WITHOUT ROWID')],
  ['metadata shadowing hides missing receipt rowids', db => {
    db.exec('DROP TABLE commit_receipts; CREATE TABLE commit_receipts(operation_id TEXT PRIMARY KEY,committed_at INTEGER NOT NULL) STRICT, WITHOUT ROWID; CREATE TABLE pragma_table_list(schema TEXT,name TEXT,type TEXT,wr INTEGER,strict INTEGER)')
    const insert = db.prepare('INSERT INTO pragma_table_list VALUES(?,?,?,?,?)')
    for (const name of ['rooms', 'room_access', 'assets', 'commit_receipts', 'runtime_lease', 'storage_identity']) insert.run('main', name, 'table', 0, 1)
  }],
  ['runtime has wrong type and nullable pid', db => db.exec('DROP TABLE runtime_lease; CREATE TABLE runtime_lease(id INTEGER PRIMARY KEY,pid TEXT,nonce TEXT NOT NULL) STRICT')],
  ['unexpected unique constraint', db => db.exec('CREATE UNIQUE INDEX one_image_type ON assets(content_type)')],
  ['nonbinary access key', db => rebuild(db, 'room_access', 'CREATE TABLE room_access(room_id TEXT COLLATE NOCASE PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE, dm_hash TEXT NOT NULL, identities_json TEXT NOT NULL,last_active INTEGER NOT NULL) STRICT')],
  ['trigger changes gameplay during identity rotation', db => db.exec('CREATE TRIGGER poison AFTER UPDATE ON storage_identity BEGIN DELETE FROM rooms; END')],
]
for (const [name, mutate] of mutations) test(`AUD-02 rejects ${name} before target creation with a recomputed checksum`, async t => {
  const f = fixture(t), db = new DatabaseSync(f.path, { enableForeignKeyConstraints: false })
  try { mutate(db) } finally { db.close() }
  reseal(f)
  await rejectedIntact(f, /SCHEMA_SHAPE/)
  const before = tree(f.backup)
  for (const readOnly of [true, false]) assert.throws(() => new SQLiteRoomStore(f.path, { readOnly }), /SCHEMA_SHAPE/)
  assert.deepEqual(tree(f.backup), before, 'failed startup must not migrate or repair v3')
})

test('invalid v2 structure cannot commit the v3 identity or version during migration', t => {
  const f = fixture(t), db = new DatabaseSync(f.path)
  try { db.exec('DROP TABLE storage_identity; DROP TABLE commit_receipts; PRAGMA user_version=2') } finally { db.close() }
  const before = tree(f.backup)
  assert.throws(() => new SQLiteRoomStore(f.path), /SCHEMA_SHAPE/)
  assert.deepEqual(tree(f.backup), before)
  const check = new DatabaseSync(f.path, { readOnly: true })
  try {
    assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 2)
    assert.equal(check.prepare("SELECT 1 FROM sqlite_schema WHERE name='storage_identity'").get(), undefined)
  } finally { check.close() }
})

test('standalone backup integrity includes index contents even when quick_check and a forged manifest agree', async t => {
  const f = fixture(t), db = new DatabaseSync(f.path)
  let pageSize = 0, firstRoot = 0, secondRoot = 0
  try {
    db.exec("CREATE TABLE auxiliary(id TEXT PRIMARY KEY) STRICT; INSERT INTO auxiliary(rowid,id) VALUES(2,'HISTORICAL')")
    pageSize = Number(db.prepare('PRAGMA page_size').get()!.page_size)
    firstRoot = Number(db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='sqlite_autoindex_rooms_1'").get()!.rootpage)
    secondRoot = Number(db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='sqlite_autoindex_auxiliary_1'").get()!.rootpage)
  } finally { db.close() }
  // Swap only two leaf-index pages in this closed synthetic database. Both
  // have one key but reference different rowids. This does not disable the
  // runtime's defensive mode or depend on writable_schema support.
  const bytes = readFileSync(f.path), firstOffset = (firstRoot - 1) * pageSize, secondOffset = (secondRoot - 1) * pageSize
  const first = Buffer.from(bytes.subarray(firstOffset, firstOffset + pageSize)), second = Buffer.from(bytes.subarray(secondOffset, secondOffset + pageSize))
  assert.equal(first.length, pageSize); assert.equal(second.length, pageSize)
  assert.equal(first[0], 0x0a); assert.equal(second[0], 0x0a)
  first.copy(bytes, secondOffset); second.copy(bytes, firstOffset); writeFileSync(f.path, bytes)
  const check = new DatabaseSync(f.path, { readOnly: true })
  try {
    assert.equal(check.prepare('PRAGMA quick_check').get()!.quick_check, 'ok')
    assert.notEqual(check.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
  } finally { check.close() }
  writeFileSync(join(f.backup, 'backup.json'), JSON.stringify({ ...f.manifest, roomCount: 0, assets: [], databaseSha256: hash(readFileSync(f.path)) }))
  await rejectedIntact(f, /CORRUPT_DATABASE/)
})

for (const offline of [false, true]) test(`AUD-01 rejects a committed WAL overlay (${offline ? 'offline bundle' : 'open connection'}) without changing any source bytes`, async t => {
  const f = fixture(t), db = new DatabaseSync(f.path)
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE)')
    reseal(f)
    const changed = structuredClone(f.state); changed.revision++; changed.board.tokens[0].name = 'COMMITTED_IN_WAL'
    db.prepare('UPDATE rooms SET state_json=?').run(JSON.stringify(changed))
    assert.equal(hash(readFileSync(f.path)), JSON.parse(readFileSync(join(f.backup, 'backup.json'), 'utf8')).databaseSha256)
    assert.ok(readFileSync(f.path + '-wal').length > 0)
    if (offline) {
      const frozen = join(f.root, 'offline'); cpSync(f.backup, frozen, { recursive: true })
      await rejectedIntact({ ...f, backup: frozen, path: join(frozen, 'rooms.sqlite') }, /BACKUP_NOT_STANDALONE/)
    } else await rejectedIntact(f, /BACKUP_NOT_STANDALONE/)
    assert.equal(JSON.parse(String(db.prepare('SELECT state_json FROM rooms').get()!.state_json)).revision, changed.revision)
  } finally { db.close() }
})
test('AUD-01 rejects a closed WAL-mode file without sidecars before SQLite can create SHM', async t => {
  const f = fixture(t), db = new DatabaseSync(f.path)
  try { db.exec('PRAGMA journal_mode=WAL') } finally { db.close() }
  assert.equal(existsSync(f.path + '-wal'), false); assert.equal(existsSync(f.path + '-shm'), false)
  reseal(f)
  await rejectedIntact(f, /BACKUP_NOT_STANDALONE/)
})
for (const suffix of ['-wal', '-shm', '-journal']) test(`AUD-01 refuses even an empty ${suffix} beside a rollback-mode main file`, async t => {
  const f = fixture(t); writeFileSync(f.path + suffix, Buffer.alloc(0))
  await rejectedIntact(f, /BACKUP_NOT_STANDALONE/)
})
test('AUD-01 refuses a dangling sidecar link without following it', async t => {
  const f = fixture(t)
  symlinkSync(join(f.root, 'absent'), f.path + '-wal', process.platform === 'win32' ? 'junction' : 'file')
  await rejectedIntact(f, /BACKUP_NOT_STANDALONE/)
})

for (const variant of ['original', 'reformatted', 'migrated-v1-rooms', 'large-pages']) test(`historical v3 ${variant} preserves exact room/access/map data through readonly inspection and restore`, async t => {
  let ddl = historicalSchema
  if (variant === 'reformatted') ddl = ddl.replaceAll('CREATE TABLE ', 'create\n table ').replace(/table (\w+)/g, 'table "$1"').replaceAll('PRIMARY KEY', 'primary key')
  if (variant === 'migrated-v1-rooms') ddl = ddl.replace(' CHECK(storage_version > 0)', '')
  if (variant === 'large-pages') ddl = 'PRAGMA page_size=65536;\n' + ddl
  const f = fixture(t, ddl), before = tree(f.backup)
  const reader = new SQLiteRoomStore(f.path, { readOnly: true })
  try { assert.deepEqual(reader.records(), [{ state: f.state, access: f.access, storageVersion: 11 }]) } finally { reader.close() }
  assert.deepEqual(tree(f.backup), before)
  await restoreBackup(f.backup, f.target)
  assert.deepEqual(tree(f.backup), before)
  const app = createDurableRoomServer({ databasePath: join(f.target, 'rooms.sqlite'), assetsDirectory: join(f.target, 'assets') })
  try {
    assert.notEqual(app.storage.store.storageIdentity, f.identity)
    assert.deepEqual(app.storage.store.records(), [{ state: f.state, access: f.access, storageVersion: 11 }])
    assert.deepEqual(app.rooms.get(f.state.id).image!.bytes, imageBytes)
    app.storage.store.delete(f.state.id)
    assert.equal(app.storage.store.loadAccess(f.state.id), null, 'historical cascade remains operational')
  } finally { await app.close() }
})
