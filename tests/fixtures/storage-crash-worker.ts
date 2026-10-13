import { writeSync } from 'node:fs'
import { join } from 'node:path'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { createBackup, restoreBackup } from '../../src/infrastructure/node/backup.ts'

const [mode, root, point, source] = process.argv.slice(2)
const fault = (at: string) => {
  if (at !== point) return
  writeSync(1, 'DND_STORAGE_CRASH:' + at + '\n')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
}
if (mode === 'restore') await restoreBackup(source, join(root, 'interrupted'), fault)
else {
  const store = new SQLiteRoomStore(join(root, 'rooms.sqlite'), { fault })
  try { if (mode === 'backup') await createBackup(store, join(root, 'assets'), join(root, 'backups'), fault) }
  finally { store.close() }
}
