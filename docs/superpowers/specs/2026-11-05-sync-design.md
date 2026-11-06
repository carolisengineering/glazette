# Sync across devices: design

Date: 2026-11-05. Status: draft for Carol's review.

## Intent

Carol logs pieces on her iPhone at the studio and wants to plan from her laptop at home: look over pieces in progress and add notes before a session. Today each device keeps its own separate journal. This adds an account that keeps her devices in step.

It is built for Carol to use and test. Other potters at Penguin Foot may get accounts someday, but not in this project. For now anyone else who tries to sign in is turned away, and the attempt is recorded so Carol can see whether there's interest.

## Goals

- Everything Carol has (pieces, steps, glaze layers, glazes, clays, photos, settings) is the same on every device she signs in on.
- A change on one device shows up on the other the next time that device is open and online. The studio has good signal, so the phone is normally online there.
- The laptop can do everything the phone can, in the same phone-width layout. "Take photo" on a laptop opens a file picker.
- Only emails on an allowed list can sign in. Today that's Carol alone.
- Turned-away sign-in attempts are recorded with the email and the time.
- Each potter's data is private to them. No potter can ever read or change another potter's pieces or photos, even after accounts open up.

## Non-goals

- A glaze plan for a piece that isn't glazed yet. That's its own feature, built after sync.
- A wider desktop layout. Later, as its own issue.
- Opening accounts to other potters, and anything about paying.
- Sharing pieces between potters, or seeing anyone else's shelf.
- Live updates while both devices are open side by side. Picking up changes when the app opens or comes back to the foreground is enough.
- Moving the app to its own domain.

## Anti-goals

These would make it a failure even if it technically works:

- **Losing a photo for good.** This is the one Carol named. Nothing about syncing, signing in or out, or a second device may destroy a photo she didn't delete herself.
- **Sync getting in the way of logging.** A slow or missing connection must never block taking a photo, adding a step or editing. The app stays offline-first.
- **Requiring an account.** Signed out, the app works exactly as it does today, including Save a backup and Restore.
- **Emailing codes to people who aren't allowed in.**

## What Carol decided

- Sign in with an email and a 6-digit code typed into the app. Not an emailed link: on iPhone a link opens Safari, not the Home Screen app. Each device stays signed in for months.
- Only an allowed list of emails can sign in. Anyone else sees a message that accounts aren't open yet, gets no code, and their email and the time are recorded.
- The first sign-in on a device uploads everything already on it and merges it into the account.
- The laptop does everything the phone does, in today's phone-width layout.
- Deleted photos and pieces stay recoverable for 30 days.
- The backend follows the 2026-11-01 stack research, re-checked on 2026-11-05 (see Constraints). Carol wanted it weighed on job-posting value, $0 hosting and Cloudflare, the same as the original stack.

## How it works for Carol

### Signing in

- Sign-in lives in the sheet under the cloud button, alongside Save a backup and Restore. *(My call.)*
- She enters her email, gets a code by email, and types it in. Wrong or expired codes say so, and she can ask for a new one.
- An email that isn't allowed shows a short, friendly message that accounts aren't open yet. No code is sent.
- Once she's signed in, the sheet shows her email, when the device last synced, and how many photos are still waiting to upload, if any.

### First sign-in on a device

- Everything on the device merges into the account:
  - glazes and clays with the same name become one;
  - photos that are the same image become one;
  - for anything changed in both places, the later change wins, the same as day-to-day sync.
- *(My call: this is the sync merge, not Restore's. Restore lets a delete beat a later edit and keeps the device's copy of everything except pieces. Sync needs the later change to win everywhere, including un-deleting from Recently deleted.)*
- This also replaces the backup-and-restore step for moving pieces from Safari into the Home Screen app: sign in on both and they meet in the account.

### Day to day

- The app syncs when it opens, when it comes back to the foreground, after she makes a change, and when the connection returns. *(My call on the triggers.)*
- Nothing on the shelf or piece screens changes. Sync status lives in the cloud-button sheet. *(My call: no badge or spinner on the main screens.)*
- If the same thing was changed on both devices before they synced, the later change wins.
- Restore from a backup still works while signed in and keeps its own merge rules. Whatever it changes on the device then syncs like any other change. Anything it deletes shows up in Recently deleted. *(My call.)*

### Signing out

- Signing out keeps everything on the device. The app goes back to working as it does when signed out. *(My call: the safest option for photos.)*
- If anything hasn't uploaded yet, the app says so and asks before signing out.

### Recently deleted

- A "Recently deleted" list in the cloud-button sheet shows pieces and photos deleted in the last 30 days.
- Tapping one puts it back where it was, on every device. Restoring a piece brings back its photos and steps.
- **What counts as a deleted photo** *(my call)*:
  - A photo lands in Recently deleted whenever it stops showing anywhere in the journal: removed from a step, replaced by Retake, dropped along with its step, or deleted along with its piece.
  - Today the same image can be shared by more than one step, so a photo still shown on another step isn't deleted.
- **Where a restored photo goes** *(my call)*:
  - It goes back on the step it was last on, if that step still exists and has no photo.
  - Otherwise it comes back as a new step at the same stage on the same piece, dated from the photo.
  - If the piece itself was deleted, restoring the photo restores the piece too.
  - So the server keeps, for each deleted photo, which piece, step and stage it was last on.
- **The 30-day clock** starts when the server first hears about the delete, not when it happened on the device. A device that was offline or signed out for months can't send old deletes that skip Recently deleted. *(My call.)*
- After 30 days the server removes it for good and frees its space on the server. Devices keep their local copies, as they do today. Giving back space on the phone is a separate decision. *(My call.)*
- The delete confirmations stay as they are.
- *(My call: Recently deleted needs an account. Signed out, deleting works as it does today.)*

## Photo safety rules

- A photo stays on the device until the server has confirmed it's stored intact. The server checks each upload against the photo's content fingerprint, which the app already records.
- A device that has never seen a photo can't cause it to be deleted. Only an actual delete does that, and that delete is recoverable for 30 days.
- Signing out never removes a photo that hasn't uploaded.
- Save a backup keeps working with or without an account.
- A device signed in to the account downloads each photo's full image and thumbnail. *(My call: everything on every device, the same as today. Fetching full images only on demand could come later if storage on the phone becomes a problem.)*

## Constraints

### Backend

This is the choice from the 2026-11-01 stack research. Carol's local research notes, in the `notes/reports/` folder (which git doesn't track), have the full reasoning. The 2026-11-05 check is in "Glazette sync backend check.md".

- A Hono API in the same Cloudflare Worker that serves the app, under `/api/*`, so sign-in cookies are first-party.
- Better Auth with its email OTP plugin, with users and sessions in D1.
  - An allowed-list check runs before any code is sent, and records turned-away emails.
  - Rate limits are stored in the database, not in memory.
  - Sessions last 90 to 365 days.
- D1 for records, tombstones and whatever the sync needs to track. R2 for photos and thumbnails, keyed by content hash.
- Hand-rolled last-write-wins sync with tombstones. Photo bytes never change once captured, so they never conflict.
- The client keeps Dexie as the source of truth on the device.

### Cost

$0 at Carol's scale:
- Workers Free, D1 Free and R2 Free (R2 probably needs a card on file).
- Email through Resend's free tier, sending from its onboarding address to Carol's own email. That only reaches Carol, which is all this project needs. A domain (about $10/yr) waits until accounts open to others.

### Address

The app stays at glazette.offhours.workers.dev. Changing the address leaves on-device data behind, so any future move is its own decision.

### Workers Free CPU

The 10 ms CPU limit per request means photo bytes go straight to R2 (streamed or via signed upload URLs), not through Worker processing.

Measure CPU on sign-in (sending and verifying a code) and on a realistic sync batch before building anything else on top of them.

**$0 is firm (Carol, 2026-11-05).** If the free plan's limit turns out too tight, don't move to Workers Paid. Stop and bring Carol the options.

### iPhone

Confirm on a real phone that the sign-in session survives closing and reopening the Home Screen app.

### Gaps in today's data model

The builder has to close these:
- Only pieces carry a last-changed time. Steps, glaze layers, glazes, clays, photos and settings don't.
- Some deletes remove rows outright instead of leaving a tombstone: glaze layers when a step is dropped, and blank steps from an unfinished new-piece sheet. Sync needs every delete to travel.
- Each device creates its own default clay ("White stoneware") with its own id, and Carol may have made the same glaze on both devices. These must merge by name, as Restore already does.
- Settings: the studio name and the default cone and notes sync. The last-backup time stays per device.

### Allowed list

The allowed list is managed on the server. Adding a person is a one-step change Carol can make without a code deploy. *(My call: a D1 table or a Worker secret, the builder's choice.)*

### Interest list

Turned-away emails are recorded with the time. Carol looks at them in the Cloudflare dashboard's D1 console. *(My call: no in-app view in this project.)*

### Privacy

Every server read and write is scoped to the signed-in user. R2 objects aren't publicly readable.

### Scheduled cleanup

The 30-day cleanup needs a scheduled job (a Cron Trigger on the Worker).

### Process

- Testing follows the project's existing setup: Vitest, Playwright, CI on GitHub Actions, deploy on merge to main.
- New secrets (the Resend key, auth secret) are set in Cloudflare and GitHub as part of the work.

## Left to the builder

- The sync protocol: what's sent, how changes are batched, how a device knows what it has already seen.
- How fine-grained "the later change wins" is: per record or per field. Per record is acceptable for one person mostly using one device at a time.
- The server schema, migrations, and the local Dexie schema bump.
- How photo uploads and downloads are queued and retried.
- The exact wording of the sign-in, turned-away, sync-status and Recently deleted screens, following the app's existing copy style: short and plain.
- How the work splits into PRs.
