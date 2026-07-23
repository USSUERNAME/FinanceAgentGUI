import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMagazineCatalog,
  fetchMagazineSettings,
  fetchMagazineStatus,
  markMagazineOpened,
  patchMagazineSettings,
  requestMagazineGenerateOne,
  requestMagazineRunNow,
} from "./magazineApi.js";

const MAGAZINE_STATUS_POLL_INTERVAL_MS = 30_000;
const MAGAZINE_GENERATE_ONE_TOOL_STORAGE_KEY = "finance-agent-gui:magazine-generate-one-tool";

export const defaultMagazineSettings = {
  ok: true,
  enabled: false,
  worldMemoryEnabled: false,
  writingProvider: "default",
  writingModel: "",
  writingReasoning: "",
  writingSpeed: "standard",
  schedulerIntervalHours: 6,
  schedulerMaxArticlesPerCycle: 2,
  disabledReason: "",
  configPath: "config/magazine.user.json",
  defaultConfigPath: "config/magazine.defaults.json",
  settings: {
    version: 1,
    enabled: false,
    writingProvider: "default",
    writingModel: "",
    writingReasoning: "",
    writingSpeed: "standard",
    schedulerIntervalHours: 6,
    schedulerMaxArticlesPerCycle: 2,
  },
};

function normalizedMagazineSettings(payload) {
  return {
    ...defaultMagazineSettings,
    ...payload,
    settings: {
      ...defaultMagazineSettings.settings,
      ...(payload?.settings || {}),
    },
  };
}

function normalizeProvider(value) {
  return value === "codex-cli" || value === "antigravity-cli" ? value : "default";
}

function writingSettingsPatch(patch) {
  const source = patch && typeof patch === "object" ? patch : {};
  return {
    ...(Object.prototype.hasOwnProperty.call(source, "writingProvider")
      ? { writingProvider: normalizeProvider(source.writingProvider) }
      : {}),
    ...(String(source.writingModel || "").trim()
      ? { writingModel: String(source.writingModel).trim() }
      : {}),
    ...(String(source.writingReasoning || "").trim()
      ? { writingReasoning: String(source.writingReasoning).trim() }
      : {}),
    ...(String(source.writingSpeed || "").trim()
      ? { writingSpeed: String(source.writingSpeed).trim() }
      : {}),
  };
}

function schedulerIsActive(status) {
  const cycle = status?.scheduler?.cycle;
  return Boolean(cycle?.active || cycle?.status === "running" || cycle?.status === "starting");
}

function readGenerateOneToolVisible() {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search || "");
    const paramValue = params.get("magazineGenerateOne");
    if (paramValue === "1" || paramValue === "true") {
      window.localStorage.setItem(MAGAZINE_GENERATE_ONE_TOOL_STORAGE_KEY, "1");
      return true;
    }
    if (paramValue === "0" || paramValue === "false") {
      window.localStorage.removeItem(MAGAZINE_GENERATE_ONE_TOOL_STORAGE_KEY);
      return false;
    }
    return window.localStorage.getItem(MAGAZINE_GENERATE_ONE_TOOL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useMagazineController({ activeView }) {
  const [magazineCatalog, setMagazineCatalog] = useState(null);
  const [magazineStatus, setMagazineStatus] = useState(null);
  const [magazineSettings, setMagazineSettings] = useState(defaultMagazineSettings);
  const [magazineSettingsBusy, setMagazineSettingsBusy] = useState(false);
  const [magazineSettingsSaving, setMagazineSettingsSaving] = useState(false);
  const [magazineSettingsError, setMagazineSettingsError] = useState("");
  const [magazineStartNowBusy, setMagazineStartNowBusy] = useState(false);
  const [magazineGenerateOneBusy, setMagazineGenerateOneBusy] = useState(false);
  const [magazineGenerateOneToolVisible] = useState(readGenerateOneToolVisible);

  const activeViewRef = useRef(activeView);
  const settingsSavingRef = useRef(false);
  const startNowBusyRef = useRef(false);
  const generateOneBusyRef = useRef(false);
  const magazineStatusRef = useRef(magazineStatus);
  const articleCountRef = useRef(0);
  const latestArticleAtRef = useRef("");

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    magazineStatusRef.current = magazineStatus;
    articleCountRef.current = Number(magazineStatus?.articleCount || magazineCatalog?.articles?.length || 0);
    latestArticleAtRef.current = magazineStatus?.readState?.latestArticleAt || "";
  }, [magazineCatalog?.articles?.length, magazineStatus]);

  const applyMagazineCatalogPayload = useCallback((payload) => {
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];
    setMagazineCatalog({
      articles,
      coverStories: Array.isArray(payload?.coverStories) ? payload.coverStories : [],
      topicCatalog: Array.isArray(payload?.topicCatalog) ? payload.topicCatalog : [],
    });
    setMagazineStatus((current) => ({
      ...(current || {}),
      ok: payload?.ok !== false,
      storage: payload?.storage || current?.storage || "files",
      articleCount: articles.length,
      readState: payload?.readState || current?.readState || null,
      settings: payload?.settings || current?.settings || null,
      scheduler: payload?.scheduler || current?.scheduler || null,
    }));
    if (payload?.settings) {
      setMagazineSettings(normalizedMagazineSettings(payload.settings));
    }
  }, []);

  const refreshMagazineCatalog = useCallback(async ({ signal } = {}) => {
    const payload = await fetchMagazineCatalog({ signal });
    applyMagazineCatalogPayload(payload);
    return payload;
  }, [applyMagazineCatalogPayload]);

  const refreshMagazineStatus = useCallback(async ({ signal } = {}) => {
    const payload = await fetchMagazineStatus({ signal });
    magazineStatusRef.current = payload;
    setMagazineStatus(payload);
    if (payload?.settings) {
      setMagazineSettings(normalizedMagazineSettings(payload.settings));
    }
    return payload;
  }, []);

  const loadMagazineSettings = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) {
      setMagazineSettingsBusy(true);
      setMagazineSettingsError("");
    }
    try {
      const nextSettings = normalizedMagazineSettings(await fetchMagazineSettings());
      setMagazineSettings(nextSettings);
      setMagazineStatus((current) => ({
        ...(current || {}),
        settings: nextSettings,
        scheduler: current?.scheduler
          ? {
              ...current.scheduler,
              enabled: Boolean(nextSettings.enabled),
              settings: nextSettings,
              nextRunAt: nextSettings.enabled ? current.scheduler.nextRunAt : "",
            }
          : current?.scheduler,
      }));
      return nextSettings;
    } catch (error) {
      setMagazineSettingsError(error.message);
      return null;
    } finally {
      if (!quiet) setMagazineSettingsBusy(false);
    }
  }, []);

  const saveSettingsPatch = useCallback(async (patch, { refreshStatus = false } = {}) => {
    if (settingsSavingRef.current) return null;
    settingsSavingRef.current = true;
    setMagazineSettingsSaving(true);
    setMagazineSettingsError("");
    try {
      const nextSettings = normalizedMagazineSettings(await patchMagazineSettings(patch));
      setMagazineSettings(nextSettings);
      if (refreshStatus) {
        await refreshMagazineStatus();
      } else {
        setMagazineStatus((current) => ({
          ...(current || {}),
          settings: nextSettings,
          scheduler: current?.scheduler
            ? { ...current.scheduler, settings: nextSettings }
            : current?.scheduler,
        }));
      }
      return nextSettings;
    } catch (error) {
      setMagazineSettingsError(error.message);
      return null;
    } finally {
      settingsSavingRef.current = false;
      setMagazineSettingsSaving(false);
    }
  }, [refreshMagazineStatus]);

  const updateMagazineEnabled = useCallback(
    (enabled) => saveSettingsPatch({ enabled }, { refreshStatus: true }),
    [saveSettingsPatch]
  );

  const updateMagazineWritingSettings = useCallback((patch = {}) => {
    const body = writingSettingsPatch(patch);
    return Object.keys(body).length ? saveSettingsPatch(body) : Promise.resolve(null);
  }, [saveSettingsPatch]);

  const updateMagazineSchedulerInterval = useCallback((schedulerIntervalHours) => {
    const safeIntervalHours = Math.max(1, Math.min(10, Math.round(Number(schedulerIntervalHours || 6))));
    return saveSettingsPatch(
      { schedulerIntervalHours: safeIntervalHours },
      { refreshStatus: true }
    );
  }, [saveSettingsPatch]);

  const updateMagazineMaxArticlesPerCycle = useCallback((schedulerMaxArticlesPerCycle) => {
    const safeMaxArticles = Math.max(1, Math.min(3, Math.round(Number(schedulerMaxArticlesPerCycle || 2))));
    return saveSettingsPatch(
      { schedulerMaxArticlesPerCycle: safeMaxArticles },
      { refreshStatus: true }
    );
  }, [saveSettingsPatch]);

  const startMagazineNow = useCallback(async () => {
    if (startNowBusyRef.current || schedulerIsActive(magazineStatusRef.current)) return null;
    startNowBusyRef.current = true;
    setMagazineStartNowBusy(true);
    try {
      const payload = await requestMagazineRunNow();
      magazineStatusRef.current = payload;
      setMagazineStatus(payload);
      if (payload?.settings) setMagazineSettings(normalizedMagazineSettings(payload.settings));
      return payload;
    } catch (error) {
      setMagazineStatus((current) => ({ ...(current || {}), ok: false, error: error.message }));
      void refreshMagazineStatus().catch(() => {});
      return null;
    } finally {
      startNowBusyRef.current = false;
      setMagazineStartNowBusy(false);
    }
  }, [refreshMagazineStatus]);

  const generateOneMagazineArticle = useCallback(async () => {
    if (
      generateOneBusyRef.current ||
      startNowBusyRef.current ||
      schedulerIsActive(magazineStatusRef.current)
    ) return null;
    generateOneBusyRef.current = true;
    setMagazineGenerateOneBusy(true);
    try {
      const payload = await requestMagazineGenerateOne();
      applyMagazineCatalogPayload(payload);
      void refreshMagazineStatus().catch(() => {});
      return payload;
    } catch (error) {
      setMagazineStatus((current) => ({ ...(current || {}), ok: false, error: error.message }));
      void refreshMagazineStatus().catch(() => {});
      return null;
    } finally {
      generateOneBusyRef.current = false;
      setMagazineGenerateOneBusy(false);
    }
  }, [applyMagazineCatalogPayload, refreshMagazineStatus]);

  const disableMagazineForWorldMemory = useCallback(() => {
    setMagazineSettings((current) => ({
      ...(current || defaultMagazineSettings),
      ok: true,
      enabled: false,
      worldMemoryEnabled: false,
      disabledReason: "world-memory-disabled",
      settings: {
        ...((current || defaultMagazineSettings).settings || {}),
        enabled: false,
        disabledReason: "world-memory-disabled",
      },
    }));
    setMagazineStatus((current) => ({
      ...(current || {}),
      settings: {
        ...(current?.settings || defaultMagazineSettings),
        enabled: false,
        worldMemoryEnabled: false,
        disabledReason: "world-memory-disabled",
      },
      scheduler: current?.scheduler
        ? { ...current.scheduler, enabled: false, nextRunAt: "" }
        : current?.scheduler,
    }));
    setMagazineSettingsError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function pollMagazineStatus() {
      try {
        const payload = await fetchMagazineStatus();
        if (cancelled) return;
        magazineStatusRef.current = payload;
        setMagazineStatus(payload);
        if (payload?.settings) setMagazineSettings(normalizedMagazineSettings(payload.settings));
        const nextArticleCount = Number(payload.articleCount || 0);
        const nextLatestArticleAt = payload.readState?.latestArticleAt || "";
        const catalogChanged =
          nextArticleCount !== articleCountRef.current ||
          nextLatestArticleAt !== latestArticleAtRef.current;
        if (catalogChanged && activeViewRef.current === "magazine") {
          await refreshMagazineCatalog();
        }
      } catch (error) {
        if (!cancelled) {
          setMagazineStatus((current) => ({ ...(current || {}), ok: false, error: error.message }));
        }
      }
    }

    void pollMagazineStatus();
    const timer = window.setInterval(pollMagazineStatus, MAGAZINE_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshMagazineCatalog]);

  useEffect(() => {
    if (activeView !== "magazine") return undefined;
    let cancelled = false;
    async function openMagazine() {
      try {
        const payload = await markMagazineOpened();
        if (!cancelled) setMagazineStatus(payload);
      } catch {
        // Opening the view remains usable with the last known read state.
      }
      if (cancelled) return;
      try {
        await refreshMagazineCatalog();
      } catch (error) {
        if (error.name !== "AbortError") console.warn("Magazine catalog refresh failed", error);
      }
    }
    void openMagazine();
    return () => {
      cancelled = true;
    };
  }, [activeView, refreshMagazineCatalog]);

  useEffect(() => {
    if (activeView === "settings") void loadMagazineSettings({ quiet: true });
  }, [activeView, loadMagazineSettings]);

  return {
    magazineCatalog,
    magazineStatus,
    magazineSettings,
    magazineSettingsBusy,
    magazineSettingsSaving,
    magazineSettingsError,
    magazineStartNowBusy,
    magazineGenerateOneBusy,
    magazineGenerateOneToolVisible,
    applyMagazineCatalogPayload,
    refreshMagazineCatalog,
    refreshMagazineStatus,
    loadMagazineSettings,
    updateMagazineEnabled,
    updateMagazineWritingSettings,
    updateMagazineSchedulerInterval,
    updateMagazineMaxArticlesPerCycle,
    startMagazineNow,
    generateOneMagazineArticle,
    disableMagazineForWorldMemory,
  };
}
