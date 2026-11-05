# PR4: Backup, Installable App and Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Carol back up and restore everything in one zip file, install Glazette on her Home Screen with its own icon (#8), keep working offline, and keep her data from being evicted.

**Architecture:** This plan replaces Tasks 10–12 of `docs/superpowers/plans/2026-11-01-glazette-mvp.md`, updated for what PR2, PR3, PR #10 and PR #11 changed. It also carries the PR3 review leftovers. Backup is two pure database functions (`exportZip` and `importZip`, using fflate) behind a Backup sheet opened from a gear on the Shelf. The installable app is vite-plugin-pwa (`generateSW`, prompt to reload) plus a static web manifest and icons rendered once from one SVG.

**Tech Stack:** React 19, TypeScript, Vite, TanStack Router, Dexie 4 (fake-indexeddb in tests), fflate, vite-plugin-pwa, Vitest + Testing Library, Playwright (Chromium + WebKit), Biome, pnpm, Cloudflare Workers static assets.

**Spec:** `docs/glazette-mvp-spec.md` (section 6 "Import and export", section 8 PWA rows). Also `docs/superpowers/specs/2026-11-05-no-photo-stages-design.md` (steps with no date).

**Branch:** `pr4-backup-pwa` (from `main` at cb9881d).

## Global Constraints

- American spelling in all new code, copy, comments and commit messages. Don't rename existing identifiers.
- **Backups keep tombstones** (Carol, 2026-11-02). Export includes rows with `deletedAt`, and photos of deleted pieces with their blobs. Import honors incoming tombstones. This overrides the old plan's "stripped on export".
- **Never invent dates.** A step without `date` exports without `date` and imports without `date`.
- **No server, no telemetry.** The backup file goes only where the user sends it.
- Icon: accent `#175474` background, wide-shouldered vase (mockup option C) in Background `#EEF1F4`, centered. iPhone rounds the corners itself, so the icon is a full square with no transparency.
- Theme and manifest colors: `#EEF1F4`. App name and short name: "Glazette".
- Exact copy:
  - Gear button accessible name: "Backup". Sheet title: "Backup".
  - Buttons: "Save a backup" and "Restore from a backup".
  - Save caption: "One file with every piece, glaze and photo. Keep it somewhere safe, like iCloud Drive."
  - "Last backup: {Mon D}" or "No backup yet".
  - Toasts: "Restored {N} pieces" / "Restored 1 piece" (changed during build; N counts pieces) / "Already up to date" / "This isn't a Glazette backup".
  - Reload prompt: "New version available" with a "Reload" button.
  - Empty shelf: "Nothing here yet. Tap + to add a piece." (All) and "No pieces at this stage." (any other chip).
- Text sizes follow the existing rule: nothing under 13px, inputs 16px, touch targets ≥ 44px.
- Before every commit, run `pnpm test`, `pnpm lint` and `pnpm typecheck`. All must pass.

## Review Focus

1. **Restoring on a fresh install.** A new install has already written default settings. A restore must still bring back the backup's studio name, notes defaults and default clay. (Test in Task 3.)
2. **Same photo under a different id.** The incoming photo's hash already exists locally under another id. The incoming entries must point at the existing photo, not at a missing id. (Test in Task 3.)
3. **Round trip of the new data.** An undated step, a tombstoned piece and the studio name survive export then import unchanged: no date is added and `deletedAt` is kept. (Test in Task 3.)
4. **Hostile glaze color.** A backup with `color: "red; background-image:url(x)"` can't reach the inline `backgroundColor` style. It becomes the default glaze color. (Test in Task 3.)
5. **A new deploy while the app is open.** The open app shows "New version available" instead of silently running stale code, and Cloudflare doesn't cache `sw.js` for long. (Tests in Task 6.)

---

### Task 1: PR3 leftovers

**Files:**
- Modify: `src/db/ops.ts` (`updatePiece`)
- Modify: `src/routes/shelf.tsx` (empty-state line)
- Modify: `docs/superpowers/plans/2026-11-01-glazette-mvp.md` (Global Constraints line "stripped on export" → "kept as tombstones on export (Carol, 2026-11-02)")
- Modify: `docs/glazette-mvp-spec.md` section 6 ("purged on export" → "kept on export as tombstones")
- Test: `src/db/ops.test.ts`, `src/routes/shelf.test.tsx`

**Interfaces:**
- Produces: `updatePiece` changes nothing and doesn't bump `updatedAt` when the piece is missing or soft-deleted. It resolves without throwing, because the notes flush on unmount runs after a delete.

- [ ] **Step 1: Write the failing tests**

```ts
test('updatePiece on a soft-deleted piece leaves it untouched', ...)  // updatedAt and notes unchanged
test('empty shelf says "Nothing here yet. Tap + to add a piece."', ...)
test('a stage chip with no pieces says "No pieces at this stage."', ...)
```

- [ ] **Step 2: Run them and see them fail:** `pnpm vitest run src/db/ops.test.ts src/routes/shelf.test.tsx`
- [ ] **Step 3: Implement.** Do the guard inside a `db.transaction('rw', db.pieces, …)`. The empty line is 16px, muted, centered in the grid area.
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Commit** `fix: guard piece updates after delete, empty shelf line, tombstone wording in docs`

---

### Task 2: Export

**Files:**
- Create: `src/backup/format.ts` (shared types and constants)
- Create: `src/backup/export.ts`
- Test: `src/backup/export.test.ts`

**Interfaces:**
- Produces:
  - In `format.ts`:
    - `BACKUP_VERSION = 1`
    - `interface BackupJson { version: 1; exportedAt: string; pieces: Piece[]; entries: StageEntry[]; glazeApps: GlazeApplication[]; glazes: Glaze[]; clays: Clay[]; settings: Settings | null; photos: PhotoMeta[] }`
    - `type PhotoMeta = Omit<Photo, 'blob' | 'thumb'>`
    - `photoPath(hash) = \`photos/${hash}.jpg\``
    - `thumbPath(hash) = \`thumbs/${hash}.jpg\``
  - In `export.ts`:
    - `exportZip(now?: Date): Promise<Blob>`: a zip (fflate `zipSync`, `level: 0` for the JPEGs) holding `glazette.json` plus one full image and one thumbnail per photo row. It includes every row of every table, tombstones too. The blob type is `application/zip`.
    - `backupFileName(now: Date): string`: `glazette-YYYY-MM-DD.zip` in the local calendar day.

Read all tables in one `db.transaction('r', …)`. Photo blobs come from `photo.blob` and `photo.thumb`. Turn a Blob into bytes with `new Uint8Array(await blob.arrayBuffer())`. In fake-indexeddb tests, stored blobs may come back as plain objects, so test with a small helper that handles both, and say so in a comment.

- [ ] **Step 1: Write the failing tests** (unzip with `unzipSync` and parse the JSON)

```ts
test('export holds every table, tombstones included, and photos by hash', ...)
test('an undated step exports with no date key', ...)
test('settings export includes the studio name', ...)
test('backupFileName uses the local day', ...)   // new Date(2026, 10, 5, 23, 30) → 'glazette-2026-11-05.zip'
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Commit** `feat(backup): export everything to one zip`

---

### Task 3: Import

**Files:**
- Create: `src/backup/import.ts`
- Test: `src/backup/import.test.ts`

**Interfaces:**
- Consumes: `format.ts`, `exportZip` (Task 2; the tests build zips with it), `DEFAULT_GLAZE_COLOR` from `src/db/seed.ts`.
- Produces:
  - `class NotABackupError extends Error`
  - `importZip(file: Blob): Promise<{ added: number; updated: number }>`

**Rules.** These are Claude's calls, recorded for Carol:

- **Not a backup.** Throw `NotABackupError` when the zip won't open, has no `glazette.json`, or `version !== 1`. Nothing is written. (changed during build) Validation also checks the zip signature and that string fields are strings.
- **Pieces.** Match by `id`. An unknown id is added. A known id is replaced only when the incoming copy changed later, comparing the later of `updatedAt` and `deletedAt` on each side, because the generic soft delete sets only `deletedAt`. (changed during build)
- **Steps, glaze layers, glazes, clays.** These have no `updatedAt`. Unknown ids are added. For a known id, keep the existing row, except that an incoming `deletedAt` is applied when the existing row has none. Deletions spread; edits never overwrite.
  - (changed during build) Clays and glazes also dedupe by live name, case-insensitive: an incoming clay or glaze whose name matches a live local one is not added, and references to it are remapped to the local row.
  - (changed during build) Glaze layers are added only along with steps this import adds.
- **Photos.** Match by `hash`.
  - When the hash exists locally under another id, map the incoming id to the local one and rewrite the incoming steps' `photoId` to match.
  - When it's new, add the photo with its blob and thumbnail from the zip.
  - When the zip lacks the image file, skip the photo row. The step keeps its `photoId`, and the app already shows a placeholder for that.
- **Settings.** The backup's settings win, since a restore is a deliberate act. The exceptions are `lastBackupAt`, which keeps the later value, `persistRequested`, which stays local, and a `defaultClayId` that names no live clay after the import, which keeps the current one. (changed during build)
- **Glaze colors.** A `glaze.color` that doesn't match `/^#[0-9a-f]{6}$/i` becomes `DEFAULT_GLAZE_COLOR`.
- **One transaction.** All writes happen in a single `db.transaction('rw', all tables, …)`. Unzip and parse before it starts.
- **Counts.** `added` counts new rows across all tables; `updated` counts replaced or newly tombstoned rows. The sheet shows `added + updated` as N.

- [ ] **Step 1: Write the failing tests**

```ts
test('import into an empty database restores every table and photo', ...)
test('importing the same zip twice adds nothing the second time', ...)              // { added: 0, updated: 0 }
test('restore on a fresh install brings back the studio name and default clay', ...) // Review Focus 1
test('a photo already stored under another id is reused and steps are rewritten', ...) // Review Focus 2
test('an undated step and a tombstoned piece round-trip unchanged', ...)           // Review Focus 3
test('a piece is replaced only by a newer updatedAt', ...)
test('an incoming tombstone deletes an existing live step', ...)
test('a bad glaze color becomes the default color', ...)                           // Review Focus 4
test('a zip without glazette.json throws NotABackupError and writes nothing', ...)
test('a failure mid-import writes nothing', ...)   // spy bulkPut to reject
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Commit** `feat(backup): restore from a zip, merging by id and photo hash`

---

### Task 4: Backup sheet

**Files:**
- Create: `src/backup/BackupSheet.tsx`, `src/backup/saveFile.ts`
- Modify: `src/routes/shelf.tsx` (gear button at the right of the header)
- Modify: `src/db/types.ts` (`Settings.lastBackupAt?: string`)
- Test: `src/backup/BackupSheet.test.tsx`

**Interfaces:**
- Consumes: `exportZip`, `backupFileName`, `importZip`, `NotABackupError`; `useModal`, `useToast`, `SAVE_ERROR`.
- Produces:
  - `saveFile(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'canceled'>`. It uses `navigator.share({ files: [new File([blob], name, { type: 'application/zip' })] })` when `navigator.canShare?.({ files })` is true; this is the iOS share sheet, with "Save to Files". Otherwise it clicks an `<a download>` on an object URL and revokes the URL afterward. An `AbortError` from share returns `'canceled'`.

**Behavior:**

- **Gear button.** A 44px round button with a gear icon, `aria-label="Backup"`, at the top right of the Shelf header, next to the studio name and title.
- **Sheet.** A bottom sheet modal, the same pattern as the piece Edit sheet (`useModal`; focus goes to the title; Escape and a backdrop tap close it). Title "Backup", then two blocks:
  - **Save a backup.** The accent button calls `exportZip` then `saveFile`. On `'shared'` or `'downloaded'`, set `settings.lastBackupAt` to now; on `'canceled'`, change nothing. The caption sits under the button, then "Last backup: Nov 5" or "No backup yet". A failure shows `SAVE_ERROR`.
  - **Restore from a backup.** A secondary button opens a hidden `<input type="file" accept=".zip,application/zip">`. The chosen file goes to `importZip`, and the result toast is "Restored N items", "Restored 1 item" or "Already up to date". `NotABackupError` shows "This isn't a Glazette backup". Any other failure shows `SAVE_ERROR`.
- **Busy state.** Both buttons are disabled while either action runs.

- [ ] **Step 1: Write the failing tests.** Mock `exportZip`/`importZip`/`saveFile` at module level where needed; test `saveFile` separately with stubbed `navigator.share`/`canShare`.

```ts
test('the gear opens the Backup sheet and Escape closes it', ...)
test('Save a backup shares the zip and records the backup date', ...)
test('a canceled share does not record a backup date', ...)
test('saveFile falls back to a download when files cannot be shared', ...)
test('Restore shows "Restored 3 items"', ...)
test('Restore with nothing new shows "Already up to date"', ...)
test('Restore of a non-backup shows "This isn\'t a Glazette backup"', ...)
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Commit** `feat(backup): Backup sheet on the shelf with save and restore`

---

### Task 5: App icon and Home Screen metadata (#8)

**Files:**
- Create: `public/icons/icon.svg` (the source)
- Create: `scripts/make-icons.mjs`
- Create, generated and committed: `public/icons/apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- Replace: `public/favicon.svg` with the vase icon
- Modify: `index.html`
- Modify: `package.json` (script `"icons": "node scripts/make-icons.mjs"`)

**Icon source.** Use a 100×100 viewBox with `<rect width="100" height="100" fill="#175474"/>` and the approved vase path, filled `#EEF1F4`:

```
M41 19 H59 V26 C67 29 73 36 73 46 C73 62 61 76 58 82 H42 C39 76 27 62 27 46 C27 36 33 29 41 26 Z
```

The maskable variant scales the vase to 80% around the center (`transform="translate(10 10) scale(0.8)"`) so it stays inside the safe zone.

**Rendering.** `make-icons.mjs` uses Playwright's Chromium, already a dev dependency. It loads each SVG into a page at the target size and screenshots it with `omitBackground: false`, so the PNG has no transparency. It's run once and the PNGs are committed. Builds don't run it.

**Changes to `index.html`:**
- `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
- `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`
- `<meta name="theme-color" content="#EEF1F4">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-title" content="Glazette">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="default">`
- `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`

- [ ] **Step 1: Create the SVGs and the script. Run `pnpm icons`, then check the four PNGs with `file public/icons/*.png`: the expected sizes, RGB with no alpha.**
- [ ] **Step 2: Add a test, `src/test/head.test.ts`, that reads `index.html` and asserts each tag above is present and every referenced icon file exists.**
- [ ] **Step 3: Run all checks plus `pnpm build`.**
- [ ] **Step 4: Commit** `feat: Glazette app icon and Home Screen metadata (#8)`

---

### Task 6: Works offline, reload prompt and persistent storage

**Files:**
- Modify: `vite.config.ts`, `src/main.tsx` (or `src/App.tsx`), `package.json` (add `vite-plugin-pwa`; pick the current major that supports the installed Vite)
- Create: `src/pwa/ReloadPrompt.tsx`, `src/pwa/persist.ts`, `public/_headers`
- Modify: `src/db/types.ts` (`Settings.persistRequested?: boolean`)
- Test: `src/pwa/persist.test.ts`, `src/pwa/ReloadPrompt.test.tsx`, `src/test/build-output.test.ts` (or a step check)

**Interfaces:**
- Produces:
  - `requestPersistence(): Promise<boolean>`. It calls `navigator.storage.persist()` at most once per install, using `settings.persistRequested` as the flag. It returns `false` and never throws when the API is missing. The app calls it once at startup after `ensureDefaults()`.
  - `ReloadPrompt`: when `useRegisterSW` reports `needRefresh`, a toast-style bar reads "New version available" with a "Reload" button, which calls `updateServiceWorker(true)`.

**PWA config:**
- `VitePWA({ registerType: 'prompt', strategies: 'generateSW', injectRegister: false, manifest: {...}, workbox: {...} })`
- `manifest`: name and short_name "Glazette", `start_url: '/'`, `display: 'standalone'`, `background_color` and `theme_color` `#EEF1F4`, plus the 192, 512 and maskable icons from Task 5.
- `workbox`: `globPatterns: ['**/*.{js,css,html,svg,png,woff2}']`, `navigateFallback: '/index.html'`.
- Disable the service worker in dev and tests (`devOptions.enabled: false`).

**Caching headers.** `public/_headers` (Cloudflare static assets) sets `Cache-Control: no-cache` for `/sw.js`, `/registerSW.js` and `/manifest.webmanifest`, so a new deploy is picked up.

- [ ] **Step 1: Write the failing tests**

```ts
test('requestPersistence resolves false when navigator.storage is missing', ...)
test('requestPersistence asks only once across two calls', ...)
test('ReloadPrompt shows Reload only when a new version is waiting', ...) // vi.mock('virtual:pwa-register/react')
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Add `vite-plugin-pwa/react` client types to `tsconfig`.
- [ ] **Step 4: Run all checks plus `pnpm build`. Confirm that `dist/sw.js`, `dist/manifest.webmanifest` and `dist/_headers` exist, and that the manifest lists the icons.**
- [ ] **Step 5: Commit** `feat(pwa): offline app shell, reload prompt and persistent storage`

---

### Task 7: End-to-end tests

**Files:**
- Create: `playwright.config.ts`, `e2e/offline.spec.ts`, `e2e/persistence.spec.ts`, `e2e/backup.spec.ts`, `e2e/fixtures/portrait-rotated.jpg`, `e2e/fixtures/sample.heic`, `scripts/make-fixtures.mjs` (or another documented way to build the fixtures)
- Modify: `src/main.tsx`: when `import.meta.env.MODE !== 'production'`, set `window.__glazette = { processImage }`
- Move: the `Window.__glazette` type from `e2e/global.d.ts` into a shared `src/types/glazette-window.d.ts` that both the app and e2e include

**Config:**
- `webServer`: `pnpm exec vite build --mode e2e && pnpm exec vite preview --port 4173 --strictPort`. Production mode would hide `window.__glazette`.
- `baseURL: http://localhost:4173`
- Projects: Chromium and WebKit.
- The HEIC spec runs on Chromium only. The offline spec runs on Chromium only, because WebKit service workers are unreliable in Playwright.

**Fixtures:**
- `portrait-rotated.jpg` has landscape pixels (e.g. 40×20) plus EXIF orientation 6, so a correct pipeline stores it 20×40.
- `sample.heic` is a small file with an `ftyp heic` header. The browser can't decode it, which is the point.

**Specs:**

```ts
// offline.spec.ts
test('app shell loads after going offline and reloading')  // wait for navigator.serviceWorker.ready, setOffline(true), reload, expect heading "My Shelf"
// persistence.spec.ts
test('a piece created with a photo survives a new page in the same context')  // + → Take photo → set file on capture input → New piece → Use photo → Done; new page → one card
// backup.spec.ts
test('save a backup downloads a zip; restoring it into a fresh context brings the piece back')  // page.waitForEvent('download'); new context; Restore via setInputFiles; expect the piece name
```

- [ ] **Step 1: Write the config, fixtures and specs.**
- [ ] **Step 2: Run `pnpm exec playwright install chromium webkit`, then `pnpm exec playwright test`. Every spec passes, including the existing `photos.spec.ts`.**
- [ ] **Step 3: Run all checks.** CI already runs Playwright once `playwright.config.ts` exists.
- [ ] **Step 4: Commit** `test(e2e): offline reload, persistence, backup round trip and photo pipeline`

---

## After the last task

Per `AGENTS.md`, run `/security-review`, then `/code-review high` on the branch. Fix the real findings, re-run the checks, and commit. Then use superpowers:finishing-a-development-branch. The PR closes #8.

**Tell Carol before merging:** on iPhone, an app added to the Home Screen keeps its own storage, separate from Safari's. To move her pieces into the installed app, she saves a backup in Safari, adds Glazette to the Home Screen, opens it, and restores the backup there.
