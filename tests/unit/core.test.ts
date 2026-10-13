import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { applyAction, createRoomState, projectRoom, registerParticipant, replaceMap, RoomError } from '../../src/core/room/domain.ts'
import { MAX_FOG, MAX_PLAYERS, MAX_TOKENS } from '../../src/core/room/types.ts'
import type { Actor, RoomState } from '../../src/core/room/types.ts'
import { shared, validShared } from '../../src/core/room/validation.ts'
import { emptyBoard, MAX_CELL } from '../../src/state/model.ts'
import { MAX_IMAGE_PIXELS } from '../../src/map/limits.ts'
import { MemoryRoomStore } from '../../src/infrastructure/memory/roomStore.ts'
import type { runMemoryScenario } from '../fixtures/portable-room.ts'

const dm: Actor = { role: 'dm', id: null }, a: Actor = { role: 'player', id: 'a' }, b: Actor = { role: 'player', id: 'b' }
const presence = { connectedIds: new Set(['a']), dmConnected: true }
function setup() {
  let sequence = 0
  const identity = () => `entity-${++sequence}`
  let state = createRoomState('room', shared(emptyBoard()), identity)
  state = registerParticipant(state, { id: 'a', name: 'Carlos' })
  state = registerParticipant(state, { id: 'b', name: 'Ana' })
  const created = applyAction(state, dm, { type: 'token.create', name: 'Arannis', x: 0, y: 0 }, identity)
  state = applyAction(created.state, dm, { type: 'token.update', id: created.tokenId!, changes: { ownerId: 'a' } }, identity).state
  return { state, identity, tokenId: created.tokenId! }
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(frozen) }
  return value
}
function rejected(state: RoomState, actor: Actor, action: unknown, identity: () => string, code: string) {
  const before = JSON.stringify(state)
  assert.throws(() => applyAction(frozen(state), actor, action, identity), (e: unknown) => e instanceof RoomError && e.code === code)
  assert.equal(JSON.stringify(state), before)
}

test('portable DM + A + B scenario executes without Node, browser, sockets or clock globals', async () => {
  const built = await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'portable-dependencies',
    resolveId(source, importer) { if (importer && !source.startsWith('.')) throw new Error(`Nonportable dependency: ${source}`) },
  }], build: { write: false, minify: false, target: 'es2022',
    lib: { entry: fileURLToPath(new URL('../fixtures/portable-room.ts', import.meta.url)), name: 'PortableRoom', formats: ['iife'] } } })
  const output = Array.isArray(built) ? built[0] : built
  assert.ok('output' in output)
  const chunk = output.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const result = runInNewContext(chunk.code + '\nPortableRoom.runMemoryScenario()', {
    process: undefined, require: undefined, Buffer: undefined, WebSocket: undefined, window: undefined,
    document: undefined, Image: undefined, fetch: undefined, crypto: undefined, Date: undefined,
    setTimeout: undefined, setInterval: undefined, localStorage: undefined,
  }, { timeout: 1000 }) as ReturnType<typeof runMemoryScenario>
  assert.equal(result.rejection, 'PERMISSION')
  assert.equal(result.revision, 5)
  assert.equal(result.position.x, 2); assert.equal(result.position.y, -1)
  assert.equal(result.player.board.tokens.length, 0); assert.equal(result.player.participants.length, 0)
  assert.equal(result.dmView.board.tokens.length, 2); assert.equal(result.dmView.participants.length, 2)
  assert.equal(result.sameProjection, true)
})

test('creation replaces imported identities and assignments without mutating local data', () => {
  const initial = frozen({ ...shared(emptyBoard()), tokens: [{ id: 'client', name: 'Local', x: 1, y: -2, ownerId: 'foreign', visible: false }],
    fog: [{ id: 'client-fog', x: 0, y: 0, width: 64, height: 64 }], map: { id: 'local-map', x: 0, y: 0, width: 1, height: 1, scale: 1 } })
  let n = 0
  const state = createRoomState('room', initial, () => `fresh-${++n}`)
  assert.equal(state.revision, 0); assert.equal(state.board.map, null)
  assert.deepEqual(state.board.tokens[0], { ...initial.tokens[0], id: 'fresh-1', ownerId: null })
  assert.equal(state.board.fog[0].id, 'fresh-2'); assert.equal(initial.tokens[0].ownerId, 'foreign')
})

test('only assigned visible players move; every other edit is DM-only and rejection is immutable', () => {
  const { state, identity, tokenId } = setup()
  const next = applyAction(frozen(state), a, { type: 'token.update', id: tokenId, changes: { x: 4, y: -3 } }, identity).state
  assert.equal(next.revision, state.revision + 1); assert.equal(next.board.tokens[0].x, 4); assert.equal(state.board.tokens[0].x, 0)
  rejected(next, b, { type: 'token.update', id: tokenId, changes: { x: 8, y: 8 } }, identity, 'PERMISSION')
  for (const action of [
    { type: 'token.create', name: 'Otra', x: 0, y: 0 }, { type: 'token.delete', id: tokenId },
    { type: 'token.update', id: tokenId, changes: { name: 'Otra' } }, { type: 'token.update', id: tokenId, changes: { visible: false } },
    { type: 'token.update', id: tokenId, changes: { ownerId: 'b' } }, { type: 'fog.set', regions: [] }, { type: 'map.delete' }, { type: 'board.reset' },
    { type: 'map.update', map: { id: 'map', x: 0, y: 0, width: 1, height: 1, scale: 1 } },
  ]) rejected(next, a, action, identity, 'PERMISSION')
  rejected(next, { role: 'player', id: 'unknown' }, { type: 'token.update', id: tokenId, changes: { x: 0, y: 0 } }, identity, 'PERMISSION')
})

test('invalid actions and missing references preserve board, participants and revision', () => {
  const { state, identity, tokenId } = setup()
  for (const action of [
    { type: 'token.update', id: tokenId, changes: { x: 1 } }, { type: 'token.update', id: tokenId, changes: { x: Infinity, y: 0 } },
    { type: 'token.create', name: '<script>', x: 0, y: 0 }, { type: 'token.create', name: 'Fuera', x: MAX_CELL + 1, y: 0 },
    { type: 'board.reset', role: 'dm' }, { type: 'token.update', id: tokenId, changes: { id: 'spoofed' } },
  ]) rejected(state, dm, action, identity, 'INVALID_MESSAGE')
  rejected(state, dm, { type: 'token.delete', id: 'missing' }, identity, 'TOKEN_NOT_FOUND')
  rejected(state, dm, { type: 'token.update', id: 'missing', changes: { name: 'Otra' } }, identity, 'TOKEN_NOT_FOUND')
  rejected(state, dm, { type: 'token.update', id: tokenId, changes: { ownerId: 'foreign' } }, identity, 'PARTICIPANT_NOT_FOUND')
})

test('DM projection contains all tokens and presence; players never see Solo DM, covered tokens or participant names', () => {
  const { identity, tokenId, state: initial } = setup()
  let state = applyAction(initial, dm, { type: 'token.create', name: 'Secreto', x: 3, y: 3, visible: false }, identity).state
  state = applyAction(state, dm, { type: 'fog.set', regions: [{ id: 'draft', x: 0, y: 0, width: 64, height: 64 }] }, identity).state
  const view = projectRoom(frozen(state), a, presence), dmView = projectRoom(state, dm, presence)
  assert.deepEqual(view.board.tokens, []); assert.deepEqual(view.participants, [])
  assert.equal(view.dmConnected, true); assert.equal(dmView.board.tokens.length, 2)
  assert.deepEqual(dmView.participants, [{ id: 'a', name: 'Carlos', connected: true }, { id: 'b', name: 'Ana', connected: false }])
  for (const privateField of ['Secreto', tokenId, 'Carlos', 'credential', 'identityHash', 'camera', 'zoom']) assert.equal(JSON.stringify(view).includes(privateField), false)
  rejected(state, a, { type: 'token.update', id: tokenId, changes: { x: 2, y: 2 } }, identity, 'PERMISSION')
  const uncovered = applyAction(state, dm, { type: 'fog.set', regions: [] }, identity).state
  assert.equal(projectRoom(uncovered, a, presence).board.tokens[0].id, tokenId)
  const secret = applyAction(uncovered, dm, { type: 'token.update', id: tokenId, changes: { visible: false } }, identity).state
  rejected(secret, a, { type: 'token.update', id: tokenId, changes: { x: 2, y: 2 } }, identity, 'PERMISSION')
})

test('fog visibility retains half-open center-of-cell boundaries and detached projections', () => {
  const { identity, state: initial } = setup()
  const state = applyAction(initial, dm, { type: 'fog.set', regions: [{ id: 'draft', x: 0, y: 0, width: 32, height: 64 }] }, identity).state
  const view = projectRoom(state, a, presence)
  assert.equal(view.board.tokens.length, 1)
  view.board.tokens[0].x = 99; view.board.fog[0].width = 99
  assert.equal(state.board.tokens[0].x, 0); assert.equal(state.board.fog[0].width, 32)
})

test('ordered concurrent patches retain renamed fields, last valid move and immediate ownership revocation', () => {
  const { identity, tokenId, state: initial } = setup()
  let state = initial
  const actions = [
    [dm, { type: 'token.update', id: tokenId, changes: { name: 'Renombrada' } }],
    [a, { type: 'token.update', id: tokenId, changes: { x: 4, y: 5 } }],
    [dm, { type: 'token.update', id: tokenId, changes: { x: -1, y: -2 } }],
    [dm, { type: 'token.update', id: tokenId, changes: { ownerId: 'b' } }],
  ] as const
  for (const [actor, action] of actions) state = applyAction(frozen(state), actor, action, identity).state
  assert.equal(state.revision, initial.revision + actions.length)
  assert.deepEqual(state.board.tokens[0], { id: tokenId, name: 'Renombrada', x: -1, y: -2, visible: true, ownerId: 'b' })
  rejected(state, a, { type: 'token.update', id: tokenId, changes: { x: 90, y: 90 } }, identity, 'PERMISSION')
  const moved = applyAction(state, b, { type: 'token.update', id: tokenId, changes: { x: 3, y: 3 } }, identity).state
  assert.equal(moved.revision, state.revision + 1)
})

test('product limits hold in the core, including disconnected identities and known participant updates at capacity', () => {
  let n = 0
  const identity = () => `id-${++n}`
  let state = createRoomState('room', shared(emptyBoard()), identity)
  for (let i = 0; i < MAX_PLAYERS; i++) state = registerParticipant(state, { id: `p-${i}`, name: `Jugador ${i}` })
  assert.throws(() => registerParticipant(frozen(state), { id: 'extra', name: 'Otro' }), /10 jugadores/)
  const resumed = registerParticipant(state, { id: 'p-0', name: 'Nuevo nombre' })
  assert.equal(resumed.participants.length, MAX_PLAYERS); assert.equal(resumed.participants[0].name, 'Nuevo nombre'); assert.equal(resumed.revision, 0)
  for (let i = 0; i < MAX_TOKENS; i++) state = applyAction(state, dm, { type: 'token.create', name: `Ficha ${i}`, x: i, y: 0 }, identity).state
  rejected(state, dm, { type: 'token.create', name: 'Otra', x: 0, y: 0 }, identity, 'LIMIT')
  const regions = Array.from({ length: MAX_FOG }, (_, i) => ({ id: `fog-${i}`, x: i, y: 0, width: 1, height: 1 }))
  const withFog = applyAction(state, dm, { type: 'fog.set', regions }, identity).state
  assert.equal(withFog.board.fog.length, MAX_FOG)
  rejected(withFog, dm, { type: 'fog.set', regions: [...regions, { ...regions[0], id: 'extra' }] }, identity, 'INVALID_MESSAGE')
  assert.equal(validShared({ ...shared(emptyBoard()), map: { id: 'map', x: 0, y: 0, width: MAX_IMAGE_PIXELS + 1, height: 1, scale: 1 } }), false)
})

test('map metadata replacement and stale adjustments preserve identity, geometry, revisions and DM authority', () => {
  const { state, identity } = setup()
  const map = { id: 'map', x: -4, y: 8, width: 20, height: 40, scale: 1 }
  const withMap = replaceMap(frozen(state), dm, map)
  assert.equal(withMap.revision, state.revision + 1); assert.equal(state.board.map, null)
  assert.throws(() => replaceMap(withMap, a, map), /Solo el DM/)
  assert.throws(() => replaceMap(withMap, dm, { ...map, scale: 0 }), /escala/)
  for (const stale of [{ ...map, id: 'old' }, { ...map, width: 21 }, { ...map, height: 41 }]) rejected(withMap, dm, { type: 'map.update', map: stale }, identity, 'MAP_CHANGED')
  const adjusted = applyAction(withMap, dm, { type: 'map.update', map: { ...map, x: 64, scale: 2 } }, identity).state
  assert.equal(adjusted.board.map!.x, 64); assert.equal(adjusted.board.map!.scale, 2)
  const deleted = applyAction(adjusted, dm, { type: 'map.delete' }, identity).state
  assert.equal(deleted.board.map, null); assert.deepEqual(deleted.board.tokens, state.board.tokens)
  const reset = applyAction(adjusted, dm, { type: 'board.reset' }, identity).state
  assert.deepEqual(reset.board, shared(emptyBoard())); assert.deepEqual(reset.participants, state.participants)
  assert.equal(reset.revision, adjusted.revision + 1)
})

test('DM token deletion and generated identity failures never mutate the previous state', () => {
  const { state, tokenId, identity } = setup()
  const deleted = applyAction(frozen(state), dm, { type: 'token.delete', id: tokenId }, identity).state
  assert.equal(deleted.board.tokens.length, 0); assert.equal(state.board.tokens.length, 1)
  rejected(state, dm, { type: 'token.create', name: 'Otra', x: 0, y: 0 }, () => tokenId, 'INVALID_ID')
})

test('memory store round-trips neutral JSON and isolates saved and loaded references', () => {
  const { state } = setup(), store = new MemoryRoomStore()
  assert.equal(store.load(state.id), null)
  store.save(state)
  const loaded = store.load(state.id)!
  assert.deepEqual(loaded, state)
  loaded.board.tokens[0].x = 99; state.participants[0].name = 'Changed outside store'
  assert.equal(store.load(state.id)!.board.tokens[0].x, 0)
  assert.equal(store.load(state.id)!.participants[0].name, 'Carlos')
  store.delete(state.id); assert.equal(store.load(state.id), null)
})
