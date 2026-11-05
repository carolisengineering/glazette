# Stages Without Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a stage be recorded without a photo, let new pieces start at any stage (with or without a photo), fill skipped stages in as no-photo steps, and stop the camera from opening by itself.

**Architecture:** A stage step's `date` becomes optional. The write operations fill skipped stages inside the same transaction that writes the new step, so every caller gets the rule for free. A one-time Dexie version-2 upgrade fills gaps in existing pieces. On the capture side, a `noPhoto` flag carries the flow through the existing screens (stage strip, pick sheet, new-piece sheet), which learn to render without a photo.

**Tech Stack:** React 19, TypeScript, TanStack Router, Dexie 4 (fake-indexeddb in tests), Zustand, Tailwind v4, Vitest + Testing Library, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-05-no-photo-stages-design.md`. Read it first. This plan argues from it.

**Branch:** `issue4-no-photo-stages` (already created from `main`; the spec is committed on it).

## Global Constraints

- American spelling in all new code, copy, comments and commit messages. Don't rename existing identifiers.
- A step with no photo has no date unless the user enters one. Never fill in "now" or a neighbor's date.
- Skipped stages are filled only strictly between the piece's current stage and the new stage. Filled steps have no photo, no date, no note.
- Deletes stay soft (`deletedAt`). Deleted entries never show in the UI.
- Date inputs are `YYYY-MM-DD` strings in local time. Store them as an ISO timestamp at local noon, so the shown day never shifts across time zones.
- Exact copy: "No photo", "No photo for this update", "Update a piece", "New piece", "Which piece?", "Date · optional", "Add date", "Save", "Saved to your shelf as {Stage}", "Glazes".
- No new wording about skipped stages anywhere (Carol removed it). The existing summary line ("Moves X from A to B") stays unchanged.
- Run `pnpm test`, `pnpm lint`, `pnpm typecheck` before every commit. All must pass.

## Review Focus

1. **Lost or Fired piece, No photo, current stage selected:** saves a no-photo, undated step at the current stage and fills nothing. (Test in Task 2.)
2. **New piece with a photo, stage tapped back and forth (Glazed → Thrown → Bisqued):** exactly one live step per stage up to Bisqued, the photo on Bisqued. (Test in Task 2.)
3. **Date chosen in a far-west time zone:** "2026-11-03" from the date field shows as "Nov 3", not "Nov 2". (Test in Task 1, run with `TZ=America/Los_Angeles`.)
4. **Existing database with a deleted Trimmed step:** the upgrade doesn't recreate Trimmed. (Test in Task 3.)
5. **No photo from + while pieces are still loading:** shows the Update/New choice instead of crashing or guessing New. (Test in Task 7.)

---

### Task 1: Optional dates, ordering, fade and date helpers

**Files:**
- Modify: `src/db/types.ts` (`StageEntry.date` → `date?: string`, comment: "Photo date, a date the user entered, or none")
- Modify: `src/db/stage.ts` (`compareEntries`, new `stagesBetween`, new `missingStages`)
- Modify: `src/db/queries.ts` (`isFadedFromAll`)
- Create: `src/db/dates.ts`
- Modify: any file the type checker flags (`src/glazes/swatch.ts`, `src/routes/piece.tsx`, `src/piece/Timeline.tsx`): photo entries always have dates, so a `?? ''` or a guard is enough. Real UI handling of undated rows comes in Task 4.
- Test: `src/db/stage.test.ts`, `src/db/queries.test.ts`, `src/db/dates.test.ts`

**Interfaces:**
- Produces:
  - `stagesBetween(from: Stage | undefined, to: Stage): Stage[]`: stages strictly after `from` and strictly before `to`, in order. `from` undefined means start before Thrown.
  - `missingStages(entries: StageEntry[]): Stage[]`: stages before the current stage (computed from live entries) that have no entry at all, deleted or not.
  - `fromDateInput(value: string): string | undefined`: `''` → `undefined`; `'2026-11-03'` → ISO timestamp of local noon on that day.
  - `toDateInput(iso: string | undefined): string`: the reverse, using the local calendar day; `undefined` → `''`.

- [ ] **Step 1: Write the failing tests**

```ts
// stage.test.ts
test('stagesBetween lists only the stages strictly between', () => {
  expect(stagesBetween('thrown', 'bisqued')).toEqual(['trimmed'])
  expect(stagesBetween(undefined, 'glazed')).toEqual(['thrown', 'trimmed', 'bisqued'])
  expect(stagesBetween('thrown', 'trimmed')).toEqual([])
  expect(stagesBetween('fired', 'fired')).toEqual([])
})
test('an undated entry sorts below a dated one of the same stage, above an earlier stage', () => {
  const undated = { ...entry('u', 'trimmed', ''), date: undefined }
  const sorted = [entry('t', 'thrown', '2026-11-01T00:00:00.000Z'), undated, entry('d', 'trimmed', '2026-10-01T00:00:00.000Z')]
    .sort((a, b) => compareEntries(b, a)).map((e) => e.id)
  expect(sorted).toEqual(['d', 'u', 't'])
})
test('missingStages skips stages that have a deleted entry', () => {
  const es = [entry('a', 'thrown', D1), entry('b', 'trimmed', D1, D2 /* deleted */), entry('c', 'glazed', D2)]
  expect(missingStages(es)).toEqual(['bisqued'])
})
// queries.test.ts
test('filterShelf all hides a Fired piece whose Fired step has no date; fired still shows it', ...)
// dates.test.ts (run once normally and once with TZ=America/Los_Angeles)
test('fromDateInput keeps the calendar day in local time', () => {
  expect(shortDate(fromDateInput('2026-11-03')!)).toBe('Nov 3')
  expect(toDateInput(fromDateInput('2026-11-03'))).toBe('2026-11-03')
  expect(fromDateInput('')).toBeUndefined()
  expect(toDateInput(undefined)).toBe('')
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/db/stage.test.ts src/db/queries.test.ts src/db/dates.test.ts`
Expected: FAIL, because `stagesBetween`, `missingStages` and `fromDateInput` aren't defined.

- [ ] **Step 3: Implement**

`compareEntries`: same stage, both dated → by date as today; one undated → it ranks lower; both undated → 0. `isFadedFromAll`: an undated latest Fired step counts as faded. Move `shortDate` from `Timeline.tsx` into `src/db/dates.ts` and re-export or update its imports.

- [ ] **Step 4: Run all checks**

Run: `pnpm test && TZ=America/Los_Angeles pnpm vitest run src/db/dates.test.ts && pnpm lint && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit** `feat(db): optional stage dates, stage gap helpers, local date input helpers`

---

### Task 2: Write operations fill skipped stages

**Files:**
- Modify: `src/db/ops.ts`
- Test: `src/db/ops.test.ts`
- Modify: existing tests that call `addStageEntry` with no photo and no date and then read a date. Give them an explicit `date`.

**Interfaces:**
- Consumes: `stagesBetween`, `currentStage` (Task 1).
- Produces:
  - `addStageEntry(input)`: same input as today. New behavior:
    - The date is `input.date`, else `input.photo?.takenAt`, else **none**.
    - Inside the transaction, it adds a filled step for each stage in `stagesBetween(currentStage(liveEntries), input.stage)`.
    - `input.glazes` are attached to the Glazed step this save writes, whether that's the chosen step or a filled one. They're ignored if the save writes no Glazed step.
    - It returns the chosen step's id.
  - `createPiece(input & { stage?: Stage; note?: string; glazes?: same shape as addStageEntry })`:
    - `stage` defaults to `'thrown'`.
    - It writes a filled step for each stage in `stagesBetween(undefined, stage)`, then the chosen step with the photo and `note`.
    - The chosen step's date is `input.date ?? photo?.takenAt`, else none.
    - `createdAt` keeps today's rule.
    - Glazes attach to the Glazed step, as in `addStageEntry`.
  - `restagePiece(pieceId: string, stage: Stage): Promise<void>`: for a just-created piece, in one transaction:
    - The step that holds the photo (if no step has one, the latest step) moves to `stage`.
    - Live photo-less steps at or after `stage` are soft-deleted.
    - Stages before `stage` that have no live step get filled.
  - `addGlazesToPiece(pieceId: string, glazes: same shape): Promise<void>`: attaches glaze applications to the piece's latest live Glazed step. It does nothing if there's no such step or `glazes` is empty.
  - `setEntryDate(entryId: string, date: string | undefined): Promise<void>`: sets the date or clears it (removes the field), and bumps the piece's `updatedAt`.

- [ ] **Step 1: Write the failing tests**

```ts
test('addStageEntry Thrown→Bisqued fills Trimmed with no photo, date or note', ...)
  // expect entries by stage: thrown(dated), trimmed{photoId:undefined,date:undefined,note:undefined}, bisqued
test('addStageEntry with no photo and no date stores no date', ...)
test('addStageEntry Bisqued→Fired puts glazes on the filled Glazed step', ...)
  // glazeApps[0].entryId === the glazed entry's id; the fired entry has none
test('addStageEntry at the current stage of a Fired piece fills nothing', ...)       // Review Focus 1
test('addStageEntry does not refill a deleted step behind the current stage', ...)
test('createPiece at Bisqued with a photo writes Thrown and Trimmed undated, photo on Bisqued', ...)
test('createPiece with no photo at Glazed: all four steps undated, glazes on Glazed', ...)
test('restagePiece Glazed→Thrown→Bisqued leaves one live step per stage, photo on Bisqued', ...) // Review Focus 2
test('setEntryDate sets, then clears, the date', ...)
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm vitest run src/db/ops.test.ts`
Expected: FAIL. `restagePiece`, `addGlazesToPiece` and `setEntryDate` aren't defined, and no steps are filled.

- [ ] **Step 3: Implement** in `src/db/ops.ts`. Share one private helper that builds filled-step rows, and one that builds `GlazeApplication` rows for a given entry id.

- [ ] **Step 4: Run all checks.** `pnpm test && pnpm lint && pnpm typecheck` pass.

- [ ] **Step 5: Commit** `feat(db): fill skipped stages on every save; restage and date ops`

---

### Task 3: One-time fill for existing pieces

**Files:**
- Modify: `src/db/db.ts` (add `this.version(2).stores({...same as v1...}).upgrade(fillSkippedStages)`)
- Create: `src/db/upgrade.ts` (`fillSkippedStages(tx: Transaction): Promise<void>`)
- Test: `src/db/upgrade.test.ts`

**Interfaces:**
- Consumes: `missingStages` (Task 1).
- Produces: nothing used elsewhere.

`fillSkippedStages` reads all pieces and entries in the upgrade transaction. For each live piece, it adds an undated, photo-less step for each stage in `missingStages(itsEntries)`. Dexie runs an upgrade once, when a database below version 2 opens. The `[pieceId+date]` index stays: nothing queries it, and undated rows are simply left out of it.

- [ ] **Step 1: Write the failing tests.** Use a raw `new Dexie('glazette')` at version 1 with the v1 schema, seed it, close it, then open the app's `db`.

```ts
test('upgrade fills Trimmed for a piece that went Thrown → Bisqued', ...)
test('upgrade leaves a stage whose step was deleted alone', ...)   // Review Focus 4
test('upgrade skips deleted pieces and pieces with no gaps', ...)
```

- [ ] **Step 2: Run and see them fail:** `pnpm vitest run src/db/upgrade.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks.** Also update `src/db/db.test.ts` if it asserts the version number.
- [ ] **Step 5: Commit** `feat(db): one-time fill of skipped stages for existing pieces`

---

### Task 4: Journey slim rows, date editing, and the piece header

**Files:**
- Modify: `src/piece/Timeline.tsx`
- Modify: `src/routes/piece.tsx` (header shows `STAGE · date` only when the step has a date; "Add photo" link gets `search={{ pieceId, addPhoto: true }}`, which Task 7 wires up)
- Modify: `src/router.tsx` (`validateSearch` returns `{ pieceId?: string; addPhoto?: true }`; keep `addPhoto` only when it's `true`)
- Test: `src/routes/piece.test.tsx`

**Interfaces:**
- Consumes: `setEntryDate`, `fromDateInput`, `toDateInput`, `shortDate` (Tasks 1–2).

Steps with a photo look and behave exactly as today. A step with no photo is a slim row (mockup option B in `.superpowers/brainstorm/*/content/journey-no-photo.html`, if it's still there):

- A 6px dot in place of the 44px thumbnail.
- The stage name in muted text at 15px, and the note if there is one.
- On the right, a date button or "Add date" button, then the delete button.

Tapping "Add date" or the date expands an inline editor under the row:

- An `<input type="date" aria-label="{Stage} date">`. Changing it saves right away via `setEntryDate`.
- A "Clear date" button when the step has a date.
- A "Done" button that collapses the editor.

- [ ] **Step 1: Write the failing tests**

```ts
test('a step with no photo is a slim row with Add date and no thumbnail', ...)
test('Add date saves the chosen date and the row shows "Nov 3"', ...)
test('Clear date returns the row to Add date', ...)
test('header shows only the stage when the current step has no date', ...)
test('Add photo links to capture with addPhoto', ...)
```

- [ ] **Step 2: Run them and see them fail:** `pnpm vitest run src/routes/piece.test.tsx`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Commit** `feat(piece): slim journey rows for steps without photos, with date editing`

---

### Task 5: Stage strip without a photo

**Files:**
- Create: `src/capture/StagePicker.tsx` (extracted from the `<fieldset>` in `StageStrip.tsx`)
- Create: `src/capture/NoPhoto.tsx` (the slim dashed placeholder)
- Create: `src/capture/resolveGlazes.ts` (move `resolveGlazes` out of `StageStrip.tsx` unchanged)
- Modify: `src/capture/StageStrip.tsx`
- Test: `src/capture/stage-strip.test.tsx`

**Interfaces:**
- Consumes: `addStageEntry` with glazes-on-Glazed behavior (Task 2), `stagesBetween`, `fromDateInput` (Task 1).
- Produces:
  - `StagePicker({ value, onChange, current, captions }: { value: Stage; onChange: (s: Stage) => void; current?: Stage; captions: boolean })`:
    - The same markup, selectable rule and bars as today's fieldset.
    - With `captions` false, the Done/Now/Next captions are hidden.
    - Task 6 uses it with `current` undefined and `captions` false, which makes all five stages selectable.
  - `NoPhoto({ label }: { label: string })`: a 56px-tall dashed box (`border-[1.5px] border-dashed border-border`, rounded 16px) with the label in muted 14px text.
  - `resolveGlazes(rows: GlazeRow[], cone: string)`: unchanged signature. It must be called inside a transaction that includes `db.glazes`.

When `photo` is undefined, the strip changes as follows:

- **Top area.** The 250px photo area becomes a compact top bar holding the existing Close link and the "Update a piece" badge, with `<NoPhoto label="No photo for this update" />` below it.
- **Date field.** A "Date · optional" `<input type="date" id="stageDate">` appears above the note. Save passes `date: fromDateInput(value)`.
- **Save label.** It reads "Save" instead of "Save photo" when the stage is the current one. Otherwise it's unchanged.

With or without a photo, the glaze rows now also appear when `stage !== 'glazed'` but `stagesBetween(current, stage)` includes `'glazed'`. In that case they carry a "Glazes" label above them, and their glazes go to the filled Glazed step. Remove the line that only resolves glazes when `stage === 'glazed'`, and resolve whenever the rows are shown.

- [ ] **Step 1: Write the failing tests.** Render with `renderRoute('/capture?pieceId=…')`. Task 7 adds the No photo button, so until then render `StageStrip` directly inside a memory router, without a photo.

```ts
test('without a photo the strip shows "No photo for this update" and a Date field', ...)
test('saving with no photo and no date writes an undated step and fills skipped stages', ...)
test('a date entered in the field is saved on the step', ...)
test('Bisqued → Fired shows glaze rows; saved glazes land on the filled Glazed step', ...)
test('without a photo, the current stage labels the button Save', ...)
```

- [ ] **Step 2: Run them and see them fail:** `pnpm vitest run src/capture/stage-strip.test.tsx`
- [ ] **Step 3: Implement.** The existing tests for the strip with a photo must still pass untouched.
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Commit** `feat(capture): stage strip works without a photo and records glazes when skipping Glazed`

---

### Task 6: New-piece sheet: stage row, glazes, no photo

**Files:**
- Modify: `src/capture/NewPieceSheet.tsx`
- Test: `src/capture/capture.test.tsx` (existing new-piece tests; add new ones)

**Interfaces:**
- Consumes: `StagePicker`, `NoPhoto`, `resolveGlazes` (Task 5), `createPiece` with `stage`/`glazes`, `restagePiece`, `addGlazesToPiece` (Task 2).
- Produces:
  - `NewPieceSheet` props become `{ pieceId?: string; photo?: ProcessedImage; onDone: () => void; onRetake?: () => void; onClose?: () => void }`.
  - With a photo, the parent passes `pieceId` and `onRetake`, as today. Without a photo, it passes neither, and passes `onClose`.

Behavior:

- **Stage row.** A `StagePicker` labeled "Stage" sits above Name, with Thrown selected.
- **With a photo** (the piece is already saved):
  - Tapping a stage calls `restagePiece(pieceId, stage)` right away. On failure it shows the save-error toast and keeps the previous selection.
  - The confirmation reads `Saved to your shelf as ${STAGE_LABEL[stage]}`.
  - Done saves the name, form and clay as today. If the glaze rows are shown, Done then calls `addGlazesToPiece`.
- **Without a photo:**
  - The 300px photo area becomes `<NoPhoto label="No photo" />` with a Close button (`aria-label="Close"`) that calls `onClose`.
  - There's no "Saved…" line. Show the heading "New piece" in its place.
  - Done calls `createPiece({ stage, name, form, clayId, glazes })` inside one `db.transaction` with `resolveGlazes`, then calls `onDone`.
  - Nothing is written before Done.
- **Glaze rows** show when the stage is Glazed or Fired.

- [ ] **Step 1: Write the failing tests**

```ts
test('picking Bisqued on the details sheet restages the saved piece; the line reads "Saved to your shelf as Bisqued"', ...)
test('details sheet with a photo at Fired saves glazes on the filled Glazed step on Done', ...)
test('details sheet without a photo saves nothing until Done, then writes the piece at the chosen stage', ...)
test('Close on the no-photo details sheet writes nothing', ...)
```

Until Task 7 adds the No photo button, render the no-photo cases by rendering `NewPieceSheet` directly.

- [ ] **Step 2: Run them and see them fail:** `pnpm vitest run src/capture/capture.test.tsx`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Commit** `feat(capture): new pieces can start at any stage, with or without a photo`

---

### Task 7: Capture start screen: No photo, and no automatic camera (#6)

**Files:**
- Modify: `src/routes/capture.tsx`
- Modify: `src/capture/PickPieceSheet.tsx`
- Test: `src/capture/capture.test.tsx`, `src/capture/pick.test.tsx`; move the Task 5/6 direct-render tests to go through the route.

**Interfaces:**
- Consumes: everything above; `addPhoto` search param (Task 4).
- Produces:
  - `PickPieceSheet` accepts `onClose?: () => void`. Without `photo`, it drops the photo header, Retake and the "Update a piece" badge. It shows a Close button (`aria-label="Close"`) at the top left and the heading "Which piece?".

Changes:

- **No automatic camera (#6).** Delete the effect that calls `camera.current?.openCamera()` on mount. Retake still opens the camera, because the user just asked to retake.
- **The start screen.**
  - Under "Choose from library", add a **No photo** button: an outlined pill, `h-14`, `border-[1.5px] border-white/35`, white text.
  - The button is hidden when `addPhoto` is set.
  - The screen's title stays "New photo".
- **The noPhoto flow.**
  - Add `const [noPhoto, setNoPhoto] = useState(false)` and a step `{ name: 'choose' }`. The details step becomes `{ name: 'details'; pieceId?: string }`.
  - With `pieceId` known, No photo goes to `{ name: 'stage', pieceId, fromPick: false }`.
  - Otherwise, if the pieces have loaded and none is `inProgress`, it goes to `{ name: 'details' }`. In every other case, including while pieces are still loading, it goes to `{ name: 'choose' }`.
  - **Choose screen.** It uses the dark start-screen layout: the title "No photo", an accent **Update a piece** button that opens `{ name: 'pick' }`, a ghost **New piece** button that opens `{ name: 'details' }`, and a Cancel link to the exit target.
  - The pick, stage and details screens render when `photo || noPhoto`.
  - Without a photo:
    - The pick sheet's "Not here?" link opens `{ name: 'details' }` without saving.
    - Its Close goes to the exit target.
    - The details sheet's Close goes to the exit target, and its Done navigates to `/` as today.
- Update the existing test that asserts the camera opens on mount: it now asserts that it doesn't.

- [ ] **Step 1: Write the failing tests**

```ts
test('the camera does not open on arrival; Take photo opens it', ...)
test('No photo from a piece opens the stage strip for that piece without a photo', ...)
test('No photo is hidden when capture was opened from Add photo', ...)
test('No photo from + with pieces in progress shows the Update a piece / New piece choice', ...)
test('No photo from + with nothing in progress goes straight to the new-piece sheet', ...)
test('No photo while pieces are still loading shows the choice', ...)          // Review Focus 5
test('the pick sheet without a photo has Close and "Which piece?", and Not here opens details without saving', ...)
test('end to end: + → No photo → New piece → Bisqued → Done leaves a Bisqued piece with Thrown and Trimmed slim rows', ...)
```

- [ ] **Step 2: Run them and see them fail:** `pnpm vitest run src/capture`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks:** `pnpm test && pnpm lint && pnpm typecheck && pnpm build`. Everything passes.
- [ ] **Step 5: Commit** `feat(capture): No photo option; the camera waits for Take photo (#6)`

---

## After the last task

Per `AGENTS.md`, run `/security-review`, then `/code-review high` on the branch, fix real findings, re-run checks, and commit. Then use superpowers:finishing-a-development-branch. The PR closes #4 and #6.
