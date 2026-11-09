import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useModal } from '../components/useModal'
import { db } from '../db/db'
import { lastSyncedLabel } from '../sync/label'
import { useSync } from '../sync/useSync'
import { countWaiting, usePhotosWaiting } from '../sync/useWaiting'
import { requestCode, verifyCode } from './api'
import { useAccount } from './useAccount'

const secondary =
  'h-14 rounded-[28px] border border-border bg-surface text-[16px] font-semibold disabled:opacity-50'
const primary =
  'h-14 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50'
const field =
  'h-14 w-full rounded-[14px] border border-border bg-surface px-4 text-[16px] text-ink'
const link =
  'min-h-11 text-[16px] font-semibold text-accent disabled:opacity-50'

/** How often the "Last synced" line is worked out again while the sheet is open. */
const SYNC_LINE_REFRESH_MS = 30_000

const LINES = {
  'not-open': "Glazette accounts aren't open yet. Thanks for your interest!",
  wrong: "That code didn't work. Check it and try again.",
  expired: 'That code has expired. Send a new one.',
  'rate-limited': 'Wait a minute before asking for another code.',
  offline: "You're offline. Connect to sign in.",
  error: 'Something went wrong. Try again.',
} as const

type Line = keyof typeof LINES

/** Sign in with an emailed code, or sign out. */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useModal(titleRef, onClose)
  const status = useAccount((s) => s.status)
  const accountEmail = useAccount((s) => s.email)
  const signOut = useAccount((s) => s.signOut)
  const syncing = useSync((s) => s.syncing)
  const failed = useSync((s) => s.failed)
  const photosWaiting = usePhotosWaiting()
  // The warning shown before signing out with something still waiting.
  const [warning, setWarning] = useState<string>()
  const syncState = useLiveQuery(() => db.syncState.get('state'), [])
  // Only a sync with this account counts as this account's last sync.
  const lastSyncedAt =
    syncState && syncState.account === accountEmail
      ? syncState.lastSyncedAt
      : undefined
  // Re-renders now and then, so "just now" moves on while the sheet stays open.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (status !== 'signed-in') return
    const timer = setInterval(
      () => setTick((tick) => tick + 1),
      SYNC_LINE_REFRESH_MS,
    )
    return () => clearInterval(timer)
  }, [status])

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  // The address a code was sent to, in the form the server saw. Set means the code step.
  const [sentTo, setSentTo] = useState<string>()
  const [line, setLine] = useState<Line>()
  const [busy, setBusy] = useState(false)
  // The current code is used up or expired; the server has dropped it, so don't ask again.
  const [spent, setSpent] = useState(false)

  const send = async (address: string) => {
    if (busy) return
    const clean = address.trim().toLowerCase()
    if (!clean) return
    setBusy(true)
    setLine(undefined)
    try {
      const result = await requestCode(clean)
      if (result === 'sent') {
        setSentTo(clean)
        setCode('')
        setSpent(false)
      } else setLine(result)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (busy || !sentTo || !/^\d{6}$/.test(code)) return
    if (spent) {
      setLine('expired')
      return
    }
    setBusy(true)
    setLine(undefined)
    try {
      // A late sign-out from an earlier session must not land on the new one.
      await useAccount.getState().settlePendingSignOut()
      const result = await verifyCode(sentTo, code)
      if (result === 'ok') useAccount.getState().signedIn(sentTo)
      else {
        if (result === 'expired') setSpent(true)
        setLine(result)
      }
    } finally {
      setBusy(false)
    }
  }

  const leave = async (confirmed = false) => {
    if (busy) return
    setBusy(true)
    try {
      if (!confirmed) {
        const { photos, changes } = await countWaiting(db)
        if (photos > 0 || changes > 0) {
          setWarning(
            photos === 1
              ? "1 photo hasn't uploaded yet. It will stay on this device and upload when you sign in again."
              : photos > 1
                ? `${photos} photos haven't uploaded yet. They'll stay on this device and upload when you sign in again.`
                : "Some changes haven't synced yet. They'll stay on this device and sync when you sign in again.",
          )
          return
        }
      }
      await signOut()
      setEmail('')
      setCode('')
      setSentTo(undefined)
      setLine(undefined)
    } finally {
      setBusy(false)
    }
  }

  const message = line && (
    <p role="alert" className="text-[14px] text-ink">
      {LINES[line]}
    </p>
  )

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
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
          Account
        </h2>
        {status === 'signed-in' ? (
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-[16px]">Signed in as {accountEmail}</p>
              <p className="text-[14px] text-muted">
                {lastSyncedLabel(lastSyncedAt, syncing, new Date())}
              </p>
              {photosWaiting > 0 && (
                <p className="text-[14px] text-muted">
                  {photosWaiting === 1
                    ? '1 photo waiting to upload'
                    : `${photosWaiting} photos waiting to upload`}
                </p>
              )}
              {failed && (
                <p className="text-[14px] text-muted">
                  Couldn&apos;t sync. It will try again later.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void leave()}
              disabled={busy}
              className={secondary}
            >
              Sign out
            </button>
          </section>
        ) : sentTo ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void verify()
            }}
          >
            <p className="text-[16px]">We sent a 6-digit code to {sentTo}.</p>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
              Code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={field}
              />
            </label>
            {message}
            <button type="submit" disabled={busy} className={primary}>
              Sign in
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(sentTo)}
              className={link}
            >
              Send a new code
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSentTo(undefined)
                setLine(undefined)
                setSpent(false)
              }}
              className={link}
            >
              Use a different email
            </button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void send(email)
            }}
          >
            <p className="text-[16px]">
              Sign in to keep your pieces in step across your devices.
            </p>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                enterKeyHint="send"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={field}
              />
            </label>
            {message}
            <button type="submit" disabled={busy} className={primary}>
              Send code
            </button>
          </form>
        )}
        <button type="button" onClick={onClose} className={secondary}>
          Close
        </button>
        {warning && (
          <ConfirmDialog
            title="Sign out?"
            body={warning}
            confirmLabel="Sign out"
            onConfirm={() => {
              setWarning(undefined)
              void leave(true)
            }}
            onCancel={() => setWarning(undefined)}
          />
        )}
      </div>
    </div>
  )
}
