import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMagazineTopicDiscoverySlots,
  chooseMagazineTopicDiscoveryLane,
  compactPostCutoffNewsFeedItemsForDecision,
  compactWorldMemoryScoutCandidatesForDecision,
  fallbackMagazineArticleCountDecision,
  normalizeMagazineSchedulerNextRunAt,
  normalizeMagazineArticleCountDecision,
} from "../server/magazineApi.mjs";
import {
  normalizeMagazineSchedulerIntervalHours,
  normalizeMagazineSchedulerMaxArticlesPerCycle,
  normalizeMagazineWritingReasoning,
} from "../server/magazineSettings.mjs";

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
  assert.equal(normalizeMagazineWritingReasoning("turbo"), "");
});
