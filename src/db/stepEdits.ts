import { db, newId } from './db'
import type { GlazeInput } from './ops'
import type { GlazeApplication } from './types'

const nowIso = (): string => new Date().toISOString()

/**
 * Makes a Glazed step's live glazes equal `glazes`, in order. Row i updates the
 * i-th live layer in place (writing only changed fields); extra layers are
 * soft-deleted and extra inputs added. Returns whether anything changed.
 */
export async function setStepGlazes(
  entryId: string,
  glazes: GlazeInput,
): Promise<boolean> {
  return db.transaction('rw', db.entries, db.glazeApps, db.pieces, async () => {
    const entry = await db.entries.get(entryId)
    if (!entry || entry.deletedAt || entry.stage !== 'glazed') {
      throw new Error('Step not found')
    }
    const live = (await db.glazeApps.where('entryId').equals(entryId).toArray())
      .filter((a) => !a.deletedAt)
      .sort((a, b) => a.order - b.order)
    let changed = false
    for (let i = 0; i < glazes.length; i++) {
      const want = glazes[i]
      const have = live[i]
      if (!have) {
        await db.glazeApps.add({
          id: newId(),
          entryId,
          pieceId: entry.pieceId,
          glazeId: want.glazeId,
          order: i,
          dips: want.dips,
          method: want.method,
          note: want.note,
        })
        changed = true
        continue
      }
      const patch: Partial<GlazeApplication> = {}
      if (have.glazeId !== want.glazeId) patch.glazeId = want.glazeId
      if (have.order !== i) patch.order = i
      if (have.dips !== want.dips) patch.dips = want.dips
      if (have.method !== want.method) patch.method = want.method
      if (have.note !== want.note) patch.note = want.note
      if (Object.keys(patch).length > 0) {
        await db.glazeApps.update(have.id, patch)
        changed = true
      }
    }
    const deletedAt = nowIso()
    for (const extra of live.slice(glazes.length)) {
      await db.glazeApps.update(extra.id, { deletedAt })
      changed = true
    }
    if (changed) {
      await db.pieces.update(entry.pieceId, { updatedAt: nowIso() })
    }
    return changed
  })
}
