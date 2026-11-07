import type { Env } from './env'
import { clientKey, overLimit, pruneRateLimits } from './limits'
import { makeTestEnv } from './test/harness'

const NOW = 1_800_000_000_000

let env: Env
let dispose: () => Promise<void>

beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
})

afterEach(async () => {
  await dispose()
})

const hit = (key: string, now = NOW) => overLimit(env.DB, key, 60_000, 3, now)

describe('overLimit', () => {
  it('the 4th hit in a window is over, and a new window starts fresh', async () => {
    const results = []
    for (let i = 0; i < 4; i++) results.push(await hit('a'))
    expect(results).toEqual([false, false, false, true])
    expect(await hit('a', NOW + 60_000)).toBe(false)
  })

  it("different keys don't share a window", async () => {
    for (let i = 0; i < 4; i++) await hit('a')
    expect(await hit('b')).toBe(false)
  })

  it('parallel hits are counted exactly', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => hit('a')))
    expect(results.filter((r) => !r)).toHaveLength(3)
  })
})

describe('pruneRateLimits', () => {
  it('deletes windows that started over an hour ago and keeps the rest', async () => {
    await hit('old', NOW - 60 * 60 * 1000 - 1)
    await hit('edge', NOW - 60 * 60 * 1000)
    await hit('recent', NOW - 30_000)
    await pruneRateLimits(env.DB, NOW)
    const rows = await env.DB.prepare(
      'SELECT key FROM rate_limits ORDER BY key',
    ).all<{ key: string }>()
    expect(rows.results.map((r) => r.key)).toEqual(['edge', 'recent'])
  })
})

const keyFor = (ip?: string) =>
  clientKey(
    new Request('https://x.test/', {
      headers: ip === undefined ? {} : { 'cf-connecting-ip': ip },
    }),
    '/send',
  )

describe('clientKey', () => {
  it("uses cf-connecting-ip, or no-ip when it's missing", () => {
    expect(keyFor('1.2.3.4')).toBe('1.2.3.4|/send')
    expect(keyFor()).toBe('no-ip|/send')
    expect(keyFor('   ')).toBe('no-ip|/send')
  })

  it('leaves IPv4 as it is, apart from spaces', () => {
    expect(keyFor(' 203.0.113.5 ')).toBe('203.0.113.5|/send')
  })

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(keyFor('::ffff:203.0.113.5')).toBe('203.0.113.5|/send')
    expect(keyFor('::FFFF:203.0.113.5')).toBe('203.0.113.5|/send')
    expect(keyFor('0:0:0:0:0:ffff:cb00:7105')).toBe('203.0.113.5|/send')
  })

  it('groups IPv6 addresses by their /64', () => {
    const a = keyFor('2001:db8:1:2::1')
    expect(a).toBe('2001:db8:1:2::/64|/send')
    expect(keyFor('2001:DB8:0001:0002:ABCD:0000:0000:FFFF')).toBe(a)
    expect(keyFor('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(a)
    expect(keyFor('2001:db8:1:3::1')).not.toBe(a)
    expect(keyFor('2001:db8::1')).toBe('2001:db8:0:0::/64|/send')
    expect(keyFor('::1')).toBe('0:0:0:0::/64|/send')
  })

  it('falls back to the trimmed raw value for garbage, without throwing', () => {
    for (const junk of [
      'not-an-ip',
      '1:2:3',
      '1::2::3',
      '2001:db8:1:2:3:4:5:6:7',
      'gggg::1',
      '12345::1',
      '::ffff:999.1.1.1',
      '1.2.3',
      '256.1.1.1',
      ':',
      ':::',
    ]) {
      expect(keyFor(` ${junk} `)).toBe(`${junk}|/send`)
    }
  })
})
