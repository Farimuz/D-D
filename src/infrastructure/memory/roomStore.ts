import type { RoomState } from '../../core/room/types.ts'
import type { RoomStore } from '../../core/room/store.ts'

// RoomState contains only JSON data. Copies keep callers from mutating stored authority.
const copy = (state: RoomState): RoomState => JSON.parse(JSON.stringify(state)) as RoomState

export class MemoryRoomStore implements RoomStore {
  private readonly states = new Map<string, RoomState>()
  load(roomId: string): RoomState | null {
    const state = this.states.get(roomId)
    return state ? copy(state) : null
  }
  save(state: RoomState): void { this.states.set(state.id, copy(state)) }
  delete(roomId: string): void { this.states.delete(roomId) }
}
