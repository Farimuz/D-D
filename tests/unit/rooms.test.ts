import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { Rooms, RoomError, roomId } from '../../server/rooms.ts'
import { emptyBoard, MAX_CELL } from '../../src/state/model.ts'
import { MAX_FOG, MAX_PLAYERS, MAX_TOKENS, ROOM_PATTERN, shared, validAction, validActionMessage, validJoin, validShared } from '../../src/online/protocol.ts'
import type { Actor } from '../../server/rooms.ts'
import type { Action } from '../../src/online/protocol.ts'

function setup() {
  const rooms = new Rooms(), access = rooms.create(), room = rooms.get(access.roomId)
  const dm = rooms.join({ type: 'join', roomId: room.id, role: 'dm', credential: access.credential }).actor
  const aIdentity = randomBytes(32).toString('hex')
  const a = rooms.join({ type: 'join', roomId: room.id, role: 'player', identity: aIdentity, name: 'Carlos' }).actor
  const b = rooms.join({ type: 'join', roomId: room.id, role: 'player', identity: randomBytes(32).toString('hex'), name: 'Ana' }).actor
  const tokenId = rooms.apply(room, dm, { type: 'token.create', name: 'Arannis', x: -3, y: 2 }).tokenId!
  rooms.apply(room, dm, { type: 'token.update', id: tokenId, changes: { ownerId: a.id } })
  return { rooms, room, access, dm, a, b, tokenId, aIdentity }
}
const denied = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof RoomError && e.code === 'PERMISSION')

test('room IDs use a cryptographic generator, nonambiguous alphabet and independent DM credentials', () => {
  const ids = new Set(Array.from({ length: 2000 }, roomId))
  assert.equal(ids.size, 2000)
  assert.ok([...ids].every(i => ROOM_PATTERN.test(i)))
  const rooms = new Rooms(), first = rooms.create(), next = rooms.create()
  assert.notEqual(first.credential, next.credential)
  assert.equal(first.credential.length, 43)
  assert.equal(rooms.authenticateDM(rooms.get(first.roomId), first.credential), true)
  assert.equal(rooms.authenticateDM(rooms.get(first.roomId), next.credential), false)
  assert.equal(rooms.authenticateDM(rooms.get(first.roomId), 'wrong'), false)
})
test('join and action validators reject forged roles, authority fields, HTML, invalid coordinates and shapes', () => {
  const code = roomId(), join = { type: 'join', roomId: code, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' }
  assert.ok(validJoin(join))
  for (const bad of [{ ...join, dm: true }, { ...join, name: '<img>' }, { ...join, identity: 'short' }, { ...join, role: 'admin' }]) assert.equal(validJoin(bad), false)
  assert.ok(validAction({ type: 'token.update', id: 'known', changes: { x: -MAX_CELL, y: MAX_CELL } }))
  for (const bad of [
    { type: 'token.update', id: 'known', changes: { x: 1 } }, { type: 'token.update', id: 'known', changes: { x: Infinity, y: 0 } },
    { type: 'token.update', id: 'known', changes: { x: MAX_CELL + 1, y: 0 } }, { type: 'token.update', id: 'known', changes: { x: .5, y: 0 } },
    { type: 'token.update', id: 'known', changes: { id: 'other' } }, { type: 'token.create', id: 'chosen', name: 'N', x: 0, y: 0 },
    { type: 'board.reset', actor: { role: 'dm' } }, { type: 'token.create', name: '<script>', x: 0, y: 0 },
  ]) assert.equal(validAction(bad), false)
  assert.equal(validActionMessage({ type: 'action', requestId: '1', action: { type: 'board.reset' }, role: 'dm' }), false)
  assert.equal(validActionMessage({ type: 'action', requestId: '', action: { type: 'board.reset' } }), false)
})
test('only an assigned player can move a visible token; DM can move any token and owns all edits', () => {
  const { rooms, room, dm, a, b, tokenId } = setup()
  rooms.apply(room, a, { type: 'token.update', id: tokenId, changes: { x: -8, y: 3 } })
  const before = JSON.stringify(room.board)
  denied(() => rooms.apply(room, b, { type: 'token.update', id: tokenId, changes: { x: 50, y: 60 } }))
  for (const action of [{ type: 'token.delete', id: tokenId }, { type: 'board.reset' }, { type: 'fog.set', regions: [] }, { type: 'token.update', id: tokenId, changes: { ownerId: b.id } }, { type: 'token.update', id: tokenId, changes: { name: 'Robada' } }] as Action[]) denied(() => rooms.apply(room, a, action))
  assert.equal(JSON.stringify(room.board), before)
  rooms.apply(room, dm, { type: 'token.update', id: tokenId, changes: { x: 2, y: -4 } })
  assert.equal(room.board.tokens[0].x, 2)
})
test('player projection omits DM-only and fog-covered tokens and never contains private identities or views', () => {
  const { rooms, room, access, dm, a, aIdentity, tokenId } = setup()
  rooms.apply(room, dm, { type: 'token.create', name: 'Secreto', x: 10, y: 10, visible: false })
  rooms.apply(room, dm, { type: 'fog.set', regions: [{ id: 'draft', x: -200, y: 100, width: 100, height: 100 }] })
  const projection = rooms.snapshot(room, a)
  assert.equal(projection.board.tokens.length, 0)
  for (const hidden of ['Secreto', tokenId, access.credential, aIdentity, 'credentialHash', 'identityHash', 'camera', 'zoom']) assert.equal(JSON.stringify(projection).includes(hidden), false)
  assert.equal(rooms.snapshot(room, dm).board.tokens.length, 2)
  denied(() => rooms.apply(room, a, { type: 'token.update', id: tokenId, changes: { x: 0, y: 0 } }))
  rooms.apply(room, dm, { type: 'fog.set', regions: [] })
  assert.equal(rooms.snapshot(room, a).board.tokens[0].id, tokenId)
})
test('last valid move wins; rename does not overwrite concurrent position and revocation rejects stale ownership', () => {
  const { rooms, room, dm, a, b, tokenId } = setup()
  rooms.apply(room, dm, { type: 'token.update', id: tokenId, changes: { name: 'Renombrada' } })
  rooms.apply(room, a, { type: 'token.update', id: tokenId, changes: { x: 4, y: 5 } })
  assert.equal(room.board.tokens[0].name, 'Renombrada')
  rooms.apply(room, dm, { type: 'token.update', id: tokenId, changes: { x: -1, y: -2 } })
  assert.equal(room.board.tokens[0].x, -1)
  rooms.apply(room, dm, { type: 'token.update', id: tokenId, changes: { ownerId: b.id } })
  denied(() => rooms.apply(room, a, { type: 'token.update', id: tokenId, changes: { x: 90, y: 90 } }))
  assert.equal(room.board.tokens[0].x, -1)
})
test('reconnection reuses the participant and assignment; DM disconnection does not promote players', () => {
  const { rooms, room, access, dm, a, aIdentity, tokenId } = setup()
  rooms.leave(room, a)
  assert.equal(rooms.snapshot(room, dm).participants.find(p => p.id === a.id)!.connected, false)
  const resumed = rooms.join({ type: 'join', roomId: room.id, role: 'player', identity: aIdentity, name: 'Carlos' }).actor
  assert.equal(resumed.id, a.id)
  assert.equal(room.board.tokens.find(t => t.id === tokenId)!.ownerId, a.id)
  rooms.leave(room, dm)
  denied(() => rooms.apply(room, a, { type: 'board.reset' }))
  const restored = rooms.join({ type: 'join', roomId: room.id, role: 'dm', credential: access.credential }).actor
  assert.equal(restored.role, 'dm')
  assert.equal(rooms.snapshot(room, restored).participants.find(p => p.id === a.id)!.connected, true)
})
test('room limits bound players, tokens, fog and rooms while allowing a known participant to resume', () => {
  const rooms = new Rooms(), access = rooms.create(), room = rooms.get(access.roomId), dm: Actor = { role: 'dm', id: null }
  const identity = 'a'.repeat(64)
  for (let n = 0; n < MAX_PLAYERS; n++) rooms.join({ type: 'join', roomId: room.id, role: 'player', name: `Jugador ${n}`, identity: n ? randomBytes(32).toString('hex') : identity })
  assert.throws(() => rooms.join({ type: 'join', roomId: room.id, role: 'player', name: 'Otro', identity: randomBytes(32).toString('hex') }), /10 jugadores/)
  assert.ok(rooms.join({ type: 'join', roomId: room.id, role: 'player', name: 'Jugador 0', identity }).actor.id)
  for (let n = 0; n < MAX_TOKENS; n++) rooms.apply(room, dm, { type: 'token.create', name: `Ficha ${n}`, x: n, y: 0 })
  assert.throws(() => rooms.apply(room, dm, { type: 'token.create', name: 'Otra', x: 0, y: 0 }), /200 fichas/)
  assert.equal(validShared({ ...shared(emptyBoard()), fog: Array.from({ length: MAX_FOG + 1 }, () => ({ id: randomUUID(), x: 0, y: 0, width: 1, height: 1 })) }), false)
  for (let n = 1; n < 10; n++) rooms.create()
  assert.throws(() => rooms.create(), /10 salas/)
})
test('new rooms replace client IDs and clear foreign assignments while retaining local geometry and visibility', () => {
  const rooms = new Rooms(), initial = { ...shared(emptyBoard()), tokens: [{ id: 'chosen', name: 'Local', x: -10, y: 3, visible: false, ownerId: 'foreign' }], fog: [{ id: 'local-fog', x: -2, y: -4, width: 6, height: 8 }] }
  const room = rooms.get(rooms.create(initial).roomId)
  assert.notEqual(room.board.tokens[0].id, 'chosen')
  assert.deepEqual({ ...room.board.tokens[0], id: 'chosen' }, { ...initial.tokens[0], ownerId: null })
  assert.notEqual(room.board.fog[0].id, 'local-fog')
  assert.deepEqual({ ...room.board.fog[0], id: 'local-fog' }, initial.fog[0])
  assert.equal(initial.tokens[0].ownerId, 'foreign')
})
test('only completely idle rooms expire and stale map geometry cannot replace a newer asset', () => {
  const { rooms, room, dm } = setup()
  room.lastActive = 0
  rooms.sweep(31 * 60_000)
  assert.equal(rooms.get(room.id), room)
  room.board.map = { id: randomUUID(), x: 0, y: 0, width: 100, height: 80, scale: 1 }
  assert.throws(() => rooms.apply(room, dm, { type: 'map.update', map: { ...room.board.map!, id: randomUUID() } }), /mapa cambió/)
  for (const member of room.members.values()) { member.connected = false; member.connections = 0 }
  room.dmConnections = 0; room.lastActive = 0
  rooms.sweep(31 * 60_000)
  assert.throws(() => rooms.get(room.id), /ya no existe/)
})
