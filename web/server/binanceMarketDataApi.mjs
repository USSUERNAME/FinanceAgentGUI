import { sendJson } from "./codexProbe.mjs";

const BINANCE_MARKET_DATA_BASE_URL = String(
  process.env.BINANCE_MARKET_DATA_BASE_URL || "https://data-api.binance.vision"
).replace(/\/+$/, "");
const BINANCE_USDM_MARKET_DATA_BASE_URL = String(
  process.env.BINANCE_USDM_MARKET_DATA_BASE_URL || "https://fapi.binance.com"
).replace(/\/+$/, "");
const BINANCE_PRODUCT_METADATA_BASE_URL = String(
  process.env.BINANCE_PRODUCT_METADATA_BASE_URL || "https://www.binance.com"
).replace(/\/+$/, "");
const BINANCE_SOURCE = "Binance Spot public market data";
const BINANCE_USDM_SOURCE = "Binance USDⓈ-M Futures public market data";
const BINANCE_PROVIDER = "binance";
const BINANCE_VENUE = "BINANCE_SPOT";
const BINANCE_USDM_VENUE = "BINANCE_USDM_FUTURES";
// TRADING status gates simulator orders, so keep the catalog fresh enough to
// notice halts without polling Binance on every local UI refresh.
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const PRODUCT_METADATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 1000;
const CANDLE_CACHE_TTL_MS = 5000;
const FETCH_TIMEOUT_MS = 12000;
const DEFAULT_CATALOG_LOAD_TIMEOUT_MS = FETCH_TIMEOUT_MS + 2000;
const MAX_EXECUTION_QUOTE_AGE_MS = 60 * 1000;
const MAX_BATCH_INSTRUMENTS = 100;
const MAX_TICKER_BATCH_SIZE = 20;
const BINANCE_DIRECT_INTERVALS = new Set([
  "1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
]);
const INTERVAL_ALIASES = Object.freeze({
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "10": "10m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  day: "1d",
  daily: "1d",
  week: "1w",
  weekly: "1w",
});

let upstreamFetch = (...args) => fetch(...args);
let catalogCache = {
  fetchedAt: 0,
  instruments: [],
  promise: null,
  promiseStartedAt: 0,
};
let catalogLoadTimeoutMs = DEFAULT_CATALOG_LOAD_TIMEOUT_MS;
let productMetadataCache = {
  fetchedAt: 0,
  bySymbol: new Map(),
  promise: null,
};
const quoteCache = new Map();
const candleCache = new Map();
let providerRuntime = {
  lastAttemptAt: "",
  lastSuccessfulAt: "",
  lastError: null,
  usedWeight1m: null,
  retryUntilMs: 0,
};

class BinanceMarketDataError extends Error {
  constructor(code, message, { statusCode = 502, retryable = true, details = null } = {}) {
    super(message);
    this.name = "BinanceMarketDataError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
  }
}

function cleanText(value, limit = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanLimit(value, fallback = 12, max = 1000) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Math.max(1, Math.min(Number.isFinite(numeric) ? Math.trunc(numeric) : fallback, max));
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanBinanceSymbol(value) {
  return cleanText(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 30);
}

function cleanMarketType(value) {
  return cleanText(value, 20).toLowerCase() === "usdm" ? "usdm" : "spot";
}

function instrumentIdForSymbol(symbol, marketType = "spot") {
  return `${BINANCE_PROVIDER}:${cleanMarketType(marketType)}:${cleanBinanceSymbol(symbol)}`;
}

function instrumentPartsFromId(value) {
  const match = cleanText(value, 80).match(/^binance:(spot|usdm):([A-Z0-9]{5,30})$/i);
  return match ? { marketType: cleanMarketType(match[1]), symbol: cleanBinanceSymbol(match[2]) } : null;
}

function symbolFromInstrumentId(value) {
  return instrumentPartsFromId(value)?.symbol || "";
}

function normalizeSearchQuery(value) {
  return cleanText(value, 80).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeProductMetadata(payload = {}) {
  const bySymbol = new Map();
  for (const row of Array.isArray(payload?.data) ? payload.data : []) {
    const symbol = cleanBinanceSymbol(row?.s || row?.symbol);
    if (!symbol) continue;
    const assetName = cleanText(row?.an || row?.assetName, 180);
    const quoteAssetName = cleanText(row?.qn || row?.quoteAssetName, 180);
    const tags = (Array.isArray(row?.tags) ? row.tags : [])
      .map((value) => cleanText(value, 80))
      .filter(Boolean);
    bySymbol.set(symbol, {
      symbol,
      baseAsset: cleanBinanceSymbol(row?.b || row?.baseAsset),
      quoteAsset: cleanBinanceSymbol(row?.q || row?.quoteAsset),
      assetName,
      quoteAssetName,
      tags,
    });
  }
  return bySymbol;
}

function displayAssetName(metadata = {}, fallback = "") {
  const assetName = cleanText(metadata?.assetName, 180);
  if (!assetName) return cleanText(fallback, 180);
  const isBstock = (Array.isArray(metadata?.tags) ? metadata.tags : [])
    .some((tag) => cleanText(tag, 80).toLowerCase() === "bstocks");
  if (!isBstock) return assetName;
  const companyName = assetName.replace(/\s*\(\s*bStocks\s*\)\s*$/i, "").trim();
  if (!companyName || /tokenized\s+bstocks/i.test(assetName)) return assetName;
  return `${companyName} Tokenized bStocks`;
}

function normalizeFilter(filter = {}) {
  const filterType = cleanText(filter.filterType, 40).toUpperCase();
  if (!filterType) return null;
  const normalized = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === "filterType") continue;
    normalized[key] = value;
  }
  return { filterType, ...normalized };
}

function normalizedFilters(filters = []) {
  const byType = {};
  for (const rawFilter of Array.isArray(filters) ? filters : []) {
    const filter = normalizeFilter(rawFilter);
    if (!filter) continue;
    const { filterType, ...values } = filter;
    byType[filterType] = values;
  }
  return byType;
}

function normalizeInstrument(row = {}, productMetadata = null, options = {}) {
  const marketType = cleanMarketType(options.marketType);
  const isUsdm = marketType === "usdm";
  const symbol = cleanBinanceSymbol(row.symbol);
  const baseAsset = cleanBinanceSymbol(row.baseAsset);
  const quoteAsset = cleanBinanceSymbol(row.quoteAsset);
  const status = cleanText(row.status, 30).toUpperCase();
  if (!symbol || !baseAsset || quoteAsset !== "USDT" || status !== "TRADING") return null;
  if (!isUsdm && row.isSpotTradingAllowed === false) return null;
  const contractType = cleanText(row.contractType, 40).toUpperCase();
  if (isUsdm && !contractType) return null;
  const displaySymbol = `${baseAsset}/${quoteAsset}`;
  const metadata = productMetadata && typeof productMetadata === "object" ? productMetadata : {};
  const assetName = cleanText(metadata.assetName, 180);
  const name = displayAssetName(metadata, displaySymbol);
  const underlyingType = cleanText(row.underlyingType, 40).toUpperCase();
  const underlyingSubType = (Array.isArray(row.underlyingSubType) ? row.underlyingSubType : [])
    .map((value) => cleanText(value, 80))
    .filter(Boolean);
  const venue = isUsdm ? BINANCE_USDM_VENUE : BINANCE_VENUE;
  const source = isUsdm ? BINANCE_USDM_SOURCE : BINANCE_SOURCE;
  const assetClass = underlyingType === "COMMODITY"
    ? "commodity"
    : underlyingType === "EQUITY"
      ? "equity"
      : underlyingType === "INDEX"
        ? "index"
        : "crypto";
  return {
    instrumentId: instrumentIdForSymbol(symbol, marketType),
    provider: BINANCE_PROVIDER,
    venue,
    marketType,
    assetClass,
    symbol,
    displaySymbol,
    baseAsset,
    quoteAsset,
    settlementAsset: "USD",
    status,
    sessionPolicy: "24x7",
    market: venue,
    name,
    englishName: name,
    assetName,
    quoteAssetName: cleanText(metadata.quoteAssetName, 180),
    tags: (Array.isArray(metadata.tags) ? metadata.tags : []).map((value) => cleanText(value, 80)).filter(Boolean),
    source,
    currency: "USD",
    nativeQuoteAsset: quoteAsset,
    orderTypes: Array.isArray(row.orderTypes) ? row.orderTypes.map((value) => cleanText(value, 30)).filter(Boolean) : [],
    filters: normalizedFilters(row.filters),
    contractType,
    underlyingType,
    underlyingSubType,
    onboardDate: finiteNumber(row.onboardDate),
    deliveryDate: finiteNumber(row.deliveryDate),
  };
}

function normalizeExchangeInfo(payload = {}, productMetadataBySymbol = new Map(), options = {}) {
  const instruments = [];
  const seen = new Set();
  for (const row of Array.isArray(payload.symbols) ? payload.symbols : []) {
    const symbol = cleanBinanceSymbol(row?.symbol);
    const instrument = normalizeInstrument(row, productMetadataBySymbol.get(symbol), options);
    if (!instrument || seen.has(instrument.instrumentId)) continue;
    seen.add(instrument.instrumentId);
    instruments.push(instrument);
  }
  return instruments.sort((left, right) => left.symbol.localeCompare(right.symbol));
}

async function fetchProductMetadata() {
  const url = new URL(`${BINANCE_PRODUCT_METADATA_BASE_URL}/bapi/asset/v2/public/asset-service/product/get-products`);
  url.searchParams.set("includeEtf", "true");
  let response;
  try {
    response = await upstreamFetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "FinanceAgentGUI Binance product metadata",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BinanceMarketDataError(
      error?.name === "TimeoutError" ? "BINANCE_METADATA_TIMEOUT" : "BINANCE_METADATA_NETWORK_ERROR",
      "Binance 표시 이름 메타데이터를 불러오지 못했습니다.",
      { details: { cause: cleanText(error?.message, 240) || null } }
    );
  }
  const payload = await parseResponseBody(response);
  if (!response.ok || payload?.success === false) {
    throw new BinanceMarketDataError(
      "BINANCE_METADATA_UPSTREAM_ERROR",
      cleanText(payload?.message, 300) || `Binance 표시 이름 메타데이터 오류 (HTTP ${response.status})`,
      { details: { upstreamStatus: response.status, upstreamCode: payload?.code ?? null } }
    );
  }
  return normalizeProductMetadata(payload);
}

async function loadProductMetadata() {
  const now = Date.now();
  if (productMetadataCache.bySymbol.size && now - productMetadataCache.fetchedAt < PRODUCT_METADATA_CACHE_TTL_MS) {
    return productMetadataCache.bySymbol;
  }
  if (!productMetadataCache.promise) {
    productMetadataCache.promise = fetchProductMetadata()
      .then((bySymbol) => {
        productMetadataCache = { fetchedAt: Date.now(), bySymbol, promise: null };
        return bySymbol;
      })
      .catch((error) => {
        productMetadataCache.promise = null;
        if (productMetadataCache.bySymbol.size) return productMetadataCache.bySymbol;
        throw error;
      });
  }
  return productMetadataCache.promise;
}

function publicUpstreamError(error) {
  return {
    code: cleanText(error?.code || "BINANCE_UPSTREAM_ERROR", 80),
    message: cleanText(error?.message || "Binance 공개 시세를 불러오지 못했습니다.", 400),
    retryable: error?.retryable !== false,
    details: error?.details || null,
    at: new Date().toISOString(),
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BinanceMarketDataError("BINANCE_INVALID_RESPONSE", "Binance 응답이 JSON 형식이 아닙니다.", {
      details: { status: response.status },
    });
  }
}

async function fetchBinanceJson(pathname, searchParams = {}, options = {}) {
  const now = Date.now();
  if (providerRuntime.retryUntilMs > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((providerRuntime.retryUntilMs - now) / 1000));
    throw new BinanceMarketDataError(
      "BINANCE_RATE_LIMITED",
      "Binance 공개 시세 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
      {
        statusCode: 503,
        details: {
          retryAfterSeconds,
          retryUntil: new Date(providerRuntime.retryUntilMs).toISOString(),
          usedWeight1m: providerRuntime.usedWeight1m,
        },
      }
    );
  }
  const baseUrl = options.marketType === "usdm"
    ? BINANCE_USDM_MARKET_DATA_BASE_URL
    : BINANCE_MARKET_DATA_BASE_URL;
  const url = new URL(`${baseUrl}${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  providerRuntime.lastAttemptAt = new Date().toISOString();
  let response;
  try {
    response = await upstreamFetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "FinanceAgentGUI Binance public market data",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const wrapped = new BinanceMarketDataError(
      error?.name === "TimeoutError" ? "BINANCE_TIMEOUT" : "BINANCE_NETWORK_ERROR",
      error?.name === "TimeoutError"
        ? "Binance 공개 시세 응답 시간이 초과됐습니다."
        : "Binance 공개 시세 연결에 실패했습니다.",
      { details: { cause: cleanText(error?.message, 240) || null } }
    );
    providerRuntime.lastError = publicUpstreamError(wrapped);
    throw wrapped;
  }

  const usedWeight1m = finiteNumber(response.headers?.get?.("x-mbx-used-weight-1m"));
  if (usedWeight1m !== null) providerRuntime.usedWeight1m = usedWeight1m;
  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const retryAfterSeconds = finiteNumber(response.headers?.get?.("retry-after"));
    const isRateLimited = response.status === 418 || response.status === 429;
    if (isRateLimited) {
      const cooldownSeconds = Math.max(1, retryAfterSeconds ?? (response.status === 418 ? 60 : 1));
      providerRuntime.retryUntilMs = Math.max(
        providerRuntime.retryUntilMs,
        Date.now() + cooldownSeconds * 1000
      );
    }
    const wrapped = new BinanceMarketDataError(
      isRateLimited ? "BINANCE_RATE_LIMITED" : "BINANCE_UPSTREAM_ERROR",
      isRateLimited
        ? "Binance 공개 시세 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
        : cleanText(payload?.msg, 300) || `Binance 공개 시세 오류 (HTTP ${response.status})`,
      {
        statusCode: isRateLimited ? 503 : 502,
        details: {
          upstreamStatus: response.status,
          upstreamCode: payload?.code ?? null,
          retryAfterSeconds,
          usedWeight1m: providerRuntime.usedWeight1m,
        },
      }
    );
    providerRuntime.lastError = publicUpstreamError(wrapped);
    throw wrapped;
  }
  providerRuntime.lastSuccessfulAt = new Date().toISOString();
  providerRuntime.lastError = null;
  providerRuntime.retryUntilMs = 0;
  return payload;
}

function catalogLoadTimeoutError() {
  return new BinanceMarketDataError(
    "BINANCE_CATALOG_TIMEOUT",
    "Binance 상품 목록 응답이 지연되어 연결을 초기화했습니다. 다시 시도해 주세요.",
    {
      statusCode: 503,
      details: { timeoutMs: catalogLoadTimeoutMs },
    }
  );
}

function waitForCatalogPromise(promise) {
  let timeoutId = null;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(catalogLoadTimeoutError()), catalogLoadTimeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function loadInstrumentCatalog({ force = false } = {}) {
  const now = Date.now();
  if (!force && catalogCache.instruments.length && now - catalogCache.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return { instruments: catalogCache.instruments, fetchedAt: catalogCache.fetchedAt, stale: false };
  }
  if (
    catalogCache.promise &&
    catalogCache.promiseStartedAt > 0 &&
    now - catalogCache.promiseStartedAt >= catalogLoadTimeoutMs
  ) {
    catalogCache.promise = null;
    catalogCache.promiseStartedAt = 0;
  }
  if (!catalogCache.promise) {
    let pendingCatalogPromise = null;
    pendingCatalogPromise = Promise.all([
      fetchBinanceJson("/api/v3/exchangeInfo"),
      fetchBinanceJson("/fapi/v1/exchangeInfo", {}, { marketType: "usdm" }).catch(() => ({ symbols: [] })),
      loadProductMetadata().catch(() => new Map()),
    ])
      .then(([spotPayload, usdmPayload, productMetadataBySymbol]) => {
        const instruments = [
          ...normalizeExchangeInfo(spotPayload, productMetadataBySymbol, { marketType: "spot" }),
          ...normalizeExchangeInfo(usdmPayload, new Map(), { marketType: "usdm" }),
        ];
        if (!instruments.length) {
          throw new BinanceMarketDataError(
            "BINANCE_EMPTY_CATALOG",
            "Binance TRADING USDT 상품 목록이 비어 있습니다."
          );
        }
        const fetchedAt = Date.now();
        if (catalogCache.promise === pendingCatalogPromise) {
          catalogCache = { fetchedAt, instruments, promise: null, promiseStartedAt: 0 };
        }
        return { instruments, fetchedAt, stale: false };
      })
      .catch((error) => {
        if (catalogCache.promise === pendingCatalogPromise) {
          catalogCache.promise = null;
          catalogCache.promiseStartedAt = 0;
        }
        throw error;
      });
    catalogCache.promise = pendingCatalogPromise;
    catalogCache.promiseStartedAt = now;
  }
  const pendingCatalogPromise = catalogCache.promise;
  try {
    return await waitForCatalogPromise(pendingCatalogPromise);
  } catch (error) {
    if (catalogCache.promise === pendingCatalogPromise) {
      catalogCache.promise = null;
      catalogCache.promiseStartedAt = 0;
    }
    if (catalogCache.instruments.length) {
      return { instruments: catalogCache.instruments, fetchedAt: catalogCache.fetchedAt, stale: true, warning: error.message };
    }
    throw error;
  }
}

function scoreInstrument(instrument, query) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return 100;
  const symbol = normalizeSearchQuery(instrument.symbol);
  const display = normalizeSearchQuery(instrument.displaySymbol);
  const baseAsset = normalizeSearchQuery(instrument.baseAsset);
  const names = [instrument.name, instrument.englishName, instrument.assetName, ...(instrument.tags || [])]
    .map(normalizeSearchQuery)
    .filter(Boolean);
  if (symbol === normalized || display === normalized) return 0;
  if (baseAsset === normalized) return 1;
  if (symbol.startsWith(normalized) || display.startsWith(normalized)) return 2;
  if (baseAsset.startsWith(normalized)) return 3;
  if (names.some((name) => name === normalized)) return 4;
  if (names.some((name) => name.startsWith(normalized))) return 5;
  if (symbol.includes(normalized) || display.includes(normalized)) return 6;
  if (names.some((name) => name.includes(normalized))) return 7;
  return 100;
}

function searchInstruments(instruments, query, limit = 12) {
  if (!normalizeSearchQuery(query)) return [];
  return instruments
    .map((instrument, index) => ({ instrument, index, score: scoreInstrument(instrument, query) }))
    .filter((entry) => entry.score < 100)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, cleanLimit(limit, 12, 30))
    .map((entry) => entry.instrument);
}

async function resolveInstruments(instrumentIds) {
  const ids = [...new Set((Array.isArray(instrumentIds) ? instrumentIds : [])
    .map((value) => cleanText(value, 80))
    .filter(Boolean))];
  if (!ids.length) {
    throw new BinanceMarketDataError("INVALID_INSTRUMENT_IDS", "instrumentIds를 하나 이상 입력해 주세요.", {
      statusCode: 400,
      retryable: false,
    });
  }
  if (ids.length > MAX_BATCH_INSTRUMENTS) {
    throw new BinanceMarketDataError(
      "TOO_MANY_INSTRUMENT_IDS",
      `instrumentIds는 한 번에 ${MAX_BATCH_INSTRUMENTS}개까지 요청할 수 있습니다.`,
      { statusCode: 400, retryable: false }
    );
  }
  const malformed = ids.find((id) => !symbolFromInstrumentId(id));
  if (malformed) {
    throw new BinanceMarketDataError("INVALID_INSTRUMENT_ID", `잘못된 Binance instrumentId입니다: ${malformed}`, {
      statusCode: 400,
      retryable: false,
    });
  }
  const catalog = await loadInstrumentCatalog();
  const byId = new Map(catalog.instruments.map((instrument) => [instrument.instrumentId, instrument]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new BinanceMarketDataError("INSTRUMENT_NOT_FOUND", `TRADING USDT 상품이 아닙니다: ${missing[0]}`, {
      statusCode: 404,
      retryable: false,
    });
  }
  return { instruments: ids.map((id) => byId.get(id)), catalog };
}

function normalizeTicker(row = {}, instrument = null) {
  const symbol = cleanBinanceSymbol(row.symbol || instrument?.symbol);
  const timestampMs = finiteNumber(row.closeTime);
  return {
    instrumentId: instrument?.instrumentId || instrumentIdForSymbol(symbol),
    provider: BINANCE_PROVIDER,
    venue: instrument?.venue || BINANCE_VENUE,
    marketType: instrument?.marketType || "spot",
    assetClass: instrument?.assetClass || "crypto",
    symbol,
    displaySymbol: instrument?.displaySymbol || symbol,
    baseAsset: instrument?.baseAsset || "",
    quoteAsset: instrument?.quoteAsset || "USDT",
    name: instrument?.name || instrument?.displaySymbol || symbol,
    englishName: instrument?.englishName || instrument?.name || instrument?.displaySymbol || symbol,
    assetName: instrument?.assetName || "",
    quoteAssetName: instrument?.quoteAssetName || "",
    tags: Array.isArray(instrument?.tags) ? instrument.tags : [],
    contractType: instrument?.contractType || "",
    underlyingType: instrument?.underlyingType || "",
    underlyingSubType: Array.isArray(instrument?.underlyingSubType) ? instrument.underlyingSubType : [],
    lastPrice: finiteNumber(row.lastPrice),
    currency: "USD",
    nativeQuoteAsset: "USDT",
    priceChangePercent: finiteNumber(row.priceChangePercent),
    volume: finiteNumber(row.volume),
    quoteVolume: finiteNumber(row.quoteVolume),
    timestamp: timestampMs === null ? "" : new Date(timestampMs).toISOString(),
    timestampMs,
    source: instrument?.source || BINANCE_SOURCE,
  };
}

async function getQuotes(instruments) {
  const now = Date.now();
  const resultByInstrumentId = new Map();
  const missing = [];
  for (const instrument of instruments) {
    const cached = quoteCache.get(instrument.instrumentId);
    if (cached && now - cached.fetchedAt < QUOTE_CACHE_TTL_MS) {
      resultByInstrumentId.set(instrument.instrumentId, cached.quote);
    } else {
      missing.push(instrument);
    }
  }
  for (const marketType of ["spot", "usdm"]) {
    const marketMissing = missing.filter((instrument) => cleanMarketType(instrument.marketType) === marketType);
    for (let index = 0; index < marketMissing.length; index += MAX_TICKER_BATCH_SIZE) {
      const batch = marketMissing.slice(index, index + MAX_TICKER_BATCH_SIZE);
      const params = batch.length === 1
        ? { symbol: batch[0].symbol }
        : marketType === "usdm"
          ? {}
          : { symbols: JSON.stringify(batch.map((instrument) => instrument.symbol)) };
      const payload = await fetchBinanceJson(
        marketType === "usdm" ? "/fapi/v1/ticker/24hr" : "/api/v3/ticker/24hr",
        params,
        { marketType },
      );
      const rows = Array.isArray(payload) ? payload : [payload];
      const instrumentBySymbol = new Map(batch.map((instrument) => [instrument.symbol, instrument]));
      for (const row of rows) {
        const instrument = instrumentBySymbol.get(cleanBinanceSymbol(row?.symbol));
        if (!instrument) continue;
        const quote = normalizeTicker(row, instrument);
        if (!Number.isFinite(quote.lastPrice) || quote.lastPrice <= 0) {
          throw new BinanceMarketDataError(
            "BINANCE_INVALID_QUOTE",
            `Binance ${instrument.displaySymbol} 현재가가 유효하지 않습니다.`
          );
        }
        quoteCache.set(instrument.instrumentId, { fetchedAt: Date.now(), quote });
        resultByInstrumentId.set(instrument.instrumentId, quote);
      }
    }
  }
  const result = instruments.map((instrument) => resultByInstrumentId.get(instrument.instrumentId)).filter(Boolean);
  if (result.length !== instruments.length) {
    throw new BinanceMarketDataError("BINANCE_INCOMPLETE_QUOTES", "Binance 시세 응답에 요청한 상품 일부가 없습니다.");
  }
  return result;
}

export async function getBinanceExecutionQuote(instrumentId) {
  const { instruments, catalog } = await resolveInstruments([instrumentId]);
  if (catalog.stale) {
    throw new BinanceMarketDataError(
      "BINANCE_STALE_INSTRUMENT_STATUS",
      "Binance 거래 상태를 최신 정보로 확인하지 못해 주문을 막았습니다.",
      { statusCode: 503 }
    );
  }
  if (providerRuntime.retryUntilMs > Date.now() || providerRuntime.lastError) {
    throw new BinanceMarketDataError(
      "BINANCE_PROVIDER_DEGRADED",
      "Binance 시세 공급자가 불안정해 주문을 잠시 막았습니다.",
      { statusCode: 503, details: providerRuntime.lastError }
    );
  }
  const [quote] = await getQuotes(instruments);
  const executionPrice = finiteNumber(quote?.lastPrice);
  const timestampMs = finiteNumber(quote?.timestampMs);
  const ageMs = timestampMs === null ? Number.POSITIVE_INFINITY : Math.max(0, Date.now() - timestampMs);
  if (executionPrice === null || executionPrice <= 0) {
    throw new BinanceMarketDataError(
      "BINANCE_INVALID_EXECUTION_PRICE",
      "Binance 현재 체결가가 유효하지 않아 주문을 막았습니다.",
      { statusCode: 503 }
    );
  }
  if (!Number.isFinite(ageMs) || ageMs > MAX_EXECUTION_QUOTE_AGE_MS) {
    throw new BinanceMarketDataError(
      "BINANCE_STALE_EXECUTION_PRICE",
      "Binance 현재가가 오래되어 주문을 막았습니다.",
      {
        statusCode: 503,
        details: {
          timestamp: quote?.timestamp || null,
          ageMs: Number.isFinite(ageMs) ? ageMs : null,
          maxAgeMs: MAX_EXECUTION_QUOTE_AGE_MS,
        },
      }
    );
  }
  return {
    instrument: instruments[0],
    quote,
    executionPrice,
    executionPricePolicy: "LAST_PRICE",
    feeRate: 0,
    feePolicy: "NO_PUBLIC_ACCOUNT_FEE_RATE_ASSUME_ZERO",
    catalogFetchedAt: new Date(catalog.fetchedAt).toISOString(),
  };
}

function normalizeInterval(value) {
  const raw = cleanText(value || "1d", 20);
  const aliased = INTERVAL_ALIASES[raw.toLowerCase()] || raw;
  if (aliased === "10m" || BINANCE_DIRECT_INTERVALS.has(aliased)) return aliased;
  throw new BinanceMarketDataError("INVALID_CANDLE_INTERVAL", `지원하지 않는 봉 간격입니다: ${raw}`, {
    statusCode: 400,
    retryable: false,
  });
}

function parseBefore(value) {
  const clean = cleanText(value, 100);
  if (!clean) return null;
  const numeric = Number(clean);
  if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
  const parsed = Date.parse(clean);
  if (Number.isFinite(parsed)) return parsed;
  throw new BinanceMarketDataError("INVALID_CANDLE_BEFORE", "before는 Unix millisecond 또는 ISO 날짜여야 합니다.", {
    statusCode: 400,
    retryable: false,
  });
}

function normalizeCandle(row = []) {
  if (!Array.isArray(row) || row.length < 7) return null;
  const openTime = finiteNumber(row[0]);
  const closeTime = finiteNumber(row[6]);
  const open = finiteNumber(row[1]);
  const high = finiteNumber(row[2]);
  const low = finiteNumber(row[3]);
  const close = finiteNumber(row[4]);
  const baseVolume = finiteNumber(row[5]);
  if ([openTime, closeTime, open, high, low, close, baseVolume].some((value) => value === null)) return null;
  const timestamp = new Date(openTime).toISOString();
  const quoteVolume = finiteNumber(row[7]) ?? close * baseVolume;
  return {
    openTime,
    closeTime,
    timestamp,
    dateTime: timestamp,
    date: timestamp.slice(0, 10),
    time: timestamp,
    open,
    high,
    low,
    close,
    volume: baseVolume,
    baseVolume,
    quoteVolume,
    turnover: quoteVolume,
    tradeCount: finiteNumber(row[8]) ?? 0,
    closed: closeTime < Date.now(),
    currency: "USD",
    nativeQuoteAsset: "USDT",
  };
}

function aggregateTenMinuteCandles(candles) {
  const groups = new Map();
  const intervalMs = 10 * 60 * 1000;
  for (const candle of candles) {
    const bucket = Math.floor(candle.openTime / intervalMs) * intervalMs;
    const current = groups.get(bucket);
    if (!current) {
      groups.set(bucket, { ...candle, openTime: bucket, timestamp: new Date(bucket).toISOString() });
      continue;
    }
    current.closeTime = Math.max(current.closeTime, candle.closeTime);
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
    current.baseVolume += candle.baseVolume;
    current.quoteVolume += candle.quoteVolume;
    current.turnover += candle.turnover;
    current.tradeCount += candle.tradeCount;
    current.closed = current.closed && candle.closed;
  }
  return [...groups.values()]
    .map((candle) => ({
      ...candle,
      dateTime: candle.timestamp,
      date: candle.timestamp.slice(0, 10),
      time: candle.timestamp,
    }))
    .sort((left, right) => left.openTime - right.openTime);
}

async function getCandles(instrument, { interval = "1d", limit = 300, before = null } = {}) {
  const normalizedInterval = normalizeInterval(interval);
  const cleanCount = cleanLimit(limit, 300, normalizedInterval === "10m" ? 500 : 1000);
  const beforeMs = parseBefore(before);
  const cacheKey = `${instrument.instrumentId}:${normalizedInterval}:${cleanCount}:${beforeMs || "latest"}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) return cached.payload;
  const upstreamInterval = normalizedInterval === "10m" ? "5m" : normalizedInterval;
  const upstreamLimit = normalizedInterval === "10m" ? Math.min(1000, cleanCount * 2) : cleanCount;
  const marketType = cleanMarketType(instrument.marketType);
  const payload = await fetchBinanceJson(marketType === "usdm" ? "/fapi/v1/klines" : "/api/v3/klines", {
    symbol: instrument.symbol,
    interval: upstreamInterval,
    limit: upstreamLimit,
    endTime: beforeMs,
  }, { marketType });
  let candles = (Array.isArray(payload) ? payload : []).map(normalizeCandle).filter(Boolean);
  if (normalizedInterval === "10m") candles = aggregateTenMinuteCandles(candles).slice(-cleanCount);
  const nextBefore = candles.length ? new Date(Math.max(0, candles[0].openTime - 1)).toISOString() : "";
  const normalized = {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    interval: normalizedInterval,
    candles,
    nextBefore,
    hasMore: candles.length > 0,
    currency: "USD",
    nativeQuoteAsset: "USDT",
  };
  candleCache.set(cacheKey, { fetchedAt: Date.now(), payload: normalized });
  return normalized;
}

function responseSourceForInstruments(instruments = []) {
  const sources = [...new Set(
    (Array.isArray(instruments) ? instruments : [instruments])
      .map((instrument) => cleanText(instrument?.source, 120))
      .filter(Boolean)
  )];
  return sources.length === 1 ? sources[0] : "Binance public market data";
}

function responseMeta(fetchedAt = Date.now(), source = BINANCE_SOURCE) {
  return {
    source: cleanText(source, 120) || BINANCE_SOURCE,
    fetchedAt: new Date(fetchedAt || Date.now()).toISOString(),
  };
}

function providerStatusResult({ catalog = null, error = null } = {}) {
  const runtimeError = error || providerRuntime.lastError;
  const unavailable = Boolean(error) && !(catalog?.instruments?.length || catalogCache.instruments.length);
  const degraded = !unavailable && (Boolean(catalog?.stale) || Boolean(runtimeError));
  return {
    provider: BINANCE_PROVIDER,
    venue: BINANCE_VENUE,
    status: unavailable ? "unavailable" : degraded ? "degraded" : "ready",
    available: !unavailable,
    authenticated: false,
    requiresApiKey: false,
    marketDataOnly: true,
    quoteCurrencyPolicy: "USDT_AS_USD",
    executionPricePolicy: "LAST_PRICE",
    feeRate: 0,
    feePolicy: "NO_PUBLIC_ACCOUNT_FEE_RATE_ASSUME_ZERO",
    instrumentCount: catalog?.instruments?.length || catalogCache.instruments.length,
    catalogFetchedAt: catalog?.fetchedAt ? new Date(catalog.fetchedAt).toISOString() : null,
    lastAttemptAt: providerRuntime.lastAttemptAt || null,
    lastSuccessfulAt: providerRuntime.lastSuccessfulAt || null,
    usedWeight1m: providerRuntime.usedWeight1m,
    retryUntil: providerRuntime.retryUntilMs > Date.now()
      ? new Date(providerRuntime.retryUntilMs).toISOString()
      : null,
    error: error ? publicUpstreamError(error) : runtimeError,
  };
}

function errorResponse(error) {
  const normalized = error instanceof BinanceMarketDataError
    ? error
    : new BinanceMarketDataError("BINANCE_MARKET_DATA_ERROR", error?.message || "Binance 시세 처리에 실패했습니다.");
  return {
    body: {
      ok: false,
      error: normalized.message,
      code: normalized.code,
      provider: BINANCE_PROVIDER,
      retryable: normalized.retryable,
      details: normalized.details,
      ...responseMeta(),
    },
    statusCode: normalized.statusCode,
  };
}

function assertGet(req) {
  if (req.method !== "GET") {
    throw new BinanceMarketDataError("METHOD_NOT_ALLOWED", "method not allowed", {
      statusCode: 405,
      retryable: false,
    });
  }
}

function requestUrl(req) {
  return new URL(req.url || "/", "http://127.0.0.1");
}

export async function handleBinanceMarketDataEndpoint(kind, req, res) {
  try {
    assertGet(req);
    const url = requestUrl(req);
    const provider = cleanText(url.searchParams.get("provider"), 30).toLowerCase();
    if (provider && provider !== BINANCE_PROVIDER) {
      throw new BinanceMarketDataError("UNSUPPORTED_PROVIDER", `지원하지 않는 provider입니다: ${provider}`, {
        statusCode: 400,
        retryable: false,
      });
    }

    if (kind === "instrument-search") {
      const query = cleanText(url.searchParams.get("query") || url.searchParams.get("q"), 80);
      const catalog = await loadInstrumentCatalog();
      sendJson(res, {
        ok: true,
        result: searchInstruments(catalog.instruments, query, url.searchParams.get("limit")),
        warning: catalog.warning || null,
        stale: catalog.stale,
        ...responseMeta(catalog.fetchedAt),
      });
      return;
    }

    if (kind === "instrument") {
      const instrumentIds = cleanText(url.searchParams.get("instrumentIds"), 8000)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const singleInstrumentId = cleanText(url.searchParams.get("instrumentId"), 80);
      const requestedIds = instrumentIds.length ? instrumentIds : [singleInstrumentId];
      const { instruments, catalog } = await resolveInstruments(requestedIds);
      sendJson(res, {
        ok: true,
        result: instrumentIds.length ? instruments : instruments[0],
        stale: catalog.stale,
        ...responseMeta(catalog.fetchedAt, responseSourceForInstruments(instruments)),
      });
      return;
    }

    if (kind === "quotes") {
      const instrumentIds = cleanText(url.searchParams.get("instrumentIds"), 8000).split(",");
      const { instruments } = await resolveInstruments(instrumentIds);
      const result = await getQuotes(instruments);
      sendJson(res, { ok: true, result, ...responseMeta(undefined, responseSourceForInstruments(instruments)) });
      return;
    }

    if (kind === "candles") {
      const instrumentId = cleanText(url.searchParams.get("instrumentId"), 80);
      const { instruments } = await resolveInstruments([instrumentId]);
      const result = await getCandles(instruments[0], {
        interval: url.searchParams.get("interval") || "1d",
        limit: url.searchParams.get("limit"),
        before: url.searchParams.get("before"),
      });
      sendJson(res, { ok: true, result, ...result, ...responseMeta(undefined, instruments[0].source) });
      return;
    }

    if (kind === "execution-price") {
      const instrumentId = cleanText(url.searchParams.get("instrumentId"), 80);
      const execution = await getBinanceExecutionQuote(instrumentId);
      sendJson(res, {
        ok: true,
        result: {
          ...execution.instrument,
          ...execution.quote,
          price: execution.executionPrice,
          executionPrice: execution.executionPrice,
          executionPricePolicy: execution.executionPricePolicy,
          feeRate: execution.feeRate,
          feePolicy: execution.feePolicy,
          catalogFetchedAt: execution.catalogFetchedAt,
        },
        ...responseMeta(undefined, execution.instrument.source),
      });
      return;
    }

    if (kind === "provider-status") {
      try {
        const catalog = await loadInstrumentCatalog();
        sendJson(res, { ok: true, result: providerStatusResult({ catalog }), ...responseMeta(catalog.fetchedAt) });
      } catch (error) {
        sendJson(res, { ok: true, result: providerStatusResult({ error }), ...responseMeta() });
      }
      return;
    }

    throw new BinanceMarketDataError("UNKNOWN_ENDPOINT", "unknown Binance market-data endpoint", {
      statusCode: 404,
      retryable: false,
    });
  } catch (error) {
    const failure = errorResponse(error);
    sendJson(res, failure.body, failure.statusCode);
  }
}

function resetCaches() {
  catalogCache = { fetchedAt: 0, instruments: [], promise: null, promiseStartedAt: 0 };
  productMetadataCache = { fetchedAt: 0, bySymbol: new Map(), promise: null };
  catalogLoadTimeoutMs = DEFAULT_CATALOG_LOAD_TIMEOUT_MS;
  quoteCache.clear();
  candleCache.clear();
  providerRuntime = {
    lastAttemptAt: "",
    lastSuccessfulAt: "",
    lastError: null,
    usedWeight1m: null,
    retryUntilMs: 0,
  };
}

export const __binanceMarketDataTestHooks = {
  aggregateTenMinuteCandles,
  errorResponse,
  instrumentIdForSymbol,
  normalizeCandle,
  normalizeExchangeInfo,
  normalizeInstrument,
  normalizeProductMetadata,
  normalizeInterval,
  normalizeTicker,
  resetCaches,
  searchInstruments,
  setFetchImplementation(implementation) {
    upstreamFetch = typeof implementation === "function" ? implementation : (...args) => fetch(...args);
  },
  setCatalogLoadTimeoutMs(value) {
    const numeric = Number(value);
    catalogLoadTimeoutMs = Number.isFinite(numeric) && numeric > 0
      ? Math.max(1, Math.trunc(numeric))
      : DEFAULT_CATALOG_LOAD_TIMEOUT_MS;
  },
};
