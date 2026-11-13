const KEY = 'glazette:update-reload'
export const UPDATE_RELOAD_MAX_AGE_MS = 60_000

/**
 * Leaves a short-lived note that the next page load is the one an update's
 * Reload button asked for. Storage can fail (private mode, quota); then we
 * simply send less.
 */
export function markUpdateReload(
  storage: Storage = sessionStorage,
  now: number = Date.now(),
): void {
  try {
    storage.setItem(KEY, String(now))
  } catch {
    // No note, no after-update mark. Never get in the way of the reload.
  }
}

/** True once if a fresh note is waiting. The note is always removed once read. */
export function consumeUpdateReload(
  storage: Storage = sessionStorage,
  now: number = Date.now(),
): boolean {
  try {
    const raw = storage.getItem(KEY)
    if (raw === null) return false
    storage.removeItem(KEY)
    const wrote = Number(raw)
    if (!Number.isFinite(wrote)) return false
    return now - wrote <= UPDATE_RELOAD_MAX_AGE_MS
  } catch {
    return false
  }
}
