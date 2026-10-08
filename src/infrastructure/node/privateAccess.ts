import { id, keys, record } from '../../core/room/validation.ts'
import type { RoomState } from '../../core/room/types.ts'
import type { PrivateAccess } from './persistence.ts'

const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
export function validAccess(v: unknown, state: RoomState): v is PrivateAccess {
  if (!record(v) || !keys(v, ['dmHash', 'identities', 'lastActive']) || !hash(v.dmHash)
    || !Number.isSafeInteger(v.lastActive) || Number(v.lastActive) < 0 || !Array.isArray(v.identities) || v.identities.length !== state.participants.length) return false
  const ids = new Set<string>(), hashes = new Set<string>()
  for (const identity of v.identities) {
    if (!record(identity) || !keys(identity, ['id', 'identityHash']) || !id(identity.id) || !hash(identity.identityHash)
      || ids.has(identity.id) || hashes.has(identity.identityHash) || !state.participants.some(p => p.id === identity.id)) return false
    ids.add(identity.id); hashes.add(identity.identityHash)
  }
  return true
}
