import { useAccount } from '../account/useAccount'
import { db as appDb } from '../db/db'
import { router as appRouter } from '../router'
import type { Screen } from './events'
import {
  captureError,
  identify,
  initTelemetry,
  resetIdentity,
  track,
} from './telemetry'

type AppRouter = typeof appRouter
type AppDb = typeof appDb

const SEEDED_KEY = 'glazette.telemetry.seeded'

export function screenFor(pathname: string): Screen | undefined {
  if (pathname === '/') return 'shelf'
  if (pathname === '/piece' || pathname.startsWith('/piece/')) return 'piece'
  if (pathname === '/glazes') return 'glazes'
  if (pathname === '/capture') return 'capture'
  return undefined
}

let stop: (() => void) | undefined

function isStandalone(): boolean {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

function trackOpen(resumed: boolean): void {
  track('app_opened', { standalone: isStandalone(), resumed })
}

// Existing users get their history as person properties once per device.
async function seedExistingUsers(db: AppDb): Promise<void> {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return
    const pieces = await db.pieces.filter((p) => !p.deletedAt).toArray()
    const first = pieces.map((p) => p.createdAt).sort()[0]
    track('telemetry_started', {
      pieces: pieces.length,
      ...(first ? { first_piece_date: first.slice(0, 10) } : {}),
    })
    localStorage.setItem(SEEDED_KEY, '1')
  } catch {
    // Blocked storage or db: skip. Telemetry must never get in the way.
  }
}

async function trackVitals(): Promise<void> {
  try {
    const v = await import('web-vitals')
    const report =
      (metric: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB') =>
      (m: { value: number }) =>
        track('web_vital', { metric, value: m.value })
    v.onLCP(report('LCP'))
    v.onINP(report('INP'))
    v.onCLS(report('CLS'))
    v.onFCP(report('FCP'))
    v.onTTFB(report('TTFB'))
  } catch {
    // ignore
  }
}

/** Starts telemetry and wires identity, opens, screens, vitals and errors. Safe to call twice. */
export function startTelemetry(
  deps: { router?: AppRouter; db?: AppDb } = {},
): void {
  if (stop) return
  const router = deps.router ?? appRouter
  const db = deps.db ?? appDb
  initTelemetry()

  let identified: string | undefined
  const syncIdentity = () => {
    const { status, email } = useAccount.getState()
    const next = status === 'signed-in' && email ? email : undefined
    if (next === identified) return
    if (identified) resetIdentity()
    if (next) identify(next)
    identified = next
  }
  syncIdentity()
  const unsubscribeAccount = useAccount.subscribe(syncIdentity)

  trackOpen(false)
  const onVisibility = () => {
    if (document.visibilityState === 'visible') trackOpen(true)
  }
  document.addEventListener('visibilitychange', onVisibility)

  const unsubscribeRouter = router.subscribe('onResolved', (event) => {
    const screen = screenFor(event.toLocation.pathname)
    if (screen) track('screen_viewed', { screen })
  })

  const onError = (event: ErrorEvent) =>
    captureError(event.error ?? event.message)
  const onRejection = (event: PromiseRejectionEvent) =>
    captureError(event.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  void trackVitals()
  void seedExistingUsers(db)

  stop = () => {
    unsubscribeAccount()
    unsubscribeRouter()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

export function stopTelemetryForTests(): void {
  stop?.()
  stop = undefined
}
