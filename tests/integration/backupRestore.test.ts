import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup, restoreBackup } from '../../src/infrastructure/node/backup.ts'
import { SQLiteRoomStore } from '../../src/infrastructure/node/sqlite/roomStore.ts'
import { startDurableProcess } from '../fixtures/durable-process.ts'
import type { DurableProcess } from '../fixtures/durable-process.ts'
import { OnlinePeer } from '../fixtures/online-peer.ts'
import { emptyBoard } from '../../src/state/model.ts'
import { shared } from '../../src/online/protocol.ts'
import type { Join } from '../../src/online/protocol.ts'

test('a real backup restores the original board/access/map in a new Node process while later source changes remain isolated', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-restore-process-')), path = join(root, 'rooms.sqlite'), assets = join(root, 'assets')
  const processes: DurableProcess[] = []
  t.after(async () => { for (const process of processes) await process.stop(true); rmSync(root, { recursive: true, force: true }) })
  const original = await startDurableProcess(path, assets); processes.push(original)
  const creation = await fetch(original.url + '/api/rooms', { method: 'POST', body: JSON.stringify(shared(emptyBoard())) })
  assert.equal(creation.status, 201)
  const access = await creation.json() as { roomId: string; credential: string }
  const dmJoin: Join = { type: 'join', ...access, role: 'dm' }
  const aJoin: Join = { type: 'join', roomId: access.roomId, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' }
  const bJoin: Join = { ...aJoin, identity: 'b'.repeat(64), name: 'Ana' }
  const dm = await new OnlinePeer(original.socketUrl).join(dmJoin), a = await new OnlinePeer(original.socketUrl).join(aJoin), b = await new OnlinePeer(original.socketUrl).join(bJoin)
  const created = await dm.action({ type: 'token.create', name: 'Snapshot', x: 0, y: 0 }); assert.ok(created.ok && created.tokenId)
  const tokenId = created.tokenId!, aId = a.latest!.selfId!, bId = b.latest!.selfId!
  assert.equal((await dm.action({ type: 'token.update', id: tokenId, changes: { ownerId: aId } })).ok, true)
  assert.equal((await a.action({ type: 'token.update', id: tokenId, changes: { x: 2, y: 3 } })).ok, true)
  assert.equal((await dm.action({ type: 'token.create', name: 'PRIVATE_DM_TOKEN', x: 9, y: 9, visible: false })).ok, true)
  assert.equal((await dm.action({ type: 'fog.set', regions: [{ id: 'draft', x: 0, y: 0, width: 64, height: 64 }] })).ok, true)
  const bytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
  const upload = () => fetch(original.url + '/api/rooms/' + access.roomId + '/map', { method: 'PUT', headers: { Authorization: 'Bearer ' + access.credential, 'X-Map-Layout': JSON.stringify({ x: -40, y: 70, scale: 2, width: 857, height: 1081 }) }, body: bytes })
  assert.equal((await upload()).status, 200)
  await dm.wait(v => v.type === 'state' && v.revision === 6)
  await a.wait(v => v.type === 'state' && v.revision === 6); await b.wait(v => v.type === 'state' && v.revision === 6)
  const snapshot = structuredClone(dm.latest!), aProjection = structuredClone(a.latest!.board)
  // The original process is still alive. Backup must coordinate with its SQLite writer.
  const connection = new SQLiteRoomStore(path)
  let backup: string
  try { backup = await createBackup(connection, assets, join(root, 'backups')) } finally { connection.close() }
  assert.equal((await dm.action({ type: 'token.update', id: tokenId, changes: { name: 'AFTER_BACKUP', x: 8, y: 3 } })).ok, true)
  assert.equal((await dm.action({ type: 'fog.set', regions: [] })).ok, true)
  assert.equal((await upload()).status, 200)
  await dm.wait(v => v.type === 'state' && v.revision === 9)
  assert.notEqual(dm.latest!.board.map!.id, snapshot.board.map!.id)
  const restoredPath = await restoreBackup(backup, join(root, 'restored'))
  const restored = await startDurableProcess(join(restoredPath, 'rooms.sqlite'), join(restoredPath, 'assets')); processes.push(restored)
  assert.notEqual(restored.pid, original.pid)
  const recoveredDM = await new OnlinePeer(restored.socketUrl).join(dmJoin)
  assert.deepEqual(recoveredDM.latest!.board, snapshot.board); assert.equal(recoveredDM.latest!.revision, 6)
  assert.ok(recoveredDM.latest!.participants.every(p => !p.connected))
  const recoveredA = await new OnlinePeer(restored.socketUrl).join(aJoin), recoveredB = await new OnlinePeer(restored.socketUrl).join(bJoin)
  assert.equal(recoveredA.latest!.selfId, aId); assert.equal(recoveredB.latest!.selfId, bId)
  assert.deepEqual(recoveredA.latest!.board, aProjection)
  assert.equal((await recoveredB.action({ type: 'token.update', id: tokenId, changes: { x: 1, y: 3 } })).ok, false)
  const image = await fetch(restored.url + '/api/rooms/' + access.roomId + '/map/' + snapshot.board.map!.id)
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes)
  for (const peer of [recoveredA, recoveredB]) for (const secret of [access.credential, 'PRIVATE_DM_TOKEN', 'identityHash', 'dmHash', 'AFTER_BACKUP']) assert.equal(peer.frames.join('').includes(secret), false)
  assert.equal(dm.latest!.revision, 9); assert.equal(dm.latest!.board.tokens.find(v => v.id === tokenId)!.name, 'AFTER_BACKUP')
  await restored.stop(); await original.stop()
})
