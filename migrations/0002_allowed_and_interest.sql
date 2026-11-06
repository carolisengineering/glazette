-- Emails that may get a sign-in code. Stored trimmed and lowercased.
CREATE TABLE allowed_email (email TEXT PRIMARY KEY);

-- One row per turned-away code request, so Carol can see who wants in.
CREATE TABLE interest (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, attempted_at TEXT NOT NULL);

-- One row per code sent, for the per-email hourly cap.
CREATE TABLE code_request (email TEXT NOT NULL, requested_at TEXT NOT NULL);
CREATE INDEX code_request_email ON code_request (email, requested_at);
