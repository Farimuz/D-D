import { test as base, expect, devices, webkit } from '@playwright/test'
import type { BrowserContext, Page, Browser } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { IDENTITY_KEY, dmKey } from '../../src/online/session'

interface Clients { dm: Page; a: Page; b: Page; aContext: BrowserContext; aFrames: string[]; errors: string[]; watch(page: Page): void }
const test = base.extend<{ clients: Clients }>({
  clients: async ({ page, browser }, use) => {
    const errors: string[] = [], aFrames: string[] = []
    function watch(p: Page) {
      p.on('pageerror', e => errors.push(e.message))
      p.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()) })
    }
    const profile = test.info().project.metadata.player
    let mobileBrowser: Browser | null = null
    if (profile === 'iphone') mobileBrowser = await webkit.launch({ channel: '' })
    const aContext = await (mobileBrowser ?? browser).newContext(profile === 'iphone' ? devices['iPhone 13'] : profile === 'android' ? devices['Pixel 5'] : {})
    const bContext = await browser.newContext()
    const a = await aContext.newPage(), b = await bContext.newPage()
    await a.addInitScript(() => {
      const Native = window.WebSocket
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          ;(window as Window & { roomSocket?: WebSocket }).roomSocket = this
        }
      }
    })
    for (const p of [page, a, b]) watch(p)
    a.on('websocket', ws => ws.on('framereceived', frame => aFrames.push(String(frame.payload))))
    await use({ dm: page, a, b, aContext, aFrames, errors, watch })
    await aContext.close(); await bContext.close(); await mobileBrowser?.close()
    expect(errors).toEqual([])
  },
})
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const board = (page: Page) => page.locator('.board')
const connected = (page: Page) => expect(page.getByRole('status', { name: 'Estado de conexión', exact: true })).toHaveText('Conectado')
async function create(page: Page, name: string) {
  await button(page, '＋ Ficha').click(); await page.getByLabel('Nombre', { exact: true }).fill(name)
  await button(page, 'Crear ficha').click(); await expect(button(page, `Ficha ${name}`)).toBeVisible()
}
async function online(page: Page) {
  await button(page, 'Opciones de partida').click(); await button(page, 'Crear partida online').click()
  await connected(page)
  const code = (await page.getByLabel('Código de sala', { exact: true }).textContent())!.trim()
  const link = await page.getByLabel('Enlace para jugadores', { exact: true }).inputValue()
  expect(link).toBe(`http://127.0.0.1:4183/room/${code}`)
  const credential = await page.evaluate(key => localStorage.getItem(key), dmKey(code))
  expect(Boolean(credential && link.includes(credential))).toBe(false)
  return { code, link, credential }
}
async function join(page: Page, link: string, name: string) {
  await page.goto(link); await page.getByLabel('Nombre', { exact: true }).fill(name)
  await button(page, 'Entrar').click(); await connected(page)
}
async function view(page: Page) {
  return { camera: { x: Number(await board(page).getAttribute('data-camera-x')), y: Number(await board(page).getAttribute('data-camera-y')) }, zoom: Number(await board(page).getAttribute('data-zoom')) }
}
async function coords(page: Page, name: string) {
  const token = page.getByLabel(`Ficha ${name}`, { exact: true })
  return { x: Number(await token.getAttribute('data-cell-x')), y: Number(await token.getAttribute('data-cell-y')) }
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, token?: string) {
  const profile = test.info().project.metadata.player
  if (profile === 'android') {
    // Used only for player A; Chromium dispatches real emulated touch contacts.
    const client = await page.context().newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, ...from }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, ...to }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await client.detach()
  } else if (profile === 'iphone') {
    await syntheticCapture(page)
    const start = token ? button(page, `Ficha ${token}`) : board(page)
    await start.dispatchEvent('pointerdown', { pointerId: 10, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: from.x, clientY: from.y })
    await board(page).dispatchEvent('pointermove', { pointerId: 10, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: to.x, clientY: to.y })
    await board(page).dispatchEvent('pointerup', { pointerId: 10, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: to.x, clientY: to.y })
  } else { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up() }
}
async function syntheticCapture(page: Page) {
  await board(page).evaluate(element => {
    const ids = new Set<number>()
    element.setPointerCapture = id => { ids.add(id) }; element.hasPointerCapture = id => ids.has(id); element.releasePointerCapture = id => { ids.delete(id) }
  })
}
async function pinch(page: Page) {
  const box = (await board(page).boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2
  if (test.info().project.metadata.player === 'android') {
    const client = await page.context().newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: x - 40, y }, { id: 1, x: x + 40, y }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: x - 60, y }, { id: 1, x: x + 60, y }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await client.detach()
  } else {
    await syntheticCapture(page)
    for (const [type, id, dx] of [['pointerdown', 10, -40], ['pointerdown', 11, 40], ['pointermove', 10, -60], ['pointermove', 11, 60], ['pointerup', 11, 60], ['pointerup', 10, -60]] as const) await board(page).dispatchEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 10, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y })
  }
}

test('desktop DM plus two players synchronize ownership, maps and fog with independent navigation and reconnection', async ({ clients }) => {
  const { dm, a, b, aContext, aFrames, watch } = clients
  await dm.goto('/')
  await create(dm, 'Secreto irrepetible'); await dm.getByLabel('Visible para jugadores', { exact: true }).uncheck()
  await create(dm, 'Arannis'); await create(dm, 'Compañera')
  await dm.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(fileURLToPath(new URL('../fixtures/grid-16px-margins.png', import.meta.url)))
  await expect(button(dm, 'Listo')).toBeEnabled(); await button(dm, 'Listo').click()
  const localBefore = await dm.evaluate(() => localStorage.getItem('dnd.local-board.v1'))
  const { code, link, credential } = await online(dm)
  await join(a, link, 'Carlos'); await join(b, link, 'Ana')
  await expect(dm.getByLabel('Participantes')).toContainText('Carlos — conectado')
  await expect(dm.getByLabel('Participantes')).toContainText('Ana — conectado')
  await button(dm, 'Cerrar opciones de partida').click()
  await expect(a.locator('.map-image')).toBeVisible(); await expect(b.locator('.map-image')).toBeVisible()
  await expect(a.getByLabel('Ficha Secreto irrepetible', { exact: true })).toHaveCount(0)
  await button(dm, 'Ficha Arannis').click(); await dm.getByLabel('Controlada por', { exact: true }).selectOption({ label: 'Carlos' })
  await expect(button(a, 'Ficha Arannis')).toBeVisible(); await expect(b.getByRole('img', { name: 'Ficha Arannis', exact: true })).toBeVisible()
  for (const name of ['＋ Ficha', 'Mapa', 'Niebla', 'Limpiar']) await expect(button(a, name)).toHaveCount(0)
  await expect(button(a, 'Medir')).toBeVisible()
  await expect(a.getByLabel('Archivo del mapa', { exact: true })).toHaveCount(0)
  const before = await coords(a, 'Arannis'), token = (await button(a, 'Ficha Arannis').boundingBox())!, zoom = (await view(a)).zoom
  const center = { x: token.x + token.width / 2, y: token.y + token.height / 2 }
  await drag(a, center, { x: center.x + 64 * zoom, y: center.y }, 'Arannis')
  await expect.poll(() => coords(dm, 'Arannis')).toEqual({ x: before.x + 1, y: before.y })
  await expect.poll(() => coords(b, 'Arannis')).toEqual({ x: before.x + 1, y: before.y })
  const dmView = await view(dm), aView = await view(a), bView = await view(b), revision = await dm.locator('.app').getAttribute('data-room-revision')
  const bToken = (await b.getByRole('img', { name: 'Ficha Arannis', exact: true }).boundingBox())!
  await b.mouse.move(bToken.x + bToken.width / 2, bToken.y + bToken.height / 2); await b.mouse.down(); await b.mouse.move(bToken.x + bToken.width / 2 + 64, bToken.y + bToken.height / 2); await b.mouse.up()
  expect(await coords(dm, 'Arannis')).toEqual({ x: before.x + 1, y: before.y })
  expect((await view(b)).camera).not.toEqual(bView.camera)
  const box = (await board(a).boundingBox())!, p = { x: box.x + 35, y: box.y + box.height / 2 }
  await drag(a, p, { x: p.x + 25, y: p.y + 15 })
  await expect.poll(async () => (await view(a)).camera).not.toEqual(aView.camera)
  await a.mouse.move(p.x, p.y)
  if (test.info().project.metadata.player === 'iphone') await board(a).dispatchEvent('wheel', { deltaY: -80, clientX: p.x, clientY: p.y, cancelable: true })
  else await a.mouse.wheel(0, -80)
  await expect.poll(async () => (await view(a)).zoom).toBeGreaterThan(aView.zoom)
  const wheelZoom = (await view(a)).zoom
  await pinch(a); await expect.poll(async () => (await view(a)).zoom).toBeGreaterThan(wheelZoom)
  expect(await view(dm)).toEqual(dmView)
  expect(await dm.locator('.app').getAttribute('data-room-revision')).toBe(revision)
  await button(dm, 'Niebla').click(); await button(dm, 'Ocultar todo').click()
  await expect(a.locator('.token')).toHaveCount(0); await expect(b.locator('.token')).toHaveCount(0)
  expect(await a.locator('.fog-cover').evaluate(e => getComputedStyle(e).fillOpacity)).toBe('1')
  await button(dm, 'Mostrar todo').click(); await button(dm, 'Listo').click()
  await expect(button(a, 'Ficha Arannis')).toBeVisible()
  // Arannis now shares this cell. Keyboard selection reaches the covered token.
  await button(dm, 'Ficha Compañera').focus(); await button(dm, 'Ficha Compañera').press('Enter')
  // Online edits remain controlled by the server; wait for its confirmation.
  await dm.getByLabel('Visible para jugadores', { exact: true }).click()
  await expect(dm.getByLabel('Visible para jugadores', { exact: true })).not.toBeChecked()
  await expect(a.getByLabel('Ficha Compañera', { exact: true })).toHaveCount(0); await expect(b.getByLabel('Ficha Compañera', { exact: true })).toHaveCount(0)
  const privateValuesAbsent = !aFrames.join('').includes('Secreto irrepetible') && (!credential || !aFrames.join('').includes(credential))
  expect(privateValuesAbsent).toBe(true)
  expect(await a.evaluate(key => localStorage.getItem(key) === null, dmKey(code))).toBe(true)
  const identityBefore = await a.evaluate(key => localStorage.getItem(key), IDENTITY_KEY)
  const beforeReconnect = await view(a)
  await a.evaluate(() => (window as Window & { roomSocket?: WebSocket }).roomSocket!.close())
  await expect(a.getByRole('status', { name: 'Estado de conexión', exact: true })).toHaveText('Reconectando…')
  await connected(a); await expect(button(a, 'Ficha Arannis')).toBeVisible()
  expect(await view(a)).toEqual(beforeReconnect)
  await a.reload(); await connected(a); await expect(button(a, 'Ficha Arannis')).toBeVisible()
  expect(await a.evaluate(key => localStorage.getItem(key), IDENTITY_KEY)).toBe(identityBefore)
  await button(dm, 'Opciones de partida').click()
  await a.close(); await expect(dm.getByLabel('Participantes')).toContainText('Carlos — desconectado')
  const restored = await aContext.newPage(); watch(restored); await restored.goto(link); await connected(restored)
  await expect(button(restored, 'Ficha Arannis')).toBeVisible(); await expect(dm.getByLabel('Participantes')).toContainText('Carlos — conectado')
  const restoredView = await view(restored)
  await dm.reload(); await connected(dm); await expect(dm.getByRole('dialog', { name: 'Partida' })).toContainText('Eres el DM')
  expect(await view(restored)).toEqual(restoredView)
  await button(dm, 'Mesa local').click()
  expect(await dm.evaluate(() => localStorage.getItem('dnd.local-board.v1'))).toBe(localBefore)
  await expect(button(dm, 'Ficha Secreto irrepetible')).toBeVisible(); await expect(dm.locator('.map-image')).toBeVisible()
})


test('player measurement is local and does not grant DM editing controls', async ({ clients }) => {
  const { dm, a, b } = clients
  await dm.goto('/')
  const { link } = await online(dm)
  await join(a, link, 'Carlos')
  await join(b, link, 'Ana')
  await button(dm, 'Cerrar opciones de partida').click()

  await expect(button(a, 'Medir')).toBeVisible()
  for (const name of ['＋ Ficha', 'Mapa', 'Niebla', 'Limpiar']) await expect(button(a, name)).toHaveCount(0)

  const revision = await dm.locator('.app').getAttribute('data-room-revision')
  await button(a, 'Medir').click()
  await expect(a.getByLabel('Medir distancias', { exact: true })).toBeVisible()

  const bounds = (await board(a).boundingBox())!
  const zoom = (await view(a)).zoom
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await drag(a, start, { x: start.x + 128 * zoom, y: start.y })

  await expect(a.getByLabel('Distancia', { exact: true })).toHaveText('10 ft')
  await expect(b.getByLabel('Distancia', { exact: true })).toHaveCount(0)
  expect(await dm.locator('.app').getAttribute('data-room-revision')).toBe(revision)

  await button(a, 'Listo').click()
  await expect(a.locator('.measurement')).toHaveCount(0)
})

test('binary JPEG/WebP, map geometry and player controls work in portrait and landscape', async ({ clients }) => {
  const { dm, a } = clients
  await dm.goto('/'); const { link } = await online(dm); await join(a, link, 'Carlos')
  await button(dm, 'Cerrar opciones de partida').click()
  for (const type of ['image/jpeg', 'image/webp']) {
    const data = await dm.evaluate(type => { const c = document.createElement('canvas'); c.width = 32; c.height = 48; c.getContext('2d')!.fillRect(0, 0, 32, 48); return c.toDataURL(type).split(',')[1] }, type)
    await dm.getByLabel('Archivo del mapa', { exact: true }).setInputFiles({ name: type === 'image/jpeg' ? 'test.jpg' : 'test.webp', mimeType: type, buffer: Buffer.from(data, 'base64') })
    await expect(button(dm, 'Listo')).toBeEnabled()
    await expect.poll(() => a.locator('.map-image').evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth === 32 && e.naturalHeight === 48)).toBe(true)
    await dm.getByLabel('Escala del mapa en porcentaje', { exact: true }).fill('200'); await dm.getByLabel('Escala del mapa en porcentaje', { exact: true }).press('Enter')
    await expect.poll(async () => Number(await a.locator('.map-image').evaluate(e => parseFloat((e as HTMLElement).style.width)))).toBe(64 * (await view(a)).zoom)
    await button(dm, 'Listo').click()
  }
  await create(dm, 'Arannis'); await dm.getByLabel('Controlada por', { exact: true }).selectOption({ label: 'Carlos' })
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await a.setViewportSize(size)
    for (const name of ['Opciones de partida', 'Alejar', 'Acercar', 'Centrar vista']) {
      const box = (await button(a, name).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44 - .001); expect(box.height).toBeGreaterThanOrEqual(44 - .001)
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(size.width + .001)
    }
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    await a.screenshot({ path: `test-results/multiplayer/player-${size.width}-${test.info().project.name}.png` })
  }
  await button(dm, 'Mapa').click(); dm.once('dialog', dialog => dialog.accept()); await button(dm, 'Eliminar mapa').click()
  await expect(a.locator('.map-image')).toHaveCount(0)
})

test('missing rooms report a clear error and room code entry preserves anonymous name-only access', async ({ clients }) => {
  const { dm, a, b } = clients
  await dm.goto('/'); const { code, link } = await online(dm)
  await a.goto('/'); await button(a, 'Opciones de partida').click(); await a.getByLabel('Código de sala', { exact: true }).fill(code)
  await button(a, 'Entrar con código').click(); await a.getByLabel('Nombre', { exact: true }).fill('Carlos'); await button(a, 'Entrar').click(); await connected(a)
  expect(a.url()).toBe(link)
  expect(await a.locator('input[type="email"],input[type="password"]').count()).toBe(0)
  await b.goto('http://127.0.0.1:4183/room/AAAAAAAAAAAA'); await b.getByLabel('Nombre', { exact: true }).fill('Ana'); await button(b, 'Entrar').click()
  await expect(b.getByRole('alert')).toContainText('La sala ya no existe')
  await expect(b.getByRole('status', { name: 'Estado de conexión', exact: true })).toHaveText('Desconectado')
})


test('online alignment commits one geometry to both players while retaining their independent views', async ({ clients }) => {
  const { dm, a, b, aFrames } = clients
  await dm.goto('/'); const { link } = await online(dm)
  await join(a, link, 'Carlos'); await join(b, link, 'Ana')
  await button(dm, 'Cerrar opciones de partida').click()
  await dm.getByLabel('Archivo del mapa', { exact: true }).setInputFiles(fileURLToPath(new URL('../fixtures/grid-16px-margins.png', import.meta.url)))
  await expect(button(dm, 'Alinear cuadrícula')).toBeEnabled()
  const aView = await view(a), bView = await view(b)
  await button(dm, 'Alinear cuadrícula').click(); await button(dm, 'Marcar una casilla').click(); await button(dm, 'Ver mapa').click()
  const surface = dm.locator('.alignment-surface')
  for (let i = 0; i < 12 && Number(await surface.getAttribute('data-zoom')) < 4; i++) await button(dm, 'Acercar para alinear').click()
  const box = (await surface.boundingBox())!, zoom = Number(await surface.getAttribute('data-zoom'))
  const camera = { x: Number(await surface.getAttribute('data-camera-x')), y: Number(await surface.getAttribute('data-camera-y')) }
  for (const p of [{ x: 420, y: 532 }, { x: 436, y: 548 }]) await dm.mouse.click(box.x + box.width / 2 + (p.x - camera.x) * zoom, box.y + box.height / 2 + (p.y - camera.y) * zoom)
  const proposal = await dm.locator('.alignment-grid').evaluate(e => ({ x: Number((e as HTMLElement).dataset.mapX), y: Number((e as HTMLElement).dataset.mapY), scale: Number((e as HTMLElement).dataset.scale) }))
  expect(proposal.scale).toBeCloseTo(4, 1)
  await button(dm, 'Aplicar').click(); await expect(surface).toHaveCount(0)
  await expect.poll(() => aFrames.map(text => JSON.parse(text)).filter(m => m.type === 'state').at(-1)?.board.map).toMatchObject(proposal)
  for (const page of [a, b]) {
    // CSS serialization rounds subpixel values; the JSON comparison above is exact.
    await expect.poll(() => page.locator('.map-image').evaluate(e => parseFloat((e as HTMLElement).style.width))).toBeCloseTo(857 * proposal.scale, 2)
    const map = await page.locator('.map-image').evaluate(e => ({ x: parseFloat((e as HTMLElement).style.left), y: parseFloat((e as HTMLElement).style.top) }))
    const bounds = (await board(page).boundingBox())!, v = await view(page)
    expect(map.x).toBeCloseTo(bounds.width / 2 + (proposal.x - v.camera.x) * v.zoom, 2)
    expect(map.y).toBeCloseTo(bounds.height / 2 + (proposal.y - v.camera.y) * v.zoom, 2)
  }
  expect(await view(a)).toEqual(aView); expect(await view(b)).toEqual(bView)
})
