# Stages without photos

Covers GitHub issues #4 (allow skipping a photo for a stage) and #6 (the camera opens by
itself). Piece ideas, meaning pieces planned but not yet thrown, are split out to #9 and are
not part of this work.

## Why

Carol started using Glazette with pieces already in progress, and she doesn't photograph every
piece at every stage. Today the app can't record a stage without a photo:

- A new piece is always saved as Thrown, with a photo.
- Moving a piece forward always starts with the camera.
- Jumping a piece from Thrown to Bisqued is possible (the stage row lets you tap any later
  stage), but the skipped Trimmed stage leaves no trace in the journey.

Carol's three real cases:

1. **Starting late.** The piece was already bisqued when she started using the app. Its
   journey should show Thrown, Trimmed and Bisqued, with a photo only on Bisqued.
2. **A missed photo.** She photographed it thrown, forgot to photograph it trimmed, then
   photographed it bisqued. The journey should still show Trimmed.
3. **Backlogging.** She's catching the app up after the fact, with nothing to photograph:
   marking pieces Trimmed from the couch, or adding a piece that's sitting on the studio shelf.

## Goals

- A stage can be recorded without a photo.
- A new piece can start at any stage, with or without a photo.
- A new piece can be added with no photo at all.
- When a piece skips stages, the skipped stages appear in its journey as steps with no photo.
- A step with no photo has no date unless Carol adds one. She can add, change or clear its
  date later.
- The camera doesn't open until Carol taps Take photo (#6).

## Non-goals

- Piece ideas: pieces before Thrown (#9).
- Adding a photo to an existing no-photo step later. *(Builder's call; see "Calls made".)*
- Changing the date of a step that has a photo.
- Moving a piece backward to an earlier stage.

## Anti-goals

- Making the photo feel optional in the everyday flow. Taking a photo stays the first and
  biggest choice. No photo is the third option, not the default.
- Inventing dates. A step Carol didn't date shows no date. The app never fills in a guessed
  date such as "today" or the date of the next photo.

## How it works

### The capture start screen (#6)

The +, the arrow on a shelf card, "Move … to …" on a piece, and "Add photo" on a piece all open
the capture start screen. Today the camera opens automatically over that screen. After this
change it doesn't: the screen shows its choices and waits.

The choices are **Take photo**, **Choose from library**, **No photo** (new), and **Cancel**. No
photo uses a quieter style than the two photo buttons: an outlined pill under them, as in the
mockup.

No photo doesn't appear when the screen was opened from "Add photo" on a piece, because that
button exists only to add a photo.

### No photo, starting from a piece

When Carol starts from a shelf card's arrow or from "Move … to …", the piece is already known.
No photo goes straight to the stage screen for that piece.

### No photo, starting from the + button

The piece isn't known yet. As the approved mockup says, Carol still chooses between New piece
and Update, the same as with a photo. No photo leads to a short choice on the dark capture
screen with two buttons, **Update a piece** and **New piece**, plus Cancel. *(Claude's call
on the layout.)* If nothing is in progress, it skips the choice and goes straight to New
piece, matching today's first-run rule.

- **Update a piece** opens the existing pick-a-piece sheet without a photo. The photo header
  and Retake are hidden, and the heading becomes "Which piece?" instead of "Which piece is
  this?". Its "Not here? Save as a new piece" link opens the new-piece details screen. Picking
  a piece and confirming opens the stage screen.
- **New piece** opens the new-piece details screen without a photo.

### The stage screen without a photo

The stage screen is today's screen with these changes:

- The photo area at the top is replaced by a slim placeholder that says there's no photo for
  this update, as in the mockup.
- A **Date · optional** field is added. It starts empty, and an empty date is saved as no
  date. It appears only when there's no photo; a photo carries its own date.
- The glaze rows still appear for Glazed, so backlogged glazes can be recorded.
- **Glazes when skipping past Glazed (Carol's decision).** With or without a photo, if the
  chosen stage is after Glazed and the move fills in a Glazed step (for example, Bisqued to
  Fired), the glaze rows appear under a "Glazes" label. Any glazes entered are saved on the
  filled-in Glazed step. Leaving them empty is fine.
- The existing summary line ("Moves Double Cups from Thrown to Bisqued") stays as it is
  today. No extra wording about skipped stages is added. Carol asked for that wording to be
  removed from the mockup.
- The save button reads the same as today ("Save to Bisqued"). If the chosen stage is the
  piece's current stage, it reads "Save" instead of "Save photo".

The stage rules don't change: any stage from the current one onward can be picked, the next
stage is preselected, and a lost piece preselects its current stage.

### New pieces start at any stage

The new-piece details screen gets a **Stage** row, using the same five stages as the stage
screen, with Thrown selected. It appears with and without a photo. The "Saved to your shelf as
Thrown" confirmation follows the chosen stage.

- **With a photo:** the photo belongs to the chosen stage. Stages before it are added as
  no-photo steps.
- **Without a photo:** the photo area is replaced by the slim no-photo placeholder (Retake is
  hidden, since there's nothing to retake). The chosen stage is saved without a photo and
  without a date. Stages before it are added as no-photo steps.

**Glazes (Carol's decision).** When the chosen stage is Glazed or Fired, the details screen
shows the same glaze rows as the stage screen. Glazes entered are saved on the Glazed step,
whether that step has the photo (Glazed) or was filled in (Fired). Leaving them empty is fine.

Today the piece is saved as Thrown as soon as Carol taps Use photo, and the details screen edits
that saved piece. Picking a later stage on the details screen must leave exactly one step per
stage up to the chosen one, with the photo on the chosen stage. Switching the stage back and
forth must not leave extra steps behind. How this is done is up to the builder.

Leaving the screen without tapping Done *(Claude's call)*:

- **With a photo:** the piece is kept, as today, at the stage on screen when Carol left.
  Retake still throws the piece away.
- **Without a photo:** nothing is saved until Done. The screen gets a Close button in place of
  Retake, and closing saves nothing.

### Skipped stages are filled in

Whenever a piece moves forward past one or more stages, with or without a photo, each skipped
stage is added as a step with no photo, no date and no note. The one exception is a filled-in
Glazed step, which carries any glazes Carol entered. Examples:

- Thrown → Bisqued adds Trimmed.
- A new piece started at Glazed adds Thrown, Trimmed and Bisqued.
- A piece with no steps yet that's saved as Bisqued adds Thrown and Trimmed.

Only stages strictly between the piece's current stage and the new stage are filled. If Carol
deletes a filled-in step, it stays deleted: moving the piece forward later never reaches back
past its current stage, so it doesn't bring the step back.

### The journey

Steps with no photo use the slim row Carol picked (mockup option B):

- No thumbnail. A small dot sits in the thumbnail column so the row lines up with the others.
- The stage name in muted text, the note if there is one, and the delete button, the same as
  other rows.
- If the step has no date, an **Add date** link sits where the date would be. If it has a
  date, the date shows there instead.
- Tapping Add date, or the date, opens a date picker. Carol can set, change or clear the date.
  Clearing it returns the row to Add date.
- Steps with photos look and behave as they do today.

Order stays newest first: later stage first, then later date within a stage. Within one stage,
an undated step sorts below dated steps of the same stage. *(Builder's call.)*

### Everywhere else a date is shown or used

- **Piece header** ("Bisqued · Nov 3"): if the current step has no date, it shows only the
  stage name.
- **Before/after, glaze swatches, hero photo:** these already use only steps with photos, so
  undated no-photo steps don't affect them.
- **Fired pieces leaving the All filter after 14 days (Carol's decision):** if the piece's
  latest Fired step has no date, the piece leaves All right away. It still shows under the
  Fired chip. Adding a recent date brings it back to All until 14 days after that date.
- **Day count** ("Day 16") counts from when the piece was added. A piece added from memory
  counts from the day it was added to the app. *(Builder's call.)*

## Data

- A stage step's date becomes optional. Existing steps all have dates and need no migration.
- The database has an index on piece plus date. IndexedDB leaves out records whose indexed
  value is missing, so undated steps won't appear in that index. The builder must check that
  nothing relies on that index to list a piece's steps, and change the schema or the query if
  something does.
- A piece's created date is still required. For a piece added with no photo, it's the day it
  was added.
- Backup and export (planned for a later PR) must handle undated steps.
- **One-time fill for existing pieces (Carol's decision).** Pieces that skipped a stage before
  this change get the missing steps filled in once, when the update first loads. For each
  piece, every stage before its current stage that has no step at all gets a no-photo, undated
  step. A stage whose step was deleted counts as having a step, so it isn't filled. The fill
  runs once and isn't repeated.

## Calls made

These are Claude's calls, not things Carol decided. She can overrule any of them.

- Adding a photo to an existing no-photo step later is out of scope.
- From the + button, No photo leads to an Update a piece / New piece choice on the dark capture
  screen, or straight to New piece when nothing is in progress. The pick sheet without a photo
  hides its photo header and Retake.
- Leaving the new-piece screen: with a photo, the piece is kept at the stage on screen; without
  a photo, nothing is saved and the screen gets a Close button.
- Within one stage, undated steps sort below dated steps.
- The Date field on the stage screen appears only when there's no photo.
- Day count for a piece added from memory starts on the day it was added.
- No photo is hidden when capture was opened from "Add photo".

## Left to the builder

- How the new-piece save works so that changing the stage can't leave extra steps behind.
- The date picker control (the platform's native date input is fine).
- Exact styling of the slim row and the no-photo placeholder, following the mockups and the
  existing design tokens.
- How capture knows it was opened from "Add photo" versus "Move … to …".

## Carol's decisions after the builder check

- Glazes can be recorded when a new piece starts at Glazed or Fired, or a move skips past
  Glazed.
- An undated Fired piece leaves the All filter right away.
- Existing pieces get their skipped stages filled in once.

## Mockups

Brainstorm mockups are in `.superpowers/brainstorm/` (not committed):
`journey-no-photo.html` (option B chosen) and `no-photo-flow.html` (approved apart from the
wording that was removed).
