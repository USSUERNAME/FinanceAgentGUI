import test from "node:test";
import assert from "node:assert/strict";

import { __marketSymbolCatalogTestHooks } from "../server/marketSymbolCatalog.mjs";

const {
  normalizeKrxEtfPayload,
  normalizeNyseListingsPayload,
  searchKrxEtfs,
} = __marketSymbolCatalogTestHooks;

test("KRX ETF finder rows normalize alphanumeric symbols and names", () => {
  const rows = normalizeKrxEtfPayload({
    block1: [
      { full_code: "KR7069500007", short_code: "069500", codeName: "KODEX 200", dellistDd: "" },
      { full_code: "KR70182R0003", short_code: "0182R0", codeName: "1Q K반도체TOP2+", dellistDd: "" },
      { full_code: "KR7000000000", short_code: "000000", codeName: "상장폐지", dellistDd: "2026-01-01" },
    ],
  });
  assert.deepEqual(rows.map((row) => row.symbol), ["069500", "0182R0"]);
  assert.equal(rows[0].securityType, "ETF");
  assert.equal(rows[0].source, "KRX ETF Finder");
});

test("KRX ETF search matches both product name and exact ticker", () => {
  const rows = normalizeKrxEtfPayload({
    block1: [
      { short_code: "069500", codeName: "KODEX 200", dellistDd: "" },
      { short_code: "360750", codeName: "TIGER 미국S&P500", dellistDd: "" },
    ],
  });
  assert.equal(searchKrxEtfs(rows, "KODEX", 12)[0].symbol, "069500");
  assert.equal(searchKrxEtfs(rows, "360750", 12)[0].name, "TIGER 미국S&P500");
});

test("NYSE ETF rows keep ETF security type", () => {
  const rows = normalizeNyseListingsPayload([
    {
      normalizedTicker: "TQQQ",
      instrumentName: "PROSHARES TRUST ULTRAPRO QQQ USD",
      url: "https://www.nyse.com/quote/XNMS:TQQQ",
    },
  ], { securityType: "ETF" });
  assert.equal(rows[0].symbol, "TQQQ");
  assert.equal(rows[0].securityType, "ETF");
  assert.equal(rows[0].market, "NASDAQ Global Market");
});
