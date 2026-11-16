import { expect, test } from 'vitest'
import { isPieceRow } from './rowChecks'

const piece = { id: 'p', createdAt: 'x', updatedAt: 'x' }

test('a piece row may carry a well-formed glaze plan', () => {
  expect(isPieceRow(piece)).toBe(true)
  expect(
    isPieceRow({
      ...piece,
      glazePlan: [{ glazeId: 'g', dips: 2, method: 'dip', note: 'n' }],
    }),
  ).toBe(true)
})

test('a piece row with a malformed glaze plan is rejected', () => {
  for (const glazePlan of [
    'g',
    [{}],
    [{ glazeId: 3 }],
    [{ glazeId: 'g', dips: '2' }],
    [{ glazeId: 'g', note: 1 }],
    [null],
  ]) {
    expect(isPieceRow({ ...piece, glazePlan })).toBe(false)
  }
})

test('a planned layer whose dips came back null (an infinite value in JSON) still reads', () => {
  expect(
    isPieceRow({ ...piece, glazePlan: [{ glazeId: 'g', dips: null }] }),
  ).toBe(true)
})
