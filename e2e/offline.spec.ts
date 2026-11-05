import { expect, test } from '@playwright/test'

// WebKit service workers are unreliable under Playwright.
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only')

test('app shell loads after going offline and reloading', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // The first load may not be controlled yet; reload once so it is.
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My Shelf' })).toBeVisible()
})
