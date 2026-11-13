# Reading Glazette's telemetry in PostHog

Glazette sends a small set of events to PostHog. They hold numbers, yes/no values and fixed labels. They never hold piece names, glaze names, notes or photos. A signed-in person's email is the only free text, and it is only their ID.

## Set up (once)

1. Make a PostHog project on the free plan. Set a billing limit so it can never charge you.
2. In the project settings, turn on "Discard client IP data".
3. Copy the project key. In the GitHub repo, add a repository variable named `POSTHOG_KEY` and paste the key in. The deploy sends it to the build.
4. If the project is in the EU, change `POSTHOG_HOST` in `wrangler.jsonc` to `https://eu.i.posthog.com`. The default is the US address.

A local `pnpm build` or `pnpm deploy` has no key, so it ships no telemetry.

## The Glazette dashboard

PostHog's home page for this project is a dashboard called Glazette. Start there. It has two sections. The menu names in PostHog may differ slightly from what this guide says, since they are written from memory.

### Are they using it?

- **Who's using it**: a table with one row per person. It shows their email, or "Anonymous phone" plus a short ID. The columns are last seen, days used, launches, pieces logged, stages added, other changes, oldest piece date, phone type and version. Version is the newest `app_version` that person has sent, so it shows who is on an old build.
- **People who opened the app**: how many people launched the app each day. Coming back from the background doesn't count.
- **Pieces and stages logged**: how many pieces and stages were saved each day.
- **Who came back**: weekly retention on opening the app. Each row is a group of people who first showed up in the same week. Each column shows how many of them came back that many weeks later.

Friends who used Glazette before telemetry will look brand new, because PostHog first sees them on their first telemetry day. The "oldest piece date" column helps tell them apart. An early date means an existing friend, not a new one. It is the date of their oldest piece, saved the first time telemetry ran on their device. For a piece logged from a photo, that is the date the photo was taken, so a new friend who logs old photos can look long-standing.

### How does it feel?

- **How long things take**: one row per step: opening the app, opening a piece, preparing a photo, saving a piece, saving a stage, syncing records, syncing photos and restoring a backup. It shows the usual time, a slow time and the slowest. The slow time means 1 run in 10 is slower than that.
- **Page speed**: the browser's five speed measures: LCP, INP, CLS, FCP and TTFB. Each comes with the limit for a good score.
- **Syncs by result**: record syncs per day, split by how they ended: done, offline, signed-out or error.

## Updates and versions

Every event carries `app_version`. It looks like `2026-11-12 5c69b37`: the build date in Chicago time, then the commit.

`after_update` is true on everything from the page load right after someone taps Reload on "New version available". Leave those events out when counting launches or reading speed, because that load is not a real launch and its speed is not typical. The dashboard already leaves them out.

## Leave yourself out

Open the insight's filters and add a person filter. Set "Email" (the `email` property, which is set when someone signs in) to "doesn't equal" your own address. To do this everywhere, add the same rule under Settings, then Internal and test users.

The project is set to Chicago time, so days and weeks on the dashboard follow Chicago time.

## The events

- `app_opened`: the app was opened or came back to the screen. It says whether it runs as an installed app and whether it was resumed.
- `screen_viewed`: a screen was shown: shelf, piece, glazes, capture, account or backup.
- `piece_logged`: a new piece was saved. It says if it had a photo, its stage and how long saving took. A piece logged from a photo is reported when its details sheet closes, with the stage chosen there. A piece whose sheet is still open when the app closes isn't counted.
- `stage_added`: a stage was added to a piece. It says the stage, if it had a photo and how long it took.
- `glazes_added`: glazes were added to a piece. It says how many layers.
- `piece_edited`: a piece's details or notes were changed.
- `piece_lost`: a piece was marked lost or found again.
- `piece_deleted`: a piece was deleted.
- `step_deleted`: a stage entry was deleted.
- `put_back`: something was restored from Recently deleted: a piece or a photo.
- `signed_in`: someone signed in.
- `signed_out`: someone signed out. They then get a new anonymous ID.
- `backup_saved`: a backup was saved. It says how long it took, and that includes the time the friend spent in the share sheet.
- `backup_restored`: a backup was restored. It says how long it took.
- `startup`: the shelf finished loading. It says how long and how many pieces.
- `piece_opened`: a piece screen finished loading. It says how long and whether it has a photo. Opens slower than 10 seconds aren't sent, for example when the photo is still waiting to download, so the slowest opens are missing.
- `photo_processed`: a chosen photo was prepared. It says how long and its size in megabytes.
- `sync_records`: a record sync ran. It says how long, how it ended (done, offline, signed-out or error) and how many records went up and down.
- `sync_photos`: a photo sync ran. It says how long, how it ended, how many photos went up and down and how many bytes.
- `web_vital`: a standard speed measure from the browser: LCP, INP, CLS, FCP or TTFB.
- `telemetry_started`: sent every time the app starts. It carries `pieces` (how many pieces) and `first_piece_date`. PostHog keeps the first values it ever saw as person properties, so those show the state at the person's first telemetry start.
- `$exception`: an error the app caught.

A signed-in person is known by their email. Signing out starts a new anonymous ID, so the same person can show up twice.
