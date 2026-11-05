import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const html = readFileSync(join(root, 'index.html'), 'utf8')

describe('index.html head', () => {
  it.each([
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
    '<meta name="theme-color" content="#EEF1F4" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-title" content="Glazette" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
  ])('contains %s', (tag) => {
    expect(html).toContain(tag)
  })

  it('references icon files that exist under public', () => {
    const hrefs = [...html.matchAll(/<link[^>]*href="([^"]+)"/g)].map(
      (m) => m[1],
    )
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(existsSync(join(root, 'public', href)), href).toBe(true)
    }
  })

  it('ships every icon the manifest will use', () => {
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
      expect(existsSync(join(root, 'public', 'icons', f)), f).toBe(true)
    }
  })
})
