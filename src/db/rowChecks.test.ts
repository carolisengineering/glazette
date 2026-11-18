import { expect, test } from 'vitest'
import { isGlazeRow, isPhotoRow, isPieceRow } from './rowChecks'

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

test('isGlazeRow rejects a non-string swatchPhotoId', () => {
  expect(isGlazeRow({ id: 'g', name: 'n' })).toBe(true)
  expect(isGlazeRow({ id: 'g', name: 'n', swatchPhotoId: 'p' })).toBe(true)
  expect(isGlazeRow({ id: 'g', name: 'n', swatchPhotoId: 3 })).toBe(false)
})

test('isPhotoRow rejects swatch other than 1', () => {
  const photo = {
    id: 'p',
    hash: 'a'.repeat(64),
    takenAt: 'x',
    width: 1,
    height: 1,
  }
  expect(isPhotoRow(photo)).toBe(true)
  expect(isPhotoRow({ ...photo, swatch: 1 })).toBe(true)
  expect(isPhotoRow({ ...photo, swatch: 2 })).toBe(false)
  expect(isPhotoRow({ ...photo, swatch: true })).toBe(false)
})
