import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export interface DurableProcess {
  child: ChildProcess; pid: number; url: string; socketUrl: string
  arm(point: string): Promise<void>; crashPoint(point: string): Promise<void>
  stop(abrupt?: boolean): Promise<void>
}
export async function startDurableProcess(databasePath: string, assetsDirectory: string): Promise<DurableProcess> {
  const child = fork(fileURLToPath(new URL('./durable-server.ts', import.meta.url)), [databasePath, assetsDirectory], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  })
  let output = '', errors = ''
  child.stdout!.on('data', bytes => { output += String(bytes) })
  child.stderr!.on('data', bytes => { errors += String(bytes) })
  function message(type: string): Promise<Record<string, unknown>> {
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => { cleanup(); child.kill('SIGKILL'); reject(new Error(`Child ${type} timeout: ${errors.slice(-1500)}`)) }, 8000)
      const receive = (v: unknown) => { if (v && typeof v === 'object' && 'type' in v && v.type === type) { cleanup(); accept(v as Record<string, unknown>) } }
      const exit = () => { cleanup(); reject(new Error(`Child exited before ${type}: ${errors.slice(-1500)}`)) }
      function cleanup() { clearTimeout(timer); child.off('message', receive); child.off('exit', exit) }
      child.on('message', receive); child.once('exit', exit)
    })
  }
  const ready = await message('ready'), port = Number(ready.port)
  return {
    child, pid: Number(ready.pid), url: `http://127.0.0.1:${port}`, socketUrl: `ws://127.0.0.1:${port}/socket`,
    async arm(point) { const armed = message('armed'); child.send({ type: 'arm', point }); await armed },
    async crashPoint(point) {
      const marker = `DND_CRASH_POINT:${point}\n`
      if (output.includes(marker)) return
      await new Promise<void>((accept, reject) => {
        const timer = setTimeout(() => { cleanup(); child.kill('SIGKILL'); reject(new Error(`Missing crash point ${point}: ${errors.slice(-1500)}`)) }, 8000)
        const receive = () => { if (output.includes(marker)) { cleanup(); accept() } }
        function cleanup() { clearTimeout(timer); child.stdout!.off('data', receive) }
        child.stdout!.on('data', receive)
      })
    },
    async stop(abrupt = false) {
      if (child.exitCode !== null || child.signalCode !== null) return
      await new Promise<void>((accept, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Child shutdown timeout')) }, 8000)
        child.once('exit', (code, signal) => { clearTimeout(timer); if (!abrupt && (code !== 0 || signal)) reject(new Error(`Shutdown failed: ${code}/${signal} ${errors.slice(-1500)}`)); else accept() })
        if (abrupt) child.kill('SIGKILL')
        else child.send({ type: 'stop' })
      })
    },
  }
}
