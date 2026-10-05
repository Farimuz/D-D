import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { MAX_NAME_LENGTH } from '../state/model'

interface Props { onCreate(name: string): void; onClose(): void; initialName?: string; title?: string; submitLabel?: string }

export default function NameDialog({ onCreate, onClose, initialName = '', title = 'Nueva ficha', submitLabel = 'Crear ficha' }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialName)

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    input.current?.focus()
    return () => element.close()
  }, [])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim()) onCreate(name.trim())
  }

  return (
    <dialog ref={dialog} className="name-dialog" aria-labelledby="dialog-title" onCancel={onClose}>
      <form onSubmit={submit}>
        <h2 id="dialog-title">{title}</h2>
        <label htmlFor="token-name">Nombre</label>
        <input ref={input} id="token-name" value={name} onChange={event => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} placeholder="Arannis, Goblin, Juan Pérez…" autoComplete="off" required />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button className="primary" type="submit" disabled={!name.trim()}>{submitLabel}</button>
        </div>
      </form>
    </dialog>
  )
}
