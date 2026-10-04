import { useEffect, useState } from 'react'
import type { MapAsset } from '../state/model'
import { clampMapScale } from '../map/mapAsset'

interface Props { map: MapAsset; disabled: boolean; canAlign: boolean; onScale(scale: number): void; onDone(): void; onAlign(): void }

export default function MapControls({ map, disabled, canAlign, onScale, onDone, onAlign }: Props) {
  const [percentage, setPercentage] = useState(String(Number((map.scale * 100).toFixed(3))))
  useEffect(() => { setPercentage(String(Number((map.scale * 100).toFixed(3)))) }, [map.scale])
  function apply() {
    if (disabled) return
    const value = Number(percentage)
    if (Number.isFinite(value) && value > 0) onScale(clampMapScale(value / 100))
    else setPercentage(String(Number((map.scale * 100).toFixed(3))))
  }
  return <section className="map-panel" aria-label="Ajustar mapa">
    <p><strong>Ajustar mapa</strong> · Arrastra la imagen</p>
    <div className="panel-heading"><button disabled={disabled || !canAlign} onClick={onAlign}>Alinear cuadrícula</button><button className="primary" onClick={onDone} disabled={disabled}>Listo</button></div>
    <div className="map-scale">
      <button aria-label="Disminuir escala del mapa" disabled={disabled} onClick={() => onScale(clampMapScale(map.scale / 1.02))}>−</button>
      <label>Escala % <input aria-label="Escala del mapa en porcentaje" type="number" min="0.5" max="1600" step="0.001" value={percentage} disabled={disabled} onChange={event => setPercentage(event.target.value)} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
      <button aria-label="Aumentar escala del mapa" disabled={disabled} onClick={() => onScale(clampMapScale(map.scale * 1.02))}>＋</button>
    </div>
  </section>
}
