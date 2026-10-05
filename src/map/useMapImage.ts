import { useEffect, useState } from 'react'
import { readMap } from '../storage/mapAssets'
import { validateImage } from './mapAsset'

export function useMapImage(id: string | undefined, remoteUrl?: string | null) {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setImage(null)
    setWarning(null)
    if (remoteUrl !== undefined) return
    if (id) void (async () => {
      try {
        const blob = await readMap(id)
        if (!blob) throw new Error('missing')
        const valid = await validateImage(blob)
        if (cancelled) return
        url = URL.createObjectURL(valid.blob)
        setImage({ id, url })
      } catch {
        if (!cancelled) setWarning('No se pudo recuperar el mapa. Las fichas se conservaron; puedes reemplazarlo o eliminarlo desde «Mapa».')
      }
    })()
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [id, remoteUrl])
  return remoteUrl !== undefined ? { url: remoteUrl, warning: null } : { url: image && image.id === id ? image.url : null, warning }
}
