// For tests only: an in-memory sync server for one user, following the same
// rules as the Worker (worker/sync.ts).

import {
  isSyncRecord,
  PULL_LIMIT,
  PUSH_LIMIT,
  type PullResponse,
  type PushResponse,
  type SyncRecord,
} from '../../shared/syncProtocol'
import { SyncStopped, type Transport } from './engine'

/** A copy as it would come over the wire. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function createTestServer(): Transport & { records(): SyncRecord[] } {
  const stored = new Map<string, { record: SyncRecord; seq: number }>()
  let lastSeq = 0

  const inSeqOrder = () => [...stored.values()].sort((x, y) => x.seq - y.seq)

  return {
    async push(records: SyncRecord[]): Promise<PushResponse> {
      const keys = new Set(records.map((r) => `${r.kind}/${r.id}`))
      if (
        records.length > PUSH_LIMIT ||
        !records.every(isSyncRecord) ||
        keys.size !== records.length
      ) {
        throw new SyncStopped('error')
      }
      const rejected: SyncRecord[] = []
      for (const record of copy(records)) {
        const key = `${record.kind}/${record.id}`
        const mine = stored.get(key)
        // Strictly later wins; on a tie the stored copy stays.
        if (mine && mine.record.changedAt >= record.changedAt) {
          rejected.push(copy(mine.record))
        } else {
          stored.set(key, { record, seq: ++lastSeq })
        }
      }
      return { rejected }
    },

    async pull(since: number): Promise<PullResponse> {
      const page = inSeqOrder()
        .filter((s) => s.seq > since)
        .slice(0, PULL_LIMIT)
      return {
        records: page.map((s) => copy(s.record)),
        cursor: page.length > 0 ? page[page.length - 1].seq : since,
        more: page.length === PULL_LIMIT,
      }
    },

    records(): SyncRecord[] {
      return inSeqOrder().map((s) => copy(s.record))
    },
  }
}
