# Reading Glazette's telemetry in PostHog

Glazette sends a small set of events to PostHog. They hold numbers, yes/no values and fixed labels. They never hold piece names, glaze names, notes or photos. A signed-in person's email is the only free text, and it is only their ID.

## Set up (once)

1. Make a PostHog project on the free plan. Set a billing limit so it can never charge you.
2. In the project settings, turn on "Discard client IP data".
3. Copy the project key. In the GitHub repo, add a repository variable named `POSTHOG_KEY` and paste the key in. The deploy sends it to the build.
4. If the project is in the EU, change `POSTHOG_HOST` in `wrangler.jsonc` to `https://eu.i.posthog.com`. The default is the US address.

A local `pnpm build` or `pnpm deploy` has no key, so it ships no telemetry.

## Who came back (retention)

The menu names below come from memory and may differ slightly in PostHog. Carol: please check them when you set this up and fix any that are off.

1. Open Product analytics and make a new Retention insight.
2. Set both the starting event and the returning event to `app_opened`.
3. Count by unique users. Pick weekly or daily periods.

Friends who used Glazette before telemetry will look brand new, because PostHog first sees them on their first telemetry day. To tell them apart, use `first_piece_date`. It is the date of their oldest piece, saved on the person the first time telemetry ran on their device. Break the insight down by this person property. An early date means an existing friend, not a new one. The date is the oldest piece's own date, and for a piece logged from a photo that is the date the photo was taken. A new friend who logs old photos can therefore look long-standing.

## How fast it is (timings)

1. Make a new Trends insight.
2. Pick one of these events: `startup`, `piece_opened`, `photo_processed`, `piece_logged`, `stage_added` or `sync_records`.
3. Change the math to "Median" of the property `ms`. Add a second series with "90th percentile".
4. Break down by "Operating system".

The median shows the usual wait. The 90th percentile shows the slow ones.

## Leave yourself out

Open the insight's filters and add a person filter. Set "Email" (the `email` property, which is set when someone signs in) to "doesn't equal" your own address. To do this everywhere, add the same rule under Settings, then Internal and test users.

## The events

- `app_opened`: the app was opened or came back to the screen. It says whether it runs as an installed app and whether it was resumed.
- `screen_viewed`: a screen was shown: shelf, piece, glazes, capture, account or backup.
- `piece_logged`: a new piece was saved. It says if it had a photo, its stage and how long saving took. A piece logged camera-first is saved as Thrown before the friend picks its stage, so its stage here is Thrown. A Retake from the details sheet also logs one extra piece.
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
- `piece_opened`: a piece screen finished loading. It says how long and whether it has a photo. It is not sent when the photo never loads, for example one still waiting to download, so the slowest opens are missing.
- `photo_processed`: a chosen photo was prepared. It says how long and its size in megabytes.
- `sync_records`: a record sync ran. It says how long, how it ended (done, offline, signed-out or error) and how many records went up and down.
- `sync_photos`: a photo sync ran. It says how long, how it ended, how many photos went up and down and how many bytes.
- `web_vital`: a standard speed measure from the browser: LCP, INP, CLS, FCP or TTFB.
- `telemetry_started`: sent every time the app starts. It carries `pieces` (how many pieces) and `first_piece_date`. PostHog keeps the first values it ever saw as person properties, so those show the state at the person's first telemetry start.
- `$exception`: an error the app caught.

A signed-in person is known by their email. Signing out starts a new anonymous ID, so the same person can show up twice.
