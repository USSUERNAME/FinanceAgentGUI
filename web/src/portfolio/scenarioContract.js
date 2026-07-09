import { cleanPortfolioWidgetText } from "./widgetIdentity.js";
import { normalizePortfolioWidgetVisualType } from "./widgetTypes.js";

export const PORTFOLIO_SCENARIO_ROOT_ID = "portfolio_scenario_root";

export const PORTFOLIO_WIDGET_OUTPUT_ROLES = Object.freeze({
  allocationSnapshot: "allocation_snapshot",
  assetHistory: "asset_history",
  backtestResult: "backtest_result",
  metrics: "metrics",
  note: "note",
  positionStatus: "position_status",
  scenarioGrid: "scenario_grid",
  seasonalComparison: "seasonal_comparison",
  signalMatrix: "signal_matrix",
  sourceMatrix: "source_matrix",
});

const defaultScenarioAssumptions = Object.freeze({
  dataProvider: "yfinance",
  executionPrice: "next_open",
  feePolicy: "0%",
  slippagePolicy: "0%",
  dividendPolicy: "adjusted",
  cashInterestPolicy: "0%",
});

function normalizeScenarioRun(value = {}, index = 0, fallbackPeriod = "1y") {
  const startDate = cleanPortfolioWidgetText(value.startDate || value.start || "", 30);
  const endDate = cleanPortfolioWidgetText(value.endDate || value.end || "", 30);
  const rawPeriod = cleanPortfolioWidgetText(value.period || value.range || "", 40);
  const rawLabel = cleanPortfolioWidgetText(value.label || value.name || "", 80);
  const hasSpecificLabel = Boolean(rawLabel && !/^기본 실행$|^실행 \d+$/i.test(rawLabel));
  const period =
    !startDate && !endDate && hasSpecificLabel && (!rawPeriod || rawPeriod === "1y" || rawPeriod === fallbackPeriod)
      ? "기간 미확정"
      : rawPeriod || (startDate || endDate ? "custom" : fallbackPeriod || "1y");
  return {
    runId: cleanPortfolioWidgetText(value.runId || value.id || value.key || (index === 0 ? "base" : `run_${index + 1}`), 40),
    label: rawLabel || (index === 0 ? "기본 실행" : `실행 ${index + 1}`),
    period,
    startDate,
    endDate,
    timeframe: cleanPortfolioWidgetText(value.timeframe || value.interval || value.frequency || "1d", 30),
  };
}

export function defaultPortfolioScenarioSpec({ backtestPeriod = "1y", now = new Date().toISOString() } = {}) {
  return {
    id: PORTFOLIO_SCENARIO_ROOT_ID,
    graphRole: "scenario_root",
    outputRole: PORTFOLIO_WIDGET_OUTPUT_ROLES.scenarioGrid,
    title: "기간 및 타임프레임",
    status: "ready",
    version: 1,
    runs: [normalizeScenarioRun({ period: backtestPeriod }, 0, backtestPeriod)],
    dimensions: ["runId", "date", "asset", "field"],
    assumptions: { ...defaultScenarioAssumptions },
    updatedAt: now,
  };
}

export function normalizePortfolioScenarioSpec(value, { backtestPeriod = "1y", now = new Date().toISOString() } = {}) {
  const fallback = defaultPortfolioScenarioSpec({ backtestPeriod, now });
  const source = value && typeof value === "object" ? value : {};
  const runs = Array.isArray(source.runs)
    ? source.runs.slice(0, 12).map((run, index) => normalizeScenarioRun(run, index, backtestPeriod)).filter((run) => run.runId)
    : [];
  const assumptions = source.assumptions && typeof source.assumptions === "object" ? source.assumptions : {};
  return {
    ...fallback,
    id: cleanPortfolioWidgetText(source.id || PORTFOLIO_SCENARIO_ROOT_ID, 80) || PORTFOLIO_SCENARIO_ROOT_ID,
    title: cleanPortfolioWidgetText(source.title || fallback.title, 80),
    status: cleanPortfolioWidgetText(source.status || fallback.status, 30),
    version: Math.max(1, Number(source.version || 1) || 1),
    runs: runs.length ? runs : fallback.runs,
    dimensions: Array.isArray(source.dimensions) && source.dimensions.length
      ? source.dimensions.slice(0, 8).map((item) => cleanPortfolioWidgetText(item, 40)).filter(Boolean)
      : fallback.dimensions,
    assumptions: {
      ...fallback.assumptions,
      dataProvider: cleanPortfolioWidgetText(assumptions.dataProvider || assumptions.source || fallback.assumptions.dataProvider, 60),
      executionPrice: cleanPortfolioWidgetText(assumptions.executionPrice || fallback.assumptions.executionPrice, 60),
      feePolicy: cleanPortfolioWidgetText(assumptions.feePolicy || assumptions.fees || fallback.assumptions.feePolicy, 60),
      slippagePolicy: cleanPortfolioWidgetText(assumptions.slippagePolicy || assumptions.slippage || fallback.assumptions.slippagePolicy, 60),
      dividendPolicy: cleanPortfolioWidgetText(assumptions.dividendPolicy || fallback.assumptions.dividendPolicy, 60),
      cashInterestPolicy: cleanPortfolioWidgetText(assumptions.cashInterestPolicy || assumptions.cashInterest || fallback.assumptions.cashInterestPolicy, 60),
    },
    graphRole: "scenario_root",
    outputRole: PORTFOLIO_WIDGET_OUTPUT_ROLES.scenarioGrid,
    updatedAt: String(source.updatedAt || fallback.updatedAt),
  };
}

export function normalizePortfolioPeriodComparison(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rawFlag =
    source.isMultiplePeriodComparison ??
    source.multiplePeriodComparison ??
    source.isMultiple ??
    source.multiple ??
    source.requiresScenarioRuns ??
    source.periodComparison;
  const flagText = String(rawFlag ?? "").trim().toLowerCase();
  const periods = Array.isArray(source.periods)
    ? source.periods
        .slice(0, 12)
        .map((period, index) => normalizeScenarioRun(period, index, "custom"))
        .filter((period) => period.label || period.startDate || period.endDate)
    : [];
  const explicitTrue = rawFlag === true || ["y", "yes", "true", "multiple", "multi", "복수", "예"].includes(flagText);
  return {
    isMultiplePeriodComparison: explicitTrue || periods.length > 1,
    periods,
    confidence: cleanPortfolioWidgetText(source.confidence || "", 30),
    note: cleanPortfolioWidgetText(source.note || source.reason || "", 180),
  };
}

export function portfolioActionDeclaresMultiplePeriodComparison(action = {}) {
  const periodComparison = normalizePortfolioPeriodComparison(action?.periodComparison || action?.periodComparisonIntent);
  if (periodComparison.isMultiplePeriodComparison) return true;
  const classification =
    action?.classification ||
    action?.intent ||
    action?.taskIntent ||
    action?.analysisIntent ||
    action?.requestClassification ||
    action?.decision ||
    action?.decisionFlags ||
    {};
  const rawFlag =
    classification.isMultiplePeriodComparison ??
    classification.multiplePeriodComparison ??
    classification.isMultiple ??
    classification.multiple ??
    classification.requiresScenarioRuns;
  const flagText = String(rawFlag ?? "").trim().toLowerCase();
  return rawFlag === true || ["y", "yes", "true", "multiple", "multi", "복수", "예"].includes(flagText);
}

export function portfolioScenarioHasConcreteRuns(scenario = {}) {
  const normalized = normalizePortfolioScenarioSpec(scenario);
  return normalized.runs.length > 1 && normalized.runs.every((run) => run.startDate && run.endDate);
}

export function portfolioScenarioHasIncompleteComparisonRuns(scenario = {}) {
  const normalized = normalizePortfolioScenarioSpec(scenario);
  return normalized.runs.length > 1 && normalized.runs.some((run) => !run.startDate || !run.endDate);
}

export function normalizePortfolioWidgetOutputRole(widget = {}) {
  const visualType = normalizePortfolioWidgetVisualType(widget.visualType || widget.chartSpec?.type);
  if (visualType === "markdown") return PORTFOLIO_WIDGET_OUTPUT_ROLES.note;
  const explicit = cleanPortfolioWidgetText(
    widget.outputRole ||
      widget.matrixRole ||
      widget.resultRole ||
      widget.chartSpec?.outputRole ||
      widget.chartSpec?.matrixRole ||
      widget.functionSpec?.outputRole ||
      "",
    60
  );
  if (Object.values(PORTFOLIO_WIDGET_OUTPUT_ROLES).includes(explicit)) return explicit;

  if (visualType === "function") return PORTFOLIO_WIDGET_OUTPUT_ROLES.signalMatrix;
  if (visualType === "metrics-table") return PORTFOLIO_WIDGET_OUTPUT_ROLES.metrics;
  if (visualType === "allocation") return PORTFOLIO_WIDGET_OUTPUT_ROLES.allocationSnapshot;
  if (visualType === "price-history") return PORTFOLIO_WIDGET_OUTPUT_ROLES.assetHistory;
  if (visualType === "position-status") return PORTFOLIO_WIDGET_OUTPUT_ROLES.positionStatus;
  if (visualType === "seasonal-comparison") return PORTFOLIO_WIDGET_OUTPUT_ROLES.seasonalComparison;
  if (visualType === "line") return PORTFOLIO_WIDGET_OUTPUT_ROLES.backtestResult;
  if (visualType === "table") return PORTFOLIO_WIDGET_OUTPUT_ROLES.sourceMatrix;
  return PORTFOLIO_WIDGET_OUTPUT_ROLES.note;
}

const portfolioOutputRoleOrder = Object.freeze({
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.scenarioGrid]: 0,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.sourceMatrix]: 1,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.allocationSnapshot]: 2,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.assetHistory]: 3,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.positionStatus]: 3,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.seasonalComparison]: 3,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.signalMatrix]: 2,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.backtestResult]: 3,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.metrics]: 4,
  [PORTFOLIO_WIDGET_OUTPUT_ROLES.note]: 9,
});

export function portfolioWidgetCanDependOnOutputRole(targetRole = "", sourceRole = "") {
  const target = portfolioOutputRoleOrder[targetRole] ?? portfolioOutputRoleOrder[PORTFOLIO_WIDGET_OUTPUT_ROLES.note];
  const source = portfolioOutputRoleOrder[sourceRole] ?? portfolioOutputRoleOrder[PORTFOLIO_WIDGET_OUTPUT_ROLES.note];
  if (targetRole === PORTFOLIO_WIDGET_OUTPUT_ROLES.note) return true;
  if (sourceRole === PORTFOLIO_WIDGET_OUTPUT_ROLES.note) return false;
  return source <= target;
}

export function portfolioWidgetCanDependOnWidget(targetWidget = {}, sourceWidget = {}) {
  return portfolioWidgetCanDependOnOutputRole(
    normalizePortfolioWidgetOutputRole(targetWidget),
    normalizePortfolioWidgetOutputRole(sourceWidget)
  );
}

export function portfolioScenarioLabel(scenario = {}) {
  const normalized = normalizePortfolioScenarioSpec(scenario);
  const runLabels = normalized.runs.map((run) => `${run.label} ${run.period || ""} ${run.timeframe || ""}`.replace(/\s+/g, " ").trim());
  return runLabels.join(" / ");
}
