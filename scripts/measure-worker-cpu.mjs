// Measures the Worker's CPU time locally, one step per line.
// Usage: node --no-warnings scripts/measure-worker-cpu.mjs <bundle.js> <migrationsDir>
// Build the bundle first: pnpm exec wrangler deploy --dry-run --outdir .wrangler/cpu-bundle
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const [bundlePath, migrationsDir] = process.argv.slice(2)
if (!bundlePath || !migrationsDir) {
  console.error(
    'Usage: node scripts/measure-worker-cpu.mjs <bundle.js> <migrationsDir>',
  )
  process.exit(2)
}

const ORIGIN = 'https://glazette.offhours.workers.dev'
const EMAIL = 'a@b.co'
const DAY_MS = 24 * 60 * 60 * 1000

const cpuMs = () => {
  const u = process.cpuUsage()
  return (u.user + u.system) / 1000
}

// A node:sqlite stand-in for D1: prepare/bind/all/run/first/raw plus batch.
const sqlite = new DatabaseSync(':memory:')
for (const f of readdirSync(migrationsDir).sort()) {
  sqlite.exec(readFileSync(`${migrationsDir}/${f}`, 'utf8'))
}
sqlite.exec(`INSERT INTO allowed_email VALUES ('${EMAIL}')`)

const clean = (args) =>
  args.map((v) =>
    typeof v === 'boolean' ? Number(v) : v === undefined ? null : v,
  )

const statement = (sql) => {
  let args = []
  // Statements that return rows (SELECT, RETURNING) give rows back; the rest report changes.
  const exec = () => {
    const p = sqlite.prepare(sql)
    if (p.columns().length)
      return { results: p.all(...args), success: true, meta: {} }
    const r = p.run(...args)
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(r.changes),
        last_row_id: Number(r.lastInsertRowid),
      },
    }
  }
  return {
    bind(...a) {
      args = clean(a)
      return this
    },
    async all() {
      return exec()
    },
    async run() {
      return exec()
    },
    async first(col) {
      const row = sqlite.prepare(sql).get(...args) ?? null
      return row && col ? row[col] : row
    },
    async raw() {
      const p = sqlite.prepare(sql)
      p.setReturnArrays?.(true)
      return p.all(...args)
    },
  }
}

const DB = {
  prepare: statement,
  // Runs the statements one by one, not atomically like D1's batch. Fine for timing.
  batch: async (list) => {
    const out = []
    for (const s of list) out.push(await s.all())
    return out
  },
}

const env = {
  DB,
  // The Worker's existing secret name.
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  APP_ORIGIN: ORIGIN,
  RESEND_API_KEY: 'test-key',
  ASSETS: { fetch: () => new Response('') },
}

// Capture the sign-in code from the email the Worker sends through Resend.
let lastCode = ''
globalThis.fetch = async (_url, init) => {
  const text = JSON.parse(init.body).text ?? ''
  lastCode = text.match(/\b\d{6}\b/)?.[0] ?? lastCode
  return new Response('{"id":"1"}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// Time can be moved forward to exercise the daily session refresh.
const realNow = Date.now
let skewMs = 0
Date.now = () => realNow() + skewMs

let t = cpuMs()
const mod = await import(pathToFileURL(resolve(bundlePath)).href)
console.log('module load', (cpuMs() - t).toFixed(1), 'ms')

let cookie = ''
const request = (path, body) => {
  const headers = { origin: ORIGIN, 'cf-connecting-ip': '1.2.3.4' }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  })
}

// Realistic records: a piece with a 300-character note, a step, and a glaze layer.
const T = '2026-11-07T10:00:00.000Z'
const makeRecords = (n) =>
  Array.from({ length: n }, (_, i) => {
    const kind = ['piece', 'entry', 'glazeApp'][i % 3]
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    const data =
      kind === 'piece'
        ? {
            id,
            name: `Bowl ${i}`,
            clayId: '11111111-1111-4111-8111-111111111111',
            note: 'n'.repeat(300),
            createdAt: T,
            updatedAt: T,
          }
        : kind === 'entry'
          ? {
              id,
              pieceId: id,
              stage: 'glazed',
              note: 'Dipped twice, wiped the foot.',
              createdAt: T,
              updatedAt: T,
            }
          : {
              id,
              entryId: id,
              glazeId: '22222222-2222-4222-8222-222222222222',
              coats: 2,
              updatedAt: T,
            }
    return { kind, id, changedAt: T, data }
  })
// The shared push limit is 50 records; a full pull page is 200.
const all = makeRecords(200)
const records = all.slice(0, 50)

const syncRequest = (path, body) =>
  new Request(`${ORIGIN}/api/sync${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      origin: ORIGIN,
      'cf-connecting-ip': '1.2.3.4',
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  })

const steps = [
  ['get-session (no cookie)', 200, () => request('/get-session')],
  [
    'send-code',
    200,
    () =>
      request('/email-otp/send-verification-otp', {
        email: EMAIL,
        type: 'sign-in',
      }),
  ],
  [
    'sign-in',
    200,
    () => request('/sign-in/email-otp', { email: EMAIL, otp: lastCode }),
  ],
  ['get-session (cookie)', 200, () => request('/get-session')],
  [
    'get-session (a day later, refresh)',
    200,
    () => {
      skewMs += DAY_MS + 1000
      return request('/get-session')
    },
  ],
  ['sync push 50', 200, () => syncRequest('/push', { records })],
  [
    'sync push 50 again (all rejected)',
    200,
    () => syncRequest('/push', { records }),
  ],
  [
    'sync pull 200',
    200,
    () => {
      // Untimed: store the other 150 records so the page is full.
      const userId = sqlite.prepare('SELECT id FROM users').get().id
      const insert = sqlite.prepare(
        `INSERT INTO records (user_id, kind, id, changed_at, data, seq)
         VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records))`,
      )
      for (const r of all.slice(50))
        insert.run(userId, r.kind, r.id, r.changedAt, JSON.stringify(r.data))
      return syncRequest('/pull?since=0')
    },
  ],
  ['sign-out', 200, () => request('/sign-out', {})],
]

let failed = false
const fail = (message) => {
  console.error(`FAILED: ${message}`)
  failed = true
}
const ctx = { waitUntil() {}, passThroughOnException() {} }
const isSignedIn = (json) => json?.user?.email === EMAIL

for (const [label, expected, make] of steps) {
  const req = make()
  t = cpuMs()
  const res = await mod.default.fetch(req, env, ctx)
  const text = await res.text()
  const ms = cpuMs() - t
  console.log(label, res.status, ms.toFixed(1), 'ms')

  // Checks run outside the timed region.
  const set = res.headers.get('set-cookie')
  // Keep only live cookies; sign-out answers an empty one that clears it.
  const pair = set?.split(';')[0]
  if (
    pair?.startsWith('__Host-session_token=') &&
    pair.length > '__Host-session_token='.length
  )
    cookie = pair
  if (res.status !== expected)
    fail(`${label}: expected ${expected}, got ${res.status}`)
  if (label === 'sign-in' && !cookie)
    fail('sign-in did not set a session cookie')
  if (label === 'get-session (cookie)') {
    if (!isSignedIn(JSON.parse(text)))
      fail(`${label}: not signed in as ${EMAIL}: ${text}`)
    if (set) fail(`${label}: unexpected Set-Cookie`)
  }
  if (label === 'get-session (a day later, refresh)') {
    if (!isSignedIn(JSON.parse(text)))
      fail(`${label}: not signed in as ${EMAIL}: ${text}`)
    if (!set?.includes('__Host-session_token='))
      fail(`${label}: missing refreshed Set-Cookie`)
  }
  if (label === 'sync push 50') {
    if (JSON.stringify(JSON.parse(text)) !== '{"rejected":[]}')
      fail(`${label}: expected nothing rejected: ${text.slice(0, 200)}`)
  }
  if (label === 'sync push 50 again (all rejected)') {
    const { rejected } = JSON.parse(text)
    if (
      rejected.length !== records.length ||
      JSON.stringify(rejected) !== JSON.stringify(records)
    )
      fail(`${label}: expected the server's 50 copies back`)
  }
  if (label === 'sync pull 200') {
    const pulled = JSON.parse(text)
    if (
      pulled.records.length !== all.length ||
      pulled.more !== true ||
      pulled.cursor < 1 ||
      JSON.stringify(pulled.records) !== JSON.stringify(all)
    )
      fail(`${label}: expected a full page of 200 records in order`)
  }
}

// Untimed: the signed-out cookie must no longer work.
const after = await mod.default.fetch(request('/get-session'), env, ctx)
const afterText = await after.text()
if (after.status !== 200 || JSON.parse(afterText) !== null) {
  fail(
    `get-session after sign-out should answer null, got ${after.status} ${afterText}`,
  )
}

if (failed) process.exit(1)
