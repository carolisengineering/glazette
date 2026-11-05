// Renders the app icon PNGs from public/icons/icon.svg with Playwright's Chromium.
// Run once with `pnpm icons` and commit the output. Builds don't run it.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = join(root, 'public', 'icons')
const source = readFileSync(join(iconsDir, 'icon.svg'), 'utf8')

// Same icon with the vase scaled to 80% so it stays inside the maskable safe zone.
const maskable = source.replace(
  /<path /,
  '<path transform="translate(10 10) scale(0.8)" ',
)

const targets = [
  { file: 'apple-touch-icon.png', size: 180, svg: source },
  { file: 'icon-192.png', size: 192, svg: source },
  { file: 'icon-512.png', size: 512, svg: source },
  { file: 'icon-maskable-512.png', size: 512, svg: maskable },
]

const browser = await chromium.launch()
try {
  for (const { file, size, svg } of targets) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
    })
    const inner = svg.replace('<svg ', `<svg width="${size}" height="${size}" `)
    await page.setContent(
      `<!doctype html><body style="margin:0;background:#175474">${inner}</body>`,
    )
    await page.screenshot({
      path: join(iconsDir, file),
      omitBackground: false,
      clip: { x: 0, y: 0, width: size, height: size },
    })
    await page.close()
    console.log(`wrote ${file}`)
  }
} finally {
  await browser.close()
}
