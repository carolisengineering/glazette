import { type RefObject, useEffect, useRef } from 'react'

/** Open modals, oldest first. Only the last one answers Escape. */
const openModals: symbol[] = []

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
    const id = Symbol('modal')
    openModals.push(id)
    const opener = document.activeElement
    initialFocus.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === id)
        close.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      openModals.splice(openModals.indexOf(id), 1)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [initialFocus])
}
