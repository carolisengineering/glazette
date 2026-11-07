# Our Own Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Better Auth with a small hand-written email-code sign-in that answers the app exactly as today and uses a few milliseconds of CPU per request.

**Architecture:** Four small modules under `worker/` (crypto helpers, sign-in codes, sessions, rate limits) over plain D1 SQL, wired into Hono routes at the same `/api/auth/*` addresses Better Auth served. New tables arrive first (Tasks 1–2) so every task stays green. Task 3 switches the routes over, drops Better Auth's tables and removes the package. Task 4 measures CPU.

**Tech Stack:** Cloudflare Workers, Hono, D1, Web Crypto, Vitest with wrangler's `getPlatformProxy` (tests run in Node against a real local D1).

**Spec:** `docs/superpowers/specs/2026-11-07-own-sign-in-design.md`

## Global Constraints

- The app's sign-in calls in `src/account/api.ts` are the contract. Don't change that file or its tests. Today's behavior wins over any table in the spec.
- No new runtime dependencies. Remove `better-auth`. Keep `hono`.
- Crypto only through Web Crypto (`crypto.getRandomValues`, `crypto.subtle`, `crypto.randomUUID`). No `node:` imports in `worker/` outside tests.
- Codes: 6 digits, expire after 5 minutes, 3 tries. A new request replaces the old code and resets its tries.
- Limits: 5 codes per email per hour (existing `code_request` statement, refund on failed send). Per client IP (`cf-connecting-ip`, or the shared key `no-ip` when it's missing): 3 send-code requests per 60 s, 3 sign-in tries per 60 s. No limit on get-session or sign-out.
- Emails are trimmed and lowercased. Plausible means: at most 254 characters, matching `/^[^\s@]+@[^\s@]+$/`.
- Sessions last 365 days from the last refresh. They're refreshed at most once a day, when checked.
- Cookie: `__Host-session_token`, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`. Cleared with the same attributes and `Max-Age=0`.
- Every POST under `/api/auth` needs an `Origin` equal to the origin of `APP_ORIGIN` or to one listed in the optional `EXTRA_ORIGINS` (comma-separated, local dev only, never in `wrangler.jsonc`). Otherwise it gets 403 `BAD_ORIGIN` and nothing is written.
- Keep the `BETTER_AUTH_SECRET` Worker secret under its current name. Rename the `BETTER_AUTH_URL` setting to `APP_ORIGIN`.
- Error answers are JSON `{ code, message }`. American spelling in all new text.
- CPU target: on Carol's Mac, loading the bundle plus any first request is about 3 ms or less.

## Review Focus

1. **Several wrong guesses at once** (parallel requests, or many IPs) must not get more than 3 comparisons against one code. Pinned in Task 1.
2. **A garbage, tampered, expired or signed-out cookie.** get-session answers 200 `null`, sign-out answers 200, nothing throws. Pinned in Tasks 2 and 3.
3. **A malformed body** (not JSON, email not a string, missing otp, a 7-digit or non-digit otp) is a 400, never a 500, and writes nothing. Pinned in Task 3.
4. **A POST from another site, or with no Origin header**, is refused before anything is written or emailed. Pinned in Task 3.
5. **A request with no `cf-connecting-ip`** (local dev, odd proxies) falls into the shared bucket and still works. Pinned in Task 2.

---

### Task 1: Sign-in codes

**Files:**
- Create: `migrations/0003_own_sign_in.sql`, `worker/crypto.ts`, `worker/codes.ts`, `worker/crypto.test.ts`, `worker/codes.test.ts`

**Interfaces:**
- Produces, in `worker/crypto.ts`:
  - `randomCode(): string`: 6 digits, uniform. Draw `Uint32` values from `crypto.getRandomValues` and reject any value `>= 4_294_000_000` (the largest multiple of 1,000,000 below 2³²), then take `% 1_000_000` and pad to 6 digits.
  - `randomToken(): string`: 32 random bytes, base64url without padding.
  - `hmacHex(secret: string, data: string): Promise<string>`: HMAC-SHA-256, lowercase hex.
  - `sha256Hex(data: string): Promise<string>`: lowercase hex.
  - `sameHex(a: string, b: string): boolean`: constant-time over equal-length strings (XOR-accumulate every character). False on length mismatch.
- Produces, in `worker/codes.ts`:
  - `CODE_TTL_MS = 5 * 60 * 1000`, `CODE_TRIES = 3`.
  - `issueCode(db: D1Database, secret: string, email: string, now: number): Promise<string>`: returns the plain code and stores only `hmacHex(secret, `${email}:${code}`)`. Upserts so the email's previous code is replaced and its tries reset.
  - `type CodeCheck = 'ok' | 'INVALID_OTP' | 'OTP_EXPIRED' | 'TOO_MANY_ATTEMPTS'`
  - `checkCode(db: D1Database, secret: string, email: string, otp: string, now: number): Promise<CodeCheck>`
- The migration creates all four new tables. Tasks 2 and 3 use the other three:
  ```sql
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, created_at INTEGER NOT NULL, refreshed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE sign_in_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
  ```
  All times are epoch milliseconds. Keep the `--` comment style of `0002`. The test harness splits files on `;`, so no semicolons inside comments.

- [ ] **Step 1: Write the failing tests**

`worker/crypto.test.ts`:
- `randomCode` returns `/^\d{6}$/` for 1,000 draws, and at least 900 of those draws are distinct.
- `randomToken` matches `/^[A-Za-z0-9_-]{43}$/`, and two calls differ.
- `hmacHex('k', 'm')` equals the known HMAC-SHA-256 of key `k` and message `m`: compute it once with `node:crypto` in the test and compare. The same goes for `sha256Hex('abc')` against `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
- `sameHex('ab', 'ab')` is true, and `sameHex('ab', 'ac')` and `sameHex('ab', 'abc')` are false.

`worker/codes.test.ts` (uses `makeTestEnv`, with fixed `now` values, no fake timers):
- `the right code is ok once, then INVALID_OTP`.
- `a wrong code is INVALID_OTP`, and `a code for an email with none issued is INVALID_OTP`.
- `a code is OTP_EXPIRED after 5 minutes`: check at `now + CODE_TTL_MS + 1`. The row is deleted, so a second check is `INVALID_OTP`.
- `after 3 wrong tries even the right code is TOO_MANY_ATTEMPTS`: the first three wrong checks are `INVALID_OTP`.
- `the right code on the third try still works`: two wrong, then right, is `ok`.
- `a new code replaces the old one and resets tries`: issue, two wrong, issue again. The old code is `INVALID_OTP` and the new one is `ok`.
- `parallel wrong guesses get at most 3 comparisons` (Review Focus 1): issue, then run 6 wrong checks with `Promise.all`. Exactly 3 are `INVALID_OTP` and 3 are `TOO_MANY_ATTEMPTS`. Then the right code is `TOO_MANY_ATTEMPTS`.
- `the stored hash does not contain the code`: `sign_in_codes.code_hash` doesn't include the 6 digits.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run --project worker worker/crypto.test.ts worker/codes.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `migrations/0003_own_sign_in.sql`, `worker/crypto.ts` and `worker/codes.ts`**

`checkCode` must claim a try atomically before comparing, so parallel requests can't share one try:

```
1. UPDATE sign_in_codes SET attempts = attempts + 1
     WHERE email = ? AND attempts < 3 AND expires_at > now RETURNING code_hash
2. If a row came back:
     match = sameHex(code_hash, hmacHex(secret, `${email}:${otp}`))
     if match: DELETE ... WHERE email = ? AND code_hash = ?   -> changes === 1 ? 'ok' : 'INVALID_OTP'
     else 'INVALID_OTP'
3. If no row: SELECT expires_at, attempts for the email
     none                -> 'INVALID_OTP'
     expires_at <= now   -> DELETE it, 'OTP_EXPIRED'
     otherwise           -> 'TOO_MANY_ATTEMPTS'
```

- [ ] **Step 4: Run them and see them pass, plus the whole worker suite**

Run: `pnpm vitest run --project worker`
Expected: all pass, including the existing Better Auth tests, which are untouched.

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_own_sign_in.sql worker/crypto.ts worker/codes.ts worker/crypto.test.ts worker/codes.test.ts
git commit -m "feat(worker): sign-in codes stored as keyed hashes, three tries each"
```

---

### Task 2: Sessions and per-connection limits

**Files:**
- Create: `worker/sessions.ts`, `worker/limits.ts`, `worker/sessions.test.ts`, `worker/limits.test.ts`

**Interfaces:**
- Consumes: `randomToken`, `sha256Hex` (Task 1). The `users`, `sessions` and `rate_limits` tables (Task 1).
- Produces, in `worker/sessions.ts`:
  - `SESSION_COOKIE = '__Host-session_token'`, `SESSION_TTL_MS = 365 * 86_400_000`, `REFRESH_AFTER_MS = 86_400_000`.
  - `createSession(db: D1Database, userId: string, now: number): Promise<string>`: returns the plain token and stores its `sha256Hex`.
  - `type SessionUser = { userId: string; email: string; refreshed: boolean }`
  - `readSession(db: D1Database, token: string, now: number): Promise<SessionUser | null>`
    - Unknown token: null.
    - Expired: delete the row, then null.
    - `now - refreshed_at >= REFRESH_AFTER_MS`: set `refreshed_at = now` and `expires_at = now + SESSION_TTL_MS`, and return `refreshed: true`.
  - `endSession(db: D1Database, token: string): Promise<void>`: deletes the row. Never throws for an unknown token.
  - `sessionCookie(token: string): string` and `clearedSessionCookie(): string`: full `Set-Cookie` values with the Global Constraints attributes.
  - `tokenFromCookie(header: string | null | undefined): string | null`: reads `__Host-session_token` from a Cookie header.
- Produces, in `worker/limits.ts`:
  - `overLimit(db: D1Database, key: string, windowMs: number, max: number, now: number): Promise<boolean>`: a fixed window, counted in one upsert statement. If the stored `window_start <= now - windowMs`, it resets to `(now, 1)`. Otherwise it increments `count`. It uses `RETURNING count` and returns `count > max`.
  - `clientKey(req: Request, path: string): string`: `` `${ip}|${path}` ``, with `ip` from `cf-connecting-ip` or `'no-ip'`.
  - Move `admitCodeRequest` (the allowed-list check, the interest row and the 5-per-hour insert) and the refund `DELETE` out of `worker/auth.ts` into this file unchanged. Export `admitCodeRequest(db, email): Promise<'not-open' | 'too-many' | number>` (number = slot rowid), `refundCodeRequest(db, slot: number): Promise<void>`, and `isAllowed(db, email): Promise<boolean>`. `worker/auth.ts` keeps working by importing them, mapping the results back to its `APIError`s.

- [ ] **Step 1: Write the failing tests**

`worker/sessions.test.ts` (insert a `users` row directly):
- `a new session reads back with the user's email`, with `refreshed: false`.
- `an unknown or garbage token is null` (Review Focus 2): tokens `''`, `'x'`, and a valid-looking `randomToken()` never issued.
- `an expired session is null and its row is gone`: read at `now + SESSION_TTL_MS + 1`.
- `a session is refreshed at most once a day`:
  - At `now + REFRESH_AFTER_MS - 1`: `refreshed: false` and `expires_at` unchanged.
  - At `now + REFRESH_AFTER_MS`: `refreshed: true` and `expires_at === now + REFRESH_AFTER_MS + SESSION_TTL_MS`.
- `endSession removes the session, and ending an unknown token is fine`.
- `the stored hash is not the token`.
- `the cookie is HttpOnly, Secure, SameSite=Lax, Path=/, a year long`: assert each attribute in `sessionCookie('t')`, `Max-Age=0` in `clearedSessionCookie()`, and that `tokenFromCookie('a=1; __Host-session_token=t; b=2') === 't'`, with null for a missing header.

`worker/limits.test.ts`:
- `the 4th hit in a window is over, and a new window starts fresh`: hits at `now` give `[false, false, false, true]`, and a hit at `now + 60_000` is false.
- `different keys don't share a window`.
- `parallel hits are counted exactly`: 6 hits with `Promise.all`, so exactly 3 are false.
- `clientKey uses cf-connecting-ip, or no-ip when it's missing` (Review Focus 5).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run --project worker worker/sessions.test.ts worker/limits.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `worker/sessions.ts` and `worker/limits.ts`, and repoint `worker/auth.ts` at the moved helpers**

- [ ] **Step 4: Run the whole worker suite**

Run: `pnpm vitest run --project worker`
Expected: all pass, including the unchanged Better Auth tests.

- [ ] **Step 5: Commit**

```bash
git add worker/sessions.ts worker/limits.ts worker/sessions.test.ts worker/limits.test.ts worker/auth.ts
git commit -m "feat(worker): hashed year-long sessions and per-connection limits"
```

---

### Task 3: Switch the sign-in routes over and remove Better Auth

**Files:**
- Rewrite: `worker/auth.ts`, `worker/auth.test.ts`
- Modify: `worker/app.ts`, `worker/env.ts`, `worker/test/harness.ts`, `wrangler.jsonc`, `package.json`, `pnpm-lock.yaml`
- Create: `migrations/0004_drop_better_auth.sql`
- Delete: `worker/app-reuse.test.ts`

**Interfaces:**
- Consumes: everything Tasks 1–2 produce. `SendCode` and `resendSender` in `worker/email.ts` are unchanged.
- Produces:
  - `type Env = { DB: D1Database; BETTER_AUTH_SECRET: string; APP_ORIGIN: string; RESEND_API_KEY: string; EXTRA_ORIGINS?: string }`.
  - `authRoutes(sendCode: (env: Env) => SendCode): Hono<{ Bindings: Env }>` in `worker/auth.ts`, mounted by `createApp` at `/auth` (under the existing `/api` base path). `createApp(deps: AppDeps = {})` keeps its signature and passes `() => deps.sendCode` when it's given, otherwise `resendSender`. The `WeakMap` instance cache goes away.
  - The routes and their answers:

| Route | Order of checks | Answers |
|---|---|---|
| `POST /email-otp/send-verification-otp` | origin, then the IP limit (3 per 60 s), then the body, then `type === 'sign-in'`, then `admitCodeRequest`, then `issueCode` and send | 200 `{ success: true }` · 403 `BAD_ORIGIN` · 429 `TOO_MANY_REQUESTS` · 400 `INVALID_BODY` / `INVALID_EMAIL` / `INVALID_TYPE` · 403 `NOT_OPEN` · 502 `SEND_FAILED` (refund the slot, and log `'Could not send the sign-in code:'` with the error via `console.error`) |
| `POST /sign-in/email-otp` | origin, then the IP limit (3 per 60 s), then the body (otp must match `/^\d{6}$/`, else 400 `INVALID_OTP`), then `checkCode`, then find or create the user (creating only if `isAllowed`, else 403 `NOT_OPEN`), then `createSession` | 200 `{ user: { email } }` and `Set-Cookie: sessionCookie(token)` · 400 `INVALID_OTP` / `OTP_EXPIRED` · 403 `TOO_MANY_ATTEMPTS` · 429 |
| `GET /get-session` | read the cookie, then `readSession` | 200 `{ user: { email } }`, with `Set-Cookie` re-sent when `refreshed` · 200 `null` (with `clearedSessionCookie()` when a cookie was sent but the session is dead) |
| `POST /sign-out` | origin, then `endSession` if there's a cookie | always 200 `{ success: true }` with `clearedSessionCookie()` |

Any other `/api/auth/*` path falls through to the app's 404 JSON.

- [ ] **Step 1: Rewrite `worker/auth.test.ts` against the new tables**

Keep every existing test and its assertions. Only the table and column names change: `user` → `users`, `session.expiresAt` → `sessions.expires_at` (epoch ms), `verification.value` → `sign_in_codes.code_hash`. The `'session_token='` cookie checks still hold, since the new name contains it. Add:
- `a sign-in with no code issued is 400 INVALID_OTP`.
- `a POST with no Origin, or a foreign Origin, is 403 BAD_ORIGIN and sends nothing` (Review Focus 4). Cover send-code, sign-in and sign-out with `Origin: https://evil.example` and with no Origin. Assert that `captured`, `interest` and `code_request` are empty.
- `EXTRA_ORIGINS lets a listed dev origin through`: `{ ...env, EXTRA_ORIGINS: 'https://localhost:5173, https://192.168.1.5:5173' }` accepts both.
- `malformed bodies are 400 and write nothing` (Review Focus 3): send-code with a non-JSON body and with `{ email: 42, type: 'sign-in' }`. Sign-in with no `otp`, with `'1234567'`, and with `'12a456'`.
- `more than 3 sign-in tries from one address in a minute are 429`.
- `a session check a day later refreshes the cookie` (fake `Date`): the response carries `Set-Cookie` with `__Host-session_token`.
- `a dead or garbage cookie: get-session is null and sign-out is 200` (Review Focus 2).
- `a successful sign-in never returns the token in the body`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run --project worker worker/auth.test.ts`
Expected: FAIL. Better Auth is still serving the routes, and the new tables are empty.

- [ ] **Step 3: Write the routes and switch over**

- Rewrite `worker/auth.ts` as `authRoutes` per the table above. Wire it in `worker/app.ts`. Update `worker/env.ts`.
- In `worker/test/harness.ts`, set `APP_ORIGIN: 'http://localhost'` in place of `BETTER_AUTH_URL`.
- In `wrangler.jsonc`, rename the var to `APP_ORIGIN` and remove `compatibility_flags: ["nodejs_compat"]`.
- `migrations/0004_drop_better_auth.sql` drops `session`, `account`, `verification` and `rateLimit` before `"user"`, since D1 enforces foreign keys. Add a comment explaining the order.
- Delete `worker/app-reuse.test.ts`.
- Run `pnpm remove better-auth`.

- [ ] **Step 4: Run everything**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm exec playwright test`
Expected: all clean and passing. `src/account/*` tests are untouched and pass. `grep -rn "better-auth\|betterAuth\|BETTER_AUTH_URL" worker src wrangler.jsonc package.json` prints nothing.

- [ ] **Step 5: Check local dev by hand**

Apply the migrations locally (`pnpm exec wrangler d1 migrations apply glazette --local`), then run `pnpm dev:api` and `pnpm dev` with `.dev.vars` holding `EXTRA_ORIGINS=https://localhost:5173`, `BETTER_AUTH_SECRET`, a dummy `RESEND_API_KEY`, and `APP_ORIGIN=https://localhost:5173`. In the browser, sending a code to an email not on the local allowed list shows "Glazette accounts aren't open yet." Record the result in the task report. Add a `.dev.vars.example` with those four keys and placeholder values (`.dev.vars*` is gitignored, so force-add the example).

- [ ] **Step 6: Commit**

```bash
git add -A worker migrations wrangler.jsonc package.json pnpm-lock.yaml
git add -f .dev.vars.example
git commit -m "feat(worker): serve sign-in ourselves and remove Better Auth"
```

---

### Task 4: Measure CPU and update the docs

**Files:**
- Create: `scripts/measure-worker-cpu.mjs`
- Modify: `docs/superpowers/specs/2026-11-05-sync-design.md` (the Better Auth bullet under Constraints → Backend)

**Interfaces:**
- Consumes: the built Worker bundle and `migrations/`.
- Produces: `node scripts/measure-worker-cpu.mjs <bundle.js> <migrationsDir>`, which prints one `label status ms` line per step.

- [ ] **Step 1: Write the script**

Start from `scripts/measure-worker-cpu.mjs`. Its parts:
- A `node:sqlite` stand-in for D1 that supports `prepare/bind/all/run/first/raw` and `batch`. Make `run` return rows for `RETURNING` statements.
- `process.cpuUsage()` around the module import and around each request.
- Allowed email `a@b.co`.
- Capture the code by stubbing `globalThis.fetch` to read the Resend request body.

Time, in one fresh process: load, get-session (no cookie), send-code, sign-in with the right code, get-session with the cookie, get-session a day later (refresh, by moving `Date.now`), and sign-out.

- [ ] **Step 2: Run it**

Run: `pnpm exec wrangler deploy --dry-run --outdir .wrangler/cpu-bundle && node scripts/measure-worker-cpu.mjs .wrangler/cpu-bundle/index.js migrations`
Expected: every request answers its expected status. Load plus the slowest first request is about 3 ms or less. Note the bundle size `wrangler` prints. If the target is missed, stop and report the numbers instead of tuning blindly.

- [ ] **Step 3: Update the sync design**

Replace "Better Auth with its email OTP plugin, with users and sessions in D1." with a line saying sign-in is our own email-code sign-in, per `2026-11-07-own-sign-in-design.md`, with users and sessions in D1. Leave its sub-bullets as they are.

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-worker-cpu.mjs docs/superpowers/specs/2026-11-05-sync-design.md
git commit -m "chore: script to measure Worker CPU locally; sync design points at our own sign-in"
```

---

## After the last task

Per `AGENTS.md`: run `/security-review`, then `/code-review high` on the branch. Fix the real findings, re-run the full check from Task 3 Step 4, and commit. Put the CPU numbers and bundle size from Task 4 in the PR's Verification section.

## After merge (Carol)

1. Sign in again on the iPhone Home Screen app and the laptop. Close and reopen each and confirm you're still signed in.
2. Open the app a few times over a day. Then read CPU time on the Workers metrics page. S2 starts only if the median is under 10 ms.
