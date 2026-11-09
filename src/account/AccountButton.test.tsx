import { render, screen } from '@testing-library/react'
import { db } from '../db/db'
import { quietly } from '../sync/track'
import { AccountButton } from './AccountButton'
import { useAccount } from './useAccount'

const EMAIL = 'carol@example.com'

async function waitingPhoto() {
  await quietly(db, () =>
    db.photos.put({
      id: 'p1',
      hash: 'h1',
      width: 1,
      height: 1,
      takenAt: '2026-11-08T00:00:00.000Z',
      needsUpload: 1,
    }),
  )
}

beforeEach(async () => {
  await quietly(db, () => db.photos.clear())
  useAccount.setState({ status: 'signed-out', email: undefined })
})

test('signed in with photos waiting shows the dot', async () => {
  await waitingPhoto()
  useAccount.setState({ status: 'signed-in', email: EMAIL })
  render(<AccountButton onClick={() => {}} />)
  expect(await screen.findByTestId('waiting-dot')).toBeInTheDocument()
  expect(
    screen.getByRole('button', {
      name: `Account, signed in as ${EMAIL}, photos waiting to upload`,
    }),
  ).toBeVisible()
})

test('no dot when nothing waits', async () => {
  useAccount.setState({ status: 'signed-in', email: EMAIL })
  render(<AccountButton onClick={() => {}} />)
  expect(
    await screen.findByRole('button', {
      name: `Account, signed in as ${EMAIL}`,
    }),
  ).toBeVisible()
  expect(screen.queryByTestId('waiting-dot')).not.toBeInTheDocument()
})

test('no dot when signed out, even with photos waiting', async () => {
  await waitingPhoto()
  render(<AccountButton onClick={() => {}} />)
  await screen.findByRole('button', { name: 'Account, signed out' })
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByTestId('waiting-dot')).not.toBeInTheDocument()
})
