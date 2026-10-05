import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyBoard, MAX_CELL, MIN_ZOOM } from '../../src/state/model.ts'
import { cellCenter } from '../../src/map/geometry.ts'
import { isBoardState, loadBoard, saveBoard, STORAGE_KEY } from '../../src/state/storage.ts'

test('storage restores the complete board, including Unicode, camera and zoom', () => {
  const board = { ...emptyBoard(), tokens: [{ id: 'a', name: 'Juan Pérez', x: -8, y: 5 }], camera: { x: 109.5, y: -55 }, zoom: 2.5 }
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  assert.equal(saveBoard(storage, board), true)
  assert.deepEqual(loadBoard(storage), { board, warning: null, blocked: false })
  assert.equal(data.size, 1)
  assert.ok(data.has(STORAGE_KEY))
})

test('first visit returns an empty board without writing', () => {
  assert.deepEqual(loadBoard({ getItem: () => null }), { board: emptyBoard(), warning: null, blocked: false })
})

test('centering tokens at the board coordinate limit still produces restorable data', () => {
  const token = { id: 'edge', name: 'Límite', x: MAX_CELL, y: -MAX_CELL }
  assert.equal(isBoardState({ ...emptyBoard(), tokens: [token], camera: cellCenter(token) }), true)
})

test('corrupt and future data is not overwritten; unavailable storage is reported', () => {
  for (const raw of ['{', '{"version":2}', 'null', '[]']) {
    const loaded = loadBoard({ getItem: () => raw })
    assert.equal(loaded.blocked, true)
    assert.ok(loaded.warning)
    assert.deepEqual(loaded.board, emptyBoard())
  }
  assert.equal(loadBoard({ getItem: () => { throw new Error('denied') } }).blocked, true)
  assert.equal(saveBoard({ setItem: () => { throw new Error('quota') } }, emptyBoard()), false)
})

test('validation rejects duplicate identities, fractions, nonfinite and out-of-range values', () => {
  const token = { id: 'a', name: 'A', x: 0, y: 0 }
  for (const invalid of [
    { ...emptyBoard(), tokens: [token, token] },
    { ...emptyBoard(), tokens: [{ ...token, x: 1.5 }] },
    { ...emptyBoard(), tokens: [{ ...token, name: '   ' }] },
    { ...emptyBoard(), tokens: [{ ...token, name: 'a'.repeat(61) }] },
    { ...emptyBoard(), camera: { x: Infinity, y: 0 } },
    { ...emptyBoard(), zoom: 0 },
    { ...emptyBoard(), zoom: NaN },
    { ...emptyBoard(), tokens: [{ ...token, x: 1_000_001 }] },
  ]) assert.equal(isBoardState(invalid), false)
})


test('old schema and exact tiny zoom persist without a schema change', () => {
  for (const zoom of [0.5, 0.123456789, MIN_ZOOM]) {
    let raw = ''
    const board = { ...emptyBoard(), zoom }
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
    assert.equal(saveBoard(storage, board), true)
    assert.deepEqual(loadBoard(storage).board, board)
    assert.equal(loadBoard(storage).board.version, 1)
  }
  assert.equal(isBoardState({ ...emptyBoard(), zoom: MIN_ZOOM / 2 }), false)
})
