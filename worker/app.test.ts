import { createApp } from './app'
import type { Env } from './env'
import { makeTestEnv } from './test/harness'

let env: Env
let dispose: () => Promise<void>

beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
})

afterEach(async () => {
  await dispose()
})

test('GET /api/health answers ok', async () => {
  const res = await createApp().request('/api/health', {}, env)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test('unknown /api routes are 404 JSON, not the app shell', async () => {
  const res = await createApp().request('/api/nope', {}, env)
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('application/json')
})
