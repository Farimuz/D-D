import type { FogRegion, MapAsset, Token } from '../../state/model.ts'

export const MAX_PLAYERS = 10
export const MAX_TOKENS = 200
export const MAX_FOG = 1000

// Shared state deliberately has no camera, zoom, selection or temporary tools.
export interface SharedBoard { version: 1; tokens: Token[]; map: MapAsset | null; fog: FogRegion[] }
export interface Participant { id: string; name: string; connected: boolean }
export type Role = 'dm' | 'player'
export type Changes = Partial<Pick<Token, 'x' | 'y' | 'name' | 'visible' | 'ownerId'>>
export type Action = { type: 'token.create'; name: string; x: number; y: number; visible?: boolean }
  | { type: 'token.update'; id: string; changes: Changes }
  | { type: 'token.delete'; id: string }
  | { type: 'fog.set'; regions: FogRegion[] }
  | { type: 'map.update'; map: MapAsset }
  | { type: 'map.delete' }
  | { type: 'board.reset' }

// Access hashes, connection counts, presence and asset bytes belong to adapters.
export interface RoomState { id: string; board: SharedBoard; revision: number; participants: Array<{ id: string; name: string }> }
export interface Actor { role: Role; id: string | null }
export interface Presence { connectedIds: ReadonlySet<string>; dmConnected: boolean }
export interface RoomProjection {
  roomId: string; revision: number; role: Role; selfId: string | null
  board: SharedBoard; participants: Participant[]; dmConnected: boolean
}
