import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeTransactionSettings,
  preserveTransactionWatchlistInstrumentsForLegacyPatch,
} from "../server/transactionSettings.mjs";

test("transaction status menu visibility defaults to shown and normalizes saved values", () => {
  assert.equal(normalizeTransactionSettings({}).menuHidden, false);
  assert.equal(normalizeTransactionSettings({ menuHidden: true }).menuHidden, true);
  assert.equal(normalizeTransactionSettings({ menuHidden: "off" }).menuHidden, false);
});

test("transaction status navigation is labeled and placed directly after stock channel", () => {
  const source = readFileSync(new URL("../src/shell/AppNavigation.jsx", import.meta.url), "utf8");
  const stockChannelIndex = source.indexOf('{ label: "주식채널"');
  const transactionStatusIndex = source.indexOf('{ label: "거래 현황"');
  const newsFeedIndex = source.indexOf('{ label: "News Feed"');

  assert.ok(stockChannelIndex >= 0);
  assert.ok(transactionStatusIndex > stockChannelIndex);
  assert.ok(newsFeedIndex > transactionStatusIndex);
  assert.match(source, /item\.view !== "transaction-status" \|\| !transactionStatusHidden/);
});

test("transaction settings keep v1 watchlist symbols readable", () => {
  const settings = normalizeTransactionSettings({
    version: 1,
    watchlistGroups: [
      {
        id: "legacy",
        name: "기존 관심 목록",
        symbols: ["aapl", "005930"],
      },
    ],
  });

  assert.equal(settings.version, 2);
  assert.deepEqual(settings.watchlistGroups[0].symbols, ["AAPL", "005930"]);
  assert.deepEqual(settings.watchlistGroups[0].instruments, []);
});

test("transaction settings preserve canonical Binance Spot instrument metadata", () => {
  const settings = normalizeTransactionSettings({
    watchlistGroups: [
      {
        id: "crypto",
        name: "크립토",
        symbols: [],
        instruments: [
          {
            instrumentId: "BINANCE:SPOT:btcusdt",
            provider: "binance",
            venue: "BINANCE_SPOT",
            assetClass: "crypto",
            symbol: "btcusdt",
            displaySymbol: "BTC/USDT",
            baseAsset: "btc",
            quoteAsset: "usdt",
            settlementAsset: "usdt",
            status: "trading",
            sessionPolicy: "24x7",
            market: "BINANCE_SPOT",
            name: "Bitcoin",
            englishName: "Bitcoin",
            source: "binance-market-data",
          },
          {
            instrumentId: "binance:spot:BTCUSDT",
            provider: "binance",
            symbol: "BTCUSDT",
          },
        ],
      },
    ],
  });

  const group = settings.watchlistGroups[0];
  assert.deepEqual(group.symbols, ["BTCUSDT"]);
  assert.equal(group.instruments.length, 1);
  assert.deepEqual(group.instruments[0], {
    instrumentId: "binance:spot:BTCUSDT",
    provider: "binance",
    venue: "BINANCE_SPOT",
    assetClass: "crypto",
    symbol: "BTCUSDT",
    displaySymbol: "BTC/USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    settlementAsset: "USD",
    status: "TRADING",
    sessionPolicy: "24x7",
    market: "BINANCE_SPOT",
    name: "Bitcoin",
    englishName: "Bitcoin",
    source: "binance-market-data",
  });
});

test("Binance identity is provider-derived without inventing a TRADING status", () => {
  const settings = normalizeTransactionSettings({
    watchlistGroups: [
      {
        id: "crypto",
        name: "크립토",
        instruments: [
          {
            provider: "binance",
            symbol: "BTCUSDT",
            baseAsset: "BTC",
            quoteAsset: "USDT",
          },
        ],
      },
    ],
  });

  assert.deepEqual(settings.watchlistGroups[0].instruments[0], {
    instrumentId: "binance:spot:BTCUSDT",
    provider: "binance",
    venue: "BINANCE_SPOT",
    assetClass: "crypto",
    symbol: "BTCUSDT",
    displaySymbol: "BTC/USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    settlementAsset: "USD",
    status: "",
    sessionPolicy: "24x7",
    market: "BINANCE_SPOT",
    name: "BTCUSDT",
    englishName: "",
    source: "binance-market-data",
  });
});

test("symbols-only legacy patches retain matching instrument metadata", () => {
  const currentGroups = normalizeTransactionSettings({
    watchlistGroups: [
      {
        id: "crypto",
        name: "크립토",
        instruments: [
          { provider: "binance", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
          { provider: "binance", symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT" },
        ],
      },
    ],
  }).watchlistGroups;

  const preserved = preserveTransactionWatchlistInstrumentsForLegacyPatch(
    [{ id: "crypto", name: "크립토", symbols: ["BTCUSDT"] }],
    currentGroups,
  );
  const normalized = normalizeTransactionSettings({ watchlistGroups: preserved });
  assert.deepEqual(normalized.watchlistGroups[0].symbols, ["BTCUSDT"]);
  assert.deepEqual(
    normalized.watchlistGroups[0].instruments.map((instrument) => instrument.instrumentId),
    ["binance:spot:BTCUSDT"],
  );
});

test("provider-qualified instruments preserve same-symbol entries independently", () => {
  const settings = normalizeTransactionSettings({
    watchlistGroups: [
      {
        id: "collision",
        name: "공급자 분리",
        instruments: [
          { instrumentId: "toss:stock:BTCUSDT", provider: "toss", symbol: "BTCUSDT", status: "ACTIVE" },
          {
            instrumentId: "binance:spot:BTCUSDT",
            provider: "binance",
            symbol: "BTCUSDT",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            status: "TRADING",
          },
        ],
      },
    ],
  });
  const group = settings.watchlistGroups[0];
  assert.deepEqual(group.symbols, ["BTCUSDT"]);
  assert.deepEqual(
    group.instruments.map((instrument) => instrument.instrumentId),
    ["toss:stock:BTCUSDT", "binance:spot:BTCUSDT"],
  );
});

test("sidebar manual order preserves provider-qualified keys while reading legacy symbols", () => {
  const settings = normalizeTransactionSettings({
    sidebarManualOrder: [
      "BTCUSDT",
      "BINANCE:SPOT:btcusdt",
      "toss:stock:BTCUSDT",
    ],
  });
  assert.deepEqual(settings.sidebarManualOrder, [
    "BTCUSDT",
    "binance:spot:BTCUSDT",
    "toss:stock:BTCUSDT",
  ]);
});
