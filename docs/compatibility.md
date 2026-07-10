# Compatibility And Agent Repair Notes

FinanceAgentGUI is a local app plus repairable source code. It should work out of the box for common environments, but OS, browser, auth, and local finance-tooling differences are expected. When compatibility fails, make the failure diagnosable and easy for a local coding agent to patch.

## Compatibility Philosophy

- Prefer clear diagnostics over broad generic advice.
- Keep every runtime requirement inside the app tree or configurable through settings/environment variables.
- Provide override knobs for platform-sensitive paths.
- Do not expose secrets while debugging.
- If a platform-specific fix is made, update this document in the same pass.

## Current Platform Expectations

| Area | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Vite/React web app | Intended, tested locally | Intended | Intended |
| Node local server | Intended, tested locally on Node 22 | Intended with Node 22+ recommended | Intended with Node 22+ recommended |
| Python helper scripts | Intended with venv | Intended with venv | Intended with venv or PowerShell activation |
| Arca.live browser handoff start | Tested with Google Chrome; Chrome is the default | Intended through `which`-detected browser commands | Intended through common Chrome/Edge/Brave install paths |
| Arca.live handoff recovery after server restart | Implemented through `ps` scan | Implemented through `ps` scan | Not fully implemented yet |

Windows support for starting a fresh browser handoff is present, but recovering an already-open handoff browser after GUI server restart is still a known improvement area.

## Windows Runtime Policy

Windows should be documented and supported in this order:

| Level | Environment | Support stance | Notes |
| --- | --- | --- | --- |
| 1 | Native PowerShell | Recommended default | Best match for Windows browser paths, local profiles, ports, Python venv activation, and future launcher scripts. |
| 2 | CMD | Secondary | Basic npm commands should work, but docs and repair guidance should prefer PowerShell. |
| 3 | WSL | Advanced only | Good for development or agent repair, not the default runtime for browser handoff. |

The default Windows user should run FinanceAgentGUI from native PowerShell, not WSL. This keeps Node, npm, Python, browser executables, browser profiles, and local server ports in the same operating-system context.

WSL is a separate Linux environment. Running the GUI server in WSL while expecting it to control a Windows Chrome installation can create path, quoting, profile-lock, localhost, DevTools, and credential-store confusion. If a user insists on WSL, make the environment choice explicit:

- WSL-native path: install Node/Python/npm packages inside WSL and use a Linux Chromium-family browser reachable from WSL.
- Windows-native path: install Node/Python/npm packages in PowerShell and use Windows Chrome/Edge/Brave.
- Do not mix WSL-installed dependencies with a PowerShell-run server, or PowerShell-installed dependencies with a WSL-run server.

If Windows users ask which one to choose, recommend PowerShell.

## Arca.live Browser Login Handoff

The Arca.live notification login flow uses a dedicated browser profile:

- profile directory: `data/arca-browser-profile`
- session file: `data/secrets/arca-session.json`
- login URL: `https://arca.live/u/login?goto=%2Fb%2Fstock`
- browser DevTools endpoint: local `127.0.0.1:<random-port>`

The user logs in manually in the opened browser. The app then captures only Arca.live cookies through the browser DevTools Protocol and stores them locally in `data/secrets/arca-session.json`.

Do not print the session file or raw cookie header. Status UI should show only safe metadata such as connected state, cookie names, domains, and timestamps.

## Toss Securities Open API Read-Only Connector

The Toss Securities connector is a local read-only integration for account,
holdings, order-history, and conditional-order-history retrieval.
It must not expose a generic Toss API proxy.

- encrypted credential vault: `data/secrets/tossinvest-credentials.vault.json`
- legacy plaintext detection only: `data/secrets/tossinvest-credentials.json`
- order-history sync ledger: `data/tossinvest/tossinvest-ledger.sqlite3`
- ledger schema contract: `config/tossinvest-ledger.schema.sql`
- order-history sync user setting: `config/tossinvest-sync.user.json`
- environment variables: `TOSSINVEST_CLIENT_ID`, `TOSSINVEST_CLIENT_SECRET`
- base URL: `https://openapi.tossinvest.com`

The Settings UI stores saved credentials in an AES-256-GCM vault whose key is
derived from the user's vault password with `scrypt`. The vault password is not
stored. Decrypted credentials stay in the running server process only. Toss
access tokens are not written to disk; the in-process token cache stores the
token encrypted with AES-256-GCM using a process-local random key and decrypts it
only when constructing the outbound `Authorization` header. Raw credentials and
tokens are never returned to the frontend. Restarting the server or using the
Settings lock action requires the user to unlock the vault again.

The connector no longer reads the legacy plaintext file automatically. If that
file is present, Settings should show a warning and a successful encrypted save
should remove it.

Deleting the saved Toss Securities API key store from Settings also deletes
`data/tossinvest/tossinvest-ledger.sqlite3` and SQLite sidecar files so
credentials, locally synced transaction history, reconstructed snapshots, Toss
daily candles, and Toss USD/KRW exchange rates are cleared together. The same
cleanup also removes obsolete pre-release generated `position-reconstruction-*`,
`market-candles/`, and `fx-usdkrw-*` files if they exist locally.

Position reconstruction is SQLite-first. The ledger contains `orders`,
`sync_state`, `rebuild_runs`, `position_snapshots`, `market_candles`,
`market_candle_cache_state`, and `fx_rates`. Snapshots are rebuilt only after
the sync loop reaches the end of Toss history for every account. Intermediate
sync batches that still have more historical pages do not rebuild snapshots.
The final rebuild cross-checks current Toss holdings; positive replay positions
that are absent from current holdings are treated as zero-value extinguished
positions and excluded from all generated snapshots.

The asset-management rebuild must not use yfinance. Daily candles are fetched
from the Toss Securities candles endpoint and cached per symbol/date in
`market_candles`; coverage requests are tracked in
`market_candle_cache_state`. USD/KRW rates are fetched from the Toss Securities
exchange-rate endpoint and cached per date in `fx_rates`. These caches are
runtime-local generated data inside the ledger, not release assets.

Order-history sync must be rate-limit friendly. A sync run should continue
through historical pages while Toss reports more results, but it must space Toss
ORDER_HISTORY page requests by at least two seconds. If Toss returns a
rate-limit response, prefer increasing `config/tossinvest-sync.user.json`
`pageDelayMs` or waiting for a later sync over increasing request burst size.
The frontend also sends enabled sync an automatic signal about every ten minutes
only while Toss is unlocked and connection-tested; if another order-history sync
is in progress at that moment, the timer signal is skipped.

When Toss returns an IP allowlist error, Settings may call
`/api/tossinvest/network/public-ip` after the user presses the public-IP check
button. The local server checks IPv4-only public IP echo services first and
falls back to IPv6-only services only when IPv4 lookup is unavailable. The
result is shown only in the local Settings UI so the user can copy it into Toss
PC's Open API allowlist.

Allowed server endpoints should remain GET-backed read operations such as
accounts, holdings, historical orders, and conditional-order history. Do not add
endpoints that call Toss write APIs such as order create, order modify, order
cancel, conditional-order create, conditional-order modify, or conditional-order
cancel.

The `거래현황` page is a live read-only view, not a
`position_snapshots` projection. It uses `/api/tossinvest/investment-status`
as a local aggregate over Toss accounts, holdings, and prices. The view should
keep existing rows visible while refreshing text values, avoid remounting the
whole surface, pause automatic refresh while the browser tab is hidden, and
coalesce duplicate refreshes for the same account/currency. If the Toss vault is
locked or credentials are missing, the page should show the same locked/missing
state as asset management and must not call the live investment endpoint until
credentials are usable again.

The sidebar and main-section `transaction-currency-switch` preferences, table
column choices, manual ordering, and 관심 목록 groups with their saved instruments
are file-backed. Watchlist name autocomplete uses the KRX KIND
listed-company table for domestic listings and the NYSE Listings Directory
quotes filter for US listing candidates, then validates the final symbol through
Toss `GET /api/v1/stocks` before saving. Toss's official `stocks` endpoint
requires `symbols` and does not expose a full text-search or all-symbol
autocomplete surface, so external symbol-master sources remain lookup hints
before the same Toss validation step. The shipped default is
`config/transaction-status.defaults.json`, and local choices are written to
ignored user config at `config/transaction-status.user.json` through
`/api/transactions/settings`. Settings schema v2 preserves legacy `symbols[]`
and adds provider-qualified `instruments[]`; a symbols-only user file remains
readable and is not silently reclassified as crypto. Saved `KRW` or `USD`
preferences override the live payload's primary currency when the user returns
to the page.

Binance Spot autocomplete is local filtering over the public `exchangeInfo`
catalog, not a separate Binance autocomplete endpoint. The local market-data
connector intentionally exposes only currently `TRADING` USDT Spot pairs and
uses `instrumentId`, `provider`, `venue`, `assetClass`, `baseAsset`,
`quoteAsset`, `settlementAsset`, `status`, and `sessionPolicy` metadata instead
of inferring a market from an alphabetic symbol. Public price, 24-hour volume,
candle, and exchange metadata requests use `data-api.binance.vision` without an
API key. Provider timeout, stale/degraded state, and upstream 418/429 limits are
reported separately from Toss credential state. A Binance simulator order is
blocked during the upstream retry window, when the cached catalog is stale, or
when its current-price execution reference is older than 60 seconds; the server
does not fall back to a client-supplied price or an assumed `TRADING` status.

The `거래현황` live calls are screen-scoped. `내 투자` calls
`/api/tossinvest/investment-status` only for the selected account's current
holdings. `관심 목록` does not call the holdings aggregate; it partitions the
selected folder by provider and requests only those stock or Binance instruments.
Mixed folders continue to show Binance rows if Toss credentials are locked.
Binance's `priceChangePercent` is already percent-valued and must not be scaled
again; longer-period returns use UTC-aligned Binance daily candles. When candle
history is shorter than the requested period, the period displays `-` rather
than a synthetic return.

Investment simulator accounts are local-only and use their own SQLite store at
`data/invest-simulator/simulator.sqlite3`, with the schema tracked in
`config/invest-simulator.schema.sql`. The `/api/invest-simulator/*` endpoints
call `scripts/invest_simulator_store.py` through Python's standard `sqlite3`
module. Simulator account creation appends an `initial_cash` ledger event,
FX conversion appends an `fx_exchange` event, market buys append `stock_buy`,
and market sells append `stock_sell`; filled orders also write matching
`simulator_orders` and `simulator_trades` rows. Cash balances and positions
must be replayed from the simulator ledger and trade rows. The simulator order
path must enforce KRW settlement for Korean stocks and USD settlement for US
stocks at the store/API layer, not only in the frontend. Binance Spot USDT pairs
also settle against the existing USD balance under an explicit `USDT = USD`
practice assumption; there is no USDT balance or USD/USDT FX event. Binance
orders use `status = TRADING`, `sessionPolicy = 24x7`, provider availability,
and non-stale current-price data instead of a KR/US market calendar. Fills use
the latest standard price without bid/ask, depth, or slippage modeling. Because
account-specific Binance commission is authenticated user data, no-key fills
record fee `0 USD` and `feeAssumption = zero-no-public-account-rate`. The HTTP
order API requires a per-intent idempotency key, which the UI preserves across
retries until that order succeeds. Sells must reject orders above the current
position quantity and reduce remaining cost basis by average cost. When a
simulator account is selected in `거래현황`, the UI refreshes
the local simulator account snapshot and provider-specific read-only price/candle
data so simulated positions show current price and daily-return movement.
Simulator daily profit uses previous close for carried positions, but same-day
buy lots use their actual fill cost as the daily baseline so first-day daily
profit cannot exceed total profit solely because the stock moved before entry.
Simulator account renames update `simulator_accounts.name` and append an
`account_renamed` ledger event. Simulator deletion archives the account and appends
an `account_archived` ledger event; it must not hard-delete account, trade,
snapshot, or ledger history rows. This store is separate from
`data/tossinvest/tossinvest-ledger.sqlite3`; simulator cash, orders, trades,
snapshots, and FX events must not be written into the real Toss order-history
sync ledger. The simulator UI may still use Toss read-only market endpoints
for current prices, candles, and USD/KRW reference rates while keeping all
simulated user actions in the simulator ledger.
The complete v2 storage and replay contract is in `docs/invest-simulator.md`.

Live market calls must respect Toss Open API market rate-limit groups:

| Group | Local use | Limit policy |
| --- | --- | --- |
| `MARKET_INFO` | exchange rate and market calendar reference calls | at most 3 calls/second |
| `MARKET_DATA` | current prices and quote-like reads | at most 10 calls/second |
| `MARKET_DATA_CHART` | candles and chart history reads | at most 5 calls/second |

The local server enforces conservative per-group spacing before outbound Toss
requests. `/api/tossinvest/investment-status` should cache a fresh aggregate for
short automatic refresh windows, coalesce simultaneous forced refreshes, and
chunk large price requests into Toss-sized symbol batches. Do not use the Toss
exchange-rate endpoint to rewrite or merge portfolio cache values; Toss FX is a
separate current/reference data source and may differ from external or
historical reconstruction rates.

## Browser Detection

The handoff code defaults to Google Chrome where available. It looks for browsers in this order:

- explicit `ARCA_BROWSER_PATH`
- macOS app paths for Chrome, Edge, Brave, Chromium
- Windows common install paths under `LOCALAPPDATA`, `Program Files`, and `Program Files (x86)`
- Linux commands resolved by `which`: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge`, `brave-browser`

ChatGPT Atlas is not auto-selected for this flow because it may not expose a stable DevTools endpoint when launched as a detached login handoff. If a user intentionally wants another Chromium-family browser, set `ARCA_BROWSER_PATH` to that executable. If detection fails, the recovery path should tell the user to set `ARCA_BROWSER_PATH` to the browser executable.

Starting the login handoff should return promptly after the dedicated browser process is open. If Chrome is still warming up its DevTools endpoint, the app can show the handoff as open and verify the endpoint again when the user presses "세션 저장".

## Known Compatibility Risks

### Durable local server service

The durable server command is cross-platform but intentionally uses each OS's
native user-level service manager:

- macOS: `launchd` LaunchAgent
- Linux: `systemd --user`
- Windows: Task Scheduler

Run from `web`:

```bash
npm run server:service:install
npm run server:service:status
```

The service keeps the local GUI server independent from a terminal window. It
does not make the app a public network service; the default bind remains
`127.0.0.1`.

Common repair checks:

- If install succeeds but the page is down, run `npm run server:service:status`
  and inspect `logs/service-5173.err.log`.
- If port `5173` is already occupied by a terminal-started server, stop the old
  process and run `npm run server:service:restart`.
- If Node was installed through a version manager and the service cannot find
  it, set `NODE_BIN` to the absolute Node executable path and reinstall the
  service.
- On Linux, `systemd --user` must be available in the current desktop/session
  environment. Without user systemd, use the foreground `npm run dev` path or
  add a platform-specific supervisor.
- On Windows, the scheduled task runs in the current user's context at logon. It
  should be installed from native PowerShell or another native Windows shell,
  not WSL.

### Local urgent notifications

The local urgent notification path uses the browser Notification API:

- title: `주식채널+`
- body: one-line summary generated from the saved urgent market update report
- icon: `/favicon.svg`
- click target: the open FinanceAgentGUI tab focuses and switches to `보고서`

Browser notifications require an open FinanceAgentGUI browser tab and browser
notification permission for the local site. The app requests permission on the
first user click or keypress when the browser still reports the permission state
as `default`. If permission is denied or the page is closed, the in-app `보고서`
sidebar badge remains the reliable visual signal for urgent updates.

Urgent market updates are generated before notification delivery. The app first
writes a short report from the existing shared-memory external market summary,
then stores a notification event for the open browser tab to display. Opening
Reports or clicking the browser notification marks the current urgent badge as
read; a new urgent report turns it on again.

### Antigravity CLI OAuth

Antigravity provider calls use the standalone `agy` CLI and its Google OAuth
session. Install the CLI, then run `agy` in a terminal to complete the browser
login flow before selecting Antigravity in the app.

If `agy` is missing, unauthenticated, or unable to list models, Antigravity
provider actions should fail with a clear readiness or generation error. Do not
use an alternate authentication mechanism or another selected provider.

### World Memory local database

World Memory stores user-specific SQLite data under `data/world-memory/`.
The app should create or migrate that database locally through
`scripts/world_memory_cli.py`; GitHub should only contain the schema blueprint
and operating instructions.

Tracked references:

- `docs/world-memory.md`
- `config/world-memory.schema.sql`
- `config/world-memory-collection.prompt.md`

Do not fix a missing World Memory store by copying in a bundled SQLite file.
Run `python scripts/world_memory_cli.py init` from the repository root if the file is
absent. If a populated store exists, repair commands must show the target path,
expected impact, and backup or confirmation boundary before destructive changes.

### Node WebSocket support

`web/server/arcaAuthApi.mjs` uses the global `WebSocket` client to talk to Chrome DevTools Protocol. Node 22 is the recommended runtime.

If the error says WebSocket is unavailable:

- upgrade Node,
- or patch the project to use an explicit WebSocket dependency,
- then document the new dependency in `docs/installation.md`.

### Windows Python stdout encoding

Windows native shells can expose `cp949` or another locale code page to Python
child processes. The yfinance calendar endpoints emit Korean labels, country
emoji, and fallback markers such as `•` as JSON, so `web/server/earningsApi.mjs`
and `web/server/economicCalendarApi.mjs` force their Python subprocesses to
UTF-8 with `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1`.

If a calendar view shows `UnicodeEncodeError: 'cp949' codec can't encode`, check
that those server modules are the active build and that the process was restarted
after updating. Do not remove the UTF-8 environment override when refactoring
Python subprocess helpers.

### Browser profile locks

Chromium-family browsers lock a profile while running. If `data/arca-browser-profile` is already open and the GUI server lost in-memory handoff state, the app should recover the running DevTools port where possible.

Current behavior:

- macOS/Linux: recovery scans running processes for the profile path and `--remote-debugging-port`.
- Windows: recovery is not yet fully implemented.

Possible Windows repair strategies:

- use PowerShell `Get-CimInstance Win32_Process` to find a command line containing `data\\arca-browser-profile` and `--remote-debugging-port=`,
- persist the handoff port and pid to a local runtime state file when launching,
- read Chromium's `DevToolsActivePort` file if available for the profile.

For WSL-specific repairs, avoid assuming a Windows browser executable can safely consume a Linux profile path. Prefer native PowerShell execution, or implement a deliberate WSL bridge with path conversion and explicit documentation.

### Browser enterprise policies

Some managed environments block remote debugging or custom user-data-dir profiles. If handoff start fails even with a correct browser path:

- capture the safe error message,
- verify whether the browser launches manually with `--remote-debugging-port`,
- offer `ARCA_BROWSER_PATH` or a different Chromium-family browser.

### Cloudflare and captcha

Arca.live may show Cloudflare challenge or captcha screens. The app should not bypass these. The user should complete them manually in the handoff browser. Agents should not solve captcha unless the user explicitly asks at action time.

### Login URL drift

The current login URL uses `goto`, not `redirect`. A wrong parameter can lead to `/u/null` and a 404 page after login.

If login opens a 404 page:

1. Inspect the public board page for the current login link.
2. Update the default login URL in `web/server/arcaAuthApi.mjs`.
3. Keep `ARCA_LOGIN_URL` as an override.
4. Re-run status/start/stop probes.

## Safe Diagnostic Commands

From the project root, inspect local stores and publish safety without reading
row payloads or printing matched secret values:

```bash
python scripts/sqlite_store_doctor.py
python scripts/sqlite_store_setup.py plan --initialize-missing
python scripts/release_safety_check.py --strict
```

From `web`:

```bash
npm run build
node --check server/arcaAuthApi.mjs
node --check server/tossInvestApi.mjs
npm run dev -- --host 127.0.0.1
```

Probe auth status:

```bash
curl -sS http://127.0.0.1:5173/api/arca/auth/status
curl -sS http://127.0.0.1:5173/api/tossinvest/auth/status
```

Probe start/stop without printing secrets:

```bash
curl -sS -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:5173/api/arca/auth/start

curl -sS -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:5173/api/arca/auth/stop
```

If Vite uses another port, use the printed local URL.

## What Not To Do

- Do not commit `data/secrets/arca-session.json`.
- Do not commit `data/secrets/tossinvest-credentials.vault.json` or legacy `data/secrets/tossinvest-credentials.json`.
- Do not commit `data/tossinvest/tossinvest-ledger.sqlite3`, `config/tossinvest-sync.user.json`, or `config/transaction-status.user.json`.
- Do not commit `data/invest-simulator/simulator.sqlite3` or its SQLite sidecar files.
- Do not commit `data/magazine/event-signature-index.sqlite3`, `data/backups/`, or generated Magazine articles.
- Do not commit `data/world-memory/world_issue_log.sqlite3` or any generated World Memory runtime file.
- Do not paste raw cookies into issues, chat, logs, or memory.
- Do not make a personal absolute path the default browser path.
- Do not remove the manual-login boundary by asking the app to collect the user's password.
- Do not treat a successful cookie capture as proof that notification polling is complete; polling still needs its own endpoint, status, error handling, and verification.

## Agent Repair Checklist

When the user says "fix this on my machine":

1. Identify the OS, shell, Node version, browser used, and exact failing endpoint.
2. Read `docs/installation.md` and this file.
3. Run the read-only SQLite doctor and release safety check from the project root; do not inspect secret contents directly.
4. For GitHub updates or DB setup, read `docs/update-and-release-safety.md` and `docs/sqlite-stores.md`, stop the server, review the setup plan, and back up before migration.
5. Check whether `ARCA_BROWSER_PATH` or `ARCA_LOGIN_URL` would solve the issue without code changes.
6. If code changes are needed, keep them under the app tree.
7. Run `node --check` on edited server modules.
8. Run `npm run build`.
9. Start the local server and test the narrow endpoint.
10. Do not display raw secrets.
11. Update this document with any durable compatibility lesson.
