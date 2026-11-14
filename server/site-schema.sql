-- Additive migration. Never changes recipe tables, sessions or existing photos.
CREATE TABLE IF NOT EXISTS gallery_photos (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  title TEXT NOT NULL,
  alt TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  captured_at TEXT,
  commit_sha TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS gallery_fingerprint ON gallery_photos(fingerprint) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS gallery_hidden (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS site_content (
  site TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
