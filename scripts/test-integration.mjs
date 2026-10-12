import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The Windows/22.18.0 process harness can stall synchronous fetch/fork calls
// with seven concurrent test processes, including without D&D or SQLite.
// Keep concurrent requests within every test; limit only test-file processes
// on the runtime/platform reproduced in phase-b1-stability.md.
const options = process.platform === 'win32' && process.versions.node === '22.18.0'
  ? ['--test-concurrency=2'] : []
const child = spawn(process.execPath, ['--test', ...options, 'tests/integration/*.test.ts'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
  windowsHide: true,
})
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
