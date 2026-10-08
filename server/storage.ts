import { createBackup, restoreBackup } from '../src/infrastructure/node/backup.ts'
import { SQLiteRoomStore } from '../src/infrastructure/node/sqlite/roomStore.ts'
import { storageConfiguration } from './storageConfig.ts'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
try {
  if (args[0] === 'backup') {
    const config = storageConfiguration(args)
    if (config.mode !== 'durable') throw new Error('El backup requiere modo durable.')
    if (!existsSync(config.databasePath)) throw new Error('No existe la base que se quiere respaldar.')
    const store = new SQLiteRoomStore(config.databasePath)
    try { console.log(await createBackup(store, config.assetsDirectory, config.backupDirectory)) } finally { store.close() }
  } else if (args[0] === 'restore') {
    const option = (name: string) => { const i = args.indexOf(name), value = args[i + 1]; if (i < 0 || !value || value.startsWith('--')) throw new Error(`Falta ${name}.`); return value }
    console.log(await restoreBackup(option('--backup'), option('--target')))
  } else throw new Error('Uso: npm run storage -- backup [opciones de almacenamiento] | restore --backup <copia> --target <directorio nuevo>')
} catch (error) { console.error(error instanceof Error ? error.message : 'Falló la operación de almacenamiento.'); process.exitCode = 1 }
