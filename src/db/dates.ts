export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const pad = (n: number): string => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' (local) to an ISO timestamp at local noon, so the day never shifts across time zones. '' gives undefined. */
export function fromDateInput(value: string): string | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toISOString()
}

/** The local calendar day of an ISO timestamp as 'YYYY-MM-DD'; undefined gives ''. */
export function toDateInput(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
