import test from 'node:test'
import assert from 'node:assert/strict'
import { contains, isRectangle, rectangleBetween, revealFog, subtractRectangle, usedArea, visibleToPlayers } from '../../src/map/fog.ts'
import { emptyBoard, MAX_CAMERA } from '../../src/state/model.ts'
import type { BoardState } from '../../src/state/model.ts'
import { isBoardState, loadBoard, saveBoard } from '../../src/state/storage.ts'
import { worldToScreen, screenToWorld, zoomAt } from '../../src/map/geometry.ts'

const fog = { id: 'fog', x: -64, y: -64, width: 128, height: 128 }
const token = { id: 'old', name: 'Antigua', x: 0, y: 0 }

test('fog validates positive finite geometry, identity, visibility and preserves invalid saved data', () => {
  assert.ok(isBoardState({ ...emptyBoard(), fog: [fog], tokens: [{ ...token, visible: false }] }))
  for (const bad of [{ ...fog, width: 0 }, { ...fog, height: -1 }, { ...fog, x: Infinity }, { ...fog, x: MAX_CAMERA * 3 }, { ...fog, width: '3' }, { ...fog, id: '' }]) {
    const raw = JSON.stringify({ ...emptyBoard(), fog: [bad] })
    assert.equal(loadBoard({ getItem: () => raw }).blocked, true)
  }
  assert.equal(isBoardState({ ...emptyBoard(), fog: [fog, fog] }), false)
  assert.equal(isBoardState({ ...emptyBoard(), fog: null }), false)
  assert.equal(isBoardState({ ...emptyBoard(), tokens: [{ ...token, visible: 'true' }] }), false)
})

test('legacy normalization retains all v0.0.1/v0.0.2 fields; missing visibility means public and missing fog means empty', () => {
  const legacy: BoardState[] = [
    { version: 1 as const, tokens: [token], camera: { x: -32, y: 87 }, zoom: 0.5 },
    { ...emptyBoard(), tokens: [token], map: { id: 'image', x: -20, y: 50, width: 100, height: 80, scale: 1 } },
  ]
  for (const old of legacy) {
    const raw = JSON.stringify(old)
    const loaded = loadBoard({ getItem: () => raw })
    assert.equal(loaded.blocked, false)
    assert.deepEqual(loaded.board, { ...old, map: old.map ?? null })
    assert.equal(visibleToPlayers(loaded.board.tokens[0], loaded.board.fog), true)
    assert.deepEqual(loaded.board.tokens[0], token)
  }
})

test('player projection excludes DM-only and covered centers, includes public tokens outside and handles negative cells', () => {
  assert.equal(visibleToPlayers({ ...token, visible: false }), false)
  assert.equal(visibleToPlayers(token, [fog]), false)
  assert.equal(visibleToPlayers({ ...token, x: 1 }, [fog]), true)
  assert.equal(visibleToPlayers({ ...token, x: -1, y: -1 }, [fog]), false)
  assert.equal(visibleToPlayers({ ...token, x: -2 }, [fog]), true)
  assert.equal(contains(fog, { x: -64, y: -64 }), true)
  assert.equal(contains(fog, { x: 64, y: 0 }), false)
  assert.equal(contains(fog, { x: 0, y: 64 }), false)
})

test('rectangles normalize all diagonal directions without accepting taps or nonfinite coordinates', () => {
  for (const [a, b] of [[{ x: -30, y: -40 }, { x: 80, y: 60 }], [{ x: 80, y: -40 }, { x: -30, y: 60 }]]) {
    assert.deepEqual(rectangleBetween(a, b), { x: -30, y: -40, width: 110, height: 100 })
    assert.deepEqual(rectangleBetween(b, a), rectangleBetween(a, b))
  }
  assert.equal(rectangleBetween({ x: 0, y: 0 }, { x: 0, y: 0 }), null)
  assert.equal(rectangleBetween({ x: NaN, y: 0 }, { x: 5, y: 8 }), null)
  assert.equal(rectangleBetween({ x: Infinity, y: 0 }, { x: 5, y: 8 }), null)
})

test('subtraction covers interior, edge, corner, full, disjoint and touching cuts with no overlaps or area loss', () => {
  const original = { x: -10, y: -10, width: 100, height: 80 }
  const cuts = [
    { x: 20, y: 10, width: 30, height: 20 }, { x: -30, y: -30, width: 50, height: 50 },
    { x: -30, y: 10, width: 60, height: 20 }, { x: -20, y: -20, width: 200, height: 200 },
    { x: 90, y: 0, width: 20, height: 20 }, { x: 100, y: 100, width: 20, height: 20 },
  ]
  for (const cut of cuts) {
    const parts = subtractRectangle(original, cut)
    assert.ok(parts.length <= 4)
    assert.ok(parts.every(isRectangle))
    for (let x = -9.5; x < 90; x++) for (let y = -9.5; y < 70; y++) {
      const point = { x, y }
      assert.equal(parts.filter(part => contains(part, point)).length, contains(cut, point) ? 0 : 1)
    }
    const intersection = Math.max(0, Math.min(90, cut.x + cut.width) - Math.max(-10, cut.x)) * Math.max(0, Math.min(70, cut.y + cut.height) - Math.max(-10, cut.y))
    assert.equal(parts.reduce((sum, part) => sum + part.width * part.height, 0), 8000 - intersection)
  }
  assert.deepEqual(original, { x: -10, y: -10, width: 100, height: 80 })
})

test('reveal subtracts every overlapping region and retains unaffected identities without mutating inputs', () => {
  const far = { ...fog, id: 'far', x: 200 }
  const overlap = { ...fog, id: 'overlap', x: -32 }
  const regions = [fog, overlap, far], snapshot = JSON.stringify(regions)
  let id = 0
  const result = revealFog(regions, { x: -10, y: -10, width: 30, height: 30 }, () => `fragment-${++id}`)
  assert.equal(JSON.stringify(regions), snapshot)
  assert.ok(result.includes(far))
  assert.equal(new Set(result.map(part => part.id)).size, result.length)
  assert.equal(result.some(part => contains(part, { x: 0, y: 0 })), false)
  assert.ok(isBoardState({ ...emptyBoard(), fog: result }))
})

test('pan, zoom and viewport changes preserve fog world coordinates and center visibility', () => {
  const board = { ...emptyBoard(), tokens: [token], fog: [fog] }, snapshot = JSON.stringify(board)
  for (const size of [{ x: 320, y: 568 }, { x: 1280, y: 720 }]) {
    const view = zoomAt({ x: 60, y: 90 }, size, board, 0.2)
    const rendered = worldToScreen(fog, size, view.camera, view.zoom)
    const restored = screenToWorld(rendered, size, view.camera, view.zoom)
    assert.ok(Math.abs(restored.x - fog.x) < 1e-9 && Math.abs(restored.y - fog.y) < 1e-9)
    assert.equal(visibleToPlayers(token, board.fog), false)
  }
  assert.equal(JSON.stringify(board), snapshot)
})

test('hide all uses the complete scaled map, or viewport plus all used cells without a map', () => {
  const board = { ...emptyBoard(), tokens: [{ ...token, x: -100, y: 200 }] }
  const bounds = usedArea(board, { x: 390, y: 844 })
  assert.ok(contains(bounds, { x: -100 * 64 + 32, y: 200 * 64 + 32 }))
  assert.ok(contains(bounds, board.camera))
  const map = { id: 'm', x: -80, y: -90, width: 1000, height: 700, scale: 4 }
  assert.deepEqual(usedArea({ ...board, map }, { x: 390, y: 844 }), { x: -80, y: -90, width: 4000, height: 2800 })
  const edge = usedArea({ ...board, map: { ...map, x: MAX_CAMERA, y: -MAX_CAMERA } }, { x: 320, y: 568 })
  assert.ok(isRectangle(edge))
  assert.ok(isBoardState({ ...board, fog: [{ ...edge, id: 'edge' }] }))
})

test('fog and explicit visibility round-trip together without touching map references', () => {
  const board = { ...emptyBoard(), fog: [fog], tokens: [{ ...token, visible: false }] }
  let raw = ''
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
  assert.equal(saveBoard(storage, board), true)
  assert.deepEqual(loadBoard(storage).board, board)
})
