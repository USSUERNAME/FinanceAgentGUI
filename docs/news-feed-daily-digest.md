# News Feed Daily Digest

The News Feed screen keeps a dated Korean digest in addition to the rolling
15-minute market summary.

## Window and schedule

- The digest window closes at `07:30 Asia/Seoul`.
- Each run covers the preceding 24 hours: yesterday `07:30` through today
  `07:30`.
- The scheduler catches up after app startup when the latest closed window has
  no ready digest.
- News Feed retention is at least 48 hours so a delayed or manually repeated
  run can still read the full completed window.

## Pipeline

1. Select timestamped News Feed rows inside the completed window.
2. Normalize source URLs and remove common tracking parameters.
3. Pre-cluster exact URLs and highly similar translated or original text.
4. Ask the configured low-cost translation model to select at most eight
   market-relevant events and write Korean summaries.
5. Validate every model-selected cluster id against the local input.
6. Derive verification labels and source URLs from local records rather than
   trusting model-provided status.
7. Persist the latest result and 14 prior windows locally.

`metadata_only` means one feed detected the event. `multi_source` means at least
two configured feeds detected it. Neither label means that an official primary
source was checked.

## Local files and API

- Runtime file: `data/news-feed-daily-digest.json`
- Generate or regenerate: `POST /api/news-feed/daily-digest`
- Read the current digest: `GET /api/news-feed/daily-digest`
- The News Feed status snapshot also exposes `dailyDigest`.

The runtime digest file is user data and must not be committed.
