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

The external folder is read-only. FinanceAgentGUI does not modify, delete, or
publish its files.

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
- The connection is read-only.
- Notion and Telegram publication continue to belong to the external pipeline
  until an approved GUI publishing action is implemented.
