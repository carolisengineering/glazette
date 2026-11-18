import { addPieceWithPhoto, expect, readPhotos, test } from './helpers'

test('set a swatch, see it while picking, then remove it', async ({ page }) => {
  await addPieceWithPhoto(page, 'Swatch test')
  await page.goto('/glazes')
  await page.getByRole('button', { name: 'Add glaze' }).click()
  const sheet = page.getByRole('dialog').first()
  await sheet.getByLabel('Name').fill('E2E Blue')
  await sheet.getByRole('button', { name: 'Add photo' }).click()
  await page
    .getByTestId('library-input')
    .setInputFiles('e2e/fixtures/second.jpg')

  const crop = page.getByRole('dialog', { name: 'Crop swatch' })
  await expect(crop).toBeVisible()
  const img = crop.locator('img').first()
  await expect(img).toBeVisible()
  const box = await img.boundingBox()
  if (!box) throw new Error('crop photo has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 20, y, { steps: 4 })
  await page.mouse.move(x - 40, y, { steps: 4 })
  await page.mouse.up()
  await crop.getByRole('button', { name: 'Use swatch' }).click()
  await expect(crop).toBeHidden()
  await page.getByRole('button', { name: 'Save' }).click()

  const tile = () => page.getByRole('button', { name: /E2E Blue/ }).first()
  await expect(tile().locator('img')).toBeVisible()
  await page.reload()
  await expect(tile().locator('img')).toBeVisible()

  // Log a Glazed photo and see the swatch while picking.
  await page.goto('/')
  await page
    .getByRole('link', { name: /Swatch test/ })
    .first()
    .click()
  await page.getByRole('link', { name: 'Add photo' }).click()
  await page
    .getByTestId('capture-input')
    .setInputFiles('e2e/fixtures/second.jpg')
  await page.getByRole('button', { name: 'Use photo' }).click()
  await page.getByRole('button', { name: /^Glazed/ }).click()
  const pick = page.getByRole('button', { name: 'E2E Blue' })
  await expect(pick.locator('img')).toBeVisible()
  await pick.click()
  await expect(page.getByTestId('picked-swatch').locator('img')).toBeVisible()

  // Remove the swatch; the color field comes back.
  await page.goto('/glazes')
  await page
    .getByRole('button', { name: /E2E Blue/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByLabel('Color')).toBeVisible()

  const swatches = (await readPhotos(page)).filter((p) => p.swatch === 1)
  expect(swatches).toHaveLength(1)
  expect(swatches[0].deletedAt).toBeTruthy()
})
