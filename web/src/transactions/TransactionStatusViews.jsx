import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BriefcaseBusiness from "lucide-react/dist/esm/icons/briefcase-business.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import CircleHelp from "lucide-react/dist/esm/icons/circle-help.js";
import CirclePlus from "lucide-react/dist/esm/icons/circle-plus.js";
import Filter from "lucide-react/dist/esm/icons/filter.js";
import FolderClosed from "lucide-react/dist/esm/icons/folder-closed.js";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical.js";
import Heart from "lucide-react/dist/esm/icons/heart.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Save from "lucide-react/dist/esm/icons/save.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import X from "lucide-react/dist/esm/icons/x.js";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
} from "lightweight-charts";
import { PortfolioTossApiStatus } from "../portfolio/PortfolioWorkspaceHeader.jsx";
import {
  sortOptions,
  companyNames,
  formatKrw,
  formatUsd,
  formatMoney,
  normalizeMoneyUnit,
  defaultTransactionCurrencySettings,
  transactionSimulatorStorageKey,
  transactionSimulatorInitialKrw,
  transactionSimulatorInitialUsd,
  transactionSimulatorMinimumBuyKrw,
  transactionSimulatorMinimumBuyUsd,
  transactionWatchlistPriceRefreshMs,
  transactionEtfNameTranslationPollMs,
  transactionTossUsMarkets,
  transactionTossTranslatedFundTypes,
  transactionTossRateLimitFallbackMs,
  transactionWatchlistCandlePageSize,
  transactionInvestmentDetailCandlePageSize,
  transactionInvestmentDetailCandleRefreshMs,
  transactionInvestmentDetailOlderLoadThreshold,
  transactionWatchlistCandleCacheTtlMs,
  transactionWatchlistKoreanDailyBasisCacheTtlMs,
  transactionWatchlistCandleCache,
  transactionInvestmentDetailCandleCache,
  transactionWatchlistKoreanDailyBasisCache,
  transactionWatchlistMarketCalendarCache,
  transactionInvestmentDirectionPalettes,
  transactionInvestmentDetailChartModes,
  transactionInvestmentMinuteIntervals,
  transactionInvestmentTimeframeTabs,
  transactionInvestmentDetailChartModeIds,
  transactionInvestmentDetailIntervalIds,
  transactionWatchlistReturnColumns,
  transactionMainTableColumns,
  fixedTransactionMainTableColumnId,
  transactionSelectableMainTableColumns,
  transactionSelectableMainTableColumnIds,
  normalizeTransactionMainTableColumnsSetting,
  normalizeTransactionSidebarManualOrderSetting,
  cleanTransactionWatchlistGroupName,
  cleanTransactionWatchlistGroupId,
  cleanTransactionWatchlistSymbol,
  normalizeTransactionInstrumentProvider,
  cleanTransactionInstrumentId,
  normalizeTransactionInstrument,
  transactionEtfTranslationMarketCountry,
  transactionEtfNameTranslationSource,
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
  transactionItemOrderKey,
  transactionItemSelectionKey,
  cleanTransactionItemSelectionKey,
  createTransactionSimulatorOrderIdempotencyKey,
  transactionItemOrderKeys,
  arraysEqual,
  syncTransactionSidebarManualOrder,
  reorderTransactionSidebarManualOrder,
  reorderTransactionWatchlistGroups,
  normalizeTransactionWatchlistInstrumentOrder,
  reorderTransactionWatchlistInstruments,
  transactionWatchlistInstrumentsInOrder,
  watchlistGroupIdsEqual,
  visibleTransactionMainTableColumns,
  normalizeDisplayCurrencySetting,
  normalizeTransactionValueModeSetting,
  normalizeTransactionInvestmentChartModeSetting,
  normalizeTransactionInvestmentChartIntervalSetting,
  normalizeTransactionBooleanSetting,
  transactionCurrencySettingsFromPayload,
  effectiveMoneyUnitFromSetting,
  numericAmount,
  optionalNumericAmount,
  optionalRatePercent,
  convertMoney,
  convertedMoney,
  formatConvertedMoney,
  formatOptionalMoney,
  formatOptionalSignedMoney,
  formatSignedMoney,
  formatOptionalPerformance,
  formatConvertedPerformance,
  formatPercent,
  formatSignedPercent,
  formatQuantity,
  formatUpdatedAt,
  formatCompactNumber,
  formatCompactMoney,
  transactionDatePartsFromTime,
  formatTransactionChartDateLabel,
  formatTransactionChartTickMark,
  valueTone,
  transactionInvestmentDirectionPalette,
  displayName,
  displayNameFromInstrumentSources,
  transactionInstrumentDescription,
  transactionNameTranslationPending,
  transactionWatchlistSearchName,
  transactionWatchlistOptionAliases,
  transactionSymbolSearchSuggestions,
  transactionWatchlistSymbolOptions,
  transactionWatchlistStockOptionsFromPayload,
  transactionMarketDataInstrumentOptionsFromPayload,
  transactionWatchlistPriceRowsFromPayload,
  transactionWatchlistCandleRowsFromPayload,
  transactionInvestmentIntervalIsIntraday,
  transactionInvestmentCandleRowsFromPayload,
  transactionInvestmentSourceInterval,
  transactionBinanceSourceInterval,
  transactionInvestmentCandleRowKey,
  uniqueTransactionInvestmentCandleRows,
  mergeTransactionInvestmentCandleRows,
  transactionInvestmentCandleRowsEqual,
  transactionInvestmentOlderBeforeFromRows,
  transactionInvestmentNextBeforeFromPayload,
  transactionInvestmentShouldLoadOlderFromLogicalRange,
  transactionInvestmentRestoredLogicalRange,
  transactionInvestmentMinuteSize,
  mergeTransactionInvestmentCandleGroup,
  aggregateTransactionInvestmentMinuteRows,
  transactionInvestmentWeekStart,
  aggregateTransactionInvestmentWeeklyRows,
  transactionInvestmentDailyDate,
  aggregateTransactionInvestmentDailyRows,
  aggregateTransactionInvestmentRows,
  transactionChartTimeSortValue,
  transactionChartDataTime,
  transactionChartDataTimeKey,
  transactionInvestmentChartDatumEqual,
  transactionInvestmentCanUpdateLastChartDatum,
  normalizeTransactionChartRows,
  transactionInvestmentDisplayCandleRows,
  transactionInvestmentLineChartData,
  transactionInvestmentOhlcChartData,
  transactionInvestmentVolumeChartData,
  transactionInvestmentChartDataReady,
  transactionInvestmentHasNewCandleRows,
  transactionWatchlistMinuteCandleRowsFromPayload,
  transactionWatchlistPriceDate,
  transactionWatchlistPriceDateObject,
  transactionWatchlistLocalDateString,
  transactionWatchlistDateParts,
  transactionWatchlistShiftDate,
  transactionWatchlistReturnTargetDate,
  transactionWatchlistCloseAtOrBefore,
  transactionWatchlistReturnPercent,
  transactionWatchlistAddMinutes,
  transactionWatchlistUniqueCandleRows,
  previousCloseForWatchlistPrice,
  transactionWatchlistReturnsForPrice,
  transactionWatchlistPriceMap,
  fetchTransactionWatchlistCatalogOptions,
  fetchTransactionWatchlistCandleRows,
  fetchTransactionInvestmentDetailCandles,
  fetchTransactionWatchlistMarketCalendar,
  transactionWatchlistKoreanDailyBasisBoundary,
  transactionWatchlistUsDailyBasisBoundary,
  fetchTransactionWatchlistMinuteBasisClose,
  fetchTransactionWatchlistKoreanDailyBasis,
  fetchTransactionWatchlistUsDailyBasis,
  fetchTransactionBinanceDailyBasis,
  fetchTransactionWatchlistDailyBasis,
  fetchTransactionTossWatchlistPrices,
  fetchTransactionBinanceWatchlistPrices,
  fetchTransactionWatchlistPrices,
  transactionSimulatorPriceFromPayload,
  fetchTransactionSimulatorExecutionPrice,
  mergeTransactionWatchlistSymbolOptions,
  resolveTransactionWatchlistSymbolInput,
  transactionSimulatorBuyPresets,
  transactionSimulatorSellFractions,
  transactionSimulatorOrderNotificationMessage,
  transactionSimulatorStockOptionFromItem,
  transactionSimulatorSettlementUnit,
  transactionSimulatorMarketCalendarCode,
  transactionSimulatorCalendarDateInTimeZone,
  transactionSimulatorCalendarDate,
  transactionSimulatorCalendarResult,
  transactionSimulatorCalendarSessions,
  transactionSimulatorCurrentMarketSession,
  transactionSimulatorCalendarUnitsForItems,
  transactionBinanceProviderAvailability,
  transactionSidebarPriceModeLabel,
  transactionSimulatorBuyTradingEligibility,
  transactionSimulatorCurrencyLabel,
  transactionSimulatorMinimumSettlementBuyAmount,
  transactionSimulatorMinimumOrderAmount,
  transactionSimulatorMinimumBuyLabel,
  transactionSimulatorBuyAvailableAmount,
  transactionSimulatorPositionSettlementValue,
  cleanTransactionSimulatorBuyAmountDraft,
  transactionSimulatorBuyAmountValue,
  formatTransactionSimulatorBuyAmountDraft,
  transactionSimulatorExchangeModes,
  transactionSimulatorExchangeMode,
  cleanTransactionSimulatorExchangeAmountDraft,
  formatTransactionSimulatorExchangeAmountDraft,
  transactionSimulatorExchangeAmountValue,
  transactionSimulatorExchangeOutputAmount,
  transactionSimulatorExchangeRateText,
  cleanAccountSeq,
  accountDisplayLabel,
  cleanTransactionSimulatorId,
  cleanTransactionSimulatorName,
  simulatorDisplayLabel,
  normalizeTransactionSimulatorAccount,
  normalizeTransactionSimulatorAccounts,
  readStoredTransactionSimulators,
  clearStoredTransactionSimulators,
  transactionSimulatorMarketDateForTimestamp,
  transactionSimulatorSameDayLotBasis,
  transactionSimulatorDailyBaseline,
  transactionSimulatorItemsWithPrices,
  transactionSimulatorTotalsFromItems,
  transactionSimulatorDailyReturnPercent,
  transactionSimulatorDefaultDisplayUnit,
  transactionAvailableDisplayUnit,
  transactionSimulatorPayload,
  simulatorAccountsFromApiPayload,
  transactionLiveFetchGate,
  transactionPageIsVisible,
  retryAfterMsFromRateLimit,
  normalizeItem,
  sumConvertedItems,
  aggregatePerformance,
  usdKrwRateFromPayload,
  sortItems,
  itemMarketCountry,
  itemIsOverseasStock,
  itemIsDomesticStock,
  itemIsCrypto,
  transactionPerformancePeriodPrefix,
  transactionSortOptionsForItems,
} from "./transactionDomain.js";

export function TransactionTranslatedName({ item, name = displayName(item) }) {
  return (
    <span className="transaction-translated-name">
      <span>{name}</span>
      {transactionNameTranslationPending(item) ? (
        <small className="transaction-name-translation-status">번역대기중</small>
      ) : null}
    </span>
  );
}
export function SectionRail({ activeSection, onSelectSection }) {
  const items = [
    { id: "investment", label: "내 투자", Icon: BriefcaseBusiness },
    { id: "watchlist", label: "관심", Icon: Heart },
  ];
  return (
    <nav className="transaction-section-rail" aria-label="거래현황 섹션">
      {items.map(({ id, label, Icon }) => (
        <button
          className={activeSection === id ? "is-active" : ""}
          type="button"
          key={id}
          onClick={() => onSelectSection(id)}
          aria-pressed={activeSection === id}
        >
          <Icon size={18} strokeWidth={2.3} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function SortMenu({ sortId, open, onOpenChange, onSelect, items = [] }) {
  const contextualOptions = transactionSortOptionsForItems(items);
  const selected = contextualOptions.find((option) => option.id === sortId) || contextualOptions[3];
  return (
    <div className="transaction-sort-menu">
      <button
        className="transaction-sort-trigger"
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} strokeWidth={2.4} />
      </button>
      {open ? (
        <div className="transaction-sort-popover" role="menu">
          {contextualOptions.map((option) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={option.id === sortId}
              className={option.id === sortId ? "is-selected" : ""}
              key={option.id}
              onClick={() => {
                onSelect(option.id);
                onOpenChange(false);
              }}
            >
              <span>{option.label}</span>
              {option.id === sortId ? <Check size={17} strokeWidth={2.6} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CurrencySwitch({ unit, onChange, label = "통화 표시" }) {
  const normalizedUnit = normalizeMoneyUnit(unit);
  const nextUnit = normalizedUnit === "USD" ? "KRW" : "USD";
  const currentLabel = normalizedUnit === "USD" ? "달러" : "원화";
  const nextLabel = nextUnit === "USD" ? "달러" : "원화";
  return (
    <button
      className="transaction-currency-switch"
      type="button"
      onClick={() => onChange(nextUnit)}
      aria-label={`${label}: 현재 ${currentLabel}, 클릭하면 ${nextLabel}`}
    >
      <span className={normalizedUnit === "USD" ? "is-active" : ""} aria-hidden="true">
        $
      </span>
      <span className={normalizedUnit === "KRW" ? "is-active" : ""} aria-hidden="true">
        원
      </span>
    </button>
  );
}

export function TransactionColumnFilter({ selectedColumnIds, onChange }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const normalizedColumnIds = useMemo(
    () => normalizeTransactionMainTableColumnsSetting(selectedColumnIds, []),
    [selectedColumnIds]
  );
  const selectedSet = useMemo(() => new Set(normalizedColumnIds), [normalizedColumnIds]);
  const active = normalizedColumnIds.length > 0;
  const buttonTitle = active ? `추가 표 열 ${normalizedColumnIds.length}개 선택` : "기본 표 열만 표시";

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (anchorRef.current && !anchorRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const updateColumns = useCallback((nextColumnIds) => {
    onChange(normalizeTransactionMainTableColumnsSetting(nextColumnIds, []));
  }, [onChange]);

  const toggleColumn = useCallback((columnId, checked) => {
    const current = normalizeTransactionMainTableColumnsSetting(selectedColumnIds, []);
    const nextColumns = checked
      ? [...current, columnId]
      : current.filter((item) => item !== columnId);
    updateColumns(nextColumns);
  }, [selectedColumnIds, updateColumns]);

  return (
    <div className="transaction-column-filter-anchor" ref={anchorRef}>
      <button
        className={active ? "transaction-column-filter-button is-active" : "transaction-column-filter-button"}
        type="button"
        aria-label={buttonTitle}
        title={buttonTitle}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Filter size={17} strokeWidth={2.2} />
      </button>
      {open ? (
        <div className="transaction-column-filter-panel" role="dialog" aria-label="표 열 필터">
          <div className="transaction-column-filter-links">
            <button
              type="button"
              onClick={() => updateColumns(transactionSelectableMainTableColumns.map((column) => column.id))}
            >
              전부 선택
            </button>
            <button type="button" onClick={() => updateColumns([])}>
              전부 선택 해제
            </button>
          </div>
          <div className="transaction-column-filter-options">
            {transactionSelectableMainTableColumns.map((column) => (
              <label className="transaction-column-filter-option" key={column.id}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(column.id)}
                  onChange={(event) => toggleColumn(column.id, event.target.checked)}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function transactionSidebarPositionView(item, displayUnit, valueMode, usdKrwRate) {
  const itemUnit = item.displayCurrency || item.currency || displayUnit;
  const isPriceMode = valueMode === "price";
  const displayValue = isPriceMode ? item.currentPrice : item.value;
  const changeValue = isPriceMode ? item.dailyProfit : item.profit;
  const marketDailyReturnPercent = Number(item.marketDailyReturnPercent);
  const changePercent = isPriceMode && Number.isFinite(marketDailyReturnPercent)
    ? marketDailyReturnPercent
    : isPriceMode
      ? item.dailyReturnPercent
      : item.profitPercent;
  const displayValueInUnit = convertedMoney(displayValue, itemUnit, displayUnit, usdKrwRate);
  const positionName = isPriceMode ? displayName(item) : item.symbol;
  const positionMeta = isPriceMode
    ? `내 평균 ${item.averageKnownCost ? formatConvertedMoney(item.averageKnownCost, itemUnit, displayUnit, usdKrwRate) : "-"}`
    : formatQuantity(item.quantity, item);
  const changeLabel = isPriceMode
    ? formatSignedPercent(changePercent)
    : formatConvertedPerformance(true, changeValue, changePercent, itemUnit, displayUnit, usdKrwRate);
  return {
    positionName,
    translationPending: transactionNameTranslationPending(item),
    positionMeta,
    valueLabel: formatOptionalMoney(displayValueInUnit.hasValue, displayValueInUnit.value, displayUnit),
    changeLabel,
    toneClass: valueTone(isPriceMode ? changePercent : changeValue),
  };
}

export function SimulatorNameEditForm({
  inputId,
  value,
  busy = false,
  error = "",
  compact = false,
  onChange,
  onSubmit,
  onCancel,
}) {
  const handleCommit = () => {
    if (busy) return;
    onSubmit?.();
  };
  return (
    <span
      className={`transaction-simulator-name-form${compact ? " is-compact" : ""}`}
      role="form"
      aria-label="시뮬레이터 계좌 이름 변경"
      onClick={(event) => event.stopPropagation()}
    >
      <input
        id={inputId}
        type="text"
        value={value}
        maxLength={80}
        autoComplete="off"
        autoFocus
        disabled={busy}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent?.isComposing) {
            event.preventDefault();
            handleCommit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel?.();
          }
        }}
      />
      <button
        className="transaction-simulator-name-save"
        type="button"
        disabled={busy}
        aria-label="시뮬레이터 이름 저장"
        title="저장"
        onClick={handleCommit}
      >
        <Check size={14} strokeWidth={2.6} aria-hidden="true" />
      </button>
      <button type="button" disabled={busy} aria-label="시뮬레이터 이름 편집 취소" title="취소" onClick={onCancel}>
        <X size={14} strokeWidth={2.6} aria-hidden="true" />
      </button>
      {error ? <span className="transaction-simulator-name-error" role="alert">{error}</span> : null}
    </span>
  );
}

export function SimulatorEditableName({
  simulator,
  index = 0,
  placement = "main",
  editing = false,
  draft = "",
  busy = false,
  error = "",
  onStart,
  onDraftChange,
  onSubmit,
  onCancel,
}) {
  const simulatorId = cleanTransactionSimulatorId(simulator?.id);
  const simulatorName = simulatorDisplayLabel(simulator, index);
  if (!simulatorId) return <strong>{simulatorName}</strong>;
  if (editing) {
    return (
      <SimulatorNameEditForm
        inputId={`transaction-simulator-name-${placement}`}
        value={draft}
        busy={busy}
        error={error}
        compact={placement !== "main"}
        onChange={onDraftChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }
  return (
    <button
      className="transaction-simulator-name-inline"
      type="button"
      title={`${simulatorName} 이름 변경`}
      aria-label={`${simulatorName} 이름 변경`}
      onClick={(event) => {
        event.stopPropagation();
        onStart?.(simulator, placement);
      }}
    >
      <span>{simulatorName}</span>
    </button>
  );
}

export function SimulatorPositionActionPopover({
  menu,
  onClose,
  onBuy,
  onSell,
}) {
  const buyButtonRef = useRef(null);
  const item = menu?.item || null;
  const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
  const positionName = item ? displayName(item) : "";

  useEffect(() => {
    if (!menu) return;
    buyButtonRef.current?.focus();
  }, [menu]);

  if (!menu || !item) return null;

  return (
    <div
      className="transaction-side-position-actions-popover"
      role="dialog"
      aria-label={`${positionName || symbol} 거래 메뉴`}
      style={{
        "--transaction-position-action-x": `${menu.x}px`,
        "--transaction-position-action-y": `${menu.y}px`,
      }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose?.();
      }}
    >
      <span className="transaction-side-position-actions-title">
        {symbol || positionName}
      </span>
      <button
        className="is-buy"
        type="button"
        ref={buyButtonRef}
        onClick={() => {
          onClose?.();
          onBuy?.(item);
        }}
      >
        매수
      </button>
      <button
        className="is-sell"
        type="button"
        disabled={!onSell}
        title={onSell ? `${positionName || symbol} 매도` : "매도 주문은 다음 단계에서 연결합니다"}
        onClick={() => {
          onClose?.();
          onSell?.(item);
        }}
      >
        매도
      </button>
    </div>
  );
}

export function InvestmentSidebar({
  items,
  payload,
  unit,
  usdKrwRate,
  onUnitChange,
  sortId,
  sortOpen,
  onSortOpenChange,
  onSortSelect,
  manualOrder,
  manualOrderEditing,
  onManualOrderChange,
  onManualOrderSave,
  onManualOrderCancel,
  accounts,
  simulators = [],
  accountOpen,
  selectedAccountSeq,
  selectedSimulatorId,
  simulatorMarketCalendars = {},
  simulatorLoading = false,
  simulatorError = "",
  simulatorRenameTarget = null,
  simulatorRenameDraft = "",
  simulatorRenameBusy = false,
  simulatorRenameError = "",
  onAccountOpenChange,
  onAccountSelect,
  onSimulatorSelect,
  onCreateSimulator,
  onOpenExchange,
  onPositionBuy,
  onPositionSell,
  onSimulatorRenameStart,
  onSimulatorRenameDraftChange,
  onSimulatorRenameSubmit,
  onSimulatorRenameCancel,
  valueMode,
  onValueModeChange,
  selectedPositionKey = "",
  onSelectPosition,
  onResetPositionSelection,
}) {
  const displayUnit = normalizeMoneyUnit(unit);
  const [draggedOrderKey, setDraggedOrderKey] = useState("");
  const [dragOverOrderKey, setDragOverOrderKey] = useState("");
  const [dragInsertPlacement, setDragInsertPlacement] = useState("before");
  const [dragPreview, setDragPreview] = useState(null);
  const [positionActionMenu, setPositionActionMenu] = useState(null);
  const pointerDraggedOrderKeyRef = useRef("");
  const pointerDragOverOrderKeyRef = useRef("");
  const pointerDragPlacementRef = useRef("before");
  const manualOrderRef = useRef(manualOrder);
  const manualItemsRef = useRef(items);
  const hasPayload = Boolean(payload?.ok);
  const payloadBalances = payload?.balances && typeof payload.balances === "object" ? payload.balances : {};
  const totalUsd = hasPayload
    ? Number(payload?.cashUsd ?? payload?.usdCash ?? payloadBalances.USD ?? payload?.totalValueUsd ?? items.reduce((sum, item) => sum + Number(item.marketValueUsd || 0), 0))
    : null;
  const totalKrw = hasPayload
    ? Number(payload?.cashKrw ?? payload?.krwCash ?? payloadBalances.KRW ?? payload?.totalValueKrw ?? 0)
    : null;
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const contextualSortOptions = transactionSortOptionsForItems(items);
  const sortLabel = (contextualSortOptions.find((option) => option.id === sortId) || contextualSortOptions[3]).label;
  const accountRows = Array.isArray(accounts) ? accounts : [];
  const simulatorRows = normalizeTransactionSimulatorAccounts(simulators);
  const effectiveAccountSeq = cleanAccountSeq(selectedAccountSeq || payload?.accountSeq);
  const effectiveSimulatorId = cleanTransactionSimulatorId(selectedSimulatorId);
  const selectedAccountIndex = Math.max(
    0,
    accountRows.findIndex((account) => cleanAccountSeq(account.accountSeq) === effectiveAccountSeq)
  );
  const selectedAccount = accountRows[selectedAccountIndex] || {};
  const selectedSimulatorIndex = simulatorRows.findIndex((simulator) => simulator.id === effectiveSimulatorId);
  const selectedSimulator = selectedSimulatorIndex >= 0 ? simulatorRows[selectedSimulatorIndex] : null;
  const priceModeLabel = "현재가";
  const nextValueMode = valueMode === "price" ? "value" : "price";
  const activeValueModeLabel = valueMode === "price" ? priceModeLabel : "평가금";
  const nextValueModeLabel = nextValueMode === "price" ? priceModeLabel : "평가금";
  const accountLabel = selectedSimulator
    ? simulatorDisplayLabel(selectedSimulator, selectedSimulatorIndex)
    : accountRows.length
      ? accountDisplayLabel(selectedAccount, selectedAccountIndex)
      : "기본계좌";
  const summaryLabel = selectedSimulator ? simulatorDisplayLabel(selectedSimulator, selectedSimulatorIndex) : "내 투자";
  const manualSortActive = sortId === "custom" && manualOrderEditing;
  const sideTotalRenameEditing = Boolean(
    selectedSimulator &&
      simulatorRenameTarget?.simulatorId === selectedSimulator.id &&
      simulatorRenameTarget?.placement === "sideTotal"
  );
  const positionSelectionEnabled = Boolean(onSelectPosition && !manualSortActive);
  const positionActionsEnabled = Boolean(selectedSimulator && !positionSelectionEnabled && !manualSortActive);
  const sideTotalResetEnabled = Boolean(onResetPositionSelection);

  useEffect(() => {
    manualOrderRef.current = manualOrder;
  }, [manualOrder]);

  useEffect(() => {
    manualItemsRef.current = items;
  }, [items]);

  const updateDragOverOrderKey = useCallback((orderKey, placement = "before") => {
    pointerDragOverOrderKeyRef.current = orderKey;
    pointerDragPlacementRef.current = placement;
    setDragOverOrderKey(orderKey);
    setDragInsertPlacement(placement);
  }, []);

  const commitManualOrderChange = useCallback((sourceKey, targetKey, placement = "before") => {
    const currentOrder = syncTransactionSidebarManualOrder(manualOrderRef.current, manualItemsRef.current);
    const nextOrder = reorderTransactionSidebarManualOrder(currentOrder, sourceKey, targetKey, placement);
    if (!arraysEqual(currentOrder, nextOrder)) {
      manualOrderRef.current = nextOrder;
      onManualOrderChange(nextOrder);
    }
  }, [onManualOrderChange]);

  const handleManualDragEnd = useCallback(() => {
    pointerDraggedOrderKeyRef.current = "";
    pointerDragOverOrderKeyRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedOrderKey("");
    setDragOverOrderKey("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, []);

  const handleManualPointerStart = useCallback((event, item) => {
    if (!manualSortActive) return;
    if (event.type === "mousedown" && pointerDraggedOrderKeyRef.current) return;
    const orderKey = transactionItemSelectionKey(item);
    if (!orderKey) return;
    pointerDraggedOrderKeyRef.current = orderKey;
    pointerDragOverOrderKeyRef.current = orderKey;
    pointerDragPlacementRef.current = "before";
    setDraggedOrderKey(orderKey);
    setDragOverOrderKey(orderKey);
    setDragInsertPlacement("before");
    setDragPreview({
      key: orderKey,
      ...transactionSidebarPositionView(item, displayUnit, valueMode, usdKrwRate),
      x: event.clientX,
      y: event.clientY,
    });
    if (typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; document-level listeners still drive reordering.
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }, [displayUnit, manualSortActive, usdKrwRate, valueMode]);

  const handleManualPointerMove = useCallback((event) => {
    if (!manualSortActive || !pointerDraggedOrderKeyRef.current) return;
    setDragPreview((current) => (
      current ? { ...current, x: event.clientX, y: event.clientY } : current
    ));
  }, [manualSortActive]);

  const handleManualPointerEnd = useCallback(() => {
    if (!manualSortActive || !pointerDraggedOrderKeyRef.current) return;
    pointerDraggedOrderKeyRef.current = "";
    pointerDragOverOrderKeyRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedOrderKey("");
    setDragOverOrderKey("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, [manualSortActive]);

  const closePositionActionMenu = useCallback(() => {
    setPositionActionMenu(null);
  }, []);

  const openPositionActionMenu = useCallback((event, item) => {
    if (!positionActionsEnabled) return;
    const orderKey = transactionItemSelectionKey(item);
    if (!orderKey) return;
    event.preventDefault();
    event.stopPropagation();
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
    const fallbackRect = event.currentTarget?.getBoundingClientRect?.();
    const rawX = Number.isFinite(event.clientX) && event.clientX > 0
      ? event.clientX
      : (fallbackRect ? fallbackRect.left + fallbackRect.width / 2 : 0);
    const rawY = Number.isFinite(event.clientY) && event.clientY > 0
      ? event.clientY
      : (fallbackRect ? fallbackRect.top + fallbackRect.height / 2 : 0);
    const x = Math.max(8, Math.min(rawX, viewportWidth - 172));
    const y = Math.max(8, Math.min(rawY, viewportHeight - 66));
    setPositionActionMenu({ orderKey, x, y, item });
  }, [positionActionsEnabled]);

  const handlePositionActionKeyDown = useCallback((event, item) => {
    if (!positionActionsEnabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    openPositionActionMenu(event, item);
  }, [openPositionActionMenu, positionActionsEnabled]);

  const handlePositionSelectKeyDown = useCallback((event, item) => {
    if (!positionSelectionEnabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectPosition?.(transactionItemSelectionKey(item));
  }, [onSelectPosition, positionSelectionEnabled]);

  const handlePositionBuy = useCallback((item) => {
    closePositionActionMenu();
    onPositionBuy?.(item);
  }, [closePositionActionMenu, onPositionBuy]);

  const handlePositionSell = useCallback((item) => {
    if (!onPositionSell) return;
    closePositionActionMenu();
    onPositionSell(item);
  }, [closePositionActionMenu, onPositionSell]);

  const handleSideTotalReset = useCallback(() => {
    closePositionActionMenu();
    onResetPositionSelection?.();
  }, [closePositionActionMenu, onResetPositionSelection]);

  const handleSideTotalKeyDown = useCallback((event) => {
    if (!sideTotalResetEnabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleSideTotalReset();
  }, [handleSideTotalReset, sideTotalResetEnabled]);

  useEffect(() => {
    if (!positionActionMenu) return undefined;
    function handleDocumentPointerDown() {
      closePositionActionMenu();
    }
    function handleDocumentContextMenu() {
      closePositionActionMenu();
    }
    function handleDocumentKeyDown(event) {
      if (event.key === "Escape") closePositionActionMenu();
    }
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("contextmenu", handleDocumentContextMenu);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("contextmenu", handleDocumentContextMenu);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [closePositionActionMenu, positionActionMenu]);

  useEffect(() => {
    if (!positionActionMenu) return;
    if (!positionActionsEnabled) {
      closePositionActionMenu();
      return;
    }
    if (!items.some((item) => transactionItemSelectionKey(item) === positionActionMenu.orderKey)) {
      closePositionActionMenu();
    }
  }, [closePositionActionMenu, items, positionActionMenu, positionActionsEnabled]);

  useEffect(() => {
    if (!manualSortActive || !draggedOrderKey) return undefined;
    function dropTargetFromPoint(clientX, clientY) {
      const target = document.elementFromPoint(clientX, clientY);
      const row = target?.closest?.("[data-transaction-order-key]");
      const orderKey = cleanTransactionItemSelectionKey(row?.dataset?.transactionOrderKey);
      if (!row || !orderKey) return null;
      const rect = row.getBoundingClientRect();
      return {
        orderKey,
        placement: clientY > rect.top + rect.height / 2 ? "after" : "before",
      };
    }
    function handleDocumentMove(event) {
      if (!pointerDraggedOrderKeyRef.current) return;
      const clientX = Number(event.clientX || 0);
      const clientY = Number(event.clientY || 0);
      setDragPreview((current) => (
        current ? { ...current, x: clientX, y: clientY } : current
      ));
      const target = dropTargetFromPoint(clientX, clientY);
      if (!target) return;
      if (
        target.orderKey === pointerDragOverOrderKeyRef.current &&
        target.placement === pointerDragPlacementRef.current
      ) {
        return;
      }
      updateDragOverOrderKey(target.orderKey, target.placement);
      if (target.orderKey !== pointerDraggedOrderKeyRef.current) {
        commitManualOrderChange(pointerDraggedOrderKeyRef.current, target.orderKey, target.placement);
      }
    }
    function handleDocumentEnd() {
      handleManualDragEnd();
    }
    document.addEventListener("pointermove", handleDocumentMove);
    document.addEventListener("mousemove", handleDocumentMove);
    document.addEventListener("pointerup", handleDocumentEnd);
    document.addEventListener("mouseup", handleDocumentEnd);
    return () => {
      document.removeEventListener("pointermove", handleDocumentMove);
      document.removeEventListener("mousemove", handleDocumentMove);
      document.removeEventListener("pointerup", handleDocumentEnd);
      document.removeEventListener("mouseup", handleDocumentEnd);
    };
  }, [
    commitManualOrderChange,
    draggedOrderKey,
    handleManualDragEnd,
    manualSortActive,
    updateDragOverOrderKey,
  ]);

  return (
    <aside className="transaction-investment-sidebar" aria-label="내 투자 요약">
      <div className="transaction-account-header">
        <div className="transaction-account-menu">
          {selectedSimulator ? (
            <button
              className="transaction-account-trigger is-simulator"
              type="button"
              onClick={() => onAccountOpenChange(!accountOpen)}
              aria-expanded={accountOpen}
            >
              <span className="transaction-account-dot is-simulator" aria-hidden="true" />
              <strong>{accountLabel}</strong>
              <ChevronDown size={14} strokeWidth={2.4} />
            </button>
          ) : (
            <button
              className="transaction-account-trigger"
              type="button"
              onClick={() => onAccountOpenChange(!accountOpen)}
              aria-expanded={accountOpen}
            >
              <span className="transaction-account-dot" aria-hidden="true" />
              <strong>{accountLabel}</strong>
              <ChevronDown size={14} strokeWidth={2.4} />
            </button>
          )}
          {accountOpen ? (
            <div className="transaction-account-popover" role="menu">
              {accountRows.length ? (
                accountRows.map((account, index) => {
                  const accountSeq = cleanAccountSeq(account.accountSeq);
                  const selected = !effectiveSimulatorId && accountSeq && accountSeq === effectiveAccountSeq;
                  return (
                    <button
                      className={selected ? "is-selected" : ""}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      key={`transaction-account-${accountSeq || index}`}
                      onClick={() => onAccountSelect(accountSeq)}
                    >
                      <span>{accountDisplayLabel(account, index)}</span>
                      {selected ? <Check size={15} strokeWidth={2.6} /> : null}
                    </button>
                  );
                })
              ) : (
                <span>정규 계좌 없음</span>
              )}
              {simulatorRows.length ? (
                <div className="transaction-account-popover-divider" role="separator" />
              ) : null}
              {simulatorRows.map((simulator, index) => {
                const selected = simulator.id === effectiveSimulatorId;
                return (
                  <button
                    className={selected ? "is-selected is-simulator" : "is-simulator"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    key={`transaction-simulator-account-${simulator.id}`}
                    onClick={() => onSimulatorSelect(simulator.id)}
                  >
                    <span>{simulatorDisplayLabel(simulator, index)}</span>
                    {selected ? <Check size={15} strokeWidth={2.6} /> : null}
                  </button>
                );
              })}
              {simulatorLoading ? (
                <span className="transaction-account-popover-status">시뮬레이터 장부 확인 중</span>
              ) : null}
              {simulatorError ? (
                <span className="transaction-account-popover-error">{simulatorError}</span>
              ) : null}
              <button
                className="transaction-account-create-simulator"
                type="button"
                role="menuitem"
                disabled={simulatorLoading}
                onClick={onCreateSimulator}
              >
                <span>
                  <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                  <span>{simulatorLoading ? "시뮬레이터 준비 중" : "투자 시뮬레이터 추가"}</span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
        <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="사이드바 통화 표시" />
      </div>

      {selectedSimulator ? (
        <div className="transaction-cash-grid is-actionable" aria-label="시뮬레이터 현금 잔고">
          <button type="button" onClick={() => onOpenExchange?.("KRW_TO_USD")}>
            <span>원화</span>
            <strong>{formatOptionalMoney(hasPayload, totalKrw, "KRW")}</strong>
          </button>
          <button type="button" onClick={() => onOpenExchange?.("USD_TO_KRW")}>
            <span>달러</span>
            <strong>{hasPayload ? formatUsd(totalUsd) : "-"}</strong>
          </button>
        </div>
      ) : (
        <div className="transaction-cash-grid" aria-label="현금 잔고">
          <div>
            <span>원화</span>
            <strong>{formatOptionalMoney(hasPayload, totalKrw, "KRW")}</strong>
          </div>
          <div>
            <span>달러</span>
            <strong>{hasPayload ? formatUsd(totalUsd) : "-"}</strong>
          </div>
        </div>
      )}

      <section
        className={sideTotalResetEnabled ? "transaction-side-total is-clickable" : "transaction-side-total"}
        role={sideTotalResetEnabled ? "button" : undefined}
        tabIndex={sideTotalResetEnabled ? 0 : undefined}
        title={sideTotalResetEnabled ? "내 투자 첫 화면으로 이동" : undefined}
        aria-label={sideTotalResetEnabled ? "내 투자 첫 화면으로 이동" : undefined}
        onClick={sideTotalResetEnabled ? handleSideTotalReset : undefined}
        onKeyDown={handleSideTotalKeyDown}
      >
        <span>
          {selectedSimulator ? (
            <SimulatorEditableName
              simulator={selectedSimulator}
              index={selectedSimulatorIndex}
              placement="sideTotal"
              editing={sideTotalRenameEditing}
              draft={simulatorRenameDraft}
              busy={simulatorRenameBusy}
              error={sideTotalRenameEditing ? simulatorRenameError : ""}
              onStart={onSimulatorRenameStart}
              onDraftChange={onSimulatorRenameDraftChange}
              onSubmit={onSimulatorRenameSubmit}
              onCancel={onSimulatorRenameCancel}
            />
          ) : summaryLabel}
        </span>
        <strong>{formatOptionalMoney(hasPayload && totals.value.hasValue, totals.value.value, displayUnit)}</strong>
        <em className={hasPayload ? valueTone(totals.profit.value) : ""}>
          {formatOptionalPerformance(
            hasPayload && totals.profit.hasValue,
            totals.profit.value,
            totals.profitPercent,
            displayUnit
          )}
        </em>
      </section>

      <div className="transaction-side-controls">
        <SortMenu
          sortId={sortId}
          open={sortOpen}
          onOpenChange={onSortOpenChange}
          onSelect={onSortSelect}
          items={items}
        />
        {manualSortActive ? (
          <div className="transaction-manual-order-actions" role="group" aria-label="수동 정렬 편집">
            <button className="is-primary" type="button" onClick={onManualOrderSave}>
              저장
            </button>
            <button type="button" onClick={onManualOrderCancel}>
              취소
            </button>
          </div>
        ) : (
          <div className="transaction-value-mode" role="group" aria-label="보유 목록 값 표시">
            <button
              type="button"
              className="is-active"
              aria-pressed={valueMode === "price"}
              aria-label={`${activeValueModeLabel} 표시 중. 클릭하면 ${nextValueModeLabel} 표시`}
              title={`${nextValueModeLabel} 표시`}
              onClick={() => onValueModeChange(nextValueMode)}
            >
              <span className={valueMode === "price" ? "is-active" : ""}>{priceModeLabel}</span>
              <span className={valueMode === "value" ? "is-active" : ""}>평가금</span>
            </button>
          </div>
        )}
      </div>

      <ol
        className={dragPreview ? "transaction-side-position-list is-dragging" : "transaction-side-position-list"}
        aria-label={`${sortLabel} 보유 종목`}
        onPointerMove={handleManualPointerMove}
        onPointerUp={handleManualPointerEnd}
        onPointerCancel={handleManualDragEnd}
        onMouseMove={handleManualPointerMove}
        onMouseUp={handleManualPointerEnd}
      >
        {items.map((item) => {
          const orderKey = transactionItemSelectionKey(item);
          const selectionKey = orderKey;
          const positionView = transactionSidebarPositionView(item, displayUnit, valueMode, usdKrwRate);
          const positionSelected = positionSelectionEnabled && selectionKey === selectedPositionKey;
          const positionInteractive = positionActionsEnabled || positionSelectionEnabled;
          const itemClassName = [
            "transaction-side-position-item",
            positionActionsEnabled ? "is-simulator-actionable" : "",
            positionSelectionEnabled ? "is-selectable" : "",
            positionSelected ? "is-selected" : "",
            positionActionMenu?.orderKey === selectionKey ? "is-action-open" : "",
            manualSortActive ? "is-manual-sort" : "",
            dragOverOrderKey === orderKey && draggedOrderKey && draggedOrderKey !== orderKey
              ? `is-drop-${dragInsertPlacement}`
              : "",
            draggedOrderKey === orderKey ? "is-dragging" : "",
          ].filter(Boolean).join(" ");
          return (
            <li
              className={itemClassName}
              key={`transaction-side-${selectionKey}`}
              data-transaction-order-key={orderKey}
              role={positionInteractive ? "button" : undefined}
              tabIndex={positionInteractive ? 0 : undefined}
              aria-pressed={positionSelectionEnabled ? positionSelected : undefined}
              aria-label={
                positionActionsEnabled
                  ? `${displayName(item)} 거래 메뉴 열기`
                  : positionSelectionEnabled
                    ? `${displayName(item)} 상세 보기`
                    : undefined
              }
              onClick={
                positionActionsEnabled
                  ? (event) => openPositionActionMenu(event, item)
                  : positionSelectionEnabled
                    ? () => onSelectPosition?.(selectionKey)
                    : undefined
              }
              onKeyDown={
                positionActionsEnabled
                  ? (event) => handlePositionActionKeyDown(event, item)
                  : positionSelectionEnabled
                    ? (event) => handlePositionSelectKeyDown(event, item)
                    : undefined
              }
            >
              {manualSortActive ? (
                <button
                  className="transaction-side-drag-handle"
                  type="button"
                  title="클릭해서 드래그하면 순서를 바꿀 수 있습니다"
                  aria-label={`${displayName(item)} 순서 드래그`}
                  onPointerDown={(event) => handleManualPointerStart(event, item)}
                  onMouseDown={(event) => handleManualPointerStart(event, item)}
                >
                  <GripVertical size={16} strokeWidth={2.2} />
                </button>
              ) : null}
              <div className="transaction-side-position-name">
                <strong>
                  <span>{positionView.positionName}</span>
                  {positionView.translationPending ? (
                    <small className="transaction-name-translation-status">번역대기중</small>
                  ) : null}
                </strong>
                <span>{positionView.positionMeta}</span>
              </div>
              <div className="transaction-side-position-value">
                <strong>{positionView.valueLabel}</strong>
                <span className={positionView.toneClass}>{positionView.changeLabel}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <SimulatorPositionActionPopover
        menu={positionActionMenu}
        onClose={closePositionActionMenu}
        onBuy={handlePositionBuy}
        onSell={onPositionSell ? handlePositionSell : null}
      />
      {dragPreview ? (
        <div
          className="transaction-side-drag-preview"
          style={{ "--transaction-drag-x": `${dragPreview.x}px`, "--transaction-drag-y": `${dragPreview.y}px` }}
          aria-hidden="true"
        >
          <div className="transaction-side-position-name">
            <strong>
              <span>{dragPreview.positionName}</span>
              {dragPreview.translationPending ? (
                <small className="transaction-name-translation-status">번역대기중</small>
              ) : null}
            </strong>
            <span>{dragPreview.positionMeta}</span>
          </div>
          <div className="transaction-side-position-value">
            <strong>{dragPreview.valueLabel}</strong>
            <span className={dragPreview.toneClass}>{dragPreview.changeLabel}</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function renderTransactionTableCell(columnId, { item, itemUnit, displayUnit, usdKrwRate }) {
  if (columnId === "ticker") return item.symbol || "-";
  if (columnId === "name") return <TransactionTranslatedName item={item} />;
  if (columnId === "profitPercent") return formatSignedPercent(item.profitPercent);
  if (columnId === "profit") {
    const profit = convertedMoney(item.profit, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalSignedMoney(profit.hasValue, profit.value, displayUnit);
  }
  if (columnId === "value") {
    const value = convertedMoney(item.value, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalMoney(value.hasValue, value.value, displayUnit);
  }
  if (columnId === "costBasis") {
    const costBasis = convertedMoney(item.costBasis, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalMoney(costBasis.hasValue, costBasis.value, displayUnit);
  }
  if (columnId === "currentPrice") {
    const currentPrice = convertedMoney(item.currentPrice, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalMoney(currentPrice.hasValue, currentPrice.value, displayUnit);
  }
  if (columnId === "quantity") return formatQuantity(item.quantity, item);
  if (columnId === "averageKnownCost") {
    const averageKnownCost = convertedMoney(item.averageKnownCost, itemUnit, displayUnit, usdKrwRate);
    return item.averageKnownCost ? formatOptionalMoney(averageKnownCost.hasValue, averageKnownCost.value, displayUnit) : "-";
  }
  if (columnId === "dailyReturnPercent") return formatSignedPercent(item.dailyReturnPercent);
  if (columnId === "dailyProfit") {
    const dailyProfit = convertedMoney(item.dailyProfit, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalSignedMoney(dailyProfit.hasValue, dailyProfit.value, displayUnit);
  }
  return "-";
}

export function transactionContextInstrumentRow(item = {}, displayUnit = "KRW", usdKrwRate = 0) {
  const itemUnit = normalizeMoneyUnit(item.displayCurrency || item.currency || displayUnit);
  const convert = (value) => {
    const result = convertedMoney(value, itemUnit, displayUnit, usdKrwRate);
    return result.hasValue ? result.value : null;
  };
  return {
    instrumentId: transactionInstrumentKey(item),
    provider: String(item.provider || "toss").trim(),
    venue: String(item.venue || "").trim(),
    assetClass: String(item.assetClass || "").trim(),
    symbol: cleanTransactionWatchlistSymbol(item.symbol),
    name: displayName(item),
    market: String(item.market || "").trim(),
    sourceCurrency: itemUnit,
    displayCurrency: displayUnit,
    quantity: Number(item.quantity || 0),
    value: Number(item.value || 0),
    costBasis: Number(item.costBasis || 0),
    profit: Number(item.profit || 0),
    profitPercent: Number(item.profitPercent || 0),
    currentPrice: Number(item.currentPrice || 0),
    averageKnownCost: Number(item.averageKnownCost || 0),
    dailyReturnPercent: Number(item.dailyReturnPercent || 0),
    marketDailyReturnPercent: Number.isFinite(Number(item.marketDailyReturnPercent))
      ? Number(item.marketDailyReturnPercent)
      : null,
    dailyProfit: Number(item.dailyProfit || 0),
    displayed: {
      value: convert(item.value),
      costBasis: convert(item.costBasis),
      profit: convert(item.profit),
      currentPrice: convert(item.currentPrice),
      averageKnownCost: item.averageKnownCost ? convert(item.averageKnownCost) : null,
      dailyProfit: convert(item.dailyProfit),
      quantityLabel: formatQuantity(item.quantity, item),
    },
  };
}

export function transactionInvestmentOverviewDisplayData({
  kind,
  title,
  accountType,
  accountId = "",
  items = [],
  filteredItems = [],
  payload = null,
  displayUnit = "KRW",
  usdKrwRate = 0,
  activeFilter = "all",
  selectedColumnIds = [],
  sidebarValueMode = "value",
} = {}) {
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const visibleColumns = visibleTransactionMainTableColumns(selectedColumnIds);
  return {
    schemaVersion: "transaction-status-display-data.v1",
    id: kind,
    title,
    kind,
    exposure: "context",
    summary: {
      status: payload?.ok ? "ready" : "waiting",
      accountType,
      accountId,
      displayUnit,
      activeFilter,
      holdingCount: items.length,
      visibleRowCount: filteredItems.length,
      totalValue: totals.value.hasValue ? totals.value.value : null,
      totalCostBasis: totals.costBasis.hasValue ? totals.costBasis.value : null,
      totalProfit: totals.profit.hasValue ? totals.profit.value : null,
      totalProfitPercent: totals.profitPercent,
      dailyProfit: totals.dailyProfit.hasValue ? totals.dailyProfit.value : null,
      dailyReturnPercent: Number(payload?.dailyReturnPercent || 0),
      cashKrw: Number(payload?.cashKrw ?? payload?.balances?.KRW ?? 0),
      cashUsd: Number(payload?.cashUsd ?? payload?.balances?.USD ?? 0),
      source: String(payload?.source || "").trim(),
      fetchedAt: String(payload?.fetchedAt || "").trim(),
    },
    data: {
      sidebarItems: items.map((item) => ({
        ...transactionContextInstrumentRow(item, displayUnit, usdKrwRate),
        sidebar: transactionSidebarPositionView(item, displayUnit, sidebarValueMode, usdKrwRate),
      })),
      tableColumns: visibleColumns.map((column) => ({ id: column.id, label: column.label })),
      tableRows: filteredItems.map((item) => transactionContextInstrumentRow(item, displayUnit, usdKrwRate)),
    },
  };
}

export function transactionWatchlistContextRow(row = {}) {
  return {
    instrumentId: cleanTransactionInstrumentId(row.instrumentId),
    provider: String(row.provider || "toss").trim(),
    venue: String(row.venue || "").trim(),
    assetClass: String(row.assetClass || "").trim(),
    symbol: cleanTransactionWatchlistSymbol(row.symbol),
    name: String(row.name || row.symbol || "").trim(),
    currency: String(row.price?.currency || row.item?.currency || "").trim(),
    lastPrice: Number.isFinite(Number(row.lastPrice)) ? Number(row.lastPrice) : null,
    dailyReturnPercent: row.hasDailyReturn ? Number(row.dailyReturnPercent) : null,
    weeklyReturnPercent: row.hasWeeklyReturn ? Number(row.weeklyReturnPercent) : null,
    monthlyReturnPercent: row.hasMonthlyReturn ? Number(row.monthlyReturnPercent) : null,
    sixMonthReturnPercent: row.hasSixMonthReturn ? Number(row.sixMonthReturnPercent) : null,
    timestamp: String(row.price?.timestamp || "").trim(),
  };
}

export function InvestmentTable({
  items,
  payload,
  unit,
  usdKrwRate,
  selectedColumnIds,
  emptyLabel = "보유 종목이 없습니다.",
  onSelectItem,
}) {
  const displayUnit = normalizeMoneyUnit(unit);
  const visibleColumns = useMemo(() => visibleTransactionMainTableColumns(selectedColumnIds), [selectedColumnIds]);
  const periodPrefix = transactionPerformancePeriodPrefix(items);
  return (
    <div className="transaction-main-table-wrap">
      <table className="transaction-main-table" style={{ "--transaction-table-column-count": visibleColumns.length }}>
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th className={column.align === "left" ? "is-left" : ""} key={`transaction-table-head-${column.id}`}>
                {column.id === "dailyReturnPercent"
                  ? `${periodPrefix} 수익률`
                  : column.id === "dailyProfit"
                    ? `${periodPrefix} 수익금`
                    : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const itemUnit = item.displayCurrency || item.currency || displayUnit;
            const rowKey = transactionItemSelectionKey(item);
            const rowContext = { item, itemUnit, displayUnit, usdKrwRate };
            return (
              <tr
                className={onSelectItem ? "transaction-investment-row is-selectable" : "transaction-investment-row"}
                key={`transaction-table-${rowKey}`}
                tabIndex={onSelectItem ? 0 : undefined}
                aria-label={onSelectItem ? `${displayName(item)} 차트 보기` : undefined}
                onClick={onSelectItem ? () => onSelectItem(rowKey) : undefined}
                onKeyDown={onSelectItem ? (event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelectItem(rowKey);
                } : undefined}
              >
                {visibleColumns.map((column) => {
                  const toneClass = column.toneField ? valueTone(item[column.toneField]) : "";
                  const className = [column.align === "left" ? "is-left" : "", column.className || "", toneClass]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td className={className} key={`transaction-table-${rowKey}-${column.id}`}>
                      {renderTransactionTableCell(column.id, rowContext)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!items.length ? (
        <div className="transaction-empty-state">{emptyLabel}</div>
      ) : null}
      <div className="transaction-table-credit">
        <span>{payload?.source || "토스 증권 API"}</span>
        {payload?.fetchedAt ? <span>{formatUpdatedAt(payload.fetchedAt)}</span> : null}
      </div>
    </div>
  );
}

export function formatTransactionCandleRowLabel(row = {}) {
  return String(row.date || row.timestamp || "").slice(5, 10).replace("-", ".");
}

export const TransactionAssetDailyTable = React.memo(function TransactionAssetDailyTable({
  rows,
  unit,
  initialLoading = false,
  loadingMore = false,
  hasMore = true,
  error = "",
  onLoadMore,
  onRetry,
}) {
  const tableWrapRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const tableRows = useMemo(() => {
    const sourceRows = aggregateTransactionInvestmentDailyRows(Array.isArray(rows) ? rows : []);
    return sourceRows
      .map((row, index) => {
        const previousClose = sourceRows[index - 1]?.close;
        const changePercent = previousClose > 0 ? ((row.close - previousClose) / previousClose) * 100 : 0;
        return {
          ...row,
          changePercent,
        };
      })
      .reverse();
  }, [rows]);

  useEffect(() => {
    const root = tableWrapRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (
      !root ||
      !sentinel ||
      initialLoading ||
      loadingMore ||
      Boolean(error) ||
      !hasMore ||
      typeof onLoadMore !== "function" ||
      typeof IntersectionObserver === "undefined"
    ) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      {
        root,
        rootMargin: "0px 0px 120px 0px",
        threshold: 0,
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMore, initialLoading, loadingMore, onLoadMore, tableRows.length]);

  return (
    <section className="transaction-asset-daily-panel" aria-label="일별 시세">
      <div className="transaction-asset-daily-toolbar">
        <strong>시세</strong>
      </div>
      <div
        className="transaction-asset-daily-table-wrap"
        ref={tableWrapRef}
        aria-busy={initialLoading || loadingMore}
      >
        <table className="transaction-main-table transaction-asset-daily-table">
          <colgroup>
            <col className="transaction-asset-daily-col-date" />
            <col className="transaction-asset-daily-col-price" />
            <col className="transaction-asset-daily-col-change" />
            <col className="transaction-asset-daily-col-volume" />
            <col className="transaction-asset-daily-col-turnover" />
            <col className="transaction-asset-daily-col-price" />
            <col className="transaction-asset-daily-col-price" />
            <col className="transaction-asset-daily-col-price" />
          </colgroup>
          <thead>
            <tr>
              <th className="is-left">일자</th>
              <th>종가</th>
              <th>등락률</th>
              <th>거래량</th>
              <th>거래대금</th>
              <th>시가</th>
              <th>고가</th>
              <th>저가</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={`transaction-asset-daily-${row.timestamp || row.date}`}>
                <td className="is-left">{formatTransactionCandleRowLabel(row)}</td>
                <td>{formatMoney(row.close, unit)}</td>
                <td className={valueTone(row.changePercent)}>{formatSignedPercent(row.changePercent)}</td>
                <td>{row.volume ? Math.round(row.volume).toLocaleString("ko-KR") : "-"}</td>
                <td>{row.turnover ? formatCompactMoney(row.turnover, unit) : "-"}</td>
                <td>{formatMoney(row.open, unit)}</td>
                <td>{formatMoney(row.high, unit)}</td>
                <td>{formatMoney(row.low, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {initialLoading && !tableRows.length ? (
          <div className="transaction-asset-daily-load-state" role="status">
            <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
            <span>일별 시세 로딩</span>
          </div>
        ) : null}
        {!initialLoading && !tableRows.length && !error ? (
          <div className="transaction-empty-state">일별 시세가 없습니다.</div>
        ) : null}
        {error ? (
          <div className="transaction-asset-daily-load-state is-error" role="status">
            <span>{error}</span>
            <button type="button" onClick={tableRows.length ? onLoadMore : onRetry}>
              다시 불러오기
            </button>
          </div>
        ) : null}
        {loadingMore ? (
          <div className="transaction-asset-daily-load-state" role="status">
            <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
            <span>이전 일별 시세 로딩</span>
          </div>
        ) : null}
        <div className="transaction-asset-daily-load-sentinel" ref={loadMoreSentinelRef} aria-hidden="true" />
      </div>
    </section>
  );
});

export function TransactionInvestmentAssetDetail({
  item,
  payload,
  unit,
  usdKrwRate,
  onUnitChange,
  onClose,
  statusBannerProps,
  binanceStatus,
  binanceError = "",
  chartModeSetting = defaultTransactionCurrencySettings.investmentChartMode,
  intervalModeSetting = defaultTransactionCurrencySettings.investmentChartIntervalMode,
  volumeVisibleSetting = defaultTransactionCurrencySettings.investmentChartVolumeVisible,
  onChartModeChange,
  onIntervalModeChange,
  onVolumeVisibleChange,
  onBuy,
  onSell,
  onDisplayData,
}) {
  const chartContainerRef = useRef(null);
  const minuteMenuRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const seriesModeRef = useRef("");
  const averagePriceLineRef = useRef(null);
  const averagePriceLineValueRef = useRef(null);
  const previousChartKeyRef = useRef("");
  const chartOptionsKeyRef = useRef("");
  const priceSeriesDataRef = useRef({ identity: "", rows: [] });
  const volumeSeriesDataRef = useRef({ identity: "", rows: [] });
  const visibleRangeSubscriptionRef = useRef(null);
  const chartRangeUpdateSuppressedRef = useRef(false);
  const chartRangeSuppressionTimerRef = useRef(null);
  const chartOlderLoadIntentRef = useRef(false);
  const chartOlderLoadIntentTimerRef = useRef(null);
  const previousFirstCandleKeyRef = useRef("");
  const candleOlderLoadingRef = useRef(false);
  const candleOlderControllerRef = useRef(null);
  const candleOlderLoadedBeforeRef = useRef(new Set());
  const loadOlderCandlesRef = useRef(() => {});
  const dailyCandleLoadingRef = useRef(false);
  const dailyCandleControllerRef = useRef(null);
  const dailyCandleLoadedBeforeRef = useRef(new Set());
  const [chartMode, setChartMode] = useState(() => normalizeTransactionInvestmentChartModeSetting(chartModeSetting));
  const [intervalMode, setIntervalMode] = useState(() => normalizeTransactionInvestmentChartIntervalSetting(intervalModeSetting));
  const [volumeVisible, setVolumeVisible] = useState(() =>
    normalizeTransactionBooleanSetting(volumeVisibleSetting, defaultTransactionCurrencySettings.investmentChartVolumeVisible)
  );
  const [minuteMenuOpen, setMinuteMenuOpen] = useState(false);
  const [candlePayload, setCandlePayload] = useState(null);
  const [candleLoading, setCandleLoading] = useState(false);
  const [candleOlderLoading, setCandleOlderLoading] = useState(false);
  const [candleOlderError, setCandleOlderError] = useState("");
  const [candleError, setCandleError] = useState("");
  const [dailyCandlePayload, setDailyCandlePayload] = useState(null);
  const [dailyCandleLoading, setDailyCandleLoading] = useState(false);
  const [dailyCandleOlderLoading, setDailyCandleOlderLoading] = useState(false);
  const [dailyCandleError, setDailyCandleError] = useState("");
  const requestedDisplayUnit = normalizeMoneyUnit(unit);
  const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
  const instrumentId = transactionInstrumentKey(item);
  const candleInstrument = useMemo(
    () => normalizeTransactionInstrument({ instrumentId, symbol }),
    [instrumentId, symbol]
  );
  const itemUnit = normalizeMoneyUnit(item?.displayCurrency || item?.currency || payload?.unit || requestedDisplayUnit);
  const displayUnit = requestedDisplayUnit === itemUnit || convertMoney(1, itemUnit, requestedDisplayUnit, usdKrwRate) !== null
    ? requestedDisplayUnit
    : itemUnit;
  const averagePrice = Number(item?.averageKnownCost || 0);
  const currentPrice = Number(item?.currentPrice || 0);
  const marketDailyReturnPercent = Number(item?.marketDailyReturnPercent);
  const dailyReturnPercent = Number.isFinite(marketDailyReturnPercent)
    ? marketDailyReturnPercent
    : Number(item?.dailyReturnPercent || 0);
  const itemName = displayName(item);
  const applyLatestCandlePayload = useCallback((nextPayload, { replace = false } = {}) => {
    const sourceInterval = nextPayload?.interval || transactionInvestmentSourceInterval(intervalMode);
    const nextRows = transactionInvestmentCandleRowsFromPayload(nextPayload?.candles || [], sourceInterval);
    setCandlePayload((current) => {
      const currentInterval = current?.interval || sourceInterval;
      const currentSymbol = cleanTransactionWatchlistSymbol(current?.symbol);
      if (replace || !current || currentSymbol !== symbol || currentInterval !== sourceInterval) {
        return {
          ...nextPayload,
          interval: sourceInterval,
          requestedInterval: intervalMode,
          candles: nextRows,
        };
      }
      const mergedRows = mergeTransactionInvestmentCandleRows(current?.candles || [], nextRows, sourceInterval);
      if (transactionInvestmentCandleRowsEqual(current?.candles || [], mergedRows, sourceInterval)) {
        return current;
      }
      return {
        ...nextPayload,
        interval: sourceInterval,
        requestedInterval: intervalMode,
        candles: mergedRows,
        nextBefore: current?.nextBefore || nextPayload?.nextBefore || "",
        hasMore: current?.hasMore === false ? false : nextPayload?.hasMore !== false,
      };
    });
  }, [intervalMode, symbol]);

  useEffect(() => {
    setChartMode(normalizeTransactionInvestmentChartModeSetting(chartModeSetting));
  }, [chartModeSetting]);

  useEffect(() => {
    setIntervalMode(normalizeTransactionInvestmentChartIntervalSetting(intervalModeSetting));
    setMinuteMenuOpen(false);
  }, [intervalModeSetting]);

  useEffect(() => {
    setVolumeVisible(
      normalizeTransactionBooleanSetting(volumeVisibleSetting, defaultTransactionCurrencySettings.investmentChartVolumeVisible)
    );
  }, [volumeVisibleSetting]);

  const handleChartModeSelect = useCallback((nextMode) => {
    const normalizedMode = normalizeTransactionInvestmentChartModeSetting(nextMode);
    setChartMode(normalizedMode);
    onChartModeChange?.(normalizedMode);
  }, [onChartModeChange]);

  const handleIntervalModeSelect = useCallback((nextInterval) => {
    const normalizedInterval = normalizeTransactionInvestmentChartIntervalSetting(nextInterval);
    setIntervalMode(normalizedInterval);
    setMinuteMenuOpen(false);
    onIntervalModeChange?.(normalizedInterval);
  }, [onIntervalModeChange]);

  const handleVolumeVisibleChange = useCallback((event) => {
    const nextVisible = Boolean(event.target.checked);
    setVolumeVisible(nextVisible);
    onVolumeVisibleChange?.(nextVisible);
  }, [onVolumeVisibleChange]);

  useEffect(() => {
    if (!minuteMenuOpen) return undefined;
    function closeMinuteMenuFromOutside(event) {
      const menu = minuteMenuRef.current;
      if (menu && event.target && menu.contains(event.target)) return;
      setMinuteMenuOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setMinuteMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMinuteMenuFromOutside, true);
    document.addEventListener("focusin", closeMinuteMenuFromOutside, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeMinuteMenuFromOutside, true);
      document.removeEventListener("focusin", closeMinuteMenuFromOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [minuteMenuOpen]);

  useEffect(() => {
    if (!onClose) return undefined;
    function handleChartKeyDown(event) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (minuteMenuOpen || document.querySelector('[aria-modal="true"]')) return;
      onClose();
    }
    document.addEventListener("keydown", handleChartKeyDown);
    return () => document.removeEventListener("keydown", handleChartKeyDown);
  }, [minuteMenuOpen, onClose]);

  useEffect(() => {
    if (!symbol) {
      setCandlePayload(null);
      setCandleLoading(false);
      setCandleOlderLoading(false);
      setCandleOlderError("");
      setCandleError("");
      candleOlderLoadingRef.current = false;
      candleOlderControllerRef.current?.abort();
      candleOlderControllerRef.current = null;
      candleOlderLoadedBeforeRef.current = new Set();
      previousFirstCandleKeyRef.current = "";
      return undefined;
    }
    const controller = new AbortController();
    let latestRefreshBusy = false;
    setCandleOlderLoading(false);
    setCandleOlderError("");
    candleOlderLoadingRef.current = false;
    candleOlderControllerRef.current?.abort();
    candleOlderControllerRef.current = null;
    candleOlderLoadedBeforeRef.current = new Set();
    previousFirstCandleKeyRef.current = "";
    async function loadCandles({ replace = false } = {}) {
      if (latestRefreshBusy) return;
      latestRefreshBusy = true;
      if (replace) {
        setCandleLoading(true);
        setCandleError("");
      }
      try {
        const nextPayload = await fetchTransactionInvestmentDetailCandles(candleInstrument, intervalMode, controller.signal, { force: true });
        if (controller.signal.aborted) return;
        applyLatestCandlePayload(nextPayload, { replace });
        setCandleError("");
      } catch (fetchError) {
        if (replace && fetchError.name !== "AbortError") {
          setCandleError(fetchError.message || "일별 시세를 불러오지 못했습니다.");
        }
      } finally {
        latestRefreshBusy = false;
        if (replace && !controller.signal.aborted) setCandleLoading(false);
      }
    }
    void loadCandles({ replace: true });
    const timer = window.setInterval(() => {
      if (candleOlderLoadingRef.current) return;
      void loadCandles();
    }, transactionInvestmentDetailCandleRefreshMs);
    return () => {
      window.clearInterval(timer);
      controller.abort();
      candleOlderControllerRef.current?.abort();
      candleOlderControllerRef.current = null;
    };
  }, [applyLatestCandlePayload, candleInstrument, instrumentId, intervalMode, symbol]);

  const loadInitialDailyCandles = useCallback(async () => {
    if (!symbol || dailyCandleLoadingRef.current) return;
    dailyCandleLoadingRef.current = true;
    dailyCandleControllerRef.current?.abort();
    const controller = new AbortController();
    dailyCandleControllerRef.current = controller;
    setDailyCandleLoading(true);
    setDailyCandleOlderLoading(false);
    setDailyCandleError("");
    try {
      const nextPayload = await fetchTransactionInvestmentDetailCandles(candleInstrument, "1d", controller.signal, { force: true });
      if (controller.signal.aborted) return;
      setDailyCandlePayload({
        ...nextPayload,
        interval: "1d",
        requestedInterval: "1d",
        candles: transactionInvestmentCandleRowsFromPayload(nextPayload?.candles || [], "1d"),
      });
    } catch (fetchError) {
      if (fetchError.name !== "AbortError" && !controller.signal.aborted) {
        setDailyCandleError(fetchError.message || "일별 시세를 불러오지 못했습니다.");
      }
    } finally {
      if (dailyCandleControllerRef.current === controller) {
        dailyCandleControllerRef.current = null;
        dailyCandleLoadingRef.current = false;
        if (!controller.signal.aborted) setDailyCandleLoading(false);
      }
    }
  }, [candleInstrument, instrumentId, symbol]);

  useEffect(() => {
    dailyCandleControllerRef.current?.abort();
    dailyCandleControllerRef.current = null;
    dailyCandleLoadingRef.current = false;
    dailyCandleLoadedBeforeRef.current = new Set();
    setDailyCandlePayload(null);
    setDailyCandleLoading(Boolean(symbol));
    setDailyCandleOlderLoading(false);
    setDailyCandleError("");
    if (symbol) void loadInitialDailyCandles();
    return () => {
      dailyCandleControllerRef.current?.abort();
      dailyCandleControllerRef.current = null;
      dailyCandleLoadingRef.current = false;
    };
  }, [loadInitialDailyCandles, symbol]);

  const rawCandleRows = useMemo(
    () => transactionInvestmentCandleRowsFromPayload(candlePayload?.candles || [], candlePayload?.interval || intervalMode),
    [candlePayload?.candles, candlePayload?.interval, intervalMode]
  );
  const candleRows = useMemo(
    () => aggregateTransactionInvestmentRows(rawCandleRows, intervalMode),
    [intervalMode, rawCandleRows]
  );
  const dailyCandleRows = useMemo(
    () => transactionInvestmentCandleRowsFromPayload(dailyCandlePayload?.candles || [], "1d"),
    [dailyCandlePayload?.candles]
  );
  const latestCandle = candleRows[candleRows.length - 1] || null;
  const effectiveCurrentPrice = currentPrice > 0 ? currentPrice : latestCandle?.close || 0;
  const displayAveragePrice = convertMoney(averagePrice, itemUnit, displayUnit, usdKrwRate) ?? 0;
  const displayCandleRows = useMemo(
    () => transactionInvestmentDisplayCandleRows(candleRows, itemUnit, displayUnit, usdKrwRate),
    [candleRows, displayUnit, itemUnit, usdKrwRate]
  );
  const displayDailyCandleRows = useMemo(
    () => transactionInvestmentDisplayCandleRows(dailyCandleRows, itemUnit, displayUnit, usdKrwRate),
    [dailyCandleRows, displayUnit, itemUnit, usdKrwRate]
  );
  const visibleCandleRows = useMemo(() => normalizeTransactionChartRows(displayCandleRows), [displayCandleRows]);
  const lineData = useMemo(
    () => transactionInvestmentLineChartData(visibleCandleRows),
    [visibleCandleRows]
  );
  const ohlcData = useMemo(
    () => transactionInvestmentOhlcChartData(visibleCandleRows),
    [visibleCandleRows]
  );
  const volumeData = useMemo(
    () => transactionInvestmentVolumeChartData(visibleCandleRows, lineData),
    [lineData, visibleCandleRows]
  );
  const chartDataReady = useMemo(
    () => transactionInvestmentChartDataReady(lineData, volumeData, volumeVisible),
    [lineData, volumeData, volumeVisible]
  );
  const chartPalette = transactionInvestmentDirectionPalette(dailyReturnPercent);
  const chartColor = chartPalette.lineColor;
  const chartFillColor = chartPalette.fillColor;
  const chartFillBottomColor = chartPalette.fillBottomColor;
  const chartKey = `${symbol}|${intervalMode}|${chartMode}`;
  const displayData = useMemo(() => ({
    schemaVersion: "transaction-status-display-data.v1",
    id: "investment-chart-detail",
    title: `${itemName} 차트뷰`,
    kind: "investment-chart-detail",
    exposure: "rag",
    summary: {
      status: candleLoading ? "loading" : candleError ? "error" : chartDataReady ? "ready" : "empty",
      error: candleError || candleOlderError,
      instrumentId,
      provider: String(item?.provider || "toss").trim(),
      venue: String(item?.venue || "").trim(),
      symbol,
      name: itemName,
      chartMode,
      intervalMode,
      volumeVisible,
      sourceCurrency: itemUnit,
      displayCurrency: displayUnit,
      candleCount: visibleCandleRows.length,
      dailyCandleCount: displayDailyCandleRows.length,
      startTime: visibleCandleRows[0]?.time || visibleCandleRows[0]?.date || "",
      endTime: visibleCandleRows.at(-1)?.time || visibleCandleRows.at(-1)?.date || "",
      currentPrice: effectiveCurrentPrice,
      displayCurrentPrice: convertMoney(effectiveCurrentPrice, itemUnit, displayUnit, usdKrwRate),
      averageKnownCost: averagePrice,
      displayAverageKnownCost: displayAveragePrice,
      quantity: Number(item?.quantity || 0),
      value: Number(item?.value || 0),
      profit: Number(item?.profit || 0),
      profitPercent: Number(item?.profitPercent || 0),
      dailyReturnPercent,
      source: String(candlePayload?.source || payload?.source || "").trim(),
      fetchedAt: String(candlePayload?.fetchedAt || payload?.fetchedAt || "").trim(),
    },
    data: {
      displayedCandles: visibleCandleRows,
      displayedDailyCandles: displayDailyCandleRows,
      priceSeries: chartMode === "candles" || chartMode === "bars" ? ohlcData : lineData,
      volumeSeries: volumeData,
    },
  }), [
    averagePrice,
    candleError,
    candleLoading,
    candleOlderError,
    candlePayload?.fetchedAt,
    candlePayload?.source,
    chartDataReady,
    chartMode,
    dailyReturnPercent,
    displayAveragePrice,
    displayDailyCandleRows,
    displayUnit,
    effectiveCurrentPrice,
    instrumentId,
    intervalMode,
    item,
    itemName,
    itemUnit,
    lineData,
    ohlcData,
    payload?.fetchedAt,
    payload?.source,
    symbol,
    usdKrwRate,
    visibleCandleRows,
    volumeData,
    volumeVisible,
  ]);

  useEffect(() => {
    onDisplayData?.(displayData);
  }, [displayData, onDisplayData]);
  const loadOlderDailyCandles = useCallback(async () => {
    if (!symbol || dailyCandleLoadingRef.current || !dailyCandleRows.length) return;
    if (dailyCandlePayload?.hasMore === false) return;
    const before =
      String(dailyCandlePayload?.nextBefore || "").trim() ||
      transactionInvestmentOlderBeforeFromRows(dailyCandleRows, "1d");
    if (!before || dailyCandleLoadedBeforeRef.current.has(before)) return;
    dailyCandleLoadedBeforeRef.current.add(before);
    dailyCandleLoadingRef.current = true;
    const controller = new AbortController();
    dailyCandleControllerRef.current = controller;
    setDailyCandleOlderLoading(true);
    setDailyCandleError("");
    try {
      const nextPayload = await fetchTransactionInvestmentDetailCandles(candleInstrument, "1d", controller.signal, { before });
      if (controller.signal.aborted) return;
      const nextRows = transactionInvestmentCandleRowsFromPayload(nextPayload?.candles || [], "1d");
      const hasNewOlderRows = transactionInvestmentHasNewCandleRows(dailyCandleRows, nextRows, "1d");
      setDailyCandlePayload((current) => {
        const currentRows = transactionInvestmentCandleRowsFromPayload(current?.candles || [], "1d");
        return {
          ...nextPayload,
          interval: "1d",
          requestedInterval: "1d",
          candles: mergeTransactionInvestmentCandleRows(currentRows, nextRows, "1d"),
          hasMore: nextPayload?.hasMore !== false && hasNewOlderRows,
        };
      });
    } catch (fetchError) {
      if (fetchError.name !== "AbortError" && !controller.signal.aborted) {
        dailyCandleLoadedBeforeRef.current.delete(before);
        setDailyCandleError(fetchError.message || "이전 일별 시세를 더 불러오지 못했습니다.");
      }
    } finally {
      if (dailyCandleControllerRef.current === controller) {
        dailyCandleControllerRef.current = null;
        dailyCandleLoadingRef.current = false;
        if (!controller.signal.aborted) setDailyCandleOlderLoading(false);
      }
    }
  }, [candleInstrument, dailyCandlePayload?.hasMore, dailyCandlePayload?.nextBefore, dailyCandleRows, instrumentId, symbol]);

  const loadOlderCandles = useCallback(async () => {
    if (!symbol || candleLoading || candleOlderLoadingRef.current || !rawCandleRows.length) return;
    if (candlePayload?.hasMore === false) return;
    const sourceInterval = candlePayload?.interval || transactionInvestmentSourceInterval(intervalMode);
    const before =
      String(candlePayload?.nextBefore || "").trim() ||
      transactionInvestmentOlderBeforeFromRows(rawCandleRows, sourceInterval);
    if (!before || candleOlderLoadedBeforeRef.current.has(before)) return;
    candleOlderLoadedBeforeRef.current.add(before);
    candleOlderLoadingRef.current = true;
    const controller = new AbortController();
    candleOlderControllerRef.current = controller;
    setCandleOlderLoading(true);
    setCandleOlderError("");
    try {
      const nextPayload = await fetchTransactionInvestmentDetailCandles(candleInstrument, intervalMode, controller.signal, { before });
      if (controller.signal.aborted) return;
      const nextRows = transactionInvestmentCandleRowsFromPayload(nextPayload?.candles || [], nextPayload?.interval || sourceInterval);
      const mergedRows = mergeTransactionInvestmentCandleRows(rawCandleRows, nextRows, sourceInterval);
      const hasNewOlderRows = transactionInvestmentHasNewCandleRows(rawCandleRows, mergedRows, sourceInterval);
      setCandlePayload({
        ...nextPayload,
        interval: sourceInterval,
        requestedInterval: intervalMode,
        candles: mergedRows,
        hasMore: nextPayload?.hasMore !== false && hasNewOlderRows,
      });
      if (!hasNewOlderRows) {
        setCandleOlderError("");
      }
    } catch (fetchError) {
      if (fetchError.name !== "AbortError" && !controller.signal.aborted) {
        candleOlderLoadedBeforeRef.current.delete(before);
        setCandleOlderError(fetchError.message || "과거 시세를 더 불러오지 못했습니다.");
      }
    } finally {
      if (candleOlderControllerRef.current === controller) {
        candleOlderControllerRef.current = null;
      }
      candleOlderLoadingRef.current = false;
      if (!controller.signal.aborted) setCandleOlderLoading(false);
    }
  }, [
    candleLoading,
    candleInstrument,
    candlePayload?.hasMore,
    candlePayload?.interval,
    candlePayload?.nextBefore,
    intervalMode,
    instrumentId,
    rawCandleRows,
    symbol,
  ]);

  useEffect(() => {
    loadOlderCandlesRef.current = loadOlderCandles;
  }, [loadOlderCandles]);

  const suppressChartRangeChange = useCallback((callback) => {
    chartRangeUpdateSuppressedRef.current = true;
    if (chartRangeSuppressionTimerRef.current) {
      window.clearTimeout(chartRangeSuppressionTimerRef.current);
    }
    try {
      callback();
    } finally {
      chartRangeSuppressionTimerRef.current = window.setTimeout(() => {
        chartRangeSuppressionTimerRef.current = null;
        chartRangeUpdateSuppressedRef.current = false;
      }, 100);
    }
  }, []);

  const clearChartOlderLoadIntent = useCallback(() => {
    chartOlderLoadIntentRef.current = false;
    if (chartOlderLoadIntentTimerRef.current) {
      window.clearTimeout(chartOlderLoadIntentTimerRef.current);
      chartOlderLoadIntentTimerRef.current = null;
    }
  }, []);

  const armChartOlderLoadIntent = useCallback(() => {
    if (candleOlderLoadingRef.current) return;
    if (chartOlderLoadIntentTimerRef.current) {
      window.clearTimeout(chartOlderLoadIntentTimerRef.current);
    }
    chartOlderLoadIntentRef.current = true;
    chartOlderLoadIntentTimerRef.current = window.setTimeout(() => {
      chartOlderLoadIntentTimerRef.current = null;
      chartOlderLoadIntentRef.current = false;
    }, 500);
  }, []);

  const requestOlderCandlesIfNeeded = useCallback((logicalRange = null) => {
    if (chartRangeUpdateSuppressedRef.current) return;
    if (!chartOlderLoadIntentRef.current) return;
    const targetRange = logicalRange || chartRef.current?.timeScale?.().getVisibleLogicalRange?.() || null;
    if (transactionInvestmentShouldLoadOlderFromLogicalRange(seriesRef.current, targetRange)) {
      clearChartOlderLoadIntent();
      loadOlderCandlesRef.current();
    }
  }, [clearChartOlderLoadIntent]);

  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node || !chartDataReady) return undefined;
    const handlePointerMove = (event) => {
      if (event.buttons) armChartOlderLoadIntent();
    };
    node.addEventListener("wheel", armChartOlderLoadIntent, { passive: true });
    node.addEventListener("pointerdown", armChartOlderLoadIntent, { passive: true });
    node.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      node.removeEventListener("wheel", armChartOlderLoadIntent);
      node.removeEventListener("pointerdown", armChartOlderLoadIntent);
      node.removeEventListener("pointermove", handlePointerMove);
    };
  }, [armChartOlderLoadIntent, chartDataReady]);

  useEffect(() => {
    clearChartOlderLoadIntent();
  }, [chartKey, clearChartOlderLoadIntent]);

  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node || !chartDataReady) return undefined;
    let chart = chartRef.current;
    let series = seriesRef.current;
    const chartSeriesKind = chartMode;
    const baselineBaseValue = displayAveragePrice > 0 ? displayAveragePrice : lineData[0]?.value || 0;
    const chartSeriesKey = [
      chartSeriesKind,
      "stable-no-series-options-v4",
      chartSeriesKind === "baseline" ? baselineBaseValue : "",
      chartSeriesKind === "area" || chartSeriesKind === "line" ? chartColor : "",
    ].join(":");
    const modeChanged = seriesModeRef.current !== chartSeriesKey;
    const chartKeyChanged = previousChartKeyRef.current && previousChartKeyRef.current !== chartKey;
    const visibleLogicalRange = chart?.timeScale?.().getVisibleLogicalRange?.() || null;
    const previousFirstKey = previousFirstCandleKeyRef.current;
    const currentFirstKey = transactionInvestmentCandleRowKey(visibleCandleRows[0] || {}, intervalMode);
    const prependedVisibleCount = previousFirstKey
      ? visibleCandleRows.findIndex((row) => transactionInvestmentCandleRowKey(row, intervalMode) === previousFirstKey)
      : -1;
    const restoredLogicalRange = transactionInvestmentRestoredLogicalRange(visibleLogicalRange, prependedVisibleCount);
    const chartShowsIntradayTime = transactionInvestmentIntervalIsIntraday(intervalMode);
    const chartOptionsKey = `${displayUnit}|${volumeVisible ? "volume" : "price"}|${chartShowsIntradayTime ? "intraday" : "calendar"}`;

    if (!chart) {
      chart = createChart(node, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "#ffffff" },
          textColor: "#667085",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        },
        grid: {
          vertLines: { color: "rgba(148, 163, 184, 0.13)" },
          horzLines: { color: "rgba(148, 163, 184, 0.13)" },
        },
        localization: {
          priceFormatter: (price) => formatMoney(price, displayUnit),
          timeFormatter: (time) => formatTransactionChartDateLabel(time),
          dateFormat: "yy년 MM월 dd일",
          locale: "ko-KR",
        },
        rightPriceScale: {
          borderColor: "rgba(148, 163, 184, 0.22)",
          scaleMargins: { top: 0.12, bottom: volumeVisible ? 0.28 : 0.14 },
        },
        timeScale: {
          borderColor: "rgba(148, 163, 184, 0.22)",
          timeVisible: chartShowsIntradayTime,
          secondsVisible: false,
          tickMarkFormatter: formatTransactionChartTickMark,
        },
        crosshair: {
          mode: 1,
          vertLine: { visible: true, labelVisible: true },
          horzLine: { visible: true, labelVisible: true },
        },
        handleScroll: true,
        handleScale: true,
      });
      chartRef.current = chart;
      chartOptionsKeyRef.current = chartOptionsKey;
    }
    if (!visibleRangeSubscriptionRef.current) {
      const handleVisibleRangeChange = (logicalRange) => {
        if (!logicalRange) return;
        requestOlderCandlesIfNeeded(logicalRange);
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      visibleRangeSubscriptionRef.current = handleVisibleRangeChange;
    }

    if (chartOptionsKeyRef.current !== chartOptionsKey) {
      chart.applyOptions({
        localization: {
          priceFormatter: (price) => formatMoney(price, displayUnit),
          timeFormatter: (time) => formatTransactionChartDateLabel(time),
          dateFormat: "yy년 MM월 dd일",
          locale: "ko-KR",
        },
        rightPriceScale: {
          scaleMargins: { top: 0.12, bottom: volumeVisible ? 0.28 : 0.14 },
        },
        timeScale: {
          timeVisible: chartShowsIntradayTime,
          secondsVisible: false,
          tickMarkFormatter: formatTransactionChartTickMark,
        },
      });
      chartOptionsKeyRef.current = chartOptionsKey;
    }

    if (!series || modeChanged) {
      if (averagePriceLineRef.current && series) {
        try {
          series.removePriceLine(averagePriceLineRef.current);
        } catch {
          // Removed series may already have released the price line.
        }
        averagePriceLineRef.current = null;
        averagePriceLineValueRef.current = null;
      }
      if (series) {
        chart.removeSeries(series);
        priceSeriesDataRef.current = { identity: "", rows: [] };
      }
      if (chartMode === "candles") {
        series = chart.addSeries(CandlestickSeries, {
          upColor: "#e11d48",
          borderUpColor: "#e11d48",
          wickUpColor: "#e11d48",
          downColor: "#2878ff",
          borderDownColor: "#2878ff",
          wickDownColor: "#2878ff",
        });
      } else if (chartMode === "bars") {
        series = chart.addSeries(BarSeries, {
          upColor: "#e11d48",
          downColor: "#2878ff",
          thinBars: false,
        });
      } else if (chartSeriesKind === "area") {
        series = chart.addSeries(AreaSeries, {
          lineColor: chartColor,
          topColor: chartFillColor,
          bottomColor: chartFillBottomColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
      } else if (chartSeriesKind === "baseline") {
        series = chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: baselineBaseValue },
          topLineColor: "#e11d48",
          topFillColor1: "rgba(225, 29, 72, 0.18)",
          topFillColor2: "rgba(225, 29, 72, 0.02)",
          bottomLineColor: "#2878ff",
          bottomFillColor1: "rgba(40, 120, 255, 0.02)",
          bottomFillColor2: "rgba(40, 120, 255, 0.18)",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
      } else if (chartSeriesKind === "line") {
        series = chart.addSeries(LineSeries, {
          color: chartColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
      }
      seriesRef.current = series;
      seriesModeRef.current = chartSeriesKey;
    }

    const nextPriceSeriesRows = chartMode === "candles" || chartMode === "bars" ? ohlcData : lineData;
    const priceSeriesIdentity = `${chartKey}|${chartSeriesKey}|${displayUnit}`;
    const previousPriceSeriesData = priceSeriesDataRef.current;
    if (
      previousPriceSeriesData.identity === priceSeriesIdentity &&
      transactionInvestmentCanUpdateLastChartDatum(previousPriceSeriesData.rows, nextPriceSeriesRows)
    ) {
      series.update(nextPriceSeriesRows[nextPriceSeriesRows.length - 1]);
    } else {
      const replacePriceSeriesData = () => series.setData(nextPriceSeriesRows);
      if (prependedVisibleCount > 0) {
        suppressChartRangeChange(replacePriceSeriesData);
      } else {
        replacePriceSeriesData();
      }
    }
    priceSeriesDataRef.current = { identity: priceSeriesIdentity, rows: nextPriceSeriesRows };

    if (volumeVisible) {
      if (!volumeSeriesRef.current) {
        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          priceLineVisible: false,
          lastValueVisible: false,
          color: "rgba(100, 116, 139, 0.28)",
        });
        volumeSeriesDataRef.current = { identity: "", rows: [] };
      }
      chart.priceScale("volume").applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.78, bottom: 0 },
      });
      const volumeSeriesIdentity = `${chartKey}|volume`;
      const previousVolumeSeriesData = volumeSeriesDataRef.current;
      if (
        previousVolumeSeriesData.identity === volumeSeriesIdentity &&
        transactionInvestmentCanUpdateLastChartDatum(previousVolumeSeriesData.rows, volumeData)
      ) {
        volumeSeriesRef.current.update(volumeData[volumeData.length - 1]);
      } else {
        volumeSeriesRef.current.setData(volumeData);
      }
      volumeSeriesDataRef.current = { identity: volumeSeriesIdentity, rows: volumeData };
    } else if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData([]);
      volumeSeriesDataRef.current = { identity: "", rows: [] };
    }

    if (averagePriceLineRef.current && averagePriceLineValueRef.current !== displayAveragePrice) {
      try {
        series.removePriceLine(averagePriceLineRef.current);
      } catch {
        // Price line cleanup is best-effort across chart mode changes.
      }
      averagePriceLineRef.current = null;
      averagePriceLineValueRef.current = null;
    }
    if (!averagePriceLineRef.current && displayAveragePrice > 0) {
      averagePriceLineRef.current = series.createPriceLine({
        price: displayAveragePrice,
        color: "rgba(71, 85, 105, 0.62)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "내 평균",
      });
      averagePriceLineValueRef.current = displayAveragePrice;
    }

    if (!previousChartKeyRef.current || chartKeyChanged) {
      suppressChartRangeChange(() => chart.timeScale().fitContent());
    } else if (restoredLogicalRange) {
      suppressChartRangeChange(() => chart.timeScale().setVisibleLogicalRange(restoredLogicalRange));
    }
    previousChartKeyRef.current = chartKey;
    previousFirstCandleKeyRef.current = currentFirstKey;

    return undefined;
  }, [
    chartFillBottomColor,
    chartFillColor,
    chartColor,
    chartKey,
    chartMode,
    displayAveragePrice,
    displayUnit,
    intervalMode,
    chartDataReady,
    lineData,
    ohlcData,
    volumeData,
    volumeVisible,
    visibleCandleRows,
    requestOlderCandlesIfNeeded,
    suppressChartRangeChange,
  ]);

  useEffect(
    () => () => {
      if (chartRef.current) {
        if (visibleRangeSubscriptionRef.current) {
          chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(visibleRangeSubscriptionRef.current);
          visibleRangeSubscriptionRef.current = null;
        }
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      seriesModeRef.current = "";
      averagePriceLineRef.current = null;
      averagePriceLineValueRef.current = null;
      previousChartKeyRef.current = "";
      chartOptionsKeyRef.current = "";
      priceSeriesDataRef.current = { identity: "", rows: [] };
      volumeSeriesDataRef.current = { identity: "", rows: [] };
      candleOlderLoadingRef.current = false;
      candleOlderControllerRef.current?.abort();
      candleOlderControllerRef.current = null;
      candleOlderLoadedBeforeRef.current = new Set();
      if (chartRangeSuppressionTimerRef.current) {
        window.clearTimeout(chartRangeSuppressionTimerRef.current);
        chartRangeSuppressionTimerRef.current = null;
      }
      chartRangeUpdateSuppressedRef.current = false;
      if (chartOlderLoadIntentTimerRef.current) {
        window.clearTimeout(chartOlderLoadIntentTimerRef.current);
        chartOlderLoadIntentTimerRef.current = null;
      }
      chartOlderLoadIntentRef.current = false;
      previousFirstCandleKeyRef.current = "";
    },
    []
  );

  const displayValue = convertedMoney(item?.value, itemUnit, displayUnit, usdKrwRate);
  const displayProfit = convertedMoney(item?.profit, itemUnit, displayUnit, usdKrwRate);
  const displayCostBasis = convertedMoney(item?.costBasis, itemUnit, displayUnit, usdKrwRate);
  const secondaryPriceUnit = displayUnit === "USD" ? "KRW" : "USD";
  const primaryPriceLabel =
    effectiveCurrentPrice > 0
      ? formatConvertedMoney(effectiveCurrentPrice, itemUnit, displayUnit, usdKrwRate)
      : "-";
  const secondaryPriceLabel =
    effectiveCurrentPrice > 0
      ? formatConvertedMoney(effectiveCurrentPrice, itemUnit, secondaryPriceUnit, usdKrwRate)
      : "-";
  const previousClose = Number(item?.previousClose);
  const dailyPriceChange =
    effectiveCurrentPrice > 0 && Number.isFinite(previousClose) && previousClose > 0
      ? effectiveCurrentPrice - previousClose
      : effectiveCurrentPrice > 0 && Number.isFinite(dailyReturnPercent) && dailyReturnPercent > -100
        ? effectiveCurrentPrice - effectiveCurrentPrice / (1 + dailyReturnPercent / 100)
        : null;
  const dailyPriceChangeAmount = Number.isFinite(dailyPriceChange)
    ? convertMoney(dailyPriceChange, itemUnit, displayUnit, usdKrwRate)
    : null;
  const dailyPriceChangeLabel = dailyPriceChangeAmount !== null
    ? formatSignedMoney(dailyPriceChangeAmount, displayUnit)
    : "-";
  const activeChartMode = transactionInvestmentDetailChartModes.some((mode) => mode.id === chartMode) ? chartMode : "area";
  const activeMinuteInterval = transactionInvestmentMinuteIntervals.find((interval) => interval.id === intervalMode);
  const minuteTriggerLabel = activeMinuteInterval?.label || transactionInvestmentMinuteIntervals[0].label;
  const intervalLabel =
    activeMinuteInterval?.label ||
    transactionInvestmentTimeframeTabs.find((timeframe) => timeframe.id === intervalMode)?.label ||
    "일";
  const isCryptoInstrument = itemIsCrypto(item);

  return (
    <section className="transaction-main-section transaction-asset-detail-section" aria-label={`${itemName} 상세`}>
      <TransactionMarketDataStatus
        statusBannerProps={statusBannerProps}
        instruments={[item]}
        binanceStatus={binanceStatus}
        binanceError={binanceError}
      />
      <div className="transaction-asset-detail-header">
        <div className="transaction-asset-quote-block">
          <div className="transaction-asset-title-block">
            <strong>{itemName}</strong>
            <span>{item?.displaySymbol || symbol}</span>
          </div>
          <div className="transaction-asset-price-block">
            <strong>{primaryPriceLabel}</strong>
            <b>{secondaryPriceLabel}</b>
            <span className="transaction-asset-price-comparison">
              {isCryptoInstrument ? "· 지난 미국 정규장 마감보다" : "· 지난 정규장보다"}
            </span>
            <span className={`transaction-asset-price-change ${valueTone(dailyReturnPercent)}`.trim()}>
              {dailyPriceChangeLabel} ({formatSignedPercent(dailyReturnPercent)})
            </span>
          </div>
        </div>
        <div className="transaction-asset-detail-header-actions">
          <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="메인 섹션 통화 표시" />
          {onClose ? (
            <button
              className="transaction-asset-detail-close-button"
              type="button"
              aria-label={`${itemName} 차트 닫기`}
              title="차트 닫기"
              onClick={onClose}
            >
              <X size={17} strokeWidth={2.6} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="transaction-asset-summary-strip" aria-label="선택 종목 보유 지표">
        <div>
          <span>평가금</span>
          <strong>{formatOptionalMoney(displayValue.hasValue, displayValue.value, displayUnit)}</strong>
        </div>
        <div>
          <span>원금</span>
          <strong>{formatOptionalMoney(displayCostBasis.hasValue, displayCostBasis.value, displayUnit)}</strong>
        </div>
        <div>
          <span>총 수익</span>
          <strong className={valueTone(item?.profit)}>
            {formatOptionalSignedMoney(displayProfit.hasValue, displayProfit.value, displayUnit)}
          </strong>
        </div>
        <div>
          <span>수익률</span>
          <strong className={valueTone(item?.profitPercent)}>{formatSignedPercent(item?.profitPercent)}</strong>
        </div>
        <div>
          <span>보유 수량</span>
          <strong>{formatQuantity(item?.quantity, item)}</strong>
        </div>
        <div>
          <span>평단가</span>
          <strong>{displayAveragePrice > 0 ? formatMoney(displayAveragePrice, displayUnit) : "-"}</strong>
        </div>
      </div>

      <div className="transaction-asset-detail-scroll">
        <section className="transaction-asset-chart-panel" aria-label={`${itemName} 가격 차트`}>
          <div className="transaction-asset-chart-toolbar">
            <div className="transaction-asset-chart-primary-tools">
              <div className="transaction-asset-chart-ranges" role="group" aria-label="봉 모드">
                <div className="transaction-asset-minute-menu" ref={minuteMenuRef}>
                  <button
                    className={activeMinuteInterval ? "is-active" : ""}
                    type="button"
                    aria-expanded={minuteMenuOpen}
                    aria-pressed={Boolean(activeMinuteInterval)}
                    onClick={() => setMinuteMenuOpen((current) => !current)}
                  >
                    <span>{minuteTriggerLabel}</span>
                    <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                  {minuteMenuOpen ? (
                    <div className="transaction-asset-minute-popover" role="menu">
                      {transactionInvestmentMinuteIntervals.map((interval) => (
                        <button
                          className={interval.id === intervalMode ? "is-active" : ""}
                          type="button"
                          role="menuitemradio"
                          aria-checked={interval.id === intervalMode}
                          key={`transaction-asset-minute-${interval.id}`}
                          onClick={() => handleIntervalModeSelect(interval.id)}
                        >
                          {interval.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {transactionInvestmentTimeframeTabs.map((timeframe) => (
                  <button
                    className={timeframe.id === intervalMode ? "is-active" : ""}
                    type="button"
                    key={`transaction-asset-timeframe-${timeframe.id}`}
                    aria-pressed={timeframe.id === intervalMode}
                    onClick={() => handleIntervalModeSelect(timeframe.id)}
                  >
                    {timeframe.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="transaction-asset-chart-options">
              <label className="transaction-asset-volume-toggle">
                <input
                  type="checkbox"
                  checked={volumeVisible}
                  onChange={handleVolumeVisibleChange}
                />
                <span>거래량</span>
              </label>
              <div className="transaction-asset-chart-modes" role="group" aria-label="차트 형식">
                {transactionInvestmentDetailChartModes.map((mode) => (
                  <button
                    className={mode.id === activeChartMode ? "is-active" : ""}
                    type="button"
                    key={`transaction-asset-mode-${mode.id}`}
                    aria-pressed={mode.id === activeChartMode}
                    onClick={() => handleChartModeSelect(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="transaction-asset-chart-frame">
            {onBuy || onSell ? (
              <div className="transaction-asset-chart-trade-actions" role="group" aria-label={`${itemName} 모의투자 주문`}>
                <button className="is-buy" type="button" disabled={!onBuy} onClick={() => onBuy?.(item)}>
                  매수
                </button>
                <button className="is-sell" type="button" disabled={!onSell} onClick={() => onSell?.(item)}>
                  매도
                </button>
              </div>
            ) : null}
            {candleLoading ? <div className="transaction-asset-chart-state">차트 데이터 로딩</div> : null}
            {!candleLoading && candleError ? <div className="transaction-asset-chart-state is-error">{candleError}</div> : null}
            {!candleLoading && !candleError && !lineData.length ? (
              <div className="transaction-asset-chart-state">가격 차트 데이터가 없습니다.</div>
            ) : null}
            {!candleLoading && !candleError && candleOlderLoading ? (
              <div className="transaction-asset-chart-older-state">과거 데이터 로딩</div>
            ) : null}
            {!candleLoading && !candleError && candleOlderError ? (
              <div className="transaction-asset-chart-older-state is-error">{candleOlderError}</div>
            ) : null}
            <div
              className={lineData.length && !candleLoading && !candleError ? "transaction-asset-chart-canvas" : "transaction-asset-chart-canvas is-hidden"}
              ref={chartContainerRef}
            />
          </div>
          <div className="transaction-asset-chart-credit">
            <span>{[candlePayload?.source || "토스 증권 API 시세", intervalLabel].join(" · ")}</span>
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              Lightweight Charts™
            </a>
          </div>
        </section>

        <TransactionAssetDailyTable
          rows={displayDailyCandleRows}
          unit={displayUnit}
          initialLoading={dailyCandleLoading}
          loadingMore={dailyCandleOlderLoading}
          hasMore={dailyCandlePayload?.hasMore !== false}
          error={dailyCandleError}
          onLoadMore={loadOlderDailyCandles}
          onRetry={loadInitialDailyCandles}
        />
      </div>
    </section>
  );
}

export function InvestmentMain({
  items,
  payload,
  unit,
  usdKrwRate,
  onUnitChange,
  selectedTableColumnIds,
  onTableColumnsChange,
  loading,
  error,
  statusBannerProps,
  onSelectItem,
  onDisplayData,
  sidebarValueMode = "value",
}) {
  const [activeFilter, setActiveFilter] = useState("all");
  const displayUnit = normalizeMoneyUnit(unit);
  const hasPayload = Boolean(payload?.ok);
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const overseasCount = items.filter(itemIsOverseasStock).length;
  const domesticCount = items.filter(itemIsDomesticStock).length;
  const cryptoCount = items.filter(itemIsCrypto).length;
  const stockCount = overseasCount + domesticCount;
  const periodProfitLabel = "일간 수익";
  const filteredItems = useMemo(() => {
    if (activeFilter === "overseas") return items.filter(itemIsOverseasStock);
    if (activeFilter === "domestic") return items.filter(itemIsDomesticStock);
    if (activeFilter === "crypto") return items.filter(itemIsCrypto);
    return items;
  }, [activeFilter, items]);
  const activeFilterLabel =
    activeFilter === "overseas"
      ? "해외주식"
      : activeFilter === "domestic"
        ? "국내주식"
        : activeFilter === "crypto"
          ? "암호자산"
          : "전체";
  const shouldShowBlockingError = Boolean(error && !payload);
  const displayData = useMemo(
    () => transactionInvestmentOverviewDisplayData({
      kind: "live-investment-overview",
      title: "내 투자 첫 페이지",
      accountType: "live",
      accountId: payload?.accountSeq || "",
      items,
      filteredItems,
      payload,
      displayUnit,
      usdKrwRate,
      activeFilter,
      selectedColumnIds: selectedTableColumnIds,
      sidebarValueMode,
    }),
    [activeFilter, displayUnit, filteredItems, items, payload, selectedTableColumnIds, sidebarValueMode, usdKrwRate]
  );

  useEffect(() => {
    onDisplayData?.(displayData);
  }, [displayData, onDisplayData]);

  return (
    <section className="transaction-main-section" aria-label="내 투자 상세">
      <PortfolioTossApiStatus {...statusBannerProps} />

      <div className="transaction-main-summary">
        <span>내 투자</span>
        <div>
          <strong>{formatOptionalMoney(hasPayload && totals.value.hasValue, totals.value.value, displayUnit)}</strong>
          <em>원금 {formatOptionalMoney(hasPayload && totals.costBasis.hasValue, totals.costBasis.value, displayUnit)}</em>
          <em className={hasPayload ? valueTone(totals.profit.value) : ""}>
            총 수익 {formatOptionalPerformance(hasPayload && totals.profit.hasValue, totals.profit.value, totals.profitPercent, displayUnit)}
          </em>
          <em className={hasPayload ? valueTone(totals.dailyProfit.value) : ""}>
            {periodProfitLabel} {formatOptionalPerformance(
              hasPayload && totals.dailyProfit.hasValue,
              totals.dailyProfit.value,
              payload?.dailyReturnPercent || 0,
              displayUnit
            )}
          </em>
        </div>
      </div>

      <div className="transaction-main-filters" aria-label="보유 종목 필터">
        <button
          className={activeFilter === "all" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "all"}
          onClick={() => setActiveFilter("all")}
        >
          전체 {items.length}개
        </button>
        <button
          className={activeFilter === "overseas" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "overseas"}
          onClick={() => setActiveFilter("overseas")}
        >
          해외주식 {overseasCount}개
        </button>
        <button
          className={activeFilter === "domestic" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "domestic"}
          onClick={() => setActiveFilter("domestic")}
        >
          국내주식 {domesticCount}개
        </button>
        <button
          className={activeFilter === "crypto" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "crypto"}
          onClick={() => setActiveFilter("crypto")}
        >
          암호자산 {cryptoCount}개
        </button>
        <TransactionColumnFilter
          selectedColumnIds={selectedTableColumnIds}
          onChange={onTableColumnsChange}
        />
        <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="메인 섹션 통화 표시" />
      </div>

      {loading && !payload ? (
        <div className="transaction-loading-state">
          <LoaderCircle className="is-spinning" size={18} strokeWidth={2.4} />
          <span>토스 증권 API 불러오는 중</span>
        </div>
      ) : shouldShowBlockingError ? (
        <div className="transaction-error-state">{error}</div>
      ) : (
        <InvestmentTable
          items={filteredItems}
          payload={payload}
          unit={displayUnit}
          usdKrwRate={usdKrwRate}
          selectedColumnIds={selectedTableColumnIds}
          emptyLabel={`${activeFilterLabel} 보유 종목이 없습니다.`}
          onSelectItem={onSelectItem}
        />
      )}
    </section>
  );
}

export function TransactionMarketDataStatus({
  statusBannerProps,
  instruments = [],
  binanceStatus = null,
  binanceError = "",
  showBinanceWhenEmpty = false,
}) {
  const normalizedInstruments = normalizeTransactionWatchlistInstrumentsSetting(instruments);
  const usesBinance = showBinanceWhenEmpty || normalizedInstruments.some((instrument) => instrument.provider === "binance");
  const usesToss = !normalizedInstruments.length || normalizedInstruments.some((instrument) => instrument.provider !== "binance");
  const availability = transactionBinanceProviderAvailability(binanceStatus, binanceError);
  const binanceConnected = availability.available;
  return (
    <div className="transaction-market-provider-status-stack">
      {usesToss ? <PortfolioTossApiStatus {...statusBannerProps} /> : null}
      {usesBinance ? (
        <div
          className={`transaction-market-provider-status is-binance ${binanceConnected ? "is-connected" : "is-error"}`}
          role="status"
        >
          <strong>Binance 공개 시세</strong>
          <span>{binanceConnected ? "API 키 없이 연결됨 · USDT=USD" : availability.reason}</span>
        </div>
      ) : null}
    </div>
  );
}

export function SimulatorInvestmentMain({
  simulator,
  items: orderedItems = [],
  payload,
  unit,
  usdKrwRate,
  onUnitChange,
  selectedTableColumnIds,
  onTableColumnsChange,
  statusBannerProps,
  binanceStatus,
  binanceError = "",
  deleteBusy = false,
  simulatorRenameTarget = null,
  simulatorRenameDraft = "",
  simulatorRenameBusy = false,
  simulatorRenameError = "",
  onDeleteSimulator,
  onOpenSymbolSearch,
  onSimulatorRenameStart,
  onSimulatorRenameDraftChange,
  onSimulatorRenameSubmit,
  onSimulatorRenameCancel,
  onSelectItem,
  onDisplayData,
  sidebarValueMode = "value",
}) {
  const [activeFilter, setActiveFilter] = useState("all");
  const displayUnit = normalizeMoneyUnit(unit);
  const simulatorName = simulatorDisplayLabel(simulator, 0);
  const hasPayload = Boolean(payload?.ok);
  const items = useMemo(
    () => (
      Array.isArray(orderedItems)
        ? orderedItems.map((item) => normalizeItem(item, payload?.unit || displayUnit))
        : []
    ),
    [displayUnit, orderedItems, payload?.unit]
  );
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const overseasCount = items.filter(itemIsOverseasStock).length;
  const domesticCount = items.filter(itemIsDomesticStock).length;
  const cryptoCount = items.filter(itemIsCrypto).length;
  const simulatorStockCount = overseasCount + domesticCount;
  const simulatorPeriodProfitLabel = "일간 수익";
  const filteredItems = useMemo(() => {
    if (activeFilter === "overseas") return items.filter(itemIsOverseasStock);
    if (activeFilter === "domestic") return items.filter(itemIsDomesticStock);
    if (activeFilter === "crypto") return items.filter(itemIsCrypto);
    return items;
  }, [activeFilter, items]);
  const activeFilterLabel =
    activeFilter === "overseas"
      ? "해외주식"
      : activeFilter === "domestic"
        ? "국내주식"
        : activeFilter === "crypto"
          ? "암호자산"
          : "전체";
  const mainRenameEditing = Boolean(
    simulator?.id &&
      simulatorRenameTarget?.simulatorId === simulator.id &&
      simulatorRenameTarget?.placement === "main"
  );
  const displayData = useMemo(
    () => transactionInvestmentOverviewDisplayData({
      kind: "simulator-investment-overview",
      title: `${simulatorName} 첫 페이지`,
      accountType: "simulator",
      accountId: simulator?.id || "",
      items,
      filteredItems,
      payload,
      displayUnit,
      usdKrwRate,
      activeFilter,
      selectedColumnIds: selectedTableColumnIds,
      sidebarValueMode,
    }),
    [activeFilter, displayUnit, filteredItems, items, payload, selectedTableColumnIds, sidebarValueMode, simulator?.id, simulatorName, usdKrwRate]
  );

  useEffect(() => {
    onDisplayData?.(displayData);
  }, [displayData, onDisplayData]);

  return (
    <section className="transaction-main-section transaction-simulator-main-section" aria-label={`${simulatorName} 상세`}>
      <TransactionMarketDataStatus
        statusBannerProps={statusBannerProps}
        instruments={items}
        binanceStatus={binanceStatus}
        binanceError={binanceError}
        showBinanceWhenEmpty
      />

      <div className="transaction-simulator-banner" aria-label="시뮬레이터 상태">
        <div className="transaction-simulator-banner-copy">
          <span>시뮬레이터</span>
          <strong>실계좌와 분리된 모의 계좌</strong>
        </div>
        <button
          className="transaction-simulator-delete-button"
          type="button"
          title={`${simulatorName} 삭제`}
          aria-label={`${simulatorName} 삭제`}
          disabled={deleteBusy}
          onClick={() => onDeleteSimulator?.(simulator?.id)}
        >
          <Trash2 size={16} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>

      <div className="transaction-main-summary is-actionable">
        <span className="transaction-main-summary-title">
          <SimulatorEditableName
            simulator={simulator}
            placement="main"
            editing={mainRenameEditing}
            draft={simulatorRenameDraft}
            busy={simulatorRenameBusy}
            error={mainRenameEditing ? simulatorRenameError : ""}
            onStart={onSimulatorRenameStart}
            onDraftChange={onSimulatorRenameDraftChange}
            onSubmit={onSimulatorRenameSubmit}
            onCancel={onSimulatorRenameCancel}
          />
        </span>
        <div>
          <strong>{formatOptionalMoney(hasPayload && totals.value.hasValue, totals.value.value, displayUnit)}</strong>
          <em>원금 {formatOptionalMoney(hasPayload && totals.costBasis.hasValue, totals.costBasis.value, displayUnit)}</em>
          <em className={hasPayload ? valueTone(totals.profit.value) : ""}>
            총 수익 {formatOptionalPerformance(hasPayload && totals.profit.hasValue, totals.profit.value, totals.profitPercent, displayUnit)}
          </em>
          <em className={hasPayload ? valueTone(totals.dailyProfit.value) : ""}>
            {simulatorPeriodProfitLabel} {formatOptionalPerformance(
              hasPayload && totals.dailyProfit.hasValue,
              totals.dailyProfit.value,
              payload?.dailyReturnPercent || 0,
              displayUnit
            )}
          </em>
        </div>
        <button
          className="transaction-simulator-search-button"
          type="button"
          aria-label={`${simulatorName} 종목검색`}
          title={`${simulatorName} 종목검색`}
          onClick={onOpenSymbolSearch}
        >
          <Search size={15} strokeWidth={2.4} aria-hidden="true" />
          <span>종목검색</span>
        </button>
      </div>

      <div className="transaction-main-filters" aria-label="모의 보유 종목 필터">
        <button
          className={activeFilter === "all" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "all"}
          onClick={() => setActiveFilter("all")}
        >
          전체 {items.length}개
        </button>
        <button
          className={activeFilter === "overseas" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "overseas"}
          onClick={() => setActiveFilter("overseas")}
        >
          해외주식 {overseasCount}개
        </button>
        <button
          className={activeFilter === "domestic" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "domestic"}
          onClick={() => setActiveFilter("domestic")}
        >
          국내주식 {domesticCount}개
        </button>
        <button
          className={activeFilter === "crypto" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "crypto"}
          onClick={() => setActiveFilter("crypto")}
        >
          암호자산 {cryptoCount}개
        </button>
        <TransactionColumnFilter
          selectedColumnIds={selectedTableColumnIds}
          onChange={onTableColumnsChange}
        />
        <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="시뮬레이터 표 통화 표시" />
      </div>

      <InvestmentTable
        items={filteredItems}
        payload={payload}
        unit={displayUnit}
        usdKrwRate={usdKrwRate}
        selectedColumnIds={selectedTableColumnIds}
        emptyLabel={`${activeFilterLabel} 모의 보유 종목이 없습니다.`}
        onSelectItem={onSelectItem}
      />
    </section>
  );
}

export function watchlistRowsFromGroup(group, items, symbolOptions = [], priceMap = new Map()) {
  const itemByInstrument = new Map();
  const itemBySymbol = new Map();
  for (const item of items) {
    const instrumentId = transactionInstrumentKey(item);
    if (instrumentId && !itemByInstrument.has(instrumentId)) {
      itemByInstrument.set(instrumentId, item);
    }
    const symbol = transactionItemOrderKey(item);
    if (symbol && !itemBySymbol.has(symbol)) {
      itemBySymbol.set(symbol, item);
    }
  }
  const optionByInstrument = new Map(
    symbolOptions
      .map((option) => [transactionInstrumentKey(option), option])
      .filter(([instrumentId]) => instrumentId)
  );
  const instruments = normalizeTransactionWatchlistInstrumentsSetting(group?.instruments, group?.symbols);
  return instruments.map((instrument) => {
    const symbol = instrument.symbol;
    const item = instrument.instrumentId
      ? itemByInstrument.get(instrument.instrumentId) || null
      : itemBySymbol.get(symbol) || null;
    const option = optionByInstrument.get(instrument.instrumentId) || instrument;
    const price = instrument.instrumentId
      ? priceMap.get(instrument.instrumentId) || null
      : priceMap.get(symbol) || null;
    const displayItem = normalizeTransactionInstrument({
      ...instrument,
      ...option,
      ...price,
      ...(item || {}),
      name: displayNameFromInstrumentSources(item, option, price, instrument),
    });
    const row = {
      ...instrument,
      symbol,
      item,
      option,
      price,
      name: displayName(displayItem || item || option || price),
      lastPrice: price?.lastPrice ?? item?.currentPrice ?? null,
    };
    for (const column of transactionWatchlistReturnColumns) {
      const value = Number(price?.[column.valueField]);
      const hasValue = Boolean(price?.[column.hasField] && Number.isFinite(value));
      row[column.valueField] = hasValue ? value : 0;
      row[column.hasField] = hasValue;
    }
    return row;
  });
}

export function transactionWatchlistDetailItem(row, fallbackUnit = "KRW") {
  const source = row?.item || row?.option || {};
  const displayCurrency = normalizeMoneyUnit(
    row?.price?.currency || source?.displayCurrency || source?.currency || fallbackUnit
  );
  const hasDailyReturn = Boolean(row?.hasDailyReturn && Number.isFinite(Number(row?.dailyReturnPercent)));
  const dailyReturnPercent = hasDailyReturn ? Number(row.dailyReturnPercent) : Number(source?.dailyReturnPercent || 0);
  return normalizeItem({
    ...source,
    instrumentId: row?.instrumentId || source?.instrumentId,
    provider: row?.provider || source?.provider,
    venue: row?.venue || source?.venue,
    assetClass: row?.assetClass || source?.assetClass,
    displaySymbol: row?.displaySymbol || source?.displaySymbol,
    baseAsset: row?.baseAsset || source?.baseAsset,
    quoteAsset: row?.quoteAsset || source?.quoteAsset,
    settlementAsset: row?.settlementAsset || source?.settlementAsset,
    nativeQuoteAsset: row?.nativeQuoteAsset || source?.nativeQuoteAsset,
    sessionPolicy: row?.sessionPolicy || source?.sessionPolicy,
    status: row?.status || source?.status,
    symbol: cleanTransactionWatchlistSymbol(row?.symbol),
    label: String(row?.name || source?.label || source?.name || row?.symbol || "-").trim(),
    currency: displayCurrency,
    displayCurrency,
    currentPrice: Number(row?.lastPrice ?? source?.currentPrice ?? 0),
    marketDailyReturnPercent: hasDailyReturn ? dailyReturnPercent : source?.marketDailyReturnPercent,
    dailyReturnPercent,
  }, displayCurrency);
}

export function averageWatchlistDailyReturn(rows) {
  const values = rows
    .filter((row) => row.hasDailyReturn)
    .map((row) => row.dailyReturnPercent);
  if (!values.length) return { hasValue: false, value: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { hasValue: true, value: total / values.length };
}

export function WatchlistTable({
  rows,
  payload,
  emptyLabel = "추가한 종목이 없습니다.",
  orderEditing,
  onOrderChange,
  onRemoveSymbol,
  onSelectSymbol,
}) {
  const [draggedInstrumentId, setDraggedInstrumentId] = useState("");
  const [dragOverInstrumentId, setDragOverInstrumentId] = useState("");
  const [dragInsertPlacement, setDragInsertPlacement] = useState("before");
  const [dragPreview, setDragPreview] = useState(null);
  const pointerDraggedInstrumentIdRef = useRef("");
  const pointerDragOverInstrumentIdRef = useRef("");
  const pointerDragPlacementRef = useRef("before");
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const updateDragOverInstrument = useCallback((instrumentId, placement = "before") => {
    pointerDragOverInstrumentIdRef.current = instrumentId;
    pointerDragPlacementRef.current = placement;
    setDragOverInstrumentId(instrumentId);
    setDragInsertPlacement(placement);
  }, []);

  const handleSymbolDragEnd = useCallback(() => {
    pointerDraggedInstrumentIdRef.current = "";
    pointerDragOverInstrumentIdRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedInstrumentId("");
    setDragOverInstrumentId("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, []);

  const commitInstrumentOrderChange = useCallback((sourceId, targetId, placement = "before") => {
    const currentRows = Array.isArray(rowsRef.current) ? rowsRef.current : [];
    const currentOrder = currentRows.map((row) => row.instrumentId);
    const nextOrder = reorderTransactionWatchlistInstruments(currentOrder, sourceId, targetId, placement);
    if (arraysEqual(currentOrder, nextOrder)) return;
    const rowById = new Map(currentRows.map((row) => [row.instrumentId, row]));
    rowsRef.current = nextOrder.map((instrumentId) => rowById.get(instrumentId)).filter(Boolean);
    onOrderChange(nextOrder);
  }, [onOrderChange]);

  const handleSymbolPointerStart = useCallback((event, row) => {
    if (!orderEditing) return;
    if (event.type === "mousedown" && pointerDraggedInstrumentIdRef.current) return;
    const instrumentId = cleanTransactionInstrumentId(row?.instrumentId);
    if (!instrumentId) return;
    pointerDraggedInstrumentIdRef.current = instrumentId;
    pointerDragOverInstrumentIdRef.current = instrumentId;
    pointerDragPlacementRef.current = "before";
    setDraggedInstrumentId(instrumentId);
    setDragOverInstrumentId(instrumentId);
    setDragInsertPlacement("before");
    setDragPreview({
      instrumentId,
      symbol: row.symbol,
      name: row.name,
      x: event.clientX,
      y: event.clientY,
    });
    if (typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; document-level listeners still drive reordering.
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }, [orderEditing]);

  const handleSymbolPointerMove = useCallback((event) => {
    if (!orderEditing || !pointerDraggedInstrumentIdRef.current) return;
    setDragPreview((current) => (
      current ? { ...current, x: event.clientX, y: event.clientY } : current
    ));
  }, [orderEditing]);

  const handleSymbolPointerEnd = useCallback(() => {
    if (!orderEditing || !pointerDraggedInstrumentIdRef.current) return;
    handleSymbolDragEnd();
  }, [handleSymbolDragEnd, orderEditing]);

  useEffect(() => {
    if (!orderEditing || !draggedInstrumentId) return undefined;
    function dropTargetFromPoint(clientX, clientY) {
      const target = document.elementFromPoint(clientX, clientY);
      const row = target?.closest?.("[data-transaction-watchlist-instrument]");
      const instrumentId = cleanTransactionInstrumentId(row?.dataset?.transactionWatchlistInstrument);
      if (!row || !instrumentId) return null;
      const rect = row.getBoundingClientRect();
      return {
        instrumentId,
        placement: clientY > rect.top + rect.height / 2 ? "after" : "before",
      };
    }
    function handleDocumentMove(event) {
      if (!pointerDraggedInstrumentIdRef.current) return;
      const clientX = Number(event.clientX || 0);
      const clientY = Number(event.clientY || 0);
      setDragPreview((current) => (
        current ? { ...current, x: clientX, y: clientY } : current
      ));
      const target = dropTargetFromPoint(clientX, clientY);
      if (!target) return;
      if (
        target.instrumentId === pointerDragOverInstrumentIdRef.current &&
        target.placement === pointerDragPlacementRef.current
      ) {
        return;
      }
      updateDragOverInstrument(target.instrumentId, target.placement);
      if (target.instrumentId !== pointerDraggedInstrumentIdRef.current) {
        commitInstrumentOrderChange(pointerDraggedInstrumentIdRef.current, target.instrumentId, target.placement);
      }
    }
    document.addEventListener("pointermove", handleDocumentMove);
    document.addEventListener("mousemove", handleDocumentMove);
    document.addEventListener("pointerup", handleSymbolDragEnd);
    document.addEventListener("mouseup", handleSymbolDragEnd);
    return () => {
      document.removeEventListener("pointermove", handleDocumentMove);
      document.removeEventListener("mousemove", handleDocumentMove);
      document.removeEventListener("pointerup", handleSymbolDragEnd);
      document.removeEventListener("mouseup", handleSymbolDragEnd);
    };
  }, [
    commitInstrumentOrderChange,
    draggedInstrumentId,
    handleSymbolDragEnd,
    orderEditing,
    updateDragOverInstrument,
  ]);

  return (
    <div className="transaction-main-table-wrap">
      <table
        className={orderEditing ? "transaction-main-table transaction-watchlist-table is-order-editing" : "transaction-main-table transaction-watchlist-table"}
        style={{ "--transaction-table-column-count": transactionWatchlistReturnColumns.length + 3 }}
      >
        <thead>
          <tr>
            {orderEditing ? <th className="transaction-watchlist-drag-column" aria-label="순서" /> : null}
            <th className="is-left">티커 / 종목번호</th>
            <th className="is-left">종목명</th>
            {transactionWatchlistReturnColumns.map((column) => (
              <th key={`transaction-watchlist-head-${column.key}`}>{column.label}</th>
            ))}
            {!orderEditing ? <th className="transaction-watchlist-action-column" aria-label="항목 작업" /> : null}
          </tr>
        </thead>
        <tbody
          onPointerMove={handleSymbolPointerMove}
          onPointerUp={handleSymbolPointerEnd}
          onPointerCancel={handleSymbolDragEnd}
          onMouseMove={handleSymbolPointerMove}
          onMouseUp={handleSymbolPointerEnd}
        >
          {rows.map((row) => {
            const rowClassName = [
              "transaction-watchlist-stock-row",
              !orderEditing && onSelectSymbol ? "is-selectable" : "",
              orderEditing ? "is-manual-sort" : "",
              dragOverInstrumentId === row.instrumentId && draggedInstrumentId && draggedInstrumentId !== row.instrumentId
                ? `is-drop-${dragInsertPlacement}`
                : "",
              draggedInstrumentId === row.instrumentId ? "is-dragging" : "",
            ].filter(Boolean).join(" ");
            return (
            <tr
              className={rowClassName}
              key={`transaction-watchlist-row-${row.instrumentId || row.symbol}`}
              data-transaction-watchlist-instrument={row.instrumentId || row.symbol}
              tabIndex={!orderEditing && onSelectSymbol ? 0 : undefined}
              onClick={!orderEditing && onSelectSymbol ? () => onSelectSymbol(row.instrumentId || row.symbol) : undefined}
              onKeyDown={!orderEditing && onSelectSymbol ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelectSymbol(row.instrumentId || row.symbol);
              } : undefined}
            >
              {orderEditing ? (
                <td className="transaction-watchlist-drag-cell">
                  <button
                    className="transaction-watchlist-symbol-drag-handle"
                    type="button"
                    title="클릭해서 드래그하면 순서를 바꿀 수 있습니다"
                    aria-label={`${row.symbol} 순서 드래그`}
                    onPointerDown={(event) => handleSymbolPointerStart(event, row)}
                    onMouseDown={(event) => handleSymbolPointerStart(event, row)}
                  >
                    <GripVertical size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </td>
              ) : null}
              <td className="is-left transaction-table-ticker">{row.symbol}</td>
              <td className="is-left transaction-table-name">{row.name}</td>
              {transactionWatchlistReturnColumns.map((column) => {
                const value = Number(row[column.valueField]);
                const hasValue = Boolean(row[column.hasField] && Number.isFinite(value));
                return (
                  <td
                    key={`transaction-watchlist-row-${row.instrumentId || row.symbol}-${column.key}`}
                    className={hasValue ? valueTone(value) : ""}
                  >
                    {hasValue ? formatSignedPercent(value) : "-"}
                  </td>
                );
              })}
              {!orderEditing ? (
                <td className="transaction-watchlist-row-actions">
                  <button
                    className="transaction-watchlist-symbol-delete-button"
                    type="button"
                    aria-label={`${row.symbol} 관심 종목 삭제`}
                    title={`${row.symbol} 관심 종목 삭제`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveSymbol(row.instrumentId || row.symbol);
                    }}
                  >
                    <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </td>
              ) : null}
            </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length ? (
        <div className="transaction-empty-state">{emptyLabel}</div>
      ) : null}
      <div className="transaction-table-credit">
        <span>{payload?.source || "토스 증권 API"}</span>
        {payload?.fetchedAt ? <span>{formatUpdatedAt(payload.fetchedAt)}</span> : null}
      </div>
      {dragPreview ? (
        <div
          className="transaction-watchlist-stock-drag-preview"
          style={{ "--transaction-drag-x": `${dragPreview.x}px`, "--transaction-drag-y": `${dragPreview.y}px` }}
          aria-hidden="true"
        >
          <span className="transaction-watchlist-stock-drag-label">
            <GripVertical size={15} strokeWidth={2.2} />
            <strong>{dragPreview.symbol}</strong>
            <span>{dragPreview.name}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function WatchlistMain({
  selectedGroup,
  items,
  symbolOptions,
  priceMap,
  payload,
  loading,
  error,
  statusBannerProps,
  binanceStatus,
  binanceError = "",
  renameActive,
  renameDraft,
  renameError,
  onRequestRenameGroup,
  onRenameDraftChange,
  onSubmitRenameGroup,
  onCancelRenameGroup,
  symbolOrderEditing,
  onSymbolOrderEditStart,
  onSymbolOrderChange,
  onSymbolOrderSave,
  onOpenAddSymbol,
  onRemoveSymbol,
  onSelectSymbol,
  onDisplayData,
}) {
  const hasSelectedGroup = Boolean(selectedGroup);
  const rows = useMemo(
    () => watchlistRowsFromGroup(selectedGroup, items, symbolOptions, priceMap),
    [items, priceMap, selectedGroup, symbolOptions]
  );
  const averageDailyReturn = useMemo(() => averageWatchlistDailyReturn(rows), [rows]);
  const stockAverageReturn = useMemo(
    () => averageWatchlistDailyReturn(rows.filter((row) => row.provider !== "binance")),
    [rows],
  );
  const cryptoAverageReturn = useMemo(
    () => averageWatchlistDailyReturn(rows.filter((row) => row.provider === "binance")),
    [rows],
  );
  const hasMixedPeriods = rows.some((row) => row.provider === "binance") &&
    rows.some((row) => row.provider !== "binance");
  const averageReturnLabel = hasMixedPeriods
    ? `주식 ${stockAverageReturn.hasValue ? formatSignedPercent(stockAverageReturn.value) : "-"} · 암호자산 ${cryptoAverageReturn.hasValue ? formatSignedPercent(cryptoAverageReturn.value) : "-"} · 합계 ${averageDailyReturn.hasValue ? formatSignedPercent(averageDailyReturn.value) : "-"}`
    : averageDailyReturn.hasValue ? formatSignedPercent(averageDailyReturn.value) : "-";
  const averageReturnMetrics = hasMixedPeriods
    ? [
        { id: "stock", label: "주식", ...stockAverageReturn },
        { id: "crypto", label: "암호자산", ...cryptoAverageReturn },
        { id: "total", label: "합계", ...averageDailyReturn },
      ]
    : [{ id: "total", label: "합계", ...averageDailyReturn }];
  const averageReturnCaption = "일간 평균 수익";
  const shouldShowBlockingError = Boolean(error && !payload);
  const SymbolOrderIcon = symbolOrderEditing ? Save : PencilLine;
  const displayData = useMemo(() => ({
    schemaVersion: "transaction-status-display-data.v1",
    id: "watchlist-overview",
    title: `${selectedGroup?.name || "관심 목록"} 메인`,
    kind: "watchlist-overview",
    exposure: "context",
    summary: {
      status: loading ? "loading" : error ? "error" : "ready",
      error,
      groupId: selectedGroup?.id || "",
      groupName: selectedGroup?.name || "관심 목록",
      rowCount: rows.length,
      averageReturnLabel,
      averageReturnCaption,
      mixedPeriods: hasMixedPeriods,
      source: String(payload?.source || "").trim(),
      fetchedAt: String(payload?.fetchedAt || "").trim(),
    },
    data: {
      selectedGroup: selectedGroup
        ? {
            id: selectedGroup.id,
            name: selectedGroup.name,
            instruments: normalizeTransactionWatchlistInstrumentsSetting(
              selectedGroup.instruments,
              selectedGroup.symbols
            ),
          }
        : null,
      tableColumns: [
        { id: "symbol", label: "티커 / 종목번호" },
        { id: "name", label: "종목명" },
        ...transactionWatchlistReturnColumns.map((column) => ({ id: column.key, label: column.label })),
      ],
      tableRows: rows.map(transactionWatchlistContextRow),
    },
  }), [averageReturnCaption, averageReturnLabel, error, hasMixedPeriods, loading, payload, rows, selectedGroup]);

  useEffect(() => {
    onDisplayData?.(displayData);
  }, [displayData, onDisplayData]);

  return (
    <section className="transaction-main-section transaction-watchlist-main-section" aria-label="관심 그룹 상세">
      <TransactionMarketDataStatus
        statusBannerProps={statusBannerProps}
        instruments={normalizeTransactionWatchlistInstrumentsSetting(selectedGroup?.instruments, selectedGroup?.symbols)}
        binanceStatus={binanceStatus}
        binanceError={binanceError}
      />

      <div className="transaction-main-summary transaction-watchlist-main-summary">
        {renameActive && selectedGroup ? (
          <form
            className="transaction-watchlist-title-rename-form"
            aria-label={`${selectedGroup.name} 관심 그룹 이름 변경`}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitRenameGroup();
            }}
          >
            <input
              className="transaction-watchlist-title-rename-input"
              type="text"
              value={renameDraft}
              maxLength={80}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onBlur={(event) => {
                if (!cleanTransactionWatchlistGroupName(event.currentTarget.value)) {
                  onCancelRenameGroup();
                  return;
                }
                onSubmitRenameGroup();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRenameGroup();
                }
              }}
            />
            {renameError ? <span className="transaction-watchlist-title-rename-error" role="alert">{renameError}</span> : null}
          </form>
        ) : (
          <button
            className="transaction-watchlist-title-button"
            type="button"
            aria-label={hasSelectedGroup ? `${selectedGroup.name} 관심 그룹 이름 변경` : "관심 목록"}
            title={hasSelectedGroup ? "관심 그룹 이름 변경" : undefined}
            disabled={!hasSelectedGroup}
            onClick={() => onRequestRenameGroup(selectedGroup.id, "main")}
          >
            <span>{selectedGroup?.name || "관심 목록"}</span>
          </button>
        )}
        <div className="transaction-watchlist-return-summary">
          <span className="transaction-watchlist-return-metrics" aria-label={averageReturnLabel}>
            {averageReturnMetrics.map((metric) => (
              <span className="transaction-watchlist-return-metric" key={metric.id}>
                <strong>{metric.label}</strong>
                <em className={metric.hasValue ? valueTone(metric.value) : ""}>
                  {metric.hasValue ? formatSignedPercent(metric.value) : "-"}
                </em>
              </span>
            ))}
          </span>
          <em className="transaction-watchlist-return-caption">{averageReturnCaption}</em>
        </div>
      </div>

      <div className="transaction-main-filters transaction-watchlist-main-actions" aria-label="관심 종목 작업">
        <button
          className={symbolOrderEditing ? "transaction-watchlist-stock-order-button is-active" : "transaction-watchlist-stock-order-button"}
          type="button"
          aria-label={symbolOrderEditing ? "관심 종목 순서 저장" : "관심 종목 순서 바꾸기"}
          title={symbolOrderEditing ? "관심 종목 순서 저장" : "관심 종목 순서 바꾸기"}
          aria-pressed={symbolOrderEditing}
          disabled={!symbolOrderEditing && (!hasSelectedGroup || rows.length < 2)}
          onClick={symbolOrderEditing ? onSymbolOrderSave : onSymbolOrderEditStart}
        >
          <SymbolOrderIcon size={16} strokeWidth={2.3} aria-hidden="true" />
          <span>{symbolOrderEditing ? "순서 저장" : "순서 바꾸기"}</span>
        </button>
        <button
          className="transaction-watchlist-stock-add-button"
          type="button"
          aria-label="종목 추가하기"
          title="종목 추가하기"
          disabled={!hasSelectedGroup || symbolOrderEditing}
          onClick={onOpenAddSymbol}
        >
          <CirclePlus size={17} strokeWidth={2.3} aria-hidden="true" />
          <span>종목 추가하기</span>
        </button>
      </div>

      {loading && !payload ? (
        <div className="transaction-loading-state">
          <LoaderCircle className="is-spinning" size={18} strokeWidth={2.4} />
          <span>시장 시세 불러오는 중</span>
        </div>
      ) : shouldShowBlockingError ? (
        <div className="transaction-error-state">{error}</div>
      ) : (
        <WatchlistTable
          rows={rows}
          payload={payload}
          emptyLabel={hasSelectedGroup ? "추가한 종목이 없습니다." : "관심 그룹이 없습니다."}
          orderEditing={symbolOrderEditing}
          onOrderChange={onSymbolOrderChange}
          onRemoveSymbol={onRemoveSymbol}
          onSelectSymbol={onSelectSymbol}
        />
      )}
    </section>
  );
}

export function WatchlistCreateDialog({
  draftName,
  error,
  onDraftNameChange,
  onCancel,
  onSubmit,
}) {
  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="transaction-watchlist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-watchlist-create-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="transaction-watchlist-field" htmlFor="transaction-watchlist-group-name">
          <span id="transaction-watchlist-create-title">새 관심 그룹 이름을 입력하세요</span>
          <input
            id="transaction-watchlist-group-name"
            type="text"
            value={draftName}
            maxLength={80}
            autoFocus
            onChange={(event) => onDraftNameChange(event.target.value)}
          />
        </label>
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-watchlist-modal-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button className="is-primary" type="submit">
            입력
          </button>
        </div>
      </form>
    </div>
  );
}

export function TransactionSymbolSearchField({
  inputId,
  titleId,
  label = "티커 / 종목번호 / 종목명을 입력하세요",
  draftSymbol,
  symbolOptions = [],
  excludedInstruments = [],
  selectedSymbol = null,
  autoFocus = false,
  disabled = false,
  onDraftSymbolChange,
  onSelectOption,
}) {
  const query = String(draftSymbol || "").trim();
  const listboxId = `${inputId}-options`;
  const selectedSymbolCode = cleanTransactionWatchlistSymbol(selectedSymbol?.symbol);
  const selectedMatchesDraft = selectedSymbolCode && selectedSymbolCode === cleanTransactionWatchlistSymbol(draftSymbol);
  const suggestions = query && !selectedMatchesDraft
    ? transactionSymbolSearchSuggestions(symbolOptions, query, excludedInstruments, 8)
    : [];
  const suggestionKey = suggestions.map((option) => option.instrumentId).join(",");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  useEffect(() => {
    setHighlightedIndex(suggestions.length ? 0 : -1);
  }, [query, suggestionKey, suggestions.length]);
  const handleSelectOption = useCallback((option) => {
    const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
    if (!symbol) return;
    if (onSelectOption) {
      onSelectOption({ ...option, symbol });
    } else {
      onDraftSymbolChange(symbol);
    }
    setHighlightedIndex(-1);
  }, [onDraftSymbolChange, onSelectOption]);

  return (
    <>
      <label className="transaction-watchlist-field" htmlFor={inputId}>
        <span id={titleId}>{label}</span>
        <input
          id={inputId}
          type="text"
          value={draftSymbol}
          maxLength={32}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={suggestions.length ? listboxId : undefined}
          aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-${highlightedIndex}` : undefined}
          disabled={disabled}
          onChange={(event) => onDraftSymbolChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setHighlightedIndex((current) => (current + 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setHighlightedIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === "Escape" && highlightedIndex >= 0) {
              event.preventDefault();
              event.stopPropagation();
              setHighlightedIndex(-1);
              return;
            }
            if (event.key !== "Enter" || !onSelectOption || !suggestions.length) return;
            event.preventDefault();
            handleSelectOption(suggestions[Math.max(0, highlightedIndex)]);
          }}
        />
      </label>
      {suggestions.length ? (
        <div id={listboxId} className="transaction-watchlist-autocomplete" role="listbox" aria-label="종목 자동완성">
          {suggestions.map((option, index) => (
            <button
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              key={`transaction-watchlist-option-${option.instrumentId || option.symbol}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => handleSelectOption(option)}
            >
              <strong>{option.displaySymbol || option.symbol}</strong>
              <span>{transactionInstrumentDescription(option)}</span>
              <em className={`transaction-instrument-provider-badge is-${normalizeTransactionInstrumentProvider(option.provider)}`}>
                {normalizeTransactionInstrumentProvider(option.provider) === "binance" ? "Binance" : "Toss"}
              </em>
            </button>
          ))}
        </div>
      ) : query && !selectedMatchesDraft ? (
        <p className="transaction-watchlist-autocomplete-empty">검색 가능한 종목 목록에서 찾을 수 없습니다.</p>
      ) : null}
    </>
  );
}

export function TransactionSymbolSearchDialog({
  inputId,
  titleId,
  draftSymbol,
  selectedSymbol,
  error,
  symbolOptions = [],
  excludedInstruments = [],
  onDraftSymbolChange,
  onSelectSymbol,
  onCancel,
  onSubmit,
}) {
  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="transaction-watchlist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <TransactionSymbolSearchField
          inputId={inputId}
          titleId={titleId}
          draftSymbol={draftSymbol}
          symbolOptions={symbolOptions}
          excludedInstruments={excludedInstruments}
          selectedSymbol={selectedSymbol}
          autoFocus
          onDraftSymbolChange={onDraftSymbolChange}
          onSelectOption={onSelectSymbol}
        />
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-watchlist-modal-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button className="is-primary" type="submit">
            입력
          </button>
        </div>
      </form>
    </div>
  );
}

export function WatchlistSymbolDialog({
  group,
  draftSymbol,
  selectedSymbol,
  error,
  symbolOptions = [],
  onDraftSymbolChange,
  onSelectSymbol,
  onCancel,
  onSubmit,
}) {
  if (!group) return null;
  return (
    <TransactionSymbolSearchDialog
      inputId="transaction-watchlist-symbol"
      titleId="transaction-watchlist-symbol-title"
      draftSymbol={draftSymbol}
      selectedSymbol={selectedSymbol}
      error={error}
      symbolOptions={symbolOptions}
      excludedInstruments={group.instruments}
      onDraftSymbolChange={onDraftSymbolChange}
      onSelectSymbol={onSelectSymbol}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}

export function WatchlistDeleteDialog({ group, onCancel, onConfirm }) {
  if (!group) return null;
  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="transaction-watchlist-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="관심 그룹 삭제"
        aria-describedby="transaction-watchlist-delete-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p id="transaction-watchlist-delete-description">관심 그룹을 삭제하시겠습니까? 이 결정은 되돌릴 수 없습니다</p>
        <strong className="transaction-watchlist-delete-target">{group.name}</strong>
        <div className="transaction-watchlist-modal-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button className="is-danger" type="button" onClick={onConfirm}>
            확인
          </button>
        </div>
      </section>
    </div>
  );
}

export function SimulatorDeleteDialog({ simulator, busy = false, onCancel, onConfirm }) {
  if (!simulator) return null;
  const simulatorName = simulatorDisplayLabel(simulator, 0);
  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section
        className="transaction-watchlist-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="투자 시뮬레이터 삭제"
        aria-describedby="transaction-simulator-delete-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p id="transaction-simulator-delete-description">
          이 시뮬레이터 계좌를 목록에서 삭제할까요? 장부에는 삭제 기록이 남습니다.
        </p>
        <strong className="transaction-watchlist-delete-target">{simulatorName}</strong>
        <div className="transaction-watchlist-modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button className="is-danger" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? "삭제 중" : "삭제"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function SimulatorExchangeDialog({
  simulator,
  usdKrwRate,
  modeId,
  amountDraft,
  error,
  busy = false,
  onModeChange,
  onAmountChange,
  onSubmitExchange,
  onCancel,
}) {
  if (!simulator) return null;
  const mode = transactionSimulatorExchangeMode(modeId);
  const fromBalance = transactionSimulatorBuyAvailableAmount(simulator, mode.fromUnit);
  const amountValue = transactionSimulatorExchangeAmountValue(amountDraft);
  const hasAmount = String(amountDraft || "").trim() !== "";
  const outputAmount = transactionSimulatorExchangeOutputAmount(amountValue, mode.id, usdKrwRate);
  const rate = Number(usdKrwRate || 0);
  const rateUnavailable = !Number.isFinite(rate) || rate <= 0;
  const amountTooLarge = hasAmount && amountValue > fromBalance;
  const amountInvalid = hasAmount && amountValue <= 0;
  const convertedText = hasAmount && outputAmount !== null && outputAmount > 0
    ? formatMoney(outputAmount, mode.toUnit)
    : "-";
  const formMessage = rateUnavailable
    ? "환율을 불러온 뒤 환전 가능합니다."
    : amountTooLarge
      ? `최대 환전 가능 액수는 ${formatMoney(fromBalance, mode.fromUnit)}입니다.`
      : amountInvalid
        ? "환전할 금액을 입력하세요."
        : "";
  const canSubmitExchange =
    !busy &&
    hasAmount &&
    !rateUnavailable &&
    !amountTooLarge &&
    !amountInvalid &&
    outputAmount !== null &&
    outputAmount > 0;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmitExchange) return;
    onSubmitExchange?.({
      mode: mode.id,
      fromCurrency: mode.fromUnit,
      toCurrency: mode.toUnit,
      fromAmount: amountValue,
      toAmount: outputAmount,
      rate,
    });
  }

  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section
        className="transaction-watchlist-modal transaction-simulator-exchange-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-simulator-exchange-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="transaction-simulator-exchange-header">
          <strong id="transaction-simulator-exchange-title">환전</strong>
          <span>{transactionSimulatorExchangeRateText(usdKrwRate)}</span>
        </div>
        <div className="transaction-simulator-exchange-tabs" role="tablist" aria-label="환전 방향">
          {transactionSimulatorExchangeModes.map((tabMode) => {
            const selected = tabMode.id === mode.id;
            return (
              <button
                className={selected ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={selected}
                key={tabMode.id}
                disabled={busy}
                onClick={() => onModeChange?.(tabMode.id)}
              >
                {tabMode.label}
              </button>
            );
          })}
        </div>
        <form className="transaction-simulator-exchange-form" onSubmit={handleSubmit}>
          <label htmlFor="transaction-simulator-exchange-amount">
            <span>{transactionSimulatorCurrencyLabel(mode.fromUnit)} 금액</span>
            <div className={`transaction-simulator-money-input transaction-simulator-exchange-input is-${mode.fromUnit.toLowerCase()}`}>
              <input
                id="transaction-simulator-exchange-amount"
                type="text"
                inputMode={mode.fromUnit === "USD" ? "decimal" : "numeric"}
                placeholder={mode.fromUnit === "USD" ? "0.00" : "0"}
                value={amountDraft}
                disabled={busy}
                autoFocus
                onChange={(event) => onAmountChange?.(event.target.value)}
              />
              <em className="transaction-simulator-money-input-adornment" aria-hidden="true">
                {mode.fromUnit === "USD" ? "$" : "원"}
              </em>
            </div>
          </label>
          <p className="transaction-simulator-exchange-limit">
            최대 환전 가능 {formatMoney(fromBalance, mode.fromUnit)}
          </p>
          <p className="transaction-simulator-exchange-estimate">
            예상 수령 <strong>{convertedText}</strong>
          </p>
          {formMessage ? <p className="transaction-watchlist-modal-error" role="alert">{formMessage}</p> : null}
          {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
          <div className="transaction-simulator-exchange-actions">
            <button type="button" disabled={busy} onClick={onCancel}>
              닫기
            </button>
            <button className="is-primary" type="submit" disabled={!canSubmitExchange}>
              {busy ? "환전 중" : "환전하기"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function SimulatorBuyDialog({
  simulator,
  unit,
  usdKrwRate,
  draftSymbol,
  selectedSymbol,
  symbolOptions = [],
  amountDraft,
  error,
  busy = false,
  marketCalendar,
  marketCalendarLoading = false,
  marketCalendarError = "",
  binanceStatus = null,
  binanceError = "",
  onDraftSymbolChange,
  onSelectSymbol,
  onAmountChange,
  onPresetAmount,
  onSubmitOrder,
  onCancel,
}) {
  if (!simulator) return null;
  const displayUnit = normalizeMoneyUnit(unit);
  const selectedSymbolCode = cleanTransactionWatchlistSymbol(selectedSymbol?.symbol);
  const hasSelectedSymbol = Boolean(selectedSymbolCode);
  const settlementUnit = hasSelectedSymbol ? transactionSimulatorSettlementUnit(selectedSymbol) : displayUnit;
  const settlementCurrencyLabel = transactionSimulatorCurrencyLabel(settlementUnit);
  const selectedSymbolDescription = transactionInstrumentDescription(selectedSymbol);
  const availableSettlementAmount = transactionSimulatorBuyAvailableAmount(simulator, settlementUnit);
  const availableOrderAmount = convertMoney(availableSettlementAmount, settlementUnit, displayUnit, usdKrwRate);
  const availableOrderText = availableOrderAmount === null ? "-" : formatMoney(availableOrderAmount, displayUnit);
  const minimumSettlementAmount = transactionSimulatorMinimumSettlementBuyAmount(settlementUnit, usdKrwRate);
  const minimumAmount = transactionSimulatorMinimumOrderAmount(displayUnit, settlementUnit, usdKrwRate);
  const minimumLabel = transactionSimulatorMinimumBuyLabel(displayUnit, settlementUnit, usdKrwRate);
  const amountValue = transactionSimulatorBuyAmountValue(amountDraft);
  const hasAmount = String(amountDraft || "").trim() !== "";
  const settlementAmountValue = convertMoney(amountValue, displayUnit, settlementUnit, usdKrwRate);
  const needsExchangeRate = hasSelectedSymbol && displayUnit !== settlementUnit && (
    minimumAmount === null || availableOrderAmount === null || (hasAmount && settlementAmountValue === null)
  );
  const amountTooSmall = hasSelectedSymbol && hasAmount && minimumAmount !== null && amountValue < minimumAmount;
  const amountTooLarge =
    hasSelectedSymbol && hasAmount && settlementAmountValue !== null && settlementAmountValue > availableSettlementAmount;
  const tradingEligibility = transactionSimulatorBuyTradingEligibility({
    selectedSymbol,
    marketCalendar,
    marketCalendarLoading,
    marketCalendarError,
    binanceStatus,
    binanceError,
  });
  const canSubmitOrder =
    hasSelectedSymbol &&
    hasAmount &&
    tradingEligibility.canTrade &&
    !needsExchangeRate &&
    !amountTooSmall &&
    !amountTooLarge &&
    settlementAmountValue !== null &&
    settlementAmountValue > 0;
  const tradingMessage = hasSelectedSymbol && !tradingEligibility.canTrade ? tradingEligibility.reason : "";
  const amountMessage = tradingMessage || (
    needsExchangeRate
      ? "환율을 불러온 뒤 주문 가능합니다."
      : amountTooSmall
        ? `최소 주문 금액은 ${minimumLabel}입니다.`
        : amountTooLarge
          ? `주문 가능 금액은 ${availableOrderText}입니다.`
          : ""
  );
  const presets = transactionSimulatorBuyPresets(displayUnit);
  const helpTitle =
    `소수점 매매만 지원하며 체결 가격은 시장가만 사용합니다. ${settlementCurrencyLabel} 잔고에서 결제됩니다.${itemIsCrypto(selectedSymbol) ? " 공개 계정 수수료율을 알 수 없어 수수료는 0으로 가정합니다." : ""}`;

  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="transaction-watchlist-modal transaction-simulator-buy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-simulator-buy-symbol-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <TransactionSymbolSearchField
          inputId="transaction-simulator-buy-symbol"
          titleId="transaction-simulator-buy-symbol-title"
          draftSymbol={draftSymbol}
          symbolOptions={symbolOptions}
          selectedSymbol={selectedSymbol}
          autoFocus
          disabled={busy}
          onDraftSymbolChange={onDraftSymbolChange}
          onSelectOption={onSelectSymbol}
        />
        {hasSelectedSymbol ? (
          <div className="transaction-simulator-buy-selected-symbol">
            <strong>{selectedSymbolCode}</strong>
            <span>{selectedSymbolDescription || selectedSymbolCode}</span>
          </div>
        ) : null}
        <div
          className={`transaction-simulator-buy-order-panel${hasSelectedSymbol ? "" : " is-disabled"}`}
          aria-disabled={!hasSelectedSymbol}
        >
          <div className="transaction-simulator-buy-amount-row">
            <span className="transaction-simulator-buy-amount-label">총 주문 금액</span>
            <div className={`transaction-simulator-buy-amount-control transaction-simulator-money-input is-${displayUnit.toLowerCase()}`}>
              <input
                type="text"
                inputMode={displayUnit === "USD" ? "decimal" : "numeric"}
                placeholder={displayUnit === "USD" ? "0.00" : "0"}
                value={amountDraft}
                disabled={!hasSelectedSymbol || busy}
                aria-label="총 주문 금액"
                onChange={(event) => onAmountChange(event.target.value)}
              />
              <em className="transaction-simulator-money-input-adornment" aria-hidden="true">
                {displayUnit === "USD" ? "$" : "원"}
              </em>
            </div>
          </div>
          <div className="transaction-simulator-buy-presets" aria-label="주문 금액 빠른 입력">
            {presets.map((preset) => {
              const belowMinimum = minimumAmount !== null && preset.amount < minimumAmount;
              return (
                <button
                  type="button"
                  key={`${displayUnit}-${preset.label}`}
                  disabled={!hasSelectedSymbol || busy || belowMinimum}
                  title={belowMinimum ? `최소 주문 금액은 ${minimumLabel}입니다.` : `${preset.label} 입력`}
                  onClick={() => onPresetAmount(preset.amount)}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              type="button"
              disabled={
                !hasSelectedSymbol ||
                busy ||
                availableOrderAmount === null ||
                availableSettlementAmount < minimumSettlementAmount
              }
              title="주문 가능 금액 전체 입력"
              onClick={() => onPresetAmount(availableOrderAmount)}
            >
              최대
            </button>
          </div>
          <p className="transaction-simulator-buy-available">
            주문 가능 금액 {availableOrderText}
            <span title={helpTitle} aria-label={helpTitle}>
              <CircleHelp size={15} strokeWidth={2.1} aria-hidden="true" />
            </span>
          </p>
          {hasSelectedSymbol ? (
            <p className="transaction-simulator-buy-settlement">
              결제 잔고 {settlementCurrencyLabel} {formatMoney(availableSettlementAmount, settlementUnit)}
            </p>
          ) : null}
          {hasSelectedSymbol ? (
            <p
              className={`transaction-simulator-buy-trading${tradingEligibility.canTrade ? " is-open" : " is-closed"}`}
            >
              {tradingEligibility.label}
            </p>
          ) : null}
          <p className="transaction-simulator-buy-minimum">최소 주문 금액 {minimumLabel}</p>
          {amountMessage ? <p className="transaction-watchlist-modal-error" role="alert">{amountMessage}</p> : null}
        </div>
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-simulator-buy-modal-actions">
          <span>
            {transactionSimulatorCurrencyLabel(displayUnit)} 입력 · {settlementCurrencyLabel} 결제 · 시장가 매수
            {itemIsCrypto(selectedSymbol) ? " · 수수료 0 가정" : ""}
          </span>
          <div className="transaction-simulator-buy-modal-action-buttons">
            <button type="button" disabled={busy} onClick={onCancel}>
              닫기
            </button>
            <button
              className="transaction-simulator-buy-submit"
              type="button"
              disabled={!canSubmitOrder || busy}
              onClick={() => onSubmitOrder?.({
                ...normalizeTransactionInstrument(selectedSymbol),
                symbol: selectedSymbolCode,
                symbolName: selectedSymbol?.name || "",
                market: selectedSymbol?.market || "",
                orderUnit: displayUnit,
                settlementUnit,
                orderAmount: amountValue,
                settlementAmount: settlementAmountValue,
                marketSession: tradingEligibility.sessionKey || "",
              })}
            >
              {busy ? "주문 중" : "주문하기"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function SimulatorSellDialog({
  position,
  unit,
  usdKrwRate,
  amountDraft,
  error,
  busy = false,
  marketCalendar,
  marketCalendarLoading = false,
  marketCalendarError = "",
  binanceStatus = null,
  binanceError = "",
  onAmountChange,
  onPresetFraction,
  onSubmitOrder,
  onCancel,
}) {
  if (!position) return null;
  const displayUnit = normalizeMoneyUnit(unit);
  const selectedSymbol = transactionSimulatorStockOptionFromItem(position);
  const selectedSymbolCode = cleanTransactionWatchlistSymbol(selectedSymbol?.symbol);
  const settlementUnit = normalizeMoneyUnit(position.currency || position.displayCurrency || transactionSimulatorSettlementUnit(selectedSymbol));
  const settlementCurrencyLabel = transactionSimulatorCurrencyLabel(settlementUnit);
  const selectedSymbolDescription = transactionInstrumentDescription(selectedSymbol);
  const availableSettlementAmount = transactionSimulatorPositionSettlementValue(position);
  const availableOrderAmount = convertMoney(availableSettlementAmount, settlementUnit, displayUnit, usdKrwRate);
  const availableOrderText = availableOrderAmount === null ? "-" : formatMoney(availableOrderAmount, displayUnit);
  const amountValue = transactionSimulatorBuyAmountValue(amountDraft);
  const hasAmount = String(amountDraft || "").trim() !== "";
  const settlementAmountValue = convertMoney(amountValue, displayUnit, settlementUnit, usdKrwRate);
  const needsExchangeRate = displayUnit !== settlementUnit && (
    availableOrderAmount === null || (hasAmount && settlementAmountValue === null)
  );
  const amountTooLarge =
    hasAmount && settlementAmountValue !== null && settlementAmountValue > availableSettlementAmount;
  const tradingEligibility = transactionSimulatorBuyTradingEligibility({
    selectedSymbol,
    marketCalendar,
    marketCalendarLoading,
    marketCalendarError,
    binanceStatus,
    binanceError,
  });
  const canSubmitOrder =
    Boolean(selectedSymbolCode) &&
    hasAmount &&
    tradingEligibility.canTrade &&
    !needsExchangeRate &&
    !amountTooLarge &&
    settlementAmountValue !== null &&
    settlementAmountValue > 0;
  const tradingMessage = !tradingEligibility.canTrade ? tradingEligibility.reason : "";
  const amountMessage = tradingMessage || (
    needsExchangeRate
      ? "환율을 불러온 뒤 주문 가능합니다."
      : amountTooLarge
        ? `매도 가능 금액은 ${availableOrderText}입니다.`
        : ""
  );
  const helpTitle =
    `소수점 매매만 지원하며 체결 가격은 시장가만 사용합니다. ${settlementCurrencyLabel} 보유분을 매도합니다.${itemIsCrypto(selectedSymbol) ? " 공개 계정 수수료율을 알 수 없어 수수료는 0으로 가정합니다." : ""}`;

  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="transaction-watchlist-modal transaction-simulator-buy-modal transaction-simulator-sell-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-simulator-sell-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="transaction-simulator-sell-header">
          <strong id="transaction-simulator-sell-title">매도</strong>
          <span>시장가 · 소수점 매매</span>
        </div>
        <div className="transaction-simulator-buy-selected-symbol">
          <strong>{selectedSymbolCode}</strong>
          <span>{selectedSymbolDescription || selectedSymbolCode}</span>
        </div>
        <div className="transaction-simulator-buy-order-panel" aria-disabled={false}>
          <div className="transaction-simulator-buy-amount-row">
            <span className="transaction-simulator-buy-amount-label">총 주문 금액</span>
            <div className={`transaction-simulator-buy-amount-control transaction-simulator-money-input is-${displayUnit.toLowerCase()}`}>
              <input
                type="text"
                inputMode={displayUnit === "USD" ? "decimal" : "numeric"}
                placeholder={displayUnit === "USD" ? "0.00" : "0"}
                value={amountDraft}
                disabled={busy}
                autoFocus
                aria-label="총 주문 금액"
                onChange={(event) => onAmountChange(event.target.value)}
              />
              <em className="transaction-simulator-money-input-adornment" aria-hidden="true">
                {displayUnit === "USD" ? "$" : "원"}
              </em>
            </div>
          </div>
          <div className="transaction-simulator-buy-presets transaction-simulator-sell-presets" aria-label="매도 비율 빠른 입력">
            {transactionSimulatorSellFractions.map((preset) => (
              <button
                type="button"
                key={preset.label}
                disabled={busy || availableOrderAmount === null || availableOrderAmount <= 0}
                title={`${preset.label} 매도 금액 입력`}
                onClick={() => onPresetFraction(preset.fraction)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="transaction-simulator-buy-available">
            매도 가능 금액 {availableOrderText}
            <span title={helpTitle} aria-label={helpTitle}>
              <CircleHelp size={15} strokeWidth={2.1} aria-hidden="true" />
            </span>
          </p>
          <p className="transaction-simulator-buy-settlement">
            보유 수량 {formatQuantity(position.quantity, position)} · {settlementCurrencyLabel} 평가액 {formatMoney(availableSettlementAmount, settlementUnit)}
          </p>
          <p
            className={`transaction-simulator-buy-trading${tradingEligibility.canTrade ? " is-open" : " is-closed"}`}
          >
            {tradingEligibility.label}
          </p>
          {amountMessage ? <p className="transaction-watchlist-modal-error" role="alert">{amountMessage}</p> : null}
        </div>
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-simulator-buy-modal-actions">
          <span>
            {transactionSimulatorCurrencyLabel(displayUnit)} 입력 · {settlementCurrencyLabel} 매도 · 시장가 매도
            {itemIsCrypto(selectedSymbol) ? " · 수수료 0 가정" : ""}
          </span>
          <div className="transaction-simulator-buy-modal-action-buttons">
            <button type="button" disabled={busy} onClick={onCancel}>
              닫기
            </button>
            <button
              className="transaction-simulator-sell-submit"
              type="button"
              disabled={!canSubmitOrder || busy}
              onClick={() => onSubmitOrder?.({
                ...normalizeTransactionInstrument(selectedSymbol),
                symbol: selectedSymbolCode,
                symbolName: selectedSymbol?.name || "",
                englishName: selectedSymbol?.englishName || "",
                market: selectedSymbol?.market || "",
                orderUnit: displayUnit,
                settlementUnit,
                orderAmount: amountValue,
                settlementAmount: settlementAmountValue,
                marketSession: tradingEligibility.sessionKey || "",
              })}
            >
              {busy ? "주문 중" : "주문하기"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function TransactionSimulatorOrderNotifications({ notifications = [] }) {
  if (!notifications.length) return null;
  return (
    <div className="transaction-order-notification-stack" aria-live="polite" aria-atomic="false">
      {notifications.map((notification) => (
        <div
          className={`transaction-order-notification is-${notification.side}${notification.leaving ? " is-leaving" : ""}`}
          key={notification.id}
          role="status"
        >
          <span>{notification.message}</span>
        </div>
      ))}
    </div>
  );
}

export function WatchlistPlaceholder({
  statusBannerProps,
  binanceStatus,
  binanceError = "",
  watchlistGroups,
  selectedGroupId,
  selectedGroup,
  items,
  symbolOptions,
  priceMap,
  payload,
  loading,
  error,
  orderEditing,
  renameGroupId,
  renamePlacement,
  renameDraft,
  renameError,
  symbolOrderEditing,
  onSelectGroup,
  onRequestRenameGroup,
  onRenameDraftChange,
  onSubmitRenameGroup,
  onCancelRenameGroup,
  onSymbolOrderEditStart,
  onSymbolOrderChange,
  onSymbolOrderSave,
  onOpenAddSymbol,
  onRemoveSymbol,
  selectedChartItem,
  chartUnit,
  usdKrwRate,
  onChartUnitChange,
  chartModeSetting,
  chartIntervalModeSetting,
  chartVolumeVisibleSetting,
  onChartModeChange,
  onChartIntervalModeChange,
  onChartVolumeVisibleChange,
  onSelectSymbol,
  onCloseChart,
  onOpenCreateGroup,
  onRequestDeleteGroup,
  onOrderEditStart,
  onOrderChange,
  onOrderSave,
  onDisplayData,
}) {
  const groups = normalizeTransactionWatchlistGroupsSetting(watchlistGroups, []);
  const [draggedGroupId, setDraggedGroupId] = useState("");
  const [dragOverGroupId, setDragOverGroupId] = useState("");
  const [dragInsertPlacement, setDragInsertPlacement] = useState("before");
  const [dragPreview, setDragPreview] = useState(null);
  const pointerDraggedGroupIdRef = useRef("");
  const pointerDragOverGroupIdRef = useRef("");
  const pointerDragPlacementRef = useRef("before");
  const groupsRef = useRef(groups);
  const SaveIcon = orderEditing ? Save : PencilLine;

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const updateDragOverGroupId = useCallback((groupId, placement = "before") => {
    pointerDragOverGroupIdRef.current = groupId;
    pointerDragPlacementRef.current = placement;
    setDragOverGroupId(groupId);
    setDragInsertPlacement(placement);
  }, []);

  const handleGroupDragEnd = useCallback(() => {
    pointerDraggedGroupIdRef.current = "";
    pointerDragOverGroupIdRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedGroupId("");
    setDragOverGroupId("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, []);

  const commitGroupOrderChange = useCallback((sourceId, targetId, placement = "before") => {
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(groupsRef.current, []);
    const nextGroups = reorderTransactionWatchlistGroups(currentGroups, sourceId, targetId, placement);
    if (!watchlistGroupIdsEqual(currentGroups, nextGroups)) {
      groupsRef.current = nextGroups;
      onOrderChange(nextGroups);
    }
  }, [onOrderChange]);

  const handleGroupPointerStart = useCallback((event, group) => {
    if (!orderEditing) return;
    if (event.type === "mousedown" && pointerDraggedGroupIdRef.current) return;
    const groupId = cleanTransactionWatchlistGroupId(group.id);
    if (!groupId) return;
    pointerDraggedGroupIdRef.current = groupId;
    pointerDragOverGroupIdRef.current = groupId;
    pointerDragPlacementRef.current = "before";
    setDraggedGroupId(groupId);
    setDragOverGroupId(groupId);
    setDragInsertPlacement("before");
    setDragPreview({
      id: groupId,
      name: group.name,
      x: event.clientX,
      y: event.clientY,
    });
    if (typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; document-level listeners still drive reordering.
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }, [orderEditing]);

  const handleGroupPointerMove = useCallback((event) => {
    if (!orderEditing || !pointerDraggedGroupIdRef.current) return;
    setDragPreview((current) => (
      current ? { ...current, x: event.clientX, y: event.clientY } : current
    ));
  }, [orderEditing]);

  const handleGroupPointerEnd = useCallback(() => {
    if (!orderEditing || !pointerDraggedGroupIdRef.current) return;
    handleGroupDragEnd();
  }, [handleGroupDragEnd, orderEditing]);

  useEffect(() => {
    if (!orderEditing || !draggedGroupId) return undefined;
    function dropTargetFromPoint(clientX, clientY) {
      const target = document.elementFromPoint(clientX, clientY);
      const row = target?.closest?.("[data-transaction-watchlist-group-id]");
      const groupId = cleanTransactionWatchlistGroupId(row?.dataset?.transactionWatchlistGroupId);
      if (!row || !groupId) return null;
      const rect = row.getBoundingClientRect();
      return {
        groupId,
        placement: clientY > rect.top + rect.height / 2 ? "after" : "before",
      };
    }
    function handleDocumentMove(event) {
      if (!pointerDraggedGroupIdRef.current) return;
      const clientX = Number(event.clientX || 0);
      const clientY = Number(event.clientY || 0);
      setDragPreview((current) => (
        current ? { ...current, x: clientX, y: clientY } : current
      ));
      const target = dropTargetFromPoint(clientX, clientY);
      if (!target) return;
      if (
        target.groupId === pointerDragOverGroupIdRef.current &&
        target.placement === pointerDragPlacementRef.current
      ) {
        return;
      }
      updateDragOverGroupId(target.groupId, target.placement);
      if (target.groupId !== pointerDraggedGroupIdRef.current) {
        commitGroupOrderChange(pointerDraggedGroupIdRef.current, target.groupId, target.placement);
      }
    }
    document.addEventListener("pointermove", handleDocumentMove);
    document.addEventListener("mousemove", handleDocumentMove);
    document.addEventListener("pointerup", handleGroupDragEnd);
    document.addEventListener("mouseup", handleGroupDragEnd);
    return () => {
      document.removeEventListener("pointermove", handleDocumentMove);
      document.removeEventListener("mousemove", handleDocumentMove);
      document.removeEventListener("pointerup", handleGroupDragEnd);
      document.removeEventListener("mouseup", handleGroupDragEnd);
    };
  }, [
    commitGroupOrderChange,
    draggedGroupId,
    handleGroupDragEnd,
    orderEditing,
    updateDragOverGroupId,
  ]);

  return (
    <section className="transaction-watchlist-section" aria-label="관심">
      <div className="transaction-watchlist-sidebar">
        <div className="transaction-watchlist-header">
          <h2>관심 목록</h2>
          <div className="transaction-watchlist-header-actions">
            <button
              className={orderEditing ? "transaction-watchlist-edit-button is-active" : "transaction-watchlist-edit-button"}
              type="button"
              aria-label={orderEditing ? "관심 그룹 순서 저장" : "관심 그룹 순서 편집"}
              title={orderEditing ? "관심 그룹 순서 저장" : "관심 그룹 순서 편집"}
              aria-pressed={orderEditing}
              disabled={!orderEditing && !groups.length}
              onClick={orderEditing ? onOrderSave : onOrderEditStart}
            >
              <SaveIcon size={17} strokeWidth={2.3} aria-hidden="true" />
            </button>
            <button
              className="transaction-watchlist-add-button"
              type="button"
              aria-label="관심 그룹 추가"
              title="관심 그룹 추가"
              onClick={onOpenCreateGroup}
            >
              <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        </div>
        {groups.length ? (
          <ul
            className={dragPreview ? "transaction-watchlist-group-list is-dragging" : "transaction-watchlist-group-list"}
            aria-label="관심 그룹 목록"
            onPointerMove={handleGroupPointerMove}
            onPointerUp={handleGroupPointerEnd}
            onPointerCancel={handleGroupDragEnd}
            onMouseMove={handleGroupPointerMove}
            onMouseUp={handleGroupPointerEnd}
          >
            {groups.map((group) => {
              const groupId = cleanTransactionWatchlistGroupId(group.id);
              const isSelected = groupId === selectedGroupId;
              const isRenaming = !orderEditing && groupId === renameGroupId && renamePlacement === "sidebar";
              const itemClassName = [
                "transaction-watchlist-group-item",
                isSelected ? "is-selected" : "",
                isRenaming ? "is-renaming" : "",
                orderEditing ? "is-manual-sort" : "",
                dragOverGroupId === groupId && draggedGroupId && draggedGroupId !== groupId
                  ? `is-drop-${dragInsertPlacement}`
                  : "",
                draggedGroupId === groupId ? "is-dragging" : "",
              ].filter(Boolean).join(" ");
              return (
              <li
                className={itemClassName}
                key={group.id}
                data-transaction-watchlist-group-id={groupId}
              >
                {orderEditing ? (
                  <button
                    className="transaction-watchlist-drag-handle"
                    type="button"
                    title="클릭해서 드래그하면 순서를 바꿀 수 있습니다"
                    aria-label={`${group.name} 순서 드래그`}
                    onPointerDown={(event) => handleGroupPointerStart(event, group)}
                    onMouseDown={(event) => handleGroupPointerStart(event, group)}
                  >
                    <GripVertical size={16} strokeWidth={2.2} />
                  </button>
                ) : null}
                {orderEditing ? (
                  <span className="transaction-watchlist-group-label">
                    <FolderClosed size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>{group.name}</span>
                  </span>
                ) : isRenaming ? (
                  <form
                    className="transaction-watchlist-rename-form"
                    aria-label={`${group.name} 관심 그룹 이름 변경`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      onSubmitRenameGroup();
                    }}
                  >
                    <FolderClosed size={15} strokeWidth={2.2} aria-hidden="true" />
                    <input
                      className="transaction-watchlist-rename-input"
                      type="text"
                      value={renameDraft}
                      maxLength={80}
                      autoFocus
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => onRenameDraftChange(event.target.value)}
                      onBlur={(event) => {
                        if (!cleanTransactionWatchlistGroupName(event.currentTarget.value)) {
                          onCancelRenameGroup();
                          return;
                        }
                        onSubmitRenameGroup();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          onCancelRenameGroup();
                        }
                      }}
                    />
                    {renameError ? <span className="transaction-watchlist-rename-error" role="alert">{renameError}</span> : null}
                  </form>
                ) : (
                  <button
                    className="transaction-watchlist-group-select"
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => (
                      isSelected ? onRequestRenameGroup(groupId, "sidebar") : onSelectGroup(groupId)
                    )}
                  >
                    <FolderClosed size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>{group.name}</span>
                  </button>
                )}
                {!orderEditing && !isRenaming ? (
                  <button
                    className="transaction-watchlist-delete-button"
                    type="button"
                    aria-label={`${group.name} 관심 그룹 삭제`}
                    title={`${group.name} 관심 그룹 삭제`}
                    onClick={() => onRequestDeleteGroup(group)}
                  >
                    <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className="transaction-watchlist-main" aria-label="관심 본문">
        {selectedChartItem ? (
          <TransactionInvestmentAssetDetail
            item={selectedChartItem}
            payload={payload}
            unit={chartUnit}
            usdKrwRate={usdKrwRate}
            onUnitChange={onChartUnitChange}
            onClose={onCloseChart}
            statusBannerProps={statusBannerProps}
            binanceStatus={binanceStatus}
            binanceError={binanceError}
            chartModeSetting={chartModeSetting}
            intervalModeSetting={chartIntervalModeSetting}
            volumeVisibleSetting={chartVolumeVisibleSetting}
            onChartModeChange={onChartModeChange}
            onIntervalModeChange={onChartIntervalModeChange}
            onVolumeVisibleChange={onChartVolumeVisibleChange}
            onDisplayData={onDisplayData}
          />
        ) : (
          <WatchlistMain
            selectedGroup={selectedGroup}
            items={items}
            symbolOptions={symbolOptions}
            priceMap={priceMap}
            payload={payload}
            loading={loading}
            error={error}
            statusBannerProps={statusBannerProps}
            binanceStatus={binanceStatus}
            binanceError={binanceError}
            renameActive={!orderEditing && selectedGroup?.id === renameGroupId && renamePlacement === "main"}
            renameDraft={renameDraft}
            renameError={renameError}
            onRequestRenameGroup={onRequestRenameGroup}
            onRenameDraftChange={onRenameDraftChange}
            onSubmitRenameGroup={onSubmitRenameGroup}
            onCancelRenameGroup={onCancelRenameGroup}
            symbolOrderEditing={symbolOrderEditing}
            onSymbolOrderEditStart={onSymbolOrderEditStart}
            onSymbolOrderChange={onSymbolOrderChange}
            onSymbolOrderSave={onSymbolOrderSave}
            onOpenAddSymbol={onOpenAddSymbol}
            onRemoveSymbol={onRemoveSymbol}
            onSelectSymbol={onSelectSymbol}
            onDisplayData={onDisplayData}
          />
        )}
      </div>
      {dragPreview ? (
        <div
          className="transaction-watchlist-drag-preview"
          style={{ "--transaction-drag-x": `${dragPreview.x}px`, "--transaction-drag-y": `${dragPreview.y}px` }}
          aria-hidden="true"
        >
          <span className="transaction-watchlist-group-label">
            <FolderClosed size={15} strokeWidth={2.2} />
            <span>{dragPreview.name}</span>
          </span>
        </div>
      ) : null}
    </section>
  );
}
