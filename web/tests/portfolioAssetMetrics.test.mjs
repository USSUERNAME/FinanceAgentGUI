import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioAssetMetricRow,
  buildPortfolioAssetMetricRows,
  portfolioAssetBetaBenchmark,
  portfolioWidgetIsAssetEvaluationTable,
} from "../src/portfolio/portfolioAssetMetrics.js";
import { samplePortfolioComparisonRows } from "../src/portfolio/portfolioAssetComparisonData.js";

const portfolioRows = [
  { time: "2025-01-02", value: 100 },
  { time: "2025-01-03", value: 105 },
  { time: "2025-01-06", value: 102 },
  { time: "2026-01-02", value: 120 },
];

const benchmarkRows = [
  { time: "2025-01-02", value: 100 },
  { time: "2025-01-03", value: 102 },
  { time: "2025-01-06", value: 101 },
  { time: "2026-01-02", value: 110 },
];

test("보유자산 평가는 표준 성과 지표를 계산한다", () => {
  const row = buildPortfolioAssetMetricRow({
    name: "보유자산",
    rows: portfolioRows,
    timeframe: "1d",
    benchmarkRows,
    benchmarkLabel: "KODEX 200",
  });

  assert.equal(row.name, "보유자산");
  assert.ok(Math.abs(row.cumulativeReturn - 20) < 0.0001);
  assert.ok(row.cagr > 19 && row.cagr < 21);
  assert.ok(row.mdd < 0);
  assert.ok(row.volatility > 0);
  assert.ok(Number.isFinite(row.beta));
  assert.notEqual(row.beta, 1);
  assert.equal(row.betaBenchmark, "KODEX 200");
});

test("비교 자산은 한 줄씩 추가되고 선택한 시장 기준 beta를 가진다", () => {
  const rows = buildPortfolioAssetMetricRows({
    portfolioRows,
    timeframe: "1d",
    benchmarkRows,
    benchmarkLabel: "VOO",
    assetSeries: [
      {
        asset: { symbol: "TQQQ", name: "ProShares UltraPro QQQ" },
        rows: [
          { time: "2025-01-02", value: 50 },
          { time: "2025-01-03", value: 54 },
          { time: "2025-01-06", value: 51 },
          { time: "2026-01-02", value: 70 },
        ],
      },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "보유자산");
  assert.equal(rows[0].betaBenchmark, "VOO");
  assert.match(rows[1].name, /^TQQQ/);
  assert.ok(Number.isFinite(rows[1].beta));
  assert.equal(rows[1].betaBenchmark, "VOO");
});

test("평가표 BETA 기준은 KODEX 200 069500과 VOO로 정규화된다", () => {
  assert.deepEqual(portfolioAssetBetaBenchmark(), {
    id: "VOO",
    label: "VOO",
    asset: { symbol: "VOO", name: "Vanguard S&P 500 ETF", market: "NYSE Arca" },
  });
  assert.equal(portfolioAssetBetaBenchmark("069500").id, "KODEX_200");
  assert.equal(portfolioAssetBetaBenchmark("VOO").asset.symbol, "VOO");
});

test("BETA는 주말을 제외한 공통 가격 날짜를 먼저 맞춘 뒤 구간 수익률을 계산한다", () => {
  const row = buildPortfolioAssetMetricRow({
    name: "보유자산",
    rows: [
      { time: "2026-07-02", value: 100 },
      { time: "2026-07-03", value: 121 },
      { time: "2026-07-04", value: 300 },
      { time: "2026-07-05", value: 50 },
      { time: "2026-07-06", value: 98.01 },
    ],
    benchmarkRows: [
      { time: "2026-07-02", value: 100 },
      { time: "2026-07-03", value: 110 },
      { time: "2026-07-06", value: 99 },
    ],
    benchmarkLabel: "VOO",
  });

  assert.ok(Math.abs(row.beta - 2) < 0.000001);
});

test("자산 평가 테이블은 원본 위젯 의존성으로 식별된다", () => {
  const widget = {
    chartSpec: {
      role: "asset_history_evaluation",
      sourceWidgetIds: ["asset-history-1"],
    },
    dependsOn: ["asset-history-1"],
  };

  assert.equal(portfolioWidgetIsAssetEvaluationTable(widget), true);
  assert.equal(portfolioWidgetIsAssetEvaluationTable(widget, "asset-history-1"), true);
  assert.equal(portfolioWidgetIsAssetEvaluationTable(widget, "asset-history-2"), false);
});

test("실제 주별 타임프레임 1wk는 주간 마지막 시세로 샘플링한다", () => {
  const rows = samplePortfolioComparisonRows([
    { time: "2026-07-06", value: 100 },
    { time: "2026-07-07", value: 101 },
    { time: "2026-07-10", value: 105 },
    { time: "2026-07-13", value: 106 },
  ], "1wk");

  assert.deepEqual(rows, [
    { time: "2026-07-10", value: 105 },
    { time: "2026-07-13", value: 106 },
  ]);
});
