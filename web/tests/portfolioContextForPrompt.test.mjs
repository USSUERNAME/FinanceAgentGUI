import test from "node:test";
import assert from "node:assert/strict";

import {
  portfolioContextForPrompt,
  portfolioWidgetRagContextForPrompt,
  resolveAgentRetrievalPolicy,
} from "../server/codexProbe.mjs";
import {
  buildPortfolioChatActionInstructions,
  buildPortfolioWidgetAgentPrompt,
} from "../src/portfolio/agentPromptBuilder.js";

test("agent retrieval policy searches global memory without injecting snapshots on portfolio canvases", () => {
  const policy = resolveAgentRetrievalPolicy({
    screen: "portfolio-canvas",
    includeWorldMemoryContext: false,
    includeWorldMemorySearchContext: true,
    includeNewsFeedContext: false,
    includeNewsFeedSearchContext: true,
  });

  assert.equal(policy.includeWorldMemorySnapshot, false);
  assert.equal(policy.worldMemoryPage, false);
  assert.equal(policy.includeWorldMemorySearch, true);
  assert.equal(policy.includeNewsFeedLatest, false);
  assert.equal(policy.includeNewsFeedSearch, true);
});

test("agent retrieval policy keeps World Memory page context separate from mandatory semantic search", () => {
  const policy = resolveAgentRetrievalPolicy({
    screen: "world-memory",
    includeWorldMemoryContext: true,
    forceWorldMemoryVectorSearch: true,
    includeNewsFeedContext: true,
  });

  assert.equal(policy.worldMemoryPage, true);
  assert.equal(policy.includeWorldMemorySnapshot, false);
  assert.equal(policy.includeWorldMemorySearch, true);
  assert.equal(policy.forceWorldMemorySearch, true);
  assert.equal(policy.includeNewsFeedLatest, true);
  assert.equal(policy.includeNewsFeedSearch, true);
});

test("portfolio prompt context preserves chart series and metric outputs", () => {
  const context = portfolioContextForPrompt({
    screen: "portfolio-canvas",
    canvas: { id: "canvas-1", name: "전략 연구" },
    workspaceStatus: "ready",
    widgets: [
      {
        id: "w-backtest",
        displayId: "W-003",
        title: "QQQ: Shiller PE HA 전략 vs Buy & Hold",
        kind: "백테스트 비교",
        status: "ready",
        visualType: "line",
        outputRole: "backtest_result",
        layout: { x: 1, y: 3, w: 2, h: 2 },
        dependsOn: ["w-input", "w-signal"],
        chartSpec: {
          type: "line",
          xLabels: ["2026-01-02", "2026-01-03", "2026-01-04"],
          sourceWidgetIds: ["w-input"],
          strategyWidgetIds: ["w-signal"],
          series: [
            {
              name: "QQQ Buy & Hold",
              type: "line",
              data: [
                ["2026-01-02", 100],
                ["2026-01-03", 103],
                ["2026-01-04", 101],
              ],
            },
            {
              name: "Shiller PE HA 전략",
              type: "line",
              data: [
                ["2026-01-02", 100],
                ["2026-01-03", 105],
                ["2026-01-04", 107],
              ],
            },
          ],
          metrics: [
            {
              name: "QQQ Buy & Hold",
              endingValue: 131.95,
              cumulativeReturn: 31.95,
              cagr: 32.24,
              mdd: -11.96,
              sharpe: 1.646,
            },
            {
              name: "Shiller PE HA 전략",
              endingValue: 141.21,
              cumulativeReturn: 41.21,
              cagr: 41.6,
              mdd: -7.88,
              sharpe: 2.271,
            },
          ],
          metricColumns: ["name", "endingValue", "cagr", "mdd", "sharpe"],
          sourceTables: [
            {
              id: "w-input",
              displayId: "W-001",
              title: "QQQ 100% 원본 포트폴리오",
              dataset: [{ ticker: "QQQ", value: 100 }],
            },
          ],
          scenarioMatrix: {
            scenarioId: "scenario-root",
            resultRole: "backtest_result",
            runs: [{ runId: "base", period: "1y", timeframe: "1d" }],
          },
        },
      },
    ],
    widgetDependencyGraph: [
      {
        id: "w-backtest",
        displayId: "W-003",
        dependsOn: ["w-input", "w-signal"],
        outputRole: "backtest_result",
      },
    ],
  });

  const [widget] = context.widgets;
  assert.equal(widget.displayId, "W-003");
  assert.equal(widget.chartSpec.series.length, 2);
  assert.equal(widget.chartSpec.series[0].dataPointCount, 3);
  assert.deepEqual(widget.chartSpec.series[1].firstPoints[2], ["2026-01-04", 107]);
  assert.equal(widget.chartSpec.metrics[1].endingValue, 141.21);
  assert.equal(widget.chartSpec.metrics[1].sharpe, 2.271);
  assert.deepEqual(widget.chartSpec.metricColumns, ["name", "endingValue", "cagr", "mdd", "sharpe"]);
  assert.equal(widget.backtestMatrixContext.actionId, "request_backtest_matrix_context");
  assert.equal(widget.backtestMatrixContext.widgetDisplayId, "W-003");
  assert.equal(widget.backtestMatrixContext.pointCount, 3);
  assert.deepEqual(widget.backtestMatrixContext.supportedTransforms, ["raw", "returns", "drawdown", "monthly_returns", "yearly_returns"]);
  assert.equal(widget.chartSpec.sourceTables[0].dataset.previewRows[0].ticker, "QQQ");
  assert.equal(widget.chartSpec.scenarioMatrix.resultRole, "backtest_result");
  assert.equal(context.widgetDependencyGraph[0].dependsOn[1], "w-signal");
});

test("portfolio prompt context preserves function specs but strips large attachment bodies", () => {
  const context = portfolioContextForPrompt({
    widgets: [
      {
        id: "w-signal",
        displayId: "W-002",
        title: "Shiller PE HA 월간 신호",
        kind: "함수 위젯",
        status: "ready",
        visualType: "function",
        outputRole: "signal_matrix",
        functionSpec: {
          language: "portfolio-matrix-dsl",
          executionMode: "matrix-dsl",
          outputs: ["signal_matrix"],
          program: [
            { op: "rule", when: "close < open", emit: { field: "target_weight", asset: "QQQ", value: 0 } },
            { op: "rule", when: "close > open", emit: { field: "target_weight", asset: "QQQ", value: 1 } },
          ],
          dataSources: [
            {
              id: "file-1",
              name: "MULTPL_SHILLER_PE_RATIO_MONTH.csv",
              type: "text/csv",
              size: 18000,
              text: "time,open,close\n2026-01-31,10,11\n",
              dataUrl: "data:text/csv;base64,AAAA",
            },
          ],
        },
        signalMatrix: {
          rowCount: 163,
          columns: ["date", "asset", "targetWeight"],
          rows: [{ date: "2026-02-02", asset: "QQQ", targetWeight: 1 }],
        },
        dataFiles: [
          {
            id: "file-1",
            name: "MULTPL_SHILLER_PE_RATIO_MONTH.csv",
            type: "text/csv",
            size: 18000,
            text: "time,open,close\n2026-01-31,10,11\n",
            dataUrl: "data:text/csv;base64,AAAA",
          },
        ],
      },
    ],
  });

  const [widget] = context.widgets;
  assert.equal(widget.functionSpec.executionMode, "matrix-dsl");
  assert.equal(widget.functionSpec.program[1].emit.value, 1);
  assert.equal(widget.functionSpec.dataSources[0].hasText, true);
  assert.equal(widget.functionSpec.dataSources[0].hasDataUrl, true);
  assert.equal("text" in widget.functionSpec.dataSources[0], false);
  assert.equal("dataUrl" in widget.functionSpec.dataSources[0], false);
  assert.equal(widget.signalMatrix.rows[0].targetWeight, 1);
  assert.equal(widget.dataFiles[0].textPreview.startsWith("time,open,close"), true);
});

test("portfolio prompt context preserves metrics-table widget rows", () => {
  const context = portfolioContextForPrompt({
    widgets: [
      {
        id: "w-metrics",
        displayId: "W-004",
        title: "백테스트 성과 지표",
        kind: "백테스트 지표",
        status: "ready",
        visualType: "metrics-table",
        outputRole: "metrics",
        dependsOn: ["w-backtest"],
        chartSpec: {
          type: "metrics-table",
          metrics: [
            { name: "Buy & Hold", endingValue: 131.95, cagr: 32.24, mdd: -11.96 },
            { name: "외부 CSV 신호 전략", endingValue: 141.21, cagr: 41.6, mdd: -7.88 },
          ],
          metricColumns: ["name", "endingValue", "cagr", "mdd"],
        },
      },
    ],
  });

  const [widget] = context.widgets;
  assert.equal(widget.displayId, "W-004");
  assert.equal(widget.chartSpec.metrics.length, 2);
  assert.equal(widget.chartSpec.metrics[0].cagr, 32.24);
  assert.equal(widget.chartSpec.metrics[1].mdd, -7.88);
  assert.deepEqual(widget.dependsOn, ["w-backtest"]);
});

test("asset widget prompt uses compact display summaries and retrieves full matching rows through local RAG", () => {
  const points = Array.from({ length: 420 }, (_, index) => ({
    time: `row-${String(index).padStart(3, "0")}`,
    value: index === 317 ? 987654321 : index * 10,
    note: index === 317 ? "needle-delta" : "ordinary",
  }));
  const rawContext = {
    screen: "portfolio-canvas",
    canvas: { id: "asset-canvas", name: "자산 관리", mode: "asset-management" },
    portfolioMode: "asset-management",
    widgetDataRetrieval: {
      mode: "query-scoped-local-rag",
      scope: "current-canvas-visible-widget-data",
      indexedWidgetCount: 1,
      persistence: "request-only",
    },
    widgets: [
      {
        id: "asset-history-1",
        displayId: "W-007",
        title: "보유 자산 과거 내역",
        kind: "보유 자산 과거 내역 차트",
        visualType: "price-history",
        displayData: {
          schemaVersion: "portfolio-widget-display-data.v1",
          kind: "asset-price-history",
          query: { currency: "KRW", timeframe: "1d" },
          summary: { status: "ready", pointCount: points.length, latestValue: 4190 },
          data: { points },
        },
      },
    ],
  };

  const compact = portfolioContextForPrompt(rawContext);
  assert.equal(compact.widgets[0].displayData.summary.pointCount, 420);
  assert.equal(compact.widgets[0].displayData.retrieval.fullDataAvailable, true);
  assert.equal("data" in compact.widgets[0].displayData, false);

  const rag = portfolioWidgetRagContextForPrompt(rawContext, "W-007 needle-delta 987654321 행을 확인해줘");
  assert.equal(rag.retrievalMode, "query-scoped-local-rag");
  assert.equal(rag.searchedWidgetCount, 1);
  assert.ok(rag.totalChunkCount > 1);
  assert.ok(rag.chunks.some((chunk) => JSON.stringify(chunk.data).includes("needle-delta")));
  assert.ok(rag.chunks.some((chunk) => JSON.stringify(chunk.data).includes("987654321")));
});

test("portfolio agent prompts require structured period-comparison scenario runs", () => {
  const chatInstructions = buildPortfolioChatActionInstructions({
    portfolioMode: "strategy-research",
    canvas: { id: "canvas-strategy", name: "전략 연구" },
    scenario: {
      title: "기간 및 타임프레임",
      runs: [{ runId: "base", label: "기본 실행", period: "1y", timeframe: "1d" }],
      dimensions: ["runId", "date", "asset", "field"],
    },
    widgets: [],
  });
  const widgetPrompt = buildPortfolioWidgetAgentPrompt({
    action: "create",
    canvasId: "canvas-strategy",
    canvasMode: "strategy-research",
    prompt: "QQQ의 이번주 5거래일과 3월 3일부터 3월 8일까지 비교해줘",
  });

  for (const prompt of [chatInstructions, widgetPrompt]) {
    assert.match(prompt, /classification/);
    assert.match(prompt, /primaryOutput='backtest_line_chart'/);
    assert.match(prompt, /로컬 GUI는 자연어 키워드로 widget\.visualType, dataset, functionSpec/);
    assert.match(prompt, /복수의 기간 비교인가/);
    assert.match(prompt, /periodComparison\.isMultiplePeriodComparison/);
    assert.match(prompt, /periodComparison\.periods/);
    assert.match(prompt, /scenario\.runs/);
    assert.match(prompt, /startDate:'YYYY-MM-DD'|startDate/);
    assert.match(prompt, /period:'1y'로 대체하지 마세요/);
  }
  assert.doesNotMatch(widgetPrompt, /"dataset":\s*\[\s*\{\s*"label":\s*"QQQ"/);
  assert.doesNotMatch(widgetPrompt, /"visualType":\s*"line"/);
});

test("portfolio context no longer exposes in-place table backtest conversion", () => {
  const context = portfolioContextForPrompt({
    screen: "portfolio-canvas",
    workspaceMode: "widget-canvas",
    widgets: [
      {
        id: "w-source",
        displayId: "W-001",
        title: "QQQ 100%",
        kind: "포트폴리오 표",
        visualType: "table",
        dataset: [{ ticker: "QQQ", value: 100 }],
        nextActions: ["run_yfinance_backtest"],
      },
    ],
  });

  assert.equal(context.availableActions.includes("run_yfinance_backtest"), false);
  assert.equal(context.widgets[0].nextActions, undefined);
});
