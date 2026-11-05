import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type BrowserContext,
  test as base,
  devices,
  expect,
  type Page,
} from '@playwright/test'

interface Fixtures {
  /** Opens another isolated context that behaves like `context`, closed after the test. */
  newContext: () => Promise<BrowserContext>
}

/**
 * Playwright's ephemeral WebKit contexts reject Blobs in IndexedDB ("Error
 * preparing Blob/File data to be stored in object store"), which Safari itself
 * doesn't. WebKit therefore gets persistent contexts, each with its own temp
 * profile folder. Chromium uses ordinary contexts.
 */
export const test = base.extend<Fixtures>({
  newContext: async ({ browser, browserName, baseURL }, use) => {
    const opened: BrowserContext[] = []
    const dirs: string[] = []
    await use(async () => {
      let ctx: BrowserContext
      if (browserName === 'webkit') {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glazette-webkit-'))
        dirs.push(dir)
        // launchPersistentContext doesn't apply the project's device options.
        ctx = await browser.browserType().launchPersistentContext(dir, {
          ...devices['Desktop Safari'],
          baseURL,
        })
      } else {
        ctx = await browser.newContext({ baseURL })
      }
      opened.push(ctx)
      return ctx
    })
    for (const ctx of opened) await ctx.close()
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
  },
  context: async ({ newContext }, use) => {
    await use(await newContext())
  },
  page: async ({ context }, use) => {
    await use(await context.newPage())
  },
})

export { expect }

export interface StoredPhoto {
  hash: string
  size: number
  thumbSize: number
}

/** Reads every stored photo straight from IndexedDB, independent of the app's own code. */
export async function readPhotos(page: Page): Promise<StoredPhoto[]> {
  return page.evaluate(
    () =>
      new Promise<StoredPhoto[]>((resolve, reject) => {
        const open = indexedDB.open('glazette')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const all = open.result
            .transaction('photos')
            .objectStore('photos')
            .getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            open.result.close()
            resolve(
              all.result.map((p) => ({
                hash: p.hash,
                size: p.blob.size,
                thumbSize: p.thumb.size,
              })),
            )
          }
        }
      }),
  )
}

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
