const KEY = 'glazette:update-reload'
export const UPDATE_RELOAD_MAX_AGE_MS = 60_000

/**
 * Leaves a short-lived note that the next page load is the one an update's
 * Reload button asked for. Storage can fail (private mode, blocked site data,
 * quota), even just reading `sessionStorage`; then we simply send less.
 */
export function markUpdateReload(
  storage?: Storage,
  now: number = Date.now(),
): void {
  try {
    const store = storage ?? sessionStorage
    store.setItem(KEY, String(now))
  } catch {
    // No note, no after-update mark. Never get in the way of the reload.
  }
}

/** True once if a fresh note is waiting. The note is always removed once read. */
export function consumeUpdateReload(
  storage?: Storage,
  now: number = Date.now(),
): boolean {
  try {
    const store = storage ?? sessionStorage
    const raw = store.getItem(KEY)
    if (raw === null) return false
    store.removeItem(KEY)
    const wrote = Number(raw)
    if (!Number.isFinite(wrote)) return false
    // A note dated in the future (clock change) is not trusted either.
    const age = now - wrote
    return age >= 0 && age <= UPDATE_RELOAD_MAX_AGE_MS
  } catch {
    return false
  }
}
