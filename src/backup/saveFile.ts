/**
 * Hands the backup to the user. Where files can be shared (iPhone), this opens
 * the share sheet, which has "Save to Files". Elsewhere it downloads the file.
 */
export async function saveFile(
  blob: Blob,
  name: string,
): Promise<'shared' | 'downloaded' | 'canceled' | 'blocked'> {
  const file = new File([blob], name, { type: 'application/zip' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'canceled'
      }
      // Safari refuses to share once the tap's permission has lapsed.
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        return 'blocked'
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
    // Some browsers read the URL after click returns, so revoke later.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return 'downloaded'
}
