import Dexie from 'dexie'
import {
  PULL_LIMIT,
  PUSH_MAX_CHARS,
  type SyncRecord,
} from '../../shared/syncProtocol'
import { GlazetteDB } from '../db/db'
import type { Piece } from '../db/types'
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
    expect(JSON.stringify(records).length).toBeLessThanOrEqual(PUSH_MAX_CHARS)
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

test('photos are never touched', async () => {
  const photo = (id: string) => ({
    id,
    blob: new Blob(['full'], { type: 'image/jpeg' }),
    thumb: new Blob(['th'], { type: 'image/jpeg' }),
    hash: `h-${id}`,
    width: 1,
    height: 1,
    takenAt: T1,
  })
  await a.photos.add(photo('ph-a'))
  await b.photos.add(photo('ph-b'))
  await a.pieces.add(piece('p1'))
  await a.entries.add({
    id: 'e1',
    pieceId: 'p1',
    stage: 'thrown',
    photoId: 'ph-a',
  })
  const bPhotosBefore = await b.photos.toArray()

  await syncOnce(a, server, ME)
  await syncOnce(b, server, ME)

  expect(server.records().map((r) => r.id)).not.toContain('ph-a')
  expect(server.records().map((r) => r.kind)).not.toContain('photo')
  expect(await b.photos.toArray()).toEqual(bPhotosBefore)
  expect((await a.photos.toArray()).map((p) => p.id)).toEqual(['ph-a'])
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
