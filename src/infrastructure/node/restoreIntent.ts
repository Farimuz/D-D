import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { canonicalPath } from './filesystem/canonicalPath.ts'

export function restoreIntentName(destination: string): string {
  const path = canonicalPath(destination)
  const key = process.platform === 'win32' ? path.toLowerCase() : path
  return 'restore-intent-' + createHash('sha256').update(key).digest('hex') + '.json'
}
export function restoreIncomplete(dataDirectory: string): boolean {
  for (const path of [join(dataDirectory, 'restore-in-progress'), join(dirname(dataDirectory), restoreIntentName(dataDirectory))]) {
    try { lstatSync(path); return true }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return false
}
