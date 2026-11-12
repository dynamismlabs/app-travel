CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);

CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);


CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);


CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);


CREATE TABLE verifications (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);


CREATE TABLE oauth_applications (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, metadata TEXT, client_id TEXT NOT NULL UNIQUE, client_secret TEXT, redirect_urls TEXT NOT NULL, type TEXT NOT NULL, disabled INTEGER DEFAULT 0, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);


CREATE TABLE oauth_access_tokens (id TEXT PRIMARY KEY, access_token TEXT NOT NULL UNIQUE, refresh_token TEXT NOT NULL UNIQUE, access_token_expires_at INTEGER NOT NULL, refresh_token_expires_at INTEGER NOT NULL, client_id TEXT NOT NULL REFERENCES oauth_applications(client_id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);


CREATE TABLE oauth_consents (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES oauth_applications(client_id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, scopes TEXT NOT NULL, consent_given INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);


CREATE TABLE spaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, created_at TEXT NOT NULL);


CREATE TABLE members (space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','contributor','viewer')), PRIMARY KEY(space_id,user_id));


CREATE TABLE invites (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('contributor','viewer')), expires_at TEXT NOT NULL, accepted_by TEXT REFERENCES users(id), revoked_at TEXT);


CREATE TABLE files (id TEXT PRIMARY KEY, storage_key TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), parent_id TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);


CREATE INDEX sessions_user_id_idx ON sessions(user_id);


CREATE INDEX members_user_idx ON members(user_id);


CREATE INDEX files_parent_idx ON files(parent_id);


CREATE TABLE owner_claim (id INTEGER PRIMARY KEY CHECK(id=1), user_id TEXT NOT NULL REFERENCES users(id));


CREATE TABLE installation (id INTEGER PRIMARY KEY CHECK(id=1), instance_id TEXT NOT NULL UNIQUE);


INSERT INTO installation (id,instance_id) VALUES (1,lower(hex(randomblob(16))));

INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0001','cbc980ec6b8a2aef3269a02a416992c07cde4a6229cabf72258ea59295613f22',CURRENT_TIMESTAMP);
