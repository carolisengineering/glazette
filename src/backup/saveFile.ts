/**
 * Hands the backup to the user. Where files can be shared (iPhone), this opens
 * the share sheet, which has "Save to Files". Elsewhere it downloads the file.
 */
export async function saveFile(
  blob: Blob,
  name: string,
): Promise<'shared' | 'downloaded' | 'canceled'> {
  const file = new File([blob], name, { type: 'application/zip' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'canceled'
      }
      throw err
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
  return 'downloaded'
}
