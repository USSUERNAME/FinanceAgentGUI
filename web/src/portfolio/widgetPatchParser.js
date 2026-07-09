import {
  parsePortfolioWidgetJsonAction,
  stripPortfolioWidgetActionBlocks,
} from "./actionParser.js";
import {
  buildPortfolioWidgetChartSpec,
  normalizePortfolioChartScale,
} from "./chartBuilders.js";
import {
  normalizePortfolioWidgetDataset,
  portfolioWidgetDatasetFromMarkdownTable,
  portfolioWidgetDatasetRows,
} from "./datasetParser.js";
import {
  filterPortfolioFunctionDataSources,
  normalizePortfolioFunctionSpec,
  normalizePortfolioWidgetDataFiles,
} from "./functionSpecParser.js";
import { normalizePortfolioSignalMatrix } from "./signalMatrixCompiler.js";
import { PORTFOLIO_WIDGET_MAX_HEIGHT, PORTFOLIO_WIDGET_MAX_SPAN } from "./workspaceState.js";
import {
  clampPortfolioWidgetNumber,
  cleanPortfolioWidgetText,
  normalizePortfolioWidgetDisplayId,
  normalizePortfolioWidgetList,
} from "./widgetIdentity.js";
import {
  normalizePortfolioActionClassification,
  portfolioActionClassificationVisualType,
} from "./widgetActionClassification.js";
import {
  normalizePortfolioWidgetReferenceList,
  normalizePortfolioWidgetUpdatePolicy,
} from "./widgetRelations.js";
import {
  normalizePortfolioWidgetDerivedFrom,
  portfolioWidgetLooksLikeMetricsTarget,
} from "./widgetRoleClassifier.js";
import { normalizePortfolioWidgetVisualType } from "./widgetTypes.js";
import {
  normalizePortfolioMarkdownECharts,
  normalizePortfolioMarkdownText,
  portfolioWidgetIsMarkdownType,
} from "./markdownWidget.js";
import {
  PORTFOLIO_SCENARIO_ROOT_ID,
  normalizePortfolioWidgetOutputRole,
} from "./scenarioContract.js";

const BACKTEST_ACTION_TOKENS = new Set([
  "run_yfinance_backtest",
  "run_backtest_chart_widget",
  "run_yfinance_backtest_comparison",
]);

function normalizePatchActionToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function requestedPortfolioLineScale(widgetPatch = {}, request = {}) {
  const explicitScale = normalizePortfolioChartScale(
    widgetPatch?.chartSpec?.yScale ||
      widgetPatch?.chartSpec?.yAxisScale ||
      widgetPatch?.chartSpec?.axisScale ||
      widgetPatch?.chartSpec?.scale ||
      widgetPatch?.chartSpec?.yAxis?.type ||
      widgetPatch?.yScale ||
      widgetPatch?.scale
  );
  if (explicitScale) return explicitScale;
  return "";
}

export function protectPortfolioLineScalePatchForTarget(targetWidget, widgetPatch = {}, request = {}) {
  if (normalizePortfolioWidgetVisualType(targetWidget?.visualType) !== "line") return widgetPatch;
  const yScale = requestedPortfolioLineScale(widgetPatch, request);
  if (!yScale) return widgetPatch;
  const targetChartSpec = targetWidget?.chartSpec && typeof targetWidget.chartSpec === "object" ? targetWidget.chartSpec : {};
  const patchChartSpec = widgetPatch?.chartSpec && typeof widgetPatch.chartSpec === "object" ? widgetPatch.chartSpec : {};
  const hasReplacementSeries = Array.isArray(patchChartSpec.series) && patchChartSpec.series.length > 0;
  const hasReplacementLabels = Array.isArray(patchChartSpec.xLabels) && patchChartSpec.xLabels.length > 0;
  return {
    ...widgetPatch,
    kind: widgetPatch.kind || targetWidget.kind,
    visualType: "line",
    dataset: Array.isArray(widgetPatch.dataset) && widgetPatch.dataset.length ? widgetPatch.dataset : targetWidget.dataset || [],
    chartSpec: {
      ...targetChartSpec,
      ...patchChartSpec,
      type: "line",
      yScale,
      series: hasReplacementSeries ? patchChartSpec.series : targetChartSpec.series || [],
      xLabels: hasReplacementLabels ? patchChartSpec.xLabels : targetChartSpec.xLabels || [],
    },
    nextActions: normalizePortfolioWidgetList(widgetPatch.nextActions || targetWidget.nextActions || ["run_backtest_chart_widget"], 4, 80),
  };
}

export function protectPortfolioWidgetPatchForTarget(targetWidget, widgetPatch = {}, request = {}) {
  const lineScalePatch = protectPortfolioLineScalePatchForTarget(targetWidget, widgetPatch, request);
  if (lineScalePatch !== widgetPatch) return lineScalePatch;
  if (!portfolioWidgetLooksLikeMetricsTarget(targetWidget)) return widgetPatch;
  const patchType = normalizePortfolioWidgetVisualType(widgetPatch.visualType || "");
  const explicitConversion = patchType === "table";
  if (!patchType || patchType === "metrics-table" || explicitConversion) return widgetPatch;
  const hasMetricRows = Array.isArray(widgetPatch.chartSpec?.metrics) && widgetPatch.chartSpec.metrics.length > 0;
  return {
    ...widgetPatch,
    title: widgetPatch.title || targetWidget.title,
    kind: widgetPatch.kind || targetWidget.kind,
    visualType: "metrics-table",
    dataset: targetWidget.dataset || [],
    chartSpec: hasMetricRows
      ? {
          ...(targetWidget.chartSpec || {}),
          ...(widgetPatch.chartSpec || {}),
          type: "metrics-table",
        }
      : targetWidget.chartSpec,
    nextActions: normalizePortfolioWidgetList(
      (widgetPatch.nextActions || targetWidget.nextActions || []).filter((action) => !BACKTEST_ACTION_TOKENS.has(normalizePatchActionToken(action))),
      4,
      80
    ),
  };
}

export function resolvePortfolioWidgetTargetId(widgets = [], action = {}, request = {}) {
  const requestedId = action?.widgetId || action?.targetWidgetId || action?.widget?.id || request?.widgetId || request?.widget?.id;
  if (requestedId && widgets.some((widget) => widget.id === requestedId)) return requestedId;
  const requestedIdAsDisplayId = normalizePortfolioWidgetDisplayId(requestedId, 0);
  if (requestedIdAsDisplayId) {
    const byRequestedDisplayId = widgets.find((widget) => widget.displayId === requestedIdAsDisplayId);
    if (byRequestedDisplayId) return byRequestedDisplayId.id;
  }
  const requestedDisplayId = normalizePortfolioWidgetDisplayId(
    action?.widgetDisplayId || action?.displayId || action?.widget?.displayId || request?.widgetDisplayId || request?.widget?.displayId || "",
    0
  );
  if (requestedDisplayId) {
    const byDisplayId = widgets.find((widget) => widget.displayId === requestedDisplayId);
    if (byDisplayId) return byDisplayId.id;
  }
  const requestedTitle = cleanPortfolioWidgetText(action?.widget?.title || request?.widget?.title || "", 80).toLowerCase();
  if (requestedTitle) {
    const byTitle = widgets.find((widget) => widget.title.toLowerCase() === requestedTitle);
    if (byTitle) return byTitle.id;
  }
  return "";
}

export function hasExplicitPortfolioWidgetTarget(action = {}, request = {}) {
  return Boolean(
    action?.widgetId ||
      action?.targetWidgetId ||
      action?.widget?.id ||
      request?.widgetId ||
      request?.widget?.id ||
      action?.widgetDisplayId ||
      action?.displayId ||
      action?.widget?.displayId ||
      request?.widgetDisplayId ||
      request?.displayId ||
      request?.widget?.displayId
  );
}

export function rewritePortfolioWidgetReferenceValue(value, refMap) {
  if (!refMap?.size || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => rewritePortfolioWidgetReferenceValue(item, refMap));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (["id", "widgetId", "displayId", "widgetDisplayId", "sourceWidgetId", "targetWidgetId"].includes(key)) {
          const mapped = refMap.get(String(item || ""));
          return [key, mapped || item];
        }
        return [key, rewritePortfolioWidgetReferenceValue(item, refMap)];
      })
    );
  }
  const mapped = refMap.get(String(value || ""));
  return mapped || value;
}

export function portfolioWidgetSummaryFromAnswer(answer = "", fallback = "") {
  const text = stripPortfolioWidgetActionBlocks(answer)
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .find((line) => !/^(위젯 초안|다음|검증|필요|요구|action|json)/i.test(line));
  return cleanPortfolioWidgetText(text || fallback || "에이전트가 위젯 초안을 만들었습니다.", 260);
}

export function buildPortfolioWidgetPatchFromAgentAnswer(answer, request = {}) {
  const parsed = parsePortfolioWidgetJsonAction(answer);
  const parsedWidget = parsed?.widget && typeof parsed.widget === "object"
    ? parsed.widget
    : parsed && typeof parsed === "object"
      ? parsed
      : {};
  const actionClassification = normalizePortfolioActionClassification(parsedWidget, parsed);
  const relationSources = [
    parsedWidget.dependsOn,
    parsedWidget.inputWidgets,
    parsedWidget.sourceWidgets,
    parsedWidget.dependencies,
    parsedWidget.sourceWidgetIds,
    parsedWidget.strategyWidgetIds,
    parsedWidget.derivedFrom,
    parsedWidget.sources,
    parsedWidget.inputs,
    parsedWidget.chartSpec?.sourceWidgetIds,
    parsedWidget.chartSpec?.strategyWidgetIds,
    parsedWidget.chart?.sourceWidgetIds,
    parsedWidget.chart?.strategyWidgetIds,
    parsed?.dependsOn,
    parsed?.inputWidgets,
    parsed?.sourceWidgets,
    parsed?.dependencies,
    parsed?.sourceWidgetIds,
    parsed?.strategyWidgetIds,
    parsed?.derivedFrom,
    parsed?.sources,
    parsed?.inputs,
    parsed?.chartSpec?.sourceWidgetIds,
    parsed?.chartSpec?.strategyWidgetIds,
    parsed?.chart?.sourceWidgetIds,
    parsed?.chart?.strategyWidgetIds,
    parsedWidget.functionSpec?.inputs,
    parsed?.functionSpec?.inputs,
    parsedWidget.updatePolicy,
    parsed?.updatePolicy,
  ];
  const hasRelationFields = relationSources.some((item) => item !== undefined && item !== null && item !== "");
  const baseText = [answer, request?.prompt, request?.widget?.prompt].filter(Boolean).join("\n");
  const datasetSourceCandidates = [
    parsedWidget.dataset,
    parsedWidget.data,
    parsedWidget.holdings,
    parsedWidget.tickers,
    parsedWidget.symbols,
    parsedWidget.assets,
    parsedWidget.positions,
    parsedWidget.chartSpec?.dataset,
    parsedWidget.chartSpec?.data,
    parsedWidget.chartSpec?.holdings,
    parsedWidget.chart?.dataset,
    parsedWidget.chart?.data,
    parsedWidget.chart?.holdings,
  ];
  const datasetSource =
    datasetSourceCandidates.find((item) => portfolioWidgetDatasetRows(item).length) ||
    datasetSourceCandidates.find((item) => item !== undefined && item !== null);
  const parsedDataset = normalizePortfolioWidgetDataset(datasetSource);
  const markdownDataset =
    datasetSource !== undefined && datasetSource !== null ? portfolioWidgetDatasetFromMarkdownTable(baseText) : [];
  const dataset = parsedDataset.length ? parsedDataset : markdownDataset;
  const summary = cleanPortfolioWidgetText(
    parsedWidget.summary || parsedWidget.agentSummary || portfolioWidgetSummaryFromAnswer(answer, request?.widget?.prompt),
    360
  );
  const rawVisualType = normalizePortfolioWidgetVisualType(
    parsedWidget.visualType ||
      parsedWidget.visual ||
      parsedWidget.type ||
      parsedWidget.chartSpec?.type ||
      parsedWidget.chart?.type ||
      request?.widget?.visualType ||
      portfolioActionClassificationVisualType(actionClassification) ||
      "memo"
  );
  const visualType = cleanPortfolioWidgetText(rawVisualType, 30);
  const isMarkdownWidget = portfolioWidgetIsMarkdownType(visualType);
  const markdown = isMarkdownWidget
    ? normalizePortfolioMarkdownText(
        parsedWidget.markdown,
        parsedWidget.markdownText,
        parsedWidget.content,
        parsedWidget.document,
        parsedWidget.body,
        parsedWidget.report,
        parsedWidget.text,
        stripPortfolioWidgetActionBlocks(answer)
      )
    : "";
  const echarts = isMarkdownWidget
    ? normalizePortfolioMarkdownECharts(
        parsedWidget.echarts,
        parsedWidget.eCharts,
        parsedWidget.echartsOptions,
        parsedWidget.echartsOption,
        markdown,
        parsedWidget.option,
        parsedWidget.sections,
        parsedWidget.chartSpec?.echarts,
        parsedWidget.chartSpec?.echartsOptions,
        parsedWidget.chartSpec?.echartsOption,
        parsedWidget.chartSpec?.option,
        parsedWidget.chartSpec,
        parsed?.echarts,
        parsed?.echartsOption,
        parsed?.sections
      )
    : [];
  const explicitDataFiles = normalizePortfolioWidgetDataFiles(
    parsedWidget.dataFiles,
    parsedWidget.dataSources,
    parsedWidget.files,
    parsedWidget.attachments,
    parsedWidget.externalData,
    parsedWidget.externalDataFiles,
    parsedWidget.functionSpec?.dataSources,
    parsedWidget.functionSpec?.dataFiles,
    parsedWidget.strategySpec?.dataSources,
    parsedWidget.tradingStrategy?.dataSources,
    parsed?.dataFiles,
    parsed?.dataSources,
    parsed?.files,
    parsed?.attachments,
    parsed?.functionSpec?.dataSources
  );
  const requestAttachmentDataFiles = visualType === "function" ? normalizePortfolioWidgetDataFiles(request?.attachments) : [];
  const dataFiles = normalizePortfolioWidgetDataFiles(
    explicitDataFiles,
    requestAttachmentDataFiles
  );
  const hasExplicitFunctionSpec =
    parsedWidget.functionSpec ||
    parsedWidget.strategySpec ||
    parsedWidget.tradingStrategy ||
    parsedWidget.ruleSpec ||
    parsedWidget.signalSpec ||
    parsedWidget.rules ||
    parsedWidget.conditions ||
    parsedWidget.signals;
  const functionSpecSource = hasExplicitFunctionSpec
    ? parsedWidget.functionSpec ||
      parsedWidget.strategySpec ||
      parsedWidget.tradingStrategy ||
      parsedWidget.ruleSpec ||
      parsedWidget.signalSpec ||
      {
        rules: parsedWidget.rules || parsedWidget.conditions || parsedWidget.signals,
        rebalance: parsedWidget.rebalance,
        riskControls: parsedWidget.riskControls || parsedWidget.guards || parsedWidget.constraints,
        executionMode: parsedWidget.executionMode,
        language: parsedWidget.language,
        inputs: parsedWidget.inputs || parsedWidget.inputWidgets,
        outputs: parsedWidget.outputs,
        dataSources: dataFiles,
      }
    : null;
  const normalizedFunctionSpec = visualType === "function" && functionSpecSource
    ? normalizePortfolioFunctionSpec(functionSpecSource)
    : null;
  const functionDataFiles = normalizedFunctionSpec
    ? filterPortfolioFunctionDataSources(normalizedFunctionSpec, dataFiles)
    : dataFiles;
  const functionSpec = normalizedFunctionSpec
    ? {
        ...normalizedFunctionSpec,
        dataSources: functionDataFiles.length ? functionDataFiles : normalizedFunctionSpec.dataSources,
      }
    : null;
  const signalMatrix =
    visualType === "function"
      ? normalizePortfolioSignalMatrix(parsedWidget.signalMatrix || parsedWidget.signalSpec || parsedWidget.matrix, {
          widget: parsedWidget,
          functionSpec,
          dataFiles: functionDataFiles,
        })
      : null;
  const visualNeedsRoom =
    dataset.length > 0 ||
    dataFiles.length > 0 ||
    ["line", "allocation", "table", "metrics-table", "checklist", "function", "markdown", "position-status", "seasonal-comparison"].includes(visualType);
  const defaultWidgetSpan = visualType === "function" ? 1 : visualType === "markdown" ? 3 : visualNeedsRoom ? 2 : 1;
  const datasetRequirements = dataset.map((row) => `${row.label} ${row.value}%`);
  const rawRequirements = normalizePortfolioWidgetList(
    parsedWidget.requirements || parsedWidget.requiredData || (datasetRequirements.length ? datasetRequirements : [])
  );
  const rawChecks = normalizePortfolioWidgetList(parsedWidget.checks || parsedWidget.validation || []);
  return {
    title: cleanPortfolioWidgetText(parsedWidget.title || request?.widget?.title || "", 80) || "새 포트폴리오 위젯",
    kind: cleanPortfolioWidgetText(parsedWidget.kind || request?.widget?.kind || "", 40) || "프롬프트 위젯",
    status: "ready",
    agentSummary: isMarkdownWidget ? "" : summary,
    visualType,
    markdown,
    echarts,
    graphRole: cleanPortfolioWidgetText(parsedWidget.graphRole || "process_node", 60),
    scenarioId: cleanPortfolioWidgetText(parsedWidget.scenarioId || parsed?.scenarioId || PORTFOLIO_SCENARIO_ROOT_ID, 80),
    outputRole: normalizePortfolioWidgetOutputRole({ ...parsedWidget, visualType, functionSpec }),
    dataset: isMarkdownWidget ? [] : dataset,
    chartSpec: buildPortfolioWidgetChartSpec(parsedWidget, visualType, dataset),
    functionSpec,
    signalMatrix,
    dataFiles: isMarkdownWidget ? [] : functionDataFiles,
    badges: normalizePortfolioWidgetList(parsedWidget.badges || parsedWidget.basis, 4, 80),
    preferredW: clampPortfolioWidgetNumber(parsedWidget.w ?? parsedWidget.layout?.w, 1, PORTFOLIO_WIDGET_MAX_SPAN, defaultWidgetSpan),
    preferredH: clampPortfolioWidgetNumber(parsedWidget.h ?? parsedWidget.layout?.h, 1, PORTFOLIO_WIDGET_MAX_HEIGHT, defaultWidgetSpan),
    requirements: visualType === "memo" ? rawRequirements : [],
    checks: visualType === "checklist" ? [...rawChecks, ...rawRequirements].slice(0, 4) : [],
    nextActions: isMarkdownWidget ? [] : normalizePortfolioWidgetList(parsedWidget.nextActions || parsedWidget.actions || parsedWidget.nextAction || [], 4, 80),
    lastAgentAnswer: cleanPortfolioWidgetText(stripPortfolioWidgetActionBlocks(answer), 1600),
    ...(isMarkdownWidget
      ? {
          dependsOn: [],
          derivedFrom: [],
          updatePolicy: "manual",
        }
      : hasRelationFields
      ? {
          dependsOn: normalizePortfolioWidgetReferenceList(
            parsedWidget.dependsOn,
            parsedWidget.inputWidgets,
            parsedWidget.sourceWidgets,
            parsedWidget.dependencies,
            parsedWidget.sourceWidgetIds,
            parsedWidget.strategyWidgetIds,
            parsedWidget.chartSpec?.sourceWidgetIds,
            parsedWidget.chartSpec?.strategyWidgetIds,
            parsedWidget.chart?.sourceWidgetIds,
            parsedWidget.chart?.strategyWidgetIds,
            parsedWidget.functionSpec?.inputs,
            parsed?.dependsOn,
            parsed?.inputWidgets,
            parsed?.sourceWidgets,
            parsed?.dependencies,
            parsed?.sourceWidgetIds,
            parsed?.strategyWidgetIds,
            parsed?.chartSpec?.sourceWidgetIds,
            parsed?.chartSpec?.strategyWidgetIds,
            parsed?.chart?.sourceWidgetIds,
            parsed?.chart?.strategyWidgetIds,
            parsed?.functionSpec?.inputs
          ),
          derivedFrom: normalizePortfolioWidgetDerivedFrom(
            parsedWidget.derivedFrom || parsedWidget.sources || parsedWidget.inputs || parsed?.derivedFrom || parsed?.sources || parsed?.inputs
          ),
          updatePolicy: normalizePortfolioWidgetUpdatePolicy(parsedWidget.updatePolicy || parsed?.updatePolicy),
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
}
