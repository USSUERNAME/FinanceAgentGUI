import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDailyUserMemoryRollup,
  buildExternalNewsBriefing,
  extractExternalMarketSummaryFromBriefingText,
  normalizeExternalMarketSummaryCandidate,
  sanitizeWorldMemoryReportText,
} from "../server/sharedMemoryStore.mjs";

test("world memory context strips memory change suggestions", () => {
  const text = sanitizeWorldMemoryReportText({
    text: [
      "# World Memory 시장 상황 인식",
      "",
      "핵심 요약입니다.",
      "",
      "## 주요 변화",
      "- 유지되어야 할 시장 변화",
      "",
      "## 월드 메모리 변경 제안",
      "- 컨텍스트에 들어가면 안 되는 변경 제안",
      "",
      "## 포트폴리오/관찰 제안",
      "- 유지되어야 할 포트폴리오 관찰",
    ].join("\n"),
  });

  assert.match(text, /주요 변화/);
  assert.match(text, /포트폴리오/);
  assert.doesNotMatch(text, /변경 제안/);
  assert.doesNotMatch(text, /들어가면 안 되는/);
});

test("external briefing stores a market summary from the selected News Feed sample, not raw news", () => {
  const briefing = buildExternalNewsBriefing({
    builtAt: "2026-06-27T01:00:00.000Z",
    worldMemoryCutoffAt: "2026-06-27T00:20:00.000Z",
    worldReport: {
      generatedAt: "2026-06-27T00:30:00.000Z",
      view: {
        title: "World Memory 시장 상황 인식",
        summary: "유가와 금리가 완화됐지만 기술주 비용 검증이 남아 있다.",
        memoryChangeSuggestions: ["이 내용은 외부 레이어에 들어가면 안 된다."],
      },
    },
    newsStore: {
      items: [
        {
          feedTitle: "FinancialJuice",
          translatedTitle: "수집 이후 새 소식",
          translatedText: "시장에 영향을 줄 수 있는 새 뉴스",
          publishedAt: "2026-06-27T00:45:00.000Z",
        },
        {
          feedTitle: "FinancialJuice",
          translatedTitle: "보고서 작성 전이지만 수집 이후 새 소식",
          translatedText: "보고서 작성 시각이 아니라 월드메모리 수집 기준 이후라 포함되어야 하는 뉴스",
          publishedAt: "2026-06-27T00:25:00.000Z",
        },
        {
          feedTitle: "FinancialJuice",
          translatedTitle: "보고서 이전 오래된 소식",
          translatedText: "이미 월드 메모리에 반영됐을 가능성이 높은 뉴스",
          publishedAt: "2026-06-27T00:10:00.000Z",
        },
      ],
    },
    marketSummary: {
      marketTone: "mixed",
      summaryKo: "수집 이후 새 신호는 기술주 비용 검증과 유가 완화가 엇갈리는 혼재 국면으로 정리된다.",
      confidence: 0.68,
      alertLevel: "watch",
      severityKo: "엇갈린 신호가 있어 관찰은 필요하지만 긴급 절차를 실행할 정도의 충격은 아니다.",
      shouldCreateReport: false,
      pushSummary: "",
    },
    marketSummaryStatus: "translation-model",
    marketSummaryModel: "translation-test-model",
    marketSummaryProvider: "Codex CLI",
    marketSummaryReasoning: "low",
  });

  assert.equal(briefing.reportAt, "2026-06-27T00:30:00.000Z");
  assert.equal(briefing.collectionAt, "2026-06-27T00:20:00.000Z");
  assert.equal(briefing.consideredCount, 3);
  assert.match(briefing.text, /News Feed 기준 수집 시각: 2026-06-27T00:20:00.000Z/);
  assert.match(briefing.text, /월드 메모리 기준 시장 요약/);
  assert.match(briefing.text, /혼재 국면/);
  assert.match(briefing.text, /심각성 평가/);
  assert.match(briefing.text, /등급: watch/);
  assert.match(briefing.text, /긴급 절차: 대기/);
  assert.match(briefing.text, /translation-test-model/);
  assert.match(briefing.text, /대상 보도 수: 3/);
  assert.doesNotMatch(briefing.text, /핵심 신호/);
  assert.doesNotMatch(briefing.text, /주의점/);
  assert.doesNotMatch(briefing.text, /시장에 영향을 줄 수 있는 새 뉴스/);
  assert.doesNotMatch(briefing.text, /월드메모리 수집 기준 이후라 포함되어야 하는 뉴스/);
  assert.doesNotMatch(briefing.text, /보고서 이전 오래된 소식/);
  assert.doesNotMatch(briefing.text, /외부 레이어에 들어가면 안 된다/);
});

test("external briefing backfills to 30 recent news items when the post-collection window is thin", () => {
  const olderItems = Array.from({ length: 35 }, (_value, index) => ({
    feedTitle: "FinancialJuice",
    translatedTitle: `수집 전 최근 소식 ${index + 1}`,
    translatedText: "이미 기준 서술에 반영됐을 수 있으므로 요약문에 원문으로 누적하면 안 된다.",
    publishedAt: new Date(Date.parse("2026-06-27T00:39:00.000Z") - index * 60_000).toISOString(),
  }));
  const briefing = buildExternalNewsBriefing({
    builtAt: "2026-06-27T01:00:00.000Z",
    worldMemoryCutoffAt: "2026-06-27T00:40:00.000Z",
    worldReport: {
      generatedAt: "2026-06-27T00:42:00.000Z",
      view: {
        title: "World Memory 시장 상황 인식",
        summary: "기준 서술은 이미 직전 이벤트를 반영하고 있다.",
      },
    },
    newsStore: {
      items: [
        {
          feedTitle: "FinancialJuice",
          translatedTitle: "수집 이후 유일한 새 소식",
          translatedText: "월드메모리 수집 이후 새로 들어온 뉴스",
          publishedAt: "2026-06-27T00:45:00.000Z",
        },
        ...olderItems,
      ],
    },
    marketSummary: {
      marketTone: "mixed",
      summaryKo: "수집 이후 새 신호는 적지만 최근 보도 흐름까지 보면 시장은 혼재 국면으로 정리된다.",
      confidence: 0.61,
      alertLevel: "watch",
      severityKo: "최근 보도 표본을 보강해도 긴급 절차를 실행할 정도의 충격은 아니다.",
      shouldCreateReport: false,
      pushSummary: "",
    },
    marketSummaryStatus: "translation-model",
  });

  assert.equal(briefing.consideredCount, 30);
  assert.match(briefing.text, /대상 보도 수: 30/);
  assert.match(briefing.text, /최근 보도 흐름/);
  assert.doesNotMatch(briefing.text, /월드메모리 수집 이후 새로 들어온 뉴스/);
  assert.doesNotMatch(briefing.text, /이미 기준 서술에 반영됐을 수 있으므로/);
});

test("external briefing does not use report generation time as a News Feed cutoff", () => {
  const briefing = buildExternalNewsBriefing({
    builtAt: "2026-06-27T01:00:00.000Z",
    worldReport: {
      generatedAt: "2026-06-27T00:30:00.000Z",
      view: {
        title: "World Memory 시장 상황 인식",
        summary: "보고서는 있지만 수집 성공 시각은 없다.",
      },
    },
    newsStore: {
      items: [
        {
          feedTitle: "FinancialJuice",
          translatedTitle: "보고서 작성 이후 새 소식",
          translatedText: "수집 컷오프가 없으면 요약 대상이 아니다.",
          publishedAt: "2026-06-27T00:45:00.000Z",
        },
      ],
    },
  });

  assert.equal(briefing.reportAt, "2026-06-27T00:30:00.000Z");
  assert.equal(briefing.collectionAt, "");
  assert.equal(briefing.consideredCount, 0);
  assert.match(briefing.text, /News Feed 기준 수집 시각: 아직 없음/);
  assert.match(briefing.text, /분석할 수 있는 시장 요약 후보가 없습니다/);
  assert.doesNotMatch(briefing.text, /보고서 작성 이후 새 소식/);
  assert.doesNotMatch(briefing.text, /수집 컷오프가 없으면/);
});

test("external market summary harness rejects empty or non-Korean summaries", () => {
  const candidate = normalizeExternalMarketSummaryCandidate({
    marketTone: "mixed",
    summaryKo: "Market is mixed.",
    confidence: 2,
    alertLevel: "watch",
    severityKo: "긴급 절차 대상은 아니다.",
    shouldCreateReport: false,
    pushSummary: "",
  });

  assert.equal(candidate.ok, false);
  assert.match(candidate.error, /한국어/);
  assert.equal(candidate.confidence, 1);
});

test("external market summary harness accepts a summary without signal lists", () => {
  const candidate = normalizeExternalMarketSummaryCandidate({
    marketTone: "mixed",
    summaryKo: "시장 방향성은 아직 뚜렷하지 않다.",
    confidence: 0.4,
    alertLevel: "watch",
    severityKo: "관찰할 만한 신호는 있지만 긴급 절차 대상은 아니다.",
    shouldCreateReport: false,
    pushSummary: "",
  });

  assert.equal(candidate.ok, true);
  assert.equal(candidate.summaryKo, "시장 방향성은 아직 뚜렷하지 않다.");
  assert.equal(candidate.alertLevel, "watch");
  assert.equal(candidate.shouldCreateReport, false);
});

test("external market summary harness requires push summary for urgent reports", () => {
  const candidate = normalizeExternalMarketSummaryCandidate({
    marketTone: "risk_off",
    summaryKo: "시장 전반의 위험회피가 빠르게 확산되고 있다.",
    confidence: 0.82,
    alertLevel: "urgent",
    severityKo: "주요 자산 가격이 동시에 부정적으로 재평가되고 있어 긴급 확인이 필요하다.",
    shouldCreateReport: true,
    pushSummary: "",
  });

  assert.equal(candidate.ok, false);
  assert.match(candidate.error, /pushSummary/);
});

test("external briefing exposes a display market summary without generation metadata or legacy signal lists", () => {
  const summary = extractExternalMarketSummaryFromBriefingText([
    "# External Memory Layer",
    "",
    "브리핑 갱신: 2026-06-27T01:00:00.000Z",
    "",
    "## 월드 메모리 수집 이후 시장 요약",
    "요약 방식: translation-model",
    "모델 공급자: Codex CLI",
    "모델: translation-test-model",
    "reasoning: low",
    "대상 보도 수: 3",
    "",
    "시장 톤: mixed",
    "신뢰도: 0.72",
    "",
    "기술주 비용 검증과 유가 완화가 엇갈리는 혼재 국면이다.",
    "",
    "심각성 평가:",
    "등급: watch",
    "긴급 절차: 대기",
    "판단: 관찰할 만하지만 긴급 절차 대상은 아니다.",
    "",
    "핵심 신호:",
    "- 금리 부담은 완화됐지만 비용 검증은 남아 있다.",
    "- 이 줄도 화면에는 중복으로 보이면 안 된다.",
  ].join("\n"));

  assert.equal(summary.ok, true);
  assert.equal(summary.builtAt, "2026-06-27T01:00:00.000Z");
  assert.equal(summary.summaryMode, "translation-model");
  assert.equal(summary.provider, "Codex CLI");
  assert.equal(summary.model, "translation-test-model");
  assert.equal(summary.newsItemsConsidered, 3);
  assert.equal(summary.tone, "mixed");
  assert.equal(summary.confidence, "0.72");
  assert.equal(summary.alertLevel, "watch");
  assert.equal(summary.shouldCreateReport, false);
  assert.equal(summary.severityKo, "관찰할 만하지만 긴급 절차 대상은 아니다.");
  assert.match(summary.text, /혼재 국면/);
  assert.match(summary.text, /심각성 평가/);
  assert.match(summary.text, /등급: watch/);
  assert.doesNotMatch(summary.text, /요약 방식/);
  assert.doesNotMatch(summary.text, /시장 톤/);
  assert.doesNotMatch(summary.text, /신뢰도/);
  assert.doesNotMatch(summary.text, /핵심 신호/);
  assert.doesNotMatch(summary.text, /금리 부담/);
});

test("daily user memory rollup keeps notebook-like entries in one layer", () => {
  const rollup = buildDailyUserMemoryRollup("2026-06-27", [
    "- 09:00 [sidebar-chat] 투자 판단: 사용자는 구조적 변화 해석을 중시한다고 말했다.",
    "- 10:30 [sidebar-chat] 감정 맥락: 최근 손실 여부보다 판단 과정의 일관성을 더 중요하게 봤다.",
  ]);

  assert.match(rollup, /2026-06-27/);
  assert.match(rollup, /2건의 사용자 메모/);
  assert.match(rollup, /구조적 변화 해석/);
  assert.match(rollup, /감정 맥락/);
});
