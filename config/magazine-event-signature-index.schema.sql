-- FinanceAgentGUI Magazine event-signature index blueprint.
--
-- The runtime database lives at data/magazine/event-signature-index.sqlite3.
-- It is a rebuildable local index and must never be committed or distributed,
-- including as an empty seed database.

CREATE TABLE IF NOT EXISTS magazine_event_signature_embeddings (
  article_id TEXT PRIMARY KEY,
  embedding_engine TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  signature_hash TEXT NOT NULL,
  embedding_dims INTEGER NOT NULL,
  embedding_blob BLOB NOT NULL,
  signature_text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_magazine_event_signature_hash
  ON magazine_event_signature_embeddings(signature_hash);

PRAGMA user_version = 1;
