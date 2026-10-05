import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

test('audit: the entire core import closure has no provider, browser, network or clock dependencies', async () => {
  const root = fileURLToPath(new URL('../../src/', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'dnd-core-audit-'))
  try {
    const config = join(directory, 'tsconfig.json')
    await writeFile(config, JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', allowImportingTsExtensions: true, strict: true, noEmit: true,
      lib: ['ES2022'], types: [] },
      files: ['domain', 'types', 'store', 'validation'].map(name => resolve(root, 'core/room', name + '.ts')) }))
    // Use the installed compiler CLI: no Node/DOM types, including every transitive file.
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)),
      '--project', config, '--listFiles'], { encoding: 'utf8', timeout: 20_000, windowsHide: true })
    assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error ?? ''))
    const visited = new Set<string>()
    for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
      if (/[\\/]node_modules[\\/](?:typescript|@typescript[\\/]typescript-[^\\/]+)[\\/]lib[\\/]lib\..*\.d\.ts$/.test(line)) continue
      const path = resolve(line)
      assert.ok(path.startsWith(root), `Nonportable dependency: ${path}`)
      visited.add(path)
      const source = await readFile(path, 'utf8')
      assert.doesNotMatch(source, /\b(?:Date|crypto|setTimeout|clearTimeout|setInterval|clearInterval)\b/, `${path}: clock/runtime access`)
      assert.doesNotMatch(source, /\bimport\s*\(/, `${path}: dynamic runtime import`)
    }
    for (const path of ['map/fog.ts', 'state/validation.ts', 'map/geometry.ts']) assert.ok(visited.has(resolve(root, path)))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
