import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { dirname, join, parse, relative, resolve } from 'node:path'
import { PersistenceError } from '../persistence.ts'
import type { FaultInjector } from '../persistence.ts'

// Data directories must belong to the operator and be inaccessible to untrusted
// OS users. Linux operations are anchored to a directory descriptor; on Windows
// Node has no openat API, so ancestor identities are checked at every boundary.
export class ManagedDirectory {
  readonly path: string
  private descriptor: number
  private readonly pins: Array<{ path: string; dev: bigint; ino: bigint }> = []
  constructor(path: string, fault: FaultInjector = () => {}) {
    this.path = resolve(path)
    fault('directory.open')
    const paths: string[] = []
    for (let cursor = this.path; ; cursor = dirname(cursor)) { paths.unshift(cursor); if (cursor === parse(cursor).root) break }
    for (const current of paths) {
      if (!existsSync(current)) { try { mkdirSync(current, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e } }
      const stat = lstatSync(current, { bigint: true })
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PersistenceError('PATH', 'unchanged')
      this.pins.push({ path: current, dev: stat.dev, ino: stat.ino })
    }
    const stat = lstatSync(this.path, { bigint: true })
    if (process.platform !== 'win32' && ((stat.mode & 0o022n) !== 0n || stat.uid !== BigInt(process.getuid!()))) throw new PersistenceError('DIRECTORY_PERMISSIONS', 'unchanged')
    this.descriptor = openSync(this.path, constants.O_RDONLY)
    try { this.assert() } catch (e) { closeSync(this.descriptor); this.descriptor = -1; throw e }
  }
  assert() {
    if (this.descriptor < 0) throw new PersistenceError('DIRECTORY_CLOSED', 'unchanged')
    for (const pin of this.pins) {
      const stat = lstatSync(pin.path, { bigint: true })
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== pin.dev || stat.ino !== pin.ino) throw new PersistenceError('PATH_CHANGED', 'unchanged')
    }
    const stat = fstatSync(this.descriptor, { bigint: true }), pin = this.pins.at(-1)!
    if (stat.dev !== pin.dev || stat.ino !== pin.ino) throw new PersistenceError('PATH_CHANGED', 'unchanged')
  }
  file(name: string): string {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(name) || name.includes('..') || name.endsWith('.') || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw new PersistenceError('PATH', 'unchanged')
    this.assert()
    const path = join(this.path, name)
    if (relative(this.path, path) !== name) throw new PersistenceError('PATH', 'unchanged')
    if (process.platform === 'linux') {
      const anchor = `/proc/self/fd/${this.descriptor}`
      if (!existsSync(anchor)) throw new PersistenceError('DIRECTORY_ANCHOR', 'unchanged')
      return `${anchor}/${name}`
    }
    return path
  }
  regular(name: string) {
    const stat = lstatSync(this.file(name), { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw new PersistenceError('UNSAFE_FILE', 'unchanged')
    return stat
  }
  close() { if (this.descriptor >= 0) { closeSync(this.descriptor); this.descriptor = -1 } }
}
