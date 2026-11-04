import { create } from 'zustand'
import type { ProcessedImage } from '../photos/process'

export type CaptureMode = 'new' | 'update'

interface CaptureState {
  /** The processed photo under review. Not in the database until a piece is picked. */
  photo?: ProcessedImage
  /** Set when the capture started from a known piece. */
  pieceId?: string
  mode: CaptureMode
  setPhoto(photo?: ProcessedImage): void
  setPieceId(id?: string): void
  setMode(mode: CaptureMode): void
  reset(): void
}

// Most shots update an existing piece.
const INITIAL = {
  photo: undefined,
  pieceId: undefined,
  mode: 'update',
} as const

export const useCaptureStore = create<CaptureState>((set) => ({
  ...INITIAL,
  setPhoto: (photo) => set({ photo }),
  setPieceId: (pieceId) => set({ pieceId }),
  setMode: (mode) => set({ mode }),
  reset: () => set({ ...INITIAL }),
}))
