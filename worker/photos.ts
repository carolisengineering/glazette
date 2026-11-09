import type { Context } from 'hono'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  MAX_FULL_BYTES,
  MAX_THUMB_BYTES,
  MISSING_LIMIT,
  type MissingResponse,
  PHOTO_HASH,
  PHOTO_PARTS,
  type PhotoPart,
} from '../shared/photoProtocol'
import type { Env } from './env'
import { requireSession, type SessionVars } from './sessions'

type Ctx = Context<{ Bindings: Env; Variables: SessionVars }>

function fail(
  c: Ctx,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ code, message }, status)
}

const badRequest = (c: Ctx) =>
  fail(c, 400, 'BAD_PHOTO_REQUEST', 'The photo request is malformed.')

const isPart = (value: string): value is PhotoPart =>
  (PHOTO_PARTS as readonly string[]).includes(value)

const maxBytes = (part: PhotoPart) =>
  part === 'full' ? MAX_FULL_BYTES : MAX_THUMB_BYTES

const key = (userId: string, part: PhotoPart, hash: string) =>
  `u/${userId}/${part}/${hash}`

// Hashes that have both parts stored. The second ? is the requested hashes as JSON.
const STORED_BOTH = `SELECT hash FROM photo_files
  WHERE user_id = ? AND hash IN (SELECT value FROM json_each(?))
  GROUP BY hash HAVING COUNT(*) = 2`

export function photoRoutes() {
  const routes = new Hono<{ Bindings: Env; Variables: SessionVars }>()

  routes.use('*', requireSession)

  routes.post(
    '/missing',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) =>
        c.json(
          { code: 'TOO_LARGE', message: 'That photo request is too large.' },
          413,
        ),
    }),
    async (c) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return badRequest(c)
      }
      const hashes = (body as { hashes?: unknown } | null)?.hashes
      if (
        !Array.isArray(hashes) ||
        hashes.length > MISSING_LIMIT ||
        !hashes.every((h) => typeof h === 'string' && PHOTO_HASH.test(h))
      ) {
        return badRequest(c)
      }
      const { results } = await c.env.DB.prepare(STORED_BOTH)
        .bind(c.get('userId'), JSON.stringify(hashes))
        .all<{ hash: string }>()
      const stored = new Set(results.map((r) => r.hash))
      const missing = [...new Set<string>(hashes)].filter((h) => !stored.has(h))
      return c.json({ missing } satisfies MissingResponse)
    },
  )

  routes.put('/:hash/:part', async (c) => {
    const { hash, part } = c.req.param()
    const checksum = c.req.header('x-content-sha256')
    if (
      !PHOTO_HASH.test(hash) ||
      !isPart(part) ||
      checksum === undefined ||
      !PHOTO_HASH.test(checksum) ||
      (part === 'full' && checksum !== hash)
    ) {
      return badRequest(c)
    }
    // The size is judged from the header, before the body is touched.
    const length = c.req.header('content-length')
    if (length === undefined) {
      return fail(
        c,
        411,
        'LENGTH_REQUIRED',
        'The photo needs a Content-Length.',
      )
    }
    if (!/^\d{1,15}$/.test(length) || Number(length) === 0) {
      return badRequest(c)
    }
    if (Number(length) > maxBytes(part)) {
      return fail(c, 413, 'TOO_LARGE', 'That photo is too large.')
    }

    const userId = c.get('userId')
    try {
      // R2 checks the bytes against the checksum and refuses a mismatch.
      await c.env.PHOTOS.put(key(userId, part, hash), c.req.raw.body, {
        sha256: checksum,
        httpMetadata: { contentType: 'image/jpeg' },
      })
    } catch {
      return fail(
        c,
        400,
        'PHOTO_MISMATCH',
        "The photo doesn't match its checksum.",
      )
    }
    await c.env.DB.prepare(
      `INSERT INTO photo_files (user_id, hash, part, size) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, hash, part) DO UPDATE SET size = excluded.size`,
    )
      .bind(userId, hash, part, Number(length))
      .run()
    return c.json({ stored: true })
  })

  routes.get('/:hash/:part', async (c) => {
    const { hash, part } = c.req.param()
    if (!PHOTO_HASH.test(hash) || !isPart(part)) return badRequest(c)
    const object = await c.env.PHOTOS.get(key(c.get('userId'), part, hash))
    if (!object) {
      return fail(c, 404, 'NO_PHOTO', 'That photo is not stored.')
    }
    return new Response(object.body, {
      headers: {
        'content-type': 'image/jpeg',
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    })
  })

  return routes
}
