-- Better Auth's tables, replaced by users, sessions and sign_in_codes in 0003.
-- D1 enforces foreign keys, and session and account reference "user", so they
-- go first and "user" goes last. Existing sessions end: everyone signs in again.
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS verification;
DROP TABLE IF EXISTS rateLimit;
DROP TABLE IF EXISTS "user";
