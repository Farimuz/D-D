import test from 'node:test'
import assert from 'node:assert/strict'
import { imageType, initialMap, clampMapScale, MIN_MAP_SCALE, MAX_MAP_SCALE } from '../../src/map/mapAsset.ts'
import { loadBoard, isBoardState } from '../../src/state/storage.ts'
import { emptyBoard } from '../../src/state/model.ts'

test('raster signatures accept PNG/JPEG/WebP and reject SVG, names and incomplete headers', () => {
  assert.equal(imageType(Uint8Array.from([137,80,78,71,13,10,26,10])), 'image/png')
  assert.equal(imageType(Uint8Array.from([255,216,255,224])), 'image/jpeg')
  assert.equal(imageType(new TextEncoder().encode('RIFFxxxxWEBP')), 'image/webp')
  for (const value of ['<svg onload="alert(1)">', 'map.png', 'RIFFxxxxWAVE', '']) assert.equal(imageType(new TextEncoder().encode(value)), null)
})
test('map initially fits and centers in world coordinates at camera zoom', () => {
  const map = initialMap('a', 1000, 500, { x: 32, y: -64 }, 2, { x: 390, y: 844 })
  assert.equal(map.scale, 326 / 2000)
  assert.equal(map.x + map.width * map.scale / 2, 32)
  assert.equal(map.y + map.height * map.scale / 2, -64)
  assert.equal(clampMapScale(0), MIN_MAP_SCALE)
  assert.equal(clampMapScale(100), MAX_MAP_SCALE)
})
test('v0.0.1 data is normalized without discarding or writing old state', () => {
  const legacy = { version: 1, tokens: [{ id: 'a', name: 'Antigua', x: -3, y: 8 }], camera: { x: 72, y: 99 }, zoom: 1.5 }
  const loaded = loadBoard({ getItem: () => JSON.stringify(legacy) })
  assert.deepEqual(loaded.board, { ...legacy, map: null })
  assert.equal(loaded.blocked, false)
})
test('map metadata validation rejects invalid geometry and preserves saved bad data', () => {
  const map = initialMap('a', 640, 320, { x: 32, y: 32 }, 1, { x: 390, y: 844 })
  assert.equal(isBoardState({ ...emptyBoard(), map }), true)
  for (const bad of [{ ...map, scale: NaN }, { ...map, scale: 0 }, { ...map, width: 0 }, { ...map, height: 1.5 }, { ...map, x: Infinity }, { ...map, width: 999999 }, { ...map, id: '' }]) {
    const board = { ...emptyBoard(), map: bad }
    assert.equal(isBoardState(board), false)
    assert.equal(loadBoard({ getItem: () => JSON.stringify(board) }).blocked, true)
  }
})
