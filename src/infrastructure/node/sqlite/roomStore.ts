import { DatabaseSync } from 'node:sqlite'
import { closeSync, constants, existsSync, openSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RoomState } from '../../../core/room/types.ts'
import { RoomError } from '../../../core/room/domain.ts'
import { id, keys, record, validRoomState } from '../../../core/room/validation.ts'
import { ASSET_ID, validAsset } from '../assetMetadata.ts'
import { CommitUncertainError, PersistenceError } from '../persistence.ts'
import type { AssetMetadata, DurableRoomStore, FaultInjector, PrivateAccess } from '../persistence.ts'
import { ManagedDirectory } from '../filesystem/managedDirectory.ts'
import { initializeSchema } from './schema.ts'

const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
function validAccess(v: unknown, state: RoomState): v is PrivateAccess {
  if (!record(v) || !keys(v, ['dmHash', 'identities', 'lastActive']) || !hash(v.dmHash)
    || !Number.isSafeInteger(v.lastActive) || Number(v.lastActive) < 0 || !Array.isArray(v.identities) || v.identities.length !== state.participants.length) return false
  const ids = new Set<string>(), hashes = new Set<string>()
  for (const identity of v.identities) {
    if (!record(identity) || !keys(identity, ['id', 'identityHash']) || !id(identity.id) || !hash(identity.identityHash)
      || ids.has(identity.id) || hashes.has(identity.identityHash) || !state.participants.some(p => p.id === identity.id)) return false
    ids.add(identity.id); hashes.add(identity.identityHash)
  }
  return true
}

export class SQLiteRoomStore implements DurableRoomStore {
  readonly durable = true as const
  readonly path: string
  private readonly directory: ManagedDirectory
  private readonly fileIdentity: { dev: bigint; ino: bigint }
  private readonly db: DatabaseSync
  private readonly fault: FaultInjector
  private readonly readOnly: boolean
  private readonly loaded = new WeakMap<RoomState, number>()
  private readonly reads = new Map<string, number>()
  private readonly changed = new Set<string>()
  private inTransaction = false
  private dirty = false
  private uncertain = false
  constructor(path: string, options: { fault?: FaultInjector; readOnly?: boolean } = {}) {
    this.path = resolve(path); this.fault = options.fault ?? (() => {}); this.readOnly = options.readOnly ?? false
    this.directory = new ManagedDirectory(dirname(this.path), this.fault)
    try {
      const file = this.directory.file(basename(this.path))
      if (!existsSync(file) && !this.readOnly) closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600))
      this.fileIdentity = this.directory.regular(basename(this.path))
      for (const suffix of ['-wal', '-shm']) {
        try { this.directory.regular(basename(this.path) + suffix) }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
      }
      this.db = new DatabaseSync(file, { readOnly: this.readOnly, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false })
      try {
        initializeSchema(this.db, this.readOnly, this.fault)
        void this.storageIdentity
        if (!this.readOnly) this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=250;')
        this.records()
      } catch (e) { this.db.close(); throw e }
    } catch (e) { this.directory.close(); throw e }
  }
  private available() {
    if (this.uncertain) throw new CommitUncertainError('reopen-required')
    this.directory.assert()
    if (!this.db.isOpen) throw new PersistenceError('CLOSED', 'unchanged')
    const stat = this.directory.regular(basename(this.path))
    if (stat.dev !== this.fileIdentity.dev || stat.ino !== this.fileIdentity.ino) throw new PersistenceError('DATABASE_PATH_CHANGED', 'unchanged')
  }
  get storageIdentity(): string {
    this.available()
    const identity = this.db.prepare('SELECT value FROM storage_identity WHERE id = 1').get()?.value
    if (typeof identity !== 'string' || !ASSET_ID.test(identity)) throw new PersistenceError('CORRUPT_STORAGE_IDENTITY', 'unchanged')
    return identity
  }
  load(roomId: string): RoomState | null {
    this.available()
    try {
      this.fault('sqlite.read')
      const row = this.db.prepare('SELECT state_json, storage_version FROM rooms WHERE id = ?').get(roomId)
      if (!row) return null
      let state: unknown
      try { state = JSON.parse(String(row.state_json)) } catch (e) { throw new PersistenceError('CORRUPT_STATE', 'unchanged', e) }
      if (!validRoomState(state) || state.id !== roomId || !Number.isSafeInteger(row.storage_version) || Number(row.storage_version) < 1) throw new PersistenceError('CORRUPT_STATE', 'unchanged')
      this.loaded.set(state, Number(row.storage_version))
      if (this.inTransaction) this.reads.set(roomId, Number(row.storage_version))
      return state
    } catch (e) { if (e instanceof PersistenceError) throw e; throw new PersistenceError('READ', 'unchanged', e) }
  }
  save(state: RoomState): undefined {
    if (!this.inTransaction) { this.transaction(() => this.write(state, this.loaded.get(state))); return }
    this.write(state, this.loaded.get(state) ?? this.reads.get(state.id))
  }
  private write(state: RoomState, expected?: number) {
    if (!validRoomState(state)) throw new PersistenceError('INVALID_STATE', 'unchanged')
    const json = JSON.stringify(state), current = this.db.prepare('SELECT storage_version FROM rooms WHERE id = ?').get(state.id)
    if (current) this.load(state.id) // An invalid existing record must never be silently repaired by saving.
    if (current && (expected === undefined || Number(current.storage_version) !== expected)) throw new PersistenceError('CONFLICT', 'unchanged')
    if (!current && expected !== undefined) throw new PersistenceError('CONFLICT', 'unchanged')
    this.fault('sqlite.writeState')
    const version = current ? Number(current.storage_version) + 1 : 1
    if (!Number.isSafeInteger(version)) throw new PersistenceError('STORAGE_VERSION_LIMIT', 'unchanged')
    if (current) this.db.prepare('UPDATE rooms SET state_json = ?, storage_version = ? WHERE id = ? AND storage_version = ?').run(json, version, state.id, expected!)
    else this.db.prepare('INSERT INTO rooms(id, state_json, storage_version) VALUES (?, ?, ?)').run(state.id, json, version)
    this.reads.set(state.id, version); this.changed.add(state.id); this.dirty = true
  }
  delete(roomId: string): undefined {
    if (!this.inTransaction) { this.transaction(() => this.delete(roomId)); return }
    this.load(roomId)
    this.fault('sqlite.delete')
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId)
    this.changed.add(roomId); this.dirty = true
  }
  loadAccess(roomId: string): PrivateAccess | null {
    this.available()
    const row = this.db.prepare(`SELECT dm_hash, identities_json, last_active, state_json
      FROM room_access JOIN rooms ON rooms.id = room_access.room_id WHERE room_id = ?`).get(roomId)
    if (!row) return null
    let access: unknown, state: unknown
    try { access = { dmHash: row.dm_hash, identities: JSON.parse(String(row.identities_json)), lastActive: row.last_active }; state = JSON.parse(String(row.state_json)) }
    catch (e) { throw new PersistenceError('CORRUPT_ACCESS', 'unchanged', e) }
    if (!validRoomState(state) || state.id !== roomId || !validAccess(access, state)) throw new PersistenceError('CORRUPT_ACCESS', 'unchanged')
    return access
  }
  saveAccess(roomId: string, access: PrivateAccess): undefined {
    if (!this.inTransaction) { this.transaction(() => this.saveAccess(roomId, access)); return }
    const state = this.load(roomId)
    if (!state || !validAccess(access, state)) throw new PersistenceError('INVALID_ACCESS', 'unchanged')
    if (!this.changed.has(roomId)) this.save(state)
    this.fault('sqlite.writePrivate')
    this.db.prepare(`INSERT INTO room_access(room_id, dm_hash, identities_json, last_active) VALUES (?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET dm_hash = excluded.dm_hash, identities_json = excluded.identities_json, last_active = excluded.last_active`)
      .run(roomId, access.dmHash, JSON.stringify(access.identities), access.lastActive)
    this.dirty = true
  }
  loadAsset(assetId: string): AssetMetadata | null {
    this.available()
    const row = this.db.prepare('SELECT id, content_type, byte_length, sha256, width, height FROM assets WHERE id = ?').get(assetId)
    if (!row) return null
    const meta = { id: row.id, type: row.content_type, byteLength: row.byte_length, sha256: row.sha256, width: row.width, height: row.height }
    if (!validAsset(meta)) throw new PersistenceError('CORRUPT_ASSET_METADATA', 'unchanged')
    return meta
  }
  saveAsset(meta: AssetMetadata): undefined {
    if (!this.inTransaction) { this.transaction(() => this.saveAsset(meta)); return }
    if (!validAsset(meta)) throw new PersistenceError('INVALID_ASSET_METADATA', 'unchanged')
    this.fault('sqlite.writeAsset')
    this.db.prepare('INSERT INTO assets(id, content_type, byte_length, sha256, width, height) VALUES (?, ?, ?, ?, ?, ?)')
      .run(meta.id, meta.type, meta.byteLength, meta.sha256, meta.width, meta.height)
    this.dirty = true
  }
  pruneAssetMetadata(): undefined {
    if (!this.inTransaction) { this.transaction(() => this.pruneAssetMetadata()); return }
    const referenced = new Set(this.records().flatMap(({ state }) => state.board.map ? [state.board.map.id] : []))
    for (const row of this.db.prepare('SELECT id FROM assets').all()) if (!referenced.has(String(row.id))) {
      this.db.prepare('DELETE FROM assets WHERE id = ?').run(row.id!)
      this.dirty = true
    }
  }
  private validateReference(state: RoomState, access: PrivateAccess | null) {
    if (!access || !state.board.map) return
    const meta = this.loadAsset(state.board.map.id), map = state.board.map
    if (!meta || !(meta.width === map.width && meta.height === map.height || meta.width === map.height && meta.height === map.width)) throw new PersistenceError('CORRUPT_ASSET_REFERENCE', 'unchanged')
  }
  records(): ReturnType<DurableRoomStore['records']> {
    this.available()
    if (!this.inTransaction && !this.db.isTransaction) {
      // All rows and associations belong to one read snapshot, even with another writer.
      this.db.exec('BEGIN')
      try { return this.records() } finally { this.db.exec('ROLLBACK') }
    }
    const result = []
    for (const row of this.db.prepare('SELECT id, storage_version FROM rooms ORDER BY id').all()) {
      const state = this.load(String(row.id))!, access = this.loadAccess(state.id)
      this.validateReference(state, access)
      result.push({ state, access, storageVersion: Number(row.storage_version) })
    }
    return result
  }
  transaction<T>(work: () => T): T {
    this.available()
    if (this.readOnly) throw new PersistenceError('READ_ONLY', 'unchanged')
    if (this.inTransaction) throw new PersistenceError('NESTED_TRANSACTION', 'unchanged')
    const operationId = randomUUID()
    try { this.fault('sqlite.begin'); this.db.exec('BEGIN IMMEDIATE') }
    catch (e) { throw new PersistenceError((e as { errcode?: number }).errcode === 5 ? 'BUSY' : 'BEGIN', 'unchanged', e) }
    this.inTransaction = true; this.dirty = false; this.reads.clear(); this.changed.clear()
    let result!: T, attemptedCommit = false
    try {
      result = work()
      if (result && typeof result === 'object' && 'then' in result) throw new PersistenceError('ASYNC_TRANSACTION', 'unchanged')
      // Validate private/domain associations only once both parts are written.
      for (const roomId of this.changed) { const state = this.load(roomId); if (state) this.validateReference(state, this.loadAccess(roomId)) }
      if (this.dirty) this.db.prepare('INSERT INTO commit_receipts(operation_id, committed_at) VALUES (?, ?)').run(operationId, Date.now())
      this.fault('sqlite.commit'); attemptedCommit = true; this.db.exec('COMMIT'); this.fault('sqlite.afterCommit')
      return result
    } catch (e) {
      try {
        if (this.db.isTransaction) { this.fault('sqlite.rollback'); this.db.exec('ROLLBACK') }
        if (this.db.isTransaction) throw new Error('Rollback not confirmed')
        this.fault('sqlite.reconcile')
        const receipt = this.db.prepare('SELECT operation_id FROM commit_receipts WHERE operation_id = ?').get(operationId)
        if (receipt) return result // Confirmed commit, including an exception after COMMIT.
        if (attemptedCommit && !this.dirty) return result // Read-only transaction has no durable effects.
      } catch (reconcile) { this.uncertain = true; throw new CommitUncertainError(operationId, reconcile) }
      if (e instanceof RoomError) throw e
      if (e instanceof PersistenceError) throw this.dirty ? new PersistenceError(e.code, 'rolled-back', e) : e
      throw new PersistenceError('WRITE', 'rolled-back', e)
    } finally { this.inTransaction = false; this.reads.clear(); this.changed.clear() }
  }
  claimRuntime(): string {
    return this.transaction(() => {
      const lease = this.db.prepare('SELECT pid, nonce FROM runtime_lease WHERE id = 1').get()
      if (lease) {
        if (!Number.isSafeInteger(lease.pid) || Number(lease.pid) < 1 || typeof lease.nonce !== 'string' || !ASSET_ID.test(lease.nonce)) throw new PersistenceError('CORRUPT_RUNTIME_LEASE', 'unchanged')
        let alive = true
        try { process.kill(Number(lease.pid), 0) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false }
        if (alive) throw new PersistenceError('RUNTIME_ACTIVE', 'unchanged')
      }
      const nonce = randomUUID()
      this.db.prepare('INSERT INTO runtime_lease(id, pid, nonce) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid, nonce=excluded.nonce').run(process.pid, nonce)
      this.dirty = true
      return nonce
    })
  }
  releaseRuntime(nonce: string) {
    this.transaction(() => {
      const result = this.db.prepare('DELETE FROM runtime_lease WHERE id = 1 AND nonce = ?').run(nonce)
      this.dirty = Number(result.changes) > 0
    })
  }
  close() { if (this.db.isOpen) this.db.close(); this.directory.close() }
}
