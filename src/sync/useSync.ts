import { create } from 'zustand'
import { useAccount } from '../account/useAccount'
import { db } from '../db/db'
import { moveBytesApart } from '../photos/bytes'
import { syncOnce } from './engine'
import { fetchPhotoTransport } from './photoTransport'
import { onLocalChange } from './track'
import { transferPhotos } from './transfer'
import { fetchTransport } from './transport'

/** How long after the last local change a sync starts. */
export const CHANGE_DELAY_MS = 2_000

interface SyncState {
  syncing: boolean
  /** The last attempt failed for a reason other than being offline. */
  failed: boolean
}

export const useSync = create<SyncState>(() => ({
  syncing: false,
  failed: false,
}))

let running = false
let again = false

/**
 * Syncs in the background, if signed in. One sync runs at a time; requests
 * made during a run lead to exactly one more run after it.
 */
export function requestSync(): void {
  if (useAccount.getState().status !== 'signed-in') return
  if (running) {
    again = true
    return
  }
  running = true
  void loop()
}

async function loop(): Promise<void> {
  try {
    do {
      again = false
      if (useAccount.getState().status !== 'signed-in') break
      useSync.setState({ syncing: true })
      // First, so the sync's writes to photo rows come after the move.
      await moveBytesApart(db)
      // Read after the move, which can take a while.
      const { status, email } = useAccount.getState()
      if (status !== 'signed-in' || !email) break
      let outcome = await syncOnce(db, fetchTransport, email)
      // Photo bytes follow the records, in the same run.
      if (outcome === 'done') {
        outcome = await transferPhotos(db, fetchPhotoTransport)
      }
      if (outcome === 'signed-out') void useAccount.getState().refresh()
      else useSync.setState({ failed: outcome === 'error' })
    } while (again)
  } finally {
    running = false
    again = false
    useSync.setState({ syncing: false })
  }
}

let stop: (() => void) | undefined

/** Starts syncing on sign-in, on return, when back online and after changes. Safe to call twice. */
export function startSync(): void {
  if (stop) return

  let signedInAs: string | undefined
  const onAccount = () => {
    const { status, email } = useAccount.getState()
    const now = status === 'signed-in' ? email : undefined
    if (now === signedInAs) return
    signedInAs = now
    if (now) requestSync()
    else useSync.setState({ failed: false })
  }
  const unsubscribeAccount = useAccount.subscribe(onAccount)
  onAccount()

  const onVisible = () => {
    if (document.visibilityState === 'visible') requestSync()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', requestSync)

  let timer: ReturnType<typeof setTimeout> | undefined
  const unsubscribeChanges = onLocalChange(db, () => {
    clearTimeout(timer)
    timer = setTimeout(requestSync, CHANGE_DELAY_MS)
  })

  stop = () => {
    unsubscribeAccount()
    unsubscribeChanges()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', requestSync)
    clearTimeout(timer)
    stop = undefined
  }
}

/** Undoes startSync. For tests; the app never stops syncing. */
export function stopSync(): void {
  stop?.()
}
