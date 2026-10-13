import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resourceLimits } from '../src/infrastructure/node/resourceLimits.ts'
import type { ResourceLimits } from '../src/infrastructure/node/resourceLimits.ts'
import { canonicalPath } from '../src/infrastructure/node/filesystem/canonicalPath.ts'

export interface StorageConfiguration {
  mode: 'temporary' | 'durable'
  databasePath: string; assetsDirectory: string; backupDirectory: string
  limits: Readonly<ResourceLimits>
}
export function storageConfiguration(args: readonly string[] = process.argv.slice(2), env: Readonly<Record<string, string | undefined>> = process.env, cwd = process.cwd()): StorageConfiguration {
  function option(key: string, fallback: string) {
    const index = args.lastIndexOf(key)
    if (index < 0) return fallback
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${key}.`)
    return value
  }
  const mode = args.includes('--temporary') ? 'temporary' : env.DND_STORAGE_MODE ?? 'durable'
  if (mode !== 'temporary' && mode !== 'durable') throw new Error('DND_STORAGE_MODE debe ser temporary o durable.')
  const data = resolve(cwd, option('--data-dir', env.DND_DATA_DIR ?? '.dnd-data'))
  const databasePath = resolve(cwd, option('--database', env.DND_DB_PATH ?? join(data, 'rooms.sqlite')))
  const assetsDirectory = resolve(cwd, option('--assets-dir', env.DND_ASSETS_DIR ?? join(data, 'assets')))
  const backupDirectory = resolve(cwd, option('--backup-dir', env.DND_BACKUP_DIR ?? '.dnd-backups'))
  const inside = (parent: string, child: string) => { const path = relative(canonicalPath(parent), canonicalPath(child)); return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path) }
  if (inside(assetsDirectory, dirname(databasePath)) || inside(assetsDirectory, backupDirectory)) throw new Error('SQLite y backups deben quedar fuera del directorio de assets.')
  const keys: Array<[keyof ResourceLimits, string]> = [
    ['maxRooms', 'ROOMS'], ['maxReferencedAssetBytes', 'REFERENCED_ASSET_BYTES'], ['maxAssetStorageBytes', 'ASSET_STORAGE_BYTES'],
    ['maxDatabaseBytes', 'DATABASE_BYTES'], ['maxWalBytes', 'WAL_BYTES'], ['maxCommitReceipts', 'COMMIT_RECEIPTS'], ['maxBackupBytes', 'BACKUP_BYTES'],
  ]
  const overrides: Partial<ResourceLimits> = {}
  for (const [key, suffix] of keys) {
    const raw = option('--max-' + suffix.toLowerCase().replaceAll('_', '-'), env['DND_MAX_' + suffix] ?? '')
    if (raw !== '') { if (!/^\d+$/.test(raw)) throw new Error('Los límites de almacenamiento deben ser enteros positivos.'); overrides[key] = Number(raw) }
  }
  return { mode, databasePath, assetsDirectory, backupDirectory, limits: resourceLimits(overrides) }
}
