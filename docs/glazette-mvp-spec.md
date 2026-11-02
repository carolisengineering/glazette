# Glazette – MVP Spec

*Working name: Glazette (glaze + gazette). Last updated 2026-11-01 (sections 8.2–12 and monetization moved to docs/future-details.md; camera flow, glaze layers, stage rules, deletion, import, open questions and tech stack resolved; builder-reviewed).*

A visual studio journal for wheel-throwing potters. Every piece moves through its stages with a photo at each step, and every glaze builds into a library of real fired results. The look should be calm and elegant, and logging should be effortless.

---

## 1. Problem

- Hobby potters track glazes and pieces in the Notes app, notebooks or memory.
- Results are hard to reproduce: which glaze, how many dips, which clay, which cone?
- Existing pottery trackers (KilnNote, Pottery Log, ClayNote, Claybook, Muddy and others) are form-heavy and feel like databases.

**Opportunity:** the same core job, done with a photo-first, beautiful UI where logging takes one tap at the wheel.

## 2. Target user

- Hobby or semi-serious **wheel-throwing** potters (not hand-builders, for v1).
- Fire mostly at **cone 6**, often in a shared or community studio.
- Have 5–30 pieces in progress at once and lose track of what's where.
- Phone in an apron pocket, often with muddy hands.

### 2.1 Reference studio and defaults

Carol throws at Penguin Foot Pottery (penguinfoot.com), a community studio. It is the reference user environment for v1 and the source of the app's defaults:

- **Clay body:** one studio-supplied white stoneware; outside clay is not permitted. Default clay: "White stoneware."
- **Bisque:** cone 6 (assumed; the studio doesn't publish it). Default Bisqued note: "Cone 6."
- **Glaze firing:** cone 6 oxidation, electric kilns. Default Glaze cone: "6". Default Fired note: "Cone 6 oxidation."
- **Glazes:** 11 rotating in-house glazes plus slips, underglazes, terra sig and oxide stains. Commercial glazes need approval and test tiles.
- **Timelines:** bisque takes ~2 weeks, glaze firing ~14 days, and finished work is discarded ~7 weeks after a session with no pickup notification. The Shelf's 14-day Fired window matches this cadence.
- **Clay allotment:** students get 5–10 lb per class (25 lb per session cap); members 50 lb per month. Clay is tracked by weight, which is why the Thrown stage note is clay weight.

Defaults are pre-filled, never locked: a user at another studio changes the clay and cone once and the app remembers.

## 3. Product principles

1. **Photos are the interface.** Every screen leads with images, not forms.
2. **One tap to log.** Snapping a photo updates a piece or creates one. There are no required fields.
3. **One tap to advance.** Moving a piece to its next stage is a single action.
4. **Never type twice.** Clay bodies and glazes autocomplete from what you've used before.
5. **The kiln is the payoff.** The glazed → fired before/after reveal is the emotional moment.
6. **Quiet UI, loud glazes.** A neutral interface, so glaze colors provide all the color.

## 4. Stages (fixed for v1)

| # | Stage | Typical note |
|---|-------|--------------|
| 1 | Thrown | Clay weight |
| 2 | Trimmed | Handle attached, foot trimmed |
| 3 | Bisqued | Bisque cone |
| 4 | Glazed | Glaze(s), dips, application |
| 5 | Fired | Cone, atmosphere, result |

Stages are linear. A piece can be marked **Lost** (cracked, collapsed or broken) from any stage. That's archived, not deleted.

Rules:
- A piece's current stage is the stage of its most recent stage entry. It is never edited directly.
- A piece never moves backward. A refire is a second **Fired** entry; a reglaze is a second **Glazed** entry followed by another Fired entry.
- Several entries at the same stage are allowed (a second photo, a refire).
- The before/after toggle compares the most recent Glazed photo with the most recent Fired photo.
- Glazes are attached to a specific Glazed entry, so each glazing event has its own list.

## 5. v1 scope – screens

### 5.1 Shelf (home)
- A two-column photo grid of pieces in progress. **All** hides Fired pieces 14 days after firing; the **Fired** chip always shows every fired piece.
- Filter chips: **All · Thrown · Trimmed · Bisqued · Glazed · Fired**, each with a count. A **Lost** chip appears at the end once at least one piece is lost.
- Each card shows the latest photo, name (serif), clay or glaze + day count, a 5-segment progress bar and an **advance arrow**.
- Kiln banner: "N pieces ready to bisque" when any piece is Trimmed.
- Bottom bar: Shelf · **+ (camera)** · Glazes.

### 5.2 Piece detail
- Full-bleed hero photo of the current stage.
- **Before/after toggle** once fired: "Before firing" vs "Out of the kiln."
- Fact cards: Clay · Glaze · Firing (cone).
- **Journey timeline:** one row per stage with a thumbnail, note and date.
- Free-text notes.
- Actions: Advance stage, Add photo, Edit, Mark as lost.

### 5.3 Glazes
- A swatch wall of **test tiles**: an automatic center-crop square from the most recent fired photo of any piece using that glaze, or a solid color when there's no fired photo yet. User-picked crop areas are v2.
- Selecting a glaze shows: name, cone, the number of pieces using it, thumbnails of those pieces and a one-line tip.
- Add or edit a glaze: name, cone, color, notes.

### 5.4 Camera (the + button)
- v1 uses the **native camera** through a file input, not an in-app viewfinder. Tapping + opens the system camera immediately; the dark camera UI in the mockup is the post-capture review screen, not a live viewfinder. A custom viewfinder is a later upgrade (see 8.1).
- **Camera roll is allowed.** The review screen offers "Choose from library" so photos taken earlier with the regular camera app can be logged. For a library photo, the stage entry date comes from the photo's own timestamp (EXIF), falling back to now.
- Nothing is saved until a piece is picked. Most shots are updates to an existing piece, so capture is followed by the pick step.

### 5.5 Pick a piece
- A sheet slides up over the photo.
- At the top: one large **New piece** tile, always in the same spot so it can be found without looking.
- Below: a photo grid of in-progress pieces, ordered by most recently touched. Each tile shows the latest photo, name and current stage.
- Lost and Fired pieces are hidden from this grid.
- Tap a tile to pick it.

### 5.6 Confirm the stage (existing piece)
- A strip shows the five stages with the **next** stage pre-selected.
- One tap on **Save** records the photo as a new stage entry and advances the piece.
- Tapping a different stage first lets you add a second photo at the current stage, or skip a stage.
- When the selected stage is **Glazed**, the sheet includes the glaze list (see 5.8).
- Optional note field. Nothing is required.

### 5.7 New piece
- Saves as **Thrown** immediately.
- Optional details sheet: Name ("Name it later"), Form chips (Mug, Bowl, Vase, Plate, Jar), Clay chips (recent first).
- Done → back to Shelf. Retake → back to camera.

### 5.8 Glazes on a piece
- An ordered list of glazes, in the order they went on. Pick one glaze; a "+ add another glaze" link adds a second row.
- Each row: glaze (autocomplete from the library), optional dips, optional method, and an **optional note** ("top half only", "brushed over the rim").
- No base/overlay labels and no placement drawing in v1.

### 5.9 From a piece
- The advance arrow and "Add photo" on the piece detail screen open the same camera, but skip the pick step since the piece is known.

## 6. Data model

```ts
type Stage = 'thrown' | 'trimmed' | 'bisqued' | 'glazed' | 'fired';

interface Piece {
  id: string;
  name?: string;              // optional – "Untitled bowl" fallback
  form?: 'mug' | 'bowl' | 'vase' | 'plate' | 'jar' | 'other';
  clayId?: string;
  lost?: boolean;
  notes?: string;
  createdAt: string;          // ISO date
  updatedAt: string;
  deletedAt?: string;         // soft delete (tombstone for v2 sync)
}
// Current stage is derived: the stage of the piece's latest StageEntry.

interface StageEntry {
  id: string;
  pieceId: string;
  stage: Stage;
  photoId?: string;
  note?: string;              // e.g. "Cone 04", "2 dips"
  date: string;               // EXIF date for library photos, else capture time
  deletedAt?: string;
}

interface GlazeApplication {
  id: string;
  entryId: string;            // the Glazed StageEntry this belongs to
  pieceId: string;
  glazeId: string;
  order: number;              // layering order
  dips?: number;
  method?: 'dip' | 'brush' | 'pour' | 'spray';
  note?: string;              // "top half only", "brushed over the rim"
}

interface Glaze {
  id: string;
  name: string;
  cone?: string;              // "6", "10", "04"
  color: string;              // hex for the swatch fallback
  notes?: string;
  deletedAt?: string;
}

interface Clay {
  id: string;
  name: string;               // "Speckled buff", "Porcelain"
  deletedAt?: string;
}

interface Photo {
  id: string;
  blob: Blob;                 // stored locally (IndexedDB), JPEG
  thumb: Blob;                // ~400px thumbnail for grids
  hash: string;               // content hash; dedupes re-imports
  width: number;
  height: number;
  takenAt: string;
}
```

### Deleting

- Pieces, stage entries and photos can be deleted, with a confirmation. Deletes are soft (`deletedAt`), since v2 sync needs tombstones. Deleted rows are excluded everywhere in the UI and purged on export.
- Glazes and clays can be deleted. Pieces that reference them keep the reference and show the name with "(retired)".
- Lost is not a delete; it's a flag.

### Import and export

- **Export:** a zip of `glazette.json` (every table, including tombstones) plus photos named by hash.
- **Import (in v1):** restore from that zip. Photos dedupe by hash, records merge by id. Without this, a cleared browser or a new phone loses everything on the free tier.

## 7. Visual design

| Token | Value | Use |
|-------|-------|-----|
| Background | `#EEF1F4` | Slate base |
| Surface | `#FFFFFF` | Cards |
| Ink | `#16202A` | Primary text |
| Muted | `#5B6672` | Secondary text |
| Border | `#D5DBE1` | Chips, inputs |
| Accent | `#175474` | Marine – the only accent |
| Accent tint | `#E3ECF1` | Advance button |

- **Type:** Instrument Serif for piece and glaze names and screen titles; Inter for everything else.
- **Shape:** 20–24px card radius, pill chips, a floating dark bottom bar.
- **Camera:** dark UI (`#0E151C`).
- **Touch targets:** at least 44px. Big enough for muddy fingers.
- Dark mode: planned, not in v1.

Mockups: `docs/mockups/` holds the artboard source (390×844) copied from the *Pottery Tracker – Shelf* design canvas at https://claude.ai/artifact/HuVxdT1BANh15KX2GLWmsr. Shelf, Piece, Glazes, Pick a piece and Stage strip are authoritative for layout, type and color. The Quick add board draws a live viewfinder, which v1 does not have (5.4); treat its dark screen as the post-capture review and its details sheet as authoritative. See `docs/mockups/README.md` for the board-to-section map and one open difference on 5.5.

## 8. Tech approach

Chosen 2026-11-01 after research (see `reports/Glazette stack research.md`). Criteria: skills that appear in software engineering job postings, $0 hosting during validation, Cloudflare seriously considered.

### 8.1 v1 stack (client-only PWA)

| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript, plain Vite SPA (no SSR) |
| Scaffold | `npm create cloudflare@latest -- glazette --framework=react` |
| Routing | TanStack Router or React Router (either will work) |
| PWA | vite-plugin-pwa 2.x, `generateSW`, `registerType: 'prompt'` with a "new version available" reload prompt |
| Storage | Dexie 4.x + `useLiveQuery` over IndexedDB |
| Photos | `<input type="file" accept="image/*" capture="environment">` → `createImageBitmap` → OffscreenCanvas → JPEG at 0.8 (80%) quality, max 2000px long edge, plus a separate thumbnail |
| Styling | Tailwind v4, with the section 7 design tokens (colors, fonts, radius) declared once in its `@theme` block; hand-written CSS for the grid, timeline and before/after reveal |
| Components | shadcn/ui (on Base UI), restyled to the design |
| UI state | Zustand for ephemeral UI state only |
| Testing | Vitest 4 + React Testing Library; Playwright E2E for offline reload and IndexedDB persistence |
| CI/CD | GitHub Actions: Biome, `tsc`, Vitest, Playwright, then `wrangler deploy` on merge to main |
| Tooling | pnpm, Biome 2.x (fall back to ESLint + Prettier if hooks/a11y rule coverage is lacking) |
| Hosting | Cloudflare Workers static assets, free `*.workers.dev` subdomain |
| Export | JSON + photos zip |
