import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { OnlinePeer } from '../fixtures/online-peer.ts'
import { shared } from '../../src/online/protocol.ts'
import { emptyBoard } from '../../src/state/model.ts'

async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>(accept => server.close(() => accept())); return port
}
test('the development launcher starts Vite and durable Node together with same-origin HTTP/WebSocket proxy', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-development-')), databasePath = join(root, 'rooms.sqlite')
  const backend = await freePort(), frontend = await freePort()
  const launcher = spawn(process.execPath, ['scripts/dev.mjs', '--port', String(frontend), '--strictPort'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true,
    env: { ...process.env, DND_STORAGE_MODE: 'durable', DND_SERVER_PORT: String(backend), DND_DB_PATH: databasePath, DND_ASSETS_DIR: join(root, 'assets') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  launcher.stdout.on('data', data => { output += String(data) }); launcher.stderr.on('data', data => { output += String(data) })
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) {
      const stopped = once(launcher, 'exit')
      if (process.platform === 'win32') {
        // Only this fixture's launcher and its own descendants are terminated.
        const killer = spawn('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        await once(killer, 'exit')
      } else launcher.kill('SIGTERM')
      await stopped
    }
    rmSync(root, { recursive: true, force: true })
  })
  const url = `http://127.0.0.1:${frontend}`
  const deadline = Date.now() + 10000
  while (!output.includes('Local:') || !output.includes(String(backend))) {
    if (launcher.exitCode !== null || Date.now() > deadline) throw new Error('Development launch failed: ' + output.slice(-1500))
    await new Promise(accept => setTimeout(accept, 25))
  }
  assert.equal((await fetch(url)).status, 200)
  const response = await fetch(url + '/api/rooms', { method: 'POST', body: JSON.stringify(shared(emptyBoard())) })
  assert.equal(response.status, 201)
  const access = await response.json() as { roomId: string; credential: string }
  const dm = await new OnlinePeer(`ws://127.0.0.1:${frontend}/socket`).join({ type: 'join', ...access, role: 'dm' })
  assert.equal((await dm.action({ type: 'token.create', name: 'Development smoke', x: 1, y: 2 })).ok, true)
  dm.socket.close()
  const store = new SQLiteRoomStore(databasePath, { readOnly: true })
  try { assert.equal(store.load(access.roomId)!.board.tokens[0].name, 'Development smoke'); assert.equal(store.load(access.roomId)!.revision, 1) } finally { store.close() }
})
