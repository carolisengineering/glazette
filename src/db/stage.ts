import type { Piece, Stage, StageEntry } from './types'

export const STAGES = [
  'thrown',
  'trimmed',
  'bisqued',
  'glazed',
  'fired',
] as const satisfies readonly Stage[]

const DAY_MS = 24 * 60 * 60 * 1000

/** Latest non-deleted entry by date (ties: later array position wins), optionally for one stage. */
export function latestEntry(
  entries: StageEntry[],
  stage?: Stage,
): StageEntry | undefined {
  let latest: StageEntry | undefined
  for (const e of entries) {
    if (e.deletedAt || (stage && e.stage !== stage)) continue
    if (!latest || e.date >= latest.date) latest = e
  }
  return latest
}

export function currentStage(entries: StageEntry[]): Stage | undefined {
  return latestEntry(entries)?.stage
}

export function nextStage(stage: Stage | undefined): Stage | undefined {
  if (!stage) return STAGES[0]
  return STAGES[STAGES.indexOf(stage) + 1]
}

export function displayName(piece: Piece): string {
  const name = piece.name?.trim()
  if (name) return name
  return piece.form ? `Untitled ${piece.form}` : 'Untitled piece'
}

/** Whole days since creation, floored, never negative. */
export function dayCount(piece: Piece, now: Date): number {
  const days = Math.floor(
    (now.getTime() - new Date(piece.createdAt).getTime()) / DAY_MS,
  )
  return Math.max(0, days)
}
