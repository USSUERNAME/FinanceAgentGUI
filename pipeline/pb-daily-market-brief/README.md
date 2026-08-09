# Multi-source market intelligence -> Codex Korean Brief -> Notion PoC

This proof of concept intentionally avoids finance-site scraping. It keeps
each source in a small API or permitted-file adapter, then writes all items in
one normalized local inbox before Codex creates a Korean internal brief.

GitHub Actions runs a publication preflight after dependency installation and
before any collection or Notion publishing: `python -m compileall -q .` followed
by `python -m unittest discover -s tests`. A preflight failure skips report
creation, preserves artifacts when available, sends the existing failure
notification, and marks the workflow failed. It does not call external data
sources or create a Notion page.

## PB operations manifest

The daily pipeline keeps the reader brief and internal operations log separate,
then creates a read-only status contract for a future local operator console:

```text
workspace/operations_manifest/YYYY-MM-DD/operations_manifest.json
```

The manifest contains publication-bundle readiness, the latest collector
status, review-queue counts, and relative paths for recent reader and operations
reports. It does not include report bodies, absolute paths, API keys, or tokens.
`publish_cached` is enabled in the contract only when the cached bundle and
`REPORT_COMPLETE` marker are present; the manifest never publishes or performs
an investment action by itself.

To inspect an existing local bundle:

```powershell
python build_operations_manifest.py --date 2026-07-24 --run-mode dry_run
```

### Optional breaking-news radar feeds

Operator-authorized RSS relay URLs can be supplied through the following
GitHub Secrets or local environment variables:

```text
FINANCIAL_JUICE_RADAR_RSS_URL
WALTER_BLOOMBERG_RADAR_RSS_URL
FIRST_SQUAWK_RADAR_RSS_URL
UNUSUAL_WHALES_RADAR_RSS_URL
BREAKING_NEWS_RADAR_5_RSS_URL
```

These feeds are discovery-only regardless of their configured domain. Every
item is forced to Grade D, `metadata_only`, unconfirmed, and
`publication_eligible: false`. The item can create an event cluster and an
official-source search plan, but it is removed from the reader/report input.
The operator remains responsible for feed access and redistribution rights.

### Read-only local operations console

After a daily run has created an operations manifest, start the console:

```powershell
python pb_operations_console.py
```

Then open `http://127.0.0.1:8765`. The console shows run and publication-bundle
status, collector health, discovery-only radar counts, review queues, and recent
reader/internal reports. It binds to localhost only, serves reports only from
the two allowlisted report directories, and has no POST, rerun, collection, or
publication endpoint.

### File-based research continuity memory

Each successful daily run derives a bounded continuity index from the existing
hypothesis, sector-thesis, company-thesis, event-cluster, and official-source
resolution histories:

```text
workspace/history/continuity_memory.json
workspace/history/continuity_reviews/YYYY-MM-DD.json
```

Stable `continuity_id` values connect repeated metric tests, sector/company
theses, and recurring event families. Each entry records first/last seen dates,
last confirmation, a deterministic monitoring state, separated price/news/
filing/research references, confirmation and invalidation conditions, and at
most 50 observations. Source histories remain authoritative. Model-generated
suggestions may enter a bounded read-only review queue, but they cannot apply
themselves. Automatic memory changes, external actions, and position actions
are disabled.

## FinanceAgent V2 Daily Intelligence contract

The V2 branch adds a channel-neutral, event-centered contract before final
Notion composition:

```text
workspace/intelligence/YYYY-MM-DD/daily_intelligence.json
```

`build_daily_intelligence.py` joins the existing market analysis, event
clusters, official-source resolution, structured evidence, impact synthesis,
and continuity review. It selects no more than eight event cards and keeps
verified primary facts separate from secondary reports, interpretation angles,
and conflicting claims. Finding an official URL alone is not enough to confirm
a fact: an origin-grade source, completed extraction, and at least one
structured fact are all required.

The artifact is designed as the common input for a future FinanceAgent-style
Reports UI and the reader-facing editorial stage. It contains no collection,
publication, memory-mutation, or portfolio-action authority. The existing
Notion brief and internal operations report remain unchanged while V2 is
introduced incrementally.

## FinanceAgent V2 research task router

The next V2 artifact is a deterministic research routing plan:

```text
workspace/intelligence/YYYY-MM-DD/research_task_plan.json
```

`route_intelligence_tasks.py` maps verified event types to bounded public-equity
research workflows such as `economic-impact-report`, `earnings-deep-dive`,
`event-driven-analyzer`, and `thesis-tracker`. Missing primary facts or issuer
mapping are surfaced as explicit readiness blockers. The plan is advisory:
it cannot execute an agent, publish a report, mutate memory, or authorize a
portfolio action. Every future execution requires a separate operator-confirmed
step.

Eligible tasks are then materialized as a research support packet:

```text
workspace/intelligence/YYYY-MM-DD/research_execution_pack.json
```

`build_research_execution_pack.py` attaches only already-generated market or
company research outputs. A verified event without a matching specialist
output remains `prepared_for_specialist` or `awaiting_matching_output`; it is
never presented as completed analysis. This stage makes no model call and
performs no publication, memory mutation, or portfolio action.

### Explicitly approved specialist execution

The operator can list tasks that have both a current input hash and a dedicated
allowlisted specialist:

```powershell
python execute_research_task.py --date 2026-07-24 --list
```

Execution is limited to one exact task per command. Validate the request first:

```powershell
python execute_research_task.py `
  --date 2026-07-24 `
  --task-id <TASK_ID> `
  --expected-input-hash <INPUT_HASH> `
  --dry-run
```

An actual run additionally requires the requester, a review note, and the exact
confirmation phrase:

```powershell
python execute_research_task.py `
  --date 2026-07-24 `
  --task-id <TASK_ID> `
  --expected-input-hash <INPUT_HASH> `
  --requested-by <OPERATOR_NAME> `
  --execution-note "<WHY THIS VERIFIED TASK SHOULD RUN>" `
  --confirm-execution EXECUTE_RESEARCH_TASK
```

The executor accepts only verified event tasks mapped to the existing
`economic-impact-report` or `earnings-deep-dive` specialist scripts. It rejects
completed attachments, stale hashes, duplicate successful runs, unsupported
workflows, and batch execution. After the specialist succeeds, it refreshes
Daily Intelligence, the deterministic task plan, and the execution pack.
It never publishes, mutates continuity memory, approves an investment
recommendation, or authorizes a position action. Successful runs create an
append-only receipt under
`workspace/intelligence/YYYY-MM-DD/execution_receipts/`.

The read-only operations console also summarizes the same execution boundary:
currently executable work items, existing attached outputs, completed receipts,
blocked tasks, invalid receipt files, and the availability of expected output
artifacts. It deliberately does not expose command output, credentials, an
execution button, or a POST endpoint. A completed receipt with the same task ID
and input hash removes that stale item from the console's executable queue.

## FinanceAgent V2 reader report and Notion preview

The V2 editorial stage creates a separate reader contract and Markdown note:

```text
workspace/v2_reader_reports/YYYY-MM-DD/reader_report.json
workspace/v2_reader_reports/YYYY-MM-DD/reader_report.md
```

`compose_v2_reader_report.py` uses the deterministic market scoreboard and only
events that passed primary-fact confirmation, structured extraction, and the
reader publication gate. Unverified event titles, same-session non-causal price
context, task IDs, hashes, execution state, internal paths, and position actions
are excluded. Empty sections are hidden except for one concise verified-event
or Korea-data limitation.

The V2 Notion publisher remains separate from the production daily publisher.
It creates one new child page with a `[V2 TEST]` title and cannot update,
archive, replace, or notify from an existing report:

```powershell
python publish_v2_reader_report.py --date 2026-07-24 --dry-run
python publish_v2_reader_report.py --date 2026-07-24 --confirm-publish
```

Set `NOTION_V2_TEST_PARENT_PAGE_ID` when the preview should live below a
separate private parent. If it is blank, the publisher uses
`NOTION_PARENT_PAGE_ID` but retains the test-only title and create-only
behavior. A mode flag is mandatory, so a validation command cannot publish by
accident. This command is intentionally absent from `run_daily_report.py` and
the scheduled GitHub Actions publication step until the preview is reviewed.

## What this first version does

1. `fetch_sec_filings.py` checks three selected companies for new `8-K`,
   `10-Q`, and `10-K` filings and saves the metadata in a local inbox.
2. `prepare_brief_packet.py` downloads one selected filing and creates a
   bounded review packet for Codex.
3. Codex reads that packet and writes a Korean **internal brief**, not a full
   translation or investment recommendation.
4. `publish_to_notion.py` creates a child page under one private Notion page.

## Source adapters (new)

`collect_all.py` is the expansion point. Every adapter returns the same fields:
source, published time, title, link, relevant tickers/tags, a bounded source
excerpt, and a rights label. It then writes a de-duplicated JSON inbox under
`workspace/normalized/YYYY-MM-DD/`.

Every normalized record also carries evidence-control fields: observation and
release dates, collection time, market cut-off, source grade, primary-source
confirmation, evidence scope, and freshness state. A null release date is kept
null; the composer must not treat a monthly observation period as its release
date.

Every record also carries deterministic link lineage: `publisher`, original
`url`, tracking-parameter-free `canonical_url`, `source_url_kind`,
`link_required`, optional `source_reference`, and optional `derivation_note`.
News, filings, and primary-source records are blocked from publication when a
required original URL is absent. An operator-authorized broker excerpt without
a URL can remain in the private report, but the evidence posture is reduced to
`monitoring_only` and its internal reference is printed instead of a fake link.
Duplicate canonical URLs are counted and reported in the final bibliography.

### Event candidate pipeline: stages 1-3

The daily run now gathers link-only candidates from NewsAPI, configured
RSS/Atom feeds, and the GDELT DOC 2.0 API.  `candidate_pipeline.py` applies the
first deterministic quality gates before any model call:

1. normalize publisher URLs and remove tracking parameters;
2. collapse exact URL duplicates and near-identical titles published within
   the configured time window;
3. attach source tier, freshness, and keyword evidence to every news
   candidate;
4. discard only hard failures such as invalid URLs, blocked domains, stale
   records, and explicit exclusion matches;
5. retain ambiguous general-source items as `needs_local_classification` for
   the next local-model triage stage.

GDELT and ordinary publisher feeds remain discovery metadata (`source_grade:
D`). An RSS item is primary-confirmed only when its item URL matches an
explicitly configured official domain. Candidate filter counts and discarded
record IDs are preserved in the daily source-status artifact.

### Event candidate pipeline: stages 4-5

`triage_news_candidates.py` reads the normalized inbox and sends only a
candidate's title and bounded description to an optional local,
OpenAI-compatible endpoint. Configure it with:

```text
LOCAL_NEWS_CLASSIFIER_URL=http://127.0.0.1:11434/v1/chat/completions
LOCAL_NEWS_CLASSIFIER_MODEL=your-local-model
```

Only loopback endpoints are accepted. Without a configured local endpoint,
the daily GitHub-hosted run uses a conservative deterministic fallback:
primary/trusted or keyword-supported candidates are kept, while ambiguous
general-source metadata becomes `needs_more_text`. Those ambiguous records do
not enter the PB brief, but their IDs remain in `triage_audit.json`.

Kept candidates are clustered into events using publication time, title
similarity, entity overlap, and non-generic topic overlap. The report consumes
`workspace/triaged/YYYY-MM-DD/triaged_inbox.json`; the complete triage audit
and `event_clusters.json` remain workflow artifacts.

### Event candidate pipeline: stages 6-7

`official_source_registry.json` maps each event type to official origin
domains, official provider domains, and discovery landing pages.
`resolve_event_sources.py` first searches the already collected records for a
matching official source. An official provider record is kept distinct from
the origin agency. When no origin document matches, the output contains a
search plan and `missing_required_source`; it never fabricates a primary URL.

`prepare_event_evidence.py` selects at most two representatives per event:
prefer one matched origin document, then one strong explanatory publisher
record. Automated body extraction is limited to primary-confirmed HTML on an
allowlisted official domain. Redirects are rechecked. Publisher articles,
paywalled research, PDFs, and unapproved domains remain link/metadata only.
The bounded packets are written under
`workspace/event_evidence/YYYY-MM-DD/` for the next structured fact-extraction
stage.

### Event candidate pipeline: stage 8

`structure_event_evidence.py` assigns stable evidence IDs and uses one bounded
schema-constrained call for the highest-priority events. It stores verified
primary facts, unverified secondary reports, expectation gaps, interpretation
hypotheses, and conflicting evidence in separate fields. The model never
creates or returns URLs; code maps validated evidence IDs back to the source
ledger and rejects unknown IDs or secondary evidence presented as a verified
fact.

Daily and five-session ETF returns are attached only as same-session or
adjacent-close context. They are explicitly non-causal and are not presented
as announcement-window reactions. When an API key is unavailable, extraction
fails, or the workflow is a dry run, the stage keeps the evidence ledger but
emits empty fact arrays and an explicit fallback status instead of blocking
the report or inventing content. Output is written to
`workspace/event_evidence/YYYY-MM-DD/structured_event_evidence.json` and
embedded into the daily snapshot.

### Event candidate pipeline: stage 9

`synthesize_event_impacts.py` scores structured events deterministically,
selects at most three eligible events, and sends only those bounded records to
the high-capability synthesis model. The score separates market-impact
breadth, Korean-market relevance, expectation evidence, primary-source
confirmation, source quality, recency, and explicit penalties. Same-session
or adjacent-close returns receive zero price-reaction points because they are
not announcement-window measurements.

The synthesis maps each selected event through a transmission channel to a
validated sector ID and first affected financial line item. Sector links
remain research candidates unless the existing normalized record already has
an evidence-connected sector classification. With no supplied portfolio,
allowed postures are limited to `watchlist`, `wait_for_proof`, `pass`, and
`re_underwrite`. Unknown event, evidence, or sector IDs, unsupported
`verified change` claims, and priced-in conclusions based only on contextual
returns are rejected. Output is written to
`workspace/analysis/YYYY-MM-DD/event_impact_synthesis.json` and embedded in
the daily snapshot.

### Event candidate pipeline: stage 10

`compose_daily_brief.py` converts only the selected synthesis events into a
deterministic reader section under `해외 뉴스 > 핵심 사건 및 근거`. Verified
primary facts, unverified secondary reports, and transmission hypotheses stay
visibly separate. Every claim carries nearby source links, and every source
row shows its source grade, verification range, publication time, and stable
evidence ID.

The publication gate rejects a completed event when a cited evidence ID is
unknown, a reader URL or source label is missing, or a sector transmission
lacks its verification status. If synthesis was not run or failed, the daily
brief remains publishable but prints an explicit incomplete status and makes
no event conclusion. The same event sources are placed first in the final
source inventory and deduplicated against the general source list. Notion
renders each selected event as a numbered news callout rather than an
unsupported fourth-level heading.

Optional controls:

```text
OPENAI_EVENT_SYNTHESIS_MODEL=gpt-5
EVENT_SYNTHESIS_MAX_EVENTS=3
```

For an authorized broker report named `report.md`, `report.txt`, or
`report.pdf`, add a required `report.meta.json` rights sidecar. Copy
`examples/broker_report.meta.template.json` and confirm every rights field
before ingestion:

```json
{
  "publisher": "Example Securities",
  "title": "Semiconductor outlook",
  "source_url": "https://research.example.com/report/123",
  "published_at": "2026-07-20T01:00:00+00:00",
  "source_reference": "EXAMPLE-20260720-123",
  "acquisition_mode": "operator_authorized_local",
  "analysis_allowed": true,
  "redistribution_allowed": false,
  "publication_policy": "summary_and_link_only",
  "rights_review_status": "operator_confirmed",
  "rights_label": "Internal summary permitted; no redistribution",
  "tags": ["semiconductor"],
  "derivation_note": null
}
```

When a target price or another value is reverse-calculated rather than quoted
from the report, set `derivation_note` to the calculation basis. Never mark a
private report primary-confirmed merely because the operator supplied it.
Reports without the rights sidecar, reports marked for redistribution, and
unsupported files fail closed. Rejected filenames are not printed in Actions
logs.

- **FRED** (`FRED_API_KEY`): official U.S. macro time-series observations.
- **Alpaca Market Data** (`APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`): one
  multi-symbol historical-bars request supplies the required U.S. market
  breadth, style, and 11-sector ETF panel. Configure only an account-authorized
  feed and keep the derived data for permitted internal research.
- **Alpha Vantage** (`ALPHAVANTAGE_API_KEY`): API-delivered market/macro news
  metadata and summaries. The original publisher link stays with every item.
- **NewsAPI** (`NEWSAPI_KEY`): a compact set of current international business
  headlines for Korean title/summary translation. Use the publisher link; its
  provider ordering is not a literal article-view count.
- **OpenDART** (`OPENDART_API_KEY`): official Korean disclosure metadata from
  the Financial Supervisory Service. The daily brief selects at most eight
  recent high-signal disclosures and keeps the original DART filing link.
  Treat each record as metadata until the filing body has been reviewed.
- **SEC inbox**: converts the filings already fetched by `fetch_sec_filings.py`
  into the shared inbox. It carries metadata only; prepare the SEC source packet
  before any detailed interpretation.
- **Authorized report drop**: put a permitted `.md`, `.txt`, or `.pdf` report
  plus its rights sidecar in `workspace/incoming_reports/`. You can set
  `BROKER_REPORT_INBOX_DIR` to a private Google Drive Desktop-synced folder.
  The normalized inbox keeps only a bounded text extraction and rights
  metadata; the reader report receives an independent short summary, original
  publisher link or internal reference, and no source charts, tables, ratings,
  target prices, or verbatim report text.
  PDFs whose embedded font map yields no usable text automatically use bounded
  OCR. Windows uses the installed Korean Windows OCR language; GitHub Actions
  installs Korean Tesseract and Poppler. Control the fallback with
  `BROKER_REPORT_OCR_ENABLED`, `BROKER_REPORT_OCR_MAX_PAGES`,
  `BROKER_REPORT_OCR_DPI`, and `BROKER_REPORT_OCR_LANG`.
  GitHub Actions gives the two authorized-report collectors a bounded
  five-minute deadline for a cold OCR run. Only the rights-safe structured
  analysis cache is restored between Actions runs; the OCR text cache is not
  persisted or uploaded as an artifact. Cache restore/save failures are
  non-blocking, and content, model, prompt, or schema changes invalidate the
  relevant structured result automatically.
- **Private Google Drive research inbox**: optionally configure
  `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
  `GOOGLE_DRIVE_REFRESH_TOKEN`, and `GOOGLE_DRIVE_RESEARCH_FOLDER_ID`. The
  collector reads only that folder, pairs each report with
  `<report>.meta.json`, and skips cleanly when credentials are absent.
  To authorize without manually copying tokens, download a Google OAuth
  Desktop client JSON and run:

  ```powershell
  python authorize_google_drive.py `
    --client-secret-json C:\path\to\client_secret.json `
    --folder-id 1h7GhI-wAMZ-Vr9-Bcrcv4OFaipVnU-1-
  ```

  When an ignored `.env` already contains the restored Drive OAuth client id,
  client secret, and research folder id, rerun `python authorize_google_drive.py`
  without those arguments to issue only a fresh read-only refresh token.

  The helper opens a localhost callback, requests read-only Drive access,
  validates the configured folder, and updates the ignored `.env` without
  printing the client secret or refresh token.
- **Broker and portal websites**: `broker_research_sources.json` keeps Naver
  Finance and generic broker websites manual/link-only by default. Enable a
  specific official feed only after its automation and redistribution terms
  are recorded.
- **X**: keep the user's existing official API collector. Its output should be
  written into this same normalized schema; this PoC deliberately does not
  duplicate a personal X query or expose its credentials.

SEC remains a separate, already-tested collector because filings need their
own source-document review packet. The daily workflow combines its selected
filings with the normalized source inbox at the later AI-brief step.

## Sector research master

`sector_master.json` is the stable taxonomy for the sector-leadership layer.
It starts with 21 U.S./Korea research sectors and separates beneficiary paths
such as AI accelerators, data-center networking, power and cooling, grid
equipment, nuclear supply chains, batteries, defense, and shipbuilding. It is
a research classification layered on top of GICS, not a replacement for GICS.

Each sector has a stable `sector_id`, Korean and English labels, GICS anchors,
beneficiary pathways, ETF market proxies, representative companies, at least
three leading indicators, macro sensitivities, bilingual matching keywords,
and a minimum evidence contract. Representative companies are intentionally
marked `candidate_unverified`; the later classifier must prove revenue,
orders, backlog, margin, or estimate exposure before promoting a theme.

The top-level scoring weights are also fixed here: industry leading data 25%,
earnings revisions 25%, orders/CAPEX/backlog 15%, market confirmation 15%,
structural drivers 10%, and catalyst durability 10%. These definitions will
feed the later `sector_snapshot` and thesis-history stages without asking the
model to invent a scoring framework.

Validate the master without making any API request:

```powershell
python sector_master.py
```

Application code should use `load_sector_master()` rather than reading the
JSON directly. The loader rejects duplicate IDs, invalid tickers, incomplete
indicator metadata, fewer than two required independent sources, and scoring
weights that do not total 100.

`sector_classifier.py` connects the master to normalized evidence and ETF
market rows without an additional model call. Direct master ticker matches are
`high` confidence. Two or more matching theme terms are `medium`; a single
title or provider-tag match remains a `low` candidate and is excluded from the
accepted `sector_ids`. Every result keeps ticker and keyword match details plus
`needs_exposure_attribution` so a mention is not mistaken for proven revenue
or order exposure.

`collect_all.py` writes these fields into every normalized record. The daily
snapshot reclassifies older inboxes for backward compatibility, maps available
ETF rows, and emits `sector_evidence_connections`. That object contains source
and market connection counts only; it deliberately does not assign sector
scores or promote an investment idea. Scoring is the next pipeline stage.

`build_sector_snapshot.py` now materializes that next stage as
`workspace/snapshots/YYYY-MM-DD/sector_snapshot.json`. It creates all six
weighted dimensions from the master, but only scores a dimension when a
deterministic structured input exists. Available official operating proxies
can populate `industry_leading_data`, and sector ETF rows can produce a
benchmark-relative `market_confirmation_score`; news mentions, filing
metadata, and keyword matches cannot create industry, earnings, orders,
structural, or catalyst scores.

A composite `leadership_score` remains null unless at least 60% of dimension
weight is populated, industry-leading data, earnings revisions, and market
confirmation are all present, two independent sources are connected, and one
record is primary-confirmed. Until those gates pass, the snapshot uses states
such as `market_signal_only`, `evidence_connected_not_directional`, and
`no_current_signal`. A/B/C labels are research-priority buckets only and are
never generated from price momentum alone.

`sector_metric_registry.json` and `collect_sector_metrics.py` add the first
official operating-data layer for semiconductors, grid equipment, nuclear
generation, aerospace/defense, and shipbuilding. The registry fixes the FRED
series ID, source URL, frequency, units, geography, proxy scope, freshness
limit, and Korean limitation note before collection. Current inputs are the
Federal Reserve's seasonally adjusted monthly U.S. industrial-production
series; they are broad operating proxies, not company orders, backlog, CAPEX,
earnings revisions, or proof of Korean/global exposure.

The collector writes
`workspace/sector_metrics/YYYY-MM-DD/sector_metrics.json`, excludes
observations after the report date, marks stale series unscored, and preserves
the current-vintage revision warning. It calculates 1-, 3-, and 12-period
changes and a bounded directional monitoring score. The daily pipeline copies
these records into the snapshot and can populate only the 25%
`industry_leading_data` dimension. Even when an ETF price signal is also
present, the leadership score remains null until the independent earnings,
evidence-source, and overall coverage gates pass.

Run just this collector with the existing FRED secret:

```powershell
python collect_sector_metrics.py --date 2026-07-20
```

Missing `FRED_API_KEY` is nonfatal and produces an explicit empty status; it
never fabricates observations. GitHub Actions preserves the metric payload in
the 90-day evidence artifact.

`sector_fundamental_registry.json` and `collect_sector_fundamentals.py` add
the next two score inputs. For U.S. representative-company candidates, the
collector calls Alpha Vantage `EARNINGS_ESTIMATES`, retains the nearest future
fiscal quarter and year, and calculates a 30-day EPS consensus change plus
up/down revision breadth. The provider supports annual and quarterly EPS and
revenue estimates, analyst counts, and EPS revision history. Raw API keys and
query URLs are never written to the output.

An estimate is stored as `score_candidate` until the company's sector exposure
has a primary-source URL and exact body location in
`sector_fundamental_registry.json`. Two verified companies are required before
the 25% `earnings_revisions` dimension is available. This prevents a ticker's
presence in the representative-company list from silently becoming exposure
proof.

Orders, backlog, and CAPEX guidance use a stricter file-drop contract. Copy
`examples/sector_fundamental_input.template.json` into
`workspace/sector_fundamental_inputs/YYYY-MM-DD/`, replace every placeholder,
and retain the primary document URL, source date, page/table/section,
comparable current/prior periods, units, and separate exposure proof. Two
companies with distinct primary documents are required before the 15%
`orders_capex_backlog` dimension is available. DART/SEC metadata-only records
cannot pass this gate.

Run the bounded collector manually:

```powershell
python collect_sector_fundamentals.py --date 2026-07-20 --max-companies 2
```

The production pipeline omits `--max-companies`, uses the configured Alpha
Vantage request delay, writes
`workspace/sector_fundamentals/YYYY-MM-DD/sector_fundamentals.json`, and
preserves it in the GitHub Actions evidence artifact. Candidate estimates that
fail exposure verification remain visible as coverage gaps but cannot create a
sector rank.

The initial exposure registry now contains primary-source mappings for NVDA,
TSM, GEV, ETN, CCJ, CEG, LMT, RTX, HD Korea Shipbuilding & Offshore
Engineering, Samsung Heavy Industries, and Hanwha Ocean. U.S. mappings point
to the latest annual SEC filing and an exact business section; Korean
shipbuilding mappings point to company-owned product, overview, or brochure
pages. These mappings prove business exposure only. They do not prove that a
specific news item or contract is financially material.

The same registry includes four time-bounded, body-verified operating rows:
GE Vernova Electrification RPO, Eaton Electrical Americas backlog, Lockheed
Martin backlog, and RTX defense backlog, each with a comparable 2024 value.
They activate `orders_capex_backlog` for grid/electrification and
aerospace/defense because two companies and two primary documents are present.
Every row has `valid_until`; an expired annual observation is dropped rather
than silently carried forward.

`sector_driver_registry.json` and `collect_sector_drivers.py` complete the two
remaining score dimensions: `structural_driver` and `catalyst_durability`.
Only dated grade-A primary evidence is eligible: enacted law or programs, final
rules, official forecasts and roadmaps, or an official binding commitment.
Each item must include its transmission path, evidence horizon, and a concrete
invalidation condition. Evidence IDs are globally unique, so a policy or event
cannot be counted again under another score dimension. Structural-driver scores
require two independent primary-source owners; catalyst durability requires one
confirmed dated catalyst and reports lower confidence when only one exists.

```powershell
python collect_sector_drivers.py --date 2026-07-20
```

The output is stored at
`workspace/sector_drivers/YYYY-MM-DD/sector_drivers.json`, consumed by the daily
sector snapshot, and retained in the 90-day workflow evidence artifact. Missing,
expired, not-yet-effective, or unconfirmed records remain explicit coverage gaps.

`track_sector_theses.py` turns the daily sector snapshot into an append-only
thesis history at `workspace/history/sector_thesis_history.json`. Every sector
keeps a stable `thesis_id`, daily dimension state, evidence coverage, blockers,
and a deterministic transition. Same-input reruns are idempotent; changed
same-day inputs append a new revision and retain the superseded record.

The transition rules deliberately separate operating evidence from price:

- `thesis_strengthening` requires a material improvement or newly available
  non-market dimension.
- `market_confirmation_only` records a score increase driven only by market
  confirmation and cannot strengthen the company thesis.
- `score_lost` records failure of the composite evidence gate.
- `thesis_weakening` requires deterioration in industry, earnings, orders,
  structural-driver, or catalyst evidence.

All 5-point materiality thresholds are labeled
`draft_system_monitoring_rule`; they are monitoring defaults, not approved
portfolio rules. The daily review is written to
`workspace/history/sector_reviews/YYYY-MM-DD.json` and the report shows only
material changes plus the five highest scored research candidates. It remains
research prioritization because valuation, priced-in expectations, and
portfolio context are not present.

```powershell
python track_sector_theses.py --date 2026-07-20
```

`build_sector_leadership_radar.py` adds the persistence gate that turns the
append-only history into a research funnel. It reviews the latest revision for
each of the last five report dates and emits these stages:

- `insufficient_history`: fewer than three distinct report dates.
- `emerging_research_candidate`: a newly scored or strengthening thesis backed
  by at least three available non-market dimensions.
- `persistent_research_candidate`: at least five reports, 80% score readiness,
  median score of 70 or more, broad non-market evidence, and no recent adverse
  transition.
- `watchlist_needs_trigger` or `evidence_building`: useful signals that have not
  passed the persistence gate.
- `fading_reunderwrite`: lost score readiness or deteriorating non-market
  evidence.

Price-only changes cannot create an emerging candidate. Even persistent
candidates advance only to company exposure, valuation, and expectations
diligence; they are not labeled confirmed future leaders or recommendations.
The daily output is stored at
`workspace/history/sector_radar/YYYY-MM-DD.json` and is included in the report's
sector research funnel.

```powershell
python build_sector_leadership_radar.py --date 2026-07-20
```

`build_company_research_queue.py` maps the persistence-aware sector funnel to
listed-company diligence without turning representative-company lists into
recommendations. The bounded queue covers advanced, reunderwrite, and up to
five watchlist sectors, and applies these company gates in order:

1. The sector must advance through the persistence radar before a company can
   advance.
2. Company exposure must have a primary-source URL and exact body location.
3. At least one eligible company estimate-revision or verified operating signal
   must exist.
4. The resulting company remains `valuation_expectations_gated` until the
   bounded market-context collector runs; raw price and multiples still do not
   establish relative valuation or what is priced in.

Unverified companies remain `needs_exposure_attribution`, even when a provider
estimate exists. Verified companies without a financial signal remain
`verified_exposure_needs_financial_signal`. The queue stores actionability,
why-now, variant-wedge gap, first rejection, investability requirements, kill
condition, and next workflow for each candidate. Its output is written to
`workspace/company_research_queue/YYYY-MM-DD/company_research_queue.json`,
retained in the workflow artifact, and summarized in the report with at most
five company rows.

```powershell
python build_company_research_queue.py --date 2026-07-20
```

`collect_company_market_context.py` is the next evidence gate. It calls Alpha
Vantage `GLOBAL_QUOTE` and `OVERVIEW` for at most three US candidates already
at `valuation_expectations_gated`, retains the price as-of date and provider
documentation URL, and records raw market-cap and valuation fields. It never
classifies a company as cheap, expensive, fairly valued, or decision-grade
without peer or historical benchmarks and a complete expectations bar.

Missing API keys, an empty eligible queue, unsupported non-US candidates, and
provider failures are explicit nonfatal collection states. Liquidity,
ownership, positioning, factor exposure, full consensus, and company-guidance
comparison remain visible data gaps. Output is written to
`workspace/company_market_context/YYYY-MM-DD/company_market_context.json` and
retained in the workflow artifact.

```powershell
python collect_company_market_context.py --date 2026-07-20
```

`company_peer_registry.json`, `collect_company_peer_context.py`, and
`build_company_valuation_expectations.py` add a screening-only peer and
expectations gate. Peer membership is target-specific and keeps an explicit
role and rationale. Core and secondary peers can enter the screen; negative or
not-clean comps remain visible but cannot anchor the median. The collector
deduplicates peer tickers and makes at most four additional Alpha Vantage
`OVERVIEW` requests per report.

The production ceiling is 20 Alpha Vantage requests per report: up to 10
estimate calls, 6 target quote/overview calls, and 4 peer overview calls. This
stays below the provider's stated standard free allowance of 25 requests per
day. The 13-second cadence is preserved inside collectors and between the
separate provider stages.

A relative result requires the same positive multiple for the target and at
least two usable peers. The output may state only premium, discount, or near a
small watchlist-peer median. It cannot label the stock cheap, expensive, fairly
valued, priced-in, decision-grade, or assign a selected valuation range. The
first usable metric follows a fixed order beginning with forward P/E and
EV/EBITDA, and all peer selections remain analyst screening assumptions pending
primary business-model review.

The expectations bar carries the provider's nearest forward quarter/year EPS
and revenue estimates, analyst counts, 30-day EPS change, and revision breadth.
It is labeled `third_party_forward_estimate`, not consensus, until methodology
and estimate-set timing are verified. Company guidance comparison and
historical valuation bands remain explicit gaps. Outputs are stored under
`workspace/company_peer_context/` and
`workspace/company_valuation_expectations/` and retained in the evidence
artifact.

```powershell
python collect_company_peer_context.py --date 2026-07-20
python build_company_valuation_expectations.py --date 2026-07-20
```

`collect_company_primary_facts.py` adds the primary-company baseline. For up to
three screened U.S. companies it calls the official SEC Company Facts API once
per company and extracts only standard `us-gaap` or `ifrs-full` concepts for
revenue, operating income, net income, diluted EPS, operating cash flow, and
capital expenditures. Every value retains its original taxonomy tag, unit,
form, fiscal labels, exact period start/end, filing date, accession number, and
direct EDGAR filing-index URL. A duration fact is never silently relabeled as a
standalone quarter because a 10-Q can contain year-to-date values.

Company guidance uses a separate body-verification contract. Copy
`examples/company_guidance_input.template.json` into
`workspace/company_guidance_inputs/YYYY-MM-DD/` and replace every placeholder
with a company filing, earnings release, or IR presentation URL plus the exact
page/table/section. Guidance remains an issuer management claim. It is compared
with a third-party estimate only when fiscal period, metric, currency, and unit
match exactly; otherwise the mismatch remains explicit.

The output is written to
`workspace/company_primary_facts/YYYY-MM-DD/company_primary_facts.json`, added
to the deterministic source inventory and retained with any accepted guidance
input in the workflow artifact.
It is a reported baseline, not an adjusted model, valuation conclusion, or
recommendation.

```powershell
python collect_company_primary_facts.py --date 2026-07-20
```

`build_company_operating_bridge.py` normalizes the SEC baseline and verified
company operating evidence into an auditable long-form schedule. Each row keeps
its source ID, original and standard label, exact period, period type, source
and normalized values, currency, units, evidence label, confidence,
comparability status, and model treatment. CAPEX retains the reported positive
source value while the normalized cash-flow value uses a negative outflow sign.

The bridge automatically reuses body-verified orders/backlog/CAPEX records from
the sector-fundamental stage. Additional segment revenue, segment profit,
bookings, capacity, utilization, or company-defined KPI records use
`examples/company_operating_input.template.json`, copied to
`workspace/company_operating_inputs/YYYY-MM-DD/`. Every record requires an
exact primary-source body location, metric definition, comparable period and
unit, and separate exposure proof. Management-adjusted metrics additionally
require a body-verified reconciliation to the reported metric.

Outputs include a source index, normalized long-form rows, operating-evidence
summary, QA flags, and the validation checks actually performed. Missing
segment schedules and KPI definitions remain visible readiness gaps. Even a
verified company operating signal is labeled non-causal: it does not prove the
sector theme caused the result. The package remains audit-only rather than a
complete model schedule or recommendation.

```powershell
python build_company_operating_bridge.py --date 2026-07-20
```

`build_company_tearsheets.py` combines the advanced company queue, current
market context, bounded peer/expectations screen, SEC reported baseline, and
the operating bridge into a compact cited issuer profile. Only companies that
passed `valuation_expectations_gated` are included, with a maximum of four per
daily report.

Each profile contains verified identity and business exposure, price and
freshness, up to five source-backed metrics, up to three operating or earnings
drivers, a bounded `Valuation Context`, a proof trigger, a falsifier, material
evidence gaps, and a deduplicated source index. Missing liquidity, ownership,
positioning, historical valuation, contributor-verified consensus, guidance,
or segment schedules remain explicit rather than being inferred.

The validator rejects future-dated prices, metrics without period/unit/source,
decision-grade escalation, recommendations, selected valuation ranges, and any
claim that the small peer screen establishes fair value or what is priced in.
The output remains a screen-grade public-company baseline for the daily brief,
not an initiation report or investment recommendation.

```powershell
python build_company_tearsheets.py --date 2026-07-20
```

`build_company_earnings_driver_review.py` turns each bounded tearsheet into an
earnings-driver monitoring packet. It keeps provider forward estimates,
body-verified company guidance, last reported SEC baselines, and company KPIs
in separate evidence lanes. Every estimate carries a freeze date, period,
units, basis label, and provider source; guidance remains an issuer claim and
is compared with an estimate only when period and units match exactly.

The packet adds up to three operating proof points with a confirmation
condition, falsifier, and listen-for question. If EPS is present but the
provider basis is not verified, GAAP/non-GAAP, tax, share-count, and
below-the-line risks remain visible as an EPS-quality warning.

The current pipeline does not yet collect a primary-source earnings event
date, event-isolating options tenor, full contributor-methodology consensus,
or current positioning. Therefore this stage deliberately remains
`earnings_driver_monitoring_not_pre_event_preview`: it cannot create an
earnings date, implied move, bull/base/bear reaction cases, or position action.
The next gate is to verify those inputs before graduating a company into a
real pre-event preview.

```powershell
python build_company_earnings_driver_review.py --date 2026-07-20
```

`collect_company_earnings_events.py` adds the event-date gate required to
graduate a monitoring review into a pre-event input pack. It makes one global
Alpha Vantage `EARNINGS_CALENDAR` request for the next three months and keeps
matching rows as `expected` soft dates only. A provider date never becomes a
confirmed earnings date by itself.

Exact dates are unlocked only by a body-verified company IR calendar,
company earnings release, or company event page. Copy
`examples/company_earnings_event_input.template.json` to
`workspace/company_earnings_event_inputs/YYYY-MM-DD/` and replace every field
with the primary source URL, source date, exact body location, event date,
reported period, and market timing. If the provider date conflicts with the
company date, the company source controls and the discrepancy remains in the
conflict log. Same-vintage conflicting primary dates block selection.

Confirmed records promote the matching driver review only to
`pre_event_preview_ready_input_pack`. Missing reaction, options, positioning,
or estimate-methodology evidence remains visible, so this gate still cannot
generate an implied move, reaction forecast, position action, or trade-ready
preview.

```powershell
python collect_company_earnings_events.py --date 2026-07-20
python build_company_earnings_driver_review.py --date 2026-07-20
```

`collect_company_earnings_reaction_context.py` adds a bounded reaction hurdle
for at most two prioritized companies. For each company it uses one Alpha
Vantage `EARNINGS` request and one free `TIME_SERIES_DAILY compact` request,
keeping the full daily pipeline at its 25-request ceiling. Because the earnings
history lacks a verified report time, the calculated return runs from the
close before the reported date to the first trading close after it. This broad
raw-price window is context only and is never labeled an isolated one-day
earnings reaction or a directional forecast.

Realtime option chains are not called automatically because the documented
Alpha Vantage endpoint requires a high-tier subscription. A licensed provider,
broker, or exchange export can be supplied by copying
`examples/company_option_input.template.json` to
`workspace/company_option_inputs/YYYY-MM-DD/`. The record requires an as-of,
event date, expiry, spot, ATM call/put mids, provider reference, and confirmed
usage rights.

The ATM straddle is treated as an `event_hurdle_candidate_not_forecast` only
when the snapshot is within five calendar days before the confirmed event and
expiry is within three days after it. Wider expiries remain
`expiry_tenor_volatility_context` because they contain substantial non-event
time. Neither historical reactions nor the option hurdle can generate a
directional call, bull/base/bear cases, or a position action.

```powershell
python collect_company_earnings_reaction_context.py --date 2026-07-20
python build_company_earnings_driver_review.py --date 2026-07-20
```

`build_company_earnings_scenarios.py` converts a fully verified pre-event input
pack into a three-row thesis-trigger table. The gate opens only when the
earnings date is confirmed by a body-verified primary company source, a
company guidance range and third-party estimate share the exact period and
units, and at least one comparable company KPI is available.

The three cases are evidence classifications: above the verified guidance
high, inside the verified range, or below the verified guidance low. They
change research posture only after the reported result and KPI quality are
checked. The stage does not assign probabilities, forecast stock direction,
calculate expected return or price targets, or issue position actions.
Historical and option reaction context remains a nondirectional hurdle. A
company that passes the gate still ends at `wait_for_proof`, followed by an
earnings deep dive and thesis-tracker update after results are source-verified.

```powershell
python build_company_earnings_scenarios.py --date 2026-07-20
```

`track_company_theses.py` stores those evidence cases as an append-only company
thesis baseline under `workspace/history/company_thesis_history.json`. Same-day
reruns are idempotent; changed inputs create a new revision instead of
overwriting the prior record. The daily compact review is written to
`workspace/history/company_thesis_reviews/YYYY-MM-DD.json`.

This pre-event tracker separates `company_thesis_status`,
`security_thesis_readiness`, and `position_action`. Opening the evidence gate
does not strengthen a thesis: until source-verified post-earnings actuals and
KPI quality are reviewed, every company remains `untested`,
`not_decision_grade`, and `wait_for_proof`. All generated thresholds remain
`Draft threshold for PM confirmation` and cannot authorize a position action.
The history also records the next review gate, evidence blockers, review
cadence, and a minimal operating model without manufacturing owners or scores.

```powershell
python track_company_theses.py --date 2026-07-20
```

`collect_company_earnings_results.py` prepares the source-verified input pack
for the later post-earnings deep dive. Copy
`examples/company_earnings_result_input.template.json` to
`workspace/company_earnings_result_inputs/YYYY-MM-DD/` and replace every
placeholder with facts from a company earnings release, filed SEC document or
exhibit, company presentation, or prepared remarks.

Each reported metric and operating KPI requires its own period, units,
accounting basis, exact body location, source date, and primary HTTPS URL.
Non-GAAP rows require the closest GAAP comparable and a body-verified
reconciliation. Every company also receives an EPS-quality screen and an
explicit transcript availability status.

The pack becomes `ready_for_post_earnings_deep_dive` only when the confirmed
event fiscal-period end matches the frozen pre-event guidance/estimate period,
the reported metric matches that period and unit exactly, and at least one
tracked operating KPI remains comparable. On later report dates, the script
retrieves the frozen pre-event rules from append-only
`company_thesis_history.json`; it never rebuilds the old hurdle using refreshed
post-result estimates. The pack still cannot update the thesis, model,
valuation, or position action by itself.

```powershell
python collect_company_earnings_results.py --date 2026-07-20
```

`build_company_earnings_deep_dive.py` turns a ready input pack into a bounded
post-earnings research review. It separates the exact headline result from
comparable operating KPIs, EPS-quality adjustments, issuer guidance,
transcript availability, a model-update packet, and price/valuation screening
context. Every result, pre-event hurdle, KPI, guidance row, EPS bridge item,
and displayed market price retains source lineage and an as-of date.

The output is written to
`workspace/company_earnings_deep_dive/YYYY-MM-DD/company_earnings_deep_dive.json`.
Its `research_case_signal` can be strengthening, within range, mixed, or
weakening evidence, but this is not a formal thesis decision. Without the
approved original underwriting, refreshed estimates, audited model/valuation,
and portfolio context, the tracker deliberately preserves `untested`,
`not_decision_grade`, and `wait_for_proof`.

```powershell
python build_company_earnings_deep_dive.py --date 2026-07-20
```

`collect_company_underwriting.py` loads versioned original-underwriting records
from the tracked `company_underwriting_registry.json` file and optional local
files under `workspace/company_underwriting_inputs/`. Start from
`examples/company_underwriting_input.template.json`, then append each reviewed
version to the root registry so GitHub Actions can read it. The record preserves the
one-sentence thesis, variant perception, market setup, valuation anchor,
falsifiable core and secondary pillars, evidence bindings, catalysts, open
diligence, and exact kill criteria.

Drafts remain `draft_pending_user_approval`. A formal thesis update is unlocked
only when the file is explicitly changed to `approved_by_user_or_pm` and
contains an approver plus approval timestamp. Kill criteria in an approved
record remain `Inherited threshold` and `Approved monitoring rule`; the daily
pipeline does not manufacture or silently approve new rules.

```powershell
python collect_company_underwriting.py --date 2026-07-20
```

`build_company_underwriting_drafts.py` reduces the manual blank-page work. It
uses the current company tearsheet, source-backed earnings drivers, and the
conditional earnings trigger table to propose a one-sentence company case,
core pillars, KPI bindings, and draft break conditions. The result is written
to `workspace/company_underwriting_drafts/YYYY-MM-DD/` and is also available to
the daily report as an approval-review queue.

The generator never invents a variant perception, valuation anchor, expected
return, score, or position action. All proposed break conditions remain
`Draft threshold for PM confirmation` and `draft_pending_user_approval`.
Existing approved underwriting is never overwritten, and generated drafts are
not appended automatically to `company_underwriting_registry.json`.

```powershell
python build_company_underwriting_drafts.py --date 2026-07-20
```

`approve_company_underwriting_draft.py` is the explicit human approval gate.
It approves only the exact generated draft identified by `draft_hash`, requires
an approver, an approval note, substantive replacement of the generated thesis,
variant-perception placeholder, and horizon, plus the exact confirmation phrase
`APPROVE_ORIGINAL_UNDERWRITING`. The command appends a new version atomically to
`company_underwriting_registry.json`; it never overwrites an existing
ticker/version and is intentionally not part of the daily workflow.

Review the draft JSON first, copy its `draft_hash`, and preview the approved
record without writing anything:

```powershell
python approve_company_underwriting_draft.py `
  --date 2026-07-20 `
  --ticker GEV `
  --approved-by "portfolio_manager" `
  --approval-note "Reviewed thesis, pillars, sources, and break conditions." `
  --expected-draft-hash "<draft_hash>" `
  --one-sentence-thesis "<reviewed company thesis>" `
  --variant-perception "<reviewed variant perception or explicit no-mispricing conclusion>" `
  --horizon "12-24 months" `
  --dry-run
```

After checking the preview, rerun without `--dry-run` and add:

```powershell
--confirm-approval APPROVE_ORIGINAL_UNDERWRITING
```

An approval receipt is retained under
`workspace/company_underwriting_approvals/YYYY-MM-DD/`. Approval changes only
the monitored company thesis. It does not approve a security thesis, valuation,
expected return, or position action.

The published Notion brief also receives a deterministic
`언더라이팅 승인 검토` section immediately before `다음 확인 항목`. It is built
directly from the draft JSON rather than model prose and shows the exact hash,
proposed company thesis, pillars, break conditions, source lineage, remaining
diligence, and the fields required for approval. Each company is a compact
purple review card with auditable detail underneath. Viewing the card never
executes approval; the explicit CLI/Codex approval gate above remains required.

`build_company_thesis_review_calendar.py` activates only for companies with an
explicitly approved original underwriting. It separates body-verified company
IR hard dates, provider expected soft-date candidates, and thesis-critical but
undated pillar proof points. Confirmed events receive stable review IDs, source
lineage, the pillars being tested, pre-event evidence preparation, and the
post-event handoff into results collection, earnings deep dive, and formal
thesis update. Provider dates never become exact review dates.

The builder deliberately leaves analyst/evidence/KPI/model owners, preparation
lead time, review cadence, and post-event update SLA blank until a user or PM
supplies them. Its output is written to
`workspace/company_thesis_review_calendar/YYYY-MM-DD/`, retained in the
workflow evidence artifact, and rendered as orange cards under
`회사 논리 검토 캘린더` in the Notion report.

```powershell
python build_company_thesis_review_calendar.py --date 2026-07-20
```

The calendar can schedule a company-thesis review only. It cannot alter the
approved underwriting, infer a valuation or expected return, or authorize a
buy, sell, sizing, or hedge action.

`company_review_operating_registry.json` is the append-only operating-policy
registry for that calendar. Copy
`examples/company_review_operating_input.template.json`, replace every owner,
then explicitly approve and append the record. Each version fixes the decision
authority, PM, analyst, evidence, KPI, model and decision-log owners; review
cadence; preparation lead time and its day basis; post-event update SLA; and
process escalation triggers.

`collect_company_review_operating_config.py` never selects drafts; the review
queue owns their completion state. For purported approvals it rejects placeholders,
future approvals, duplicate ticker/version pairs, unsupported timing rules,
missing internal source lineage, and any configuration that permits automatic
position action. It selects the latest approved version without deleting prior
versions and writes the daily selection to
`workspace/company_review_operating_config/YYYY-MM-DD/`.

`approve_company_review_operating_config.py` is the explicit approval gate for
this registry and is intentionally excluded from the daily workflow. It hashes
the reviewed identity, owners, cadence, preparation rule, SLA, escalation
triggers, and automatic-action prohibition. Actual approval requires that same
hash, an approver and note, and the exact phrase
`APPROVE_COMPANY_REVIEW_OPERATIONS`. Existing ticker/version records cannot be
overwritten, and each new record must use the next sequential version.

After copying and reviewing the template, print the immutable review hash:

```powershell
python approve_company_review_operating_config.py `
  --date 2026-07-21 `
  --reviewed-config-file "workspace/company_review_operating_inputs/GEV_v1.json" `
  --show-review-hash
```

Preview the exact approved record without writing the registry:

```powershell
python approve_company_review_operating_config.py `
  --date 2026-07-21 `
  --reviewed-config-file "workspace/company_review_operating_inputs/GEV_v1.json" `
  --approved-by "portfolio_manager" `
  --approval-note "Reviewed owners, cadence, preparation timing, SLA, and escalation triggers." `
  --expected-review-hash "<review_hash>" `
  --dry-run
```

To append it after checking the preview, rerun without `--dry-run` and add:

```powershell
--confirm-approval APPROVE_COMPANY_REVIEW_OPERATIONS
```

The tool writes a separate receipt under
`workspace/company_review_operating_approvals/YYYY-MM-DD/`. This approval
authorizes only the thesis-review workflow. It never approves a security
thesis, valuation, expected return, or position action.

`build_company_review_operating_review_queue.py` scans the reviewed input
folder on every daily run and creates a deterministic approval queue under
`workspace/company_review_operating_review_queue/YYYY-MM-DD/`. A complete next
version receives an immutable review hash. Placeholders, duplicate files,
version collisions, skipped versions, invalid timing rules, and automatic
position authority remain visibly blocked. An input whose exact hash is
already approved is not queued again.

The Notion brief renders this artifact as blue gear cards under
`운영 설정 승인 검토`. Each card shows the owners, cadence, next internal review,
preparation lead time, post-event SLA, escalation triggers, exact hash, and
required confirmation phrase. The card is read-only: report publication never
runs the approval command or changes the registry.

`generate_company_review_operating_drafts.py` removes the blank-page step for
companies that already have explicitly approved original underwriting but no
operating configuration. It creates the next version with owner placeholders,
an event-driven cadence, a five-calendar-day preparation proposal, a 24-hour
post-result SLA proposal, and standard process-escalation triggers. A
body-verified company event date may populate the proposed next review date;
provider expected dates are never promoted.

All generated values remain `draft_pending_user_or_pm_approval`. The daily
workflow materializes a missing per-company file under
`workspace/company_review_operating_inputs/` without overwriting any existing
file and retains the generation manifest under
`workspace/company_review_operating_drafts/YYYY-MM-DD/`. Until every owner
placeholder is replaced, the Notion gear card shows `운영 설정 입력 필요` and no
review hash. Once completed, the next run validates the policy and displays the
immutable approval hash.

```powershell
python generate_company_review_operating_drafts.py `
  --date 2026-07-21 `
  --materialize-inputs
```

Configured companies are skipped by default. Creating a proposed next version
requires the explicit `--include-configured` option. Generated drafts never
approve a company thesis, security thesis, valuation, expected return, or
position action.

`monitor_company_review_operations.py` observes only reviews backed by an
approved operating configuration and confirmed hard-date calendar entry. It
stores first-seen milestones append-only in
`workspace/history/company_review_operations_history.json`: pre-event trigger
pack availability, verified primary-result availability, and formal company
thesis update availability. Same-input reruns are idempotent.

Preparation is labeled scheduled, due today, overdue/unconfirmed, completed on
time, or completed late against the approved preparation deadline. The
post-event SLA clock starts only when body-verified primary results are first
observed; a news headline, provider expected date, or event date alone cannot
start it. The monitor also surfaces confirmed date changes, approved kill-rule
matches, and missing required primary evidence after an event.

The daily output is retained under
`workspace/company_review_operations_monitor/YYYY-MM-DD/` and rendered in
Notion as yellow timer cards under `운영 알림 모니터`. It creates report-internal
attention or critical-review states only. It does not send an external message,
change company-thesis evidence, promote security readiness, or execute any
position action.

```powershell
python monitor_company_review_operations.py --date 2026-07-21
```

### 승인 기반 기업 검토 경고 전달

`dispatch_company_review_alerts.py`는 `운영 알림 모니터`의
`critical_review_required` 레코드 가운데 승인 정책에 명시된 사유만 텔레그램
후보로 만듭니다. 기본 레지스트리
`company_review_alert_delivery_policy_registry.json`은 비어 있으므로 새 설치에서는
외부 메시지를 보내지 않습니다. 정책이 승인돼 있어도 GitHub Secret
`COMPANY_REVIEW_ALERTS_ENABLED=true`가 별도로 설정돼야 실제 발송이 가능합니다.

동일 경고는 검토 ID, 이벤트 날짜, 경고 단계, 사유, 준비 상태와 SLA 상태를
묶은 안정적인 `alert_key`로 식별합니다. 성공 발송 이력은
`workspace/history/company_review_alert_delivery_history.json`에 append-only로 남고,
같은 키는 다시 보내지 않습니다. 사용자가 확인한 키는
`company_review_alert_acknowledgement_registry.json`에 명시적인 확인자, 시각, 메모와
함께 기록하면 발송 후보에서 제외됩니다. 이 전달기는 운영 검토 요청만 보내며
매수·매도·비중 변경 권한을 갖지 않습니다.

```powershell
python dispatch_company_review_alerts.py --date 2026-07-21 --dry-run
```

정책과 확인 레코드의 입력 예시는 각각
`examples/company_review_alert_delivery_policy.template.json`,
`examples/company_review_alert_acknowledgement.template.json`에 있습니다. 일일 리포트의
`운영 알림 모니터`에는 승인 정책, 활성 스위치, 후보·발송·실패·차단 건수가
결정론적으로 표시됩니다.

정책은 승인 필드를 직접 편집하지 않고 검토 해시와 확인 문구를 거쳐 append-only로
등록합니다. 먼저 템플릿을 복사해 정책 내용을 검토한 뒤 해시를 확인하고, 동일한
파일과 해시로 승인합니다. 실제 승인을 해도 활성 Secret은 자동으로 켜지지 않습니다.

```powershell
python approve_company_review_alert_delivery_policy.py --date 2026-07-21 --reviewed-policy-file reviewed_alert_policy.json --show-review-hash
python approve_company_review_alert_delivery_policy.py --date 2026-07-21 --reviewed-policy-file reviewed_alert_policy.json --approved-by "pm_owner" --approval-note "심각 운영 경고만 승인" --expected-review-hash "검토해시" --confirm-approval APPROVE_COMPANY_REVIEW_ALERT_DELIVERY
```

경고 확인도 동일하게 현재 일일 계획에서 후보와 해시를 먼저 확인한 뒤에만 기록합니다.
확인은 경고를 검토·인계했다는 운영 기록일 뿐, 회사 논리·종목 판단·포지션 행동을
바꾸지 않습니다.

```powershell
python acknowledge_company_review_alert.py --date 2026-07-21 --list-eligible
python acknowledge_company_review_alert.py --date 2026-07-21 --alert-key "경고키" --show-review-hash
python acknowledge_company_review_alert.py --date 2026-07-21 --alert-key "경고키" --acknowledged-by "pm_owner" --note "후속 담당자 지정" --expected-review-hash "검토해시" --confirm-acknowledgement ACKNOWLEDGE_COMPANY_REVIEW_ALERT
```

확인된 경고는 담당자·마감 시각·완료 기준 없이 종료되지 않도록 후속조치를 별도로
배정합니다. 배정되지 않은 확인 경고는 `확인 필요`, 기한을 넘긴 배정은 `즉시 검토 필요`
로 일일 리포트의 `경고 후속조치 모니터`에 다시 표시됩니다. 이 모니터는 내부 운영
추적만 하며 외부 재알림이나 자동 투자 행동을 하지 않습니다.

```powershell
python assign_company_review_alert_followup.py --date 2026-07-21 --list-acknowledged
python assign_company_review_alert_followup.py --date 2026-07-21 --alert-key "경고키" --show-acknowledgement-hash
python assign_company_review_alert_followup.py --date 2026-07-21 --alert-key "경고키" --assigned-by "pm_owner" --owner "research_analyst" --due-at "2026-07-22T09:00:00+09:00" --completion-criteria "1차 자료 검토 후 공식 회사 논리 업데이트 기록" --expected-acknowledgement-hash "확인해시" --confirm-assignment ASSIGN_COMPANY_REVIEW_ALERT_FOLLOWUP
```

후속조치는 완료 근거를 남기기 전까지 닫히지 않습니다. 완료 시에는 배정 당시의 해시,
완료자·시각·결과, 최소 한 건의 근거 참조를 함께 기록합니다. 종결은 단지 운영 작업의
완료를 뜻하며, 회사 논리·밸류에이션·포지션 판단을 자동으로 변경하지 않습니다.

```powershell
python complete_company_review_alert_followup.py --date 2026-07-21 --list-open
python complete_company_review_alert_followup.py --date 2026-07-21 --alert-key "경고키" --show-followup-hash
python complete_company_review_alert_followup.py --date 2026-07-21 --alert-key "경고키" --completed-by "research_analyst" --completion-outcome evidence_review_completed --evidence-summary "1차 자료를 검토하고 운영 메모를 기록함" --evidence-reference-file examples/company_review_alert_completion_evidence.template.json --expected-followup-hash "후속조치해시" --confirm-completion COMPLETE_COMPANY_REVIEW_ALERT_FOLLOWUP
```

완료 근거 파일 형식은
`examples/company_review_alert_completion_evidence.template.json`을 참고하면 됩니다.

일일 실행은 최근 7일의 확인·배정·종결 흐름과 현재 미배정·기한 경과 백로그를
`주간 운영 SLA 요약`에 표시합니다. 종결 표본이 3건 미만이면 SLA 비율과 중앙 소요
시간은 표시하지 않습니다. 숫자가 적은 초기 운영 기간을 성과로 오해하지 않기 위해서입니다.

```powershell
python build_company_review_alert_sla_summary.py --date 2026-07-21
```

기본 산출물은
`workspace/company_review_alert_sla_summary/YYYY-MM-DD/company_review_alert_weekly_sla_summary.json`이며,
GitHub Actions 증거 아티팩트에도 포함됩니다. 이 요약은 운영 처리 속도만 다루며
회사 논리·종목 판단·포지션 행동을 평가하거나 변경하지 않습니다.

`운영 담당자 큐`는 현재 미완료 건만 담당자별로 보여줍니다. 우선순위는 기한 경과,
후속조치 미배정, 정상 진행 중 순서이며, 원인은 승인된 운영 상태에서 결정론적으로
가져옵니다. 종결된 건은 큐에서 제외하고 SLA 요약에만 남깁니다.

```powershell
python build_company_review_alert_owner_queue.py --date 2026-07-21
```

기본 산출물은
`workspace/company_review_alert_owner_queue/YYYY-MM-DD/company_review_alert_owner_queue.json`입니다.
담당자별 필터·자동 리마인더·포지션 행동은 이 큐의 범위가 아니며, 별도 승인 단계가
필요합니다.

`롤링 SLA 추이`는 매일의 최근 7일 SLA 스냅샷을 append-only로 보관합니다. 같은 날짜에
동일한 내용으로 다시 실행하면 중복하지 않고, 내용이 달라진 경우에만 revision을 추가합니다.
리포트에는 최근 최대 8개 점과 미배정·기한 경과의 직전 스냅샷 대비 변화만 표시합니다.
각 점의 기간이 겹치므로 독립적인 주간 성과 비교에는 사용하지 않습니다.

```powershell
python track_company_review_alert_sla_history.py --date 2026-07-21
```

이력은 `workspace/history/company_review_alert_sla_history.json`, 당일 추이 뷰는
`workspace/company_review_alert_sla_trend/YYYY-MM-DD/company_review_alert_sla_trend.json`에 저장됩니다.

종결 근거 상태 점검은 완료 기록의 참조가 아직 해석 가능한지 확인합니다. 로컬 경로는
존재 여부를 확인하고, 외부 HTTP(S) URL은 네트워크 요청 없이 `외부 확인 대기`로만
표시합니다. 사용자가 URL을 직접 검토했다면, 대상 참조 해시와 확인 문구를 통해
append-only 수동 확인 기록을 남길 수 있습니다. 수동 확인은 운영 근거 상태만 표시하며
이 점검은 종결 상태를 되돌리거나 회사 논리·포지션 행동을 바꾸지 않습니다.

```powershell
python validate_company_review_alert_completion_evidence.py --date 2026-07-21
```

기본 산출물은
`workspace/company_review_alert_completion_evidence_integrity/YYYY-MM-DD/company_review_alert_completion_evidence_integrity.json`입니다.

외부 근거를 수동 확인하려면 우선 대상과 해시를 확인한 뒤, 실제로 해당 URL을 검토한
사용자 또는 PM만 아래 명령을 실행합니다. 자동 URL 접속·크롤링은 수행하지 않습니다.

```powershell
python verify_company_review_alert_completion_evidence.py --date 2026-07-21 --list-external
python verify_company_review_alert_completion_evidence.py --date 2026-07-21 --completion-id "completion:경고키" --evidence-id "official-url-001" --show-evidence-hash
python verify_company_review_alert_completion_evidence.py --date 2026-07-21 --completion-id "completion:경고키" --evidence-id "official-url-001" --verified-by "pm_name" --verification-note "원문 URL과 완료 근거의 연결을 직접 검토함" --expected-evidence-hash "근거해시" --confirm-verification VERIFY_COMPANY_REVIEW_ALERT_EXTERNAL_EVIDENCE
```

형식과 확인 범위는
`examples/company_review_alert_completion_evidence_verification.template.json`을 참고하면 됩니다.
기록 및 영수증은 각각
`company_review_alert_completion_evidence_verification_registry.json`과
`workspace/company_review_alert_completion_evidence_verifications/YYYY-MM-DD/`에 저장됩니다.

수동 확인 대기 외부 근거는 일별 스냅샷을 append-only로 보관하고, 최초 대기일 기준으로
경과 일수를 계산해 주간 검토 큐를 만듭니다. 3일 이상은 `high`, 기본 7일 이상은
`critical / weekly_manual_review_due`로 표시하지만, 담당자를 추정·배정하거나 자동 재알림,
URL 접속, 투자 행동을 수행하지 않습니다.

```powershell
python build_company_review_alert_external_evidence_backlog.py --date 2026-07-21
```

이력은 `workspace/history/company_review_alert_external_evidence_backlog_history.json`,
당일 큐는
`workspace/company_review_alert_external_evidence_backlog/YYYY-MM-DD/company_review_alert_external_evidence_backlog.json`에 저장됩니다.

대기 항목의 검토 우선순위만 조정해야 할 때는, 현재 큐의 해시를 확인하고 사용자 또는 PM이
보류 재검토일·대체 근거 요청·더 이상 유효하지 않음 중 하나를 append-only로 기록합니다.
`더 이상 유효하지 않음`은 운영 큐에서만 제외하며 종결 근거의 원래 검증 상태나 투자 판단은 바꾸지 않습니다.

```powershell
python review_company_review_alert_external_evidence_backlog.py --date 2026-07-21 --list-open
python review_company_review_alert_external_evidence_backlog.py --date 2026-07-21 --item-key "항목키" --show-backlog-hash
python review_company_review_alert_external_evidence_backlog.py --date 2026-07-21 --item-key "항목키" --reviewed-by "pm_name" --decision deferred_pending_recheck --deferred-until 2026-07-28 --note "후속 공시 확인 후 재검토" --expected-backlog-hash "항목해시" --confirm-review REVIEW_COMPANY_REVIEW_ALERT_EXTERNAL_EVIDENCE_BACKLOG
```

기록은 `company_review_alert_external_evidence_backlog_review_registry.json`, 영수증은
`workspace/company_review_alert_external_evidence_backlog_reviews/YYYY-MM-DD/`에 저장됩니다.

주간 외부 근거 검토 모니터는 활성 대기, 주간 검토 미처리, 보류, 대체 근거 요청과 최근
7일의 사람 검토 기록을 분리합니다. 이는 운영량 요약일 뿐 URL 접속, 알림 발송, 회사 논리
또는 포지션 행동을 바꾸지 않습니다.

```powershell
python build_company_review_alert_external_evidence_review_summary.py --date 2026-07-21
```

산출물은
`workspace/company_review_alert_external_evidence_review_summary/YYYY-MM-DD/company_review_alert_external_evidence_review_summary.json`입니다.

외부 근거 운영 감사는 근거 무결성·백로그·수동 검토·주간 요약이 서로 일치하는지 교차
확인합니다. 이전 URL에 묶인 검토 결정처럼 현재 항목에 더 이상 연결되지 않는 기록은
`attention_manual_review_refresh_required`로 표시할 뿐, 자동 수정·알림·투자 행동은 하지 않습니다.

```powershell
python audit_company_review_alert_external_evidence_operation.py --date 2026-07-21
```

산출물은
`workspace/company_review_alert_external_evidence_operation_audit/YYYY-MM-DD/company_review_alert_external_evidence_operation_audit.json`입니다.

```powershell
python collect_company_review_operating_config.py --date 2026-07-21
python build_company_thesis_review_calendar.py --date 2026-07-21
```

When an approved configuration exists, the calendar derives the preparation
due date from the confirmed event date and approved lead-time basis, displays
the named owner, and carries the approved SLA as a rule beginning only when
verified primary results become available. Without an approved configuration,
all ownership and timing fields remain visibly unassigned.

`build_company_thesis_update.py` maps source-verified post-earnings evidence to
those approved pillars and kill criteria. Exact selector matching supports the
headline result, named comparable operating KPIs, EPS-quality status, guidance
availability, and transcript availability. Unmapped or missing evidence stays
`untested` rather than being inferred.

The resulting company status can be `strengthening`, `intact`, `watch`,
`impaired`, `broken`, or `untested`. This changes the company thesis only. The
security remains `not_decision_grade` and `wait_for_proof` until refreshed
estimates, an audited model and valuation/downside framework, plus portfolio
and benchmark context are supplied. Even an approved kill-criterion hit cannot
create an automatic sell or exit instruction.

```powershell
python build_company_thesis_update.py --date 2026-07-20
```

## Configure and test the new adapters

1. Copy the new blank variables from `.env.example` into your existing `.env`.
   Leave a provider key blank until that provider account is ready.
2. Adjust watchlist, macro series, and news topics in `sources.json`.
3. Confirm configuration without any API request:

```powershell
python collect_all.py --dry-run
```

4. After adding at least one provider key, collect the enabled sources:

```powershell
python collect_all.py
```

Missing provider keys are reported as `SKIPPED`; they do not break the run.
Run this manually first.

The default OpenDART window is three Korea-time calendar days so a Monday run
can still see weekend filings. Configure `opendart.max_items` and
`opendart.disclosure_types` in `sources.json`; do not put the API key there.

The filing adapters now attempt a bounded body review for only the highest
priority records. `opendart.max_body_fetches` and
`sec_filings.max_body_fetches` default to three, while `max_body_chars` limits
the evidence passed downstream. OpenDART's official document ZIP and SEC's
primary filing HTML are accepted only from their official endpoints. A
successful extraction upgrades the record to `evidence_scope:
filing_body_excerpt`; it never claims a complete filing review. A blocked,
missing, oversized, malformed, or unselected body remains
`filing_metadata_only`, so report generation must not infer transaction terms
from the title. `SEC_USER_AGENT` must continue to identify the operator with a
real contact email, and secret values are never written to an artifact.

For an SEC 8-K, the extractor also follows at most two official-domain Exhibit
99 links and records their URL, label, extraction status, and bounded text
length. `filing_facts` then stores exact Item numbers and dollar-amount
candidates with their surrounding excerpt. OpenDART bodies use only explicit
label/value pairs such as conversion price, issuance amount, new-share count,
use of proceeds, payment date, and conversion period. These rows are evidence
candidates rather than model conclusions: `materiality_status` remains
`not_computable`, and dilution or market-cap impact is prohibited until the
required denominator and comparable units are independently verified.

## Create and publish the daily report

After review of the collector output, compose one Korean internal report and
publish it as a child page of the configured private Notion parent page:

```powershell
python compose_daily_brief.py
python publish_visual_brief.py workspace/briefs/<YYYY-MM-DD>_리포트.md `
  --macro-image workspace/charts/<YYYY-MM-DD>_macro_dashboard.png `
  --etf-image workspace/charts/<YYYY-MM-DD>_etf_dashboard_labeled.png
```

The scheduled pipeline now separates deterministic calculations from model
interpretation:

1. `collect_all.py` writes normalized records and a source-status manifest.
2. `generate_etf_chart.py` writes charts plus deterministic 1D/5D/20D/62D ETF metrics.
3. `collect_official_market_calendar.py` collects a bounded official release
   schedule. BLS ICS is attempted directly; BEA's official schedule is an
   accessible fallback for GDP and personal-income/PCE releases. A blocked
   source is recorded as partial rather than stopping publication.
4. `collect_korea_market.py` writes a separate Korea-transmission contract.
   USD/KRW comes from the Federal Reserve H.10 `DEXKOUS` series through FRED.
   KOSPI and KOSDAQ daily closing indices come from the KRX Open API when the
   `KRX_OPEN_API_KEY` GitHub Actions secret is present and both daily-index
   services have been separately approved in the KRX portal. The API records
   the official close and one-day change. The collector scans at most 16
   calendar days for six official trading closes and deterministically computes
   the five-session change when all six are available. Samsung Electronics,
   SK hynix, and foreign cash/futures flows remain unavailable unless a
   verified official input supplies them; no ETF proxy is silently substituted.
   A verified interim input can be copied from
   `examples/krx_official_market_input.template.json` to
   `workspace/korea_market_inputs/YYYY-MM-DD/krx_official.json`. The validator
   requires a matching date, numeric values, units, grade-A primary lineage,
   and an official KRX URL. It rejects future-dated or third-party rows.
   The KRX key alone is not sufficient: request access to both `KOSPI 일별매매정보`
   and `KOSDAQ 일별매매정보` in the KRX Open API service list, then add the key
   to repository Settings > Secrets and variables > Actions as
   `KRX_OPEN_API_KEY`. Authorization failures are stored only as a sanitized
   status and exception type; response bodies and keys are never written.
5. `build_us_equity_universe.py` creates a separate U.S. stock-screening
   population. It always merges configured watchlist names, U.S. representative
   companies from the sector master, and current grade-A SEC filing tickers.
   S&P 500 and Nasdaq-100 membership enters only through a current authorized
   input at
   `workspace/us_equity_universe_inputs/YYYY-MM-DD/index_membership.json`.
   Copy `examples/us_index_membership_input.template.json` as a starting point.
   Each source must retain its official or licensed URL, as-of date, membership
   scope, and an accepted internal automation-rights label. The universe is not
   marked ready for a full index scan unless both inputs are current and contain
   at least 450 S&P 500 and 90 Nasdaq-100 securities. Fund holdings used as a
   proxy remain explicitly labeled `fund_holdings_proxy`; they are not silently
   described as the index provider's constituent file. This artifact defines
   the population only and does not rank or recommend securities.
6. `screen_us_equity_candidates.py` accepts an authorized batch market snapshot
   from
   `workspace/us_equity_market_inputs/YYYY-MM-DD/market_snapshot.json`.
   The daily pipeline now creates that input with
   `collect_us_equity_market_snapshot.py`. It reuses the ten ETF rows already
   collected for the visual dashboard. When `APCA_API_KEY_ID` and
   `APCA_API_SECRET_KEY` are configured, one Alpaca multi-symbol historical-bars
   request fills the shared 19-ticker market-internals contract plus the current
   SEC-event securities. `ALPACA_MARKET_DATA_FEED` defaults to `iex`, which is
   compatible with Alpaca Basic accounts. Use `sip` only when the configured
   account permits consolidated SIP history. Alpaca raw daily bars
   are used so they remain comparable with the existing Alpha Vantage raw-close
   rows. If Alpaca is unavailable or incomplete, the collector spends a bounded
   Alpha Vantage supplemental request budget on current SEC-event securities,
   RSP/MDY breadth, and missing sector ETFs in that order. The default is seven
   supplemental requests and two event securities; configure
   `US_MARKET_DATA_REQUEST_BUDGET` and
   `US_MARKET_DATA_MAX_EVENT_SECURITIES` to fit the account's total daily
   allowance. Provider failures produce a validated partial snapshot rather
   than fabricated rows. The artifact reports
   `available_required_benchmark_count`, `missing_required_benchmarks`, and
   `market_internals_ready`; downstream analysis is ready only at 19/19.
   Only derived close, return, and volume fields enter downstream artifacts;
   raw provider time series are not redistributed.
   `run_daily_report.py` writes the cross-stage allocation to
   `workspace/provider_budget/YYYY-MM-DD/alpha_vantage_plan.json`. The default
   25-request profile reserves 10 calls for the ETF dashboard, seven for this
   market snapshot, and eight for sector fundamentals. When that static upper
   bound is exhausted, later optional company-provider adapters follow their
   explicit unavailable-data paths instead of issuing known-over-limit calls.
   Set `ALPHAVANTAGE_DAILY_REQUEST_LIMIT=0` only when the configured account
   agreement has no daily ceiling.
   Alpha Vantage usage here is labeled for permitted internal research.
   External or commercial redistribution requires the operator to confirm the
   appropriate provider agreement and market-data entitlement.
   It deterministically calculates 1-day, 5-session, and 20-session returns,
   20-day volume ratios, SPY-relative returns, and sector-ETF-relative moves.
   Candidate scores are bounded to 100 points: event importance 30, abnormal
   price movement 20, volume anomaly 15, sector influence 15, official material
   10, and five-session index-relative strength 10. At most ten research
   candidates are retained. Only the top three with a current market snapshot
   and at least one structured fact from a body-verified primary source can
   enter the later company-analysis stage. A downloaded body without a
   supported fact stays on the anomaly watchlist. SEC filing metadata remains
   a candidate signal but cannot unlock deep analysis by itself. Grade-D
   discovery metadata cannot unlock deep analysis. Copy
   `examples/us_equity_market_snapshot_input.template.json` as a contract
   example; absent or stale inputs produce an explicit blocked or stale status
   instead of estimated values.
7. `build_us_market_internals.py` reuses the same rights-checked batch market
   snapshot to calculate a separate U.S. market-structure contract. It covers
   RSP/SPY breadth, IWM and MDY size participation, growth/value,
   momentum/low-volatility, equal-weight/cap-weight style pairs, and all eleven
   U.S. sector SPDR ETFs over 1-day, 5-session, and 20-session horizons.
   `broadening`, `narrowing`, and `mixed_rotation` require deterministic
   breadth and sector-participation conditions. Missing or stale tickers
   produce partial or stale status and are never estimated. Sector rankings
   are price-return observations, not evidence of flows, earnings revisions,
   event causality, or expected returns.
   Before the universe build, `collect_spy_holdings_membership.py` reads State
   Street's official daily SPY holdings workbook and records it explicitly as a
   `fund_holdings_proxy`, never as the proprietary S&P index constituent file.
   `collect_sector_spdr_holdings.py` applies the same explicit proxy rule to
   the official daily holdings of XLC, XLY, XLP, XLE, XLF, XLV, XLI, XLB,
   XLRE, XLK, and XLU. A failed sector download is isolated and produces
   partial coverage instead of stopping the other ten sectors.
   Fewer than 450 valid equity holdings fail closed. When Alpaca credentials are
   available, `build_us_constituent_breadth.py` requests up to 260 daily bars
   for the proxy members in one paginated multi-symbol batch and emits aggregate
   breadth only: advances/declines, advancing/declining volume, percentages
   above 20/50/200-day moving averages, and 52-week new highs/lows. The same
   authorized price batch is reused to calculate those indicators for each of
   the eleven sector proxies, avoiding eleven additional market-data requests.
   At least 90% daily-price coverage and 80% 200-day-history coverage are
   required for each `ready` result; otherwise the reader sees an explicit
   blocked or partial state.
   The raw holdings workbook and constituent price histories are not included
   in the reader report.
8. `build_daily_snapshot.py` adds RSP/SPY breadth, VIX/VIX3M, U.S. high-yield
   spread, nominal 10-year yield, 10-year real yield, calendar-date price
   freshness, deterministic 1D/5D ETF leaders and laggards, and merges the
   official schedule with unique manually maintained company events. It also
   merges the bounded U.S. equity candidate screen and market-internals
   contract. The analysis call receives at most ten candidates, two evidence
   records per candidate, three deep-analysis ticker IDs, and eleven sector
   rows per horizon; raw market rows are not forwarded.
9. `analyze_market_snapshot.py` makes one schema-constrained OpenAI call for
   market regime, evidence, drivers, conflicts, risks, and data warnings. U.S.
   stock selection scores remain research-prioritization metadata, never a
   recommendation or expected-return signal; only body-verified primary
   facts can make a candidate eligible for a stock analysis card. The schema
   requires exactly one card per eligible shortlist ticker, up to three, and
   restricts each card to conditional price/sector interpretation,
   confirmation, invalidation, and a deeper-research posture.
10. `compose_daily_brief.py` uses that JSON as the controlling interpretation
   and makes the final Korean report. Code inserts the verified primary facts,
   observed price/volume response, model-labeled hypotheses, and source links
   under `미국 개별주 분석`; weaker candidates appear only under
   `이상 움직임 관찰`. The section explicitly remains research triage rather
   than a recommendation, target price, or position action.

The next monitoring layer is append-only:

11. `track_daily_hypotheses.py` evaluates matured prior hypotheses from
   deterministic metric changes and appends one or two new falsifiable rows.
12. The snapshot supplies the next seven days of official and manually
   confirmed events. Official schedule timing is grade A, but consensus and
   previous values remain null until a separately licensed or verified source
   supplies them. The analysis stage creates conditional scenarios without
   inventing either value.
13. GitHub Actions restores and saves `workspace/history` through a rolling
   cache, while the workflow artifact retains the daily review and evidence.
   Dry runs restore prior history for comparison but do not save their
   provisional history back to the shared cache. Each completed collection
   writes a compact state to
   `workspace/history/daily_market_snapshots/YYYY-MM-DD.json`; the next report
   receives deterministic metric, ETF-close, market-structure, sector-leader,
   and research-candidate changes from the latest prior report.
14. A successful dry run also preserves `workspace/briefs`,
   `workspace/charts`, normalized market inputs, and the provider request plan.
   Dispatch the workflow with `run_mode=publish_cached` and the successful
   `source_run_id` to publish that exact validated bundle without recollecting
   market data or spending another provider request budget. The cached mode
   fails closed when the Markdown, chart manifest, or any required image is
   absent.

The final report call uses a configurable `OPENAI_BRIEF_MAX_OUTPUT_TOKENS`
(default `8000`). Publication is rejected when the Responses API reports an
incomplete result, the completion marker is absent, a required section is
empty, or a grade-A record lacks its original URL. The final source inventory
is generated by code rather than left to the model, so a heading alone cannot
hide a truncated source list.

GitHub Actions retains the snapshot, analysis, and source-status JSON as a
private workflow artifact for 90 days. These artifacts are evidence and QA
support; Notion remains the human-facing report surface.

## Broker-research inbox

The broker-research path is rights-first:

```text
authorized local/Drive file + rights sidecar
  -> format and authority gate
  -> bounded private text extraction
  -> normalized broker_report record
  -> at most five reports sent to the brief model
  -> paraphrased view map + original link/reference
```

Validate the registry and run only the permitted-file collectors:

```powershell
python validate_broker_research_sources.py
python collect_all.py --sources authorized_report_drop google_drive_research_inbox --include-seen
```

The report labels these inputs as broker views, not verified facts or market
consensus. Full source text, report images, tables, ratings, and target prices
must not be published.

The opening report sections are `오늘의 결론`, `데이터 기준과 수집 상태`,
`시장 스코어보드`, `전일 가설 점검`, `향후 이벤트 시나리오`, and
`가설 누적 성과`. Market regime requires at least two supplied quantitative
observations. Missing metrics and consensus must be shown as `자료 없음`, not estimated.

The generated Notion title is exactly `YYYY-MM-DD 리포트`. The OpenAI call sends
only the normalized source excerpts, is configured with `store: false`, and
does not use web-search tools. It also rejects a generated report when one of
the required sections is absent, rather than publishing a partial report. Treat the output as an internal monitoring
document: check material claims against the linked source before acting on it.
Only add scheduling after this full flow has been reviewed several times.

`publish_visual_brief.py` deliberately publishes in this order: section title,
chart image, then the Korean explanation. The overseas-news image is split into
one 1080px-wide card per article, so the labels remain readable in Notion's
mobile app. The macro and ten-ETF dashboards remain desktop overview images;
on mobile, tap an image to expand it and use the Korean explanation below it.

The published page uses a broker-digest-inspired editorial hierarchy rather
than a raw text dump: a two-card `PB RESEARCH / AS OF` masthead, one compact
blue decision lead, a three-card signal strip, a four-column market KPI strip,
and separate cards for hypothesis review, event scenarios, cumulative QA, and
next checks. Dividers, the Notion table of contents, and level-3 headings keep
grouped news and qualitative research scannable. Native Notion columns stack
on mobile, so the same template remains readable without a separate mobile
artifact.
Empty SEC sections render as a neutral one-line state rather than a red warning
card. ETF prose must cite the calculated leaders, laggards, and SPY-relative
returns instead of repeating generic chart-reading instructions.
This uses native Notion blocks, so the result remains editable in Notion.

## Add a macro chart image to the report

This uses the existing FRED API key to make a four-panel chart (policy rate,
CPI, unemployment, and 10-year Treasury yield), then uploads it to Notion's
private file storage and appends it to the report page.

```powershell
python generate_macro_chart.py --date 2026-07-16
python attach_image_to_notion.py <NOTION_REPORT_PAGE_ID> workspace/charts/2026-07-16_macro_dashboard.png
```

Use separate panels because these measures have different units and scales.
The chart is a monitoring view, not a trading signal.

## Add the 10-ETF activity sample chart

The default `etf_watchlist` is a liquid, unlevered U.S.-listed sample: broad
market, major sectors, semiconductors, long Treasuries, gold, and high-yield
bonds. It is a monitoring sample, not a live “top 10” ranking.

```powershell
python generate_etf_chart.py --date 2026-07-16
python attach_image_to_notion.py <NOTION_REPORT_PAGE_ID> workspace/charts/2026-07-16_etf_dashboard.png --caption "ETF 모니터링 | 최근 약 3개월"
```

The translation/interpretation step is deliberately not a scheduled script.
Codex performs that work when the operator asks it to review the packet. A
truly unattended LLM translation workflow would need a separate model runtime
and credentials, which is outside this low-credential PoC.

## One-time setup for the operator

1. Install Python 3.11+ if it is not already available.
2. Copy `.env.example` to `.env`.
3. Fill `SEC_USER_AGENT` with the operator's real name and email address.
4. In Notion, create a blank private parent page named `SEC 공시 브리프 인박스`.
5. Create a Notion **internal connection** with insert-content capability,
   copy its token into `NOTION_TOKEN`, and add that connection to the private
   parent page via **... -> Connections -> Add connection**.
6. Copy the parent page ID from its URL into `NOTION_PARENT_PAGE_ID`.

Keep `.env` on the operator's PC. Never send the token in chat or commit it.

## GitHub Actions daily automation

For cloud execution, keep this repository private and save every value from
`.env` as an individual GitHub **Actions secret**. Never commit `.env`.
The included workflow runs at 07:30 Korea time on weekdays and can also be
started manually from GitHub's **Actions** tab. Manual runs offer `publish`
(the normal Notion page and Telegram-success path) and `dry_run`. `dry_run`
runs collection, report generation, visual-input validation, and all quality
gates, but does not create a Notion page, deliver a company-review alert, send
a Telegram result alert, or restore/save the persistent history cache. The
scheduled weekday run always uses `publish`.

Telegram discovery monitoring is separated from the full publication job.
`.github/workflows/telegram-refresh.yml` runs every three hours at minute 17,
collects and clusters Telegram posts without calling OpenAI or publishing a
report, and retains each diagnostic artifact for 14 days. Its latest successful
payload is cached and restored into the next daily workflow artifact. A refresh
with no usable posts fails visibly so an expired session or lost channel access
does not appear healthy.

To receive a Telegram result alert, add two more GitHub Actions secrets:
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. The workflow sends the new Notion
link after success. On failure, it sends the GitHub Actions log link instead.

## Qualitative-research inbox

Run `python setup_qualitative_inbox.py` once to create a private inline Notion
database below the configured parent page. Add the printed data-source ID as
`QUALITATIVE_INBOX_DATA_SOURCE_ID` in GitHub Actions secrets. The daily workflow
uses `qualitative_sources.json` only to discover **link-only** candidates from
approved domains; it does not scrape article bodies or paid content.

The starter roster includes the existing paid/newsletter sources plus public
market-view candidates from BlackRock Investment Institute, J.P. Morgan Asset
Management Market Insights, and PIMCO Insights. These three use NewsAPI only
for title, date, and original-link discovery; the workflow never fetches or
stores the publisher's article body. Federal Reserve speeches and testimony
use the Board's official RSS feed as a separate `공식 정책 발언 후보` path. They
are facts to verify market views, not investor commentary or a consensus vote.
When the daily workflow uses `dry_run`, it discovers these candidates but does
not create or modify any qualitative Inbox row.

In Notion, change a worthwhile candidate's status to `분석할 글`. For a complete
private research note, paste the permitted text you want analysed into `원문 발췌`
or open that database row and paste a longer excerpt into its page body. `내 메모`
remains an optional question or focus instruction. The workflow never fetches
publisher pages: it analyses only the text you personally provided, adds a
bounded `주요 시장 코멘트` section to the brief, then moves the item to `완료`.
The section groups named views as `긍정` / `중립` / `부정·경계`, preserves each
item's original link and evidence posture, and prints deterministic counts plus
a bounded common-view / confirmation / risk summary.

This is an editorial map of the selected items, not a statistically valid
market survey. An item without a pasted excerpt is visibly labelled
`사용자 메모 · 원문 발췌 미입력`; an excerpt without an original link is labelled
`사용자 발췌 · 원문 링크 미등록`. Neither is allowed to look like a verified
publisher fact. Speaker and affiliation are printed only when they appear in
the user-pasted material; otherwise the report says `발언자 미식별` or
`소속 미식별`.

Existing inboxes need the one-time schema update below before the `원문 발췌`
column appears:

```powershell
python migrate_qualitative_inbox.py
```

The workflow uses a two-day SEC lookback because GitHub-hosted runners are
stateless; it may therefore repeat a very recent filing across adjacent daily
briefs. Treat it as a monitoring reminder and use the original EDGAR link as
the source of truth.

## Test the Notion connection first

```powershell
cd sec_notion_poc
Copy-Item .env.example .env
# Fill .env first.
python publish_to_notion.py examples/SEC_8K_brief_sample.md --dry-run
python publish_to_notion.py examples/SEC_8K_brief_sample.md
```

The first command does not call Notion. The second creates one child page
under the configured private parent page.

## Fetch one real SEC filing

```powershell
python fetch_sec_filings.py --reset-state
python prepare_brief_packet.py workspace/inbox/<newest-file>.json --index 0
```

Open the generated Markdown packet in Codex and use this prompt:

```text
Read this SEC filing review packet. Create a Korean internal brief in the
exact Markdown structure requested in the packet. Do not translate the filing
in full. Separate confirmed facts, possible market relevance, and items that
need primary-source review. Do not provide investment advice. Save the result
as workspace/briefs/<same-file-name>.md.
```

Then publish the reviewed file:

```powershell
python publish_to_notion.py workspace/briefs/<brief-file>.md
```

The PB-facing brief intentionally excludes internal approval, SLA, owner-queue,
evidence-backlog, and operating-monitor sections. Those deterministic sections
are preserved separately at:

```text
workspace/operations_reports/<YYYY-MM-DD>_operations.md
```

GitHub Actions uploads this internal report with the structured evidence
artifact. It is not published to the reader-facing Notion page.

## Before scheduling anything

- Run the full flow manually at least three times.
- Check that the Notion connection can access only the intended parent page.
- Verify every factual claim against the SEC source link.
- Keep the page private until internal compliance approves a different use.
- If scheduling later, run `fetch_sec_filings.py` only at a modest cadence;
  SEC asks users to download only what they need and to moderate requests.
