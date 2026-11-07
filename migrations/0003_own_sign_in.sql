-- People who have signed in. Times in these tables are epoch milliseconds.
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);

-- One row per signed-in device. Only a hash of the session token is stored.
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, created_at INTEGER NOT NULL, refreshed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_user_id ON sessions (user_id);

-- At most one live sign-in code per email. Only a keyed hash of the code is stored.
CREATE TABLE sign_in_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);

-- Fixed-window request counters, one row per limit key.
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
