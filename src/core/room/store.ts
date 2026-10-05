import type { RoomState } from './types.ts'

// Phase A is synchronous: save replaces the complete state or throws without changing it.
// Values crossing this boundary are detached JSON data, not mutable storage handles.
export interface RoomStore {
  load(roomId: string): RoomState | null
  save(state: RoomState): void
  delete(roomId: string): void
}
