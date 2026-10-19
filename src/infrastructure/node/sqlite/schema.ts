import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { PersistenceError } from '../persistence.ts'
import type { FaultInjector } from '../persistence.ts'
import { validRoomState } from '../../../core/room/validation.ts'
import { validAccess } from '../privateAccess.ts'
import { ASSET_ID, validAsset } from '../assetMetadata.ts'

// Schema 3 is the first version with complete, self-validating backup metadata.
// Earlier layouts can be migrated for normal startup but cannot be read as
// immutable backup snapshots without changing their contents.
export const MIN_RESTORABLE_BACKUP_SCHEMA_VERSION = 3
export const SCHEMA_VERSION = 3

function validateV3Structure(db: DatabaseSync) {
  // name, declared type, NOT NULL, primary-key position. Inspect SQLite's
  // resolved metadata, not SQL spelling, whitespace or constraint names.
  const tables: Record<string, Array<[string, string, number, number]>> = {
    rooms: [['id', 'TEXT', 1, 1], ['state_json', 'TEXT', 1, 0], ['storage_version', 'INTEGER', 1, 0]],
    room_access: [['room_id', 'TEXT', 1, 1], ['dm_hash', 'TEXT', 1, 0], ['identities_json', 'TEXT', 1, 0], ['last_active', 'INTEGER', 1, 0]],
    assets: [['id', 'TEXT', 1, 1], ['content_type', 'TEXT', 1, 0], ['byte_length', 'INTEGER', 1, 0], ['sha256', 'TEXT', 1, 0], ['width', 'INTEGER', 1, 0], ['height', 'INTEGER', 1, 0]],
    commit_receipts: [['operation_id', 'TEXT', 1, 1], ['committed_at', 'INTEGER', 1, 0]],
    runtime_lease: [['id', 'INTEGER', 0, 1], ['pid', 'INTEGER', 1, 0], ['nonce', 'TEXT', 1, 0]],
    storage_identity: [['id', 'INTEGER', 0, 1], ['value', 'TEXT', 1, 0]],
  }
  const invalid = () => { throw new PersistenceError('SCHEMA_SHAPE', 'unchanged') }
  // Use PRAGMA statements directly: an input database can contain tables
  // named pragma_table_list, etc. SQL table-valued lookups can be shadowed.
  const tableList = db.prepare('PRAGMA main.table_list').all()
  const metadata = (kind: 'table_xinfo' | 'index_list' | 'index_xinfo' | 'foreign_key_list', name: string) =>
    db.prepare(`PRAGMA main.${kind}("${name.replaceAll('"', '""')}")`).all()
  for (const [name, columns] of Object.entries(tables)) {
    const table = tableList.find(row => row.schema === 'main' && row.name === name)
    if (!table || table.type !== 'table' || table.wr !== 0 || table.strict !== 1) invalid()
    const actual = metadata('table_xinfo', name).sort((a, b) => Number(a.cid) - Number(b.cid))
    if (actual.length !== columns.length || actual.some((c, i) => c.name !== columns[i][0] || String(c.type).toUpperCase() !== columns[i][1]
      || c.notnull !== columns[i][2] || c.pk !== columns[i][3] || c.hidden !== 0 || c.dflt_value !== null)) invalid()
    // INTEGER PRIMARY KEY aliases the rowid. Text keys require an actual,
    // nonpartial binary PK index; additional UNIQUE indexes change admission.
    const unique = metadata('index_list', name).filter(row => row.unique === 1)
    if (columns[0][1] === 'INTEGER') { if (unique.length) invalid() }
    else {
      if (unique.length !== 1 || unique[0].origin !== 'pk' || unique[0].partial !== 0) invalid()
      const key = metadata('index_xinfo', String(unique[0].name)).filter(row => row.key === 1)
      if (key.length !== 1 || key[0].name !== columns[0][0] || key[0].coll !== 'BINARY') invalid()
    }
    const foreign = metadata('foreign_key_list', name)
    if (name === 'room_access') {
      if (foreign.length !== 1 || foreign[0].seq !== 0 || foreign[0].table !== 'rooms' || foreign[0].from !== 'room_id' || foreign[0].to !== 'id'
        || foreign[0].on_delete !== 'CASCADE' || foreign[0].on_update !== 'NO ACTION' || foreign[0].match !== 'NONE') invalid()
    } else if (foreign.length) invalid()
    if (db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='trigger' AND tbl_name=?").get(name)) invalid()
  }
  // These singleton invariants are checked as data, including layouts whose
  // original CHECK spelling is unavailable through PRAGMA metadata.
  const identities = db.prepare('SELECT id, value FROM storage_identity').all()
  if (identities.length !== 1 || identities[0].id !== 1 || typeof identities[0].value !== 'string' || !ASSET_ID.test(identities[0].value)) throw new PersistenceError('CORRUPT_STORAGE_IDENTITY', 'unchanged')
  const leases = db.prepare('SELECT id, pid, nonce FROM runtime_lease').all()
  if (leases.length > 1 || leases.some(row => row.id !== 1 || !Number.isSafeInteger(row.pid) || Number(row.pid) < 1
    || typeof row.nonce !== 'string' || row.nonce.split(':').length > 2 || !row.nonce.split(':').every(nonce => ASSET_ID.test(nonce)))) throw new PersistenceError('CORRUPT_RUNTIME_LEASE', 'unchanged')
}

export function initializeSchema(db: DatabaseSync, readOnly: boolean, fault: FaultInjector) {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) throw new PersistenceError('SCHEMA_VERSION', 'unchanged')
  // Backups of schema 3+ can be inspected without migration. A historical
  // backup must remain immutable; only a writable server startup migrates it.
  if (readOnly && version < MIN_RESTORABLE_BACKUP_SCHEMA_VERSION) throw new PersistenceError('MIGRATION_REQUIRED', 'unchanged')
  const migrating = !readOnly && version !== SCHEMA_VERSION
  try { db.exec(migrating ? 'BEGIN IMMEDIATE' : 'BEGIN') } catch (e) { throw new PersistenceError('BUSY', 'unchanged', e) }
  try {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== version) throw new PersistenceError('SCHEMA_CHANGED', 'unchanged')
  if (version === 0 && db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()) throw new PersistenceError('UNKNOWN_SCHEMA', 'unchanged')
  if (version === 3) validateV3Structure(db)
  if (version > 0) {
    const columns = db.prepare('PRAGMA table_info(rooms)').all().map(row => row.name)
    if (columns.join(',') !== 'id,state_json,storage_version') throw new PersistenceError('SCHEMA_SHAPE', 'unchanged')
    for (const row of db.prepare('SELECT id, state_json, storage_version FROM rooms').all()) {
      let state: unknown
      try { state = JSON.parse(String(row.state_json)) } catch { throw new PersistenceError('CORRUPT_STATE', 'unchanged') }
      if (!validRoomState(state) || state.id !== row.id || !Number.isSafeInteger(row.storage_version) || Number(row.storage_version) < 1) throw new PersistenceError('CORRUPT_STATE', 'unchanged')
      if (version >= 2) {
        const access = db.prepare('SELECT dm_hash, identities_json, last_active FROM room_access WHERE room_id=?').get(state.id)
        if (access) {
          let identities: unknown
          try { identities = JSON.parse(String(access.identities_json)) } catch { throw new PersistenceError('CORRUPT_ACCESS', 'unchanged') }
          if (!validAccess({ dmHash: access.dm_hash, identities, lastActive: access.last_active }, state)) throw new PersistenceError('CORRUPT_ACCESS', 'unchanged')
          if (state.board.map) {
            const meta = db.prepare('SELECT id, content_type AS type, byte_length AS byteLength, sha256, width, height FROM assets WHERE id=?').get(state.board.map.id), map = state.board.map
            if (!validAsset(meta) || !(meta.width === map.width && meta.height === map.height || meta.width === map.height && meta.height === map.width)) throw new PersistenceError('CORRUPT_ASSET_REFERENCE', 'unchanged')
          }
        }
      }
    }
    if (version >= 2) for (const meta of db.prepare('SELECT id, content_type AS type, byte_length AS byteLength, sha256, width, height FROM assets').all()) {
      if (!validAsset(meta)) throw new PersistenceError('CORRUPT_ASSET_METADATA', 'unchanged')
    }
  }
  if (migrating) {
      if (version === 0) db.exec(`CREATE TABLE rooms (
        id TEXT PRIMARY KEY, state_json TEXT NOT NULL, storage_version INTEGER NOT NULL CHECK(storage_version > 0)
      ) STRICT;`)
      // v1 is the explicitly supported neutral RoomStore schema; access is absent.
      if (version < 2) db.exec(`CREATE TABLE room_access (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
        dm_hash TEXT NOT NULL CHECK(length(dm_hash) = 64), identities_json TEXT NOT NULL,
        last_active INTEGER NOT NULL CHECK(last_active >= 0)
      ) STRICT;
      CREATE TABLE assets (
        id TEXT PRIMARY KEY, content_type TEXT NOT NULL, byte_length INTEGER NOT NULL,
        sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE commit_receipts (operation_id TEXT PRIMARY KEY, committed_at INTEGER NOT NULL) STRICT;
      CREATE TABLE runtime_lease (id INTEGER PRIMARY KEY CHECK(id = 1), pid INTEGER NOT NULL, nonce TEXT NOT NULL) STRICT;`)
      // Each asset directory is bound to one durable database identity.
      if (version < 3) {
        db.exec('CREATE TABLE storage_identity(id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL) STRICT;')
        db.prepare('INSERT INTO storage_identity(id, value) VALUES(1, ?)').run(randomUUID())
      }
      fault('sqlite.migrate')
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      validateV3Structure(db)
  }
  const integrity = db.prepare('PRAGMA quick_check').all()
  if (integrity.length !== 1 || integrity[0].quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) throw new PersistenceError('CORRUPT_DATABASE', 'unchanged')
  db.exec(migrating ? 'COMMIT' : 'ROLLBACK')
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    if (e instanceof PersistenceError) throw e
    throw new PersistenceError(migrating ? 'MIGRATION' : 'SCHEMA_SHAPE', migrating ? 'rolled-back' : 'unchanged', e)
  }
}
