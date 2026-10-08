import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { PersistenceError } from '../persistence.ts'
import type { FaultInjector } from '../persistence.ts'
import { validRoomState } from '../../../core/room/validation.ts'

export const SCHEMA_VERSION = 3
export function initializeSchema(db: DatabaseSync, readOnly: boolean, fault: FaultInjector) {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) throw new PersistenceError('SCHEMA_VERSION', 'unchanged')
  if (readOnly && version !== SCHEMA_VERSION) throw new PersistenceError('MIGRATION_REQUIRED', 'unchanged')
  if (version === 0 && db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()) throw new PersistenceError('UNKNOWN_SCHEMA', 'unchanged')
  if (version > 0) {
    const columns = db.prepare('PRAGMA table_info(rooms)').all().map(row => row.name)
    if (columns.join(',') !== 'id,state_json,storage_version') throw new PersistenceError('SCHEMA_SHAPE', 'unchanged')
    for (const row of db.prepare('SELECT id, state_json, storage_version FROM rooms').all()) {
      let state: unknown
      try { state = JSON.parse(String(row.state_json)) } catch { throw new PersistenceError('CORRUPT_STATE', 'unchanged') }
      if (!validRoomState(state) || state.id !== row.id || !Number.isSafeInteger(row.storage_version) || Number(row.storage_version) < 1) throw new PersistenceError('CORRUPT_STATE', 'unchanged')
    }
  }
  if (version !== SCHEMA_VERSION) {
    db.exec('BEGIN IMMEDIATE')
    try {
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
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}; COMMIT`)
    } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw new PersistenceError('MIGRATION', 'rolled-back', e) }
  }
  const integrity = db.prepare('PRAGMA quick_check').all()
  if (integrity.length !== 1 || integrity[0].quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) throw new PersistenceError('CORRUPT_DATABASE', 'unchanged')
}
