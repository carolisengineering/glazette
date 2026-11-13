import { setSinkForTests } from '../telemetry/telemetry'
import {
  type ProcessedImage,
  processImage,
  UnsupportedImageError,
} from './process'
import { processPickedPhoto } from './processPickedPhoto'

vi.mock('./process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./process')>()),
  processImage: vi.fn(),
}))

const done: ProcessedImage = {
  blob: new Blob(['p']),
  thumb: new Blob(['t']),
  width: 10,
  height: 10,
  hash: 'h',
  takenAt: '2026-11-04T10:00:00.000Z',
}

function captureEvents() {
  const events: Array<[string, Record<string, unknown>]> = []
  setSinkForTests({
    capture: (n, p) => events.push([n, p]),
    identify: () => {},
    reset: () => {},
    register: () => {},
    captureException: () => {},
  })
  return events
}

const file = (bytes: number) =>
  new File([new Uint8Array(bytes)], 'pot.jpg', { type: 'image/jpeg' })

afterEach(() => {
  vi.mocked(processImage).mockReset()
  setSinkForTests(undefined)
})

test('returns the processed photo and reports its size and time', async () => {
  vi.mocked(processImage).mockResolvedValue(done)
  const events = captureEvents()
  expect(await processPickedPhoto(file(1_400_000))).toBe(done)
  expect(events).toEqual([
    ['photo_processed', { ms: expect.any(Number), megabytes: 1.4 }],
  ])
})

test('a failure rejects with a message to show, and reports nothing', async () => {
  const events = captureEvents()
  vi.mocked(processImage).mockRejectedValue(new UnsupportedImageError())
  await expect(processPickedPhoto(file(10))).rejects.toThrow(
    "This photo format isn't supported",
  )
  vi.mocked(processImage).mockRejectedValue(new Error('decode failed'))
  await expect(processPickedPhoto(file(10))).rejects.toThrow(
    "Couldn't open this photo. Try again.",
  )
  expect(events).toEqual([])
})
