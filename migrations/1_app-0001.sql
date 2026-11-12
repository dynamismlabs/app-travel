CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE travel_meta (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, value INTEGER NOT NULL
)


INSERT INTO travel_meta (id, created_at, updated_at, value) VALUES ('data_revision', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1)


CREATE TABLE trips (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  title TEXT NOT NULL, title_source TEXT NOT NULL CHECK (title_source IN ('derived','manual')),
  destinations TEXT NOT NULL,
  start_date TEXT, end_date TEXT, dates_source TEXT NOT NULL CHECK (dates_source IN ('derived','manual','unset')),
  home_zone TEXT, travelers TEXT NOT NULL, notes TEXT, archived_at TEXT,
  source_key TEXT NOT NULL, fictional INTEGER NOT NULL
)


CREATE INDEX trips_dates ON trips (start_date, end_date)


CREATE TABLE bookings (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flight','train','lodging','car','activity')),
  title TEXT NOT NULL, provider TEXT, provider_code TEXT, provider_key TEXT, reference TEXT, reference_key TEXT, detail TEXT,
  travelers TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','confirmed','canceled')),
  notes TEXT, method TEXT NOT NULL CHECK (method IN ('deterministic','ai','invite','manual')),
  source_key TEXT NOT NULL, source_keys TEXT NOT NULL,
  first_date TEXT, last_date TEXT, fictional INTEGER NOT NULL
)


CREATE INDEX bookings_trip ON bookings (trip_id, first_date)


CREATE INDEX bookings_reference ON bookings (reference_key)


CREATE INDEX bookings_dates ON bookings (first_date, last_date)


CREATE TABLE segments (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, sequence INTEGER NOT NULL,
  number TEXT, origin_label TEXT, origin_code TEXT, destination_label TEXT, destination_code TEXT,
  start_local TEXT NOT NULL, start_zone TEXT, start_offset INTEGER,
  end_local TEXT, end_zone TEXT, end_offset INTEGER,
  address TEXT, end_address TEXT,
  UNIQUE (booking_id, sequence)
)


CREATE TABLE stays (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  property_name TEXT NOT NULL, address TEXT,
  check_in_date TEXT NOT NULL, check_out_date TEXT NOT NULL, check_in_time TEXT, check_out_time TEXT, zone TEXT
)


CREATE TABLE booking_overrides (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  field TEXT NOT NULL, value TEXT NOT NULL, original TEXT NOT NULL, actor TEXT NOT NULL, stale INTEGER NOT NULL,
  UNIQUE (booking_id, field)
)


CREATE TABLE evidence (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  source_key TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('gmail','file','paste','manual','fixture')),
  account TEXT, external_id TEXT, thread_id TEXT, message_id_header TEXT, invite_uid TEXT, invite_sequence INTEGER,
  title TEXT NOT NULL, sender TEXT, sender_domain TEXT, received_at TEXT, observed_at TEXT NOT NULL,
  digest TEXT NOT NULL, text_blob TEXT, file_blob TEXT, file_name TEXT, mime_type TEXT, excerpt TEXT,
  parse_version INTEGER NOT NULL, parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed','partial','unreadable','pending_attachment','pending_ai','ai_failed','ignored')),
  parse_method TEXT, parse_note TEXT, attachments TEXT NOT NULL,
  forwarded INTEGER NOT NULL, availability TEXT NOT NULL CHECK (availability IN ('available','unavailable')), unavailable_at TEXT,
  fictional INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE (source_key, external_id)
)


CREATE INDEX evidence_status ON evidence (parse_status, source_key)


CREATE INDEX evidence_invite ON evidence (invite_uid)


CREATE INDEX evidence_digest ON evidence (source_key, digest)


CREATE TABLE booking_sources (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('created','duplicate','changed','canceled','linked')),
  contributes INTEGER NOT NULL, snapshot TEXT NOT NULL,
  UNIQUE (booking_id, evidence_id)
)


CREATE INDEX booking_sources_evidence ON booking_sources (evidence_id)


CREATE TABLE booking_changes (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, fields TEXT NOT NULL, actor TEXT NOT NULL, source_key TEXT NOT NULL, note TEXT
)


CREATE INDEX booking_changes_booking ON booking_changes (booking_id, created_at)


CREATE TABLE review_items (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assign','change','cancellation','identity','extraction','unreadable')),
  booking_id TEXT REFERENCES bookings(id) ON DELETE CASCADE, trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  evidence_ids TEXT NOT NULL, reason TEXT NOT NULL, previous TEXT, proposed TEXT, candidates TEXT NOT NULL,
  decision TEXT, decided_at TEXT, decided_by TEXT,
  source_key TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, fictional INTEGER NOT NULL
)


CREATE INDEX review_items_open ON review_items (decision, created_at)


CREATE TABLE gap_dismissals (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  gap_key TEXT NOT NULL, fingerprint TEXT NOT NULL, actor TEXT NOT NULL, note TEXT,
  UNIQUE (trip_id, gap_key)
)


CREATE TABLE ideas (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('stay','activity','food','transport','place')),
  title TEXT NOT NULL, note TEXT, url TEXT, price_minor INTEGER, currency TEXT, observed_at TEXT,
  location TEXT, conditions TEXT, source_label TEXT, source_key TEXT NOT NULL, removed_at TEXT, fictional INTEGER NOT NULL
)


CREATE INDEX ideas_trip ON ideas (trip_id, created_at)


CREATE TABLE follow_ups (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('trip','booking','idea','review')), subject_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, due_at TEXT,
  task_id TEXT, state TEXT NOT NULL CHECK (state IN ('pending','created','needs_permission','failed')),
  availability TEXT NOT NULL CHECK (availability IN ('unknown','available','missing')), checked_at TEXT, last_error TEXT,
  source_key TEXT NOT NULL, actor TEXT NOT NULL
)


CREATE INDEX follow_ups_subject ON follow_ups (subject_type, subject_id)


CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  account TEXT NOT NULL, calendar_id TEXT NOT NULL, occurrence_key TEXT NOT NULL,
  summary TEXT, location TEXT, start_value TEXT, end_value TEXT, all_day INTEGER NOT NULL, start_zone TEXT,
  status TEXT, cancelled INTEGER NOT NULL, transparent INTEGER NOT NULL, response TEXT,
  source_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE (account, calendar_id, occurrence_key)
)


CREATE INDEX calendar_events_start ON calendar_events (start_value)


CREATE TABLE import_previews (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  actor TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('file','paste')),
  file_name TEXT, mime_type TEXT, source_digest TEXT NOT NULL, digest TEXT NOT NULL,
  file_blob TEXT, text_blob TEXT, parse TEXT NOT NULL, applied_at TEXT, result TEXT, revision INTEGER NOT NULL DEFAULT 1
)


CREATE VIRTUAL TABLE bookings_fts USING fts5(booking_id UNINDEXED, body, tokenize='unicode61 remove_diacritics 2')


CREATE TRIGGER trips_insert_revision AFTER INSERT ON trips BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER trips_update_revision AFTER UPDATE ON trips BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER trips_delete_revision AFTER DELETE ON trips BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER bookings_insert_revision AFTER INSERT ON bookings BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER bookings_update_revision AFTER UPDATE ON bookings BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER bookings_delete_revision AFTER DELETE ON bookings BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER segments_insert_revision AFTER INSERT ON segments BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER segments_update_revision AFTER UPDATE ON segments BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER segments_delete_revision AFTER DELETE ON segments BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER stays_insert_revision AFTER INSERT ON stays BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER stays_update_revision AFTER UPDATE ON stays BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER stays_delete_revision AFTER DELETE ON stays BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_overrides_insert_revision AFTER INSERT ON booking_overrides BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_overrides_update_revision AFTER UPDATE ON booking_overrides BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_overrides_delete_revision AFTER DELETE ON booking_overrides BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER evidence_insert_revision AFTER INSERT ON evidence BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER evidence_update_revision AFTER UPDATE ON evidence BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER evidence_delete_revision AFTER DELETE ON evidence BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_sources_insert_revision AFTER INSERT ON booking_sources BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_sources_update_revision AFTER UPDATE ON booking_sources BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_sources_delete_revision AFTER DELETE ON booking_sources BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_changes_insert_revision AFTER INSERT ON booking_changes BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_changes_update_revision AFTER UPDATE ON booking_changes BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER booking_changes_delete_revision AFTER DELETE ON booking_changes BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER review_items_insert_revision AFTER INSERT ON review_items BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER review_items_update_revision AFTER UPDATE ON review_items BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER review_items_delete_revision AFTER DELETE ON review_items BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER gap_dismissals_insert_revision AFTER INSERT ON gap_dismissals BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER gap_dismissals_update_revision AFTER UPDATE ON gap_dismissals BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER gap_dismissals_delete_revision AFTER DELETE ON gap_dismissals BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER ideas_insert_revision AFTER INSERT ON ideas BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER ideas_update_revision AFTER UPDATE ON ideas BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER ideas_delete_revision AFTER DELETE ON ideas BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER follow_ups_insert_revision AFTER INSERT ON follow_ups BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER follow_ups_update_revision AFTER UPDATE ON follow_ups BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER follow_ups_delete_revision AFTER DELETE ON follow_ups BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER calendar_events_insert_revision AFTER INSERT ON calendar_events BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER calendar_events_update_revision AFTER UPDATE ON calendar_events BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TRIGGER calendar_events_delete_revision AFTER DELETE ON calendar_events BEGIN UPDATE travel_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END


CREATE TABLE app_settings (key TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, value TEXT NOT NULL)


CREATE TABLE app_jobs (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  kind TEXT NOT NULL, source_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','running','paused','failed')),
  attempts INTEGER NOT NULL, next_eligible_at TEXT NOT NULL,
  last_run_at TEXT, last_success_at TEXT, last_error TEXT, idempotent INTEGER NOT NULL,
  UNIQUE (kind, source_key)
)


CREATE INDEX app_jobs_due ON app_jobs (state, next_eligible_at)


CREATE TABLE app_source_accounts (
  account TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('mail','calendar')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, label TEXT, history_days INTEGER NOT NULL,
  checkpoint TEXT, calendars TEXT NOT NULL, paused INTEGER NOT NULL, status TEXT NOT NULL,
  last_error TEXT, last_success_at TEXT, PRIMARY KEY (account, kind)
)


CREATE TABLE app_mail_messages (
  account TEXT NOT NULL, message_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  thread_id TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('kept','skipped','removed')),
  received_at TEXT, digest TEXT, PRIMARY KEY (account, message_id)
)


CREATE INDEX app_mail_messages_thread ON app_mail_messages (account, thread_id)


CREATE TABLE travel_blobs (digest TEXT PRIMARY KEY, created_at TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL)
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('app-0001','fdeef72282162ff3bd779648d4742ba9331185f19615da84f5b8a8e0e0c13207',CURRENT_TIMESTAMP);
