import { type Ref, useImperativeHandle, useRef } from 'react'

export interface CameraHandle {
  openCamera(): void
  openLibrary(): void
}

interface Props {
  onFile: (file: File) => void
  ref: Ref<CameraHandle>
}

/** Two hidden file inputs: the native camera and the photo library. */
export function CameraInput({ onFile, ref }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    openCamera: () => cameraRef.current?.click(),
    openLibrary: () => libraryRef.current?.click(),
  }))

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Clear so choosing the same file again still fires a change.
    e.target.value = ''
    if (file) onFile(file)
  }

  return (
    <>
      <input
        ref={cameraRef}
        data-testid="capture-input"
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handle}
      />
      <input
        ref={libraryRef}
        data-testid="library-input"
        type="file"
        accept="image/*"
        hidden
        onChange={handle}
      />
    </>
  )
}
