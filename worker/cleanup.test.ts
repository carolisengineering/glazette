import { createHash } from 'node:crypto'
import {
  PUSH_LIMIT,
  type PullResponse,
  type SyncRecord,
} from '../shared/syncProtocol'
import { createApp } from './app'
import { PURGE_LIMIT, R2_DELETE_MAX_KEYS, runCleanup } from './cleanup'
import type { Env } from './env'
import { createSession } from './sessions'
import { makeTestEnv } from './test/harness'

const ORIGIN = 'http://localhost'
const T1 = '2026-11-07T10:00:00.000Z'
const DAY = 86_400_000

let env: Env
let bucket: R2Bucket
let dispose: () => Promise<void>
let app: ReturnType<typeof createApp>
let cookie1: string
let cookie2: string
let NOW: number

async function addUser(id: string, email: string) {
  await env.DB.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)',
  )
    .bind(id, email, Date.now())
    .run()
  return `__Host-session_token=${await createSession(env.DB, id, Date.now())}`
}

beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
  // A request made in Node has a body stream of unknown length, which R2 refuses
  // (a real Worker request has a known length). Hand R2 the bytes instead.
  bucket = env.PHOTOS
  env = {
    ...env,
    PHOTOS: {
      put: async (key: string, value: unknown, options: R2PutOptions) =>
        bucket.put(
          key,
          value instanceof ReadableStream
            ? await new Response(value).arrayBuffer()
            : (value as ArrayBuffer | null),
          options,
        ),
      get: (key: string) => bucket.get(key),
      head: (key: string) => bucket.head(key),
      delete: (keys: string | string[]) => bucket.delete(keys),
    } as unknown as R2Bucket,
  }
  app = createApp()
  cookie1 = await addUser('user-1', 'one@example.com')
  cookie2 = await addUser('user-2', 'two@example.com')
  NOW = Date.now()
  // The job logs its counts on every run.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await dispose()
})

const iso = (ms: number) => new Date(ms).toISOString()

// --- Records -----------------------------------------------------------------

const piece = (id: string, deletedAt?: string): SyncRecord => ({
  kind: 'piece',
  id,
  changedAt: T1,
  data: { id, name: `Bowl ${id}`, notes: 'Thin walls.', deletedAt },
})

const step = (
  id: string,
  pieceId: string,
  photoId?: string,
  deletedAt?: string,
): SyncRecord => ({
  kind: 'entry',
  id,
  changedAt: T1,
  data: { id, pieceId, stage: 'glazed', photoId, note: 'Cone 6', deletedAt },
})

const layer = (
  id: string,
  pieceId: string,
  entryId: string,
  deletedAt?: string,
): SyncRecord => ({
  kind: 'glazeApp',
  id,
  changedAt: T1,
  data: { id, pieceId, entryId, glazeId: 'g1', order: 1, deletedAt },
})

const photoRecord = (
  id: string,
  hash: string,
  deletedAt?: string,
  extra: Record<string, unknown> = {},
): SyncRecord => ({
  kind: 'photo',
  id,
  changedAt: T1,
  data: { id, hash, width: 10, height: 20, takenAt: T1, deletedAt, ...extra },
})

// JSON drops the undefined deletedAt, so a live record has none.
async function push(records: SyncRecord[], cookie = cookie1) {
  const res = await app.request(
    `${ORIGIN}/api/sync/push`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: ORIGIN,
        cookie,
      },
      body: JSON.stringify({ records }),
    },
    env,
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ rejected: [] })
}

async function pull(since: number, cookie = cookie1) {
  const res = await app.request(
    `${ORIGIN}/api/sync/pull?since=${since}`,
    { headers: { cookie } },
    env,
  )
  return (await res.json()) as PullResponse
}

// Makes a record's delete as old as `days`, as if the server heard of it then.
async function age(kind: string, id: string, days: number, userId = 'user-1') {
  const { meta } = await env.DB.prepare(
    'UPDATE records SET deleted_heard_at = ? WHERE user_id = ? AND kind = ? AND id = ?',
  )
    .bind(iso(NOW - days * DAY), userId, kind, id)
    .run()
  expect(meta.changes).toBe(1)
}

type Row = {
  changed_at: string
  data: string
  seq: number
  purged_at: string | null
  deleted_heard_at: string | null
}

async function row(kind: string, id: string, userId = 'user-1') {
  const r = await env.DB.prepare(
    `SELECT changed_at, data, seq, purged_at, deleted_heard_at FROM records
     WHERE user_id = ? AND kind = ? AND id = ?`,
  )
    .bind(userId, kind, id)
    .first<Row>()
  if (!r) throw new Error(`no ${kind} ${id}`)
  return r
}

const isStub = async (kind: string, id: string, userId = 'user-1') =>
  (await row(kind, id, userId)).purged_at !== null

// The stored rows of every listed record, to show a run left them alone.
const snapshot = (keys: [string, string][], userId = 'user-1') =>
  Promise.all(keys.map(([kind, id]) => row(kind, id, userId)))

// --- Photo bytes -------------------------------------------------------------

const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

// Bytes that start like a JPEG, made different by the seed.
const jpeg = (seed: number) => {
  const bytes = new Uint8Array(64)
  bytes.fill(seed)
  bytes.set([0xff, 0xd8, 0xff])
  return bytes
}

// Stores both parts of a photo through the real photo route; returns its hash.
async function upload(seed: number, cookie = cookie1) {
  const full = jpeg(seed)
  const hash = sha(full)
  for (const [part, bytes] of [
    ['full', full],
    ['thumb', jpeg(seed + 100)],
  ] as const) {
    const res = await app.request(
      `${ORIGIN}/api/photos/${hash}/${part}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          Origin: ORIGIN,
          cookie,
          'x-content-sha256': sha(bytes),
          'content-length': String(bytes.byteLength),
        },
        body: bytes,
      },
      env,
    )
    expect(res.status).toBe(200)
  }
  return hash
}

const filesOf = async (hash: string, userId = 'user-1') =>
  (
    await env.DB.prepare(
      'SELECT part FROM photo_files WHERE user_id = ? AND hash = ? ORDER BY part',
    )
      .bind(userId, hash)
      .all<{ part: string }>()
  ).results.map((r) => r.part)

const inR2 = async (hash: string, userId = 'user-1') => {
  const parts: string[] = []
  for (const part of ['full', 'thumb']) {
    if (await bucket.head(`u/${userId}/${part}/${hash}`)) parts.push(part)
  }
  return parts
}

async function expectBytes(hash: string, userId = 'user-1') {
  expect(await filesOf(hash, userId)).toEqual(['full', 'thumb'])
  expect(await inR2(hash, userId)).toEqual(['full', 'thumb'])
}

async function expectNoBytes(hash: string, userId = 'user-1') {
  expect(await filesOf(hash, userId)).toEqual([])
  expect(await inR2(hash, userId)).toEqual([])
}

// --- Tests -------------------------------------------------------------------

test('a record under 30 days old stays', async () => {
  const hash = await upload(1)
  await push([piece('p1', T1), photoRecord('ph1', hash, T1)])
  await age('piece', 'p1', 29)
  await age('photo', 'ph1', 29)
  const before = await snapshot([
    ['piece', 'p1'],
    ['photo', 'ph1'],
  ])
  expect(await runCleanup(env, NOW)).toEqual({ purged: 0, filesDeleted: 0 })
  expect(
    await snapshot([
      ['piece', 'p1'],
      ['photo', 'ph1'],
    ]),
  ).toEqual(before)
  await expectBytes(hash)
})

test('an expired photo is removed for good', async () => {
  const hash = await upload(1)
  await push([photoRecord('ph1', hash, T1)])
  await age('photo', 'ph1', 30)
  expect(await runCleanup(env, NOW)).toEqual({ purged: 1, filesDeleted: 2 })
  expect(await isStub('photo', 'ph1')).toBe(true)
  await expectNoBytes(hash)
})

test('a stub holds only its id and times', async () => {
  const hash = await upload(1)
  await push([
    piece('p1', T1),
    step('s1', 'p-live', undefined, T1),
    photoRecord('ph1', hash, T1),
  ])
  await age('piece', 'p1', 30)
  await age('entry', 's1', 30)
  await age('photo', 'ph1', 30)
  await runCleanup(env, NOW)
  for (const [kind, id] of [
    ['piece', 'p1'],
    ['entry', 's1'],
    ['photo', 'ph1'],
  ]) {
    const r = await row(kind, id)
    expect(JSON.parse(r.data)).toEqual({
      id,
      deletedAt: iso(NOW),
      purgedAt: iso(NOW),
    })
    expect(r.purged_at).toBe(iso(NOW))
    expect(r.deleted_heard_at).toBeNull()
    // The stub keeps the record's old change time.
    expect(r.changed_at).toBe(T1)
  }
})

test('a stub reaches other devices', async () => {
  await push([piece('p1', T1)])
  await push([piece('p2'), piece('p3')])
  const { cursor } = await pull(0)
  const { seq: maxBefore } = await row('piece', 'p3')
  await age('piece', 'p1', 30)
  await runCleanup(env, NOW)
  expect((await row('piece', 'p1')).seq).toBeGreaterThan(maxBefore)
  expect((await pull(cursor)).records).toEqual([
    {
      kind: 'piece',
      id: 'p1',
      changedAt: T1,
      data: { id: 'p1', deletedAt: iso(NOW), purgedAt: iso(NOW) },
    },
  ])
})

test('an expired piece takes its steps and layers', async () => {
  await push([
    piece('p1', T1),
    step('s1', 'p1'),
    step('s2', 'p1', undefined, T1),
    layer('l1', 'p1', 's1'),
    layer('l2', 'p1', 's2', T1),
    piece('q1'),
    step('sq', 'q1'),
    layer('lq', 'q1', 'sq'),
  ])
  await age('piece', 'p1', 30)
  const others = await snapshot([
    ['piece', 'q1'],
    ['entry', 'sq'],
    ['glazeApp', 'lq'],
  ])
  expect(await runCleanup(env, NOW)).toEqual({ purged: 5, filesDeleted: 0 })
  for (const [kind, id] of [
    ['piece', 'p1'],
    ['entry', 's1'],
    ['entry', 's2'],
    ['glazeApp', 'l1'],
    ['glazeApp', 'l2'],
  ]) {
    expect(await isStub(kind, id)).toBe(true)
  }
  expect(
    await snapshot([
      ['piece', 'q1'],
      ['entry', 'sq'],
      ['glazeApp', 'lq'],
    ]),
  ).toEqual(others)
})

test("an expired step takes its layers, but not its piece's other steps", async () => {
  await push([
    piece('p1'),
    step('s1', 'p1', undefined, T1),
    layer('l1', 'p1', 's1'),
    step('s2', 'p1'),
    layer('l2', 'p1', 's2'),
  ])
  await age('entry', 's1', 30)
  expect(await runCleanup(env, NOW)).toEqual({ purged: 2, filesDeleted: 0 })
  expect(await isStub('entry', 's1')).toBe(true)
  expect(await isStub('glazeApp', 'l1')).toBe(true)
  expect(await isStub('piece', 'p1')).toBe(false)
  expect(await isStub('entry', 's2')).toBe(false)
  expect(await isStub('glazeApp', 'l2')).toBe(false)
})

test('an expired piece frees the photos only it shows', async () => {
  const hash = await upload(1)
  await push([
    piece('p1', T1),
    step('s1', 'p1', 'ph1'),
    photoRecord('ph1', hash),
  ])
  await age('piece', 'p1', 30)
  expect(await runCleanup(env, NOW)).toEqual({ purged: 3, filesDeleted: 2 })
  expect(await isStub('entry', 's1')).toBe(true)
  expect(await isStub('photo', 'ph1')).toBe(true)
  await expectNoBytes(hash)
})

test('a photo also shown on a live piece stays', async () => {
  const hash = await upload(1)
  await push([
    piece('p1', T1),
    step('s1', 'p1', 'ph1'),
    piece('q1'),
    step('sq', 'q1', 'ph1'),
    photoRecord('ph1', hash),
  ])
  await age('piece', 'p1', 30)
  const kept = await snapshot([
    ['photo', 'ph1'],
    ['piece', 'q1'],
    ['entry', 'sq'],
  ])
  expect(await runCleanup(env, NOW)).toEqual({ purged: 2, filesDeleted: 0 })
  expect(await isStub('piece', 'p1')).toBe(true)
  expect(await isStub('entry', 's1')).toBe(true)
  expect(
    await snapshot([
      ['photo', 'ph1'],
      ['piece', 'q1'],
      ['entry', 'sq'],
    ]),
  ).toEqual(kept)
  await expectBytes(hash)
})

test('a photo also shown on another deleted piece stays until that piece expires', async () => {
  const hash = await upload(1)
  await push([
    piece('p1', T1),
    step('s1', 'p1', 'ph1'),
    piece('p2', T1),
    step('s2', 'p2', 'ph1'),
    photoRecord('ph1', hash),
  ])
  await age('piece', 'p1', 30)
  await age('piece', 'p2', 10)
  expect(await runCleanup(env, NOW)).toEqual({ purged: 2, filesDeleted: 0 })
  expect(await isStub('entry', 's1')).toBe(true)
  expect(await isStub('piece', 'p2')).toBe(false)
  expect(await isStub('entry', 's2')).toBe(false)
  expect(await isStub('photo', 'ph1')).toBe(false)
  await expectBytes(hash)

  await age('piece', 'p2', 30)
  expect(await runCleanup(env, NOW)).toEqual({ purged: 3, filesDeleted: 2 })
  expect(await isStub('piece', 'p2')).toBe(true)
  expect(await isStub('entry', 's2')).toBe(true)
  expect(await isStub('photo', 'ph1')).toBe(true)
  await expectNoBytes(hash)
})

test('a photo with its own clock stays when its step expires', async () => {
  const hash = await upload(1)
  await push([
    piece('p1'),
    step('s1', 'p1', 'ph1', T1),
    photoRecord('ph1', hash, T1),
  ])
  await age('entry', 's1', 30)
  await age('photo', 'ph1', 5)
  const photo = await row('photo', 'ph1')
  expect(await runCleanup(env, NOW)).toEqual({ purged: 1, filesDeleted: 0 })
  expect(await isStub('entry', 's1')).toBe(true)
  expect(await row('photo', 'ph1')).toEqual(photo)
  await expectBytes(hash)
})

test('a tombstoned step of an expired piece leaves its photo to its own clock', async () => {
  const hash = await upload(1)
  await push([
    piece('p1', T1),
    step('s1', 'p1', 'ph1', T1),
    photoRecord('ph1', hash, T1),
  ])
  await age('piece', 'p1', 30)
  await age('photo', 'ph1', 5)
  const photo = await row('photo', 'ph1')
  expect(await runCleanup(env, NOW)).toEqual({ purged: 2, filesDeleted: 0 })
  expect(await isStub('entry', 's1')).toBe(true)
  expect(await row('photo', 'ph1')).toEqual(photo)
  await expectBytes(hash)
})

test('bytes shared with another record stay', async () => {
  const hash = await upload(1)
  await push([photoRecord('ph1', hash, T1), photoRecord('ph2', hash, T1)])
  await age('photo', 'ph1', 30)
  expect(await runCleanup(env, NOW)).toEqual({ purged: 1, filesDeleted: 0 })
  expect(await isStub('photo', 'ph1')).toBe(true)
  expect(await isStub('photo', 'ph2')).toBe(false)
  await expectBytes(hash)

  await age('photo', 'ph2', 30)
  expect(await runCleanup(env, NOW)).toEqual({ purged: 1, filesDeleted: 2 })
  expect(await isStub('photo', 'ph2')).toBe(true)
  await expectNoBytes(hash)
})

test("a merged duplicate's expiry leaves the kept photo alone", async () => {
  const hash = await upload(1)
  await push([
    piece('p1'),
    step('s1', 'p1', 'ph1'),
    photoRecord('ph1', hash),
    photoRecord('ph2', hash, T1, { mergedInto: 'ph1' }),
  ])
  await age('photo', 'ph2', 30)
  const kept = await row('photo', 'ph1')
  expect(await runCleanup(env, NOW)).toEqual({ purged: 1, filesDeleted: 0 })
  expect(await isStub('photo', 'ph2')).toBe(true)
  expect(await row('photo', 'ph1')).toEqual(kept)
  await expectBytes(hash)
})

test("a deleted photo that a live step still shows isn't purged", async () => {
  const hash = await upload(1)
  await push([
    piece('p1'),
    step('s1', 'p1', 'ph1'),
    photoRecord('ph1', hash, T1),
  ])
  await age('photo', 'ph1', 30)
  const photo = await row('photo', 'ph1')
  expect(await runCleanup(env, NOW)).toEqual({ purged: 0, filesDeleted: 0 })
  // Still expired: unchanged, its clock and all.
  expect(await row('photo', 'ph1')).toEqual(photo)
  await expectBytes(hash)
})

test('glazes and clays are never purged', async () => {
  await push([
    {
      kind: 'glaze',
      id: 'g1',
      changedAt: T1,
      data: { id: 'g1', deletedAt: T1 },
    },
    {
      kind: 'clay',
      id: 'c1',
      changedAt: T1,
      data: { id: 'c1', deletedAt: T1 },
    },
  ])
  // The server never starts their clock; set one anyway to show the kind decides.
  await age('glaze', 'g1', 40)
  await age('clay', 'c1', 40)
  const before = await snapshot([
    ['glaze', 'g1'],
    ['clay', 'c1'],
  ])
  expect(await runCleanup(env, NOW)).toEqual({ purged: 0, filesDeleted: 0 })
  expect(
    await snapshot([
      ['glaze', 'g1'],
      ['clay', 'c1'],
    ]),
  ).toEqual(before)
})

test("each user's records are handled separately", async () => {
  const hash = await upload(1)
  expect(await upload(1, cookie2)).toBe(hash)
  await push([photoRecord('ph1', hash, T1)])
  // User 2 has a record with the same id and hash, under 30 days old, and a
  // live step that shows it.
  await push(
    [piece('p1'), step('s1', 'p1', 'ph1'), photoRecord('ph1', hash, T1)],
    cookie2,
  )
  await age('photo', 'ph1', 30)
  await age('photo', 'ph1', 29, 'user-2')
  const theirs = await row('photo', 'ph1', 'user-2')
  expect(await runCleanup(env, NOW)).toEqual({ purged: 1, filesDeleted: 2 })
  expect(await isStub('photo', 'ph1')).toBe(true)
  await expectNoBytes(hash)
  expect(await row('photo', 'ph1', 'user-2')).toEqual(theirs)
  await expectBytes(hash, 'user-2')
})

test('a run stops at the limit and the next run finishes', async () => {
  const ids = Array.from({ length: PURGE_LIMIT + 1 }, (_, i) => `p${i}`)
  await push(ids.slice(0, 50).map((id) => piece(id, T1)))
  await push(ids.slice(50).map((id) => piece(id, T1)))
  // Oldest first: the last id is the youngest, so it waits for the next run.
  for (const [i, id] of ids.entries()) {
    await env.DB.prepare(
      "UPDATE records SET deleted_heard_at = ? WHERE user_id = 'user-1' AND id = ?",
    )
      .bind(iso(NOW - 31 * DAY + i * 60_000), id)
      .run()
  }
  expect(await runCleanup(env, NOW)).toEqual({
    purged: PURGE_LIMIT,
    filesDeleted: 0,
  })
  for (const id of ids.slice(0, -1))
    expect(await isStub('piece', id)).toBe(true)
  expect(await isStub('piece', ids[PURGE_LIMIT])).toBe(false)

  expect(await runCleanup(env, NOW)).toEqual({ purged: 1, filesDeleted: 0 })
  expect(await isStub('piece', ids[PURGE_LIMIT])).toBe(true)
})

test('if the database write fails, the next run finishes', async () => {
  const hash = await upload(1)
  await push([piece('p1', T1), photoRecord('ph1', hash, T1)])
  await age('piece', 'p1', 30)
  await age('photo', 'ph1', 30)
  const before = await snapshot([
    ['piece', 'p1'],
    ['photo', 'ph1'],
  ])
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const db = env.DB
  let failures = 1
  const flaky = {
    prepare: (query: string) => db.prepare(query),
    batch: (statements: D1PreparedStatement[]) => {
      if (failures-- > 0) return Promise.reject(new Error('D1 is down'))
      return db.batch(statements)
    },
  } as unknown as D1Database
  const flakyEnv = { ...env, DB: flaky }

  await expect(runCleanup(flakyEnv, NOW)).rejects.toThrow('D1 is down')
  expect(error).toHaveBeenCalled()
  expect(
    await snapshot([
      ['piece', 'p1'],
      ['photo', 'ph1'],
    ]),
  ).toEqual(before)

  expect(await runCleanup(flakyEnv, NOW)).toEqual({
    purged: 2,
    filesDeleted: 2,
  })
  expect(await isStub('piece', 'p1')).toBe(true)
  expect(await isStub('photo', 'ph1')).toBe(true)
  await expectNoBytes(hash)
})

test("one user's failure doesn't stop the next user's purge", async () => {
  await push([piece('p1', T1)])
  await push([piece('p1', T1)], cookie2)
  await age('piece', 'p1', 30)
  await age('piece', 'p1', 30, 'user-2')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const db = env.DB
  let failures = 1
  const flakyEnv = {
    ...env,
    DB: {
      prepare: (query: string) => db.prepare(query),
      batch: (statements: D1PreparedStatement[]) => {
        if (failures-- > 0) return Promise.reject(new Error('D1 is down'))
        return db.batch(statements)
      },
    } as unknown as D1Database,
  }

  // Whichever user goes first fails; the other is still purged, and the run
  // still reports the failure.
  await expect(runCleanup(flakyEnv, NOW)).rejects.toThrow('D1 is down')
  expect(error).toHaveBeenCalledTimes(1)
  const stubbed = [
    await isStub('piece', 'p1', 'user-1'),
    await isStub('piece', 'p1', 'user-2'),
  ]
  expect(stubbed.sort()).toEqual([false, true])

  expect(await runCleanup(flakyEnv, NOW)).toEqual({
    purged: 1,
    filesDeleted: 0,
  })
  expect(await isStub('piece', 'p1', 'user-1')).toBe(true)
  expect(await isStub('piece', 'p1', 'user-2')).toBe(true)
})

test('R2 is asked to delete at most its limit of keys at a time', async () => {
  // One expired piece whose live steps show more photos than one R2 call can
  // delete: two keys each.
  const count = R2_DELETE_MAX_KEYS / 2 + 1
  const hashes = Array.from({ length: count }, (_, i) =>
    i.toString(16).padStart(64, '0'),
  )
  const records: SyncRecord[] = [piece('p1', T1)]
  for (const [i, hash] of hashes.entries()) {
    records.push(step(`s${i}`, 'p1', `ph${i}`), photoRecord(`ph${i}`, hash))
  }
  for (let i = 0; i < records.length; i += PUSH_LIMIT) {
    await push(records.slice(i, i + PUSH_LIMIT))
  }
  // Untimed bytes straight into the stores: the photo route would take a
  // thousand requests.
  const keys = hashes.flatMap((h) => [
    `u/user-1/full/${h}`,
    `u/user-1/thumb/${h}`,
  ])
  for (let i = 0; i < keys.length; i += 100) {
    await Promise.all(keys.slice(i, i + 100).map((k) => bucket.put(k, 'x')))
  }
  await env.DB.prepare(
    `INSERT INTO photo_files (user_id, hash, part, size)
     SELECT 'user-1', h.value, p.value, 1 FROM json_each(?1) h, json_each('["full","thumb"]') p`,
  )
    .bind(JSON.stringify(hashes))
    .run()
  await age('piece', 'p1', 30)
  const remove = vi.spyOn(env.PHOTOS, 'delete')

  expect(await runCleanup(env, NOW)).toEqual({
    purged: 1 + 2 * count,
    filesDeleted: 2 * count,
  })
  expect(remove.mock.calls.length).toBeGreaterThan(1)
  for (const [batch] of remove.mock.calls) {
    expect((batch as string[]).length).toBeLessThanOrEqual(R2_DELETE_MAX_KEYS)
  }
  expect(
    remove.mock.calls.flatMap(([batch]) => batch as string[]).sort(),
  ).toEqual([...keys].sort())
  expect((await bucket.list({ prefix: 'u/user-1/' })).objects).toEqual([])
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS n FROM photo_files').first('n'),
  ).toBe(0)
})

test('nothing expired does nothing', async () => {
  const hash = await upload(1)
  await push([piece('p1', T1), piece('p2'), photoRecord('ph1', hash, T1)])
  await age('piece', 'p1', 29)
  const db = env.DB
  const batch = vi.fn((statements: D1PreparedStatement[]) =>
    db.batch(statements),
  )
  const remove = vi.fn(async () => {})
  const watched = {
    ...env,
    DB: {
      prepare: (query: string) => db.prepare(query),
      batch,
    } as unknown as D1Database,
    PHOTOS: { delete: remove } as unknown as R2Bucket,
  }
  expect(await runCleanup(watched, NOW)).toEqual({
    purged: 0,
    filesDeleted: 0,
  })
  expect(batch).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
})
