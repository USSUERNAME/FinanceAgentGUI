# Prompt for the recipient's AI assistant

Read this repository, `handoff/REPORT_DESIGN.md`, and `handoff/DATA_CONTRACT.md` before making changes.

Goal: generate an internal Korean daily market-monitoring report that follows the 2026-07-21 Notion design reference. Treat the Notion page as visual hierarchy only; do not reuse its live data, signed image URLs, news text, or API credentials.

Implementation rules:

1. Keep source collection separate from report composition. Each collector must write the normalized JSON contract before the composer reads it.
2. Preserve original source URLs, observation dates, source grades, rights labels, and the difference between confirmed facts and interpretation.
3. Use only permitted APIs, official feeds, or operator-authorized document drops. Do not scrape broker research sites or republish licensed report text.
4. Store keys only in local `.env` for the owner's machine or GitHub Actions Secrets for remote execution. Never commit, log, or ask the owner to paste a key into chat.
5. Start with `handoff/sample_normalized_item.json` and make an offline/sample render pass before enabling a connector.
6. Keep the report non-advisory: no buy/sell/hold calls, price targets, certainty claims, or invented consensus.
7. Retain the terminal `<!-- REPORT_COMPLETE -->` marker and fail the run if a required report section is empty or the response is incomplete.

When proposing a change, first state: affected collector or composer, input fields used, report section changed, and how it will be tested.
