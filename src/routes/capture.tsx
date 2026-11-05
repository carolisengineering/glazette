import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { type CameraHandle, CameraInput } from '../capture/CameraInput'
import { NewPieceSheet } from '../capture/NewPieceSheet'
import { inProgress, PickPieceSheet } from '../capture/PickPieceSheet'
import { type ExitTarget, Review } from '../capture/Review'
import { StageStrip } from '../capture/StageStrip'
import { useCaptureStore } from '../capture/store'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { createPiece, softDelete } from '../db/ops'
import { liveDefaultClayId, usePiecesQuery } from '../db/queries'
import { processImage, UnsupportedImageError } from '../photos/process'

const captureRoute = getRouteApi('/capture')

type Step =
  | { name: 'review' }
  | { name: 'choose' }
  | { name: 'details'; pieceId?: string }
  | { name: 'pick' }
  | { name: 'stage'; pieceId: string; fromPick: boolean }

export function CaptureScreen() {
  const { pieceId, addPhoto } = captureRoute.useSearch()
  const navigate = useNavigate()
  const photo = useCaptureStore((s) => s.photo)
  const mode = useCaptureStore((s) => s.mode)
  const camera = useRef<CameraHandle>(null)
  const [step, setStep] = useState<Step>({ name: 'review' })
  const [noPhoto, setNoPhoto] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string>()
  const { show: showToast, toast } = useToast()
  const [saving, setSaving] = useState(false)

  // Start clean. Leaving the screen
  // drops the photo, and `mounted` stops a still-processing photo from landing afterward.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    useCaptureStore.getState().reset()
    return () => {
      mounted.current = false
      useCaptureStore.getState().reset()
    }
  }, [])

  // Default the New piece / Update toggle once the pieces are known: New when
  // nothing is in progress. Never overrides a choice the user made.
  const pieces = usePiecesQuery()
  const hasPhoto = photo !== undefined
  useEffect(() => {
    if (!hasPhoto || pieceId || !pieces) return
    useCaptureStore
      .getState()
      .defaultMode(pieces.some(inProgress) ? 'update' : 'new')
  }, [hasPhoto, pieceId, pieces])

  const onFile = async (file: File) => {
    setError(undefined)
    setProcessing(true)
    try {
      const processed = await processImage(file)
      if (mounted.current) useCaptureStore.getState().setPhoto(processed)
    } catch (err) {
      if (!mounted.current) return
      setError(
        err instanceof UnsupportedImageError
          ? "This photo format isn't supported"
          : "Couldn't open this photo. Try again.",
      )
    } finally {
      if (mounted.current) setProcessing(false)
    }
  }

  const retake = () => {
    useCaptureStore.getState().setPhoto(undefined)
    setStep({ name: 'review' })
    setError(undefined)
    camera.current?.openCamera()
  }

  /** Retake from the details sheet: the piece was already saved, so discard it first. */
  const retaking = useRef(false)
  const retakeNewPiece = async (id: string) => {
    if (retaking.current) return
    retaking.current = true
    // Open the camera in the tap itself: iOS drops the user activation after an await.
    retake()
    try {
      await softDelete('pieces', id)
    } catch {
      showToast("Couldn't discard that piece. It's still on your shelf.")
    } finally {
      retaking.current = false
    }
  }

  /** Saves the photo as a new Thrown piece with the default clay, then asks for details. */
  const startNewPiece = async () => {
    if (!photo || saving) return
    setSaving(true)
    try {
      const id = await createPiece({
        photo,
        clayId: await liveDefaultClayId(),
      })
      setStep({ name: 'details', pieceId: id })
    } catch {
      showToast(SAVE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  const startNoPhoto = () => {
    setNoPhoto(true)
    if (pieceId) {
      setStep({ name: 'stage', pieceId, fromPick: false })
    } else if (pieces && !pieces.some(inProgress)) {
      setStep({ name: 'details' })
    } else {
      setStep({ name: 'choose' })
    }
  }

  const handleUsePhoto = async () => {
    if (!photo || saving) return
    if (pieceId) {
      setStep({ name: 'stage', pieceId, fromPick: false })
    } else if (mode === 'update') {
      setStep({ name: 'pick' })
    } else {
      await startNewPiece()
    }
  }

  // Cancelling returns to where capture was entered from.
  const exit: ExitTarget = pieceId
    ? { to: '/piece/$id', params: { id: pieceId } }
    : { to: '/' }

  const close = () => {
    void navigate({ ...exit, replace: true })
  }

  const done = () => {
    void navigate({ to: '/', replace: true })
  }

  const active = photo !== undefined || noPhoto
  let body: React.ReactNode
  if (active && step.name === 'details') {
    body =
      photo && step.pieceId ? (
        <NewPieceSheet
          pieceId={step.pieceId}
          photo={photo}
          onDone={done}
          onRetake={() => void retakeNewPiece(step.pieceId as string)}
        />
      ) : (
        <NewPieceSheet onDone={done} onClose={close} />
      )
  } else if (active && step.name === 'pick') {
    body = (
      <PickPieceSheet
        photo={photo}
        onPick={(id) => setStep({ name: 'stage', pieceId: id, fromPick: true })}
        onNew={photo ? startNewPiece : () => setStep({ name: 'details' })}
        onRetake={photo ? retake : undefined}
        onClose={close}
      />
    )
  } else if (active && step.name === 'stage') {
    body = (
      <StageStrip
        pieceId={step.pieceId}
        photo={photo}
        exit={exit}
        onChangePiece={
          step.fromPick ? () => setStep({ name: 'pick' }) : undefined
        }
      />
    )
  } else if (noPhoto && step.name === 'choose') {
    body = (
      <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center gap-4 bg-camera px-5 text-white">
        <h1 className="font-serif text-[32px] leading-none font-normal">
          No photo
        </h1>
        <button
          type="button"
          onClick={() => setStep({ name: 'pick' })}
          className="h-14 w-full max-w-[320px] rounded-[28px] bg-accent text-[16px] font-semibold text-white"
        >
          Update a piece
        </button>
        <button
          type="button"
          onClick={() => setStep({ name: 'details' })}
          className="h-14 w-full max-w-[320px] rounded-[28px] bg-white/12 text-[16px] font-semibold text-white"
        >
          New piece
        </button>
        <Link
          {...exit}
          replace
          className="flex h-11 items-center text-[15px] text-[#b7c0c9]"
        >
          Cancel
        </Link>
      </main>
    )
  } else if (photo) {
    body = (
      <Review
        photo={photo}
        exit={exit}
        showToggle={!pieceId}
        mode={mode}
        onMode={(m) => useCaptureStore.getState().setMode(m)}
        onRetake={retake}
        onUse={handleUsePhoto}
        busy={saving}
      />
    )
  } else {
    body = (
      <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center gap-4 bg-camera px-5 text-white">
        <h1 className="font-serif text-[32px] leading-none font-normal">
          New photo
        </h1>
        {processing ? (
          <p role="status" className="text-[16px] text-[#b7c0c9]">
            Getting your photo ready…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-[16px]">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={processing}
          onClick={() => camera.current?.openCamera()}
          className="h-14 w-full max-w-[320px] rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
        >
          Take photo
        </button>
        <button
          type="button"
          disabled={processing}
          onClick={() => camera.current?.openLibrary()}
          className="h-14 w-full max-w-[320px] rounded-[28px] bg-white/12 text-[16px] font-semibold text-white disabled:opacity-50"
        >
          Choose from library
        </button>
        {addPhoto ? null : (
          <button
            type="button"
            disabled={processing}
            onClick={startNoPhoto}
            className="h-14 w-full max-w-[320px] rounded-[28px] border-[1.5px] border-white/35 text-[16px] font-semibold text-white disabled:opacity-50"
          >
            No photo
          </button>
        )}
        <Link
          {...(pieceId
            ? { to: '/piece/$id', params: { id: pieceId } }
            : { to: '/' })}
          className="flex h-11 items-center text-[15px] text-[#b7c0c9]"
        >
          Cancel
        </Link>
      </main>
    )
  }

  return (
    <>
      <CameraInput ref={camera} onFile={onFile} />
      {body}
      {toast}
    </>
  )
}
