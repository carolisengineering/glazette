import { useEffect, useRef } from 'react'

interface Props {
  message: string
  onDismiss: () => void
  /** Milliseconds before it dismisses itself. */
  duration?: number
}

/** A short message at the top of the screen that dismisses itself. */
export function Toast({ message, onDismiss, duration = 4000 }: Props) {
  // Held in a ref so a parent's inline callback doesn't restart the timer on every render.
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(), duration)
    return () => clearTimeout(timer)
  }, [duration])

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-5 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto max-w-[390px] rounded-2xl bg-ink px-4 py-3 text-[15px] font-medium text-white shadow-lg"
    >
      {message}
    </div>
  )
}
