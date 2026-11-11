import Dexie from 'dexie'
import {
  isSyncRecord,
  MAX_DATA_CHARS,
  PULL_LIMIT,
  PUSH_MAX_BYTES,
  type SyncRecord,
} from '../../shared/syncProtocol'
import { GlazetteDB } from '../db/db'
import { putBackPhoto, putBackPiece } from '../db/putBack'
import type { Piece } from '../db/types'
import { setSinkForTests, type TelemetrySink } from '../telemetry/telemetry'
import { SyncStopped, syncOnce, type Transport } from './engine'
import { createTestServer } from './testServer'
import { SYNCED_TABLES } from './track'

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'
const T3 = '2026-03-01T00:00:00.000Z'

const ME = 'me@example.com'

let a: GlazetteDB
let b: GlazetteDB
let server: ReturnType<typeof createTestServer>

beforeEach(async () => {
  const n = crypto.randomUUID()
  a = new GlazetteDB(`a-${n}`)
  b = new GlazetteDB(`b-${n}`)
  await a.open()
  await b.open()
  server = createTestServer()
})

afterEach(async () => {
  vi.restoreAllMocks()
  setSinkForTests(undefined)
  await a.delete()
  await b.delete()
})

const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  createdAt: T1,
  updatedAt: T1,
  ...extra,
})

/** Every row on a device, table by table. */
async function rowsOf(db: GlazetteDB) {
  const rows: Record<string, unknown[]> = {}
  for (const name of SYNCED_TABLES) rows[name] = await db.table(name).toArray()
  return rows
}

async function dirtyCount(db: GlazetteDB): Promise<number> {
  let count = 0
  for (const name of SYNCED_TABLES) {
    count += await db.table(name).where('dirty').equals(1).count()
  }
  return count
}

const onServer = (kind: SyncRecord['kind'], id: string) =>
  server.records().find((r) => r.kind === kind && r.id === id)

/** The test server, with every push recorded. */
function watched(target: Transport = server) {
  const pushed: SyncRecord[][] = []
  const transport: Transport = {
    pull: (since) => target.pull(since),
    push: (records) => {
      pushed.push(records)
      return target.push(records)
    },
  }
  return { transport, pushed }
}

test('a piece made on one device shows up on the other', async () => {
  await a.pieces.add(piece('p1', { name: 'Bowl' }))
  await a.entries.add({ id: 'e1', pieceId: 'p1', stage: 'glazed', date: T1 })
  await a.glazeApps.add({
    id: 'l1',
    entryId: 'e1',
    pieceId: 'p1',
    glazeId: 'g1',
    order: 0,
  })

  expect(await syncOnce(a, server, ME)).toBe('done')
  expect(await syncOnce(b, server, ME)).toBe('done')

  expect(await rowsOf(b)).toEqual(await rowsOf(a))
  expect((await b.pieces.get('p1'))?.name).toBe('Bowl')
  expect(await b.entries.get('e1')).toBeDefined()
  expect(await b.glazeApps.get('l1')).toBeDefined()
  expect(await dirtyCount(a)).toBe(0)
  expect(await dirtyCount(b)).toBe(0)
})

describe('the later edit wins and a tie goes to the server', () => {
  beforeEach(async () => {
    await a.pieces.add(piece('p1', { name: 'First' }))
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)
  })

  test('the later edit wins, whichever device syncs first', async () => {
    await b.pieces.update('p1', { name: 'Earlier', updatedAt: T2 })
    await a.pieces.update('p1', { name: 'Later', updatedAt: T3 })

    await syncOnce(b, server, ME)
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)

    expect((await a.pieces.get('p1'))?.name).toBe('Later')
    expect((await b.pieces.get('p1'))?.name).toBe('Later')
    expect(onServer('piece', 'p1')?.data.name).toBe('Later')
  })

  test('on a tie, the copy already on the server wins', async () => {
    await a.pieces.update('p1', { name: 'From A', updatedAt: T2 })
    await b.pieces.update('p1', { name: 'From B', updatedAt: T2 })

    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)

    expect((await b.pieces.get('p1'))?.name).toBe('From A')
    expect(onServer('piece', 'p1')?.data.name).toBe('From A')
    expect(await dirtyCount(b)).toBe(0)
  })

  test('a tie found only on push also goes to the server', async () => {
    await a.pieces.update('p1', { name: 'From A', updatedAt: T2 })
    await b.pieces.update('p1', { name: 'From B', updatedAt: T2 })
    // A's copy reaches the server after B's pull and before B's push.
    const racing: Transport = {
      pull: (since) => server.pull(since),
      push: async (records) => {
        await syncOnce(a, server, ME)
        return server.push(records)
      },
    }

    expect(await syncOnce(b, racing, ME)).toBe('done')

    expect((await b.pieces.get('p1'))?.name).toBe('From A')
    expect(onServer('piece', 'p1')?.data.name).toBe('From A')
    expect(await dirtyCount(b)).toBe(0)
  })
})

test('a delete travels', async () => {
  await a.pieces.add(piece('p1'))
  await syncOnce(a, server, ME)
  await syncOnce(b, server, ME)

  await a.pieces.update('p1', { deletedAt: T2 })
  await syncOnce(a, server, ME)
  await syncOnce(b, server, ME)

  expect((await b.pieces.get('p1'))?.deletedAt).toBe(T2)
})

test("an edit made during a sync isn't lost", async () => {
  await a.pieces.add(piece('p1', { name: 'Old' }))
  let edited = false
  const editing: Transport = {
    pull: (since) => server.pull(since),
    push: async (records) => {
      const answer = await server.push(records)
      if (!edited) {
        edited = true
        // The way the app edits a piece: with a later updatedAt.
        await a.pieces.update('p1', { name: 'New', updatedAt: T2 })
      }
      return answer
    },
  }

  expect(await syncOnce(a, editing, ME)).toBe('done')

  const row = await a.pieces.get('p1')
  expect(row?.name).toBe('New')
  expect(row?.dirty).toBe(1)
  expect(onServer('piece', 'p1')?.data.name).toBe('Old')

  expect(await syncOnce(a, server, ME)).toBe('done')
  expect(onServer('piece', 'p1')?.data.name).toBe('New')
  expect((await a.pieces.get('p1'))?.dirty).toBeUndefined()
})

test("a row whose rejected copy this version can't use stays waiting", async () => {
  // A later copy from a newer app version, without a field this one needs.
  await server.push([
    {
      kind: 'piece',
      id: 'p1',
      changedAt: T3,
      data: { id: 'p1', updatedAt: T3, name: 'From the future' },
    },
  ])
  await a.pieces.add(piece('p1', { name: 'Mine', updatedAt: T2 }))
  await a.pieces.add(piece('p2'))

  expect(await syncOnce(a, server, ME)).toBe('done')

  expect(await a.pieces.get('p1')).toMatchObject({ name: 'Mine', dirty: 1 })
  expect((await a.pieces.get('p2'))?.dirty).toBeUndefined()
  expect(onServer('piece', 'p1')?.data.name).toBe('From the future')
})

test("a stale device can't bring back a deleted piece", async () => {
  // Both devices restored the same backup.
  await a.pieces.add(piece('p1', { updatedAt: T1 }))
  await b.pieces.add(piece('p1', { updatedAt: T1 }))

  await a.pieces.update('p1', { deletedAt: T2 })
  expect(await syncOnce(a, server, ME)).toBe('done')
  expect(await syncOnce(b, server, ME)).toBe('done')

  expect((await b.pieces.get('p1'))?.deletedAt).toBe(T2)
  expect(onServer('piece', 'p1')?.data.deletedAt).toBe(T2)
  expect(await dirtyCount(b)).toBe(0)
})

describe("a device with a slow clock takes the server's copy", () => {
  beforeEach(async () => {
    await a.pieces.add(piece('p1', { name: 'First' }))
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)
  })

  test('when the later copy is already on the server', async () => {
    await a.pieces.update('p1', { name: 'Server', updatedAt: T3 })
    await syncOnce(a, server, ME)

    await b.pieces.update('p1', { name: 'Slow', updatedAt: T2 })
    expect(await syncOnce(b, server, ME)).toBe('done')

    const row = await b.pieces.get('p1')
    expect(row?.name).toBe('Server')
    expect(row?.updatedAt).toBe(T3)
    expect(row?.dirty).toBeUndefined()
    expect(onServer('piece', 'p1')?.data.name).toBe('Server')
  })

  test('when the later copy reaches the server during the sync', async () => {
    await a.pieces.update('p1', { name: 'Server', updatedAt: T3 })
    await b.pieces.update('p1', { name: 'Slow', updatedAt: T2 })
    const racing: Transport = {
      pull: (since) => server.pull(since),
      push: async (records) => {
        await syncOnce(a, server, ME)
        return server.push(records)
      },
    }

    expect(await syncOnce(b, racing, ME)).toBe('done')

    const row = await b.pieces.get('p1')
    expect(row?.name).toBe('Server')
    expect(row?.dirty).toBeUndefined()
    expect(onServer('piece', 'p1')?.data.name).toBe('Server')
  })
})

test('the first sign-in merges same-named glazes and clays', async () => {
  const settings = {
    id: 'app' as const,
    defaultCone: '6',
    bisqueNote: 'Cone 6',
    firedNote: 'Cone 6 oxidation',
  }
  await a.clays.add({ id: 'clay-a', name: 'White stoneware', updatedAt: T1 })
  await a.glazes.add({ id: 'g-a', name: 'Shino', color: '#aa8866' })
  await a.settings.add({ ...settings, defaultClayId: 'clay-a', updatedAt: T1 })

  await b.clays.add({ id: 'clay-b', name: 'White stoneware', updatedAt: T1 })
  await b.glazes.add({ id: 'g-b', name: ' shino', color: '#aa8866' })
  await b.settings.add({ ...settings, defaultClayId: 'clay-b', updatedAt: T2 })
  await b.pieces.add(piece('pb', { clayId: 'clay-b' }))
  await b.entries.add({ id: 'eb', pieceId: 'pb', stage: 'glazed' })
  await b.glazeApps.add({
    id: 'lb',
    entryId: 'eb',
    pieceId: 'pb',
    glazeId: 'g-b',
    order: 0,
  })

  expect(await syncOnce(a, server, ME)).toBe('done')
  expect(await syncOnce(b, server, ME)).toBe('done')

  const liveNamed = (
    rows: { id: string; name: string; deletedAt?: string }[],
    n: string,
  ) => rows.filter((r) => !r.deletedAt && r.name.trim().toLowerCase() === n)
  for (const device of [a, b]) {
    expect(
      liveNamed(await device.clays.toArray(), 'white stoneware').map(
        (c) => c.id,
      ),
    ).toEqual(['clay-a'])
    expect(
      liveNamed(await device.glazes.toArray(), 'shino').map((g) => g.id),
    ).toEqual(['g-a'])
  }
  const serverRows = (kind: SyncRecord['kind']) =>
    server
      .records()
      .filter((r) => r.kind === kind)
      .map((r) => r.data as { id: string; name: string; deletedAt?: string })
  expect(
    liveNamed(serverRows('clay'), 'white stoneware').map((c) => c.id),
  ).toEqual(['clay-a'])
  expect(liveNamed(serverRows('glaze'), 'shino').map((g) => g.id)).toEqual([
    'g-a',
  ])

  expect((await b.pieces.get('pb'))?.clayId).toBe('clay-a')
  expect((await b.glazeApps.get('lb'))?.glazeId).toBe('g-a')
  expect((await b.settings.get('app'))?.defaultClayId).toBe('clay-a')
  expect(onServer('piece', 'pb')?.data.clayId).toBe('clay-a')
  expect(onServer('glazeApp', 'lb')?.data.glazeId).toBe('g-a')
  expect(onServer('settings', 'app')?.data.defaultClayId).toBe('clay-a')
  expect(await dirtyCount(b)).toBe(0)
})

test("the name merge's move to the account's clay wins over a server copy with the same change time", async () => {
  // An earlier full sync stopped after pushing the piece, still pointing at
  // this device's own clay; another device already put the account's clay up.
  await server.push([
    {
      kind: 'clay',
      id: 'clay-acct',
      changedAt: T1,
      data: { id: 'clay-acct', name: 'White stoneware', updatedAt: T1 },
    },
    {
      kind: 'piece',
      id: 'p1',
      changedAt: T1,
      data: { id: 'p1', createdAt: T1, updatedAt: T1, clayId: 'clay-local' },
    },
  ])
  await a.clays.add({
    id: 'clay-local',
    name: 'White stoneware',
    updatedAt: T1,
  })
  await a.clays.add({ id: 'clay-acct', name: 'White stoneware', updatedAt: T1 })
  await a.pieces.add(piece('p1', { clayId: 'clay-local' }))

  expect(await syncOnce(a, server, ME)).toBe('done')

  expect((await a.pieces.get('p1'))?.clayId).toBe('clay-acct')
  expect(onServer('piece', 'p1')?.data.clayId).toBe('clay-acct')
  expect((await a.clays.get('clay-local'))?.deletedAt).toBeTruthy()
  expect(await dirtyCount(a)).toBe(0)
})

test('signing in to a different account runs a full sync', async () => {
  await a.pieces.add(piece('p1'))
  await a.pieces.add(piece('p2'))
  await a.clays.add({ id: 'c1', name: 'Porcelain' })
  await syncOnce(a, server, 'x@example.com')
  expect(await dirtyCount(a)).toBe(0)

  const other = createTestServer()
  const { transport, pushed } = watched(other)
  expect(await syncOnce(a, transport, 'y@example.com')).toBe('done')

  expect(
    pushed
      .flat()
      .map((r) => r.id)
      .sort(),
  ).toEqual(['c1', 'p1', 'p2'])
  expect(other.records()).toHaveLength(3)
  expect((await a.syncState.get('state'))?.account).toBe('y@example.com')
})

describe('stopping early keeps what is safe', () => {
  test('a pull that stops on page 2 keeps page 1 and its cursor', async () => {
    await syncOnce(b, server, ME)
    const before = await b.syncState.get('state')
    const records: SyncRecord[] = Array.from(
      { length: PULL_LIMIT + 50 },
      (_, i) => {
        const id = `p${i}`
        return {
          kind: 'piece',
          id,
          changedAt: T1,
          data: { id, createdAt: T1, updatedAt: T1 },
        }
      },
    )
    for (let i = 0; i < records.length; i += 100) {
      await server.push(records.slice(i, i + 100))
    }
    const page1 = await server.pull(before?.cursor ?? 0)
    let pulls = 0
    const flaky: Transport = {
      push: (r) => server.push(r),
      pull: async (since) => {
        pulls++
        if (pulls === 2) throw new SyncStopped('offline')
        return server.pull(since)
      },
    }

    expect(await syncOnce(b, flaky, ME)).toBe('offline')

    expect(await b.pieces.count()).toBe(PULL_LIMIT)
    const after = await b.syncState.get('state')
    expect(after?.cursor).toBe(page1.cursor)
    expect(after?.lastSyncedAt).toBe(before?.lastSyncedAt)
  })

  test('a push that stops leaves the rows waiting', async () => {
    await syncOnce(a, server, ME)
    const before = await a.syncState.get('state')
    await a.pieces.add(piece('p1'))
    await a.clays.add({ id: 'c1', name: 'Porcelain' })
    const signedOut: Transport = {
      pull: (since) => server.pull(since),
      push: async () => {
        throw new SyncStopped('signed-out')
      },
    }

    expect(await syncOnce(a, signedOut, ME)).toBe('signed-out')

    expect((await a.pieces.get('p1'))?.dirty).toBe(1)
    expect((await a.clays.get('c1'))?.dirty).toBe(1)
    expect(await a.syncState.get('state')).toEqual(before)
  })

  test('a full sync that stops saves no sync state, so the next one is full again', async () => {
    await a.pieces.add(piece('p1'))
    await syncOnce(a, server, ME)
    await b.pieces.add(piece('p2'))
    const offline: Transport = {
      pull: (since) => server.pull(since),
      push: async () => {
        throw new SyncStopped('offline')
      },
    }

    expect(await syncOnce(b, offline, ME)).toBe('offline')
    expect(await b.syncState.get('state')).toBeUndefined()

    const since: number[] = []
    const { transport, pushed } = watched()
    const spying: Transport = {
      push: transport.push,
      pull: (s) => {
        since.push(s)
        return transport.pull(s)
      },
    }
    expect(await syncOnce(b, spying, ME)).toBe('done')
    // Full again: it pulls from the start, though page 1 was applied last time.
    expect(since).toEqual([0])
    expect(pushed.flat().map((r) => r.id)).toEqual(['p2'])
    expect((await b.syncState.get('state'))?.account).toBe(ME)
  })

  test('anything else that goes wrong is an error, and is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: Transport = {
      pull: async () => {
        throw new Error('boom')
      },
      push: (r) => server.push(r),
    }

    expect(await syncOnce(a, broken, ME)).toBe('error')
    expect(log).toHaveBeenCalled()
  })

  test('an unexpected error reaches telemetry, a stop does not', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const captured: unknown[] = []
    setSinkForTests({
      capture: () => {},
      identify: () => {},
      reset: () => {},
      captureException: (e) => captured.push(e),
    })
    const boom = new Error('boom')
    const broken: Transport = {
      pull: async () => {
        throw boom
      },
      push: (r) => server.push(r),
    }
    expect(await syncOnce(a, broken, ME)).toBe('error')
    expect(captured).toEqual([boom])

    captured.length = 0
    const offline: Transport = {
      pull: async () => {
        throw new SyncStopped('offline')
      },
      push: (r) => server.push(r),
    }
    expect(await syncOnce(a, offline, ME)).toBe('offline')
    expect(captured).toEqual([])
  })

  test("a server that says there's more without moving on is an error", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stuck: Transport = {
      pull: async (since) => ({ records: [], cursor: since, more: true }),
      push: (r) => server.push(r),
    }

    expect(await syncOnce(a, stuck, ME)).toBe('error')
    expect(await a.syncState.get('state')).toBeUndefined()
  })
})

test('pushes stay under the size limit and every record arrives', async () => {
  const note = 'x'.repeat(15_000)
  await a.pieces.add(piece('p1'))
  await a.entries.bulkAdd(
    Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      pieceId: 'p1',
      stage: 'thrown' as const,
      note,
    })),
  )
  const { transport, pushed } = watched()

  expect(await syncOnce(a, transport, ME)).toBe('done')

  expect(pushed.length).toBeGreaterThan(1)
  for (const records of pushed) {
    expect(JSON.stringify(records).length).toBeLessThanOrEqual(PUSH_MAX_BYTES)
  }
  const onServerIds = server
    .records()
    .filter((r) => r.kind === 'entry')
    .map((r) => r.id)
  expect(onServerIds.sort()).toEqual(
    Array.from({ length: 60 }, (_, i) => `e${i}`).sort(),
  )
  expect(await dirtyCount(a)).toBe(0)
})

test('pushes are sized in bytes, so long Japanese notes stay under the limit', async () => {
  // 3 bytes per character in UTF-8.
  const note = '釉薬が垂れる'.repeat(2_500)
  await a.pieces.add(piece('p1'))
  await a.entries.bulkAdd(
    Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      pieceId: 'p1',
      stage: 'thrown' as const,
      note,
    })),
  )
  const { transport, pushed } = watched()

  expect(await syncOnce(a, transport, ME)).toBe('done')

  expect(pushed.length).toBeGreaterThan(1)
  for (const records of pushed) {
    const bytes = new TextEncoder().encode(JSON.stringify(records)).length
    expect(bytes).toBeLessThanOrEqual(PUSH_MAX_BYTES)
  }
  const onServerIds = server
    .records()
    .filter((r) => r.kind === 'entry')
    .map((r) => r.id)
  expect(onServerIds.sort()).toEqual(
    Array.from({ length: 60 }, (_, i) => `e${i}`).sort(),
  )
  expect(await dirtyCount(a)).toBe(0)
})

test('records of the largest size, in 3-byte text, each fit in a push', async () => {
  const step = {
    id: 'e0',
    pieceId: 'p1',
    stage: 'thrown' as const,
    updatedAt: T1,
    note: '',
  }
  // As much 3-byte text as one record's data may hold.
  const note = '釉'.repeat(MAX_DATA_CHARS - JSON.stringify(step).length)
  await a.pieces.add(piece('p1'))
  await a.entries.bulkAdd(
    ['e0', 'e1', 'e2'].map((id) => ({ ...step, id, note })),
  )
  const { transport, pushed } = watched()

  expect(await syncOnce(a, transport, ME)).toBe('done')

  const steps = pushed.flat().filter((r) => r.kind === 'entry')
  expect(steps).toHaveLength(3)
  for (const record of steps) {
    expect(JSON.stringify(record.data).length).toBe(MAX_DATA_CHARS)
    expect(isSyncRecord(record)).toBe(true)
    const bytes = new TextEncoder().encode(JSON.stringify([record])).length
    expect(bytes).toBeGreaterThan(3 * MAX_DATA_CHARS - 1_000)
    expect(bytes).toBeLessThanOrEqual(PUSH_MAX_BYTES)
  }
  for (const records of pushed) {
    const bytes = new TextEncoder().encode(JSON.stringify(records)).length
    expect(bytes).toBeLessThanOrEqual(PUSH_MAX_BYTES)
  }
  expect(
    server
      .records()
      .filter((r) => r.kind === 'entry')
      .map((r) => r.id)
      .sort(),
  ).toEqual(['e0', 'e1', 'e2'])
  expect(await dirtyCount(a)).toBe(0)
})

test('nothing to do is still a sync', async () => {
  await a.pieces.add(piece('p1'))
  expect(await syncOnce(a, server, ME)).toBe('done')

  const { transport, pushed } = watched()
  expect(await syncOnce(a, transport, ME)).toBe('done')
  expect(pushed.flat()).toEqual([])
})

test('a sync saves the account, cursor and time', async () => {
  await a.pieces.add(piece('p1'))
  await syncOnce(a, server, ME)
  await syncOnce(b, server, ME)

  const state = await b.syncState.get('state')
  expect(state?.account).toBe(ME)
  expect(state?.cursor).toBe((await server.pull(0)).cursor)
  expect(Number.isNaN(Date.parse(state?.lastSyncedAt ?? ''))).toBe(false)
})

test("photo details sync, and each device's bytes stay where they are", async () => {
  const photo = (id: string, n: string) => ({
    id,
    blob: new Blob(['full'], { type: 'image/jpeg' }),
    thumb: new Blob(['th'], { type: 'image/jpeg' }),
    hash: n.repeat(64),
    width: 1,
    height: 1,
    takenAt: T1,
  })
  await a.photos.add(photo('ph-a', 'a'))
  await b.photos.add(photo('ph-b', 'b'))
  await a.pieces.add(piece('p1'))
  await a.entries.add({
    id: 'e1',
    pieceId: 'p1',
    stage: 'thrown',
    photoId: 'ph-a',
  })

  await syncOnce(a, server, ME)
  await syncOnce(b, server, ME)
  await syncOnce(a, server, ME)

  const sent = server.records().filter((r) => r.kind === 'photo')
  expect(sent.map((r) => r.id).sort()).toEqual(['ph-a', 'ph-b'])
  for (const r of sent) expect(r.data).not.toHaveProperty('blob')

  // B has A's photo as details only, waiting for its bytes.
  const pulledPhoto = await b.photos.get('ph-a')
  expect(pulledPhoto?.needsDownload).toBe(1)
  expect(pulledPhoto?.blob).toBeUndefined()
  expect((await b.entries.get('e1'))?.photoId).toBe('ph-a')
  // Each device still holds its own bytes.
  expect((await b.photos.get('ph-b'))?.blob).toBeDefined()
  expect((await a.photos.get('ph-a'))?.blob).toBeDefined()
  expect((await a.photos.get('ph-b'))?.needsDownload).toBe(1)
})

test('the same image under two ids becomes one on both devices', async () => {
  const photo = (id: string) => ({
    id,
    hash: 'a'.repeat(64),
    width: 1,
    height: 1,
    takenAt: T1,
  })
  const bytes = { hash: 'a'.repeat(64), blob: new Blob(['full']) }
  await a.photoBytes.add(bytes)
  await a.photos.add({ ...photo('ph-b'), needsUpload: 1 })
  await a.pieces.add(piece('p1'))
  await a.entries.add({
    id: 'e1',
    pieceId: 'p1',
    stage: 'thrown',
    photoId: 'ph-b',
  })
  await b.photoBytes.add(bytes)
  await b.photos.add(photo('ph-a'))
  await b.pieces.add(piece('p2'))
  await b.entries.add({
    id: 'e2',
    pieceId: 'p2',
    stage: 'thrown',
    photoId: 'ph-a',
  })

  await syncOnce(a, server, ME)
  await syncOnce(b, server, ME)
  await syncOnce(a, server, ME)

  for (const db of [a, b]) {
    const live = (await db.photos.toArray()).filter((p) => !p.deletedAt)
    expect(live.map((p) => p.id)).toEqual(['ph-a'])
    expect(await db.photoBytes.count()).toBe(1)
    expect(live[0].needsDownload).toBeUndefined()
    expect((await db.entries.get('e1'))?.photoId).toBe('ph-a')
    expect((await db.entries.get('e2'))?.photoId).toBe('ph-a')
    expect((await db.photos.get('ph-b'))?.mergedInto).toBe('ph-a')
    // A full sync set each device's copy waiting. Whichever row it's on, the
    // image still gets its upload, once.
    expect(await db.photos.where('needsUpload').equals(1).count()).toBe(1)
  }
})

test('a photo made on one device arrives as details first', async () => {
  await a.photos.add({
    id: 'ph-a',
    blob: new Blob(['full'], { type: 'image/jpeg' }),
    thumb: new Blob(['th'], { type: 'image/jpeg' }),
    hash: 'a'.repeat(64),
    width: 1,
    height: 1,
    takenAt: T1,
  })
  await a.pieces.add(piece('p1'))
  await a.entries.add({
    id: 'e1',
    pieceId: 'p1',
    stage: 'thrown',
    photoId: 'ph-a',
  })
  await syncOnce(a, server, ME)
  await syncOnce(b, server, ME)

  const row = await b.photos.get('ph-a')
  expect(row?.needsDownload).toBe(1)
  expect(row?.blob).toBeUndefined()
  expect((await b.entries.get('e1'))?.photoId).toBe('ph-a')
})

test('a full sync pulls from the start and an incremental one from the cursor', async () => {
  await a.pieces.add(piece('p1'))
  await syncOnce(a, server, ME)
  const since: number[] = []
  const spying: Transport = {
    push: (r) => server.push(r),
    pull: (s) => {
      since.push(s)
      return server.pull(s)
    },
  }

  await syncOnce(b, spying, ME)
  const cursor = (await b.syncState.get('state'))?.cursor
  await syncOnce(b, spying, ME)

  expect(since).toEqual([0, cursor])
  expect(cursor).toBeGreaterThan(0)
})

describe('rows changed before this update keep their changes at first sync', () => {
  const V2_STORES = {
    pieces: 'id, updatedAt, deletedAt',
    entries: 'id, pieceId, [pieceId+date], stage, deletedAt',
    glazeApps: 'id, entryId, pieceId, glazeId',
    glazes: 'id, name, deletedAt',
    clays: 'id, name, deletedAt',
    photos: 'id, hash',
    settings: 'id',
  }
  // The settings ensureDefaults writes.
  const DEFAULTS = {
    id: 'app' as const,
    defaultCone: '6',
    bisqueNote: 'Cone 6',
    firedNote: 'Cone 6 oxidation',
  }

  /**
   * Rebuilds a device as it was before this update (database version 2, no
   * change times), then opens it as the app does, which runs the upgrade.
   */
  async function fromBeforeTheUpdate(
    device: GlazetteDB,
    seed: (old: Dexie) => Promise<void>,
  ) {
    await device.delete()
    const old = new Dexie(device.name)
    old.version(2).stores(V2_STORES)
    await old.open()
    await seed(old)
    old.close()
    await device.open()
  }

  test('edited settings from before the update survive a first sync against untouched defaults', async () => {
    await fromBeforeTheUpdate(a, async (old) => {
      await old.table('clays').add({ id: 'clay-a', name: 'White stoneware' })
      await old.table('settings').add({ ...DEFAULTS, defaultClayId: 'clay-a' })
    })
    await fromBeforeTheUpdate(b, async (old) => {
      await old.table('clays').add({ id: 'clay-b', name: 'White stoneware' })
      await old.table('settings').add({
        ...DEFAULTS,
        defaultClayId: 'clay-b',
        studioName: 'Penguin Foot',
        bisqueNote: 'Cone 04',
      })
    })

    expect(await syncOnce(a, server, ME)).toBe('done')
    expect(await syncOnce(b, server, ME)).toBe('done')
    expect(await syncOnce(a, server, ME)).toBe('done')

    const edited = { studioName: 'Penguin Foot', bisqueNote: 'Cone 04' }
    expect(await a.settings.get('app')).toMatchObject(edited)
    expect(await b.settings.get('app')).toMatchObject(edited)
    expect(onServer('settings', 'app')?.data).toMatchObject(edited)
  })

  test('a step edited before the update on one device survives a first sync', async () => {
    // Both devices restored the same backup; B then dated and noted the step.
    const step = { id: 'e1', pieceId: 'p1', stage: 'thrown' }
    const edited = { date: T2, note: 'Wide foot ring' }
    await fromBeforeTheUpdate(a, async (old) => {
      await old.table('pieces').add(piece('p1', { updatedAt: T1 }))
      await old.table('entries').add(step)
    })
    await fromBeforeTheUpdate(b, async (old) => {
      await old.table('pieces').add(piece('p1', { updatedAt: T2 }))
      await old.table('entries').add({ ...step, ...edited })
    })

    expect(await syncOnce(a, server, ME)).toBe('done')
    expect(await syncOnce(b, server, ME)).toBe('done')
    expect(await syncOnce(a, server, ME)).toBe('done')

    expect(await a.entries.get('e1')).toMatchObject(edited)
    expect(await b.entries.get('e1')).toMatchObject(edited)
    expect(onServer('entry', 'e1')?.data).toMatchObject(edited)
  })
})

describe('recently deleted', () => {
  const HASH = 'a'.repeat(64)
  const photoRow = (id: string) => ({
    id,
    hash: HASH,
    width: 1,
    height: 1,
    takenAt: T1,
  })

  /** A holds piece p1 with photo ph1 on step e1, and both devices have synced. */
  async function sharedPhoto() {
    await a.photoBytes.add({ hash: HASH, blob: new Blob(['full']) })
    await a.pieces.add(piece('p1'))
    await a.photos.add({ ...photoRow('ph1'), needsUpload: 1 })
    await a.entries.add({
      id: 'e1',
      pieceId: 'p1',
      stage: 'trimmed',
      photoId: 'ph1',
    })
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)
  }

  test("an old device can't bring back a purged piece", async () => {
    await a.pieces.add(piece('p1', { name: 'Bowl' }))
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)
    // B stops syncing. A deletes the piece, and the server purges it.
    await a.pieces.update('p1', { deletedAt: T2, updatedAt: T2 })
    await syncOnce(a, server, ME)
    expect(server.clockOf('piece', 'p1')).toBeDefined()
    server.purge('piece', 'p1')
    await b.pieces.update('p1', { name: 'Edited', updatedAt: T3 })

    expect(await syncOnce(b, server, ME)).toBe('done')

    const row = await b.pieces.get('p1')
    expect(row?.deletedAt).toBeTruthy()
    expect(row?.purgedAt).toBeTruthy()
    expect(row?.dirty).toBeUndefined()
    const stub = onServer('piece', 'p1')
    expect(stub?.data).toEqual({
      id: 'p1',
      deletedAt: stub?.data.purgedAt,
      purgedAt: expect.any(String),
    })
    expect(server.clockOf('piece', 'p1')).toBeUndefined()
    // Even a later copy pushed straight to the server is refused.
    const { rejected } = await server.push([
      {
        kind: 'piece',
        id: 'p1',
        changedAt: '2026-12-01T00:00:00.000Z',
        data: piece('p1', { updatedAt: '2026-12-01T00:00:00.000Z' }) as never,
      },
    ])
    expect(rejected).toEqual([stub])
    expect(onServer('piece', 'p1')).toEqual(stub)
  })

  test("a full sync can't relist a purged record", async () => {
    await a.pieces.add(piece('p1'))
    await a.pieces.update('p1', { deletedAt: T2, updatedAt: T2 })
    await syncOnce(a, server, ME)
    server.purge('piece', 'p1')
    const stub = onServer('piece', 'p1')
    await a.syncState.clear()

    expect(await syncOnce(a, server, ME)).toBe('done')

    expect(onServer('piece', 'p1')).toEqual(stub)
    expect((await a.pieces.get('p1'))?.purgedAt).toBe(stub?.data.purgedAt)
    expect(await dirtyCount(a)).toBe(0)
  })

  test('a stub stops the upload of a photo waiting to go', async () => {
    // The server holds ph1 deleted; this device has it, waiting to upload.
    await server.push([
      {
        kind: 'photo',
        id: 'ph1',
        changedAt: T1,
        data: { ...photoRow('ph1'), updatedAt: T1, deletedAt: T1 },
      },
    ])
    await a.photoBytes.add({ hash: HASH, blob: new Blob(['full']) })
    await a.photos.add({ ...photoRow('ph1'), updatedAt: T2, needsUpload: 1 })
    // The daily job purges it between this device's pull and its push.
    const purging: Transport = {
      pull: (since) => server.pull(since),
      push: (records) => {
        server.purge('photo', 'ph1')
        return server.push(records)
      },
    }

    expect(await syncOnce(a, purging, ME)).toBe('done')

    const row = await a.photos.get('ph1')
    expect(row?.needsUpload).toBeUndefined()
    expect(row?.purgedAt).toBeTruthy()
    expect(row?.deletedAt).toBeTruthy()
    expect(row?.dirty).toBeUndefined()
    expect(await a.photoBytes.get(HASH)).toBeDefined()
  })

  test("a deleted step's photo is deleted on both devices", async () => {
    await sharedPhoto()
    // As the app deletes a step: the photo row isn't touched.
    await a.entries.update('e1', { deletedAt: new Date().toISOString() })

    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)
    await syncOnce(b, server, ME)

    const place = { lastPieceId: 'p1', lastEntryId: 'e1', lastStage: 'trimmed' }
    for (const db of [a, b]) {
      const row = await db.photos.get('ph1')
      expect(row?.deletedAt).toBeTruthy()
      expect(row).toMatchObject(place)
    }
    expect((await b.photos.get('ph1'))?.dirty).toBeUndefined()
    expect(await dirtyCount(b)).toBe(0)
    expect(onServer('photo', 'ph1')?.data).toMatchObject(place)
    expect(server.clockOf('photo', 'ph1')).toBeDefined()
    // A still holds the image.
    expect(await a.photoBytes.get(HASH)).toBeDefined()
  })

  test.each([['A, B, A, B'], ['B, A, B, A']])(
    "a photo in use on one device isn't lost to a delete on the other (%s)",
    async (order) => {
      await sharedPhoto()
      // Offline, A deletes the step and B adds another with the same photo.
      await a.entries.update('e1', { deletedAt: new Date().toISOString() })
      await b.entries.add({
        id: 'e2',
        pieceId: 'p1',
        stage: 'bisqued',
        photoId: 'ph1',
      })

      for (const device of order.split(', ')) {
        expect(await syncOnce(device === 'A' ? a : b, server, ME)).toBe('done')
      }

      for (const db of [a, b]) {
        expect((await db.photos.get('ph1'))?.deletedAt).toBeUndefined()
        const e2 = await db.entries.get('e2')
        expect(e2?.photoId).toBe('ph1')
        expect(e2?.deletedAt).toBeUndefined()
        expect((await db.entries.get('e1'))?.deletedAt).toBeTruthy()
      }
      expect(onServer('photo', 'ph1')?.data.deletedAt).toBeUndefined()
      expect(server.clockOf('photo', 'ph1')).toBeUndefined()
      // Nothing is still waiting to go.
      expect(await dirtyCount(a)).toBe(0)
      expect(await dirtyCount(b)).toBe(0)
    },
  )

  test('a restored photo the server purged comes back as a new photo', async () => {
    // A deleted ph1 long ago, and the server has purged it.
    await a.pieces.add(piece('p1'))
    await a.photos.add({ ...photoRow('ph1'), deletedAt: T2 })
    await syncOnce(a, server, ME)
    server.purge('photo', 'ph1')
    // B has synced since, so it never held ph1.
    await syncOnce(b, server, ME)
    expect(await b.photos.get('ph1')).toBeUndefined()
    // B restores a backup from before the delete: a step showing ph1, with
    // its image.
    await b.photoBytes.add({ hash: HASH, blob: new Blob(['full']) })
    await b.photos.add({ ...photoRow('ph1'), updatedAt: T1, needsUpload: 1 })
    await b.entries.add({
      id: 'e1',
      pieceId: 'p1',
      stage: 'thrown',
      photoId: 'ph1',
      updatedAt: T1,
    })

    // The push is refused and the stub comes back; the next sync re-homes it.
    await syncOnce(b, server, ME)
    expect((await b.photos.get('ph1'))?.purgedAt).toBeTruthy()
    await syncOnce(b, server, ME)

    const photoId = (await b.entries.get('e1'))?.photoId as string
    expect(photoId).not.toBe('ph1')
    const row = await b.photos.get(photoId)
    expect(row).toMatchObject({ hash: HASH, needsUpload: 1 })
    expect(row?.deletedAt).toBeUndefined()
    expect(onServer('photo', photoId)?.data).toMatchObject({ hash: HASH })
    expect(onServer('photo', photoId)?.data.deletedAt).toBeUndefined()
    expect(onServer('entry', 'e1')?.data.photoId).toBe(photoId)
    expect(onServer('photo', 'ph1')?.data.purgedAt).toBeTruthy()
    expect(await dirtyCount(b)).toBe(0)
  })

  test('a piece deleted on one device and put back on the other returns on both', async () => {
    await sharedPhoto()
    await a.glazeApps.add({
      id: 'l1',
      entryId: 'e1',
      pieceId: 'p1',
      glazeId: 'g1',
      order: 0,
    })
    await a.pieces.update('p1', { deletedAt: new Date().toISOString() })
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)
    expect((await b.pieces.get('p1'))?.deletedAt).toBeTruthy()

    await putBackPiece('p1', b)
    await syncOnce(b, server, ME)
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)

    for (const db of [a, b]) {
      expect((await db.pieces.get('p1'))?.deletedAt).toBeUndefined()
      expect((await db.entries.get('e1'))?.photoId).toBe('ph1')
      expect((await db.entries.get('e1'))?.deletedAt).toBeUndefined()
      expect((await db.glazeApps.get('l1'))?.deletedAt).toBeUndefined()
      expect((await db.photos.get('ph1'))?.deletedAt).toBeUndefined()
      expect(await dirtyCount(db)).toBe(0)
    }
    expect(onServer('piece', 'p1')?.data.deletedAt).toBeUndefined()
    expect(server.clockOf('piece', 'p1')).toBeUndefined()
  })

  test('a photo put back on the other device returns on both', async () => {
    await sharedPhoto()
    await a.entries.update('e1', { deletedAt: new Date().toISOString() })
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)
    await syncOnce(a, server, ME)
    expect((await b.photos.get('ph1'))?.deletedAt).toBeTruthy()
    // The step was deleted, so the photo goes on a new step.

    const back = await putBackPhoto('ph1', b)
    expect(back?.id).toBe('p1')
    await syncOnce(b, server, ME)
    await syncOnce(a, server, ME)
    await syncOnce(b, server, ME)

    for (const db of [a, b]) {
      const row = await db.photos.get('ph1')
      expect(row?.deletedAt).toBeUndefined()
      expect(row?.lastPieceId).toBeUndefined()
      const shown = await db.entries
        .filter((e) => e.photoId === 'ph1' && !e.deletedAt)
        .toArray()
      expect(shown).toHaveLength(1)
      expect(shown[0]).toMatchObject({ pieceId: 'p1', stage: 'trimmed' })
      expect(await dirtyCount(db)).toBe(0)
    }
    expect(await a.photoBytes.get(HASH)).toBeDefined()
    expect((await a.photos.get('ph1'))?.needsDownload).toBeUndefined()
  })
})
