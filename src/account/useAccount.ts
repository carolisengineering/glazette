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
    const started = generation
    const session = await fetchSession()
    if (session === 'offline' || started !== generation) return
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
    writeCached(email)
    set({ status: 'signed-in', email })
  },
  signOut: async () => {
    generation++
    try {
      await signOutRemote()
    } catch {
      // Offline: the device is still signed out locally.
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
