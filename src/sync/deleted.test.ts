import type { Photo, Piece } from '../db/types'
import { daysLeftLabel, deletedRows } from './deleted'

const HEARD = '2026-01-01T00:00:00.000Z'
const after = (ms: number) => new Date(Date.parse(HEARD) + ms)
const HOUR = 3_600_000
const DAY = 24 * HOUR

test('days left counts from when the server heard', () => {
  expect(daysLeftLabel(HEARD, after(DAY))).toBe('29 days left')
  expect(daysLeftLabel(HEARD, after(27 * DAY + 12 * HOUR))).toBe('2 days left')
  expect(daysLeftLabel(HEARD, after(29 * DAY))).toBe('1 day left')
  expect(daysLeftLabel(HEARD, after(29 * DAY + HOUR))).toBe(
    'Less than a day left',
  )
  expect(daysLeftLabel(HEARD, after(31 * DAY))).toBe('Less than a day left')
})

const T = '2026-01-02T00:00:00.000Z'
const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  createdAt: T,
  updatedAt: T,
  ...extra,
})
const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  hash: 'a'.repeat(64),
  width: 1,
  height: 1,
  takenAt: T,
  ...extra,
})
const map = <V extends { id: string }>(rows: V[]) =>
  new Map(rows.map((r) => [r.id, r]))

test('only rows still deleted here are listed', () => {
  const pieces = map([
    piece('gone', { deletedAt: T }),
    piece('live'),
    piece('stub', { deletedAt: T, purgedAt: T }),
  ])
  const photos = map([
    photo('p-gone', { deletedAt: T }),
    photo('p-live'),
    photo('p-stub', { deletedAt: T, purgedAt: T }),
    photo('p-merged', { deletedAt: T, mergedInto: 'p-gone' }),
  ])
  const item = (kind: 'piece' | 'photo', id: string) => ({
    kind,
    id,
    heardAt: HEARD,
  })
  const rows = deletedRows(
    [
      item('piece', 'gone'),
      item('piece', 'live'),
      item('piece', 'stub'),
      item('piece', 'unknown'),
      item('photo', 'p-gone'),
      item('photo', 'p-live'),
      item('photo', 'p-stub'),
      item('photo', 'p-merged'),
      item('photo', 'p-unknown'),
    ],
    pieces,
    photos,
  )
  expect(
    rows.map((r) => (r.kind === 'piece' ? r.piece.id : r.photo.id)),
  ).toEqual(['gone', 'p-gone'])
})

test('a photo row carries its piece', () => {
  const pieces = map([piece('p1')])
  const photos = map([
    photo('known', { deletedAt: T, lastPieceId: 'p1' }),
    photo('unknown', { deletedAt: T, lastPieceId: 'nope' }),
  ])
  const rows = deletedRows(
    [
      { kind: 'photo', id: 'known', heardAt: HEARD },
      { kind: 'photo', id: 'unknown', heardAt: HEARD },
    ],
    pieces,
    photos,
  )
  expect(rows[0]).toMatchObject({ kind: 'photo', piece: { id: 'p1' } })
  expect(rows[1]).toMatchObject({ kind: 'photo' })
  expect(
    rows[1] && 'piece' in rows[1] ? rows[1].piece : undefined,
  ).toBeUndefined()
})

test("a photo whose piece was purged doesn't name it", () => {
  const pieces = map([
    piece('stub', { name: 'Blue mug', deletedAt: T, purgedAt: T }),
  ])
  const photos = map([photo('ph', { deletedAt: T, lastPieceId: 'stub' })])
  const [row] = deletedRows(
    [{ kind: 'photo', id: 'ph', heardAt: HEARD }],
    pieces,
    photos,
  )
  expect(row).toMatchObject({ kind: 'photo', photo: { id: 'ph' } })
  expect(row && 'piece' in row ? row.piece : undefined).toBeUndefined()
})
