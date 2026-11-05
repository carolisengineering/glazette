import { expect, test } from '@playwright/test'
import { addPieceWithPhoto, WEBKIT_BLOB_SKIP } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_BLOB_SKIP)

test('a piece created with a photo survives a new page in the same context', async ({
  page,
  context,
}) => {
  await addPieceWithPhoto(page)
  await expect(page.locator('article')).toHaveCount(1)

  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByRole('heading', { name: 'My Shelf' })).toBeVisible()
  await expect(second.locator('article')).toHaveCount(1)
})
