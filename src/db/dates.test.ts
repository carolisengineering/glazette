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

test('fromDateInput keeps years below 100 and ignores malformed input', () => {
  expect(new Date(fromDateInput('0050-03-04') as string).getFullYear()).toBe(50)
  expect(fromDateInput('nonsense')).toBeUndefined()
  expect(fromDateInput('2026-11')).toBeUndefined()
})
