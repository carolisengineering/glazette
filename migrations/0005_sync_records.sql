-- The latest copy of every synced record, per user. seq orders changes for pulls.
CREATE TABLE records (user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, kind TEXT NOT NULL, id TEXT NOT NULL, changed_at TEXT NOT NULL, data TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (user_id, kind, id));
CREATE UNIQUE INDEX records_seq ON records (seq);
CREATE INDEX records_user_seq ON records (user_id, seq);
