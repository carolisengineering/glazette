import { renderHook, waitFor } from '@testing-library/react'
import { db } from '../db/db'
import { quietly } from './track'
import { countWaiting, usePhotosWaiting } from './useWaiting'

const photo = (id: string, extra = {}) => ({
  id,
  hash: id,
  width: 1,
  height: 1,
  takenAt: '2026-11-08T00:00:00.000Z',
  ...extra,
})

beforeEach(async () => {
  await quietly(db, async () => {
    await db.photos.clear()
    await db.glazes.clear()
  })
})

test('usePhotosWaiting is 0 at first and counts photos waiting to upload', async () => {
  await quietly(db, () =>
    db.photos.bulkPut([
      photo('a', { needsUpload: 1 }),
      photo('b', { needsUpload: 1 }),
      photo('c'),
    ]),
  )
  const { result } = renderHook(() => usePhotosWaiting())
  expect(result.current).toBe(0)
  await waitFor(() => expect(result.current).toBe(2))
})

test('countWaiting counts waiting photos and dirty rows in every synced table', async () => {
  await quietly(db, async () => {
    await db.photos.bulkPut([
      photo('a', { needsUpload: 1 }),
      photo('b'),
      photo('d', { dirty: 1 }),
    ])
    await db.glazes.put({ id: 'g', name: 'Celadon', dirty: 1 } as never)
  })
  expect(await countWaiting(db)).toEqual({ photos: 1, changes: 2 })
})

test('countWaiting is zero when nothing waits', async () => {
  expect(await countWaiting(db)).toEqual({ photos: 0, changes: 0 })
})
