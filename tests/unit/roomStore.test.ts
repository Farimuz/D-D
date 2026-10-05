import test from 'node:test'
import assert from 'node:assert/strict'
import { Rooms } from '../../server/rooms.ts'
import type { RoomStore } from '../../src/core/room/store.ts'
import type { Actor, RoomState } from '../../src/core/room/types.ts'
import { FailingRoomStore } from '../fixtures/failing-room-store.ts'

const dm: Actor = { role: 'dm', id: null }
test('Node actions and projections use an injected JSON store as their sole authoritative state', () => {
  const records = new Map<string, string>()
  const store: RoomStore = {
    load: id => records.has(id) ? JSON.parse(records.get(id)!) as RoomState : null,
    save: state => { records.set(state.id, JSON.stringify(state)) }, delete: id => { records.delete(id) },
  }
  const rooms = new Rooms(store), access = rooms.create(), room = rooms.get(access.roomId)
  const id = rooms.apply(room, dm, { type: 'token.create', name: 'Arannis', x: 0, y: 0 }).tokenId!
  const restored = store.load(room.id)!
  restored.board.tokens[0].x = 20; restored.revision = 40
  store.save(restored)
  assert.equal(rooms.snapshot(room, dm).board.tokens[0].x, 20)
  rooms.apply(room, dm, { type: 'token.update', id, changes: { name: 'Renombrada' } })
  assert.equal(room.board.tokens[0].x, 20); assert.equal(room.revision, 41)
  const detached = room.board; detached.tokens[0].x = 99
  assert.equal(room.board.tokens[0].x, 20)
  rooms.delete(room.id); assert.equal(records.size, 0)
})

test('failed saves preserve actions, map bytes, revisions, activity and participant connection authority', () => {
  const store = new FailingRoomStore(), rooms = new Rooms(store), room = rooms.get(rooms.create().roomId)
  const identity = 'a'.repeat(64)
  const actor = rooms.join({ type: 'join', roomId: room.id, role: 'player', identity, name: 'Carlos' }).actor
  const map = { id: 'map', x: 0, y: 0, width: 10, height: 20, scale: 1 }, image = { id: map.id, bytes: Buffer.from('old bytes'), type: 'image/png' }
  rooms.replaceMap(room, dm, map, image)
  const before = store.load(room.id), lastActive = room.lastActive
  for (const action of [{ type: 'token.create', name: 'Otra', x: 0, y: 0 }, { type: 'map.delete' }, { type: 'board.reset' }] as const) {
    store.failNextSave = true
    assert.throws(() => rooms.apply(room, dm, action), /Injected storage/)
    assert.deepEqual(store.load(room.id), before); assert.equal(room.image, image); assert.equal(room.lastActive, lastActive)
  }
  store.failNextSave = true
  assert.throws(() => rooms.replaceMap(room, dm, { ...map, id: 'replacement' }, { ...image, id: 'replacement', bytes: Buffer.from('new bytes') }), /Injected storage/)
  assert.deepEqual(store.load(room.id), before); assert.equal(room.image, image)
  for (const join of [{ identity, name: 'Renombrado' }, { identity: 'b'.repeat(64), name: 'Ana' }]) {
    store.failNextSave = true
    assert.throws(() => rooms.join({ type: 'join', roomId: room.id, role: 'player', ...join }), /Injected storage/)
    assert.deepEqual(store.load(room.id), before); assert.equal(room.members.size, 1); assert.equal(room.members.get(actor.id!)!.connections, 1)
  }
  assert.equal(room.lastActive, lastActive)
  rooms.apply(room, dm, { type: 'map.delete' })
  assert.equal(room.image, null); assert.equal(room.revision, before!.revision + 1)
})

test('failed creation grants no runtime authority; expiry deletes state and shutdown only releases runtime', () => {
  const store = new FailingRoomStore(), rooms = new Rooms(store)
  store.failNextSave = true
  assert.throws(() => rooms.create(), /Injected storage/); assert.equal(rooms.rooms.size, 0)
  const room = rooms.get(rooms.create().roomId)
  room.lastActive = 0
  rooms.sweep(31 * 60_000)
  assert.equal(store.load(room.id), null); assert.equal(rooms.rooms.size, 0)
  const next = rooms.create(), runtime = rooms.get(next.roomId), before = store.load(next.roomId)
  rooms.releaseRuntime()
  assert.deepEqual(store.load(next.roomId), before); assert.equal(rooms.rooms.size, 0)
  assert.throws(() => rooms.apply(runtime, dm, { type: 'board.reset' }), /activa/)
  rooms.delete(next.roomId); assert.equal(store.load(next.roomId), null)
})

test('connection caps remain in Node without changing stored names or granting extra authority', () => {
  const rooms = new Rooms(), access = rooms.create(), room = rooms.get(access.roomId)
  const join = { type: 'join', roomId: room.id, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' } as const
  for (let i = 0; i < 4; i++) rooms.join(join)
  assert.throws(() => rooms.join({ ...join, name: 'Rejected name' }), /cuatro conexiones/)
  assert.equal(rooms.snapshot(room, dm).participants[0].name, 'Carlos')
  const dmJoin = { type: 'join', roomId: room.id, role: 'dm', credential: access.credential } as const
  for (let i = 0; i < 4; i++) rooms.join(dmJoin)
  assert.throws(() => rooms.join(dmJoin), /cuatro conexiones/)
  assert.equal(room.dmConnections, 4)
  rooms.leave(room, dm); assert.equal(rooms.join(dmJoin).actor.role, 'dm'); assert.equal(room.dmConnections, 4)
})
