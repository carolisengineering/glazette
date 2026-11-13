import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect, useRef } from 'react'
import { clearUpdateReload, markUpdateReload } from '../telemetry/updateReload'

/** Stays on screen until the user taps Reload, since a waiting update shouldn't be missed. */
export function ReloadPrompt() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      registration.current = r
    },
  })

  // Look for a new version whenever the app comes back to the foreground.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      // Offline, the check fails; that's fine, the next one will work.
      registration.current?.update()?.catch(() => {})
    }
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [])

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed inset-x-5 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto flex max-w-[390px] items-center justify-between gap-3 rounded-2xl bg-ink py-2 pr-2 pl-4 text-[15px] font-medium text-white shadow-lg"
    >
      <span>New version available</span>
      <button
        type="button"
        onClick={() => {
          markUpdateReload()
          // If the page reloads, this timer dies with it. If no reload follows,
          // the note must not mark some later, unrelated load.
          setTimeout(() => clearUpdateReload(), 10_000)
          try {
            Promise.resolve(updateServiceWorker(true)).catch(() =>
              clearUpdateReload(),
            )
          } catch {
            clearUpdateReload()
          }
        }}
        className="min-h-11 rounded-xl bg-accent px-4 text-[15px] font-semibold text-white"
      >
        Reload
      </button>
    </div>
  )
}
