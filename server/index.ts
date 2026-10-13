import { fileURLToPath } from 'node:url'
import { createRoomServer } from './app.ts'
import { createDurableRoomServer } from './durable.ts'
import { storageConfiguration } from './storageConfig.ts'

function option(key: string, fallback: string) {
  const index = process.argv.lastIndexOf(key)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}
const port = Number(option('--port', process.env.DND_SERVER_PORT ?? '8787'))
const host = option('--host', '0.0.0.0')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('El puerto debe estar entre 1 y 65535.')
const storage = storageConfiguration(), dist = fileURLToPath(new URL('../dist/', import.meta.url))
const app = storage.mode === 'temporary' ? createRoomServer({ dist }) : createDurableRoomServer({ ...storage, dist })
app.http.on('error', () => { console.error('No se pudo iniciar el servidor. Comprueba que el puerto esté disponible.'); void app.close().then(() => { process.exitCode = 1 }, () => { process.exitCode = 1 }) })
app.http.listen(port, host, () => console.log(`Servidor D&D (${storage.mode}): http://${host}:${port}`))
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  void app.close().then(() => { process.exitCode = 0 }, () => { console.error('No se pudo completar el cierre del almacenamiento.'); process.exitCode = 1 })
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
