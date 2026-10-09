import { createBackup, restoreBackup } from '../src/infrastructure/node/backup.ts'
import { SQLiteRoomStore } from '../src/infrastructure/node/sqlite/roomStore.ts'
import { storageConfiguration } from './storageConfig.ts'
import { existsSync } from 'node:fs'
import { FilesystemAssetStore } from '../src/infrastructure/node/filesystem/assetStore.ts'
import { ManagedDirectory } from '../src/infrastructure/node/filesystem/managedDirectory.ts'
import { directoryBytes } from '../src/infrastructure/node/resourceLimits.ts'

const args = process.argv.slice(2)
try {
  if (args[0] === 'backup' || args[0] === 'status') {
    const config = storageConfiguration(args)
    if (config.mode !== 'durable') throw new Error('El backup requiere modo durable.')
    if (!existsSync(config.databasePath)) throw new Error('No existe la base que se quiere respaldar.')
    const store = new SQLiteRoomStore(config.databasePath, { limits: config.limits, readOnly: args[0] === 'status' })
    try {
      if (args[0] === 'backup') console.log(await createBackup(store, config.assetsDirectory, config.backupDirectory))
      else {
        const assets = new FilesystemAssetStore(config.assetsDirectory, store.storageIdentity, () => {}, { readOnly: true })
        let backups: ManagedDirectory | undefined
        try {
          if (existsSync(config.backupDirectory)) backups = new ManagedDirectory(config.backupDirectory, () => {}, false)
          console.log(JSON.stringify({ ...store.usage(), assetStorageBytes: assets.usageBytes(), backupBytes: backups ? directoryBytes(backups, true) : 0 }, null, 2))
        } finally { backups?.close(); assets.close() }
      }
    } finally { store.close() }
  } else if (args[0] === 'restore') {
    const option = (name: string) => { const i = args.indexOf(name), value = args[i + 1]; if (i < 0 || !value || value.startsWith('--')) throw new Error(`Falta ${name}.`); return value }
    console.log(await restoreBackup(option('--backup'), option('--target')))
  } else throw new Error('Uso: npm run storage -- backup|status [opciones de almacenamiento] | restore --backup <copia> --target <directorio nuevo>')
} catch (error) { console.error(error instanceof Error ? error.message : 'Falló la operación de almacenamiento.'); process.exitCode = 1 }
