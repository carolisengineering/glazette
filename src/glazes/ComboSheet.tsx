import { useId, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { fieldLabel } from '../components/PieceFields'
import { useModal } from '../components/useModal'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { deleteCombo, saveCombo } from '../db/combos'
import type { SwatchImage } from '../photos/swatchImage'
import { usePhotoPicker } from '../photos/usePhotoPicker'
import { CropSwatch } from './CropSwatch'
import { type ComboView, useComboPhotoChoices } from './combos'
import { GlazeSwatch } from './GlazeSwatch'
import { PiecePhotoGrid } from './PiecePhotoGrid'

interface Props {
  view: ComboView
  onClose: () => void
}

const sourceButton =
  'h-11 rounded-[22px] border border-border bg-surface px-4 text-[15px] font-semibold disabled:opacity-50'

/**
 * Edit a combo: replace its photo (from the library or a piece wearing this
 * exact stack) or delete it. The layers never change. A new photo saves as
 * soon as it's cropped.
 */
export function ComboSheet({ view, onClose }: Props) {
  const { combo, layers, name } = view
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [choosingPiece, setChoosingPiece] = useState(false)
  // A photo waiting to be cropped.
  const [cropping, setCropping] = useState<{
    blob: Blob
    width: number
    height: number
  }>()
  const [busy, setBusy] = useState(false)
  const { show: showToast, toast } = useToast()
  // Escape reaches only the modal on top, so the confirm dialog, crop screen
  // and piece grid take it while they're open. The sheet stays put while a
  // save runs.
  useModal(titleRef, () => {
    if (!busy) onClose()
  })
  const pieceChoices = useComboPhotoChoices(combo.layers)
  const picker = usePhotoPicker(
    (picked) =>
      setCropping({
        blob: picked.blob,
        width: picked.width,
        height: picked.height,
      }),
    showToast,
  )

  const replace = async (image: SwatchImage) => {
    setCropping(undefined)
    setBusy(true)
    try {
      await saveCombo(combo.layers, image)
      onClose()
    } catch {
      showToast(SAVE_ERROR)
      setBusy(false)
    }
  }

  const remove = async () => {
    setConfirming(false)
    setBusy(true)
    try {
      await deleteCombo(combo.id)
      onClose()
    } catch {
      showToast(SAVE_ERROR)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-5 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <h2
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="font-serif text-[24px] leading-tight outline-none"
        >
          Edit combo
        </h2>
        <div className="flex items-center gap-3.5">
          <GlazeSwatch
            color={layers[0].color}
            photoId={combo.swatchPhotoId}
            className="size-[76px] flex-none rounded-[18px]"
          />
          <p className="min-w-0 text-[18px] leading-tight font-semibold break-words">
            {name}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Replace photo</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={picker.open}
              disabled={busy || picker.processing}
              className={sourceButton}
            >
              Add photo
            </button>
            {pieceChoices && pieceChoices.length > 0 ? (
              <button
                type="button"
                onClick={() => setChoosingPiece(true)}
                disabled={busy}
                className={sourceButton}
              >
                From a piece
              </button>
            ) : null}
          </div>
          {picker.input}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="h-14 rounded-[28px] border border-border bg-surface text-[16px] font-semibold disabled:opacity-50"
        >
          Done
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="h-11 self-center text-[16px] font-semibold text-ink underline disabled:opacity-50"
        >
          Delete combo
        </button>
      </div>
      {confirming ? (
        <ConfirmDialog
          title={`Delete ${name}?`}
          body="Its photo goes too. Pieces keep their glazes."
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {choosingPiece ? (
        <PiecePhotoGrid
          title={`Pieces in ${name}`}
          photoIds={(pieceChoices ?? []).map((c) => c.photoId)}
          onPick={({ photoId: _photoId, ...picked }) => {
            setChoosingPiece(false)
            setCropping(picked)
          }}
          onCancel={() => setChoosingPiece(false)}
        />
      ) : null}
      {cropping ? (
        <CropSwatch
          source={cropping.blob}
          width={cropping.width}
          height={cropping.height}
          onUse={replace}
          onCancel={() => setCropping(undefined)}
        />
      ) : null}
      {toast}
    </div>
  )
}
