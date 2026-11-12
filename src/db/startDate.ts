import { db } from './db'
import { STAGES } from './stage'

/**
 * Keeps a piece's start date (`createdAt`, which "Day N" counts from) in step
 * with its first step: the live step of the earliest stage (the earliest dated
 * one when that stage has several). A dated first step sets the start date,
 * earlier or later. With an undated first step, other steps' dates can only
 * move it earlier, never later. Joins an outer transaction when called inside
 * one.
 */
export async function followStartDate(pieceId: string): Promise<void> {
  await db.transaction('rw', db.entries, db.pieces, async () => {
    const live = (
      await db.entries.where('pieceId').equals(pieceId).toArray()
    ).filter((e) => !e.deletedAt)
    if (live.length === 0) return
    const earliestDate = (dates: (string | undefined)[]) =>
      dates.reduce<string | undefined>(
        (min, d) => (d && (min === undefined || d < min) ? d : min),
        undefined,
      )
    const firstStage = Math.min(...live.map((e) => STAGES.indexOf(e.stage)))
    const firstDate = earliestDate(
      live
        .filter((e) => STAGES.indexOf(e.stage) === firstStage)
        .map((e) => e.date),
    )
    const piece = await db.pieces.get(pieceId)
    if (!piece) return
    let start = firstDate
    if (start === undefined) {
      const earliest = earliestDate(live.map((e) => e.date))
      if (earliest !== undefined && earliest < piece.createdAt) start = earliest
    }
    if (start === undefined || start === piece.createdAt) return
    await db.pieces.update(pieceId, {
      createdAt: start,
      updatedAt: new Date().toISOString(),
    })
  })
}
