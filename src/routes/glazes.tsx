import { BottomBar } from '../components/BottomBar'

/** Placeholder until the Glazes screen is built. */
export function GlazesScreen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col gap-5 px-5 pt-14 pb-32">
      <h1 className="font-serif text-[32px] leading-none font-normal">
        Glazes
      </h1>
      <BottomBar />
    </main>
  )
}
