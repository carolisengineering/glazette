import { db } from './db'

/**
 * Moves a piece's start date (`createdAt`, which "Day N" counts from) to its
 * earliest dated live step. Joins an outer transaction when called inside one.
 */
export async function followStartDate(pieceId: string): Promise<void> {
  await db.transaction('rw', db.entries, db.pieces, async () => {
    const entries = await db.entries.where('pieceId').equals(pieceId).toArray()
    let earliest: string | undefined
    for (const entry of entries) {
      if (entry.deletedAt || !entry.date) continue
      if (earliest === undefined || entry.date < earliest) earliest = entry.date
    }
    if (earliest === undefined) return
    const piece = await db.pieces.get(pieceId)
    if (!piece || piece.createdAt === earliest) return
    await db.pieces.update(pieceId, {
      createdAt: earliest,
      updatedAt: new Date().toISOString(),
    })
  })
}
