import {
  currentStage,
  dayCount,
  displayName,
  latestEntry,
  nextStage,
  STAGES,
} from './stage'
import type { Piece, StageEntry } from './types'

const entry = (
  id: string,
  stage: StageEntry['stage'],
  date: string,
  deletedAt?: string,
): StageEntry => ({
  id,
  pieceId: 'p1',
  stage,
  date,
  deletedAt,
})

const piece = (over: Partial<Piece> = {}): Piece => ({
  id: 'p1',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...over,
})

test('currentStage is the latest entry by date, ignoring deleted', () => {
  const entries = [
    entry('a', 'thrown', '2026-11-01'),
    entry('b', 'glazed', '2026-11-03', '2026-11-04'),
    entry('c', 'trimmed', '2026-11-02'),
  ]
  expect(currentStage(entries)).toBe('trimmed')
})

test('currentStage of no entries is undefined', () => {
  expect(currentStage([])).toBeUndefined()
  expect(
    currentStage([entry('a', 'thrown', '2026-11-01', 'x')]),
  ).toBeUndefined()
})

test('nextStage: thrown→trimmed … fired→undefined, undefined→thrown', () => {
  expect(STAGES).toEqual(['thrown', 'trimmed', 'bisqued', 'glazed', 'fired'])
  expect(nextStage(undefined)).toBe('thrown')
  expect(nextStage('thrown')).toBe('trimmed')
  expect(nextStage('trimmed')).toBe('bisqued')
  expect(nextStage('bisqued')).toBe('glazed')
  expect(nextStage('glazed')).toBe('fired')
  expect(nextStage('fired')).toBeUndefined()
})

test('latestEntry(entries, "glazed") returns the newest glazed entry', () => {
  const entries = [
    entry('a', 'glazed', '2026-11-02'),
    entry('b', 'glazed', '2026-11-05'),
    entry('c', 'fired', '2026-11-06'),
    entry('d', 'glazed', '2026-11-09', 'x'),
  ]
  expect(latestEntry(entries, 'glazed')?.id).toBe('b')
  expect(latestEntry(entries)?.id).toBe('c')
  expect(latestEntry([], 'glazed')).toBeUndefined()
})

test('displayName falls back to "Untitled bowl" / "Untitled piece"', () => {
  expect(displayName(piece({ name: '  Tea mug ' }))).toBe('Tea mug')
  expect(displayName(piece({ form: 'bowl' }))).toBe('Untitled bowl')
  expect(displayName(piece({ name: '   ', form: 'bowl' }))).toBe(
    'Untitled bowl',
  )
  expect(displayName(piece())).toBe('Untitled piece')
})

test('dayCount counts whole days since createdAt', () => {
  const p = piece({ createdAt: '2026-11-01T10:00:00.000Z' })
  expect(dayCount(p, new Date('2026-11-01T23:00:00.000Z'))).toBe(0)
  expect(dayCount(p, new Date('2026-11-04T09:00:00.000Z'))).toBe(2)
  expect(dayCount(p, new Date('2026-10-30T10:00:00.000Z'))).toBe(0)
})
