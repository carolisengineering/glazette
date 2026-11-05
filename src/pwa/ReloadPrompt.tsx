import { useRegisterSW } from 'virtual:pwa-register/react'

/** Stays on screen until the user taps Reload, since a waiting update shouldn't be missed. */
export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed inset-x-5 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto flex max-w-[390px] items-center justify-between gap-3 rounded-2xl bg-ink py-2 pr-2 pl-4 text-[15px] font-medium text-white shadow-lg"
    >
      <span>New version available</span>
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className="min-h-11 rounded-xl bg-accent px-4 text-[15px] font-semibold text-white"
      >
        Reload
      </button>
    </div>
  )
}
