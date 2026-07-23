import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildMagazineTopicDiscoverySlots,
  chooseMagazineTopicDiscoveryLane,
  compactPostCutoffNewsFeedItemsForDecision,
  compactWorldMemoryScoutCandidatesForDecision,
  decideMagazineArticleSlotTopic,
  fallbackMagazineArticleCountDecision,
  magazineArticleCountEvidenceFingerprint,
  normalizeMagazineSchedulerNextRunAt,
  normalizeMagazineArticleCountDecision,
  reuseMagazineArticleCountDecision,
} from "../server/magazineApi.mjs";
import {
  normalizeMagazineSchedulerIntervalHours,
  normalizeMagazineSchedulerMaxArticlesPerCycle,
  normalizeMagazineWritingModel,
  normalizeMagazineWritingReasoning,
  normalizeMagazineWritingSpeed,
} from "../server/magazineSettings.mjs";
import {
  normalizeWorldMemoryManagementModel,
  normalizeWorldMemoryManagementReasoning,
  normalizeWorldMemoryManagementSpeed,
} from "../server/worldMemorySettings.mjs";
import {
  getSpeedOptionsForReasoning,
  modelGroupsFromAntigravityCatalog,
} from "../src/agent/agentOptions.js";
import {
  codexServiceTierArgs,
  codexSpeedOptionsFromModel,
  normalizeCodexSpeed,
} from "../server/agentSpeed.mjs";
import {
  buildCodexArgs,
  buildCodexResumeArgs,
  buildCoverClassificationPrompt,
  buildCoverRebuildPrompt,
  buildEditorialReviewPrompt,
  buildV2Prompt,
  extractCodexSessionId,
  extractCodexTokenUsage,
  htmlForEditorialReview,
  installPreparedHero,
  normalizeCoverClassificationDecision,
  normalizeCoverRebuildDecision,
  normalizeGeneratedResearchMode,
  normalizeLockedTopic,
} from "../../scripts/magazine_generate_with_codex.mjs";

test("magazine scheduler preserves a model decision to skip with reason", () => {
  const decision = normalizeMagazineArticleCountDecision(
    {
      targetCount: 0,
      confidence: 0.88,
      reason: "최근 기사와 다른 독립 각도가 부족합니다.",
      candidateAngles: [],
    },
    {
      maxCount: 3,
      provider: "antigravity-cli",
      model: "Gemini 3.5 Flash (Medium)",
      reasoning: "medium",
    },
  );

  assert.equal(decision.schemaOk, true);
  assert.equal(decision.targetCount, 0);
  assert.equal(decision.basis, "llm-editorial-judgment");
  assert.equal(decision.provider, "antigravity-cli");
  assert.match(decision.reason, /독립 각도/);
});

test("magazine scheduler clamps model count decisions to the configured maximum", () => {
  const decision = normalizeMagazineArticleCountDecision(
    {
      targetCount: 9,
      confidence: 0.73,
      reason: "후보가 많지만 설정 상한을 따른다.",
      candidateAngles: [
        { title: "A", reason: "첫 번째 후보", urgency: "high" },
        { title: "B", reason: "두 번째 후보", urgency: "medium" },
        { title: "C", reason: "세 번째 후보", urgency: "low" },
        { title: "D", reason: "초과 후보", urgency: "high" },
      ],
    },
    { maxCount: 3 },
  );

  assert.equal(decision.targetCount, 3);
  assert.equal(decision.candidateAngles.length, 3);
  assert.equal(decision.candidateAngles[0].urgency, "high");
});

test("magazine scheduler preserves every semantically selected evidence id without a fixed cap", () => {
  const newsFeedIds = Array.from({ length: 15 }, (_, index) => `nf_${index + 1}`);
  const decision = normalizeMagazineArticleCountDecision(
    {
      targetCount: 1,
      confidence: 0.9,
      reason: "직접 연결된 정책 발언과 가격 반응을 한 기사로 묶습니다.",
      candidateAngles: [{
        title: "에너지 충격과 금리",
        reason: "각 근거가 서로 다른 정책 또는 시장 역할을 맡습니다.",
        urgency: "high",
        storyFamily: "에너지와 통화정책",
        editorialAngle: "공급 충격이 금리로 번지는 경로",
        primaryEvent: "중앙은행이 에너지 충격 속에서 금리를 동결했다",
        newsFeedIds,
        researchQueries: [],
      }],
    },
    { maxCount: 1 },
  );
  assert.deepEqual(decision.candidateAngles[0].newsFeedIds, newsFeedIds);
  assert.deepEqual(normalizeLockedTopic({
    title: "에너지 충격과 금리",
    newsFeedIds,
  }).newsFeedIds, newsFeedIds);
});

test("magazine scheduler fallback is explicit and never random", () => {
  const decision = fallbackMagazineArticleCountDecision({
    maxCount: 3,
    provider: "codex-cli",
    model: "gpt-5.5",
    reasoning: "high",
    error: "model unavailable",
  });

  assert.equal(decision.targetCount, 1);
  assert.equal(decision.fallback, true);
  assert.equal(decision.basis, "fallback-after-model-decision-failure");
  assert.match(decision.reason, /1건/);
  assert.match(decision.error, /model unavailable/);
});

test("magazine scheduler reuses only exact non-fallback evidence decisions", () => {
  const agent = { provider: "codex-cli", model: "gpt-5.6-sol", reasoning: "medium", speed: "standard" };
  const firstContext = {
    now: "2026-07-23T01:00:00.000Z",
    maxTargetCount: 2,
    newsFeed: { storeUpdatedAt: "2026-07-23T00:55:00.000Z", postCutoffItems: [{ id: "nf_1" }] },
    recentArticles: [{ id: "article-a" }],
  };
  const sameEvidenceLater = { ...firstContext, now: "2026-07-23T02:00:00.000Z" };
  const changedEvidence = {
    ...sameEvidenceLater,
    newsFeed: { ...sameEvidenceLater.newsFeed, postCutoffItems: [{ id: "nf_1" }, { id: "nf_2" }] },
  };
  const fingerprint = magazineArticleCountEvidenceFingerprint(firstContext, agent);

  assert.equal(magazineArticleCountEvidenceFingerprint(sameEvidenceLater, agent), fingerprint);
  assert.notEqual(magazineArticleCountEvidenceFingerprint(changedEvidence, agent), fingerprint);
  const reused = reuseMagazineArticleCountDecision({
    evidenceFingerprint: fingerprint,
    reuseCount: 0,
    decision: { schemaOk: true, fallback: false, targetCount: 1, basis: "llm-editorial-judgment" },
  }, fingerprint);
  assert.equal(reused.targetCount, 1);
  assert.equal(reused.cacheHit, true);
  assert.equal(reused.reuseCount, 1);
  assert.equal(reuseMagazineArticleCountDecision({
    evidenceFingerprint: fingerprint,
    decision: { schemaOk: true, fallback: true, targetCount: 1 },
  }, fingerprint), null);
});

test("magazine scheduler includes every post-cutoff News Feed item in decision context", () => {
  const cutoffMs = Date.parse("2026-07-03T12:00:00.000Z");
  const items = Array.from({ length: 32 }, (_, index) => ({
    id: `nf-${String(index + 1).padStart(2, "0")}`,
    feedTitle: "First Squawk",
    translatedTitle: `후보 ${index + 1}`,
    publishedAt: new Date(cutoffMs + (index + 1) * 60_000).toISOString(),
  }));
  items.push({
    id: "nf-before-cutoff",
    feedTitle: "First Squawk",
    translatedTitle: "이전 후보",
    publishedAt: new Date(cutoffMs - 60_000).toISOString(),
  });

  const compacted = compactPostCutoffNewsFeedItemsForDecision(items, cutoffMs);

  assert.equal(compacted.length, 32);
  assert.equal(compacted[0].id, "nf-32");
  assert.equal(compacted.at(-1).id, "nf-01");
  assert.equal(compacted.some((item) => item.id === "nf-before-cutoff"), false);
});

test("magazine topic discovery lane uses a true 12 percent scout branch", () => {
  assert.equal(chooseMagazineTopicDiscoveryLane({ roll: 0 }).id, "world-memory-scout");
  assert.equal(chooseMagazineTopicDiscoveryLane({ roll: 11 }).id, "world-memory-scout");
  assert.equal(chooseMagazineTopicDiscoveryLane({ roll: 12 }).id, "news-feed-primary");
  assert.equal(chooseMagazineTopicDiscoveryLane({ roll: 99 }).id, "news-feed-primary");
});

test("magazine topic discovery rolls independently for each article slot", () => {
  const slots = buildMagazineTopicDiscoverySlots(3, { rolls: [0, 12, 11] });

  assert.deepEqual(
    slots.map((slot) => slot.topicDiscoveryLane.id),
    ["world-memory-scout", "news-feed-primary", "world-memory-scout"],
  );
  assert.deepEqual(
    slots.map((slot) => slot.index),
    [1, 2, 3],
  );
  assert.deepEqual(
    slots.map((slot) => slot.topicDiscoveryLane.randomRoll),
    [0, 12, 11],
  );
});

test("magazine news-feed slots reuse the count-decision candidate as locked preflight", async () => {
  const candidate = { title: "뉴욕 구독 규제", reason: "새 규칙 채택", urgency: "medium" };
  const result = await decideMagazineArticleSlotTopic({
    cycle: {
      agent: { provider: "codex-cli", model: "gpt-5.6-sol" },
      articleCountDecision: { confidence: 0.9, candidateAngles: [candidate] },
    },
    index: 0,
    slot: { topicDiscoveryLane: { id: "news-feed-primary", label: "News Feed 우선" } },
  });
  assert.equal(result.decision.policy, "magazine-slot-topic-reuse-v2");
  assert.deepEqual(result.candidateAngle, candidate);
});

test("magazine World Memory scout candidates dedupe recent article anchors", () => {
  const rows = [
    {
      event_id: "already-covered",
      title: "이미 다룬 후보",
      summary: "최근 기사와 같은 이벤트",
      importance: "medium",
      entry_mode: "brief",
      as_of: "2026-07-03T12:00:00.000Z",
    },
    {
      event_id: "quiet-signal",
      title: "조용하지만 흥미로운 후보",
      summary: "메인 뉴스에 덜 잡히는 산업 신호",
      why_it_matters: "후속 공시와 가격 반응으로 커질 수 있다.",
      importance: "medium",
      entry_mode: "brief",
      as_of: "2026-07-03T13:00:00.000Z",
      industries: ["power_grid"],
      sources: [{ name: "Bloomberg" }],
    },
    {
      event_id: "same-story",
      title: "같은 스토리 후보 A",
      summary: "중복 스토리",
      importance: "medium",
      entry_mode: "brief",
      as_of: "2026-07-03T14:00:00.000Z",
      story_key: "same-story-key",
    },
    {
      event_id: "same-story-2",
      title: "같은 스토리 후보 B",
      summary: "중복 스토리",
      importance: "medium",
      entry_mode: "brief",
      as_of: "2026-07-03T15:00:00.000Z",
      story_key: "same-story-key",
    },
  ];

  const compacted = compactWorldMemoryScoutCandidatesForDecision(
    rows,
    [{ worldMemoryEventIds: ["already-covered"] }],
    { nowMs: Date.parse("2026-07-04T00:00:00.000Z"), limit: 10 },
  );

  assert.equal(compacted.some((item) => item.eventId === "already-covered"), false);
  assert.equal(compacted.some((item) => item.eventId === "quiet-signal"), true);
  assert.equal(compacted.filter((item) => item.title.startsWith("같은 스토리 후보")).length, 1);
});

test("magazine scheduler normalizes manual next-run timestamps", () => {
  const nextRunAt = normalizeMagazineSchedulerNextRunAt("2026-06-30T17:30:00+09:00", {
    nowMs: Date.parse("2026-06-30T17:00:00+09:00"),
  });

  assert.equal(nextRunAt, "2026-06-30T08:30:00.000Z");
});

test("magazine scheduler rejects manual next-run timestamps in the past", () => {
  assert.throws(
    () =>
      normalizeMagazineSchedulerNextRunAt("2026-06-30T17:30:00+09:00", {
        nowMs: Date.parse("2026-06-30T17:31:00+09:00"),
      }),
    /future/,
  );
});

test("magazine scheduler interval defaults to 6 hours and stays in the settings range", () => {
  assert.equal(normalizeMagazineSchedulerIntervalHours(undefined), 6);
  assert.equal(normalizeMagazineSchedulerIntervalHours(0), 1);
  assert.equal(normalizeMagazineSchedulerIntervalHours(99), 10);
  assert.equal(normalizeMagazineSchedulerIntervalHours("4"), 4);
});

test("magazine scheduler max articles defaults to 2 and stays in the settings range", () => {
  assert.equal(normalizeMagazineSchedulerMaxArticlesPerCycle(undefined), 2);
  assert.equal(normalizeMagazineSchedulerMaxArticlesPerCycle(0), 1);
  assert.equal(normalizeMagazineSchedulerMaxArticlesPerCycle(99), 3);
  assert.equal(normalizeMagazineSchedulerMaxArticlesPerCycle("3"), 3);
});

test("magazine writing reasoning accepts only known CLI reasoning levels", () => {
  assert.equal(normalizeMagazineWritingReasoning("minimal"), "minimal");
  assert.equal(normalizeMagazineWritingReasoning("LOW"), "low");
  assert.equal(normalizeMagazineWritingReasoning("xhigh"), "xhigh");
  assert.equal(normalizeMagazineWritingReasoning("max"), "max");
  assert.equal(normalizeMagazineWritingReasoning("ultra"), "ultra");
  assert.equal(normalizeMagazineWritingReasoning("turbo"), "");
});

test("feature-specific model settings keep safe catalog values", () => {
  assert.equal(normalizeMagazineWritingModel("gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(normalizeMagazineWritingModel("Gemini 3.5 Flash (High)\n"), "Gemini 3.5 Flash (High)");
  assert.equal(normalizeMagazineWritingSpeed("priority"), "priority");
  assert.equal(normalizeMagazineWritingSpeed("turbo"), "standard");
  assert.equal(normalizeWorldMemoryManagementModel("gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(normalizeWorldMemoryManagementReasoning("ULTRA"), "ultra");
  assert.equal(normalizeWorldMemoryManagementSpeed("fast"), "priority");
});

test("Antigravity catalog models embed reasoning instead of exposing a second selector", () => {
  const groups = modelGroupsFromAntigravityCatalog({
    models: [
      {
        name: "Gemini 3.5 Flash (High)",
        displayName: "Gemini 3.5 Flash (High)",
        reasoningLevel: "High",
        selectable: true,
      },
    ],
  });

  assert.equal(groups[0].reasoningEmbedded, true);
  assert.equal(groups[0].defaultReasoningLevel, "high");
  assert.deepEqual(groups[0].reasoningLevels.map((item) => item.id), ["high"]);
  assert.deepEqual(groups[0].speedOptions, []);
});

test("Antigravity Thinking is a model variant with no separate speed control", () => {
  const groups = modelGroupsFromAntigravityCatalog({
    models: [
      {
        name: "Claude Sonnet 4.6 (Thinking)",
        displayName: "Claude Sonnet 4.6 (Thinking)",
        reasoningLevel: "Thinking",
        selectable: true,
      },
    ],
  });

  assert.equal(groups[0].reasoningControl, "model-variant");
  assert.equal(groups[0].speedControl, "unsupported");
  assert.equal(groups[0].reasoningLevels[0].label, "사고 모드 (Thinking)");
  assert.deepEqual(getSpeedOptionsForReasoning(groups[0], "thinking").map((item) => item.id), ["standard"]);
});

test("Codex speed tiers are filtered by the selected reasoning level", () => {
  const speedOptions = codexSpeedOptionsFromModel({
    supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
    service_tiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
        supported_reasoning_levels: [{ effort: "low" }],
      },
    ],
  });
  const group = { defaultReasoningLevel: "low", speedOptions };

  assert.deepEqual(getSpeedOptionsForReasoning(group, "low").map((item) => item.id), ["standard", "priority"]);
  assert.deepEqual(getSpeedOptionsForReasoning(group, "high").map((item) => item.id), ["standard"]);
  assert.equal(speedOptions[1].cli, '-c service_tier="priority"');
});

test("Codex priority speed reaches CLI arguments and fast aliases normalize", () => {
  assert.equal(normalizeCodexSpeed("fast"), "priority");
  assert.deepEqual(codexServiceTierArgs("standard"), []);
  assert.deepEqual(codexServiceTierArgs("priority"), ["-c", 'service_tier="priority"']);

  const args = buildCodexArgs({
    approval: "never",
    sandbox: "workspace-write",
    model: "gpt-5.6-terra",
    reasoning: "medium",
    speed: "priority",
    outputPath: "/tmp/article.txt",
    prompt: "test",
  });
  assert.equal(args.includes('service_tier="priority"'), true);
});

test("Magazine v2 writer persists a resumable Codex session without using --last", () => {
  const initialArgs = buildCodexArgs({
    approval: "never",
    sandbox: "workspace-write",
    model: "gpt-5.6-sol",
    reasoning: "medium",
    outputPath: "/tmp/writer.txt",
    prompt: "write",
    persistSession: true,
    jsonEvents: true,
  });
  assert.equal(initialArgs.includes("--ephemeral"), false);
  assert.equal(initialArgs.includes("--json"), true);

  const sessionId = "019f4d60-31df-7912-a647-6a98fdd017ef";
  const resumeArgs = buildCodexResumeArgs({
    sessionId,
    model: "gpt-5.6-sol",
    reasoning: "medium",
    outputPath: "/tmp/repair.txt",
    prompt: "repair",
  });
  assert.deepEqual(resumeArgs.slice(0, 3), ["exec", "resume", sessionId]);
  assert.equal(resumeArgs.includes("--last"), false);
});

test("Magazine v2 keeps invariant editorial context before per-run prompt data", () => {
  const articleDirectory = "/tmp/magazine-dynamic-stage";
  const prompt = buildV2Prompt({
    count: 1,
    replace: false,
    articleDirectory,
    staged: true,
    lockedTopic: { title: "테스트 소재", reason: "독립 근거", researchQueries: ["공식 자료"] },
  });

  const exemplarIndex = prompt.indexOf("승인된 한국어 장문 퓨샷:");
  const runIndex = prompt.indexOf("이번 실행:");
  const dynamicPathIndex = prompt.indexOf(articleDirectory);
  assert.equal(exemplarIndex >= 0, true);
  assert.equal(runIndex > exemplarIndex, true);
  assert.equal(dynamicPathIndex > runIndex, true);
});

test("Magazine v2 extracts explicit Codex session ids and normalizes locked topics", () => {
  const sessionId = "019f4d60-31df-7912-a647-6a98fdd017ef";
  assert.equal(
    extractCodexSessionId({ stdout: `${JSON.stringify({ type: "thread.started", thread_id: sessionId })}\n` }),
    sessionId,
  );
  assert.equal(extractCodexSessionId({ stderr: `session id: ${sessionId}\n` }), sessionId);
  assert.deepEqual(normalizeLockedTopic({
    title: "  새 규제 집행  ",
    reason: "독립 델타",
    newsFeedIds: ["nf_1", "nf_1", "nf_2"],
  }), {
    title: "새 규제 집행",
    reason: "독립 델타",
    storyFamily: "",
    editorialAngle: "",
    primaryEvent: "",
    newsFeedIds: ["nf_1", "nf_2"],
    researchQueries: [],
  });
});

test("Magazine v2 extracts Codex cached-input token telemetry", () => {
  assert.deepEqual(
    extractCodexTokenUsage({
      stdout: `${JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 12000, cached_input_tokens: 9000, output_tokens: 1800 },
      })}\n`,
    }),
    { inputTokens: 12000, cachedInputTokens: 9000, outputTokens: 1800 },
  );
});

test("Magazine v2 editorial review preserves article heading and paragraph boundaries", () => {
  const text = htmlForEditorialReview(`
    <p>첫 문단입니다.</p>
    <h2>사람은 움직이고 파일은 남습니다</h2>
    <p>다음 문단입니다.<br>둘째 줄입니다.</p>
  `);

  assert.equal(text, "첫 문단입니다.\n\n## 사람은 움직이고 파일은 남습니다\n\n다음 문단입니다.\n둘째 줄입니다.");
});

test("Magazine v2 semantic review keeps editorial scaffolding out of reader-facing copy", () => {
  const prompt = buildEditorialReviewPrompt({
    articleId: "sample",
    metadata: {},
    bodyText: "## 강한 반론: 실제로는 집행 능력이 문제입니다",
  });

  assert.match(prompt, /편집 구조 표찰/);
  assert.match(prompt, /경쟁하는 실제 주장·행위자·증거·결과/);
  assert.match(prompt, /blocking 범위/);
});

test("Magazine v2 semantic review blocks pervasive unidiomatic Korean instead of treating it as optional polish", () => {
  const prompt = buildEditorialReviewPrompt({
    articleId: "sample",
    metadata: {},
    bodyText: "지수가 장부에 묻고 호가가 매일 서명합니다.",
  });

  assert.match(prompt, /영어식 추상명사 주어/);
  assert.match(prompt, /역번역/);
  assert.match(prompt, /pervasive-unidiomatic-korean/);
  assert.match(prompt, /자연스러운 한국어 제목/);
  assert.match(prompt, /명료한 설명형·분석형 한국어는 허용/);
  assert.match(prompt, /보고서형 호흡.*advisory/);
});

test("Magazine v2 cover classification is an explicit semantic LLM contract", () => {
  const prompt = buildCoverClassificationPrompt({
    candidate: { articleId: "candidate", title: "새 정책 집행" },
    comparisonArticles: [{ articleId: "previous", title: "기존 시장 신호" }],
    worldMemorySignals: "- 가장 최근 이슈: 새 정책 집행",
  });

  assert.match(prompt, /독립 커버스토리 분류기/);
  assert.match(prompt, /텍스트 키워드 일치.*정규식으로 판정하지 않는다/);
  assert.match(prompt, /LLM_CLASSIFICATION_ONLY/);
  assert.match(prompt, /promote \| do-not-promote/);
});

test("Magazine v2 normalizes a complete cover classification and rejects omissions", () => {
  const normalized = normalizeCoverClassificationDecision({
    result: "promote",
    confidence: 0.91,
    candidateScore: 93,
    bestPreviousScore: 88,
    worldMemorySignals: {
      mostImportantIssue: "AI 전력망 투자",
      mostRecentIssue: "새 전력 조달 계약",
      query: "AI 전력 조달",
      hitIds: ["wm-1"],
    },
    rationale: "새 계약이 기존 비교창보다 최근성과 파급 범위에서 앞섭니다.",
  }, {
    comparisonArticleIds: ["previous-1", "previous-2"],
    evaluatedAt: "2026-07-23T16:00:00+09:00",
    totalArticleCount: 400,
    classifier: { provider: "codex-cli", model: "gpt-5.6-sol", reasoning: "low" },
  });

  assert.equal(normalized.policy, "world-memory-cover-v1");
  assert.equal(normalized.method, "LLM_CLASSIFICATION_ONLY");
  assert.equal(normalized.result, "promote");
  assert.deepEqual(normalized.comparisonWindow.articleIds, ["previous-1", "previous-2"]);
  assert.throws(
    () => normalizeCoverClassificationDecision({ result: "do-not-promote" }),
    /candidateScore/,
  );
});

test("Magazine cover rebuild selects exactly five known articles in rank order", () => {
  const candidateArticleIds = ["a", "b", "c", "d", "e", "f"];
  const source = {
    confidence: 0.89,
    worldMemorySignals: {
      mostImportantIssue: "중동 운송 위험",
      mostRecentIssue: "새 해운 보험료",
      query: "운송 위험 보험료",
      hitIds: [],
    },
    coverStories: ["a", "b", "c", "d", "e"].map((articleId, index) => ({
      articleId,
      rank: index + 1,
      score: 95 - index,
      rationale: `${articleId}를 현재 커버에 포함할 근거`,
    })),
  };
  const normalized = normalizeCoverRebuildDecision(source, {
    candidateArticleIds,
    evaluatedAt: "2026-07-23T16:00:00+09:00",
  });
  const prompt = buildCoverRebuildPrompt({
    candidates: candidateArticleIds.map((articleId) => ({ articleId })),
    worldMemorySignals: "- 중동 운송 위험",
  });

  assert.deepEqual(normalized.coverStories.map((item) => item.articleId), ["a", "b", "c", "d", "e"]);
  assert.match(prompt, /정확히 5건/);
  assert.throws(
    () => normalizeCoverRebuildDecision({ ...source, coverStories: source.coverStories.slice(0, 4) }, {
      candidateArticleIds,
    }),
    /exactly 5/,
  );
});

test("Magazine v2 normalizes improvised research mode labels from actual evidence", () => {
  assert.equal(normalizeGeneratedResearchMode({
    researchMode: "news-feed-first-with-external-research",
    newsFeed: { items: [{ id: "nf_1" }] },
  }), "news-feed-first");
  assert.equal(normalizeGeneratedResearchMode({
    newsFeed: { items: [{ id: "nf_1" }] },
    worldMemory: { vectorSearch: { hits: [{ id: "wm_1" }] } },
  }), "news-feed-with-world-memory-backup");
  assert.equal(normalizeGeneratedResearchMode({ sourceBasis: [{ url: "https://example.com" }] }), "external-research");
});

test("Magazine v2 installs an early prepared hero into the single written article", () => {
  const root = mkdtempSync(join(tmpdir(), "magazine-prepared-hero-"));
  try {
    const preparedArticleDir = join(root, "prepared", "locked-topic");
    const articleDirectory = join(root, "articles");
    const articleDir = join(articleDirectory, "written-article");
    mkdirSync(join(preparedArticleDir, "assets"), { recursive: true });
    mkdirSync(articleDir, { recursive: true });
    writeFileSync(join(preparedArticleDir, "assets", "hero.png"), Buffer.alloc(12 * 1024, 1));

    const patches = installPreparedHero({
      preparedHero: {
        preparedArticleDir,
        patch: {
          heroImage: {
            src: "assets/hero.png",
            alt: "검증 이미지",
            credit: "Source",
            sourceUrl: "https://example.com/hero",
            license: "Open",
          },
        },
      },
      articleDirectory,
    });

    assert.equal(patches.has("written-article"), true);
    assert.equal(existsSync(join(articleDir, "assets", "hero.png")), true);
    assert.deepEqual(readFileSync(join(articleDir, "assets", "hero.png")), Buffer.alloc(12 * 1024, 1));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
