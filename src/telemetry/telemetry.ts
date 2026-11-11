import type { EventName, EventProps } from './events'

export interface TelemetrySink {
  capture(name: string, props: Record<string, unknown>): void
  identify(email: string): void
  reset(): void
  captureException(error: unknown): void
}

const MAX_BUFFERED = 100

let sink: TelemetrySink | undefined
let started = false
// Closures over sink calls, so identify and reset keep their order with captures.
let buffer: Array<(s: TelemetrySink) => void> = []

export function telemetryEnabled(env: {
  MODE: string
  VITE_POSTHOG_KEY?: string
}): boolean {
  return env.MODE === 'production' && !!env.VITE_POSTHOG_KEY
}

export function elapsed(start: number): number {
  return Math.round(performance.now() - start)
}

// Telemetry must never break the app, so every sink call is swallowed.
function send(call: (s: TelemetrySink) => void): void {
  try {
    if (sink) {
      call(sink)
    } else if (buffer.length < MAX_BUFFERED) {
      buffer.push(call)
    }
  } catch {
    // ignore
  }
}

export function track<N extends EventName>(
  name: N,
  props: EventProps[N],
): void {
  send((s) => s.capture(name, props))
}

export function identify(email: string): void {
  send((s) => s.identify(email))
}

export function resetIdentity(): void {
  send((s) => s.reset())
}

export function captureError(error: unknown): void {
  send((s) => s.captureException(error))
}

function flush(s: TelemetrySink): void {
  const pending = buffer
  buffer = []
  for (const call of pending) {
    try {
      call(s)
    } catch {
      // ignore
    }
  }
}

/** Sets the sink directly and clears the buffer. */
export function setSinkForTests(next: TelemetrySink | undefined): void {
  sink = next
  started = false
  buffer = []
}

// Wait until after first render so the analytics chunk never competes with it.
function whenIdle(run: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 5000 })
  } else {
    setTimeout(run, 2000)
  }
}

async function loadPostHog(): Promise<TelemetrySink> {
  const { default: posthog } = await import('posthog-js')
  const key = (import.meta.env as { VITE_POSTHOG_KEY?: string })
    .VITE_POSTHOG_KEY
  posthog.init(key ?? '', {
    api_host: '/api/t',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_performance: false,
    capture_exceptions: false,
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    person_profiles: 'identified_only',
  })
  posthog.register({ $geoip_disable: true })
  return {
    capture: (name, props) => posthog.capture(name, props),
    identify: (email) => posthog.identify(email),
    reset: () => posthog.reset(),
    captureException: (error) => posthog.captureException(error),
  }
}

export function initTelemetry(
  load: () => Promise<TelemetrySink> = loadPostHog,
): void {
  if (started || sink) return
  started = true
  const run = () => {
    load().then(
      (s) => {
        sink = s
        flush(s)
      },
      (error) => {
        console.error('telemetry failed to load', error)
        buffer = []
      },
    )
  }
  // The default loader waits for idle; tests pass their own and run at once.
  if (load === loadPostHog) whenIdle(run)
  else run()
}
