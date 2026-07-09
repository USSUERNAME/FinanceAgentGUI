export const PORTFOLIO_WIDGET_VISUAL_TYPES = Object.freeze({
  allocation: "allocation",
  checklist: "checklist",
  function: "function",
  line: "line",
  markdown: "markdown",
  memo: "memo",
  metricsTable: "metrics-table",
  priceHistory: "price-history",
  positionStatus: "position-status",
  seasonalComparison: "seasonal-comparison",
  table: "table",
});

export const PORTFOLIO_WIDGET_DOMAIN_TYPES = Object.freeze({
  betaReference: "beta-reference",
  function: "function",
  portfolioTable: "portfolio-table",
  timeSeriesChart: "time-series-chart",
});

export const PORTFOLIO_WIDGET_CANONICAL_VISUAL_TYPES = Object.freeze([
  PORTFOLIO_WIDGET_VISUAL_TYPES.allocation,
  PORTFOLIO_WIDGET_VISUAL_TYPES.checklist,
  PORTFOLIO_WIDGET_VISUAL_TYPES.function,
  PORTFOLIO_WIDGET_VISUAL_TYPES.line,
  PORTFOLIO_WIDGET_VISUAL_TYPES.markdown,
  PORTFOLIO_WIDGET_VISUAL_TYPES.metricsTable,
  PORTFOLIO_WIDGET_VISUAL_TYPES.priceHistory,
  PORTFOLIO_WIDGET_VISUAL_TYPES.positionStatus,
  PORTFOLIO_WIDGET_VISUAL_TYPES.seasonalComparison,
  PORTFOLIO_WIDGET_VISUAL_TYPES.table,
]);

function normalizeWidgetTypeToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function normalizePortfolioWidgetVisualType(value = "") {
  const token = normalizeWidgetTypeToken(value);
  if (!token) return PORTFOLIO_WIDGET_VISUAL_TYPES.memo;
  if (["markdown", "md", "document", "report", "note"].includes(token)) return PORTFOLIO_WIDGET_VISUAL_TYPES.markdown;
  if (["function", "strategy_function", "trading_strategy", "function_widget", "signal_matrix"].includes(token)) {
    return PORTFOLIO_WIDGET_VISUAL_TYPES.function;
  }
  if (["metrics_table", "standard_metrics", "benchmark_metrics", "performance_table"].includes(token)) {
    return PORTFOLIO_WIDGET_VISUAL_TYPES.metricsTable;
  }
  if (["pie", "donut", "allocation", "allocation_chart"].includes(token)) return PORTFOLIO_WIDGET_VISUAL_TYPES.allocation;
  if (
    [
      "price_history",
      "price_history_chart",
      "asset_history",
      "asset_history_chart",
      "investment_history",
      "investment_history_chart",
      "portfolio_value_history",
    ].includes(token)
  ) {
    return PORTFOLIO_WIDGET_VISUAL_TYPES.priceHistory;
  }
  if (
    [
      "position_status",
      "position_status_chart",
      "positions_status",
      "positions_chart",
      "holdings_status",
      "holdings_status_chart",
      "holdings_composition",
      "holdings_composition_chart",
      "investment_position_status",
      "investment_positions",
      "investment_positions_chart",
      "asset_position_status",
      "asset_positions",
      "asset_positions_chart",
    ].includes(token)
  ) {
    return PORTFOLIO_WIDGET_VISUAL_TYPES.positionStatus;
  }
  if (
    [
      "seasonal_comparison",
      "seasonal_comparison_chart",
      "seasonal_return",
      "seasonal_returns",
      "seasonal_return_chart",
      "annual_return_comparison",
      "annual_returns_comparison",
      "yearly_return_comparison",
      "yearly_returns_comparison",
      "year_comparison",
      "season_by_year",
      "seasonal",
    ].includes(token)
  ) {
    return PORTFOLIO_WIDGET_VISUAL_TYPES.seasonalComparison;
  }
  if (["line", "line_chart", "time_series_chart", "backtest_line_chart", "backtest_result"].includes(token)) {
    return PORTFOLIO_WIDGET_VISUAL_TYPES.line;
  }
  if (["table", "source_table", "holdings_table", "portfolio_table", "source_matrix"].includes(token)) {
    return PORTFOLIO_WIDGET_VISUAL_TYPES.table;
  }
  if (["check", "checklist", "risk_checklist", "validation_checklist"].includes(token)) {
    return PORTFOLIO_WIDGET_VISUAL_TYPES.checklist;
  }
  if (Object.values(PORTFOLIO_WIDGET_VISUAL_TYPES).includes(token)) return token;
  return PORTFOLIO_WIDGET_VISUAL_TYPES.memo;
}

export function portfolioWidgetVisualTypeContractIssue(widget = {}) {
  const visualType = normalizePortfolioWidgetVisualType(widget?.visualType || widget?.chartSpec?.type || "");
  if (PORTFOLIO_WIDGET_CANONICAL_VISUAL_TYPES.includes(visualType)) return null;
  const display = widget?.displayId || widget?.title || "위젯";
  return {
    code: "missing_widget_visual_type",
    widgetId: widget?.id,
    displayId: widget?.displayId,
    title: widget?.title,
    message: `${display} 생성 보류 · widget.visualType은 table, function, line, price-history, position-status, seasonal-comparison, metrics-table, markdown, allocation, checklist 중 하나로 명시해야 합니다. memo/프롬프트 위젯 fallback은 에이전트 산출물로 저장하지 않습니다.`,
  };
}
