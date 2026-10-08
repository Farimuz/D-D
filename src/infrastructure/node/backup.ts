import { DatabaseSync } from 'node:sqlite'
import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readSync, unlinkSync, writeSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { SQLiteRoomStore } from './sqlite/roomStore.ts'
import { SCHEMA_VERSION } from './sqlite/schema.ts'
import { FilesystemAssetStore } from './filesystem/assetStore.ts'
import { ManagedDirectory } from './filesystem/managedDirectory.ts'
import { ASSET_ID, validAsset } from './assetMetadata.ts'
import { PersistenceError } from './persistence.ts'
import type { AssetMetadata, FaultInjector } from './persistence.ts'

export interface BackupManifest {
  format: 'dnd-backup'; version: 1; schemaVersion: number
  storageIdentity: string; createdAt: string; databaseSha256: string
  roomCount: number; assets: AssetMetadata[]
}
const noFollow = constants.O_NOFOLLOW ?? 0
const nothing: FaultInjector = () => {}
function writeFile(directory: ManagedDirectory, name: string, bytes: Uint8Array) {
  const fd = openSync(directory.file(name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600)
  try {
    let offset = 0
    while (offset < bytes.length) {
      const size = writeSync(fd, bytes, offset, bytes.length - offset)
      if (size <= 0) throw new PersistenceError('PARTIAL_WRITE', 'unchanged')
      offset += size
    }
    fsyncSync(fd)
  } finally { closeSync(fd) }
  directory.sync()
}
function fileHash(directory: ManagedDirectory, name: string) {
  const named = directory.regular(name), fd = openSync(directory.file(name), constants.O_RDONLY | noFollow)
  try {
    const before = fstatSync(fd, { bigint: true })
    if (before.dev !== named.dev || before.ino !== named.ino || before.nlink !== 1n) throw new PersistenceError('UNSAFE_FILE', 'unchanged')
    const hash = createHash('sha256'), bytes = Buffer.alloc(65536)
    let size = 0, count
    while ((count = readSync(fd, bytes, 0, bytes.length, null))) { hash.update(bytes.subarray(0, count)); size += count }
    const after = fstatSync(fd, { bigint: true })
    if (BigInt(size) !== before.size || after.size !== before.size || after.mtimeNs !== before.mtimeNs) throw new PersistenceError('FILE_CHANGED', 'unchanged')
    directory.assert()
    return hash.digest('hex')
  } finally { closeSync(fd) }
}
function syncDatabase(directory: ManagedDirectory) {
  directory.regular('rooms.sqlite')
  const fd = openSync(directory.file('rooms.sqlite'), constants.O_RDWR | noFollow)
  try { fsyncSync(fd) } finally { closeSync(fd) }
  directory.sync()
}
function copySnapshot(source: ManagedDirectory, target: ManagedDirectory) {
  // This is the closed, checksum-validated standalone backup, never a live DB.
  const sourceStat = source.regular('rooms.sqlite'), targetStat = target.regular('rooms.sqlite')
  const input = openSync(source.file('rooms.sqlite'), constants.O_RDONLY | noFollow)
  let output: number | undefined
  try {
    output = openSync(target.file('rooms.sqlite'), constants.O_WRONLY | noFollow)
    const from = fstatSync(input, { bigint: true }), to = fstatSync(output, { bigint: true })
    if (from.dev !== sourceStat.dev || from.ino !== sourceStat.ino || from.nlink !== 1n
      || to.dev !== targetStat.dev || to.ino !== targetStat.ino || to.nlink !== 1n || to.size !== 0n) throw new PersistenceError('UNSAFE_FILE', 'unchanged')
    const bytes = Buffer.alloc(65536)
    let size = 0, count
    while ((count = readSync(input, bytes, 0, bytes.length, null))) {
      let offset = 0
      while (offset < count) { const written = writeSync(output, bytes, offset, count - offset); if (!written) throw new PersistenceError('PARTIAL_WRITE', 'unchanged'); offset += written }
      size += count
    }
    if (BigInt(size) !== from.size || fstatSync(input, { bigint: true }).mtimeNs !== from.mtimeNs) throw new PersistenceError('FILE_CHANGED', 'unchanged')
    fsyncSync(output); source.assert(); target.sync()
  } finally { if (output !== undefined) closeSync(output); closeSync(input) }
}
function references(store: SQLiteRoomStore) {
  const records = store.records(), assets = new Map<string, AssetMetadata>()
  for (const { state } of records) if (state.board.map) {
    const meta = store.loadAsset(state.board.map.id)
    if (!meta) throw new PersistenceError('CORRUPT_ASSET_REFERENCE', 'unchanged')
    assets.set(meta.id, meta)
  }
  return { roomCount: records.length, assets: [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)) }
}
function copyAssets(source: FilesystemAssetStore, target: FilesystemAssetStore, assets: AssetMetadata[], fault: FaultInjector, prefix: string) {
  for (const meta of assets) {
    fault(`${prefix}.asset`)
    const copied = target.prepare(meta.id, source.read(meta), meta.type)
    if (JSON.stringify(copied) !== JSON.stringify(meta)) throw new PersistenceError('BACKUP_ASSET_MISMATCH', 'unchanged')
  }
}
function standaloneSnapshot(directory: ManagedDirectory) {
  directory.regular('rooms.sqlite')
  const db = new DatabaseSync(directory.file('rooms.sqlite'), { allowExtension: false })
  try {
    // Presence and the process lease belong to the source runtime, never a restored runtime.
    db.exec('DELETE FROM runtime_lease; PRAGMA journal_mode=DELETE;')
  } finally { db.close() }
  syncDatabase(directory)
}
function manifestValue(value: unknown): value is BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== 'assets,createdAt,databaseSha256,format,roomCount,schemaVersion,storageIdentity,version'
    || v.format !== 'dnd-backup' || v.version !== 1 || v.schemaVersion !== SCHEMA_VERSION
    || typeof v.storageIdentity !== 'string' || !ASSET_ID.test(v.storageIdentity)
    || typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))
    || typeof v.databaseSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.databaseSha256)
    || !Number.isSafeInteger(v.roomCount) || Number(v.roomCount) < 0 || !Array.isArray(v.assets)) return false
  return v.assets.every(validAsset) && new Set(v.assets.map(a => a.id)).size === v.assets.length
}
function readManifest(directory: ManagedDirectory): BackupManifest {
  if (existsSync(directory.file('backup-in-progress'))) throw new PersistenceError('BACKUP_INCOMPLETE', 'unchanged')
  const named = directory.regular('backup.json')
  if (named.size > 16n * 1024n * 1024n) throw new PersistenceError('BACKUP_MANIFEST_LIMIT', 'unchanged')
  const fd = openSync(directory.file('backup.json'), constants.O_RDONLY | noFollow)
  try {
    const stat = fstatSync(fd, { bigint: true })
    if (stat.dev !== named.dev || stat.ino !== named.ino || stat.nlink !== 1n || stat.size !== named.size) throw new PersistenceError('UNSAFE_FILE', 'unchanged')
    const bytes = Buffer.alloc(Number(stat.size))
    let offset = 0
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, null); if (!count) throw new PersistenceError('BACKUP_MANIFEST', 'unchanged'); offset += count }
    let value: unknown
    try { value = JSON.parse(bytes.toString('utf8')) } catch (e) { throw new PersistenceError('BACKUP_MANIFEST', 'unchanged', e) }
    if (!manifestValue(value)) throw new PersistenceError('BACKUP_FORMAT', 'unchanged')
    directory.assert(); return value
  } finally { closeSync(fd) }
}
function checkSnapshot(directory: ManagedDirectory, manifest: BackupManifest) {
  if (fileHash(directory, 'rooms.sqlite') !== manifest.databaseSha256) throw new PersistenceError('BACKUP_CHECKSUM', 'unchanged')
  const store = new SQLiteRoomStore(join(directory.path, 'rooms.sqlite'), { readOnly: true })
  let assets: FilesystemAssetStore | undefined
  try {
    if (store.storageIdentity !== manifest.storageIdentity) throw new PersistenceError('BACKUP_IDENTITY', 'unchanged')
    const refs = references(store)
    if (refs.roomCount !== manifest.roomCount || JSON.stringify(refs.assets) !== JSON.stringify(manifest.assets)) throw new PersistenceError('BACKUP_REFERENCES', 'unchanged')
    const db = new DatabaseSync(directory.file('rooms.sqlite'), { readOnly: true, allowExtension: false })
    try { if (db.prepare('SELECT 1 FROM runtime_lease').get()) throw new PersistenceError('BACKUP_RUNTIME', 'unchanged') } finally { db.close() }
    assets = new FilesystemAssetStore(join(directory.path, 'assets'), store.storageIdentity, nothing, { readOnly: true })
    for (const meta of refs.assets) assets.read(meta)
  } finally { assets?.close(); store.close() }
}

export async function createBackup(store: SQLiteRoomStore, assetsDirectory: string, backupDirectory: string, fault: FaultInjector = nothing): Promise<string> {
  const parentPath = resolve(backupDirectory), sourceAssetsPath = resolve(assetsDirectory)
  const inside = relative(sourceAssetsPath, parentPath)
  if (inside === '' || !inside.startsWith('..') && !inside.includes(':')) throw new PersistenceError('BACKUP_PATH', 'unchanged')
  const parent = new ManagedDirectory(parentPath, fault)
  let bundle: ManagedDirectory | undefined
  try {
    const path = join(parent.path, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID())
    parent.assert(); mkdirSync(path, { mode: 0o700 }); parent.sync()
    bundle = new ManagedDirectory(path, fault, false)
    writeFile(bundle, 'backup-in-progress', Buffer.from('Incomplete backup; do not restore.\n'))
    writeFile(bundle, 'rooms.sqlite', Buffer.alloc(0))
    const target = bundle
    await store.snapshot(target.file('rooms.sqlite'), () => {
      standaloneSnapshot(target)
      const snapshot = new SQLiteRoomStore(join(target.path, 'rooms.sqlite'), { readOnly: true })
      let source: FilesystemAssetStore | undefined, copies: FilesystemAssetStore | undefined
      try {
        const refs = references(snapshot)
        source = new FilesystemAssetStore(sourceAssetsPath, snapshot.storageIdentity, fault, { readOnly: true })
        copies = new FilesystemAssetStore(join(target.path, 'assets'), snapshot.storageIdentity, fault)
        copyAssets(source, copies, refs.assets, fault, 'backup')
        const manifest: BackupManifest = { format: 'dnd-backup', version: 1, schemaVersion: SCHEMA_VERSION,
          storageIdentity: snapshot.storageIdentity, createdAt: new Date().toISOString(), databaseSha256: fileHash(target, 'rooms.sqlite'), ...refs }
        checkSnapshot(target, manifest)
        const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
        if (bytes.length > 16 * 1024 * 1024) throw new PersistenceError('BACKUP_MANIFEST_LIMIT', 'unchanged')
        writeFile(target, 'backup.partial.json', bytes)
      } finally { copies?.close(); source?.close(); snapshot.close() }
    })
    fault('backup.publish')
    // Atomic no-clobber publication of the manifest. A flag remains until complete.
    linkSync(bundle.file('backup.partial.json'), bundle.file('backup.json'))
    unlinkSync(bundle.file('backup.partial.json')); unlinkSync(bundle.file('backup-in-progress')); bundle.sync()
    return path
  } finally { bundle?.close(); parent.close() }
}

export async function restoreBackup(backupDirectory: string, destination: string, fault: FaultInjector = nothing): Promise<string> {
  const source = new ManagedDirectory(backupDirectory, fault, false)
  let target: ManagedDirectory | undefined
  try {
    const manifest = readManifest(source)
    checkSnapshot(source, manifest) // No target is touched until the whole source validates.
    const path = resolve(destination)
    const nested = relative(source.path, path)
    if (nested === '' || !nested.startsWith('..') && !nested.includes(':')) throw new PersistenceError('RESTORE_PATH', 'unchanged')
    if (existsSync(path)) throw new PersistenceError('RESTORE_TARGET_EXISTS', 'unchanged')
    // The parent must already exist; only an exclusively created new target is owned.
    const parentPath = resolve(path, '..'), parent = new ManagedDirectory(parentPath, fault, false)
    try { parent.assert(); mkdirSync(path, { mode: 0o700 }); parent.sync() } finally { parent.close() }
    target = new ManagedDirectory(path, fault, false)
    writeFile(target, 'restore-in-progress', Buffer.from('Incomplete restore; server startup is blocked.\n'))
    writeFile(target, 'rooms.sqlite', Buffer.alloc(0))
    fault('restore.snapshot'); copySnapshot(source, target)
    const original = new FilesystemAssetStore(join(source.path, 'assets'), manifest.storageIdentity, fault, { readOnly: true })
    let copies: FilesystemAssetStore | undefined
    try {
      copies = new FilesystemAssetStore(join(target.path, 'assets'), manifest.storageIdentity, fault)
      copyAssets(original, copies, manifest.assets, fault, 'restore')
    } finally { copies?.close(); original.close() }
    fault('restore.verify'); checkSnapshot(target, manifest)
    // Recheck source too: a backup is an immutable operator-owned artifact.
    checkSnapshot(source, manifest)
    fault('restore.publish'); unlinkSync(target.file('restore-in-progress')); target.sync()
    return path
  } finally { target?.close(); source.close() }
}
