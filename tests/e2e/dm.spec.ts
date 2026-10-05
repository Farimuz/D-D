import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import type { BoardState, Point, Rectangle } from '../../src/state/model'
import { cellCenter, worldToScreen } from '../../src/map/geometry'
import { contains } from '../../src/map/fog'

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
const raw = (page: Page) => page.evaluate(() => localStorage.getItem('dnd.local-board.v1'))
const surface = (page: Page) => page.locator('.board')
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
async function create(page: Page, name: string) {
  await button(page, '＋ Ficha').click()
  await page.getByLabel('Nombre', { exact: true }).fill(name)
  await button(page, 'Crear ficha').click()
  await expect(button(page, `Ficha ${name}`)).toBeVisible()
}
async function importMap(page: Page) {
  await page.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(fileURLToPath(new URL('../fixtures/grid-16px-margins.png', import.meta.url)))
  await expect(button(page, 'Listo')).toBeEnabled()
  await button(page, 'Listo').click()
}
async function geometry(page: Page) {
  const box = (await surface(page).boundingBox())!
  const zoom = Number(await surface(page).getAttribute('data-zoom'))
  const camera = { x: Number(await surface(page).getAttribute('data-camera-x')), y: Number(await surface(page).getAttribute('data-camera-y')) }
  return { box, zoom, camera }
}
async function screen(page: Page, world: Point) {
  const { box, camera, zoom } = await geometry(page)
  const p = worldToScreen(world, { x: box.width, y: box.height }, camera, zoom)
  return { x: box.x + p.x, y: box.y + p.y }
}
async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up()
}
async function safeRectangle(page: Page): Promise<Rectangle> {
  const { zoom, camera } = await geometry(page)
  // The central open canvas stays between top tools and the bottom toolbar.
  return { x: camera.x - 70 / zoom, y: camera.y - 65 / zoom, width: 140 / zoom, height: 80 / zoom }
}
async function draw(page: Page, r: Rectangle) {
  await drag(page, await screen(page, r), await screen(page, { x: r.x + r.width, y: r.y + r.height }))
}
async function syntheticCapture(page: Page) {
  await surface(page).evaluate(element => {
    const ids = new Set<number>()
    element.setPointerCapture = id => { ids.add(id) }
    element.hasPointerCapture = id => ids.has(id)
    element.releasePointerCapture = id => { ids.delete(id) }
  })
}
async function pointer(page: Page, type: string, id: number, p: Point) {
  await surface(page).dispatchEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 10, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y })
}
async function pinch(page: Page) {
  await syntheticCapture(page)
  const { box } = await geometry(page), y = box.y + box.height / 2, x = box.x + box.width / 2
  await pointer(page, 'pointerdown', 10, { x: x - 40, y })
  await pointer(page, 'pointerdown', 11, { x: x + 40, y })
  await pointer(page, 'pointermove', 10, { x: x - 60, y: y + 8 })
  await pointer(page, 'pointermove', 11, { x: x + 60, y: y + 8 })
  await pointer(page, 'pointerup', 11, { x: x + 60, y: y + 8 })
  await pointer(page, 'pointerup', 10, { x: x - 60, y: y + 8 })
}
async function wheel(page: Page) {
  const { box } = await geometry(page), p = { x: box.x + 55, y: box.y + box.height / 2 }
  if (test.info().project.name === 'iphone') await surface(page).dispatchEvent('wheel', { deltaY: -80, clientX: p.x, clientY: p.y, cancelable: true })
  else {
    await page.mouse.move(p.x, p.y)
    await page.mouse.wheel(0, -80 * (test.info().project.name === 'android' ? test.info().project.use.deviceScaleFactor ?? 1 : 1))
  }
}

test.beforeEach(async ({ page }) => { await page.goto('/') })

test('fog imports, previews only until release, persists, subtracts a hole, and hides or shows the complete map', async ({ page }) => {
  await importMap(page); await button(page, 'Niebla').click()
  const before = await saved(page), r = await safeRectangle(page)
  const from = await screen(page, r), to = await screen(page, { x: r.x + r.width, y: r.y + r.height })
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 })
  await expect(page.locator('.fog-draft')).toBeVisible()
  expect(await saved(page)).toEqual(before)
  await page.mouse.up()
  await expect.poll(async () => (await saved(page)).fog?.length).toBe(1)
  const covered = (await saved(page)).fog![0]
  expect(covered.x).toBeCloseTo(r.x, 3); expect(covered.width).toBeCloseTo(r.width, 3)
  await page.reload(); expect((await saved(page)).fog).toEqual([covered])
  await button(page, 'Niebla').click(); await button(page, 'Revelar').click()
  const cut = { x: covered.x + covered.width / 4, y: covered.y + covered.height / 4, width: covered.width / 2, height: covered.height / 2 }
  await draw(page, cut)
  await expect.poll(async () => (await saved(page)).fog?.length).toBe(4)
  const parts = (await saved(page)).fog!
  expect(parts.some(part => contains(part, { x: cut.x + cut.width / 2, y: cut.y + cut.height / 2 }))).toBe(false)
  expect(parts.reduce((sum, part) => sum + part.width * part.height, 0)).toBeCloseTo(covered.width * covered.height * .75, 2)
  await button(page, 'Ocultar todo').click()
  const full = await saved(page), map = full.map!
  expect(full.fog![0]).toMatchObject({ x: map.x, y: map.y, width: map.width * map.scale, height: map.height * map.scale })
  await button(page, 'Mostrar todo').click(); expect((await saved(page)).fog).toEqual([])
  await page.reload(); expect((await saved(page)).fog).toEqual([])
})

test('DM-only and covered public tokens disappear only in player projection; selection and visibility persist', async ({ page }) => {
  await create(page, 'Bajo niebla'); await create(page, 'Pública'); await create(page, 'Secreto')
  await page.getByLabel('Visible para jugadores', { exact: true }).uncheck()
  await expect(button(page, 'Ficha Secreto')).toHaveClass(/dm-only/)
  expect((await saved(page)).tokens.find(t => t.name === 'Secreto')!.visible).toBe(false)
  await button(page, 'Ficha Bajo niebla').click()
  const center = cellCenter((await saved(page)).tokens.find(t => t.name === 'Bajo niebla')!)
  await button(page, 'Niebla').click(); await draw(page, { x: center.x - 16, y: center.y - 16, width: 32, height: 32 })
  await button(page, 'Listo').click()
  const before = await raw(page)
  await button(page, 'Vista jugadores').click()
  await expect(page.getByRole('img', { name: 'Ficha Pública', exact: true })).toBeVisible()
  await expect(page.getByLabel('Ficha Secreto', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Ficha Bajo niebla', { exact: true })).toHaveCount(0)
  expect(await page.locator('.fog-cover').evaluate(e => getComputedStyle(e).fillOpacity)).toBe('1')
  await button(page, 'Volver a DM').click()
  await expect(button(page, 'Ficha Bajo niebla')).toHaveAttribute('aria-pressed', 'true')
  await expect(button(page, 'Ficha Secreto')).toBeVisible()
  expect(await raw(page)).toBe(before)
  await page.reload(); await button(page, 'Ficha Secreto').click()
  await expect(page.getByLabel('Visible para jugadores', { exact: true })).not.toBeChecked()
  await page.getByLabel('Visible para jugadores', { exact: true }).check()
  await button(page, 'Vista jugadores').click()
  await expect(page.getByRole('img', { name: 'Ficha Secreto', exact: true })).toBeVisible()
})

test('player preview hides DM controls and cannot persist edits, pan, wheel, pinch, buttons or keyboard navigation', async ({ page }) => {
  await create(page, 'Exploradora'); await importMap(page)
  const before = await raw(page), dmView = await geometry(page)
  await button(page, 'Vista jugadores').click()
  for (const name of ['＋ Ficha', 'Mapa', 'Niebla', 'Medir', 'Limpiar', 'Nombre', 'Duplicar', 'Eliminar']) await expect(button(page, name)).toHaveCount(0)
  await expect(page.getByLabel('Archivo del mapa', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Visible para jugadores', { exact: true })).toHaveCount(0)
  const token = page.getByRole('img', { name: 'Ficha Exploradora', exact: true }), t = (await token.boundingBox())!
  // Dragging where a player sees a token navigates, never moves that token.
  await drag(page, { x: t.x + t.width / 2, y: t.y + t.height / 2 }, { x: t.x + t.width / 2 + 20, y: t.y + t.height / 2 - 10 })
  await expect.poll(async () => (await geometry(page)).camera.x).not.toBe(dmView.camera.x)
  expect(await raw(page)).toBe(before)
  const panned = await geometry(page); await wheel(page)
  await expect.poll(async () => (await geometry(page)).zoom).toBeGreaterThan(panned.zoom)
  await expect(button(page, 'Volver a DM')).toBeEnabled()
  const wheeled = await geometry(page); await pinch(page)
  await expect.poll(async () => (await geometry(page)).zoom).toBeCloseTo(wheeled.zoom * 1.5, 5)
  await button(page, 'Alejar').click(); await button(page, 'Centrar vista').click()
  await surface(page).focus(); await page.keyboard.press('Delete'); await page.keyboard.press('Backspace'); await page.keyboard.press('ArrowLeft')
  expect(await raw(page)).toBe(before)
  await button(page, 'Volver a DM').click()
  await expect(button(page, 'Ficha Exploradora')).toHaveAttribute('aria-pressed', 'true')
  expect((await geometry(page)).camera).toEqual(dmView.camera)
  expect(await raw(page)).toBe(before)
  await button(page, 'Vista jugadores').click(); await surface(page).focus(); await page.keyboard.press('Escape')
  await expect(button(page, 'Ficha Exploradora')).toHaveAttribute('aria-pressed', 'true')
  await button(page, 'Vista jugadores').click(); await page.reload()
  await expect(button(page, 'Vista jugadores')).toBeVisible()
  await expect(button(page, 'Volver a DM')).toHaveCount(0)
  expect(await raw(page)).toBe(before)
})

test('fog interruptions roll back, two fingers cancel drawing, and navigation, measurement and map alignment retain world regions', async ({ page }) => {
  await create(page, 'DM'); await importMap(page); await button(page, 'Niebla').click()
  await draw(page, await safeRectangle(page)); const before = await saved(page)
  const r = await safeRectangle(page), from = await screen(page, r), to = await screen(page, { x: r.x + r.width, y: r.y + r.height })
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y)
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up()
  expect(await saved(page)).toEqual(before)
  await pinch(page)
  await expect.poll(async () => (await saved(page)).zoom).toBeGreaterThan(before.zoom)
  expect((await saved(page)).fog).toEqual(before.fog)
  await button(page, 'Navegar').click()
  const { box } = await geometry(page), p = { x: box.x + 40, y: box.y + box.height / 2 }
  await drag(page, p, { x: p.x + 30, y: p.y + 15 })
  await wheel(page); await expect(button(page, 'Listo')).toBeEnabled()
  expect((await saved(page)).fog).toEqual(before.fog)
  await button(page, 'Listo').click(); await button(page, 'Medir').click()
  await drag(page, p, { x: p.x + 64, y: p.y }); await expect(page.getByLabel('Distancia', { exact: true })).toBeVisible()
  expect((await saved(page)).fog).toEqual(before.fog)
  await button(page, 'Listo').click(); await button(page, 'Mapa').click(); await button(page, 'Ajustar mapa').click()
  await button(page, 'Alinear cuadrícula').click(); await button(page, 'Cancelar').click()
  expect((await saved(page)).fog).toEqual(before.fog)
  await expect(button(page, 'Ficha DM')).toHaveAttribute('aria-pressed', 'true')
})

test('legacy boards are public without a load write; hide all without a map covers used cells and fog quota failures warn', async ({ page }) => {
  const legacy = { version: 1, tokens: [{ id: 'a', name: 'Antigua', x: 0, y: 0 }], camera: { x: 32, y: 32 }, zoom: 1 }
  const old = JSON.stringify(legacy)
  await page.evaluate(value => localStorage.setItem('dnd.local-board.v1', value), old); await page.reload()
  await button(page, 'Ficha Antigua').click(); await expect(page.getByLabel('Visible para jugadores', { exact: true })).toBeChecked()
  await button(page, 'Vista jugadores').click(); await expect(page.getByRole('img', { name: 'Ficha Antigua', exact: true })).toBeVisible()
  expect(await raw(page)).toBe(old)
  await button(page, 'Volver a DM').click(); await button(page, 'Niebla').click(); await button(page, 'Ocultar todo').click()
  expect(contains((await saved(page)).fog![0], { x: 32, y: 32 })).toBe(true)
  const durable = await raw(page)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError') } })
  await button(page, 'Mostrar todo').click(); await expect(page.getByRole('alert')).toContainText('No se pudo guardar')
  await expect(page.locator('.fog')).toHaveAttribute('data-region-count', '0')
  expect(await raw(page)).toBe(durable)
})

test('fog and preview controls remain touch-sized in narrow portrait and landscape layouts with open drawing space', async ({ page }) => {
  await importMap(page); await button(page, 'Niebla').click()
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size)
    for (const name of ['Ocultar', 'Revelar', 'Navegar', 'Ocultar todo', 'Mostrar todo', 'Listo', 'Niebla', 'Vista jugadores']) {
      const box = (await button(page, name).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44 - .001); expect(box.height).toBeGreaterThanOrEqual(44 - .001)
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + .001); expect(box.y + box.height).toBeLessThanOrEqual(size.height + .001)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    const { box } = await geometry(page), center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    expect(await page.evaluate(p => Boolean(document.elementFromPoint(p.x, p.y)?.closest('.board')), center)).toBe(true)
    await page.screenshot({ path: `test-results/fog-layout-${size.width}-${test.info().project.name}.png` })
  }
})

test('mobile tap fog creates and reveals via touch, cancels incomplete rectangles and navigates player preview', async ({ page }) => {
  await importMap(page)
  await button(page, 'Vista jugadores').tap(); await expect(button(page, 'Volver a DM')).toBeVisible()
  await button(page, 'Volver a DM').tap(); await button(page, 'Niebla').tap()
  const r = await safeRectangle(page), from = await screen(page, r), to = await screen(page, { x: r.x + r.width, y: r.y + r.height })
  const android = test.info().project.name === 'android'
  const client = android ? await page.context().newCDPSession(page) : null
  if (!client) await syntheticCapture(page)
  async function touch(a: Point, b: Point, cancel = false) {
    if (client) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, ...a }] })
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, ...b }] })
      await client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
    } else {
      await pointer(page, 'pointerdown', 10, a); await pointer(page, 'pointermove', 10, b)
      await pointer(page, cancel ? 'pointercancel' : 'pointerup', 10, b)
    }
  }
  await touch(from, to)
  await expect.poll(async () => (await saved(page)).fog?.length).toBe(1)
  const covered = await saved(page)
  await touch(from, { x: to.x + 20, y: to.y + 20 }, true)
  expect(await saved(page)).toEqual(covered)
  await button(page, 'Revelar').tap()
  await touch({ x: from.x + 35, y: from.y + 20 }, { x: to.x - 35, y: to.y - 20 })
  await expect.poll(async () => (await saved(page)).fog?.length).toBe(4)
  await button(page, 'Vista jugadores').tap()
  await expect(button(page, 'Volver a DM')).toBeVisible()
  const durable = await raw(page), initial = await geometry(page)
  if (!client) await syntheticCapture(page)
  await touch(from, { x: from.x + 20, y: from.y + 10 })
  await expect.poll(async () => (await geometry(page)).camera.x).not.toBe(initial.camera.x)
  if (client) {
    const { box } = await geometry(page), x = box.x + box.width / 2, y = box.y + box.height / 2
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: x - 40, y }, { id: 1, x: x + 40, y }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: x - 60, y }, { id: 1, x: x + 60, y }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else await pinch(page)
  await expect.poll(async () => (await geometry(page)).zoom).toBeGreaterThan(initial.zoom)
  expect(await raw(page)).toBe(durable)
  await button(page, 'Volver a DM').tap(); await expect(button(page, 'Niebla')).toBeVisible()
  await client?.detach()
})
