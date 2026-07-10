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
  normalizeMagazineSchedulerNextRunAt,
  normalizeMagazineArticleCountDecision,
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
  extractCodexSessionId,
  htmlForEditorialReview,
  installPreparedHero,
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

test("Magazine v2 editorial review preserves article heading and paragraph boundaries", () => {
  const text = htmlForEditorialReview(`
    <p>첫 문단입니다.</p>
    <h2>사람은 움직이고 파일은 남습니다</h2>
    <p>다음 문단입니다.<br>둘째 줄입니다.</p>
  `);

  assert.equal(text, "첫 문단입니다.\n\n## 사람은 움직이고 파일은 남습니다\n\n다음 문단입니다.\n둘째 줄입니다.");
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
