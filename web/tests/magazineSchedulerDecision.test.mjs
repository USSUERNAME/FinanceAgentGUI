import test from "node:test";
import assert from "node:assert/strict";

import {
  fallbackMagazineArticleCountDecision,
  normalizeMagazineSchedulerNextRunAt,
  normalizeMagazineArticleCountDecision,
} from "../server/magazineApi.mjs";
import {
  normalizeMagazineSchedulerIntervalHours,
  normalizeMagazineSchedulerMaxArticlesPerCycle,
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
