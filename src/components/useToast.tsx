import { useCallback, useState } from 'react'
import { Toast } from './Toast'

export const SAVE_ERROR = "Couldn't save. Free up space and try again."

/**
 * A self-dismissing message. `show` displays it, and showing the same message
 * again restarts the timer; render `toast` once in the screen.
 */
export function useToast() {
  const [state, setState] = useState<{ message: string; id: number }>()
  const show = useCallback(
    (message: string) => setState((t) => ({ message, id: (t?.id ?? 0) + 1 })),
    [],
  )
  const toast = state ? (
    <Toast
      key={state.id}
      message={state.message}
      onDismiss={() => setState(undefined)}
    />
  ) : null
  return { show, toast }
}
