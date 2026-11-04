import type { Piece, Stage, StageEntry } from './types'

export const STAGES = [
  'thrown',
  'trimmed',
  'bisqued',
  'glazed',
  'fired',
] as const satisfies readonly Stage[]

export const STAGE_LABEL: Record<Stage, string> = {
  thrown: 'Thrown',
  trimmed: 'Trimmed',
  bisqued: 'Bisqued',
  glazed: 'Glazed',
  fired: 'Fired',
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Latest non-deleted entry, optionally for one stage. A piece never moves
 * backward, so a later stage outranks an earlier one whatever their dates
 * (same-day entries and backdated library photos still advance the piece).
 * Within one stage the newest date wins.
 */
export function latestEntry(
  entries: StageEntry[],
  stage?: Stage,
): StageEntry | undefined {
  let latest: StageEntry | undefined
  for (const e of entries) {
    if (e.deletedAt || (stage && e.stage !== stage)) continue
    if (!latest || compareEntries(e, latest) >= 0) latest = e
  }
  return latest
}

/** Ascending rank of two entries: later stage first, then later date. Sort with (a, b) => compareEntries(b, a) for newest first. */
export function compareEntries(a: StageEntry, b: StageEntry): number {
  const byStage = STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)
  if (byStage !== 0) return byStage
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
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

/**
 * "Day N" for a piece: local calendar days since it was thrown, plus one, so
 * the day it was thrown is Day 1. Undefined when createdAt is not a valid date.
 */
export function dayCount(piece: Piece, now: Date): number | undefined {
  const created = new Date(piece.createdAt)
  if (Number.isNaN(created.getTime())) return undefined
  const start = new Date(
    created.getFullYear(),
    created.getMonth(),
    created.getDate(),
  )
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - start.getTime()) / DAY_MS)
  return Math.max(0, days) + 1
}
