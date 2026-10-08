import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDurableProcess } from '../fixtures/durable-process.ts'
import type { DurableProcess } from '../fixtures/durable-process.ts'
import { OnlinePeer } from '../fixtures/online-peer.ts'
import { emptyBoard } from '../../src/state/model.ts'
import { shared } from '../../src/online/protocol.ts'
import type { Action, Join } from '../../src/online/protocol.ts'

const bytes = readFileSync(new URL('../fixtures/grid-16px-margins.png', import.meta.url))
const layout = { x: -80, y: 90, scale: 2, width: 857, height: 1081 }
function directory(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-process-')), path = join(root, 'rooms.sqlite'), assets = join(root, 'assets')
  const processes: DurableProcess[] = []
  t.after(async () => { for (const process of processes) await process.stop(true); rmSync(root, { recursive: true, force: true }) })
  return { root, path, assets, async start() { const process = await startDurableProcess(path, assets); processes.push(process); return process } }
}
async function create(process: DurableProcess) {
  const res = await fetch(process.url + '/api/rooms', { method: 'POST', body: JSON.stringify(shared(emptyBoard())) })
  assert.equal(res.status, 201)
  return await res.json() as { roomId: string; credential: string }
}
async function action(peer: OnlinePeer, command: Action) {
  const result = await peer.action(command); assert.equal(result.ok, true)
  return result.ok ? result.tokenId : undefined
}
const upload = (process: DurableProcess, access: { roomId: string; credential: string }) => fetch(process.url + '/api/rooms/' + access.roomId + '/map', {
  method: 'PUT', headers: { Authorization: 'Bearer ' + access.credential, 'X-Map-Layout': JSON.stringify(layout) }, body: bytes,
})

test('separate Node processes recover the complete DM + two-player room after graceful and abrupt shutdowns', { timeout: 30000 }, async t => {
  const data = directory(t), first = await data.start(), access = await create(first)
  const dmJoin: Join = { type: 'join', ...access, role: 'dm' }
  const aJoin: Join = { type: 'join', roomId: access.roomId, role: 'player', identity: 'a'.repeat(64), name: 'Carlos' }
  const bJoin: Join = { type: 'join', roomId: access.roomId, role: 'player', identity: 'b'.repeat(64), name: 'Ana' }
  const dm = await new OnlinePeer(first.socketUrl).join(dmJoin), a = await new OnlinePeer(first.socketUrl).join(aJoin), b = await new OnlinePeer(first.socketUrl).join(bJoin)
  const aId = a.latest!.selfId!, bId = b.latest!.selfId!
  const aToken = (await action(dm, { type: 'token.create', name: 'Arannis', x: 0, y: 0 }))!
  await action(dm, { type: 'token.update', id: aToken, changes: { ownerId: aId } })
  await action(a, { type: 'token.update', id: aToken, changes: { x: 3, y: 4 } })
  const bToken = (await action(dm, { type: 'token.create', name: 'Companion', x: -1, y: 2 }))!
  await action(dm, { type: 'token.update', id: bToken, changes: { ownerId: bId } })
  await action(b, { type: 'token.update', id: bToken, changes: { x: -2, y: 2 } })
  await action(dm, { type: 'token.create', name: 'SECRET_SOLO_DM', x: 9, y: 9, visible: false })
  await action(dm, { type: 'fog.set', regions: [{ id: 'draft', x: 192, y: 256, width: 64, height: 64 }] })
  assert.equal((await upload(first, access)).status, 200)
  await dm.wait(v => v.type === 'state' && v.revision === 9)
  await a.wait(v => v.type === 'state' && v.revision === 9)
  await b.wait(v => v.type === 'state' && v.revision === 9)
  const board = structuredClone(dm.latest!.board), revision = dm.latest!.revision
  assert.deepEqual(a.latest!.board.tokens.map(token => token.id), [bToken])
  await first.stop()
  let priorPid = first.pid
  const participantIds = [aId, bId]
  for (const abrupt of [false, true]) {
    const restarted = await data.start()
    assert.notEqual(restarted.pid, priorPid)
    const recoveredDM = await new OnlinePeer(restarted.socketUrl).join(dmJoin)
    assert.deepEqual(recoveredDM.latest!.board, board); assert.equal(recoveredDM.latest!.revision, revision)
    assert.deepEqual(recoveredDM.latest!.participants.map(p => ({ id: p.id, connected: p.connected })), participantIds.map(id => ({ id, connected: false })))
    const recoveredA = await new OnlinePeer(restarted.socketUrl).join(aJoin), recoveredB = await new OnlinePeer(restarted.socketUrl).join(bJoin)
    assert.equal(recoveredA.latest!.selfId, aId); assert.equal(recoveredB.latest!.selfId, bId)
    assert.deepEqual(recoveredA.latest!.board.tokens.map(token => token.id), [bToken])
    assert.deepEqual(recoveredB.latest!.board.tokens.map(token => token.id), [bToken])
    assert.equal((await recoveredA.action({ type: 'token.update', id: aToken, changes: { x: 0, y: 0 } })).ok, false)
    assert.equal((await recoveredA.action({ type: 'token.update', id: bToken, changes: { x: 0, y: 0 } })).ok, false)
    const fresh = await new OnlinePeer(restarted.socketUrl).join({ ...aJoin, identity: 'c'.repeat(64), name: 'New player' })
    assert.notEqual(fresh.latest!.selfId, aId)
    if (!participantIds.includes(fresh.latest!.selfId!)) participantIds.push(fresh.latest!.selfId!)
    else assert.equal(fresh.latest!.selfId, participantIds[2])
    assert.equal((await fresh.action({ type: 'token.update', id: bToken, changes: { x: 0, y: 0 } })).ok, false)
    const wrong = new OnlinePeer(restarted.socketUrl)
    await new Promise<void>(accept => wrong.socket.once('open', accept))
    wrong.socket.send(JSON.stringify({ ...dmJoin, credential: 'x'.repeat(43) }))
    assert.equal((await wrong.wait(v => v.type === 'error' && v.code === 'ACCESS')).type, 'error')
    const image = await fetch(restarted.url + '/api/rooms/' + access.roomId + '/map/' + board.map!.id)
    assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes)
    for (const peer of [recoveredA, recoveredB, fresh]) for (const secret of [access.credential, 'SECRET_SOLO_DM', 'a'.repeat(64), 'b'.repeat(64), 'identityHash', 'dmHash', 'storageVersion']) assert.equal(peer.frames.join('').includes(secret), false)
    for (const secret of [access.credential, 'a'.repeat(64), 'b'.repeat(64), 'identityHash', 'dmHash', 'storageVersion']) assert.equal(recoveredDM.frames.join('').includes(secret), false)
    priorPid = restarted.pid
    await restarted.stop(abrupt)
  }
  // The last shutdown above is abrupt; this final process exercises WAL recovery.
  const last = await data.start(), recovered = await new OnlinePeer(last.socketUrl).join(dmJoin)
  assert.notEqual(last.pid, priorPid)
  assert.deepEqual(recovered.latest!.board, board); assert.equal(recovered.latest!.revision, revision)
  assert.ok(recovered.latest!.participants.every(p => !p.connected))
  await last.stop()
})

for (const point of ['asset.beforePrepare', 'asset.partialWrite', 'asset.prepared', 'sqlite.commit', 'sqlite.afterCommit', 'asset.cleanup']) {
  test(`abrupt Node death at ${point} recovers a coherent reference and the last valid image`, { timeout: 20000 }, async t => {
    const data = directory(t), first = await data.start(), access = await create(first)
    const res = await upload(first, access); assert.equal(res.status, 200)
    const old = (await res.json()).map
    await first.arm(point)
    const pending = upload(first, access).then(response => response.status).catch(() => 0)
    await first.crashPoint(point); await first.stop(true)
    assert.equal(await pending, 0)
    const restarted = await data.start(), dm = await new OnlinePeer(restarted.socketUrl).join({ type: 'join', ...access, role: 'dm' })
    const committed = point === 'sqlite.afterCommit' || point === 'asset.cleanup'
    assert.equal(dm.latest!.revision, committed ? 2 : 1)
    if (committed) assert.notEqual(dm.latest!.board.map!.id, old.id)
    else assert.deepEqual(dm.latest!.board.map, old)
    const mapId = dm.latest!.board.map!.id
    const image = await fetch(restarted.url + '/api/rooms/' + access.roomId + '/map/' + mapId)
    assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes)
    assert.deepEqual(readdirSync(data.assets).sort(), ['assets-owner.json', mapId + '.asset'].sort())
    await restarted.stop()
  })
}
