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

-- Higher-quality uploads and immutable replacement versions use additive tables.
-- The original gallery rows and all recipe data remain intact.
CREATE TABLE IF NOT EXISTS gallery_media (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  high_fingerprint TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  has_high INTEGER NOT NULL CHECK (has_high IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gallery_media_parent ON gallery_media(photo_id);
CREATE TABLE IF NOT EXISTS gallery_replacements (
  photo_id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL CHECK (revision > 0)
);
