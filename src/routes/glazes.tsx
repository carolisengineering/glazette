import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { BottomBar } from '../components/BottomBar'
import { db } from '../db/db'
import { usePieces } from '../db/queries'
import { DEFAULT_SETTINGS } from '../db/seed'
import { GlazeCard } from '../glazes/GlazeCard'
import { GlazeSheet } from '../glazes/GlazeSheet'
import { SwatchWall } from '../glazes/SwatchWall'
import { useGlazeViews } from '../glazes/swatch'

type Sheet = { glazeId?: string } | undefined

const addButton =
  'h-11 rounded-3xl bg-accent px-5 text-[16px] font-semibold text-white'

export function GlazesScreen() {
  const views = useGlazeViews()
  const pieces = usePieces()
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const [pickedId, setPickedId] = useState<string>()
  const [sheet, setSheet] = useState<Sheet>()

  const list = views ?? []
  const selected = list.find((v) => v.glaze.id === pickedId) ?? list[0]
  const editing = sheet?.glazeId
    ? list.find((v) => v.glaze.id === sheet.glazeId)?.glaze
    : undefined

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col gap-5 px-5 pt-14 pb-32">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-semibold tracking-[0.12em] text-muted uppercase">
            Library
          </span>
          <h1 className="font-serif text-[32px] leading-none font-normal">
            Glazes
          </h1>
        </div>
        {selected ? (
          <button
            type="button"
            onClick={() => setSheet({})}
            className={addButton}
          >
            Add glaze
          </button>
        ) : null}
      </div>
      {views && !selected ? (
        <div className="flex flex-col items-start gap-4 rounded-card bg-surface p-5">
          <p className="text-[16px] text-muted">
            No glazes yet. Add one here, or log a Glazed photo.
          </p>
          <button
            type="button"
            onClick={() => setSheet({})}
            className={addButton}
          >
            Add glaze
          </button>
        </div>
      ) : null}
      {selected ? (
        <>
          <GlazeCard
            view={selected}
            pieces={pieces}
            onEdit={() => setSheet({ glazeId: selected.glaze.id })}
          />
          <SwatchWall
            glazes={list}
            selectedId={selected.glaze.id}
            onSelect={setPickedId}
          />
        </>
      ) : null}
      {sheet ? (
        <GlazeSheet
          glaze={editing}
          liveGlazes={list.map((v) => v.glaze)}
          defaultCone={settings?.defaultCone ?? DEFAULT_SETTINGS.defaultCone}
          onClose={(savedId) => {
            if (savedId) setPickedId(savedId)
            setSheet(undefined)
          }}
        />
      ) : null}
      <BottomBar />
    </main>
  )
}
