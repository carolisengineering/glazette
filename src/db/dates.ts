export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const pad = (n: number): string => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' (local, four-digit year 1000 to 9999) to an ISO timestamp at local noon, so the day never shifts across time zones. Anything else, '' included, gives undefined. */
export function fromDateInput(value: string): string | undefined {
  const match = /^([1-9]\d{3})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const date = new Date(0)
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setHours(12, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** The local calendar day of an ISO timestamp as 'YYYY-MM-DD'; undefined gives ''. */
export function toDateInput(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
