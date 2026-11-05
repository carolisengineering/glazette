import { useState } from 'react'
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

export function ShelfScreen() {
  const loaded = usePiecesQuery()
  const views = loaded ?? []
  const [chip, setChip] = useState<ShelfChip>('all')
  const now = new Date()
  const counts = chipCounts(views, now)
  // The Lost chip disappears when no lost pieces remain; fall back to All.
  const active = chip === 'lost' && counts.lost === 0 ? 'all' : chip
  const shown = filterShelf(views, active, now)
  const ready = counts.trimmed

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col gap-5 px-5 pt-14 pb-32">
      <header className="flex flex-col gap-0.5">
        <StudioName />
        <h1 className="font-serif text-[32px] leading-none font-normal">
          My Shelf
        </h1>
      </header>
      <KilnBanner count={ready} />
      <StageChips counts={counts} active={active} onPick={setChip} />
      {loaded && shown.length === 0 ? (
        <p className="py-10 text-center text-[16px] text-muted">
          {active === 'all'
            ? 'Nothing here yet. Tap + to add a piece.'
            : 'No pieces at this stage.'}
        </p>
      ) : (
        <div className="shelf-grid">
          {shown.map((view) => (
            <PieceCard key={view.piece.id} view={view} now={now} />
          ))}
        </div>
      )}
      <BottomBar />
    </main>
  )
}
