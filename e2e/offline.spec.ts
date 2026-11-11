import { expect, test } from '@playwright/test'

// WebKit service workers are unreliable under Playwright.
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only')

test('app shell loads after going offline and reloading', async ({
  page,
  context,
}) => {
  // Telemetry must stay silent in e2e builds.
  const telemetryRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/t/')) telemetryRequests.push(req.url())
  })

  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // The first load may not be controlled yet; reload once so it is.
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My Shelf' })).toBeVisible()
  expect(telemetryRequests).toEqual([])
})
