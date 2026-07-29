import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioRiskActions,
  buildPortfolioRiskTrend,
  comparePortfolioRiskSnapshots,
  portfolioRiskSnapshot,
  updatePortfolioRiskHistory,
} from "../server/portfolioRiskHistory.mjs";

test("portfolio risk actions explain causes and bounded review steps", () => {
  const actions = buildPortfolioRiskActions({
    stockConcentration: [{ ticker: "NVDA", weight: 45, severity: "high" }],
    sectorConcentration: [{
      ticker: "XLK",
      label: "기술",
      weight: 62,
      tickers: ["NVDA", "MSFT"],
      severity: "high",
    }],
    thesisConflicts: [{
      ticker: "TSLA",
      sectorTicker: "XLY",
      sectorLabel: "경기소비재",
      reason: "금리 부담이 확대됐습니다.",
      confirmationCondition: "상대성과 반등 확인",
    }],
    unmapped: [{ ticker: "ABC", weight: 5 }],
  });
  assert.equal(actions.length, 4);
  assert.equal(actions[0].severity, "high");
  assert.ok(actions.every((item) => item.cause && item.checks.length && item.actions.length));
  assert.match(actions.find((item) => item.id === "stock:NVDA").cause, /45%/);
  assert.match(actions.find((item) => item.id === "sector:XLK").cause, /MSFT, NVDA/);
});

test("portfolio risk history records only high concentration and bounded conflicts", () => {
  const snapshot = portfolioRiskSnapshot({
    reportDate: "2026-07-29",
    quickPortfolioWeight: 75,
    riskReview: {
      stockConcentration: [
        { ticker: "NVDA", severity: "high" },
        { ticker: "MSFT", severity: "monitor" },
      ],
      sectorConcentration: [
        { ticker: "XLK", severity: "high" },
      ],
      thesisConflicts: [
        { ticker: "TSLA", sectorTicker: "XLY" },
      ],
      unmapped: [
        { ticker: "ABC" },
      ],
    },
  });
  assert.deepEqual(snapshot.stockHigh, ["NVDA"]);
  assert.deepEqual(snapshot.sectorHigh, ["XLK"]);
  assert.deepEqual(snapshot.thesisConflicts, ["TSLA:XLY"]);
  assert.deepEqual(snapshot.unmapped, ["ABC"]);
});

test("portfolio risk comparison separates new and resolved warnings", () => {
  const previous = {
    reportDate: "2026-07-28",
    stockHigh: ["NVDA"],
    sectorHigh: ["XLK"],
    thesisConflicts: [],
    unmapped: ["ABC"],
  };
  const current = {
    reportDate: "2026-07-29",
    stockHigh: ["TSLA"],
    sectorHigh: ["XLK"],
    thesisConflicts: ["TSLA:XLY"],
    unmapped: [],
  };
  const comparison = comparePortfolioRiskSnapshots(current, previous);
  assert.deepEqual(comparison.stockHigh.added, ["TSLA"]);
  assert.deepEqual(comparison.stockHigh.removed, ["NVDA"]);
  assert.deepEqual(comparison.thesisConflicts.added, ["TSLA:XLY"]);
  assert.deepEqual(comparison.unmapped.removed, ["ABC"]);
  assert.equal(comparison.addedCount, 2);
  assert.equal(comparison.removedCount, 2);
  assert.equal(comparison.direction, "unchanged");
});

test("portfolio risk history replaces a same-day snapshot without duplicating dates", () => {
  const history = [{
    reportDate: "2026-07-28",
    stockHigh: [],
    sectorHigh: [],
    thesisConflicts: [],
    unmapped: [],
  }, {
    reportDate: "2026-07-29",
    stockHigh: ["NVDA"],
    sectorHigh: [],
    thesisConflicts: [],
    unmapped: [],
  }];
  const result = updatePortfolioRiskHistory(history, {
    reportDate: "2026-07-29",
    stockHigh: ["TSLA"],
    sectorHigh: [],
    thesisConflicts: [],
    unmapped: [],
  });
  assert.deepEqual(result.history.map((item) => item.reportDate), [
    "2026-07-28",
    "2026-07-29",
  ]);
  assert.deepEqual(result.comparison.stockHigh.added, ["TSLA"]);
});

test("weekly portfolio risk trend waits for two dates and classifies improvement", () => {
  const insufficient = buildPortfolioRiskTrend([{
    reportDate: "2026-07-28",
    stockHigh: ["NVDA"],
    sectorHigh: [],
    thesisConflicts: [],
    unmapped: [],
  }]);
  assert.equal(insufficient.status, "insufficient_sample");
  assert.equal(insufficient.sampleCount, 1);

  const improved = buildPortfolioRiskTrend([
    {
      reportDate: "2026-07-28",
      stockHigh: ["NVDA"],
      sectorHigh: ["XLK"],
      thesisConflicts: ["TSLA:XLY"],
      unmapped: ["ABC"],
    },
    {
      reportDate: "2026-07-29",
      stockHigh: [],
      sectorHigh: [],
      thesisConflicts: ["TSLA:XLY"],
      unmapped: [],
    },
  ]);
  assert.equal(improved.status, "improved");
  assert.equal(improved.label, "개선");
  assert.equal(improved.scoreChange, -7);
  assert.equal(improved.warningChange, -3);
  assert.equal(improved.rows.length, 2);
  assert.deepEqual(improved.drivers.removed, [
    { kind: "stockHigh", kindLabel: "종목 고위험", value: "NVDA" },
    { kind: "sectorHigh", kindLabel: "섹터 고위험", value: "XLK" },
    { kind: "unmapped", kindLabel: "섹터 매핑 대기", value: "ABC" },
  ]);
});
