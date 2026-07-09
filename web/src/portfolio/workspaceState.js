import { buildPortfolioWidgetChartSpec } from "./chartBuilders.js";
import { normalizePortfolioWidgetDataset } from "./datasetParser.js";
import {
  filterPortfolioFunctionDataSources,
  normalizePortfolioFunctionSpec,
  normalizePortfolioWidgetDataFiles,
  normalizePortfolioWidgetInlineData,
  portfolioWidgetDataFileCanInline,
} from "./functionSpecParser.js";
import {
  clampPortfolioWidgetNumber,
  cleanPortfolioWidgetText,
  nextPortfolioWidgetDisplayIndex,
  nextPortfolioWidgetDisplayIndexFromStoredState,
  normalizePortfolioWidgetDisplayId,
  normalizePortfolioWidgetList,
  normalizePortfolioWidgetStatus,
  portfolioWidgetDisplayId,
} from "./widgetIdentity.js";
import {
  normalizePortfolioWidgetReferenceList,
  normalizePortfolioWidgetUpdatePolicy,
  portfolioWidgetComputedFrom,
  resolvePortfolioWidgetReferenceId,
  wouldCreatePortfolioWidgetDependencyCycle,
} from "./widgetRelations.js";
import { normalizePortfolioWidgetDerivedFrom } from "./widgetRoleClassifier.js";
import { normalizePortfolioWidgetVisualType } from "./widgetTypes.js";
import {
  normalizePortfolioMarkdownECharts,
  normalizePortfolioMarkdownText,
  portfolioWidgetIsMarkdownType,
} from "./markdownWidget.js";
import {
  normalizePortfolioWidgetNextActionsForState,
  portfolioWidgetShouldAutoRunBacktest,
} from "./widgetActions.js";
import { normalizePortfolioSignalMatrix } from "./signalMatrixCompiler.js";
import {
  PORTFOLIO_SCENARIO_ROOT_ID,
  normalizePortfolioScenarioSpec,
  portfolioScenarioHasIncompleteComparisonRuns,
  portfolioWidgetCanDependOnWidget,
  normalizePortfolioWidgetOutputRole,
} from "./scenarioContract.js";

export const PORTFOLIO_WIDGET_GRID_COLUMNS = 3;
export const PORTFOLIO_WIDGET_MAX_SPAN = 3;
export const PORTFOLIO_WIDGET_MAX_ROWS = 160;
export const PORTFOLIO_WIDGET_MAX_HEIGHT = PORTFOLIO_WIDGET_MAX_ROWS;
export const PORTFOLIO_WIDGET_GRID_EXTRA_ROWS = 12;
export const PORTFOLIO_WIDGET_GRID_ROW_HEIGHT = 132;
export const PORTFOLIO_WIDGET_GRID_GAP = 10;
export const PORTFOLIO_WORKSPACE_STORAGE_KEY = "finance-agent-gui.portfolio-workspace.v1";
export const PORTFOLIO_CANVASES_STORAGE_KEY = "finance-agent-gui.portfolio-canvases.v1";
export const PORTFOLIO_CANVASES_BACKUP_STORAGE_KEY = "finance-agent-gui.portfolio-canvases.backup.v1";

const PORTFOLIO_CHAT_MEMORY_LIMIT = 80;
const PORTFOLIO_MAX_CHAT_ATTACHMENTS = 6;
const PORTFOLIO_CHAT_USER_TEXT_LIMIT = 8_000;
const PORTFOLIO_CHAT_ASSISTANT_TEXT_LIMIT = 80_000;
const PORTFOLIO_CHAT_STATUS_BODY_LIMIT = 2_000;
const PORTFOLIO_BACKTEST_CHART_ACTIONS = new Set(["run_backtest_chart_widget", "run_yfinance_backtest_comparison"]);
const PORTFOLIO_CANVAS_MODE_IDS = Object.freeze({
  asset: "asset-management",
  strategy: "strategy-research",
});

function normalizePortfolioWorkspaceToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function portfolioWidgetDataFileHasFunctionInputRole(dataFile = {}) {
  const role = String(dataFile?.role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return role === "strategy_input";
}

function portfolioWidgetKeepsDataFile(visualType = "", dataFile = {}) {
  if (visualType === "function") return true;
  if (portfolioWidgetDataFileHasFunctionInputRole(dataFile)) return false;
  return true;
}

function portfolioWidgetHasStoredBacktestFailureMarker(item = {}, chartSpec = {}) {
  const marker = String(item?.failureRole || item?.errorRole || chartSpec?.failureRole || chartSpec?.errorRole || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (marker === "backtest_execution_failure" || marker === "backtest_failure") return true;
  if (item?.backtestFailure === true || chartSpec?.backtestFailure === true) return true;
  return [
    item?.errorCode,
    item?.failureCode,
    item?.lastError?.code,
    item?.execution?.errorCode,
    chartSpec?.errorCode,
    chartSpec?.failureCode,
  ].some((value) => String(value || "").trim());
}

function portfolioWidgetLooksLikeStoredBacktestFailure(item = {}) {
  const chartSpec = item?.chartSpec && typeof item.chartSpec === "object" ? item.chartSpec : {};
  const nextActions = normalizePortfolioWidgetList(item?.nextActions);
  const role = String(chartSpec?.role || item?.outputRole || "").trim();
  const restoreMode = String(chartSpec?.restoreMode || "").trim();
  const type = normalizePortfolioWidgetVisualType(item?.visualType || chartSpec?.type || "");
  const hasBacktestShape =
    item?.outputRole === "backtest_result" ||
    role === "backtest_result" ||
    role === "period_return_comparison" ||
    restoreMode === "self_table_toggle" ||
    nextActions.includes("run_backtest_chart_widget") ||
    nextActions.includes("run_yfinance_backtest_comparison") ||
    type === "line" ||
    (Array.isArray(chartSpec.sourceTables) && chartSpec.sourceTables.length > 0);
  return (
    normalizePortfolioWidgetStatus(item?.status) === "error" &&
    hasBacktestShape &&
    portfolioWidgetHasStoredBacktestFailureMarker(item, chartSpec)
  );
}

const legacyPortfolioDemoInput = [
  "ticker,name,assetClass,region,value,cost",
  "AAPL,Apple,미국 대형주,미국,18500000,15200000",
  "MSFT,Microsoft,미국 대형주,미국,16400000,13900000",
  "NVDA,NVIDIA,AI 성장주,미국,14600000,9200000",
  "SCHD,Schwab US Dividend ETF,배당 ETF,미국,9800000,9500000",
  "TLT,iShares 20+ Year Treasury Bond ETF,장기채,미국,7600000,8100000",
  "GLD,SPDR Gold Shares,금,글로벌,5200000,4800000",
  "CASH,현금,현금,원화,4100000,4100000",
].join("\n");

const emptyPortfolioActivityLog = [
  "빈 포트폴리오 캔버스 준비",
  "사이드바 에이전트 입력 대기",
  "첫 에이전트 요청 전 상태",
];

export const portfolioBacktestPeriodOptions = [
  { id: "6mo", label: "6개월" },
  { id: "1y", label: "1년" },
  { id: "3y", label: "3년" },
  { id: "5y", label: "5년" },
];

export const portfolioAssetHistoryTimeframeOptions = [
  { id: "1d", label: "일별" },
  { id: "1wk", label: "주별" },
  { id: "1mo", label: "월별" },
];

function trimPortfolioMemoryText(value, maxLength = 420) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function trimPortfolioChatText(value, maxLength = 420) {
  const text = String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

export function normalizePortfolioCanvasMode(value) {
  const normalized = String(value || "").trim();
  if (normalized === "strategy" || normalized === PORTFOLIO_CANVAS_MODE_IDS.strategy) {
    return PORTFOLIO_CANVAS_MODE_IDS.strategy;
  }
  return PORTFOLIO_CANVAS_MODE_IDS.asset;
}

export function portfolioCanvasDefaultName(index, mode = PORTFOLIO_CANVAS_MODE_IDS.asset) {
  const normalizedMode = normalizePortfolioCanvasMode(mode);
  const prefix =
    normalizedMode === PORTFOLIO_CANVAS_MODE_IDS.strategy
      ? "이름 없는 전략 캔버스"
      : "이름 없는 자산 캔버스";
  return `${prefix} ${index}`;
}

export function defaultPortfolioStrategyPortfolios() {
  const now = new Date().toISOString();
  return [
    {
      id: `strategy_portfolio_a_${Date.now()}`,
      name: "A 전략 포트폴리오",
      weights: [],
      dataSources: [],
      assumptions: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `strategy_portfolio_b_${Date.now()}`,
      name: "B 전략 포트폴리오",
      weights: [],
      dataSources: [],
      assumptions: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function normalizePortfolioStrategyPortfolios(value) {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  return value
    .slice(0, 12)
    .map((item, index) => ({
      id: String(item?.id || `strategy_portfolio_${index + 1}_${Date.now()}`),
      name: cleanPortfolioWidgetText(item?.name || `${String.fromCharCode(65 + index)} 전략 포트폴리오`, 80),
      weights: Array.isArray(item?.weights) ? item.weights.slice(0, 80) : [],
      dataSources: Array.isArray(item?.dataSources) ? item.dataSources.slice(0, 20) : [],
      assumptions: normalizePortfolioWidgetList(item?.assumptions, 8, 140),
      createdAt: String(item?.createdAt || now),
      updatedAt: String(item?.updatedAt || item?.createdAt || now),
    }))
    .filter((item) => item.name);
}

export function defaultPortfolioWorkspaceState({ workspaceStarted = false } = {}) {
  return {
    workspaceStarted,
    inputText: "",
    backtestPeriod: "1y",
    assetHistoryRange: normalizePortfolioAssetHistoryRange(),
    benchmark: "",
    workspaceStatus: "draft",
    activityLog: emptyPortfolioActivityLog,
    liveBacktest: null,
    widgets: [],
    scenario: normalizePortfolioScenarioSpec(null, { backtestPeriod: "1y" }),
    nextWidgetDisplayIndex: 1,
    strategyPortfolios: [],
    processedAgentActionKeys: [],
  };
}

export function normalizePortfolioAssetHistoryDate(value = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || "").trim());
  if (!match) return "";
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? date : "";
}

export function portfolioAssetHistoryTodayDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

export function normalizePortfolioAssetHistoryRange(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const timeframe = portfolioAssetHistoryTimeframeOptions.some((option) => option.id === source.timeframe)
    ? source.timeframe
    : "1d";
  return {
    startDate: normalizePortfolioAssetHistoryDate(source.startDate || source.start || ""),
    endDate: normalizePortfolioAssetHistoryDate(source.endDate || source.end || ""),
    timeframe,
  };
}

export function clampPortfolioAssetHistoryRange(value = {}, { minimumDate = "", maximumDate = "" } = {}) {
  const source = normalizePortfolioAssetHistoryRange(value);
  const min = normalizePortfolioAssetHistoryDate(minimumDate);
  const max = normalizePortfolioAssetHistoryDate(maximumDate);
  let startDate = source.startDate;
  let endDate = source.endDate;

  if (min && startDate && startDate < min) startDate = min;
  if (max && endDate && endDate > max) endDate = max;
  if (max && startDate && startDate > max) startDate = max;
  if (min && endDate && endDate < min) endDate = min;
  if (startDate && endDate && endDate < startDate) endDate = startDate;

  return {
    ...source,
    startDate,
    endDate,
  };
}

export function normalizePortfolioAssetHistoryDisplayRange(value = {}, options = {}) {
  const source = clampPortfolioAssetHistoryRange(value, options);
  const min = normalizePortfolioAssetHistoryDate(options.minimumDate);
  const max = normalizePortfolioAssetHistoryDate(options.maximumDate);

  return {
    ...source,
    startDate: min && source.startDate === min ? "" : source.startDate,
    endDate: max && source.endDate === max ? "" : source.endDate,
  };
}

function hashPortfolioActionText(value = "") {
  const source = String(value || "");
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function normalizePortfolioAgentActionKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanPortfolioWidgetText(item, 180)).filter(Boolean))].slice(-60);
}

export function portfolioWidgetAgentActionKey(action = {}, parsedAction = null, canvasId = "") {
  if (!action || typeof action !== "object") return "";
  const actionIdentity = [
    action.id,
    action.request?.requestId,
    parsedAction?.actionId,
    parsedAction?.id,
    parsedAction?.requestId,
  ]
    .map((item) => cleanPortfolioWidgetText(item, 80))
    .find(Boolean);
  const canvasKey = cleanPortfolioWidgetText(action.canvasId || parsedAction?.canvasId || canvasId || "", 80);
  if (actionIdentity) return [canvasKey, actionIdentity].filter(Boolean).join(":");
  const contentHash = hashPortfolioActionText(
    JSON.stringify({
      answer: action.answer || "",
      error: action.error || "",
      request: action.request || {},
      widgetId: action.widgetId || "",
      parsedAction: parsedAction || null,
    })
  );
  return [canvasKey, contentHash].filter(Boolean).join(":");
}

export function safePortfolioBacktestPayload(value) {
  if (!value?.ok || !Array.isArray(value.series)) return null;
  const includeBenchmark = value.includeBenchmark === true && Boolean(value.benchmark);
  return {
    ok: true,
    source: value.source || "yfinance",
    methodology: value.methodology || "",
    fetchedAt: value.fetchedAt || "",
    period: value.period || "1y",
    includeBenchmark,
    benchmark: includeBenchmark ? value.benchmark : "",
    betaBenchmark: value.betaBenchmark || "",
    tickers: Array.isArray(value.tickers) ? value.tickers.slice(0, 80) : [],
    issues: Array.isArray(value.issues) ? value.issues.slice(0, 40) : [],
    metrics: value.metrics || {},
    series: value.series.slice(-1400),
  };
}

export function normalizePortfolioWidgets(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const usedDisplayIds = new Set();
  for (const item of value.slice(0, 40)) {
    const rawLayout = item?.layout && typeof item.layout === "object" ? item.layout : {};
    const prompt = cleanPortfolioWidgetText(item?.prompt || item?.body || "", 1200);
    const title = cleanPortfolioWidgetText(item?.title || "", 80) || "새 포트폴리오 위젯";
    const storedBacktestFailure = portfolioWidgetLooksLikeStoredBacktestFailure(item);
    const rawChartSpec = item?.chartSpec && typeof item.chartSpec === "object" ? item.chartSpec : {};
    const visualTypeSource = storedBacktestFailure && rawChartSpec?.type ? rawChartSpec.type : item?.visualType || item?.chartSpec?.type || "";
    const visualType = cleanPortfolioWidgetText(normalizePortfolioWidgetVisualType(visualTypeSource), 30);
    const isMarkdownWidget = portfolioWidgetIsMarkdownType(visualType);
    const defaultSpan = isMarkdownWidget ? 3 : 1;
    const w = clampPortfolioWidgetNumber(item?.w ?? rawLayout.w ?? rawLayout.width, 1, PORTFOLIO_WIDGET_MAX_SPAN, defaultSpan);
    const h = clampPortfolioWidgetNumber(item?.h ?? rawLayout.h ?? rawLayout.height, 1, PORTFOLIO_WIDGET_MAX_HEIGHT, defaultSpan);
    const x = clampPortfolioWidgetNumber(item?.x ?? rawLayout.x ?? rawLayout.col, 0, PORTFOLIO_WIDGET_GRID_COLUMNS - w, 0);
    const y = clampPortfolioWidgetNumber(item?.y ?? rawLayout.y ?? rawLayout.row, 0, PORTFOLIO_WIDGET_MAX_ROWS - h, normalized.length);
    const dataset = isMarkdownWidget ? [] : normalizePortfolioWidgetDataset(item?.dataset || item?.chartSpec?.dataset);
    const markdown = isMarkdownWidget
      ? normalizePortfolioMarkdownText(
          item?.markdown,
          item?.markdownText,
          item?.content,
          item?.document,
          item?.body,
          item?.agentSummary,
          item?.summary,
          item?.lastAgentAnswer,
          prompt
        )
      : "";
    const echarts = isMarkdownWidget
      ? normalizePortfolioMarkdownECharts(
          item?.echarts,
          item?.eCharts,
          item?.echartsOptions,
          item?.echartsOption,
          item?.chartSpec?.echarts,
          item?.chartSpec?.echartsOptions,
          item?.chartSpec?.echartsOption,
          item?.chartSpec?.option,
          item?.chartSpec
        )
      : [];
    const rawDataFiles = normalizePortfolioWidgetDataFiles(
      item?.dataFiles,
      item?.dataSources,
      item?.files,
      item?.attachments,
      visualType === "function" ? item?.functionSpec?.dataSources : null,
      visualType === "function" ? item?.functionSpec?.dataFiles : null
    );
    const dataFilesForVisualType = rawDataFiles.filter((dataFile) => portfolioWidgetKeepsDataFile(visualType, dataFile));
    const normalizedFunctionSpec =
      visualType === "function"
        ? normalizePortfolioFunctionSpec(item?.functionSpec || item?.strategySpec || item?.tradingStrategy)
        : null;
    const functionSpec = normalizedFunctionSpec
      ? {
          ...normalizedFunctionSpec,
          dataSources: filterPortfolioFunctionDataSources(
            normalizedFunctionSpec,
            rawDataFiles.length ? rawDataFiles : normalizedFunctionSpec.dataSources
          ),
        }
      : null;
    const dataFiles = visualType === "function"
      ? filterPortfolioFunctionDataSources(functionSpec || normalizedFunctionSpec || {}, dataFilesForVisualType.length ? dataFilesForVisualType : functionSpec?.dataSources || [])
      : dataFilesForVisualType.length ? dataFilesForVisualType : functionSpec?.dataSources || [];
    let displayId = normalizePortfolioWidgetDisplayId(item?.displayId || item?.widgetDisplayId, normalized.length + 1);
    while (usedDisplayIds.has(displayId)) {
      displayId = portfolioWidgetDisplayId(Number(displayId.replace(/\D/g, "")) + 1);
    }
    usedDisplayIds.add(displayId);
    const id = String(item?.id || `portfolio_widget_${Date.now()}_${normalized.length}`);
    const chartSpec = buildPortfolioWidgetChartSpec(item?.chartSpec || item || {}, visualType, dataset);
    if (visualType === "line" && Array.isArray(chartSpec.sourceWidgetIds)) {
      chartSpec.sourceWidgetIds = chartSpec.sourceWidgetIds.filter((sourceId) => sourceId && sourceId !== id && sourceId !== displayId);
      if (!chartSpec.restoreMode && chartSpec.sourceTables?.some((table) => table?.id === id || table?.displayId === displayId)) {
        chartSpec.restoreMode = "self_table_toggle";
      }
      if (storedBacktestFailure && !chartSpec.restoreMode && chartSpec.sourceTables?.length) {
        chartSpec.restoreMode = "self_table_toggle";
      }
    }
    const kind = cleanPortfolioWidgetText(item?.kind || "", 40) || "프롬프트 위젯";
    const dependsOn = isMarkdownWidget
      ? []
      : normalizePortfolioWidgetReferenceList(item?.dependsOn).filter((sourceId) => sourceId !== id && sourceId !== displayId);
    const derivedFrom = isMarkdownWidget
      ? []
      : normalizePortfolioWidgetDerivedFrom(item?.derivedFrom).filter((row) => row.widgetId !== id && row.widgetId !== displayId);
    const storedWidgetForStatus = {
      ...item,
      id,
      displayId,
      title,
      prompt,
      kind,
      visualType,
      dataset,
      chartSpec,
      functionSpec,
      dataFiles,
    };
    const normalizedAgentSummary = isMarkdownWidget ? "" : cleanPortfolioWidgetText(item?.agentSummary || item?.summary || "", 360);
    const status = normalizePortfolioWidgetStatus(item?.status);
    const normalizedChecks = normalizePortfolioWidgetList(item?.checks);
    const normalizedStatus = status === "error" && storedBacktestFailure
        ? "stale"
        : status;
    const checks = normalizedChecks;
    const nextActions = isMarkdownWidget ? [] : normalizePortfolioWidgetNextActionsForState(storedWidgetForStatus, item?.nextActions);
    const outputRole = normalizePortfolioWidgetOutputRole({
      ...item,
      title,
      kind,
      visualType,
      chartSpec,
      functionSpec,
    });
    const signalMatrix =
      visualType === "function"
        ? normalizePortfolioSignalMatrix(item?.signalMatrix, {
            widget: storedWidgetForStatus,
            functionSpec,
            dataFiles,
          })
        : null;
    const updatePolicy = portfolioWidgetShouldAutoRunBacktest({ ...storedWidgetForStatus, nextActions })
      ? "auto"
      : normalizePortfolioWidgetUpdatePolicy(item?.updatePolicy);
    normalized.push({
      id,
      displayId,
      graphRole: cleanPortfolioWidgetText(item?.graphRole || "process_node", 60),
      scenarioId: cleanPortfolioWidgetText(item?.scenarioId || item?.scenario?.id || PORTFOLIO_SCENARIO_ROOT_ID, 80),
      outputRole,
      x,
      y,
      w,
      h,
      title,
      prompt,
      kind,
      status: normalizedStatus,
      agentSummary: normalizedAgentSummary,
      visualType,
      markdown,
      echarts,
      dataset,
      chartSpec,
      functionSpec,
      signalMatrix,
      dataFiles,
      badges: normalizePortfolioWidgetList(item?.badges, 4, 80),
      requirements: normalizePortfolioWidgetList(item?.requirements),
      checks,
      nextActions,
      lastAgentAnswer: cleanPortfolioWidgetText(item?.lastAgentAnswer || "", 1600),
      errorCode: cleanPortfolioWidgetText(item?.errorCode || item?.failureCode || "", 120),
      failureRole: cleanPortfolioWidgetText(item?.failureRole || "", 80),
      dependsOn,
      derivedFrom,
      updatePolicy,
      version: Math.max(1, Number(item?.version || 1) || 1),
      lastComputedFrom: item?.lastComputedFrom && typeof item.lastComputedFrom === "object" ? item.lastComputedFrom : {},
      staleReason: cleanPortfolioWidgetText(item?.staleReason || (storedBacktestFailure ? "백테스트 재실행 필요" : ""), 180),
      staleSince: String(item?.staleSince || ""),
      createdAt: String(item?.createdAt || new Date().toISOString()),
      updatedAt: String(item?.updatedAt || item?.createdAt || new Date().toISOString()),
    });
  }
  return normalizePortfolioWidgetFlowRelations(normalized);
}

function normalizePortfolioWidgetFlowRelations(widgets = []) {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  return widgets.map((widget) => {
    const dependsOn = [];
    for (const ref of normalizePortfolioWidgetReferenceList(widget.dependsOn)) {
      const id = resolvePortfolioWidgetReferenceId(ref, widgets);
      if (!id || id === widget.id || dependsOn.includes(id)) continue;
      const sourceWidget = byId.get(id);
      if (!sourceWidget) continue;
      if (!portfolioWidgetCanDependOnWidget(widget, sourceWidget)) continue;
      if (wouldCreatePortfolioWidgetDependencyCycle(widget.id, id, widgets)) continue;
      dependsOn.push(id);
    }
    const derivedFrom = normalizePortfolioWidgetDerivedFrom(widget.derivedFrom)
      .map((row) => {
        const id = resolvePortfolioWidgetReferenceId(row.widgetId, widgets);
        if (!id || !dependsOn.includes(id)) return null;
        return { ...row, widgetId: id };
      })
      .filter(Boolean);
    return {
      ...widget,
      dependsOn,
      derivedFrom,
      lastComputedFrom: portfolioWidgetComputedFrom(dependsOn, widgets),
    };
  });
}

function portfolioStoredWidgetHasMetricRows(widget = {}) {
  const chartSpec = widget?.chartSpec || {};
  return Boolean(
    (Array.isArray(widget?.metrics) && widget.metrics.length) ||
      (Array.isArray(widget?.standardMetrics) && widget.standardMetrics.length) ||
      (Array.isArray(chartSpec.metrics) && chartSpec.metrics.length) ||
      (Array.isArray(chartSpec.standardMetrics) && chartSpec.standardMetrics.length)
  );
}

function repairStoredPeriodComparisonWorkspace({ widgets = [], scenario = null, backtestPeriod = "1y" } = {}) {
  if (!portfolioScenarioHasIncompleteComparisonRuns(scenario)) return { widgets, scenario };
  const target = widgets.find((widget) => {
    if (widget?.visualType === "line" || widget?.outputRole === "backtest_result") return true;
    return widget?.visualType === "metrics-table" && !portfolioStoredWidgetHasMetricRows(widget);
  });
  if (!target) return { widgets, scenario };

  const repairedWidgets = widgets.map((widget) => {
    if (widget.id !== target.id) return widget;
    const chartSpec = buildPortfolioWidgetChartSpec(
      {
        ...widget,
        kind: "백테스트 비교",
        visualType: "line",
        chartSpec: {
          ...(widget.chartSpec || {}),
          type: "line",
          role: widget.chartSpec?.role || "period_return_comparison",
          xField: widget.chartSpec?.xField || "date",
          includeBenchmark: widget.chartSpec?.includeBenchmark ?? false,
          benchmarkMode: widget.chartSpec?.benchmarkMode || "none",
          benchmark: widget.chartSpec?.benchmark || "",
        },
      },
      "line",
      []
    );
    const baseActions = Array.isArray(widget.nextActions) ? widget.nextActions : [];
    const nextActions = normalizePortfolioWidgetNextActionsForState(
      {
        ...widget,
        kind: "백테스트 비교",
        visualType: "line",
        chartSpec,
      },
      ["run_backtest_chart_widget", ...baseActions]
    );
    return {
      ...widget,
      kind: "백테스트 비교",
      visualType: "line",
      outputRole: normalizePortfolioWidgetOutputRole({
        ...widget,
        outputRole: "",
        kind: "백테스트 비교",
        visualType: "line",
        chartSpec,
      }),
      chartSpec,
      checks: normalizePortfolioWidgetList(
        [
          ...(Array.isArray(widget.checks) ? widget.checks : []),
          "복수 기간 비교는 scenario.runs 각각에 startDate와 endDate가 필요합니다.",
        ],
        6,
        140
      ),
      nextActions: nextActions.filter((action) => !PORTFOLIO_BACKTEST_CHART_ACTIONS.has(normalizePortfolioWorkspaceToken(action))),
      status: "error",
      updatePolicy: "manual",
      staleReason: widget.staleReason || "기간 비교 시나리오 경계 필요",
    };
  });

  return {
    widgets: normalizePortfolioWidgetFlowRelations(repairedWidgets),
    scenario,
  };
}

export function compactPortfolioWidget(widget) {
  return {
    id: widget.id,
    displayId: widget.displayId,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    title: widget.title,
    prompt: widget.prompt,
    kind: widget.kind,
    status: widget.status,
    agentSummary: widget.agentSummary,
    visualType: widget.visualType,
    markdown: widget.markdown,
    echarts: widget.echarts,
    dataset: widget.dataset,
    chartSpec: widget.chartSpec,
    functionSpec: widget.functionSpec,
    signalMatrix: widget.signalMatrix,
    dataFiles: widget.dataFiles,
    graphRole: widget.graphRole,
    scenarioId: widget.scenarioId,
    outputRole: widget.outputRole,
    badges: widget.badges,
    requirements: widget.requirements,
    checks: widget.checks,
    nextActions: normalizePortfolioWidgetNextActionsForState(widget),
    lastAgentAnswer: widget.lastAgentAnswer,
    errorCode: widget.errorCode,
    failureRole: widget.failureRole,
    dependsOn: widget.dependsOn,
    derivedFrom: widget.derivedFrom,
    updatePolicy: widget.updatePolicy,
    version: widget.version,
    lastComputedFrom: widget.lastComputedFrom,
    staleReason: widget.staleReason,
    staleSince: widget.staleSince,
    createdAt: widget.createdAt,
    updatedAt: widget.updatedAt,
  };
}

export function normalizePortfolioWorkspaceState(stored, { forceStarted = false } = {}) {
  const fallback = defaultPortfolioWorkspaceState({ workspaceStarted: forceStarted });
  if (!stored || typeof stored !== "object") return fallback;
  const storedInputText = typeof stored.inputText === "string" ? stored.inputText : "";
  const isLegacyDemoInput = storedInputText.trim() === legacyPortfolioDemoInput.trim();
  const widgets = isLegacyDemoInput ? [] : normalizePortfolioWidgets(stored.widgets);
  const storedNextWidgetDisplayIndex = Number(stored.nextWidgetDisplayIndex || stored.nextWidgetIndex || 1);
  const backtestPeriod = portfolioBacktestPeriodOptions.some((option) => option.id === stored.backtestPeriod)
    ? stored.backtestPeriod
    : fallback.backtestPeriod;
  const normalizedScenario = normalizePortfolioScenarioSpec(stored.scenario, { backtestPeriod });
  const repairedWorkspace = repairStoredPeriodComparisonWorkspace({
    widgets,
    scenario: normalizedScenario,
    backtestPeriod,
  });
  const normalizedWidgets = repairedWorkspace.widgets;

  return {
    workspaceStarted: forceStarted || (typeof stored.workspaceStarted === "boolean" ? stored.workspaceStarted : fallback.workspaceStarted),
    inputText: isLegacyDemoInput ? fallback.inputText : storedInputText.trim() ? storedInputText : fallback.inputText,
    backtestPeriod,
    assetHistoryRange: isLegacyDemoInput ? fallback.assetHistoryRange : normalizePortfolioAssetHistoryRange(stored.assetHistoryRange),
    benchmark: typeof stored.benchmark === "string" && stored.benchmark.trim() ? stored.benchmark.trim().toUpperCase() : fallback.benchmark,
    workspaceStatus: stored.workspaceStatus === "remembered" || stored.workspaceStatus === "review-ready" ? stored.workspaceStatus : "draft",
    activityLog: !isLegacyDemoInput && Array.isArray(stored.activityLog) && stored.activityLog.length
      ? stored.activityLog.slice(-8).map((item) => String(item || "").slice(0, 140))
      : fallback.activityLog,
    liveBacktest: isLegacyDemoInput ? null : safePortfolioBacktestPayload(stored.liveBacktest),
    widgets: normalizedWidgets,
    scenario: repairedWorkspace.scenario,
    nextWidgetDisplayIndex: Math.max(
      1,
      Number.isFinite(storedNextWidgetDisplayIndex) ? storedNextWidgetDisplayIndex : 1,
      nextPortfolioWidgetDisplayIndexFromStoredState(stored),
      nextPortfolioWidgetDisplayIndex(normalizedWidgets)
    ),
    strategyPortfolios: isLegacyDemoInput ? [] : normalizePortfolioStrategyPortfolios(stored.strategyPortfolios),
    processedAgentActionKeys: isLegacyDemoInput ? [] : normalizePortfolioAgentActionKeys(stored.processedAgentActionKeys),
  };
}

export function readStoredPortfolioWorkspaceState() {
  const fallback = defaultPortfolioWorkspaceState();
  if (typeof window === "undefined") return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(PORTFOLIO_WORKSPACE_STORAGE_KEY) || "null");
    return normalizePortfolioWorkspaceState(stored);
  } catch {
    return fallback;
  }
}

export function hasMeaningfulPortfolioWorkspaceState(state) {
  return Boolean(
    state?.workspaceStarted ||
      String(state?.inputText || "").trim() ||
      state?.liveBacktest ||
      normalizePortfolioWidgets(state?.widgets).length
  );
}

function nextPortfolioCanvasId() {
  return `portfolio_canvas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nextPortfolioCanvasIndex(canvases = [], mode = "") {
  const targetMode = mode ? normalizePortfolioCanvasMode(mode) : "";
  const used = new Set(
    canvases
      .filter((canvas) => !targetMode || normalizePortfolioCanvasMode(canvas?.mode) === targetMode)
      .map((canvas) => String(canvas?.name || "").match(/^이름 없는 캔버스\s+(\d+)$/)?.[1])
      .filter(Boolean)
      .concat(
        canvases
          .filter((canvas) => !targetMode || normalizePortfolioCanvasMode(canvas?.mode) === targetMode)
          .map((canvas) => String(canvas?.name || "").match(/^이름 없는 (?:자산|전략) 캔버스\s+(\d+)$/)?.[1])
          .filter(Boolean)
      )
      .filter(Boolean)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
  );
  let index = 1;
  while (used.has(index)) index += 1;
  return index;
}

export function clonePortfolioJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch {
    return fallback;
  }
}

function compactChatMessage(message) {
  if (!message || typeof message !== "object") return null;
  const role = message.role === "assistant" ? "assistant" : "user";
  const base = {
    id: String(message.id || `${role}-${Date.now()}`),
    role,
    time: String(message.time || ""),
  };
  if (role === "user") {
    return {
      ...base,
      text: trimPortfolioChatText(message.text || "", PORTFOLIO_CHAT_USER_TEXT_LIMIT),
      article: message.article
        ? {
            title: trimPortfolioMemoryText(message.article.title || "", 180),
            url: trimPortfolioMemoryText(message.article.url || message.article.href || "", 420),
            href: trimPortfolioMemoryText(message.article.href || message.article.url || "", 420),
            source: trimPortfolioMemoryText(message.article.source || "", 80),
          }
        : null,
      attachments: Array.isArray(message.attachments)
        ? message.attachments.slice(0, PORTFOLIO_MAX_CHAT_ATTACHMENTS).map((attachment) => ({
            id: String(attachment.id || attachment.name || ""),
            name: trimPortfolioMemoryText(attachment.name || "첨부 파일", 180),
            type: trimPortfolioMemoryText(attachment.type || "", 120),
            size: Number(attachment.size || 0),
            dataUrl: portfolioWidgetDataFileCanInline({ name: attachment.name || "", type: attachment.type || "" })
              ? normalizePortfolioWidgetInlineData(attachment.dataUrl || "")
              : "",
            text: portfolioWidgetDataFileCanInline({ name: attachment.name || "", type: attachment.type || "" })
              ? normalizePortfolioWidgetInlineData(attachment.text || attachment.content || attachment.csv || attachment.rawText || "")
              : "",
          }))
        : [],
    };
  }
  return {
    ...base,
    providerLabel: trimPortfolioMemoryText(message.providerLabel || "", 80),
    blocks: Array.isArray(message.blocks)
      ? message.blocks.slice(-20).map((block) => ({
          type: block.type || "paragraph",
          tone: block.tone || "",
          title: trimPortfolioMemoryText(block.title || "", 180),
          body: trimPortfolioChatText(block.body || "", PORTFOLIO_CHAT_STATUS_BODY_LIMIT),
          text: trimPortfolioChatText(block.text || "", PORTFOLIO_CHAT_ASSISTANT_TEXT_LIMIT),
        }))
      : [],
  };
}

export function normalizePortfolioChatMessages(value) {
  return Array.isArray(value)
    ? value.map(compactChatMessage).filter(Boolean).slice(-PORTFOLIO_CHAT_MEMORY_LIMIT)
    : [];
}

function portfolioAttachmentLookupKey(value = {}) {
  const rawUrl = String(value?.dataUrl || value?.dataURL || value?.dataUri || value?.dataURI || "");
  const attachmentId = rawUrl.startsWith("attachment://") ? rawUrl.slice("attachment://".length) : "";
  const id = String(value?.id || value?.attachmentId || value?.fileId || attachmentId || "").trim();
  const name = String(value?.name || value?.fileName || value?.filename || "").trim().toLowerCase();
  const stem = name.replace(/\.[^.]+$/, "");
  return { id, name, stem };
}

function portfolioCanvasAttachmentLookup(chatMessages = []) {
  const lookup = new Map();
  const put = (key, attachment) => {
    if (key && !lookup.has(key)) lookup.set(key, attachment);
  };
  chatMessages.forEach((message) => {
    (Array.isArray(message?.attachments) ? message.attachments : []).forEach((attachment) => {
      const [normalizedAttachment] = normalizePortfolioWidgetDataFiles(attachment);
      if (!normalizedAttachment?.text && !normalizedAttachment?.dataUrl) return;
      const key = portfolioAttachmentLookupKey(normalizedAttachment);
      put(key.id, normalizedAttachment);
      put(key.name, normalizedAttachment);
      put(key.stem, normalizedAttachment);
    });
  });
  return lookup;
}

function portfolioCanvasAttachmentForDataFile(dataFile = {}, lookup = new Map()) {
  const key = portfolioAttachmentLookupKey(dataFile);
  return lookup.get(key.id) || lookup.get(key.name) || lookup.get(key.stem) || null;
}

function hydratePortfolioCanvasDataFile(dataFile = {}, lookup = new Map()) {
  const attachment = portfolioCanvasAttachmentForDataFile(dataFile, lookup);
  if (!attachment) return dataFile;
  const rawUrl = String(dataFile?.dataUrl || dataFile?.dataURL || dataFile?.dataUri || dataFile?.dataURI || "");
  return {
    ...dataFile,
    id: dataFile.id || attachment.id,
    type: dataFile.type || attachment.type,
    size: Math.max(Number(dataFile.size) || 0, Number(attachment.size) || 0),
    source: dataFile.source || attachment.source,
    status: "attached",
    dataUrl: rawUrl.startsWith("attachment://") ? attachment.dataUrl : dataFile.dataUrl || attachment.dataUrl,
    text: dataFile.text || attachment.text,
  };
}

function hydratePortfolioWorkspaceAttachmentData(workspace = {}, chatMessages = []) {
  const attachmentLookup = portfolioCanvasAttachmentLookup(chatMessages);
  if (!attachmentLookup.size || !Array.isArray(workspace.widgets)) return workspace;
  return {
    ...workspace,
    widgets: workspace.widgets.map((widget) => {
      if (widget?.visualType !== "function") return widget;
      const dataFiles = normalizePortfolioWidgetDataFiles(
        widget.dataFiles?.map((dataFile) => hydratePortfolioCanvasDataFile(dataFile, attachmentLookup)),
        widget.functionSpec?.dataSources?.map((dataFile) => hydratePortfolioCanvasDataFile(dataFile, attachmentLookup))
      );
      if (!dataFiles.length) return widget;
      const functionSpec = widget.functionSpec
        ? {
            ...widget.functionSpec,
            dataSources: filterPortfolioFunctionDataSources(widget.functionSpec, dataFiles),
          }
        : widget.functionSpec;
      const filteredDataFiles = filterPortfolioFunctionDataSources(functionSpec || widget.functionSpec || {}, dataFiles);
      const signalMatrix = normalizePortfolioSignalMatrix(widget.signalMatrix, {
        widget: {
          ...widget,
          dataFiles: filteredDataFiles,
          functionSpec,
        },
        functionSpec,
        dataFiles: filteredDataFiles,
      });
      return {
        ...widget,
        dataFiles: filteredDataFiles,
        functionSpec: functionSpec ? { ...functionSpec, dataSources: filteredDataFiles } : functionSpec,
        signalMatrix,
      };
    }),
  };
}

export function createPortfolioCanvas({ index = 1, name = "", mode = PORTFOLIO_CANVAS_MODE_IDS.asset, workspace = null, chatMessages = [] } = {}) {
  const now = new Date().toISOString();
  const canvasMode = normalizePortfolioCanvasMode(mode);
  const normalizedWorkspace = normalizePortfolioWorkspaceState(workspace, { forceStarted: true });
  if (
    canvasMode === PORTFOLIO_CANVAS_MODE_IDS.strategy &&
    !normalizePortfolioStrategyPortfolios(normalizedWorkspace.strategyPortfolios).length
  ) {
    normalizedWorkspace.strategyPortfolios = defaultPortfolioStrategyPortfolios();
  }
  return {
    id: nextPortfolioCanvasId(),
    mode: canvasMode,
    name: cleanPortfolioWidgetText(name, 80) || portfolioCanvasDefaultName(index, canvasMode),
    workspace: normalizedWorkspace,
    chatMessages: normalizePortfolioChatMessages(chatMessages),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizePortfolioCanvas(canvas, index = 1) {
  if (!canvas || typeof canvas !== "object") return null;
  const id = String(canvas.id || "").trim();
  if (!id) return null;
  const now = new Date().toISOString();
  const mode = normalizePortfolioCanvasMode(canvas.mode);
  const chatMessages = normalizePortfolioChatMessages(canvas.chatMessages);
  const workspace = hydratePortfolioWorkspaceAttachmentData(
    normalizePortfolioWorkspaceState(canvas.workspace, { forceStarted: true }),
    chatMessages
  );
  return {
    id,
    mode,
    name: cleanPortfolioWidgetText(canvas.name, 80) || portfolioCanvasDefaultName(index, mode),
    workspace,
    chatMessages,
    createdAt: String(canvas.createdAt || now),
    updatedAt: String(canvas.updatedAt || canvas.createdAt || now),
  };
}

export function normalizePortfolioCanvasStore(store) {
  const canvases = (Array.isArray(store?.canvases) ? store.canvases : [])
    .map((canvas, index) => normalizePortfolioCanvas(canvas, index + 1))
    .filter(Boolean);
  const activeCanvasId = canvases.some((canvas) => canvas.id === store?.activeCanvasId)
    ? store.activeCanvasId
    : canvases[0]?.id || "";
  return { canvases, activeCanvasId };
}

export function portfolioCanvasStoreHasCanvases(store) {
  return normalizePortfolioCanvasStore(store).canvases.length > 0;
}

function readStoredPortfolioCanvasStoreKey(key) {
  if (typeof window === "undefined") return null;
  try {
    const storedText = window.localStorage.getItem(key);
    if (storedText === null) return null;
    const stored = JSON.parse(storedText || "null");
    if (stored && typeof stored === "object" && Array.isArray(stored.canvases)) {
      return normalizePortfolioCanvasStore(stored);
    }
  } catch {
    return null;
  }
  return { canvases: [], activeCanvasId: "" };
}

export function writeStoredPortfolioCanvasStore(store) {
  if (typeof window === "undefined") return;
  const normalizedStore = normalizePortfolioCanvasStore(store);
  try {
    window.localStorage.setItem(PORTFOLIO_CANVASES_STORAGE_KEY, JSON.stringify(normalizedStore));
    if (portfolioCanvasStoreHasCanvases(normalizedStore)) {
      window.localStorage.setItem(PORTFOLIO_CANVASES_BACKUP_STORAGE_KEY, JSON.stringify(normalizedStore));
    }
  } catch {
    // Browser storage is only a migration/backup layer; the file API is primary.
  }
}

export function readStoredPortfolioCanvasStore() {
  if (typeof window === "undefined") return { canvases: [], activeCanvasId: "" };
  const currentStore = readStoredPortfolioCanvasStoreKey(PORTFOLIO_CANVASES_STORAGE_KEY);
  if (portfolioCanvasStoreHasCanvases(currentStore)) {
    return currentStore;
  }
  const backupStore = readStoredPortfolioCanvasStoreKey(PORTFOLIO_CANVASES_BACKUP_STORAGE_KEY);
  if (portfolioCanvasStoreHasCanvases(backupStore)) {
    return backupStore;
  }

  const legacyWorkspace = readStoredPortfolioWorkspaceState();
  if (!hasMeaningfulPortfolioWorkspaceState(legacyWorkspace)) {
    return currentStore || backupStore || { canvases: [], activeCanvasId: "" };
  }
  const migratedCanvas = createPortfolioCanvas({
    index: 1,
    workspace: legacyWorkspace,
  });
  return {
    canvases: [migratedCanvas],
    activeCanvasId: migratedCanvas.id,
  };
}
