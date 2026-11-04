import type { ProcessedImage } from '../photos/process'
import { useCaptureStore } from './store'

const photo: ProcessedImage = {
  blob: new Blob(['a']),
  thumb: new Blob(['b']),
  width: 10,
  height: 10,
  hash: 'h',
  takenAt: '2026-11-01T10:00:00.000Z',
}

test('store reset clears photo and mode', () => {
  const s = useCaptureStore.getState()
  s.setPhoto(photo)
  s.setMode('new')
  useCaptureStore.getState().reset()
  const after = useCaptureStore.getState()
  expect(after.photo).toBeUndefined()
  expect(after.mode).toBe('update')
})
