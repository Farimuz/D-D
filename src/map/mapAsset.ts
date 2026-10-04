import type { MapAsset, Point } from '../state/model.ts'
import { MAX_CAMERA } from '../state/model.ts'

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 32_000_000
export const MIN_MAP_SCALE = 0.005
export const MAX_MAP_SCALE = 16

export function imageType(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export function clampMapScale(value: number): number {
  return Math.max(MIN_MAP_SCALE, Math.min(MAX_MAP_SCALE, value))
}

export function initialMap(id: string, width: number, height: number, camera: Point, zoom: number, size: Point): MapAsset {
  const scale = clampMapScale(Math.min(1, Math.max(64, size.x - 64) / zoom / width, Math.max(64, size.y - 240) / zoom / height))
  const limit = (value: number) => Math.max(-MAX_CAMERA, Math.min(MAX_CAMERA, value))
  return { id, width, height, scale, x: limit(camera.x - width * scale / 2), y: limit(camera.y - height * scale / 2) }
}

export async function validateImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('El mapa debe pesar entre 1 byte y 25 MiB.')
  const type = imageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()))
  if (!type) throw new Error('Formato no compatible. Elige PNG, JPG/JPEG o WebP; SVG no está permitido.')
  const blob = file.slice(0, file.size, type)
  const url = URL.createObjectURL(blob)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { image.onload = image.onerror = null; reject(new Error('La imagen tardó demasiado en abrirse. Prueba un mapa más pequeño.')) }, 20_000)
      image.onload = () => { clearTimeout(timer); resolve() }
      image.onerror = () => { clearTimeout(timer); reject(new Error('No se pudo abrir la imagen. El archivo puede estar corrupto.')) }
      image.src = url
    })
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('El mapa debe tener como máximo 32 millones de píxeles.')
    return { blob, width, height }
  } finally {
    image.onload = image.onerror = null
    image.src = ''
    URL.revokeObjectURL(url)
  }
}
