import { expect, type Page } from '@playwright/test'

/**
 * Playwright's WebKit uses ephemeral storage, where IndexedDB rejects Blob values
 * ("Error preparing Blob/File data to be stored in object store"). Specs that
 * store photos skip WebKit for that reason; real Safari is unaffected.
 */
export const WEBKIT_BLOB_SKIP =
  'Playwright WebKit cannot store Blobs in IndexedDB'

/** Walks the capture flow with a fixture photo and lands on the shelf with one new piece. */
export async function addPieceWithPhoto(
  page: Page,
  name?: string,
): Promise<void> {
  await page.goto('/capture')
  await page
    .getByTestId('capture-input')
    .setInputFiles('e2e/fixtures/portrait-rotated.jpg')
  await page.getByRole('button', { name: 'New piece' }).click()
  await page.getByRole('button', { name: 'Use photo' }).click()
  if (name) await page.getByLabel('Name').fill(name)
  const done = page.getByRole('button', { name: 'Done' })
  await expect(done).toBeEnabled()
  await done.click()
  await expect(page.getByRole('heading', { name: 'My Shelf' })).toBeVisible()
}
