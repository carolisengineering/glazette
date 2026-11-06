import { resendSender } from './email'
import type { Env } from './env'

const env = { RESEND_API_KEY: 're_test_key' } as Env

afterEach(() => {
  vi.unstubAllGlobals()
})

test('sends the code through Resend from Glazette', async () => {
  const fetchMock = vi.fn(
    async () => new Response('{"id":"1"}', { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)

  await resendSender(env)('carol@example.com', '123456')

  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ]
  expect(url).toBe('https://api.resend.com/emails')
  expect(init.method).toBe('POST')
  expect(new Headers(init.headers).get('authorization')).toBe(
    'Bearer re_test_key',
  )
  expect(JSON.parse(init.body as string)).toEqual({
    from: 'Glazette <onboarding@resend.dev>',
    to: ['carol@example.com'],
    subject: 'Your Glazette code',
    text: 'Your Glazette sign-in code is 123456. It expires in 5 minutes.',
  })
})

test('throws when Resend refuses the email', async () => {
  vi.stubGlobal(
    'fetch',
    async () => new Response('invalid key', { status: 401 }),
  )
  await expect(
    resendSender(env)('carol@example.com', '123456'),
  ).rejects.toThrow(/401/)
})
