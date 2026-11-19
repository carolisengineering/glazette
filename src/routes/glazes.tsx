import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { BottomBar } from '../components/BottomBar'
import { db } from '../db/db'
import { DEFAULT_SETTINGS } from '../db/seed'
import { AddCombos } from '../glazes/AddCombos'
import { ComboCard } from '../glazes/ComboCard'
import { ComboStrips } from '../glazes/ComboStrips'
import { comboStrips, useComboViews } from '../glazes/combos'
import { GlazeCard } from '../glazes/GlazeCard'
import { GlazeSheet } from '../glazes/GlazeSheet'
import { SwatchWall } from '../glazes/SwatchWall'
import { firedPhotoIds, useGlazeViews } from '../glazes/swatch'

type Sheet = { glazeId?: string } | undefined

const addButton =
  'h-11 rounded-3xl bg-accent px-5 text-[16px] font-semibold text-white'

const segment = (active: boolean) =>
  `h-11 flex-1 rounded-[10px] text-[15px] font-semibold ${
    active ? 'bg-surface text-ink shadow-sm' : 'bg-transparent text-muted'
  }`

export function GlazesScreen() {
  const views = useGlazeViews()
  const comboViews = useComboViews()
  const [tab, setTab] = useState<'glazes' | 'combos'>('glazes')
  const [pickedComboId, setPickedComboId] = useState<string>()
  // Adding combos; with `comboId` set, editing one (not built yet).
  const [comboSheet, setComboSheet] = useState<{ comboId?: string }>()
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const [pickedId, setPickedId] = useState<string>()
  const [sheet, setSheet] = useState<Sheet>()

  const list = views ?? []
  const selected = list.find((v) => v.glaze.id === pickedId) ?? list[0]
  const editingView = sheet?.glazeId
    ? list.find((v) => v.glaze.id === sheet.glazeId)
    : undefined
  const editing = editingView?.glaze

  const comboList = comboViews ?? []
  const strips = comboStrips(comboList)
  const selectedCombo =
    comboList.find((v) => v.combo.id === pickedComboId) ?? strips[0]?.combos[0]
  const onCombos = tab === 'combos' && !!selected
  // Like Add glaze, the header's Add combos waits until there's a combo; the
  // empty card offers it before then.
  const showHeaderAdd = onCombos ? !!selectedCombo : !!selected

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
        {showHeaderAdd ? (
          <button
            type="button"
            onClick={() => (onCombos ? setComboSheet({}) : setSheet({}))}
            className={addButton}
          >
            {onCombos ? 'Add combos' : 'Add glaze'}
          </button>
        ) : null}
      </div>
      {selected ? (
        <div className="flex gap-1 rounded-xl bg-[#dfe4e9] p-1">
          <button
            type="button"
            aria-pressed={tab === 'glazes'}
            onClick={() => setTab('glazes')}
            className={segment(tab === 'glazes')}
          >
            Glazes
          </button>
          <button
            type="button"
            aria-pressed={tab === 'combos'}
            onClick={() => setTab('combos')}
            className={segment(tab === 'combos')}
          >
            Combos
          </button>
        </div>
      ) : null}
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
      {onCombos && comboViews && !selectedCombo ? (
        <div className="flex flex-col items-start gap-4 rounded-card bg-surface p-5">
          <p className="text-[16px] text-muted">
            No combos yet. Add them from a photo of your studio's test tiles, or
            from a fired piece.
          </p>
          <button
            type="button"
            onClick={() => setComboSheet({})}
            className={addButton}
          >
            Add combos
          </button>
        </div>
      ) : null}
      {onCombos && selectedCombo ? (
        <>
          <ComboCard
            view={selectedCombo}
            onEdit={() => setComboSheet({ comboId: selectedCombo.combo.id })}
          />
          <ComboStrips
            strips={strips}
            selectedId={selectedCombo.combo.id}
            onSelect={(v) => setPickedComboId(v.combo.id)}
          />
        </>
      ) : null}
      {!onCombos && selected ? (
        <>
          <GlazeCard
            view={selected}
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
          firedPhotoIds={editingView ? firedPhotoIds(editingView.pieces) : []}
          liveGlazes={list.map((v) => v.glaze)}
          defaultCone={settings?.defaultCone ?? DEFAULT_SETTINGS.defaultCone}
          onClose={(savedId) => {
            if (savedId) setPickedId(savedId)
            setSheet(undefined)
          }}
        />
      ) : null}
      {comboSheet && !comboSheet.comboId ? (
        <AddCombos
          onClose={() => setComboSheet(undefined)}
          onSaved={(id) => {
            setTab('combos')
            setPickedComboId(id)
          }}
        />
      ) : null}
      <BottomBar />
    </main>
  )
}
