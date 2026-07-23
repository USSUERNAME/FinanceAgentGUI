async function requestJson(path, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(path, {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.errorCode = payload?.errorCode || "";
    error.rateLimit = payload?.rateLimit || null;
    throw error;
  }
  return payload;
}

export function fetchBinanceProviderStatus(signal, fetchImpl) {
  return requestJson(
    "/api/market-data/providers/status?provider=binance",
    { signal },
    fetchImpl,
  );
}

export function fetchTossStockOptions(symbols = [], signal, fetchImpl) {
  const cleanSymbols = (Array.isArray(symbols) ? symbols : [symbols])
    .map((symbol) => String(symbol || "").trim().toUpperCase())
    .filter(Boolean);
  if (!cleanSymbols.length) return Promise.resolve({ ok: true, result: [] });
  return requestJson(
    `/api/tossinvest/stocks?symbols=${encodeURIComponent(cleanSymbols.join(","))}`,
    { signal },
    fetchImpl,
  );
}

export function fetchTossMarketCalendar(marketCode, date, signal, fetchImpl) {
  const cleanMarketCode = String(marketCode || "").trim().toLowerCase();
  const cleanDate = String(date || "").trim();
  return requestJson(
    `/api/tossinvest/market-calendar/${encodeURIComponent(cleanMarketCode)}?date=${encodeURIComponent(cleanDate)}`,
    { signal },
    fetchImpl,
  );
}

export function fetchUsdKrwExchangeRate(signal, fetchImpl) {
  return requestJson(
    "/api/tossinvest/exchange-rate?baseCurrency=USD&quoteCurrency=KRW",
    { signal },
    fetchImpl,
  );
}

export function fetchTossInvestmentStatus(
  { currency = "KRW", accountSeq = "", force = false } = {},
  signal,
  fetchImpl,
) {
  const params = new URLSearchParams({ currency: String(currency || "KRW") });
  if (accountSeq) params.set("accountSeq", String(accountSeq));
  if (force) params.set("force", "1");
  return requestJson(
    `/api/tossinvest/investment-status?${params.toString()}`,
    { signal },
    fetchImpl,
  );
}
