import { clampTakenAt } from './process'

const now = new Date('2026-11-02T12:00:00.000Z')

test('clampTakenAt keeps a past EXIF date', () => {
  const past = new Date('2026-10-01T08:30:00.000Z')
  expect(clampTakenAt(past, now)).toBe('2026-10-01T08:30:00.000Z')
})

test('clampTakenAt falls back to now for a future EXIF date', () => {
  const future = new Date('2030-01-01T00:00:00.000Z')
  expect(clampTakenAt(future, now)).toBe('2026-11-02T12:00:00.000Z')
})
