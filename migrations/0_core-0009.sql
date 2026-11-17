CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
ALTER TABLE oauth_refresh_rotations ADD COLUMN issued TEXT;


ALTER TABLE oauth_refresh_rotations ADD COLUMN issued_at TEXT;


ALTER TABLE oauth_refresh_rotations ADD COLUMN revoked_at TEXT;


UPDATE oauth_refresh_rotations SET issued_at = rotated_at;


CREATE INDEX oauth_refresh_rotations_family_idx ON oauth_refresh_rotations(client_id, user_id);
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0009','3665629d730038362fa31946a02be0ce72bce9d0cb9c45bf93f443ebad3902dc',CURRENT_TIMESTAMP);
