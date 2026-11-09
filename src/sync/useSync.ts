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

/** First wait before checking again for a photo another device hasn't uploaded. */
export const WAIT_RETRY_START_MS = 60_000
/** The longest wait; the delay doubles up to this. */
export const WAIT_RETRY_MAX_MS = 30 * 60_000

interface SyncState {
  syncing: boolean
  /** The last attempt failed for a reason other than being offline. */
  failed: boolean
}

export const useSync = create<SyncState>(() => ({
  syncing: false,
  failed: false,
}))

// Checking again for photos waiting on another device. Kept in memory only.
let waitTimer: ReturnType<typeof setTimeout> | undefined
let waitDelay = WAIT_RETRY_START_MS
// Bumped by every clear, so a check that was reading when sync stopped or the
// account signed out doesn't set a timer afterwards.
let waitEpoch = 0

function clearWait() {
  waitEpoch += 1
  clearTimeout(waitTimer)
  waitTimer = undefined
  waitDelay = WAIT_RETRY_START_MS
}

/** After a run: one timer while a live photo still waits to download. */
async function scheduleWaitCheck() {
  const epoch = waitEpoch
  const waiting = await db.photos
    .where('needsDownload')
    .equals(1)
    .filter((p) => !p.deletedAt)
    .count()
  if (epoch !== waitEpoch) return
  if (waiting === 0 || useAccount.getState().status !== 'signed-in') {
    clearWait()
    return
  }
  clearTimeout(waitTimer)
  waitTimer = setTimeout(requestSync, waitDelay)
  waitDelay = Math.min(waitDelay * 2, WAIT_RETRY_MAX_MS)
}

let running = false
let again = false

/**
 * Syncs in the background, if signed in. One sync runs at a time; requests
 * made during a run lead to exactly one more run after it.
 */
export function requestSync(): void {
  if (useAccount.getState().status !== 'signed-in') {
    clearWait()
    return
  }
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
      await scheduleWaitCheck()
    } while (again)
  } finally {
    if (useAccount.getState().status !== 'signed-in') clearWait()
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
    else {
      clearWait()
      useSync.setState({ failed: false })
    }
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
    clearWait()
    stop = undefined
  }
}

/** Undoes startSync. For tests; the app never stops syncing. */
export function stopSync(): void {
  stop?.()
}
