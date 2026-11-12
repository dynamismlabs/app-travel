CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE app_credentials (owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,key));
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0002','224be9603b6911eafbe6387442d9a4dddb8fbd274d50b8d3faf0a59e01932659',CURRENT_TIMESTAMP);
