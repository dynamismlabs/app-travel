CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
ALTER TABLE installation ADD COLUMN owner_id TEXT;


UPDATE installation SET owner_id = COALESCE((SELECT user_id FROM owner_claim WHERE id=1), CASE WHEN EXISTS (SELECT 1 FROM users WHERE id='local-owner') THEN NULL ELSE (SELECT id FROM users ORDER BY created_at, id LIMIT 1) END) WHERE id=1;
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0008','b4993191db545494ec54a3d6e759e3e14f96b8bf20b2041f6040f67e1c4351d8',CURRENT_TIMESTAMP);
