import type { FogAction } from '../state/model'
import ActionButton from './ActionButton'

interface Props { action: FogAction; disabled: boolean; onAction(action: FogAction): void; onHideAll(): void; onShowAll(): void; onDone(): void }
export default function FogControls({ action, disabled, onAction, onHideAll, onShowAll, onDone }: Props) {
  return <section className="map-panel fog-controls" aria-label="Herramientas de niebla">
    <ActionButton disabled={disabled} aria-pressed={action === 'hide'} onPress={() => onAction('hide')}>Ocultar</ActionButton>
    <ActionButton disabled={disabled} aria-pressed={action === 'reveal'} onPress={() => onAction('reveal')}>Revelar</ActionButton>
    <ActionButton disabled={disabled} aria-pressed={action === 'navigate'} onPress={() => onAction('navigate')}>Navegar</ActionButton>
    <ActionButton disabled={disabled} onPress={onHideAll}>Ocultar todo</ActionButton>
    <ActionButton disabled={disabled} onPress={onShowAll}>Mostrar todo</ActionButton>
    <ActionButton disabled={disabled} onPress={onDone}>Listo</ActionButton>
  </section>
}
