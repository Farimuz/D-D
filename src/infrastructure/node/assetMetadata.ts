import { keys, record } from '../../core/room/validation.ts'
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from '../../map/limits.ts'
import type { AssetMetadata } from './persistence.ts'

export const ASSET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export function validAsset(v: unknown): v is AssetMetadata {
  return record(v) && keys(v, ['id', 'type', 'byteLength', 'sha256', 'width', 'height'])
    && typeof v.id === 'string' && ASSET_ID.test(v.id) && ['image/png', 'image/jpeg', 'image/webp'].includes(String(v.type))
    && Number.isSafeInteger(v.byteLength) && Number(v.byteLength) > 0 && Number(v.byteLength) <= MAX_IMAGE_BYTES
    && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256)
    && Number.isInteger(v.width) && Number(v.width) > 0 && Number.isInteger(v.height) && Number(v.height) > 0
    && Number(v.width) * Number(v.height) <= MAX_IMAGE_PIXELS
}
