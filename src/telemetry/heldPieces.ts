import { db } from '../db/db'
import { currentStage } from '../db/stage'
import { track } from './telemetry'

interface HeldProps {
  has_photo: boolean
  ms: number
}

// A camera-first piece is saved as Thrown before the user picks its real stage
// on the details sheet. Its piece_logged report waits here until the sheet ends.
const held = new Map<string, HeldProps>()

export function holdPieceLogged(pieceId: string, props: HeldProps): void {
  held.set(pieceId, props)
}

/**
 * A discarded piece (Retake) is never reported. Returns the dropped report so a
 * failed discard can hold it again.
 */
export function dropPieceLogged(pieceId: string): HeldProps | undefined {
  const props = held.get(pieceId)
  held.delete(pieceId)
  return props
}

/**
 * Sends every held report with the piece's stage as it stands now. A piece
 * that was deleted, or whose stage can't be read, is dropped without sending. Never throws.
 */
export async function releaseHeldPieces(): Promise<void> {
  const pending = [...held]
  held.clear()
  for (const [pieceId, props] of pending) {
    try {
      const piece = await db.pieces.get(pieceId)
      if (!piece || piece.deletedAt) continue
      const entries = await db.entries
        .where('pieceId')
        .equals(pieceId)
        .toArray()
      const stage = currentStage(entries)
      if (stage) track('piece_logged', { ...props, stage })
    } catch {
      // Telemetry failures only mean sending less.
    }
  }
}

export function clearHeldPiecesForTests(): void {
  held.clear()
}
