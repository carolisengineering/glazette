import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Needs `pnpm build` first. Locally it skips when dist/ is absent; in CI (CI is set)
// a missing build is a failure, so the check can never be silently skipped there.
const dist = resolve(__dirname, '../../dist')

const built = existsSync(resolve(dist, 'sw.js'))

describe.skipIf(!built && !process.env.CI)('build output', () => {
  test('dist has been built', () => {
    expect(built, 'run `pnpm build` before this test').toBe(true)
  })

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
