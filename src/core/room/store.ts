import type { RoomState } from './types.ts'

// Phase A is synchronous: save replaces the complete state or throws without changing it.
// Values crossing this boundary are detached JSON data, not mutable storage handles.
// Returning undefined (rather than void) rejects accidentally supplied Promise methods.
export interface RoomStore {
  load(roomId: string): RoomState | null
  save(state: RoomState): undefined
  delete(roomId: string): undefined
}
