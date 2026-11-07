# Our Own Sign-In: Design

Date: 2026-11-07. Replaces the "Better Auth with its email OTP plugin" choice in [the sync design](2026-11-05-sync-design.md). Everything else in that design still holds.

## Why

Sync S1 (PR #14) shipped sign-in by emailed code using Better Auth. It works on Carol's iPhone and laptop. But the CPU check that gates S2 failed. On the Cloudflare dashboard, requests used about 39 ms at the median, with spikes near 80 ms. The Workers Free limit is 10 ms per request, and $0 is firm.

Measured locally on 2026-11-07 (Node on Carol's Mac, the bundled Worker, a real SQLite copy of the schema):

- The Worker bundle is 1.9 MB, and about 95% of it is Better Auth and what it pulls in (kysely, zod, jose, @noble/*).
- Loading the code took 30 ms of CPU.
- The first request on a fresh instance took 12 ms, mostly building Better Auth and checking the database layout. Later requests took 2–5 ms.
- Cloudflare's machines are slower per core than the Mac, which roughly accounts for the dashboard numbers.
- Glazette gets so little traffic that nearly every request lands on a fresh instance.

Every S2–S4 sync request will check the session too, so this cost would follow every later request.

Carol chose (2026-11-07) to replace Better Auth with a small sign-in we write ourselves.

## Goals

- Sign-in looks and behaves exactly as it does today, from Carol's side (Carol, 2026-11-07: "from the user point of view sign in was fine").
- Every API request, including the first on a fresh instance, uses only a few milliseconds of CPU on Cloudflare, well under 10.
- Security is at least as strict as today.
- Better Auth leaves the project entirely, including its database tables.

## Non-goals

- No change to the Account button, the Account sheet, their copy, or the app's account state handling. The two open copy questions from PR #14 (the 429 wording, feedback on "Send a new code") stay as they are.
- No new sign-in methods, no password, no account settings.
- No in-app view of the allowed list or the interest list.

## Anti-goals

- Moving to Workers Paid, or any cost above $0.
- Swapping Better Auth for another sizable auth library. That brings the same startup cost back.
- Hand-rolled crypto. Everything uses the Web Crypto that Workers provide.

## What stays the same

The app's sign-in calls are the contract. The server answers at the same addresses with the same status codes and error codes, so the app's sign-in code and its tests don't change. *(My call: this keeps the change on the server only.)*

| Request | Today's answers the app relies on |
|---|---|
| `POST /api/auth/email-otp/send-verification-otp` with `{ email, type: "sign-in" }` | 200 sent. 403 with code `NOT_OPEN` when the email isn't allowed. 429 when rate-limited. 400 `INVALID_EMAIL` or `INVALID_TYPE` for bad input. 502 `SEND_FAILED` when the email couldn't be sent. |
| `POST /api/auth/sign-in/email-otp` with `{ email, otp }` | 200 with the session cookie set. 400-range with code `INVALID_OTP` (wrong code), `OTP_EXPIRED`, or `TOO_MANY_ATTEMPTS`. 429 when rate-limited. |
| `GET /api/auth/get-session` | 200 with `{ user: { email } }` when signed in. 200 with `null` when not. |
| `POST /api/auth/sign-out` | 200, and the session ends on the server and the cookie is cleared. |

Before writing anything, the builder reads `src/account/api.ts` and the PR #14 worker tests and confirms each answer above against today's behavior, including the exact status and code for a wrong code and for an email with no code issued. Where today's behavior differs from this table, today's behavior wins.

Behavior carried over unchanged:

- Codes are 6 digits, expire after 5 minutes, and allow 3 tries. After the third wrong try the code is used up and the app shows it as expired. Asking for a new code replaces the old one.
- Only emails on the allowed list get a code. Anyone else gets `NOT_OPEN`, and their email and the time are recorded in the existing interest table.
- Each email may request at most 5 codes an hour. The count and the insert happen in one statement, as now. A send that fails gives its slot back.
- Each connection (Cloudflare's client IP header) may ask for at most 3 codes a minute, and try at most 3 sign-ins a minute. These match today's limits for those two requests.
- Emails are trimmed and lowercased, and rejected if they don't look like an email (one "@" with something either side, no spaces, at most 254 characters).
- An account is created on first successful sign-in, and only for an allowed email (the second guard stays).
- A session lasts a year from its last refresh. It is refreshed at most once a day, when the app checks the session.
- The email itself is sent through Resend exactly as now.

## The how (my calls)

- **Server.** Keep Hono and the existing Worker layout. Remove the `better-auth` package. Drop the `nodejs_compat` flag if nothing else needs it.
- **Codes.** Generated with Web Crypto randomness, uniform over 000000–999999 (no modulo bias). Stored only as an HMAC-SHA-256 of email plus code, keyed with the existing `BETTER_AUTH_SECRET` Worker secret. A keyed hash means a leaked database doesn't give up codes to a million guesses. Compared in constant time.
- **Sessions.** A random 32-byte token in the cookie. The server stores only its SHA-256 hash, the user, and the expiry. Sign-out deletes the row.
- **Cookie.** HttpOnly, Secure, SameSite=Lax, Path=/, one-year Max-Age, re-set on each refresh. The builder picks the name. If it uses the `__Host-` prefix, it checks that local dev and the Playwright tests (Chromium and WebKit) still work.
- **Requests from other sites.** Every POST must carry an Origin header that matches the app's own origin, or it's refused. This replaces Better Auth's trusted-origins check, and it's deliberately stricter. Today Better Auth checks Origin only when a cookie is present, falls back to Referer, and accepts `Origin: null` on same-origin requests. Browsers send Origin on every POST, including same-origin ones, so the app isn't affected. Local dev (the Vite dev server in front of `wrangler dev`, including phone testing over the LAN) gets its own allowed origins through local-only settings, never in production.
- **Sign-out always answers 200**, even with no cookie or a dead one, as today. The app relies on this when it retries a sign-out that didn't reach the server.
- **No rate limit on the session check or sign-out.** Neither can be used to guess anything, and skipping the limit saves a database write on every app open. Today these fall under Better Auth's general limit of 100 per 10 seconds.
- **Database.** One new migration drops Better Auth's five tables (`user`, `session`, `account`, `verification`, `rateLimit`) and adds simpler ones for users, sessions, pending codes, and the per-connection limits. `allowed_email`, `interest` and `code_request` stay as they are, with their data. Carol's current account and session go away, so she signs in once more on each device. No synced data exists yet.
  - D1 enforces foreign keys, so the migration drops the tables that point at `user` before `user` itself.
  - CI applies migrations before it deploys the new Worker. For a moment the old Worker runs without its tables, and sign-in is down until the deploy finishes. If the deploy fails, sign-in stays down until it's fixed. Signed-out use of the app is unaffected. With one user and nothing synced, that's acceptable.
- **Secrets and settings.** Keep using the `BETTER_AUTH_SECRET` secret under its current name, so no new setup is needed before merge. The `BETTER_AUTH_URL` setting may be renamed, since it lives in `wrangler.jsonc`.

## Measuring CPU

- **Before the PR:** bundle the Worker (`wrangler deploy --dry-run --outdir …`), load it in a fresh Node process with a SQLite-backed stand-in for D1, and time loading plus the first request of each kind. The harness used on 2026-11-07 is the model (now committed as `scripts/measure-worker-cpu.mjs`). The builder commits a version of it as a script so it can be rerun, and extends it to time a successful sign-in, a session check with a live cookie (including one that refreshes), and sign-out. Target: loading plus any first request totals about 3 ms or less on Carol's Mac. Report the bundle size and the numbers in the PR.
- **After merge:** Carol signs in on both devices and opens the app a few times. Then she reads CPU time on the Workers metrics page. S2 starts only if the median is under 10 ms. If not, stop and bring Carol the options.

## Left to the builder

- Table and column names for the new tables, and the cookie name.
- How the per-connection limit is stored (a fixed window in D1 is fine).
- The test layout. Today's worker tests are the starting point, and every behavior in "What stays the same" needs a test.
- Whether to update the sync design's Better Auth line to point here. It should, in the same PR.

## Pre-merge and after-merge steps

- Before merge: none expected.
- After merge: Carol signs in again on the iPhone Home Screen app and the laptop. She confirms the sign-in survives closing and reopening the app, and does the CPU check above.
