import test from 'node:test'
import assert from 'node:assert/strict'
import { cellCenter, clampZoom, initials, nearbyCell, screenToWorld, snapCell, spawnCell, worldToScreen } from '../../src/map/geometry.ts'
import { CELL_SIZE, emptyBoard, MAX_CELL } from '../../src/state/model.ts'

test('zoom limits and nearest-cell snap cover negative coordinates', () => {
  assert.equal(clampZoom(0.1), 0.5)
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
