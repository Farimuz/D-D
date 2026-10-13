import { applyAction, createRoomState, projectRoom, registerParticipant, RoomError } from '../../src/core/room/domain.ts'
import { shared } from '../../src/core/room/validation.ts'
import { emptyBoard } from '../../src/state/model.ts'
import { MemoryRoomStore } from '../../src/infrastructure/memory/roomStore.ts'
import type { Actor } from '../../src/core/room/types.ts'
export { replaceMap } from '../../src/core/room/domain.ts'

// Executed as a standalone bundle with Node, browser, networking and clock APIs absent.
export function runMemoryScenario() {
  let sequence = 0
  const identity = () => `entity-${++sequence}`
  const store = new MemoryRoomStore()
  let state = createRoomState('portable-room', shared(emptyBoard()), identity)
  state = registerParticipant(state, { id: 'a', name: 'Carlos' })
  state = registerParticipant(state, { id: 'b', name: 'Ana' })
  const dm: Actor = { role: 'dm', id: null }, a: Actor = { role: 'player', id: 'a' }, b: Actor = { role: 'player', id: 'b' }
  const created = applyAction(state, dm, { type: 'token.create', name: 'Arannis', x: 0, y: 0 }, identity)
  state = applyAction(created.state, dm, { type: 'token.update', id: created.tokenId!, changes: { ownerId: 'a' } }, identity).state
  state = applyAction(state, a, { type: 'token.update', id: created.tokenId!, changes: { x: 2, y: -1 } }, identity).state
  let rejection: string | null = null
  try { applyAction(state, b, { type: 'token.update', id: created.tokenId!, changes: { x: 8, y: 8 } }, identity) }
  catch (error) { if (!(error instanceof RoomError)) throw error; rejection = error.code }
  state = applyAction(state, dm, { type: 'token.create', name: 'Solo DM', x: 8, y: 8, visible: false }, identity).state
  state = applyAction(state, dm, { type: 'fog.set', regions: [{ id: 'draft', x: 128, y: -64, width: 64, height: 64 }] }, identity).state
  store.save(state)
  const presence = { connectedIds: new Set(['a', 'b']), dmConnected: true }
  const player = projectRoom(state, a, presence), dmView = projectRoom(state, dm, presence)
  const restored = store.load(state.id)!
  return { rejection, revision: state.revision, position: state.board.tokens[0], player, dmView,
    sameProjection: JSON.stringify(projectRoom(restored, a, presence)) === JSON.stringify(player) }
}
