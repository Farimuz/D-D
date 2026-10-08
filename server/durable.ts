import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SQLiteRoomStore } from '../src/infrastructure/node/sqlite/roomStore.ts'
import { FilesystemAssetStore } from '../src/infrastructure/node/filesystem/assetStore.ts'
import { CommitUncertainError, PersistenceError } from '../src/infrastructure/node/persistence.ts'
import type { FaultInjector } from '../src/infrastructure/node/persistence.ts'
import { createRoomServer } from './app.ts'
import { Rooms } from './rooms.ts'

export function createDurableRoomServer(options: {
  databasePath: string; assetsDirectory: string; fault?: FaultInjector
  dist?: string; heartbeatMs?: number; joinTimeoutMs?: number
}) {
  if (existsSync(join(dirname(options.databasePath), 'restore-in-progress'))) throw new PersistenceError('RESTORE_INCOMPLETE', 'unchanged')
  const store = new SQLiteRoomStore(options.databasePath, { fault: options.fault })
  let assets: FilesystemAssetStore | undefined, lease: string | undefined
  try {
    lease = store.claimRuntime()
    assets = new FilesystemAssetStore(options.assetsDirectory, store.storageIdentity, options.fault)
    const recovery = new Rooms(store, assets).recoverAssets()
    const app = createRoomServer({ roomStore: store, assetStore: assets, dist: options.dist, heartbeatMs: options.heartbeatMs, joinTimeoutMs: options.joinTimeoutMs })
    let closing: Promise<void> | undefined
    return {
      ...app, storage: { store, assets, recovery },
      close(): Promise<void> {
        closing ??= (async () => {
          await app.close()
          try { store.releaseRuntime(lease!) }
          catch (e) { if (!(e instanceof CommitUncertainError)) throw e }
          finally { assets!.close(); store.close() }
        })()
        return closing
      },
    }
  } catch (e) {
    try { if (lease) store.releaseRuntime(lease) } catch { /* Quarantined storage is released by process exit, never overwritten. */ }
    assets?.close(); store.close(); throw e
  }
}
