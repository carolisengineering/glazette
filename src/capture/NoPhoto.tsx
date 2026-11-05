/** The slim dashed placeholder shown where a photo would be. */
export function NoPhoto({ label }: { label: string }) {
  return (
    <div className="flex h-14 items-center justify-center rounded-2xl border-[1.5px] border-dashed border-border">
      <span className="text-[14px] text-muted">{label}</span>
    </div>
  )
}
