import { createApp } from './app'
import { makeTestEnv } from './test/harness'

test('GET /api/health answers ok', async () => {
  const { env, dispose } = await makeTestEnv()
  const res = await createApp().request('/api/health', {}, env)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  await dispose()
})

test('unknown /api routes are 404 JSON, not the app shell', async () => {
  const { env, dispose } = await makeTestEnv()
  const res = await createApp().request('/api/nope', {}, env)
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('application/json')
  await dispose()
})
