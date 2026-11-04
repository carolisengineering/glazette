export function KilnBanner({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <div className="flex items-center gap-3.5 rounded-[20px] bg-accent px-[18px] py-4 text-white">
      <div className="flex size-10 flex-none items-center justify-center rounded-xl bg-white/15">
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z" />
        </svg>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold">
          {count === 1 ? '1 piece' : `${count} pieces`} ready to bisque
        </span>
        <span className="text-sm text-white/80">Next bisque firing</span>
      </div>
    </div>
  )
}
