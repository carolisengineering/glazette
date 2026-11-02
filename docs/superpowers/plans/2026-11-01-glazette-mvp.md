# Glazette MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 Glazette PWA: a photo-first, offline, on-device journal where a wheel-throwing potter logs each piece through five stages and builds a glaze library of real fired results.

**Architecture:** A client-only React SPA. All records and photos live in IndexedDB through Dexie, read by components with `useLiveQuery`, so the database is the single source of truth and screens update themselves. The camera is the native one through a file input; a Zustand store carries the captured photo between the review, pick-a-piece and stage-strip screens until a piece is chosen and the entry is written. Deployed as static assets on Cloudflare Workers.

**Tech Stack:** React 19, TypeScript, Vite, TanStack Router, Dexie 4, Tailwind v4, shadcn/ui on Base UI, Zustand, vite-plugin-pwa, fflate (zip), exifr (EXIF date), Vitest 4 + React Testing Library + fake-indexeddb, Playwright, Biome, pnpm, GitHub Actions, wrangler.

**Spec:** `docs/glazette-mvp-spec.md` (sections 4–8 drive this plan). Mockups: `docs/mockups/project/*.dc.html` and `docs/mockups/README.md`.

## Global Constraints

- Stages are exactly `'thrown' | 'trimmed' | 'bisqued' | 'glazed' | 'fired'`, in that order. A piece never moves backward; its current stage is derived from its latest `StageEntry`, never stored.
- Nothing is required: every form field is optional and every screen has a working default.
- Deletes are soft (`deletedAt` ISO string). Deleted rows never appear in the UI and are stripped on export.
- Photos: JPEG at quality 0.8, max 2000px long edge, plus a ~400px thumbnail, content-addressed by SHA-256 hash.
- Design tokens (section 7): Background `#EEF1F4`, Surface `#FFFFFF`, Ink `#16202A`, Muted `#5B6672`, Border `#D5DBE1`, Accent `#175474`, Accent tint `#E3ECF1`, Camera `#0E151C`. Fonts: Instrument Serif for names and screen titles, Inter elsewhere. Card radius 20–24px, pill chips, touch targets ≥ 44px.
- Defaults (section 2.1): clay "White stoneware"; Bisqued note "Cone 6"; glaze cone "6"; Fired note "Cone 6 oxidation". Pre-filled, never locked.
- Copy: "Untitled <form>" (e.g. "Untitled bowl") when a piece has no name; "(retired)" suffix for a deleted glaze or clay; Shelf title "The Shelf"; kiln banner "N pieces ready to bisque" / "1 piece ready to bisque"; before/after labels "Before firing" / "Out of the kiln".
- American spelling in all UI copy, comments and docs.
- No server, no telemetry endpoint, no dark mode in v1.

## Review Focus

1. **Sideways photos.** A portrait iPhone photo arrives with an EXIF orientation tag; the stored JPEG must be upright. Pinned by Task 4's `processImage` orientation test (Playwright, since jsdom has no canvas).
2. **HEIC from the iOS library picker.** `createImageBitmap` may reject HEIC; the app must show "This photo format isn't supported" and return to the review screen, not hang on a spinner. Pinned by Task 4's rejection test.
3. **Partial records after import.** A piece with zero stage entries or an entry whose `photoId` points nowhere must still render on the Shelf and in detail. Pinned by Task 2's `currentStage([])` test and Task 8's missing-photo render test.
4. **Re-importing the same photo.** Choosing a library photo already logged must reuse the existing `Photo` row, not store a second copy. Pinned by Task 4's `savePhoto` dedupe test.
5. **Storage failure mid-save.** If the Photo write throws (quota), no orphan `StageEntry` may be left behind and the user sees "Couldn't save. Free up space and try again." Pinned by Task 3's transaction-rollback test and Task 7's error-toast test.

---

### Task 1: Scaffold, tooling and design tokens

**Files:**
- Create: Vite project at repo root via `pnpm create cloudflare@latest -- . --framework=react` (accept TypeScript, no git init since the repo exists)
- Create: `biome.json`, `vitest.config.ts`, `src/test/setup.ts`
- Create: `src/styles/app.css` (Tailwind v4 import + `@theme` tokens + Google Fonts link in `index.html`)
- Modify: `package.json` scripts: `dev`, `build`, `test`, `lint`, `typecheck`
- Modify: `.gitignore` (keep the existing `notes/` line; add `node_modules`, `dist`, `.wrangler`)
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` all green; Tailwind classes `bg-background`, `bg-surface`, `text-ink`, `text-muted`, `border-border`, `bg-accent`, `bg-accent-tint`, `bg-camera`, `font-serif` (Instrument Serif), `font-sans` (Inter), `rounded-card` (22px).

- [ ] **Step 1: Scaffold with the Cloudflare React template, then add dependencies**

```bash
pnpm add dexie dexie-react-hooks zustand @tanstack/react-router fflate exifr
pnpm add -D @biomejs/biome vitest@4 @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event fake-indexeddb tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Write the failing smoke test**

```tsx
// src/App.test.tsx
import { render, screen } from '@testing-library/react';
import App from './App';
test('renders the Shelf title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it to verify it fails** — `pnpm test` → FAIL: heading not found.

- [ ] **Step 4: Replace the template `App.tsx` with a page that renders `<h1 className="font-serif">The Shelf</h1>` on `bg-background`; declare the tokens in `src/styles/app.css`**

```css
@import "tailwindcss";
@theme {
  --color-background: #EEF1F4; --color-surface: #FFFFFF; --color-ink: #16202A;
  --color-muted: #5B6672; --color-border: #D5DBE1; --color-accent: #175474;
  --color-accent-tint: #E3ECF1; --color-camera: #0E151C;
  --font-serif: "Instrument Serif", Georgia, serif; --font-sans: Inter, system-ui, sans-serif;
  --radius-card: 22px;
}
```

- [ ] **Step 5: Configure Biome (recommended rules + `a11y` + `react` hooks domain), Vitest (`environment: 'jsdom'`, `setupFiles: ['src/test/setup.ts']` importing `fake-indexeddb/auto` and jest-dom)**

- [ ] **Step 6: Run `pnpm test && pnpm lint && pnpm typecheck && pnpm build`** — all PASS. If Biome lacks `react-hooks/exhaustive-deps` or `jsx-a11y` coverage, note it in the commit and switch to ESLint + Prettier per spec 8.1.

- [ ] **Step 7: Commit** — `chore: scaffold Vite React PWA with tokens and test tooling`

---

### Task 2: Data model and pure stage logic

**Files:**
- Create: `src/db/types.ts` (the section 6 interfaces, verbatim), `src/db/db.ts`, `src/db/stage.ts`
- Test: `src/db/stage.test.ts`, `src/db/db.test.ts`

**Interfaces:**
- Produces: `db` (Dexie instance) with tables `pieces`, `entries`, `glazeApps`, `glazes`, `clays`, `photos`, `settings`; `STAGES: readonly Stage[]`; `currentStage(entries: StageEntry[]): Stage | undefined`; `nextStage(stage: Stage | undefined): Stage | undefined`; `latestEntry(entries, stage?): StageEntry | undefined`; `displayName(piece: Piece): string`; `dayCount(piece: Piece, now: Date): number`; `Settings { id: 'app'; defaultClayId?: string; defaultCone: string; bisqueNote: string; firedNote: string }`.

- [ ] **Step 1: Write failing tests**

```ts
// src/db/stage.test.ts
test('currentStage is the latest entry by date, ignoring deleted', ...)   // entries [thrown d1, glazed d3 (deleted), trimmed d2] → 'trimmed'
test('currentStage of no entries is undefined', ...)
test('nextStage: thrown→trimmed … fired→undefined, undefined→thrown', ...)
test('latestEntry(entries, "glazed") returns the newest glazed entry', ...)
test('displayName falls back to "Untitled bowl" / "Untitled piece"', ...) // form 'bowl' → "Untitled bowl"; no form → "Untitled piece"
test('dayCount counts whole days since createdAt', ...)
// src/db/db.test.ts
test('schema has the seven tables and compound index entries.[pieceId+date]', ...)
```

- [ ] **Step 2: Run** `pnpm test src/db` → FAIL (modules missing).

- [ ] **Step 3: Implement.** Dexie v4 schema: `pieces: 'id, updatedAt, deletedAt'`, `entries: 'id, pieceId, [pieceId+date], stage, deletedAt'`, `glazeApps: 'id, entryId, pieceId, glazeId'`, `glazes: 'id, name, deletedAt'`, `clays: 'id, name, deletedAt'`, `photos: 'id, hash'`, `settings: 'id'`. Ids are `crypto.randomUUID()`.

- [ ] **Step 4: Run** `pnpm test src/db` → PASS.
- [ ] **Step 5: Commit** — `feat(db): Dexie schema and stage derivation`

---

### Task 3: Write operations and defaults

**Files:**
- Create: `src/db/ops.ts`, `src/db/seed.ts`
- Test: `src/db/ops.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `ensureDefaults(): Promise<void>` — creates clay "White stoneware" and the `settings` row (`defaultCone '6'`, `bisqueNote 'Cone 6'`, `firedNote 'Cone 6 oxidation'`) once.
  - `createPiece(input: { photoId?: string; name?: string; form?: Piece['form']; clayId?: string; date?: string }): Promise<string>` — inserts the piece and a Thrown entry in one transaction; returns piece id.
  - `addStageEntry(input: { pieceId: string; stage: Stage; photoId?: string; note?: string; date?: string; glazes?: Array<{ glazeId: string; dips?: number; method?: GlazeApplication['method']; note?: string }> }): Promise<string>` — one transaction; writes `GlazeApplication` rows with `order` = array index; bumps `piece.updatedAt`.
  - `updatePiece(id, patch: Partial<Pick<Piece,'name'|'form'|'clayId'|'notes'>>)`, `markLost(id, lost: boolean)`, `softDelete(table: 'pieces'|'entries'|'photos'|'glazes'|'clays', id)`.
  - `upsertGlaze(input: Omit<Glaze,'id'|'deletedAt'> & { id?: string }): Promise<string>`, `upsertClay(name: string): Promise<string>` (case-insensitive match on existing name).
  - `defaultNoteFor(stage: Stage, settings: Settings): string` — `'bisqued'` → bisqueNote, `'fired'` → firedNote, else `''`.

- [ ] **Step 1: Write failing tests** (each test runs `db.delete()` then `db.open()` in `beforeEach`)

```ts
test('ensureDefaults is idempotent: one clay, one settings row after two calls')
test('createPiece writes piece + thrown entry; currentStage is thrown')
test('addStageEntry glazed writes GlazeApplication rows in order 0,1 and bumps updatedAt')
test('addStageEntry rolls back the entry when the glazeApps write throws')  // spy db.glazeApps.bulkAdd to throw; expect entries count unchanged
test('softDelete sets deletedAt and pieceQueries exclude it')
test('upsertClay("white STONEWARE") returns the existing id')
test('defaultNoteFor bisqued/fired/thrown')
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `db.transaction('rw', ...)`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(db): piece, entry, glaze and clay operations with defaults`

---

### Task 4: Photo pipeline

**Files:**
- Create: `src/photos/fit.ts`, `src/photos/hash.ts`, `src/photos/process.ts`, `src/photos/store.ts`
- Test: `src/photos/fit.test.ts`, `src/photos/hash.test.ts`, `src/photos/store.test.ts`, `e2e/photos.spec.ts` (Playwright, created here; runner configured in Task 12)

**Interfaces:**
- Consumes: `db.photos`.
- Produces:
  - `fitWithin(w: number, h: number, max: number): { w: number; h: number }` — never upscales.
  - `sha256(blob: Blob): Promise<string>` (hex).
  - `processImage(file: File): Promise<{ blob: Blob; thumb: Blob; width: number; height: number; hash: string; takenAt: string }>` — `createImageBitmap(file, { imageOrientation: 'from-image' })`, resize on `OffscreenCanvas`, `convertToBlob({ type: 'image/jpeg', quality: 0.8 })`, long edge 2000, thumb long edge 400; `takenAt` from `exifr.parse(file, ['DateTimeOriginal'])` else `new Date().toISOString()`. Throws `UnsupportedImageError` when decoding fails.
  - `savePhoto(file: File): Promise<string>` — returns the existing photo id when `hash` matches, else inserts and returns the new id.

- [ ] **Step 1: Write failing unit tests**

```ts
test('fitWithin(4000,3000,2000) → {2000,1500}; fitWithin(800,600,2000) → {800,600}')
test('sha256 of the same bytes is stable and 64 hex chars')
test('savePhoto returns the same id for a file with the same bytes')   // stub processImage via vi.mock
```

- [ ] **Step 2: Write the Playwright spec** (runs against `pnpm dev`, uses `page.setInputFiles` with `e2e/fixtures/portrait-rotated.jpg` (EXIF orientation 6) and `e2e/fixtures/sample.heic`)

```ts
test('rotated portrait photo is stored upright', ...)        // call window.__glazette.processImage in page; expect height > width
test('HEIC rejection shows the unsupported-format message', ...)
```

- [ ] **Step 3: Run** unit tests → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS (unit now; E2E after Task 12).
- [ ] **Step 6: Commit** — `feat(photos): resize, hash and store captured images`

---

### Task 5: App shell, routing and Shelf

**Files:**
- Create: `src/router.tsx`, `src/routes/shelf.tsx`, `src/routes/piece.tsx` (stub), `src/routes/glazes.tsx` (stub), `src/routes/capture.tsx` (stub), `src/components/BottomBar.tsx`, `src/components/PieceCard.tsx`, `src/components/StageChips.tsx`, `src/components/KilnBanner.tsx`, `src/components/PhotoImg.tsx`, `src/db/queries.ts`, `src/styles/grid.css`
- Modify: `src/App.tsx`
- Test: `src/db/queries.test.ts`, `src/routes/shelf.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - Routes `/`, `/piece/$id`, `/glazes`, `/capture` (search params `pieceId?`).
  - `usePieces(): PieceView[]` where `PieceView = { piece: Piece; entries: StageEntry[]; stage?: Stage; latestPhotoId?: string; clayName?: string; glazeNames: string[] }` (live, excludes deleted).
  - `filterShelf(views: PieceView[], chip: 'all' | Stage | 'lost', now: Date): PieceView[]` — `'all'` drops lost pieces and fired pieces whose latest fired entry is older than 14 days; `'fired'` shows every fired, non-lost piece; `'lost'` shows lost pieces.
  - `chipCounts(views, now): Record<'all' | Stage | 'lost', number>`.
  - `PhotoImg({ photoId, thumb?: boolean })` — reads the blob with `useLiveQuery`, object URL revoked on unmount, neutral placeholder when missing.
  - `<KilnBanner count={n} />` text per Global Constraints.

- [ ] **Step 1: Write failing tests**

```ts
// queries.test.ts
test('filterShelf all hides a piece fired 15 days ago but keeps one fired 13 days ago')
test('filterShelf fired shows both')
test('filterShelf all hides lost; lost shows only lost')
test('chipCounts matches filterShelf lengths for every chip')
// shelf.test.tsx (seed db, render router at "/")
test('shows "2 pieces ready to bisque" when two pieces are trimmed')
test('Lost chip is absent until a piece is lost')
test('card shows "Untitled bowl", stage label, clay name and "Day 3"')
test('advance arrow navigates to /capture?pieceId=<id>')
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the Main board (two-column grid, 5-segment progress bar, chip row with counts, floating dark bottom bar). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(shelf): routing, live piece grid, filters and kiln banner`

---

### Task 6: Capture, review and new piece

**Files:**
- Create: `src/capture/store.ts` (Zustand), `src/capture/CameraInput.tsx`, `src/capture/Review.tsx`, `src/capture/NewPieceSheet.tsx`
- Modify: `src/routes/capture.tsx`
- Test: `src/capture/store.test.ts`, `src/capture/capture.test.tsx`

**Interfaces:**
- Consumes: `savePhoto`, `createPiece`, `upsertClay`, `ensureDefaults`.
- Produces:
  - `useCaptureStore`: `{ file?: File; photoId?: string; takenAt?: string; pieceId?: string; mode: 'new' | 'update'; setFile(file), setPhotoId(id, takenAt), setPieceId(id?), reset() }`.
  - `/capture` without `pieceId`: a hidden `<input type="file" accept="image/*" capture="environment">` clicked on mount, plus a visible "Choose from library" button (same input without `capture`). After a file is chosen: `savePhoto` runs, the Review screen shows the photo on `bg-camera` with a New piece / Update toggle (Capture board), "Retake", and "Use photo".
  - `/capture?pieceId=X`: skips the toggle and pick step; goes straight to Task 7's stage strip after the photo.
  - New piece path: `createPiece({ photoId, date: takenAt })` immediately on "Use photo", then the details sheet (NewPieceSheet) with Name ("Name it later" placeholder), Form chips, Clay chips recent-first with the default clay preselected; "Done" → `/`.

- [ ] **Step 1: Write failing tests**

```ts
test('store reset clears file, photoId and pieceId')
test('choosing a file in New mode creates a piece at Thrown with the photo and opens the details sheet')  // mock savePhoto → 'p1'
test('details sheet Done with name "Morning Mug" and form Mug updates the piece')
test('Retake clears the photo and reopens the file input')
test('unsupported image shows "This photo format isn\'t supported" and stays on review')
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(capture): native camera input, review screen and new piece sheet`

---

### Task 7: Pick a piece and stage strip

**Files:**
- Create: `src/capture/PickPieceSheet.tsx`, `src/capture/StageStrip.tsx`, `src/capture/GlazeRows.tsx`, `src/components/Toast.tsx`
- Modify: `src/routes/capture.tsx`
- Test: `src/capture/pick.test.tsx`, `src/capture/stage-strip.test.tsx`

**Interfaces:**
- Consumes: `usePieces`, `addStageEntry`, `nextStage`, `defaultNoteFor`, `useCaptureStore`, glazes table.
- Produces:
  - `PickPieceSheet({ onPick(pieceId), onNew() })`: the PickPiece board. List of in-progress pieces (not lost, not fired), most recently updated first, search box filtering by name, clay or glaze name; "Not here? Save as a new piece" → `onNew`; button label `Add to <name>`.
  - `StageStrip({ pieceId, photoId, takenAt })`: five stage chips, `nextStage(current)` preselected (current stage selectable for a second photo; any later stage allowed; earlier stages disabled); note field prefilled with `defaultNoteFor`; when selection is `glazed`, `GlazeRows` appears; button `Save to <Stage>` or `Save photo` when the selected stage equals the current one. On save: `addStageEntry` then navigate to `/piece/$id`. On thrown error: Toast "Couldn't save. Free up space and try again." and stay.
  - `GlazeRows({ value, onChange })` where `value: Array<{ glazeId?: string; name: string; dips?: number; method?: GlazeApplication['method']; note?: string }>`: autocomplete input against glazes, "+ add another glaze" adds a row, each row has dips, method select, note. Unknown names create a glaze via `upsertGlaze({ name, cone: settings.defaultCone, color: '#9DBBAA' })` at save.

- [ ] **Step 1: Write failing tests**

```ts
test('pick sheet lists only in-progress pieces, newest first, and filters by search')
test('stage strip preselects Trimmed for a Thrown piece and disables earlier stages')
test('selecting Glazed shows glaze rows; saving writes two GlazeApplications in order')
test('Bisqued note is prefilled with "Cone 6"')
test('save failure shows the toast and does not navigate')
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(capture): pick-a-piece sheet and stage strip with glaze rows`

---

### Task 8: Piece detail

**Files:**
- Create: `src/routes/piece.tsx` (replace stub), `src/piece/Hero.tsx`, `src/piece/BeforeAfter.tsx`, `src/piece/FactCards.tsx`, `src/piece/Timeline.tsx`, `src/piece/EditSheet.tsx`, `src/styles/timeline.css`, `src/styles/reveal.css`
- Test: `src/routes/piece.test.tsx`

**Interfaces:**
- Consumes: `usePiece(id)` (add to `queries.ts`: single `PieceView` plus `glazeApps` and `photos`), `latestEntry`, `updatePiece`, `markLost`, `softDelete`.
- Produces: the Piece board. Hero = latest entry photo. `BeforeAfter` renders only when a fired entry exists, toggling between the latest glazed and latest fired photos with labels "Before firing" / "Out of the kiln". Fact cards: Clay (name or "(retired)" suffix when the clay is deleted), Glaze (names from the latest glazed entry, joined with " + "), Firing (cone from the glaze or settings). Timeline: one row per entry, newest first, thumbnail, note, date. Notes textarea saves on blur. Actions: Advance → `/capture?pieceId`, Add photo → same, Edit → EditSheet (name, form, clay), Mark as lost (toggle), Delete (confirm dialog → `softDelete`, then `/`).

- [ ] **Step 1: Write failing tests**

```ts
test('before/after toggle is absent until a fired entry exists, then shows both labels')
test('renders when the latest entry has no photo and when the piece has no entries')
test('clay card shows "Speckled buff (retired)" when the clay is deleted')
test('Mark as lost sets piece.lost; Delete asks to confirm and then soft-deletes')
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(piece): detail screen with before/after, timeline and actions`

---

### Task 9: Glazes

**Files:**
- Create: `src/routes/glazes.tsx` (replace stub), `src/glazes/SwatchWall.tsx`, `src/glazes/GlazeCard.tsx`, `src/glazes/GlazeSheet.tsx`, `src/glazes/swatch.ts`
- Test: `src/glazes/swatch.test.ts`, `src/routes/glazes.test.tsx`

**Interfaces:**
- Consumes: `usePieces`, glazes and glazeApps tables, `upsertGlaze`, `softDelete`.
- Produces:
  - `useGlazeViews(): Array<{ glaze: Glaze; pieceIds: string[]; swatchPhotoId?: string }>` — `swatchPhotoId` is the photo of the newest fired entry among pieces whose latest glazed entry includes this glaze.
  - `centerCropStyle(width: number, height: number): CSSProperties` — `object-fit: cover; object-position: center` applied to a square tile (the "automatic center-crop").
  - Swatch wall (3 columns) per the Glazes board; tile shows the cropped photo or `glaze.color`. Selected card: name, "Cone N · used on N pieces", piece thumbnails, `notes` as the tip. "Add glaze" and edit open `GlazeSheet` (name, cone default from settings, color input, notes). Delete → soft delete; pieces keep showing the name with "(retired)".

- [ ] **Step 1: Write failing tests**

```ts
test('swatchPhotoId is the newest fired photo among pieces using the glaze, undefined when none fired')
test('card copy: "Cone 6 · used on 1 piece" singular and "pieces" plural')
test('add glaze sheet saves with cone "6" when left blank')
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(glazes): swatch wall, glaze detail and editor`

---

### Task 10: Export and import

**Files:**
- Create: `src/backup/export.ts`, `src/backup/import.ts`, `src/backup/BackupSheet.tsx` (reached from a gear button on the Shelf header)
- Test: `src/backup/backup.test.ts`

**Interfaces:**
- Consumes: all tables, `fflate` (`zipSync`/`unzipSync`).
- Produces:
  - `exportZip(): Promise<Blob>` — `glazette.json` = `{ version: 1, exportedAt, pieces, entries, glazeApps, glazes, clays, settings, photos: Array<Omit<Photo,'blob'|'thumb'>> }` with every row whose `deletedAt` is unset; files `photos/<hash>.jpg`. Downloaded as `glazette-YYYY-MM-DD.zip`.
  - `importZip(file: File): Promise<{ added: number; skipped: number }>` — records upsert by `id` (newer `updatedAt`/`date` wins, otherwise existing kept), photos skipped when a row with the same `hash` exists, thumbs regenerated with `processImage`.

- [ ] **Step 1: Write failing tests**

```ts
test('export excludes soft-deleted rows and names photos by hash')
test('import into an empty db restores every table; importing the same zip twice adds 0 and skips all')
test('import merges: existing piece with newer updatedAt is kept')
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(backup): zip export and merge import`

---

### Task 11: PWA and persistence

**Files:**
- Modify: `vite.config.ts` (vite-plugin-pwa, `generateSW`, `registerType: 'prompt'`, `globPatterns` for the app shell only, `navigateFallback: '/index.html'`), `index.html` (theme-color `#EEF1F4`, icons), `src/main.tsx`
- Create: `public/icons/*.png` (192, 512, maskable), `src/pwa/ReloadPrompt.tsx`, `src/pwa/persist.ts`
- Test: `src/pwa/persist.test.ts`, `src/pwa/ReloadPrompt.test.tsx`

**Interfaces:**
- Produces: `requestPersistence(): Promise<boolean>` — calls `navigator.storage.persist()` once per install (flag in `settings`), returns the result, never throws when the API is missing. `ReloadPrompt` shows "New version available" with a "Reload" button when `useRegisterSW` reports `needRefresh`.

- [ ] **Step 1: Write failing tests**

```ts
test('requestPersistence resolves false when navigator.storage is undefined')
test('requestPersistence calls persist() once across two invocations')
test('ReloadPrompt renders the Reload button only when needRefresh is true')  // mock virtual:pwa-register/react
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `pnpm build` emits `sw.js` and `manifest.webmanifest`.
- [ ] **Step 5: Commit** — `feat(pwa): service worker, install manifest and persistent storage`

---

### Task 12: Playwright end-to-end

**Files:**
- Create: `playwright.config.ts` (webServer: `pnpm build && pnpm preview`, Chromium + WebKit), `e2e/offline.spec.ts`, `e2e/persistence.spec.ts`, `e2e/fixtures/portrait-rotated.jpg`, `e2e/fixtures/sample.heic`
- Modify: `src/main.tsx` to expose `window.__glazette = { processImage }` when `import.meta.env.MODE !== 'production'`

**Interfaces:**
- Consumes: Task 4's `e2e/photos.spec.ts`.

- [ ] **Step 1: Write the specs**

```ts
// offline.spec.ts
test('app shell loads after going offline and reloading')   // visit /, wait for SW active, context.setOffline(true), reload, expect heading "The Shelf"
// persistence.spec.ts
test('a piece created with a photo survives closing and reopening the browser context')  // setInputFiles on the capture input, "Use photo", "Done"; new context on the same storageState dir; expect one card
```

- [ ] **Step 2: Run** `pnpm exec playwright test` → all three spec files PASS (including Task 4's).
- [ ] **Step 3: Commit** — `test(e2e): offline reload, persistence and photo pipeline`

---

### Task 13: CI/CD and deploy

**Files:**
- Create: `.github/workflows/ci.yml`, `wrangler.jsonc` (static assets, `not_found_handling: 'single-page-application'`), `README.md` (run, test, deploy)
- Modify: `package.json` script `deploy: wrangler deploy`

**Interfaces:**
- Produces: on every push and PR: install (pnpm, cached), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm exec playwright install --with-deps chromium webkit`, `pnpm exec playwright test`; on push to `main` only, after the above: `wrangler deploy` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

- [ ] **Step 1: Write the workflow and wrangler config.**
- [ ] **Step 2: Verify locally** — `pnpm build && pnpm exec wrangler deploy --dry-run` → prints the asset upload plan without error.
- [ ] **Step 3: Push a branch and open a PR** — the CI run is green. Add the two secrets in the repo settings (a manual step for Carol), merge, confirm the `*.workers.dev` URL serves the Shelf.
- [ ] **Step 4: Commit** — `ci: lint, test, e2e and deploy to Cloudflare Workers`

---

## Self-review notes

- Spec coverage: 4 (Task 2–3), 5.1 (5), 5.2 (8), 5.3 (9), 5.4 (6), 5.5–5.6 (7), 5.7 (6), 5.8 (7), 5.9 (6: `pieceId` search param), 6 incl. deleting and import/export (2, 3, 10), 7 (1 tokens; boards per task), 8.1 (1, 11, 12, 13). Section 2.1 defaults (3, 7, 9).
- The mockup's pick sheet (list + search, New piece toggle on the Capture screen) is used over the spec's 5.5 grid wording, per `docs/mockups/README.md`.
- Glaze tip in 5.3 maps to `Glaze.notes`; no separate field is added.
