# PB Daily Intelligence Bridge

FinanceAgentGUI can display the latest reader report and its separate research
queue from an external `pb-daily-market-brief` workspace.

## Connection

Set `PB_DAILY_INTELLIGENCE_DIR` to the external pipeline's `workspace` folder
before starting the local server.

PowerShell example:

```powershell
$env:PB_DAILY_INTELLIGENCE_DIR = "C:\path\to\pb-daily-market-brief\workspace"
npm --prefix web run dev
```

The artifact folder remains read-only. FinanceAgentGUI does not modify or
delete files through the snapshot endpoint.

## Optional job runner

To enable the operator controls, also configure the external pipeline root and
its Python executable:

```powershell
$env:PB_DAILY_INTELLIGENCE_ENGINE_DIR = "C:\path\to\pb-daily-market-brief"
$env:PB_DAILY_INTELLIGENCE_PYTHON = "C:\path\to\python.exe"
```

When installing the durable local service, set these three variables in the
same PowerShell window. If the background service cannot discover Codex from
`PATH`, also set `CODEX_CLI_PATH` to the local Codex executable. The service
persists only these allowlisted executable and connection paths in its OS
service definition. API keys, Telegram sessions, tokens, and the external
engine's `.env` contents are never copied into the FinanceAgentGUI service.

The GUI exposes only three fixed actions:

- `collect`: runs `collect_all.py`
- `dry_run`: runs `run_daily_report.py --dry-run`
- `verification_dry_run`: runs `run_daily_report.py --verification-dry-run`;
  it fetches allowlisted official evidence and performs structured event
  analysis while blocking Notion publication and Telegram delivery
- `publish`: runs `run_daily_report.py`

The browser cannot submit a command, script path, argument list, or working
directory. Every action first requests a short-lived server confirmation plan.
The plan displays the executable preview, local/external effect, and target.
Only the plan token can start the allowlisted action. One job may run at a
time, logs are bounded and redacted, and there is no process-kill action.

## GitHub Actions runner and local artifact sync

Report generation can use the Secrets already stored in a private
`pb-daily-market-brief` repository instead of copying them into a local `.env`.
The local server dispatches the allowlisted `daily-brief.yml` workflow through
an authenticated GitHub CLI, waits for the uniquely correlated run, downloads
`daily-market-evidence-<run-id>`, and copies only known report workspace
directories into `PB_DAILY_INTELLIGENCE_DIR`.

Configure the durable service with:

```powershell
$env:PB_DAILY_INTELLIGENCE_REMOTE_ENABLED = "true"
$env:PB_DAILY_INTELLIGENCE_REMOTE_REPO = "owner/pb-daily-market-brief"
$env:PB_DAILY_INTELLIGENCE_REMOTE_WORKFLOW = "daily-brief.yml"
$env:PB_DAILY_INTELLIGENCE_REMOTE_REF = "main"
$env:PB_DAILY_INTELLIGENCE_GH = "C:\Program Files\GitHub CLI\gh.exe"
```

The workflow must accept a `client_request_id` input and include it in
`run-name`; this prevents the GUI from attaching to another manual run. Local
collection-only actions remain local. Report generation, official-evidence
verification, Telegram/Gmail analysis, and publication use GitHub Actions when
remote mode is enabled. Publication still requires an explicit GUI confirmation.

For a non-service local setup, the same values may be stored in ignored
`config/pb-daily-intelligence.remote.user.json` using `enabled`, `repository`,
`workflow`, `ref`, `workspace`, and `ghPath` fields. Secret values never enter
this file or the FinanceAgentGUI process.

## Expected artifacts

```text
workspace/
  v2_reader_reports/
    YYYY-MM-DD/
      reader_report.json
  intelligence/
    YYYY-MM-DD/
      daily_intelligence.json
  us_market_internals/
    YYYY-MM-DD/
      market_internals.json
  sector_metrics/
    YYYY-MM-DD/
      sector_metrics.json
  us_equity_candidate_screen/
    YYYY-MM-DD/
      candidate_screen.json
```

Supported schemas:

- `v2_reader_report.v1`
- `daily_market_intelligence.v2`
- `us_market_internals.v1`
- `sector_metric_observations.v1`
- `us_equity_candidate_screen.v1`

The reader report supplies the public-facing conclusion, market findings,
verified events, Korea transmission, next checks, data warnings, and sources.
The intelligence artifact supplies operational event counts and the
verification queue. Unverified queue items are visually separated and are
never promoted into the reader-facing verified-event section. The interface
shows every queued event rather than truncating it. Market internals, sector
metrics, and U.S. equity candidates enrich the operator screen without changing
the stricter reader-report publication gate.

## Daily decision home

The `Daily Intelligence` reader is the short daily decision path. It keeps the
evidence gate, same-day thesis-change alerts, the 30-second conclusion, the
compact market-to-sector-to-stock chain, portfolio linkage, verified events,
and next checks. A four-card analysis-desk launcher opens the independent
market, company, thesis-journal, and institutional-ownership screens. Data
warnings and primary-source links remain available in one collapsed supporting
evidence section instead of occupying two permanent reader cards.

## Institutional 13F radar

The independent `기관 포트폴리오` screen (`#institutional-portfolio`) can
collect the latest eight Form 13F quarters for the built-in
institutional-manager watch set. It reuses only the current Daily Intelligence
decision and stock-candidate context needed for cross-links; the radar itself
is no longer rendered on the Daily Intelligence page. Add an application name
and a monitored contact email to the ignored project-root `.env` file:

```dotenv
SEC_13F_USER_AGENT=FinanceAgentGUI research your-email@example.com
```

The value is sent only as the SEC request `User-Agent`; it is not returned to
the browser or written to the local cache. Collection starts only when the
operator presses `SEC 13F 수집` or `공시 새로고침`. Normal page loads read the
ignored local cache at
`data/pb-daily-intelligence/institutional-holdings-radar.json` and do not make
background SEC requests.

Sector attribution uses the most recent `us_sector_holdings` artifact from the
configured PB workspace first. That artifact is an official Select Sector SPDR
membership proxy. A small issuer-name fallback covers common large issuers;
everything else remains explicitly unclassified. The UI displays the mapped
value coverage so an incomplete sector map cannot appear complete.

The radar is an idea-triage surface, not a recommendation engine. It excludes
reported put/call and principal-amount (`PRN`) rows from common-equity sector
weights, compares share counts before market values, separates filing and
report dates, links matching sectors to the current market decision chain, and
sends only user-selected matching stock candidates into the existing thesis
tracker. The first version uses original `13F-HR` filings and does not merge
later `13F-HR/A` amendments; the UI states that limitation explicitly.

## Market and sector screen

The independent `시장·섹터` screen (`#market-sectors`) owns the market
scoreboard, sector and style leadership, structural sector indicators, market
structure findings, and Korea transmission paths. Daily Intelligence keeps the
decision summary, verified events, next checks, and portfolio linkage instead
of repeating those market-detail panels.

## Company research screen

The independent `기업 리서치` screen (`#company-research`) owns the stock
comparison decision board, screened U.S. equity candidates, and earnings,
guidance, and estimate-revision detail. Existing thesis tracking and watchlist
quick-add actions remain available on that screen. Daily Intelligence keeps the
compact market-to-sector-to-stock chain but no longer repeats the detailed
company cards.

## Thesis and decision journal

The independent `투자 가설·복기` screen (`#thesis-journal`) owns the Decision
Coach, the World Memory thesis ledger, weekly thesis-outcome calibration, and
monthly decision-habit goals. All approval, journal, rule-review, and thesis
sync actions remain connected to the existing controller. Daily Intelligence
keeps only the compact same-day thesis-change alert so important confirmation
or contradiction signals remain visible in the daily reading path.

## Safety boundary

- No external absolute path is shown in the browser response.
- Missing or malformed artifacts fail closed and remain unpublished.
- Snapshot reads remain read-only.
- Local writes and Notion/Telegram publication require the separate configured
  job runner plus the explicit plan-and-confirm flow.
- `dry_run` and `verification_dry_run` never publish to Notion or Telegram;
  `publish` uses the external
  pipeline's existing credentials, quality gates, and destinations.
