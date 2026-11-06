import { createApp } from './app'
import type { Env } from './env'
import { makeTestEnv } from './test/harness'

const built = vi.hoisted(() => ({ count: 0 }))
vi.mock('./auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('./auth')>()
  return {
    ...real,
    createAuth: (...args: Parameters<typeof real.createAuth>) => {
      built.count++
      return real.createAuth(...args)
    },
  }
})

let env: Env
let dispose: () => Promise<void>
beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
  built.count = 0
})
afterEach(() => dispose())

test('requests through one app and env share one auth instance', async () => {
  const app = createApp({ sendCode: async () => {} })
  const get = () =>
    app.request(
      'http://localhost/api/auth/get-session',
      { headers: { Origin: 'http://localhost' } },
      env,
    )
  expect((await get()).status).toBe(200)
  expect((await get()).status).toBe(200)
  expect(built.count).toBe(1)
})
