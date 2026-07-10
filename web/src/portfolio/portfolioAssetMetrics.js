export const portfolioAssetEvaluationMetricColumns = [
  { key: "name", label: "자산" },
  { key: "cumulativeReturn", label: "Cumulative Return" },
  { key: "cagr", label: "CAGR" },
  { key: "mdd", label: "MDD" },
  { key: "volatility", label: "Volatility" },
  { key: "sharpe", label: "Sharpe" },
  { key: "sortino", label: "Sortino" },
  { key: "calmar", label: "Calmar" },
  { key: "ulcer", label: "Ulcer" },
  { key: "upi", label: "UPI" },
  { key: "beta", label: "BETA" },
];

export const portfolioAssetBetaBenchmarks = [
  {
    id: "KODEX_200",
    label: "KODEX 200",
    asset: { symbol: "069500", name: "KODEX 200", market: "KRX ETF" },
  },
  {
    id: "VOO",
    label: "VOO",
    asset: { symbol: "VOO", name: "Vanguard S&P 500 ETF", market: "NYSE Arca" },
  },
];

export const DEFAULT_PORTFOLIO_ASSET_BETA_BENCHMARK_ID = "VOO";

export function portfolioAssetBetaBenchmark(value = "") {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return portfolioAssetBetaBenchmarks.find((benchmark) => (
    benchmark.id === normalized || benchmark.asset.symbol === normalized
  )) || portfolioAssetBetaBenchmarks.find((benchmark) => benchmark.id === DEFAULT_PORTFOLIO_ASSET_BETA_BENCHMARK_ID);
}

export function portfolioWidgetIsAssetEvaluationTable(widget = {}, sourceWidgetId = "") {
  const role = String(widget?.chartSpec?.role || widget?.outputRole || "").trim().toLowerCase();
  if (role !== "asset_history_evaluation") return false;
  if (!sourceWidgetId) return true;
  const references = [
    widget?.chartSpec?.sourceWidgetId,
    ...(Array.isArray(widget?.chartSpec?.sourceWidgetIds) ? widget.chartSpec.sourceWidgetIds : []),
    ...(Array.isArray(widget?.dependsOn) ? widget.dependsOn : []),
  ].map((value) => String(value || "").trim());
  return references.includes(sourceWidgetId);
}

function cleanSeries(rows = []) {
  const byTime = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const time = String(row?.time || "").slice(0, 10);
    const value = Number(row?.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time) || !Number.isFinite(value) || value <= 0) continue;
    byTime.set(time, { time, value });
  }
  return [...byTime.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function periodicReturns(rows = []) {
  const cleanRows = cleanSeries(rows);
  const returns = [];
  for (let index = 1; index < cleanRows.length; index += 1) {
    const value = cleanRows[index].value / cleanRows[index - 1].value - 1;
    if (Number.isFinite(value)) returns.push({ time: cleanRows[index].time, value });
  }
  return returns;
}

function average(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleDeviation(values = []) {
  if (values.length < 2) return null;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function periodsPerYear(timeframe = "1d") {
  if (timeframe === "1mo") return 12;
  if (["1w", "1wk"].includes(timeframe)) return 52;
  return 252;
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

function betaToBenchmark(rows = [], benchmarkRows = []) {
  const benchmarkByTime = new Map(cleanSeries(benchmarkRows).map((row) => [row.time, row.value]));
  const alignedValues = cleanSeries(rows).flatMap((row) => (
    benchmarkByTime.has(row.time)
      ? [{ time: row.time, assetValue: row.value, benchmarkValue: benchmarkByTime.get(row.time) }]
      : []
  ));
  const pairs = [];
  for (let index = 1; index < alignedValues.length; index += 1) {
    const previous = alignedValues[index - 1];
    const current = alignedValues[index];
    const assetReturn = current.assetValue / previous.assetValue - 1;
    const benchmarkReturn = current.benchmarkValue / previous.benchmarkValue - 1;
    if (Number.isFinite(assetReturn) && Number.isFinite(benchmarkReturn)) {
      pairs.push([assetReturn, benchmarkReturn]);
    }
  }
  if (pairs.length < 2) return null;
  const assetMean = average(pairs.map(([assetReturn]) => assetReturn));
  const benchmarkMean = average(pairs.map(([, benchmarkReturn]) => benchmarkReturn));
  let covariance = 0;
  let benchmarkVariance = 0;
  for (const [assetReturn, benchmarkReturn] of pairs) {
    covariance += (assetReturn - assetMean) * (benchmarkReturn - benchmarkMean);
    benchmarkVariance += (benchmarkReturn - benchmarkMean) ** 2;
  }
  return benchmarkVariance > 0 ? covariance / benchmarkVariance : null;
}

export function buildPortfolioAssetMetricRow({ name = "", rows = [], timeframe = "1d", benchmarkRows = [], benchmarkLabel = "" } = {}) {
  const cleanRows = cleanSeries(rows);
  if (cleanRows.length < 2 || !name) return null;
  const first = cleanRows[0];
  const last = cleanRows.at(-1);
  const cumulativeReturn = (last.value / first.value - 1) * 100;
  const elapsedDays = Math.max(1, (Date.parse(`${last.time}T00:00:00Z`) - Date.parse(`${first.time}T00:00:00Z`)) / 86_400_000);
  const cagr = ((last.value / first.value) ** (365.25 / elapsedDays) - 1) * 100;
  const returnRows = periodicReturns(cleanRows);
  const returnValues = returnRows.map((row) => row.value);
  const annualPeriods = periodsPerYear(timeframe);
  const meanReturn = average(returnValues);
  const deviation = sampleDeviation(returnValues);
  const volatility = Number.isFinite(deviation) ? deviation * Math.sqrt(annualPeriods) * 100 : null;
  const annualizedMean = Number.isFinite(meanReturn) ? meanReturn * annualPeriods : null;
  const sharpe = ratio(annualizedMean, Number.isFinite(deviation) ? deviation * Math.sqrt(annualPeriods) : null);
  const downsideValues = returnValues.filter((value) => value < 0);
  const downsideDeviation = downsideValues.length
    ? Math.sqrt(downsideValues.reduce((sum, value) => sum + value ** 2, 0) / downsideValues.length) * Math.sqrt(annualPeriods)
    : null;
  const sortino = ratio(annualizedMean, downsideDeviation);
  let peak = cleanRows[0].value;
  let mdd = 0;
  let drawdownSquares = 0;
  for (const row of cleanRows) {
    peak = Math.max(peak, row.value);
    const drawdown = (row.value / peak - 1) * 100;
    mdd = Math.min(mdd, drawdown);
    drawdownSquares += drawdown ** 2;
  }
  const ulcer = Math.sqrt(drawdownSquares / cleanRows.length);
  return {
    name,
    cumulativeReturn,
    cagr,
    mdd,
    volatility,
    sharpe,
    sortino,
    calmar: ratio(cagr, Math.abs(mdd)),
    ulcer,
    upi: ratio(cagr, ulcer),
    beta: betaToBenchmark(cleanRows, benchmarkRows),
    betaBenchmark: benchmarkLabel,
  };
}

export function buildPortfolioAssetMetricRows({
  portfolioRows = [],
  assetSeries = [],
  timeframe = "1d",
  benchmarkRows = [],
  benchmarkLabel = "",
} = {}) {
  const portfolioMetric = buildPortfolioAssetMetricRow({
    name: "보유자산",
    rows: portfolioRows,
    timeframe,
    benchmarkRows,
    benchmarkLabel,
  });
  const assetMetrics = assetSeries.flatMap((series) => {
    const name = [series?.asset?.symbol, series?.asset?.name && series.asset.name !== series.asset.symbol ? series.asset.name : ""]
      .filter(Boolean)
      .join(" · ");
    const row = buildPortfolioAssetMetricRow({
      name,
      rows: series?.rows,
      timeframe,
      benchmarkRows,
      benchmarkLabel,
    });
    return row ? [row] : [];
  });
  return [portfolioMetric, ...assetMetrics].filter(Boolean);
}
