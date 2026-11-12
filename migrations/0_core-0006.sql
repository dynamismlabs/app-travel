CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE installation_credentials (key TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL);


CREATE TABLE connector_status (source TEXT PRIMARY KEY, state TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL);
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0006','3ce172a9b68503b7c58f5a55d7c705598d21868e71624e2684f9f109e23fa01c',CURRENT_TIMESTAMP);
