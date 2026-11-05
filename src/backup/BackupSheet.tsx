import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useRef, useState } from 'react'
import { useModal } from '../components/useModal'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { shortDate } from '../db/dates'
import { db } from '../db/db'
import { setLastBackupAt } from '../db/ops'
import { backupFileName, exportZip } from './export'
import { importZip, NewerBackupError, NotABackupError } from './import'
import { saveFile } from './saveFile'

const secondary =
  'h-14 rounded-[28px] border border-border bg-surface text-[16px] font-semibold disabled:opacity-50'

function restoredMessage({ pieces }: { pieces: number }): string {
  if (pieces === 0) return 'Already up to date'
  return pieces === 1 ? 'Restored 1 piece' : `Restored ${pieces} pieces`
}

/** Save everything to one file, or restore from one. */
export function BackupSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastBackupAt = useLiveQuery(
    () => db.settings.get('app'),
    [],
  )?.lastBackupAt
  const [busy, setBusy] = useState(false)
  // A built zip kept when the share sheet was blocked, so a fresh tap can share it.
  const [ready, setReady] = useState<{ blob: Blob; name: string }>()
  // Closing mid-action would hide the result toast.
  const close = () => {
    if (!busy) onClose()
  }
  useModal(titleRef, close)
  const { show: showToast, toast } = useToast()

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (err) {
      showToast(
        err instanceof NotABackupError
          ? "This isn't a Glazette backup"
          : err instanceof NewerBackupError
            ? 'This backup is from a newer version of Glazette'
            : SAVE_ERROR,
      )
    } finally {
      setBusy(false)
    }
  }

  const share = async (blob: Blob, name: string) => {
    const result = await saveFile(blob, name)
    if (result === 'blocked') {
      setReady({ blob, name })
      showToast('Your backup is ready. Tap Save backup file to save it.')
      return
    }
    if (result === 'canceled') return
    setReady(undefined)
    await setLastBackupAt(new Date().toISOString())
  }

  const save = () =>
    run(async () => {
      const now = new Date()
      await share(await exportZip(now), backupFileName(now))
    })

  // No awaits before sharing: iOS needs the share to follow the tap directly.
  const saveReady = () => {
    if (ready) void run(() => share(ready.blob, ready.name))
  }

  const restore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Clear so choosing the same file again still fires a change.
    e.target.value = ''
    if (!file) return
    void run(async () => {
      showToast(restoredMessage(await importZip(file)))
      setReady(undefined)
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-dvh w-full max-w-[430px] flex-col gap-6 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <h2
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="font-serif text-[24px] leading-tight outline-none"
        >
          Backup
        </h2>
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={ready ? saveReady : save}
            disabled={busy}
            className="h-14 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
          >
            {ready ? 'Save backup file' : 'Save a backup'}
          </button>
          <p className="text-[13px] text-muted">
            One file with every piece, glaze and photo. Keep it somewhere safe,
            like iCloud Drive.
          </p>
          <p className="text-[13px] text-muted">
            {lastBackupAt
              ? `Last backup: ${shortDate(lastBackupAt)}`
              : 'No backup yet'}
          </p>
        </section>
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className={secondary}
          >
            Restore from a backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={restore}
          />
        </section>
        <button type="button" onClick={close} className={secondary}>
          Close
        </button>
      </div>
      {toast}
    </div>
  )
}
