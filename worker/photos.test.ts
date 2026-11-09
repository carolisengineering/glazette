import { createHash } from 'node:crypto'
import {
  MAX_FULL_BYTES,
  MAX_THUMB_BYTES,
  MISSING_LIMIT,
  type PhotoPart,
  photoFileUrl,
} from '../shared/photoProtocol'
import { createApp } from './app'
import type { Env } from './env'
import { createSession } from './sessions'
import { makeTestEnv } from './test/harness'

const ORIGIN = 'http://localhost'

let env: Env
let dispose: () => Promise<void>
let app: ReturnType<typeof createApp>
let cookie1: string
let cookie2: string

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
  // (a real Worker request has a known length). Hand R2 the bytes instead; its
  // checksum check is still the real one.
  const bucket = env.PHOTOS
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
    } as unknown as R2Bucket,
  }
  app = createApp()
  cookie1 = await addUser('user-1', 'one@example.com')
  cookie2 = await addUser('user-2', 'two@example.com')
})

afterEach(async () => {
  await dispose()
})

const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

// Bytes that start like a JPEG, made different by the seed.
const photo = (seed: number, length = 64) => {
  const bytes = new Uint8Array(length)
  bytes.fill(seed)
  bytes.set([0xff, 0xd8, 0xff])
  return bytes
}

type PutOptions = {
  cookie?: string | null
  origin?: string | null
  checksum?: string | null
  length?: string | null
}

function put(
  hash: string,
  part: string,
  bytes: Uint8Array,
  {
    cookie = cookie1,
    origin = ORIGIN,
    checksum = sha(bytes),
    length = String(bytes.byteLength),
  }: PutOptions = {},
) {
  const headers: Record<string, string> = { 'content-type': 'image/jpeg' }
  if (cookie) headers.cookie = cookie
  if (origin !== null) headers.Origin = origin
  if (checksum !== null) headers['x-content-sha256'] = checksum
  if (length !== null) headers['content-length'] = length
  return app.request(
    `${ORIGIN}/api/photos/${hash}/${part}`,
    { method: 'PUT', headers, body: bytes },
    env,
  )
}

function get(hash: string, part: string, cookie: string | null = cookie1) {
  return app.request(
    `${ORIGIN}/api/photos/${hash}/${part}`,
    { headers: cookie ? { cookie } : {} },
    env,
  )
}

function missing(
  body: unknown,
  { cookie = cookie1, raw }: { cookie?: string | null; raw?: string } = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    Origin: ORIGIN,
  }
  if (cookie) headers.cookie = cookie
  return app.request(
    `${ORIGIN}/api/photos/missing`,
    { method: 'POST', headers, body: raw ?? JSON.stringify(body) },
    env,
  )
}

const rows = async () =>
  (
    await env.DB.prepare(
      'SELECT user_id, hash, part FROM photo_files ORDER BY user_id, hash, part',
    ).all()
  ).results

async function storeBoth(hash: string, cookie = cookie1) {
  const full = photo(1)
  // The full image's hash is the hash of its own bytes, so find bytes for it.
  expect(sha(full)).toBe(hash)
  expect((await put(hash, 'full', full, { cookie })).status).toBe(200)
  expect((await put(hash, 'thumb', photo(2), { cookie })).status).toBe(200)
}

const A_BYTES = photo(1)
const A = sha(A_BYTES)
const B_BYTES = photo(3)
const B = sha(B_BYTES)
const C = sha(photo(4))

async function body(res: Response) {
  return (await res.json()) as { code?: string; missing?: string[] }
}

test('photo routes need a session', async () => {
  const responses = [
    await put(A, 'full', A_BYTES, { cookie: null }),
    await get(A, 'full', null),
    await missing({ hashes: [A] }, { cookie: null }),
  ]
  for (const res of responses) {
    expect(res.status).toBe(401)
    expect((await body(res)).code).toBe('NO_SESSION')
  }
})

test("a PUT needs the app's origin", async () => {
  const res = await put(A, 'full', A_BYTES, { origin: null })
  expect(res.status).toBe(403)
  expect((await body(res)).code).toBe('BAD_ORIGIN')
  const other = await put(A, 'full', A_BYTES, { origin: 'https://evil.test' })
  expect(other.status).toBe(403)
  expect(await env.PHOTOS.head(`u/user-1/full/${A}`)).toBeNull()
})

test('an uploaded photo comes back byte for byte', async () => {
  const thumb = photo(2, 40)
  expect((await put(A, 'full', A_BYTES)).status).toBe(200)
  const stored = await put(A, 'thumb', thumb)
  expect(stored.status).toBe(200)
  expect(await stored.json()).toEqual({ stored: true })

  for (const [part, bytes] of [
    ['full', A_BYTES],
    ['thumb', thumb],
  ] as const) {
    const res = await get(A, part)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  }
})

test("a full image that doesn't match its hash is refused", async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const res = await put(C, 'full', A_BYTES, { checksum: C })
  expect(logged).toHaveBeenCalled()
  logged.mockRestore()
  expect(res.status).toBe(400)
  expect((await body(res)).code).toBe('PHOTO_MISMATCH')
  expect((await get(C, 'full')).status).toBe(404)
  expect(await rows()).toEqual([])
})

test("a thumbnail that doesn't match its header is refused", async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const res = await put(A, 'thumb', photo(2), { checksum: sha(photo(9)) })
  expect(logged).toHaveBeenCalled()
  logged.mockRestore()
  expect(res.status).toBe(400)
  expect((await body(res)).code).toBe('PHOTO_MISMATCH')
  expect((await get(A, 'thumb')).status).toBe(404)
  expect(await rows()).toEqual([])
})

test("the full image's header must be its hash", async () => {
  const res = await put(A, 'full', A_BYTES, { checksum: B })
  expect(res.status).toBe(400)
  expect((await body(res)).code).toBe('BAD_PHOTO_REQUEST')
  expect(await rows()).toEqual([])
})

test('sizes are checked before anything is stored', async () => {
  const none = await put(A, 'full', A_BYTES, { length: null })
  expect(none.status).toBe(411)
  expect((await body(none)).code).toBe('LENGTH_REQUIRED')

  const bigFull = await put(A, 'full', A_BYTES, {
    length: String(MAX_FULL_BYTES + 1),
  })
  expect(bigFull.status).toBe(413)
  expect((await body(bigFull)).code).toBe('TOO_LARGE')

  const bigThumb = await put(A, 'thumb', photo(2), {
    length: String(MAX_THUMB_BYTES + 1),
  })
  expect(bigThumb.status).toBe(413)
  expect(await rows()).toEqual([])
})

test('bad hashes and parts are refused', async () => {
  const cases: [string, string][] = [
    [A.toUpperCase(), 'full'],
    [A.slice(1), 'full'],
    [A, 'big'],
  ]
  for (const [hash, part] of cases) {
    const putRes = await put(hash, part, A_BYTES)
    expect(putRes.status).toBe(400)
    expect((await body(putRes)).code).toBe('BAD_PHOTO_REQUEST')
    const getRes = await get(hash, part)
    expect(getRes.status).toBe(400)
    expect((await body(getRes)).code).toBe('BAD_PHOTO_REQUEST')
  }
})

test("missing lists what isn't fully stored", async () => {
  await storeBoth(A)
  expect((await put(B, 'full', B_BYTES)).status).toBe(200)
  const res = await missing({ hashes: [C, A, B, C] })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ missing: [C, B] })
})

test('missing refuses bad lists', async () => {
  const tooMany = Array.from({ length: MISSING_LIMIT + 1 }, (_, i) =>
    i.toString(16).padStart(64, '0'),
  )
  const bad = [
    await missing({ hashes: tooMany }),
    await missing({ hashes: [A, 'nope'] }),
    await missing({}),
    await missing(null, { raw: 'not json' }),
  ]
  for (const res of bad) {
    expect(res.status).toBe(400)
    expect((await body(res)).code).toBe('BAD_PHOTO_REQUEST')
  }
})

test('each user sees only their own photos', async () => {
  await storeBoth(A)
  expect((await get(A, 'full', cookie2)).status).toBe(404)
  expect((await get(A, 'full', cookie2)).headers.get('content-type')).toContain(
    'json',
  )
  expect(
    await (await missing({ hashes: [A] }, { cookie: cookie2 })).json(),
  ).toEqual({ missing: [A] })
  expect(await (await missing({ hashes: [A] })).json()).toEqual({ missing: [] })
})

test('uploading the same photo twice is fine', async () => {
  const thumb = photo(2)
  for (let i = 0; i < 2; i++) {
    expect((await put(A, 'full', A_BYTES)).status).toBe(200)
    expect((await put(A, 'thumb', thumb)).status).toBe(200)
  }
  expect(await rows()).toEqual([
    { user_id: 'user-1', hash: A, part: 'full' },
    { user_id: 'user-1', hash: A, part: 'thumb' },
  ])
})

test('photoFileUrl names the route', () => {
  const part: PhotoPart = 'thumb'
  expect(photoFileUrl(A, part)).toBe(`/api/photos/${A}/thumb`)
})
