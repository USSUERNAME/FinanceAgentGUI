# Telegram → Notion market-monitor integration

This integration treats Telegram as a fast discovery and viewpoint layer, not
as a factual source.

## Registered channels

The channel inventory and per-channel publication rights are stored in
`telegram_channels.json`. It currently contains the six operator-selected
channels and sixteen additional public channels, for a total of twenty-two.

The added broker channels cover Korean market strategy, global strategy,
US/global equity research, and small/mid-cap research. A public channel is not
treated as permission to republish its report: PDF attachments still require an
operator approval, and reader output remains limited to a bounded internal
summary plus the original post or report link.

Do not add a channel without recording:

- public username and display name;
- category and priority;
- whether the channel was operator-supplied or later recommended;
- publication policy;
- a rights label.

`link_only_no_republication` is the strictest policy. Such a channel may supply
only its name, a topic label and its Telegram post link to the reader report.

## Required private settings

Live collection uses an authorized Telegram user session because Telegram's
channel-history method is user-only.

The operator supplies these values outside the repository:

```text
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_SESSION_STRING
```

Never commit or print them. Session files and journals are ignored by Git.

After the operator creates the Telegram application ID and hash, run
`create_telegram_session.py` once on the operator's trusted machine. The script
stores the resulting string in
`workspace/local_secrets/telegram_session_string.txt` without printing it.
Copy that value into the `TELEGRAM_SESSION_STRING` GitHub Actions Secret, then
remove the local file if it is no longer needed.

## Processing contract

```text
Telegram public channels
→ bounded channel-post records
→ outbound URL and near-title de-duplication
→ title/body relevance triage
→ cross-source event clustering
→ official-source matching
→ at most three clusters in `텔레그램 관점 모니터`
```

Every Telegram record is forced to:

```text
source_grade: D
primary_source_confirmed: false
evidence_scope: telegram_channel_post
evidence_label: discovery_lead_only
```

The final report must not quote posts, reproduce broker research, repeat target
prices or turn Telegram-only claims into confirmed facts.

## Reader output

The Notion report adds a final level-three subsection under `해외 뉴스`:

```text
텔레그램 관점 모니터
```

Each retained cluster shows:

- a short paraphrased topic;
- participating channel names;
- the duplicate-post reduction count;
- a bounded difference in viewpoints, when supported;
- verification status;
- original Telegram post links.

When no post passes the collection and quality gates, the subsection is reduced
to one compact empty-state sentence.
