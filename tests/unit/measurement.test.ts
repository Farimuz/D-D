import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceFeet, distanceLabel, worldCell } from '../../src/map/measurement.ts'

test('measurement counts cell-center distances consistently on both axes and diagonals', () => {
  for (const to of [{ x: 4, y: 0 }, { x: 0, y: -4 }]) assert.equal(distanceFeet({ from: { x: 0, y: 0 }, to }), 20)
  assert.equal(distanceLabel({ from: { x: -3, y: 8 }, to: { x: -3, y: 14 } }), '30 ft')
  assert.equal(distanceFeet({ from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }), 25)
  assert.equal(distanceLabel({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }), '7.1 ft')
  assert.equal(distanceFeet({ from: { x: 1, y: 1 }, to: { x: 1, y: 1 } }), 0)
})
test('pointer selects its containing cell, including negative coordinates and boundaries', () => {
  assert.deepEqual(worldCell({ x: 63.999, y: -0.1 }), { x: 0, y: -1 })
  assert.deepEqual(worldCell({ x: 64, y: -64 }), { x: 1, y: -1 })
  assert.deepEqual(worldCell({ x: 1e12, y: -1e12 }), { x: 1000000, y: -1000000 })
})
