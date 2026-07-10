const MAX_CANDLE_PAGES = 6;

function cleanComparisonSymbol(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);
}

export function normalizePortfolioComparisonAssets(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 5).flatMap((row) => {
    const symbol = cleanComparisonSymbol(row?.symbol || row?.ticker || row);
    if (!symbol || seen.has(symbol)) return [];
    seen.add(symbol);
    return [{
      symbol,
      name: String(row?.name || row?.label || symbol).trim().slice(0, 180),
      englishName: String(row?.englishName || "").trim().slice(0, 180),
      market: String(row?.market || "").trim().slice(0, 60),
    }];
  });
}

export function normalizePortfolioAssetComparisonQuery(chartSpec = {}) {
  const query = chartSpec?.query && typeof chartSpec.query === "object" ? chartSpec.query : {};
  const currency = String(query.currency || chartSpec.currency || chartSpec.valueCurrency || "KRW").toUpperCase() === "USD"
    ? "USD"
    : "KRW";
  return {
    startDate: String(query.startDate || chartSpec.startDate || "").trim(),
    endDate: String(query.endDate || chartSpec.endDate || "").trim(),
    timeframe: String(query.timeframe || chartSpec.timeframe || "1d").trim() || "1d",
    currency,
    assets: normalizePortfolioComparisonAssets(query.comparisonAssets),
  };
}

function portfolioHistoryUrl(query) {
  const params = new URLSearchParams({
    timeframe: query.timeframe || "1d",
    currency: query.currency || "KRW",
  });
  if (query.startDate) params.set("startDate", query.startDate);
  if (query.endDate) params.set("endDate", query.endDate);
  return `/api/tossinvest/order-sync/investment-history?${params.toString()}`;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

function candleRowsFromPayload(payload = {}) {
  const source = Array.isArray(payload?.result?.candles)
    ? payload.result.candles
    : Array.isArray(payload?.candles)
      ? payload.candles
      : Array.isArray(payload?.result)
        ? payload.result
        : Array.isArray(payload)
          ? payload
          : [];
  return source.flatMap((row) => {
    const time = String(row?.date || row?.timestamp || row?.dateTime || row?.time || "").slice(0, 10);
    const value = Number(row?.closePrice ?? row?.close ?? row?.lastPrice ?? row?.price);
    return /^\d{4}-\d{2}-\d{2}$/.test(time) && Number.isFinite(value) && value > 0
      ? [{ time, value }]
      : [];
  });
}

function nextBeforeFromPayload(payload = {}, rows = []) {
  const nextBefore = String(payload?.result?.nextBefore || payload?.nextBefore || "").trim();
  if (nextBefore) return nextBefore;
  const earliest = rows[0]?.time || "";
  if (!earliest) return "";
  const previous = new Date(`${earliest}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return `${previous.toISOString().slice(0, 10)}T23:59:59+09:00`;
}

async function fetchComparisonCandles(asset, { startDate = "", endDate = "" } = {}, signal) {
  const byTime = new Map();
  let before = endDate ? `${endDate}T23:59:59+09:00` : "";
  for (let pageIndex = 0; pageIndex < MAX_CANDLE_PAGES; pageIndex += 1) {
    const params = new URLSearchParams({
      symbol: asset.symbol,
      interval: "1d",
      count: "200",
      adjusted: "true",
    });
    if (before) params.set("before", before);
    const body = await fetchJson(`/api/tossinvest/candles?${params.toString()}`, signal);
    const pageRows = candleRowsFromPayload(body).sort((left, right) => left.time.localeCompare(right.time));
    for (const row of pageRows) byTime.set(row.time, row);
    const earliest = pageRows[0]?.time || "";
    if (!pageRows.length || (startDate && earliest && earliest <= startDate)) break;
    const nextBefore = nextBeforeFromPayload(body, pageRows);
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;
  }
  return [...byTime.values()]
    .filter((row) => (!startDate || row.time >= startDate) && (!endDate || row.time <= endDate))
    .sort((left, right) => left.time.localeCompare(right.time));
}

function comparisonBucketKey(time, timeframe) {
  if (timeframe === "1mo") return time.slice(0, 7);
  if (!["1w", "1wk"].includes(timeframe)) return time;
  const date = new Date(`${time}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function samplePortfolioComparisonRows(rows = [], timeframe = "1d") {
  if (timeframe === "1d") return rows;
  const byBucket = new Map();
  for (const row of rows) byBucket.set(comparisonBucketKey(row.time, timeframe), row);
  return [...byBucket.values()].sort((left, right) => left.time.localeCompare(right.time));
}

export function indexedPortfolioAssetSeries(rows = []) {
  const cleanRows = rows
    .map((row) => ({ time: String(row?.time || "").slice(0, 10), value: Number(row?.value) }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.time) && Number.isFinite(row.value) && row.value > 0)
    .sort((left, right) => left.time.localeCompare(right.time));
  const baseValue = cleanRows[0]?.value;
  if (!baseValue) return [];
  return cleanRows.map((row) => ({ time: row.time, value: Number(((row.value / baseValue) * 100).toFixed(4)) }));
}

export async function loadPortfolioAssetComparisonData(query, signal, { betaBenchmark = null } = {}) {
  const history = await fetchJson(portfolioHistoryUrl(query), signal);
  const points = Array.isArray(history?.points) ? history.points : [];
  const effectiveStart = query.startDate || String(points[0]?.time || "").slice(0, 10);
  const effectiveEnd = query.endDate || String(history?.timelineEndDate || points.at(-1)?.time || "").slice(0, 10);
  const loadAsset = async (asset) => ({
    asset,
    rows: samplePortfolioComparisonRows(
      await fetchComparisonCandles(asset, { startDate: effectiveStart, endDate: effectiveEnd }, signal),
      query.timeframe
    ),
  });
  const [results, betaBenchmarkResult] = await Promise.all([
    Promise.allSettled(query.assets.map((asset) => loadAsset(asset))),
    betaBenchmark?.asset
      ? Promise.resolve(loadAsset(betaBenchmark.asset)).then(
          (value) => ({ status: "fulfilled", value }),
          (reason) => ({ status: "rejected", reason })
        )
      : Promise.resolve(null),
  ]);
  const assetSeries = results.flatMap((result) => (
    result.status === "fulfilled" && result.value.rows.length ? [result.value] : []
  ));
  const betaBenchmarkSeries = betaBenchmarkResult?.status === "fulfilled" && betaBenchmarkResult.value.rows.length
    ? betaBenchmarkResult.value
    : null;
  return {
    portfolioPayload: history,
    assetSeries,
    failedAssetCount: results.length - assetSeries.length,
    betaBenchmarkSeries,
    betaBenchmarkFailed: Boolean(betaBenchmark?.asset && !betaBenchmarkSeries),
  };
}
