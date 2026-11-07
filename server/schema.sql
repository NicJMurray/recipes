CREATE TABLE IF NOT EXISTS recipes (
  slug TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  data TEXT NOT NULL,
  photo TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_versions (
  slug TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  photo TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (slug, revision)
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_limits (
  scope TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_photos (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL CHECK (length(data) <= 1000000),
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL
);
