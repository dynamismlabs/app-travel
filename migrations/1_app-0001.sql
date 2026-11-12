CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE books (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, author TEXT NOT NULL, status TEXT NOT NULL,
      note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      

      CREATE INDEX books_owner_date_idx ON books(user_id, created_at DESC);
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('app-0001','a2a5d3d780d51a621b3d34f05bb81153b437e8860af03e344ebf738dcfe345a4',CURRENT_TIMESTAMP);
