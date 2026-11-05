/**
 * Asks the browser to keep our storage from being evicted. Runs on every start:
 * browsers (Safari especially) may refuse early and grant later, so a refusal
 * isn't remembered. Resolves false, never throws, when the API is missing or
 * fails.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist)
      return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch (err) {
    console.error('Could not request persistent storage', err)
    return false
  }
}
