import { db } from '../db/db'
import type { addStageEntry } from '../db/ops'
import { upsertGlaze } from '../db/ops'
import { notDeleted } from '../db/queries'
import { DEFAULT_GLAZE_COLOR } from '../db/seed'
import type { GlazeRow } from './GlazeRows'

/** Match each row to a library glaze (by id, then name ignoring case) or create it once. */
export async function resolveGlazes(rows: GlazeRow[], cone: string) {
  const live = (await db.glazes.toArray()).filter(notDeleted)
  const byName = new Map(live.map((g) => [g.name.trim().toLowerCase(), g.id]))
  const out: Parameters<typeof addStageEntry>[0]['glazes'] = []
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    let glazeId = row.glazeId
    if (!glazeId) {
      const key = name.toLowerCase()
      glazeId = byName.get(key)
      if (!glazeId) {
        glazeId = await upsertGlaze({ name, cone, color: DEFAULT_GLAZE_COLOR })
        byName.set(key, glazeId)
      }
    }
    out.push({
      glazeId,
      dips: row.dips,
      method: row.method,
      note: row.note?.trim() || undefined,
    })
  }
  return out
}
