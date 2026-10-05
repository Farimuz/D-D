import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { BoardState, Point } from '../../src/state/model'
import { screenToWorld } from '../../src/map/geometry'

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
async function create(page: Page, name = 'Goblin') {
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Crear ficha', exact: true }).click()
}
async function box(page: Page) { return (await page.locator('.board').boundingBox())! }
async function pointer(page: Page, type: string, id: number, point: Point, target = '.board') {
  await page.locator(target).dispatchEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 10, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: point.x, clientY: point.y })
}
async function syntheticCapture(page: Page) {
  // WebKit's public automation API lacks multi-touch injection. Exercise two Pointer Events explicitly.
  await page.locator('.board').waitFor()
  await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.board')!
    const captured = new Set<number>()
    board.setPointerCapture = id => { captured.add(id) }
    board.hasPointerCapture = id => captured.has(id)
    board.releasePointerCapture = id => { captured.delete(id) }
  })
}
async function pinch(page: Page, from = 100, to = 180, drift = { x: 0, y: 0 }) {
  const b = await box(page)
  const center = { x: b.x + b.width / 2, y: b.y + Math.min(210, b.height / 2) }
  await pointer(page, 'pointerdown', 10, { x: center.x - from / 2, y: center.y })
  await pointer(page, 'pointerdown', 11, { x: center.x + from / 2, y: center.y })
  await pointer(page, 'pointermove', 10, { x: center.x - to / 2 + drift.x, y: center.y + drift.y })
  await pointer(page, 'pointermove', 11, { x: center.x + to / 2 + drift.x, y: center.y + drift.y })
  await pointer(page, 'pointerup', 11, { x: center.x + to / 2 + drift.x, y: center.y + drift.y })
  await pointer(page, 'pointerup', 10, { x: center.x - to / 2 + drift.x, y: center.y + drift.y })
  return { center, destination: { x: center.x + drift.x, y: center.y + drift.y } }
}
async function wheel(page: Page, deltaY: number) {
  if (test.info().project.name === 'iphone') {
    const b = await box(page)
    await page.locator('.board').dispatchEvent('wheel', { deltaY, deltaMode: 0, clientX: b.x + 68, clientY: b.y + 152, cancelable: true })
  } else {
    // Chromium mobile converts the injected wheel delta by its device scale factor.
    const scale = test.info().project.name === 'android' ? test.info().project.use.deviceScaleFactor ?? 1 : 1
    await page.mouse.wheel(0, deltaY * scale)
  }
}
async function image(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c9b99c'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#675b4c'; ctx.lineWidth = 20; ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  await page.getByLabel('Archivo del mapa', { exact: true }).setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled()
}
test.beforeEach(async ({ page }) => { await page.goto('/') })

test('wheel zoom is smooth, anchored, below fifty percent, capped and persisted exactly', async ({ page }) => {
  await create(page)
  const token = page.getByRole('button', { name: 'Ficha Goblin', exact: true })
  const b = await box(page), anchor = { x: 68, y: 152 }, size = { x: b.width, y: b.height }
  const before = await saved(page), world = screenToWorld(anchor, size, before.camera, before.zoom)
  await page.mouse.move(b.x + anchor.x, b.y + anchor.y)
  await wheel(page, -100)
  await expect.poll(async () => (await saved(page)).zoom).toBeGreaterThan(1)
  let data = await saved(page)
  expect(data.zoom).toBeLessThan(1.3)
  let under = screenToWorld(anchor, size, data.camera, data.zoom)
  expect(under.x).toBeCloseTo(world.x, 6); expect(under.y).toBeCloseTo(world.y, 6)
  for (let i = 0; i < 8; i++) await wheel(page, 120)
  await expect.poll(async () => (await saved(page)).zoom).toBeLessThan(0.5)
  data = await saved(page)
  under = screenToWorld(anchor, size, data.camera, data.zoom)
  expect(under.x).toBeCloseTo(world.x, 5); expect(under.y).toBeCloseTo(world.y, 5)
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
  await expect(token).toHaveAttribute('aria-pressed', 'true')
  await page.reload(); expect((await saved(page)).zoom).toBe(data.zoom)
  await page.mouse.move(b.x + anchor.x, b.y + anchor.y)
  for (let i = 0; i < 24; i++) await wheel(page, -120)
  await expect.poll(async () => (await saved(page)).zoom).toBe(2.5)
})

test('hiding the page saves the visible wheel zoom before its delayed storage flush', async ({ page }) => {
  await create(page)
  const b = await box(page)
  // A single coalesced wheel event is spread over frames, without discarding its delta.
  await page.locator('.board').dispatchEvent('wheel', { deltaY: 480, deltaMode: 0, clientX: b.x + 68, clientY: b.y + 152, cancelable: true })
  await page.evaluate(() => new Promise<void>(resolve => {
    let frames = 0
    const frame = () => { if (++frames === 6) resolve(); else requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  }))
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  const data = await saved(page)
  expect(data.zoom).toBeCloseTo(Math.exp(-0.96), 8)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
  await page.reload()
  expect((await saved(page)).zoom).toBe(data.zoom)
})

test('two pointers zoom and pan around their midpoint with limits and stable selection', async ({ page }) => {
  await create(page); await syntheticCapture(page)
  const before = await saved(page), b = await box(page), size = { x: b.width, y: b.height }
  const anchor = { x: b.width / 2, y: Math.min(210, b.height / 2) }
  const world = screenToWorld(anchor, size, before.camera, before.zoom)
  const result = await pinch(page, 100, 180, { x: 17, y: 14 })
  let data = await saved(page)
  expect(data.zoom).toBeCloseTo(1.8, 8)
  const under = screenToWorld({ x: result.destination.x - b.x, y: result.destination.y - b.y }, size, data.camera, data.zoom)
  expect(under.x).toBeCloseTo(world.x, 7); expect(under.y).toBeCloseTo(world.y, 7)
  expect(data.tokens).toEqual(before.tokens)
  await pinch(page, 200, 20); data = await saved(page)
  expect(data.zoom).toBeCloseTo(0.18, 8)
  await page.reload(); expect((await saved(page)).zoom).toBe(data.zoom)
  await syntheticCapture(page); await page.locator('.token').focus()
  await pinch(page, 10, 300); expect((await saved(page)).zoom).toBe(2.5)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
})

test('lifting one pinch pointer continues camera pan without resuming a token drag', async ({ page }) => {
  await create(page); await syntheticCapture(page)
  const b = await box(page), before = await saved(page), x = b.width / 2, y = b.y + 170
  await pointer(page, 'pointerdown', 10, { x: x - 50, y })
  await pointer(page, 'pointerdown', 11, { x: x + 50, y })
  await pointer(page, 'pointermove', 10, { x: x - 90, y })
  await pointer(page, 'pointermove', 11, { x: x + 90, y })
  await pointer(page, 'pointerup', 11, { x: x + 90, y })
  const pinched = await saved(page)
  await pointer(page, 'pointermove', 10, { x: x - 70, y: y + 10 })
  await pointer(page, 'pointerup', 10, { x: x - 70, y: y + 10 })
  const panned = await saved(page)
  expect(panned.zoom).toBeCloseTo(1.8, 8)
  expect(panned.camera.x).toBeCloseTo(pinched.camera.x - 20 / 1.8, 7)
  expect(panned.camera.y).toBeCloseTo(pinched.camera.y - 10 / 1.8, 7)
  expect(panned.tokens).toEqual(before.tokens)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
})

test('camera pan hands off to pinch using the displayed camera without a jump', async ({ page }) => {
  await create(page); await syntheticCapture(page)
  const b = await box(page), start = { x: 70, y: b.y + 160 }, moved = { x: 100, y: b.y + 180 }
  const before = await saved(page), size = { x: b.width, y: b.height }
  await pointer(page, 'pointerdown', 10, start)
  await pointer(page, 'pointermove', 10, moved)
  const other = { x: 200, y: moved.y }
  await pointer(page, 'pointerdown', 11, other)
  const camera = { x: before.camera.x - 30, y: before.camera.y - 20 }
  const anchor = { x: 150 - b.x, y: moved.y - b.y }
  const world = screenToWorld(anchor, size, camera, before.zoom)
  await pointer(page, 'pointermove', 11, { x: 250, y: moved.y })
  await pointer(page, 'pointerup', 11, { x: 250, y: moved.y })
  await pointer(page, 'pointerup', 10, moved)
  const after = await saved(page)
  const under = screenToWorld({ x: 175 - b.x, y: moved.y - b.y }, size, after.camera, after.zoom)
  expect(after.zoom).toBeCloseTo(1.5, 8)
  expect(under.x).toBeCloseTo(world.x, 7); expect(under.y).toBeCloseTo(world.y, 7)
  expect(after.tokens).toEqual(before.tokens)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
})

test('selection survives empty click, pan, wheel, measurement and switches only explicitly', async ({ page }) => {
  await create(page, 'Goblin'); await create(page, 'Maga')
  const first = page.getByRole('button', { name: 'Ficha Goblin', exact: true }), second = page.getByRole('button', { name: 'Ficha Maga', exact: true })
  await first.click(); const b = await box(page)
  await page.mouse.click(b.x + 40, b.y + 140)
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(b.x + 40, b.y + 140); await page.mouse.down(); await page.mouse.move(b.x + 70, b.y + 150); await page.mouse.up()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await wheel(page, 60); await expect(page.getByRole('button', { name: 'Medir', exact: true })).toBeEnabled()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Medir', exact: true }).click()
  await page.mouse.move(b.x + 40, b.y + 140); await page.mouse.down(); await page.mouse.move(b.x + 100, b.y + 140); await page.mouse.up()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Ficha seleccionada' })).toContainText('Goblin')
  await second.click(); await expect(second).toHaveAttribute('aria-pressed', 'true'); await expect(first).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Deseleccionar ficha' }).click(); await expect(second).toHaveAttribute('aria-pressed', 'false')
  await first.click(); await page.getByRole('button', { name: 'Acercar', exact: true }).focus(); await page.keyboard.press('Escape')
  await expect(first).toHaveAttribute('aria-pressed', 'false')
})

test('second finger rolls back token drag; cancellation and a third finger never strand a gesture', async ({ page }) => {
  await create(page); await syntheticCapture(page)
  const before = await saved(page), t = (await page.locator('.token').boundingBox())!
  const start = { x: t.x + t.width / 2, y: t.y + t.height / 2 }
  await pointer(page, 'pointerdown', 10, start, '.token')
  await pointer(page, 'pointermove', 10, { x: start.x + 80, y: start.y - 30 })
  await page.mouse.move(start.x, start.y); await wheel(page, 100)
  expect(await saved(page)).toEqual(before)
  await pointer(page, 'pointerdown', 11, { x: start.x - 80, y: start.y - 30 })
  await pointer(page, 'pointermove', 11, { x: start.x - 120, y: start.y - 50 })
  await pointer(page, 'pointerdown', 12, { x: 30, y: 150 })
  await pointer(page, 'pointerup', 10, { x: start.x + 80, y: start.y - 30 })
  await pointer(page, 'pointercancel', 11, { x: start.x - 120, y: start.y - 50 })
  await pointer(page, 'pointerup', 12, { x: 30, y: 150 })
  expect((await saved(page)).tokens).toEqual(before.tokens)
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
  await pinch(page); expect((await saved(page)).zoom).toBeGreaterThan(1)
  await page.mouse.move(40, 160); await wheel(page, 100)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
})

test('map fitting shows a large map; edit and measurement pinch keep map, tokens and selection intact', async ({ page }) => {
  await create(page); await image(page)
  await page.getByRole('spinbutton', { name: /Escala/ }).fill('1600')
  await page.getByRole('spinbutton', { name: /Escala/ }).press('Tab')
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  const before = await saved(page)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Mapa', exact: true }).click()
  await page.getByRole('button', { name: 'Ver mapa completo', exact: true }).click()
  const fitted = await saved(page)
  expect(fitted.zoom).toBeLessThan(0.5)
  expect(fitted.map).toEqual(before.map); expect(fitted.tokens).toEqual(before.tokens)
  const b = await box(page), img = (await page.locator('.map-image').boundingBox())!
  expect(img.x).toBeGreaterThanOrEqual(b.x + 15)
  expect(img.x + img.width).toBeLessThanOrEqual(b.x + b.width - 15)
  expect(img.y).toBeGreaterThanOrEqual(b.y + 15)
  expect(img.y + img.height).toBeLessThanOrEqual((await page.locator('.bottom-controls').boundingBox())!.y)
  const face = (await page.locator('.token-face').boundingBox())!
  expect(face.width).toBeLessThan(14)
  await page.screenshot({ path: `test-results/fit-map-${test.info().project.name}.png` })
  const originalViewport = page.viewportSize()!
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: 'Mapa', exact: true }).click()
    await page.getByRole('button', { name: 'Ver mapa completo', exact: true }).click()
    const boardBox = await box(page), imageBox = (await page.locator('.map-image').boundingBox())!
    expect(imageBox.x).toBeGreaterThanOrEqual(boardBox.x + 15)
    expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(boardBox.x + boardBox.width - 15)
    expect(imageBox.y).toBeGreaterThanOrEqual(boardBox.y + 15)
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual((await page.locator('.bottom-controls').boundingBox())!.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/fit-map-${viewport.width}-${test.info().project.name}.png` })
  }
  await page.setViewportSize(originalViewport)
  await syntheticCapture(page)
  await page.getByRole('button', { name: 'Mapa', exact: true }).click(); await page.getByRole('button', { name: 'Ajustar mapa' }).click()
  await pinch(page)
  expect((await saved(page)).map).toEqual(before.map); expect((await saved(page)).tokens).toEqual(before.tokens)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await page.getByRole('button', { name: 'Medir', exact: true }).click(); await pinch(page)
  expect((await saved(page)).map).toEqual(before.map); expect((await saved(page)).tokens).toEqual(before.tokens)
  await expect(page.locator('.measurement')).toHaveCount(0)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Ficha seleccionada' })).toContainText('Goblin')
})

test('mobile tap deselection and two Pointer Events preserve touch targets and selection', async ({ page }) => {
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).tap()
  await page.getByLabel('Nombre', { exact: true }).fill('Toque')
  await page.getByRole('button', { name: 'Crear ficha', exact: true }).tap()
  await syntheticCapture(page); await pinch(page, 200, 20)
  const target = (await page.locator('.token').boundingBox())!, face = (await page.locator('.token-face').boundingBox())!
  expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44)
  expect(face.width).toBeLessThan(14)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Deseleccionar ficha' }).tap()
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'false')
})

test('Android trusted touch pinch, one finger pan, token drag and pinch after drag', async ({ page }) => {
  await create(page)
  const client = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: { id: number; x: number; y: number }[]) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  const before = await saved(page), t = (await page.locator('.token').boundingBox())!
  const start = { x: t.x + t.width / 2, y: t.y + t.height / 2 }
  await touch('touchStart', [{ id: 0, ...start }]); await touch('touchMove', [{ id: 0, x: start.x + 64, y: start.y - 64 }]); await touch('touchEnd', [])
  expect((await saved(page)).tokens[0]).toMatchObject({ x: before.tokens[0].x + 1, y: before.tokens[0].y - 1 })
  const b = await box(page), y = b.y + 170, x = b.width / 2
  await touch('touchStart', [{ id: 0, x: x - 50, y }])
  await touch('touchStart', [{ id: 0, x: x - 50, y }, { id: 1, x: x + 50, y }])
  await touch('touchMove', [{ id: 0, x: x - 90, y: y + 12 }, { id: 1, x: x + 90, y: y + 12 }])
  await touch('touchEnd', [])
  await touch('touchStart', [{ id: 0, x: x - 90, y: y + 12 }])
  await touch('touchMove', [{ id: 0, x: x - 70, y: y + 22 }]); await touch('touchEnd', [])
  const after = await saved(page)
  expect(after.zoom).toBeCloseTo(1.8, 2)
  expect(after.tokens[0]).toMatchObject({ x: before.tokens[0].x + 1, y: before.tokens[0].y - 1 })
  expect(after.camera.x).toBeCloseTo(before.camera.x - 20 / after.zoom, 2)
  await expect(page.locator('.token')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
  await client.detach()
})
