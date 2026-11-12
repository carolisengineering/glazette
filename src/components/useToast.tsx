import { useCallback, useState } from 'react'
import { Toast, type ToastAction } from './Toast'

export const SAVE_ERROR = "Couldn't save. Free up space and try again."

/**
 * A self-dismissing message. `show` displays it, and showing the same message
 * again restarts the timer; render `toast` once in the screen.
 */
export function useToast() {
  const [state, setState] = useState<{
    message: string
    id: number
    action?: ToastAction
    duration?: number
  }>()
  const show = useCallback(
    (message: string, options?: { action?: ToastAction; duration?: number }) =>
      setState((t) => ({ message, id: (t?.id ?? 0) + 1, ...options })),
    [],
  )
  const toast = state ? (
    <Toast
      key={state.id}
      message={state.message}
      action={state.action}
      duration={state.duration}
      onDismiss={() => setState(undefined)}
    />
  ) : null
  return { show, toast }
}
