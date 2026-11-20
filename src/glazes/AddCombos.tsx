import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useModal } from '../components/useModal'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { comboId, saveCombo } from '../db/combos'
import { db } from '../db/db'
import { upsertGlaze } from '../db/ops'
import { notDeleted } from '../db/queries'
import { DEFAULT_GLAZE_COLOR, DEFAULT_SETTINGS } from '../db/seed'
import type { ProcessedImage } from '../photos/process'
import type { SwatchImage } from '../photos/swatchImage'
import { usePhotoPicker } from '../photos/usePhotoPicker'
import { CropSwatch } from './CropSwatch'
import {
  type ComboPhotoChoice,
  useComboPhotoChoices,
  useComboViews,
} from './combos'
import type { CropView } from './cropView'
import { type GlazePick, GlazeTilePicker } from './GlazeTilePicker'
import { PiecePhotoGrid } from './PiecePhotoGrid'

interface Props {
  onClose: () => void
  /** Called once at the end of a run with the last combo saved. */
  onSaved: (id: string) => void
}

type Step =
  | { kind: 'choose' }
  | { kind: 'bucket'; photo: ProcessedImage }
  | { kind: 'crop'; photo: ProcessedImage }
  | { kind: 'top'; photo: ProcessedImage; image: SwatchImage }
  | { kind: 'piece' }
  | {
      kind: 'pieceCrop'
      choice: ComboPhotoChoice
      photo: { blob: Blob; width: number; height: number }
    }
  | { kind: 'replace'; choice: ComboPhotoChoice; image: SwatchImage }

const FIRST_HINT =
  "Drag and pinch so the square holds only glaze. Read the tile's label before you tap Next."

/**
 * Adds combos. A test tile run: pick a photo of one bucket's tiles, say which
 * glaze the bucket holds, then crop a tile and say which glaze is on top, as
 * many times as there are tiles. Each tile saves as soon as it's named.
 * From a piece: pick a fired photo of a piece wearing 2 or 3 glazes, crop it,
 * and its glazes become the combo's layers. One combo, then done.
 */
export function AddCombos({ onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [bucket, setBucket] = useState<{ id: string; name: string }>()
  // Where the square was for the last tile, so the next starts there.
  const [view, setView] = useState<CropView>()
  const [saved, setSaved] = useState<{ count: number; id?: string }>({
    count: 0,
  })
  const [hint, setHint] = useState(FIRST_HINT)
  const { show: showToast, toast } = useToast()
  // A tap while a save is running is ignored.
  const busy = useRef(false)

  const glazes = useLiveQuery(
    async () =>
      (await db.glazes.toArray())
        .filter(notDeleted)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const comboViews = useComboViews()
  const pieceChoices = useComboPhotoChoices()
  const savedTops = new Set(
    (comboViews ?? []).flatMap(({ combo }) =>
      combo.layers.length === 2 && combo.layers[1] === bucket?.id
        ? [combo.layers[0]]
        : [],
    ),
  )

  const picker = usePhotoPicker(
    (photo) => setStep({ kind: 'bucket', photo }),
    showToast,
  )

  const finish = () => {
    if (saved.id) onSaved(saved.id)
    onClose()
  }

  const addGlaze = (name: string) =>
    upsertGlaze({
      name,
      cone: settings?.defaultCone ?? DEFAULT_SETTINGS.defaultCone,
      color: DEFAULT_GLAZE_COLOR,
    })

  const nameOf = (pick: GlazePick) =>
    'newName' in pick
      ? pick.newName
      : (glazes?.find((g) => g.id === pick.glazeId)?.name ?? '')

  const pickBucket = async (photo: ProcessedImage, pick: GlazePick) => {
    if (busy.current) return
    busy.current = true
    try {
      const id = 'newName' in pick ? await addGlaze(pick.newName) : pick.glazeId
      setBucket({ id, name: nameOf(pick) })
      setStep({ kind: 'crop', photo })
    } catch {
      showToast(SAVE_ERROR)
    } finally {
      busy.current = false
    }
  }

  const pickTop = async (
    photo: ProcessedImage,
    image: SwatchImage,
    pick: GlazePick,
  ) => {
    if (!bucket || busy.current) return
    busy.current = true
    try {
      // A new glaze and its combo save together, or neither does.
      const id = await db.transaction(
        'rw',
        [db.combos, db.glazes, db.photos, db.photoBytes],
        async () => {
          const top =
            'newName' in pick ? await addGlaze(pick.newName) : pick.glazeId
          return saveCombo([top, bucket.id], image)
        },
      )
      setSaved((s) => ({ count: s.count + 1, id }))
      setHint(
        `Saved ${nameOf(pick)} over ${bucket.name}. Move the square to the next tile.`,
      )
      setStep({ kind: 'crop', photo })
    } catch {
      showToast(SAVE_ERROR)
    } finally {
      busy.current = false
    }
  }

  /** Saves a piece's combo, first asking when its stack already has one. */
  const savePiece = async (
    choice: ComboPhotoChoice,
    image: SwatchImage,
    replace = false,
  ) => {
    if (busy.current) return
    busy.current = true
    try {
      if (!replace) {
        const existing = await db.combos.get(comboId(choice.layers))
        if (existing && !existing.deletedAt) {
          setStep({ kind: 'replace', choice, image })
          return
        }
      }
      onSaved(await saveCombo(choice.layers, image))
      onClose()
    } catch {
      showToast(SAVE_ERROR)
    } finally {
      busy.current = false
    }
  }

  return (
    <>
      {/* Waits for the piece check, so From a piece doesn't appear under a finger. */}
      {step.kind === 'choose' && pieceChoices ? (
        <ChooseSheet
          onTestTiles={picker.open}
          onPiece={
            pieceChoices.length > 0
              ? () => setStep({ kind: 'piece' })
              : undefined
          }
          processing={picker.processing}
          onCancel={onClose}
        />
      ) : null}
      {step.kind === 'piece' ? (
        <PiecePhotoGrid
          title="From a piece"
          photoIds={(pieceChoices ?? []).map((c) => c.photoId)}
          captionOf={(id) => pieceChoices?.find((c) => c.photoId === id)?.name}
          onPick={({ photoId, ...photo }) => {
            const choice = pieceChoices?.find((c) => c.photoId === photoId)
            if (choice) setStep({ kind: 'pieceCrop', choice, photo })
          }}
          onCancel={() => setStep({ kind: 'choose' })}
        />
      ) : null}
      {step.kind === 'pieceCrop' ? (
        <CropSwatch
          source={step.photo.blob}
          width={step.photo.width}
          height={step.photo.height}
          onUse={(image) => savePiece(step.choice, image)}
          onCancel={() => setStep({ kind: 'piece' })}
        />
      ) : null}
      {step.kind === 'replace' ? (
        <ConfirmDialog
          title={`${step.choice.name} already has a photo. Replace it with this one?`}
          confirmLabel="Replace"
          cancelLabel="Keep old"
          onConfirm={() => savePiece(step.choice, step.image, true)}
          onCancel={onClose}
        />
      ) : null}
      {picker.input}
      {step.kind === 'bucket' ? (
        <GlazeTilePicker
          title="Which bucket is this?"
          sub="The bottom glaze for every tile in this photo"
          preview={{ kind: 'photo', photo: step.photo }}
          glazes={glazes ?? []}
          onPick={(pick) => pickBucket(step.photo, pick)}
          onCancel={finish}
        />
      ) : null}
      {step.kind === 'crop' && bucket ? (
        <CropSwatch
          source={step.photo.blob}
          width={step.photo.width}
          height={step.photo.height}
          labels={{ cancel: 'Done', use: 'Next' }}
          status={`Over ${bucket.name} · ${saved.count} saved`}
          hint={hint}
          initialView={view}
          onUse={(image, used) => {
            setView(used)
            setStep({ kind: 'top', photo: step.photo, image })
          }}
          onCancel={finish}
        />
      ) : null}
      {step.kind === 'top' && bucket ? (
        <GlazeTilePicker
          title="Which glaze is on top?"
          preview={{
            kind: 'crop',
            photo: step.image,
            caption: `? over ${bucket.name}`,
            sub: 'Pick the glaze written on the tile',
          }}
          glazes={glazes ?? []}
          exclude={bucket.id}
          faded={savedTops}
          onPick={(pick) => pickTop(step.photo, step.image, pick)}
          onCancel={() => {
            if (!busy.current) setStep({ kind: 'crop', photo: step.photo })
          }}
        />
      ) : null}
      {toast}
    </>
  )
}

const choice =
  'flex min-h-11 w-full items-center gap-3 rounded-[18px] bg-surface p-3.5 text-left text-ink disabled:opacity-50'

/**
 * The ways in. Test tile photo opens the photo picker straight from the tap.
 * From a piece shows only when `onPiece` is given.
 */
function ChooseSheet({
  onTestTiles,
  onPiece,
  processing,
  onCancel,
}: {
  onTestTiles: () => void
  onPiece?: () => void
  processing: boolean
  onCancel: () => void
}) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useModal(titleRef, onCancel)
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-3 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <h2
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="pb-1 font-serif text-[24px] leading-tight outline-none"
        >
          Add combos
        </h2>
        <button
          type="button"
          onClick={onTestTiles}
          disabled={processing}
          className={choice}
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-[16px] font-semibold">Test tile photo</span>
            <span className="text-[14px] text-muted">
              One bucket's tiles. Crop as many combos as you like.
            </span>
          </span>
        </button>
        {onPiece ? (
          <button
            type="button"
            onClick={onPiece}
            disabled={processing}
            className={choice}
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-[16px] font-semibold">From a piece</span>
              <span className="text-[14px] text-muted">
                A fired piece with 2 or 3 glazes. One combo.
              </span>
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 h-14 rounded-[28px] border border-border bg-surface text-[16px] font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
