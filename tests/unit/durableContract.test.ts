import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('durable transaction types reject Promise callbacks and unions without weakening the neutral core', () => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-durable-types-'))
  try {
    const base = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/')
    writeFileSync(join(root, 'probe.ts'), `import type { DurableRoomStore } from '${base}src/infrastructure/node/persistence.ts'
import type { SQLiteRoomStore } from '${base}src/infrastructure/node/sqlite/roomStore.ts'
declare const store: DurableRoomStore
declare const sqlite: SQLiteRoomStore
const result: number = store.transaction(() => 42)
sqlite.transaction(() => ({ result }))
// @ts-expect-error Async callbacks are forbidden.
store.transaction(async () => 42)
// @ts-expect-error Ordinary Promise callbacks are also forbidden.
sqlite.transaction(() => Promise.resolve(42))
// @ts-expect-error A union that might return a Promise is forbidden.
store.transaction(() => Math.random() ? 42 : Promise.resolve(42))
// @ts-expect-error Snapshot copying must also remain synchronous.
sqlite.snapshot('copy.sqlite', async () => 42)
// @ts-expect-error Ordinary Promise snapshot callbacks are forbidden.
sqlite.snapshot('copy.sqlite', () => Promise.resolve(42))
`)
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', allowImportingTsExtensions: true,
      strict: true, noEmit: true, types: ['node'], typeRoots: [base + 'node_modules/@types'], skipLibCheck: true,
    }, files: [join(root, 'probe.ts')] }))
    const result = spawnSync(process.execPath, [base + 'node_modules/typescript/bin/tsc', '-p', join(root, 'tsconfig.json')], { encoding: 'utf8', timeout: 20_000, windowsHide: true })
    assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error ?? ''))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
