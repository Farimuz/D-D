import { readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { ManagedDirectory } from './filesystem/managedDirectory.ts'
import { PersistenceError } from './persistence.ts'

export interface ResourceLimits {
  maxRooms: number
  maxReferencedAssetBytes: number
  maxAssetStorageBytes: number
  maxDatabaseBytes: number
  maxWalBytes: number
  maxCommitReceipts: number
  maxBackupBytes: number
}
export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  maxRooms: 1000, maxReferencedAssetBytes: 1024 ** 3, maxAssetStorageBytes: 1280 * 1024 ** 2,
  maxDatabaseBytes: 256 * 1024 ** 2, maxWalBytes: 64 * 1024 ** 2,
  maxCommitReceipts: 1024, maxBackupBytes: 2 * 1024 ** 3,
})
export function resourceLimits(overrides: Partial<ResourceLimits> = {}): Readonly<ResourceLimits> {
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_RESOURCE_LIMITS, key) || !Number.isSafeInteger(value) || value < 1) throw new PersistenceError('INVALID_RESOURCE_LIMIT', 'unchanged')
  }
  return Object.freeze({ ...DEFAULT_RESOURCE_LIMITS, ...overrides })
}
// Include unknown files and incomplete bundles; never follow links or erase them.
export function directoryBytes(directory: ManagedDirectory, recursive = false, depth = 0): number {
  directory.assert()
  if (depth > 32) throw new PersistenceError('RESOURCE_SCAN_DEPTH', 'unchanged')
  let bytes = 0
  for (const name of readdirSync(directory.path)) {
    const stat = lstatSync(directory.file(name))
    if (recursive && stat.isDirectory() && !stat.isSymbolicLink()) {
      // file() may be a Linux fd anchor containing symlinks. A new directory
      // must pin the checked physical ancestors, not treat that anchor as input.
      const child = new ManagedDirectory(join(directory.path, name), () => {}, false)
      try { bytes += directoryBytes(child, true, depth + 1) } finally { child.close() }
    } else {
      if (!stat.isFile() || stat.isSymbolicLink()) throw new PersistenceError('UNSAFE_FILE', 'unchanged')
      // Accounting never reads or removes a hard link. Count every name
      // conservatively, including a manifest pair left during publication.
      bytes += stat.size
    }
    if (!Number.isSafeInteger(bytes)) throw new PersistenceError('RESOURCE_SCAN_LIMIT', 'unchanged')
  }
  directory.assert()
  return bytes
}
