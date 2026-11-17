CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE connection_add_only (client_id TEXT NOT NULL REFERENCES oauth_applications(client_id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, sources TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(client_id,user_id));
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0010','c688b0643e434466f3fc72060642670c913717191ef8b91cdf0b03b84d49f58f',CURRENT_TIMESTAMP);
