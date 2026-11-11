# Telemetry: design

Date: 2026-11-10. Status: draft for Carol's review.

## Intent

Carol has shared Glazette with a few friends. Once the app is on their phones she can't see how it's used. She wants to answer two questions:

1. **Are they actually using it?** Do they log pieces, and do they come back over the following days and weeks, or try it once and stop?
2. **How does it feel to use?** How quickly screens respond, and how long saving and loading take on their phones.

She'll read the answers herself, in PostHog's own dashboards. Nobody else reads them.

## Goals

- Carol can see, per friend, when they opened the app and what they did: logged a new piece, added a stage, added glazes, edited, deleted.
- Carol can see who came back, and when, after their first use.
- Carol can see how long the things that matter take on real phones: the app starting up and showing the shelf, opening a piece, processing a photo, saving, and syncing.
- Carol can see errors that happen on friends' phones.
- Signed-in friends show up by email. Friends who haven't signed in show up as anonymous phones.

## Non-goals

- Telling friends about telemetry, or giving them a setting to turn it off. Carol is handling that herself.
- Dashboards or stats pages inside Glazette. Carol uses PostHog's.
- Tracking every tap. A small set of meaningful events beats a firehose.
- Server-side metrics. Cloudflare's own observability, already on, covers the Worker.

## Anti-goals

These would make it a failure even if it technically works:

- **Sending what friends wrote or photographed.** No photos, piece names, notes, glaze names, clay names or studio names go to PostHog. The app's own properties are only counts, timings, dates, stage names, IDs and the signed-in email. *(Stage names are the app's fixed list, like "bisqued". IDs are random and mean nothing outside the app.)* What PostHog adds to every event on its own is covered under "What PostHog adds by itself" below.
- **Slowing the app down or getting in its way.** Telemetry never blocks a save, a screen or sync. If PostHog is unreachable or blocked, the app behaves exactly as it does today.
- **Breaking offline use.** The app still starts and works fully offline.
- **Costing money.** $0 is firm for this project, the same as for sync.
- **Polluting the numbers with development.** Local dev, tests and end-to-end runs send nothing.

## What Carol decided

- PostHog, the hosted analytics service. She's fine with friends' usage data going there.
- She wants to know which friend is which. Signed-in friends are identified by their sign-in email. Anonymous users are fine too.
- Telemetry includes how fast screens respond and how long saving and loading take, not just usage.
- She'll tell friends herself. Nothing about telemetry appears in the app.
- *(She agreed to these after I proposed them)*: a handful of meaningful events rather than every tap; no friend-written content or photos sent; session recordings off; nothing sent from local dev.

## How it works

### Who's who

- When the app starts, each phone gets PostHog's anonymous ID, and that ID stays on the phone.
- When a friend signs in, the app tells PostHog the anonymous ID belongs to their email. What they did on that phone before signing in gets attached to them. *(My call.)*
- An already-signed-in phone identifies itself as soon as the app starts, from the email the app already keeps on the device.
- Signing out starts a fresh anonymous ID, so a shared phone doesn't blend two people. *(My call.)*
- The email is the person's ID in PostHog. *(My call: the device only knows the email, not the server's account ID, and emails don't change in Glazette.)*

### What gets recorded

*(My call on the list. The builder may adjust names and add a property or two, within the anti-goals.)*

Usage:
- **App opened**, including when it comes back to the foreground. Whether it was opened from the Home Screen or in a browser tab.
- **Screen viewed**: shelf, piece, glazes, capture, account. Route changes, with IDs but no content.
- **Piece logged**: with whether it had a photo and its starting stage.
- **Stage added**: with the stage, and whether it had a photo.
- **Glazes added to a piece**: with how many layers. No glaze names.
- **Piece edited**, **piece marked lost**, **piece deleted**, **photo removed**, **put back from Recently deleted**.
- **Signed in**, **signed out**.
- **Backup saved**, **backup restored**.

How it feels (each a duration in milliseconds, plus a little context):
- **Startup**: from launch until the shelf first shows pieces, with the number of pieces on the device. This is the main "how fast does it open" number.
- **Page speed**: PostHog's built-in web-vitals measurements (how soon the page shows something, how quickly it responds to taps, how much it jumps around).
- **Photo processed**: resizing and encoding a captured photo, with the original photo's file size. Likely the slowest thing a friend waits for.
- **Saved**: writing a new piece or stage to the phone.
- **Piece opened**: from tapping a piece until its photo and journey show.
- **Sync**: one record sync, with how it ended (done, offline, error) and how many records went up and down. One photo transfer run, with how many photos and bytes moved.

Errors:
- Uncaught errors and the errors the app already logs (for example a sync that ends in error), using PostHog's error capture. Error messages and stack traces only. Nothing from the user's records.

### Friends who were using the app before telemetry

Friends who already have the app will first show up on whatever day the update reaches their phone. That day differs per friend, because updates wait for them to accept the reload prompt. To keep "who came back" honest, the app records once per person the date the device's earliest piece was logged and how many pieces it already had when telemetry first ran. Carol can then tell a brand-new friend from one who's been logging for weeks. *(My call.)* The note for Carol (see "Left to the builder") explains how to read the retention chart with this in mind.

### What PostHog adds by itself

PostHog attaches some details to every event on its own. *(My call on each.)*
- **Kept:** device type, browser, operating system, screen size, and the page address, which contains only IDs. Without device and OS the timings can't be read: a slow save on an old Android phone means something different from one on a new iPhone.
- **Turned off:** the phone's IP address and the location PostHog works out from it. Neither question needs them. The library is set not to send them and the PostHog project is set to discard them (see Pre-merge steps). The pass-through therefore doesn't need to forward the friend's IP.
- **Referrer:** kept. It only shows how someone first reached the app.

### What's turned off

- Session recordings. They would capture friends' photos and notes.
- Automatic click capture. It records the text of what was tapped, which can include piece and glaze names.
- Surveys, heatmaps and anything else that loads extra scripts at runtime.

### When it sends

- Only in the production build, and only when a PostHog project key was provided at build time. Local dev, unit tests and end-to-end runs send nothing.
- Events queue in the background and send in batches. If the phone is offline, events wait and send later, best effort. Losing a few events from a phone that stays offline and then closes is acceptable. *(My call.)*

### Getting past ad blockers

- Events go to PostHog through the app's own Worker, at a path under the app's own address, rather than straight to PostHog's address. Many ad blockers and Safari's tracking protection block PostHog's address, and with only a few friends, losing one friend's data would skew everything. *(My call.)*
- The Worker only passes requests through. This keeps its CPU use well inside Workers Free.
- If that pass-through risks the Workers Free limits, fall back to sending straight to PostHog and tell Carol which friends' data might be missing as a result.

### Carol's own use

Carol uses the app herself, so her events will be in the data. She can filter out her email in PostHog. *(My call: no special handling in the app.)*

## Constraints

- **Cost:** PostHog's free plan. Set its billing limits so it can never charge. Workers Free for the pass-through.
- **Stack:** the PostHog JavaScript library, bundled with the app like the other dependencies. No script loaded from PostHog's servers.
- **App size:** the PostHog library loads after the app first shows, so startup isn't slower. *(My call.)*
- **Offline and PWA:** the service worker must not cache or intercept PostHog requests.
- **Privacy rule for the builder:** every property the app sets is either a fixed value from the app (a stage, a route, a count, a duration, a date, a yes/no) or an ID. The signed-in email is the one exception. Never a free-text field. Tests check this for each event the app sends. They don't need to cover what PostHog adds by itself, which is handled by configuration.
- **Testing:** the project's existing setup, Vitest and Playwright. Tests use a stand-in for PostHog, and no test sends to the real service.

## Pre-merge steps (for Carol)

- Create a PostHog account and project on the free plan, and set billing limits so it never charges.
- In the project settings, turn on the option to discard client IP data.
- Give the builder the project key and the region (US or EU), so the build can use them. The key is safe to ship in the app. PostHog designs it to be public.

## Left to the builder

- Exact event and property names.
- Where timing hooks go in the code, as long as measuring never changes behavior and never throws.
- The pass-through path and how it's routed in the Worker.
- How the project key and region reach the build.
- A short note for Carol on building the two views she wants in PostHog: a "who came back" retention chart and a timings chart. *(My call: a note, not set up by code.)*
- How the work splits into PRs. It likely fits in one.
