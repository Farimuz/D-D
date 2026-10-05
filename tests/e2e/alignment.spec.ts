import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import type { BoardState, Point } from '../../src/state/model'

const test = base.extend<{ cleanConsole: void }>({
  cleanConsole: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
    await use()
    expect(errors).toEqual([])
  }, { auto: true }],
})
const saved = (page: Page): Promise<BoardState> => page.evaluate(() => JSON.parse(localStorage.getItem('dnd.local-board.v1')!))
const surface = (page: Page) => page.locator('.alignment-surface')
const handles = (page: Page) => page.locator('.alignment-handle')
async function picked(page: Page): Promise<Point[]> {
  return handles(page).evaluateAll(elements => elements.map(element => ({ x: Number((element as HTMLElement).dataset.imageX), y: Number((element as HTMLElement).dataset.imageY) })))
}
async function geometry(page: Page) {
  const box = (await surface(page).boundingBox())!
  return { box, zoom: Number(await surface(page).getAttribute('data-zoom')), camera: { x: Number(await surface(page).getAttribute('data-camera-x')), y: Number(await surface(page).getAttribute('data-camera-y')) } }
}
async function screen(page: Page, point: Point) {
  const { box, zoom, camera } = await geometry(page)
  return { x: box.x + box.width / 2 + (point.x - camera.x) * zoom, y: box.y + box.height / 2 + (point.y - camera.y) * zoom }
}
async function mark(page: Page, point: Point, touch = false) {
  const p = await screen(page, point)
  if (touch) await page.touchscreen.tap(p.x, p.y)
  else await page.mouse.click(p.x, p.y)
}
async function open(page: Page, method = 'Marcar una casilla') {
  await page.getByRole('button', { name: 'Alinear cuadrícula', exact: true }).click()
  await page.getByRole('button', { name: method, exact: true }).click()
  await page.getByRole('button', { name: 'Ver mapa', exact: true }).click()
}
async function magnify(page: Page) {
  for (let i = 0; i < 12 && (await geometry(page)).zoom < 4; i++) await page.getByRole('button', { name: 'Acercar para alinear' }).click()
}
async function pair(page: Page, touch = false) {
  await mark(page, { x: 420, y: 532 }, touch)
  await mark(page, { x: 436, y: 548 }, touch)
  await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeEnabled()
}
async function wheel(page: Page, deltaY: number) {
  const { box } = await geometry(page)
  if (test.info().project.name === 'iphone') {
    // Mobile WebKit automation cannot inject a native wheel or multi-touch gesture.
    await surface(page).dispatchEvent('wheel', { deltaY, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, cancelable: true })
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const scale = test.info().project.name === 'android' ? test.info().project.use.deviceScaleFactor ?? 1 : 1
    await page.mouse.wheel(0, deltaY * scale)
  }
}
async function syntheticCapture(page: Page) {
  await surface(page).evaluate(element => {
    const ids = new Set<number>()
    element.setPointerCapture = id => { ids.add(id) }
    element.hasPointerCapture = id => ids.has(id)
    element.releasePointerCapture = id => { ids.delete(id) }
  })
}
async function pointer(page: Page, type: string, id: number, point: Point, handle?: number) {
  await (handle === undefined ? surface(page) : handles(page).nth(handle)).dispatchEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 10, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: point.x, clientY: point.y })
}
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).click()
  await page.getByLabel('Nombre', { exact: true }).fill('Exploradora')
  await page.getByRole('button', { name: 'Crear ficha', exact: true }).click()
  await page.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(fileURLToPath(new URL('../fixtures/grid-16px-margins.png', import.meta.url)))
  await expect(page.getByRole('button', { name: 'Alinear cuadrícula', exact: true })).toBeEnabled()
})

test('alignment mouse flow previews 16px cell, applies scale and offset together, and preserves selection and reload', async ({ page }) => {
  const before = await saved(page)
  await open(page); await magnify(page); await pair(page)
  expect(await saved(page)).toEqual(before)
  const points = await picked(page), a = points[0], b = points[1]
  expect(Math.abs(a.x - 420)).toBeLessThan(0.3); expect(Math.abs(a.y - 532)).toBeLessThan(0.3)
  expect(Math.abs(b.x - a.x)).toBeCloseTo(16, 0)
  expect(Math.abs(b.y - a.y)).toBeCloseTo(16, 0)
  await expect(page.getByLabel('Resultado de alineación')).toContainText(`Casilla detectada: ${Math.abs(b.x - a.x).toFixed(1)} × ${Math.abs(b.y - a.y).toFixed(1)} px`)
  const grid = page.locator('.alignment-grid')
  await expect(grid).toBeVisible()
  const proposedScale = Number(await grid.getAttribute('data-scale'))
  expect(proposedScale).toBeCloseTo(4, 1)
  const expectedX = Math.round((before.map!.x + a.x * proposedScale) / 64) * 64 - a.x * proposedScale
  const expectedY = Math.round((before.map!.y + a.y * proposedScale) / 64) * 64 - a.y * proposedScale
  expect(Number(await grid.getAttribute('data-map-x'))).toBeCloseTo(expectedX, 8)
  expect(Number(await grid.getAttribute('data-map-y'))).toBeCloseTo(expectedY, 8)
  expect(proposedScale).toBeCloseTo(64 / Math.sqrt(Math.abs(b.x - a.x) * Math.abs(b.y - a.y)), 8)
  await page.screenshot({ path: `test-results/alignment-preview-${test.info().project.name}.png` })
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click()
  const after = await saved(page)
  expect(after.map).toEqual({ ...before.map, scale: proposedScale, x: expectedX, y: expectedY })
  expect(after.tokens).toEqual(before.tokens)
  await expect(page.getByRole('region', { name: 'Ficha seleccionada' })).toContainText('Exploradora')
  await page.reload(); expect(await saved(page)).toEqual(after)
  await expect(page.locator('.map-image')).toBeVisible()
})

test('alignment retry and cancel restore exact state; normal tools are inaccessible and Escape retains token selection', async ({ page }) => {
  const before = await saved(page)
  await open(page); await magnify(page); await pair(page)
  await expect(page.getByRole('button', { name: 'Limpiar', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Medir', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Escala del mapa en porcentaje')).toHaveCount(0)
  await expect(page.locator('.token')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(handles(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeDisabled()
  await pair(page)
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  expect(await saved(page)).toEqual(before)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
  await open(page); await magnify(page); await pair(page)
  await surface(page).focus(); await page.keyboard.press('Escape')
  await expect(surface(page)).toHaveCount(0)
  expect(await saved(page)).toEqual(before)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
})

test('alignment handles support mouse and keyboard fine adjustment, invalid squares and interrupted drags', async ({ page }) => {
  await open(page); await magnify(page); await pair(page)
  const original = await picked(page), p = await screen(page, original[1]), { zoom } = await geometry(page)
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + zoom * 3, p.y, { steps: 3 }); await page.mouse.up()
  await expect(page.getByRole('alert')).toContainText('casilla cuadrada')
  await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeDisabled()
  const handleBox = (await handles(page).nth(1).boundingBox())!
  expect(Math.abs(handleBox.y + handleBox.height / 2 - p.y)).toBeLessThan(1)
  await handles(page).nth(1).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')
  await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeEnabled()
  await syntheticCapture(page)
  const initial = await picked(page), start = await screen(page, initial[0])
  await pointer(page, 'pointerdown', 10, start, 0)
  await pointer(page, 'pointermove', 10, { x: start.x - 12, y: start.y - 12 })
  await expect.poll(() => picked(page)).not.toEqual(initial)
  await pointer(page, 'pointercancel', 10, { x: start.x - 12, y: start.y - 12 })
  await expect.poll(() => picked(page)).toEqual(initial)
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeEnabled()
})

test('alignment wheel and two pointer pinch preserve source points; a second finger cancels handle adjustment', async ({ page }) => {
  await open(page); await magnify(page); await pair(page); await syntheticCapture(page)
  const initial = await picked(page), before = await saved(page), start = await geometry(page)
  await wheel(page, -100)
  await expect.poll(async () => (await geometry(page)).zoom).toBeGreaterThan(start.zoom)
  expect((await geometry(page)).camera.x).toBeCloseTo(start.camera.x, 1)
  expect((await geometry(page)).camera.y).toBeCloseTo(start.camera.y, 1)
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
  expect(await picked(page)).toEqual(initial)
  const p = await screen(page, initial[0])
  await pointer(page, 'pointerdown', 10, p, 0)
  await pointer(page, 'pointermove', 10, { x: p.x - 20, y: p.y - 20 })
  await expect.poll(() => picked(page)).not.toEqual(initial)
  const duringDrag = await geometry(page)
  await wheel(page, -100)
  expect((await geometry(page)).zoom).toBe(duringDrag.zoom)
  await pointer(page, 'pointerdown', 11, { x: p.x + 100, y: p.y - 20 })
  await expect.poll(() => picked(page)).toEqual(initial)
  await pointer(page, 'pointermove', 11, { x: p.x + 130, y: p.y - 20 })
  await expect.poll(async () => (await geometry(page)).zoom).toBeGreaterThan(duringDrag.zoom)
  await pointer(page, 'pointerup', 11, { x: p.x + 130, y: p.y - 20 })
  await pointer(page, 'pointermove', 10, { x: p.x - 10, y: p.y - 10 })
  await pointer(page, 'pointerup', 10, { x: p.x - 10, y: p.y - 10 })
  expect(await picked(page)).toEqual(initial)
  expect(await saved(page)).toEqual(before)
  await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeEnabled()
})

test('known map size ignores margins and aligns a marked reference intersection', async ({ page }) => {
  const before = await saved(page)
  await open(page, 'Sé el tamaño')
  await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeDisabled()
  await page.getByLabel('Columnas', { exact: true }).fill('51')
  await page.getByLabel('Filas', { exact: true }).fill('65')
  await page.getByRole('button', { name: 'Ver mapa', exact: true }).click()
  await mark(page, { x: 836, y: 1060 }); await mark(page, { x: 20, y: 20 })
  await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeEnabled()
  const points = await picked(page)
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click()
  const result = await saved(page)
  expect(result.map!.scale).toBeCloseTo(4, 1)
  const a = points[0], m = result.map!
  expect((m.x + a.x * m.scale) / 64).toBeCloseTo(Math.round((before.map!.x + a.x * m.scale) / 64), 8)
  expect((m.y + a.y * m.scale) / 64).toBeCloseTo(Math.round((before.map!.y + a.y * m.scale) / 64), 8)
})

test('alignment storage failure retains the original map and permits retry or cancel', async ({ page }) => {
  const before = await saved(page)
  await open(page); await magnify(page); await pair(page)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'QuotaExceededError') } })
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar la alineación')
  expect(await saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  expect(await saved(page)).toEqual(before)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
})

test('alignment controls and canvas remain usable in small portrait and landscape viewports', async ({ page }) => {
  await open(page)
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: 'Ver mapa', exact: true }).click()
    await magnify(page); await pair(page)
    const { box } = await geometry(page)
    expect(box.height).toBeGreaterThan(100)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const button of await page.locator('.alignment button:visible').all()) {
      const b = (await button.boundingBox())!
      // Firefox may return 43.999996 for a transformed 44px handle.
      expect(b.width).toBeGreaterThanOrEqual(44 - 0.001); expect(b.height).toBeGreaterThanOrEqual(44 - 0.001)
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(b.y + b.height).toBeLessThanOrEqual(viewport.height + 1)
    }
    await page.screenshot({ path: `test-results/alignment-${viewport.width}-${test.info().project.name}.png` })
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
  }
})

test('mobile tap alignment has 44px handles, touch adjustment, cancellation and apply', async ({ page }) => {
  await open(page); await magnify(page); await pair(page, true); await syntheticCapture(page)
  const before = await picked(page), start = await screen(page, before[1]), { zoom } = await geometry(page)
  await pointer(page, 'pointerdown', 10, start, 1)
  await pointer(page, 'pointermove', 10, { x: start.x + zoom, y: start.y + zoom })
  await pointer(page, 'pointerup', 10, { x: start.x + zoom, y: start.y + zoom })
  const after = await picked(page)
  expect(after[1].x).toBeCloseTo(before[1].x + 1, 6)
  expect(after[1].y).toBeCloseTo(before[1].y + 1, 6)
  await page.getByRole('button', { name: 'Aplicar', exact: true }).tap()
  expect((await saved(page)).map!.scale).toBeCloseTo(64 / 17, 1)
  await expect(page.getByRole('region', { name: 'Ficha seleccionada' })).toContainText('Exploradora')
})

test('Android trusted touch alignment selects, adjusts and pinches without altering chosen points', async ({ page }) => {
  await open(page); await magnify(page); await pair(page, true)
  const client = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { id: number; x: number; y: number }[]) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  const before = await picked(page), p = await screen(page, before[1]), { zoom } = await geometry(page)
  await touch('touchStart', [{ id: 0, ...p }])
  await touch('touchMove', [{ id: 0, x: p.x + zoom * 2, y: p.y + zoom * 2 }])
  await touch('touchEnd', [])
  const adjusted = await picked(page)
  expect(adjusted[1].x - before[1].x).toBeCloseTo(2, 1)
  const { box, camera } = await geometry(page), x = box.x + box.width / 2, y = box.y + box.height / 2
  await touch('touchStart', [{ id: 0, x: x - 90, y }, { id: 1, x: x + 90, y }])
  await touch('touchMove', [{ id: 0, x: x - 120, y: y + 10 }, { id: 1, x: x + 120, y: y + 10 }])
  await touch('touchEnd', [])
  expect((await geometry(page)).zoom).toBeGreaterThan(zoom)
  const afterPinch = await geometry(page)
  expect(afterPinch.camera.x).toBeCloseTo(camera.x, 1)
  expect(afterPinch.camera.y + 10 / afterPinch.zoom).toBeCloseTo(camera.y, 1)
  expect(await picked(page)).toEqual(adjusted)
  await page.getByRole('button', { name: 'Aplicar', exact: true }).tap()
  await expect(page.getByRole('region', { name: 'Ficha seleccionada' })).toContainText('Exploradora')
  await client.detach()
})
