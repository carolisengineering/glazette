import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountSheet } from './AccountSheet'
import { requestCode, verifyCode } from './api'
import { useAccount } from './useAccount'

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  signOutRemote: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  vi.mocked(requestCode).mockReset().mockResolvedValue('sent')
  vi.mocked(verifyCode).mockReset().mockResolvedValue('ok')
  localStorage.clear()
  useAccount.setState({ status: 'signed-out', email: undefined })
})

async function sendCodeTo(email = ' Carol@Example.com ') {
  const user = userEvent.setup()
  render(<AccountSheet onClose={() => {}} />)
  await user.type(screen.getByLabelText('Email'), email)
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  return user
}

test('signed out: email → Send code → code field and the sent line', async () => {
  const user = userEvent.setup()
  render(<AccountSheet onClose={() => {}} />)
  expect(screen.getByRole('dialog', { name: 'Account' })).toBeVisible()
  expect(
    screen.getByText(
      'Sign in to keep your pieces in step across your devices.',
    ),
  ).toBeVisible()
  const email = screen.getByLabelText('Email')
  expect(email).toHaveAttribute('type', 'email')
  expect(email).toHaveAttribute('autocomplete', 'email')
  expect(email).toHaveAttribute('enterkeyhint', 'send')
  await user.type(email, ' Carol@Example.com ')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  expect(requestCode).toHaveBeenCalledWith('carol@example.com')
  expect(
    await screen.findByText('We sent a 6-digit code to carol@example.com.'),
  ).toBeVisible()
  expect(screen.getByLabelText('Code')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('a not-open email shows the not-open line and no code field', async () => {
  vi.mocked(requestCode).mockResolvedValue('not-open')
  await sendCodeTo()
  expect(
    await screen.findByText(
      "Glazette accounts aren't open yet. Thanks for your interest!",
    ),
  ).toBeVisible()
  expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
})

test('a wrong code shows the wrong-code line and keeps the code field', async () => {
  vi.mocked(verifyCode).mockResolvedValue('wrong')
  const user = await sendCodeTo()
  await user.type(await screen.findByLabelText('Code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(verifyCode).toHaveBeenCalledWith('carol@example.com', '123456')
  expect(
    await screen.findByText("That code didn't work. Check it and try again."),
  ).toBeVisible()
  expect(screen.getByLabelText('Code')).toBeVisible()
})

test('an expired code shows the expired line', async () => {
  vi.mocked(verifyCode).mockResolvedValue('expired')
  const user = await sendCodeTo()
  await user.type(await screen.findByLabelText('Code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(
    await screen.findByText('That code has expired. Send a new one.'),
  ).toBeVisible()
})

const OTHER_LINES = [
  ['rate-limited', 'Wait a minute before asking for another code.'],
  ['offline', "You're offline. Connect to sign in."],
  ['error', 'Something went wrong. Try again.'],
] as const

test.each(OTHER_LINES)(
  '%s on send shows its exact line',
  async (result, line) => {
    vi.mocked(requestCode).mockResolvedValue(result)
    await sendCodeTo()
    expect(await screen.findByText(line)).toBeVisible()
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
  },
)

test.each(OTHER_LINES)(
  '%s on verify shows its exact line',
  async (result, line) => {
    vi.mocked(verifyCode).mockResolvedValue(result)
    const user = await sendCodeTo()
    await user.type(await screen.findByLabelText('Code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(line)).toBeVisible()
  },
)

test('a right code signs in and shows Signed in as carol@example.com', async () => {
  const user = await sendCodeTo()
  await user.type(await screen.findByLabelText('Code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(
    await screen.findByText('Signed in as carol@example.com'),
  ).toBeVisible()
  expect(useAccount.getState()).toMatchObject({
    status: 'signed-in',
    email: 'carol@example.com',
  })
})

test('Sign out returns to the email field', async () => {
  useAccount.setState({ status: 'signed-in', email: 'carol@example.com' })
  const user = userEvent.setup()
  render(<AccountSheet onClose={() => {}} />)
  expect(screen.getByText('Signed in as carol@example.com')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(await screen.findByLabelText('Email')).toBeVisible()
  expect(useAccount.getState().status).toBe('signed-out')
})

test('Send code is disabled while a request is in flight (no double send)', async () => {
  let finish: (r: 'sent') => void = () => {}
  vi.mocked(requestCode).mockReturnValue(new Promise((r) => (finish = r)))
  const user = await sendCodeTo()
  const button = screen.getByRole('button', { name: 'Send code' })
  expect(button).toBeDisabled()
  await user.click(button)
  expect(requestCode).toHaveBeenCalledTimes(1)
  await act(async () => finish('sent'))
  expect(await screen.findByLabelText('Code')).toBeVisible()
})

test('Sign in is disabled while verifying (no double verify)', async () => {
  let finish: (r: 'ok') => void = () => {}
  vi.mocked(verifyCode).mockReturnValue(new Promise((r) => (finish = r)))
  const user = await sendCodeTo()
  await user.type(await screen.findByLabelText('Code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(verifyCode).toHaveBeenCalledTimes(1)
  await act(async () => finish('ok'))
})

test('Send a new code asks again for the same email', async () => {
  const user = await sendCodeTo()
  await user.click(
    await screen.findByRole('button', { name: 'Send a new code' }),
  )
  expect(requestCode).toHaveBeenCalledTimes(2)
  expect(requestCode).toHaveBeenLastCalledWith('carol@example.com')
})

test('Use a different email returns to the email step', async () => {
  const user = await sendCodeTo()
  await user.click(
    await screen.findByRole('button', { name: 'Use a different email' }),
  )
  expect(screen.getByLabelText('Email')).toBeVisible()
  expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
})

test('the code field is numeric with one-time-code autofill', async () => {
  await sendCodeTo()
  const code = await screen.findByLabelText('Code')
  expect(code).toHaveAttribute('inputmode', 'numeric')
  expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  expect(code).toHaveAttribute('maxlength', '6')
})
