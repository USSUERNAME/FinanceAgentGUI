import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchBinanceProviderStatus,
  fetchTossInvestmentStatus,
  fetchTossMarketCalendar,
  fetchUsdKrwExchangeRate,
} from "./transactionMarketDataApi.js";
import {
  fetchTransactionWatchlistPrices,
  normalizeMoneyUnit,
  normalizeTransactionWatchlistInstrumentsSetting,
  retryAfterMsFromRateLimit,
  transactionPageIsVisible,
  transactionSimulatorCalendarDate,
  transactionSimulatorMarketCalendarCode,
  transactionTossRateLimitFallbackMs,
  transactionWatchlistPriceRefreshMs,
  usdKrwRateFromPayload,
} from "./transactionDomain.js";

export function useTransactionMarketDataController({
  activeSection,
  currency = "KRW",
  liveFetchGate,
  onReload,
  selectedAccountSeq,
  selectedSimulator,
  selectedSimulatorCalendarUnitKey,
  selectedSimulatorId,
  selectedSimulatorMarketDataInstruments,
  selectedSimulatorSymbolKey,
  selectedWatchlistChartSymbol,
  selectedWatchlistGroup,
  selectedWatchlistSymbolKey,
  selectedWatchlistUsesBinance,
}) {
  const [usdKrwRate, setUsdKrwRate] = useState(0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveErrorCode, setLiveErrorCode] = useState("");
  const [liveRetryAfterMs, setLiveRetryAfterMs] = useState(0);
  const [etfNameTranslations, setEtfNameTranslations] = useState(() => new Map());
  const [watchlistPricePayload, setWatchlistPricePayload] = useState(null);
  const [watchlistPriceMap, setWatchlistPriceMap] = useState(() => new Map());
  const [watchlistPriceLoading, setWatchlistPriceLoading] = useState(false);
  const [watchlistPriceError, setWatchlistPriceError] = useState("");
  const [watchlistPriceErrorCode, setWatchlistPriceErrorCode] = useState("");
  const [simulatorPricePayload, setSimulatorPricePayload] = useState(null);
  const [simulatorPriceMap, setSimulatorPriceMap] = useState(() => new Map());
  const [simulatorPriceError, setSimulatorPriceError] = useState("");
  const [binanceProviderStatus, setBinanceProviderStatus] = useState(null);
  const [binanceProviderError, setBinanceProviderError] = useState("");
  const [simulatorMarketCalendars, setSimulatorMarketCalendars] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshSettledKey, setRefreshSettledKey] = useState(0);
  const [liveRefreshBusy, setLiveRefreshBusy] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => transactionPageIsVisible());
  const forceNextRefreshRef = useRef(false);
  const liveRefreshBusyRef = useRef(false);
  const liveRetryUntilRef = useRef(0);
  const payloadRef = useRef(null);
  const initialLoadRef = useRef(true);
  const wasPageHiddenRef = useRef(!transactionPageIsVisible());

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadBinanceProviderStatus() {
      try {
        const body = await fetchBinanceProviderStatus(controller.signal);
        if (!controller.signal.aborted) {
          setBinanceProviderStatus(body);
          setBinanceProviderError("");
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setBinanceProviderStatus(null);
          setBinanceProviderError(fetchError.message || "Binance 공개 시세 상태를 확인하지 못했습니다.");
        }
      }
    }
    void loadBinanceProviderStatus();
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (activeSection !== "watchlist") return undefined;
    const instruments = normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols,
    );
    if (!instruments.length) {
      setWatchlistPricePayload(null);
      setWatchlistPriceMap(new Map());
      setWatchlistPriceLoading(false);
      setWatchlistPriceError("");
      setWatchlistPriceErrorCode("");
      return undefined;
    }
    const hasBinance = instruments.some((instrument) => instrument.provider === "binance");
    const hasToss = instruments.some((instrument) => instrument.provider !== "binance");
    if (!hasBinance && hasToss && !liveFetchGate.ready) {
      setWatchlistPricePayload(null);
      setWatchlistPriceMap(new Map());
      setWatchlistPriceLoading(Boolean(liveFetchGate.waiting));
      setWatchlistPriceError(liveFetchGate.waiting ? "" : liveFetchGate.message);
      setWatchlistPriceErrorCode("");
      return undefined;
    }

    const controller = new AbortController();
    async function loadWatchlistPrices() {
      setWatchlistPriceLoading(true);
      setWatchlistPriceError("");
      setWatchlistPriceErrorCode("");
      try {
        const nextPayload = await fetchTransactionWatchlistPrices(instruments, controller.signal, {
          tossReady: liveFetchGate.ready,
          tossMessage: liveFetchGate.message,
        });
        if (controller.signal.aborted) return;
        setWatchlistPricePayload(nextPayload);
        setWatchlistPriceMap(nextPayload.priceMap || new Map());
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setWatchlistPriceError(fetchError.message || "관심 종목 가격을 불러오지 못했습니다.");
          setWatchlistPriceErrorCode(fetchError.errorCode || "");
        }
      } finally {
        if (!controller.signal.aborted) setWatchlistPriceLoading(false);
      }
    }

    void loadWatchlistPrices();
    return () => controller.abort();
  }, [
    activeSection,
    liveFetchGate.message,
    liveFetchGate.ready,
    liveFetchGate.waiting,
    refreshKey,
    selectedWatchlistGroup,
    selectedWatchlistSymbolKey,
  ]);

  useEffect(() => {
    if (
      activeSection !== "investment" ||
      !selectedSimulatorId ||
      !selectedSimulatorCalendarUnitKey ||
      !liveFetchGate.ready
    ) {
      setSimulatorMarketCalendars({});
      return undefined;
    }
    const units = selectedSimulatorCalendarUnitKey
      .split(",")
      .map((unit) => normalizeMoneyUnit(unit))
      .filter(Boolean);
    const controller = new AbortController();

    async function loadSimulatorMarketCalendars() {
      const entries = await Promise.all(units.map(async (unit) => {
        const marketCode = transactionSimulatorMarketCalendarCode(unit);
        const calendarDate = transactionSimulatorCalendarDate(unit);
        try {
          const body = await fetchTossMarketCalendar(marketCode, calendarDate, controller.signal);
          return [unit, body];
        } catch (fetchError) {
          if (fetchError.name === "AbortError") throw fetchError;
          return null;
        }
      }));
      if (!controller.signal.aborted) {
        setSimulatorMarketCalendars(Object.fromEntries(entries.filter(Boolean)));
      }
    }

    void loadSimulatorMarketCalendars().catch((fetchError) => {
      if (!controller.signal.aborted && fetchError.name !== "AbortError") {
        setSimulatorMarketCalendars({});
      }
    });
    return () => controller.abort();
  }, [
    activeSection,
    liveFetchGate.ready,
    selectedSimulatorCalendarUnitKey,
    selectedSimulatorId,
  ]);

  useEffect(() => {
    if (activeSection !== "investment" || !selectedSimulatorId) {
      setSimulatorPricePayload(null);
      setSimulatorPriceMap(new Map());
      setSimulatorPriceError("");
      return undefined;
    }
    const instruments = selectedSimulatorMarketDataInstruments;
    if (!instruments.length) {
      setSimulatorPricePayload(null);
      setSimulatorPriceMap(new Map());
      setSimulatorPriceError("");
      return undefined;
    }
    const hasBinance = instruments.some((instrument) => instrument.provider === "binance");
    const hasToss = instruments.some((instrument) => instrument.provider !== "binance");
    if (!hasBinance && hasToss && !liveFetchGate.ready) {
      setSimulatorPricePayload(null);
      setSimulatorPriceMap(new Map());
      setSimulatorPriceError(liveFetchGate.waiting ? "" : liveFetchGate.message);
      return undefined;
    }

    const controller = new AbortController();
    async function loadSimulatorPrices() {
      try {
        const nextPayload = await fetchTransactionWatchlistPrices(instruments, controller.signal, {
          tossReady: liveFetchGate.ready,
          tossMessage: liveFetchGate.message,
        });
        if (controller.signal.aborted) return;
        setSimulatorPricePayload(nextPayload);
        setSimulatorPriceMap(nextPayload.priceMap || new Map());
        setSimulatorPriceError("");
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setSimulatorPriceError(fetchError.message || "시뮬레이터 현재가를 갱신하지 못했습니다.");
        }
      }
    }

    void loadSimulatorPrices();
    return () => controller.abort();
  }, [
    activeSection,
    liveFetchGate.message,
    liveFetchGate.ready,
    liveFetchGate.waiting,
    refreshKey,
    selectedSimulatorId,
    selectedSimulatorMarketDataInstruments,
    selectedSimulatorSymbolKey,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    function handleVisibilityChange() {
      const visible = transactionPageIsVisible();
      setPageVisible(visible);
      if (!visible) {
        wasPageHiddenRef.current = true;
        return;
      }
      if (
        wasPageHiddenRef.current &&
        (liveFetchGate.ready || selectedWatchlistUsesBinance) &&
        (activeSection === "investment" || (activeSection === "watchlist" && selectedWatchlistSymbolKey))
      ) {
        wasPageHiddenRef.current = false;
        setRefreshKey((current) => current + 1);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [activeSection, liveFetchGate.ready, selectedWatchlistSymbolKey, selectedWatchlistUsesBinance]);

  useEffect(() => {
    const needsUsdKrwRate = activeSection === "investment" || (
      activeSection === "watchlist" && Boolean(selectedWatchlistChartSymbol)
    );
    if (!needsUsdKrwRate || !liveFetchGate.ready) {
      setUsdKrwRate(0);
      return undefined;
    }

    const controller = new AbortController();
    async function loadUsdKrwRate() {
      try {
        const body = await fetchUsdKrwExchangeRate(controller.signal);
        if (!controller.signal.aborted) setUsdKrwRate(usdKrwRateFromPayload(body));
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") setUsdKrwRate(0);
      }
    }

    void loadUsdKrwRate();
    return () => controller.abort();
  }, [activeSection, liveFetchGate.ready, selectedWatchlistChartSymbol]);

  useEffect(() => {
    if (activeSection !== "investment") {
      forceNextRefreshRef.current = false;
      liveRefreshBusyRef.current = false;
      setLiveRefreshBusy(false);
      setLoading(false);
      return undefined;
    }
    if (selectedSimulator) {
      forceNextRefreshRef.current = false;
      liveRefreshBusyRef.current = false;
      setLiveRefreshBusy(false);
      setLoading(false);
      setError("");
      setLiveErrorCode("");
      setLiveRetryAfterMs(0);
      liveRetryUntilRef.current = 0;
      return undefined;
    }
    if (!liveFetchGate.ready) {
      forceNextRefreshRef.current = false;
      liveRefreshBusyRef.current = false;
      setLiveRefreshBusy(false);
      if (liveFetchGate.waiting) {
        setLoading(true);
        setError("");
      } else {
        setPayload(null);
        setLoading(false);
        setError(liveFetchGate.message);
        setLiveErrorCode("");
        setLiveRetryAfterMs(0);
        liveRetryUntilRef.current = 0;
        initialLoadRef.current = false;
      }
      return undefined;
    }

    const controller = new AbortController();
    const force = forceNextRefreshRef.current;
    forceNextRefreshRef.current = false;

    async function loadInvestmentStatus() {
      liveRefreshBusyRef.current = true;
      setLiveRefreshBusy(true);
      const hasCurrentPayload = Boolean(payloadRef.current);
      if (!hasCurrentPayload && initialLoadRef.current) {
        setLoading(true);
        setError("");
        setLiveErrorCode("");
        setLiveRetryAfterMs(0);
      }
      try {
        const body = await fetchTossInvestmentStatus(
          { currency, accountSeq: selectedAccountSeq, force },
          controller.signal,
        );
        setPayload(body);
        setError("");
        setLiveErrorCode("");
        setLiveRetryAfterMs(0);
        liveRetryUntilRef.current = 0;
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          const retryAfterMs = Math.max(0, Number(
            retryAfterMsFromRateLimit(fetchError.rateLimit) ||
            (fetchError.status === 429 ? transactionTossRateLimitFallbackMs : 0)
          ));
          setError(fetchError.message || "거래현황을 불러오지 못했습니다.");
          setLiveErrorCode(fetchError.errorCode || "");
          setLiveRetryAfterMs(retryAfterMs);
          liveRetryUntilRef.current = retryAfterMs ? Date.now() + retryAfterMs : 0;
        }
      } finally {
        if (!controller.signal.aborted) {
          liveRefreshBusyRef.current = false;
          setLiveRefreshBusy(false);
          setLoading(false);
          initialLoadRef.current = false;
          setRefreshSettledKey((current) => current + 1);
        }
      }
    }

    void loadInvestmentStatus();
    return () => controller.abort();
  }, [
    activeSection,
    currency,
    liveFetchGate.message,
    liveFetchGate.ready,
    liveFetchGate.waiting,
    refreshKey,
    selectedAccountSeq,
    selectedSimulator,
  ]);

  useEffect(() => {
    if (activeSection !== "investment" || selectedSimulator || !liveFetchGate.ready || !pageVisible) {
      return undefined;
    }
    const recommendedIntervalMs = Number(payload?.refresh?.recommendedIntervalMs || 1_000);
    const intervalMs = Math.max(1_000, Math.min(300_000, Math.max(recommendedIntervalMs, liveRetryAfterMs || 0)));
    const timer = window.setTimeout(() => {
      setRefreshKey((current) => current + 1);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [
    activeSection,
    liveFetchGate.ready,
    pageVisible,
    liveRetryAfterMs,
    payload?.fetchedAt,
    payload?.refresh?.recommendedIntervalMs,
    refreshSettledKey,
    selectedSimulator,
  ]);

  useEffect(() => {
    if (activeSection !== "investment" || !selectedSimulatorId || !pageVisible) return undefined;
    const timer = window.setInterval(() => {
      setRefreshKey((current) => current + 1);
    }, transactionWatchlistPriceRefreshMs);
    return () => window.clearInterval(timer);
  }, [activeSection, pageVisible, selectedSimulatorId]);

  useEffect(() => {
    if (
      activeSection !== "watchlist" ||
      (!liveFetchGate.ready && !selectedWatchlistUsesBinance) ||
      !pageVisible ||
      !selectedWatchlistSymbolKey
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setRefreshKey((current) => current + 1);
    }, transactionWatchlistPriceRefreshMs);
    return () => window.clearTimeout(timer);
  }, [
    activeSection,
    liveFetchGate.ready,
    pageVisible,
    selectedWatchlistSymbolKey,
    selectedWatchlistUsesBinance,
    watchlistPricePayload?.fetchedAt,
  ]);

  const handleReload = useCallback(() => {
    if (liveFetchGate.ready && liveRefreshBusyRef.current) return;
    if (onReload) onReload();
    const retryRemainingMs = Math.max(0, liveRetryUntilRef.current - Date.now());
    if (activeSection === "investment" && retryRemainingMs > 0) {
      setLiveRetryAfterMs(retryRemainingMs);
      return;
    }
    if (activeSection === "watchlist") {
      setWatchlistPriceError("");
      setWatchlistPriceErrorCode("");
    } else {
      setError("");
      setLiveErrorCode("");
    }
    setLiveRetryAfterMs(0);
    liveRetryUntilRef.current = 0;
    forceNextRefreshRef.current = true;
    setRefreshKey((current) => current + 1);
  }, [activeSection, liveFetchGate.ready, onReload]);

  return {
    usdKrwRate,
    payload,
    loading,
    error,
    setError,
    liveErrorCode,
    setLiveErrorCode,
    liveRetryAfterMs,
    etfNameTranslations,
    setEtfNameTranslations,
    watchlistPricePayload,
    watchlistPriceMap,
    watchlistPriceLoading,
    watchlistPriceError,
    watchlistPriceErrorCode,
    simulatorPricePayload,
    simulatorPriceMap,
    simulatorPriceError,
    binanceProviderStatus,
    binanceProviderError,
    simulatorMarketCalendars,
    refreshKey,
    setRefreshKey,
    liveRefreshBusy,
    pageVisible,
    forceNextRefreshRef,
    handleReload,
  };
}
