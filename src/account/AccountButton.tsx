import { useAccount } from './useAccount'

/** The round Account button in the shelf header: a person outline, or the email's initial when signed in. */
export function AccountButton({ onClick }: { onClick: () => void }) {
  const email = useAccount((s) =>
    s.status === 'signed-in' ? s.email : undefined,
  )
  return (
    <button
      type="button"
      aria-label={
        email ? `Account, signed in as ${email}` : 'Account, signed out'
      }
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink"
    >
      {email ? (
        <span aria-hidden="true" className="text-[16px] font-semibold">
          {email[0].toUpperCase()}
        </span>
      ) : (
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
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-3.9 3.6-6 8-6s8 2.1 8 6" />
        </svg>
      )}
    </button>
  )
}
