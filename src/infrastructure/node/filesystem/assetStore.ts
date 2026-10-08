import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, readdirSync, readSync, unlinkSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { imageSize } from 'image-size'
import { imageType } from '../../../map/mapAsset.ts'
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from '../../../map/limits.ts'
import { ASSET_ID, validAsset } from '../assetMetadata.ts'
import { PersistenceError } from '../persistence.ts'
import type { AssetMetadata, AssetStore, FaultInjector, RecoveryReport } from '../persistence.ts'
import { ManagedDirectory } from './managedDirectory.ts'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const noFollow = constants.O_NOFOLLOW ?? 0
const ownerFile = 'assets-owner.json'
export class FilesystemAssetStore implements AssetStore {
  readonly directory: ManagedDirectory
  readonly storageIdentity: string
  private readonly fault: FaultInjector
  private readonly readOnly: boolean
  constructor(path: string, storageIdentity: string, fault: FaultInjector = () => {}, options: { readOnly?: boolean } = {}) {
    if (!ASSET_ID.test(storageIdentity)) throw new PersistenceError('STORAGE_IDENTITY', 'unchanged')
    this.storageIdentity = storageIdentity
    this.readOnly = options.readOnly ?? false
    this.fault = fault; this.directory = new ManagedDirectory(path, fault, !this.readOnly)
    try {
      const marker = this.directory.file(ownerFile)
      if (!existsSync(marker)) {
        if (this.readOnly) throw new PersistenceError('ASSET_DIRECTORY_OWNER', 'unchanged')
        if (readdirSync(this.directory.path).length) throw new PersistenceError('ASSET_DIRECTORY_NOT_EMPTY', 'unchanged')
        const fd = openSync(marker, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600)
        try { const bytes = Buffer.from(JSON.stringify({ format: 'dnd-assets', version: 1, storageIdentity })); this.writeAll(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
        this.directory.sync()
      }
      this.directory.regular(ownerFile)
      const owner = JSON.parse(readFileSync(marker, 'utf8')) as { format?: unknown; version?: unknown; storageIdentity?: unknown }
      if (owner.format !== 'dnd-assets' || owner.version !== 1 || owner.storageIdentity !== storageIdentity) throw new PersistenceError('ASSET_DIRECTORY_OWNER', 'unchanged')
      this.directory.assert()
    } catch (e) { this.directory.close(); throw e }
  }
  private filename(id: string, temporary = false) {
    if (!ASSET_ID.test(id)) throw new PersistenceError('ASSET_ID', 'unchanged')
    return `${id}.${temporary ? 'tmp' : 'asset'}`
  }
  private writeAll(fd: number, bytes: Uint8Array) {
    let offset = 0
    while (offset < bytes.byteLength) {
      const written = writeSync(fd, bytes, offset, bytes.byteLength - offset)
      if (written <= 0) throw new PersistenceError('ASSET_PARTIAL_WRITE', 'unchanged')
      offset += written
    }
  }
  prepare(id: string, bytes: Uint8Array, type: string): AssetMetadata {
    if (this.readOnly) throw new PersistenceError('READ_ONLY', 'unchanged')
    this.fault('asset.beforePrepare')
    const temporary = this.filename(id, true), stable = this.filename(id)
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES || imageType(bytes) !== type) throw new PersistenceError('INVALID_IMAGE', 'unchanged')
    const dimensions = imageSize(bytes)
    if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) throw new PersistenceError('INVALID_IMAGE', 'unchanged')
    const metadata = { id, type, byteLength: bytes.byteLength, sha256: digest(bytes), width: dimensions.width, height: dimensions.height }
    if (!validAsset(metadata)) throw new PersistenceError('INVALID_IMAGE', 'unchanged')
    this.fault('asset.open'); this.directory.assert()
    const fd = openSync(this.directory.file(temporary), constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow, 0o600)
    try {
      const opened = fstatSync(fd, { bigint: true }), named = this.directory.regular(temporary)
      if (opened.dev !== named.dev || opened.ino !== named.ino) throw new PersistenceError('PATH_CHANGED', 'unchanged')
      this.writeAll(fd, bytes.subarray(0, Math.ceil(bytes.byteLength / 2)))
      this.fault('asset.partialWrite')
      this.writeAll(fd, bytes.subarray(Math.ceil(bytes.byteLength / 2)))
      if (fstatSync(fd).size !== bytes.byteLength) throw new PersistenceError('ASSET_PARTIAL_WRITE', 'unchanged')
      this.fault('asset.sync'); fsyncSync(fd)
      this.fault('asset.publish'); this.directory.assert()
      // Hard-link publication is atomic and refuses an existing target; rename
      // could overwrite an unrelated file after an ID collision.
      linkSync(this.directory.file(temporary), this.directory.file(stable))
      this.directory.assert()
      const published = lstatSync(this.directory.file(stable), { bigint: true })
      if (!published.isFile() || published.isSymbolicLink() || published.dev !== opened.dev || published.ino !== opened.ino || published.nlink !== 2n) throw new PersistenceError('PATH_CHANGED', 'unchanged')
      unlinkSync(this.directory.file(temporary))
      fsyncSync(fd); this.directory.sync()
      this.read(metadata)
      this.fault('asset.prepared')
      return metadata
    } finally { closeSync(fd) }
  }
  read(metadata: AssetMetadata): Buffer {
    if (!validAsset(metadata)) throw new PersistenceError('INVALID_ASSET_METADATA', 'unchanged')
    const name = this.filename(metadata.id)
    this.fault('asset.read')
    const named = this.directory.regular(name)
    const fd = openSync(this.directory.file(name), constants.O_RDONLY | noFollow)
    try {
      const stat = fstatSync(fd, { bigint: true })
      if (stat.dev !== named.dev || stat.ino !== named.ino || !stat.isFile() || stat.nlink !== 1n || stat.size !== BigInt(metadata.byteLength)) throw new PersistenceError('CORRUPT_ASSET', 'unchanged')
      const bytes = Buffer.alloc(metadata.byteLength)
      let offset = 0
      while (offset < bytes.length) {
        const length = readSync(fd, bytes, offset, bytes.length - offset, null)
        if (length <= 0) throw new PersistenceError('CORRUPT_ASSET', 'unchanged')
        offset += length
      }
      if (readSync(fd, Buffer.alloc(1), 0, 1, null) || fstatSync(fd).size !== bytes.length) throw new PersistenceError('CORRUPT_ASSET', 'unchanged')
      this.directory.assert()
      if (bytes.length !== metadata.byteLength || digest(bytes) !== metadata.sha256 || imageType(bytes) !== metadata.type) throw new PersistenceError('CORRUPT_ASSET', 'unchanged')
      const dimensions = imageSize(bytes)
      if (dimensions.width !== metadata.width || dimensions.height !== metadata.height) throw new PersistenceError('CORRUPT_ASSET', 'unchanged')
      return bytes
    } finally { closeSync(fd) }
  }
  delete(id: string): undefined {
    if (this.readOnly) throw new PersistenceError('READ_ONLY', 'unchanged')
    const name = this.filename(id)
    this.fault('asset.delete')
    if (!existsSync(this.directory.file(name))) return
    this.directory.regular(name)
    this.directory.assert(); unlinkSync(this.directory.file(name)); this.directory.sync()
  }
  recover(references: ReadonlyMap<string, AssetMetadata>): RecoveryReport {
    if (this.readOnly) throw new PersistenceError('READ_ONLY', 'unchanged')
    this.fault('asset.cleanup')
    // Validate every reference before deleting anything. Uncertainty/corruption
    // stops cleanup, preserving all files for manual recovery.
    for (const [id, metadata] of references) {
      if (id !== metadata.id) throw new PersistenceError('CORRUPT_ASSET_REFERENCE', 'unchanged')
      this.read(metadata)
    }
    const report: RecoveryReport = { removed: [], retained: [...references.keys()], unknown: [] }
    for (const name of readdirSync(this.directory.path).sort()) {
      if (name === ownerFile) continue
      const match = /^(.{36})\.(tmp|asset)$/.exec(name)
      if (!match || !ASSET_ID.test(match[1])) { report.unknown.push(name); continue }
      const [id, suffix] = [match[1], match[2]]
      if (references.has(id)) continue
      const path = this.directory.file(name)
      let stat
      try { stat = lstatSync(path, { bigint: true }) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e }
      if (!stat.isFile() || stat.isSymbolicLink()) throw new PersistenceError('UNSAFE_FILE', 'unchanged')
      if (stat.nlink === 2n && suffix === 'asset') {
        // Crash between hard-link publication and removing the matching temp.
        const temp = this.directory.file(this.filename(id, true))
        if (!existsSync(temp)) throw new PersistenceError('UNSAFE_FILE', 'unchanged')
        const other = lstatSync(temp, { bigint: true })
        if (!other.isFile() || other.isSymbolicLink() || other.dev !== stat.dev || other.ino !== stat.ino || other.nlink !== 2n) throw new PersistenceError('UNSAFE_FILE', 'unchanged')
        this.fault('asset.delete'); this.directory.assert(); unlinkSync(temp)
        report.removed.push(this.filename(id, true))
      }
      if (!existsSync(path)) continue
      this.directory.regular(name)
      this.fault('asset.delete'); this.directory.assert(); unlinkSync(path)
      report.removed.push(name)
    }
    this.directory.sync()
    return report
  }
  close() { this.directory.close() }
}
