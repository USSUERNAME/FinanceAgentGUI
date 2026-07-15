import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/transactions/TransactionStatusView.jsx", import.meta.url), "utf8");

function loadDisplayName() {
  const match = source.match(
    /function displayName\(item = \{\}\) \{[\s\S]*?\n\}\n\nfunction transactionNameTranslationPending/
  );
  assert.ok(match, "displayName implementation should be present");
  const functionSource = match[0].replace(/\n\nfunction transactionNameTranslationPending[\s\S]*$/, "");
  return Function(
    "companyNames",
    "normalizeTransactionInstrumentProvider",
    `"use strict"; ${functionSource}; return displayName;`
  )(
    {},
    (value = "toss") => String(value || "toss").trim().toLowerCase() === "binance" ? "binance" : "toss"
  );
}

test("Binance canonical instrument ids preserve the uppercase exchange symbol", () => {
  assert.match(source, /return `binance:\$\{binanceMatch\[1\]\.toLowerCase\(\)\}:\$\{cleanTransactionWatchlistSymbol\(binanceMatch\[2\]\)\}`/);
  assert.doesNotMatch(source, /trim\(\)\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9/);
  assert.match(source, /provider === "binance" \? `binance:\$\{marketType\}:\$\{symbol\}`/);
});

test("Binance public market data keeps provider metadata and uses provider-specific routes", () => {
  assert.match(source, /group\.instruments/);
  assert.match(source, /\/api\/market-data\/instruments\/search\?query=/);
  assert.match(source, /\/api\/market-data\/quotes\?instrumentIds=/);
  assert.match(source, /\/api\/market-data\/candles/);
  assert.match(source, /\/api\/market-data\/execution-price\?instrumentId=/);
  assert.match(source, /\/api\/market-data\/providers\/status\?provider=binance/);
  assert.match(source, /transactionSymbolSearchSuggestions\(symbolOptions, query, excludedInstruments, 8\)/);
  assert.match(source, /representedProviders\.has\(entry\.instrument\.provider\)/);
  assert.match(source, /liveFetchGate\.ready && symbol && \/\^\[A-Z0-9\.-\]\+\$\//);
});

test("provider-qualified rows never fall back to another provider's same-symbol price", () => {
  assert.match(source, /const price = instrumentId \? priceMap\.get\(instrumentId\) : \(symbol \? priceMap\.get\(symbol\) : null\)/);
  assert.match(source, /const price = instrument\.instrumentId\s*\? priceMap\.get\(instrument\.instrumentId\) \|\| null/);
  assert.match(source, /normalizeTransactionWatchlistInstrumentsSetting\(excludedInstruments\)/);
  assert.match(source, /transactionWatchlistInstrumentsInOrder/);
  assert.match(source, /const source = item && typeof item === "object" \? item : \{\}/);
});

test("Binance daily return uses the completed US regular-session close instead of rolling 24 hours", () => {
  assert.match(
    source,
    /rolling24HourReturnPercent: instrument\?\.provider === "binance"\s*\? optionalNumericAmount\(item\?\.priceChangePercent\)/
  );
  assert.match(source, /dailyReturnPercent: instrument\?\.provider === "binance"\s*\? null/);
  assert.match(source, /fetchTransactionBinanceDailyBasis/);
  assert.match(source, /fetchTransactionWatchlistMarketCalendar\("us", calendarDate, signal\)/);
  assert.match(source, /source: "Binance 1분봉 미국 정규장 마감 기준가"/);
  assert.match(source, /isBinance\s*\? null\s*:\s*previousCloseForWatchlistPrice/);
  assert.match(source, /\{ key: "daily", label: "일간 수익률"/);
  assert.doesNotMatch(source, /일간 \/ 24시간 수익률/);
  assert.match(source, /normalizeTransactionInstrument\(row\)\?\.provider === "binance"/);
  assert.match(source, /new Date\(parsed\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(source, /requestedDisplayUnit === itemUnit \|\| convertMoney\(1, itemUnit, requestedDisplayUnit, usdKrwRate\) !== null/);
});

test("Binance simulator orders are 24x7 USD fills with an explicit zero-fee assumption", () => {
  assert.match(source, /"Binance Spot · 24시간 주문 가능"/);
  assert.match(source, /"Binance USDⓈ-M 선물 · 24시간 주문 가능"/);
  assert.match(source, /feeAssumption: "zero-no-public-account-rate"/);
  assert.match(source, /marketCountry: instrument\.provider === "binance" \? "GLOBAL"/);
  assert.match(source, /transactionBinanceProviderAvailability\(binanceProviderStatus, binanceProviderError\)/);
  assert.match(source, /currency: provider === "binance" \? "USD"/);
  assert.match(source, /convertMoney\(1, settlementUnit, requestedOrderUnit, usdKrwRate\) !== null/);
  assert.match(source, /setSimulatorBuyUnit\(\(currentUnit\) =>/);
  assert.match(source, /selectedSimulatorMarketDataInstruments/);
  assert.match(source, /selectedInvestmentSearchItem \? \[selectedInvestmentSearchItem\] : \[\]/);
  assert.match(source, /transactionSimulatorItemsWithPrices\(\[selectedInvestmentSearchItem\], simulatorPriceMap\)/);
  assert.match(source, /simulatorBuyIdempotencyKeyRef/);
  assert.match(source, /simulatorSellIdempotencyKeyRef/);
  assert.match(source, /transactionSimulatorDefaultDisplayUnit/);
  assert.match(source, /if \(hasUsdItems && !hasKrwItems\) return "USD"/);
  assert.match(source, /transactionAvailableDisplayUnit/);
  assert.match(source, /if \(itemUnits\.size === 1\) return \[\.\.\.itemUnits\]\[0\]/);
});

test("Binance autocomplete and simulator filters expose accessible provider-aware controls", () => {
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-autocomplete="list"/);
  assert.match(source, /aria-activedescendant=/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "ArrowUp"/);
  assert.match(source, /\uc554\ud638\uc790\uc0b0 \{cryptoCount\}\uac1c/);
  assert.match(source, /transactionPerformancePeriodPrefix/);
  assert.match(source, /transactionSortOptionsForItems/);
  assert.match(source, /transactionItemSelectionKey\(item\)/);
});

test("Toss ticker-only names use stored English names without changing Binance pair labels", () => {
  const displayName = loadDisplayName();

  assert.match(source, /name: displayNameFromInstrumentSources\(item, option, price, instrument\)/);
  assert.equal(displayName({
    provider: "toss",
    symbol: "QQQX",
    name: "QQQX",
    englishName: "NUVEEN NASDAQ 100 DYNAMIC OVWT FD",
  }), "NUVEEN NASDAQ 100 DYNAMIC OVWT FD");
  assert.equal(displayName({
    provider: "binance",
    symbol: "QQQBUSDT",
    name: "QQQB/USDT",
    displaySymbol: "QQQB/USDT",
    englishName: "QQQB/USDT",
  }), "QQQB/USDT");
});
