import { execSync } from 'node:child_process'

/** Build date in Chicago time, a space, then the 7-character commit code. */
export function appVersion(date: Date, sha: string | undefined): string {
  const day = date.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  return `${day} ${sha ? sha.slice(0, 7) : 'dev'}`
}

/** The commit being built: GITHUB_SHA in CI, else the local checkout's HEAD. */
export function buildSha(): string | undefined {
  try {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
    const out = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || undefined
  } catch {
    return undefined
  }
}
