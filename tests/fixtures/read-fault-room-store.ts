import { MemoryRoomStore } from '../../src/infrastructure/memory/roomStore.ts'
import type { RoomState } from '../../src/core/room/types.ts'

export class ReadFaultRoomStore extends MemoryRoomStore {
  failNextLoad = false
  failReadAfterSave = false
  override load(id: string) {
    if (this.failNextLoad) { this.failNextLoad = false; throw new Error('Injected read failure') }
    return super.load(id)
  }
  override save(state: RoomState): undefined { super.save(state); if (this.failReadAfterSave) this.failNextLoad = true }
}
