import { db } from '../db/db'

/**
 * Asks the browser to keep our storage from being evicted. Asked at most once
 * per install (tracked in settings). Resolves false, never throws, when the
 * API is missing or fails.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist)
      return false
    const settings = await db.settings.get('app')
    if (settings?.persistRequested) return false
    const granted = await navigator.storage.persist()
    await db.settings.update('app', { persistRequested: true })
    return granted
  } catch (err) {
    console.error('Could not request persistent storage', err)
    return false
  }
}
