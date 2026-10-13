import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { FilesystemAssetStore } from '../../src/infrastructure/node/filesystem/assetStore.ts'
import { Rooms } from '../../server/rooms.ts'

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-snapshot-contract-')), store = new SQLiteRoomStore(join(root, 'rooms.sqlite'))
  const assets = new FilesystemAssetStore(join(root, 'assets'), store.storageIdentity), rooms = new Rooms(store, assets), id = rooms.create().roomId
  t.after(() => { rooms.releaseRuntime(); assets.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const snapshot = store.snapshot.bind(store) as (destination: string, copy: () => unknown) => Promise<unknown>
  return { root, store, assets, id, snapshot }
}
test('snapshot rejects declared async copying before invocation and leaves source usable', async t => {
  const { root, store, id, snapshot } = fixture(t)
  let invoked = false
  await assert.rejects(snapshot(join(root, 'copy.sqlite'), async () => { invoked = true }), /ASYNC_SNAPSHOT/)
  assert.equal(invoked, false)
  assert.ok(store.load(id))
})
test('rejected snapshot continuations cannot mutate SQLite or filesystem after a subsequent legitimate transaction', async t => {
  const { root, store, assets, id, snapshot } = fixture(t)
  let resume!: () => void, late!: Promise<unknown[]>
  const gate = new Promise<void>(resolve => { resume = resolve })
  const bytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
  await assert.rejects(snapshot(join(root, 'copy.sqlite'), () => {
    late = gate.then(() => [() => store.delete(id), () => assets.prepare(randomUUID(), bytes, 'image/png'), () => assets.close()].map(work => {
      try { work(); return null } catch (error) { return error }
    }))
    return late
  }), /ASYNC_SNAPSHOT/)
  store.transaction(() => { const state = store.load(id)!; state.revision = 2; store.save(state) })
  const confirmed = store.records(), physical = assets.usageBytes()
  resume()
  for (const error of await late) assert.match(String(error), /ASYNC_SNAPSHOT/)
  assert.deepEqual(store.records(), confirmed); assert.equal(assets.usageBytes(), physical)
})
