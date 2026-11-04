import { useEffect } from 'react'

interface Props {
  message: string
  onDismiss: () => void
  /** Milliseconds before it dismisses itself. */
  duration?: number
}

/** A short message above the bottom edge that dismisses itself. */
export function Toast({ message, onDismiss, duration = 4000 }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [onDismiss, duration])

  return (
    <div
      role="status"
      className="fixed inset-x-5 bottom-8 z-50 mx-auto max-w-[390px] rounded-2xl bg-ink px-4 py-3 text-[15px] font-medium text-white shadow-lg"
    >
      {message}
    </div>
  )
}
