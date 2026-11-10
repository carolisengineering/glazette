// For tests only: an in-memory sync server for one user, following the same
// rules as the Worker (worker/sync.ts).

import {
  EXPIRING_KINDS,
  isSyncRecord,
  MAX_BODY_BYTES,
  PULL_LIMIT,
  PUSH_LIMIT,
  type PullResponse,
  type PushResponse,
  type RecordKind,
  type SyncRecord,
} from '../../shared/syncProtocol'
import { SyncStopped, type Transport } from './engine'

/** A copy as it would come over the wire. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export interface TestServer extends Transport {
  records(): SyncRecord[]
  /** What the daily job does to an expired record: it becomes a stub. */
  purge(kind: RecordKind, id: string): void
  /** When the server first heard of the record's delete, if it's counting. */
  clockOf(kind: RecordKind, id: string): string | undefined
}

interface Stored {
  record: SyncRecord
  seq: number
  // When the server first heard of the delete, for a kind that expires.
  heardAt?: string
  purged?: true
}

export function createTestServer(): TestServer {
  const stored = new Map<string, Stored>()
  let lastSeq = 0

  const inSeqOrder = () => [...stored.values()].sort((x, y) => x.seq - y.seq)

  return {
    async push(records: SyncRecord[]): Promise<PushResponse> {
      const keys = new Set(records.map((r) => `${r.kind}/${r.id}`))
      const body = new TextEncoder().encode(JSON.stringify({ records }))
      if (
        body.length > MAX_BODY_BYTES ||
        records.length > PUSH_LIMIT ||
        !records.every(isSyncRecord) ||
        keys.size !== records.length
      ) {
        throw new SyncStopped('error')
      }
      const rejected: SyncRecord[] = []
      const now = new Date().toISOString()
      for (const record of copy(records)) {
        const key = `${record.kind}/${record.id}`
        const mine = stored.get(key)
        // Strictly later wins; on a tie the stored copy stays. A stub is
        // never replaced.
        if (
          mine &&
          (mine.purged || mine.record.changedAt >= record.changedAt)
        ) {
          rejected.push(copy(mine.record))
        } else {
          // A winning delete keeps the first time it was heard; a winning
          // live copy clears it.
          const deleting =
            (EXPIRING_KINDS as readonly string[]).includes(record.kind) &&
            typeof record.data.deletedAt === 'string'
          stored.set(key, {
            record,
            seq: ++lastSeq,
            heardAt: deleting ? (mine?.heardAt ?? now) : undefined,
          })
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

    purge(kind: RecordKind, id: string): void {
      const mine = stored.get(`${kind}/${id}`)
      if (!mine) throw new Error(`No ${kind} ${id} to purge`)
      // Keeps its change time, and is pulled again.
      const now = new Date().toISOString()
      stored.set(`${kind}/${id}`, {
        record: {
          kind,
          id,
          changedAt: mine.record.changedAt,
          data: { id, deletedAt: now, purgedAt: now },
        },
        seq: ++lastSeq,
        purged: true,
      })
    },

    clockOf(kind: RecordKind, id: string): string | undefined {
      return stored.get(`${kind}/${id}`)?.heardAt
    },
  }
}
