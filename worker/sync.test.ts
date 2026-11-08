import {
  MAX_DATA_CHARS,
  PULL_LIMIT,
  PUSH_LIMIT,
  type PullResponse,
  type PushResponse,
  type SyncRecord,
} from '../shared/syncProtocol'
import { createApp } from './app'
import type { Env } from './env'
import { createSession } from './sessions'
import { makeTestEnv } from './test/harness'

const ORIGIN = 'http://localhost'
const T1 = '2026-11-07T10:00:00.000Z'
const T2 = '2026-11-07T11:00:00.000Z'
const T3 = '2026-11-07T12:00:00.000Z'

let env: Env
let dispose: () => Promise<void>
let app: ReturnType<typeof createApp>
let cookie1: string
let token1: string
let cookie2: string

async function addUser(id: string, email: string) {
  await env.DB.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)',
  )
    .bind(id, email, Date.now())
    .run()
  const token = await createSession(env.DB, id, Date.now())
  return token
}

beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
  app = createApp()
  token1 = await addUser('user-1', 'one@example.com')
  cookie1 = `__Host-session_token=${token1}`
  cookie2 = `__Host-session_token=${await addUser('user-2', 'two@example.com')}`
})

afterEach(async () => {
  await dispose()
})

const rec = (
  id: string,
  changedAt = T1,
  extra: Record<string, unknown> = {},
): SyncRecord => ({
  kind: 'piece',
  id,
  changedAt,
  data: { id, ...extra },
})

function push(
  body: unknown,
  {
    cookie = cookie1,
    origin = ORIGIN,
    raw,
  }: { cookie?: string | null; origin?: string | null; raw?: string } = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (cookie) headers.cookie = cookie
  if (origin !== null) headers.Origin = origin
  return app.request(
    `${ORIGIN}/api/sync/push`,
    { method: 'POST', headers, body: raw ?? JSON.stringify(body) },
    env,
  )
}

function pull(query = '?since=0', cookie: string | null = cookie1) {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.request(`${ORIGIN}/api/sync/pull${query}`, { headers }, env)
}

const pulled = async (query?: string, cookie?: string) =>
  (await (await pull(query, cookie)).json()) as PullResponse

const count = () =>
  env.DB.prepare('SELECT COUNT(*) AS n FROM records').first<number>('n')

test('push and pull need a session', async () => {
  for (const cookie of [null, '__Host-session_token=unknown']) {
    const a = await push({ records: [] }, { cookie })
    expect(a.status).toBe(401)
    expect(await a.json()).toMatchObject({ code: 'NO_SESSION' })
    const b = await pull('?since=0', cookie)
    expect(b.status).toBe(401)
    expect(await b.json()).toMatchObject({ code: 'NO_SESSION' })
  }
})

test("push needs the app's origin", async () => {
  for (const origin of [null, 'https://evil.example']) {
    const res = await push({ records: [rec('a')] }, { origin })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'BAD_ORIGIN' })
  }
  expect(await count()).toBe(0)
})

test('pushed records come back in order', async () => {
  const records = [
    rec('a', T1, { name: 'Bowl' }),
    rec('b', T1, { n: [1, 2], nested: { x: 'y' } }),
    rec('c', T2),
  ]
  const res = await push({ records })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ rejected: [] })

  const first = await pulled()
  expect(first.records).toEqual(records)
  expect(first.more).toBe(false)
  expect(first.cursor).toBeGreaterThan(0)

  const second = await pulled(`?since=${first.cursor}`)
  expect(second.records).toEqual([])
  expect(second.cursor).toBe(first.cursor)
  expect(second.more).toBe(false)
})

test('pull pages at PULL_LIMIT', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `r${i}`)
  for (let i = 0; i < ids.length; i += PUSH_LIMIT) {
    const chunk = ids.slice(i, i + PUSH_LIMIT)
    const res = await push({ records: chunk.map((id) => rec(id)) })
    expect(res.status).toBe(200)
  }
  const page1 = await pulled()
  expect(page1.records).toHaveLength(PULL_LIMIT)
  expect(page1.more).toBe(true)
  const page2 = await pulled(`?since=${page1.cursor}`)
  expect(page2.records).toHaveLength(50)
  expect(page2.more).toBe(false)
  expect([...page1.records, ...page2.records].map((r) => r.id)).toEqual(ids)
})

test('a later change replaces the copy and moves it to the end', async () => {
  await push({ records: [rec('a', T1, { v: 1 })] })
  await push({ records: [rec('b', T1)] })
  const res = await push({ records: [rec('a', T2, { v: 2 })] })
  expect(await res.json()).toEqual({ rejected: [] })
  const { records } = await pulled()
  expect(records.map((r) => r.id)).toEqual(['b', 'a'])
  expect(records[1]).toEqual(rec('a', T2, { v: 2 }))
})

test("an older or equal change is rejected with the server's copy", async () => {
  const stored = rec('a', T2, { v: 'server' })
  await push({ records: [stored] })
  for (const sent of [rec('a', T1, { v: 'old' }), rec('a', T2, { v: 'tie' })]) {
    const res = await push({ records: [sent] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rejected: [stored] })
  }
  expect((await pulled()).records).toEqual([stored])
})

test('each user sees only their own records', async () => {
  await push({ records: [rec('a', T1, { who: 'one' })] }, { cookie: cookie1 })
  await push({ records: [rec('a', T1, { who: 'two' })] }, { cookie: cookie2 })
  expect((await pulled('?since=0', cookie1)).records).toEqual([
    rec('a', T1, { who: 'one' }),
  ])
  expect((await pulled('?since=0', cookie2)).records).toEqual([
    rec('a', T1, { who: 'two' }),
  ])
})

test("rejected copies come from the caller's own records", async () => {
  await push({ records: [rec('a', T2, { who: 'one' })] }, { cookie: cookie1 })
  await push({ records: [rec('a', T2, { who: 'two' })] }, { cookie: cookie2 })

  const res = await push(
    { records: [rec('a', T1, { who: 'two, older' })] },
    { cookie: cookie2 },
  )

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    rejected: [rec('a', T2, { who: 'two' })],
  })
})

test('bad batches are refused whole', async () => {
  const good = rec('good')
  const bads: [string, { body?: unknown; raw?: string }][] = [
    [
      'unknown kind',
      { body: { records: [good, { ...rec('x'), kind: 'nope' }] } },
    ],
    ['id with a space', { body: { records: [good, rec('a b')] } }],
    ['short changedAt', { body: { records: [good, rec('x', '2026-11-07')] } }],
    [
      'data.id differs',
      { body: { records: [good, { ...rec('x'), data: { id: 'y' } }] } },
    ],
    ['data an array', { body: { records: [good, { ...rec('x'), data: [] }] } }],
    [
      'too many records',
      {
        body: {
          records: Array.from({ length: PUSH_LIMIT + 1 }, (_, i) =>
            rec(`r${i}`),
          ),
        },
      },
    ],
    [
      'data too large',
      {
        body: {
          records: [good, rec('x', T1, { s: 'a'.repeat(MAX_DATA_CHARS) })],
        },
      },
    ],
    [
      'duplicate record',
      { body: { records: [good, rec('x', T1), rec('x', T2)] } },
    ],
    ['records missing', { body: {} }],
    ['not JSON', { raw: 'not json' }],
  ]
  for (const [label, { body, raw }] of bads) {
    const res = await push(body, { raw })
    expect(res.status, label).toBe(400)
    expect(await res.json(), label).toMatchObject({ code: 'BAD_SYNC_REQUEST' })
  }
  expect(await count()).toBe(0)
})

test('pull with a bad since is refused', async () => {
  for (const query of ['?since=-1', '?since=abc', '']) {
    const res = await pull(query)
    expect(res.status, query).toBe(400)
    expect(await res.json(), query).toMatchObject({ code: 'BAD_SYNC_REQUEST' })
  }
})

test('a body over 1 MB is refused', async () => {
  const res = await push(null, { raw: 'x'.repeat(1024 * 1024 + 1) })
  expect(res.status).toBe(413)
  expect(await res.json()).toMatchObject({ code: 'TOO_LARGE' })
})

test('a sync request refreshes a day-old session like get-session does', async () => {
  await env.DB.prepare('UPDATE sessions SET refreshed_at = ?')
    .bind(Date.now() - 86_400_000 - 1000)
    .run()
  const res = await pull()
  expect(res.status).toBe(200)
  expect(res.headers.get('set-cookie')).toContain(
    `__Host-session_token=${token1}`,
  )
  // Renewed once, not on every request.
  expect((await pull()).headers.get('set-cookie')).toBeNull()
})

test('a mixed batch keeps the newer copies and stores the rest', async () => {
  await push({ records: [rec('a', T3)] })
  const res = await push({ records: [rec('a', T1), rec('b', T1)] })
  expect(((await res.json()) as PushResponse).rejected).toEqual([rec('a', T3)])
  expect((await pulled()).records.map((r) => r.id)).toEqual(['a', 'b'])
})

test('a full batch that is all rejected returns every server copy', async () => {
  const stored = Array.from({ length: PUSH_LIMIT }, (_, i) =>
    rec(`r${i}`, T2, { v: i }),
  )
  await push({ records: stored })
  const res = await push({
    records: stored.map((r) => rec(r.id, T1, { v: 'old' })),
  })
  expect(((await res.json()) as PushResponse).rejected).toEqual(stored)
  expect((await pulled()).records).toEqual(stored)
})
