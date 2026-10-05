import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoomServer } from '../../server/app.ts'
import { MemoryRoomStore } from '../../src/infrastructure/memory/roomStore.ts'

test('audit: closing a real server releases runtime without deleting domain records', async () => {
  const store = new MemoryRoomStore()
  const app = createRoomServer({ roomStore: store })
  await new Promise<void>(accept => app.http.listen(0, '127.0.0.1', accept))
  const access = app.rooms.create()
  const before = store.load(access.roomId)
  await app.close()
  assert.deepEqual(store.load(access.roomId), before)
  assert.equal(app.rooms.rooms.size, 0)
})
