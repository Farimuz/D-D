import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

// Physical comparisons resolve Windows 8.3 names with native realpath. Missing
// components are anchored to the closest existing ancestor. Keep using the raw
// supplied path in ManagedDirectory so canonicalization never hides links.
export function canonicalPath(destination: string): string {
  let cursor = resolve(destination)
  const missing: string[] = []
  for (;;) {
    try { return join(realpathSync.native(cursor), ...missing) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || cursor === dirname(cursor)) throw error
      missing.unshift(basename(cursor)); cursor = dirname(cursor)
    }
  }
}
