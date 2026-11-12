CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE connection_access (client_id TEXT NOT NULL REFERENCES oauth_applications(client_id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, sources TEXT, can_write INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(client_id,user_id));
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0003','ceafb4d7e889a43b1395a2bb170346b7a4f3e30f97d5d65a5708a0c8af8d574b',CURRENT_TIMESTAMP);
