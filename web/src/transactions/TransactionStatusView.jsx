import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { buildTransactionStatusContextPacket } from "./contextPacketBuilder.js";
import {
  deleteInvestSimulatorAccount,
  fetchInvestSimulatorAccounts,
  patchInvestSimulatorAccount,
  postInvestSimulatorAccount,
  postInvestSimulatorBuy,
  postInvestSimulatorExchange,
  postInvestSimulatorSell,
} from "./investSimulatorApi.js";
import {
  fetchTossMarketCalendar,
  fetchTossStockOptions,
} from "./transactionMarketDataApi.js";
import { useTransactionDisplaySettingsController } from "./useTransactionDisplaySettingsController.js";
import { useTransactionMarketDataController } from "./useTransactionMarketDataController.js";
import { useTransactionShellState } from "./useTransactionShellState.js";
import { useTransactionSimulatorState } from "./useTransactionSimulatorState.js";
import { useTransactionWatchlistState } from "./useTransactionWatchlistState.js";
import "./transaction-status.css";
import {
  InvestmentMain,
  InvestmentSidebar,
  SectionRail,
  SimulatorBuyDialog,
  SimulatorDeleteDialog,
  SimulatorExchangeDialog,
  SimulatorInvestmentMain,
  SimulatorSellDialog,
  TransactionInvestmentAssetDetail,
  TransactionSimulatorOrderNotifications,
  TransactionSymbolSearchDialog,
  WatchlistCreateDialog,
  WatchlistDeleteDialog,
  WatchlistPlaceholder,
  WatchlistSymbolDialog,
  transactionWatchlistDetailItem,
  watchlistRowsFromGroup,
} from "./TransactionStatusViews.jsx";

import {
  normalizeMoneyUnit,
  defaultTransactionCurrencySettings,
  transactionEtfNameTranslationPollMs,
  normalizeTransactionMainTableColumnsSetting,
  normalizeTransactionSidebarManualOrderSetting,
  cleanTransactionWatchlistGroupName,
  cleanTransactionWatchlistGroupId,
  cleanTransactionWatchlistSymbol,
  cleanTransactionInstrumentId,
  normalizeTransactionInstrument,
  collectTransactionEtfNameTranslationSources,
  resolveTransactionEtfNameTranslationCandidates,
  transactionEtfNameTranslationMap,
  applyTransactionEtfNameTranslation,
  fetchTransactionEtfNameTranslations,
  transactionInstrumentKey,
  normalizeTransactionWatchlistInstrumentsSetting,
  normalizeTransactionWatchlistSymbolsSetting,
  createTransactionWatchlistGroupId,
  normalizeTransactionWatchlistGroupsSetting,
  transactionItemSelectionKey,
  cleanTransactionItemSelectionKey,
  createTransactionSimulatorOrderIdempotencyKey,
  transactionItemOrderKeys,
  arraysEqual,
  syncTransactionSidebarManualOrder,
  normalizeTransactionWatchlistInstrumentOrder,
  transactionWatchlistInstrumentsInOrder,
  visibleTransactionMainTableColumns,
  normalizeTransactionValueModeSetting,
  normalizeTransactionInvestmentChartModeSetting,
  normalizeTransactionInvestmentChartIntervalSetting,
  normalizeTransactionBooleanSetting,
  transactionCurrencySettingsFromPayload,
  effectiveMoneyUnitFromSetting,
  numericAmount,
  convertMoney,
  transactionWatchlistSymbolOptions,
  transactionWatchlistStockOptionsFromPayload,
  fetchTransactionWatchlistCatalogOptions,
  fetchTransactionSimulatorExecutionPrice,
  mergeTransactionWatchlistSymbolOptions,
  resolveTransactionWatchlistSymbolInput,
  transactionSimulatorOrderNotificationMessage,
  transactionSimulatorStockOptionFromItem,
  transactionSimulatorSettlementUnit,
  transactionSimulatorMarketCalendarCode,
  transactionSimulatorCalendarDate,
  transactionSimulatorCalendarUnitsForItems,
  transactionBinanceProviderAvailability,
  transactionSimulatorPositionSettlementValue,
  cleanTransactionSimulatorBuyAmountDraft,
  formatTransactionSimulatorBuyAmountDraft,
  transactionSimulatorExchangeMode,
  cleanTransactionSimulatorExchangeAmountDraft,
  cleanAccountSeq,
  cleanTransactionSimulatorId,
  cleanTransactionSimulatorName,
  simulatorDisplayLabel,
  normalizeTransactionSimulatorAccounts,
  readStoredTransactionSimulators,
  clearStoredTransactionSimulators,
  transactionSimulatorItemsWithPrices,
  transactionAvailableDisplayUnit,
  transactionSimulatorPayload,
  simulatorAccountsFromApiPayload,
  transactionLiveFetchGate,
  normalizeItem,
  sortItems,
  itemIsCrypto,
} from "./transactionDomain.js";


export default function TransactionStatusView({
  tossStatus,
  tossBusy = false,
  tossError = "",
  tossErrorCode = "",
  tossPublicIp = null,
  tossPublicIpBusy = false,
  tossPublicIpError = "",
  onOpenSettings,
  onDeleteCredentials,
  onCheckPublicIp,
  onReload,
  onContextChange,
}) {
  const {
    activeSection, setActiveSection,
    selectedInvestmentOrderKey, setSelectedInvestmentOrderKey,
    selectedInvestmentSearchItem, setSelectedInvestmentSearchItem,
    sortId, setSortId,
    sortOpen, setSortOpen,
    manualOrderEditing, setManualOrderEditing,
    manualOrderDraft, setManualOrderDraft,
    accountOpen, setAccountOpen,
    selectedAccountSeq, setSelectedAccountSeq,
  } = useTransactionShellState();
  const {
    valueMode,
    sidebarUnit, setSidebarUnit,
    mainUnit, setMainUnit,
    currencySettings, setCurrencySettings,
    currencySettingsError,
    saveTransactionCurrencySettings,
    handleSidebarUnitChange,
    handleMainUnitChange,
    handleMainTableColumnsChange,
    handleValueModeChange,
    handleInvestmentChartModeChange,
    handleInvestmentChartIntervalChange,
    handleInvestmentChartVolumeVisibleChange,
  } = useTransactionDisplaySettingsController({
    defaultSettings: defaultTransactionCurrencySettings,
    normalizeSettingsPayload: transactionCurrencySettingsFromPayload,
    normalizeMoneyUnit,
    normalizeMainTableColumns: normalizeTransactionMainTableColumnsSetting,
    normalizeValueMode: normalizeTransactionValueModeSetting,
    normalizeChartMode: normalizeTransactionInvestmentChartModeSetting,
    normalizeChartInterval: normalizeTransactionInvestmentChartIntervalSetting,
    normalizeBoolean: normalizeTransactionBooleanSetting,
  });
  const {
    selectedWatchlistChartSymbol, setSelectedWatchlistChartSymbol,
    watchlistCreateOpen, setWatchlistCreateOpen,
    watchlistGroupNameDraft, setWatchlistGroupNameDraft,
    watchlistGroupNameError, setWatchlistGroupNameError,
    watchlistDeleteTarget, setWatchlistDeleteTarget,
    watchlistOrderEditing, setWatchlistOrderEditing,
    watchlistOrderDraft, setWatchlistOrderDraft,
    selectedWatchlistGroupId, setSelectedWatchlistGroupId,
    watchlistRenameGroupId, setWatchlistRenameGroupId,
    watchlistRenamePlacement, setWatchlistRenamePlacement,
    watchlistRenameDraft, setWatchlistRenameDraft,
    watchlistRenameError, setWatchlistRenameError,
    watchlistSymbolOrderEditing, setWatchlistSymbolOrderEditing,
    watchlistSymbolOrderDraft, setWatchlistSymbolOrderDraft,
    watchlistSymbolAddOpen, setWatchlistSymbolAddOpen,
    watchlistSymbolDraft, setWatchlistSymbolDraft,
    watchlistSelectedSymbol, setWatchlistSelectedSymbol,
    watchlistSymbolError, setWatchlistSymbolError,
    watchlistSavedSymbolOptions, setWatchlistSavedSymbolOptions,
    watchlistRemoteSymbolOptions, setWatchlistRemoteSymbolOptions,
  } = useTransactionWatchlistState();
  const {
    simulatorAccounts, setSimulatorAccounts,
    selectedSimulatorId, setSelectedSimulatorId,
    simulatorStoreReady, setSimulatorStoreReady,
    simulatorLoading, setSimulatorLoading,
    simulatorError, setSimulatorError,
    simulatorDeleteTarget, setSimulatorDeleteTarget,
    simulatorDeletingId, setSimulatorDeletingId,
    simulatorRenameTarget, setSimulatorRenameTarget,
    simulatorRenameDraft, setSimulatorRenameDraft,
    simulatorRenameBusy, setSimulatorRenameBusy,
    simulatorRenameError, setSimulatorRenameError,
    simulatorSymbolSearchOpen, setSimulatorSymbolSearchOpen,
    simulatorSymbolSearchDraft, setSimulatorSymbolSearchDraft,
    simulatorSymbolSearchSelection, setSimulatorSymbolSearchSelection,
    simulatorSymbolSearchOptions, setSimulatorSymbolSearchOptions,
    simulatorSymbolSearchError, setSimulatorSymbolSearchError,
    simulatorBuyOpen, setSimulatorBuyOpen,
    simulatorBuySymbolDraft, setSimulatorBuySymbolDraft,
    simulatorBuySelectedSymbol, setSimulatorBuySelectedSymbol,
    simulatorBuyRemoteSymbolOptions, setSimulatorBuyRemoteSymbolOptions,
    simulatorBuyAmountDraft, setSimulatorBuyAmountDraft,
    simulatorBuyUnit, setSimulatorBuyUnit,
    simulatorBuyError, setSimulatorBuyError,
    simulatorBuyBusy, setSimulatorBuyBusy,
    simulatorBuyMarketCalendar, setSimulatorBuyMarketCalendar,
    simulatorBuyMarketCalendarLoading, setSimulatorBuyMarketCalendarLoading,
    simulatorBuyMarketCalendarError, setSimulatorBuyMarketCalendarError,
    simulatorSellOpen, setSimulatorSellOpen,
    simulatorSellPosition, setSimulatorSellPosition,
    simulatorSellAmountDraft, setSimulatorSellAmountDraft,
    simulatorSellUnit, setSimulatorSellUnit,
    simulatorSellError, setSimulatorSellError,
    simulatorSellBusy, setSimulatorSellBusy,
    simulatorSellMarketCalendar, setSimulatorSellMarketCalendar,
    simulatorSellMarketCalendarLoading, setSimulatorSellMarketCalendarLoading,
    simulatorSellMarketCalendarError, setSimulatorSellMarketCalendarError,
    simulatorOrderNotifications, setSimulatorOrderNotifications,
    simulatorExchangeOpen, setSimulatorExchangeOpen,
    simulatorExchangeMode, setSimulatorExchangeMode,
    simulatorExchangeAmountDraft, setSimulatorExchangeAmountDraft,
    simulatorExchangeError, setSimulatorExchangeError,
    simulatorExchangeBusy, setSimulatorExchangeBusy,
    simulatorOrderNotificationTimersRef,
    simulatorBuyIdempotencyKeyRef,
    simulatorSellIdempotencyKeyRef,
  } = useTransactionSimulatorState({ normalizeMoneyUnit });
  const currency = "KRW";
  const rootRef = useRef(null);
  const transactionContextMetaRef = useRef(null);
  const handleContextSurfaceData = useCallback((surface) => {
    if (!onContextChange) return;
    onContextChange(buildTransactionStatusContextPacket({
      ...(transactionContextMetaRef.current || {}),
      surface,
    }));
  }, [onContextChange]);

  const removeSimulatorOrderNotification = useCallback((notificationId) => {
    const timers = simulatorOrderNotificationTimersRef.current.get(notificationId);
    if (timers?.leave) window.clearTimeout(timers.leave);
    if (timers?.remove) window.clearTimeout(timers.remove);
    simulatorOrderNotificationTimersRef.current.delete(notificationId);
    setSimulatorOrderNotifications((current) => current.filter((notification) => notification.id !== notificationId));
  }, []);

  const showSimulatorOrderNotification = useCallback(({ side = "buy", symbol = "", amount = 0, unit = "KRW" }) => {
    const normalizedSide = side === "sell" ? "sell" : "buy";
    const notificationId = `sim-order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const notification = {
      id: notificationId,
      side: normalizedSide,
      message: transactionSimulatorOrderNotificationMessage({
        side: normalizedSide,
        symbol,
        amount,
        unit,
      }),
      leaving: false,
    };
    setSimulatorOrderNotifications((current) => [...current, notification]);
    const leaveTimer = window.setTimeout(() => {
      setSimulatorOrderNotifications((current) => current.map((item) => (
        item.id === notificationId ? { ...item, leaving: true } : item
      )));
      const removeTimer = window.setTimeout(() => {
        removeSimulatorOrderNotification(notificationId);
      }, 260);
      const timers = simulatorOrderNotificationTimersRef.current.get(notificationId);
      if (timers) {
        simulatorOrderNotificationTimersRef.current.set(notificationId, { ...timers, remove: removeTimer });
      }
    }, 2000);
    simulatorOrderNotificationTimersRef.current.set(notificationId, { leave: leaveTimer, remove: null });
  }, [removeSimulatorOrderNotification]);

  useEffect(() => () => {
    for (const timers of simulatorOrderNotificationTimersRef.current.values()) {
      if (timers?.leave) window.clearTimeout(timers.leave);
      if (timers?.remove) window.clearTimeout(timers.remove);
    }
    simulatorOrderNotificationTimersRef.current.clear();
  }, []);

  const liveFetchGate = useMemo(() => transactionLiveFetchGate(tossStatus), [tossStatus]);
  const normalizedSimulatorAccounts = useMemo(
    () => normalizeTransactionSimulatorAccounts(simulatorAccounts),
    [simulatorAccounts]
  );
  const selectedSimulator = useMemo(() => {
    const simulatorId = cleanTransactionSimulatorId(selectedSimulatorId);
    if (!simulatorId) return null;
    return normalizedSimulatorAccounts.find((simulator) => simulator.id === simulatorId) || null;
  }, [normalizedSimulatorAccounts, selectedSimulatorId]);
  const selectedSimulatorInstruments = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting(selectedSimulator?.items || []),
    [selectedSimulator]
  );
  const selectedSimulatorMarketDataInstruments = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting([
      ...selectedSimulatorInstruments,
      ...(selectedInvestmentSearchItem ? [selectedInvestmentSearchItem] : []),
    ]),
    [selectedInvestmentSearchItem, selectedSimulatorInstruments],
  );
  const selectedSimulatorSymbolKey = useMemo(
    () => selectedSimulatorMarketDataInstruments.map((instrument) => instrument.instrumentId).join(","),
    [selectedSimulatorMarketDataInstruments]
  );
  const selectedSimulatorCalendarUnitKey = useMemo(
    () => transactionSimulatorCalendarUnitsForItems(selectedSimulator?.items || []).join(","),
    [selectedSimulator]
  );
  const activeWatchlistGroups = watchlistOrderEditing ? watchlistOrderDraft : currencySettings.watchlistGroups;
  const normalizedWatchlistGroups = useMemo(
    () => normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []),
    [activeWatchlistGroups]
  );
  const selectedWatchlistGroup = useMemo(() => {
    if (!normalizedWatchlistGroups.length) return null;
    return normalizedWatchlistGroups.find((group) => group.id === selectedWatchlistGroupId) || normalizedWatchlistGroups[0];
  }, [normalizedWatchlistGroups, selectedWatchlistGroupId]);
  const selectedWatchlistUsesToss = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    ).some((instrument) => instrument.provider !== "binance"),
    [selectedWatchlistGroup]
  );
  const selectedWatchlistUsesBinance = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    ).some((instrument) => instrument.provider === "binance"),
    [selectedWatchlistGroup]
  );
  const selectedWatchlistDisplayGroup = useMemo(() => {
    if (!selectedWatchlistGroup) return null;
    if (!watchlistSymbolOrderEditing) return selectedWatchlistGroup;
    const instruments = transactionWatchlistInstrumentsInOrder(
      selectedWatchlistGroup,
      watchlistSymbolOrderDraft,
    );
    return {
      ...selectedWatchlistGroup,
      symbols: normalizeTransactionWatchlistSymbolsSetting(instruments),
      instruments,
    };
  }, [selectedWatchlistGroup, watchlistSymbolOrderDraft, watchlistSymbolOrderEditing]);
  const selectedWatchlistSymbolKey = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    ).map((instrument) => instrument.instrumentId).join(","),
    [selectedWatchlistGroup]
  );
  const {
    usdKrwRate,
    payload,
    loading,
    error,
    liveErrorCode,
    liveRetryAfterMs,
    etfNameTranslations, setEtfNameTranslations,
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
    refreshKey, setRefreshKey,
    liveRefreshBusy,
    pageVisible,
    forceNextRefreshRef,
    handleReload,
  } = useTransactionMarketDataController({
    activeSection,
    currency,
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
  });
  const simulatorPayload = useMemo(
    () => transactionSimulatorPayload(selectedSimulator, simulatorPriceMap, simulatorPricePayload),
    [selectedSimulator, simulatorPriceMap, simulatorPricePayload]
  );
  const translatedSimulatorPayload = useMemo(() => {
    if (!simulatorPayload) return null;
    return {
      ...simulatorPayload,
      items: (Array.isArray(simulatorPayload.items) ? simulatorPayload.items : []).map((item) => (
        applyTransactionEtfNameTranslation(item, etfNameTranslations)
      )),
    };
  }, [etfNameTranslations, simulatorPayload]);
  const translatedLivePayload = useMemo(() => {
    if (!payload) return null;
    return {
      ...payload,
      items: (Array.isArray(payload.items) ? payload.items : []).map((item) => (
        applyTransactionEtfNameTranslation(item, etfNameTranslations)
      )),
    };
  }, [etfNameTranslations, payload]);
  const activeInvestmentPayload = translatedSimulatorPayload || translatedLivePayload;
  const unit = activeInvestmentPayload?.unit || currency;
  const normalizedItems = useMemo(
    () => (Array.isArray(activeInvestmentPayload?.items) ? activeInvestmentPayload.items.map((item) => normalizeItem(item, unit)) : []),
    [activeInvestmentPayload?.items, unit]
  );
  const watchlistHoldingSymbolOptions = useMemo(
    () => transactionWatchlistSymbolOptions(normalizedItems),
    [normalizedItems]
  );
  const watchlistSymbolOptions = useMemo(
    () => mergeTransactionWatchlistSymbolOptions(
      watchlistHoldingSymbolOptions,
      watchlistSavedSymbolOptions,
      watchlistRemoteSymbolOptions
    ).map((item) => applyTransactionEtfNameTranslation(item, etfNameTranslations)),
    [etfNameTranslations, watchlistHoldingSymbolOptions, watchlistRemoteSymbolOptions, watchlistSavedSymbolOptions]
  );
  const simulatorBuySymbolOptions = useMemo(
    () => mergeTransactionWatchlistSymbolOptions(watchlistSymbolOptions, simulatorBuyRemoteSymbolOptions),
    [simulatorBuyRemoteSymbolOptions, watchlistSymbolOptions]
  );
  const simulatorSearchSymbolOptions = useMemo(
    () => mergeTransactionWatchlistSymbolOptions(watchlistSymbolOptions, simulatorSymbolSearchOptions),
    [simulatorSymbolSearchOptions, watchlistSymbolOptions]
  );
  const selectedWatchlistRows = useMemo(
    () => watchlistRowsFromGroup(
      selectedWatchlistDisplayGroup,
      normalizedItems,
      watchlistSymbolOptions,
      watchlistPriceMap
    ).map((item) => applyTransactionEtfNameTranslation(item, etfNameTranslations)),
    [etfNameTranslations, normalizedItems, selectedWatchlistDisplayGroup, watchlistPriceMap, watchlistSymbolOptions]
  );
  const etfNameTranslationSources = useMemo(
    () => collectTransactionEtfNameTranslationSources(
      payload?.items,
      normalizedWatchlistGroups,
      normalizedSimulatorAccounts,
      [
        ...watchlistRemoteSymbolOptions,
        ...simulatorBuyRemoteSymbolOptions,
        ...simulatorSymbolSearchOptions,
      ],
    ),
    [
      normalizedSimulatorAccounts,
      normalizedWatchlistGroups,
      payload?.items,
      simulatorBuyRemoteSymbolOptions,
      simulatorSymbolSearchOptions,
      watchlistRemoteSymbolOptions,
    ],
  );
  const etfNameTranslationSourceKey = useMemo(
    () => JSON.stringify(etfNameTranslationSources.map((item) => [
      item.provider,
      item.symbol,
      item.instrumentId,
      item.contractType,
      item.underlyingType,
      item.underlyingSubType,
    ])),
    [etfNameTranslationSources],
  );
  const selectedWatchlistChartItem = useMemo(() => {
    const instrumentId = cleanTransactionInstrumentId(selectedWatchlistChartSymbol);
    if (!instrumentId) return null;
    const row = selectedWatchlistRows.find((item) => item.instrumentId === instrumentId);
    return row ? transactionWatchlistDetailItem(row, mainUnit) : null;
  }, [mainUnit, selectedWatchlistChartSymbol, selectedWatchlistRows]);

  useEffect(() => {
    if (!selectedWatchlistChartSymbol || selectedWatchlistChartItem) return;
    setSelectedWatchlistChartSymbol("");
  }, [selectedWatchlistChartItem, selectedWatchlistChartSymbol]);

  useEffect(() => {
    if (!etfNameTranslationSources.length) {
      setEtfNameTranslations(new Map());
      return undefined;
    }
    const controller = new AbortController();
    let timer = null;

    async function startTranslationPolling() {
      try {
        const candidates = await resolveTransactionEtfNameTranslationCandidates(
          etfNameTranslationSources,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!candidates.length) {
          setEtfNameTranslations(new Map());
          return;
        }

        async function refreshTranslations() {
          try {
            const body = await fetchTransactionEtfNameTranslations(candidates, controller.signal);
            if (controller.signal.aborted) return;
            setEtfNameTranslations(transactionEtfNameTranslationMap(body.items));
            const memory = body.etfNameTranslationCache || {};
            if (memory.inFlight || Number(memory.pendingCount || 0) > 0) {
              const retryAtMs = Date.parse(memory.nextRetryAt || "");
              const retryDelayMs = Number.isFinite(retryAtMs)
                ? Math.min(300_000, Math.max(transactionEtfNameTranslationPollMs, retryAtMs - Date.now()))
                : transactionEtfNameTranslationPollMs;
              timer = window.setTimeout(refreshTranslations, retryDelayMs);
            }
          } catch (fetchError) {
            if (!controller.signal.aborted && fetchError.name !== "AbortError") {
              timer = window.setTimeout(refreshTranslations, 5_000);
            }
          }
        }

        void refreshTranslations();
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          timer = window.setTimeout(startTranslationPolling, 5_000);
        }
      }
    }

    void startTranslationPolling();
    return () => {
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [etfNameTranslationSourceKey]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSimulatorAccounts() {
      setSimulatorLoading(true);
      setSimulatorError("");
      try {
        let body = await fetchInvestSimulatorAccounts(controller.signal);
        let nextAccounts = simulatorAccountsFromApiPayload(body);
        const storedAccounts = readStoredTransactionSimulators();
        if (!nextAccounts.length && storedAccounts.length) {
          for (const storedAccount of storedAccounts) {
            if (controller.signal.aborted) return;
            body = await postInvestSimulatorAccount({
              id: storedAccount.id,
              name: storedAccount.name,
              initialKrw: storedAccount.cashKrw,
              initialUsd: storedAccount.cashUsd,
              idempotencyKey: `prototype-migration:${storedAccount.id}`,
            }, controller.signal);
          }
          clearStoredTransactionSimulators();
          nextAccounts = simulatorAccountsFromApiPayload(body);
        }
        if (!controller.signal.aborted) {
          setSimulatorAccounts(nextAccounts);
          setSimulatorError("");
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setSimulatorError(fetchError.message || "시뮬레이터 장부를 불러오지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSimulatorLoading(false);
          setSimulatorStoreReady(true);
        }
      }
    }

    void loadSimulatorAccounts();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!simulatorStoreReady || !selectedSimulatorId) return;
    const simulatorId = cleanTransactionSimulatorId(selectedSimulatorId);
    if (!simulatorId) return;
    if (!normalizedSimulatorAccounts.some((simulator) => simulator.id === simulatorId)) {
      setSelectedSimulatorId("");
    }
  }, [normalizedSimulatorAccounts, selectedSimulatorId, simulatorStoreReady]);

  useEffect(() => {
    if (activeSection !== "watchlist") return;
    if (!normalizedWatchlistGroups.length) {
      if (selectedWatchlistGroupId) setSelectedWatchlistGroupId("");
      return;
    }
    if (!normalizedWatchlistGroups.some((group) => group.id === selectedWatchlistGroupId)) {
      setSelectedWatchlistGroupId(normalizedWatchlistGroups[0].id);
    }
  }, [activeSection, normalizedWatchlistGroups, selectedWatchlistGroupId]);

  useEffect(() => {
    if (!selectedWatchlistSymbolKey) {
      setWatchlistSavedSymbolOptions([]);
      return undefined;
    }
    const savedInstruments = normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    );
    const tossSymbols = savedInstruments
      .filter((instrument) => instrument.provider !== "binance")
      .map((instrument) => instrument.symbol);
    setWatchlistSavedSymbolOptions(savedInstruments);
    if (!tossSymbols.length || !liveFetchGate.ready) return undefined;
    const controller = new AbortController();
    async function loadSavedWatchlistSymbols() {
      try {
        const body = await fetchTossStockOptions(tossSymbols, controller.signal);
        const options = transactionWatchlistStockOptionsFromPayload(body);
        if (!controller.signal.aborted) {
          setWatchlistSavedSymbolOptions(mergeTransactionWatchlistSymbolOptions(savedInstruments, options));
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setWatchlistSavedSymbolOptions(savedInstruments);
        }
      }
    }
    void loadSavedWatchlistSymbols();
    return () => controller.abort();
  }, [liveFetchGate.ready, selectedWatchlistGroup, selectedWatchlistSymbolKey]);

  useEffect(() => {
    if (activeSection !== "investment" || !selectedSimulatorId || !simulatorStoreReady || !pageVisible) {
      return undefined;
    }

    const controller = new AbortController();
    async function refreshSimulatorAccounts() {
      try {
        const body = await fetchInvestSimulatorAccounts(controller.signal);
        if (controller.signal.aborted) return;
        setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
        setSimulatorError("");
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setSimulatorError(fetchError.message || "시뮬레이터 장부를 갱신하지 못했습니다.");
        }
      }
    }

    void refreshSimulatorAccounts();
    return () => controller.abort();
  }, [
    activeSection,
    pageVisible,
    refreshKey,
    selectedSimulatorId,
    simulatorStoreReady,
  ]);

  const handleCancelWatchlistGroupRename = useCallback(() => {
    setWatchlistRenameGroupId("");
    setWatchlistRenamePlacement("sidebar");
    setWatchlistRenameDraft("");
    setWatchlistRenameError("");
  }, []);

  const handleCancelWatchlistSymbolOrder = useCallback(() => {
    setWatchlistSymbolOrderEditing(false);
    setWatchlistSymbolOrderDraft([]);
  }, []);

  const handleOpenWatchlistCreate = useCallback(() => {
    handleCancelWatchlistGroupRename();
    handleCancelWatchlistSymbolOrder();
    setWatchlistGroupNameDraft("");
    setWatchlistGroupNameError("");
    setWatchlistCreateOpen(true);
  }, [handleCancelWatchlistGroupRename, handleCancelWatchlistSymbolOrder]);

  const handleCancelWatchlistCreate = useCallback(() => {
    setWatchlistCreateOpen(false);
    setWatchlistGroupNameDraft("");
    setWatchlistGroupNameError("");
  }, []);

  const handleWatchlistGroupDraftChange = useCallback((nextValue) => {
    setWatchlistGroupNameDraft(nextValue);
    if (watchlistGroupNameError) setWatchlistGroupNameError("");
  }, [watchlistGroupNameError]);

  const handleWatchlistRenameDraftChange = useCallback((nextValue) => {
    setWatchlistRenameDraft(nextValue);
    if (watchlistRenameError) setWatchlistRenameError("");
  }, [watchlistRenameError]);

  const handleRequestWatchlistGroupRename = useCallback((groupId, placement = "sidebar") => {
    if (watchlistOrderEditing) return;
    const nextGroupId = cleanTransactionWatchlistGroupId(groupId);
    if (!nextGroupId) return;
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const targetGroup = currentGroups.find((group) => group.id === nextGroupId);
    if (!targetGroup) return;
    handleCancelWatchlistSymbolOrder();
    setSelectedWatchlistGroupId(nextGroupId);
    setWatchlistRenameGroupId(nextGroupId);
    setWatchlistRenamePlacement(placement === "main" ? "main" : "sidebar");
    setWatchlistRenameDraft(targetGroup.name);
    setWatchlistRenameError("");
  }, [activeWatchlistGroups, handleCancelWatchlistSymbolOrder, watchlistOrderEditing]);

  const handleSubmitWatchlistGroupRename = useCallback(() => {
    const groupId = cleanTransactionWatchlistGroupId(watchlistRenameGroupId);
    if (!groupId) return;
    const groupName = cleanTransactionWatchlistGroupName(watchlistRenameDraft);
    if (!groupName) {
      setWatchlistRenameError("관심 그룹 이름을 입력하세요.");
      return;
    }
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const targetGroup = currentGroups.find((group) => group.id === groupId);
    if (!targetGroup) {
      handleCancelWatchlistGroupRename();
      return;
    }
    if (targetGroup.name === groupName) {
      handleCancelWatchlistGroupRename();
      return;
    }
    const nextGroups = currentGroups.map((group) => (
      group.id === groupId ? { ...group, name: groupName } : group
    ));
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    handleCancelWatchlistGroupRename();
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    handleCancelWatchlistGroupRename,
    saveTransactionCurrencySettings,
    watchlistOrderEditing,
    watchlistRenameDraft,
    watchlistRenameGroupId,
  ]);

  const handleCreateWatchlistGroup = useCallback(() => {
    const groupName = cleanTransactionWatchlistGroupName(watchlistGroupNameDraft);
    if (!groupName) {
      setWatchlistGroupNameError("관심 그룹 이름을 입력하세요.");
      return;
    }
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const nextGroup = {
      id: createTransactionWatchlistGroupId(),
      name: groupName,
      createdAt: new Date().toISOString(),
      symbols: [],
    };
    const nextGroups = [...currentGroups, nextGroup];
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    setSelectedWatchlistGroupId(nextGroup.id);
    setWatchlistCreateOpen(false);
    setWatchlistGroupNameDraft("");
    setWatchlistGroupNameError("");
    handleCancelWatchlistGroupRename();
    handleCancelWatchlistSymbolOrder();
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
    saveTransactionCurrencySettings,
    watchlistGroupNameDraft,
    watchlistOrderEditing,
  ]);

  const handleRequestDeleteWatchlistGroup = useCallback((group) => {
    setWatchlistDeleteTarget(group);
  }, []);

  const handleCancelDeleteWatchlistGroup = useCallback(() => {
    setWatchlistDeleteTarget(null);
  }, []);

  const handleConfirmDeleteWatchlistGroup = useCallback(() => {
    if (!watchlistDeleteTarget?.id) return;
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const nextGroups = currentGroups.filter((group) => group.id !== watchlistDeleteTarget.id);
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    if (selectedWatchlistGroupId === watchlistDeleteTarget.id) {
      setSelectedWatchlistGroupId(nextGroups[0]?.id || "");
    }
    handleCancelWatchlistGroupRename();
    handleCancelWatchlistSymbolOrder();
    setWatchlistDeleteTarget(null);
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
    saveTransactionCurrencySettings,
    selectedWatchlistGroupId,
    watchlistDeleteTarget,
    watchlistOrderEditing,
  ]);

  const handleSelectWatchlistGroup = useCallback((groupId) => {
    const nextGroupId = cleanTransactionWatchlistGroupId(groupId);
    if (!nextGroupId) return;
    setSelectedWatchlistGroupId(nextGroupId);
    setSelectedWatchlistChartSymbol("");
    if (watchlistRenameGroupId && nextGroupId !== watchlistRenameGroupId) {
      handleCancelWatchlistGroupRename();
    }
    handleCancelWatchlistSymbolOrder();
  }, [
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
    watchlistRenameGroupId,
  ]);

  const handleSelectWatchlistSymbol = useCallback((instrumentValue) => {
    const instrumentId = cleanTransactionInstrumentId(instrumentValue);
    if (!instrumentId || watchlistSymbolOrderEditing) return;
    setSelectedWatchlistChartSymbol(instrumentId);
  }, [watchlistSymbolOrderEditing]);

  const handleCloseWatchlistChart = useCallback(() => {
    setSelectedWatchlistChartSymbol("");
  }, []);

  const handleOpenWatchlistSymbolAdd = useCallback(() => {
    if (watchlistSymbolOrderEditing) return;
    if (!selectedWatchlistGroup) return;
    setWatchlistSymbolDraft("");
    setWatchlistSelectedSymbol(null);
    setWatchlistSymbolError("");
    setWatchlistRemoteSymbolOptions([]);
    setWatchlistSymbolAddOpen(true);
  }, [selectedWatchlistGroup, watchlistSymbolOrderEditing]);

  const handleCancelWatchlistSymbolAdd = useCallback(() => {
    setWatchlistSymbolAddOpen(false);
    setWatchlistSymbolDraft("");
    setWatchlistSelectedSymbol(null);
    setWatchlistSymbolError("");
    setWatchlistRemoteSymbolOptions([]);
  }, []);

  const handleWatchlistSymbolDraftChange = useCallback((nextValue) => {
    setWatchlistSymbolDraft(nextValue);
    const selectedSymbol = cleanTransactionWatchlistSymbol(watchlistSelectedSymbol?.symbol);
    if (selectedSymbol && cleanTransactionWatchlistSymbol(nextValue) !== selectedSymbol) {
      setWatchlistSelectedSymbol(null);
    }
    if (watchlistSymbolError) setWatchlistSymbolError("");
  }, [watchlistSelectedSymbol?.symbol, watchlistSymbolError]);

  const handleWatchlistSymbolSelect = useCallback((option) => {
    const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
    if (!symbol) return;
    setWatchlistSymbolDraft(symbol);
    setWatchlistSelectedSymbol({ ...option, symbol });
    setWatchlistSymbolError("");
    setWatchlistRemoteSymbolOptions((current) => (
      mergeTransactionWatchlistSymbolOptions(current, [{ ...option, symbol }])
    ));
  }, []);

  const handleOpenSimulatorSymbolSearch = useCallback(() => {
    if (!selectedSimulator) return;
    setSimulatorSymbolSearchDraft("");
    setSimulatorSymbolSearchSelection(null);
    setSimulatorSymbolSearchOptions([]);
    setSimulatorSymbolSearchError("");
    setSimulatorSymbolSearchOpen(true);
  }, [selectedSimulator]);

  const handleCancelSimulatorSymbolSearch = useCallback(() => {
    setSimulatorSymbolSearchOpen(false);
    setSimulatorSymbolSearchDraft("");
    setSimulatorSymbolSearchSelection(null);
    setSimulatorSymbolSearchOptions([]);
    setSimulatorSymbolSearchError("");
  }, []);

  const handleSimulatorSymbolSearchDraftChange = useCallback((nextValue) => {
    setSimulatorSymbolSearchDraft(nextValue);
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorSymbolSearchSelection?.symbol);
    if (selectedSymbol && cleanTransactionWatchlistSymbol(nextValue) !== selectedSymbol) {
      setSimulatorSymbolSearchSelection(null);
    }
    if (simulatorSymbolSearchError) setSimulatorSymbolSearchError("");
  }, [simulatorSymbolSearchError, simulatorSymbolSearchSelection?.symbol]);

  const handleSimulatorSymbolSearchSelect = useCallback((option) => {
    const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
    if (!symbol) return;
    const normalizedOption = { ...option, symbol };
    setSimulatorSymbolSearchDraft(symbol);
    setSimulatorSymbolSearchSelection(normalizedOption);
    setSimulatorSymbolSearchOptions((current) => (
      mergeTransactionWatchlistSymbolOptions(current, [normalizedOption])
    ));
    setSimulatorSymbolSearchError("");
  }, []);

  const handleOpenSimulatorBuy = useCallback((sourceItem = null, options = {}) => {
    if (!selectedSimulator) return;
    const selectedPositionSymbol = transactionSimulatorStockOptionFromItem(sourceItem);
    const requestedOrderUnit = normalizeMoneyUnit(options?.unit || mainUnit);
    const settlementUnit = selectedPositionSymbol
      ? transactionSimulatorSettlementUnit(selectedPositionSymbol)
      : requestedOrderUnit;
    const orderUnit = requestedOrderUnit === settlementUnit ||
      convertMoney(1, settlementUnit, requestedOrderUnit, usdKrwRate) !== null
      ? requestedOrderUnit
      : settlementUnit;
    setSimulatorSellOpen(false);
    setSimulatorSellPosition(null);
    setSimulatorBuyBusy(false);
    setSimulatorBuyUnit(orderUnit);
    setSimulatorBuySymbolDraft(selectedPositionSymbol?.symbol || "");
    setSimulatorBuySelectedSymbol(selectedPositionSymbol);
    setSimulatorBuyRemoteSymbolOptions([]);
    setSimulatorBuyAmountDraft("");
    setSimulatorBuyError("");
    setSimulatorBuyMarketCalendar(null);
    setSimulatorBuyMarketCalendarLoading(false);
    setSimulatorBuyMarketCalendarError("");
    simulatorBuyIdempotencyKeyRef.current = "";
    setSimulatorBuyOpen(true);
  }, [mainUnit, selectedSimulator, usdKrwRate]);

  const handleCancelSimulatorBuy = useCallback(() => {
    if (simulatorBuyBusy) return;
    setSimulatorBuyOpen(false);
    setSimulatorBuyBusy(false);
    setSimulatorBuySymbolDraft("");
    setSimulatorBuySelectedSymbol(null);
    setSimulatorBuyRemoteSymbolOptions([]);
    setSimulatorBuyAmountDraft("");
    setSimulatorBuyError("");
    setSimulatorBuyMarketCalendar(null);
    setSimulatorBuyMarketCalendarLoading(false);
    setSimulatorBuyMarketCalendarError("");
    simulatorBuyIdempotencyKeyRef.current = "";
  }, [simulatorBuyBusy]);

  const handleSimulatorBuySymbolDraftChange = useCallback((nextValue) => {
    setSimulatorBuySymbolDraft(nextValue);
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorBuySelectedSymbol?.symbol);
    if (selectedSymbol && cleanTransactionWatchlistSymbol(nextValue) !== selectedSymbol) {
      setSimulatorBuySelectedSymbol(null);
      setSimulatorBuyAmountDraft("");
      setSimulatorBuyMarketCalendar(null);
      setSimulatorBuyMarketCalendarLoading(false);
      setSimulatorBuyMarketCalendarError("");
      simulatorBuyIdempotencyKeyRef.current = "";
    }
    if (simulatorBuyError) setSimulatorBuyError("");
  }, [simulatorBuyError, simulatorBuySelectedSymbol?.symbol]);

  const handleSimulatorBuySelectSymbol = useCallback((option) => {
    const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
    if (!symbol) return;
    const selectedInstrument = normalizeTransactionInstrument({ ...option, symbol });
    const settlementUnit = transactionSimulatorSettlementUnit(selectedInstrument);
    setSimulatorBuyUnit((currentUnit) => (
      currentUnit === settlementUnit || convertMoney(1, settlementUnit, currentUnit, usdKrwRate) !== null
        ? currentUnit
        : settlementUnit
    ));
    setSimulatorBuySelectedSymbol(selectedInstrument);
    setSimulatorBuySymbolDraft(symbol);
    setSimulatorBuyAmountDraft("");
    setSimulatorBuyError("");
    setSimulatorBuyMarketCalendar(null);
    setSimulatorBuyMarketCalendarLoading(false);
    setSimulatorBuyMarketCalendarError("");
    simulatorBuyIdempotencyKeyRef.current = "";
  }, [usdKrwRate]);

  const handleSimulatorBuyAmountChange = useCallback((nextValue) => {
    setSimulatorBuyAmountDraft(cleanTransactionSimulatorBuyAmountDraft(nextValue, simulatorBuyUnit));
    simulatorBuyIdempotencyKeyRef.current = "";
    if (simulatorBuyError) setSimulatorBuyError("");
  }, [simulatorBuyError, simulatorBuyUnit]);

  const handleSimulatorBuyPresetAmount = useCallback((amount) => {
    setSimulatorBuyAmountDraft(formatTransactionSimulatorBuyAmountDraft(amount, simulatorBuyUnit));
    simulatorBuyIdempotencyKeyRef.current = "";
    setSimulatorBuyError("");
  }, [simulatorBuyUnit]);

  const handleSubmitSimulatorBuy = useCallback(async (order) => {
    if (!selectedSimulator?.id || simulatorBuyBusy) return;
    const symbol = cleanTransactionWatchlistSymbol(order?.symbol);
    if (!symbol) {
      setSimulatorBuyError("매수할 종목을 선택하세요.");
      return;
    }
    const settlementUnit = normalizeMoneyUnit(order?.settlementUnit);
    const instrument = normalizeTransactionInstrument({ ...simulatorBuySelectedSymbol, ...order, symbol });
    if (instrument.provider === "binance") {
      const availability = transactionBinanceProviderAvailability(binanceProviderStatus, binanceProviderError);
      if (!availability.available) {
        setSimulatorBuyError(availability.reason);
        return;
      }
    }
    const settlementAmount = Number(order?.settlementAmount || 0);
    if (!Number.isFinite(settlementAmount) || settlementAmount <= 0) {
      setSimulatorBuyError("주문 금액을 입력하세요.");
      return;
    }
    setSimulatorBuyBusy(true);
    setSimulatorBuyError("");
    try {
      const execution = await fetchTransactionSimulatorExecutionPrice(instrument, settlementUnit);
      const quantity = settlementAmount / execution.price;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("체결 수량을 계산하지 못했습니다.");
      }
      const idempotencyKey = simulatorBuyIdempotencyKeyRef.current ||
        createTransactionSimulatorOrderIdempotencyKey("buy", selectedSimulator.id, instrument.instrumentId);
      simulatorBuyIdempotencyKeyRef.current = idempotencyKey;
      const body = await postInvestSimulatorBuy({
        simulatorId: selectedSimulator.id,
        instrumentId: instrument.instrumentId,
        provider: instrument.provider,
        venue: instrument.venue,
        assetClass: instrument.assetClass,
        displaySymbol: instrument.displaySymbol,
        baseAsset: instrument.baseAsset,
        quoteAsset: instrument.quoteAsset,
        settlementAsset: instrument.settlementAsset || settlementUnit,
        nativeQuoteAsset: instrument.nativeQuoteAsset,
        sessionPolicy: instrument.sessionPolicy,
        status: instrument.status,
        feeAmount: 0,
        feeAssumption: "zero-no-public-account-rate",
        symbol,
        symbolName: order?.symbolName || simulatorBuySelectedSymbol?.name || symbol,
        englishName: simulatorBuySelectedSymbol?.englishName || "",
        market: order?.market || simulatorBuySelectedSymbol?.market || "",
        marketCountry: instrument.provider === "binance" ? "GLOBAL" : settlementUnit === "KRW" ? "KR" : "US",
        orderUnit: normalizeMoneyUnit(order?.orderUnit),
        orderAmount: order?.orderAmount,
        settlementCurrency: settlementUnit,
        settlementAmount,
        price: execution.price,
        priceCurrency: execution.currency,
        quantity,
        priceTimestamp: execution.timestamp,
        priceSource: execution.source,
        marketSession: order?.marketSession || "",
        idempotencyKey,
      });
      setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
      showSimulatorOrderNotification({
        side: "buy",
        symbol,
        amount: settlementAmount,
        unit: settlementUnit,
      });
      setSimulatorBuyOpen(false);
      setSimulatorBuySymbolDraft("");
      setSimulatorBuySelectedSymbol(null);
      setSimulatorBuyRemoteSymbolOptions([]);
      setSimulatorBuyAmountDraft("");
      setSimulatorBuyMarketCalendar(null);
      setSimulatorBuyMarketCalendarLoading(false);
      setSimulatorBuyMarketCalendarError("");
      simulatorBuyIdempotencyKeyRef.current = "";
    } catch (fetchError) {
      setSimulatorBuyError(fetchError.message || "주문을 체결하지 못했습니다.");
    } finally {
      setSimulatorBuyBusy(false);
    }
  }, [
    selectedSimulator?.id,
    binanceProviderError,
    binanceProviderStatus,
    showSimulatorOrderNotification,
    simulatorBuyBusy,
    simulatorBuySelectedSymbol,
  ]);

  const handleOpenSimulatorSell = useCallback((position, options = {}) => {
    if (!selectedSimulator) return;
    const selectedPositionSymbol = transactionSimulatorStockOptionFromItem(position);
    if (!selectedPositionSymbol) return;
    const requestedOrderUnit = normalizeMoneyUnit(options?.unit || mainUnit);
    const settlementUnit = transactionSimulatorSettlementUnit(selectedPositionSymbol);
    const orderUnit = requestedOrderUnit === settlementUnit ||
      convertMoney(1, settlementUnit, requestedOrderUnit, usdKrwRate) !== null
      ? requestedOrderUnit
      : settlementUnit;
    setSimulatorBuyOpen(false);
    setSimulatorSellBusy(false);
    setSimulatorSellUnit(orderUnit);
    setSimulatorSellPosition(position);
    setSimulatorSellAmountDraft("");
    setSimulatorSellError("");
    setSimulatorSellMarketCalendar(null);
    setSimulatorSellMarketCalendarLoading(false);
    setSimulatorSellMarketCalendarError("");
    simulatorSellIdempotencyKeyRef.current = "";
    setSimulatorSellOpen(true);
  }, [mainUnit, selectedSimulator, usdKrwRate]);

  const handleCancelSimulatorSell = useCallback(() => {
    if (simulatorSellBusy) return;
    setSimulatorSellOpen(false);
    setSimulatorSellBusy(false);
    setSimulatorSellPosition(null);
    setSimulatorSellAmountDraft("");
    setSimulatorSellError("");
    setSimulatorSellMarketCalendar(null);
    setSimulatorSellMarketCalendarLoading(false);
    setSimulatorSellMarketCalendarError("");
    simulatorSellIdempotencyKeyRef.current = "";
  }, [simulatorSellBusy]);

  const handleSimulatorSellAmountChange = useCallback((nextValue) => {
    setSimulatorSellAmountDraft(cleanTransactionSimulatorBuyAmountDraft(nextValue, simulatorSellUnit));
    simulatorSellIdempotencyKeyRef.current = "";
    if (simulatorSellError) setSimulatorSellError("");
  }, [simulatorSellError, simulatorSellUnit]);

  const handleSimulatorSellPresetFraction = useCallback((fraction) => {
    const position = simulatorSellPosition;
    const settlementUnit = normalizeMoneyUnit(position?.currency || position?.displayCurrency || "KRW");
    const holdingSettlementValue = transactionSimulatorPositionSettlementValue(position);
    const holdingOrderValue = convertMoney(holdingSettlementValue, settlementUnit, simulatorSellUnit, usdKrwRate);
    if (holdingOrderValue === null || holdingOrderValue <= 0) return;
    const nextAmount = holdingOrderValue * Number(fraction || 0);
    setSimulatorSellAmountDraft(formatTransactionSimulatorBuyAmountDraft(nextAmount, simulatorSellUnit));
    simulatorSellIdempotencyKeyRef.current = "";
    setSimulatorSellError("");
  }, [simulatorSellPosition, simulatorSellUnit, usdKrwRate]);

  const handleSubmitSimulatorSell = useCallback(async (order) => {
    if (!selectedSimulator?.id || !simulatorSellPosition || simulatorSellBusy) return;
    const symbol = cleanTransactionWatchlistSymbol(order?.symbol);
    if (!symbol) {
      setSimulatorSellError("매도할 종목을 찾지 못했습니다.");
      return;
    }
    const settlementUnit = normalizeMoneyUnit(order?.settlementUnit);
    const instrument = normalizeTransactionInstrument({ ...simulatorSellPosition, ...order, symbol });
    if (instrument.provider === "binance") {
      const availability = transactionBinanceProviderAvailability(binanceProviderStatus, binanceProviderError);
      if (!availability.available) {
        setSimulatorSellError(availability.reason);
        return;
      }
    }
    const requestedSettlementAmount = Number(order?.settlementAmount || 0);
    if (!Number.isFinite(requestedSettlementAmount) || requestedSettlementAmount <= 0) {
      setSimulatorSellError("주문 금액을 입력하세요.");
      return;
    }
    setSimulatorSellBusy(true);
    setSimulatorSellError("");
    try {
      const execution = await fetchTransactionSimulatorExecutionPrice(instrument, settlementUnit);
      const heldQuantity = numericAmount(simulatorSellPosition.quantity, 0);
      const holdingSettlementValue = transactionSimulatorPositionSettlementValue(simulatorSellPosition);
      const shouldSellAll = requestedSettlementAmount >= holdingSettlementValue * 0.999;
      let quantity = shouldSellAll ? heldQuantity : requestedSettlementAmount / execution.price;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("체결 수량을 계산하지 못했습니다.");
      }
      if (quantity > heldQuantity) {
        if (shouldSellAll || quantity - heldQuantity < 0.0000001) {
          quantity = heldQuantity;
        } else {
          throw new Error("보유 수량보다 많이 매도할 수 없습니다.");
        }
      }
      const settlementAmount = quantity * execution.price;
      const idempotencyKey = simulatorSellIdempotencyKeyRef.current ||
        createTransactionSimulatorOrderIdempotencyKey("sell", selectedSimulator.id, instrument.instrumentId);
      simulatorSellIdempotencyKeyRef.current = idempotencyKey;
      const body = await postInvestSimulatorSell({
        simulatorId: selectedSimulator.id,
        instrumentId: instrument.instrumentId,
        provider: instrument.provider,
        venue: instrument.venue,
        assetClass: instrument.assetClass,
        displaySymbol: instrument.displaySymbol,
        baseAsset: instrument.baseAsset,
        quoteAsset: instrument.quoteAsset,
        settlementAsset: instrument.settlementAsset || settlementUnit,
        nativeQuoteAsset: instrument.nativeQuoteAsset,
        sessionPolicy: instrument.sessionPolicy,
        status: instrument.status,
        feeAmount: 0,
        feeAssumption: "zero-no-public-account-rate",
        symbol,
        symbolName: order?.symbolName || simulatorSellPosition.label || simulatorSellPosition.name || symbol,
        englishName: order?.englishName || simulatorSellPosition.englishName || "",
        market: order?.market || simulatorSellPosition.market || "",
        marketCountry: instrument.provider === "binance" ? "GLOBAL" : settlementUnit === "KRW" ? "KR" : "US",
        orderUnit: normalizeMoneyUnit(order?.orderUnit),
        orderAmount: order?.orderAmount,
        settlementCurrency: settlementUnit,
        settlementAmount,
        price: execution.price,
        priceCurrency: execution.currency,
        quantity,
        priceTimestamp: execution.timestamp,
        priceSource: execution.source,
        marketSession: order?.marketSession || "",
        idempotencyKey,
      });
      setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
      showSimulatorOrderNotification({
        side: "sell",
        symbol,
        amount: settlementAmount,
        unit: settlementUnit,
      });
      setSimulatorSellOpen(false);
      setSimulatorSellPosition(null);
      setSimulatorSellAmountDraft("");
      setSimulatorSellMarketCalendar(null);
      setSimulatorSellMarketCalendarLoading(false);
      setSimulatorSellMarketCalendarError("");
      simulatorSellIdempotencyKeyRef.current = "";
    } catch (fetchError) {
      setSimulatorSellError(fetchError.message || "주문을 체결하지 못했습니다.");
    } finally {
      setSimulatorSellBusy(false);
    }
  }, [
    selectedSimulator?.id,
    binanceProviderError,
    binanceProviderStatus,
    showSimulatorOrderNotification,
    simulatorSellBusy,
    simulatorSellPosition,
  ]);

  const handleOpenSidebarSimulatorBuy = useCallback((item) => {
    handleOpenSimulatorBuy(item, { unit: sidebarUnit });
  }, [handleOpenSimulatorBuy, sidebarUnit]);

  const handleOpenSidebarSimulatorSell = useCallback((item) => {
    handleOpenSimulatorSell(item, { unit: sidebarUnit });
  }, [handleOpenSimulatorSell, sidebarUnit]);

  const handleOpenDetailSimulatorBuy = useCallback((item) => {
    handleOpenSimulatorBuy(item, { unit: mainUnit });
  }, [handleOpenSimulatorBuy, mainUnit]);

  const handleOpenDetailSimulatorSell = useCallback((item) => {
    handleOpenSimulatorSell(item, { unit: mainUnit });
  }, [handleOpenSimulatorSell, mainUnit]);

  const handleOpenSimulatorExchange = useCallback((modeId = "KRW_TO_USD") => {
    if (!selectedSimulator) return;
    const mode = transactionSimulatorExchangeMode(modeId);
    setSimulatorExchangeMode(mode.id);
    setSimulatorExchangeAmountDraft("");
    setSimulatorExchangeError("");
    setSimulatorExchangeOpen(true);
  }, [selectedSimulator]);

  const handleCancelSimulatorExchange = useCallback(() => {
    if (simulatorExchangeBusy) return;
    setSimulatorExchangeOpen(false);
    setSimulatorExchangeMode("KRW_TO_USD");
    setSimulatorExchangeAmountDraft("");
    setSimulatorExchangeError("");
  }, [simulatorExchangeBusy]);

  const handleSimulatorExchangeModeChange = useCallback((modeId) => {
    const mode = transactionSimulatorExchangeMode(modeId);
    setSimulatorExchangeMode(mode.id);
    setSimulatorExchangeAmountDraft("");
    setSimulatorExchangeError("");
  }, []);

  const handleSimulatorExchangeAmountChange = useCallback((nextValue) => {
    setSimulatorExchangeAmountDraft(cleanTransactionSimulatorExchangeAmountDraft(nextValue, simulatorExchangeMode));
    if (simulatorExchangeError) setSimulatorExchangeError("");
  }, [simulatorExchangeError, simulatorExchangeMode]);

  const handleSubmitSimulatorExchange = useCallback(async (exchange) => {
    if (!selectedSimulator?.id || simulatorExchangeBusy) return;
    setSimulatorExchangeBusy(true);
    setSimulatorExchangeError("");
    try {
      const body = await postInvestSimulatorExchange({
        simulatorId: selectedSimulator.id,
        fromCurrency: exchange.fromCurrency,
        toCurrency: exchange.toCurrency,
        fromAmount: exchange.fromAmount,
        toAmount: exchange.toAmount,
        rate: exchange.rate,
      });
      setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
      setSimulatorExchangeOpen(false);
      setSimulatorExchangeAmountDraft("");
      setSimulatorExchangeError("");
    } catch (fetchError) {
      setSimulatorExchangeError(fetchError.message || "환전을 저장하지 못했습니다.");
    } finally {
      setSimulatorExchangeBusy(false);
    }
  }, [selectedSimulator?.id, simulatorExchangeBusy]);

  const handleAddWatchlistSymbol = useCallback(async () => {
    if (!selectedWatchlistGroup?.id) return;
    const symbol = cleanTransactionWatchlistSymbol(watchlistSymbolDraft);
    const rawInput = String(watchlistSymbolDraft || "").trim();
    if (!rawInput) {
      setWatchlistSymbolError("티커 / 종목번호 / 종목명을 입력하세요.");
      return;
    }
    let nextSymbolOptions = watchlistSymbolOptions;
    let matchedSymbol = resolveTransactionWatchlistSymbolInput(watchlistSymbolDraft, nextSymbolOptions);
    let matchedInstrument = normalizeTransactionInstrument(watchlistSelectedSymbol);
    if (!matchedInstrument || matchedInstrument.symbol !== symbol) {
      matchedInstrument = matchedSymbol
        ? normalizeTransactionInstrument(nextSymbolOptions.find((option) => option.symbol === matchedSymbol))
        : null;
    }
    if (!matchedInstrument) {
      try {
        const catalogOptions = await fetchTransactionWatchlistCatalogOptions(watchlistSymbolDraft);
        nextSymbolOptions = mergeTransactionWatchlistSymbolOptions(nextSymbolOptions, catalogOptions);
        if (catalogOptions.length) {
          setWatchlistRemoteSymbolOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, catalogOptions)
          ));
        }
        matchedSymbol = resolveTransactionWatchlistSymbolInput(watchlistSymbolDraft, nextSymbolOptions);
        matchedInstrument = matchedSymbol
          ? normalizeTransactionInstrument(nextSymbolOptions.find((option) => option.symbol === matchedSymbol))
          : null;
      } catch {
        // The validation message below is enough for a failed fallback lookup.
      }
    }
    if (!matchedInstrument && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
      matchedInstrument = normalizeTransactionInstrument({ symbol, provider: "toss" });
      matchedSymbol = symbol;
    }
    if (!matchedInstrument || !matchedSymbol) {
      setWatchlistSymbolError("Toss 또는 Binance 목록에서 확인할 수 없는 티커 / 종목번호 / 종목명입니다.");
      return;
    }
    if (matchedInstrument.provider === "binance") {
      if (matchedInstrument.status !== "TRADING") {
        setWatchlistSymbolError("현재 TRADING 상태인 Binance 상품만 추가할 수 있습니다.");
        return;
      }
    } else try {
      const body = await fetchTossStockOptions([matchedSymbol]);
      const options = transactionWatchlistStockOptionsFromPayload(body);
      if (!options.some((option) => cleanTransactionWatchlistSymbol(option.symbol) === matchedSymbol)) {
        setWatchlistSymbolError("Toss에서 조회할 수 없는 종목입니다.");
        return;
      }
      setWatchlistRemoteSymbolOptions((current) => (
        mergeTransactionWatchlistSymbolOptions(current, options)
      ));
    } catch {
      setWatchlistSymbolError("Toss 종목 확인에 실패했습니다.");
      return;
    }
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const currentGroup = currentGroups.find((group) => group.id === selectedWatchlistGroup.id);
    if (!currentGroup) {
      setWatchlistSymbolError("선택된 관심 그룹을 찾지 못했습니다.");
      return;
    }
    const currentSymbols = normalizeTransactionWatchlistSymbolsSetting(currentGroup.symbols);
    const currentInstruments = normalizeTransactionWatchlistInstrumentsSetting(currentGroup.instruments, currentGroup.symbols);
    if (currentInstruments.some((instrument) => instrument.instrumentId === matchedInstrument.instrumentId)) {
      setWatchlistSymbolError("이미 추가된 종목입니다.");
      return;
    }
    const nextInstruments = [...currentInstruments, matchedInstrument];
    const nextGroups = currentGroups.map((group) => (
      group.id === selectedWatchlistGroup.id
        ? { ...group, symbols: [...currentSymbols, matchedSymbol], instruments: nextInstruments }
        : group
    ));
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    setWatchlistSymbolAddOpen(false);
    setWatchlistSymbolDraft("");
    setWatchlistSelectedSymbol(null);
    setWatchlistSymbolError("");
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    saveTransactionCurrencySettings,
    selectedWatchlistGroup,
    watchlistOrderEditing,
    watchlistSelectedSymbol,
    watchlistSymbolOptions,
    watchlistSymbolDraft,
  ]);

  const handleRemoveWatchlistSymbol = useCallback((instrumentValue) => {
    if (!selectedWatchlistGroup?.id) return;
    const instrumentId = cleanTransactionInstrumentId(instrumentValue);
    const symbol = cleanTransactionWatchlistSymbol(instrumentValue);
    if (!instrumentId && !symbol) return;
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const nextGroups = currentGroups.map((group) => {
      if (group.id !== selectedWatchlistGroup.id) return group;
      const instruments = normalizeTransactionWatchlistInstrumentsSetting(group.instruments, group.symbols)
        .filter((item) => instrumentId ? item.instrumentId !== instrumentId : item.symbol !== symbol);
      return {
        ...group,
        symbols: normalizeTransactionWatchlistSymbolsSetting(instruments),
        instruments,
      };
    });
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    saveTransactionCurrencySettings,
    selectedWatchlistGroup,
    watchlistOrderEditing,
  ]);

  const handleWatchlistOrderEditStart = useCallback(() => {
    handleCancelWatchlistGroupRename();
    handleCancelWatchlistSymbolOrder();
    setWatchlistOrderDraft(normalizeTransactionWatchlistGroupsSetting(currencySettings.watchlistGroups, []));
    setWatchlistOrderEditing(true);
  }, [
    currencySettings.watchlistGroups,
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
  ]);

  const handleWatchlistOrderChange = useCallback((nextGroups) => {
    setWatchlistOrderDraft(normalizeTransactionWatchlistGroupsSetting(nextGroups, []));
  }, []);

  const handleWatchlistOrderSave = useCallback(() => {
    const nextGroups = normalizeTransactionWatchlistGroupsSetting(watchlistOrderDraft, []);
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    setWatchlistOrderEditing(false);
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [saveTransactionCurrencySettings, watchlistOrderDraft]);

  const handleWatchlistSymbolOrderEditStart = useCallback(() => {
    if (!selectedWatchlistGroup?.id) return;
    const instrumentOrder = normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup.instruments,
      selectedWatchlistGroup.symbols,
    ).map((instrument) => instrument.instrumentId);
    if (instrumentOrder.length < 2) return;
    handleCancelWatchlistGroupRename();
    setWatchlistSymbolOrderDraft(instrumentOrder);
    setWatchlistSymbolOrderEditing(true);
  }, [handleCancelWatchlistGroupRename, selectedWatchlistGroup]);

  const handleWatchlistSymbolOrderChange = useCallback((nextSymbols) => {
    setWatchlistSymbolOrderDraft(normalizeTransactionWatchlistInstrumentOrder(nextSymbols));
  }, []);

  const handleWatchlistSymbolOrderSave = useCallback(() => {
    if (!selectedWatchlistGroup?.id) {
      handleCancelWatchlistSymbolOrder();
      return;
    }
    const nextInstrumentOrder = normalizeTransactionWatchlistInstrumentOrder(watchlistSymbolOrderDraft);
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const currentGroup = currentGroups.find((group) => group.id === selectedWatchlistGroup.id);
    if (!currentGroup) {
      handleCancelWatchlistSymbolOrder();
      return;
    }
    const nextGroups = currentGroups.map((group) => (
      group.id === selectedWatchlistGroup.id
        ? (() => {
            const instruments = transactionWatchlistInstrumentsInOrder(group, nextInstrumentOrder);
            return {
              ...group,
              symbols: normalizeTransactionWatchlistSymbolsSetting(instruments),
              instruments,
            };
          })()
        : group
    ));
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    handleCancelWatchlistSymbolOrder();
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    handleCancelWatchlistSymbolOrder,
    saveTransactionCurrencySettings,
    selectedWatchlistGroup,
    watchlistOrderEditing,
    watchlistSymbolOrderDraft,
  ]);

  useEffect(() => {
    if (!watchlistRenameGroupId) return;
    if (normalizedWatchlistGroups.some((group) => group.id === watchlistRenameGroupId)) return;
    handleCancelWatchlistGroupRename();
  }, [
    handleCancelWatchlistGroupRename,
    normalizedWatchlistGroups,
    watchlistRenameGroupId,
  ]);

  useEffect(() => {
    if (!watchlistSymbolOrderEditing) return;
    if (selectedWatchlistGroup?.id) return;
    handleCancelWatchlistSymbolOrder();
  }, [
    handleCancelWatchlistSymbolOrder,
    selectedWatchlistGroup?.id,
    watchlistSymbolOrderEditing,
  ]);

  useEffect(() => {
    if (
      !watchlistCreateOpen &&
      !watchlistDeleteTarget &&
      !watchlistSymbolAddOpen &&
      !simulatorSymbolSearchOpen &&
      !simulatorBuyOpen &&
      !simulatorSellOpen &&
      !simulatorExchangeOpen
    ) {
      return undefined;
    }
    function handleDialogKeyDown(event) {
      if (event.key !== "Escape") return;
      if (watchlistCreateOpen) handleCancelWatchlistCreate();
      if (watchlistDeleteTarget) handleCancelDeleteWatchlistGroup();
      if (watchlistSymbolAddOpen) handleCancelWatchlistSymbolAdd();
      if (simulatorSymbolSearchOpen) handleCancelSimulatorSymbolSearch();
      if (simulatorBuyOpen) handleCancelSimulatorBuy();
      if (simulatorSellOpen) handleCancelSimulatorSell();
      if (simulatorExchangeOpen) handleCancelSimulatorExchange();
    }
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => document.removeEventListener("keydown", handleDialogKeyDown);
  }, [
    handleCancelDeleteWatchlistGroup,
    handleCancelSimulatorBuy,
    handleCancelSimulatorSymbolSearch,
    handleCancelSimulatorSell,
    handleCancelSimulatorExchange,
    handleCancelWatchlistCreate,
    handleCancelWatchlistSymbolAdd,
    simulatorExchangeOpen,
    simulatorBuyOpen,
    simulatorSellOpen,
    simulatorSymbolSearchOpen,
    watchlistCreateOpen,
    watchlistDeleteTarget,
    watchlistSymbolAddOpen,
  ]);

  useEffect(() => {
    if (!watchlistSymbolAddOpen) return undefined;
    const query = String(watchlistSymbolDraft || "").trim();
    const symbol = cleanTransactionWatchlistSymbol(watchlistSymbolDraft);
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const optionGroups = [await fetchTransactionWatchlistCatalogOptions(query, controller.signal)];
        if (liveFetchGate.ready && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
          const body = await fetchTossStockOptions([symbol], controller.signal);
          optionGroups.push(transactionWatchlistStockOptionsFromPayload(body));
        }
        const options = mergeTransactionWatchlistSymbolOptions(...optionGroups);
        if (!controller.signal.aborted && options.length) {
          setWatchlistRemoteSymbolOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, options)
          ));
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          // Lookup failures should not block local holdings suggestions or manual retry.
        }
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [liveFetchGate.ready, watchlistSymbolAddOpen, watchlistSymbolDraft]);

  useEffect(() => {
    if (!simulatorBuyOpen) return undefined;
    const query = String(simulatorBuySymbolDraft || "").trim();
    const symbol = cleanTransactionWatchlistSymbol(simulatorBuySymbolDraft);
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const optionGroups = [await fetchTransactionWatchlistCatalogOptions(query, controller.signal)];
        if (liveFetchGate.ready && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
          const body = await fetchTossStockOptions([symbol], controller.signal);
          optionGroups.push(transactionWatchlistStockOptionsFromPayload(body));
        }
        const options = mergeTransactionWatchlistSymbolOptions(...optionGroups);
        if (!controller.signal.aborted && options.length) {
          setSimulatorBuyRemoteSymbolOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, options)
          ));
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          // Lookup failures leave the user with any existing local suggestions.
        }
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [liveFetchGate.ready, simulatorBuyOpen, simulatorBuySymbolDraft]);

  useEffect(() => {
    if (!simulatorSymbolSearchOpen) return undefined;
    const query = String(simulatorSymbolSearchDraft || "").trim();
    const symbol = cleanTransactionWatchlistSymbol(simulatorSymbolSearchDraft);
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const optionGroups = [await fetchTransactionWatchlistCatalogOptions(query, controller.signal)];
        if (liveFetchGate.ready && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
          const body = await fetchTossStockOptions([symbol], controller.signal);
          optionGroups.push(transactionWatchlistStockOptionsFromPayload(body));
        }
        const options = mergeTransactionWatchlistSymbolOptions(...optionGroups);
        if (!controller.signal.aborted && options.length) {
          setSimulatorSymbolSearchOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, options)
          ));
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          // Search keeps any locally available holdings and watchlist suggestions.
        }
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [liveFetchGate.ready, simulatorSymbolSearchDraft, simulatorSymbolSearchOpen]);

  useEffect(() => {
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorBuySelectedSymbol?.symbol);
    if (!simulatorBuyOpen || !selectedSymbol) return;
    if (simulatorBuySelectedSymbol?.koreanMarketDetail) return;
    const enrichedOption = simulatorBuySymbolOptions.find((option) => (
      cleanTransactionWatchlistSymbol(option.symbol) === selectedSymbol && option.koreanMarketDetail
    ));
    if (!enrichedOption) return;
    setSimulatorBuySelectedSymbol((current) => {
      if (cleanTransactionWatchlistSymbol(current?.symbol) !== selectedSymbol || current?.koreanMarketDetail) return current;
      return { ...current, ...enrichedOption, symbol: selectedSymbol };
    });
  }, [simulatorBuyOpen, simulatorBuySelectedSymbol?.koreanMarketDetail, simulatorBuySelectedSymbol?.symbol, simulatorBuySymbolOptions]);

  useEffect(() => {
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorBuySelectedSymbol?.symbol);
    if (!simulatorBuyOpen || !selectedSymbol) {
      setSimulatorBuyMarketCalendar(null);
      setSimulatorBuyMarketCalendarLoading(false);
      setSimulatorBuyMarketCalendarError("");
      return undefined;
    }
    if (itemIsCrypto(simulatorBuySelectedSymbol)) {
      setSimulatorBuyMarketCalendar(null);
      setSimulatorBuyMarketCalendarLoading(false);
      setSimulatorBuyMarketCalendarError("");
      return undefined;
    }
    const settlementUnit = transactionSimulatorSettlementUnit(simulatorBuySelectedSymbol);
    const marketCode = transactionSimulatorMarketCalendarCode(settlementUnit);
    const calendarDate = transactionSimulatorCalendarDate(settlementUnit);
    const controller = new AbortController();

    async function loadSimulatorBuyMarketCalendar() {
      setSimulatorBuyMarketCalendarLoading(true);
      setSimulatorBuyMarketCalendarError("");
      try {
        const body = await fetchTossMarketCalendar(marketCode, calendarDate, controller.signal);
        if (!controller.signal.aborted) {
          setSimulatorBuyMarketCalendar(body);
          setSimulatorBuyMarketCalendarError("");
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setSimulatorBuyMarketCalendar(null);
          setSimulatorBuyMarketCalendarError(fetchError.message || "장 운영 정보를 확인하지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSimulatorBuyMarketCalendarLoading(false);
        }
      }
    }

    void loadSimulatorBuyMarketCalendar();
    return () => controller.abort();
  }, [
    simulatorBuyOpen,
    simulatorBuySelectedSymbol?.market,
    simulatorBuySelectedSymbol?.symbol,
  ]);

  useEffect(() => {
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorSellPosition?.symbol);
    if (!simulatorSellOpen || !selectedSymbol) {
      setSimulatorSellMarketCalendar(null);
      setSimulatorSellMarketCalendarLoading(false);
      setSimulatorSellMarketCalendarError("");
      return undefined;
    }
    if (itemIsCrypto(simulatorSellPosition)) {
      setSimulatorSellMarketCalendar(null);
      setSimulatorSellMarketCalendarLoading(false);
      setSimulatorSellMarketCalendarError("");
      return undefined;
    }
    const settlementUnit = normalizeMoneyUnit(simulatorSellPosition?.currency || simulatorSellPosition?.displayCurrency || "KRW");
    const marketCode = transactionSimulatorMarketCalendarCode(settlementUnit);
    const calendarDate = transactionSimulatorCalendarDate(settlementUnit);
    const controller = new AbortController();

    async function loadSimulatorSellMarketCalendar() {
      setSimulatorSellMarketCalendarLoading(true);
      setSimulatorSellMarketCalendarError("");
      try {
        const body = await fetchTossMarketCalendar(marketCode, calendarDate, controller.signal);
        if (!controller.signal.aborted) {
          setSimulatorSellMarketCalendar(body);
          setSimulatorSellMarketCalendarError("");
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setSimulatorSellMarketCalendar(null);
          setSimulatorSellMarketCalendarError(fetchError.message || "장 운영 정보를 확인하지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSimulatorSellMarketCalendarLoading(false);
        }
      }
    }

    void loadSimulatorSellMarketCalendar();
    return () => controller.abort();
  }, [
    simulatorSellOpen,
    simulatorSellPosition?.currency,
    simulatorSellPosition?.displayCurrency,
    simulatorSellPosition?.symbol,
  ]);

  useEffect(() => {
    function closeMenu(event) {
      if (!sortOpen && !accountOpen) return;
      if (rootRef.current?.contains(event.target)) return;
      setSortOpen(false);
      setAccountOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [sortOpen, accountOpen]);

  const handleCancelSimulatorRename = useCallback(() => {
    if (simulatorRenameBusy) return;
    setSimulatorRenameTarget(null);
    setSimulatorRenameDraft("");
    setSimulatorRenameError("");
  }, [simulatorRenameBusy]);

  const handleSimulatorRenameStart = useCallback((simulator, placement = "main") => {
    if (simulatorRenameBusy) return;
    const simulatorId = cleanTransactionSimulatorId(simulator?.id);
    if (!simulatorId) return;
    setAccountOpen(false);
    const normalizedPlacement = placement === "sideTotal" ? "sideTotal" : "main";
    setSimulatorRenameTarget({
      simulatorId,
      placement: normalizedPlacement,
    });
    setSimulatorRenameDraft(cleanTransactionSimulatorName(simulator?.name) || simulatorDisplayLabel(simulator, 0));
    setSimulatorRenameError("");
  }, [simulatorRenameBusy]);

  const handleSimulatorRenameDraftChange = useCallback((nextValue) => {
    setSimulatorRenameDraft(nextValue);
    if (simulatorRenameError) setSimulatorRenameError("");
  }, [simulatorRenameError]);

  const handleSubmitSimulatorRename = useCallback(async () => {
    if (simulatorRenameBusy) return;
    const simulatorId = cleanTransactionSimulatorId(simulatorRenameTarget?.simulatorId);
    if (!simulatorId) return;
    const name = cleanTransactionSimulatorName(simulatorRenameDraft);
    if (!name) {
      setSimulatorRenameError("계좌 이름을 입력하세요.");
      return;
    }
    const targetIndex = normalizedSimulatorAccounts.findIndex((simulator) => simulator.id === simulatorId);
    const currentName = targetIndex >= 0
      ? simulatorDisplayLabel(normalizedSimulatorAccounts[targetIndex], targetIndex)
      : "";
    if (name === currentName) {
      setSimulatorRenameTarget(null);
      setSimulatorRenameDraft("");
      setSimulatorRenameError("");
      return;
    }
    setSimulatorRenameBusy(true);
    setSimulatorRenameError("");
    try {
      const body = await patchInvestSimulatorAccount({ simulatorId, name });
      setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
      setSimulatorStoreReady(true);
      setSimulatorRenameTarget(null);
      setSimulatorRenameDraft("");
      setSimulatorRenameError("");
    } catch (fetchError) {
      setSimulatorRenameError(fetchError.message || "시뮬레이터 이름을 저장하지 못했습니다.");
    } finally {
      setSimulatorRenameBusy(false);
    }
  }, [
    normalizedSimulatorAccounts,
    simulatorRenameBusy,
    simulatorRenameDraft,
    simulatorRenameTarget?.simulatorId,
  ]);

  const handleAccountSelect = useCallback((accountSeq) => {
    const nextAccountSeq = cleanAccountSeq(accountSeq);
    setAccountOpen(false);
    if (!nextAccountSeq || (!selectedSimulatorId && nextAccountSeq === selectedAccountSeq)) return;
    handleCancelSimulatorBuy();
    handleCancelSimulatorSell();
    handleCancelSimulatorExchange();
    handleCancelSimulatorSymbolSearch();
    handleCancelSimulatorRename();
    setSelectedSimulatorId("");
    setSelectedInvestmentOrderKey("");
    setSelectedInvestmentSearchItem(null);
    forceNextRefreshRef.current = true;
    setSelectedAccountSeq(nextAccountSeq);
  }, [handleCancelSimulatorBuy, handleCancelSimulatorExchange, handleCancelSimulatorRename, handleCancelSimulatorSell, handleCancelSimulatorSymbolSearch, selectedAccountSeq, selectedSimulatorId]);

  const handleSimulatorSelect = useCallback((simulatorId) => {
    const nextSimulatorId = cleanTransactionSimulatorId(simulatorId);
    if (!nextSimulatorId) return;
    setAccountOpen(false);
    handleCancelSimulatorBuy();
    handleCancelSimulatorSell();
    handleCancelSimulatorExchange();
    handleCancelSimulatorSymbolSearch();
    handleCancelSimulatorRename();
    setSelectedSimulatorId(nextSimulatorId);
    setSelectedInvestmentOrderKey("");
    setSelectedInvestmentSearchItem(null);
    setManualOrderEditing(false);
    setManualOrderDraft([]);
    forceNextRefreshRef.current = false;
  }, [handleCancelSimulatorBuy, handleCancelSimulatorExchange, handleCancelSimulatorRename, handleCancelSimulatorSell, handleCancelSimulatorSymbolSearch]);

  const handleCreateSimulator = useCallback(async () => {
    if (simulatorLoading) return;
    setSimulatorLoading(true);
    setSimulatorError("");
    try {
      const body = await postInvestSimulatorAccount({});
      const nextAccounts = simulatorAccountsFromApiPayload(body);
      const nextSimulatorId =
        cleanTransactionSimulatorId(body?.account?.id) ||
        cleanTransactionSimulatorId(nextAccounts[nextAccounts.length - 1]?.id);
      setSimulatorAccounts(nextAccounts);
      setSimulatorStoreReady(true);
      setAccountOpen(false);
      setActiveSection("investment");
      handleCancelSimulatorBuy();
      handleCancelSimulatorSell();
      handleCancelSimulatorExchange();
      handleCancelSimulatorSymbolSearch();
      handleCancelSimulatorRename();
      if (nextSimulatorId) setSelectedSimulatorId(nextSimulatorId);
      setSelectedInvestmentOrderKey("");
      setSelectedInvestmentSearchItem(null);
      setManualOrderEditing(false);
      setManualOrderDraft([]);
      forceNextRefreshRef.current = false;
    } catch (fetchError) {
      setSimulatorError(fetchError.message || "투자 시뮬레이터를 생성하지 못했습니다.");
    } finally {
      setSimulatorLoading(false);
    }
  }, [handleCancelSimulatorBuy, handleCancelSimulatorExchange, handleCancelSimulatorRename, handleCancelSimulatorSell, handleCancelSimulatorSymbolSearch, simulatorLoading]);

  const handleRequestDeleteSimulator = useCallback((simulatorId) => {
    const targetId = cleanTransactionSimulatorId(simulatorId);
    if (!targetId || simulatorDeletingId) return;
    const targetIndex = normalizedSimulatorAccounts.findIndex((simulator) => simulator.id === targetId);
    const targetSimulator = normalizedSimulatorAccounts[targetIndex] || null;
    if (!targetSimulator) return;
    handleCancelSimulatorRename();
    setSimulatorDeleteTarget(targetSimulator);
  }, [handleCancelSimulatorRename, normalizedSimulatorAccounts, simulatorDeletingId]);

  const handleCancelDeleteSimulator = useCallback(() => {
    if (simulatorDeletingId) return;
    setSimulatorDeleteTarget(null);
  }, [simulatorDeletingId]);

  const handleConfirmDeleteSimulator = useCallback(async () => {
    const targetId = cleanTransactionSimulatorId(simulatorDeleteTarget?.id);
    if (!targetId || simulatorDeletingId) return;
    const targetIndex = normalizedSimulatorAccounts.findIndex((simulator) => simulator.id === targetId);
    setSimulatorDeletingId(targetId);
    setSimulatorError("");
    try {
      const body = await deleteInvestSimulatorAccount(targetId);
      const nextAccounts = simulatorAccountsFromApiPayload(body);
      const nextIndex = Math.max(0, Math.min(targetIndex, nextAccounts.length - 1));
      const nextSimulatorId = cleanTransactionSimulatorId(nextAccounts[nextIndex]?.id);
      setSimulatorAccounts(nextAccounts);
      setSimulatorStoreReady(true);
      setAccountOpen(false);
      if (selectedSimulatorId === targetId) {
        handleCancelSimulatorBuy();
        handleCancelSimulatorSell();
        handleCancelSimulatorExchange();
        handleCancelSimulatorSymbolSearch();
        handleCancelSimulatorRename();
        setSelectedSimulatorId(nextSimulatorId);
        setSelectedInvestmentOrderKey("");
        setSelectedInvestmentSearchItem(null);
        if (!nextSimulatorId) {
          forceNextRefreshRef.current = true;
          setRefreshKey((current) => current + 1);
        }
      }
      setManualOrderEditing(false);
      setManualOrderDraft([]);
      setSimulatorDeleteTarget(null);
    } catch (fetchError) {
      setSimulatorError(fetchError.message || "투자 시뮬레이터를 삭제하지 못했습니다.");
    } finally {
      setSimulatorDeletingId("");
    }
  }, [
    handleCancelSimulatorBuy,
    handleCancelSimulatorExchange,
    handleCancelSimulatorRename,
    handleCancelSimulatorSell,
    handleCancelSimulatorSymbolSearch,
    normalizedSimulatorAccounts,
    selectedSimulatorId,
    simulatorDeleteTarget?.id,
    simulatorDeletingId,
  ]);

  useEffect(() => {
    if (!simulatorDeleteTarget) return undefined;
    function handleSimulatorDeleteKeyDown(event) {
      if (event.key === "Escape") handleCancelDeleteSimulator();
    }
    document.addEventListener("keydown", handleSimulatorDeleteKeyDown);
    return () => document.removeEventListener("keydown", handleSimulatorDeleteKeyDown);
  }, [handleCancelDeleteSimulator, simulatorDeleteTarget]);

  useEffect(() => {
    const targetId = cleanTransactionSimulatorId(simulatorRenameTarget?.simulatorId);
    if (!targetId || simulatorRenameBusy) return;
    if (!normalizedSimulatorAccounts.some((simulator) => simulator.id === targetId)) {
      setSimulatorRenameTarget(null);
      setSimulatorRenameDraft("");
      setSimulatorRenameError("");
    }
  }, [normalizedSimulatorAccounts, simulatorRenameBusy, simulatorRenameTarget?.simulatorId]);

  useEffect(() => {
    if (!activeInvestmentPayload?.ok) return;
    const fallbackUnit = normalizeMoneyUnit(activeInvestmentPayload.unit || currency);
    const activeItems = Array.isArray(activeInvestmentPayload.items) ? activeInvestmentPayload.items : [];
    const requestedSidebarUnit = effectiveMoneyUnitFromSetting(
      currencySettings.sidebarDisplayCurrency,
      fallbackUnit,
    );
    const requestedMainUnit = effectiveMoneyUnitFromSetting(
      currencySettings.mainDisplayCurrency,
      fallbackUnit,
    );
    setSidebarUnit(transactionAvailableDisplayUnit(requestedSidebarUnit, fallbackUnit, activeItems, usdKrwRate));
    setMainUnit(transactionAvailableDisplayUnit(requestedMainUnit, fallbackUnit, activeItems, usdKrwRate));
  }, [
    activeInvestmentPayload?.items,
    activeInvestmentPayload?.ok,
    activeInvestmentPayload?.unit,
    currency,
    currencySettings.mainDisplayCurrency,
    currencySettings.sidebarDisplayCurrency,
    usdKrwRate,
  ]);

  const activeSidebarManualOrder = manualOrderEditing ? manualOrderDraft : currencySettings.sidebarManualOrder;
  const sortedItems = useMemo(
    () => sortItems(normalizedItems, sortId, activeSidebarManualOrder),
    [activeSidebarManualOrder, normalizedItems, sortId]
  );
  const selectedInvestmentItem = useMemo(() => {
    const selectedKey = cleanTransactionItemSelectionKey(selectedInvestmentOrderKey);
    if (!selectedKey) return null;
    const holdingItem = sortedItems.find((item) => transactionItemSelectionKey(item) === selectedKey);
    if (holdingItem) return holdingItem;
    if (transactionItemSelectionKey(selectedInvestmentSearchItem) !== selectedKey) return null;
    return transactionSimulatorItemsWithPrices([selectedInvestmentSearchItem], simulatorPriceMap)[0] || null;
  }, [selectedInvestmentOrderKey, selectedInvestmentSearchItem, simulatorPriceMap, sortedItems]);
  const selectedInvestmentIsHeld = useMemo(() => {
    const selectedKey = cleanTransactionItemSelectionKey(selectedInvestmentOrderKey);
    return Boolean(selectedKey && sortedItems.some((item) => transactionItemSelectionKey(item) === selectedKey));
  }, [selectedInvestmentOrderKey, sortedItems]);

  useEffect(() => {
    if (!selectedInvestmentOrderKey) return;
    if (selectedInvestmentItem) return;
    setSelectedInvestmentOrderKey("");
    setSelectedInvestmentSearchItem(null);
  }, [selectedInvestmentItem, selectedInvestmentOrderKey]);

  const handleSubmitSimulatorSymbolSearch = useCallback(() => {
    const symbol = cleanTransactionWatchlistSymbol(simulatorSymbolSearchSelection?.symbol);
    const draftSymbol = cleanTransactionWatchlistSymbol(simulatorSymbolSearchDraft);
    if (!symbol || symbol !== draftSymbol) {
      setSimulatorSymbolSearchError("차트로 볼 종목을 검색 결과에서 선택하세요.");
      return;
    }
    const selectedInstrument = normalizeTransactionInstrument(simulatorSymbolSearchSelection);
    const selectedKey = transactionItemSelectionKey(selectedInstrument);
    const holdingItem = sortedItems.find((item) => transactionItemSelectionKey(item) === selectedKey) || null;
    const option = simulatorSearchSymbolOptions.find((item) => (
      transactionInstrumentKey(item) === selectedKey
    )) || simulatorSymbolSearchSelection;
    const itemUnit = transactionSimulatorSettlementUnit(option);
    const searchItem = holdingItem || normalizeItem({
      ...normalizeTransactionInstrument(option),
      symbol,
      label: String(option?.name || option?.englishName || symbol).trim(),
      englishName: String(option?.englishName || "").trim(),
      market: String(option?.market || "").trim(),
      currency: itemUnit,
      displayCurrency: itemUnit,
      source: String(option?.source || "symbol-search").trim(),
    }, itemUnit);
    setSelectedInvestmentSearchItem(holdingItem ? null : searchItem);
    setSelectedInvestmentOrderKey(transactionItemSelectionKey(searchItem));
    handleCancelSimulatorSymbolSearch();
  }, [
    handleCancelSimulatorSymbolSearch,
    simulatorSearchSymbolOptions,
    simulatorSymbolSearchDraft,
    simulatorSymbolSearchSelection,
    sortedItems,
  ]);

  const handleSelectInvestmentPosition = useCallback((orderKey) => {
    const nextOrderKey = cleanTransactionItemSelectionKey(orderKey);
    if (!nextOrderKey) return;
    setSelectedInvestmentSearchItem(null);
    setSelectedInvestmentOrderKey(nextOrderKey);
  }, []);

  const handleCloseInvestmentPosition = useCallback(() => {
    setSelectedInvestmentOrderKey("");
    setSelectedInvestmentSearchItem(null);
  }, []);

  const handleSidebarManualOrderChange = useCallback((nextOrder) => {
    const normalizedOrder = syncTransactionSidebarManualOrder(nextOrder, normalizedItems);
    setManualOrderDraft(normalizedOrder);
  }, [normalizedItems]);

  const handleManualOrderSave = useCallback(() => {
    const normalizedOrder = syncTransactionSidebarManualOrder(manualOrderDraft, normalizedItems);
    setManualOrderDraft(normalizedOrder);
    setCurrencySettings((current) => ({
      ...current,
      sidebarManualOrder: normalizedOrder,
    }));
    setManualOrderEditing(false);
    void saveTransactionCurrencySettings({ sidebarManualOrder: normalizedOrder });
  }, [manualOrderDraft, normalizedItems, saveTransactionCurrencySettings]);

  const handleManualOrderCancel = useCallback(() => {
    setManualOrderDraft(syncTransactionSidebarManualOrder(currencySettings.sidebarManualOrder, normalizedItems));
    setManualOrderEditing(false);
  }, [currencySettings.sidebarManualOrder, normalizedItems]);

  const handleSortSelect = useCallback((nextSortId) => {
    if (nextSortId === "custom") {
      const itemKeySet = new Set(transactionItemOrderKeys(normalizedItems));
      const savedManualOrder = normalizeTransactionSidebarManualOrderSetting(currencySettings.sidebarManualOrder, []);
      const hasSavedCurrentItem = savedManualOrder.some((key) => itemKeySet.has(key));
      const nextManualOrder = hasSavedCurrentItem
        ? syncTransactionSidebarManualOrder(savedManualOrder, normalizedItems)
        : syncTransactionSidebarManualOrder(transactionItemOrderKeys(sortedItems), normalizedItems);
      setManualOrderDraft(nextManualOrder);
      setManualOrderEditing(true);
    } else {
      setManualOrderEditing(false);
    }
    setSortId(nextSortId);
  }, [currencySettings.sidebarManualOrder, normalizedItems, sortedItems]);

  useEffect(() => {
    if (sortId !== "custom" || !manualOrderEditing) return;
    const nextManualOrder = syncTransactionSidebarManualOrder(manualOrderDraft, normalizedItems);
    if (arraysEqual(nextManualOrder, manualOrderDraft)) return;
    setManualOrderDraft(nextManualOrder);
  }, [manualOrderDraft, manualOrderEditing, normalizedItems, sortId]);

  const statusForBanner = useMemo(() => {
    const credentials = tossStatus?.credentials || {};
    if (credentials.locked || credentials.invalid) return tossStatus;
    const sectionHasLivePayload = activeSection === "watchlist"
      ? selectedWatchlistUsesToss && Boolean(watchlistPricePayload?.providers?.toss?.ok)
      : selectedSimulator
        ? true
        : Boolean(payload?.ok && payload?.sourceMode === "live");
    const sectionError = activeSection === "watchlist" ? watchlistPriceError : error;
    if (activeSection === "investment" && selectedSimulator) return tossStatus;
    if (sectionError || !sectionHasLivePayload) return tossStatus;
    return {
      ...(tossStatus || {}),
      connected: true,
      credentials: {
        ...(tossStatus?.credentials || {}),
        configured: true,
        usable: true,
        unlocked: true,
        locked: false,
      },
      token: {
        ...(tossStatus?.token || {}),
        cached: true,
      },
    };
  }, [
    activeSection,
    error,
    payload?.ok,
    payload?.sourceMode,
    selectedSimulator,
    selectedWatchlistUsesToss,
    tossStatus,
    watchlistPriceError,
    watchlistPricePayload?.providers?.toss?.ok,
  ]);
  const sectionError = activeSection === "watchlist" ? watchlistPriceError : error;
  const sectionErrorCode = activeSection === "watchlist" ? watchlistPriceErrorCode : liveErrorCode;
  const statusBannerError = sectionError || currencySettingsError || tossError;
  const statusBannerErrorCode = sectionError ? sectionErrorCode : statusBannerError ? tossErrorCode : "";
  const statusBannerProps = {
    status: statusForBanner,
    busy: tossBusy,
    error: statusBannerError,
    errorCode: statusBannerErrorCode,
    publicIp: tossPublicIp,
    publicIpBusy: tossPublicIpBusy,
    publicIpError: tossPublicIpError,
    showOrderSyncSummary: false,
    autoProbeConnection: false,
    onOpenSettings,
    onDeleteCredentials,
    onProbeConnection: handleReload,
    onCheckPublicIp,
  };
  const selectedSimulatorContextIndex = selectedSimulator
    ? normalizedSimulatorAccounts.findIndex((simulator) => simulator.id === selectedSimulator.id)
    : -1;
  const transactionViewMode = activeSection === "watchlist"
    ? selectedWatchlistChartItem ? "watchlist-chart-detail" : "watchlist-overview"
    : selectedInvestmentItem
      ? selectedSimulator ? "simulator-chart-detail" : "live-investment-chart-detail"
      : selectedSimulator ? "simulator-investment-overview" : "live-investment-overview";
  transactionContextMetaRef.current = {
    activeSection,
    viewMode: transactionViewMode,
    account: activeSection === "watchlist"
      ? {
          type: "watchlist",
          id: selectedWatchlistDisplayGroup?.id || "",
          label: selectedWatchlistDisplayGroup?.name || "관심 목록",
        }
      : selectedSimulator
      ? {
          type: "simulator",
          id: selectedSimulator.id,
          label: simulatorDisplayLabel(selectedSimulator, Math.max(0, selectedSimulatorContextIndex)),
        }
      : {
          type: "live",
          id: selectedAccountSeq || payload?.accountSeq || "",
          label: "내 투자",
        },
    selectedWatchlistGroup: selectedWatchlistDisplayGroup
      ? {
          id: selectedWatchlistDisplayGroup.id,
          name: selectedWatchlistDisplayGroup.name,
          instrumentCount: normalizeTransactionWatchlistInstrumentsSetting(
            selectedWatchlistDisplayGroup.instruments,
            selectedWatchlistDisplayGroup.symbols
          ).length,
        }
      : null,
    displaySettings: {
      sidebarUnit,
      mainUnit,
      sidebarValueMode: valueMode,
      sortId,
      mainTableColumns: visibleTransactionMainTableColumns(currencySettings.mainTableColumns).map((column) => column.id),
      chartMode: currencySettings.investmentChartMode,
      chartIntervalMode: currencySettings.investmentChartIntervalMode,
      chartVolumeVisible: currencySettings.investmentChartVolumeVisible,
    },
  };
  return (
    <section className="workspace-canvas transaction-status-canvas" aria-label="거래현황" ref={rootRef}>
      <div className="transaction-status-shell">
        <SectionRail activeSection={activeSection} onSelectSection={setActiveSection} />
        {activeSection === "investment" ? (
          <>
            <InvestmentSidebar
              items={sortedItems}
              payload={activeInvestmentPayload}
              unit={sidebarUnit}
              usdKrwRate={usdKrwRate}
              onUnitChange={handleSidebarUnitChange}
              sortId={sortId}
              sortOpen={sortOpen}
              onSortOpenChange={setSortOpen}
              onSortSelect={handleSortSelect}
              manualOrder={activeSidebarManualOrder}
              manualOrderEditing={manualOrderEditing}
              onManualOrderChange={handleSidebarManualOrderChange}
              onManualOrderSave={handleManualOrderSave}
              onManualOrderCancel={handleManualOrderCancel}
              accounts={payload?.accounts || []}
              simulators={normalizedSimulatorAccounts}
              accountOpen={accountOpen}
              selectedAccountSeq={selectedSimulator ? "" : selectedAccountSeq || payload?.accountSeq || ""}
              selectedSimulatorId={selectedSimulator?.id || ""}
              simulatorMarketCalendars={simulatorMarketCalendars}
              simulatorLoading={simulatorLoading}
              simulatorError={simulatorError}
              simulatorRenameTarget={simulatorRenameTarget}
              simulatorRenameDraft={simulatorRenameDraft}
              simulatorRenameBusy={simulatorRenameBusy}
              simulatorRenameError={simulatorRenameError}
              onAccountOpenChange={setAccountOpen}
              onAccountSelect={handleAccountSelect}
              onSimulatorSelect={handleSimulatorSelect}
              onCreateSimulator={handleCreateSimulator}
              onOpenExchange={handleOpenSimulatorExchange}
              onPositionBuy={handleOpenSidebarSimulatorBuy}
              onPositionSell={handleOpenSidebarSimulatorSell}
              onSimulatorRenameStart={handleSimulatorRenameStart}
              onSimulatorRenameDraftChange={handleSimulatorRenameDraftChange}
              onSimulatorRenameSubmit={handleSubmitSimulatorRename}
              onSimulatorRenameCancel={handleCancelSimulatorRename}
              valueMode={valueMode}
              onValueModeChange={handleValueModeChange}
              selectedPositionKey={selectedInvestmentOrderKey}
              onSelectPosition={handleSelectInvestmentPosition}
              onResetPositionSelection={handleCloseInvestmentPosition}
            />
            {selectedInvestmentItem ? (
              <TransactionInvestmentAssetDetail
                item={selectedInvestmentItem}
                payload={activeInvestmentPayload}
                unit={mainUnit}
                usdKrwRate={usdKrwRate}
                onUnitChange={handleMainUnitChange}
                onClose={handleCloseInvestmentPosition}
                statusBannerProps={statusBannerProps}
                binanceStatus={binanceProviderStatus}
                binanceError={binanceProviderError}
                chartModeSetting={currencySettings.investmentChartMode}
                intervalModeSetting={currencySettings.investmentChartIntervalMode}
                volumeVisibleSetting={currencySettings.investmentChartVolumeVisible}
                onChartModeChange={handleInvestmentChartModeChange}
                onIntervalModeChange={handleInvestmentChartIntervalChange}
                onVolumeVisibleChange={handleInvestmentChartVolumeVisibleChange}
                onBuy={selectedSimulator ? handleOpenDetailSimulatorBuy : undefined}
                onSell={selectedSimulator && selectedInvestmentIsHeld ? handleOpenDetailSimulatorSell : undefined}
                onDisplayData={handleContextSurfaceData}
              />
            ) : selectedSimulator ? (
              <SimulatorInvestmentMain
                simulator={selectedSimulator}
                items={sortedItems}
                payload={activeInvestmentPayload}
                unit={mainUnit}
                usdKrwRate={usdKrwRate}
                onUnitChange={handleMainUnitChange}
                selectedTableColumnIds={currencySettings.mainTableColumns}
                onTableColumnsChange={handleMainTableColumnsChange}
                statusBannerProps={statusBannerProps}
                binanceStatus={binanceProviderStatus}
                binanceError={binanceProviderError}
                deleteBusy={simulatorDeletingId === selectedSimulator.id}
                simulatorRenameTarget={simulatorRenameTarget}
                simulatorRenameDraft={simulatorRenameDraft}
                simulatorRenameBusy={simulatorRenameBusy}
                simulatorRenameError={simulatorRenameError}
                onDeleteSimulator={handleRequestDeleteSimulator}
                onOpenSymbolSearch={handleOpenSimulatorSymbolSearch}
                onSimulatorRenameStart={handleSimulatorRenameStart}
                onSimulatorRenameDraftChange={handleSimulatorRenameDraftChange}
                onSimulatorRenameSubmit={handleSubmitSimulatorRename}
                onSimulatorRenameCancel={handleCancelSimulatorRename}
                onSelectItem={handleSelectInvestmentPosition}
                onDisplayData={handleContextSurfaceData}
                sidebarValueMode={valueMode}
              />
            ) : (
              <InvestmentMain
                items={sortedItems}
                payload={payload}
                unit={mainUnit}
                usdKrwRate={usdKrwRate}
                onUnitChange={handleMainUnitChange}
                selectedTableColumnIds={currencySettings.mainTableColumns}
                onTableColumnsChange={handleMainTableColumnsChange}
                loading={loading}
                error={error}
                statusBannerProps={statusBannerProps}
                onSelectItem={handleSelectInvestmentPosition}
                onDisplayData={handleContextSurfaceData}
                sidebarValueMode={valueMode}
              />
            )}
          </>
        ) : (
          <WatchlistPlaceholder
            statusBannerProps={statusBannerProps}
            binanceStatus={binanceProviderStatus}
            binanceError={binanceProviderError}
            watchlistGroups={activeWatchlistGroups}
            selectedGroupId={selectedWatchlistDisplayGroup?.id || ""}
            selectedGroup={selectedWatchlistDisplayGroup}
            items={sortedItems}
            symbolOptions={watchlistSymbolOptions}
            priceMap={watchlistPriceMap}
            payload={watchlistPricePayload}
            loading={watchlistPriceLoading}
            error={watchlistPriceError}
            orderEditing={watchlistOrderEditing}
            renameGroupId={watchlistRenameGroupId}
            renamePlacement={watchlistRenamePlacement}
            renameDraft={watchlistRenameDraft}
            renameError={watchlistRenameError}
            symbolOrderEditing={watchlistSymbolOrderEditing}
            onSelectGroup={handleSelectWatchlistGroup}
            onRequestRenameGroup={handleRequestWatchlistGroupRename}
            onRenameDraftChange={handleWatchlistRenameDraftChange}
            onSubmitRenameGroup={handleSubmitWatchlistGroupRename}
            onCancelRenameGroup={handleCancelWatchlistGroupRename}
            onSymbolOrderEditStart={handleWatchlistSymbolOrderEditStart}
            onSymbolOrderChange={handleWatchlistSymbolOrderChange}
            onSymbolOrderSave={handleWatchlistSymbolOrderSave}
            onOpenAddSymbol={handleOpenWatchlistSymbolAdd}
            onRemoveSymbol={handleRemoveWatchlistSymbol}
            selectedChartItem={selectedWatchlistChartItem}
            chartUnit={mainUnit}
            usdKrwRate={usdKrwRate}
            onChartUnitChange={handleMainUnitChange}
            chartModeSetting={currencySettings.investmentChartMode}
            chartIntervalModeSetting={currencySettings.investmentChartIntervalMode}
            chartVolumeVisibleSetting={currencySettings.investmentChartVolumeVisible}
            onChartModeChange={handleInvestmentChartModeChange}
            onChartIntervalModeChange={handleInvestmentChartIntervalChange}
            onChartVolumeVisibleChange={handleInvestmentChartVolumeVisibleChange}
            onSelectSymbol={handleSelectWatchlistSymbol}
            onCloseChart={handleCloseWatchlistChart}
            onOpenCreateGroup={handleOpenWatchlistCreate}
            onRequestDeleteGroup={handleRequestDeleteWatchlistGroup}
            onOrderEditStart={handleWatchlistOrderEditStart}
            onOrderChange={handleWatchlistOrderChange}
            onOrderSave={handleWatchlistOrderSave}
            onDisplayData={handleContextSurfaceData}
          />
        )}
      </div>
      <TransactionSimulatorOrderNotifications notifications={simulatorOrderNotifications} />
      {watchlistCreateOpen ? (
        <WatchlistCreateDialog
          draftName={watchlistGroupNameDraft}
          error={watchlistGroupNameError}
          onDraftNameChange={handleWatchlistGroupDraftChange}
          onCancel={handleCancelWatchlistCreate}
          onSubmit={handleCreateWatchlistGroup}
        />
      ) : null}
      {watchlistSymbolAddOpen ? (
        <WatchlistSymbolDialog
          group={selectedWatchlistGroup}
          draftSymbol={watchlistSymbolDraft}
          selectedSymbol={watchlistSelectedSymbol}
          error={watchlistSymbolError}
          symbolOptions={watchlistSymbolOptions}
          onDraftSymbolChange={handleWatchlistSymbolDraftChange}
          onSelectSymbol={handleWatchlistSymbolSelect}
          onCancel={handleCancelWatchlistSymbolAdd}
          onSubmit={handleAddWatchlistSymbol}
        />
      ) : null}
      {watchlistDeleteTarget ? (
        <WatchlistDeleteDialog
          group={watchlistDeleteTarget}
          onCancel={handleCancelDeleteWatchlistGroup}
          onConfirm={handleConfirmDeleteWatchlistGroup}
        />
      ) : null}
      {simulatorSymbolSearchOpen && selectedSimulator ? (
        <TransactionSymbolSearchDialog
          inputId="transaction-simulator-symbol-search"
          titleId="transaction-simulator-symbol-search-title"
          draftSymbol={simulatorSymbolSearchDraft}
          selectedSymbol={simulatorSymbolSearchSelection}
          error={simulatorSymbolSearchError}
          symbolOptions={simulatorSearchSymbolOptions}
          onDraftSymbolChange={handleSimulatorSymbolSearchDraftChange}
          onSelectSymbol={handleSimulatorSymbolSearchSelect}
          onCancel={handleCancelSimulatorSymbolSearch}
          onSubmit={handleSubmitSimulatorSymbolSearch}
        />
      ) : null}
      {simulatorDeleteTarget ? (
        <SimulatorDeleteDialog
          simulator={simulatorDeleteTarget}
          busy={simulatorDeletingId === simulatorDeleteTarget.id}
          onCancel={handleCancelDeleteSimulator}
          onConfirm={handleConfirmDeleteSimulator}
        />
      ) : null}
      {simulatorExchangeOpen && selectedSimulator ? (
        <SimulatorExchangeDialog
          simulator={selectedSimulator}
          usdKrwRate={usdKrwRate}
          modeId={simulatorExchangeMode}
          amountDraft={simulatorExchangeAmountDraft}
          error={simulatorExchangeError}
          busy={simulatorExchangeBusy}
          onModeChange={handleSimulatorExchangeModeChange}
          onAmountChange={handleSimulatorExchangeAmountChange}
          onSubmitExchange={handleSubmitSimulatorExchange}
          onCancel={handleCancelSimulatorExchange}
        />
      ) : null}
      {simulatorBuyOpen && selectedSimulator ? (
        <SimulatorBuyDialog
          simulator={selectedSimulator}
          unit={simulatorBuyUnit}
          usdKrwRate={usdKrwRate}
          draftSymbol={simulatorBuySymbolDraft}
          selectedSymbol={simulatorBuySelectedSymbol}
          symbolOptions={simulatorBuySymbolOptions}
          amountDraft={simulatorBuyAmountDraft}
          error={simulatorBuyError}
          busy={simulatorBuyBusy}
          marketCalendar={simulatorBuyMarketCalendar}
          marketCalendarLoading={simulatorBuyMarketCalendarLoading}
          marketCalendarError={simulatorBuyMarketCalendarError}
          binanceStatus={binanceProviderStatus}
          binanceError={binanceProviderError}
          onDraftSymbolChange={handleSimulatorBuySymbolDraftChange}
          onSelectSymbol={handleSimulatorBuySelectSymbol}
          onAmountChange={handleSimulatorBuyAmountChange}
          onPresetAmount={handleSimulatorBuyPresetAmount}
          onSubmitOrder={handleSubmitSimulatorBuy}
          onCancel={handleCancelSimulatorBuy}
        />
      ) : null}
      {simulatorSellOpen && selectedSimulator ? (
        <SimulatorSellDialog
          position={simulatorSellPosition}
          unit={simulatorSellUnit}
          usdKrwRate={usdKrwRate}
          amountDraft={simulatorSellAmountDraft}
          error={simulatorSellError}
          busy={simulatorSellBusy}
          marketCalendar={simulatorSellMarketCalendar}
          marketCalendarLoading={simulatorSellMarketCalendarLoading}
          marketCalendarError={simulatorSellMarketCalendarError}
          binanceStatus={binanceProviderStatus}
          binanceError={binanceProviderError}
          onAmountChange={handleSimulatorSellAmountChange}
          onPresetFraction={handleSimulatorSellPresetFraction}
          onSubmitOrder={handleSubmitSimulatorSell}
          onCancel={handleCancelSimulatorSell}
        />
      ) : null}
    </section>
  );
}
