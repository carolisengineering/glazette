import type {
  DeletedItem,
  PullResponse,
  PushResponse,
  SyncRecord,
} from '../../shared/syncProtocol'
import { isObject } from '../db/rowChecks'
import { SyncStopped, type Transport } from './engine'

/** How long one request may take before the sync gives up on it as offline. */
export const SYNC_TIMEOUT_MS = 30_000

/**
 * One fetch, with `read` turning the response into the answer, all under one
 * timeout. Throws SyncStopped('offline') on a network failure or timeout.
 * `read` throws SyncStopped for answers it can't use. Anything else it throws
 * becomes a SyncStopped too: offline if the timeout aborted it, else error.
 */
export async function timedFetch<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  // One sync runs at a time, so a request that hangs would stall every later
  // sync. The timeout also rejects by itself, in case fetch ignores the abort.
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new SyncStopped('offline'))
    }, timeoutMs)
  })
  const answer = (async () => {
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        credentials: 'same-origin',
        signal: controller.signal,
      })
    } catch {
      throw new SyncStopped('offline')
    }
    try {
      return await read(res)
    } catch (error) {
      if (error instanceof SyncStopped) throw error
      throw new SyncStopped(controller.signal.aborted ? 'offline' : 'error')
    }
  })()
  // If the timeout wins, the answer's later failure is not an unhandled rejection.
  answer.catch(() => {})
  timedOut.catch(() => {})
  try {
    return await Promise.race([answer, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/** The server's answer as JSON. Throws SyncStopped for anything but a 2xx JSON answer. */
function request(url: string, init: RequestInit): Promise<unknown> {
  return timedFetch(url, init, SYNC_TIMEOUT_MS, async (res) => {
    if (res.status === 401) throw new SyncStopped('signed-out')
    if (!res.ok) throw new SyncStopped('error')
    return (await res.json()) as unknown
  })
}

// Only the envelope is checked. Each record is checked when it's applied, so
// one this version can't use is skipped rather than stopping the sync.

function isPushResponse(v: unknown): v is PushResponse {
  return isObject(v) && Array.isArray(v.rejected)
}

function isPullResponse(v: unknown): v is PullResponse {
  return (
    isObject(v) &&
    Array.isArray(v.records) &&
    Number.isSafeInteger(v.cursor) &&
    (v.cursor as number) >= 0 &&
    typeof v.more === 'boolean'
  )
}

/** Same-origin calls to the Worker's sync routes. */
export const fetchTransport: Transport = {
  async push(records: SyncRecord[]): Promise<PushResponse> {
    const body = await request('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ records }),
    })
    if (!isPushResponse(body)) throw new SyncStopped('error')
    return body
  },

  async pull(since: number): Promise<PullResponse> {
    const body = await request(`/api/sync/pull?since=${since}`, {
      method: 'GET',
    })
    if (!isPullResponse(body)) throw new SyncStopped('error')
    return body
  },
}

/**
 * What the server holds that was deleted and can still be put back. A word
 * for a list that can't be had: offline, signed out or an error.
 */
export async function fetchDeleted(): Promise<
  DeletedItem[] | 'offline' | 'signed-out' | 'error'
> {
  try {
    const body = await request('/api/sync/deleted', { method: 'GET' })
    if (!isObject(body) || !Array.isArray(body.items)) return 'error'
    return body.items as DeletedItem[]
  } catch (error) {
    return error instanceof SyncStopped ? error.reason : 'error'
  }
}
