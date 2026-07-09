import { portfolioWidgetActionItems } from "./actionParser.js";
import { buildAllocationChartWidgetDraft } from "./allocationCompiler.js";
import { buildPortfolioWidgetChartSpec } from "./chartBuilders.js";
import { canPlacePortfolioWidget, findPortfolioWidgetPlacement } from "./widgetLayout.js";
import {
  cleanPortfolioWidgetText,
  nextPortfolioWidgetDisplayId,
} from "./widgetIdentity.js";
import {
  portfolioWidgetComputedFrom,
  resolvePortfolioWidgetRelations,
} from "./widgetRelations.js";
import { portfolioWidgetTableRows } from "./widgetRoleClassifier.js";
import { portfolioWidgetShouldCreateDefaultAllocationChart } from "./widgetDrafts.js";
import { normalizePortfolioSignalMatrix } from "./signalMatrixCompiler.js";
import {
  PORTFOLIO_SCENARIO_ROOT_ID,
  normalizePortfolioWidgetOutputRole,
} from "./scenarioContract.js";
import { portfolioWidgetIsMarkdownType } from "./markdownWidget.js";

const AGENT_CREATE_ACTION_TOKENS = new Set([
  "create_widget",
  "create_portfolio_widget",
  "create_widget_flow",
  "update_scenario",
  "render_portfolio_artifact",
  "artifact",
  "chart",
  "pie",
  "allocation",
  "price_history",
  "asset_history",
  "investment_history",
  "seasonal_comparison",
  "seasonal_return",
  "annual_return_comparison",
  "position_status",
  "holdings_status",
  "holdings_composition",
  "investment_position_status",
  "function",
  "strategy",
  "signal",
  "markdown",
  "document",
  "report",
  "import_holdings",
]);

function normalizeAgentWidgetActionToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function portfolioAgentDefaultKindForVisualType(visualType = "") {
  if (visualType === "table") return "포트폴리오 표";
  if (visualType === "function") return "함수 위젯";
  if (visualType === "line") return "백테스트 비교";
  if (visualType === "price-history") return "보유 자산 과거 내역 차트";
  if (visualType === "position-status") return "투자 종목 현황";
  if (visualType === "seasonal-comparison") return "시즌별 비교";
  if (visualType === "metrics-table") return "백테스트 지표";
  if (visualType === "markdown") return "마크다운 위젯";
  if (visualType === "allocation") return "포트폴리오 차트";
  if (visualType === "checklist") return "체크리스트";
  return "프롬프트 위젯";
}

function normalizeAssetHistoryCurrency(value = "") {
  return String(value || "").toUpperCase() === "USD" ? "USD" : "KRW";
}

function normalizePositionStatusView(value = "") {
  return String(value || "").toLowerCase() === "pie" ? "pie" : "bar";
}

function buildAssetHistoryChartSpec(patch = {}) {
  const chartSpec = patch.chartSpec && typeof patch.chartSpec === "object" ? patch.chartSpec : {};
  const query = chartSpec.query && typeof chartSpec.query === "object" ? chartSpec.query : {};
  const currency = normalizeAssetHistoryCurrency(query.currency || chartSpec.currency || patch.currency || patch.valueCurrency || "KRW");
  return {
    ...chartSpec,
    type: "price-history",
    engine: "lightweight-charts",
    chartType: "area",
    role: chartSpec.role || "asset_cost_basis_history",
    dataProvider: chartSpec.dataProvider || "토스 증권 Open API",
    source: chartSpec.source || "tossinvest-position-reconstruction",
    query: {
      startDate: String(query.startDate || "").trim(),
      startMode: query.startMode || (query.startDate ? "custom" : "first_trade"),
      effectiveStartDate: String(query.effectiveStartDate || query.startDate || "").trim(),
      endDate: String(query.endDate || "").trim(),
      endMode: query.endMode || (query.endDate ? "custom" : "latest"),
      effectiveEndDate: String(query.effectiveEndDate || query.endDate || "").trim(),
      effectiveEndLabel: query.effectiveEndLabel || (query.endDate ? "" : "latest"),
      timeframe: String(query.timeframe || chartSpec.timeframe || patch.timeframe || "1d").trim() || "1d",
      currency,
    },
  };
}

function normalizeAgentPriceHistoryPatch(patch = {}) {
  const visualType = patch.visualType || "";
  if (visualType !== "price-history") return patch;
  const preferredW = Math.max(3, Number(patch.preferredW || patch.w || 0) || 0);
  const preferredH = Math.max(3, Number(patch.preferredH || patch.h || 0) || 0);
  const kind = !patch.kind || patch.kind === "프롬프트 위젯" ? portfolioAgentDefaultKindForVisualType(visualType) : patch.kind;
  return {
    ...patch,
    title: patch.title || "보유 자산 과거 내역",
    kind,
    dataset: [],
    chartSpec: buildAssetHistoryChartSpec(patch),
    badges: patch.badges?.length ? patch.badges : ["Lightweight Charts"],
    preferredW,
    preferredH,
    outputRole: patch.outputRole || "asset_history",
    updatePolicy: patch.updatePolicy || "auto",
  };
}

function buildPositionStatusChartSpec(patch = {}) {
  const chartSpec = patch.chartSpec && typeof patch.chartSpec === "object" ? patch.chartSpec : {};
  const query = chartSpec.query && typeof chartSpec.query === "object" ? chartSpec.query : {};
  const currency = normalizeAssetHistoryCurrency(query.currency || chartSpec.currency || patch.currency || patch.valueCurrency || "KRW");
  const view = normalizePositionStatusView(query.view || chartSpec.view || patch.view || "bar");
  return {
    ...chartSpec,
    type: "position-status",
    engine: "react-css",
    chartType: view === "pie" ? "pie" : "stacked-bar",
    role: chartSpec.role || "investment_position_status",
    dataProvider: chartSpec.dataProvider || "토스 증권 Open API",
    source: chartSpec.source || "tossinvest-position-reconstruction",
    query: {
      endDate: String(query.endDate || "").trim(),
      endMode: query.endMode || (query.endDate ? "custom" : "latest"),
      effectiveEndDate: String(query.effectiveEndDate || query.endDate || "").trim(),
      effectiveEndLabel: query.effectiveEndLabel || (query.endDate ? "" : "latest"),
      currency,
      view,
    },
  };
}

function normalizeAgentPositionStatusPatch(patch = {}) {
  const visualType = patch.visualType || "";
  if (visualType !== "position-status") return patch;
  const preferredW = Math.max(3, Number(patch.preferredW || patch.w || 0) || 0);
  const preferredH = Math.max(3, Number(patch.preferredH || patch.h || 0) || 0);
  const kind = !patch.kind || patch.kind === "프롬프트 위젯" ? portfolioAgentDefaultKindForVisualType(visualType) : patch.kind;
  return {
    ...patch,
    title: patch.title || "투자 종목 현황",
    kind,
    dataset: [],
    chartSpec: buildPositionStatusChartSpec(patch),
    badges: patch.badges?.length ? patch.badges : ["토스 증권 Open API"],
    preferredW,
    preferredH,
    outputRole: patch.outputRole || "position_status",
    updatePolicy: patch.updatePolicy || "auto",
  };
}

function buildSeasonalComparisonChartSpec(patch = {}) {
  const chartSpec = patch.chartSpec && typeof patch.chartSpec === "object" ? patch.chartSpec : {};
  const query = chartSpec.query && typeof chartSpec.query === "object" ? chartSpec.query : {};
  const currency = normalizeAssetHistoryCurrency(query.currency || chartSpec.currency || patch.currency || patch.valueCurrency || "KRW");
  return {
    ...chartSpec,
    type: "seasonal-comparison",
    engine: "lightweight-charts",
    chartType: "line",
    role: chartSpec.role || "annual_return_overlay",
    dataProvider: chartSpec.dataProvider || "토스 증권 Open API",
    source: chartSpec.source || "tossinvest-position-reconstruction",
    query: {
      startDate: String(query.startDate || "").trim(),
      startMode: query.startMode || "first_trade",
      effectiveStartDate: String(query.effectiveStartDate || query.startDate || "").trim(),
      endDate: String(query.endDate || "").trim(),
      endMode: query.endMode || (query.endDate ? "custom" : "latest"),
      effectiveEndDate: String(query.effectiveEndDate || query.endDate || "").trim(),
      effectiveEndLabel: query.effectiveEndLabel || (query.endDate ? "" : "latest"),
      timeframe: "1d",
      currency,
      returnMode: query.returnMode || "year_to_date",
    },
  };
}

function normalizeAgentSeasonalComparisonPatch(patch = {}) {
  const visualType = patch.visualType || "";
  if (visualType !== "seasonal-comparison") return patch;
  const preferredW = Math.max(3, Number(patch.preferredW || patch.w || 0) || 0);
  const preferredH = Math.max(3, Number(patch.preferredH || patch.h || 0) || 0);
  const kind = !patch.kind || patch.kind === "프롬프트 위젯" ? portfolioAgentDefaultKindForVisualType(visualType) : patch.kind;
  return {
    ...patch,
    title: patch.title || "시즌별 비교",
    kind,
    dataset: [],
    chartSpec: buildSeasonalComparisonChartSpec(patch),
    badges: patch.badges?.length ? patch.badges : ["Lightweight Charts"],
    preferredW,
    preferredH,
    outputRole: patch.outputRole || "seasonal_comparison",
    updatePolicy: patch.updatePolicy || "auto",
  };
}

function normalizeAgentAssetPatch(patch = {}) {
  return normalizeAgentSeasonalComparisonPatch(normalizeAgentPositionStatusPatch(normalizeAgentPriceHistoryPatch(patch)));
}

export function portfolioAgentWidgetActionName(parsedAction = {}, request = {}) {
  return String(parsedAction?.action || parsedAction?.actionId || request?.action || "").toLowerCase();
}

export function portfolioAgentWidgetHasPayload(parsedAction = {}) {
  return Boolean(
    parsedAction?.widget ||
      portfolioWidgetActionItems(parsedAction).length ||
      parsedAction?.dataset ||
      parsedAction?.data ||
      parsedAction?.holdings ||
      parsedAction?.positions ||
      parsedAction?.chartSpec ||
      parsedAction?.chart ||
      parsedAction?.functionSpec ||
      parsedAction?.strategySpec ||
      parsedAction?.signalMatrix ||
      parsedAction?.signalSpec ||
      parsedAction?.rules ||
      parsedAction?.dataFiles ||
      parsedAction?.dataSources ||
      parsedAction?.files ||
      parsedAction?.attachments ||
      parsedAction?.metrics ||
      parsedAction?.standardMetrics ||
      parsedAction?.markdown ||
      parsedAction?.markdownText ||
      parsedAction?.content ||
      parsedAction?.document ||
      parsedAction?.echarts ||
      parsedAction?.echartsOption ||
      parsedAction?.echartsOptions ||
      parsedAction?.title
  );
}

export function portfolioAgentWidgetCreateIntent({
  actionName = "",
  agentWidgetAction = {},
  hasExplicitTarget = false,
  hasWidgetPayload = false,
  hasParsedAction = false,
} = {}) {
  const action = normalizeAgentWidgetActionToken(actionName);
  const request = agentWidgetAction?.request || {};
  const hasPayload = Boolean(hasWidgetPayload);
  const isAmbiguousUpdateWithPayload = false;
  const shouldCreateWidget =
    !agentWidgetAction?.error &&
    (hasParsedAction || request?.action === "create_widget") &&
    (AGENT_CREATE_ACTION_TOKENS.has(action) ||
      request?.action === "create_widget" ||
      isAmbiguousUpdateWithPayload);

  return {
    shouldCreateWidget,
    isAmbiguousUpdateWithPayload,
  };
}

export function buildPortfolioAgentCreatedWidgetState({
  currentWidgets = [],
  patch: rawPatch = {},
  request = {},
  createdDisplayId = "",
  allocationDisplayId = "",
  canvasModeId = "",
  assetCanvasModeId = "",
  now = new Date().toISOString(),
  nowMs = Date.now(),
  findPlacement = findPortfolioWidgetPlacement,
  canPlace = canPlacePortfolioWidget,
} = {}) {
  const patch = normalizeAgentAssetPatch(rawPatch);
  const createdTitle = patch.title || "새 포트폴리오 위젯";
  const createdPrompt = cleanPortfolioWidgetText(request?.prompt || patch.lastAgentAnswer || "", 1200);
  const createdVisualType = patch.visualType || "memo";
  const isMarkdownWidget = portfolioWidgetIsMarkdownType(createdVisualType);
  const shouldCreateDefaultAllocationChart = portfolioWidgetShouldCreateDefaultAllocationChart({
    widget: {
      ...patch,
      status: patch.status || "ready",
      visualType: createdVisualType,
      dataset: patch.dataset || [],
      title: createdTitle,
      prompt: createdPrompt,
    },
    canvasModeId,
    assetCanvasModeId,
  });

  const { preferredW, preferredH, ...widgetPatch } = patch;
  const visualNeedsRoom =
    widgetPatch.dataset?.length > 0 ||
    ["line", "allocation", "table", "metrics-table", "checklist", "function", "markdown", "position-status", "seasonal-comparison"].includes(createdVisualType);
  const placement = findPlacement(
    currentWidgets,
    preferredW || (isMarkdownWidget ? 3 : visualNeedsRoom ? 2 : 1),
    preferredH || (isMarkdownWidget ? 3 : visualNeedsRoom ? 2 : 1)
  );
  const candidateId = `portfolio_widget_${nowMs}`;
  const relations = isMarkdownWidget
    ? { dependsOn: [], derivedFrom: [], updatePolicy: "manual" }
    : resolvePortfolioWidgetRelations(widgetPatch, currentWidgets, candidateId);
  const signalMatrix =
    createdVisualType === "function"
      ? normalizePortfolioSignalMatrix(widgetPatch.signalMatrix, {
          widget: {
            ...widgetPatch,
            visualType: createdVisualType,
            title: createdTitle,
            prompt: createdPrompt,
          },
          functionSpec: widgetPatch.functionSpec || null,
          dataFiles: widgetPatch.dataFiles || widgetPatch.functionSpec?.dataSources || [],
        })
      : null;
  const candidate = {
    id: candidateId,
    displayId: nextPortfolioWidgetDisplayId(currentWidgets, Number(String(createdDisplayId).replace(/\D/g, ""))),
    graphRole: widgetPatch.graphRole || "process_node",
    scenarioId: widgetPatch.scenarioId || PORTFOLIO_SCENARIO_ROOT_ID,
    outputRole: normalizePortfolioWidgetOutputRole({ ...widgetPatch, title: createdTitle, visualType: createdVisualType }),
    x: placement.x,
    y: placement.y,
    w: placement.w,
    h: placement.h,
    title: createdTitle || "새 포트폴리오 위젯",
    prompt: createdPrompt,
    kind: widgetPatch.kind || portfolioAgentDefaultKindForVisualType(createdVisualType),
    status: widgetPatch.status || "ready",
    agentSummary: isMarkdownWidget ? "" : widgetPatch.agentSummary || "",
    visualType: createdVisualType,
    markdown: widgetPatch.markdown || "",
    echarts: widgetPatch.echarts || [],
    dataset: isMarkdownWidget ? [] : widgetPatch.dataset || [],
    chartSpec: widgetPatch.chartSpec || buildPortfolioWidgetChartSpec({}, createdVisualType, widgetPatch.dataset || []),
    functionSpec: widgetPatch.functionSpec || null,
    signalMatrix,
    dataFiles: isMarkdownWidget ? [] : widgetPatch.dataFiles || widgetPatch.functionSpec?.dataSources || [],
    badges: widgetPatch.badges || [],
    requirements: widgetPatch.requirements || [],
    checks: widgetPatch.checks || [],
    nextActions: isMarkdownWidget ? [] : widgetPatch.nextActions || [],
    lastAgentAnswer: widgetPatch.lastAgentAnswer || "",
    dependsOn: relations.dependsOn,
    derivedFrom: relations.derivedFrom,
    updatePolicy: relations.updatePolicy,
    version: 1,
    lastComputedFrom: portfolioWidgetComputedFrom(relations.dependsOn, currentWidgets),
    staleReason: "",
    staleSince: "",
    createdAt: now,
    updatedAt: widgetPatch.updatedAt || now,
  };

  const nextWidgets = [...currentWidgets, candidate];
  if (!shouldCreateDefaultAllocationChart) {
    return {
      widgets: nextWidgets,
      candidate,
      allocationWidget: null,
      shouldCreateDefaultAllocationChart: false,
    };
  }

  const allocationPlacement = findPlacement(nextWidgets, 2, 2);
  const allocationWidget = buildAllocationChartWidgetDraft({
    sourceWidget: candidate,
    rows: portfolioWidgetTableRows(candidate),
    id: `${candidateId}_allocation`,
    displayId: allocationDisplayId || nextPortfolioWidgetDisplayId(nextWidgets),
    placement: allocationPlacement,
    now,
  });
  if (!canPlace(nextWidgets, allocationWidget)) {
    return {
      widgets: nextWidgets,
      candidate,
      allocationWidget: null,
      shouldCreateDefaultAllocationChart: false,
    };
  }

  return {
    widgets: [...nextWidgets, allocationWidget],
    candidate,
    allocationWidget,
    shouldCreateDefaultAllocationChart: true,
  };
}
