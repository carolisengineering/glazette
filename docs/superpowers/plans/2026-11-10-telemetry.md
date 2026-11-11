# Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a small, content-free set of usage events and timings from friends' phones to PostHog, so Carol can see who logs pieces, who comes back, and how fast the app feels.

**Architecture:** One client module (`src/telemetry/`) owns everything PostHog: a typed event list, a `track` call that never throws, identity that follows the account store, and a lazy-loaded PostHog client that's only created in a production build with a key. Call sites and a few data operations call `track`. The Worker gets a small pass-through route so events reach PostHog from the app's own address.

**Tech Stack:** posthog-js (1.447.x at time of writing), web-vitals 6.x, Hono in the existing Worker, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-10-telemetry-design.md`

## Global Constraints

- Telemetry runs only when `import.meta.env.MODE === 'production'` and `import.meta.env.VITE_POSTHOG_KEY` is non-empty. Dev, unit tests and e2e (`--mode e2e`) send nothing.
- Every property the app sets is a number, boolean, an ISO date (`YYYY-MM-DD`), or a string from a fixed list in the code (stage, screen, outcome, metric, kind). The signed-in email is the only free-form string, and it's used only as the person's ID. No piece, glaze, clay or studio names, no notes and no photos.
- `track`, `identify`, `resetIdentity` and `captureError` never throw and never await. Telemetry never blocks a save, a screen or sync.
- PostHog features off: autocapture, automatic pageviews and pageleaves, session recording, surveys, heatmaps, its own performance and exception capture, feature flags and remote config, and any external script loading. Check option names against the installed posthog-js types. The intent wins if a name has changed.
- No IP or location: register `$geoip_disable: true` on every event. The pass-through never forwards the client's IP or cookies.
- posthog-js loads by dynamic `import()` after the first render. Events before it loads are buffered, up to 100, then dropped.
- $0: PostHog free plan, Workers Free. The pass-through only forwards. It does no parsing or decompression.
- American spelling in new code, comments and copy.

## Review Focus

1. **PostHog blocked or offline at startup:** if the dynamic import or every request fails, the app behaves exactly as before and nothing logs an uncaught error. *Task 1 test: `init survives a failing loader`.*
2. **Storage blocked (private mode, Safari quirks):** if `localStorage` throws, telemetry init and the existing-user seeding still don't throw. *Task 3 test: `seeding survives blocked storage`.*
3. **Shared phone:** if one person signs out and another signs in, the second person's events never carry the first person's ID. *Task 3 test: `sign-out then sign-in as someone else resets in between`.*
4. **A telemetry failure inside a save:** if the sink throws during `track`, `createPiece` still resolves with the new ID and the piece is stored. *Task 4 test: `a throwing sink doesn't break createPiece`.*
5. **Pass-through abuse or leaks:** a cookie header is never forwarded, and paths outside PostHog's ingestion paths return 404 without calling PostHog. *Task 2 tests.*

---

### Task 1: Telemetry core

**Files:**
- Create: `src/telemetry/events.ts`, `src/telemetry/telemetry.ts`, `src/telemetry/telemetry.test.ts`, `src/telemetry/events.test.ts`
- Modify: `package.json` (add `posthog-js`)

**Interfaces:**
- Produces, in `events.ts`:
  - `type Screen = 'shelf' | 'piece' | 'glazes' | 'capture' | 'account' | 'backup'`
  - `type Outcome = 'done' | 'offline' | 'signed-out' | 'error'` (the same values as `SyncOutcome`)
  - `type EventProps`: a map from event name to its props:
    - `app_opened: { standalone: boolean; resumed: boolean }`
    - `screen_viewed: { screen: Screen }`
    - `piece_logged: { has_photo: boolean; stage: Stage; ms: number }`
    - `stage_added: { stage: Stage; has_photo: boolean; ms: number }`
    - `glazes_added: { layers: number }`
    - `piece_edited: { part: 'details' | 'notes' }`
    - `piece_lost: { lost: boolean }`
    - `piece_deleted: {}`
    - `step_deleted: {}`
    - `put_back: { kind: 'piece' | 'photo' }`
    - `signed_in: {}`
    - `signed_out: {}`
    - `backup_saved: { ms: number }`
    - `backup_restored: { ms: number }`
    - `startup: { ms: number; pieces: number }`
    - `piece_opened: { ms: number; has_photo: boolean }`
    - `photo_processed: { ms: number; megabytes: number }`
    - `sync_records: { ms: number; outcome: Outcome; pushed: number; pulled: number }`
    - `sync_photos: { ms: number; outcome: Outcome; uploaded: number; downloaded: number; bytes: number }`
    - `web_vital: { metric: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'; value: number }`
    - `telemetry_started: { first_piece_date?: string; pieces: number }`
  - `type EventName = keyof EventProps`
- Produces, in `telemetry.ts`:
  - `interface TelemetrySink { capture(name: string, props: Record<string, unknown>): void; identify(email: string): void; reset(): void; captureException(error: unknown): void }`
  - `track<N extends EventName>(name: N, props: EventProps[N]): void`
  - `identify(email: string): void`, `resetIdentity(): void`, `captureError(error: unknown): void`
  - `elapsed(start: number): number`: `Math.round(performance.now() - start)`
  - `telemetryEnabled(env: { MODE: string; VITE_POSTHOG_KEY?: string }): boolean`
  - `initTelemetry(load?: () => Promise<TelemetrySink>): void`. The default loader dynamically imports posthog-js, calls `init` with the Global Constraints settings and `api_host: '/api/t'`, and adapts it to `TelemetrySink`. Safe to call twice.
  - `setSinkForTests(sink: TelemetrySink | undefined): void`. Sets the sink directly and clears the buffer.

- [ ] **Step 1: Write the failing tests** (`telemetry.test.ts`)
  - `telemetryEnabled` is true only for `{ MODE: 'production', VITE_POSTHOG_KEY: 'phc_x' }`. It's false for `'e2e'`, `'development'`, and for production with `''` or a missing key.
  - `buffers until the sink loads`: `track` twice, then `initTelemetry` with a loader resolving to a fake sink. Await a tick. The fake gets both captures in order, with the props unchanged.
  - `drops past 100 buffered events`: 105 tracks before load, so the sink gets 100.
  - `init survives a failing loader`: the loader rejects. `track` afterwards doesn't throw, and there's no unhandled rejection (`await` a tick with `vi.fn` on `console.error` allowed).
  - `a throwing sink never throws out of track, identify, resetIdentity or captureError`.
  - `identify and reset are ordered with captures`: buffered `track('signed_in')`, `identify('a@b.c')`, `track('signed_out')`, `resetIdentity()` reach the sink in that order.
- [ ] **Step 2: Run** `pnpm vitest run src/telemetry/telemetry.test.ts`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement `events.ts` and `telemetry.ts`.** The buffer holds closures over the sink calls, so identify and reset keep their order. The default loader adds `$geoip_disable: true` with `register`.
- [ ] **Step 4: Write the privacy test** (`events.test.ts`)
  - `const EXAMPLES: { [N in EventName]: EventProps[N] }`, so the compiler forces one example per event.
  - The test asserts every value is a finite number, a boolean, a `YYYY-MM-DD` string, or a member of an `ALLOWED_STRINGS` set built from `STAGES` and the literal lists exported from `events.ts`. Export those lists as `as const` arrays and derive the types from them, so the test and the types can't drift.
- [ ] **Step 5: Run** `pnpm vitest run src/telemetry`. Expected: PASS. Then run `pnpm typecheck` and `pnpm lint`. Expected: clean.
- [ ] **Step 6: Commit:** `feat(telemetry): typed events and a sink that never throws`

### Task 2: Worker pass-through

**Files:**
- Create: `worker/telemetry.ts`, `worker/telemetry.test.ts`
- Modify: `worker/app.ts` (add `app.route('/t', telemetryRoutes())`), `worker/env.ts` (`POSTHOG_HOST: string`), `wrangler.jsonc` (`vars.POSTHOG_HOST: "https://us.i.posthog.com"`), `worker/test/harness.ts` (set `POSTHOG_HOST` in the test env)

**Interfaces:**
- Produces: `telemetryRoutes(): Hono<{ Bindings: Env }>`. It forwards `GET`/`POST /api/t/<path>?<query>` to `${POSTHOG_HOST}/<path>?<query>` when `<path>` starts with `e/`, `i/v0/e/`, `batch/` or `flags/`. Otherwise it returns 404 JSON, the same as the app's `notFound`.
- Forwarded headers are `content-type`, `content-encoding` and `user-agent` only. The body is streamed through untouched. The response passes back its status and body, plus `content-type`.

- [ ] **Step 1: Write the failing tests.** Use the `makeTestEnv` harness and stub `fetch` with `vi.stubGlobal`:
  - `forwards a batch to PostHog`: `POST /api/t/batch/?ver=1` with the app's `Origin`, a cookie and `cf-connecting-ip`. The stub sees `https://us.i.posthog.com/batch/?ver=1`, the same body bytes, and no `cookie`, `cf-connecting-ip` or `x-forwarded-for`. The client gets the stub's status.
  - `refuses other paths`: `POST /api/t/decide-anything-else` and `GET /api/t/static/array.js` return 404, and the stub is never called.
  - `still needs the app's origin`: a POST without a trusted `Origin` returns 403. This is the existing middleware, so it's a guard test.
- [ ] **Step 2: Run** `pnpm vitest run worker/telemetry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `worker/telemetry.ts` and wire it up.
- [ ] **Step 4: Run** `pnpm vitest run worker`. Expected: PASS, and existing Worker tests are unchanged.
- [ ] **Step 5: Commit:** `feat(worker): pass PostHog events through the app's own address`

### Task 3: Startup, identity, screens, vitals and errors

**Files:**
- Create: `src/telemetry/wire.ts`, `src/telemetry/wire.test.ts`
- Modify: `src/main.tsx`, `src/account/AccountButton.tsx` or `src/routes/shelf.tsx` (where the Account and Backup sheets open), `package.json` (add `web-vitals`), `.github/workflows/ci.yml` (deploy job's `pnpm build` gets `env: VITE_POSTHOG_KEY: ${{ vars.POSTHOG_KEY }}`), `src/vite-env.d.ts` or the existing env typing (`VITE_POSTHOG_KEY?: string`)

**Interfaces:**
- Consumes: Task 1's `track`, `identify`, `resetIdentity`, `captureError`, `initTelemetry`, `telemetryEnabled`. Also `useAccount` and `router` from `src/router.tsx`.
- Produces: `startTelemetry(deps?: { router?: AppRouter; db?: GlazetteDB }): void`, called once from `main.tsx` when `telemetryEnabled(import.meta.env)`. Safe to call twice.
- Also `screenFor(pathname: string): Screen | undefined`, which maps `/` → shelf, `/piece/...` → piece, `/glazes` → glazes, and `/capture` → capture.

`startTelemetry` does the following:
- Calls `initTelemetry()`.
- Identity follows `useAccount`: signed-in with an email → `identify(email)`. A change away from that email → `resetIdentity()`, then `identify` again if there's a new email. It acts on the current state at start too.
- `app_opened` at start (`resumed: false`) and on each `visibilitychange` to visible (`resumed: true`). `standalone` comes from `matchMedia('(display-mode: standalone)').matches` or `navigator.standalone`.
- `screen_viewed` on each resolved route change (`router.subscribe('onResolved', ...)`), using `screenFor`. It's also sent from wherever the Account and Backup sheets open (`account`, `backup`).
- Web vitals: `onLCP`, `onINP`, `onCLS`, `onFCP`, `onTTFB` from `web-vitals` → `web_vital`.
- Errors: `window` `error` and `unhandledrejection` listeners → `captureError`.
- Existing users, once per device: if `localStorage['glazette.telemetry.seeded']` is unset, read live pieces from Dexie and track `telemetry_started` with `pieces` and `first_piece_date`, the earliest `createdAt` cut to `YYYY-MM-DD`. Then set the flag. The default loader sends this event's props as `$set_once` as well. Each storage access is in try/catch.

- [ ] **Step 1: Write the failing tests** (`wire.test.ts`, a fake sink through `setSinkForTests`, a memory-history router from `createAppRouter`):
  - `identifies a signed-in device at start`.
  - `sign-out then sign-in as someone else resets in between`: sink calls are `identify(a)`, `reset()`, `identify(b)`.
  - `app_opened on start and on return`: one with `resumed: false`, then after a `visibilitychange` to visible, one with `resumed: true`.
  - `screen_viewed follows navigation`: navigating to `/piece/x` sends `{ screen: 'piece' }`.
  - `screenFor maps every route`, and returns undefined for unknown paths.
  - `seeds existing pieces once`: two pieces with `createdAt` `2026-10-03T…` and `2026-10-20T…`, so `telemetry_started` is `{ pieces: 2, first_piece_date: '2026-10-03' }`. A second `startTelemetry` after `stopTelemetryForTests()` doesn't send it again.
  - `seeding survives blocked storage`: `localStorage.getItem` throws, and `startTelemetry` doesn't throw.
  - `uncaught errors are captured`: dispatching an `ErrorEvent` on `window` calls `captureException`.
- [ ] **Step 2: Run** `pnpm vitest run src/telemetry/wire.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `wire.ts`, add the `stopTelemetryForTests()` export that undoes listeners, call `startTelemetry` from `main.tsx`, and add the CI env line.
- [ ] **Step 4: Run** `pnpm vitest run src/telemetry && pnpm typecheck && pnpm lint`. Expected: PASS and clean.
- [ ] **Step 5: Commit:** `feat(telemetry): identity, app opens, screens, vitals and errors`

### Task 4: Usage events

**Files:**
- Modify: `src/db/ops.ts` (`createPiece`, `addStageEntry`, `addGlazesToPiece`), `src/routes/piece.tsx` (lost toggle, notes save, step delete, piece delete), `src/piece/EditSheet.tsx`, `src/account/useAccount.ts` (`signedIn`, `signOut`), `src/account/RecentlyDeleted.tsx`, `src/backup/BackupSheet.tsx`, and their existing tests

**Interfaces:**
- Consumes: `track`, `elapsed` from Task 1.

Where each event fires (after the operation succeeds, outside any Dexie transaction):
- `createPiece` → `piece_logged { has_photo, stage, ms }`. `stage` is the stage it was created at, and `ms` is the whole call. One event per successful call.
- `addStageEntry` → `stage_added { stage, has_photo, ms }`.
- `addGlazesToPiece` → `glazes_added { layers: glazes.length }`, only when it added rows.
- EditSheet save → `piece_edited { part: 'details' }`. A notes save in `piece.tsx` (the explicit save and the flush) → `piece_edited { part: 'notes' }`, only when the text changed.
- Lost toggle → `piece_lost { lost }`. Piece delete confirmed → `piece_deleted`. Step delete confirmed → `step_deleted`. This is the spec's "photo removed": deleting a step is how a photo leaves the journey.
- `RecentlyDeleted` put-back success → `put_back { kind }`.
- `useAccount.signedIn` → `signed_in`. `useAccount.signOut` → `signed_out` at its start, before the identity reset.
- Backup save finished (not canceled) → `backup_saved { ms }`. Restore finished → `backup_restored { ms }`.

- [ ] **Step 1: Write the failing tests** in the existing test files, with a fake sink from `setSinkForTests`:
  - `ops.test.ts`: `createPiece reports piece_logged` with a photo, so `has_photo: true, stage: 'thrown'` and `ms` is a number. `addStageEntry reports stage_added`. `addGlazesToPiece reports glazes_added only when it adds`.
  - `ops.test.ts`: `a throwing sink doesn't break createPiece`. The fake sink's `capture` throws. The call resolves, and `db.pieces.get(id)` exists.
  - `ops.test.ts`: `a failed createPiece reports nothing`.
  - `useAccount.test.ts`: `signedIn and signOut report`.
  - `routes/piece.test.tsx`: `deleting a piece reports piece_deleted` and `marking lost reports piece_lost`.
  - `BackupSheet.test.tsx`: `a canceled save reports nothing`.
- [ ] **Step 2: Run** the touched test files. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS and clean.
- [ ] **Step 5: Commit:** `feat(telemetry): report pieces, steps, edits, sign-in and backups`

### Task 5: Timings

**Files:**
- Create: `src/telemetry/counting.ts`, `src/telemetry/counting.test.ts`
- Modify: `src/routes/shelf.tsx` (startup), `src/routes/piece.tsx`, `src/piece/Hero.tsx`, `src/components/PhotoImg.tsx` (an optional `onShown?: () => void` called from the `<img>`'s `onLoad`), `src/routes/capture.tsx` (photo processed), `src/sync/useSync.ts` (sync timings)

**Interfaces:**
- Consumes: `track`, `elapsed`.
- Produces, in `counting.ts`:
  - `countingTransport(inner: Transport): { transport: Transport; counts(): { pushed: number; pulled: number } }`. It counts `records.length` sent by `push` and received by `pull`.
  - `countingPhotoTransport(inner: PhotoTransport): { transport: PhotoTransport; counts(): { uploaded: number; downloaded: number; bytes: number } }`. It counts `stored` uploads of part `'full'` as photos. `bytes` sums the `size` of uploaded and downloaded blobs. A download is counted when it returns a non-null `'full'` part.

Timings:
- **Startup:** in `ShelfScreen`, the first time `usePiecesQuery()` is non-undefined in this page load (a module-level flag) → `startup { ms: Math.round(performance.now()), pieces: loaded.length }`. `performance.now()` counts from navigation start.
- **Piece opened:** in `PieceScreen`, record `performance.now()` on mount. Report once when the hero photo's `onShown` fires, or as soon as the piece data shows if the hero has no photo → `piece_opened { ms, has_photo }`.
- **Photo processed:** around `processImage` in `capture.tsx` `onFile`, on success → `photo_processed { ms, megabytes }`. `megabytes` is the original file's `file.size / 1e6`, rounded to one decimal. That's a cheap stand-in for the original's resolution, which the spec asks for, and it doesn't need an extra decode.
- **Sync:** in `runRecords`, wrap `fetchTransport` with `countingTransport` and time `syncOnce` → `sync_records { ms, outcome, pushed, pulled }`. In `loop`, wrap `fetchPhotoTransport` and time `transferPhotos` → `sync_photos { ms, outcome, uploaded, downloaded, bytes }`. Only send `sync_photos` when something moved or the outcome isn't `done`, so idle syncs don't flood events.

- [ ] **Step 1: Write the failing tests:**
  - `counting.test.ts`: `counts pushed and pulled records` and `counts full-photo uploads and bytes, not thumbnails`, against `src/sync/testServer.ts` and `testPhotoServer.ts`.
  - `useSync.test.ts`: `reports one sync_records per record sync with its outcome`, and `an idle photo transfer reports nothing`.
  - `shelf.test.tsx`: `reports startup once`. Rendering the shelf twice in one test module gives one `startup` event.
  - `piece.test.tsx`: `reports piece_opened for a piece without a photo`.
- [ ] **Step 2: Run** the touched test files. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `onShown` is optional and changes nothing when it's missing.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS and clean.
- [ ] **Step 5: Commit:** `feat(telemetry): time startup, piece open, photo processing and sync`

### Task 6: Carol's PostHog guide and final checks

**Files:**
- Create: `docs/posthog.md`

- [ ] **Step 1: Write `docs/posthog.md`** in plain English, under one page:
  - The setup steps from the spec's pre-merge list:
    - the free plan and billing limit;
    - "Discard client IP data";
    - the project key goes in the GitHub repo variable `POSTHOG_KEY`;
    - if the project is in the EU, change `POSTHOG_HOST` in `wrangler.jsonc` to `https://eu.i.posthog.com`.
  - How to build a retention insight on `app_opened` per person. It also explains reading `first_piece_date`, so existing friends aren't mistaken for new ones.
  - How to build a trends insight on the median and 90th percentile of `ms` for `startup`, `piece_opened`, `photo_processed`, `piece_logged`, `stage_added` and `sync_records`, broken down by OS.
  - How to filter out Carol's own email.
  - The event list, one line each, saying what it means.
- [ ] **Step 2: Run the full check:** `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm exec playwright test`. Expected: all pass.
- [ ] **Step 3: Confirm nothing ships without a key.** After `pnpm build` with no `VITE_POSTHOG_KEY`, `grep -r "api/t" dist/assets` may find the bundled code, but `telemetryEnabled` is false, so `initTelemetry` never runs. The e2e run makes no requests to `/api/t`. Add `page.on('request')` to one existing spec in `e2e/offline.spec.ts`, asserting no URL contains `/api/t/`.
- [ ] **Step 4: Commit:** `docs: how to read Glazette's telemetry in PostHog`
