import type { Env } from './env'
import { clientKey, overLimit } from './limits'
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

describe('clientKey', () => {
  it("uses cf-connecting-ip, or no-ip when it's missing", () => {
    const withIp = new Request('https://x.test/', {
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    })
    expect(clientKey(withIp, '/send')).toBe('1.2.3.4|/send')
    expect(clientKey(new Request('https://x.test/'), '/send')).toBe(
      'no-ip|/send',
    )
  })
})
