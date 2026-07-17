import test from "node:test";
import assert from "node:assert/strict";

import {
  __binanceMarketDataTestHooks,
  handleBinanceMarketDataEndpoint,
} from "../server/binanceMarketDataApi.mjs";

const {
  aggregateTenMinuteCandles,
  normalizeCandle,
  normalizeExchangeInfo,
  normalizeProductMetadata,
  normalizeTicker,
  resetCaches,
  searchInstruments,
  setCatalogLoadTimeoutMs,
  setFetchImplementation,
} = __binanceMarketDataTestHooks;

const exchangeInfoFixture = {
  symbols: [
    {
      symbol: "BTCUSDT",
      status: "TRADING",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true,
      orderTypes: ["LIMIT", "MARKET"],
      filters: [
        { filterType: "PRICE_FILTER", minPrice: "0.01000000", tickSize: "0.01000000" },
        { filterType: "LOT_SIZE", minQty: "0.00001000", stepSize: "0.00001000" },
        { filterType: "MIN_NOTIONAL", minNotional: "5.00000000", applyToMarket: true },
      ],
    },
    {
      symbol: "ETHUSDT",
      status: "TRADING",
      baseAsset: "ETH",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true,
      orderTypes: ["LIMIT", "MARKET"],
      filters: [],
    },
    {
      symbol: "BTCFDUSD",
      status: "TRADING",
      baseAsset: "BTC",
      quoteAsset: "FDUSD",
      isSpotTradingAllowed: true,
      filters: [],
    },
    {
      symbol: "OLDUSDT",
      status: "BREAK",
      baseAsset: "OLD",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true,
      filters: [],
    },
  ],
};

const usdmExchangeInfoFixture = {
  symbols: [
    {
      symbol: "CLUSDT",
      pair: "CLUSDT",
      contractType: "TRADIFI_PERPETUAL",
      status: "TRADING",
      baseAsset: "CL",
      quoteAsset: "USDT",
      marginAsset: "USDT",
      underlyingType: "COMMODITY",
      underlyingSubType: ["TradFi"],
      orderTypes: ["LIMIT", "MARKET"],
      filters: [{ filterType: "PRICE_FILTER", minPrice: "0.01000", tickSize: "0.01000" }],
    },
  ],
};

const productMetadataFixture = {
  code: "000000",
  success: true,
  data: [
    {
      s: "MUBUSDT",
      b: "MUB",
      q: "USDT",
      an: "Micron Technology (bStocks)",
      qn: "TetherUS",
      tags: ["bStocks"],
    },
  ],
};

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeResponse() {
  let body = "";
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk = "") {
      body += String(chunk);
    },
    json() {
      return JSON.parse(body || "{}");
    },
  };
}

async function invoke(kind, url, method = "GET") {
  const res = fakeResponse();
  await handleBinanceMarketDataEndpoint(kind, { method, url }, res);
  return { statusCode: res.statusCode, body: res.json(), headers: res.headers };
}

test.afterEach(() => {
  setFetchImplementation(null);
  resetCaches();
});

test("exchangeInfo keeps only TRADING USDT Spot instruments with canonical provider metadata", () => {
  const instruments = normalizeExchangeInfo(exchangeInfoFixture);
  assert.deepEqual(instruments.map((instrument) => instrument.symbol), ["BTCUSDT", "ETHUSDT"]);
  assert.deepEqual(instruments[0], {
    instrumentId: "binance:spot:BTCUSDT",
    provider: "binance",
    venue: "BINANCE_SPOT",
    marketType: "spot",
    assetClass: "crypto",
    symbol: "BTCUSDT",
    displaySymbol: "BTC/USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    settlementAsset: "USD",
    status: "TRADING",
    sessionPolicy: "24x7",
    market: "BINANCE_SPOT",
    name: "BTC/USDT",
    englishName: "BTC/USDT",
    assetName: "",
    quoteAssetName: "",
    tags: [],
    source: "Binance Spot public market data",
    currency: "USD",
    nativeQuoteAsset: "USDT",
    orderTypes: ["LIMIT", "MARKET"],
    filters: {
      PRICE_FILTER: { minPrice: "0.01000000", tickSize: "0.01000000" },
      LOT_SIZE: { minQty: "0.00001000", stepSize: "0.00001000" },
      MIN_NOTIONAL: { minNotional: "5.00000000", applyToMarket: true },
    },
    contractType: "",
    underlyingType: "",
    underlyingSubType: [],
    onboardDate: null,
    deliveryDate: null,
  });
});

test("USDⓈ-M exchangeInfo preserves CLUSDT contract metadata for model-assisted naming", () => {
  const [instrument] = normalizeExchangeInfo(usdmExchangeInfoFixture, new Map(), { marketType: "usdm" });
  assert.equal(instrument.instrumentId, "binance:usdm:CLUSDT");
  assert.equal(instrument.venue, "BINANCE_USDM_FUTURES");
  assert.equal(instrument.assetClass, "commodity");
  assert.equal(instrument.contractType, "TRADIFI_PERPETUAL");
  assert.equal(instrument.underlyingType, "COMMODITY");
  assert.deepEqual(instrument.underlyingSubType, ["TradFi"]);
});

test("local autocomplete matches ticker, display pair, and base asset", () => {
  const instruments = normalizeExchangeInfo(exchangeInfoFixture);
  assert.equal(searchInstruments(instruments, "BTC/USDT", 12)[0].instrumentId, "binance:spot:BTCUSDT");
  assert.equal(searchInstruments(instruments, "eth", 12)[0].displaySymbol, "ETH/USDT");
  assert.deepEqual(searchInstruments(instruments, "FDUSD", 12), []);
});

test("Binance product metadata adds readable names and searches tokenized assets by company name", () => {
  const metadata = normalizeProductMetadata(productMetadataFixture);
  const instruments = normalizeExchangeInfo({
    symbols: [{
      symbol: "MUBUSDT",
      status: "TRADING",
      baseAsset: "MUB",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true,
      orderTypes: ["LIMIT", "MARKET"],
      filters: [],
    }],
  }, metadata);
  assert.equal(instruments[0].name, "Micron Technology Tokenized bStocks");
  assert.equal(instruments[0].assetName, "Micron Technology (bStocks)");
  assert.equal(instruments[0].quoteAssetName, "TetherUS");
  assert.deepEqual(instruments[0].tags, ["bStocks"]);
  assert.equal(searchInstruments(instruments, "Micron Technology", 12)[0].symbol, "MUBUSDT");
  assert.equal(searchInstruments(instruments, "tokenized", 12)[0].displaySymbol, "MUB/USDT");
});

test("ticker normalization exposes USDT as native quote while presenting USD", () => {
  const [instrument] = normalizeExchangeInfo(exchangeInfoFixture);
  const quote = normalizeTicker({
    symbol: "BTCUSDT",
    lastPrice: "123456.78",
    priceChangePercent: "1.25",
    volume: "42.5",
    quoteVolume: "5200000.75",
    closeTime: 1770000000000,
  }, instrument);
  assert.equal(quote.instrumentId, "binance:spot:BTCUSDT");
  assert.equal(quote.lastPrice, 123456.78);
  assert.equal(quote.currency, "USD");
  assert.equal(quote.nativeQuoteAsset, "USDT");
  assert.equal(quote.priceChangePercent, 1.25);
  assert.equal(quote.volume, 42.5);
  assert.equal(quote.quoteVolume, 5200000.75);
});

test("5 minute Binance klines aggregate into the UI's 10 minute interval", () => {
  const start = Date.UTC(2026, 6, 10, 0, 0, 0);
  const rows = [
    [start, "100", "110", "90", "105", "2", start + 5 * 60 * 1000 - 1, "205", 10],
    [start + 5 * 60 * 1000, "105", "115", "100", "112", "3", start + 10 * 60 * 1000 - 1, "330", 12],
  ].map(normalizeCandle);
  const [candle] = aggregateTenMinuteCandles(rows);
  assert.equal(candle.open, 100);
  assert.equal(candle.high, 115);
  assert.equal(candle.low, 90);
  assert.equal(candle.close, 112);
  assert.equal(candle.volume, 5);
  assert.equal(candle.quoteVolume, 535);
  assert.equal(candle.tradeCount, 22);
  assert.equal(candle.currency, "USD");
});

test("HTTP handlers expose search, quotes, candles, execution price, and provider status without an API key", async () => {
  const calls = [];
  setFetchImplementation(async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    calls.push({ pathname: url.pathname, search: url.search, headers: options.headers || {} });
    if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse({ symbols: [] });
    if (url.pathname.endsWith("/exchangeInfo")) {
      return jsonResponse(exchangeInfoFixture, { headers: { "x-mbx-used-weight-1m": "20" } });
    }
    if (url.pathname.endsWith("/get-products")) {
      return jsonResponse(productMetadataFixture);
    }
    if (url.pathname.endsWith("/ticker/24hr")) {
      return jsonResponse({
        symbol: "BTCUSDT",
        lastPrice: "100000.50",
        priceChangePercent: "2.50",
        volume: "500",
        quoteVolume: "50000250",
        closeTime: Date.now(),
      });
    }
    if (url.pathname.endsWith("/klines")) {
      const start = Date.UTC(2026, 6, 10, 0, 0, 0);
      return jsonResponse([
        [start, "99000", "101000", "98000", "100000.5", "12", start + 86400000 - 1, "1200006", 120],
      ]);
    }
    return jsonResponse({ msg: "not found" }, { status: 404 });
  });

  const search = await invoke("instrument-search", "/?query=BTC&provider=binance&limit=12");
  assert.equal(search.statusCode, 200);
  assert.equal(search.body.ok, true);
  assert.equal(search.body.result[0].instrumentId, "binance:spot:BTCUSDT");

  const quotes = await invoke("quotes", "/?instrumentIds=binance%3Aspot%3ABTCUSDT");
  assert.equal(quotes.body.result[0].lastPrice, 100000.5);
  assert.equal(quotes.body.result[0].nativeQuoteAsset, "USDT");

  const candles = await invoke("candles", "/?instrumentId=binance%3Aspot%3ABTCUSDT&interval=1d&limit=10");
  assert.equal(candles.body.result.candles[0].close, 100000.5);
  assert.equal(candles.body.candles[0].quoteVolume, 1200006);

  const execution = await invoke("execution-price", "/?instrumentId=binance%3Aspot%3ABTCUSDT");
  assert.equal(execution.body.result.executionPrice, 100000.5);
  assert.equal(execution.body.result.executionPricePolicy, "LAST_PRICE");
  assert.equal(execution.body.result.feeRate, 0);

  const status = await invoke("provider-status", "/?provider=binance");
  assert.equal(status.body.result.status, "ready");
  assert.equal(status.body.result.requiresApiKey, false);
  assert.equal(status.body.result.quoteCurrencyPolicy, "USDT_AS_USD");
  assert.equal(status.body.result.usedWeight1m, 20);

  assert.equal(calls.filter((call) => call.pathname === "/api/v3/exchangeInfo").length, 1);
  assert.equal(calls.filter((call) => call.pathname === "/fapi/v1/exchangeInfo").length, 1);
  assert.equal(calls.filter((call) => call.pathname.endsWith("/ticker/24hr")).length, 1);
  assert.equal(calls.filter((call) => call.pathname.endsWith("/klines")).length, 1);
  assert.equal(calls.some((call) => Object.keys(call.headers).some((key) => key.toLowerCase() === "x-mbx-apikey")), false);
});

test("CLUSDT search, quote, and candles use public USDⓈ-M routes without an API key", async () => {
  const calls = [];
  setFetchImplementation(async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    calls.push({ pathname: url.pathname, headers: options.headers || {} });
    if (url.pathname === "/api/v3/exchangeInfo") return jsonResponse({ symbols: [] });
    if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse(usdmExchangeInfoFixture);
    if (url.pathname.endsWith("/get-products")) return jsonResponse({ data: [] });
    if (url.pathname === "/fapi/v1/ticker/24hr") {
      return jsonResponse({
        symbol: "CLUSDT",
        lastPrice: "73.59",
        priceChangePercent: "2.86",
        volume: "4264391.41",
        quoteVolume: "312150502.27",
        closeTime: Date.now(),
      });
    }
    if (url.pathname === "/fapi/v1/klines") {
      const start = Date.UTC(2026, 6, 12, 14, 0, 0);
      return jsonResponse([[start, "73.50", "73.60", "73.40", "73.59", "100", start + 59_999, "7359", 20]]);
    }
    return jsonResponse({ msg: "not found" }, { status: 404 });
  });
  const search = await invoke("instrument-search", "/?query=CLUSDT&provider=binance&limit=12");
  assert.equal(search.body.result[0].instrumentId, "binance:usdm:CLUSDT");
  assert.equal(search.body.result[0].contractType, "TRADIFI_PERPETUAL");
  assert.equal(search.body.result[0].underlyingType, "COMMODITY");
  const quotes = await invoke("quotes", "/?instrumentIds=binance%3Ausdm%3ACLUSDT");
  assert.equal(quotes.body.result[0].lastPrice, 73.59);
  assert.equal(quotes.body.source, "Binance USDⓈ-M Futures public market data");
  const candles = await invoke("candles", "/?instrumentId=binance%3Ausdm%3ACLUSDT&interval=1m&limit=2");
  assert.equal(candles.body.result.candles[0].close, 73.59);
  assert.equal(candles.body.source, "Binance USDⓈ-M Futures public market data");
  assert.equal(calls.some((call) => call.pathname === "/fapi/v1/ticker/24hr"), true);
  assert.equal(calls.some((call) => call.pathname === "/fapi/v1/klines"), true);
  assert.equal(calls.some((call) => Object.keys(call.headers).some((key) => key.toLowerCase() === "x-mbx-apikey")), false);
});

test("upstream rate limits return a structured retryable error", async () => {
  let upstreamCalls = 0;
  setFetchImplementation(async (rawUrl) => {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith("/get-products")) return jsonResponse(productMetadataFixture);
    upstreamCalls += 1;
    return jsonResponse(
      { code: -1003, msg: "Too much request weight used" },
      { status: 429, headers: { "retry-after": "5", "x-mbx-used-weight-1m": "6000" } },
    );
  });
  const response = await invoke("instrument-search", "/?query=BTC&provider=binance");
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, "BINANCE_RATE_LIMITED");
  assert.equal(response.body.retryable, true);
  assert.equal(response.body.details.retryAfterSeconds, 5);
  assert.equal(response.body.details.usedWeight1m, 6000);

  const cooldownResponse = await invoke("instrument-search", "/?query=ETH&provider=binance");
  assert.equal(cooldownResponse.statusCode, 503);
  assert.equal(cooldownResponse.body.code, "BINANCE_RATE_LIMITED");
  assert.equal(upstreamCalls, 2);
});

test("catalog watchdog releases a stuck shared request so the next request can recover", async () => {
  let exchangeInfoShouldHang = true;
  let exchangeInfoCalls = 0;
  setCatalogLoadTimeoutMs(20);
  setFetchImplementation(async (rawUrl) => {
    const url = new URL(rawUrl);
    if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse({ symbols: [] });
    if (!url.pathname.endsWith("/exchangeInfo")) return jsonResponse({}, { status: 404 });
    exchangeInfoCalls += 1;
    if (exchangeInfoShouldHang) return new Promise(() => {});
    return jsonResponse(exchangeInfoFixture, { headers: { "x-mbx-used-weight-1m": "20" } });
  });

  const timedOut = await invoke("provider-status", "/?provider=binance");
  assert.equal(timedOut.statusCode, 200);
  assert.equal(timedOut.body.result.status, "unavailable");
  assert.equal(timedOut.body.result.error.code, "BINANCE_CATALOG_TIMEOUT");

  exchangeInfoShouldHang = false;
  const recovered = await invoke("provider-status", "/?provider=binance");
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.result.status, "ready");
  assert.equal(recovered.body.result.available, true);
  assert.equal(recovered.body.result.instrumentCount, 2);
  assert.equal(exchangeInfoCalls, 2);
});

test("execution price fails closed when exchangeInfo refresh falls back to a stale catalog", async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  let exchangeCalls = 0;
  let tickerCalls = 0;
  Date.now = () => now;
  try {
    setFetchImplementation(async (rawUrl) => {
      const url = new URL(rawUrl);
      if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse({ symbols: [] });
      if (url.pathname.endsWith("/exchangeInfo")) {
        exchangeCalls += 1;
        if (exchangeCalls > 1) throw new Error("exchangeInfo unavailable");
        return jsonResponse(exchangeInfoFixture);
      }
      if (url.pathname.endsWith("/ticker/24hr")) {
        tickerCalls += 1;
        return jsonResponse({ symbol: "BTCUSDT", lastPrice: "100", closeTime: now });
      }
      return jsonResponse({}, { status: 404 });
    });
    const primed = await invoke("instrument-search", "/?query=BTC&provider=binance");
    assert.equal(primed.statusCode, 200);
    now += 5 * 60 * 1000 + 1;
    const execution = await invoke("execution-price", "/?instrumentId=binance%3Aspot%3ABTCUSDT");
    assert.equal(execution.statusCode, 503);
    assert.equal(execution.body.code, "BINANCE_STALE_INSTRUMENT_STATUS");
    assert.equal(exchangeCalls, 2);
    assert.equal(tickerCalls, 0);
  } finally {
    Date.now = originalNow;
  }
});

test("execution price rejects stale and invalid ticker values", async () => {
  const now = Date.now();
  let tickerPayload = { symbol: "BTCUSDT", lastPrice: "100", closeTime: now - 61_000 };
  setFetchImplementation(async (rawUrl) => {
    const url = new URL(rawUrl);
    if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse({ symbols: [] });
    if (url.pathname.endsWith("/exchangeInfo")) return jsonResponse(exchangeInfoFixture);
    if (url.pathname.endsWith("/ticker/24hr")) return jsonResponse(tickerPayload);
    return jsonResponse({}, { status: 404 });
  });

  const stale = await invoke("execution-price", "/?instrumentId=binance%3Aspot%3ABTCUSDT");
  assert.equal(stale.statusCode, 503);
  assert.equal(stale.body.code, "BINANCE_STALE_EXECUTION_PRICE");

  resetCaches();
  tickerPayload = { symbol: "BTCUSDT", lastPrice: "not-a-number", closeTime: Date.now() };
  const invalid = await invoke("execution-price", "/?instrumentId=binance%3Aspot%3ABTCUSDT");
  assert.equal(invalid.statusCode, 502);
  assert.equal(invalid.body.code, "BINANCE_INVALID_QUOTE");
});

test("quotes reject more than the supported batch size instead of silently truncating", async () => {
  const ids = Array.from({ length: 101 }, (_, index) => `binance:spot:T${String(index).padStart(4, "0")}USDT`);
  const response = await invoke("quotes", `/?instrumentIds=${encodeURIComponent(ids.join(","))}`);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "TOO_MANY_INSTRUMENT_IDS");
});
