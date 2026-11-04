import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { type CameraHandle, CameraInput } from '../capture/CameraInput'
import { NewPieceSheet } from '../capture/NewPieceSheet'
import { Review } from '../capture/Review'
import { useCaptureStore } from '../capture/store'
import { Toast } from '../components/Toast'
import { db } from '../db/db'
import { createPiece } from '../db/ops'
import { processImage, UnsupportedImageError } from '../photos/process'

const captureRoute = getRouteApi('/capture')

type Step =
  | { name: 'review' }
  | { name: 'details'; pieceId: string }
  // Seams for Task 7: the pick-a-piece sheet and the stage strip replace these.
  | { name: 'pick' }
  | { name: 'stage' }

export function CaptureScreen() {
  const { pieceId } = captureRoute.useSearch()
  const navigate = useNavigate()
  const photo = useCaptureStore((s) => s.photo)
  const mode = useCaptureStore((s) => s.mode)
  const camera = useRef<CameraHandle>(null)
  const opened = useRef(false)
  const [step, setStep] = useState<Step>({ name: 'review' })
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [saving, setSaving] = useState(false)

  // A piece id in the URL is held in the store; leaving the screen drops the photo.
  useEffect(() => {
    useCaptureStore.getState().setPieceId(pieceId)
    return () => useCaptureStore.getState().reset()
  }, [pieceId])

  // Open the camera once on arrival. The ref guard stops StrictMode opening it twice.
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    camera.current?.openCamera()
  }, [])

  const onFile = async (file: File) => {
    setError(undefined)
    setProcessing(true)
    try {
      useCaptureStore.getState().setPhoto(await processImage(file))
    } catch (err) {
      setError(
        err instanceof UnsupportedImageError
          ? "This photo format isn't supported"
          : "Couldn't open this photo. Try again.",
      )
    } finally {
      setProcessing(false)
    }
  }

  const retake = () => {
    useCaptureStore.getState().setPhoto(undefined)
    setError(undefined)
    camera.current?.openCamera()
  }

  const handleUsePhoto = async () => {
    if (!photo || saving) return
    if (pieceId) {
      setStep({ name: 'stage' })
    } else if (mode === 'update') {
      setStep({ name: 'pick' })
    } else {
      setSaving(true)
      try {
        const settings = await db.settings.get('app')
        const id = await createPiece({
          photo,
          clayId: settings?.defaultClayId,
        })
        setStep({ name: 'details', pieceId: id })
      } catch {
        setToast("Couldn't save. Free up space and try again.")
      } finally {
        setSaving(false)
      }
    }
  }

  const done = () => {
    useCaptureStore.getState().reset()
    void navigate({ to: '/' })
  }

  let body: React.ReactNode
  if (photo && step.name === 'details') {
    body = <NewPieceSheet pieceId={step.pieceId} photo={photo} onDone={done} />
  } else if (photo && step.name !== 'review') {
    body = <NextStepPlaceholder />
  } else if (photo) {
    body = (
      <Review
        photo={photo}
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
      <main className="mx-auto flex min-h-screen max-w-[430px] flex-col items-center justify-center gap-4 bg-camera px-5 text-white">
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
        <Link
          to="/"
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
      {toast ? (
        <Toast message={toast} onDismiss={() => setToast(undefined)} />
      ) : null}
    </>
  )
}

/** Task 7 replaces this with the pick-a-piece sheet and the stage strip. */
function NextStepPlaceholder() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-camera px-5 pt-14 text-white" />
  )
}
