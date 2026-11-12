import { useEffect, useRef } from 'react'

export interface ToastAction {
  label: string
  onPress: () => void
}

interface Props {
  message: string
  /** A button at the end of the toast. Pressing it runs `onPress`, then dismisses. */
  action?: ToastAction
  onDismiss: () => void
  /** Milliseconds before it dismisses itself. */
  duration?: number
}

/** A short message at the top of the screen that dismisses itself. */
export function Toast({ message, action, onDismiss, duration = 4000 }: Props) {
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
      className={`${action ? 'pointer-events-auto flex items-center justify-between gap-3' : 'pointer-events-none'} fixed inset-x-5 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto max-w-[390px] rounded-2xl bg-ink px-4 py-3 text-[15px] font-medium text-white shadow-lg`}
    >
      {message}
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onPress()
            dismiss.current()
          }}
          className="-my-2 -mr-2 min-h-[44px] shrink-0 rounded-full px-4 text-[15px] font-semibold text-white underline underline-offset-4"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
