import { MemoryRoomStore } from '../../src/infrastructure/memory/roomStore.ts'
import type { RoomState } from '../../src/core/room/types.ts'

export class FailingRoomStore extends MemoryRoomStore {
  failNextSave = false
  override save(state: RoomState): undefined {
    if (this.failNextSave) { this.failNextSave = false; throw new Error('Injected storage failure') }
    super.save(state)
  }
}
