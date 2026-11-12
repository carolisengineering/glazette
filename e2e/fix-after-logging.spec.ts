import type { Page } from '@playwright/test'
import { addPieceWithPhoto, expect, test } from './helpers'

/** A fingerprint of the bytes the top photo shows, stable across object URLs. */
async function heroDigest(page: Page, name: string): Promise<string | null> {
  const img = page.getByRole('img', { name: new RegExp(`^${name}`) })
  await expect(img).toHaveAttribute('src', /^blob:/)
  // The object URL can be swapped out mid-read; null means "try again".
  return img.evaluate(async (el: Element) => {
    try {
      const res = await fetch((el as HTMLImageElement).src)
      const buf = await crypto.subtle.digest('SHA-256', await res.arrayBuffer())
      return Array.from(new Uint8Array(buf), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
    } catch {
      return null
    }
  })
}

test("swap a step's photo and undo it", async ({ page }) => {
  await addPieceWithPhoto(page, 'Swap test')
  await page
    .getByRole('link', { name: /Swap test/ })
    .first()
    .click()
  let before: string | null = null
  await expect
    .poll(async () => (before = await heroDigest(page, 'Swap test')))
    .not.toBeNull()

  await page.getByRole('button', { name: 'Edit step' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByTestId('library-input')
    .setInputFiles('e2e/fixtures/second.jpg')
  await dialog.getByRole('button', { name: 'Save' }).click()

  const toast = page.getByText('Photo changed')
  await expect(toast).toBeVisible()
  await expect
    .poll(async () => {
      const now = await heroDigest(page, 'Swap test')
      return now !== null && now !== before
    })
    .toBe(true)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => heroDigest(page, 'Swap test')).toBe(before)
  await expect(toast).toBeHidden()
})

test('a note saved from Edit step shows in the journey', async ({ page }) => {
  await addPieceWithPhoto(page, 'Note test')
  await page
    .getByRole('link', { name: /Note test/ })
    .first()
    .click()

  await page.getByRole('button', { name: 'Edit step' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Note').fill('Dipped twice')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByText('Dipped twice')).toBeVisible()
})
