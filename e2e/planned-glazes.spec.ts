import { addPieceWithPhoto, expect, test } from './helpers'

test('plan glazes, log Glazed from the plan, and see it matched', async ({
  page,
}) => {
  await addPieceWithPhoto(page, 'Plan test')
  await page
    .getByRole('link', { name: /Plan test/ })
    .first()
    .click()

  await page.getByRole('button', { name: '+ Plan glazes' }).click()
  const sheet = page.getByRole('dialog', { name: 'Glaze plan' })
  await sheet.getByLabel('Glaze 1', { exact: true }).fill('E2E Celadon')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()

  const plan = page.getByRole('list', { name: 'Glaze plan' })
  await expect(plan).toContainText('E2E Celadon')
  await page.reload()
  await expect(plan).toContainText('E2E Celadon')

  // Add a new photo for the piece and pick Glazed in the strip.
  await page.getByRole('link', { name: 'Add photo' }).click()
  await page
    .getByTestId('capture-input')
    .setInputFiles('e2e/fixtures/second.jpg')
  await page.getByRole('button', { name: 'Use photo' }).click()
  await page.getByRole('button', { name: /^Glazed/ }).click()
  await expect(
    page.getByText(
      'Filled in from your plan. Change anything you did differently.',
    ),
  ).toBeVisible()
  await expect(page.getByLabel('Glaze 1', { exact: true })).toHaveValue(
    'E2E Celadon',
  )
  await page.getByRole('button', { name: /^Save to Glazed/ }).click()

  await expect(page.getByRole('heading', { name: 'Plan test' })).toBeVisible()
  await expect(page.getByText('Same as plan')).toBeVisible()
})
