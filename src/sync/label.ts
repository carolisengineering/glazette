const JUST_NOW_MS = 60_000

/** Plain-space time such as "9:41 AM". Node's ICU puts U+202F before AM/PM. */
function timeOf(date: Date): string {
  return date
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/\s/g, ' ')
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** The Account sheet's line about when this device last synced with the account. */
export function lastSyncedLabel(
  lastSyncedAt: string | undefined,
  syncing: boolean,
  now: Date,
): string {
  const at = lastSyncedAt ? new Date(lastSyncedAt) : undefined
  if (!at || Number.isNaN(at.getTime())) {
    return syncing ? 'Syncing…' : 'Not synced yet'
  }
  if (now.getTime() - at.getTime() < JUST_NOW_MS) return 'Last synced just now'
  if (sameDay(at, now)) return `Last synced today at ${timeOf(at)}`
  const day = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Last synced ${day} at ${timeOf(at)}`
}
