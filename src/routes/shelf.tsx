import { useState } from 'react'
import { AccountButton } from '../account/AccountButton'
import { AccountSheet } from '../account/AccountSheet'
import { BackupSheet } from '../backup/BackupSheet'
import { BottomBar } from '../components/BottomBar'
import { KilnBanner } from '../components/KilnBanner'
import { PieceCard } from '../components/PieceCard'
import { StageChips } from '../components/StageChips'
import { StudioName } from '../components/StudioName'
import {
  chipCounts,
  filterShelf,
  type ShelfChip,
  usePiecesQuery,
} from '../db/queries'
import { track } from '../telemetry/telemetry'

export function ShelfScreen() {
  const loaded = usePiecesQuery()
  const views = loaded ?? []
  const [chip, setChip] = useState<ShelfChip>('all')
  const [backupOpen, setBackupOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const now = new Date()
  const counts = chipCounts(views, now)
  // The Lost chip disappears when no lost pieces remain; fall back to All.
  const active = chip === 'lost' && counts.lost === 0 ? 'all' : chip
  const shown = filterShelf(views, active, now)
  const ready = counts.trimmed

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col gap-5 px-5 pt-14 pb-32">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <StudioName />
          <h1 className="font-serif text-[32px] leading-none font-normal">
            My Shelf
          </h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            aria-label="Backup"
            onClick={() => {
              track('screen_viewed', { screen: 'backup' })
              setBackupOpen(true)
            }}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink"
          >
            <svg
              aria-hidden="true"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18" />
              <path d="M12 21v-8" />
              <path d="m9 15.5 3-3 3 3" />
            </svg>
          </button>
          <AccountButton
            onClick={() => {
              track('screen_viewed', { screen: 'account' })
              setAccountOpen(true)
            }}
          />
        </div>
      </header>
      <KilnBanner count={ready} />
      <StageChips counts={counts} active={active} onPick={setChip} />
      {loaded && shown.length === 0 ? (
        <p className="py-10 text-center text-[16px] text-muted">
          {active !== 'all'
            ? 'No pieces at this stage.'
            : views.length === 0
              ? 'Nothing here yet. Tap + to add a piece.'
              : 'Nothing in progress. Fired and lost pieces are under their chips.'}
        </p>
      ) : (
        <div className="shelf-grid">
          {shown.map((view) => (
            <PieceCard key={view.piece.id} view={view} now={now} />
          ))}
        </div>
      )}
      <BottomBar />
      {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}
      {backupOpen && <BackupSheet onClose={() => setBackupOpen(false)} />}
    </main>
  )
}
