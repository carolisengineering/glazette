import { Link } from '@tanstack/react-router'

const tab =
  'flex w-[72px] flex-col items-center justify-center gap-[3px] text-[13px] font-medium no-underline min-h-11'

export function BottomBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-5 bottom-7 mx-auto flex h-[68px] max-w-[430px] items-center justify-around rounded-[34px] bg-ink/95 px-2.5"
    >
      <Link
        to="/"
        className={tab}
        activeProps={{ className: `${tab} text-white` }}
        inactiveProps={{ className: `${tab} text-[#aeb8c2]` }}
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
          <path d="M3 10h18M3 20h18M6 10V6h4v4M14 10V4h4v6M6 20v-6h5v6M15 20v-4h3v4" />
        </svg>
        Shelf
      </Link>
      <Link
        to="/capture"
        aria-label="New piece"
        className="flex size-14 items-center justify-center rounded-full bg-accent shadow-[0_6px_16px_rgba(23,84,116,0.45)]"
      >
        <svg
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </Link>
      <Link
        to="/glazes"
        className={tab}
        activeProps={{ className: `${tab} text-white` }}
        inactiveProps={{ className: `${tab} text-[#aeb8c2]` }}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="7" cy="7" r="3.5" />
          <circle cx="17" cy="7" r="3.5" />
          <circle cx="7" cy="17" r="3.5" />
          <circle cx="17" cy="17" r="3.5" />
        </svg>
        Glazes
      </Link>
    </nav>
  )
}
