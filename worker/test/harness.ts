import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import type { Env } from '../env'

const root = resolve(__dirname, '../..')

export async function makeTestEnv(): Promise<{
  env: Env
  dispose(): Promise<void>
}> {
  // A fresh checkout has no dist/ until the first build, and the assets
  // directory named in wrangler.jsonc must exist for the proxy to start.
  mkdirSync(resolve(root, 'dist'), { recursive: true })
  const proxy = await getPlatformProxy<Env>({
    configPath: resolve(root, 'wrangler.jsonc'),
    persist: false,
  })
  const dir = resolve(root, 'migrations')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const f of files) {
    // D1 exec() runs one statement per line, so flatten each file first.
    const sql = readFileSync(resolve(dir, f), 'utf8')
    await proxy.env.DB.exec(sql.replace(/\s*\n\s*/g, ' '))
  }
  const env: Env = {
    ...proxy.env,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    BETTER_AUTH_URL: 'http://localhost',
  }
  return { env, dispose: () => proxy.dispose() }
}
