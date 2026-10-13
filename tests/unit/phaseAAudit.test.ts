import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAction, createRoomState, projectRoom, registerParticipant, replaceMap, RoomError } from '../../src/core/room/domain.ts'
import { shared } from '../../src/core/room/validation.ts'
import { emptyBoard } from '../../src/state/model.ts'
import type { Actor, Action, RoomState } from '../../src/core/room/types.ts'
import { MemoryRoomStore } from '../../src/infrastructure/memory/roomStore.ts'
import { Rooms } from '../../server/rooms.ts'

const dm: Actor = { role: 'dm', id: null }, a: Actor = { role: 'player', id: 'a' }
function scenario() {
  let n = 0
  const identity = () => `audit-${++n}`
  let state = createRoomState('audit-room', shared(emptyBoard()), identity)
  for (const id of ['a', 'b']) state = registerParticipant(state, { id, name: id.toUpperCase() })
  return { state, identity }
}

test('audit: projections whitelist wire fields at every nesting level', () => {
  const { identity, state: initial } = scenario()
  let state = applyAction(initial, dm, { type: 'token.create', name: 'Public', x: 0, y: 0 }, identity).state
  state = replaceMap(state, dm, { id: 'map', x: 0, y: 0, width: 10, height: 10, scale: 1 })
  state = applyAction(state, dm, { type: 'fog.set', regions: [{ id: 'draft', x: 640, y: 640, width: 64, height: 64 }] }, identity).state
  const privateFields = { credentialHash: 'AUDIT_PRIVATE_HASH', identity: 'AUDIT_PRIVATE_ID', storeHandle: { value: 'AUDIT_PRIVATE_STORE' } }
  for (const record of [state, state.board, state.board.tokens[0], state.board.map!, state.board.fog[0], state.participants[0]]) Object.assign(record, privateFields)
  for (const actor of [dm, a]) {
    const view = projectRoom(state, actor, { connectedIds: new Set(['a']), dmConnected: true })
    assert.equal(JSON.stringify(view).includes('AUDIT_PRIVATE'), false)
    assert.deepEqual(Object.keys(view.board).sort(), ['fog', 'map', 'tokens', 'version'])
    assert.deepEqual(Object.keys(view.board.tokens[0]).sort(), ['id', 'name', 'ownerId', 'visible', 'x', 'y'])
    assert.deepEqual(Object.keys(view.board.map!).sort(), ['height', 'id', 'scale', 'width', 'x', 'y'])
    assert.deepEqual(Object.keys(view.board.fog[0]).sort(), ['height', 'id', 'width', 'x', 'y'])
    if (actor.role === 'dm') assert.deepEqual(Object.keys(view.participants[0]).sort(), ['connected', 'id', 'name'])
  }
})

test('audit: ownership never overrides the complete public/Solo DM/fog projection matrix', () => {
  const { identity, state: initial } = scenario()
  let state = initial
  const expected: string[] = [], allowedMoves: string[] = [], fog = []
  for (const ownerId of [null, 'a', 'b']) for (const visible of [true, false]) for (const covered of [false, true]) {
    const x = state.board.tokens.length * 2
    const created = applyAction(state, dm, { type: 'token.create', name: `Token ${x}`, x, y: 0, visible }, identity)
    state = applyAction(created.state, dm, { type: 'token.update', id: created.tokenId!, changes: { ownerId } }, identity).state
    if (covered) fog.push({ id: `draft-${x}`, x: x * 64, y: 0, width: 64, height: 64 })
    if (visible && !covered) { expected.push(created.tokenId!); if (ownerId === 'a') allowedMoves.push(created.tokenId!) }
  }
  state = applyAction(state, dm, { type: 'fog.set', regions: fog }, identity).state
  const presence = { connectedIds: new Set(['a', 'b']), dmConnected: true }
  assert.deepEqual(projectRoom(state, a, presence).board.tokens.map(t => t.id), expected)
  assert.equal(projectRoom(state, dm, presence).board.tokens.length, 12)
  for (const token of state.board.tokens) {
    const before = JSON.stringify(state)
    const move: Action = { type: 'token.update', id: token.id, changes: { x: token.x, y: token.y } }
    if (allowedMoves.includes(token.id)) assert.equal(applyAction(state, a, move, identity).state.revision, state.revision + 1)
    else assert.throws(() => applyAction(state, a, move, identity), (e: unknown) => e instanceof RoomError && e.code === 'PERMISSION')
    assert.equal(JSON.stringify(state), before)
  }
})

test('audit: every mutation survives a detached JSON store and fails atomically on load or save', () => {
  class FaultStore extends MemoryRoomStore {
    fault: 'load' | 'save' | null = null
    override load(id: string) { if (this.fault === 'load') throw new Error('Load failure'); return super.load(id) }
    override save(state: RoomState): undefined { if (this.fault === 'save') throw new Error('Save failure'); super.save(state) }
  }
  const store = new FaultStore(), rooms = new Rooms(store), access = rooms.create(), room = rooms.get(access.roomId)
  rooms.join({ type: 'join', roomId: room.id, role: 'player', name: 'A', identity: 'a'.repeat(64) })
  const tokenId = rooms.apply(room, dm, { type: 'token.create', name: 'Public', x: 0, y: 0 }).tokenId!
  const map = { id: 'map', x: 0, y: 0, width: 10, height: 10, scale: 1 }
  const image = { id: map.id, bytes: Buffer.from('fixture'), type: 'image/png' }
  rooms.replaceMap(room, dm, map, image)
  const actions: Action[] = [
    { type: 'token.create', name: 'Another', x: 1, y: 0 }, { type: 'token.update', id: tokenId, changes: { name: 'Renamed' } },
    { type: 'token.delete', id: tokenId }, { type: 'fog.set', regions: [{ id: 'draft', x: 0, y: 0, width: 64, height: 64 }] },
    { type: 'map.update', map: { ...map, x: 64 } }, { type: 'map.delete' }, { type: 'board.reset' },
  ]
  for (const fault of ['load', 'save'] as const) for (const action of actions) {
    const before = store.load(room.id), activity = room.lastActive
    store.fault = fault
    assert.throws(() => rooms.apply(room, dm, action), /failure/)
    store.fault = null
    assert.deepEqual(store.load(room.id), before); assert.equal(room.image, image); assert.equal(room.lastActive, activity)
  }
})

test('audit: revision counts accepted commands, including no-ops; membership and presence do not advance it', () => {
  const store = new MemoryRoomStore(), rooms = new Rooms(store), access = rooms.create(), room = rooms.get(access.roomId)
  const dmActor = rooms.join({ type: 'join', roomId: room.id, role: 'dm', credential: access.credential }).actor
  const playerJoin = { type: 'join', roomId: room.id, role: 'player', identity: 'a'.repeat(64), name: 'A' } as const
  const player = rooms.join(playerJoin).actor
  rooms.leave(room, player); rooms.join({ ...playerJoin, name: 'Renamed' }); rooms.leave(room, dmActor)
  assert.equal(room.revision, 0)
  rooms.apply(room, dm, { type: 'map.delete' }); assert.equal(room.revision, 1)
  rooms.apply(room, dm, { type: 'fog.set', regions: [] }); assert.equal(room.revision, 2)
  rooms.apply(room, dm, { type: 'board.reset' }); assert.equal(room.revision, 3)
  const id = rooms.apply(room, dm, { type: 'token.create', name: 'T', x: 0, y: 0 }).tokenId!
  rooms.apply(room, dm, { type: 'token.update', id, changes: { x: 0, y: 0 } }); assert.equal(room.revision, 5)
  assert.throws(() => rooms.apply(room, player, { type: 'token.delete', id }), /Solo el DM/)
  assert.equal(room.revision, 5)
})

test('audit: stale independent writes expose absent CAS while Node orders current actions without lost fields', () => {
  const { identity, state: initial } = scenario(), store = new MemoryRoomStore()
  const state = applyAction(initial, dm, { type: 'token.create', name: 'T', x: 0, y: 0 }, identity).state
  store.save(state)
  const first = store.load(state.id)!, second = store.load(state.id)!
  store.save(applyAction(first, dm, { type: 'token.update', id: state.board.tokens[0].id, changes: { name: 'First writer' } }, identity).state)
  store.save(applyAction(second, dm, { type: 'token.update', id: state.board.tokens[0].id, changes: { x: 4, y: 4 } }, identity).state)
  assert.equal(store.load(state.id)!.board.tokens[0].name, 'T') // Contract does not claim compare-and-swap.
  assert.equal(store.load(state.id)!.revision, state.revision + 1)
  const rooms = new Rooms(), room = rooms.get(rooms.create().roomId)
  const id = rooms.apply(room, dm, { type: 'token.create', name: 'T', x: 0, y: 0 }).tokenId!
  rooms.apply(room, dm, { type: 'token.update', id, changes: { name: 'First writer' } })
  rooms.apply(room, dm, { type: 'token.update', id, changes: { x: 4, y: 4 } })
  assert.equal(room.board.tokens[0].name, 'First writer'); assert.equal(room.revision, 3)
})

test('audit: committing then throwing violates the atomic store contract and cannot be called a rollback', () => {
  class NonconformingStore extends MemoryRoomStore {
    failAfterCommit = false
    override save(state: RoomState): undefined { super.save(state); if (this.failAfterCommit) throw new Error('Failure after commit') }
  }
  const store = new NonconformingStore(), rooms = new Rooms(store), room = rooms.get(rooms.create().roomId)
  store.failAfterCommit = true
  assert.throws(() => rooms.apply(room, dm, { type: 'token.create', name: 'T', x: 0, y: 0 }), /after commit/)
  assert.equal(store.load(room.id)!.revision, 1)
  assert.equal(store.load(room.id)!.board.tokens.length, 1) // Counterexample, not a passing atomicity guarantee.
})
