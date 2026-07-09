import { normalizePortfolioWidgetDataset } from "./datasetParser.js";
import { normalizePortfolioWidgetVisualType } from "./widgetTypes.js";

function cleanPortfolioChartText(value, maxLength = 900) {
  return String(value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}

function normalizePortfolioChartToken(value = "") {
  return cleanPortfolioChartText(value, 120)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function normalizePortfolioChartScale(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return "";
  if (/log|로그|logarithmic/.test(normalized)) return "log";
  if (/linear|value|선형/.test(normalized)) return "linear";
  return "";
}

export function portfolioWidgetDatasetLooksLikeTimeSeries(rows = []) {
  return rows.some((row) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(String(row?.label || "").trim()));
}

export function portfolioWidgetLooksLikeBacktestLine(widget = {}) {
  const chartSpec = widget?.chartSpec && typeof widget.chartSpec === "object" ? widget.chartSpec : {};
  const actionTokens = Array.isArray(widget?.nextActions) ? widget.nextActions.map(normalizePortfolioChartToken) : [];
  const tokens = [
    ...actionTokens,
    widget?.outputRole,
    chartSpec?.type,
    chartSpec?.role,
    chartSpec?.source,
    chartSpec?.dataProvider,
    chartSpec?.xField,
    chartSpec?.restoreMode,
  ]
    .filter(Boolean)
    .map(normalizePortfolioChartToken);
  const explicitBacktestSignal = tokens.some((token) =>
    [
      "run_backtest_chart_widget",
      "run_yfinance_backtest_comparison",
      "backtest_result",
      "period_return_comparison",
      "self_table_toggle",
    ].includes(token)
  );
  return (
    explicitBacktestSignal ||
    (Array.isArray(chartSpec.sourceTables) && chartSpec.sourceTables.length > 0) ||
    (Array.isArray(chartSpec.strategyWidgetIds) && chartSpec.strategyWidgetIds.length > 0)
  );
}

export function portfolioWidgetSuppressLineDatasetFallback(widget = {}) {
  if (normalizePortfolioWidgetVisualType(widget?.visualType || widget?.chartSpec?.type) !== "line") return false;
  if (!portfolioWidgetLooksLikeBacktestLine(widget)) return false;
  const dataset = normalizePortfolioWidgetDataset(widget?.dataset || widget?.chartSpec?.dataset, 24);
  return !portfolioWidgetDatasetLooksLikeTimeSeries(dataset);
}

export function buildPortfolioWidgetChartSpec(parsedWidget, visualType, dataset) {
  const source = parsedWidget?.chartSpec || parsedWidget?.chart || parsedWidget || {};
  const backtestLine = normalizePortfolioWidgetVisualType(source.type || visualType) === "line" && portfolioWidgetLooksLikeBacktestLine(parsedWidget);
  const sourceSeries = Array.isArray(source.series)
    ? source.series.slice(0, 12).map((series, index) => ({
        name: cleanPortfolioChartText(series?.name || `Series ${index + 1}`, 80),
        data: Array.isArray(series?.data) ? series.data.slice(0, 1400) : [],
        type: cleanPortfolioChartText(series?.type || "line", 20),
        smooth: series?.smooth !== false,
        lineStyle: series?.lineStyle && typeof series.lineStyle === "object" ? series.lineStyle : undefined,
        areaStyle: series?.areaStyle && typeof series.areaStyle === "object" ? series.areaStyle : undefined,
      }))
    : [];
  return {
    type: normalizePortfolioWidgetVisualType(source.type || visualType),
    title: cleanPortfolioChartText(source.title || parsedWidget?.title || "", 80),
    dataset,
    engine: cleanPortfolioChartText(source.engine || "", 40),
    chartType: cleanPortfolioChartText(source.chartType || source.chartKind || "", 40),
    dataProvider: cleanPortfolioChartText(source.dataProvider || source.provider || "", 80),
    source: cleanPortfolioChartText(source.source || source.dataSource || "", 80),
    query: source.query && typeof source.query === "object" ? { ...source.query } : undefined,
    xField: cleanPortfolioChartText(source.xField || (backtestLine ? "date" : "label"), 32),
    yField: cleanPortfolioChartText(source.yField || "value", 32),
    yScale: normalizePortfolioChartScale(source.yScale || source.yAxisScale || source.axisScale || source.scale || source.yAxis?.type),
    xLabels: Array.isArray(source.xLabels) ? source.xLabels.slice(0, 1400).map((item) => String(item ?? "")) : [],
    series: sourceSeries,
    benchmark: cleanPortfolioChartText(source.benchmark || "", 24),
    includeBenchmark:
      source.includeBenchmark === false || source.showBenchmark === false || source.withBenchmark === false
        ? false
        : source.includeBenchmark === true || source.showBenchmark === true || source.withBenchmark === true
          ? true
          : undefined,
    benchmarkMode: cleanPortfolioChartText(source.benchmarkMode || source.benchmarkPolicy || "", 20),
    role: cleanPortfolioChartText(source.role || source.purpose || source.benchmarkRole || "", 40),
    restoreMode: cleanPortfolioChartText(source.restoreMode || "", 40),
    metrics: Array.isArray(source.metrics) ? source.metrics.slice(0, 12) : [],
    metricColumns: Array.isArray(source.metricColumns) ? source.metricColumns.slice(0, 16) : [],
    issues: Array.isArray(source.issues) ? source.issues.slice(0, 12) : [],
    sourceWidgetIds: Array.isArray(source.sourceWidgetIds) ? source.sourceWidgetIds.slice(0, 12).map(String) : [],
    strategyWidgetIds: Array.isArray(source.strategyWidgetIds) ? source.strategyWidgetIds.slice(0, 12).map(String) : [],
    benchmarkSourceWidgetIds: Array.isArray(source.benchmarkSourceWidgetIds) ? source.benchmarkSourceWidgetIds.slice(0, 12).map(String) : [],
    betaBenchmarkWidgetIds: Array.isArray(source.betaBenchmarkWidgetIds) ? source.betaBenchmarkWidgetIds.slice(0, 12).map(String) : [],
    expectedSeries: Array.isArray(source.expectedSeries) ? source.expectedSeries.slice(0, 12).map((item) => cleanPortfolioChartText(item, 80)).filter(Boolean) : [],
    sourceTables: Array.isArray(source.sourceTables)
      ? source.sourceTables.slice(0, 12).map((table, index) => ({
          id: String(table?.id || ""),
          displayId: cleanPortfolioChartText(table?.displayId || "", 20),
          title: cleanPortfolioChartText(table?.title || `입력 테이블 ${index + 1}`, 80),
          kind: cleanPortfolioChartText(table?.kind || "포트폴리오 표", 40),
          dataset: normalizePortfolioWidgetDataset(table?.dataset, 24),
        }))
      : [],
  };
}

export function portfolioWidgetPieGradient(dataset = []) {
  const total = dataset.reduce((sum, row) => sum + row.value, 0);
  if (!total) return "conic-gradient(#d7e4de 0deg 360deg)";
  let start = 0;
  const segments = dataset.map((row, index) => {
    const end = index === dataset.length - 1 ? 360 : start + (row.value / total) * 360;
    const segment = `${row.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    start = end;
    return segment;
  });
  return `conic-gradient(${segments.join(", ")})`;
}

export function portfolioWidgetAllocationPercent(row = {}, dataset = []) {
  const total = dataset.reduce((sum, item) => sum + Number(item?.value || 0), 0);
  const value = Number(row?.value || 0);
  if (!total || !Number.isFinite(value)) return 0;
  return (value / total) * 100;
}

export function buildPortfolioWidgetAllocationOption(widget) {
  const dataset = normalizePortfolioWidgetDataset(widget?.dataset || widget?.chartSpec?.dataset, 12);
  const chartRows = dataset.length
    ? dataset
    : [{ label: "데이터 대기", value: 1, color: "#d7e4de" }];
  return {
    color: chartRows.map((row) => row.color),
    title: dataset.length
      ? undefined
      : {
          text: "차트 데이터 대기",
          subtext: "holdings 또는 dataset이 들어오면 즉시 갱신됩니다.",
          left: "center",
          top: "center",
          textStyle: { color: "#475652", fontSize: 13, fontWeight: 850 },
          subtextStyle: { color: "#7f8b88", fontSize: 11 },
        },
    tooltip: {
      trigger: "item",
      formatter: ({ name, value, percent }) =>
        `${name}<br/>비중 ${Number(percent || 0).toFixed(1)}% · 값 ${Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`,
    },
    series: [
      {
        name: widget?.title || "포트폴리오 비중",
        type: "pie",
        radius: ["50%", "74%"],
        center: ["50%", "52%"],
        avoidLabelOverlap: true,
        minShowLabelAngle: 4,
        itemStyle: {
          borderColor: "#ffffff",
          borderWidth: 2,
          borderRadius: 2,
        },
        emphasis: {
          scale: true,
          scaleSize: 8,
          itemStyle: {
            shadowBlur: 14,
            shadowColor: "rgba(26, 54, 47, 0.22)",
          },
          label: {
            fontWeight: 850,
          },
        },
        label: {
          show: dataset.length > 0,
          color: "#2f3634",
          fontSize: 11,
          fontWeight: 720,
          lineHeight: 14,
          formatter: ({ name, percent }) => `${name}\n${Number(percent || 0).toFixed(0)}%`,
        },
        labelLine: {
          show: dataset.length > 0,
          length: 11,
          length2: 8,
          lineStyle: {
            width: 1.4,
          },
        },
        data: chartRows.map((row) => ({
          name: row.label,
          value: row.value,
          itemStyle: { color: row.color },
        })),
      },
    ],
  };
}

export function buildPortfolioWidgetLineOption(widget) {
  const chartSpec = widget?.chartSpec && typeof widget.chartSpec === "object" ? widget.chartSpec : {};
  const specSeries = Array.isArray(chartSpec.series) ? chartSpec.series.filter((series) => Array.isArray(series?.data) && series.data.length) : [];
  const specLabels = Array.isArray(chartSpec.xLabels) ? chartSpec.xLabels : [];
  const isCompact = Number(widget?.h || 1) <= 2;
  const requestedYScale = normalizePortfolioChartScale(
    chartSpec.yScale || chartSpec.yAxisScale || chartSpec.axisScale || chartSpec.scale || chartSpec.yAxis?.type
  );
  if (specSeries.length && specLabels.length) {
    const numericValues = specSeries
      .flatMap((series) => series.data)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    const minValue = numericValues.length ? Math.max(0, Math.floor(Math.min(...numericValues) - 2)) : undefined;
    const canUseLogScale = requestedYScale === "log" && numericValues.every((value) => value > 0);
    const yAxisLabel = {
      color: "#5f6c69",
      fontSize: isCompact ? 10 : 11,
      formatter: (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 }) : value),
    };
    return {
      color: ["#2f806e", "#7a6f9f", "#b07d45", "#c36c62", "#4d8f7a", "#6b7c93", "#efb54e"],
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) =>
          Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-",
      },
      legend: {
        top: 0,
        right: 0,
        type: "scroll",
        itemWidth: isCompact ? 18 : 25,
        itemHeight: isCompact ? 10 : 14,
        textStyle: { color: "#465450", fontSize: isCompact ? 10 : 11, fontWeight: 700 },
      },
      grid: isCompact ? { left: 34, right: 14, top: 28, bottom: 16, containLabel: true } : { left: 34, right: 18, top: 34, bottom: 28, containLabel: true },
      xAxis: {
        type: "category",
        data: specLabels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#d8e0de" } },
        axisLabel: { color: "#5f6c69", fontSize: isCompact ? 10 : 11, hideOverlap: true },
      },
      yAxis: {
        type: canUseLogScale ? "log" : "value",
        ...(canUseLogScale ? { logBase: 10, min: "dataMin" } : { min: minValue }),
        axisLabel: yAxisLabel,
        splitLine: { lineStyle: { color: "#edf1f0" } },
      },
      series: specSeries.map((series, index) => ({
        name: series.name || `Series ${index + 1}`,
        type: "line",
        smooth: series.smooth !== false,
        symbolSize: index === 0 ? (isCompact ? 3 : 4) : 0,
        lineStyle: {
          width: index === 0 ? (isCompact ? 2.4 : 3) : isCompact ? 1.8 : 2,
          ...(series.lineStyle || {}),
        },
        areaStyle: series.areaStyle,
        data: series.data,
      })),
    };
  }
  const suppressDatasetFallback = portfolioWidgetSuppressLineDatasetFallback(widget);
  const dataset = suppressDatasetFallback ? [] : normalizePortfolioWidgetDataset(widget?.dataset || widget?.chartSpec?.dataset, 24);
  const datasetValues = dataset.map((row) => Number(row.value)).filter((value) => Number.isFinite(value));
  const canUseLogScale = requestedYScale === "log" && datasetValues.every((value) => value > 0);
  const waitingForBacktest = portfolioWidgetLooksLikeBacktestLine(widget);
  return {
    color: ["#2f806e"],
    title: dataset.length
      ? undefined
      : {
          text: waitingForBacktest ? "백테스트 실행 대기" : "차트 데이터 대기",
          subtext: waitingForBacktest
            ? "실행 후 날짜 X축과 전략별 시리즈로 갱신됩니다."
            : "날짜/값 데이터셋이 들어오면 선 차트로 갱신됩니다.",
          left: "center",
          top: "center",
          textStyle: { color: "#475652", fontSize: 13, fontWeight: 850 },
          subtextStyle: { color: "#7f8b88", fontSize: 11 },
    },
    tooltip: { trigger: "axis" },
    grid: isCompact ? { left: 34, right: 14, top: 24, bottom: 16, containLabel: true } : { left: 34, right: 18, top: 28, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: dataset.map((row) => row.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#d8e0de" } },
      axisLabel: { color: "#5f6c69", fontSize: isCompact ? 10 : 11, hideOverlap: true },
    },
    yAxis: {
      type: canUseLogScale ? "log" : "value",
      ...(canUseLogScale ? { logBase: 10, min: "dataMin" } : {}),
      axisLabel: { color: "#5f6c69", fontSize: isCompact ? 10 : 11 },
      splitLine: { lineStyle: { color: "#edf1f0" } },
    },
    series: [
      {
        name: widget?.title || "포트폴리오 차트",
        type: "line",
        smooth: true,
        symbolSize: isCompact ? 3 : 5,
        lineStyle: { width: isCompact ? 2.4 : 3 },
        areaStyle: { opacity: 0.08 },
        data: dataset.map((row) => row.value),
      },
    ],
  };
}
