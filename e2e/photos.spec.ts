import fs from 'node:fs'
import { expect, type Page, test } from '@playwright/test'

interface Fixture {
  b64: string
  name: string
  type: string
}

const fixture = (path: string, name: string, type: string): Fixture => ({
  b64: fs.readFileSync(path).toString('base64'),
  name,
  type,
})

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.__glazette !== undefined)
}

test('rotated portrait photo is stored upright', async ({ page }) => {
  await openApp(page)
  const file = fixture(
    'e2e/fixtures/portrait-rotated.jpg',
    'portrait-rotated.jpg',
    'image/jpeg',
  )
  const result = await page.evaluate(async ({ b64, name, type }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const make = () => new File([bytes], name, { type })
    const first = await window.__glazette.processImage(make())
    const second = await window.__glazette.processImage(make())
    return {
      width: first.width,
      height: first.height,
      sameHash: first.hash === second.hash,
    }
  }, file)
  expect(result.height).toBeGreaterThan(result.width)
  expect(result.sameHash).toBe(true)
})

test('HEIC rejection throws UnsupportedImageError', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit on macOS may decode HEIC')
  await openApp(page)
  const file = fixture('e2e/fixtures/sample.heic', 'sample.heic', 'image/heic')
  const errorName = await page.evaluate(async ({ b64, name, type }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    try {
      await window.__glazette.processImage(new File([bytes], name, { type }))
      return null
    } catch (e) {
      return (e as Error).name
    }
  }, file)
  expect(errorName).toBe('UnsupportedImageError')
})
