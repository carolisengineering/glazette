import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeletedItem } from '../../shared/syncProtocol'
import { db } from '../db/db'
import * as putBackModule from '../db/putBack'
import type { Photo, Piece, StageEntry } from '../db/types'
import { fetchDeleted } from '../sync/transport'
import { requestSync, useSync } from '../sync/useSync'
import { AccountSheet } from './AccountSheet'
import { RecentlyDeleted } from './RecentlyDeleted'
import { useAccount } from './useAccount'

vi.mock('../sync/transport', async (orig) => ({
  ...(await orig<typeof import('../sync/transport')>()),
  fetchDeleted: vi.fn(),
}))
vi.mock('../sync/useSync', async (orig) => ({
  ...(await orig<typeof import('../sync/useSync')>()),
  requestSync: vi.fn(),
}))

const T = '2026-01-02T00:00:00.000Z'
// Heard of the delete a day before the tests' "now", so 29 days are left.
const HEARD = new Date(Date.now() - 24 * 3_600_000 + 60_000).toISOString()
const HASH = 'b'.repeat(64)

const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  name: 'Blue mug',
  createdAt: T,
  updatedAt: T,
  ...extra,
})
const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  hash: HASH,
  width: 1,
  height: 1,
  takenAt: T,
  ...extra,
})
const item = (kind: 'piece' | 'photo', id: string): DeletedItem => ({
  kind,
  id,
  heardAt: HEARD,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  vi.mocked(fetchDeleted).mockReset().mockResolvedValue([])
  vi.mocked(requestSync).mockReset()
  useSync.setState({ syncing: false, failed: false })
  useAccount.setState({ status: 'signed-in', email: 'carol@example.com' })
})

afterEach(() => vi.restoreAllMocks())

// What the record sync writes when it finishes; photo transfers come after.
let syncedAt = Date.parse(T)
const finishRecordSync = () =>
  act(async () => {
    syncedAt += 60_000
    await db.syncState.put({
      id: 'state',
      account: 'carol@example.com',
      cursor: 1,
      lastSyncedAt: new Date(syncedAt).toISOString(),
    })
  })

async function seedBoth() {
  await db.pieces.bulkAdd([piece('p1', { deletedAt: T })])
  await db.entries.bulkAdd([
    { id: 'e1', pieceId: 'p1', stage: 'thrown' } as StageEntry,
  ])
  await db.photos.bulkAdd([
    photo('ph1', { deletedAt: T, lastPieceId: 'p1', lastStage: 'thrown' }),
  ])
  vi.mocked(fetchDeleted).mockResolvedValue([
    item('piece', 'p1'),
    item('photo', 'ph1'),
  ])
}

test('the list shows deleted pieces and photos', async () => {
  await seedBoth()
  render(<RecentlyDeleted onBack={() => {}} />)
  expect(
    screen.getByText('Kept for 30 days, then removed for good.'),
  ).toBeVisible()
  expect(await screen.findByText('Blue mug')).toBeVisible()
  expect(screen.getByText('Photo from Blue mug')).toBeVisible()
  expect(screen.getAllByText('29 days left')).toHaveLength(2)
})

test('a piece put back leaves the list and says so', async () => {
  await db.pieces.add(piece('p1', { deletedAt: T }))
  vi.mocked(fetchDeleted).mockResolvedValue([item('piece', 'p1')])
  const user = userEvent.setup()
  render(<RecentlyDeleted onBack={() => {}} />)
  await user.click(await screen.findByRole('button', { name: 'Put back' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Put back Blue mug.',
  )
  expect(screen.queryByRole('button', { name: 'Put back' })).toBeNull()
  expect((await db.pieces.get('p1'))?.deletedAt).toBeUndefined()
})

test('a photo put back says where', async () => {
  await seedBoth()
  const user = userEvent.setup()
  render(<RecentlyDeleted onBack={() => {}} />)
  const row = (await screen.findByText('Photo from Blue mug')).closest('li')
  await user.click(within(row as HTMLElement).getByRole('button'))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Put back the photo on Blue mug.',
  )
  expect((await db.photos.get('ph1'))?.deletedAt).toBeUndefined()
})

test('a failed put back says so and keeps the row', async () => {
  await db.pieces.add(piece('p1', { deletedAt: T }))
  vi.mocked(fetchDeleted).mockResolvedValue([item('piece', 'p1')])
  vi.spyOn(putBackModule, 'putBackPiece').mockRejectedValue(new Error('no'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const user = userEvent.setup()
  render(<RecentlyDeleted onBack={() => {}} />)
  await user.click(await screen.findByRole('button', { name: 'Put back' }))
  expect(
    await screen.findByText("Couldn't put that back. Try again."),
  ).toBeVisible()
  expect(screen.getByText('Blue mug')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Put back' })).toBeEnabled()
})

test('Put back is disabled while its write runs', async () => {
  await db.pieces.add(piece('p1', { deletedAt: T }))
  vi.mocked(fetchDeleted).mockResolvedValue([item('piece', 'p1')])
  let finish: () => void = () => {}
  vi.spyOn(putBackModule, 'putBackPiece').mockReturnValue(
    new Promise<void>((r) => {
      finish = r
    }),
  )
  const user = userEvent.setup()
  render(<RecentlyDeleted onBack={() => {}} />)
  await user.click(await screen.findByRole('button', { name: 'Put back' }))
  expect(screen.getByRole('button', { name: 'Put back' })).toBeDisabled()
  await act(async () => finish())
  expect(await screen.findByRole('status')).toBeVisible()
})

test('nothing deleted shows the empty line', async () => {
  render(<RecentlyDeleted onBack={() => {}} />)
  expect(
    await screen.findByText(
      'Nothing here. Deleted pieces and photos stay for 30 days.',
    ),
  ).toBeVisible()
})

test('offline shows the offline line and no list', async () => {
  vi.mocked(fetchDeleted).mockResolvedValue('offline')
  render(<RecentlyDeleted onBack={() => {}} />)
  expect(
    await screen.findByText(
      "You're offline. Connect to see what's been deleted.",
    ),
  ).toBeVisible()
  expect(screen.queryByRole('list')).toBeNull()
})

test('a failed load shows the failure line', async () => {
  vi.mocked(fetchDeleted).mockResolvedValue('error')
  render(<RecentlyDeleted onBack={() => {}} />)
  expect(
    await screen.findByText("Couldn't load this. Try again later."),
  ).toBeVisible()
})

test('a list fetched again after a sync shows new deletes', async () => {
  render(<RecentlyDeleted onBack={() => {}} />)
  await screen.findByText(/Nothing here/)
  expect(fetchDeleted).toHaveBeenCalledTimes(1)
  await db.pieces.add(piece('p1', { deletedAt: T }))
  vi.mocked(fetchDeleted).mockResolvedValue([item('piece', 'p1')])
  act(() => useSync.setState({ syncing: true }))
  expect(fetchDeleted).toHaveBeenCalledTimes(1)
  await finishRecordSync()
  expect(await screen.findByText('Blue mug')).toBeVisible()
  expect(fetchDeleted).toHaveBeenCalledTimes(2)
})

test("while a sync runs, an empty list shows nothing until the sync's refetch lands", async () => {
  // The server has the other device's delete; this device hasn't pulled it.
  await db.pieces.add(piece('p1'))
  vi.mocked(fetchDeleted).mockResolvedValue([item('piece', 'p1')])
  useSync.setState({ syncing: true })
  render(<RecentlyDeleted onBack={() => {}} />)
  await waitFor(() => expect(fetchDeleted).toHaveBeenCalledTimes(1))
  await act(() => new Promise((r) => setTimeout(r, 50)))
  expect(screen.queryByText(/Nothing here/)).toBeNull()
  expect(screen.queryByRole('list')).toBeNull()

  // The pull brings the delete in, and the refetch after the record sync
  // shows it, while photos still transfer.
  await db.pieces.update('p1', { deletedAt: T })
  await finishRecordSync()
  expect(await screen.findByText('Blue mug')).toBeVisible()
  expect(fetchDeleted).toHaveBeenCalledTimes(2)
})

test('a list still empty after the record sync shows the empty line while photos transfer', async () => {
  useSync.setState({ syncing: true })
  render(<RecentlyDeleted onBack={() => {}} />)
  await waitFor(() => expect(fetchDeleted).toHaveBeenCalledTimes(1))
  await finishRecordSync()
  expect(await screen.findByText(/Nothing here/)).toBeVisible()
  expect(fetchDeleted).toHaveBeenCalledTimes(2)
  expect(useSync.getState().syncing).toBe(true)
})

test('a sync that ends without finishing shows the empty line', async () => {
  useSync.setState({ syncing: true })
  render(<RecentlyDeleted onBack={() => {}} />)
  await waitFor(() => expect(fetchDeleted).toHaveBeenCalledTimes(1))
  act(() => useSync.setState({ syncing: false }))
  expect(await screen.findByText(/Nothing here/)).toBeVisible()
})

test("each Put back is described by its row's name", async () => {
  await seedBoth()
  render(<RecentlyDeleted onBack={() => {}} />)
  await screen.findByText('Photo from Blue mug')
  const buttons = screen.getAllByRole('button', { name: 'Put back' })
  expect(buttons).toHaveLength(2)
  expect(buttons[0]).toHaveAccessibleDescription('Blue mug')
  expect(buttons[1]).toHaveAccessibleDescription('Photo from Blue mug')
})

test('opening the list starts a sync', async () => {
  render(<RecentlyDeleted onBack={() => {}} />)
  await screen.findByText(/Nothing here/)
  expect(requestSync).toHaveBeenCalledTimes(1)
})

test('a dead session refreshes the account', async () => {
  vi.mocked(fetchDeleted).mockResolvedValue('signed-out')
  const refresh = vi.fn().mockResolvedValue(undefined)
  useAccount.setState({ refresh })
  render(<RecentlyDeleted onBack={() => {}} />)
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
})

test("a photo not held here uses the server's thumbnail", async () => {
  await db.photos.add(photo('ph1', { deletedAt: T }))
  vi.mocked(fetchDeleted).mockResolvedValue([item('photo', 'ph1')])
  const { container } = render(<RecentlyDeleted onBack={() => {}} />)
  expect(await screen.findByText('Photo')).toBeVisible()
  await waitFor(() =>
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      `/api/photos/${HASH}/thumb`,
    ),
  )
})

test('a photo held here shows its own bytes', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:mine')
  URL.revokeObjectURL = vi.fn()
  await db.photos.add(photo('ph1', { deletedAt: T }))
  await db.photoBytes.add({ hash: HASH, blob: new Blob(['x']) })
  vi.mocked(fetchDeleted).mockResolvedValue([item('photo', 'ph1')])
  const { container } = render(<RecentlyDeleted onBack={() => {}} />)
  await waitFor(() =>
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:mine'),
  )
})

test('the Back button returns to the Account sheet', async () => {
  const user = userEvent.setup()
  render(<AccountSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Recently deleted' }))
  expect(
    await screen.findByRole('dialog', { name: 'Recently deleted' }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('dialog', { name: 'Account' })).toBeVisible()
  expect(screen.getByText('Signed in as carol@example.com')).toBeVisible()
})

test('swapping views moves focus to the title', async () => {
  const user = userEvent.setup()
  render(<AccountSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Recently deleted' }))
  expect(
    screen.getByRole('heading', { name: 'Recently deleted' }),
  ).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('heading', { name: 'Account' })).toHaveFocus()
})

test('signing out and back in with the sheet open shows the Account view', async () => {
  const user = userEvent.setup()
  render(<AccountSheet onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Recently deleted' }))
  expect(
    await screen.findByRole('dialog', { name: 'Recently deleted' }),
  ).toBeVisible()
  act(() => useAccount.setState({ status: 'signed-out', email: undefined }))
  act(() =>
    useAccount.setState({ status: 'signed-in', email: 'carol@example.com' }),
  )
  expect(screen.getByRole('dialog', { name: 'Account' })).toBeVisible()
  expect(screen.getByText('Signed in as carol@example.com')).toBeVisible()
})
