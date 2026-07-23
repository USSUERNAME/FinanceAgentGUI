import { useCallback, useEffect, useState } from "react";
import { fetchTransactionSettings, patchTransactionSettings } from "./transactionSettingsApi.js";

export function useTransactionDisplaySettingsController({
  defaultSettings,
  normalizeSettingsPayload,
  normalizeMoneyUnit,
  normalizeMainTableColumns,
  normalizeValueMode,
  normalizeChartMode,
  normalizeChartInterval,
  normalizeBoolean,
}) {
  const [valueMode, setValueMode] = useState("value");
  const [sidebarUnit, setSidebarUnit] = useState(() => normalizeMoneyUnit("KRW"));
  const [mainUnit, setMainUnit] = useState(() => normalizeMoneyUnit("KRW"));
  const [currencySettings, setCurrencySettings] = useState(defaultSettings);
  const [currencySettingsError, setCurrencySettingsError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadSettings() {
      try {
        const payload = await fetchTransactionSettings(undefined, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const nextSettings = normalizeSettingsPayload(payload);
        setCurrencySettings(nextSettings);
        setValueMode(nextSettings.sidebarValueMode);
        setCurrencySettingsError("");
      } catch (error) {
        if (error.name !== "AbortError") {
          setCurrencySettingsError(error.message || "거래현황 통화 설정을 불러오지 못했습니다.");
        }
      }
    }
    void loadSettings();
    return () => controller.abort();
  }, [normalizeSettingsPayload]);

  const saveSettings = useCallback(async (patch) => {
    try {
      const payload = await patchTransactionSettings(patch || {});
      const nextSettings = normalizeSettingsPayload(payload);
      setCurrencySettings(nextSettings);
      setValueMode(nextSettings.sidebarValueMode);
      setCurrencySettingsError("");
      return nextSettings;
    } catch (error) {
      setCurrencySettingsError(error.message || "거래현황 설정을 저장하지 못했습니다.");
      return null;
    }
  }, [normalizeSettingsPayload]);

  const handleSidebarUnitChange = useCallback((nextUnit) => {
    const normalizedUnit = normalizeMoneyUnit(nextUnit);
    setSidebarUnit(normalizedUnit);
    setCurrencySettings((current) => ({ ...current, sidebarDisplayCurrency: normalizedUnit }));
    void saveSettings({ sidebarDisplayCurrency: normalizedUnit });
  }, [normalizeMoneyUnit, saveSettings]);

  const handleMainUnitChange = useCallback((nextUnit) => {
    const normalizedUnit = normalizeMoneyUnit(nextUnit);
    setMainUnit(normalizedUnit);
    setCurrencySettings((current) => ({ ...current, mainDisplayCurrency: normalizedUnit }));
    void saveSettings({ mainDisplayCurrency: normalizedUnit });
  }, [normalizeMoneyUnit, saveSettings]);

  const handleMainTableColumnsChange = useCallback((nextColumnIds) => {
    const normalizedColumnIds = normalizeMainTableColumns(nextColumnIds, []);
    setCurrencySettings((current) => ({ ...current, mainTableColumns: normalizedColumnIds }));
    void saveSettings({ mainTableColumns: normalizedColumnIds });
  }, [normalizeMainTableColumns, saveSettings]);

  const handleValueModeChange = useCallback((nextMode) => {
    const normalizedMode = normalizeValueMode(nextMode);
    setValueMode(normalizedMode);
    setCurrencySettings((current) => ({ ...current, sidebarValueMode: normalizedMode }));
    void saveSettings({ sidebarValueMode: normalizedMode });
  }, [normalizeValueMode, saveSettings]);

  const handleInvestmentChartModeChange = useCallback((nextMode) => {
    const normalizedMode = normalizeChartMode(nextMode);
    setCurrencySettings((current) => ({ ...current, investmentChartMode: normalizedMode }));
    void saveSettings({ investmentChartMode: normalizedMode });
  }, [normalizeChartMode, saveSettings]);

  const handleInvestmentChartIntervalChange = useCallback((nextInterval) => {
    const normalizedInterval = normalizeChartInterval(nextInterval);
    setCurrencySettings((current) => ({ ...current, investmentChartIntervalMode: normalizedInterval }));
    void saveSettings({ investmentChartIntervalMode: normalizedInterval });
  }, [normalizeChartInterval, saveSettings]);

  const handleInvestmentChartVolumeVisibleChange = useCallback((nextVisible) => {
    const normalizedVisible = normalizeBoolean(nextVisible, defaultSettings.investmentChartVolumeVisible);
    setCurrencySettings((current) => ({ ...current, investmentChartVolumeVisible: normalizedVisible }));
    void saveSettings({ investmentChartVolumeVisible: normalizedVisible });
  }, [defaultSettings.investmentChartVolumeVisible, normalizeBoolean, saveSettings]);

  return {
    valueMode,
    sidebarUnit, setSidebarUnit,
    mainUnit, setMainUnit,
    currencySettings, setCurrencySettings,
    currencySettingsError,
    saveTransactionCurrencySettings: saveSettings,
    handleSidebarUnitChange,
    handleMainUnitChange,
    handleMainTableColumnsChange,
    handleValueModeChange,
    handleInvestmentChartModeChange,
    handleInvestmentChartIntervalChange,
    handleInvestmentChartVolumeVisibleChange,
  };
}
