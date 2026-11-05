import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { addPieceWithPhoto, WEBKIT_BLOB_SKIP } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_BLOB_SKIP)

test('save a backup downloads a zip; restoring it into a fresh context brings the piece back', async ({
  page,
  browser,
}, testInfo) => {
  // Force the download path: with share available the save would open the share sheet.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined })
    Object.defineProperty(navigator, 'share', { value: undefined })
  })
  await addPieceWithPhoto(page, 'Backup Bowl')

  await page.getByRole('button', { name: 'Backup' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save a backup' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^glazette-\d{4}-\d{2}-\d{2}\.zip$/,
  )
  const zipPath = testInfo.outputPath('backup.zip')
  await download.saveAs(zipPath)
  expect(fs.statSync(zipPath).size).toBeGreaterThan(0)

  const fresh = await browser.newContext()
  try {
    const page2 = await fresh.newPage()
    await page2.goto('/')
    await expect(page2.getByRole('heading', { name: 'My Shelf' })).toBeVisible()
    await expect(page2.locator('article')).toHaveCount(0)

    await page2.getByRole('button', { name: 'Backup' }).click()
    await page2
      .locator('input[type="file"][accept*=".zip"]')
      .setInputFiles(zipPath)
    await expect(page2.getByText(/^Restored \d+ items?$/)).toBeVisible()
    await page2.getByRole('button', { name: 'Close' }).click()
    await expect(page2.locator('article')).toHaveCount(1)
    await expect(page2.getByText('Backup Bowl')).toBeVisible()
  } finally {
    await fresh.close()
  }
})
