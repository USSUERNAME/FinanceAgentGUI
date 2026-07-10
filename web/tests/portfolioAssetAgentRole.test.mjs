import test from "node:test";
import assert from "node:assert/strict";

import { portfolioContextForPrompt } from "../server/codexProbe.mjs";
import {
  buildPortfolioChatActionInstructions,
  buildPortfolioWidgetAgentPrompt,
} from "../src/portfolio/agentPromptBuilder.js";
import { buildPortfolioContextPacket } from "../src/portfolio/contextPacketBuilder.js";
import { buildPortfolioAgentWidgetActionApplyState } from "../src/portfolio/widgetAgentActionApply.js";

const assetModeMeta = {
  id: "asset-management",
  label: "자산 관리",
  actionGuidance: "새 위젯은 사용자가 + 버튼에서 직접 선택합니다.",
};

const strategyModeMeta = {
  id: "strategy-research",
  label: "전략 연구",
  actionGuidance: "전략 위젯 그래프를 구성합니다.",
};

test("asset-management sidebar directs widget creation to the canvas plus picker", () => {
  const contextPacket = {
    portfolioMode: "asset-management",
    canvas: { id: "asset-canvas", name: "내 자산" },
    widgets: [],
  };
  const chatInstructions = buildPortfolioChatActionInstructions(contextPacket, {
    modeMeta: assetModeMeta,
  });
  const widgetPrompt = buildPortfolioWidgetAgentPrompt(
    {
      action: "create",
      canvasId: "asset-canvas",
      canvasName: "내 자산",
      canvasMode: "asset-management",
      prompt: "보유 자산 과거 내역 위젯을 만들어줘",
    },
    { modeMeta: assetModeMeta }
  );

  for (const prompt of [chatInstructions, widgetPrompt]) {
    assert.match(prompt, /전략 캔버스보다 단순/);
    assert.match(prompt, /빈 칸의 `\+` 버튼/);
    assert.match(prompt, /새 위젯을 직접 생성하지 않습니다/);
    assert.match(prompt, /create_widget.*액션을 출력하지 마세요/);
    assert.doesNotMatch(prompt, /```portfolio_widget_action/);
    assert.doesNotMatch(prompt, /생성 action 예시/);
  }
});

test("strategy-research sidebar keeps agent widget creation enabled", () => {
  const instructions = buildPortfolioChatActionInstructions(
    {
      portfolioMode: "strategy-research",
      canvas: { id: "strategy-canvas", name: "전략 연구" },
      widgets: [],
    },
    { modeMeta: strategyModeMeta }
  );

  assert.match(instructions, /새 위젯 생성은 action=create_widget/);
  assert.match(instructions, /```portfolio_widget_action/);
  assert.doesNotMatch(instructions, /새 위젯을 직접 생성하지 않습니다/);
});

test("asset-management context packet exposes user-owned widget creation only", () => {
  const assetContext = buildPortfolioContextPacket({
    canvas: { id: "asset-canvas", name: "내 자산" },
    canvasModeMeta: assetModeMeta,
    assetCanvasModeId: "asset-management",
    isWidgetCanvasMode: true,
    widgets: [{ id: "asset-widget-1", displayId: "W-001", title: "투자 종목 현황" }],
    widgetDisplayDataById: {
      "asset-widget-1": {
        schemaVersion: "portfolio-widget-display-data.v1",
        kind: "asset-position-status",
        summary: { status: "ready", itemCount: 2, totalValue: 1234567 },
        data: { items: [{ symbol: "AAPL", percent: 60 }, { symbol: "MSFT", percent: 40 }] },
      },
    },
  });
  const strategyContext = buildPortfolioContextPacket({
    canvas: { id: "strategy-canvas", name: "전략 연구" },
    canvasModeMeta: strategyModeMeta,
    assetCanvasModeId: "asset-management",
    isWidgetCanvasMode: true,
  });

  assert.deepEqual(assetContext.widgetCreationPolicy, {
    owner: "user",
    entryPoint: "canvas-empty-cell-plus",
    label: "+",
    agentCanCreate: false,
    guidance: "전략 캔버스보다 위젯 구조가 단순하므로 사용자가 캔버스 빈 칸의 + 버튼에서 직접 선택합니다.",
  });
  assert.equal(assetContext.availableActions.includes("create_portfolio_widget"), false);
  assert.equal(assetContext.availableActions.includes("create_function_widget"), false);
  assert.equal(assetContext.availableActions.includes("render_portfolio_artifact"), false);
  assert.equal(assetContext.widgetDataRetrieval.mode, "query-scoped-local-rag");
  assert.equal(assetContext.widgetDataRetrieval.indexedWidgetCount, 1);
  assert.equal(assetContext.widgets[0].displayData.summary.totalValue, 1234567);
  assert.equal(strategyContext.widgetCreationPolicy.agentCanCreate, true);
  assert.equal(strategyContext.availableActions.includes("create_portfolio_widget"), true);

  const compactPromptContext = portfolioContextForPrompt(assetContext);
  assert.equal(compactPromptContext.canvas.mode, "asset-management");
  assert.equal(compactPromptContext.widgetCreationPolicy.owner, "user");
  assert.equal(compactPromptContext.widgetCreationPolicy.entryPoint, "canvas-empty-cell-plus");
  assert.equal(compactPromptContext.widgetCreationPolicy.agentCanCreate, false);
  assert.equal(compactPromptContext.widgets[0].displayData.summary.itemCount, 2);
  assert.equal(compactPromptContext.widgets[0].displayData.retrieval.fullDataAvailable, true);
  assert.equal("data" in compactPromptContext.widgets[0].displayData, false);
});

test("asset-management action harness rejects direct agent widget creation", () => {
  const answer = [
    "```portfolio_widget_action",
    JSON.stringify({
      action: "create_widget",
      actionId: "render_portfolio_artifact",
      canvasId: "asset-canvas",
      widget: {
        title: "보유 자산 과거 내역",
        kind: "보유 자산 과거 내역 차트",
        visualType: "price-history",
        dataset: [],
        chartSpec: { type: "price-history" },
      },
    }),
    "```",
  ].join("\n");
  const state = buildPortfolioAgentWidgetActionApplyState({
    agentWidgetAction: {
      id: "agent-action-1",
      answer,
      canvasId: "asset-canvas",
      request: { action: "create", prompt: "위젯을 만들어줘" },
    },
    canvasId: "asset-canvas",
    canvasModeId: "asset-management",
    assetCanvasModeId: "asset-management",
    currentWidgets: [],
    nextDisplayIndex: 1,
  });

  assert.equal(state.status, "asset-widget-creation-disabled");
  assert.deepEqual(state.widgets, []);
  assert.equal(state.nextDisplayIndex, 1);
  assert.equal(state.rememberWorkspace, false);
  assert.match(state.logMessages[0], /\+ 버튼에서 직접 추가/);
});

test("asset-management action harness also blocks fallback creation without JSON", () => {
  const state = buildPortfolioAgentWidgetActionApplyState({
    agentWidgetAction: {
      id: "agent-action-2",
      answer: "보유 자산 과거 내역을 준비하겠습니다.",
      canvasId: "asset-canvas",
      request: { action: "create", prompt: "위젯을 만들어줘" },
    },
    canvasId: "asset-canvas",
    canvasModeId: "asset-management",
    assetCanvasModeId: "asset-management",
    currentWidgets: [],
    nextDisplayIndex: 1,
  });

  assert.equal(state.status, "asset-widget-creation-disabled");
  assert.deepEqual(state.widgets, []);
});

test("asset-management action harness keeps explicitly targeted existing-widget updates", () => {
  const currentWidget = {
    id: "asset-position-1",
    displayId: "W-001",
    title: "투자 종목 현황",
    kind: "투자 종목 현황",
    visualType: "position-status",
    status: "ready",
    chartSpec: {
      type: "position-status",
      query: { currency: "KRW", view: "bar" },
    },
  };
  const answer = [
    "```portfolio_widget_action",
    JSON.stringify({
      action: "update_widget",
      canvasId: "asset-canvas",
      widgetId: currentWidget.id,
      widgetDisplayId: currentWidget.displayId,
      widget: {
        title: "투자 종목 구성",
        visualType: "position-status",
        chartSpec: {
          type: "position-status",
          query: { currency: "USD", view: "pie" },
        },
      },
    }),
    "```",
  ].join("\n");
  const state = buildPortfolioAgentWidgetActionApplyState({
    agentWidgetAction: {
      id: "agent-action-update",
      answer,
      canvasId: "asset-canvas",
      request: { action: "edit", widgetId: currentWidget.id, prompt: "이 위젯을 원형 달러 보기로 바꿔줘" },
    },
    canvasId: "asset-canvas",
    canvasModeId: "asset-management",
    assetCanvasModeId: "asset-management",
    currentWidgets: [currentWidget],
    nextDisplayIndex: 2,
  });

  assert.equal(state.status, "updated");
  assert.equal(state.widgets.length, 1);
  assert.equal(state.widgets[0].title, "투자 종목 구성");
  assert.equal(state.widgets[0].chartSpec.query.currency, "USD");
  assert.equal(state.widgets[0].chartSpec.query.view, "pie");
});

test("strategy-research action harness still applies direct agent widget creation", () => {
  const answer = [
    "```portfolio_widget_action",
    JSON.stringify({
      action: "create_widget",
      canvasId: "strategy-canvas",
      widget: {
        title: "QQQ 100%",
        kind: "포트폴리오 표",
        visualType: "table",
        dataset: [{ ticker: "QQQ", value: 100 }],
        chartSpec: { type: "table" },
        scenarioId: "portfolio_scenario_root",
        outputRole: "source_matrix",
      },
    }),
    "```",
  ].join("\n");
  const state = buildPortfolioAgentWidgetActionApplyState({
    agentWidgetAction: {
      id: "agent-action-3",
      answer,
      canvasId: "strategy-canvas",
      request: { action: "create", prompt: "QQQ 100% 위젯을 만들어줘" },
    },
    canvasId: "strategy-canvas",
    canvasModeId: "strategy-research",
    assetCanvasModeId: "asset-management",
    currentWidgets: [],
    nextDisplayIndex: 1,
    now: "2026-07-10T00:00:00.000Z",
    nowMs: 1,
  });

  assert.equal(state.status, "created");
  assert.equal(state.widgets.length, 1);
  assert.equal(state.widgets[0].title, "QQQ 100%");
});
