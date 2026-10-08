import type { RoomStore } from '../../core/room/store.ts'
import type { RoomState } from '../../core/room/types.ts'

export type FaultInjector = (point: string) => void
export interface PrivateAccess {
  dmHash: string
  identities: Array<{ id: string; identityHash: string }>
  lastActive: number
}
export interface AssetMetadata {
  id: string; type: 'image/png' | 'image/jpeg' | 'image/webp'
  byteLength: number; sha256: string; width: number; height: number
}
export interface DurableRoomStore extends RoomStore {
  readonly durable: true
  readonly storageIdentity: string
  transaction<T>(work: () => T): T
  loadAccess(id: string): PrivateAccess | null
  saveAccess(id: string, access: PrivateAccess): undefined
  saveAsset(metadata: AssetMetadata): undefined
  loadAsset(id: string): AssetMetadata | null
  pruneAssetMetadata(): undefined
  records(): Array<{ state: RoomState; access: PrivateAccess | null; storageVersion: number }>
}
export interface RecoveryReport { removed: string[]; retained: string[]; unknown: string[] }
export interface AssetStore {
  readonly storageIdentity: string
  prepare(id: string, bytes: Uint8Array, type: string): AssetMetadata
  read(metadata: AssetMetadata): Uint8Array
  delete(id: string): undefined
  recover(references: ReadonlyMap<string, AssetMetadata>): RecoveryReport
  close(): void
}
export function isDurable(store: RoomStore): store is DurableRoomStore {
  return 'durable' in store && store.durable === true
}
export class PersistenceError extends Error {
  readonly code: string
  readonly outcome: 'unchanged' | 'rolled-back' | 'unknown'
  constructor(code: string, outcome: PersistenceError['outcome'], cause?: unknown) {
    super(`Persistence ${code} (${outcome})`, { cause }); this.code = code; this.outcome = outcome
  }
}
export class CommitUncertainError extends PersistenceError {
  readonly operationId: string
  constructor(operationId: string, cause?: unknown) { super('COMMIT_UNCERTAIN', 'unknown', cause); this.operationId = operationId }
}
