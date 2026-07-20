import test from "node:test";
import assert from "node:assert/strict";

import {
  loadReportMarketProxyContext,
  normalizeReportMarketProxyContext,
  REPORT_MARKET_PROXY_INSTRUMENT_IDS,
} from "../src/reports/reportMarketProxyContext.js";

const NOW_MS = Date.parse("2026-07-18T18:49:00.000Z");

function quote(instrumentId, lastPrice, priceChangePercent) {
  return {
    instrumentId,
    symbol: instrumentId.split(":").at(-1),
    lastPrice,
    priceChangePercent,
    timestamp: "2026-07-18T18:48:00.000Z",
    timestampMs: Date.parse("2026-07-18T18:48:00.000Z"),
    nativeQuoteAsset: "USDT",
    marketType: instrumentId.includes(":spot:") ? "spot" : "usdm",
    contractType: instrumentId.includes(":spot:") ? "" : "TRADIFI_PERPETUAL",
    quoteVolume: 20_000_000,
    count: 20_000,
    source: "Binance USDⓈ-M Futures public market data",
  };
}

test("report market proxy context maps ETFs, commodities, and crypto spot contracts", () => {
  const result = normalizeReportMarketProxyContext(
    {
      ok: true,
      fetchedAt: "2026-07-18T18:48:07.283Z",
      result: [
        quote("binance:usdm:BZUSDT", 89.15, 3.663),
        quote("binance:usdm:QQQUSDT", 694.22, -0.463),
        quote("binance:usdm:SPYUSDT", 743.06, -0.132),
        quote("binance:usdm:EWYUSDT", 161.58, -2.197),
        quote("binance:usdm:EWJUSDT", 91.36, 0.984),
        quote("binance:usdm:XAUUSDT", 4018.56, 0.12),
        quote("binance:usdm:XAGUSDT", 56, -0.32),
        quote("binance:usdm:XPTUSDT", 1600.2, -0.141),
        quote("binance:usdm:XPDUSDT", 1259.63, 0.147),
        quote("binance:usdm:CLUSDT", 84.47, 3.708),
        quote("binance:usdm:NATGASUSDT", 2.884, 0.313),
        quote("binance:usdm:COPPERUSDT", 6.255, -0.223),
        quote("binance:spot:BTCUSDT", 118000, 1.2),
        quote("binance:spot:ETHUSDT", 3600, 0.8),
      ],
    },
    { nowMs: NOW_MS },
  );

  assert.equal(result.available, true);
  assert.deepEqual(result.quotes.map((item) => item.symbol), [
    "QQQUSDT",
    "SPYUSDT",
    "EWYUSDT",
    "EWJUSDT",
    "XAUUSDT",
    "XAGUSDT",
    "XPTUSDT",
    "XPDUSDT",
    "CLUSDT",
    "BZUSDT",
    "NATGASUSDT",
    "COPPERUSDT",
    "BTCUSDT",
    "ETHUSDT",
  ]);
  assert.equal(result.quotes[0].usagePolicy, "closed_market_supplement");
  assert.equal(result.quotes[4].usagePolicy, "continuous_reference");
  assert.equal(result.quotes[11].officialReferenceTicker, "HG=F");
  assert.equal(result.quotes[12].usagePolicy, "continuous_direct_reference");
  assert.equal(result.quotes[12].instrumentKind, "Binance spot");
  assert.equal(result.quotes[12].contractType, "SPOT");
  assert.equal(result.quotes.every((item) => item.liquidityStatus === "high"), true);
  assert.equal(result.quotes.every((item) => item.fresh), true);
});

test("report market proxy loader falls back to individual contracts when a batch fails", async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(String(url));
    const parsed = new URL(String(url), "http://127.0.0.1");
    const instrumentIds = parsed.searchParams.get("instrumentIds").split(",");
    if (instrumentIds.length > 1) {
      return {
        ok: false,
        status: 502,
        json: async () => ({ ok: false, error: "batch unavailable" }),
      };
    }
    const instrumentId = instrumentIds[0];
    const isBrent = instrumentId === "binance:usdm:BZUSDT";
    return {
      ok: isBrent,
      status: isBrent ? 200 : 404,
      json: async () =>
        isBrent
          ? { ok: true, result: [quote(instrumentId, 89.15, 3.663)] }
          : { ok: false, error: "not found" },
    };
  };

  const result = await loadReportMarketProxyContext({ fetchImpl, nowMs: NOW_MS });
  assert.equal(fetchCalls.length, REPORT_MARKET_PROXY_INSTRUMENT_IDS.length + 1);
  assert.equal(result.available, true);
  assert.equal(result.degraded, true);
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].symbol, "BZUSDT");
  assert.equal(result.warning, "batch unavailable");
});

test("stale Binance proxy quotes remain visible but are marked unusable", () => {
  const stale = quote("binance:usdm:XAUUSDT", 4018.56, 0.12);
  stale.timestampMs = NOW_MS - 10 * 60 * 1000;
  stale.timestamp = new Date(stale.timestampMs).toISOString();
  const result = normalizeReportMarketProxyContext({ result: [stale] }, { nowMs: NOW_MS });
  assert.equal(result.quotes[0].fresh, false);
  assert.equal(result.quotes[0].quoteAgeMs, 10 * 60 * 1000);
});

test("thin proxy markets are explicitly tagged for cautious report use", () => {
  const copper = quote("binance:usdm:COPPERUSDT", 6.255, -0.223);
  copper.quoteVolume = 400_000;
  copper.count = 900;
  const result = normalizeReportMarketProxyContext({ result: [copper] }, { nowMs: NOW_MS });
  assert.equal(result.quotes[0].liquidityStatus, "thin");
  assert.equal(result.quotes[0].officialReferenceTicker, "HG=F");
});
