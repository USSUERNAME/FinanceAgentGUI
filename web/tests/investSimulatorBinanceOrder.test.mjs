import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareInvestSimulatorOrderPayload,
  requireOrderIdempotencyKey,
} from "../server/investSimulatorApi.mjs";

function fakeExecution() {
  return {
    instrument: {
      instrumentId: "binance:spot:BTCUSDT",
      provider: "binance",
      venue: "BINANCE_SPOT",
      assetClass: "crypto",
      symbol: "BTCUSDT",
      displaySymbol: "BTC/USDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      nativeQuoteAsset: "USDT",
      settlementAsset: "USD",
      status: "TRADING",
      sessionPolicy: "24x7",
      market: "BINANCE_SPOT",
    },
    quote: {
      timestamp: "2026-07-10T12:00:00.000Z",
      source: "Binance Spot public market data",
    },
    executionPrice: 50_000,
  };
}

function fakeUsdmExecution() {
  return {
    instrument: {
      instrumentId: "binance:usdm:NVDAUSDT",
      provider: "binance",
      venue: "BINANCE_USDM_FUTURES",
      marketType: "usdm",
      assetClass: "equity",
      symbol: "NVDAUSDT",
      displaySymbol: "NVDA/USDT",
      baseAsset: "NVDA",
      quoteAsset: "USDT",
      nativeQuoteAsset: "USDT",
      settlementAsset: "USD",
      status: "TRADING",
      sessionPolicy: "24x7",
      market: "BINANCE_USDM_FUTURES",
    },
    quote: {
      timestamp: "2026-07-17T12:00:00.000Z",
      source: "Binance USDⓈ-M Futures public market data",
    },
    executionPrice: 205,
  };
}

test("Binance simulator buy replaces client price and metadata with authoritative execution data", async () => {
  const calls = [];
  const prepared = await prepareInvestSimulatorOrderPayload(
    {
      simulatorId: "sim-1",
      provider: "binance",
      instrumentId: "binance:spot:BTCUSDT",
      symbol: "BTCUSDT",
      status: "HALT",
      price: 1,
      quantity: 10,
      settlementAmount: 100,
      feeAmount: 999,
      feeCurrency: "USDT",
    },
    "buy",
    async (instrumentId) => {
      calls.push(instrumentId);
      return fakeExecution();
    },
  );

  assert.deepEqual(calls, ["binance:spot:BTCUSDT"]);
  assert.equal(prepared.price, 50_000);
  assert.equal(prepared.quantity, 0.002);
  assert.equal(prepared.status, "TRADING");
  assert.equal(prepared.settlementCurrency, "USD");
  assert.equal(prepared.nativeQuoteAsset, "USDT");
  assert.equal(prepared.marketCountry, "GLOBAL");
  assert.equal(prepared.feeAmount, 0);
  assert.equal(prepared.feeCurrency, "USD");
  assert.equal(prepared.feeAssumption, "zero-no-public-account-rate");
  assert.equal(prepared.marketSession, "24x7");
});

test("Binance simulator sell keeps requested quantity while replacing the execution price", async () => {
  const prepared = await prepareInvestSimulatorOrderPayload(
    {
      simulatorId: "sim-1",
      provider: "binance",
      instrumentId: "binance:spot:BTCUSDT",
      symbol: "BTCUSDT",
      price: 1,
      quantity: 0.003,
    },
    "sell",
    async () => fakeExecution(),
  );
  assert.equal(prepared.price, 50_000);
  assert.equal(prepared.quantity, 0.003);
});

test("Binance USDⓈ-M simulator orders preserve the authoritative futures identity", async () => {
  const calls = [];
  const prepared = await prepareInvestSimulatorOrderPayload(
    {
      simulatorId: "sim-1",
      provider: "binance",
      instrumentId: "binance:usdm:NVDAUSDT",
      symbol: "NVDAUSDT",
      settlementAmount: 100,
    },
    "buy",
    async (instrumentId) => {
      calls.push(instrumentId);
      return fakeUsdmExecution();
    },
  );

  assert.deepEqual(calls, ["binance:usdm:NVDAUSDT"]);
  assert.equal(prepared.instrumentId, "binance:usdm:NVDAUSDT");
  assert.equal(prepared.marketType, "usdm");
  assert.equal(prepared.venue, "BINANCE_USDM_FUTURES");
  assert.equal(prepared.assetClass, "equity");
  assert.equal(prepared.priceSource, "Binance USDⓈ-M Futures public market data");
});

test("non-Binance simulator orders keep the existing order payload", async () => {
  const source = { provider: "toss", symbol: "AAPL", price: 200 };
  const prepared = await prepareInvestSimulatorOrderPayload(source, "buy", async () => {
    throw new Error("resolver should not run");
  });
  assert.equal(prepared, source);
});

test("simulator order API requires an explicit retry-stable idempotency key", () => {
  assert.equal(requireOrderIdempotencyKey({ idempotencyKey: "buy:sim-1:request-1" }), "buy:sim-1:request-1");
  assert.throws(
    () => requireOrderIdempotencyKey({}),
    (error) => error?.statusCode === 400 && error?.code === "SIMULATOR_IDEMPOTENCY_KEY_REQUIRED",
  );
});
