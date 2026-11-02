import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    __glazette: {
      processImage: (file: File) => Promise<{ width: number; height: number }>
    }
  }
}

test('rotated portrait photo is stored upright', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles(
    'input[type=file]',
    'e2e/fixtures/portrait-rotated.jpg',
  )
  const size = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    const file = input?.files?.[0]
    if (!file) throw new Error('no file selected')
    const { width, height } = await window.__glazette.processImage(file)
    return { width, height }
  })
  expect(size.height).toBeGreaterThan(size.width)
})

test('HEIC rejection shows the unsupported-format message', async ({
  page,
}) => {
  await page.goto('/')
  await page.setInputFiles('input[type=file]', 'e2e/fixtures/sample.heic')
  const errorName = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    const file = input?.files?.[0]
    if (!file) throw new Error('no file selected')
    try {
      await window.__glazette.processImage(file)
      return null
    } catch (e) {
      return (e as Error).name
    }
  })
  expect(errorName).toBe('UnsupportedImageError')
})
