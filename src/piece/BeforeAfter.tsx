export type Side = 'glazed' | 'fired'

const SIDES: { value: Side; label: string }[] = [
  { value: 'glazed', label: 'Before firing' },
  { value: 'fired', label: 'Out of the kiln' },
]

interface Props {
  value: Side
  onChange: (side: Side) => void
}

/** Toggle that sits over the hero photo and switches between glazed and fired. */
export function BeforeAfter({ value, onChange }: Props) {
  return (
    <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-3xl bg-white/90 p-1">
      {SIDES.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={value === s.value}
          onClick={() => onChange(s.value)}
          className={`h-11 rounded-[20px] px-[18px] text-[14px] font-semibold whitespace-nowrap ${
            value === s.value ? 'bg-ink text-white' : 'bg-transparent text-ink'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
