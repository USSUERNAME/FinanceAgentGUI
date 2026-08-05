# Credential setup — owner performs only this part

## GitHub Actions

In the recipient's repository, open **Settings → Secrets and variables → Actions → New repository secret**. Add only the services they actually enable:

| Secret name | Used for |
|---|---|
| `OPENAI_API_KEY` | Korean brief generation. |
| `NOTION_TOKEN` | Publishing to the recipient's Notion workspace. |
| `NOTION_PARENT_PAGE_ID` | Parent page/database configured for published reports. |
| `FRED_API_KEY` | FRED collection, if enabled. |
| `OPENDART_API_KEY` | Korean disclosure collection, if enabled. |
| `ALPHAVANTAGE_API_KEY` | Market/news adapter, if enabled. |
| `NEWSAPI_KEY` | News metadata adapter, if enabled. |

Do not share secret values with the project owner, an AI chat, Figma, Notion text, screenshots, or Git commits. The AI may tell the operator the secret *name* to add, but never needs the secret value.

After adding secrets, dispatch the workflow with sample/offline data first. Confirm that the report contains source URLs, source grades, price as-of date, and `<!-- REPORT_COMPLETE -->` before enabling live collection.
