# Investment simulator storage contract

The investment simulator is local-only. Its SQLite database lives at
`data/invest-simulator/simulator.sqlite3`, and the tracked schema is
`config/invest-simulator.schema.sql`. Runtime databases and SQLite sidecar files
must not be committed or included in a release archive.

Initialize the local schema explicitly with
`python scripts/invest_simulator_store.py init`, or let the feature create it on
first use. For read-only integrity/schema checks and backed-up GitHub update
migrations, use `scripts/sqlite_store_doctor.py` and the workflow in
`docs/sqlite-stores.md`. Never copy an empty simulator DB into an existing app.

## Instrument identity

Orders, trades, instrument ledger events, and reconstructed positions preserve a
provider-qualified identity. The canonical Binance Spot example is:

```json
{
  "instrumentId": "binance:spot:BTCUSDT",
  "provider": "binance",
  "venue": "BINANCE_SPOT",
  "assetClass": "crypto",
  "symbol": "BTCUSDT",
  "displaySymbol": "BTC/USDT",
  "baseAsset": "BTC",
  "quoteAsset": "USDT",
  "nativeQuoteAsset": "USDT",
  "settlementAsset": "USD",
  "currency": "USD",
  "status": "TRADING",
  "sessionPolicy": "24x7",
  "market": "BINANCE_SPOT",
  "source": "binance-market-data"
}
```

Provider metadata takes precedence over legacy symbol heuristics. In particular,
`BTCUSDT` with provider `binance` is a 24x7 crypto instrument and must not be
classified as a US equity merely because the symbol starts with a letter.

Binance Spot `USDT` quote values settle against the simulator's existing `USD`
cash balance at `USDT = USD`. The simulator does not create a separate USDT
balance or an FX event. Fills use the current price supplied by the market-data
layer. The 24x7 session policy does not override provider status: an explicit
Binance status other than `TRADING` is rejected by the store. Since the public
no-key API cannot provide the account-specific commission rate, Binance
simulator fills store `feeAmount = 0`,
`feeCurrency = USD`, and `feeAssumption = zero-no-public-account-rate`.

The simulator HTTP order boundary does not trust Binance price, symbol, status,
or fee metadata submitted by the browser. It resolves `instrumentId` again from
the current `exchangeInfo` catalog and obtains a fresh standard price from the
market-data connector before writing the order. The order is rejected when the
catalog is stale, the instrument is no longer `TRADING`, the provider is in a
timeout/rate-limit cooldown, or the execution quote is older than 60 seconds.
There is no bid/ask spread, depth, slippage, or FX model: both buys and sells fill
at that standard price and `USDT = USD` remains the explicit practice assumption.

Every HTTP buy or sell request must include an `idempotencyKey`. The UI creates
one key per order intent and reuses it when the same request is retried; it creates
a new key only after the intent changes or the prior order succeeds. This makes a
network retry return the existing ledger event instead of creating a second fill.

## Schema migration and replay

Schema version 2 adds provider-qualified columns to `simulator_orders`,
`simulator_trades`, and `simulator_ledger_events`. The store migrates a version 1
database with additive `ALTER TABLE ADD COLUMN` operations. Existing rows and
payload JSON are not rewritten. When an added version 2 column is blank, replay
may recover the corresponding provider metadata from the old row's raw payload;
it must not invent a `TRADING` status that the saved payload did not contain.

Ledger history remains append-only. The `(simulator_id, idempotency_key)` unique
index continues to prevent duplicate events, and positions are rebuilt from
trade rows using `instrumentId` as the primary identity. Legacy rows without an
instrument id fall back to their existing market, symbol, and settlement
currency identity.

## Watchlist settings compatibility

Each `watchlistGroups[]` item continues to store `symbols[]` for version 1
clients and may additionally store canonical `instruments[]` objects. Reading a
symbols-only user file yields the same symbols and an empty instruments array.
When instruments are present, their symbols are also included in `symbols[]` so
older clients can still render the group.

When an older client submits a symbols-only group patch, the settings store
retains metadata for instruments whose symbols remain in that group. Removing a
symbol also removes its retained instrument metadata. A version 2 client may
send an explicit `instruments: []` when it intends to clear the metadata.

Manual ordering and UI selection use provider-qualified instrument ids when they
are available. Two providers may therefore expose the same bare symbol without
sharing prices, selection state, saved order, or React row identity. Legacy bare
symbols remain readable and are expanded against the matching saved instruments
for backward compatibility.
