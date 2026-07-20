const REPORT_MARKET_PROXY_DEFINITIONS = Object.freeze([
  {
    instrumentId: "binance:usdm:QQQUSDT",
    symbol: "QQQUSDT",
    referenceAsset: "Invesco QQQ ETF / Nasdaq-100 risk proxy",
    officialReferenceTicker: "QQQ",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "closed_market_supplement",
  },
  {
    instrumentId: "binance:usdm:SPYUSDT",
    symbol: "SPYUSDT",
    referenceAsset: "SPDR S&P 500 ETF / S&P 500 risk proxy",
    officialReferenceTicker: "SPY",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "closed_market_supplement",
  },
  {
    instrumentId: "binance:usdm:EWYUSDT",
    symbol: "EWYUSDT",
    referenceAsset: "iShares MSCI South Korea ETF / South Korea equity proxy",
    officialReferenceTicker: "EWY",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "closed_market_supplement",
  },
  {
    instrumentId: "binance:usdm:EWJUSDT",
    symbol: "EWJUSDT",
    referenceAsset: "iShares MSCI Japan ETF / Japan equity proxy",
    officialReferenceTicker: "EWJ",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "closed_market_supplement",
  },
  {
    instrumentId: "binance:usdm:XAUUSDT",
    symbol: "XAUUSDT",
    referenceAsset: "gold",
    officialReferenceTicker: "GC=F",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "continuous_reference",
  },
  {
    instrumentId: "binance:usdm:XAGUSDT",
    symbol: "XAGUSDT",
    referenceAsset: "silver",
    officialReferenceTicker: "SI=F",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "continuous_reference",
  },
  {
    instrumentId: "binance:usdm:XPTUSDT",
    symbol: "XPTUSDT",
    referenceAsset: "platinum",
    officialReferenceTicker: "PL=F",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "continuous_reference",
  },
  {
    instrumentId: "binance:usdm:XPDUSDT",
    symbol: "XPDUSDT",
    referenceAsset: "palladium",
    officialReferenceTicker: "PA=F",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "continuous_reference",
  },
  {
    instrumentId: "binance:usdm:CLUSDT",
    symbol: "CLUSDT",
    referenceAsset: "WTI crude oil",
    officialReferenceTicker: "CL=F",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "continuous_reference",
  },
  {
    instrumentId: "binance:usdm:BZUSDT",
    symbol: "BZUSDT",
    referenceAsset: "Brent crude oil",
    officialReferenceTicker: "BZ=F",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "continuous_reference",
  },
  {
    instrumentId: "binance:usdm:NATGASUSDT",
    symbol: "NATGASUSDT",
    referenceAsset: "Henry Hub natural gas",
    officialReferenceTicker: "NG=F",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "continuous_reference",
  },
  {
    instrumentId: "binance:usdm:COPPERUSDT",
    symbol: "COPPERUSDT",
    referenceAsset: "copper",
    officialReferenceTicker: "HG=F",
    instrumentKind: "Binance USDⓈ-M TradFi perpetual",
    usagePolicy: "continuous_reference",
  },
  {
    instrumentId: "binance:spot:BTCUSDT",
    symbol: "BTCUSDT",
    referenceAsset: "Bitcoin spot",
    officialReferenceTicker: "BTC-USD",
    instrumentKind: "Binance spot",
    usagePolicy: "continuous_direct_reference",
  },
  {
    instrumentId: "binance:spot:ETHUSDT",
    symbol: "ETHUSDT",
    referenceAsset: "Ether spot",
    officialReferenceTicker: "ETH-USD",
    instrumentKind: "Binance spot",
    usagePolicy: "continuous_direct_reference",
  },
]);

export const REPORT_MARKET_PROXY_INSTRUMENT_IDS = Object.freeze(
  REPORT_MARKET_PROXY_DEFINITIONS.map((item) => item.instrumentId),
);

const definitionByInstrumentId = new Map(
  REPORT_MARKET_PROXY_DEFINITIONS.map((item) => [item.instrumentId, item]),
);

function cleanText(value, limit = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function quoteLiquidityStatus(quoteVolume24h, tradeCount24h) {
  if (quoteVolume24h === null || tradeCount24h === null) return "unknown";
  if (quoteVolume24h >= 10_000_000 && tradeCount24h >= 10_000) return "high";
  if (quoteVolume24h >= 1_000_000 && tradeCount24h >= 2_000) return "standard";
  return "thin";
}

function normalizeQuote(row = {}, nowMs = Date.now()) {
  const instrumentId = cleanText(row.instrumentId, 80);
  const definition = definitionByInstrumentId.get(instrumentId);
  const lastPrice = finiteNumber(row.lastPrice);
  const timestampMs = finiteNumber(row.timestampMs) ?? Date.parse(cleanText(row.timestamp, 80));
  if (!definition || lastPrice === null || lastPrice <= 0 || !Number.isFinite(timestampMs)) return null;
  const quoteAgeMs = Math.max(0, nowMs - timestampMs);
  const quoteVolume24h = finiteNumber(row.quoteVolume);
  const tradeCount24h = finiteNumber(row.tradeCount) ?? finiteNumber(row.count);
  return {
    instrumentId,
    symbol: definition.symbol,
    referenceAsset: definition.referenceAsset,
    officialReferenceTicker: definition.officialReferenceTicker,
    usagePolicy: definition.usagePolicy,
    instrumentKind: definition.instrumentKind,
    marketType: cleanText(row.marketType, 30) || (instrumentId.includes(":spot:") ? "spot" : "usdm"),
    contractType: cleanText(row.contractType, 60) || (instrumentId.includes(":spot:") ? "SPOT" : "TRADIFI_PERPETUAL"),
    lastPrice,
    nativeQuoteAsset: cleanText(row.nativeQuoteAsset, 20) || "USDT",
    priceChangePercent24h: finiteNumber(row.priceChangePercent),
    quoteVolume24h,
    tradeCount24h,
    liquidityStatus: quoteLiquidityStatus(quoteVolume24h, tradeCount24h),
    timestamp: new Date(timestampMs).toISOString(),
    quoteAgeMs,
    fresh: quoteAgeMs <= 5 * 60 * 1000,
    source: cleanText(row.source, 160) || "Binance USDⓈ-M Futures public market data",
  };
}

export function normalizeReportMarketProxyContext(payload = {}, { nowMs = Date.now() } = {}) {
  const rows = Array.isArray(payload?.result) ? payload.result : [];
  const quotes = rows
    .map((row) => normalizeQuote(row, nowMs))
    .filter(Boolean)
    .sort(
      (left, right) =>
        REPORT_MARKET_PROXY_INSTRUMENT_IDS.indexOf(left.instrumentId) -
        REPORT_MARKET_PROXY_INSTRUMENT_IDS.indexOf(right.instrumentId),
    );
  return {
    version: 1,
    available: quotes.length > 0,
    requestedInstrumentIds: [...REPORT_MARKET_PROXY_INSTRUMENT_IDS],
    fetchedAt: cleanText(payload?.fetchedAt, 80) || new Date(nowMs).toISOString(),
    source: cleanText(payload?.source, 160) || "Binance USDⓈ-M Futures public market data",
    quoteWindow: "rolling_24h",
    quotes,
  };
}

async function fetchQuotes(fetchImpl, instrumentIds, signal) {
  const params = new URLSearchParams({ instrumentIds: instrumentIds.join(",") });
  const response = await fetchImpl(`/api/market-data/quotes?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function loadReportMarketProxyContext({
  fetchImpl = fetch,
  signal,
  nowMs = Date.now(),
} = {}) {
  try {
    const payload = await fetchQuotes(fetchImpl, REPORT_MARKET_PROXY_INSTRUMENT_IDS, signal);
    return normalizeReportMarketProxyContext(payload, { nowMs });
  } catch (batchError) {
    if (batchError?.name === "AbortError") throw batchError;
    const settled = await Promise.allSettled(
      REPORT_MARKET_PROXY_INSTRUMENT_IDS.map((instrumentId) =>
        fetchQuotes(fetchImpl, [instrumentId], signal),
      ),
    );
    const rows = settled.flatMap((result) =>
      result.status === "fulfilled" && Array.isArray(result.value?.result)
        ? result.value.result
        : [],
    );
    const normalized = normalizeReportMarketProxyContext(
      {
        ok: rows.length > 0,
        result: rows,
        fetchedAt: new Date(nowMs).toISOString(),
      },
      { nowMs },
    );
    return {
      ...normalized,
      degraded: true,
      warning: cleanText(batchError?.message || "Binance 프록시 일괄 시세 요청 실패", 240),
    };
  }
}
