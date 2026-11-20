import type { Page } from '@playwright/test'
import { addPieceWithPhoto, expect, test } from './helpers'

/** Open a piece from the shelf and add a photo, ready to pick a stage. */
async function addPhotoTo(page: Page, name: string) {
  await page.goto('/')
  await page
    .getByRole('link', { name: new RegExp(name) })
    .first()
    .click()
  await page.getByRole('link', { name: 'Add photo' }).click()
  await page
    .getByTestId('capture-input')
    .setInputFiles('e2e/fixtures/second.jpg')
  await page.getByRole('button', { name: 'Use photo' }).click()
}

test("repeat a past piece's glazes", async ({ page }) => {
  // Soup bowl: glazed with two glazes and their details, then fired.
  await addPieceWithPhoto(page, 'Soup bowl')
  await addPhotoTo(page, 'Soup bowl')
  await page.getByRole('button', { name: /^Glazed/ }).click()
  await page.getByLabel('Glaze 1', { exact: true }).fill('E2E Celadon')
  await page.getByLabel('Dips for glaze 1').fill('2')
  await page.getByLabel('Method for glaze 1').selectOption('dip')
  await page.getByRole('button', { name: '+ add another glaze' }).click()
  await page.getByLabel('Glaze 2', { exact: true }).fill('E2E Tenmoku')
  await page.getByLabel('Note for glaze 2').fill('thin at rim')
  await page.getByRole('button', { name: /^Save to Glazed/ }).click()
  await expect(page.getByRole('heading', { name: 'Soup bowl' })).toBeVisible()

  await addPhotoTo(page, 'Soup bowl')
  await page.getByRole('button', { name: /^Fired/ }).click()
  await page.getByRole('button', { name: /^Save to Fired/ }).click()
  await expect(page.getByRole('heading', { name: 'Soup bowl' })).toBeVisible()

  // Tall mug: copy the soup bowl's recipe while logging it as Glazed.
  await addPieceWithPhoto(page, 'Tall mug')
  await addPhotoTo(page, 'Tall mug')
  await page.getByRole('button', { name: /^Glazed/ }).click()
  await page.getByRole('button', { name: 'From a past piece' }).click()
  const sheet = page.getByRole('dialog', { name: 'Past pieces' })
  await sheet.getByRole('button', { name: 'E2E Celadon', exact: true }).click()
  await sheet
    .getByRole('button', { name: 'Soup bowl: E2E Celadon over E2E Tenmoku' })
    .click()
  const card = page.getByRole('dialog', { name: 'Soup bowl' })
  await card.getByRole('button', { name: 'Use these glazes' }).click()
  await expect(card).toBeHidden()
  await expect(sheet).toBeHidden()

  await expect(page.getByLabel('Glaze 1', { exact: true })).toHaveValue(
    'E2E Celadon',
  )
  await expect(page.getByLabel('Dips for glaze 1')).toHaveValue('2')
  await expect(page.getByLabel('Method for glaze 1')).toHaveValue('dip')
  await expect(page.getByLabel('Glaze 2', { exact: true })).toHaveValue(
    'E2E Tenmoku',
  )
  await expect(page.getByLabel('Note for glaze 2')).toHaveValue('thin at rim')
})
