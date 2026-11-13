import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SAVE_ERROR } from '../components/useToast'
import { fromDateInput } from '../db/dates'
import { db } from '../db/db'
import { addStageEntry, createPiece, ensureDefaults } from '../db/ops'
import type { PhotoSwap } from '../db/stepEdits'
import type { Stage, StageEntry } from '../db/types'
import { type ProcessedImage, processImage } from '../photos/process'
import { setSinkForTests } from '../telemetry/telemetry'
import { StepSheet } from './StepSheet'

// Stored blobs don't survive fake-indexeddb as real Blobs, so expose which photo each image shows.
vi.mock('../components/PhotoImg', () => ({
  PhotoImg: ({ photoId, alt }: { photoId?: string; alt?: string }) => (
    <img data-photo-id={photoId} alt={alt} />
  ),
}))

vi.mock('../photos/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../photos/process')>()),
  processImage: vi.fn(),
}))

const picked: ProcessedImage = {
  blob: new Blob(['new'], { type: 'image/jpeg' }),
  thumb: new Blob(['tnew'], { type: 'image/jpeg' }),
  width: 10,
  height: 10,
  hash: 'hash-new',
  takenAt: '2026-11-04T10:00:00.000Z',
}

function photo(tag: string): ProcessedImage {
  return {
    blob: new Blob([tag], { type: 'image/jpeg' }),
    thumb: new Blob([`t${tag}`], { type: 'image/jpeg' }),
    hash: `hash-${tag}`,
    width: 10,
    height: 10,
    takenAt: '2026-10-21T12:00:00.000Z',
  }
}

const STORED_DATE = fromDateInput('2026-10-21') as string

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureDefaults()
  vi.mocked(processImage).mockReset()
  vi.mocked(processImage).mockResolvedValue(picked)
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
  setSinkForTests(undefined)
})

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

async function step(
  stage: Stage,
  options: { photo?: ProcessedImage; note?: string; date?: string } = {},
): Promise<StageEntry> {
  const pieceId = await createPiece({ name: 'Mug' })
  const id = await addStageEntry({ pieceId, stage, ...options })
  return (await db.entries.get(id)) as StageEntry
}

function renderSheet(entry: StageEntry) {
  const onClose = vi.fn()
  const onSaved = vi.fn<(swap: PhotoSwap | undefined) => void>()
  const { unmount } = render(
    <StepSheet entry={entry} onClose={onClose} onSaved={onSaved} />,
  )
  const dialog = screen.getByRole('dialog', {
    name: `${entry.stage[0].toUpperCase()}${entry.stage.slice(1)} step`,
  })
  return { onClose, onSaved, dialog, unmount }
}

const liveApps = async (entryId: string) =>
  (await db.glazeApps.where('entryId').equals(entryId).toArray()).filter(
    (a) => !a.deletedAt,
  )

// The photo spot's image has alt="", so it has no img role to query by.
const shownImage = (dialog: HTMLElement) => dialog.querySelector('img')

const pickFile = (dialog: HTMLElement) =>
  fireEvent.change(within(dialog).getByTestId('library-input'), {
    target: { files: [new File(['x'], 'pot.jpg', { type: 'image/jpeg' })] },
  })

test('a Glazed step logged without glazes gets a glaze on Save', async () => {
  const entry = await step('glazed')
  const { dialog, onSaved, onClose } = renderSheet(entry)
  await userEvent.type(
    await within(dialog).findByRole('textbox', { name: 'Glaze 1' }),
    'Celadon',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(onSaved).toHaveBeenCalledWith(undefined)
  const apps = await liveApps(entry.id)
  expect(apps).toHaveLength(1)
  expect((await db.glazes.get(apps[0].glazeId))?.name).toBe('Celadon')
})

test('note and date save; Cancel writes nothing', async () => {
  const entry = await step('bisqued', { note: 'Cone 04', date: STORED_DATE })
  const first = renderSheet(entry)
  const note = within(first.dialog).getByRole('textbox', { name: 'Note' })
  expect(note).toHaveValue('Cone 04')
  await userEvent.clear(note)
  await userEvent.type(note, 'Cone 06')
  fireEvent.change(within(first.dialog).getByLabelText('Date'), {
    target: { value: '2026-10-23' },
  })
  await userEvent.click(
    within(first.dialog).getByRole('button', { name: 'Cancel' }),
  )
  expect(first.onClose).toHaveBeenCalled()
  expect(first.onSaved).not.toHaveBeenCalled()
  expect(await db.entries.get(entry.id)).toEqual(entry)
  first.unmount()

  const second = renderSheet(entry)
  const note2 = within(second.dialog).getByRole('textbox', { name: 'Note' })
  await userEvent.clear(note2)
  await userEvent.type(note2, 'Cone 06')
  fireEvent.change(within(second.dialog).getByLabelText('Date'), {
    target: { value: '2026-10-23' },
  })
  await userEvent.click(
    within(second.dialog).getByRole('button', { name: 'Save' }),
  )
  await waitFor(() => expect(second.onClose).toHaveBeenCalled())
  const saved = await db.entries.get(entry.id)
  expect(saved?.note).toBe('Cone 06')
  expect(saved?.date).toBe(fromDateInput('2026-10-23'))
})

test('saving only a note keeps the stored date exactly', async () => {
  const takenAt = '2026-10-21T07:43:12.000Z'
  const entry = await step('bisqued', { date: takenAt })
  const { dialog, onClose } = renderSheet(entry)
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Note' }),
    'Cone 04',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const saved = await db.entries.get(entry.id)
  expect(saved?.note).toBe('Cone 04')
  expect(saved?.date).toBe(takenAt)
})

test('Escape closes without writing', async () => {
  const entry = await step('bisqued', { note: 'Cone 04' })
  const { dialog, onClose } = renderSheet(entry)
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Note' }),
    ' more',
  )
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
  expect(await db.entries.get(entry.id)).toEqual(entry)
})

test('picking a photo fills the date from it, and Save swaps it', async () => {
  const entry = await step('bisqued', { photo: photo('old') })
  const oldPhotoId = entry.photoId as string
  const { dialog, onSaved, onClose } = renderSheet(entry)
  expect(
    within(dialog).getByRole('button', { name: 'Change photo' }),
  ).toBeInTheDocument()
  pickFile(dialog)
  await waitFor(() =>
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-11-04'),
  )
  // The preview shows the picked photo, not the stored one.
  await waitFor(() =>
    expect(shownImage(dialog)).toHaveAttribute(
      'src',
      expect.stringMatching(/^blob:/),
    ),
  )
  expect(shownImage(dialog)).not.toHaveAttribute('data-photo-id')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const old = await db.photos.get(oldPhotoId)
  expect(old?.deletedAt).toBeDefined()
  const saved = await db.entries.get(entry.id)
  expect(saved?.photoId).not.toBe(oldPhotoId)
  // The photo's own time, not noon, while the field still shows its day.
  expect(saved?.date).toBe(picked.takenAt)
  expect(onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ oldPhotoId, newPhotoId: saved?.photoId }),
  )
})

test('a picked photo with the date changed to another day saves that day at noon', async () => {
  const entry = await step('bisqued', { photo: photo('old') })
  const { dialog, onClose } = renderSheet(entry)
  pickFile(dialog)
  const date = within(dialog).getByLabelText('Date')
  await waitFor(() => expect(date).toHaveValue('2026-11-04'))
  fireEvent.change(date, { target: { value: '2026-11-06' } })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect((await db.entries.get(entry.id))?.date).toBe(
    fromDateInput('2026-11-06'),
  )
})

test('the photo spot opens the library picker in the tap', async () => {
  const click = vi.spyOn(HTMLInputElement.prototype, 'click')
  const entry = await step('thrown')
  const { dialog } = renderSheet(entry)
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Add photo' }),
  )
  expect(click).toHaveBeenCalledTimes(1)
  expect(click.mock.contexts[0]).toBe(
    within(dialog).getByTestId('library-input'),
  )
})

test('a Bisqued step has no glaze section', async () => {
  const entry = await step('bisqued')
  const { dialog } = renderSheet(entry)
  expect(within(dialog).getByRole('textbox', { name: 'Note' })).toBeVisible()
  expect(
    within(dialog).queryByRole('textbox', { name: 'Glaze 1' }),
  ).not.toBeInTheDocument()
  expect(within(dialog).queryByText(/Glaze ·/)).not.toBeInTheDocument()
})

test('a half-typed date keeps the stored date; Clear date clears it', async () => {
  const entry = await step('bisqued', { date: STORED_DATE })
  const first = renderSheet(entry)
  // Native date inputs report '' while a field is half-edited.
  fireEvent.change(within(first.dialog).getByLabelText('Date'), {
    target: { value: '' },
  })
  await userEvent.click(
    within(first.dialog).getByRole('button', { name: 'Save' }),
  )
  await waitFor(() => expect(first.onClose).toHaveBeenCalled())
  expect((await db.entries.get(entry.id))?.date).toBe(STORED_DATE)
  first.unmount()

  const second = renderSheet(entry)
  await userEvent.click(
    within(second.dialog).getByRole('button', { name: 'Clear date' }),
  )
  expect(within(second.dialog).getByLabelText('Date')).toHaveValue('')
  expect(
    within(second.dialog).queryByRole('button', { name: 'Clear date' }),
  ).not.toBeInTheDocument()
  await userEvent.click(
    within(second.dialog).getByRole('button', { name: 'Save' }),
  )
  await waitFor(() => expect(second.onClose).toHaveBeenCalled())
  expect((await db.entries.get(entry.id))?.date).toBeUndefined()
})

test('a failed save shows the error, keeps the sheet open and adds no library glaze', async () => {
  const entry = await step('glazed', { note: 'Two dips' })
  const glazesBefore = await db.glazes.count()
  vi.spyOn(db.entries, 'update').mockRejectedValue(new Error('QuotaExceeded'))
  const { dialog, onClose, onSaved } = renderSheet(entry)
  await userEvent.type(
    await within(dialog).findByRole('textbox', { name: 'Glaze 1' }),
    'Brand New Glaze',
  )
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Note' }),
    ', thin',
  )
  const save = within(dialog).getByRole('button', { name: 'Save' })
  await userEvent.click(save)
  expect(await screen.findByText(SAVE_ERROR)).toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
  expect(save).toBeEnabled()
  expect(await db.glazes.count()).toBe(glazesBefore)
  expect(await liveApps(entry.id)).toHaveLength(0)
  expect((await db.entries.get(entry.id))?.note).toBe('Two dips')
})

test('an unreadable photo shows the photo error and keeps the old photo', async () => {
  vi.mocked(processImage).mockRejectedValue(new Error('decode failed'))
  const entry = await step('bisqued', { photo: photo('old') })
  const { dialog } = renderSheet(entry)
  pickFile(dialog)
  expect(
    await screen.findByText("Couldn't open this photo. Try again."),
  ).toBeInTheDocument()
  expect(shownImage(dialog)).toHaveAttribute('data-photo-id', entry.photoId)
  expect(
    within(dialog).getByRole('button', { name: 'Change photo' }),
  ).toBeEnabled()
  expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-10-21')
})

/** A Glazed step wearing one Celadon layer. */
async function glazedStep(): Promise<StageEntry> {
  const celadon = crypto.randomUUID()
  await db.glazes.add({ id: celadon, name: 'Celadon', color: '#aaaaaa' })
  const pieceId = await createPiece({ name: 'Mug' })
  const id = await addStageEntry({
    pieceId,
    stage: 'glazed',
    glazes: [{ glazeId: celadon }],
  })
  return (await db.entries.get(id)) as StageEntry
}

test('saving only a note leaves the glazes alone, even ones that changed meanwhile', async () => {
  const entry = await glazedStep()
  const events = captureEvents()
  const { dialog, onClose } = renderSheet(entry)
  await within(dialog).findByDisplayValue('Celadon')
  // Another device changes the layer after the sheet opened.
  const [layer] = await liveApps(entry.id)
  await act(() => db.glazeApps.update(layer.id, { note: 'rim only' }))
  const before = await db.glazeApps.toArray()
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Note' }),
    'Thin',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect((await db.entries.get(entry.id))?.note).toBe('Thin')
  expect(await db.glazeApps.toArray()).toEqual(before)
  expect(events).not.toContainEqual(['piece_edited', { part: 'glazes' }])
})

test('changing glazes in the step sheet reports piece_edited glazes', async () => {
  const entry = await glazedStep()
  const events = captureEvents()
  const { dialog, onClose } = renderSheet(entry)
  await userEvent.click(
    await within(dialog).findByRole('button', { name: '+ add another glaze' }),
  )
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Glaze 2' }),
    'Speckle',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(await liveApps(entry.id)).toHaveLength(2)
  expect(events).toContainEqual(['piece_edited', { part: 'glazes' }])
  expect(events).toContainEqual(['piece_edited', { part: 'step' }])
})

test('Save reports piece_edited step', async () => {
  const events = captureEvents()
  const entry = await step('bisqued')
  const { dialog, onClose } = renderSheet(entry)
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Note' }),
    'Cone 04',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(events).toContainEqual(['piece_edited', { part: 'step' }])
})
