import { addPieceWithPhoto, expect, test } from './helpers'

test('add combos from a tile photo, then fill a piece glazes from one', async ({
  page,
}) => {
  await addPieceWithPhoto(page, 'Combo test')
  await page.goto('/glazes')
  for (const name of ['E2E Tenmoku', 'E2E Celadon']) {
    await page.getByRole('button', { name: 'Add glaze' }).click()
    const sheet = page.getByRole('dialog').first()
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(sheet).toBeHidden()
  }

  await page.getByRole('button', { name: 'Combos', exact: true }).click()
  await page.getByRole('button', { name: 'Add combos' }).first().click()
  await page.getByRole('button', { name: /Test tile photo/ }).click()
  await page
    .getByTestId('library-input')
    .setInputFiles('e2e/fixtures/second.jpg')

  await page.getByRole('button', { name: 'E2E Tenmoku' }).click()
  const crop = page.getByRole('dialog', { name: 'Crop swatch' })
  await expect(crop).toBeVisible()
  await crop.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'E2E Celadon' }).click()
  await expect(crop).toBeVisible()
  await crop.getByRole('button', { name: 'Done' }).click()
  await expect(crop).toBeHidden()

  const tileName = 'E2E Celadon over E2E Tenmoku'
  const strip = page.getByRole('heading', {
    name: 'Over E2E Tenmoku',
    exact: true,
  })
  await expect(strip).toBeVisible()
  const tile = page.getByRole('button', { name: tileName })
  await expect(tile).toBeVisible()
  await expect
    .poll(() =>
      tile.locator('img').evaluate((e) => (e as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)

  // Fill a piece's glaze rows from the combo.
  await page.goto('/')
  await page
    .getByRole('link', { name: /Combo test/ })
    .first()
    .click()
  await page.getByRole('link', { name: 'Add photo' }).click()
  await page
    .getByTestId('capture-input')
    .setInputFiles('e2e/fixtures/second.jpg')
  await page.getByRole('button', { name: 'Use photo' }).click()
  await page.getByRole('button', { name: /^Glazed/ }).click()
  await page.getByRole('button', { name: 'Browse combos' }).click()
  const browse = page.getByRole('dialog', { name: 'Combos' })
  await browse.getByRole('button', { name: tileName }).click()
  await expect(browse).toBeHidden()
  await expect(page.getByLabel('Glaze 1', { exact: true })).toHaveValue(
    'E2E Celadon',
  )
  await expect(page.getByLabel('Glaze 2', { exact: true })).toHaveValue(
    'E2E Tenmoku',
  )
})
