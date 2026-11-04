import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { markLost, softDelete, updatePiece } from '../db/ops'
import { type PieceDetail, usePiece } from '../db/queries'
import { displayName, latestEntry, nextStage, STAGE_LABEL } from '../db/stage'
import type { StageEntry } from '../db/types'
import { BeforeAfter, type Side } from '../piece/BeforeAfter'
import { EditSheet } from '../piece/EditSheet'
import { FactCards } from '../piece/FactCards'
import { Hero } from '../piece/Hero'
import { shortDate, Timeline } from '../piece/Timeline'

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
  const [notes, setNotes] = useState(piece.notes ?? '')

  const fired = latestEntry(entries, 'fired')
  const heroPhotoId = fired
    ? latestEntry(entries, side)?.photoId
    : view.latestPhotoId
  const latest = latestEntry(entries)
  const next = nextStage(stage)

  const saveNotes = async () => {
    if (notes !== (piece.notes ?? '')) await updatePiece(piece.id, { notes })
  }

  const confirmDelete = async () => {
    const target = pending
    setPending(undefined)
    if (target?.kind === 'entry') {
      await softDelete('entries', target.entry.id)
    } else if (target?.kind === 'piece') {
      await softDelete('pieces', piece.id)
      await navigate({ to: '/', replace: true })
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col text-ink">
      <Hero photoId={heroPhotoId} alt={name}>
        {fired ? <BeforeAfter value={side} onChange={setSide} /> : null}
      </Hero>

      <div className="flex flex-col gap-6 px-5 pt-6 pb-12">
        <div className="flex flex-col gap-1">
          {stage && latest ? (
            <span className="text-[13px] font-semibold tracking-[0.12em] text-accent uppercase">
              {STAGE_LABEL[stage]} · {shortDate(latest.date)}
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
              {`Move ${name} to ${STAGE_LABEL[next]}`}
            </Link>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Link
              to="/capture"
              search={{ pieceId: piece.id }}
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
            onClick={() => markLost(piece.id, !piece.lost)}
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
