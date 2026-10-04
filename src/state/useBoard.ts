import { useRef, useState } from 'react'
import type { BoardState } from './model'
import { emptyBoard } from './model'
import { loadBoard, saveBoard } from './storage'

export function useBoard() {
  const [initial] = useState(() => {
    try { return loadBoard(window.localStorage) }
    catch { return { board: emptyBoard(), warning: 'El navegador no permite guardar. Los cambios durarán solo mientras esta página esté abierta.', blocked: false } }
  })
  const [board, setBoard] = useState(initial.board)
  const [warning, setWarning] = useState(initial.warning)
  const current = useRef(board)
  const blocked = useRef(initial.blocked)

  function change(update: (previous: BoardState) => BoardState, resetStorage = false, requireStorage = false): boolean {
    const next = update(current.current)
    let saved = false
    if (blocked.current && !resetStorage) {
      if (requireStorage) return false
      current.current = next
      setBoard(next)
      return false
    }
    try {
      saved = saveBoard(window.localStorage, next)
      setWarning(saved ? null : 'No se pudo guardar. Los cambios están solo en esta sesión; no cierres la página si quieres conservarlos.')
    } catch {
      setWarning('El navegador no permite guardar. Los cambios durarán solo mientras esta página esté abierta.')
    }
    // Do not remove/replace an asset until its new reference is durably saved.
    if (requireStorage && !saved) return false
    if (resetStorage) blocked.current = false
    current.current = next
    setBoard(next)
    return saved
  }

  return { board, warning, change, getBoard: () => current.current }
}
