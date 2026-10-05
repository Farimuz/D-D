import test from 'node:test'
import assert from 'node:assert/strict'
import { buttonZoom, fitMap, zoomAt, cellCenter, clampZoom, initials, nearbyCell, screenToWorld, snapCell, spawnCell, worldToScreen } from '../../src/map/geometry.ts'
import { CELL_SIZE, emptyBoard, MAX_CELL, MIN_ZOOM } from '../../src/state/model.ts'

test('zoom limits and nearest-cell snap cover negative coordinates', () => {
  assert.equal(clampZoom(0.1), 0.1)
  assert.equal(clampZoom(0), MIN_ZOOM)
  assert.equal(clampZoom(10), 2.5)
  assert.equal(clampZoom(1.25), 1.25)
  assert.equal(snapCell(-1.6), -2)
  assert.equal(snapCell(1.49), 1)
  assert.equal(snapCell(1.51), 2)
  assert.equal(snapCell(MAX_CELL + 20), MAX_CELL)
})

test('duplicates choose an unoccupied neighbor even at board edges and in a crowded cluster', () => {
  for (const origin of [{ x: 0, y: 0 }, { x: MAX_CELL, y: -MAX_CELL }]) {
    const tokens = [{ id: 'a', name: 'Goblin', ...origin }]
    for (let i = 0; i < 20; i++) {
      const cell = nearbyCell(tokens, origin)
      assert.ok(Math.abs(cell.x) <= MAX_CELL && Math.abs(cell.y) <= MAX_CELL)
      assert.ok(!tokens.some(token => token.x === cell.x && token.y === cell.y))
      assert.ok(Math.max(Math.abs(cell.x - origin.x), Math.abs(cell.y - origin.y)) <= 5)
      tokens.push({ id: String(i), name: 'Goblin', ...cell })
    }
  }
})

test('world and screen coordinates round-trip after pan, at every zoom limit', () => {
  for (const zoom of [0.5, 1, 1.75, 2.5]) {
    const point = cellCenter({ x: -4, y: 8 })
    const size = { x: 390, y: 680 }
    const camera = { x: -123.25, y: 201 }
    const restored = screenToWorld(worldToScreen(point, size, camera, zoom), size, camera, zoom)
    assert.ok(Math.abs(restored.x - point.x) < 1e-9)
    assert.ok(Math.abs(restored.y - point.y) < 1e-9)
  }
  assert.deepEqual(cellCenter({ x: 0, y: 0 }), { x: CELL_SIZE / 2, y: CELL_SIZE / 2 })
})

test('initials handle one name, multiple words and Unicode', () => {
  assert.equal(initials('Arannis'), 'A')
  assert.equal(initials('Goblin'), 'G')
  assert.equal(initials(' Juan   Pérez '), 'JP')
  assert.equal(initials('Éowyn'), 'É')
  assert.equal(initials('🧙 Mago'), '🧙M')
})

test('new tokens choose an empty visible cell near a panned camera', () => {
  const camera = { x: 640 + 32, y: -128 + 32 }
  const first = spawnCell([], camera, 1, { x: 390, y: 680 })
  assert.deepEqual(first, { x: 10, y: -2 })
  const next = spawnCell([{ id: 'a', name: 'A', ...first }], camera, 1, { x: 390, y: 680 })
  assert.notDeepEqual(next, first)
  assert.ok(Math.abs(next.x - first.x) <= 1 && Math.abs(next.y - first.y) <= 1)
  assert.deepEqual(emptyBoard(), emptyBoard())
})


test('anchored zoom and moving pinch midpoint preserve the world point at both limits', () => {
  const size = { x: 390, y: 680 }, anchor = { x: 87, y: 210 }, destination = { x: 104, y: 234 }
  const view = { camera: { x: 321, y: -147 }, zoom: 1 }
  const world = screenToWorld(anchor, size, view.camera, view.zoom)
  for (const requested of [0, 0.001, 0.4, 1.2, 20]) {
    const next = zoomAt(anchor, size, view, requested, destination)
    const screen = worldToScreen(world, size, next.camera, next.zoom)
    assert.ok(Math.abs(screen.x - destination.x) < 1e-6)
    assert.ok(Math.abs(screen.y - destination.y) < 1e-6)
    assert.ok(next.zoom >= MIN_ZOOM && next.zoom <= 2.5)
  }
})

test('zoom buttons retain old steps and continue below fifty percent to the numerical floor', () => {
  assert.equal(buttonZoom(1, -1), 0.75)
  assert.equal(buttonZoom(0.75, -1), 0.5)
  assert.equal(buttonZoom(0.5, -1), 0.4)
  assert.equal(buttonZoom(0.4, 1), 0.5)
  assert.equal(buttonZoom(MIN_ZOOM, -1), MIN_ZOOM)
  assert.equal(buttonZoom(2.5, 1), 2.5)
})

test('fit includes a maximum-width map and respects margins, controls and maximum zoom', () => {
  for (const size of [{ x: 320, y: 506 }, { x: 844, y: 336 }]) {
    for (const width of [100, 32_000_000]) {
      const map = { id: 'map', width, height: 1, scale: 16, x: -35, y: 17 }
      const view = fitMap(map, size, emptyBoard(), 48, 180)
      const first = worldToScreen(map, size, view.camera, view.zoom)
      const last = worldToScreen({ x: map.x + width * 16, y: map.y + 16 }, size, view.camera, view.zoom)
      assert.ok(first.x >= 16 - 1e-6 && last.x <= size.x - 16 + 1e-6)
      assert.ok(first.y >= 64 - 1e-6 && last.y <= size.y - 196 + 1e-6)
      assert.ok(view.zoom >= MIN_ZOOM && view.zoom <= 2.5)
    }
  }
})
