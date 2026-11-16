import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import { createPiece, ensureDefaults } from '../db/ops'
import type { Piece } from '../db/types'
import { setSinkForTests } from '../telemetry/telemetry'
import { PlanSheet } from './PlanSheet'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureDefaults()
})

afterEach(() => setSinkForTests(undefined))

async function pieceOf(id: string): Promise<Piece> {
  const piece = await db.pieces.get(id)
  if (!piece) throw new Error('Piece not found')
  return piece
}

function captureEvents() {
  const events: string[] = []
  setSinkForTests({
    capture: (n) => events.push(n),
    identify: () => {},
    reset: () => {},
    register: () => {},
    captureException: () => {},
  })
  return events
}

test('saving a plan creates the typed glaze and stores the plan', async () => {
  const id = await createPiece({ name: 'Mug' })
  const events = captureEvents()
  const onClose = vi.fn()
  render(
    <PlanSheet piece={await pieceOf(id)} planLayers={[]} onClose={onClose} />,
  )
  await userEvent.type(screen.getByLabelText('Glaze 1'), 'Brand New')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const glaze = (await db.glazes.toArray()).find((g) => g.name === 'Brand New')
  expect((await pieceOf(id)).glazePlan).toEqual([{ glazeId: glaze?.id }])
  expect(events).toEqual(['piece_edited'])
})

test('saving for a piece that was deleted meanwhile creates no glaze, sends nothing, and closes', async () => {
  const id = await createPiece({ name: 'Mug' })
  const events = captureEvents()
  const piece = await pieceOf(id)
  const onClose = vi.fn()
  render(<PlanSheet piece={piece} planLayers={[]} onClose={onClose} />)
  await userEvent.type(screen.getByLabelText('Glaze 1'), 'Ghost Glaze')
  await db.pieces.update(id, { deletedAt: '2026-11-12T10:00:00.000Z' })
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect((await db.glazes.toArray()).map((g) => g.name)).not.toContain(
    'Ghost Glaze',
  )
  expect(events).toEqual([])
})
