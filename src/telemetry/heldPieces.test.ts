import { db } from '../db/db'
import { createPiece, restagePiece, softDelete } from '../db/ops'
import type { ProcessedImage } from '../photos/process'
import {
  clearHeldPiecesForTests,
  dropPieceLogged,
  holdPieceLogged,
  releaseHeldPieces,
} from './heldPieces'
import { setSinkForTests, type TelemetrySink } from './telemetry'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  clearHeldPiecesForTests()
  setSinkForTests(undefined)
})

function captureEvents() {
  const events: Array<[string, Record<string, unknown>]> = []
  const sink: TelemetrySink = {
    capture: (n, p) => events.push([n, p]),
    identify: () => {},
    reset: () => {},
    register: () => {},
    captureException: () => {},
  }
  setSinkForTests(sink)
  return events
}

const photo: ProcessedImage = {
  blob: new Blob(['full']),
  thumb: new Blob(['thumb']),
  hash: 'h1',
  width: 10,
  height: 20,
  takenAt: '2026-10-31T09:00:00.000Z',
}

test('release sends piece_logged with the current stage and the held save time', async () => {
  const events = captureEvents()
  const id = await createPiece({ photo, holdReport: true })
  await restagePiece(id, 'bisqued')
  await releaseHeldPieces()
  expect(events).toEqual([
    [
      'piece_logged',
      { has_photo: true, ms: expect.any(Number), stage: 'bisqued' },
    ],
  ])
})

test('release sends each held piece once', async () => {
  const events = captureEvents()
  await createPiece({ photo, holdReport: true })
  await releaseHeldPieces()
  await releaseHeldPieces()
  expect(events).toHaveLength(1)
})

test('a dropped piece is never sent', async () => {
  const events = captureEvents()
  const id = await createPiece({ photo, holdReport: true })
  dropPieceLogged(id)
  await releaseHeldPieces()
  expect(events).toEqual([])
})

test("a piece whose stage can't be read is dropped silently", async () => {
  const events = captureEvents()
  holdPieceLogged('missing', { has_photo: true, ms: 5 })
  await expect(releaseHeldPieces()).resolves.toBeUndefined()
  await releaseHeldPieces()
  expect(events).toEqual([])
})

test('a held piece whose row is soft-deleted is not reported', async () => {
  const events = captureEvents()
  const id = await createPiece({ photo, holdReport: true })
  await softDelete('pieces', id)
  await releaseHeldPieces()
  expect(events).toEqual([])
})
