import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { type CameraHandle, CameraInput } from '../capture/CameraInput'
import { elapsed, track } from '../telemetry/telemetry'
import { type ProcessedImage, photoErrorMessage, processImage } from './process'

/**
 * Picks one photo. `open()` shows the library input, which on iPhone offers
 * its own Photo Library / Take Photo menu; render `input` once. A chosen file
 * is processed and handed to `onPicked`, or a message to `onError`. Nothing is
 * called back after unmount.
 */
export function usePhotoPicker(
  onPicked: (photo: ProcessedImage) => void,
  onError: (message: string) => void,
): { open: () => void; input: ReactNode; processing: boolean } {
  const camera = useRef<CameraHandle>(null)
  const [processing, setProcessing] = useState(false)
  const callbacks = useRef({ onPicked, onError })
  callbacks.current = { onPicked, onError }
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const onFile = async (file: File) => {
    setProcessing(true)
    try {
      const start = performance.now()
      const processed = await processImage(file)
      track('photo_processed', {
        ms: elapsed(start),
        megabytes: Math.round(file.size / 1e5) / 10,
      })
      if (mounted.current) callbacks.current.onPicked(processed)
    } catch (err) {
      if (mounted.current) callbacks.current.onError(photoErrorMessage(err))
    } finally {
      if (mounted.current) setProcessing(false)
    }
  }

  // Synchronous, so the click stays inside the tap: iOS drops the user
  // activation after an await.
  const open = useCallback(() => camera.current?.openLibrary(), [])

  return {
    open,
    input: <CameraInput ref={camera} onFile={onFile} />,
    processing,
  }
}
