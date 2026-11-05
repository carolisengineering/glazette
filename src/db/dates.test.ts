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
