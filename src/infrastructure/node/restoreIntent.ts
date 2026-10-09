import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export function restoreIntentName(destination: string): string {
  const path = resolve(destination)
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
