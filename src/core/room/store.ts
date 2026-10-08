import type { RoomState } from './types.ts'

// Synchronous: save replaces the complete state or fails without changing it.
// Durable infrastructure must distinguish an uncertain commit from a confirmed
// failure; its coordinator reconciles that outcome before acknowledging commands.
// Values crossing this boundary are detached JSON data, not mutable storage handles.
// Returning undefined (rather than void) rejects accidentally supplied Promise methods.
export interface RoomStore {
  load(roomId: string): RoomState | null
  save(state: RoomState): undefined
  delete(roomId: string): undefined
}
