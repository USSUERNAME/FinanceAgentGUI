# Normalized data contract

Every collector writes an array of records to `workspace/normalized/YYYY-MM-DD/inbox_<source>.json`.
The report composer reads this normalized inbox; it should not read a provider response directly.

## Required fields

| Field | Rule |
|---|---|
| `id` | Stable unique identifier for de-duplication. |
| `source_id`, `source_type` | Identify the adapter and data type. |
| `published_at`, `collected_at` | ISO-8601 timestamps. |
| `title`, `raw_text` | Bounded source metadata/excerpt; no full licensed article text. |
| `url`, `canonical_url`, `publisher` | Original link lineage; canonical URL has no tracking parameters. |
| `source_url_kind`, `link_required` | Allowed kinds: primary_source, publisher_article, licensed_report, provider_metadata, missing. |
| `source_grade`, `primary_source_confirmed` | Evidence quality and confirmation status. |
| `observation_date`, `release_date`, `market_cutoff` | Keep null when unknown; never substitute an observation period for a release date. |
| `tickers`, `tags` | Arrays, even when empty. |
| `rights_label` | Permitted use/redistribution note. |

## Gate rules

- A news, filing, or primary-source record with `link_required: true` is not publishable if its original URL is missing.
- `source_grade: D` or `evidence_scope: metadata_only` must be labelled as unverified metadata in the report.
- A licensed broker excerpt may be internal-only. It must include a rights label and must not be reproduced or redistributed.
- Model-written commentary may interpret supplied facts, but it cannot add missing prices, dates, quotes, consensus figures, or terms from a filing title.

See `sample_normalized_item.json` for a safe sample.
