import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchWorldMemorySettings,
  fetchWorldMemoryStatus,
  patchWorldMemorySettings,
  requestWorldMemoryAction,
} from "./worldMemoryApi.js";

export const defaultWorldMemorySettings = {
  ok: true,
  enabled: false,
  autopilotEnabled: false,
  managementProvider: "default",
  managementModel: "",
  managementReasoning: "",
  managementSpeed: "standard",
  configPath: "config/world-memory.user.json",
  defaultConfigPath: "config/world-memory.defaults.json",
  settings: {
    version: 1,
    enabled: false,
    autopilotEnabled: false,
    managementProvider: "default",
    managementModel: "",
    managementReasoning: "",
    managementSpeed: "standard",
  },
};

function normalizedWorldMemorySettings(payload) {
  return {
    ...defaultWorldMemorySettings,
    ...payload,
    settings: {
      ...defaultWorldMemorySettings.settings,
      ...(payload?.settings || {}),
    },
  };
}

function normalizeManagementProvider(value) {
  return value === "codex-cli" || value === "antigravity-cli" ? value : "default";
}

function managementSettingsPatch(patch) {
  const source = patch && typeof patch === "object" ? patch : {};
  return {
    ...(Object.prototype.hasOwnProperty.call(source, "managementProvider")
      ? { managementProvider: normalizeManagementProvider(source.managementProvider) }
      : {}),
    ...(String(source.managementModel || "").trim()
      ? { managementModel: String(source.managementModel).trim() }
      : {}),
    ...(String(source.managementReasoning || "").trim()
      ? { managementReasoning: String(source.managementReasoning).trim() }
      : {}),
    ...(String(source.managementSpeed || "").trim()
      ? { managementSpeed: String(source.managementSpeed).trim() }
      : {}),
  };
}

function disabledWorldMemoryStatus(current, settings) {
  return {
    ...(current || {}),
    ok: true,
    enabled: false,
    settings: settings.settings,
    configPath: settings.configPath,
    defaultConfigPath: settings.defaultConfigPath,
    collector: {
      ...(current?.collector || {}),
      status: "disabled",
      schedulerStarted: false,
      inFlight: false,
    },
  };
}

export function useWorldMemoryController({ activeView }) {
  const [worldMemorySettings, setWorldMemorySettings] = useState(defaultWorldMemorySettings);
  const [worldMemorySettingsBusy, setWorldMemorySettingsBusy] = useState(false);
  const [worldMemorySettingsSaving, setWorldMemorySettingsSaving] = useState(false);
  const [worldMemorySettingsError, setWorldMemorySettingsError] = useState("");
  const [worldMemoryStatus, setWorldMemoryStatus] = useState(null);
  const [worldMemoryBusy, setWorldMemoryBusy] = useState(false);
  const [worldMemoryError, setWorldMemoryError] = useState("");
  const [worldMemoryActionBusy, setWorldMemoryActionBusy] = useState(false);
  const [worldMemoryRunningAction, setWorldMemoryRunningAction] = useState("");
  const [worldMemoryRunningAgentActionId, setWorldMemoryRunningAgentActionId] = useState("");
  const [worldMemoryActionResult, setWorldMemoryActionResult] = useState(null);
  const [worldMemoryTechOpen, setWorldMemoryTechOpen] = useState(false);

  const settingsRef = useRef(worldMemorySettings);
  const settingsSavingRef = useRef(false);
  const actionBusyRef = useRef(false);

  useEffect(() => {
    settingsRef.current = worldMemorySettings;
  }, [worldMemorySettings]);

  const loadWorldMemoryStatus = useCallback(async ({ summary = false } = {}) => {
    setWorldMemoryBusy(true);
    setWorldMemoryError("");
    try {
      const payload = await fetchWorldMemoryStatus({ summary });
      setWorldMemoryStatus(payload);
      if (!payload.ok && payload.dependencies?.issues?.length) {
        const firstError = payload.dependencies.issues.find((issue) => issue.status === "error");
        setWorldMemoryError(firstError?.message || "");
      }
      return payload;
    } catch (error) {
      setWorldMemoryError(error.message);
      return null;
    } finally {
      setWorldMemoryBusy(false);
    }
  }, []);

  const loadWorldMemorySettings = useCallback(async ({ quiet = false, refreshStatus = false } = {}) => {
    if (!quiet) {
      setWorldMemorySettingsBusy(true);
      setWorldMemorySettingsError("");
    }
    try {
      const nextSettings = normalizedWorldMemorySettings(await fetchWorldMemorySettings());
      settingsRef.current = nextSettings;
      setWorldMemorySettings(nextSettings);
      if (refreshStatus && nextSettings.enabled) {
        await loadWorldMemoryStatus();
      } else if (!nextSettings.enabled) {
        setWorldMemoryStatus((current) => disabledWorldMemoryStatus(current, nextSettings));
        setWorldMemoryError("");
      }
      return nextSettings;
    } catch (error) {
      setWorldMemorySettingsError(error.message);
      return null;
    } finally {
      if (!quiet) setWorldMemorySettingsBusy(false);
    }
  }, [loadWorldMemoryStatus]);

  const saveWorldMemoryEnabled = useCallback(async (enabled) => {
    if (settingsSavingRef.current) return null;
    settingsSavingRef.current = true;
    setWorldMemorySettingsSaving(true);
    setWorldMemorySettingsError("");
    try {
      const nextSettings = normalizedWorldMemorySettings(
        await patchWorldMemorySettings({ enabled })
      );
      settingsRef.current = nextSettings;
      setWorldMemorySettings(nextSettings);
      if (nextSettings.enabled) {
        await loadWorldMemoryStatus();
      } else {
        setWorldMemoryStatus((current) => disabledWorldMemoryStatus(current, nextSettings));
        setWorldMemoryError("");
      }
      return nextSettings;
    } catch (error) {
      setWorldMemorySettingsError(error.message);
      return null;
    } finally {
      settingsSavingRef.current = false;
      setWorldMemorySettingsSaving(false);
    }
  }, [loadWorldMemoryStatus]);

  const updateWorldMemoryManagementSettings = useCallback(async (patch = {}) => {
    if (settingsSavingRef.current) return null;
    const body = managementSettingsPatch(patch);
    if (!Object.keys(body).length) return null;
    settingsSavingRef.current = true;
    setWorldMemorySettingsSaving(true);
    setWorldMemorySettingsError("");
    try {
      const nextSettings = normalizedWorldMemorySettings(await patchWorldMemorySettings(body));
      settingsRef.current = nextSettings;
      setWorldMemorySettings(nextSettings);
      setWorldMemoryStatus((current) =>
        current
          ? {
              ...current,
              settings: nextSettings.settings || current.settings,
            }
          : current
      );
      return nextSettings;
    } catch (error) {
      setWorldMemorySettingsError(error.message);
      return null;
    } finally {
      settingsSavingRef.current = false;
      setWorldMemorySettingsSaving(false);
    }
  }, []);

  const updateWorldMemoryAutopilotEnabled = useCallback(async (autopilotEnabled) => {
    if (settingsSavingRef.current) return null;
    settingsSavingRef.current = true;
    setWorldMemorySettingsSaving(true);
    setWorldMemorySettingsError("");
    try {
      const nextSettings = normalizedWorldMemorySettings(
        await patchWorldMemorySettings({ autopilotEnabled })
      );
      settingsRef.current = nextSettings;
      setWorldMemorySettings(nextSettings);
      await loadWorldMemoryStatus({ summary: true });
      return nextSettings;
    } catch (error) {
      setWorldMemorySettingsError(error.message);
      return null;
    } finally {
      settingsSavingRef.current = false;
      setWorldMemorySettingsSaving(false);
    }
  }, [loadWorldMemoryStatus]);

  const runWorldMemoryAction = useCallback(async (action, options = {}) => {
    if (actionBusyRef.current) return undefined;
    const { uiAgentActionId = "", ...requestOptions } = options;
    actionBusyRef.current = true;
    setWorldMemoryActionBusy(true);
    setWorldMemoryRunningAction(action);
    setWorldMemoryRunningAgentActionId(uiAgentActionId);
    setWorldMemoryError("");
    try {
      const { payload, responseOk } = await requestWorldMemoryAction(action, requestOptions);
      setWorldMemoryActionResult(payload);
      if (!responseOk || !payload.ok) {
        setWorldMemoryError(payload.error || "World Memory action failed");
      }
      await loadWorldMemoryStatus();
      return payload;
    } catch (error) {
      setWorldMemoryError(error.message);
      return { ok: false, error: error.message };
    } finally {
      actionBusyRef.current = false;
      setWorldMemoryActionBusy(false);
      setWorldMemoryRunningAction("");
      setWorldMemoryRunningAgentActionId("");
    }
  }, [loadWorldMemoryStatus]);

  useEffect(() => {
    void Promise.all([
      loadWorldMemorySettings({ quiet: true }),
      loadWorldMemoryStatus({ summary: true }),
    ]);
  }, [loadWorldMemorySettings, loadWorldMemoryStatus]);

  useEffect(() => {
    if (activeView === "settings") {
      void loadWorldMemorySettings({ refreshStatus: true });
    }
  }, [activeView, loadWorldMemorySettings]);

  useEffect(() => {
    if (activeView === "world-memory" && settingsRef.current.enabled) {
      void loadWorldMemoryStatus();
    }
  }, [activeView, loadWorldMemoryStatus, worldMemorySettings.enabled]);

  return {
    worldMemorySettings,
    worldMemorySettingsBusy,
    worldMemorySettingsSaving,
    worldMemorySettingsError,
    worldMemoryStatus,
    worldMemoryBusy,
    worldMemoryError,
    worldMemoryActionBusy,
    worldMemoryRunningAction,
    worldMemoryRunningAgentActionId,
    worldMemoryActionResult,
    worldMemoryTechOpen,
    loadWorldMemorySettings,
    loadWorldMemoryStatus,
    saveWorldMemoryEnabled,
    updateWorldMemoryManagementSettings,
    updateWorldMemoryAutopilotEnabled,
    runWorldMemoryAction,
    toggleWorldMemoryTech: () => setWorldMemoryTechOpen((open) => !open),
  };
}
