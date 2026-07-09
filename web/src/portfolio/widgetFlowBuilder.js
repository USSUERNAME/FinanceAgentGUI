import { portfolioWidgetActionItems } from "./actionParser.js";
import { buildPortfolioWidgetChartSpec } from "./chartBuilders.js";
import { normalizePortfolioWidgetDataset } from "./datasetParser.js";
import {
  filterPortfolioFunctionDataSources,
  normalizePortfolioFunctionSpec,
  normalizePortfolioWidgetDataFiles,
  portfolioFunctionSpecMatrixDslContractIssue,
} from "./functionSpecParser.js";
import { normalizePortfolioSignalMatrix } from "./signalMatrixCompiler.js";
import { PORTFOLIO_WIDGET_MAX_HEIGHT, PORTFOLIO_WIDGET_MAX_SPAN } from "./workspaceState.js";
import { normalizePortfolioWidgetNextActionsForState } from "./widgetActions.js";
import {
  clampPortfolioWidgetNumber,
  cleanPortfolioWidgetText,
  nextPortfolioWidgetDisplayId,
  nextPortfolioWidgetDisplayIndex,
  normalizePortfolioWidgetList,
  normalizePortfolioWidgetStatus,
} from "./widgetIdentity.js";
import {
  normalizePortfolioActionClassification,
  portfolioActionClassificationPrimaryOutput,
  portfolioActionClassificationVisualType,
} from "./widgetActionClassification.js";
import {
  normalizePortfolioWidgetUpdatePolicy,
  portfolioWidgetComputedFrom,
  resolvePortfolioWidgetRelations,
} from "./widgetRelations.js";
import {
  normalizePortfolioWidgetVisualType,
  portfolioWidgetVisualTypeContractIssue,
} from "./widgetTypes.js";
import {
  portfolioWidgetSummaryFromAnswer,
  rewritePortfolioWidgetReferenceValue,
} from "./widgetPatchParser.js";
import {
  PORTFOLIO_SCENARIO_ROOT_ID,
  portfolioActionDeclaresMultiplePeriodComparison,
  portfolioScenarioHasConcreteRuns,
  normalizePortfolioWidgetOutputRole,
} from "./scenarioContract.js";
import {
  normalizePortfolioMarkdownECharts,
  normalizePortfolioMarkdownText,
  portfolioWidgetIsMarkdownType,
} from "./markdownWidget.js";
import {
  portfolioWidgetBacktestHoldings,
} from "./widgetRoleClassifier.js";

const BACKTEST_CHART_ACTIONS = new Set(["run_backtest_chart_widget", "run_yfinance_backtest_comparison"]);

function normalizeFlowActionToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function fallbackPortfolioFlowPlacement(existingWidgets = [], width = 1, height = 1) {
  const bottom = existingWidgets.reduce((max, widget) => Math.max(max, Number(widget?.y || 0) + Number(widget?.h || 1)), 0);
  return { x: 0, y: bottom, w: width, h: height };
}

function portfolioFlowDataFileIdentity(value = {}) {
  const rawUrl = String(value?.dataUrl || value?.dataURL || value?.dataUri || value?.dataURI || "");
  const attachmentId = rawUrl.startsWith("attachment://") ? rawUrl.slice("attachment://".length) : "";
  const name = String(value?.name || value?.fileName || value?.filename || "").trim().toLowerCase();
  const stem = name.replace(/\.[^.]+$/, "");
  return {
    id: String(value?.id || value?.attachmentId || value?.fileId || attachmentId || "").trim(),
    name,
    stem,
  };
}

function portfolioFlowDataFileMatches(left = {}, right = {}) {
  const a = portfolioFlowDataFileIdentity(left);
  const b = portfolioFlowDataFileIdentity(right);
  if (a.id && b.id && a.id === b.id) return true;
  if (a.name && b.name && a.name === b.name) return true;
  return Boolean(a.stem && b.stem && a.stem === b.stem);
}

function requestAttachmentDataFilesForFlow(request = {}, dataFiles = []) {
  const attachments = normalizePortfolioWidgetDataFiles(request?.attachments);
  if (!attachments.length) return [];
  if (!dataFiles.length) return attachments;
  return attachments.map((attachment) => {
    const match = dataFiles.find((dataFile) => portfolioFlowDataFileMatches(dataFile, attachment));
    if (!match) return attachment;
    return {
      ...attachment,
      role: match.role || attachment.role,
      source: attachment.source || match.source,
      status: "attached",
    };
  });
}

function portfolioFlowDefaultKindForVisualType(visualType = "") {
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

function normalizeFlowAssetHistoryCurrency(value = "") {
  return String(value || "").toUpperCase() === "USD" ? "USD" : "KRW";
}

function normalizeFlowPositionStatusView(value = "") {
  return String(value || "").toLowerCase() === "pie" ? "pie" : "bar";
}

function buildPortfolioFlowChartSpec(raw = {}, visualType = "", dataset = []) {
  if (!["price-history", "position-status", "seasonal-comparison"].includes(visualType)) {
    return buildPortfolioWidgetChartSpec(raw, visualType, dataset);
  }
  const chartSpec = raw.chartSpec && typeof raw.chartSpec === "object" ? raw.chartSpec : {};
  const query = chartSpec.query && typeof chartSpec.query === "object" ? chartSpec.query : {};
  if (visualType === "seasonal-comparison") {
    const currency = normalizeFlowAssetHistoryCurrency(query.currency || chartSpec.currency || raw.currency || raw.valueCurrency || "KRW");
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
  if (visualType === "position-status") {
    const currency = normalizeFlowAssetHistoryCurrency(query.currency || chartSpec.currency || raw.currency || raw.valueCurrency || "KRW");
    const view = normalizeFlowPositionStatusView(query.view || chartSpec.view || raw.view || "bar");
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
  const currency = normalizeFlowAssetHistoryCurrency(query.currency || chartSpec.currency || raw.currency || raw.valueCurrency || "KRW");
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
      timeframe: String(query.timeframe || chartSpec.timeframe || raw.timeframe || "1d").trim() || "1d",
      currency,
    },
  };
}

function portfolioFlowDefaultUpdatePolicy(raw = {}, visualType = "") {
  if (["price-history", "position-status", "seasonal-comparison"].includes(visualType) && !raw.updatePolicy) return "auto";
  return normalizePortfolioWidgetUpdatePolicy(raw.updatePolicy);
}

function portfolioFlowDefaultBadges(raw = {}, visualType = "") {
  const badges = normalizePortfolioWidgetList(raw.badges || raw.basis, 4, 80);
  if (badges.length || !["price-history", "position-status", "seasonal-comparison"].includes(visualType)) return badges;
  if (visualType === "position-status") return ["토스 증권 Open API"];
  return ["Lightweight Charts"];
}

function portfolioFlowRawHasMetricRows(raw = {}) {
  const chartSpec = raw?.chartSpec || raw?.chart || {};
  return Boolean(
    (Array.isArray(raw?.metrics) && raw.metrics.length) ||
      (Array.isArray(raw?.standardMetrics) && raw.standardMetrics.length) ||
      (Array.isArray(chartSpec?.metrics) && chartSpec.metrics.length) ||
      (Array.isArray(chartSpec?.standardMetrics) && chartSpec.standardMetrics.length)
  );
}

function portfolioFlowWidgetShouldRunBacktest(widget = {}) {
  const visualType = normalizePortfolioWidgetVisualType(widget.visualType || widget.chartSpec?.type);
  if (visualType !== "line") return false;
  const actions = normalizePortfolioWidgetList(widget.nextActions || widget.actions || widget.nextAction, 4, 80);
  if (actions.some((action) => BACKTEST_CHART_ACTIONS.has(normalizeFlowActionToken(action)))) return true;
  const outputRole = normalizePortfolioWidgetOutputRole({ ...widget, visualType });
  return outputRole === "backtest_result";
}

function portfolioFlowMetricRows(widget = {}) {
  const chartSpec = widget?.chartSpec && typeof widget.chartSpec === "object" ? widget.chartSpec : {};
  return [
    widget.metrics,
    widget.standardMetrics,
    chartSpec.metrics,
    chartSpec.standardMetrics,
  ].find((rows) => Array.isArray(rows) && rows.length) || [];
}

function portfolioFlowWidgetIndex(widgets = [], widget = {}) {
  return widgets.findIndex((candidate) => candidate?.id && candidate.id === widget?.id);
}

function portfolioFlowWidgetsBefore(widgets = [], widget = {}) {
  const index = portfolioFlowWidgetIndex(widgets, widget);
  return index >= 0 ? widgets.slice(0, index) : widgets.filter((candidate) => candidate?.id !== widget?.id);
}

function portfolioFlowSourceCandidatesBefore(widget = {}, widgets = []) {
  return portfolioFlowWidgetsBefore(widgets, widget).filter((candidate) => {
    if (!candidate?.id) return false;
    if (candidate.id === widget.id) return false;
    const outputRole = normalizePortfolioWidgetOutputRole(candidate);
    const visualType = normalizePortfolioWidgetVisualType(candidate.visualType || candidate.chartSpec?.type);
    const hasRows = Array.isArray(candidate.dataset) && candidate.dataset.length > 0;
    return outputRole === "source_matrix" && ["table", "allocation"].includes(visualType) && hasRows;
  });
}

function portfolioFlowMetricSourceCandidatesBefore(widget = {}, widgets = []) {
  return portfolioFlowWidgetsBefore(widgets, widget).filter((candidate) => {
    if (!candidate?.id || candidate.id === widget.id) return false;
    return normalizePortfolioWidgetOutputRole(candidate) === "backtest_result";
  });
}

function portfolioFlowDependencyWidgets(widget = {}, widgets = []) {
  const ids = Array.isArray(widget.dependsOn) ? widget.dependsOn : [];
  return ids
    .map((id) => widgets.find((candidate) => candidate.id === id || candidate.displayId === id))
    .filter(Boolean);
}

function portfolioFlowSourceDependencyWidgets(widget = {}, widgets = []) {
  const chartSpec = widget?.chartSpec && typeof widget.chartSpec === "object" ? widget.chartSpec : {};
  const ids = [
    ...(Array.isArray(widget.dependsOn) ? widget.dependsOn : []),
    ...(Array.isArray(chartSpec.sourceWidgetIds) ? chartSpec.sourceWidgetIds : []),
  ];
  return [...new Set(ids)]
    .map((id) => widgets.find((candidate) => candidate.id === id || candidate.displayId === id))
    .filter((candidate) => {
      const outputRole = normalizePortfolioWidgetOutputRole(candidate);
      const visualType = normalizePortfolioWidgetVisualType(candidate?.visualType || candidate?.chartSpec?.type);
      return outputRole === "source_matrix" && ["table", "allocation"].includes(visualType) && Array.isArray(candidate?.dataset) && candidate.dataset.length > 0;
    });
}

function portfolioFlowWidgetHasSourceDependency(widget = {}, widgets = []) {
  return portfolioFlowDependencyWidgets(widget, widgets).some((candidate) => {
    const outputRole = normalizePortfolioWidgetOutputRole(candidate);
    const visualType = normalizePortfolioWidgetVisualType(candidate.visualType || candidate.chartSpec?.type);
    return outputRole === "source_matrix" && ["table", "allocation"].includes(visualType) && Array.isArray(candidate.dataset) && candidate.dataset.length > 0;
  });
}

function portfolioFlowWidgetHasBacktestDependency(widget = {}, widgets = []) {
  return portfolioFlowDependencyWidgets(widget, widgets).some(
    (candidate) => normalizePortfolioWidgetOutputRole(candidate) === "backtest_result"
  );
}

function portfolioFlowRelationsWithStructuralFallback(relations = {}, widget = {}, widgets = []) {
  if (portfolioWidgetIsMarkdownType(widget.visualType)) return relations;
  if (portfolioFlowWidgetShouldRunBacktest(widget)) {
    if (portfolioFlowWidgetHasSourceDependency({ ...widget, dependsOn: relations.dependsOn }, widgets)) return relations;
    const source = portfolioFlowSourceCandidatesBefore(widget, widgets)[0];
    if (!source) return relations;
    return {
      ...relations,
      dependsOn: [...new Set([...(relations.dependsOn || []), source.id])],
      derivedFrom: [
        ...(relations.derivedFrom || []),
        { widgetId: source.id, field: "dataset", role: "portfolio_input" },
      ].slice(0, 12),
      updatePolicy: relations.updatePolicy === "manual" ? "auto" : relations.updatePolicy || "auto",
    };
  }
  if (normalizePortfolioWidgetOutputRole(widget) === "metrics") {
    if (portfolioFlowMetricRows(widget).length || portfolioFlowWidgetHasBacktestDependency({ ...widget, dependsOn: relations.dependsOn }, widgets)) {
      return relations;
    }
    const source = portfolioFlowMetricSourceCandidatesBefore(widget, widgets)[0];
    if (!source) return relations;
    return {
      ...relations,
      dependsOn: [...new Set([...(relations.dependsOn || []), source.id])],
      derivedFrom: [
        ...(relations.derivedFrom || []),
        { widgetId: source.id, field: "chartSpec.metrics", role: "backtest_metrics" },
      ].slice(0, 12),
      updatePolicy: relations.updatePolicy === "manual" ? "auto" : relations.updatePolicy || "auto",
    };
  }
  return relations;
}

function portfolioFlowContractIssueForWidget(widget = {}, widgets = []) {
  const visualTypeIssue = portfolioWidgetVisualTypeContractIssue(widget);
  if (visualTypeIssue) return visualTypeIssue;
  if (widget.visualType === "function") {
    const issue = portfolioFunctionSpecMatrixDslContractIssue(widget.functionSpec || {}, widget);
    if (issue) return issue;
  }
  if (portfolioFlowWidgetShouldRunBacktest(widget)) {
    const sourceTables = Array.isArray(widget?.chartSpec?.sourceTables) ? widget.chartSpec.sourceTables : [];
    if (!sourceTables.length && !portfolioFlowWidgetHasSourceDependency(widget, widgets)) {
      return {
        code: "missing_backtest_source",
        widgetId: widget.id,
        displayId: widget.displayId,
        title: widget.title,
        message: `${widget.displayId || widget.title || "백테스트 위젯"} 생성 보류 · source_matrix 입력 위젯 관계가 없습니다.`,
      };
    }
  }
  if (normalizePortfolioWidgetOutputRole(widget) === "metrics") {
    const ownMetrics = portfolioFlowMetricRows(widget);
    if (!ownMetrics.length && !portfolioFlowWidgetHasBacktestDependency(widget, widgets)) {
      return {
        code: "missing_metric_rows",
        widgetId: widget.id,
        displayId: widget.displayId,
        title: widget.title,
        message: `${widget.displayId || widget.title || "평가 테이블"} 생성 보류 · chartSpec.metrics 또는 백테스트 결과 위젯 관계가 없습니다.`,
      };
    }
  }
  return null;
}

function portfolioFlowAssetComparisonContractIssue(actionClassification = {}, createdWidgets = [], widgets = []) {
  if (!actionClassification.isMultipleAssetComparison) return null;
  const backtestWidgets = createdWidgets.filter((widget) => {
    const outputRole = normalizePortfolioWidgetOutputRole(widget);
    return outputRole === "backtest_result" || portfolioFlowWidgetShouldRunBacktest(widget);
  });
  if (!backtestWidgets.length) return null;
  const invalidWidget = backtestWidgets.find(
    (widget) => portfolioFlowSourceDependencyWidgets(widget, widgets).length < 2
  );
  if (!invalidWidget) return null;
  return {
    code: "missing_asset_comparison_sources",
    widgetId: invalidWidget.id,
    displayId: invalidWidget.displayId,
    title: invalidWidget.title,
    message: `${invalidWidget.displayId || invalidWidget.title || "백테스트 비교"} 생성 보류 · 복수 자산 비교는 독립 source_matrix 위젯 2개 이상이 필요합니다. 단일 표 안의 복수 종목 행은 혼합 포트폴리오로 계산됩니다.`,
  };
}

function portfolioFlowHoldingsSignature(widget = {}) {
  const holdings = portfolioWidgetBacktestHoldings(widget);
  if (!holdings.length) return "";
  return holdings
    .map((item) => {
      const ticker = String(item.ticker || "").trim().toUpperCase();
      const value = Number(item.value || item.weight || 0);
      return ticker && Number.isFinite(value) && value > 0 ? `${ticker}:${Math.round(value * 10000) / 10000}` : "";
    })
    .filter(Boolean)
    .sort()
    .join("|");
}

function portfolioFlowDuplicateStrategySourceContractIssue(createdWidgets = [], widgets = []) {
  const backtestWidgets = createdWidgets.filter((widget) => portfolioFlowWidgetShouldRunBacktest(widget));
  for (const widget of backtestWidgets) {
    const dependencies = portfolioFlowDependencyWidgets(widget, widgets);
    const sourceDependencies = dependencies.filter((candidate) => {
      const outputRole = normalizePortfolioWidgetOutputRole(candidate);
      const visualType = normalizePortfolioWidgetVisualType(candidate?.visualType || candidate?.chartSpec?.type);
      return outputRole === "source_matrix" && ["table", "allocation"].includes(visualType) && portfolioFlowHoldingsSignature(candidate);
    });
    const functionDependencies = dependencies.filter((candidate) => normalizePortfolioWidgetVisualType(candidate?.visualType) === "function");
    if (!functionDependencies.length || sourceDependencies.length < 2) continue;
    const bySignature = new Map();
    for (const source of sourceDependencies) {
      const signature = portfolioFlowHoldingsSignature(source);
      const previous = bySignature.get(signature);
      if (!previous) {
        bySignature.set(signature, source);
        continue;
      }
      return {
        code: "duplicate_strategy_source_matrix",
        widgetId: widget.id,
        displayId: widget.displayId,
        title: widget.title,
        message: `${widget.displayId || widget.title || "백테스트 위젯"} 생성 보류 · 같은 holdings를 가진 source_matrix가 중복되었습니다. Buy & Hold와 전략 비교는 하나의 source_matrix를 함수 위젯과 백테스트 위젯이 함께 참조해야 합니다. 중복 source: ${previous.displayId || previous.title}, ${source.displayId || source.title}.`,
      };
    }
  }
  return null;
}

export function buildPortfolioWidgetFlowFromAction(
  action,
  request = {},
  {
    currentWidgets = [],
    nextDisplayIndex = 1,
    nowMs = Date.now(),
    now = new Date().toISOString(),
    findPlacement = fallbackPortfolioFlowPlacement,
  } = {}
) {
  const rawWidgets = portfolioWidgetActionItems(action);
  if (!rawWidgets.length) return null;

  const nextWidgets = [...currentWidgets];
  const refMap = new Map();
  let displayIndex = Math.max(Number(nextDisplayIndex) || 1, nextPortfolioWidgetDisplayIndex(currentWidgets));
  const actionClassification = normalizePortfolioActionClassification(action);
  const shouldPreferRunnablePeriodComparison =
    portfolioActionDeclaresMultiplePeriodComparison(action) &&
    portfolioScenarioHasConcreteRuns(action?.scenario) &&
    portfolioActionClassificationPrimaryOutput(actionClassification) !== "metrics_table";

  const reserveDisplayId = () => {
    const displayId = nextPortfolioWidgetDisplayId(nextWidgets, displayIndex);
    displayIndex = Number(displayId.replace(/\D/g, "")) + 1;
    return displayId;
  };

  const drafts = rawWidgets.map((raw, index) => {
    const id = `portfolio_widget_${nowMs}_${index}`;
    const displayId = reserveDisplayId();
    [
      raw.id,
      raw.widgetId,
      raw.displayId,
      raw.widgetDisplayId,
      raw.clientId,
      raw.ref,
      raw.key,
      raw.title,
    ]
      .filter(Boolean)
      .forEach((ref) => refMap.set(String(ref), id));
    refMap.set(displayId, id);

    const rawText = [
      raw.prompt,
      raw.title,
      raw.summary,
      raw.agentSummary,
      request?.prompt,
    ]
      .filter(Boolean)
      .join("\n");
    const widgetClassification = normalizePortfolioActionClassification(raw);
    const rawVisualType = normalizePortfolioWidgetVisualType(
      raw.visualType ||
        raw.visual ||
        raw.type ||
        raw.chartSpec?.type ||
        portfolioActionClassificationVisualType(widgetClassification) ||
        "memo"
    );
    const shouldCoerceMetricsTableToBacktest =
      shouldPreferRunnablePeriodComparison && rawVisualType === "metrics-table" && !portfolioFlowRawHasMetricRows(raw);
    const materializedRaw = shouldCoerceMetricsTableToBacktest
      ? {
          ...raw,
          kind: "백테스트 비교",
          visualType: "line",
          type: "line",
          nextActions: ["run_backtest_chart_widget", ...(Array.isArray(raw.nextActions) ? raw.nextActions : [])],
          chartSpec: {
            ...(raw.chartSpec || {}),
            type: "line",
            role: raw.chartSpec?.role || "period_return_comparison",
            xField: raw.chartSpec?.xField || "date",
            includeBenchmark: raw.chartSpec?.includeBenchmark ?? false,
            benchmarkMode: raw.chartSpec?.benchmarkMode || "none",
            benchmark: raw.chartSpec?.benchmark || "",
          },
        }
      : raw;
    const visualType = cleanPortfolioWidgetText(
      normalizePortfolioWidgetVisualType(
        materializedRaw.visualType ||
          materializedRaw.visual ||
          materializedRaw.type ||
          materializedRaw.chartSpec?.type ||
          portfolioActionClassificationVisualType(widgetClassification) ||
          "memo"
      ),
      30
    );
    const isMarkdownWidget = portfolioWidgetIsMarkdownType(visualType);
    const explicitDatasetSource =
      materializedRaw.dataset || materializedRaw.data || materializedRaw.holdings || materializedRaw.positions || materializedRaw.chartSpec?.dataset || materializedRaw.chart?.dataset;
    const dataset = normalizePortfolioWidgetDataset(
      isMarkdownWidget ? [] : explicitDatasetSource || [],
      24
    );
    const markdown = isMarkdownWidget
      ? normalizePortfolioMarkdownText(materializedRaw.markdown, materializedRaw.markdownText, materializedRaw.content, materializedRaw.document, materializedRaw.body, materializedRaw.summary, materializedRaw.agentSummary, rawText)
      : "";
    const echarts = isMarkdownWidget
      ? normalizePortfolioMarkdownECharts(
          materializedRaw.echarts,
          materializedRaw.eCharts,
          materializedRaw.echartsOptions,
          materializedRaw.echartsOption,
          materializedRaw.option,
          materializedRaw.sections,
          materializedRaw.chartSpec?.echarts,
          materializedRaw.chartSpec?.echartsOptions,
          materializedRaw.chartSpec?.echartsOption,
          materializedRaw.chartSpec?.option,
          materializedRaw.chartSpec
        )
      : [];
    const defaultSpan = visualType === "function" ? 1 : ["markdown", "price-history", "position-status", "seasonal-comparison"].includes(visualType) ? 3 : ["line", "table", "metrics-table"].includes(visualType) ? 2 : 1;
    const width = clampPortfolioWidgetNumber(materializedRaw.w ?? materializedRaw.layout?.w, 1, PORTFOLIO_WIDGET_MAX_SPAN, defaultSpan);
    const height = clampPortfolioWidgetNumber(materializedRaw.h ?? materializedRaw.layout?.h, 1, PORTFOLIO_WIDGET_MAX_HEIGHT, defaultSpan);
    const placement = findPlacement(nextWidgets, width, height);
    const rawFunctionSpec =
      visualType === "function" && (materializedRaw.functionSpec || materializedRaw.strategySpec || materializedRaw.tradingStrategy || materializedRaw.ruleSpec)
        ? normalizePortfolioFunctionSpec(materializedRaw.functionSpec || materializedRaw.strategySpec || materializedRaw.tradingStrategy || materializedRaw.ruleSpec)
        : null;
    const rawDataFiles = normalizePortfolioWidgetDataFiles(materializedRaw.dataFiles, materializedRaw.dataSources, materializedRaw.files, rawFunctionSpec?.dataSources);
    const dataFiles = normalizePortfolioWidgetDataFiles(
      rawDataFiles,
      visualType === "function" ? requestAttachmentDataFilesForFlow(request, rawDataFiles) : null
    );
    const functionDataFiles = rawFunctionSpec
      ? filterPortfolioFunctionDataSources(rawFunctionSpec, dataFiles)
      : dataFiles;
    const functionSpec = rawFunctionSpec
      ? {
          ...rawFunctionSpec,
          dataSources: functionDataFiles.length ? functionDataFiles : rawFunctionSpec.dataSources,
        }
      : null;
    const signalMatrix =
      visualType === "function"
        ? normalizePortfolioSignalMatrix(materializedRaw.signalMatrix || materializedRaw.signalSpec || materializedRaw.matrix, {
            widget: materializedRaw,
            functionSpec,
            dataFiles: functionDataFiles,
          })
        : null;
    const widget = {
      id,
      displayId,
      graphRole: cleanPortfolioWidgetText(materializedRaw.graphRole || "process_node", 60),
      scenarioId: cleanPortfolioWidgetText(materializedRaw.scenarioId || PORTFOLIO_SCENARIO_ROOT_ID, 80),
      outputRole: normalizePortfolioWidgetOutputRole({ ...materializedRaw, visualType, title: materializedRaw.title, functionSpec }),
      x: placement.x,
      y: placement.y,
      w: placement.w,
      h: placement.h,
      title: cleanPortfolioWidgetText(materializedRaw.title || "", 80) || "새 포트폴리오 위젯",
      prompt: cleanPortfolioWidgetText(materializedRaw.prompt || request?.prompt || "", 1200),
      kind: cleanPortfolioWidgetText(materializedRaw.kind || portfolioFlowDefaultKindForVisualType(visualType), 40),
      status: normalizePortfolioWidgetStatus(materializedRaw.status || "ready"),
      agentSummary: isMarkdownWidget ? "" : cleanPortfolioWidgetText(materializedRaw.summary || materializedRaw.agentSummary || portfolioWidgetSummaryFromAnswer("", rawText), 360),
      visualType,
      markdown,
      echarts,
      dataset,
      chartSpec: buildPortfolioFlowChartSpec(materializedRaw, visualType, dataset),
      functionSpec,
      signalMatrix,
      dataFiles: isMarkdownWidget ? [] : functionDataFiles,
      badges: portfolioFlowDefaultBadges(materializedRaw, visualType),
      requirements: normalizePortfolioWidgetList(materializedRaw.requirements || materializedRaw.requiredData),
      checks: normalizePortfolioWidgetList(materializedRaw.checks || materializedRaw.validation),
      nextActions: isMarkdownWidget ? [] : normalizePortfolioWidgetList(materializedRaw.nextActions || materializedRaw.actions || materializedRaw.nextAction, 4, 80),
      lastAgentAnswer: cleanPortfolioWidgetText(JSON.stringify(materializedRaw), 1600),
      dependsOn: [],
      derivedFrom: [],
      updatePolicy: portfolioFlowDefaultUpdatePolicy(materializedRaw, visualType),
      version: 1,
      lastComputedFrom: {},
      staleReason: "",
      staleSince: "",
      createdAt: now,
      updatedAt: now,
    };
    nextWidgets.push(widget);
    return { raw: materializedRaw, widget };
  });

  const allWidgets = [...currentWidgets, ...drafts.map(({ widget }) => widget)];
  const createdWidgets = drafts.map(({ raw, widget }) => {
    const rewrittenRaw = rewritePortfolioWidgetReferenceValue(raw, refMap);
    const chartSpec = buildPortfolioFlowChartSpec(rewrittenRaw, widget.visualType, widget.dataset);
    const isMarkdownWidget = portfolioWidgetIsMarkdownType(widget.visualType);
    const relations = isMarkdownWidget
      ? { dependsOn: [], derivedFrom: [], updatePolicy: "manual" }
      : portfolioFlowRelationsWithStructuralFallback(
          resolvePortfolioWidgetRelations(rewrittenRaw, allWidgets, widget.id),
          { ...widget, ...rewrittenRaw, chartSpec },
          allWidgets
        );
    const rawDataFiles = normalizePortfolioWidgetDataFiles(widget.dataFiles, rewrittenRaw.dataFiles, rewrittenRaw.dataSources, rewrittenRaw.functionSpec?.dataSources);
    const dataFiles = normalizePortfolioWidgetDataFiles(
      rawDataFiles,
      widget.visualType === "function" ? requestAttachmentDataFilesForFlow(request, rawDataFiles) : null
    );
    const rewrittenFunctionSpecSource = rewrittenRaw.functionSpec || rewrittenRaw.strategySpec || widget.functionSpec;
    const rewrittenFunctionSpec =
      widget.visualType === "function" && rewrittenFunctionSpecSource
        ? normalizePortfolioFunctionSpec(rewrittenFunctionSpecSource)
        : widget.functionSpec;
    const functionDataFiles = rewrittenFunctionSpec
      ? filterPortfolioFunctionDataSources(rewrittenFunctionSpec, dataFiles)
      : dataFiles;
    const signalMatrix =
      widget.visualType === "function"
        ? normalizePortfolioSignalMatrix(rewrittenRaw.signalMatrix || widget.signalMatrix, {
            widget: { ...widget, ...rewrittenRaw },
            functionSpec: rewrittenFunctionSpec || widget.functionSpec,
            dataFiles: functionDataFiles,
          })
        : null;
    const shouldRunBacktest = portfolioFlowWidgetShouldRunBacktest({
      ...widget,
      chartSpec,
      nextActions: widget.nextActions,
    });
    const nextActions = isMarkdownWidget
      ? []
      : normalizePortfolioWidgetNextActionsForState(
          { ...widget, chartSpec, dependsOn: relations.dependsOn, derivedFrom: relations.derivedFrom },
          shouldRunBacktest ? ["run_backtest_chart_widget", ...(widget.nextActions || [])] : widget.nextActions
        );
    return {
      ...widget,
      chartSpec,
      outputRole: normalizePortfolioWidgetOutputRole({
        ...rewrittenRaw,
        visualType: widget.visualType,
        title: widget.title,
        chartSpec,
        functionSpec: rewrittenFunctionSpec || widget.functionSpec,
      }),
      functionSpec: rewrittenFunctionSpec
        ? {
            ...rewrittenFunctionSpec,
            dataSources: functionDataFiles.length ? functionDataFiles : rewrittenFunctionSpec.dataSources,
          }
        : rewrittenFunctionSpec,
      signalMatrix,
      dataFiles: isMarkdownWidget ? [] : functionDataFiles,
      nextActions,
      dependsOn: relations.dependsOn,
      derivedFrom: relations.derivedFrom,
      status: shouldRunBacktest ? "stale" : widget.status,
      updatePolicy: shouldRunBacktest || ["price-history", "position-status", "seasonal-comparison"].includes(widget.visualType) ? "auto" : relations.updatePolicy,
      lastComputedFrom: portfolioWidgetComputedFrom(relations.dependsOn, allWidgets),
      staleReason: shouldRunBacktest ? widget.staleReason || "백테스트 실행 필요" : widget.staleReason,
      staleSince: shouldRunBacktest ? widget.staleSince || now : widget.staleSince,
    };
  });

  const widgets = [...currentWidgets, ...createdWidgets];
  const contractIssue =
    portfolioFlowAssetComparisonContractIssue(actionClassification, createdWidgets, widgets) ||
    portfolioFlowDuplicateStrategySourceContractIssue(createdWidgets, widgets) ||
    createdWidgets
      .map((widget) => portfolioFlowContractIssueForWidget(widget, widgets))
      .find(Boolean);
  if (contractIssue) {
    return {
      widgets: currentWidgets,
      createdWidgets: [],
      nextDisplayIndex,
      refMap,
      error: contractIssue,
    };
  }
  return {
    widgets,
    createdWidgets,
    nextDisplayIndex: Math.max(displayIndex, nextPortfolioWidgetDisplayIndex(widgets)),
    refMap,
  };
}
