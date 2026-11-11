import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { shortDate } from '../db/dates'
import { markLost, setEntryDate, softDelete, updatePiece } from '../db/ops'
import { type PieceDetail, usePiece } from '../db/queries'
import { displayName, latestEntry, nextStage, STAGE_LABEL } from '../db/stage'
import type { StageEntry } from '../db/types'
import { BeforeAfter, type Side } from '../piece/BeforeAfter'
import { EditSheet } from '../piece/EditSheet'
import { FactCards } from '../piece/FactCards'
import { Hero } from '../piece/Hero'
import { Timeline } from '../piece/Timeline'
import { track } from '../telemetry/telemetry'

const heading =
  'm-0 text-[14px] font-semibold tracking-[0.08em] text-muted uppercase'
const secondary =
  'flex h-12 items-center justify-center rounded-3xl border border-border bg-surface px-4 text-[16px] font-semibold text-ink no-underline'

type Pending =
  | { kind: 'piece' }
  | { kind: 'entry'; entry: StageEntry }
  | undefined

export function PieceScreen() {
  const { id } = useParams({ from: '/piece/$id' })
  const view = usePiece(id)

  if (view === undefined) return null
  if (view === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-start gap-4 px-5 pt-14">
        <p className="text-[16px]">This piece isn't here anymore.</p>
        <Link
          to="/"
          className="flex min-h-11 items-center text-[16px] font-medium text-accent"
        >
          Back to shelf
        </Link>
      </main>
    )
  }
  return <PieceBoard key={view.piece.id} view={view} />
}

function PieceBoard({ view }: { view: PieceDetail }) {
  const { piece, entries, stage } = view
  const navigate = useNavigate()
  const name = displayName(piece)
  const [side, setSide] = useState<Side>('fired')
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<Pending>()
  const { show: showToast, toast } = useToast()
  const [notes, setNotes] = useState(piece.notes ?? '')

  // The before/after pair is the newest photo on each side; entries without a photo don't count.
  const withPhoto = entries.filter((e) => e.photoId)
  const afterPhoto = latestEntry(withPhoto, 'fired')
  const beforePhoto = latestEntry(withPhoto, 'glazed')
  const compare = afterPhoto && beforePhoto
  // A tapped earlier step takes over the top photo and the stage line until
  // the latest step is tapped, the step goes away, or the piece is left.
  const [pickedId, setPickedId] = useState<string>()
  const latestWithPhoto = latestEntry(withPhoto)
  const picked = withPhoto.find(
    (e) => e.id === pickedId && e.id !== latestWithPhoto?.id,
  )
  // Forget a tap whose step is gone or is now the latest, so it can't come back.
  const pickGone = pickedId !== undefined && !picked
  useEffect(() => {
    if (pickGone) setPickedId(undefined)
  }, [pickGone])
  const heroEntry =
    picked ??
    (compare ? (side === 'fired' ? afterPhoto : beforePhoto) : latestWithPhoto)
  const latest = latestEntry(entries)
  const headerEntry = picked ?? latest
  const next = nextStage(stage)

  const showStep = (entry: StageEntry) => {
    if (entry.id === latestWithPhoto?.id) {
      // Back to the latest photo, even if the toggle was on before firing.
      setPickedId(undefined)
      setSide('fired')
    } else {
      setPickedId(entry.id)
    }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    window.scrollTo({ top: 0, behavior: still?.matches ? 'auto' : 'smooth' })
  }

  /** Runs a write; a failure shows the same toast the sheets use. Returns whether it worked. */
  const attempt = async (write: () => Promise<unknown>): Promise<boolean> => {
    try {
      await write()
      return true
    } catch {
      showToast(SAVE_ERROR)
      return false
    }
  }

  // Latest text and last saved text, read through refs so the unmount save is never stale.
  const notesRef = useRef(notes)
  notesRef.current = notes
  const savedNotes = useRef(piece.notes ?? '')

  const saveNotes = async () => {
    const text = notesRef.current
    if (text === savedNotes.current) return
    if (await attempt(() => updatePiece(piece.id, { notes: text }))) {
      savedNotes.current = text
      track('piece_edited', { part: 'notes' })
    }
  }

  // Typed-but-not-blurred notes are saved when the screen is left or hidden.
  const pieceId = piece.id
  useEffect(() => {
    const flush = () => {
      const text = notesRef.current
      if (text === savedNotes.current) return
      // No screen left to show a toast on; a failed save is retried by the next flush.
      void updatePiece(pieceId, { notes: text }).then(
        () => {
          savedNotes.current = text
          track('piece_edited', { part: 'notes' })
        },
        () => {},
      )
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [pieceId])

  const confirmDelete = async () => {
    const target = pending
    setPending(undefined)
    if (target?.kind === 'entry') {
      if (await attempt(() => softDelete('entries', target.entry.id))) {
        track('step_deleted', {})
      }
    } else if (target?.kind === 'piece') {
      if (await attempt(() => softDelete('pieces', piece.id))) {
        track('piece_deleted', {})
        await navigate({ to: '/', replace: true })
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col text-ink">
      <Hero
        photoId={heroEntry?.photoId}
        alt={picked ? `${name}, ${STAGE_LABEL[picked.stage]}` : name}
      >
        {compare && !picked ? (
          <BeforeAfter value={side} onChange={setSide} />
        ) : null}
      </Hero>

      <div className="flex flex-col gap-6 px-5 pt-6 pb-12">
        <div className="flex flex-col gap-1">
          {headerEntry ? (
            <span className="text-[13px] font-semibold tracking-[0.12em] text-accent uppercase">
              {STAGE_LABEL[headerEntry.stage]}
              {headerEntry.date ? ` · ${shortDate(headerEntry.date)}` : null}
            </span>
          ) : null}
          <h1 className="m-0 font-serif text-[32px] leading-[1.05] font-normal break-words">
            {name}
          </h1>
        </div>

        <FactCards view={view} />

        <div className="flex flex-col gap-3">
          {!piece.lost && next ? (
            <Link
              to="/capture"
              search={{ pieceId: piece.id }}
              className="flex h-14 items-center justify-center rounded-[28px] bg-accent text-[16px] font-semibold text-white no-underline"
            >
              <span className="min-w-0 truncate px-4">{`Move ${name} to ${STAGE_LABEL[next]}`}</span>
            </Link>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Link
              to="/capture"
              search={{ pieceId: piece.id, addPhoto: true }}
              className={secondary}
            >
              Add photo
            </Link>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={secondary}
            >
              Edit
            </button>
          </div>
        </div>

        {entries.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className={heading}>Journey</h2>
            <Timeline
              entries={entries}
              onDelete={(entry) => setPending({ kind: 'entry', entry })}
              onSetDate={(entry, date) =>
                attempt(() => setEntryDate(entry.id, date))
              }
              shownId={heroEntry?.id}
              onShow={showStep}
            />
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <label htmlFor="pieceNotes" className={heading}>
            Notes
          </label>
          <textarea
            id="pieceNotes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={4}
            className="rounded-[20px] border-0 bg-surface p-4 text-[16px] leading-normal text-ink outline-accent"
          />
        </section>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={async () => {
              const lost = !piece.lost
              if (await attempt(() => markLost(piece.id, lost))) {
                track('piece_lost', { lost })
              }
            }}
            className={secondary}
          >
            {piece.lost ? 'Mark as found' : 'Mark as lost'}
          </button>
          <button
            type="button"
            onClick={() => setPending({ kind: 'piece' })}
            className={secondary}
          >
            Delete piece
          </button>
        </div>
      </div>

      {toast}
      {editing ? (
        <EditSheet piece={piece} onClose={() => setEditing(false)} />
      ) : null}
      {pending ? (
        <ConfirmDialog
          title={
            pending.kind === 'piece'
              ? `Delete ${name}?`
              : `Delete ${STAGE_LABEL[pending.entry.stage]} entry?`
          }
          body={
            pending.kind === 'piece'
              ? 'It will disappear from your shelf.'
              : 'It will disappear from this piece’s journey.'
          }
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPending(undefined)}
        />
      ) : null}
    </main>
  )
}
