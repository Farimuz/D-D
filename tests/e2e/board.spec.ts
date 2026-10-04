import { test as base, expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
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

async function create(page: Page, name: string) {
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Crear ficha', exact: true }).click()
  await expect(page.getByRole('button', { name: `Ficha ${name}`, exact: true })).toBeVisible()
}

async function saved(page: Page): Promise<BoardState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('dnd.local-board.v1')!))
}

async function middle(locator: Locator) {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function drag(page: Page, locator: Locator, dx: number, dy: number) {
  const start = await middle(locator)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => { await page.goto('/') })

test('create, select, drag, snap, pan, reload and delete without camera conflict', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Mesa cuadriculada' })).toBeVisible()
  await create(page, 'Arannis')
  await create(page, 'Juan Pérez')
  await create(page, 'Goblin')
  await expect(page.getByRole('button', { name: 'Ficha Juan Pérez', exact: true })).toHaveText('JP')
  const token = page.getByRole('button', { name: 'Ficha Arannis', exact: true })
  await token.click()
  await expect(token).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Ficha seleccionada' })).toContainText('Arannis')
  const before = await saved(page)
  await drag(page, token, 91, -73)
  let after = await saved(page)
  const original = before.tokens.find(item => item.name === 'Arannis')!
  expect(after.tokens.find(item => item.name === 'Arannis')).toMatchObject({ x: original.x + 1, y: original.y - 1 })
  expect(after.camera).toEqual(before.camera)
  const boardBox = (await page.getByRole('region', { name: 'Mesa cuadriculada' }).boundingBox())!
  await page.mouse.move(boardBox.x + 35, boardBox.y + 110)
  await page.mouse.down()
  await page.mouse.move(boardBox.x + 99, boardBox.y + 146, { steps: 6 })
  await page.mouse.up()
  const panned = await saved(page)
  expect(panned.camera).toEqual({ x: after.camera.x - 64, y: after.camera.y - 36 })
  expect(panned.tokens).toEqual(after.tokens)
  await page.reload()
  expect(await saved(page)).toEqual(panned)
  await expect(page.getByRole('button', { name: 'Ficha Arannis', exact: true })).toHaveAttribute('data-cell-x', String(original.x + 1))
  await token.click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Eliminar Arannis' }).click()
  await expect(token).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Eliminar Arannis' }).click()
  await expect(token).toHaveCount(0)
  after = await saved(page)
  expect(after.tokens).toHaveLength(2)
  await page.reload()
  await expect(token).toHaveCount(0)
  await page.screenshot({ path: `test-results/board-${test.info().project.name}.png` })
})

test('zoom respects limits; drag uses zoom and center restores the selected token', async ({ page }) => {
  await create(page, 'Maga')
  const token = page.getByRole('button', { name: 'Ficha Maga', exact: true })
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Acercar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Acercar', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Nivel de zoom')).toHaveText('250%')
  await drag(page, token, 160, 0)
  let data = await saved(page)
  expect(data.tokens[0].x).toBe(1)
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Alejar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Alejar', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Nivel de zoom')).toHaveText('50%')
  await drag(page, token, -32, 0)
  expect((await saved(page)).tokens[0].x).toBe(0)
  await page.getByRole('button', { name: 'Centrar vista' }).click()
  data = await saved(page)
  expect(data.zoom).toBe(1)
  expect(data.camera).toEqual({ x: 32, y: 32 })
  await page.reload()
  await expect(page.getByLabel('Nivel de zoom')).toHaveText('100%')
})

test('keyboard moves a focused token and the empty map; Escape clears selection', async ({ page }) => {
  await create(page, 'Bardo')
  const token = page.getByRole('button', { name: 'Ficha Bardo', exact: true })
  await token.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowUp')
  expect((await saved(page)).tokens[0]).toMatchObject({ x: 1, y: -1 })
  await page.keyboard.press('Escape')
  await page.getByRole('region', { name: 'Mesa cuadriculada' }).focus()
  await page.keyboard.press('ArrowLeft')
  expect((await saved(page)).camera.x).toBe(-32)
  await token.focus()
  page.once('dialog', dialog => dialog.accept())
  await page.keyboard.press('Delete')
  await expect(token).toHaveCount(0)
})

test('reset requires confirmation and persists the empty state', async ({ page }) => {
  await create(page, 'Explorador')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  expect((await saved(page)).tokens).toHaveLength(1)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await page.reload()
  await expect(page.locator('.token')).toHaveCount(0)
  await expect(page.getByText('Tu mesa empieza aquí')).toBeVisible()
})

test('cancel and interrupted pointer capture roll back uncommitted drags', async ({ page }) => {
  await create(page, 'Guerrera')
  const token = page.getByRole('button', { name: 'Ficha Guerrera', exact: true })
  const before = await saved(page)
  const start = await middle(token)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 75, start.y)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await saved(page)).toEqual(before)
  const restored = await middle(token)
  expect(restored.x).toBeCloseTo(start.x, 0)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 75, start.y)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  expect(await saved(page)).toEqual(before)
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.board')!
    board.addEventListener('pointerdown', event => { board.dataset.pointerId = String(event.pointerId) }, { once: true })
  })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 75, start.y)
  await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.board')!
    board.releasePointerCapture(Number(board.dataset.pointerId))
  })
  await page.mouse.move(start.x + 80, start.y)
  await page.mouse.up()
  expect(await saved(page)).toEqual(before)
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
})

test('small portrait and landscape layouts have no overflow and controls remain touch-sized', async ({ page }) => {
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size)
    if (!(await page.locator('.token').count())) await create(page, 'Nombre muy largo de una ficha del grupo aventurero')
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, height: document.documentElement.scrollHeight, viewportHeight: innerHeight }))
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport)
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewportHeight)
    for (const button of ['＋ Ficha', 'Acercar', 'Alejar', 'Centrar vista', 'Limpiar']) {
      const control = page.getByRole('button', { name: button, exact: true })
      const box = (await control.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width)
      expect(box.y + box.height).toBeLessThanOrEqual(size.height)
    }
  }
  await page.screenshot({ path: `test-results/layout-${test.info().project.name}.png` })
})

test('corrupt stored data remains untouched until reset; names are plain text', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('dnd.local-board.v1', '{invalid'))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Los datos anteriores se conservaron')
  await create(page, '<img src=x onerror=alert(1)>')
  expect(await page.evaluate(() => localStorage.getItem('dnd.local-board.v1'))).toBe('{invalid')
  expect(await page.locator('.token img').count()).toBe(0)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await create(page, 'Recuperada')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ficha Recuperada', exact: true })).toBeVisible()
})

test('failed localStorage writes clearly warn and retain a usable session', async ({ page }) => {
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError') } })
  await create(page, 'Temporal')
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar')
  await expect(page.getByRole('button', { name: 'Ficha Temporal', exact: true })).toBeVisible()
})

test('the name form rejects whitespace and supports cancellation', async ({ page }) => {
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).click()
  await page.getByLabel('Nombre', { exact: true }).fill('   ')
  await expect(page.getByRole('button', { name: 'Crear ficha', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.token')).toHaveCount(0)
})

test('mobile tap controls create and select a token without requiring a mouse', async ({ page }) => {
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).tap()
  await page.getByLabel('Nombre', { exact: true }).fill('Toque')
  await page.getByRole('button', { name: 'Crear ficha', exact: true }).tap()
  const token = page.getByRole('button', { name: 'Ficha Toque', exact: true })
  await token.tap()
  await expect(token).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Acercar', exact: true }).tap()
  await expect(page.getByLabel('Nivel de zoom')).toHaveText('125%')
  await page.getByRole('button', { name: 'Centrar vista' }).tap()
  await expect(page.getByLabel('Nivel de zoom')).toHaveText('100%')
  await page.screenshot({ path: `test-results/portrait-${test.info().project.name}.png` })
})

test('Android trusted touch drag, pan and a second finger never move camera and token together', async ({ page, browserName }) => {
  expect(browserName).toBe('chromium')
  await page.getByRole('button', { name: '＋ Ficha', exact: true }).tap()
  await page.getByLabel('Nombre', { exact: true }).fill('Táctil')
  await page.getByRole('button', { name: 'Crear ficha', exact: true }).tap()
  const before = await saved(page)
  const token = page.getByRole('button', { name: 'Ficha Táctil', exact: true })
  const start = await middle(token)
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: start.x, y: start.y }] })
  for (let i = 1; i <= 5; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: start.x + i * 14, y: start.y - i * 14 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: start.x + 70, y: start.y - 70 }, { id: 1, x: 60, y: 120 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const moved = await saved(page)
  expect(moved.tokens).toEqual(before.tokens) // Second finger safely cancels the pending token drag.
  expect(moved.camera).toEqual(before.camera)
  const box = (await page.getByRole('region', { name: 'Mesa cuadriculada' }).boundingBox())!
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: 40, y: box.y + 110 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: 120, y: box.y + 140 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const panned = await saved(page)
  expect(panned.camera).toEqual({ x: moved.camera.x - 80, y: moved.camera.y - 30 })
  expect(panned.tokens).toEqual(moved.tokens)
  const cancelStart = await middle(token)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, ...cancelStart }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: cancelStart.x + 70, y: cancelStart.y }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  expect(await saved(page)).toEqual(panned)
  await expect(page.getByRole('button', { name: '＋ Ficha', exact: true })).toBeEnabled()
  await page.reload()
  await expect(token).toBeVisible()
  expect(await saved(page)).toEqual(panned)
  await page.screenshot({ path: 'test-results/android-touch.png' })
  await client.detach()
})
