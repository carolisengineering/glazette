import { expect, test } from 'vitest'
import { appVersion } from './app-version.ts'

test('appVersion uses the Chicago date and the 7-character commit', () => {
  // 03:00 UTC on Nov 13 is still Nov 12 in Chicago.
  expect(appVersion(new Date('2026-11-13T03:00:00Z'), '5c69b37abcdef')).toBe(
    '2026-11-12 5c69b37',
  )
})

test('appVersion falls back to dev without a commit', () => {
  expect(appVersion(new Date('2026-11-12T18:00:00Z'), undefined)).toBe(
    '2026-11-12 dev',
  )
})
