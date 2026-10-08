import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FilesystemAssetStore } from '../../src/infrastructure/node/filesystem/assetStore.ts'

const bytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
function fixture(t: TestContext, fault: (point: string) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-assets-')), path = join(root, 'assets'), identity = randomUUID()
  const assets = new FilesystemAssetStore(path, identity, fault)
  t.after(() => { assets.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, path, identity, assets }
}

test('filesystem preserves exact binary bytes and metadata across new instances', t => {
  const { assets, path, identity } = fixture(t), metadata = assets.prepare(randomUUID(), bytes, 'image/png')
  assert.equal(metadata.byteLength, bytes.length); assert.equal(metadata.width, 857); assert.equal(metadata.height, 1081)
  assert.deepEqual(assets.read(metadata), bytes)
  const loaded = assets.read(metadata); loaded[0] = 0; assert.deepEqual(assets.read(metadata), bytes)
  assets.close()
  const reopened = new FilesystemAssetStore(path, identity)
  try { assert.deepEqual(reopened.read(metadata), bytes); assert.deepEqual(reopened.recover(new Map([[metadata.id, metadata]])).removed, []) } finally { reopened.close() }
})

for (const point of ['asset.beforePrepare', 'asset.open', 'asset.partialWrite', 'asset.sync', 'asset.publish', 'asset.prepared']) {
  test(`filesystem ${point} failure retains previous map and recovery removes only its orphan`, t => {
    let armed = false
    const { assets } = fixture(t, p => { if (armed && p === point) { armed = false; throw Object.assign(new Error('Injected file failure'), { code: point === 'asset.partialWrite' ? 'ENOSPC' : 'EACCES' }) } })
    const active = assets.prepare(randomUUID(), bytes, 'image/png')
    armed = true
    assert.throws(() => assets.prepare(randomUUID(), bytes, 'image/png'), /Injected/)
    assert.equal(armed, false); assert.deepEqual(assets.read(active), bytes)
    const refs = new Map([[active.id, active]])
    assets.recover(refs); assert.deepEqual(assets.recover(refs).removed, [])
    assert.deepEqual(assets.read(active), bytes)
  })
}

test('filesystem IDs reject traversal and platform paths without writing outside managed storage', t => {
  const { assets, root, path } = fixture(t)
  const foreign = join(root, 'valuable.txt'); writeFileSync(foreign, 'unchanged')
  for (const id of ['../valuable.txt', '..%2Fvaluable.txt', 'C:\\secret', '\\\\server\\share', randomUUID() + '.', 'not-an-id']) assert.throws(() => assets.prepare(id, bytes, 'image/png'), /ASSET_ID/)
  assert.equal(readFileSync(foreign, 'utf8'), 'unchanged'); assert.deepEqual(readdirSync(path), ['assets-owner.json'])
})

test('filesystem exclusive publication refuses ID collisions and preserves existing bytes', t => {
  const { assets } = fixture(t), id = randomUUID(), active = assets.prepare(id, bytes, 'image/png')
  assert.throws(() => assets.prepare(id, bytes, 'image/png'), (e: unknown) => (e as NodeJS.ErrnoException).code === 'EEXIST')
  assert.deepEqual(assets.read(active), bytes)
})

test('filesystem refuses directories owned by another database and refuses claiming foreign files', t => {
  const { root, path } = fixture(t)
  assert.throws(() => new FilesystemAssetStore(path, randomUUID()), /ASSET_DIRECTORY_OWNER/)
  const foreign = join(root, 'foreign'); mkdirSync(foreign); writeFileSync(join(foreign, 'valuable.txt'), 'keep')
  assert.throws(() => new FilesystemAssetStore(foreign, randomUUID()), /ASSET_DIRECTORY_NOT_EMPTY/)
  assert.equal(readFileSync(join(foreign, 'valuable.txt'), 'utf8'), 'keep')
})

test('filesystem detects a symlink/junction directory before initialization and after a race replacement', t => {
  const { root, path, assets } = fixture(t), foreign = join(root, 'foreign'), alias = join(root, 'alias')
  mkdirSync(foreign); writeFileSync(join(foreign, 'valuable.txt'), 'keep')
  symlinkSync(foreign, alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => new FilesystemAssetStore(alias, randomUUID()), /PATH/)
  const original = join(root, 'original'); renameSync(path, original)
  symlinkSync(foreign, path, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => assets.prepare(randomUUID(), bytes, 'image/png'), /PATH_CHANGED/)
  assert.deepEqual(readdirSync(foreign), ['valuable.txt']); assert.equal(readFileSync(join(foreign, 'valuable.txt'), 'utf8'), 'keep')
})

test('filesystem refuses external hard links instead of reading or deleting their target', t => {
  const { root, path, assets } = fixture(t), active = assets.prepare(randomUUID(), bytes, 'image/png')
  const foreign = join(root, 'valuable.png'); writeFileSync(foreign, bytes)
  const target = join(path, active.id + '.asset'); unlinkSync(target); linkSync(foreign, target)
  assert.throws(() => assets.read(active), /UNSAFE_FILE/)
  assert.throws(() => assets.delete(active.id), /UNSAFE_FILE/)
  assert.throws(() => assets.recover(new Map()), /UNSAFE_FILE/)
  assert.deepEqual(readFileSync(foreign), bytes)
})

test('filesystem directory-open failure is reproducible and leaves foreign files unchanged', t => {
  const { root } = fixture(t), path = join(root, 'new-assets')
  assert.throws(() => new FilesystemAssetStore(path, randomUUID(), p => { if (p === 'directory.open') throw Object.assign(new Error('Directory denied'), { code: 'EACCES' }) }), /Directory denied/)
  assert.equal(readdirSync(root).includes('new-assets'), false)
})

test('filesystem corruption and missing references stop cleanup before deleting any orphan', t => {
  const { assets, path } = fixture(t), active = assets.prepare(randomUUID(), bytes, 'image/png'), orphan = assets.prepare(randomUUID(), bytes, 'image/png')
  const bad = Buffer.from(bytes); bad[bad.length - 1] ^= 1
  writeFileSync(join(path, active.id + '.asset'), bad)
  assert.throws(() => assets.recover(new Map([[active.id, active]])), /CORRUPT_ASSET/)
  assert.ok(readdirSync(path).includes(orphan.id + '.asset'))
  unlinkSync(join(path, active.id + '.asset'))
  assert.throws(() => assets.recover(new Map([[active.id, active]])))
  assert.ok(readdirSync(path).includes(orphan.id + '.asset'))
})

test('filesystem cleanup recovers an interrupted hard-link pair, preserves unknown files, and is idempotent', t => {
  const { assets, path } = fixture(t), id = randomUUID()
  const temporary = join(path, id + '.tmp'), stable = join(path, id + '.asset')
  writeFileSync(temporary, bytes); linkSync(temporary, stable); writeFileSync(join(path, 'notes.txt'), 'keep')
  const report = assets.recover(new Map())
  assert.deepEqual(report.removed.sort(), [id + '.asset', id + '.tmp'].sort()); assert.deepEqual(report.unknown, ['notes.txt'])
  assert.deepEqual(assets.recover(new Map()).removed, []); assert.equal(readFileSync(join(path, 'notes.txt'), 'utf8'), 'keep')
})

for (const point of ['asset.delete', 'asset.cleanup']) {
  test(`filesystem ${point} failure is safely repeatable and retains all referenced bytes`, t => {
    let armed = false
    const { assets } = fixture(t, p => { if (armed && p === point) { armed = false; throw new Error('Cleanup denied') } })
    const active = assets.prepare(randomUUID(), bytes, 'image/png'); assets.prepare(randomUUID(), bytes, 'image/png')
    const refs = new Map([[active.id, active]])
    armed = true; assert.throws(() => assets.recover(refs), /Cleanup denied/)
    assert.deepEqual(assets.read(active), bytes); assets.recover(refs); assert.deepEqual(assets.recover(refs).removed, [])
  })
}
