import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import {
  addStageEntry,
  createPiece,
  ensureDefaults,
  markLost,
  softDelete,
} from '../db/ops'
import { renderRoute } from '../test/renderRoute'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureDefaults()
})

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

test('shows "2 pieces ready to bisque" when two pieces are trimmed', async () => {
  for (const name of ['A', 'B']) {
    const id = await createPiece({ name })
    await addStageEntry({ pieceId: id, stage: 'trimmed' })
  }
  await createPiece({ name: 'C' })
  renderRoute('/')
  expect(await screen.findByText('2 pieces ready to bisque')).toBeVisible()
})

test('kiln banner uses the singular for one piece and is absent for none', async () => {
  renderRoute('/')
  await screen.findByRole('heading', { name: 'My Shelf' })
  expect(screen.queryByText(/ready to bisque/)).not.toBeInTheDocument()
  const id = await createPiece({ name: 'A' })
  await addStageEntry({ pieceId: id, stage: 'trimmed' })
  expect(await screen.findByText('1 piece ready to bisque')).toBeVisible()
})

test('Lost chip is absent until a piece is lost', async () => {
  const id = await createPiece({ name: 'A' })
  renderRoute('/')
  await screen.findByText('A')
  expect(
    screen.queryByRole('button', { name: /^Lost/ }),
  ).not.toBeInTheDocument()
  await markLost(id, true)
  expect(await screen.findByRole('button', { name: /^Lost/ })).toBeVisible()
  expect(screen.queryByText('A')).not.toBeInTheDocument()
  await softDelete('pieces', id)
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /^Lost/ }),
    ).not.toBeInTheDocument(),
  )
})

test('card shows "Untitled bowl", stage label, clay name and "Day 3"', async () => {
  const clayId = await db.clays.toCollection().first()
  const id = await createPiece({
    form: 'bowl',
    clayId: clayId?.id,
    date: daysAgo(2),
  })
  renderRoute('/')
  const title = await screen.findByText('Untitled bowl')
  const card = title.closest('article') as HTMLElement
  expect(within(card).getByText('Thrown')).toBeVisible()
  expect(within(card).getByText('White stoneware · Day 3')).toBeVisible()
  expect(
    within(card).getByRole('img', { name: 'Stage 1 of 5' }),
  ).toBeInTheDocument()
  expect(id).toBeTruthy()
})

test('glazed and fired cards show glaze and clay; fired has no advance arrow', async () => {
  await db.glazes.add({ id: 'g1', name: 'Celadon', color: '#9DBBAA' })
  const clay = await db.clays.toCollection().first()
  const id = await createPiece({ name: 'Vase', clayId: clay?.id })
  await addStageEntry({
    pieceId: id,
    stage: 'glazed',
    glazes: [{ glazeId: 'g1' }],
  })
  const fired = await createPiece({ name: 'Cup' })
  await addStageEntry({ pieceId: fired, stage: 'fired' })
  renderRoute('/')
  expect(await screen.findByText('Celadon · White stoneware')).toBeVisible()
  expect(screen.getByText('Out of the kiln')).toBeVisible()
  expect(
    screen.queryByRole('link', { name: /Move Cup/ }),
  ).not.toBeInTheDocument()
})

test('a piece with no entries still renders under All', async () => {
  await db.pieces.add({
    id: 'bare',
    name: 'Bare',
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
  })
  renderRoute('/')
  expect(await screen.findByText('Bare')).toBeVisible()
})

test('chips filter the grid and show counts', async () => {
  const a = await createPiece({ name: 'Round' })
  await addStageEntry({ pieceId: a, stage: 'trimmed' })
  await createPiece({ name: 'Fresh' })
  renderRoute('/')
  await screen.findByText('Round')
  const user = userEvent.setup()
  expect(screen.getByRole('button', { name: /^All\s*2$/ })).toBeVisible()
  await user.click(screen.getByRole('button', { name: /^Thrown\s*1$/ }))
  expect(screen.queryByText('Round')).not.toBeInTheDocument()
  expect(screen.getByText('Fresh')).toBeVisible()
})

test('advance arrow navigates to /capture?pieceId=<id>', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute('/')
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('link', { name: 'Move Mug to trimmed' }),
  )
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/capture')
    expect(router.state.location.search).toEqual({ pieceId: id })
  })
})

test('the + button goes to /capture without a pieceId, Glazes goes to /glazes', async () => {
  const router = renderRoute('/')
  const user = userEvent.setup()
  await user.click(await screen.findByRole('link', { name: 'New piece' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/capture'))
  expect(router.state.location.search).toEqual({})
  await router.navigate({ to: '/' })
  await user.click(await screen.findByRole('link', { name: 'Glazes' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/glazes'))
})

test('tapping a card opens the piece stub', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute('/')
  const user = userEvent.setup()
  await user.click(await screen.findByText('Mug'))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/piece/${id}`),
  )
  expect(await screen.findByRole('heading', { name: 'Mug' })).toBeVisible()
  expect(screen.getByText('Thrown')).toBeVisible()
  expect(screen.getByRole('link', { name: /Shelf/ })).toBeVisible()
})
