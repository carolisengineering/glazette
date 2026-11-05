import type { Transaction } from 'dexie'
import { newId } from './db'
import { missingStages } from './stage'
import type { Piece, StageEntry } from './types'

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
