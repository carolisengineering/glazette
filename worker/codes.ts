import { hmacHex, randomCode, sameHex } from './crypto'

export const CODE_TTL_MS = 5 * 60 * 1000
export const CODE_TRIES = 3

export type CodeCheck =
  | 'ok'
  | 'INVALID_OTP'
  | 'OTP_EXPIRED'
  | 'TOO_MANY_ATTEMPTS'

// Issues a new code for the email, replacing any earlier one and resetting
// its tries. Returns the plain code. Only a keyed hash is stored.
export async function issueCode(
  db: D1Database,
  secret: string,
  email: string,
  now: number,
): Promise<string> {
  const code = randomCode()
  const codeHash = await hmacHex(secret, `${email}:${code}`)
  await db
    .prepare(
      `INSERT INTO sign_in_codes (email, code_hash, expires_at, attempts)
       VALUES (?, ?, ?, 0)
       ON CONFLICT (email) DO UPDATE SET
         code_hash = excluded.code_hash,
         expires_at = excluded.expires_at,
         attempts = 0`,
    )
    .bind(email, codeHash, now + CODE_TTL_MS)
    .run()
  return code
}

export async function checkCode(
  db: D1Database,
  secret: string,
  email: string,
  otp: string,
  now: number,
): Promise<CodeCheck> {
  // Claim a try before comparing, so parallel guesses can't share one try.
  const claimed = await db
    .prepare(
      `UPDATE sign_in_codes SET attempts = attempts + 1
       WHERE email = ? AND attempts < ? AND expires_at > ?
       RETURNING code_hash`,
    )
    .bind(email, CODE_TRIES, now)
    .first<{ code_hash: string }>()

  if (claimed) {
    const given = await hmacHex(secret, `${email}:${otp}`)
    if (!sameHex(claimed.code_hash, given)) return 'INVALID_OTP'
    const deleted = await db
      .prepare('DELETE FROM sign_in_codes WHERE email = ? AND code_hash = ?')
      .bind(email, claimed.code_hash)
      .run()
    return deleted.meta.changes === 1 ? 'ok' : 'INVALID_OTP'
  }

  const row = await db
    .prepare('SELECT expires_at, attempts FROM sign_in_codes WHERE email = ?')
    .bind(email)
    .first<{ expires_at: number; attempts: number }>()
  if (!row) return 'INVALID_OTP'
  if (row.expires_at <= now) {
    // Only the expired code: a fresh one issued since must survive.
    await db
      .prepare('DELETE FROM sign_in_codes WHERE email = ? AND expires_at <= ?')
      .bind(email, now)
      .run()
    return 'OTP_EXPIRED'
  }
  return 'TOO_MANY_ATTEMPTS'
}
