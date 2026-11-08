import type {
  PullResponse,
  PushResponse,
  SyncRecord,
} from '../../shared/syncProtocol'
import { SyncStopped, type Transport } from './engine'

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The server's answer as JSON. Throws SyncStopped for anything but a 2xx JSON answer. */
async function request(url: string, init: RequestInit): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { ...init, credentials: 'same-origin' })
  } catch {
    throw new SyncStopped('offline')
  }
  if (res.status === 401) throw new SyncStopped('signed-out')
  if (!res.ok) throw new SyncStopped('error')
  try {
    return await res.json()
  } catch {
    throw new SyncStopped('error')
  }
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
