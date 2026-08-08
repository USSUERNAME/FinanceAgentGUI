# Private report reader

The private reader publishes a sanitized, read-only research bundle to the
Cloudflare Pages project `finance-agent-reports`. Cloudflare Access must protect
the production hostname before real data is enabled.

## Published views

- Daily brief: sanitized `v2_reader_reports/*/reader_report.json` files.
- Full intelligence: decision fields from `intelligence/*/daily_intelligence.json`.
- World Memory: the current report view and PB investment theses exported from
  local runtime state.

The bundle excludes raw PDF text, OAuth/API credentials, cookies, raw source
bodies, operational logs, absolute paths, and the World Memory SQLite database.
The browser is read-only; collection, semantic search, and memory mutation stay
in the local app.

## Sync local World Memory

World Memory is local runtime data, so it is transferred separately through the
write-only GitHub Actions secret `PRIVATE_READER_WORLD_MEMORY_JSON`.

```powershell
node scripts/sync-private-reader-world-memory.mjs `
  --repo OWNER/REPOSITORY `
  --push
```

The command writes an ignored preview under `.generated/`, sanitizes the
snapshot, and sends only that snapshot to the repository secret. Run the
`deploy_reader` workflow afterward with a validated `source_run_id`. Normal
scheduled deployments keep using the most recently synchronized snapshot.

## Required GitHub configuration

- Secret `CLOUDFLARE_ACCOUNT_ID`
- Secret `CLOUDFLARE_API_TOKEN`
- Secret `PRIVATE_READER_WORLD_MEMORY_JSON` (created by the sync command)
- Variable `CLOUDFLARE_REPORTS_PROTECTED=true`

Do not commit generated `reports.json`, local report workspaces, World Memory
runtime files, or credentials.
