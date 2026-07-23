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
data/magazine/event-signature-index.sqlite3
```

The event-signature SQLite file is a local, rebuildable derived index. Its
tracked blueprint is `config/magazine-event-signature-index.schema.sql`; create
or migrate its empty shape with
`python scripts/magazine_event_signature_index.py init`. Do not commit or ship
the populated index or an empty seed copy. Use `scripts/sqlite_store_doctor.py`
for read-only schema/integrity checks and `docs/sqlite-stores.md` for update-time
backup and migration.

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

Magazine v2 does not trust the article writer to self-select the cover. After
the article files exist, a separate low-reasoning LLM classification pass reads
the candidate, the previous five uploaded articles, and the current market
signals. It must return exactly one of `promote` or `do-not-promote` with
comparable scores and a rationale. The generator writes
`coverDecisionGate: "magazine-cover-classifier-v2"` before validation, so a
missing or malformed classification blocks publication instead of silently
becoming `isCoverStory: false`. Every classifier process uses the shared
installed-conditional astop observation gate.

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

That omission allowance is for legacy articles only. New Magazine v2 articles
with `coverDecisionGate: "magazine-cover-classifier-v2"` must retain the
independent LLM result even when the result is `do-not-promote`.

If a historical classifier regression leaves the visible cover stale, rebuild
only the cover metadata from a bounded recent upload window:

```bash
node scripts/magazine_generate_with_codex.mjs \
  --rebuild-covers \
  --candidate-limit 24 \
  --provider codex-cli \
  --model gpt-5.6-sol \
  --reasoning low \
  --approval never
```

The command above is a dry run. Add `--apply` only after reviewing the five
ranked article ids. Apply mode backs up every touched `metadata.json` under
ignored `data/backups/`, keeps article bodies and publication timestamps
unchanged, and assigns a shared `coverRegisteredAt` plus `coverRank` 1-5 so the
API renders the selected order deterministically.

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

The local `data/news-feed.json` items may be used for urgent or unusually article-worthy subjects, but only for items after the latest successful internal collection/import update. The internal eligibility boundary is `data/world-memory/collector-state.json` `collector.lastSuccessfulAt`; report generation timestamps such as `report.generatedAt` are not eligible cutoffs. If `collector.lastSuccessfulAt` is missing, those items must not be used as a subject source for that generation run.

Article-count decisions and article-generation prompts should include all eligible post-update News Feed items, not an arbitrary fixed sample such as the latest 18 or 24 rows. A busy six-hour window can contain hundreds of short squawk items; the model should make the editorial judgment from the full eligible set, then ignore weak, promotional, duplicative, or off-domain items semantically rather than because they fell outside a prompt cap.

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

Scheduled topic discovery normally uses the eligible post-update News Feed set as the main candidate lane. After the model decides the cycle's `targetCount`, the server makes an independent true-random 12% lane roll for each actual article slot. A slot that rolls into the under-radar World Memory scout pass excludes News Feed items as subject candidates for that slot and instead evaluates recent World Memory rows using a "심심해요"-style method: look for quieter medium/low-importance, industry, company, subject, or mechanism signals that may become article-worthy, while still applying the same recent-article and event-anchor duplicate checks. This lane only changes topic discovery; once a subject is selected, article writing must continue to use the normal magazine writing harness, style rules, evidence requirements, continuity search, external research, image rules, title pass, and strict checks.

Store `metadata.eventSignature` for new articles as a primary event-card claimlet, not a prose summary: `role:"primary"`, `actor`, `action`, `object[]`, `time`, `marketMechanism`, and `sourceIds[]`. For articles that intentionally connect several facts, `metadata.eventSignatures[]` may contain exactly one `role:"primary"` card plus zero or more `role:"supporting"` cards. The primary event signature is the text that should be embedded for duplicate discovery; do not embed the whole article body for novelty checks.

Novelty is enforced before publish, not only by prompt wording. Scheduled/staged generation checks the staged article against the latest uploaded production article baseline. Exact primary event-signature reuse and reused local evidence ids remain blocking. A shared statistics page, filing portal, standing dataset, IR page, or other source URL is only an editorial similarity signal in the v2 harness; it is not by itself proof that two articles cover the same event. Independent delta is not whole-article embedding distance and not hero-image difference; it must be a fresh evidence anchor such as a new eligible local item, official/external source URL, number, policy execution, price reaction, or company action that happened after the previous article. Primary continuity event overlap is treated as context, not a standalone veto. Ambiguous cases should be judged as `same_event`, `independent_followup`, or `unrelated` by LLM editorial judgment, not by text matching or a fixed day-count embargo.

`scripts/magazine_event_signature_index.py` uses the same `sentence-transformers` model as World Memory (`ibm-granite/granite-embedding-97m-multilingual-r2` by default) to embed the primary `eventSignature + source titles + noveltyNote` into `data/magazine/event-signature-index.sqlite3`. Exact primary-signature/source reuse is a hard failure. High embedding similarity without source reuse is a near-duplicate candidate for LLM novelty judgment; set `MAGAZINE_EVENT_SIGNATURE_STRICT=1` to fail those warnings during stricter runs. Article deletion removes the matching event-signature index row when present.

## Article Writing Harness

The default profile is `v2`, defined in `config/magazine-article-style-v2.prompt.md` and checked by `scripts/magazine_article_quality_check.mjs`. It keeps publication integrity, evidence, exact-event novelty, files, topics, and image rights as blocking gates. Length, paragraph count, H2 rhythm, optional wit, quotation count, five-source density, and issue-slate mix are advisory signals and do not automatically trigger a rewrite. The writer receives at most the newest 24 eligible local news candidates in its initial prompt and can inspect the local store when older context is needed.

Magazine v2's default commission is the original Korean longform standard in `config/magazine-longform-editorial-standard.prompt.md`. It targets the argumentative and reporting depth of a substantial weekend essay or reported review: an early contestable thesis, evidence with distinct functions, a serious counterargument, historical or institutional context where useful, concrete consequences, deliberately uneven section rhythm, and an ending that sharpens rather than repeats the opening. The usual Korean scope is roughly 5,500-8,500 non-space characters, but the reviewer must never turn that range into a character-count gate. A materially thin brief can fail only when semantic review identifies the missing argumentative work in the actual article.

Natural Korean is part of publication integrity, not an optional polish pass. After research, the writer first converts evidence into a Korean semantic map of confirmed facts, actors, actions, causal links, counterargument, uncertainty, and conclusion, then drafts from that map without preserving source-language sentence order or rhetorical images. Repeated abstract personification, noun-phrase chains, omitted semantic relations used only for symmetry, manufactured aphorisms, and headlines that require mental back-translation are a blocking `pervasive-unidiomatic-korean` failure when they shape the article as a whole. The repair path is a full rewrite from the semantic map, not keyword replacement or sentence-by-sentence humanizing. A separate generic Korean-humanize layer is not part of Magazine generation. Clear, restrained explanatory Korean is valid Magazine prose; report-like cadence, limited warmth, missing scenes, or consolidatable repetition remain advisory unless unsupported padding prevents the argument from advancing.

Approved Korean few-shot exemplars are local runtime assets under `data/magazine/editorial-exemplars/<exemplar-id>/`. Each exemplar contains `article.md`, `metadata.json`, and `editorial-map.json`; only metadata with `approved:true` is eligible. `config/magazine-editorial-exemplars.json` controls the root, count, and prompt-size limits. The default Codex writer receives exactly three approved article bodies, not their editorial maps or repository instructions. Exemplar facts and source lists are never evidence for a new article, and the writer is explicitly prohibited from copying their wording, metaphors, title patterns, named entities, or section order. The active exemplar ids are recorded in `metadata.generationAgent.editorialExemplars`. The runtime directory remains gitignored because these exemplars may be derived from the user's private World Memory and are not release assets by default.

Run `node scripts/magazine_editorial_exemplar_check.mjs --strict` before setting or retaining `approved:true`. The checker verifies the local package contract and reports the longform scope as an advisory; factual accuracy, argumentative quality, and originality still require semantic editorial review.

The previous exhaustive contract remains unchanged as the `legacy` profile in `config/magazine-article-style.prompt.md` and `scripts/magazine_article_style_check.mjs`. Use `--harness legacy` or `MAGAZINE_HARNESS_PROFILE=legacy` for compatibility or comparison runs. Legacy reader-tone and quote-flow self-classification metadata remains readable but is not required by v2.

The default Codex writer performs its semantic editorial check inside the same structured one-shot response. It stores `metadata.editorialReviewDecision` with `policy:"magazine-editorial-review-v2"`, `method:"LLM_INTEGRATED_ONE_SHOT_REVIEW"`, `publicationReady`, and concrete `issues[]`. A false readiness value or any blocking issue stops the cycle without an LLM repair call. Advisory findings remain visible without forcing repair. The opt-in agentic comparison path retains the independent `method:"LLM_SEMANTIC_REVIEW"` reviewer.

The default Codex v2 path separates editorial work from operations without changing the prose contract. The scheduler sends every eligible post-update News Feed candidate to one isolated structured decision turn; there is no candidate-count cap. That decision chooses the cycle count and locked article angles. Each actual writer receives only its locked topic, all semantically selected evidence ids, and exactly three approved prose exemplars in one isolated turn. The writer cannot use tools or load repository instructions. For a one-article generator run, the existing image worker starts from the locked topic at the same time as the writer. If early image preparation fails, only the image worker retries after writing.

The default Codex v2 writer is ephemeral and must complete in exactly one turn with zero tool calls. It never uses `codex exec resume`, `--last`, an independent reviewer, or a writer repair loop. Local quality, novelty, embedding, or integrated-review failures stop the cycle; only image failure may retry the image worker. The previous multi-turn implementation remains available only for an explicit comparison run with `--pipeline agentic`.

Codex Magazine passes request JSON events and log the prompt character/byte count plus provider-reported input, cached-input, and output token usage when the CLI exposes it. This telemetry is diagnostic only and never changes the editorial decision or article contract.

The detailed rules below document the legacy profile and historical editorial preferences. For v2 generation, the shorter v2 prompt is authoritative where the two profiles differ.

Magazine article prose should feel edited, not templated.

- Do not expose internal retrieval language in reader-facing body copy. Avoid phrases like "World Memory", "월드 메모리", "월드메모리", "World Memory vector search results", "월드 메모리 벡터 검색 결과", "News Feed", "post-cutoff", "post-World-Memory-update", "컷오프", "수집 기사", or source-pipeline words like "피드" in `deck`, `summary`, and `article.html`.
- Do not mechanically replace those internal labels with one fixed substitute. Write the sentence as a newspaper article would. Examples: `Bloomberg가 전한 장중 보도`, `같은 날 나온 ISNA 인용 발언`, `새 가격 반응`, `새 기업 공시`, `최근 현지 매체 보도`, or another source-specific phrase that fits the paragraph. Never write source labels as `계열 피드`, `새 피드`, or similar data-pipeline language.
- During article drafting, leave `metadata.title` empty. The generator finalizes it after `article.html` exists by sending only the article body text to a separate title pass. That pass asks for a readable Korean headline in a Bloomberg or Financial Times style and writes the returned one-line title into `metadata.json`.
- Do not include editorial-process placeholders such as "편집회의 체크리스트" in the article body. Store future production notes in metadata or a separate editorial feature when that UI exists.
- Do not use a fixed `H2 + two paragraphs` rhythm. Assign each section a job and vary paragraph counts naturally. A short lead section may use two paragraphs, a data section may need three to five, a mechanism section may need two or three, and a conclusion may be brief.
- Keep the section's editorial job backstage. Headings and body copy should state the actual competing claim, actor, evidence, incentive, or consequence instead of announcing `강한 반론`, `반론`, `시장 메커니즘`, `논증 전환`, or similar outline labels. Preserve such wording only when a named participant or formal source genuinely uses it and the label itself is newsworthy.
- Do not write as if teaching or scolding the reader. Avoid repeating command-heavy phrasing such as `봐야 합니다`, `확인해야 합니다`, `점검해야 합니다`, `잊으면 안 됩니다`, and `투자자는 ...해야 합니다`. Prefer observational magazine prose that lets facts, scenes, quotes, and numbers carry the point.
- `투자자` may appear as a third-party article subject, such as foreign investors, bond investors, institutional investors, or market participants named by a source. Do not call the reader `투자자`, `투자자 여러분`, or write generic reader-address sentences like `투자자는 ...해야 합니다`.
- Do not bundle the ending into a mini checklist under headings such as `다음 확인 지점`, `앞으로 볼 것`, or `남은 확인 변수`. Even without those headings, later sections must not tell readers what they should watch, check, monitor, distinguish, or reflect. If the article needs forward-looking context, write it as market implication, unresolved tension, or an evidence-based open question, not as instructions for what the reader should monitor next.
- Reader-directive detection is an LLM classification contract, not text matching. The generator must store `metadata.readerToneDecision` with `policy:"magazine-reader-tone-v1"`, `method:"LLM_CLASSIFICATION_ONLY"`, `noTextMatching:true`, `readerDirective:false`, `readerAddressedAsInvestor:false`, `checklistConclusion:false`, and at least one `lateSectionReviews[]` item. Valid late-section classifications are `market_observation`, `unresolved_tension`, `evidence_based_implication`, and `third_party_market_participant`; `reader_directive`, `checklist_conclusion`, and `mixed` fail strict validation.
- Avoid generic repeated explainers. If an issue has already been covered recently, the new article should be a follow-up about what changed, what assumption moved, what price reacted differently, or what new data point now matters.
- For deep analysis articles, include concrete numbers, source-backed comparisons, and chart blocks. The article should explain what moves, why it moves, who pays, and which indicators confirm or falsify the thesis.
- When research contains attributable comments from executives, analysts, policymakers, traders, agencies, or other named stakeholders, use them as evidence instead of flattening everything into summary prose. In running prose, write attribution naturally, such as `Morgan Stanley(모건스탠리)의 Michael Wilson(마이클 윌슨)은 "..."라고 말했습니다` or `U.S. Energy Information Administration(EIA·미국 에너지정보청)에 따르면 ...입니다`. Prefer direct quote treatment when exact wording is verified. If the exact wording is not verified, do not use quotation marks; use only the amount of indirect attribution needed to identify the source and claim.
- If research finds a materially relevant actual statement from a named person, company, agency, policymaker, analyst, trader, or other stakeholder, do not flatten it into anonymous summary. Use a direct quote when exact wording is verified. Use explicit indirect attribution only when exact wording is not verified, the full wording is too long to quote cleanly, or a short source attribution is enough.
- Do not fix quote-flow problems by deleting direct quotes. If a verified direct quote repeats a prior paraphrase, keep the quote and rewrite the prior paraphrase as context, stakes, or market mechanism. A quote-free article is acceptable only when research finds no materially relevant verified stakeholder statement.
- Do not indirectly paraphrase a statement and then attach a direct quote that says the same thing. If exact wording is verified and the quote is worth using, let the direct quote be the first expression of that claim. The preceding sentence should explain why this voice matters, not summarize the quote in advance.
- Quotes and attributions are not decorative proof stamps. Do not explain the whole point in body prose and then repeat it in a quote. A quoted or attributed moment should do one clear job: introduce a new fact, sharpen disagreement, explain the implication of a number, reveal who benefits or pays, or set up the next paragraph's mechanism.
- Make the prose around a quote do real work. The sentence before the quote should create the need for that source voice without restating it, and the sentence after it should use the quote to move the article forward. If the quote does not change what the reader understands, keep the verified direct quote and rewrite the preceding paraphrase as context, or remove the quote entirely.
- Write media, organization, and personal names in the form a Korean reader would naturally encounter. Do not mechanically attach an original-language name to every familiar proper noun. When a less familiar name or acronym genuinely needs disambiguation, introduce it once as `한국어명(원어명·약어)` or the shortest natural equivalent, such as `미국 에너지정보청(EIA)`, and then use the Korean short form or acronym.
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

- Direct quote text itself should be Korean in reader-facing magazine articles, even when the source quote is in English. Translate faithfully, preserve the meaning and level of certainty, and keep the original speaker/source attribution in the label. Do not invent quotes, speaker names, titles, dates, or source labels. If the source only supports an indirect summary, use brief indirect attribution rather than a direct quote block.
- A production-like generated article should usually include at least five `sourceBasis` entries and around four body-level direct quotes or necessary attribution moments. Treat this as a writing-balance target, not a mechanical quota. Weak, repetitive, indirect-quote-heavy, or disconnected quotes should be rewritten as high-signal direct quotes, tighter attribution, or removed.
- Quote-flow detection is an LLM classification contract, not text matching or quote counting. The generator must store `metadata.quoteFlowDecision` with `policy:"magazine-quote-flow-v1"`, `method:"LLM_CLASSIFICATION_ONLY"`, `noTextMatching:true`, `quoteFlowOk:true`, `directQuotePreferredWhenExactWordingVerified:true`, `directQuoteCoverageOk:true`, `indirectAttributionLimitedToUnverifiedWording:true`, `directQuoteAvoidance:false`, `repeatedIndirectBeforeDirectQuote:false`, `indirectAttributionOverused:false`, `ornamentalQuoteBlocks:false`, and at least one `reviews[]` item. Valid classifications are `direct_quote_integrated`, `necessary_indirect_attribution`, `source_attribution_without_repetition`, and `no_verified_statement_available`; `indirect_then_direct_repetition`, `direct_quote_avoidance`, `indirect_attribution_overused`, `ornamental_quote_block`, and `mixed` fail strict validation.
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

Run the default v2 quality and novelty check before publishing generated articles:

```bash
node scripts/magazine_article_quality_check.mjs
node scripts/magazine_article_quality_check.mjs --strict
```

Run the unchanged legacy checker only for a legacy comparison:

```bash
node scripts/magazine_article_style_check.mjs --strict
```

Generate a fresh issue through the connected Codex CLI. `simple` is the default:

```bash
node scripts/magazine_generate_with_codex.mjs --count 1 --harness v2 --pipeline simple
```

The generator edits only local Magazine runtime folders. The default path locks the topic, runs one-turn structured writing and existing image sourcing concurrently, installs the verified bitmap and rights metadata, applies the existing cover classifier, then runs `node scripts/magazine_article_quality_check.mjs --strict` and the event-signature embedding check. It does not run an independent title, review, or repair LLM. The scheduler invokes one generator process per article. Use `--pipeline agentic` only for a deliberate legacy-cost comparison; `--harness legacy` retains the older legacy contract.

For a non-publishing comparison, `scripts/magazine_generate_simple.mjs` runs the same isolated structured writer without image, cover, quality, embedding, or publish finalizers. Any tool call or stage turn count other than one fails the experiment. It writes `article.md`, `metadata.json`, and `generation-telemetry.json` below `data/magazine/simple-tests/`:

```bash
node scripts/magazine_generate_simple.mjs \
  --topic-file data/magazine/simple-tests/example-input.json \
  --output-dir data/magazine/simple-tests/example-output \
  --model gpt-5.6-sol \
  --reasoning medium
```

Use `--discover-all` instead of `--topic-file` to test the complete candidate path. This reads every News Feed item after `data/world-memory/collector-state.json` `collector.lastSuccessfulAt` without a candidate-count cap, submits the complete compact candidate set to one semantic LLM selection turn, and passes only the selected evidence ids to the one-turn three-exemplar writer. Telemetry records the eligibility cutoff, complete candidate count, selected evidence count, and both stages separately:

```bash
node scripts/magazine_generate_simple.mjs \
  --discover-all \
  --output-dir data/magazine/simple-tests/all-candidates-output \
  --model gpt-5.6-sol \
  --reasoning medium
```

The scheduler and production generator now reuse this bounded writer contract. Do not copy test output into `data/magazine/articles/`; production still has to pass the image, cover, local quality, and event-signature gates.

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

Do not store this switch, the scheduler interval, or the per-cycle maximum article count in browser memory or localStorage. The Settings page must read/write the file-backed `/api/magazine/settings` endpoint. Magazine can only be enabled when World Memory is enabled; turning World Memory off also writes Magazine off.

When the local web server starts, it starts the magazine scheduler only if both World Memory and Magazine are enabled, and unless `FINANCE_AGENT_MAGAZINE_SCHEDULER_DISABLED=1` or `FINANCE_AGENT_MAGAZINE_AUTORUN=0` is set.

Default behavior:

- first scheduled run: about 6 hours after server start by default
- recurring interval: 6 hours by default, adjustable from 1-10 hours in Settings
- per cycle article count: model editorial judgment from 0 to the configured maximum, never random
- per cycle maximum article count: 2 by default, adjustable from 1-3 in Settings; this is an upper bound, not a guaranteed generation count
- generation order: sequential, one `--count 1` generator run at a time
- replacement policy: `replace=false`, so scheduled runs append new article folders rather than replacing the issue
- retry policy: failed scheduled cycles retry every 15 minutes until the next regular update slot
- retry window: if a cycle still cannot complete before its next regular update slot, that cycle is closed and no longer carries work forward
- deadline policy: if a cycle reaches the next regular update slot before its planned article count is filled, the article already being generated may finish, but any not-yet-started articles are canceled; the next new writing attempt waits 15 minutes after the slot or after the in-flight article is sent

The scheduler asks the selected local agent provider for an `articleCountDecision` JSON object before a new regular cycle starts. The decision must include `targetCount`, `confidence`, `reason`, and optional `candidateAngles`. `targetCount=0` is valid only when the model judges that there is no clearly article-worthy new angle after checking the evidence bundle, recent magazine articles, and reader preference/bias signals. `targetCount` must not exceed the configured maximum article count, but that maximum never forces the scheduler to create that many articles. A successful non-fallback decision is reused only when a SHA-256 fingerprint of the complete decision evidence and selected agent settings is identical; the volatile wall-clock field is excluded, while News Feed items, World Memory/scout context, recent articles, preferences, bias, lane, maximum count, provider, model, reasoning, and speed remain part of the fingerprint. Any evidence or agent change invalidates the cache. Failed/fallback decisions are never cached. If the count-decision model call fails, the scheduler records a fallback decision and conservatively attempts one article rather than silently skipping the cycle.

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

`PATCH /api/magazine/settings` also accepts `{"schedulerMaxArticlesPerCycle":2}`. The value is stored in `config/magazine.user.json`, defaults to `2`, and is clamped to the Settings UI range of 1-3 articles. This setting is the maximum the model may choose for a cycle; the decision harness can still select fewer articles, including `targetCount=0`, when the evidence does not support more.

`PATCH /api/magazine/settings` also accepts `{"writingProvider":"codex-cli","writingModel":"gpt-5.6-sol","writingReasoning":"max","writingSpeed":"priority"}`. These values stay independent from the default chat agent and drive article-count judgment, article generation, every title/classification/repair pass, Magazine comments, and the Magazine sidebar runtime. The Settings page orders the controls as provider, model, model-specific reasoning, then speed only when that model/reasoning combination advertises a real speed tier. Codex `priority` is executed as `-c service_tier="priority"`; unsupported or stale speed values fall back to `standard`. The local CLI model catalog can be reloaded on demand. Antigravity CLI 1.1.1 exposes neither a reasoning flag nor a speed flag: entries such as `Gemini 3.5 Flash (High)` and `Claude Sonnet 4.6 (Thinking)` are complete model variants, so the separate reasoning and speed selectors stay hidden.

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
