import test from 'node:test'
import assert from 'node:assert/strict'
import { alignMap, imageToWorld, worldToImage, inspectZoom, SQUARE_TOLERANCE } from '../../src/map/alignment.ts'
import { worldToScreen, screenToWorld } from '../../src/map/geometry.ts'
import { MAX_CAMERA } from '../../src/state/model.ts'
import type { MapAsset } from '../../src/state/model.ts'

const map: MapAsset = { id: 'grid', width: 857, height: 1081, x: -173.5, y: -283.25, scale: 0.3 }
const first = { x: 420, y: 532 }

test('16px and 32px cells yield 400% and 200%, snapping the first corner to the nearest world intersection', () => {
  for (const width of [16, 32]) {
    const result = alignMap(map, first, { x: first.x + width, y: first.y + width })
    assert.ok(result.map)
    assert.equal(result.map.scale, 64 / width)
    const projected = imageToWorld(first, { ...map, scale: 64 / width })
    const actual = imageToWorld(first, result.map)
    assert.equal(actual.x, Math.round(projected.x / 64) * 64)
    assert.equal(actual.y, Math.round(projected.y / 64) * 64)
    assert.equal(result.map.x, width === 16 ? -144 : -200)
    assert.equal(result.map.y, width === 16 ? -272 : -296)
    assert.equal(map.scale, 0.3)
  }
})

test('all four diagonal orders produce the same grid phase, including negative world positions', () => {
  const corners = [{ x: 20, y: 20 }, { x: 36, y: 36 }, { x: 36, y: 20 }, { x: 20, y: 36 }]
  for (const [a, b] of [[0, 1], [1, 0], [2, 3], [3, 2]]) {
    const result = alignMap({ ...map, x: -373.5 }, corners[a], corners[b])
    assert.ok(result.map)
    assert.equal(result.map.scale, 4)
    for (const point of [corners[a], corners[b]]) {
      const world = imageToWorld(point, result.map)
      assert.ok(world.x < 0 && world.y < 0)
      assert.equal(Math.abs(world.x % 64), 0)
      assert.equal(Math.abs(world.y % 64), 0)
    }
  }
})

test('6% tolerance is symmetric and uses the geometric mean without stretching either axis', () => {
  assert.equal(SQUARE_TOLERANCE, 0.06)
  for (const [width, height] of [[16, 16.9], [16.9, 16]]) {
    const result = alignMap(map, { x: 0, y: 0 }, { x: width, y: height })
    assert.ok(result.map)
    assert.equal(result.map.scale, 64 / Math.sqrt(width * height))
  }
  for (const [width, height] of [[16, 17], [17, 16], [16, 32]]) {
    assert.match(alignMap(map, { x: 0, y: 0 }, { x: width, y: height }).error!, /casilla cuadrada/)
  }
})

test('invalid points, identical corners, subpixel dimensions and scale limits cannot be applied', () => {
  for (const point of [{ x: NaN, y: 16 }, { x: 16, y: Infinity }, { x: -1, y: 16 }, { x: 858, y: 16 }]) {
    assert.ok(alignMap(map, { x: 0, y: 0 }, point).error)
  }
  for (const side of [0, 0.5, 1, 3.9]) assert.ok(alignMap(map, { x: 0, y: 0 }, { x: side, y: side }).error)
  assert.equal(alignMap(map, { x: 0, y: 0 }, { x: 4, y: 4 }).map?.scale, 16)
  const large = { ...map, width: 20000, height: 20000 }
  assert.equal(alignMap(large, { x: 0, y: 0 }, { x: 12800, y: 12800 }).map?.scale, 0.005)
  assert.ok(alignMap(large, { x: 0, y: 0 }, { x: 13000, y: 13000 }).error)
  assert.ok(alignMap({ ...map, x: MAX_CAMERA + 1000 }, first, { x: 436, y: 548 }).error)
  assert.ok(alignMap({ ...map, scale: NaN }, first, { x: 436, y: 548 }).error)
})

test('known dimensions use marked useful bounds, not image margins, and reject invalid counts', () => {
  const result = alignMap(map, { x: 20, y: 20 }, { x: 836, y: 1060 }, 51, 65)
  assert.equal(result.map?.scale, 4)
  assert.equal(result.width, 16); assert.equal(result.height, 16)
  const reverse = alignMap(map, { x: 836, y: 1060 }, { x: 20, y: 20 }, 51, 65)
  assert.deepEqual(reverse.map, result.map)
  const reference = alignMap({ ...map, width: 817, height: 1041 }, { x: 0, y: 0 }, { x: 816, y: 1040 }, 51, 65)
  assert.equal(reference.map?.scale, 4)
  for (const n of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.ok(alignMap(map, first, { x: 436, y: 548 }, n, 1).error)
    assert.ok(alignMap(map, first, { x: 436, y: 548 }, 1, n).error)
  }
})

test('image/world transformations and the image-space preview agree with rendering in world space', () => {
  const aligned = alignMap(map, first, { x: 436, y: 548 }).map!
  const size = { x: 390, y: 600 }, camera = { x: 432, y: 550 }, zoom = 3.25
  for (const point of [first, { x: 0, y: 0 }, { x: -22.5, y: -73.25 }]) {
    assert.deepEqual(worldToImage(imageToWorld(point, aligned), aligned), point)
    assert.deepEqual(worldToScreen(point, size, camera, zoom), worldToScreen(imageToWorld(point, aligned), size, imageToWorld(camera, aligned), zoom / aligned.scale))
  }
})

test('inspection zoom reaches precision magnification and keeps wheel/pinch anchors stable at both limits', () => {
  const size = { x: 390, y: 420 }, anchor = { x: 100, y: 120 }, destination = { x: 110, y: 130 }
  const view = { camera: { x: 428, y: 540 }, zoom: 0.25 }
  const point = screenToWorld(anchor, size, view.camera, view.zoom)
  for (const request of [0, 0.5, 4, 32, 100]) {
    const result = inspectZoom(anchor, size, view, request, destination)
    const restored = screenToWorld(destination, size, result.camera, result.zoom)
    assert.ok(Math.abs(restored.x - point.x) < 0.0001)
    assert.ok(Math.abs(restored.y - point.y) < 0.0001)
    assert.ok(result.zoom >= 1e-9 && result.zoom <= 32)
  }
})
