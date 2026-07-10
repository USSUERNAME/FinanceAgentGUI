CREATE TABLE IF NOT EXISTS simulator_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'KRW',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_simulator_accounts_status_created
  ON simulator_accounts (status, created_at);

CREATE TABLE IF NOT EXISTS simulator_ledger_events (
  id TEXT PRIMARY KEY,
  simulator_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  asset_class TEXT NOT NULL DEFAULT '',
  symbol TEXT NOT NULL DEFAULT '',
  base_asset TEXT NOT NULL DEFAULT '',
  quote_asset TEXT NOT NULL DEFAULT '',
  settlement_asset TEXT NOT NULL DEFAULT '',
  instrument_status TEXT NOT NULL DEFAULT '',
  session_policy TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT,
  source TEXT NOT NULL DEFAULT 'gui',
  reversal_of_event_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (simulator_id) REFERENCES simulator_accounts (id)
);

CREATE INDEX IF NOT EXISTS idx_simulator_ledger_events_account_time
  ON simulator_ledger_events (simulator_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS idx_simulator_ledger_events_account_instrument_time
  ON simulator_ledger_events (simulator_id, instrument_id, occurred_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_simulator_ledger_events_idempotency
  ON simulator_ledger_events (simulator_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

CREATE TABLE IF NOT EXISTS simulator_orders (
  id TEXT PRIMARY KEY,
  simulator_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  asset_class TEXT NOT NULL DEFAULT '',
  base_asset TEXT NOT NULL DEFAULT '',
  quote_asset TEXT NOT NULL DEFAULT '',
  settlement_asset TEXT NOT NULL DEFAULT '',
  instrument_status TEXT NOT NULL DEFAULT '',
  session_policy TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT '',
  order_type TEXT NOT NULL DEFAULT 'market',
  quantity TEXT,
  limit_price TEXT,
  currency TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (simulator_id) REFERENCES simulator_accounts (id)
);

CREATE INDEX IF NOT EXISTS idx_simulator_orders_account_created
  ON simulator_orders (simulator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulator_orders_account_instrument_created
  ON simulator_orders (simulator_id, instrument_id, created_at DESC);

CREATE TABLE IF NOT EXISTS simulator_trades (
  id TEXT PRIMARY KEY,
  simulator_id TEXT NOT NULL,
  order_id TEXT,
  instrument_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  asset_class TEXT NOT NULL DEFAULT '',
  base_asset TEXT NOT NULL DEFAULT '',
  quote_asset TEXT NOT NULL DEFAULT '',
  settlement_asset TEXT NOT NULL DEFAULT '',
  instrument_status TEXT NOT NULL DEFAULT '',
  session_policy TEXT NOT NULL DEFAULT '',
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity TEXT NOT NULL,
  price TEXT NOT NULL,
  currency TEXT NOT NULL,
  fee_amount TEXT NOT NULL DEFAULT '0',
  fee_currency TEXT NOT NULL DEFAULT '',
  executed_at TEXT NOT NULL,
  ledger_event_id TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (simulator_id) REFERENCES simulator_accounts (id),
  FOREIGN KEY (order_id) REFERENCES simulator_orders (id),
  FOREIGN KEY (ledger_event_id) REFERENCES simulator_ledger_events (id)
);

CREATE INDEX IF NOT EXISTS idx_simulator_trades_account_executed
  ON simulator_trades (simulator_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulator_trades_account_instrument_executed
  ON simulator_trades (simulator_id, instrument_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS simulator_snapshots (
  id TEXT PRIMARY KEY,
  simulator_id TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  cash_krw TEXT NOT NULL,
  cash_usd TEXT NOT NULL,
  positions_json TEXT NOT NULL DEFAULT '[]',
  valuation_json TEXT NOT NULL DEFAULT '{}',
  source_event_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (simulator_id) REFERENCES simulator_accounts (id),
  FOREIGN KEY (source_event_id) REFERENCES simulator_ledger_events (id)
);

CREATE INDEX IF NOT EXISTS idx_simulator_snapshots_account_time
  ON simulator_snapshots (simulator_id, snapshot_at DESC);

PRAGMA user_version = 2;
