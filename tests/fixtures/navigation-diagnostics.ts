import type { Page, Request, Response, TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const markers = new WeakMap<Page, (event: string) => void>()
// Opt-in diagnostics record resource types and timing, never URLs, headers,
// credentials, console contents, board state or participant data.
export function navigationDiagnostics(page: Page, info: TestInfo) {
  if (process.env.DND_NAVIGATION_DIAGNOSTICS !== '1') return async () => {}
  const started = performance.now(), startedWallTime = Date.now(), events: object[] = [], pending = new Map<Request, number>()
  let sequence = 0
  const record = (event: string, details: object = {}) => { if (events.length < 250) events.push({ ms: performance.now() - started, event, ...details }) }
  const request = (value: Request) => { const id = ++sequence; pending.set(value, id); record('request', { id, resourceType: value.resourceType(), navigation: value.isNavigationRequest() }) }
  const finished = (value: Request) => { record('request-finished', { id: pending.get(value) }); pending.delete(value) }
  const failed = (value: Request) => {
    const error = /(?:net::)?ERR_[A-Z_]+|NS_ERROR_[A-Z_]+|Load failed|cancelled|timeout/i.exec(value.failure()?.errorText ?? '')?.[0] ?? 'other'
    record('request-failed', { id: pending.get(value), resourceType: value.resourceType(), error }); pending.delete(value)
  }
  const navigated = () => record('frame-navigation')
  const dom = () => record('domcontentloaded')
  const loaded = () => record('load')
  page.on('request', request)
  const received = (value: Response) => record('response', { id: pending.get(value.request()), status: value.status() })
  page.on('response', received); page.on('requestfinished', finished); page.on('requestfailed', failed)
  page.on('framenavigated', navigated); page.on('domcontentloaded', dom); page.on('load', loaded)
  markers.set(page, event => record(event))
  return async () => {
    record('finish', { pendingResources: [...pending].map(([value, id]) => ({ id, resourceType: value.resourceType(), navigation: value.isNavigationRequest() })) })
    page.off('request', request); page.off('response', received); page.off('requestfinished', finished); page.off('requestfailed', failed)
    page.off('framenavigated', navigated); page.off('domcontentloaded', dom); page.off('load', loaded); markers.delete(page)
    const path = info.outputPath('navigation-events.json')
    await writeFile(path, JSON.stringify({ startedWallTime, events, truncated: events.length === 250 }, null, 2))
    await info.attach('navigation-events', { path, contentType: 'application/json' })
  }
}
export function markNavigation(page: Page, event: string) { markers.get(page)?.(event) }
