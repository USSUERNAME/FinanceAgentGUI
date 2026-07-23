# World Memory Storage Contract

FinanceAgentGUI ships the World Memory engine shape, not a starter database.

The runtime database is local user state:

- path: `data/world-memory/world_issue_log.sqlite3`
- collector state: `data/world-memory/collector-state.json`
- logs and generated review artifacts: `logs/world-memory/*`
- user setting: `config/world-memory.user.json`

These files are intentionally ignored by Git. Do not commit an empty SQLite file,
sample SQLite file, copied user memory, collector state, generated embeddings,
collection logs, or a user's enabled/disabled preference. Even an empty tracked
database can overwrite or confuse a user's existing local memory during clone,
pull, archive extraction, or repair.

## Feature Toggle

World Memory is opt-in by default.

- `config/world-memory.defaults.json` is tracked and sets `enabled: false`.
- `config/world-memory.user.json` is ignored local configuration written by the
  Settings screen switch.
- `Autopilot 모드` also defaults off and persists as `autopilotEnabled` in the
  same ignored user configuration file.
- When disabled, the left sidebar hides the World Memory menu and sidebar-agent
  prompts do not receive World Memory search context.
- When enabled, the local collector can start and World Memory status/actions use
  the private runtime store under `data/world-memory/`.
- Sidebar-agent prompts do not receive the World Memory store wholesale. General
  screens receive only bounded retrieval results when enabled: World Memory uses
  semantic search, while News Feed contributes a separate bounded lexical search
  result from `data/news-feed.json`.

## Autopilot mode

Autopilot is an explicit, user-controlled standing approval for World Memory
change suggestions. It is available only while World Memory itself is enabled.
Turning World Memory off also normalizes Autopilot back to off.

After a collection or report refresh creates unresolved change suggestions, the
configured World Memory management model evaluates each suggestion against the
current report, local list/state/taxonomy/audit output, and semantic-search
evidence. The model must return one structured JSON decision:

- `accept_original`: apply the proposed direction as written.
- `accept_modified`: apply the model's narrower or otherwise adjusted version.
- `investigate`: when write evidence is insufficient, run a bounded read-only
  follow-up instead of guessing or silently rejecting the suggestion.

The server validates the decision with an allowlist and the existing World
Memory action parameter contract before execution. Autopilot cannot emit an
arbitrary shell command and cannot call `collectNow`, `pause`, `feedScan`,
`report`, or `refreshReport` as a model-selected action. Mutation decisions are
limited to `stateAdd`, `briefStoryBackfill`, `storyLink`, `taxonomyRefresh`, and
`stateSync`; investigation decisions are limited to existing read-only World
Memory actions. A failed model contract or action stays unresolved and is
recorded as an Autopilot error rather than being treated as accepted.

Successful mutations are recorded in the same suggestion ledger and followed by
one report refresh. `autopilot` state and the latest bounded result summary live
in ignored `data/world-memory/collector-state.json`. Enabling Autopilot also
offers the current unresolved report suggestions to the same pipeline, so the
user does not need to wait for the next six-hour collection.

## Tracked Blueprint

The tracked design artifacts are:

- `config/world-memory.defaults.json`: default feature toggle, shipped off.
- `config/world-memory.schema.sql`: empty-store SQLite schema blueprint.
- `config/world-memory-collection.prompt.md`: collection and curation operating rules.
- `scripts/world_memory_cli.py`: owner CLI that creates, migrates, reads, and writes the store.
- `scripts/world_memory_harness.py`: verification harness for store health.
- `tests/test_world_memory_cli.py` and `tests/test_world_memory_harness.py`: behavior checks.

The cross-store registry and read-only verification entrypoint are
`config/sqlite-stores.json` and `scripts/sqlite_store_doctor.py`. Update-time
backups and owner-controlled migration are documented in `docs/sqlite-stores.md`.

The schema file is documentation and repair guidance. The CLI remains the runtime
owner because it also seeds system taxonomy and applies compatibility migrations.

## Collector State Timestamps

`data/world-memory/collector-state.json` separates collection eligibility from
report generation:

- `collector.lastSuccessfulAt` is the latest successful collection/import
  cutoff. News Feed windows for Magazine start after this timestamp. Shared
  memory market summaries use it as the primary freshness boundary, then backfill
  from the latest timestamped News Feed rows to keep a 30-row analysis sample
  when the feed store has enough rows.
- `collector.lastReportSuccessfulAt` and `report.generatedAt` describe report
  generation or report refresh completion. They must not move News Feed
  eligibility forward by themselves.
- A report-only refresh can update `report.generatedAt` without changing
  `collector.lastSuccessfulAt`.

## Change Suggestion States

`data/world-memory/collector-state.json` keeps accepted report suggestions in
`changeSuggestionLedger.handled` for backward compatibility, but each record now
has an explicit status:

- `watching`: a read-only investigation such as `semanticSearch` completed, but
  no World Memory structure was changed. The report keeps the suggestion visible
  with an orange eye marker until the next report/update selection and continues
  to offer the local agent follow-up.
- `completed`: an approved mutation such as `briefStoryBackfill`, `stateAdd`, or
  `storyLink` completed. The report uses a green check marker and removes the
  local-agent action button from that row.

Legacy ledger records without a status are interpreted as `completed`. Completed
rows are never rendered with strike-through text. Watching rows are temporary
feedback that a read-only follow-up ran without a material structure change.
During the next report or collection update, the model evaluates them under the
same importance, timeliness, and follow-up-value criteria as every other change
suggestion. A watching row remains visible only when the model selects it again;
an omitted row disappears from the report and expires from the watching ledger.

Each ledger record also owns a stable `continuityId`. During report generation,
the model first decides whether each previous watching item still deserves a
place; prior watching status never guarantees reselection. It then classifies
every proposed change against those records: a reselected update to the same
target, intent, and follow-up action must reuse the supplied ID even when counts,
timestamps, or wording changed; a genuinely separate issue uses an explicit
empty ID. When watching records exist, legacy string rows or object rows that
omit this decision fail the report-generation harness. The server accepts only
IDs already present in the ledger and coalesces repeated output for one ID to the
latest sentence. This structured LLM-classification harness keeps genuinely
continued observations in one visible row without relying on keyword or regex
similarity.

## Collector Recovery And Connectivity

The collector treats `collector-state.json` as rebuildable runtime state. If the
state file is missing, invalid, or reset to an empty first-run shape while the
SQLite store or `logs/world-memory/world_memory_market_situation_*.json` still
exist, the server should recover the visible collector/report state from those
artifacts instead of showing a false first-run screen.

Before starting a collection cycle, the server performs a lightweight internet
connectivity probe. If the probe fails, the collector enters `offline_wait`
rather than running FEED scans or model calls. In this state it schedules a
lightweight retry check for 10 minutes later and keeps the collection attempt
number stable. When a later probe succeeds, the scheduled collection continues
automatically. The FEED scan fetches First Squawk, unusual_whales,
FinancialJuice, *Walter Bloomberg, and Wall St Engine as five independent RSS
XML sources. A failure in one source is reported with that source name and URL
while the other sources continue through normalization, deduplication, and
scoring. No Telegram fallback is used. These are the same five RSS.app sources
shipped in the News Feed defaults; the separate Trump's Truth News Feed source
is not part of the World Memory breaking-news scan. RSS.app currently serializes
First Squawk and unusual_whales local publication times with a misleading `GMT`
suffix, so both collection paths apply a source-specific `-540` minute offset.
FinancialJuice, *Walter Bloomberg, and Wall St Engine remain unshifted because
their timestamps are already valid UTC. In News Feed, all five X/Twitter-backed
RSS.app sources use `itemContentMode: "title-only"`: collection and translation
use the RSS title only, and the repeated description with account/date
attribution is not stored as the visible original body. Trump's Truth retains
body translation.
For local diagnostics only,
`WORLD_MEMORY_ASSUME_ONLINE=1` forces
the probe to pass and `WORLD_MEMORY_ASSUME_ONLINE=0` forces the offline path.
The probe treats any reachable non-5xx HTTP response, including 3xx/4xx, as
evidence of internet connectivity; it is checking network reachability, not
whether the probe URL is a valid content endpoint. If Vite hot reload or a server
restart leaves an old connectivity-check promise in memory after `nextRetryAt`
has already passed, the scheduler should clear that stale in-flight marker and
resume the connectivity retry immediately.

## Management model settings

`PATCH /api/world-memory/settings` accepts `autopilotEnabled`, `managementProvider`,
`managementModel`, `managementReasoning`, and `managementSpeed`. The Settings
page orders these as provider, model, model-specific reasoning, and speed when
the selected model/reasoning combination actually exposes a controllable speed
tier. Codex `priority` is passed to every model call as
`-c service_tier="priority"`; unsupported or stale values fall back to
`standard`. The selected model, reasoning, and speed apply to collection,
report/change-suggestion refreshes,
and the World Memory sidebar runtime. Antigravity entries that include their
reasoning level in the model name do not show redundant reasoning or speed
selectors because Antigravity CLI 1.1.1 exposes neither control separately.
The model catalog and supported reasoning levels can be reloaded from the
installed CLI without restarting the app.

## Initialization

From the repository root, initialize a local store only when the user does not already
have one:

```bash
python scripts/world_memory_cli.py init
```

The command creates `data/world-memory/world_issue_log.sqlite3` if needed and
preserves existing local data. Local agents should check whether the file exists
before proposing destructive repair.

## Current SQLite Shape

The current store contains these tables:

- `world_issue_entries`: canonical issue and brief records. Each row stores
  searchable columns plus the normalized source payload in `payload_json`.
- `world_issue_embeddings`: sidecar semantic-search vectors keyed by event,
  engine, and model. Embeddings are generated runtime artifacts, not seed data.
- `world_issue_taxonomy`: indexed taxonomy values derived from entries, states,
  stories, and system taxonomy.
- `world_issue_states`: active, watch, or replaced market-regime state rows.
- `world_issue_story_links`: explicit story relation and family links.
- `world_issue_story_family_suggestions`: proposed story-family split or cleanup
  suggestions awaiting review.

All richer record fields should live inside `payload_json` unless they are needed
for filtering, joins, ordering, dedupe, or verification. This keeps the table
surface stable while allowing memory payloads to evolve.

## Data Safety Rules

- Never add `data/world-memory/world_issue_log.sqlite3` to Git.
- Never create a tracked zero-byte or empty SQLite placeholder.
- Keep only `data/world-memory/.gitkeep` tracked so the local runtime directory
  exists after checkout.
- Treat `collector-state.json` as generated local state.
- Treat embeddings as rebuildable local artifacts.
- Before running repair that could delete, replace, or import many rows, show the
  target path, planned impact, dry-run output when available, and confirmation
  boundary.
- After writes, verify with the narrowest relevant command, usually `audit`,
  `embed-status`, or `python scripts/world_memory_harness.py --strict`.
- To reduce orphan brief ratio after a user-approved curation decision, use
  `python scripts/world_memory_cli.py brief-story-backfill --event-id <id> --story "<story>" --story-family "<family>"`.
  This sets `manual_story_override` on the selected brief rows so later cleanup
  preserves the human or LLM-reviewed story assignment. Do not guess event ids;
  retrieve them from `list` or `semantic-search` first.

## Repair Guidance

If the store is missing, run `python scripts/world_memory_cli.py init` rather
than copying a database into place.

If the schema appears stale, prefer the CLI's init or migration path first. Use
`config/world-memory.schema.sql` as the human-readable target shape for local
repair, but do not replace a populated user database without an explicit backup
and confirmation.

If a Git command shows `data/world-memory/world_issue_log.sqlite3` as staged or
tracked, stop and remove it from the index before continuing.
