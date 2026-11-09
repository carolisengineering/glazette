-- Which photo files each user has stored in R2. A row is written only after R2 accepted the bytes.
CREATE TABLE photo_files (user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, hash TEXT NOT NULL, part TEXT NOT NULL CHECK (part IN ('full', 'thumb')), size INTEGER NOT NULL, PRIMARY KEY (user_id, hash, part));
