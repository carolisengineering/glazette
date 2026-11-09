import type { Transaction } from 'dexie'
import { newId } from './db'
import { DEFAULT_SETTINGS } from './seed'
import { missingStages } from './stage'
import type { Piece, Settings, StageEntry } from './types'

/**
 * Version 2 upgrade: give every live piece an undated, photo-less step for
 * each earlier stage it has no step for. Only adds rows; never edits or
 * deletes. A stage whose step was deleted counts as having one, so it is not
 * brought back.
 */
export async function fillSkippedStages(tx: Transaction): Promise<void> {
  const pieces = await tx.table<Piece, string>('pieces').toArray()
  const entries = await tx.table<StageEntry, string>('entries').toArray()
  const byPiece = new Map<string, StageEntry[]>()
  for (const e of entries) {
    const list = byPiece.get(e.pieceId)
    if (list) list.push(e)
    else byPiece.set(e.pieceId, [e])
  }
  const added: StageEntry[] = []
  for (const p of pieces) {
    if (p.deletedAt) continue
    for (const stage of missingStages(byPiece.get(p.id) ?? [])) {
      added.push({ id: newId(), pieceId: p.id, stage })
    }
  }
  if (added.length > 0) await tx.table('entries').bulkAdd(added)
}

/**
 * Version 4 upgrade: forget where the last sync stood, so the first sync after
 * updating is a full one. It uploads the photos this device already holds and
 * fetches any record an older version skipped. Photos that were stored before
 * stay undated, so they count as unchanged since 1970 unless deleted.
 */
export async function forgetLastSync(tx: Transaction): Promise<void> {
  await tx.table('syncState').clear()
}

/** The synced settings that ensureDefaults sets; device-only ones don't count. */
const SETTINGS_COMPARED = [
  'defaultCone',
  'bisqueNote',
  'firedNote',
  'studioName',
] as const

/**
 * Version 3 upgrade: give rows changed before sync a change time, so the first
 * sync doesn't let an untouched copy on another device win. Steps and layers
 * without one take their piece's updatedAt (every step and layer change bumps
 * it, so it's an upper bound); one whose piece is missing stays undated.
 * Settings that differ from the defaults take the upgrade time; untouched
 * defaults stay undated, so they always lose to real settings. Glazes and
 * clays stay as they are. Each write gives its own updatedAt, which the
 * change tracking keeps.
 */
export async function dateOldRows(tx: Transaction): Promise<void> {
  const pieceTimes = new Map<string, string>()
  await tx
    .table<Piece, string>('pieces')
    .each((p) => pieceTimes.set(p.id, p.updatedAt))
  for (const name of ['entries', 'glazeApps']) {
    await tx
      .table<{ pieceId: string; updatedAt?: string }, string>(name)
      .filter(
        (row) => row.updatedAt === undefined && pieceTimes.has(row.pieceId),
      )
      .modify((row) => {
        row.updatedAt = pieceTimes.get(row.pieceId)
      })
  }
  const defaults: Partial<Settings> = DEFAULT_SETTINGS
  const now = new Date().toISOString()
  await tx
    .table<Settings, string>('settings')
    .filter(
      (s) =>
        s.updatedAt === undefined &&
        SETTINGS_COMPARED.some((k) => s[k] !== defaults[k]),
    )
    .modify({ updatedAt: now })
}
