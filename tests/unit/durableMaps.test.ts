import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { FilesystemAssetStore } from '../../src/infrastructure/node/filesystem/assetStore.ts'
import { Rooms } from '../../server/rooms.ts'

const dm = { role: 'dm', id: null } as const
const bytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
const map = () => ({ id: randomUUID(), x: -80, y: 90, scale: 2, width: 857, height: 1081 })
function fixture(t: TestContext, fault: (point: string) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-map-')), path = join(root, 'rooms.sqlite'), assetPath = join(root, 'assets')
  const store = new SQLiteRoomStore(path, { fault }), assets = new FilesystemAssetStore(assetPath, store.storageIdentity, fault)
  const rooms = new Rooms(store, assets), room = rooms.get(rooms.create().roomId)
  t.after(() => { rooms.releaseRuntime(); assets.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  return { store, assets, rooms, room, path, assetPath }
}
function upload(rooms: Rooms, room: ReturnType<Rooms['get']>) { const metadata = map(); rooms.replaceMap(room, dm, metadata, { id: metadata.id, bytes, type: 'image/png' }); return metadata }

test('durable maps recover exact bytes, geometry and revision from new SQLite/filesystem/runtime objects', t => {
  const { store, assets, rooms, room, path, assetPath } = fixture(t), first = upload(rooms, room)
  const before = store.load(room.id)
  rooms.releaseRuntime(); assets.close(); store.close()
  const restoredStore = new SQLiteRoomStore(path), restoredAssets = new FilesystemAssetStore(assetPath, restoredStore.storageIdentity), restored = new Rooms(restoredStore, restoredAssets)
  try {
    restored.recoverAssets()
    const recovered = restored.get(room.id)
    assert.deepEqual(restoredStore.load(room.id), before); assert.deepEqual(recovered.board.map, first)
    assert.equal(recovered.revision, 1); assert.deepEqual(recovered.image!.bytes, bytes)
    assert.equal(recovered.image!.type, 'image/png')
  } finally { restored.releaseRuntime(); restoredAssets.close(); restoredStore.close() }
})

for (const point of ['asset.partialWrite', 'asset.sync', 'asset.publish', 'asset.prepared', 'sqlite.writeAsset', 'sqlite.writeState', 'sqlite.writePrivate', 'sqlite.commit']) {
  test(`durable map failure at ${point} preserves old reference/bytes/revision/access and recovers its orphan`, t => {
    let armed = false
    const { store, assets, rooms, room, assetPath } = fixture(t, p => { if (armed && p === point) { armed = false; throw Object.assign(new Error('Injected persistence failure'), { code: 'ENOSPC' }) } })
    const old = upload(rooms, room), before = store.records()
    armed = true; assert.throws(() => upload(rooms, room)); assert.equal(armed, false)
    assert.deepEqual(store.records(), before); assert.deepEqual(room.image!.bytes, bytes); assert.equal(room.board.map!.id, old.id)
    rooms.recoverAssets()
    assert.deepEqual(readdirSync(assetPath).sort(), ['assets-owner.json', old.id + '.asset'].sort())
    assert.deepEqual(assets.read(store.loadAsset(old.id)!), bytes)
    upload(rooms, room); assert.equal(room.revision, 2)
  })
}

for (const point of ['asset.cleanup', 'asset.delete']) {
  test(`durable post-commit ${point} failure retains confirmed new map and safely finishes later`, t => {
    let armed = false
    const { store, rooms, room, assetPath } = fixture(t, p => { if (armed && p === point) { armed = false; throw new Error('Cleanup denied') } })
    const old = upload(rooms, room)
    armed = true; const current = upload(rooms, room)
    assert.equal(armed, false); assert.ok(rooms.maintenanceError)
    assert.equal(room.revision, 2); assert.equal(room.board.map!.id, current.id); assert.deepEqual(room.image!.bytes, bytes)
    assert.ok(readdirSync(assetPath).includes(old.id + '.asset'))
    rooms.recoverAssets(); assert.equal(store.loadAsset(old.id), null)
    assert.deepEqual(readdirSync(assetPath).sort(), ['assets-owner.json', current.id + '.asset'].sort())
  })
}

test('durable cleanup preserves maps referenced by every room and explicit map deletion removes only unused assets', t => {
  const { rooms, room, store, assetPath } = fixture(t), first = upload(rooms, room), secondRoom = rooms.get(rooms.create().roomId), second = upload(rooms, secondRoom)
  rooms.apply(room, dm, { type: 'map.delete' })
  assert.equal(room.board.map, null); assert.equal(room.image, null); assert.equal(store.loadAsset(first.id), null)
  assert.deepEqual(secondRoom.image!.bytes, bytes); assert.ok(readdirSync(assetPath).includes(second.id + '.asset'))
  rooms.delete(secondRoom.id); assert.equal(store.loadAsset(second.id), null)
  assert.deepEqual(readdirSync(assetPath), ['assets-owner.json'])
})
