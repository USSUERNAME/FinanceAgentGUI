import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTransactionSettings, patchTransactionSettings } from "./transactionSettingsApi.js";

export const defaultTransactionSettings = {
  ok: true,
  configPath: "config/transaction-status.user.json",
  defaultConfigPath: "config/transaction-status.defaults.json",
  settings: {
    version: 2,
    menuHidden: false,
  },
};

function normalizedTransactionSettings(payload) {
  return {
    ...defaultTransactionSettings,
    ...payload,
    settings: {
      ...defaultTransactionSettings.settings,
      ...(payload?.settings || {}),
    },
  };
}

export function useTransactionSettingsController({ activeView }) {
  const [transactionSettings, setTransactionSettings] = useState(defaultTransactionSettings);
  const [transactionSettingsBusy, setTransactionSettingsBusy] = useState(false);
  const [transactionSettingsSaving, setTransactionSettingsSaving] = useState(false);
  const [transactionSettingsError, setTransactionSettingsError] = useState("");
  const savingRef = useRef(false);

  const loadTransactionSettings = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) {
      setTransactionSettingsBusy(true);
      setTransactionSettingsError("");
    }
    try {
      const nextSettings = normalizedTransactionSettings(await fetchTransactionSettings());
      setTransactionSettings(nextSettings);
      return nextSettings;
    } catch (error) {
      setTransactionSettingsError(error.message);
      return null;
    } finally {
      if (!quiet) setTransactionSettingsBusy(false);
    }
  }, []);

  const saveTransactionStatusHidden = useCallback(async (menuHidden) => {
    if (savingRef.current) return null;
    savingRef.current = true;
    setTransactionSettingsSaving(true);
    setTransactionSettingsError("");
    try {
      const nextSettings = normalizedTransactionSettings(
        await patchTransactionSettings({ menuHidden })
      );
      setTransactionSettings(nextSettings);
      return nextSettings;
    } catch (error) {
      setTransactionSettingsError(error.message);
      return null;
    } finally {
      savingRef.current = false;
      setTransactionSettingsSaving(false);
    }
  }, []);

  useEffect(() => {
    void loadTransactionSettings({ quiet: true });
  }, [loadTransactionSettings]);

  useEffect(() => {
    if (activeView === "settings") void loadTransactionSettings();
  }, [activeView, loadTransactionSettings]);

  return {
    transactionSettings,
    transactionSettingsBusy,
    transactionSettingsSaving,
    transactionSettingsError,
    loadTransactionSettings,
    saveTransactionStatusHidden,
  };
}
