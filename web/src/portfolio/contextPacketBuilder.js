import { normalizePortfolioWidgetNextActionsForState } from "./widgetActions.js";
import { portfolioWidgetDependencyIds } from "./widgetRelations.js";
import { normalizePortfolioScenarioSpec } from "./scenarioContract.js";

const portfolioContextAvailableActions = [
  "start_portfolio_workspace",
  "create_portfolio_widget",
  "create_function_widget",
  "update_function_widget",
  "edit_portfolio_widget",
  "resize_portfolio_widget",
  "delete_portfolio_widget",
  "import_holdings",
  "refresh_canvas_latest_data",
  "run_backtest_chart_widget",
  "request_backtest_matrix_context",
  "render_portfolio_artifact",
  "set_widget_dependencies",
  "update_derived_widget",
];

const assetManagementBlockedCreationActions = new Set([
  "create_portfolio_widget",
  "create_function_widget",
  "import_holdings",
  "render_portfolio_artifact",
]);

function portfolioContextWidget(widget = {}, displayData = null) {
  return {
    id: widget.id,
    displayId: widget.displayId,
    title: widget.title,
    kind: widget.kind,
    prompt: widget.prompt,
    layout: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
    status: widget.status,
    visualType: widget.visualType,
    graphRole: widget.graphRole,
    scenarioId: widget.scenarioId,
    outputRole: widget.outputRole,
    dataset: widget.dataset,
    chartSpec: widget.chartSpec,
    functionSpec: widget.functionSpec,
    signalMatrix: widget.signalMatrix,
    dataFiles: widget.dataFiles || widget.functionSpec?.dataSources || [],
    badges: widget.badges,
    agentSummary: widget.agentSummary,
    requirements: widget.requirements,
    checks: widget.checks,
    nextActions: normalizePortfolioWidgetNextActionsForState(widget),
    dependsOn: widget.dependsOn,
    derivedFrom: widget.derivedFrom,
    updatePolicy: widget.updatePolicy,
    version: widget.version,
    lastComputedFrom: widget.lastComputedFrom,
    staleReason: widget.staleReason,
    staleSince: widget.staleSince,
    displayData: displayData && typeof displayData === "object" ? displayData : null,
  };
}

function portfolioContextWidgetDependency(widget = {}) {
  return {
    id: widget.id,
    displayId: widget.displayId,
    title: widget.title,
    kind: widget.kind,
    visualType: widget.visualType,
    scenarioId: widget.scenarioId,
    outputRole: widget.outputRole,
    dependsOn: portfolioWidgetDependencyIds(widget),
    updatePolicy: widget.updatePolicy,
    version: widget.version,
    status: widget.status,
    staleReason: widget.staleReason,
  };
}

function portfolioContextRefreshTarget(widget = {}) {
  return {
    id: widget.id,
    displayId: widget.displayId,
    title: widget.title,
    dependsOn: portfolioWidgetDependencyIds(widget),
  };
}

function portfolioContextTopHolding(row = {}) {
  return {
    ticker: row.ticker,
    name: row.name,
    assetClass: row.assetClass,
    region: row.region,
    value: row.value,
    weight: row.weight,
    inputMode: row.inputMode,
    inputWeight: row.inputWeight,
  };
}

function portfolioLiveBacktestContext(liveBacktest, hasLiveBacktest = false) {
  if (!hasLiveBacktest || !liveBacktest) return null;
  return {
    source: liveBacktest.source,
    methodology: liveBacktest.methodology,
    period: liveBacktest.period,
    benchmark: liveBacktest.benchmark,
    fetchedAt: liveBacktest.fetchedAt,
    metrics: liveBacktest.metrics,
    tickers: liveBacktest.tickers,
    issues: liveBacktest.issues,
  };
}

export function buildPortfolioContextPacket({
  canvas,
  canvasModeMeta,
  assetCanvasModeId,
  workspaceStarted = false,
  isWidgetCanvasMode = false,
  workspaceStatus = "draft",
  strategyPortfolios = [],
  scenario = null,
  assetHistoryRange = null,
  widgets = [],
  canvasRefreshTargets = [],
  holdings = [],
  summary = {},
  backtestPeriod = "",
  benchmark = "",
  liveBacktestBusy = false,
  hasLiveBacktest = false,
  liveBacktestError = "",
  liveBacktest = null,
  portfolioSchemaTables = [],
  portfolioTheoryPrinciples = [],
  activityLog = [],
  widgetDisplayDataById = {},
} = {}) {
  const modeMeta = canvasModeMeta || {};
  const isAssetCanvas = modeMeta.id === assetCanvasModeId;
  const scenarioSpec = normalizePortfolioScenarioSpec(scenario, { backtestPeriod });
  return {
    screen: "portfolio-canvas",
    canvas: {
      id: canvas?.id || "",
      name: canvas?.name || "이름 없는 캔버스",
      mode: modeMeta.id,
      modeLabel: modeMeta.label,
    },
    portfolioMode: modeMeta.id,
    portfolioModeLabel: modeMeta.label,
    portfolioModeGuidance: modeMeta.actionGuidance,
    source: "현재 포트폴리오 작업실 화면",
    developerDocs: {
      portfolioWidgetContract: "docs/portfolio-widgets.md",
    },
    guideVisible: !workspaceStarted,
    memoryScope: "portfolio-canvas",
    memoryAccessPolicy: {
      ownCanvasChat: "read/write",
      systemMainChat: "blocked",
      systemMainCanReadThisCanvas: true,
    },
    workspaceMode: isWidgetCanvasMode ? "widget-canvas" : "analysis-canvas",
    workspaceStatus,
    widgetCreationPolicy: isAssetCanvas
      ? {
          owner: "user",
          entryPoint: "canvas-empty-cell-plus",
          label: "+",
          agentCanCreate: false,
          guidance: "전략 캔버스보다 위젯 구조가 단순하므로 사용자가 캔버스 빈 칸의 + 버튼에서 직접 선택합니다.",
        }
      : {
          owner: "sidebar-agent",
          entryPoint: "agent-widget-action",
          agentCanCreate: true,
          guidance: "전략 캔버스는 사이드바 에이전트가 typed widget graph를 생성할 수 있습니다.",
        },
    scenario: isAssetCanvas
      ? null
      : {
          id: scenarioSpec.id,
          title: scenarioSpec.title,
          graphRole: scenarioSpec.graphRole,
          outputRole: scenarioSpec.outputRole,
          runs: scenarioSpec.runs,
          dimensions: scenarioSpec.dimensions,
          assumptions: scenarioSpec.assumptions,
          invariant: "strategy-research canvases have exactly one pinned scenario root; process widgets must preserve this scenarioId and emit one outputRole.",
        },
    assetHistoryQuery: isAssetCanvas && assetHistoryRange
      ? {
          title: "기간 및 타임프레임",
          dataProvider: "토스 증권 Open API",
          startDate: assetHistoryRange.startDate,
          startMode: assetHistoryRange.startMode || (assetHistoryRange.startDate ? "custom" : "first_trade"),
          effectiveStartDate: assetHistoryRange.effectiveStartDate || assetHistoryRange.startDate,
          endDate: assetHistoryRange.endDate,
          endMode: assetHistoryRange.endMode || (assetHistoryRange.endDate ? "custom" : "latest"),
          effectiveEndDate: assetHistoryRange.effectiveEndDate || assetHistoryRange.endDate,
          effectiveEndLabel: assetHistoryRange.effectiveEndLabel || (assetHistoryRange.endDate ? "" : "latest"),
          timeframe: assetHistoryRange.timeframe,
          invariant: "asset-management history queries are hidden until Toss Invest API is connected and the completed position snapshot is available; a blank startDate means the first synced trade, a blank endDate means the latest available point, and startDate cannot precede the first synced trade.",
        }
      : null,
    strategyPortfolios: strategyPortfolios.map((strategy) => ({
      id: strategy.id,
      name: strategy.name,
      weightsCount: Array.isArray(strategy.weights) ? strategy.weights.length : 0,
      dataSources: Array.isArray(strategy.dataSources) ? strategy.dataSources : [],
      assumptions: Array.isArray(strategy.assumptions) ? strategy.assumptions : [],
    })),
    widgets: widgets.map((widget) => portfolioContextWidget(widget, widgetDisplayDataById?.[widget.id])),
    widgetDataRetrieval: {
      mode: "query-scoped-local-rag",
      scope: "current-canvas-visible-widget-data",
      indexedWidgetCount: widgets.filter((widget) => widgetDisplayDataById?.[widget.id]).length,
      availableWidgetCount: widgets.length,
      persistence: "request-only",
      guidance: "요약은 Context Packet에 직접 포함되고 전체 표시 데이터는 사용자 질문에 맞춰 서버에서 청크 검색됩니다.",
    },
    widgetDependencyGraph: widgets.map(portfolioContextWidgetDependency),
    canvasRefresh: {
      actionId: "refresh_canvas_latest_data",
      label: "캔버스를 최신 정보로 새로고침",
      source: isAssetCanvas ? "토스 증권 Open API" : "yfinance",
      refreshableWidgetCount: canvasRefreshTargets.length,
      dependencyOrder: canvasRefreshTargets.map(portfolioContextRefreshTarget),
    },
    holdingsCount: holdings.length,
    totalValue: summary.totalValue,
    totalWeight: summary.totalWeight,
    valueMode: summary.valueMode,
    profitLoss: summary.profitLoss,
    profitLossRate: summary.profitLossRate,
    concentration: {
      top3Weight: summary.top3Weight,
      hhi: summary.hhi,
      level: summary.concentrationLevel,
    },
    topHoldings: holdings.slice(0, 6).map(portfolioContextTopHolding),
    assetClasses: summary.classRows,
    regions: summary.regionRows,
    workspaceConcept: isAssetCanvas
      ? "실제 자산 데이터, 투자금, 원금, 평가금액, 수량, 손익, 업데이트 이력을 추적하는 자산 관리 캔버스"
      : "전략별 포트폴리오 비율, 가정, yfinance/CSV 데이터, 백테스트 조건을 비교하는 전략 연구 캔버스",
    backtestRequest: isAssetCanvas
      ? null
      : {
          source: "yfinance",
          period: backtestPeriod,
          benchmark,
          status: liveBacktestBusy ? "running" : hasLiveBacktest ? "ready" : liveBacktestError ? "error" : "waiting",
          error: liveBacktestError,
        },
    liveBacktest: portfolioLiveBacktestContext(liveBacktest, hasLiveBacktest),
    schemaDraft: portfolioSchemaTables,
    principles: portfolioTheoryPrinciples.map((item) => item.title),
    availableActions: isAssetCanvas
      ? portfolioContextAvailableActions.filter((actionId) => !assetManagementBlockedCreationActions.has(actionId))
      : portfolioContextAvailableActions,
    logsTail: activityLog.slice(-5),
  };
}
