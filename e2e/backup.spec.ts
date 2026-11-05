import fs from 'node:fs'
import { unzipSync } from 'fflate'
import { addPieceWithPhoto, expect, readPhotos, test } from './helpers'

test('save a backup downloads a zip; restoring it into a fresh context brings the piece back', async ({
  page,
  newContext,
}, testInfo) => {
  // Force the download path: with share available the save would open the share sheet.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined })
    Object.defineProperty(navigator, 'share', { value: undefined })
  })
  await addPieceWithPhoto(page, 'Backup Bowl')
  const original = await readPhotos(page)
  expect(original).toHaveLength(1)
  expect(original[0].size).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Backup' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save a backup' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^glazette-\d{4}-\d{2}-\d{2}\.zip$/,
  )
  const zipPath = testInfo.outputPath('backup.zip')
  await download.saveAs(zipPath)
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))
  const photoEntry = entries[`photos/${original[0].hash}.jpg`]
  expect(photoEntry?.length).toBe(original[0].size)

  const fresh = await newContext()
  const page2 = await fresh.newPage()
  await page2.goto('/')
  await expect(page2.getByRole('heading', { name: 'My Shelf' })).toBeVisible()
  await expect(page2.locator('article')).toHaveCount(0)

  await page2.getByRole('button', { name: 'Backup' }).click()
  await page2
    .locator('input[type="file"][accept*=".zip"]')
    .setInputFiles(zipPath)
  await expect(page2.getByText(/^Restored \d+ pieces?$/)).toBeVisible()
  await page2.getByRole('button', { name: 'Close' }).click()
  await expect(page2.locator('article')).toHaveCount(1)
  await expect(page2.getByText('Backup Bowl')).toBeVisible()

  // The photo itself came back, not just the piece.
  const img = page2.locator('article img')
  await expect(img).toBeVisible()
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0)
  expect(await readPhotos(page2)).toEqual(original)
})
