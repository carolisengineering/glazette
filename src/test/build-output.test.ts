import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Needs `pnpm build` first; skipped when dist/ is absent so `pnpm test` works on a fresh clone.
const dist = resolve(__dirname, '../../dist')

describe.skipIf(!existsSync(resolve(dist, 'sw.js')))('build output', () => {
  test('ships a service worker, manifest and cache headers', () => {
    expect(readFileSync(resolve(dist, '_headers'), 'utf8')).toContain('/sw.js')
    const manifest = JSON.parse(
      readFileSync(resolve(dist, 'manifest.webmanifest'), 'utf8'),
    )
    expect(manifest.name).toBe('Glazette')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    )
    expect(
      manifest.icons.some(
        (i: { purpose?: string }) => i.purpose === 'maskable',
      ),
    ).toBe(true)
  })

  test('precaches the fonts', () => {
    expect(readFileSync(resolve(dist, 'sw.js'), 'utf8')).toMatch(/\.woff2/)
  })
})
