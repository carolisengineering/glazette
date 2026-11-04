import { create } from 'zustand'
import type { ProcessedImage } from '../photos/process'

export type CaptureMode = 'new' | 'update'

interface CaptureState {
  /** The processed photo under review. Not in the database until a piece is picked. */
  photo?: ProcessedImage
  mode: CaptureMode
  /** True once the user has tapped the New piece / Update toggle. */
  modeTouched: boolean
  setPhoto(photo?: ProcessedImage): void
  /** The user's choice; it is never overridden by a default. */
  setMode(mode: CaptureMode): void
  /** A default for an untouched toggle. Ignored once the user has chosen. */
  defaultMode(mode: CaptureMode): void
  reset(): void
}

// Most shots update an existing piece.
const INITIAL = {
  photo: undefined,
  mode: 'update',
  modeTouched: false,
} as const

export const useCaptureStore = create<CaptureState>((set) => ({
  ...INITIAL,
  setPhoto: (photo) => set({ photo }),
  setMode: (mode) => set({ mode, modeTouched: true }),
  defaultMode: (mode) => set((s) => (s.modeTouched ? s : { mode })),
  reset: () => set({ ...INITIAL }),
}))
