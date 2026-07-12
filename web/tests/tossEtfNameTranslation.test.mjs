import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __tossEtfNameTranslationTestHooks,
  decorateTossOverseasEtfNames,
  mergeTossEtfNameCandidates,
  readTossEtfNameTranslationCache,
  writeTossEtfNameTranslationCache,
} from "../server/tossEtfNameTranslation.mjs";

function testPayload() {
  return {
    ok: true,
    items: [
      {
        symbol: "VOO",
        label: "Vanguard S&P 500 ETF",
        market: "AMEX",
        securityType: "ETF",
        marketCountry: "US",
        currency: "USD",
      },
      {
        symbol: "AAPL",
        label: "Apple Inc.",
        market: "NASDAQ",
        securityType: "STOCK",
        marketCountry: "US",
        currency: "USD",
      },
      {
        symbol: "005930",
        label: "삼성전자",
        market: "KOSPI",
        securityType: "STOCK",
        marketCountry: "KR",
        currency: "KRW",
      },
    ],
  };
}

test("Toss ETF name decorator creates a missing JSON cache and queues overseas English names", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "finance-agent-toss-etf-test-"));
  const path = join(directory, "translation-cache.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const decorated = decorateTossOverseasEtfNames(testPayload(), { path, startTranslation: false });
  assert.equal(existsSync(path), true);
  assert.equal(decorated.items[0].label, "Vanguard S&P 500 ETF");
  assert.equal(decorated.etfNameTranslationCache.path, "data/toss-overseas-etf-name-translation-cache.json");

  const persisted = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(persisted.entries), ["VOO"]);
  assert.equal(persisted.entries.VOO.status, "pending");
  assert.equal(persisted.entries.AAPL, undefined);
  assert.equal(persisted.entries["005930"], undefined);
});

test("cached US-market translations replace display names and preserve original English names", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "finance-agent-toss-etf-test-"));
  const path = join(directory, "translation-cache.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const now = new Date().toISOString();
  writeTossEtfNameTranslationCache({
    entries: {
      VOO: {
        ticker: "VOO",
        sourceName: "Vanguard S&P 500 ETF",
        market: "AMEX",
        securityType: "ETF",
        marketCountry: "US",
        status: "translated",
        textKo: "뱅가드 S&P 500 ETF",
        firstSeenAt: now,
        lastSeenAt: now,
      },
      AAPL: {
        ticker: "AAPL",
        sourceName: "Apple Inc.",
        market: "NASDAQ",
        securityType: "STOCK",
        marketCountry: "US",
        status: "not_etf",
        isEtf: false,
        textKo: "",
        firstSeenAt: now,
        lastSeenAt: now,
      },
    },
  }, path);

  const decorated = decorateTossOverseasEtfNames(testPayload(), { path, startTranslation: false });
  assert.equal(decorated.items[0].label, "뱅가드 S&P 500 ETF");
  assert.equal(decorated.items[0].name, "뱅가드 S&P 500 ETF");
  assert.equal(decorated.items[0].englishName, "Vanguard S&P 500 ETF");
  assert.equal(decorated.items[0].originalName, "Vanguard S&P 500 ETF");
  assert.equal(decorated.items[1].label, "Apple Inc.");
  assert.equal(decorated.items[1].etfNameTranslationStatus, undefined);
});

test("watchlist and simulator candidates accept overseas funds and Binance assets", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "finance-agent-toss-etf-test-"));
  const path = join(directory, "translation-cache.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  decorateTossOverseasEtfNames({
    ok: true,
    items: [
      {
        symbol: "QQQ",
        name: "Invesco QQQ Trust",
        market: "NASDAQ",
        securityType: "FOREIGN_ETF",
        marketCountry: "US",
        currency: "KRW",
        provider: "toss",
        assetClass: "stock",
      },
      {
        symbol: "LEVNOTE",
        name: "Leveraged Index Note",
        market: "NYSE",
        securityType: "ETN",
        marketCountry: "US",
        currency: "USD",
        provider: "toss",
        assetClass: "stock",
      },
      {
        symbol: "BTCUSDT",
        name: "Bitcoin",
        marketCountry: "GLOBAL",
        currency: "USD",
        provider: "binance",
        assetClass: "crypto",
      },
    ],
  }, { path, startTranslation: false });

  const cache = readTossEtfNameTranslationCache(path);
  assert.deepEqual(Object.keys(cache.entries), ["QQQ", "LEVNOTE", "BTCUSDT"]);
  assert.equal(cache.entries.BTCUSDT.sourceName, "Bitcoin");
  assert.equal(cache.entries.BTCUSDT.status, "pending");
});

test("a changed source name requeues the ticker instead of keeping a stale translation", () => {
  const now = "2026-07-10T00:00:00.000Z";
  const initial = {
    entries: {
      VOO: {
        ticker: "VOO",
        sourceName: "Old ETF Name",
        status: "translated",
        textKo: "이전 ETF 이름",
        firstSeenAt: now,
        lastSeenAt: now,
      },
    },
  };
  const { memory, changed } = mergeTossEtfNameCandidates(initial, [{
    symbol: "VOO",
    label: "Vanguard S&P 500 ETF",
    market: "AMEX",
    securityType: "ETF",
    marketCountry: "US",
    currency: "USD",
  }], "2026-07-10T01:00:00.000Z");

  assert.equal(changed, true);
  assert.equal(memory.entries.VOO.status, "pending");
  assert.equal(memory.entries.VOO.textKo, "");
  assert.equal(Object.keys(memory.entries).length, 1);
});

test("unchanged holdings do not rewrite lastSeenAt on every one-second refresh", () => {
  const now = "2026-07-10T00:00:00.000Z";
  const initial = {
    entries: {
      VOO: {
        ticker: "VOO",
        sourceName: "Vanguard S&P 500 ETF",
        market: "AMEX",
        securityType: "ETF",
        marketCountry: "US",
        status: "translated",
        textKo: "뱅가드 S&P 500 ETF",
        firstSeenAt: now,
        lastSeenAt: now,
      },
    },
  };
  const { memory, changed } = mergeTossEtfNameCandidates(initial, [{
    symbol: "VOO",
    label: "Vanguard S&P 500 ETF",
    market: "AMEX",
    securityType: "ETF",
    marketCountry: "US",
    currency: "USD",
  }], "2026-07-10T00:00:01.000Z");

  assert.equal(changed, false);
  assert.equal(memory.entries.VOO.lastSeenAt, now);
});

test("an interrupted translating entry is recovered to the pending queue", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "finance-agent-toss-etf-test-"));
  const path = join(directory, "translation-cache.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeTossEtfNameTranslationCache({
    entries: {
      VOO: {
        ticker: "VOO",
        sourceName: "Vanguard S&P 500 ETF",
        marketCountry: "US",
        status: "translating",
        firstSeenAt: "2026-07-10T00:00:00.000Z",
        lastSeenAt: "2026-07-10T00:00:00.000Z",
      },
    },
  }, path);

  decorateTossOverseasEtfNames(testPayload(), { path, startTranslation: false });
  const recovered = readTossEtfNameTranslationCache(path);
  assert.equal(recovered.entries.VOO.status, "pending");
  assert.match(recovered.entries.VOO.error, /다시 대기/);
});

test("translation model output validation requires a Korean display name", () => {
  const item = { ticker: "VOO", sourceName: "Vanguard S&P 500 ETF" };
  assert.equal(
    __tossEtfNameTranslationTestHooks.validateCandidate(item, { textKo: "Vanguard S&P 500 ETF" }).ok,
    false,
  );
  assert.deepEqual(
    __tossEtfNameTranslationTestHooks.validateCandidate(item, { textKo: "뱅가드 S&P 500 ETF" }),
    { ok: true, textKo: "뱅가드 S&P 500 ETF" },
  );
});

test("cache reader tolerates a missing file", () => {
  const path = join(tmpdir(), `missing-toss-etf-${Date.now()}.json`);
  const cache = readTossEtfNameTranslationCache(path);
  assert.equal(cache.version, 1);
  assert.deepEqual(cache.entries, {});
});
