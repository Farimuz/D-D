import { test as base, expect } from '@playwright/test'
import type { Page, Locator } from '@playwright/test'
import type { BoardState } from '../../src/state/model'

const test = base.extend<{ cleanConsole: void }>({
  cleanConsole: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
    await use()
    expect(errors, 'No page exceptions, console errors or warnings').toEqual([])
  }, { auto: true }],
})

async function saved(page: Page): Promise<BoardState> { return page.evaluate(() => JSON.parse(localStorage.getItem('dnd.local-board.v1')!)) }
async function assets(page: Page): Promise<{ id: string; size: number; type: string; format: 'blob' | 'binary' }[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('dnd.local-maps', 1)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('assets', 'readonly')
      const store = tx.objectStore('assets')
      const keys = store.getAllKeys()
      const values = store.getAll()
      tx.oncomplete = () => { db.close(); resolve(values.result.map((value: Blob | { bytes: ArrayBuffer; type: string }, i) => ({ id: String(keys.result[i]), size: value instanceof Blob ? value.size : value.bytes.byteLength, type: value.type, format: value instanceof Blob ? 'blob' : 'binary' }))) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
    request.onerror = () => reject(request.error)
  }))
}
async function mapFile(page: Page, type = 'image/png') {
  // Synthetic fixture, generated in memory; no external or copyrighted map.
  const bytes = await page.evaluate(async type => {
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 320
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c9b99c'; ctx.fillRect(0, 0, 512, 320)
    ctx.fillStyle = '#675b4c'; ctx.fillRect(32, 32, 448, 256)
    ctx.fillStyle = '#ded0b6'; ctx.fillRect(64, 64, 160, 192); ctx.fillRect(288, 64, 160, 192); ctx.fillRect(224, 128, 64, 64)
    ctx.strokeStyle = '#9a8a70'; ctx.lineWidth = 1
    for (let x = 0; x < 512; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 320); ctx.stroke() }
    for (let y = 0; y < 320; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke() }
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), type))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }, type)
  return { name: 'map.local', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }
}
async function importMap(page: Page, type = 'image/png') {
  await page.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(await mapFile(page, type))
  await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
}
async function create(page: Page, name: string) {
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Crear ficha', exact: true }).click()
}
async function middle(locator: Locator) {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
async function drag(page: Page, start: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(start.x, start.y); await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 }); await page.mouse.up()
}

test.beforeEach(async ({ page }) => { await page.goto('/') })

test('map imports PNG/JPEG/WebP by content, preserves aspect and replaces the old Blob', async ({ page }) => {
  await create(page, 'Goblin')
  const token = (await saved(page)).tokens[0]
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    await importMap(page, type)
    const board = await saved(page)
    expect(board.map).toMatchObject({ width: 512, height: 320 })
    expect(board.map!.x + 256 * board.map!.scale).toBeCloseTo(board.camera.x, 4)
    const image = page.getByRole('img', { name: 'Mapa importado' })
    const box = (await image.boundingBox())!
    expect(box.width / box.height).toBeCloseTo(512 / 320, 3)
    const stored = await assets(page)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: board.map!.id, type })
    expect(['blob', 'binary']).toContain(stored[0].format)
    expect(stored[0].size).toBeGreaterThan(0)
    expect(board.tokens[0]).toEqual(token)
    expect(await page.evaluate(() => localStorage.getItem('dnd.local-board.v1'))).not.toContain('base64')
    await page.getByRole('button', { name: 'Listo', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Mapa', exact: true }).click()
    await page.getByRole('button', { name: 'Reemplazar', exact: true }).click()
    await (await chooser).setFiles([])
  }
  const order = await page.evaluate(() => ['.map-image', '.grid', '.token', '.bottom-controls'].map(selector => Number(getComputedStyle(document.querySelector(selector)!).zIndex)))
  expect(order).toEqual([...order].sort((a, b) => a - b))
})

test('map rejects unsupported, oversized and corrupt files without replacing the current map', async ({ page }) => {
  await importMap(page)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  const before = await saved(page)
  const invalid = [
    { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), message: 'Formato no compatible' },
    { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(25 * 1024 * 1024 + 1), message: '25 MiB' },
    { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 224, 0]), message: 'corrupto' },
  ]
  for (const file of invalid) {
    await page.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(file)
    await expect(page.getByRole('alert')).toContainText(file.message)
    await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
    expect(await saved(page)).toEqual(before)
    expect(await assets(page)).toHaveLength(1)
  }
})

test('map adjustment never moves tokens or camera, writes at release and restores geometry on reload', async ({ page }) => {
  await create(page, 'Maga')
  await importMap(page)
  const before = await saved(page)
  const start = await middle(page.getByRole('button', { name: 'Ficha Maga', exact: true }))
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 30, start.y - 35)
  expect(await saved(page)).toEqual(before)
  await page.mouse.up()
  let after = await saved(page)
  expect(after.map).toMatchObject({ x: before.map!.x + 30, y: before.map!.y - 35 })
  expect(after.tokens).toEqual(before.tokens)
  expect(after.camera).toEqual(before.camera)
  await page.getByRole('button', { name: 'Aumentar escala del mapa', exact: true }).click()
  expect((await saved(page)).map!.scale).toBeCloseTo(before.map!.scale * 1.02, 5)
  await page.getByRole('button', { name: 'Disminuir escala del mapa', exact: true }).click()
  await page.getByLabel('Escala del mapa en porcentaje').fill('125')
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  after = await saved(page)
  expect(after.map!.scale).toBe(1.25)
  await page.reload()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
  expect(await saved(page)).toEqual(after)
  await drag(page, await middle(page.getByRole('button', { name: 'Ficha Maga', exact: true })), 64, 0)
  expect((await saved(page)).tokens[0].x).toBe(before.tokens[0].x + 1)
  expect((await saved(page)).map).toEqual(after.map)
  await page.screenshot({ path: `test-results/map-${test.info().project.name}.png` })
})

test('delete map keeps tokens; confirmed reset clears Blob, tokens, geometry and camera', async ({ page }) => {
  await create(page, 'Guerrero'); await importMap(page)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  const tokens = (await saved(page)).tokens
  await page.getByRole('button', { name: 'Mapa', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Eliminar mapa', exact: true }).click()
  expect((await saved(page)).map).toBeTruthy()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Eliminar mapa', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Limpiar', exact: true })).toBeEnabled()
  expect((await saved(page)).tokens).toEqual(tokens)
  expect(await assets(page)).toHaveLength(0)
  await importMap(page)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await page.getByRole('button', { name: 'Acercar', exact: true }).click()
  const board = (await page.getByRole('region', { name: 'Mesa cuadriculada' }).boundingBox())!
  await drag(page, { x: 30, y: board.y + 100 }, 60, 20)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  expect(await assets(page)).toHaveLength(1)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Limpiar', exact: true })).toBeEnabled()
  expect(await saved(page)).toEqual({ version: 1, tokens: [], camera: { x: 32, y: 32 }, zoom: 1, map: null })
  expect(await assets(page)).toHaveLength(0)
  await page.reload()
  await expect(page.locator('.token, .map-image')).toHaveCount(0)
})

test('existing v0.0.1 tokens survive import and reload; map storage failures preserve the board', async ({ page }) => {
  const legacy = { version: 1, tokens: [{ id: 'old', name: 'Antigua', x: 0, y: 0 }], camera: { x: 32, y: 32 }, zoom: 1 }
  await page.evaluate(value => localStorage.setItem('dnd.local-board.v1', JSON.stringify(value)), legacy)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ficha Antigua', exact: true })).toBeVisible()
  await importMap(page)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  const before = await saved(page)
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException('Quota', 'QuotaExceededError') } })
  await page.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(await mapFile(page))
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar')
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
  expect(await saved(page)).toEqual(before)
  expect(await assets(page)).toHaveLength(1)
  await page.reload()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ficha Antigua', exact: true })).toBeVisible()
})

test('measurement uses correct horizontal and vertical distances at camera zoom without changing saved state', async ({ page }) => {
  await create(page, 'Medidora'); await importMap(page)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Alejar', exact: true }).click()
  const before = await saved(page)
  await page.getByRole('button', { name: 'Medir', exact: true }).click()
  const start = await middle(page.getByRole('button', { name: 'Ficha Medidora', exact: true }))
  await drag(page, start, -128, 0)
  await expect(page.getByLabel('Distancia', { exact: true })).toHaveText('20 ft')
  expect(await saved(page)).toEqual(before)
  await drag(page, start, 0, -192)
  await expect(page.getByLabel('Distancia', { exact: true })).toHaveText('30 ft')
  expect(await saved(page)).toEqual(before)
  const layers = await page.evaluate(() => ['.grid', '.measurement', '.token', '.bottom-controls'].map(selector => Number(getComputedStyle(document.querySelector(selector)!).zIndex)))
  expect(layers).toEqual([...layers].sort((a, b) => a - b))
  await page.screenshot({ path: `test-results/measurement-${test.info().project.name}.png` })
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await expect(page.locator('.measurement')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.measurement')).toHaveCount(0)
})

test('rename validates the name and duplicate keeps it with a fresh identity and free nearby cell', async ({ page }) => {
  await create(page, 'Goblin')
  const original = (await saved(page)).tokens[0]
  await page.getByRole('button', { name: 'Editar nombre de Goblin', exact: true }).click()
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Goblin')
  await page.getByLabel('Nombre', { exact: true }).fill('   ')
  await expect(page.getByRole('button', { name: 'Guardar nombre', exact: true })).toBeDisabled()
  await page.getByLabel('Nombre', { exact: true }).fill('Goblin rojo')
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click()
  expect((await saved(page)).tokens[0]).toEqual({ ...original, name: 'Goblin rojo' })
  await page.getByRole('button', { name: 'Duplicar Goblin rojo', exact: true }).click()
  const tokens = (await saved(page)).tokens
  expect(tokens).toHaveLength(2)
  expect(tokens[1].name).toBe('Goblin rojo')
  expect(tokens[1].id).not.toBe(tokens[0].id)
  expect({ x: tokens[1].x, y: tokens[1].y }).not.toEqual({ x: tokens[0].x, y: tokens[0].y })
  expect(Math.max(Math.abs(tokens[1].x - tokens[0].x), Math.abs(tokens[1].y - tokens[0].y))).toBe(1)
  await page.reload()
  expect((await saved(page)).tokens).toEqual(tokens)
  await expect(page.getByRole('button', { name: 'Ficha Goblin rojo', exact: true })).toHaveCount(2)
})

test('failed metadata writes cannot replace, delete or reset a durable map asset', async ({ page }) => {
  await create(page, 'Persistente'); await importMap(page)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  const before = await saved(page)
  const stored = await assets(page)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError') } })
  await page.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(await mapFile(page))
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('mapa anterior se conservó')
  expect(await saved(page)).toEqual(before)
  expect(await assets(page)).toEqual(stored)
  await page.getByRole('button', { name: 'Mapa', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Eliminar mapa', exact: true }).click()
  expect(await saved(page)).toEqual(before)
  expect(await assets(page)).toEqual(stored)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  expect(await saved(page)).toEqual(before)
  expect(await assets(page)).toEqual(stored)
  await page.reload()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
})

test('unavailable or missing image storage warns without losing tokens or saved metadata', async ({ page }) => {
  await create(page, 'Conservada'); await importMap(page)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  const before = await saved(page)
  await page.evaluate(() => { IDBFactory.prototype.open = () => { throw new DOMException('Denied', 'SecurityError') } })
  await page.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(await mapFile(page))
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await saved(page)).toEqual(before)
  await page.reload()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('dnd.local-maps', 1)
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').clear()
      tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => { db.close(); reject(tx.error) }
    }
  }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Las fichas se conservaron')
  await expect(page.getByRole('button', { name: 'Ficha Conservada', exact: true })).toBeVisible()
  expect(await saved(page)).toEqual(before)
})

test('map gesture interruptions roll back and object URLs are released on replace and delete', async ({ page }) => {
  await page.evaluate(() => {
    const active = new Set<string>()
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url }
    URL.revokeObjectURL = url => { active.delete(url); revoke(url) }
    Object.assign(window, { activeMapUrls: active })
  })
  await importMap(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as { activeMapUrls: Set<string> }).activeMapUrls.size)).toBe(1)
  const before = await saved(page)
  const image = (await page.getByRole('img', { name: 'Mapa importado' }).boundingBox())!
  const start = { x: image.x + image.width / 2, y: image.y + image.height / 2 }
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 40, start.y - 20)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  expect(await saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await importMap(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as { activeMapUrls: Set<string> }).activeMapUrls.size)).toBe(1)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await page.getByRole('button', { name: 'Mapa', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Eliminar mapa', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { activeMapUrls: Set<string> }).activeMapUrls.size)).toBe(0)
})

test('map and measurement controls fit narrow portrait and landscape viewports with touch-sized targets', async ({ page }) => {
  await importMap(page)
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size)
    for (const label of ['Mapa', 'Medir', 'Listo', 'Aumentar escala del mapa', 'Disminuir escala del mapa']) {
      const box = (await page.getByRole('button', { name: label, exact: true }).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width); expect(box.y + box.height).toBeLessThanOrEqual(size.height)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const start = await middle(page.locator('.board'))
    expect(await page.evaluate(point => Boolean(document.elementFromPoint(point.x, point.y)?.closest('.board')), start)).toBe(true)
    const before = await saved(page)
    await drag(page, start, 12, 0)
    expect((await saved(page)).map!.x).toBeCloseTo(before.map!.x + 12 / before.zoom, 4)
    await page.screenshot({ path: `test-results/map-adjust-${size.width}-${test.info().project.name}.png` })
  }
})

test('mobile tap imports and aligns a map, then uses tokens, camera and synthetic touch measurement', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Mapa', exact: true }).tap()
  await (await chooser).setFiles(await mapFile(page))
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled()
  const before = await saved(page)
  // WebKit provides tap automation; synthetic touch PointerEvents exercise drag handlers on iPhone.
  async function touch(start: { x: number; y: number }, dx: number, dy: number) {
    await page.evaluate(({ start, dx, dy }) => {
      const board = document.querySelector<HTMLElement>('.board')!
      const capture = board.setPointerCapture; const has = board.hasPointerCapture
      board.setPointerCapture = () => {}; board.hasPointerCapture = () => false
      try {
        const target = document.elementFromPoint(start.x, start.y)!
        const event = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, pointerId: 42, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y })
        target.dispatchEvent(event('pointerdown', start.x, start.y))
        board.dispatchEvent(event('pointermove', start.x + dx, start.y + dy))
        board.dispatchEvent(event('pointerup', start.x + dx, start.y + dy))
      } finally { board.setPointerCapture = capture; board.hasPointerCapture = has }
    }, { start, dx, dy })
  }
  const image = (await page.getByRole('img', { name: 'Mapa importado' }).boundingBox())!
  await touch({ x: image.x + image.width / 2, y: image.y + image.height / 2 }, 30, -20)
  expect((await saved(page)).map).toMatchObject({ x: before.map!.x + 30, y: before.map!.y - 20 })
  await page.getByRole('button', { name: 'Aumentar escala del mapa', exact: true }).tap()
  await page.getByRole('button', { name: 'Disminuir escala del mapa', exact: true }).tap()
  await page.getByRole('button', { name: 'Listo', exact: true }).tap()
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).tap()
  await page.getByLabel('Nombre', { exact: true }).fill('Móvil')
  await page.getByRole('button', { name: 'Crear ficha', exact: true }).tap()
  const token = page.getByRole('button', { name: 'Ficha Móvil', exact: true })
  await touch(await middle(token), 64, -64)
  expect((await saved(page)).tokens[0]).toMatchObject({ x: 1, y: -1 })
  const cameraBefore = (await saved(page)).camera
  const boardBox = (await page.locator('.board').boundingBox())!
  await touch({ x: 30, y: boardBox.y + 100 }, 30, 20)
  expect((await saved(page)).camera).toEqual({ x: cameraBefore.x - 30, y: cameraBefore.y - 20 })
  await page.getByRole('button', { name: 'Acercar', exact: true }).tap()
  await page.getByRole('button', { name: 'Centrar vista', exact: true }).tap()
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Alejar', exact: true }).tap()
  await page.getByRole('button', { name: 'Medir', exact: true }).tap()
  const measurementBefore = await saved(page)
  const start = await middle(token)
  await touch(start, -128, 0)
  await expect(page.getByLabel('Distancia', { exact: true })).toHaveText('20 ft')
  await touch(start, 0, -192)
  await expect(page.getByLabel('Distancia', { exact: true })).toHaveText('30 ft')
  expect(await saved(page)).toEqual(measurementBefore)
  await page.getByRole('button', { name: 'Listo', exact: true }).tap()
  await page.reload()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/mobile-map-${test.info().project.name}.png` })
})

test('Android trusted touch adjusts maps and measures without moving tokens or camera', async ({ page, browserName }) => {
  expect(browserName).toBe('chromium')
  await create(page, 'Táctil'); await importMap(page)
  const client = await page.context().newCDPSession(page)
  async function touch(start: { x: number; y: number }, dx: number, dy: number, cancel = false) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, ...start }] })
    for (let i = 1; i <= 5; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: start.x + dx * i / 5, y: start.y + dy * i / 5 }] })
    await client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
  }
  const token = page.getByRole('button', { name: 'Ficha Táctil', exact: true })
  const before = await saved(page)
  const start = await middle(token)
  await touch(start, 40, -30)
  const moved = await saved(page)
  expect(moved.map).toMatchObject({ x: before.map!.x + 40, y: before.map!.y - 30 })
  expect(moved.tokens).toEqual(before.tokens); expect(moved.camera).toEqual(before.camera)
  await touch(start, 70, -30, true)
  expect(await saved(page)).toEqual(moved)
  await page.getByRole('button', { name: 'Aumentar escala del mapa', exact: true }).tap()
  await page.getByRole('button', { name: 'Listo', exact: true }).tap()
  await touch(start, 64, -64)
  expect((await saved(page)).tokens[0]).toMatchObject({ x: 1, y: -1 })
  const box = (await page.locator('.board').boundingBox())!
  await touch({ x: 30, y: box.y + 100 }, 30, 20)
  await page.getByRole('button', { name: 'Acercar', exact: true }).tap()
  await page.getByRole('button', { name: 'Centrar vista', exact: true }).tap()
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Alejar', exact: true }).tap()
  await page.getByRole('button', { name: 'Medir', exact: true }).tap()
  const measurementBefore = await saved(page)
  const origin = await middle(token)
  await touch(origin, -128, 0)
  await expect(page.getByLabel('Distancia', { exact: true })).toHaveText('20 ft')
  await touch(origin, 0, -192)
  await expect(page.getByLabel('Distancia', { exact: true })).toHaveText('30 ft')
  expect(await saved(page)).toEqual(measurementBefore)
  await touch(origin, -128, 0, true)
  await expect(page.locator('.measurement')).toHaveCount(0)
  await page.getByRole('button', { name: 'Listo', exact: true }).tap()
  await page.reload()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
  expect(await saved(page)).toEqual(measurementBefore)
  await client.detach()
})

test('unsupported Blob cloning falls back to local binary bytes and restores after reload', async ({ page }) => {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (value instanceof Blob) throw new DOMException('Error preparing Blob/File data', 'UnknownError')
      return put.call(this, value, key)
    }
  })
  await importMap(page)
  const before = await saved(page)
  expect((await assets(page))[0].format).toBe('binary')
  await page.reload()
  await expect(page.getByRole('img', { name: 'Mapa importado' })).toBeVisible()
  expect(await saved(page)).toEqual(before)
})
