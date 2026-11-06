import { create } from 'zustand'
import { fetchSession, signOutRemote } from './api'

const KEY = 'glazette.account'

function readCached(): string | undefined {
  try {
    return localStorage.getItem(KEY) || undefined
  } catch {
    return undefined
  }
}

function writeCached(email?: string): void {
  try {
    if (email) localStorage.setItem(KEY, email)
    else localStorage.removeItem(KEY)
  } catch {
    // Storage may be blocked; the account state still works for this session.
  }
}

// Set when a sign-out didn't reach the server. The session cookie is HttpOnly, so only the
// server can clear it; until it does, refresh must not treat a live session as signed in.
const PENDING_KEY = 'glazette.signout-pending'

function readPending(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) !== null
  } catch {
    return false
  }
}

function writePending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(PENDING_KEY, '1')
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    // Storage may be blocked; the retry then only lasts for this session.
  }
}

interface AccountState {
  status: 'unknown' | 'signed-out' | 'signed-in'
  email?: string
  /** Checks the server session. Offline keeps whatever the device already shows. */
  refresh(): Promise<void>
  signedIn(email: string): void
  /** Always signs out locally, even if the server can't be reached. */
  signOut(): Promise<void>
}

const SIGNED_OUT = { status: 'signed-out', email: undefined } as const

// Hydrates from the cached email so the Account button is stable on first paint and offline.
const cached = readCached()

// Bumped by sign-in and sign-out so a refresh that started earlier can't apply a stale answer.
let generation = 0

export const useAccount = create<AccountState>((set) => ({
  ...(cached ? { status: 'signed-in' as const, email: cached } : SIGNED_OUT),
  refresh: async () => {
    const startedAt = generation
    if (readPending()) {
      try {
        await signOutRemote()
        writePending(false)
      } catch {
        // Still can't reach the server; stay signed out locally and retry next time.
      }
      if (startedAt !== generation) return
      if (!readPending()) {
        writeCached()
        set(SIGNED_OUT)
      }
      return
    }
    const session = await fetchSession()
    if (session === 'offline' || startedAt !== generation) return
    if (session) {
      writeCached(session.email)
      set({ status: 'signed-in', email: session.email })
    } else {
      writeCached()
      set(SIGNED_OUT)
    }
  },
  signedIn: (email) => {
    generation++
    writePending(false)
    writeCached(email)
    set({ status: 'signed-in', email })
  },
  signOut: async () => {
    generation++
    try {
      await signOutRemote()
      writePending(false)
    } catch {
      // Offline or refused: the device is signed out locally; finish it on a later refresh.
      writePending(true)
    }
    generation++
    writeCached()
    set(SIGNED_OUT)
  },
}))

let started = false

/** Refreshes now and whenever the app becomes visible again. Safe to call twice. */
export function startAccountRefresh(): void {
  if (started) return
  started = true
  void useAccount.getState().refresh()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      void useAccount.getState().refresh()
  })
}
