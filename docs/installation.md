# Installation And Local Run Guide

This document is for people or local agents setting up FinanceAgentGUI from the
project folder.

The app is intentionally a local web console. It runs a local server, opens in a browser, and stores user-specific state under local `data/` and `logs/` directories.

## Supported Shape

- Project folder: wherever the user cloned or downloaded this repository
- Web app: `web`
- Frontend: Vite + React
- Local server/API layer: Node.js modules under `web/server`
- Python helper scripts: `scripts`
- Runtime state: `data`
- Runtime logs: `logs`

Do not require files outside the project folder for normal installation or
execution.

## Prerequisites

Recommended baseline:

- Node.js 22 or newer
- npm matching the installed Node.js runtime
- Python 3.11 or newer for optional finance helper scripts
- A Chromium-family browser for browser-login handoff flows: ChatGPT Atlas, Chrome, Edge, Chromium, or Brave
- Antigravity CLI (`agy`) for Antigravity/Gemini provider features. This is a standalone CLI dependency, not an SDK package.

Node 22 is recommended because browser-login handoff code uses the built-in `WebSocket` client to talk to the browser DevTools Protocol. If a user is on an older Node runtime, either upgrade Node or patch the handoff implementation to use a project dependency with equivalent WebSocket support.

## Windows Shell Choice

On Windows, use this order:

1. PowerShell: primary supported path
2. CMD: acceptable for simple `npm` commands, but not the documentation default
3. WSL: advanced development/repair path only, not the default runtime path

PowerShell should be the default user-facing setup path because it runs in the same Windows environment as the installed browser, user profile, local ports, and credential tools. This avoids most confusion around browser-login handoff and local file paths.

CMD can usually run `npm install`, `npm run dev`, and `npm run build`, but PowerShell examples are preferred because Python venv activation, diagnostics, and future launcher scripts are clearer there.

WSL should not be the default way to run FinanceAgentGUI on Windows. It can be useful for code editing or agent repair, but it introduces a boundary between Linux paths and Windows browsers. Browser-login handoff may fail or become confusing unless the user intentionally runs a Linux Chromium browser inside WSL or the code has been patched for a specific Windows-browser-from-WSL setup.

Do not mix environments during setup. If the user installs Node packages in WSL, run the app in WSL. If the user runs the app in PowerShell, install packages in PowerShell.

## Frontend Install

From the `web` directory:

```bash
npm install
```

Then run the development server:

```bash
npm run dev -- --host 127.0.0.1
```

### Durable Local Server

For daily local use, the development server can be registered as a user-level
service so it is not tied to an open terminal window.

From `web`:

```bash
npm run server:service:install
npm run server:service:status
```

This command uses the native per-user service manager for the current OS:

| OS | Service backend | Installed outside the repo |
| --- | --- | --- |
| macOS | LaunchAgent (`launchd`) | `~/Library/LaunchAgents/com.financeagentgui.devserver.plist` |
| Linux | systemd user service | `~/.config/systemd/user/finance-agent-gui-devserver.service` |
| Windows | Task Scheduler | `FinanceAgentGUI Dev Server` scheduled task |

The service still runs the app from this project folder and writes runtime logs
under `logs/`:

- `logs/service-5173.out.log`
- `logs/service-5173.err.log`

Useful commands from `web`:

```bash
npm run server:service:start
npm run server:service:stop
npm run server:service:restart
npm run server:service:status
npm run server:service:uninstall
```

If port `5173` is already held by a terminal-started server, stop that server
first and then run `npm run server:service:restart`.

For a production-style local build:

```bash
npm run build
npm run serve
```

The server binds to `127.0.0.1` by default. Use `FINANCE_AGENT_GUI_HOST` and `FINANCE_AGENT_GUI_PORT` only when a local setup requires a different binding.

## Python Helper Install

Python helpers are optional for screens that call finance scripts, world-memory checks, or portfolio backtests.

From the repository root:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

On Windows PowerShell, which is the recommended Windows path:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Avoid using the WSL venv for a GUI server that is being run from native Windows PowerShell.

If Python features fail, report the Python executable path, version, failing command, and missing package as a diagnostic issue. Do not silently switch to system packages.

## World Memory Store

World Memory ships as scripts, docs, and schema, not as a prebuilt database.

Tracked design files:

- `docs/world-memory.md`
- `config/world-memory.schema.sql`
- `config/world-memory-collection.prompt.md`
- `scripts/world_memory_cli.py`
- `scripts/world_memory_harness.py`

Local runtime data:

- `data/world-memory/world_issue_log.sqlite3`
- `data/world-memory/collector-state.json`
- `logs/world-memory/*`

Initialize a local store from the repository root only when one does not already exist:

```bash
python scripts/world_memory_cli.py init
```

Do not copy or commit an empty SQLite database as a seed file. It can overwrite,
shadow, or confuse a user's existing World Memory during installation or update.

## Required Frontend Dependency

`web/package.json` must include Apache ECharts:

```bash
cd web
npm ls echarts
```

ECharts is the default chart/graph engine for finance charts, job status visuals, verification visuals, and relationship/data visualizations. If it is missing, install it in `web` and update both `package.json` and `package-lock.json`.

## Frontend Route Boundaries

`web/src/App.jsx` owns global shell state, sidebar/chat context, and shared route selection. Shell UI such as `web/src/shell/AppNavigation.jsx` and heavy workspace screens should live in feature folders and be composed or lazy-loaded from `App.jsx`.

Default route modules:

- `web/src/arca/StockChannelView.jsx`

Current lazy route modules:

- `web/src/settings/SettingsView.jsx`
- `web/src/news/NewsFeedView.jsx`
- `web/src/worldMemory/WorldMemoryView.jsx`
- `web/src/reports/ReportsView.jsx`
- `web/src/calendars/CalendarViews.jsx`
- `web/src/portfolio/PortfolioGuidePage.jsx`
- `web/src/portfolio/PortfolioWorkspace.jsx`

Shared UI/runtime helpers should stay outside `App.jsx` when multiple screens need them, such as `web/src/shell/AppNavigation.jsx`, `web/src/shell/screenSnapshot.js`, `web/src/agent/AgentSidebar.jsx`, `web/src/agent/AgentControls.jsx`, `web/src/agent/ChatMessages.jsx`, `web/src/agent/agentOptions.js`, `web/src/agent/attachments.js`, `web/src/agent/chatProtocol.js`, `web/src/arca/ArticleContextAttachment.jsx`, `web/src/arca/articleContext.js`, `web/src/calendars/earningPrompt.js`, `web/src/news/FeedSourceLabel.jsx`, `web/src/news/newsFeedStatus.js`, `web/src/utils/formatters.js`, `web/src/utils/MarkdownText.jsx`, `web/src/memory/sharedMemoryDefaults.js`, `web/src/worldMemory/actionCatalog.js`, `web/src/worldMemory/askRequest.js`, and `web/src/worldMemory/statusHelpers.js`.

## Local Configuration

Local user configuration should live under `config` or `data`.

Common environment variables:

- `FINANCE_AGENT_GUI_HOST`: local bind host, default `127.0.0.1`
- `FINANCE_AGENT_GUI_PORT` or `PORT`: local server port
- `FINANCE_AGENT_GUI_SERVICE_LABEL`: macOS LaunchAgent label override, default `com.financeagentgui.devserver`
- `FINANCE_AGENT_GUI_SERVICE_NAME`: Linux systemd user service name override, default `finance-agent-gui-devserver.service`
- `FINANCE_AGENT_GUI_SERVICE_TASK_NAME`: Windows scheduled task name override, default `FinanceAgentGUI Dev Server`
- `NODE_BIN`: explicit Node.js executable for the durable service when the detected path is not correct
- `ARCA_BASE_URL`: default `https://arca.live`
- `ARCA_CHANNEL`: default `stock`
- `ARCA_LOGIN_URL`: override for the Arca.live login URL
- `ARCA_BROWSER_PATH`: explicit Chrome/Edge/Chromium/Brave executable path; Google Chrome is used by default when available
- `ARCA_USER_AGENT`: optional Arca.live request user agent override
- `TOSSINVEST_CLIENT_ID`: optional Toss Securities Open API client id for the read-only connector
- `TOSSINVEST_CLIENT_SECRET`: optional Toss Securities Open API client secret for the read-only connector
- `TOSSINVEST_BASE_URL`: optional Toss Securities Open API base URL override, default `https://openapi.tossinvest.com`
- `ANTIGRAVITY_CLI_PATH`: optional explicit path to `agy` when it is not on `PATH`.
- `ANTIGRAVITY_CLI_MODEL`: optional default Antigravity CLI model override, default `Gemini 3.5 Flash (Medium)`.
- `ANTIGRAVITY_CLI_PRINT_TIMEOUT`: optional `agy -p` timeout, default `5m`.

Keep user-specific config files and generated runtime data gitignored.

## Antigravity CLI Install

Install Antigravity CLI with `curl -fsSL https://antigravity.google/cli/install.sh | bash` on macOS/Linux, then run `agy` in a terminal to complete Google OAuth. Do not install or document a separate SDK package for FinanceAgentGUI's Antigravity provider; the app checks and calls the standalone `agy` CLI. Missing CLI or OAuth readiness should surface as a provider readiness failure, with no alternate authentication or provider path.

## Private Runtime Data

The following are local runtime data and should not be committed:

- `data/secrets/*`
- `data/arca-browser-profile/*`
- `data/shared-memory/*` except `.gitkeep`
- `data/world-memory/*` except `.gitkeep`
- `data/news-feed.json`
- `data/news-feed-read-state.json`
- `data/news-feed-view-state.json`
- `data/*-cache.json`
- `logs/*`

Never print raw cookies, tokens, API keys, or credentials when debugging.

The Toss Securities connector can read credentials from `TOSSINVEST_CLIENT_ID` and
`TOSSINVEST_CLIENT_SECRET`, or from the encrypted local runtime vault
`data/secrets/tossinvest-credentials.vault.json` when saved through Settings.
The vault uses AES-256-GCM with a `scrypt`-derived 256-bit key. The vault
password is not stored, so restarting the server or pressing the Settings lock
button requires unlocking the vault again before account, holdings, or order
history calls can run. Access tokens are not written to disk. When cached in the
running server process, they are stored as AES-256-GCM ciphertext using a
process-local random key and decrypted only for outbound Toss API requests.

When 거래내역 동기화 is enabled in Settings, closed Toss Securities order
history, reconstruction runs, daily/monthly position snapshots, per-symbol
daily candles, and USD/KRW exchange rates are stored in the local SQLite ledger
`data/tossinvest/tossinvest-ledger.sqlite3`. The expected schema is documented
in `config/tossinvest-ledger.schema.sql` and is created lazily by
`scripts/tossinvest_ledger_store.py` and
`scripts/tossinvest_position_reconstruct.py`. The user toggle is written to
`config/tossinvest-sync.user.json`; the shipped defaults live in
`config/tossinvest-sync.defaults.json`. The SQLite file and user config are
runtime-local and must not be committed or included in a release ZIP. The sync
path uses the existing Toss Open API credentials and Python's standard
`sqlite3` module; it does not add a Node native SQLite dependency.

The 거래현황 sidebar currency, main-section currency, table column, manual
ordering, and 관심 목록 groups with their saved ticker lists are stored in
`config/transaction-status.user.json`; the shipped defaults live in
`config/transaction-status.defaults.json`. The user file is runtime-local and
must not be included in a release ZIP. 관심 목록 autocomplete uses the KRX KIND
listed-company table for domestic stock-name to symbol lookup and the NYSE
Listings Directory quotes filter for US listing candidates, then validates the
final symbol with Toss `GET /api/v1/stocks` before saving.

The 거래현황 screens keep Toss live calls scoped to the visible work surface.
`내 투자` refreshes the selected account's holdings through
`/api/tossinvest/investment-status`. `관심 목록` refreshes only the symbols in the
currently selected watchlist folder through `/api/tossinvest/prices`; when it
needs daily, weekly, monthly, or six-month return rates, it requests `1d`
candles only for those same symbols, at a one-second interval while the
watchlist surface is visible. If a listed instrument does not have candle
history old enough for a period, that period is displayed as `-` instead of
inventing a return.

Deleting the saved Toss Securities API key store from Settings also deletes the
local SQLite ledger, SQLite sidecar files, and obsolete pre-release generated
snapshot/cache files if they exist. The sync toggle configuration remains local
user config, but the stored transaction rows, snapshots, market candles, and FX
rates are removed with the credential store.

After the order-history sync loop reaches the end of Toss history for every
account, the app rebuilds derived position snapshots inside
`position_snapshots`: month-end snapshots and every calendar day's daily
snapshot from the first synced trade through the current holdings collection
date or today. Intermediate sync batches that still have more historical pages
do not rebuild snapshots. `rebuild_runs.total_snapshots` is known before the
snapshot loop starts, so Settings and asset-management surfaces can show
`completed / total` and percent progress while `completed_snapshots` advances.
The final rebuild cross-checks current Toss holdings; positive replay positions
that are absent from current holdings are treated as zero-value extinguished
positions and excluded from all generated snapshots.

Position reconstruction does not use yfinance. It requests daily candles from
the Toss Securities candles endpoint and stores them by `(symbol, price_date)`
in `market_candles`, with requested coverage tracked in
`market_candle_cache_state`. USD/KRW rates are fetched from the Toss Securities
exchange-rate endpoint and stored by `(base_currency, quote_currency,
rate_date)` in `fx_rates`. These converted values support cost-basis and
mark-to-market columns such as `usdKrwRate`, `knownCostBasisUsd`,
`knownCostBasisKrw`, `marketValueUsd`, and `marketValueKrw`.

Order-history sync is intentionally paced. A sync run keeps fetching historical
pages while Toss reports more results, but it waits at least two seconds between
Toss ORDER_HISTORY page requests. A high safety ceiling prevents runaway loops;
if that ceiling is reached, the saved cursor lets a later sync continue without
starting over. When the Settings connection is unlocked and verified, enabled
sync sends an automatic sync signal about every ten minutes. If a manual or
previous automatic sync is already running when the timer fires, that signal is
skipped.

## Quick Verification

Run from `web`:

```bash
npm run build
```

Check server modules when editing local API code:

```bash
node --check server/server.mjs
node --check server/arcaAuthApi.mjs
node --check server/arcaApi.mjs
node --check server/tossInvestApi.mjs
node --check server/worldMemoryApi.mjs
python scripts/tossinvest_ledger_store.py status
python scripts/tossinvest_position_reconstruct.py rebuild
```

Start the app and probe a local endpoint:

```bash
npm run dev -- --host 127.0.0.1
curl -sS http://127.0.0.1:5173/api/arca/auth/status
curl -sS http://127.0.0.1:5173/api/tossinvest/auth/status
```

If Vite chooses another port, use the printed local URL.

## Agent Repair Expectations

FinanceAgentGUI is meant to be repairable by a local coding agent after a user clones or downloads it from GitHub. When setup fails:

1. Inspect the exact OS, Node version, npm version, Python version, browser path, and failing endpoint.
2. Keep secrets redacted.
3. Prefer small patches inside the app tree.
4. Re-run `npm run build` or the narrowest relevant verification.
5. Update `docs/compatibility.md` when the fix teaches a platform-specific lesson.
