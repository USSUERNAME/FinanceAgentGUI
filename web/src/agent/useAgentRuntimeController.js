import { useEffect, useMemo, useState } from "react";

import antigravityLogo from "../assets/antigravity-logo.png";
import codexLogo from "../assets/codex-logo-transparent.png";
import {
  ANTIGRAVITY_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  agentProviderIds,
} from "./agentProviderIds.js";
import { fetchAgentOptions, patchAgentSettings } from "./agentApi.js";
import {
  antigravityModelGroups,
  antigravityPolicyOptions,
  emptyAgentSettings,
  fallbackApprovalOptions,
  fallbackModelGroups,
  fallbackProviderOptions,
  getSpeedOptionsForReasoning,
  loadingApprovalOptions,
  loadingModelGroups,
  modelGroupsFromAntigravityCatalog,
  personaModeOptions,
} from "./agentOptions.js";
import {
  ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
  selectAntigravityModelForReasoning,
} from "./antigravityModelSelection.js";
import { selectCodexTranslationModel } from "./codexTranslationModelSelection.js";

export { ANTIGRAVITY_PROVIDER_ID, CODEX_PROVIDER_ID, agentProviderIds } from "./agentProviderIds.js";

function normalizeAgentModelProvider(value) {
  return value === CODEX_PROVIDER_ID || value === ANTIGRAVITY_PROVIDER_ID ? value : "default";
}

export function useAgentRuntimeController() {
  const [agentProvider, setAgentProvider] = useState(CODEX_PROVIDER_ID);
  const [providerOptions, setProviderOptions] = useState(fallbackProviderOptions);
  const [approvalOptions, setApprovalOptions] = useState(fallbackApprovalOptions);
  const [modelGroups, setModelGroups] = useState(fallbackModelGroups);
  const [antigravityCatalogGroups, setAntigravityCatalogGroups] = useState(antigravityModelGroups);
  const [agentUserSettings, setAgentUserSettings] = useState(emptyAgentSettings);
  const [agentSettingsError, setAgentSettingsError] = useState("");
  const [agentOptionsReady, setAgentOptionsReady] = useState(false);
  const [modelCatalogRefreshing, setModelCatalogRefreshing] = useState(false);
  const [personaMode, setPersonaMode] = useState("none");
  const [codexStatus, setCodexStatus] = useState({
    available: false,
    label: "Codex CLI 확인 중",
    commandPreview: "",
    version: "",
  });
  const [antigravityCliVersion, setAntigravityCliVersion] = useState("");
  const [approval, setApproval] = useState(fallbackApprovalOptions[0].id);
  const [model, setModel] = useState(fallbackModelGroups[0].slug);
  const [reasoning, setReasoning] = useState(fallbackModelGroups[0].defaultReasoningLevel);
  const [speed, setSpeed] = useState("standard");

  const activeModelGroups = agentProvider === ANTIGRAVITY_PROVIDER_ID ? antigravityCatalogGroups : modelGroups;
  const activeApprovalOptions = agentProvider === ANTIGRAVITY_PROVIDER_ID ? antigravityPolicyOptions : approvalOptions;
  const selectedModelGroup = useMemo(
    () => activeModelGroups.find((item) => item.slug === model) ?? activeModelGroups[0] ?? fallbackModelGroups[0],
    [activeModelGroups, model],
  );
  const reasoningOptions = selectedModelGroup?.reasoningLevels?.length
    ? selectedModelGroup.reasoningLevels
    : fallbackModelGroups[0].reasoningLevels;
  const selectedReasoning = useMemo(
    () =>
      reasoningOptions.find((item) => item.id === reasoning) ??
      reasoningOptions.find((item) => item.id === selectedModelGroup?.defaultReasoningLevel) ??
      reasoningOptions[0],
    [reasoning, reasoningOptions, selectedModelGroup],
  );
  const speedOptions = useMemo(
    () => getSpeedOptionsForReasoning(selectedModelGroup, selectedReasoning?.id || reasoning),
    [reasoning, selectedModelGroup, selectedReasoning],
  );
  const selectedSpeed = useMemo(
    () => speedOptions.find((item) => item.id === speed) ?? speedOptions[0],
    [speed, speedOptions],
  );
  const selectedApproval = useMemo(
    () => activeApprovalOptions.find((item) => item.id === approval) ?? activeApprovalOptions[0],
    [activeApprovalOptions, approval],
  );
  const selectedProvider = useMemo(
    () => providerOptions.find((item) => item.id === agentProvider) ?? providerOptions[0] ?? fallbackProviderOptions[0],
    [agentProvider, providerOptions],
  );
  const agentProviderLabel = agentOptionsReady ? selectedProvider?.label || "Codex CLI" : "에이전트";
  const agentIcon = agentOptionsReady && agentProvider === ANTIGRAVITY_PROVIDER_ID ? antigravityLogo : codexLogo;
  const modelSummaryLabel = selectedModelGroup?.reasoningEmbedded
    ? selectedModelGroup?.label || "모델"
    : `${selectedModelGroup?.label || "모델"} ${selectedReasoning?.label || ""}`.trim();
  const toolbarApprovalOptions = agentOptionsReady ? activeApprovalOptions : loadingApprovalOptions;
  const toolbarModelGroups = agentOptionsReady ? activeModelGroups : loadingModelGroups;
  const toolbarApprovalValue = agentOptionsReady ? selectedApproval?.id || approval : "loading";
  const toolbarModelValue = agentOptionsReady ? selectedModelGroup?.slug || model : "loading";
  const toolbarReasoningValue = agentOptionsReady ? selectedReasoning?.id || reasoning : "loading";
  const toolbarSpeedValue = agentOptionsReady ? speed : "loading";
  const newsFeedTranslationModelLabel = useMemo(() => {
    if (!agentOptionsReady) return "";
    if (agentProvider === ANTIGRAVITY_PROVIDER_ID) {
      const translationModel = selectAntigravityModelForReasoning(antigravityCatalogGroups, {
        cliVersion: antigravityCliVersion,
        currentModel: selectedModelGroup?.slug || model || ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
      });
      return `Antigravity CLI · ${translationModel}`;
    }

    const translation = selectCodexTranslationModel({
      cliVersion: codexStatus.version,
      models: modelGroups,
    });
    return `${translation.model} · ${translation.reasoning}`;
  }, [agentOptionsReady, agentProvider, antigravityCatalogGroups, antigravityCliVersion, codexStatus.version, model, modelGroups, selectedModelGroup]);

  function modelGroupsForProvider(
    providerId,
    groups = modelGroups,
    nextAntigravityGroups = antigravityCatalogGroups,
  ) {
    return providerId === ANTIGRAVITY_PROVIDER_ID
      ? nextAntigravityGroups.length
        ? nextAntigravityGroups
        : antigravityModelGroups
      : groups.length
        ? groups
        : fallbackModelGroups;
  }

  function selectionForProvider(
    providerId,
    preferred = {},
    groups = modelGroups,
    nextAntigravityGroups = antigravityCatalogGroups,
    approvals = approvalOptions,
  ) {
    const nextGroups = modelGroupsForProvider(providerId, groups, nextAntigravityGroups);
    const nextApprovalOptions = providerId === ANTIGRAVITY_PROVIDER_ID
      ? antigravityPolicyOptions
      : approvals.length
        ? approvals
        : fallbackApprovalOptions;
    const nextApproval = nextApprovalOptions.some((item) => item.id === preferred.approval)
      ? preferred.approval
      : nextApprovalOptions[0]?.id || fallbackApprovalOptions[0].id;
    const nextGroup = nextGroups.find((item) => item.slug === preferred.model) ?? nextGroups[0] ?? fallbackModelGroups[0];
    const nextReasoningLevels = nextGroup.reasoningLevels?.length
      ? nextGroup.reasoningLevels
      : fallbackModelGroups[0].reasoningLevels;
    const nextReasoning = nextReasoningLevels.some((item) => item.id === preferred.reasoning)
      ? preferred.reasoning
      : nextGroup.defaultReasoningLevel || nextReasoningLevels[0]?.id || "medium";
    const nextSpeedOptions = getSpeedOptionsForReasoning(nextGroup, nextReasoning);
    const nextSpeed = nextSpeedOptions.some((item) => item.id === preferred.speed)
      ? preferred.speed
      : "standard";

    return {
      provider: providerId,
      approval: nextApproval,
      model: nextGroup.slug,
      reasoning: nextReasoning,
      speed: nextSpeed,
    };
  }

  function agentProviderSettings(providerId, settings = agentUserSettings) {
    return settings?.providers?.[providerId] || {};
  }

  function isAgentProviderEnabled(providerId, settings = agentUserSettings) {
    const providerSettings = agentProviderSettings(providerId, settings);
    if (typeof providerSettings.enabled === "boolean") return providerSettings.enabled;
    return providerId === settings?.selectedProvider;
  }

  function enabledAgentProviders(settings = agentUserSettings) {
    return agentProviderIds.filter((providerId) => isAgentProviderEnabled(providerId, settings));
  }

  function applyAgentSelection(selection) {
    setApproval(selection.approval);
    setModel(selection.model);
    setReasoning(selection.reasoning);
    setSpeed(selection.speed);
  }

  async function saveAgentSettingsPatch(patch) {
    setAgentSettingsError("");
    try {
      const payload = await patchAgentSettings(patch);
      setAgentUserSettings(payload.settings || emptyAgentSettings);
      return payload.settings || emptyAgentSettings;
    } catch (error) {
      setAgentSettingsError(error.message);
      return null;
    }
  }

  async function saveAgentSettings(selection) {
    return saveAgentSettingsPatch({
      selectedProvider: selection.provider,
      providers: {
        [selection.provider]: {
          enabled: true,
          approval: selection.approval,
          model: selection.model,
          reasoning: selection.reasoning,
          speed: selection.speed,
        },
      },
    });
  }

  async function savePersonaMode(nextPersonaMode) {
    setAgentSettingsError("");
    try {
      const payload = await patchAgentSettings({ personaMode: nextPersonaMode });
      setAgentUserSettings(payload.settings || emptyAgentSettings);
      return payload.settings || emptyAgentSettings;
    } catch (error) {
      setAgentSettingsError(error.message);
      return null;
    }
  }

  function updatePersonaMode(nextPersonaMode) {
    const safePersonaMode = personaModeOptions.some((option) => option.id === nextPersonaMode)
      ? nextPersonaMode
      : "none";
    setPersonaMode(safePersonaMode);
    void savePersonaMode(safePersonaMode);
  }

  function handleAgentProviderChange(nextProvider) {
    setAgentProvider(nextProvider);
    const savedProviderSettings = agentProviderSettings(nextProvider);
    const nextSelection = selectionForProvider(nextProvider, savedProviderSettings);
    applyAgentSelection(nextSelection);
    void saveAgentSettings(nextSelection).then((settings) => {
      if (settings && nextProvider === ANTIGRAVITY_PROVIDER_ID) {
        void refreshAgentOptions();
      }
    });
  }

  function updateAgentSelection(patch) {
    const nextSelection = selectionForProvider(agentProvider, {
      approval: selectedApproval?.id || approval,
      model: selectedModelGroup?.slug || model,
      reasoning: selectedReasoning?.id || reasoning,
      speed: selectedSpeed?.id || speed,
      ...patch,
    });
    applyAgentSelection(nextSelection);
    void saveAgentSettings(nextSelection);
  }

  function updateProviderSelection(providerId, patch) {
    const currentProviderSettings = agentProviderSettings(providerId);
    const nextSelection = selectionForProvider(providerId, {
      ...currentProviderSettings,
      ...patch,
    });
    const providerPatch = {
      enabled: isAgentProviderEnabled(providerId),
      approval: nextSelection.approval,
      model: nextSelection.model,
      reasoning: nextSelection.reasoning,
      speed: nextSelection.speed,
    };

    setAgentUserSettings((current) => ({
      ...current,
      providers: {
        ...(current.providers || {}),
        [providerId]: {
          ...(current.providers?.[providerId] || {}),
          ...providerPatch,
        },
      },
    }));

    if (providerId === agentProvider) {
      applyAgentSelection(nextSelection);
    }

    void saveAgentSettingsPatch({
      providers: {
        [providerId]: providerPatch,
      },
    });
  }

  function updateProviderEnabled(providerId, enabled) {
    const currentEnabledProviders = enabledAgentProviders();
    if (!enabled && currentEnabledProviders.length <= 1 && currentEnabledProviders.includes(providerId)) {
      return;
    }

    const currentProviderSettings = agentProviderSettings(providerId);
    const providerSelection = selectionForProvider(providerId, currentProviderSettings);
    const nextSelectedProvider =
      !enabled && agentProvider === providerId
        ? currentEnabledProviders.find((id) => id !== providerId) || agentProvider
        : agentProvider;
    const nextSelectedSettings = agentProviderSettings(nextSelectedProvider);
    const nextSelection = selectionForProvider(nextSelectedProvider, nextSelectedSettings);
    const providerPatch = {
      enabled,
      approval: providerSelection.approval,
      model: providerSelection.model,
      reasoning: providerSelection.reasoning,
      speed: providerSelection.speed,
    };

    setAgentUserSettings((current) => ({
      ...current,
      selectedProvider: nextSelectedProvider,
      providers: {
        ...(current.providers || {}),
        [providerId]: {
          ...(current.providers?.[providerId] || {}),
          ...providerPatch,
        },
      },
    }));
    if (nextSelectedProvider !== agentProvider) {
      setAgentProvider(nextSelectedProvider);
      applyAgentSelection(nextSelection);
    }

    void saveAgentSettingsPatch({
      selectedProvider: nextSelectedProvider,
      providers: {
        [providerId]: providerPatch,
      },
    }).then((settings) => {
      if (settings && providerId === ANTIGRAVITY_PROVIDER_ID) {
        void refreshAgentOptions();
      }
    });
  }

  function configuredProviderId(setting) {
    const normalized = normalizeAgentModelProvider(setting);
    return normalized === "default" ? agentProvider : normalized;
  }

  function commandPreviewForRuntime(runtime) {
    if (!agentOptionsReady) {
      return "에이전트 설정 불러오는 중";
    }
    if (runtime.provider === ANTIGRAVITY_PROVIDER_ID) {
      return runtime.selectedProvider?.available
        ? `agy --model "${runtime.selectedModelGroup?.slug || "Gemini 3.5 Flash (Medium)"}" · ${runtime.selectedApproval?.label || "Default"}`
        : runtime.selectedProvider?.installCommand || "curl -fsSL https://antigravity.google/cli/install.sh | bash";
    }
    const approvalFlag = runtime.selectedApproval?.cli || "";
    const modelFlag = runtime.selectedModelGroup?.slug ? `-m ${runtime.selectedModelGroup.slug}` : "";
    const reasoningFlag = runtime.selectedReasoning?.cli || "";
    const speedFlag = runtime.selectedSpeed?.cli || "";
    return ["codex", approvalFlag, modelFlag, reasoningFlag, speedFlag].filter(Boolean).join(" ");
  }

  function providerRuntimeForProvider(providerId, overrides = {}) {
    const runtimeProvider = providerId === ANTIGRAVITY_PROVIDER_ID ? ANTIGRAVITY_PROVIDER_ID : CODEX_PROVIDER_ID;
    const providerStatus =
      providerOptions.find((item) => item.id === runtimeProvider) ||
      fallbackProviderOptions.find((item) => item.id === runtimeProvider) ||
      { id: runtimeProvider, label: runtimeProvider };
    const providerModelGroups = modelGroupsForProvider(runtimeProvider);
    const providerApprovalOptions =
      runtimeProvider === ANTIGRAVITY_PROVIDER_ID
        ? antigravityPolicyOptions
        : approvalOptions.length
          ? approvalOptions
          : fallbackApprovalOptions;
    const baseSelection =
      runtimeProvider === agentProvider
        ? {
            provider: runtimeProvider,
            approval: selectedApproval?.id || approval,
            model: selectedModelGroup?.slug || model,
            reasoning: selectedReasoning?.id || reasoning,
            speed: selectedSpeed?.id || speed,
          }
        : selectionForProvider(runtimeProvider, agentProviderSettings(runtimeProvider));
    const providerSelection = selectionForProvider(runtimeProvider, {
      ...baseSelection,
      ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => String(value || "").trim())),
    });
    const providerModelGroup =
      providerModelGroups.find((item) => item.slug === providerSelection.model) ||
      providerModelGroups[0] ||
      fallbackModelGroups[0];
    const providerReasoningOptions = providerModelGroup?.reasoningLevels?.length
      ? providerModelGroup.reasoningLevels
      : fallbackModelGroups[0].reasoningLevels;
    const providerSpeedOptions = getSpeedOptionsForReasoning(providerModelGroup, providerSelection.reasoning);
    const runtime = {
      provider: runtimeProvider,
      selectedProvider: providerStatus,
      providerLabel: agentOptionsReady
        ? providerStatus?.label || (runtimeProvider === ANTIGRAVITY_PROVIDER_ID ? "Antigravity CLI" : "Codex CLI")
        : "에이전트",
      providerAvailable: agentOptionsReady && Boolean(providerStatus?.available),
      icon: agentOptionsReady && runtimeProvider === ANTIGRAVITY_PROVIDER_ID ? antigravityLogo : codexLogo,
      approvalOptions: providerApprovalOptions,
      selectedApproval:
        providerApprovalOptions.find((item) => item.id === providerSelection.approval) || providerApprovalOptions[0],
      modelGroups: providerModelGroups,
      selectedModelGroup: providerModelGroup,
      reasoningOptions: providerReasoningOptions,
      selectedReasoning:
        providerReasoningOptions.find((item) => item.id === providerSelection.reasoning) || providerReasoningOptions[0],
      speedOptions: providerSpeedOptions,
      selectedSpeed: providerSpeedOptions.find((item) => item.id === providerSelection.speed) || providerSpeedOptions[0],
    };
    return {
      ...runtime,
      modelSummaryLabel: runtime.selectedModelGroup?.reasoningEmbedded
        ? runtime.selectedModelGroup?.label || "모델"
        : `${runtime.selectedModelGroup?.label || "모델"} ${runtime.selectedReasoning?.label || ""}`.trim(),
      commandPreview: commandPreviewForRuntime(runtime),
    };
  }

  async function refreshAgentOptions({ isCancelled = () => false, force = false } = {}) {
    try {
      const payload = await fetchAgentOptions({ force });
      if (isCancelled()) return;

      const nextProviderOptions = payload.providers?.length ? payload.providers : fallbackProviderOptions;
      const nextApprovalOptions = payload.approvalOptions?.length
        ? payload.approvalOptions
        : fallbackApprovalOptions;
      const nextModelGroups = payload.modelGroups?.length ? payload.modelGroups : fallbackModelGroups;
      const nextAntigravityModelGroups = modelGroupsFromAntigravityCatalog(payload.antigravityModelCatalog);
      const nextAgentSettings = payload.agentSettings?.settings || emptyAgentSettings;
      const selectedProviderFromSettings = payload.selected?.provider || nextAgentSettings.selectedProvider;
      const nextProvider = nextProviderOptions.some((item) => item.id === selectedProviderFromSettings)
        ? selectedProviderFromSettings
        : nextProviderOptions.some((item) => item.id === payload.selected?.provider)
          ? payload.selected.provider
          : CODEX_PROVIDER_ID;
      const nextSelection = selectionForProvider(
        nextProvider,
        payload.selected || nextAgentSettings.providers?.[nextProvider] || {},
        nextModelGroups,
        nextAntigravityModelGroups,
        nextApprovalOptions,
      );

      setProviderOptions(nextProviderOptions);
      setAgentProvider(nextProvider);
      setApprovalOptions(nextApprovalOptions);
      setModelGroups(nextModelGroups);
      setAntigravityCatalogGroups(nextAntigravityModelGroups);
      setAntigravityCliVersion(payload.antigravity?.version || "");
      setAgentUserSettings(nextAgentSettings);
      setPersonaMode(nextAgentSettings.personaMode || "none");
      applyAgentSelection(nextSelection);
      setAgentOptionsReady(true);
      setCodexStatus({
        available: Boolean(payload.codex?.available),
        label: payload.codex?.available
          ? "Codex CLI 연결됨"
          : payload.codex?.error || "Codex CLI 연결 실패",
        commandPreview: "",
        version: payload.codex?.version || "",
      });
    } catch (error) {
      if (isCancelled()) return;
      setAntigravityCliVersion("");
      setCodexStatus({
        available: false,
        label: `Codex CLI probe 실패: ${error.message}`,
        commandPreview: "",
        version: "",
      });
      setAgentOptionsReady(true);
    }
  }

  async function reloadAgentModelCatalog() {
    if (modelCatalogRefreshing) return;
    setModelCatalogRefreshing(true);
    try {
      await refreshAgentOptions({ force: true });
    } finally {
      setModelCatalogRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void refreshAgentOptions({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!reasoningOptions.some((item) => item.id === reasoning)) {
      setReasoning(selectedModelGroup.defaultReasoningLevel || reasoningOptions[0]?.id || "medium");
    }
    if (speedOptions.length && !speedOptions.some((item) => item.id === speed)) {
      setSpeed("standard");
    }
    if (!speedOptions.length && speed !== "standard") {
      setSpeed("standard");
    }
  }, [reasoning, reasoningOptions, selectedModelGroup, speed, speedOptions]);

  const enabledAgentProviderIds = enabledAgentProviders();
  const agentProviderProfiles = agentProviderIds.map((providerId) => {
    const runtime = providerRuntimeForProvider(providerId);
    const providerSelection = {
      approval: runtime.selectedApproval?.id || "",
      model: runtime.selectedModelGroup?.slug || "",
      reasoning: runtime.selectedReasoning?.id || "",
      speed: runtime.selectedSpeed?.id || "standard",
    };
    return {
      id: providerId,
      label: runtime.selectedProvider?.label || (providerId === ANTIGRAVITY_PROVIDER_ID ? "Antigravity CLI" : "Codex CLI"),
      enabled: isAgentProviderEnabled(providerId),
      toggleDisabled: isAgentProviderEnabled(providerId) && enabledAgentProviderIds.length <= 1,
      status: runtime.selectedProvider,
      approvalOptions: runtime.approvalOptions,
      approval: providerSelection.approval,
      modelGroups: runtime.modelGroups,
      model: providerSelection.model,
      reasoningOptions: runtime.reasoningOptions,
      reasoning: providerSelection.reasoning,
      speedOptions: runtime.speedOptions,
      speed: providerSelection.speed,
    };
  });

  return {
    agentProvider,
    providerOptions,
    approvalOptions,
    modelGroups,
    antigravityCatalogGroups,
    agentUserSettings,
    agentSettingsError,
    agentOptionsReady,
    modelCatalogRefreshing,
    personaMode,
    personaModeOptions,
    codexStatus,
    approval,
    model,
    reasoning,
    speed,
    activeModelGroups,
    activeApprovalOptions,
    selectedModelGroup,
    reasoningOptions,
    selectedReasoning,
    speedOptions,
    selectedSpeed,
    selectedApproval,
    selectedProvider,
    agentProviderLabel,
    agentIcon,
    modelSummaryLabel,
    toolbarApprovalOptions,
    toolbarModelGroups,
    toolbarApprovalValue,
    toolbarModelValue,
    toolbarReasoningValue,
    toolbarSpeedValue,
    newsFeedTranslationModelLabel,
    loadingApprovalOptions,
    loadingModelGroups,
    agentProviderProfiles,
    configuredProviderId,
    enabledAgentProviders,
    handleAgentProviderChange,
    updateAgentSelection,
    updatePersonaMode,
    updateProviderSelection,
    updateProviderEnabled,
    providerRuntimeForProvider,
    reloadAgentModelCatalog,
  };
}
