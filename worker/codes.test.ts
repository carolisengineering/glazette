import { CODE_TTL_MS, checkCode, issueCode } from './codes'
import { hmacHex } from './crypto'
import type { Env } from './env'
import { makeTestEnv } from './test/harness'

const EMAIL = 'carol@example.com'
const NOW = 1_800_000_000_000

let env: Env
let dispose: () => Promise<void>

beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
})

afterEach(async () => {
  await dispose()
})

const secret = () => env.BETTER_AUTH_SECRET
const issue = () => issueCode(env.DB, secret(), EMAIL, NOW)
const check = (otp: string, now = NOW) =>
  checkCode(env.DB, secret(), EMAIL, otp, now)
const wrongFor = (code: string) => (code === '000000' ? '000001' : '000000')

describe('sign-in codes', () => {
  it('the right code is ok once, then INVALID_OTP', async () => {
    const code = await issue()
    expect(await check(code)).toBe('ok')
    expect(await check(code)).toBe('INVALID_OTP')
  })

  it('a wrong code is INVALID_OTP', async () => {
    const code = await issue()
    expect(await check(wrongFor(code))).toBe('INVALID_OTP')
  })

  it('a code for an email with none issued is INVALID_OTP', async () => {
    expect(await check('123456')).toBe('INVALID_OTP')
  })

  it('a code is OTP_EXPIRED after 5 minutes', async () => {
    const code = await issue()
    expect(await check(code, NOW + CODE_TTL_MS + 1)).toBe('OTP_EXPIRED')
    expect(await check(code, NOW + CODE_TTL_MS + 2)).toBe('INVALID_OTP')
  })

  it('after 3 wrong tries even the right code is TOO_MANY_ATTEMPTS', async () => {
    const code = await issue()
    const wrong = wrongFor(code)
    for (let i = 0; i < 3; i++) expect(await check(wrong)).toBe('INVALID_OTP')
    expect(await check(code)).toBe('TOO_MANY_ATTEMPTS')
  })

  it('the right code on the third try still works', async () => {
    const code = await issue()
    const wrong = wrongFor(code)
    expect(await check(wrong)).toBe('INVALID_OTP')
    expect(await check(wrong)).toBe('INVALID_OTP')
    expect(await check(code)).toBe('ok')
  })

  it('a new code replaces the old one and resets tries', async () => {
    const first = await issue()
    expect(await check(wrongFor(first))).toBe('INVALID_OTP')
    expect(await check(wrongFor(first))).toBe('INVALID_OTP')
    let second = await issue()
    while (second === first) second = await issue()
    expect(await check(first)).toBe('INVALID_OTP')
    expect(await check(second)).toBe('ok')
  })

  it('parallel wrong guesses get at most 3 comparisons', async () => {
    const code = await issue()
    const wrong = wrongFor(code)
    const results = await Promise.all(
      Array.from({ length: 6 }, () => check(wrong)),
    )
    expect(results.filter((r) => r === 'INVALID_OTP')).toHaveLength(3)
    expect(results.filter((r) => r === 'TOO_MANY_ATTEMPTS')).toHaveLength(3)
    expect(await check(code)).toBe('TOO_MANY_ATTEMPTS')
  })

  it('the stored hash does not contain the code', async () => {
    const code = await issue()
    const row = await env.DB.prepare(
      'SELECT code_hash FROM sign_in_codes WHERE email = ?',
    )
      .bind(EMAIL)
      .first<{ code_hash: string }>()
    expect(row?.code_hash).toBeTruthy()
    expect(row?.code_hash).not.toContain(code)
    expect(row?.code_hash).toBe(await hmacHex(secret(), `${EMAIL}:${code}`))
  })

  it('clearing an expired code never deletes a fresh one issued meanwhile', async () => {
    await issue()
    const later = NOW + CODE_TTL_MS + 1
    let fresh = ''
    // Issue a new code just before the expired one is deleted, as a parallel send-code could.
    const racing = {
      prepare(sql: string) {
        const statement = env.DB.prepare(sql)
        if (!sql.startsWith('DELETE FROM sign_in_codes')) return statement
        return {
          bind: (...args: unknown[]) => ({
            run: async () => {
              fresh = await issueCode(env.DB, secret(), EMAIL, later)
              return statement.bind(...args).run()
            },
          }),
        }
      },
    } as unknown as D1Database
    expect(await checkCode(racing, secret(), EMAIL, '000000', later)).toBe(
      'OTP_EXPIRED',
    )
    expect(fresh).toMatch(/^\d{6}$/)
    expect(await check(fresh, later + 1)).toBe('ok')
  })
})
