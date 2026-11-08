import { lastSyncedLabel } from './label'

const now = new Date(2026, 10, 7, 9, 41, 30)

test('never synced and idle', () => {
  expect(lastSyncedLabel(undefined, false, now)).toBe('Not synced yet')
})

test('never synced and syncing', () => {
  expect(lastSyncedLabel(undefined, true, now)).toBe('Syncing…')
})

test('30 seconds ago', () => {
  const at = new Date(now.getTime() - 30_000).toISOString()
  expect(lastSyncedLabel(at, false, now)).toBe('Last synced just now')
})

test('earlier today', () => {
  const at = new Date(2026, 10, 7, 7, 5).toISOString()
  expect(lastSyncedLabel(at, false, now)).toBe('Last synced today at 7:05 AM')
})

test('yesterday', () => {
  const at = new Date(2026, 10, 6, 21, 41).toISOString()
  expect(lastSyncedLabel(at, false, now)).toBe('Last synced Nov 6 at 9:41 PM')
})

test('a sync in progress still shows the last time', () => {
  const at = new Date(2026, 10, 6, 9, 41).toISOString()
  expect(lastSyncedLabel(at, true, now)).toBe('Last synced Nov 6 at 9:41 AM')
})
