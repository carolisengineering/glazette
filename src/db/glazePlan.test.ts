import { beforeEach, describe, expect, test } from 'vitest'
import { db } from './db'
import { planMatches, setGlazePlan } from './glazePlan'
import { createPiece, softDelete } from './ops'
import { putBackPiece } from './putBack'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function pieceOf(id: string) {
  const piece = await db.pieces.get(id)
  if (!piece) throw new Error('Piece not found')
  return piece
}

test('setGlazePlan stores the layers in order and moves the piece up the shelf', async () => {
  const id = await createPiece({ name: 'Vase' })
  const before = (await pieceOf(id)).updatedAt
  const changed = await setGlazePlan(id, [
    { glazeId: 'g1', dips: 2 },
    { glazeId: 'g2', note: 'rim only' },
  ])
  const piece = await pieceOf(id)
  expect(changed).toBe(true)
  expect(piece.glazePlan).toEqual([
    { glazeId: 'g1', dips: 2 },
    { glazeId: 'g2', note: 'rim only' },
  ])
  expect(piece.updatedAt > before).toBe(true)
  expect(piece.dirty).toBe(1)
})

test('setGlazePlan with no layers removes the plan', async () => {
  const id = await createPiece({ name: 'Vase' })
  await setGlazePlan(id, [{ glazeId: 'g1' }])
  expect(await setGlazePlan(id, [])).toBe(true)
  expect(await db.pieces.get(id)).not.toHaveProperty('glazePlan')
})

test('setGlazePlan returns false and writes nothing when the plan is the same', async () => {
  const id = await createPiece({ name: 'Vase' })
  await setGlazePlan(id, [{ glazeId: 'g1', dips: 2 }])
  const stamp = (await pieceOf(id)).updatedAt
  expect(await setGlazePlan(id, [{ glazeId: 'g1', dips: 2 }])).toBe(false)
  expect((await pieceOf(id)).updatedAt).toBe(stamp)
})

test('setGlazePlan stores no undefined-valued keys', async () => {
  const id = await createPiece({ name: 'Vase' })
  await setGlazePlan(id, [{ glazeId: 'g1', dips: undefined }])
  expect(Object.keys((await pieceOf(id)).glazePlan?.[0] ?? {})).toEqual([
    'glazeId',
  ])
})

test('setGlazePlan joins the caller transaction', async () => {
  const id = await createPiece({ name: 'Vase' })
  await expect(
    db.transaction('rw', db.pieces, async () => {
      await setGlazePlan(id, [{ glazeId: 'g1' }])
      throw new Error('abort')
    }),
  ).rejects.toThrow('abort')
  expect((await db.pieces.get(id))?.glazePlan).toBeUndefined()
})

test('a deleted piece keeps its plan, and putting it back brings the plan back', async () => {
  const id = await createPiece({ name: 'Vase' })
  await setGlazePlan(id, [{ glazeId: 'g1' }])
  await softDelete('pieces', id)
  await putBackPiece(id)
  expect((await db.pieces.get(id))?.glazePlan).toEqual([{ glazeId: 'g1' }])
})

test('setGlazePlan leaves a deleted piece alone', async () => {
  const id = await createPiece({ name: 'Vase' })
  await softDelete('pieces', id)
  expect(await setGlazePlan(id, [{ glazeId: 'g1' }])).toBe(false)
  expect((await db.pieces.get(id))?.glazePlan).toBeUndefined()
})

describe('planMatches', () => {
  const plan = [
    { glazeId: 'g1', dips: 2, method: 'dip' as const },
    { glazeId: 'g2' },
  ]
  test('same glazes, order, dips and method match; notes are ignored', () => {
    expect(
      planMatches(plan, [
        { glazeId: 'g1', dips: 2, method: 'dip' },
        { glazeId: 'g2' },
      ]),
    ).toBe(true)
    expect(
      planMatches([{ glazeId: 'g1', note: 'a' }], [{ glazeId: 'g1' }]),
    ).toBe(true)
  })
  test('a different order, dip count, method or glaze is a change', () => {
    expect(
      planMatches(plan, [
        { glazeId: 'g2' },
        { glazeId: 'g1', dips: 2, method: 'dip' },
      ]),
    ).toBe(false)
    expect(
      planMatches(plan, [
        { glazeId: 'g1', dips: 3, method: 'dip' },
        { glazeId: 'g2' },
      ]),
    ).toBe(false)
    expect(
      planMatches(plan, [
        { glazeId: 'g1', dips: 2, method: 'brush' },
        { glazeId: 'g2' },
      ]),
    ).toBe(false)
    expect(planMatches(plan, [{ glazeId: 'g1', dips: 2, method: 'dip' }])).toBe(
      false,
    )
  })
  test('blank dips only match blank dips', () => {
    expect(planMatches([{ glazeId: 'g1' }], [{ glazeId: 'g1', dips: 1 }])).toBe(
      false,
    )
  })
})
