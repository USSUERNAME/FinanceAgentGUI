PRAGMA user_version = 2;

CREATE TABLE IF NOT EXISTS orders (
  account_seq TEXT NOT NULL,
  order_id TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL DEFAULT '',
  order_type TEXT NOT NULL DEFAULT '',
  time_in_force TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  price TEXT,
  quantity TEXT,
  order_amount TEXT,
  ordered_at TEXT,
  canceled_at TEXT,
  filled_quantity TEXT,
  average_filled_price TEXT,
  filled_amount TEXT,
  commission TEXT,
  tax TEXT,
  filled_at TEXT,
  settlement_date TEXT,
  raw_json TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (account_seq, order_id)
);

CREATE INDEX IF NOT EXISTS idx_toss_orders_ordered_at
  ON orders (ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_toss_orders_symbol_ordered_at
  ON orders (symbol, ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_toss_orders_status_ordered_at
  ON orders (status, ordered_at DESC);

CREATE TABLE IF NOT EXISTS sync_state (
  account_seq TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_sync_started_at TEXT,
  last_sync_finished_at TEXT,
  last_successful_sync_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  last_cursor TEXT,
  has_next INTEGER NOT NULL DEFAULT 0,
  last_from_date TEXT,
  last_to_date TEXT,
  last_ordered_at TEXT,
  last_filled_at TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  last_fetch_count INTEGER NOT NULL DEFAULT 0,
  last_inserted_count INTEGER NOT NULL DEFAULT 0,
  last_updated_count INTEGER NOT NULL DEFAULT 0,
  last_seen_count INTEGER NOT NULL DEFAULT 0,
  last_pages_fetched INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rebuild_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  requested_start_date TEXT,
  requested_end_date TEXT,
  latest_trade_at TEXT,
  current_holdings_collected_at TEXT,
  total_snapshots INTEGER NOT NULL DEFAULT 0,
  completed_snapshots INTEGER NOT NULL DEFAULT 0,
  total_snapshot_rows INTEGER NOT NULL DEFAULT 0,
  daily_target_count INTEGER NOT NULL DEFAULT 0,
  monthly_target_count INTEGER NOT NULL DEFAULT 0,
  included_trades INTEGER NOT NULL DEFAULT 0,
  position_count INTEGER NOT NULL DEFAULT 0,
  symbol_count INTEGER NOT NULL DEFAULT 0,
  priced_symbol_count INTEGER NOT NULL DEFAULT 0,
  missing_symbol_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  market_value_usd TEXT,
  market_value_krw TEXT,
  error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_toss_rebuild_runs_updated_at
  ON rebuild_runs (updated_at DESC);

CREATE TABLE IF NOT EXISTS market_candles (
  symbol TEXT NOT NULL,
  price_date TEXT NOT NULL,
  timestamp TEXT,
  currency TEXT,
  open_price TEXT,
  high_price TEXT,
  low_price TEXT,
  close_price TEXT NOT NULL,
  volume TEXT,
  source TEXT NOT NULL DEFAULT 'tossinvest-candles',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (symbol, price_date)
);

CREATE TABLE IF NOT EXISTS market_candle_cache_state (
  symbol TEXT PRIMARY KEY,
  requested_start_date TEXT,
  requested_end_date TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates (
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate_date TEXT NOT NULL,
  rate TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'tossinvest-exchange-rate',
  valid_from TEXT,
  valid_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (base_currency, quote_currency, rate_date)
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  frequency TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  account_seq TEXT NOT NULL,
  currency TEXT NOT NULL,
  symbol TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  quantity TEXT NOT NULL,
  known_quantity TEXT NOT NULL,
  unknown_quantity TEXT NOT NULL,
  opening_quantity_required TEXT NOT NULL,
  known_cost_basis TEXT NOT NULL,
  usd_krw_rate TEXT,
  known_cost_basis_usd TEXT,
  known_cost_basis_krw TEXT,
  market_price TEXT,
  market_price_date TEXT,
  market_price_currency TEXT,
  market_value TEXT,
  market_value_usd TEXT,
  market_value_krw TEXT,
  market_source TEXT,
  average_known_cost TEXT,
  buy_count INTEGER NOT NULL DEFAULT 0,
  sell_count INTEGER NOT NULL DEFAULT 0,
  rebuild_run_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (frequency, snapshot_date, account_seq, currency, symbol)
);

CREATE INDEX IF NOT EXISTS idx_toss_position_snapshots_frequency_date
  ON position_snapshots (frequency, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_toss_position_snapshots_symbol_date
  ON position_snapshots (symbol, snapshot_date);
