import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { Rooms } from '../../server/rooms.ts'

const dm = { role: 'dm', id: null } as const
function fixture(t: TestContext, fault: (point: string) => void = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'dnd-access-')), path = join(directory, 'rooms.sqlite')
  const store = new SQLiteRoomStore(path, { fault }), rooms = new Rooms(store)
  t.after(() => { rooms.releaseRuntime(); store.close(); rmSync(directory, { recursive: true, force: true }) })
  return { store, rooms, path }
}

test('durable runtime recovers DM hashes, original player IDs and assignments with zero initial presence', t => {
  const { rooms, store, path } = fixture(t), access = rooms.create(), room = rooms.get(access.roomId)
  const joinA = { type: 'join', roomId: room.id, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' } as const
  const a = rooms.join(joinA).actor
  const b = rooms.join({ ...joinA, identity: 'b'.repeat(64), name: 'Ana' }).actor
  rooms.join({ type: 'join', roomId: room.id, role: 'dm', credential: access.credential })
  const tokenId = rooms.apply(room, dm, { type: 'token.create', name: 'Arannis', x: 1, y: -2 }).tokenId!
  rooms.apply(room, dm, { type: 'token.update', id: tokenId, changes: { ownerId: a.id } })
  rooms.apply(room, a, { type: 'token.update', id: tokenId, changes: { x: 3, y: 4 } })
  rooms.apply(room, dm, { type: 'token.create', name: 'SECRET_TOKEN', x: 9, y: 9, visible: false })
  const before = store.load(room.id)!
  rooms.releaseRuntime(); store.close()
  const restoredStore = new SQLiteRoomStore(path), restored = new Rooms(restoredStore)
  try {
    const recovered = restored.get(room.id)
    assert.deepEqual(restoredStore.load(room.id), before)
    assert.equal(recovered.dmConnections, 0)
    assert.ok([...recovered.members.values()].every(member => !member.connected && member.connections === 0))
    assert.equal(restored.authenticateDM(recovered, access.credential), true)
    assert.equal(restored.authenticateDM(recovered, 'wrong'), false)
    assert.throws(() => restored.join({ type: 'join', roomId: room.id, role: 'dm', credential: 'wrong' }), /credencial/)
    const resumed = restored.join({ ...joinA, name: 'Renamed' }).actor
    assert.equal(resumed.id, a.id)
    const fresh = restored.join({ ...joinA, identity: 'c'.repeat(64), name: 'New player' }).actor
    assert.notEqual(fresh.id, a.id); assert.notEqual(fresh.id, b.id)
    assert.throws(() => restored.apply(recovered, fresh, { type: 'token.update', id: tokenId, changes: { x: 5, y: 6 } }), /asignada/)
    restored.apply(recovered, resumed, { type: 'token.update', id: tokenId, changes: { x: -5, y: 6 } })
    const projected = JSON.stringify(restored.snapshot(recovered, resumed))
    for (const secret of [access.credential, joinA.identity, 'SECRET_TOKEN', 'dmHash', 'identityHash', 'lastActive', 'storageVersion']) assert.equal(projected.includes(secret), false)
    assert.equal(restoredStore.loadAccess(room.id)!.dmHash.length, 64)
    assert.equal(JSON.stringify(restoredStore.records()).includes(access.credential), false)
  } finally { restored.releaseRuntime(); restoredStore.close() }
})

for (const point of ['sqlite.writeState', 'sqlite.writePrivate', 'sqlite.commit']) {
  test(`durable failed join at ${point} grants no identity/presence and retains all durable records`, t => {
    let armed = false
    const { rooms, store } = fixture(t, p => { if (armed && p === point) { armed = false; throw new Error('Injected join failure') } })
    const room = rooms.get(rooms.create().roomId), before = store.records(), activity = room.lastActive
    armed = true
    assert.throws(() => rooms.join({ type: 'join', roomId: room.id, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' }))
    assert.equal(armed, false); assert.equal(room.members.size, 0); assert.equal(room.lastActive, activity)
    assert.deepEqual(store.records(), before)
    assert.ok(rooms.join({ type: 'join', roomId: room.id, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' }).actor.id)
    assert.equal(store.load(room.id)!.participants.length, 1)
  })
}

test('durable identity changes serialize across independent coordinators without advancing board revision', t => {
  const { rooms, store, path } = fixture(t), access = rooms.create(), room = rooms.get(access.roomId)
  const otherStore = new SQLiteRoomStore(path), other = new Rooms(otherStore)
  try {
    const first = rooms.join({ type: 'join', roomId: room.id, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' }).actor
    const second = other.join({ type: 'join', roomId: room.id, role: 'player', identity: 'b'.repeat(64), name: 'Ana' }).actor
    const resumed = other.join({ type: 'join', roomId: room.id, role: 'player', identity: 'a'.repeat(64), name: 'Renamed' }).actor
    assert.equal(resumed.id, first.id); assert.notEqual(second.id, first.id)
    assert.deepEqual(store.load(room.id)!.participants, [{ id: first.id!, name: 'Renamed' }, { id: second.id!, name: 'Ana' }])
    assert.equal(store.load(room.id)!.revision, 0)
    assert.equal(store.loadAccess(room.id)!.identities.length, 2)
    assert.equal(store.records()[0].storageVersion, 4)
  } finally { other.releaseRuntime(); otherStore.close() }
})

test('durable inactivity evicts runtime only, releases capacity, and never removes saved rooms', t => {
  const { rooms, store } = fixture(t), ids: string[] = []
  for (let n = 0; n < 10; n++) { const access = rooms.create(); ids.push(access.roomId); rooms.get(access.roomId).lastActive = 0 }
  rooms.sweep(31 * 60_000)
  assert.equal(rooms.rooms.size, 0); assert.equal(store.records().length, 10)
  assert.equal(rooms.get(ids[0]).dmConnections, 0)
  rooms.releaseRuntime(); assert.equal(store.records().length, 10)
  const next = rooms.create(); assert.equal(store.records().length, 11)
  rooms.delete(next.roomId); assert.equal(store.records().length, 10)
})
