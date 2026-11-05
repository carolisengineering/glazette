import { addPieceWithPhoto, expect, readPhotos, test } from './helpers'

test('a piece created with a photo survives a new page in the same context', async ({
  page,
  context,
}) => {
  await addPieceWithPhoto(page)
  await expect(page.locator('article')).toHaveCount(1)
  const before = await readPhotos(page)
  expect(before).toHaveLength(1)

  // Close the first page so only stored data can bring the piece back.
  await page.close()
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByRole('heading', { name: 'My Shelf' })).toBeVisible()
  await expect(second.locator('article')).toHaveCount(1)
  await expect(second.locator('article img')).toBeVisible()
  expect(await readPhotos(second)).toEqual(before)
})
