import { useRef, useState } from "react";

export function useTransactionSimulatorState({ normalizeMoneyUnit }) {
  const [simulatorAccounts, setSimulatorAccounts] = useState([]);
  const [selectedSimulatorId, setSelectedSimulatorId] = useState("");
  const [simulatorStoreReady, setSimulatorStoreReady] = useState(false);
  const [simulatorLoading, setSimulatorLoading] = useState(false);
  const [simulatorError, setSimulatorError] = useState("");
  const [simulatorDeleteTarget, setSimulatorDeleteTarget] = useState(null);
  const [simulatorDeletingId, setSimulatorDeletingId] = useState("");
  const [simulatorRenameTarget, setSimulatorRenameTarget] = useState(null);
  const [simulatorRenameDraft, setSimulatorRenameDraft] = useState("");
  const [simulatorRenameBusy, setSimulatorRenameBusy] = useState(false);
  const [simulatorRenameError, setSimulatorRenameError] = useState("");
  const [simulatorSymbolSearchOpen, setSimulatorSymbolSearchOpen] = useState(false);
  const [simulatorSymbolSearchDraft, setSimulatorSymbolSearchDraft] = useState("");
  const [simulatorSymbolSearchSelection, setSimulatorSymbolSearchSelection] = useState(null);
  const [simulatorSymbolSearchOptions, setSimulatorSymbolSearchOptions] = useState([]);
  const [simulatorSymbolSearchError, setSimulatorSymbolSearchError] = useState("");
  const [simulatorBuyOpen, setSimulatorBuyOpen] = useState(false);
  const [simulatorBuySymbolDraft, setSimulatorBuySymbolDraft] = useState("");
  const [simulatorBuySelectedSymbol, setSimulatorBuySelectedSymbol] = useState(null);
  const [simulatorBuyRemoteSymbolOptions, setSimulatorBuyRemoteSymbolOptions] = useState([]);
  const [simulatorBuyAmountDraft, setSimulatorBuyAmountDraft] = useState("");
  const [simulatorBuyUnit, setSimulatorBuyUnit] = useState(() => normalizeMoneyUnit("KRW"));
  const [simulatorBuyError, setSimulatorBuyError] = useState("");
  const [simulatorBuyBusy, setSimulatorBuyBusy] = useState(false);
  const [simulatorBuyMarketCalendar, setSimulatorBuyMarketCalendar] = useState(null);
  const [simulatorBuyMarketCalendarLoading, setSimulatorBuyMarketCalendarLoading] = useState(false);
  const [simulatorBuyMarketCalendarError, setSimulatorBuyMarketCalendarError] = useState("");
  const [simulatorSellOpen, setSimulatorSellOpen] = useState(false);
  const [simulatorSellPosition, setSimulatorSellPosition] = useState(null);
  const [simulatorSellAmountDraft, setSimulatorSellAmountDraft] = useState("");
  const [simulatorSellUnit, setSimulatorSellUnit] = useState(() => normalizeMoneyUnit("KRW"));
  const [simulatorSellError, setSimulatorSellError] = useState("");
  const [simulatorSellBusy, setSimulatorSellBusy] = useState(false);
  const [simulatorSellMarketCalendar, setSimulatorSellMarketCalendar] = useState(null);
  const [simulatorSellMarketCalendarLoading, setSimulatorSellMarketCalendarLoading] = useState(false);
  const [simulatorSellMarketCalendarError, setSimulatorSellMarketCalendarError] = useState("");
  const [simulatorOrderNotifications, setSimulatorOrderNotifications] = useState([]);
  const [simulatorExchangeOpen, setSimulatorExchangeOpen] = useState(false);
  const [simulatorExchangeMode, setSimulatorExchangeMode] = useState("KRW_TO_USD");
  const [simulatorExchangeAmountDraft, setSimulatorExchangeAmountDraft] = useState("");
  const [simulatorExchangeError, setSimulatorExchangeError] = useState("");
  const [simulatorExchangeBusy, setSimulatorExchangeBusy] = useState(false);
  const simulatorOrderNotificationTimersRef = useRef(new Map());
  const simulatorBuyIdempotencyKeyRef = useRef("");
  const simulatorSellIdempotencyKeyRef = useRef("");

  return {
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
  };
}
