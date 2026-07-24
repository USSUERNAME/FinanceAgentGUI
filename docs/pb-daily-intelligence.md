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

The GUI exposes only three fixed actions:

- `collect`: runs `collect_all.py`
- `dry_run`: runs `run_daily_report.py --dry-run`
- `publish`: runs `run_daily_report.py`

The browser cannot submit a command, script path, argument list, or working
directory. Every action first requests a short-lived server confirmation plan.
The plan displays the executable preview, local/external effect, and target.
Only the plan token can start the allowlisted action. One job may run at a
time, logs are bounded and redacted, and there is no process-kill action.

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

## Safety boundary

- No external absolute path is shown in the browser response.
- Missing or malformed artifacts fail closed and remain unpublished.
- Snapshot reads remain read-only.
- Local writes and Notion/Telegram publication require the separate configured
  job runner plus the explicit plan-and-confirm flow.
- `dry_run` never publishes to Notion or Telegram; `publish` uses the external
  pipeline's existing credentials, quality gates, and destinations.
