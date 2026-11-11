import { createApp } from './app'
import type { Env } from './env'
import { makeTestEnv } from './test/harness'

let env: Env
let dispose: () => Promise<void>

beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await dispose()
})

const origin = 'http://localhost'

test('forwards a batch to PostHog without cookies or IP headers', async () => {
  const fetchStub = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response('{"status":1}', {
        status: 202,
        headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' },
      }),
  )
  vi.stubGlobal('fetch', fetchStub)
  const body = '{"batch":[{"event":"x"}]}'
  const res = await createApp().request(
    '/api/t/batch/?ver=1',
    {
      method: 'POST',
      body,
      headers: {
        origin,
        'content-type': 'application/json',
        cookie: 'session=secret',
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-for': '203.0.113.9',
      },
    },
    env,
  )
  expect(res.status).toBe(202)
  expect(res.headers.get('content-type')).toContain('application/json')
  expect(res.headers.get('set-cookie')).toBeNull()
  expect(await res.text()).toBe('{"status":1}')
  expect(fetchStub).toHaveBeenCalledOnce()
  const [url, init] = fetchStub.mock.calls[0]
  expect(url).toBe('https://us.i.posthog.com/batch/?ver=1')
  const sent = new Request('http://x', init as RequestInit)
  expect(await sent.text()).toBe(body)
  expect(sent.headers.get('cookie')).toBeNull()
  expect(sent.headers.get('cf-connecting-ip')).toBeNull()
  expect(sent.headers.get('x-forwarded-for')).toBeNull()
  expect(sent.headers.get('content-type')).toBe('application/json')
})

test('refuses other paths', async () => {
  const fetchStub = vi.fn()
  vi.stubGlobal('fetch', fetchStub)
  const app = createApp()
  const post = await app.request(
    '/api/t/decide-anything-else',
    { method: 'POST', body: '{}', headers: { origin } },
    env,
  )
  const get = await app.request('/api/t/static/array.js', {}, env)
  expect(post.status).toBe(404)
  expect(get.status).toBe(404)
  expect(fetchStub).not.toHaveBeenCalled()
})

test("still needs the app's origin", async () => {
  const fetchStub = vi.fn()
  vi.stubGlobal('fetch', fetchStub)
  const res = await createApp().request(
    '/api/t/batch/',
    { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } },
    env,
  )
  expect(res.status).toBe(403)
  expect(fetchStub).not.toHaveBeenCalled()
})
