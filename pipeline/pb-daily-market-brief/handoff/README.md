# PB Market Intelligence AI Handoff

This folder is the safe handoff package for a new operator and their AI assistant.
It contains no API keys, live report data, or licensed research text.

## What to share

1. Share the GitHub repository as a **template repository** (or a ZIP for a first review).
2. Share the latest visual reference: [2026-07-21 Notion report](https://app.notion.com/p/3a42aeeccec5812cba12fa8e9514bb7e).
3. Give the recipient `AI_HANDOFF.md`, `REPORT_DESIGN.md`, `DATA_CONTRACT.md`, and `sample_normalized_item.json`.
4. The recipient creates their own repository and enters their own credentials in GitHub Actions Secrets. Never transfer `.env` files or paste keys into a chat.

## Operator sequence

1. Create a repository from the template.
2. Ask their AI to read `AI_HANDOFF.md` before changing code.
3. Put credentials only in GitHub Actions Secrets.
4. Run the sample-data path first; verify the generated Markdown before enabling any data connector.
5. Enable one permitted source at a time, then verify its original URLs and source-grade labels in the output.

## Scope boundary

This produces an internal market-monitoring brief. It is not a recommendation engine: it must not produce buy/sell instructions, price targets, or invented consensus data.
