import { AsyncLocalStorage } from 'node:async_hooks'
import { types } from 'node:util'
import { PersistenceError } from './persistence.ts'
import type { SyncWork } from './persistence.ts'

type Code = 'ASYNC_TRANSACTION' | 'ASYNC_SNAPSHOT'
const scope = new AsyncLocalStorage<{ active: boolean; code: Code }>()
export function assertSynchronousScope() {
  const current = scope.getStore()
  if (current?.active === false) throw new PersistenceError(current.code, 'unchanged')
}
export function rejectAsync(work: () => unknown, code: Code) {
  if (types.isAsyncFunction(work)) throw new PersistenceError(code, 'unchanged')
}
export function runSynchronous<T>(work: SyncWork<T>, code: Code): T {
  assertSynchronousScope(); rejectAsync(work, code)
  const current = { active: true, code }
  let result: T
  try { result = scope.run(current, work) } finally { current.active = false }
  if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
    // Throwing never cancels a Promise. Only adapter authority inherited from
    // this callback is revoked, including assimilation of custom thenables.
    scope.run(current, () => { void Promise.resolve(result).catch(() => {}) })
    throw new PersistenceError(code, 'unchanged')
  }
  return result
}
