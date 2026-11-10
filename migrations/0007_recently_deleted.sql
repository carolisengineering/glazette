-- When the server first heard of a delete, and when it purged the record.
ALTER TABLE records ADD COLUMN deleted_heard_at TEXT;
ALTER TABLE records ADD COLUMN purged_at TEXT;
CREATE INDEX records_heard ON records (user_id, deleted_heard_at) WHERE deleted_heard_at IS NOT NULL;
UPDATE records SET deleted_heard_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind IN ('piece', 'entry', 'glazeApp', 'photo') AND json_extract(data, '$.deletedAt') IS NOT NULL;
