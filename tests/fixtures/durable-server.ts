import { createDurableRoomServer } from '../../server/durable.ts'
import { writeSync } from 'node:fs'

// A distinct process for persistence tests. Crash gates block synchronously only
// after an explicit test IPC message arms them; production has no crash controls.
let crashAt: string | null = null
const app = createDurableRoomServer({ databasePath: process.argv[2], assetsDirectory: process.argv[3], fault: point => {
  if (point !== crashAt) return
  writeSync(1, `DND_CRASH_POINT:${point}\n`)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
} })
app.http.listen(0, '127.0.0.1', () => process.send?.({ type: 'ready', port: (app.http.address() as { port: number }).port, pid: process.pid }))
process.on('message', message => {
  if (!message || typeof message !== 'object' || !('type' in message)) return
  if (message.type === 'arm' && 'point' in message && typeof message.point === 'string') { crashAt = message.point; process.send?.({ type: 'armed' }) }
  if (message.type === 'stop') void app.close().then(() => process.exit(0))
})
