CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE oauth_refresh_rotations (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, claim TEXT NOT NULL, rotated_at TEXT NOT NULL);


CREATE INDEX oauth_refresh_rotations_rotated_idx ON oauth_refresh_rotations(rotated_at);


DELETE FROM oauth_access_tokens WHERE EXISTS (SELECT 1 FROM oauth_access_tokens AS newer WHERE newer.client_id = oauth_access_tokens.client_id AND newer.user_id IS oauth_access_tokens.user_id AND (newer.created_at > oauth_access_tokens.created_at OR (newer.created_at = oauth_access_tokens.created_at AND newer.id > oauth_access_tokens.id)));
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0007','ea4d268a82cc8210c3e21bdb23081eadc3c0a9e0f98146c8fa2195f0df2be602',CURRENT_TIMESTAMP);
