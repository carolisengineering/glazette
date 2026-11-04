import { type RefObject, useEffect, useRef } from 'react'

/**
 * Modal behavior: focus moves to `initialFocus` on open, Escape calls `onClose`,
 * and focus returns to whatever had it before when the modal unmounts.
 */
export function useModal(
  initialFocus: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const opener = document.activeElement
    initialFocus.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [initialFocus])
}
