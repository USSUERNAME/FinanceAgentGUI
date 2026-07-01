# Magazine Storage Contract

Magazine content is local runtime data. Keep generated articles under:

```text
data/magazine/articles/<article-id>/
  metadata.json
  article.html
  comments.json
  assets/
    hero.jpg
data/magazine/editorial-preferences.json
data/magazine/editorial-bias.json
```

The canonical topic catalog lives in `config/magazine-topics.json`. Each article must set `metadata.topics` to 1-3 `topics[].label` values from that file. One primary topic is required; up to two secondary topics are optional. Three topics is a maximum, not a target, so do not fill weak secondary topics just to use all slots. Do not store ad-hoc tags, companies, industries, or subtopics in `metadata.topics`; use `storyFamily`, `editorialAngle`, `noveltyNote`, body copy, or source fields for those details instead. If a generator returns more than three topics, the runtime keeps only the first three registered topics.

`metadata.json` owns the catalog fields used by the UI:

- `title`, `deck`, `summary`, `topics`, `articleType`
- `heroImage.src`, `heroImage.alt`, `heroImage.credit`
- `publishedAt`, `createdAt`, `updatedAt`
- `isCoverStory`, `coverRegisteredAt`
- `sourceBasis`
- `worldMemory`
- `newsFeed`
- `researchMode`, `editorialAngle`, `storyFamily`, `noveltyNote`
- `chartBlocks` for data-heavy analysis articles
- `followupOptions` for reader-facing "what should we cover next?" choices

Cover stories are ordered by newest `coverRegisteredAt` first. The first item becomes the large cover story, and the next four become the smaller cover cards.

Cover promotion uses `world-memory-cover-v1`. While the total article count including the new article is five or fewer, promote the new article without scoring so the cover story pool is filled first. Starting with the sixth article, compare the new article with the latest uploaded article window by upload time: use the previous five articles. Promote the new article only if it is the strongest item in that window against the current World Memory signal: closeness to the most important issue or the most recent issue. This is an LLM editorial judgment, not text matching.

Promoted articles must set:

```json
{
  "isCoverStory": true,
  "coverRegisteredAt": "ISO timestamp",
  "coverDecision": {
    "policy": "world-memory-cover-v1",
    "result": "promote",
    "mode": "bootstrap-cover-fill",
    "scorePolicy": "not-scored-total-articles-lte-5",
    "evaluatedAt": "ISO timestamp",
    "comparisonWindow": {
      "basis": "upload-time",
      "articleLimit": 5,
      "articleIds": [],
      "totalArticleCount": 5
    },
    "worldMemorySignals": {
      "mostImportantIssue": "요약",
      "mostRecentIssue": "요약",
      "query": "판단에 사용한 검색 질의",
      "hitIds": []
    },
    "candidateScore": null,
    "bestPreviousScore": null,
    "rationale": "총 기사 수가 5개 이하인 초기 구간이므로 채점 없이 커버스토리 슬롯을 채우기 위해 승격했습니다."
  }
}
```

In scored mode, omit `mode`/`scorePolicy` or use a scoring-specific note, and set `candidateScore` to a 0-100 score. Bootstrap cover fill must keep `candidateScore` and `bestPreviousScore` null or omitted.

Non-promoted articles should set `isCoverStory: false` and `coverRegisteredAt: null`. They may omit `coverDecision`; if they include one, `coverDecision.result` must be `do-not-promote`.

When an article uses World Memory, vector search evidence is mandatory. Store it in:

```json
{
  "worldMemory": {
    "retrievalPolicy": "mandatory-vector-search",
    "query": "검색 질의",
    "vectorSearch": {
      "engine": "sentence-transformers",
      "model": "ibm-granite/granite-embedding-97m-multilingual-r2",
      "hits": []
    }
  }
}
```

The magazine API returns `worldMemoryIssues` for any World Memory based article missing the query, engine/model, or semantic-search hits.

Treat local context, recent items, continuity search, and external research as one evidence bundle for article judgment. Internal storage fields can still record where evidence came from, but article prose should not explain those layers to the reader. If semantic hits are sparse, noisy, or outside the requested field, do not skip the article automatically. Use external research and declare the source mix with `researchMode: "external-research"`, `"external-first"`, or `"mixed-research"` in `metadata.json`.

The local `data/news-feed.json` items may be used for urgent or unusually article-worthy subjects, but only for items after the latest successful internal update. The internal eligibility boundary is `data/world-memory/collector-state.json` `collector.lastSuccessfulAt`; if that timestamp is missing, those items must not be used as a subject source for that generation run.

When an article uses this local evidence, store the specific eligible evidence:

```json
{
  "researchMode": "news-feed-with-world-memory-backup",
  "newsFeed": {
    "selectionPolicy": "post-world-memory-update-only",
    "worldMemoryLastSuccessfulAt": "ISO timestamp",
    "items": [
      {
        "id": "nf_...",
        "feedId": "first-squawk",
        "feedTitle": "First Squawk",
        "title": "피드 제목",
        "publishedAt": "ISO timestamp",
        "fetchedAt": "ISO timestamp",
        "translatedAt": "ISO timestamp"
      }
    ]
  }
}
```

Use `researchMode: "news-feed-first"` when the local item is the main source and continuity search is unavailable or weak; prefer `"news-feed-with-world-memory-backup"` when continuity search adds useful context. Do not use keyword or regex matching to decide whether an item is article-worthy; the generator should make an editorial LLM judgment from the eligible item, timing, market mechanism, source, and context.

Before generating a new magazine issue, create an editorial slate. A normal five-article issue should not be five versions of the highest-ranked story family. Mix major trend follow-ups, lower-level signals, company or sector mechanics, and at least occasional external-research stories. For recurring mega-trends, write from the latest delta rather than reintroducing the issue from scratch. Use `editorialAngle`, `storyFamily`, and `noveltyNote` in metadata to make that decision auditable.

Store `metadata.eventSignature` for new articles as a primary event-card claimlet, not a prose summary: `role:"primary"`, `actor`, `action`, `object[]`, `time`, `marketMechanism`, and `sourceIds[]`. For articles that intentionally connect several facts, `metadata.eventSignatures[]` may contain exactly one `role:"primary"` card plus zero or more `role:"supporting"` cards. The primary event signature is the text that should be embedded for duplicate discovery; do not embed the whole article body for novelty checks.

Novelty is enforced before publish, not only by prompt wording. Scheduled/staged generation runs the strict checker against the staged article plus the latest uploaded production article baseline. A candidate is rejected when it reuses a recent article's exact `newsFeed.items[].id`, reuses the same non-image external/source URL anchor, or leans on the same primary `worldMemory.vectorSearch.hits[0].eventId` plus the same `storyFamily` without any fresh local item or source URL anchor. Independent delta is not whole-article embedding distance and not hero-image difference; it must be a fresh evidence anchor such as a new eligible local item, official/external source URL, number, policy execution, price reaction, or company action that happened after the previous article. Primary continuity event overlap is treated as context, not a standalone veto. Ambiguous cases should be judged as `same_event`, `independent_followup`, or `unrelated` by LLM editorial judgment, not by text matching or a fixed day-count embargo.

`scripts/magazine_event_signature_index.py` uses the same `sentence-transformers` model as World Memory (`ibm-granite/granite-embedding-97m-multilingual-r2` by default) to embed the primary `eventSignature + source titles + noveltyNote` into `data/magazine/event-signature-index.sqlite3`. Exact primary-signature/source reuse is a hard failure. High embedding similarity without source reuse is a near-duplicate candidate for LLM novelty judgment; set `MAGAZINE_EVENT_SIGNATURE_STRICT=1` to fail those warnings during stricter runs. Article deletion removes the matching event-signature index row when present.

## Article Writing Harness

Magazine article prose should feel edited, not templated.

- Do not expose internal retrieval language in reader-facing body copy. Avoid phrases like "World Memory", "월드 메모리", "월드메모리", "World Memory vector search results", "월드 메모리 벡터 검색 결과", "News Feed", "post-cutoff", "post-World-Memory-update", "컷오프", "수집 기사", or source-pipeline words like "피드" in `deck`, `summary`, and `article.html`.
- Do not mechanically replace those internal labels with one fixed substitute. Write the sentence as a newspaper article would. Examples: `Bloomberg가 전한 장중 보도`, `같은 날 나온 ISNA 인용 발언`, `새 가격 반응`, `새 기업 공시`, `최근 현지 매체 보도`, or another source-specific phrase that fits the paragraph. Never write source labels as `계열 피드`, `새 피드`, or similar data-pipeline language.
- During article drafting, leave `metadata.title` empty. The generator finalizes it after `article.html` exists by sending only the article body text to a separate title pass. That pass asks for a readable Korean headline in a Bloomberg or Financial Times style and writes the returned one-line title into `metadata.json`.
- Do not include editorial-process placeholders such as "편집회의 체크리스트" in the article body. Store future production notes in metadata or a separate editorial feature when that UI exists.
- Do not use a fixed `H2 + two paragraphs` rhythm. Assign each section a job and vary paragraph counts naturally. A short lead section may use two paragraphs, a data section may need three to five, a mechanism section may need two or three, and a conclusion may be brief.
- Do not write as if teaching or scolding the reader. Avoid repeating command-heavy phrasing such as `봐야 합니다`, `확인해야 합니다`, `점검해야 합니다`, `잊으면 안 됩니다`, and `투자자는 ...해야 합니다`. Prefer observational magazine prose that lets facts, scenes, quotes, and numbers carry the point.
- Avoid generic repeated explainers. If an issue has already been covered recently, the new article should be a follow-up about what changed, what assumption moved, what price reacted differently, or what new data point now matters.
- For deep analysis articles, include concrete numbers, source-backed comparisons, and chart blocks. The article should explain what moves, why it moves, who pays, and which indicators confirm or falsify the thesis.
- When research contains attributable comments from executives, analysts, policymakers, traders, agencies, or other named stakeholders, use them as evidence instead of flattening everything into summary prose. In running prose, write attribution naturally, such as `Morgan Stanley(모건스탠리)의 Michael Wilson(마이클 윌슨)은 "..."라고 말했습니다` or `U.S. Energy Information Administration(EIA·미국 에너지정보청)에 따르면 ...입니다`. If the exact wording is not verified, do not use quotation marks; paraphrase with `...라고 설명했습니다`, `...라고 전했습니다`, or `...라고 봤습니다`.
- If research finds a materially relevant actual statement from a named person, company, agency, policymaker, analyst, trader, or other stakeholder, do not flatten it into anonymous summary. Use a direct quote when exact wording is verified; otherwise use explicit indirect attribution.
- Quotes and attributions are not decorative proof stamps. Do not explain the whole point in body prose and then repeat it in a quote. A quoted or attributed moment should do one clear job: introduce a new fact, sharpen disagreement, explain the implication of a number, reveal who benefits or pays, or set up the next paragraph's mechanism.
- Make the prose around a quote do real work. The sentence before the quote should create the need for that source voice, and the sentence after it should use the quote to move the article forward. If the quote does not change what the reader understands, convert it to a tighter indirect attribution or remove it.
- Media names, organizations, and people names should be written as `original name(Korean name)` on first mention in reader-facing article copy. For well-known acronyms, use `original name(ACRONYM·Korean name)`, such as `International Energy Agency(IEA·국제에너지기구)`. Subsequent mentions can use the acronym or Korean short form when readability benefits.
- Hero images must be real article-related images, not generated SVG/vector mockups. Prefer free/open images and official source images when they carry the story well. For local private reading, public news/photos can be used when they are materially more accurate for a person, company, or specific event; record a clear `usageNote` such as `editorial-private-use; local personal reading only`.
- Store local hero assets as bitmap files under `assets/` and record `credit`, `sourceUrl` or `pageUrl`, and license/rights/usage notes in `metadata.heroImage`. Wikimedia Commons files can be downloaded with `Special:FilePath`; official or news photos should use the original/representative image URL when available. Verify local assets with `file`, `ls -lh`, and the strict checker instead of creating placeholders.
- Image search should be bounded. After at most three `search_web` calls, either download a viable candidate or report the failed URLs/commands. Do not keep searching while leaving the article without a real local bitmap.
- Use direct quote blocks when a statement meaningfully frames the article, sharpens a market disagreement, or gives the reader a voice from the field. Keep quotes short and source-backed. Prefer one or two high-signal quote blocks over many decorative quotes. A quote block can use this HTML shape inside `article.html`:

```html
<blockquote>
  <b>Morgan Stanley(모건스탠리)의 Michael Wilson(마이클 윌슨)에 따르면:</b><br>
  "연말까지 주식시장의 전망은 양호하다고 판단합니다."
</blockquote>
```

- Direct quote text itself should be Korean in reader-facing magazine articles, even when the source quote is in English. Translate faithfully, preserve the meaning and level of certainty, and keep the original speaker/source attribution in the label. Do not invent quotes, speaker names, titles, dates, or source labels. If the source only supports an indirect summary, use indirect attribution rather than a direct quote block.
- A production-like generated article should usually include at least five `sourceBasis` entries and at least four body-level direct or indirect attribution moments. Treat this as a writing-balance target, not a mechanical quota. Weak, repetitive, or disconnected quotes should be rewritten as useful attribution or removed.
- Unless an article covers death, war, terrorism, or a severe market collapse, the body should carry some restrained Bloomberg-newsletter-style humor and wit. The joke should sharpen the market point, not distract from the risk.
- Use polite Korean endings such as `~합니다` and `~입니다`; avoid dry encyclopedia endings like `~한다`.

Deep analysis articles can include ECharts blocks in `metadata.json`:

```json
{
  "chartBlocks": [
    {
      "id": "chart-id",
      "title": "차트 제목",
      "note": "차트 해석",
      "option": {}
    }
  ]
}
```

Keep `option` JSON-serializable and use the existing local ECharts renderer.

Run the project-local style and novelty check before publishing generated articles:

```bash
node scripts/magazine_article_style_check.mjs
node scripts/magazine_article_style_check.mjs --strict
```

Generate a fresh issue through the connected Codex CLI:

```bash
node scripts/magazine_generate_with_codex.mjs --replace --count 5
```

The generator runs Codex CLI from the standalone `GuiBuild/` root, reads the magazine harness files, edits only local magazine runtime article folders, finalizes each title from the completed body only, and then runs `node scripts/magazine_article_style_check.mjs --strict`. If a repair round changes the body, the generator runs the body-only title pass again before the next strict check.

For staged scheduler runs, the generator sets `MAGAZINE_BASELINE_ARTICLES_DIR=data/magazine/articles` and `MAGAZINE_BASELINE_ARTICLE_LIMIT=12` so the strict checker can compare candidates with recently uploaded articles before publish.

## Automatic Generation Cycle

Magazine is a World Memory adjunct feature and defaults off. The tracked default lives in:

```text
config/magazine.defaults.json
```

User changes are stored in:

```text
config/magazine.user.json
```

Do not store this switch or the scheduler interval in browser memory or localStorage. The Settings page must read/write the file-backed `/api/magazine/settings` endpoint. Magazine can only be enabled when World Memory is enabled; turning World Memory off also writes Magazine off.

When the local web server starts, it starts the magazine scheduler only if both World Memory and Magazine are enabled, and unless `FINANCE_AGENT_MAGAZINE_SCHEDULER_DISABLED=1` or `FINANCE_AGENT_MAGAZINE_AUTORUN=0` is set.

Default behavior:

- first scheduled run: about 6 hours after server start by default
- recurring interval: 6 hours by default, adjustable from 1-10 hours in Settings
- per cycle article count: model editorial judgment 0-3, never random
- generation order: sequential, one `--count 1` generator run at a time
- replacement policy: `replace=false`, so scheduled runs append new article folders rather than replacing the issue
- retry policy: failed scheduled cycles retry every 15 minutes until the next regular update slot
- retry window: if a cycle still cannot complete before its next regular update slot, that cycle is closed and no longer carries work forward
- deadline policy: if a cycle reaches the next regular update slot before its planned article count is filled, the article already being generated may finish, but any not-yet-started articles are canceled; the next new writing attempt waits 15 minutes after the slot or after the in-flight article is sent

The scheduler asks the selected local agent provider for an `articleCountDecision` JSON object before a new regular cycle starts. The decision must include `targetCount`, `confidence`, `reason`, and optional `candidateAngles`. `targetCount=0` is valid only when the model judges that there is no clearly article-worthy new angle after checking the evidence bundle, recent magazine articles, and reader preference/bias signals. If the count-decision model call fails, the scheduler records a fallback decision and conservatively attempts one article rather than silently skipping the cycle.

Runtime scheduler state is stored in:

```text
data/magazine/scheduler-state.json
```

Useful development overrides:

```bash
FINANCE_AGENT_MAGAZINE_INITIAL_DELAY_MS=10000 FINANCE_AGENT_MAGAZINE_INTERVAL_MS=60000 npm run dev
FINANCE_AGENT_MAGAZINE_AUTORUN=0 npm run dev
```

The GUI can inspect scheduler and unread state through:

```http
GET /api/magazine/settings
PATCH /api/magazine/settings
GET /api/magazine/status
POST /api/magazine/status
GET /api/magazine/read-state
POST /api/magazine/read-state
```

`PATCH /api/magazine/settings` accepts `{"schedulerIntervalHours":6}`. The value is stored in `config/magazine.user.json`, defaults to `6`, and is clamped to the Settings UI range of 1-10 hours. When Magazine is enabled and no scheduler cycle is active, changing the value re-arms the next pending run with the new interval.

`POST /api/magazine/status` accepts `{"action":"runNow"}` to request an immediate manual scheduler cycle. The cycle still runs the article-count decision harness first, so a valid result can be `targetCount=0` with a reader-visible reason instead of forcing an article. The API starts the cycle in the background, returns the refreshed status snapshot, and rejects the request while a scheduler or generation cycle is already active.

`POST /api/magazine/status` or `PATCH /api/magazine/status` accepts `{"action":"reschedule","nextRunAt":"ISO timestamp"}` to move the next pending scheduler run within the next 24 hours. It does not interrupt an active generation cycle.

The hidden break-glass one-article control can be shown by opening the app with `?magazineGenerateOne=1`; `?magazineGenerateOne=0` hides it again. It calls the article collection API with `count:1` and `replace:false`, bypassing the scheduler count-decision cycle.

`POST /api/magazine/read-state` records the magazine page-open time in `data/magazine/read-state.json`. Unread count is derived from article timestamps after that point; articles do not get individual read flags.

Reader follow-up preference options can be added per article:

```json
{
  "followupOptions": [
    {
      "id": "shipping-insurance",
      "label": "보험료와 운임 추적",
      "prompt": "선박 보험료와 운임으로 번지는 후속 기사",
      "topics": ["금융", "산업"],
      "tone": "finance"
    }
  ]
}
```

The reader UI stores selections through:

```http
GET /api/magazine/preferences
POST /api/magazine/preferences
```

Selections are stored in `data/magazine/editorial-preferences.json`, which is local runtime data and ignored by Git. Reader choices are multi-select toggles: clicking an inactive option selects it, and clicking an active option records a `deselect` event and removes it from active editorial guidance. Each event keeps the article, option, prompt, topics, timestamp, action, World Memory anchors, and `worldMemoryWeight`.

Preference strength decays with half-life windows of 30, 90, 180, and 365 days. The API returns per-event `decayWeights`, `activeByArticle`, and aggregated `effectiveSignals` based only on currently active selections. Future article generation should combine these preference weights with current World Memory relevance, so an old user preference fades when the related issue also loses World Memory weight.

## Reader Comments And Editorial Bias

Article comments are stored next to the article:

```text
data/magazine/articles/<article-id>/comments.json
```

The UI uses:

```http
GET /api/magazine/comments?articleId=<article-id>
POST /api/magazine/comments
GET /api/magazine/bias
```

Each user comment is authored as `사용자`. The one-level AI reply is authored as `매거진 편집자 AI`; do not create deeper threaded replies. The frontend shows reply states locally as `답변 대기 중`, then `답변 중`, then the final non-streamed answer.

Comment answers must receive the current article body, existing comments and AI replies, shared local memory, external memory briefing, World Memory semantic-search context, and web-research guidance when available. Force `personaMode: "none"` for comment answers even when the sidebar persona chat mode is enabled.

When a comment asks for future editorial direction, the answer LLM may emit a hidden `magazine_comment_action` JSON block. If it omits the block, the server runs a second JSON-only LLM classification harness over the article, the new comment, previous comments/replies, and the visible AI answer. The server strips hidden action blocks from the reader-facing reply and validates `biasEvents` into:

```text
data/magazine/editorial-bias.json
```

Bias events support positive and negative direction:

```json
{
  "direction": "increase",
  "label": "보험료와 운임 추적",
  "prompt": "선박 보험료, VLCC 운임, 항로 선택을 더 자주 다루기",
  "topics": ["금융", "산업"],
  "reason": "사용자가 후속 기사 방향으로 요청함",
  "weight": 1
}
```

Use `direction: "decrease"` for comments such as "요즘 이런 기사 너무 많아요" or "이런 건 줄여 주세요". Bias events use the same 30/90/180/365-day decay windows and World Memory coupling as reader follow-up preferences.

When comment-generated bias events are actually stored, the AI reply should carry `biasEventIds`; the frontend renders a light-green check marker below that reply with `사용자의 편집 방향 수정 요청이 반영되었습니다`.

Article deletion is folder based:

```http
GET /api/magazine/articles
POST /api/magazine/articles
DELETE /api/magazine/articles?id=<article-id>
```

`GET` returns `articles`, `coverStories`, `topicCatalog`, `worldMemoryPolicy`, and diagnostic issue summaries. `POST` accepts `{"action":"generateWithCodex","count":1,"replace":false}` or the equivalent selected writing provider action to append exactly one article without running the scheduler count-decision cycle. Deleting an article removes its whole folder, including `assets/`, and deletes the matching `magazine_event_signature_embeddings.article_id` row from `data/magazine/event-signature-index.sqlite3` when present. The reader UI exposes `기사 삭제` in the top-left action row and requires a destructive confirmation dialog before calling the delete API.
