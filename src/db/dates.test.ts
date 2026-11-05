import { fromDateInput, shortDate, toDateInput } from './dates'

test('fromDateInput keeps the calendar day in local time', () => {
  expect(shortDate(fromDateInput('2026-11-03') as string)).toBe('Nov 3')
  expect(toDateInput(fromDateInput('2026-11-03'))).toBe('2026-11-03')
  expect(fromDateInput('')).toBeUndefined()
  expect(toDateInput(undefined)).toBe('')
})

test('fromDateInput stores local noon', () => {
  expect(new Date(fromDateInput('2026-11-03') as string).getHours()).toBe(12)
})

test('fromDateInput ignores malformed input', () => {
  expect(fromDateInput('nonsense')).toBeUndefined()
  expect(fromDateInput('2026-11')).toBeUndefined()
})

test('fromDateInput accepts only four-digit years from 1000 to 9999', () => {
  expect(fromDateInput('0202-01-01')).toBeUndefined()
  expect(fromDateInput('0050-03-04')).toBeUndefined()
  expect(fromDateInput('20260-01-01')).toBeUndefined()
  expect(fromDateInput('1000-01-01')).toBeDefined()
  expect(new Date(fromDateInput('2026-11-03') as string).getHours()).toBe(12)
})
