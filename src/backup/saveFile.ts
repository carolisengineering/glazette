/**
 * Hands the backup to the user. On touch devices that can share files (iPhone),
 * this opens the share sheet, which has "Save to Files". Desktop browsers can
 * share files too, but their share sheet is a poor fit for a backup, so
 * anywhere without a coarse pointer the file is downloaded.
 */
export async function saveFile(
  blob: Blob,
  name: string,
): Promise<'shared' | 'downloaded' | 'canceled' | 'blocked'> {
  const file = new File([blob], name, { type: 'application/zip' })
  const touch = window.matchMedia?.('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
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
