import { useRef } from 'react'
import type { ButtonHTMLAttributes, TouchEvent } from 'react'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'onTouchEnd' | 'onTouchStart' | 'onTouchCancel'> { onPress(): void }
export default function ActionButton({ onPress, disabled, ...props }: Props) {
  const contact = useRef<{ id: number; x: number; y: number } | null>(null)
  function end(event: TouchEvent<HTMLButtonElement>) {
    const start = contact.current
    contact.current = null
    const touch = event.changedTouches[0]
    if (disabled || !start || event.touches.length || !touch || touch.identifier !== start.id) return
    const box = event.currentTarget.getBoundingClientRect()
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8 || touch.clientX < box.left || touch.clientX > box.right || touch.clientY < box.top || touch.clientY > box.bottom) return
    // Activate on touch release after captured board drags; suppress the compatibility
    // click so a normal tap cannot activate the action twice. Mouse/keyboard use click.
    event.preventDefault()
    onPress()
  }
  return <button {...props} disabled={disabled} onClick={onPress} onTouchStart={event => {
    const touch = event.touches[0]
    contact.current = event.touches.length === 1 ? { id: touch.identifier, x: touch.clientX, y: touch.clientY } : null
  }} onTouchEnd={end} onTouchCancel={() => { contact.current = null }} />
}
