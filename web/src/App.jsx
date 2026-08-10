import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import X from "lucide-react/dist/esm/icons/x.js";
import { AgentSidebar } from "./agent/AgentSidebar.jsx";
import { requestAgentChatStream } from "./agent/agentApi.js";
import { attachmentsSummary } from "./agent/attachments.js";
import { messageToHistoryText } from "./agent/chatProtocol.js";
import { consumeAgentChatStream } from "./agent/chatStreamRunner.js";
import {
  chatScopeKey,
  memorySummaryFromExchange,
  memoryTagsForExchange,
  memoryTitleFromPrompt,
  normalizeWorldMemoryActionProposal,
  parseWorldMemoryJsonAction,
  personaEligibleScreens,
  stripWorldMemoryActionBlocks,
  systemMainChatScope,
  trimForMemory,
  worldMemoryActionsNeedingReportRefresh,
  worldMemoryChatScope,
} from "./agent/chatSessionModel.js";
import {
  ANTIGRAVITY_PROVIDER_ID,
  useAgentRuntimeController,
} from "./agent/useAgentRuntimeController.js";
import { useChatComposerController } from "./agent/useChatComposerController.js";
import { buildPromptWithArticleContext } from "./arca/articleContext.js";
import { buildBoardIndexContextSnapshot } from "./arca/boardContextSnapshot.js";
import { arcaNotificationHealthState } from "./arca/notificationStatus.js";
import { useArcaController } from "./arca/useArcaController.js";
import { buildEarningAnalysisPrompt, displayEarningValue } from "./calendars/earningPrompt.js";
import { useMagazineController } from "./magazine/useMagazineController.js";
import { useMagazineReaderController } from "./magazine/useMagazineReaderController.js";
import {
  buildMagazineArticleAgentContext,
  buildStockArticleAgentContext,
  magazineArticleList,
  magazineFallbackCoverStories,
  magazineHeadlineStory,
  normalizeMagazineComment,
  normalizeMagazineCommentStore,
  normalizeMagazineReaderArticle,
  normalizeMagazineTopicCatalog,
  writeMagazineArticleToClipboard,
} from "./magazine/magazineWorkspaceModel.js";
import { useSharedMemoryController } from "./memory/useSharedMemoryController.js";
import { useNewsFeedController } from "./news/useNewsFeedController.js";
import {
  parsePortfolioWidgetJsonAction,
  stripPortfolioWidgetActionBlocks,
} from "./portfolio/actionParser.js";
import {
  isPortfolioWidgetReferenceToken,
  parsePortfolioWidgetNumber,
} from "./portfolio/datasetParser.js";
import {
  selectPortfolioWidgetRequestAttachments,
} from "./portfolio/widgetRequestAttachments.js";
import {
  cleanPortfolioWidgetText as cleanPortfolioWidgetPrompt,
} from "./portfolio/widgetIdentity.js";
import {
  PortfolioCanvasDeleteDialog,
} from "./portfolio/PortfolioCanvasDeleteDialog.jsx";
import {
  PORTFOLIO_CANVAS_MODES,
  portfolioCanvasModeMeta,
} from "./portfolio/canvasModes.jsx";
import { portfolioSchemaTables } from "./portfolio/workspaceReferenceContent.js";
import {
  normalizePortfolioWidgetReferenceList,
} from "./portfolio/widgetRelations.js";
import { usePortfolioCanvasController } from "./portfolio/usePortfolioCanvasController.js";
import { parseReportArtifactAction, stripReportArtifactBlocks } from "./reports/reportArtifactAction.js";
import { loadReportMarketProxyContext } from "./reports/reportMarketProxyContext.js";
import { postReportAction } from "./reports/reportsApi.js";
import { useNotificationController } from "./reports/useNotificationController.js";
import { AppNavigation } from "./shell/AppNavigation.jsx";
import { AppRoutes, RouteLoading } from "./shell/AppRoutes.jsx";
import { collectVisibleScreenSnapshot } from "./shell/screenSnapshot.js";
import { hashForView, viewFromHash } from "./shell/viewHash.js";
import { buildWorldMemoryAskRequest } from "./worldMemory/askRequest.js";
import { buildWorldMemoryPageContextSnapshot } from "./worldMemory/contextSnapshot.js";
import { worldMemoryHealthState } from "./worldMemory/statusHelpers.js";
import { useWorldMemoryController } from "./worldMemory/useWorldMemoryController.js";
import { useTossInvestController } from "./transactions/useTossInvestController.js";
import { useTransactionSettingsController } from "./transactions/useTransactionSettingsController.js";

const TossInvestConnectionSection = React.lazy(() =>
  import("./settings/SettingsView.jsx").then((module) => ({ default: module.TossInvestConnectionSection }))
);

const BROWSER_NOTIFICATION_LAST_SHOWN_KEY = "finance-agent-gui:last-browser-notification-id";

function browserNotificationPermissionState() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission || "default";
}

function readLastBrowserNotificationId() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(BROWSER_NOTIFICATION_LAST_SHOWN_KEY) || "";
  } catch {
    return "";
  }
}

function writeLastBrowserNotificationId(id) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BROWSER_NOTIFICATION_LAST_SHOWN_KEY, String(id || ""));
  } catch {
    // Ignore storage failures; duplicate prevention is best-effort.
  }
}

const NEWS_FEED_POLL_INTERVAL_OPTIONS = Array.from({ length: 10 }, (_, index) => {
  const minutes = index + 1;
  return {
    minutes,
    seconds: minutes * 60,
    label: `${minutes}분`,
  };
});

function App() {
  const [activeView, setActiveView] = useState(() =>
    typeof window === "undefined" ? "stock" : viewFromHash(window.location.hash, "stock")
  );
  const newsFeedController = useNewsFeedController({ activeView });
  const {
    newsFeedStatus,
    newsFeedItems,
    newsFeedBusy,
    newsFeedRefreshBusy,
    newsFeedDailyDigestBusy,
    newsFeedLoadingMore,
    newsFeedHasMore,
    newsFeedError,
    newsFeedSettings,
    newsFeedSettingsBusy,
    newsFeedSettingsSavingId,
    newsFeedSettingsError,
    loadNewsFeedSettings,
    refreshNewsFeedStatus,
    toggleNewsFeedSource,
    updateNewsFeedPollInterval,
    refreshNewsFeed,
    generateDailyDigest,
    updateNewsFeedMarketSummaryCollapsed,
    handleNewsFeedScroll,
  } = newsFeedController;
  const worldMemoryController = useWorldMemoryController({ activeView });
  const {
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
    toggleWorldMemoryTech,
  } = worldMemoryController;
  const magazineController = useMagazineController({ activeView });
  const {
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
    loadMagazineSettings,
    updateMagazineEnabled,
    updateMagazineWritingSettings,
    updateMagazineSchedulerInterval,
    updateMagazineMaxArticlesPerCycle,
    startMagazineNow,
    generateOneMagazineArticle,
    disableMagazineForWorldMemory,
  } = magazineController;
  const arcaController = useArcaController({ activeView });
  const {
    boardFilters,
    boardSearchInput,
    setBoardSearchInput,
    arcaBoard,
    arcaBoardBusy,
    arcaBoardError,
    arcaReaderArticle,
    arcaReaderBusy,
    arcaReaderError,
    arcaAuthStatus,
    arcaAuthBusy,
    arcaAuthAction,
    arcaAuthError,
    arcaNotificationStatus,
    arcaNotificationBusy,
    arcaNotificationActionBusy,
    arcaNotificationActionError,
    showHiddenNotices,
    arcaCanvasRef,
    loadArcaNotifications,
    markAllArcaNotificationsRead,
    loadArcaAuthStatus,
    startArcaLoginHandoff,
    captureArcaLoginSession,
    stopArcaLoginHandoff,
    deleteArcaLoginSession,
    updateBoardFilters,
    selectBoardCategory,
    refreshBoard,
    resetBoard,
    submitBoardSearch,
    openArcaArticleReader,
    retryArcaArticleReader,
    closeArcaArticleReader,
    openArcaNotificationArticle,
    toggleHiddenNotices,
  } = arcaController;
  const transactionSettingsController = useTransactionSettingsController({ activeView });
  const {
    transactionSettings,
    transactionSettingsBusy,
    transactionSettingsSaving,
    transactionSettingsError,
    loadTransactionSettings,
    saveTransactionStatusHidden,
  } = transactionSettingsController;
  const sharedMemoryController = useSharedMemoryController({ activeView });
  const {
    memoryStatus,
    memoryBusy,
    memoryError,
    memoryRecentOpen,
    memoryDialogOpen,
    memoryDialogRecords,
    memoryDialogBusy,
    memoryDialogError,
    memoryDialogHasMore,
    memoryDialogTotalCount,
    deletingMemoryRecordId,
    loadSharedMemoryStatus,
    toggleMemoryRecent,
    openMemoryDialog,
    closeMemoryDialog,
    handleMemoryDialogScroll,
    deleteMemoryRecord,
    saveSharedMemoryRecord,
  } = sharedMemoryController;
  const notificationController = useNotificationController();
  const {
    notificationStatus,
    markDailyIntelligenceNotificationsOpened,
    markReportsNotificationsOpened,
  } = notificationController;
  const agentRuntimeController = useAgentRuntimeController();
  const {
    agentProvider,
    providerOptions,
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
    handleAgentProviderChange,
    updateAgentSelection,
    updatePersonaMode,
    updateProviderSelection,
    updateProviderEnabled,
    providerRuntimeForProvider,
    reloadAgentModelCatalog,
  } = agentRuntimeController;
  const notificationStatusRef = useRef(null);
  const browserNotificationLastShownRef = useRef(readLastBrowserNotificationId());
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() =>
    browserNotificationPermissionState()
  );
  const [worldMemoryAgentAction, setWorldMemoryAgentAction] = useState(null);
  const [worldMemoryFocusedChangeSuggestion, setWorldMemoryFocusedChangeSuggestion] = useState(null);
  const [reportRefreshSignal, setReportRefreshSignal] = useState(0);
  const [earningCalendarContext, setEarningCalendarContext] = useState(null);
  const [economicCalendarContext, setEconomicCalendarContext] = useState(null);
  const [portfolioContext, setPortfolioContext] = useState(null);
  const portfolioCanvasController = usePortfolioCanvasController({
    setActiveView,
    setPortfolioContext,
    defaultMode: PORTFOLIO_CANVAS_MODES.asset.id,
  });
  const {
    portfolioCanvases,
    activePortfolioCanvas,
    portfolioSidebarOpen, setPortfolioSidebarOpen,
    portfolioCanvasMenuId, setPortfolioCanvasMenuId,
    editingPortfolioCanvasId,
    portfolioCanvasNameDraft, setPortfolioCanvasNameDraft,
    pendingDeletePortfolioCanvas,
    portfolioCanvasNameInputRef,
    updatePortfolioCanvasChatMessages,
    updateActivePortfolioCanvasWorkspace,
    createPortfolioCanvasFromGuide,
    selectPortfolioCanvas,
    renamePortfolioCanvasTo,
    startPortfolioCanvasRename,
    savePortfolioCanvasNameDraft,
    handlePortfolioCanvasNameKeyDown,
    duplicatePortfolioCanvas,
    requestDeletePortfolioCanvas,
    cancelDeletePortfolioCanvas,
    confirmDeletePortfolioCanvas,
  } = portfolioCanvasController;
  const [portfolioWidgetAgentAction, setPortfolioWidgetAgentAction] = useState(null);
  const [queuedPortfolioWidgetRequest, setQueuedPortfolioWidgetRequest] = useState(null);
  const activeViewRef = useRef(activeView);
  const transactionStatusContextRef = useRef(null);
  const handleTransactionStatusContextChange = useCallback((contextPacket) => {
    transactionStatusContextRef.current = contextPacket && typeof contextPacket === "object"
      ? contextPacket
      : null;
  }, []);
  const magazineArticles = useMemo(() => {
    const catalogArticles = Array.isArray(magazineCatalog?.articles) ? magazineCatalog.articles : [];
    return catalogArticles.length ? catalogArticles : magazineArticleList;
  }, [magazineCatalog]);
  const magazineTopicCatalog = useMemo(
    () => normalizeMagazineTopicCatalog(magazineCatalog?.topicCatalog),
    [magazineCatalog],
  );
  const magazineReaderController = useMagazineReaderController({
    activeView,
    topicCatalog: magazineTopicCatalog,
    applyCatalogPayload: applyMagazineCatalogPayload,
    getWritingRuntime: magazineWritingRuntime,
    normalizeArticle: normalizeMagazineReaderArticle,
    normalizeComment: normalizeMagazineComment,
    normalizeCommentStore: normalizeMagazineCommentStore,
    writeArticleToClipboard: writeMagazineArticleToClipboard,
  });
  const {
    magazineActiveArticle,
    magazineActiveTopic,
    magazinePreferenceSavingId,
    magazinePreferenceNotice,
    magazinePreferenceNoticeFading,
    magazineCommentDraft,
    setMagazineCommentDraft,
    magazineCommentSubmitting,
    magazineCommentError,
    magazineDeleteDialogOpen,
    magazineDeleting,
    magazineDeleteError,
    magazineCopyStatus,
    magazineCopyError,
    selectedMagazinePreferenceIds,
    magazineComments,
    magazineCanvasRef,
    magazineTopicModalRef,
    magazineReaderArticleRef,
    openMagazineTopic,
    closeMagazineTopic,
    openMagazineArticle,
    closeMagazineArticle,
    openMagazineDeleteDialog,
    closeMagazineDeleteDialog,
    copyMagazineArticle,
    confirmMagazineArticleDelete,
    saveMagazinePreference,
    submitMagazineComment,
  } = magazineReaderController;
  const magazineActiveTopicEntry = magazineTopicCatalog.find((topic) => topic.label === magazineActiveTopic) || null;
  const magazineTopicArticles = useMemo(() => {
    if (!magazineActiveTopic) return [];
    return magazineArticles.filter((article) => magazineArticleTopics(article).includes(magazineActiveTopic));
  }, [magazineActiveTopic, magazineArticles]);
  const magazineCoverStories = useMemo(() => {
    const catalogCoverStories = Array.isArray(magazineCatalog?.coverStories) ? magazineCatalog.coverStories : [];
    if (catalogCoverStories.length) return catalogCoverStories;
    const catalogArticles = Array.isArray(magazineCatalog?.articles) ? magazineCatalog.articles : [];
    return catalogArticles.length ? catalogArticles.slice(0, 5) : magazineFallbackCoverStories;
  }, [magazineCatalog]);
  const magazineCoverHeadline = magazineCoverStories[0] ?? magazineArticles[0] ?? magazineHeadlineStory;
  const magazineCoverCards = magazineCoverStories.slice(1, 5);
  const worldMemoryEnabled = Boolean(worldMemorySettings?.enabled);
  const magazineEnabled = worldMemoryEnabled && Boolean(magazineSettings?.enabled);
  const transactionStatusHidden = Boolean(transactionSettings?.settings?.menuHidden);
  const arcaNotificationHealth = arcaNotificationHealthState(arcaNotificationStatus);
  const worldMemoryHealth = worldMemoryHealthState(worldMemoryStatus, {
    busy: worldMemoryBusy || worldMemoryActionBusy,
    enabled: worldMemoryEnabled,
    error: worldMemoryError || worldMemorySettingsError,
  });
  const assetPortfolioActive =
    activeView === "portfolio-canvas" &&
    Boolean(activePortfolioCanvas) &&
    portfolioCanvasModeMeta(activePortfolioCanvas.mode).id === PORTFOLIO_CANVAS_MODES.asset.id;
  const tossInvestController = useTossInvestController({ activeView, assetPortfolioActive });
  const {
    tossInvestStatus,
    tossInvestBusy,
    tossInvestAction,
    tossInvestError,
    tossInvestErrorCode,
    tossInvestPublicIp,
    tossInvestPublicIpBusy,
    tossInvestPublicIpError,
    tossInvestDialogOpen,
    tossInvestOrderSyncStatus,
    tossInvestOrderSyncBusy,
    tossInvestOrderSyncAction,
    tossInvestOrderSyncError,
    tossInvestOrderSyncErrorCode,
    loadTossInvestStatus,
    saveAndProbeTossInvestCredentials,
    unlockAndProbeTossInvestVault,
    lockTossInvestVault,
    probeTossInvestConnection,
    checkTossInvestPublicIp,
    deleteTossInvestCredentials,
    loadTossInvestOrderSyncStatus,
    runTossInvestOrderSync,
    updateTossInvestOrderSyncEnabled,
    openTossInvestDialog,
    closeTossInvestDialog,
  } = tossInvestController;
  const isPortfolioCanvasView = activeView === "portfolio-canvas" && Boolean(activePortfolioCanvas);
  const isWorldMemoryChatView = activeView === "world-memory" && worldMemoryEnabled;
  const isChatCanvasView = activeView === "chat";
  const isFullWidthCanvasView = isChatCanvasView;
  const activeChatScope = isPortfolioCanvasView
    ? { type: "portfolio-canvas", canvasId: activePortfolioCanvas.id }
    : isWorldMemoryChatView
      ? worldMemoryChatScope
      : systemMainChatScope;
  const chatComposerController = useChatComposerController({
    activeChatScope,
    activePortfolioCanvas,
    isPortfolioCanvasView,
    isWorldMemoryChatView,
    portfolioCanvases,
    updatePortfolioCanvasChatMessages,
  });
  const {
    chatMessages,
    setChatMessages,
    activeChatAbortRefs,
    promptHeight,
    promptOverflow,
    isComposerDragging,
    attachingArticleHref,
    messageStackRef,
    promptRef,
    fileInputRef,
    visibleChatMessages,
    activePrompt,
    activeChatAttachments,
    activeAttachmentError,
    activeAttachedArticle,
    isSending,
    activePortfolioChatIsSending,
    worldMemoryChatIsSending,
    isChatScopeSending,
    setChatScopeSending,
    promptForScope,
    setPromptForScope,
    attachmentsForScope,
    setAttachmentErrorForScope,
    attachedArticleForScope,
    clearAttachedArticleForScope,
    clearComposerForScope,
    updateChatMessagesForScope,
    chatMessagesForScope,
    startNewChat,
    resolveChatScope,
    attachArticleContext,
    addChatAttachmentFiles,
    removeChatAttachment,
    handleComposerDragEnter,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
    handleComposerPaste,
    stopActiveChatResponse,
  } = chatComposerController;
  const newsFeedMarketSummary = memoryStatus?.contextMemory?.marketSummary || null;
  const newsFeedMarketSummaryCollapsed = newsFeedStatus?.viewState?.marketSummaryCollapsed !== false;
  const activeCategoryLabel = useMemo(() => {
    const selected = arcaBoard?.categories?.find((category) => category.name === boardFilters.category);
    return selected?.label || "전체";
  }, [arcaBoard, boardFilters.category]);

  function worldMemoryManagementProviderId() {
    return configuredProviderId(
      worldMemorySettings?.settings?.managementProvider || worldMemorySettings?.managementProvider
    );
  }

  function magazineWritingProviderId() {
    return configuredProviderId(
      magazineSettings?.settings?.writingProvider || magazineSettings?.writingProvider
    );
  }

  function worldMemoryManagementRuntime() {
    return providerRuntimeForProvider(worldMemoryManagementProviderId(), {
      model: worldMemorySettings?.settings?.managementModel || worldMemorySettings?.managementModel || "",
      reasoning: worldMemorySettings?.settings?.managementReasoning || worldMemorySettings?.managementReasoning || "",
      speed: worldMemorySettings?.settings?.managementSpeed || worldMemorySettings?.managementSpeed || "",
    });
  }

  function magazineWritingRuntime() {
    return providerRuntimeForProvider(magazineWritingProviderId(), {
      model: magazineSettings?.settings?.writingModel || magazineSettings?.writingModel || "",
      reasoning: magazineSettings?.settings?.writingReasoning || magazineSettings?.writingReasoning || "",
      speed: magazineSettings?.settings?.writingSpeed || magazineSettings?.writingSpeed || "",
    });
  }

  function handleSidebarItemClick(item) {
    if (!item.view) return;
    if (item.view === "stock" && activeView === "stock" && arcaReaderArticle) {
      closeArcaArticleReader();
      return;
    }
    if (item.view === "magazine" && activeView === "magazine" && (magazineActiveArticle || magazineActiveTopic)) {
      if (magazineActiveArticle) closeMagazineArticle();
      if (magazineActiveTopic) closeMagazineTopic();
      return;
    }
    if (item.view === "portfolio") {
      if (arcaReaderArticle) closeArcaArticleReader();
      setActiveView("portfolio");
      setPortfolioContext(null);
      setPortfolioSidebarOpen((open) => !open);
      setPortfolioCanvasMenuId("");
      return;
    }
    if (item.view === "stock") {
      refreshBoard();
    }
    if (arcaReaderArticle) closeArcaArticleReader();
    if (item.view === "reports") {
      void markReportsNotificationsOpened();
    }
    if (item.view === "daily-intelligence") {
      void markDailyIntelligenceNotificationsOpened();
    }
    setActiveView(item.view);
  }

  function openBrowserNotificationTarget(targetView = "reports", notification = null) {
    if (notification && typeof notification.close === "function") {
      notification.close();
    }
    try {
      window.focus();
    } catch {
      // Focus can fail in restricted browser contexts; still navigate the app state.
    }
    setActiveView(targetView);
    if (targetView === "daily-intelligence") {
      void markDailyIntelligenceNotificationsOpened();
    } else {
      setReportRefreshSignal((value) => value + 1);
      void markReportsNotificationsOpened();
    }
  }

  function showBrowserNotificationForStatus(status = notificationStatusRef.current) {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setBrowserNotificationPermission("unsupported");
      return false;
    }
    setBrowserNotificationPermission(window.Notification.permission || "default");
    const urgentUpdate = [
      status?.reportsUrgentUpdate,
      status?.dailyIntelligenceCriticalUpdate,
    ]
      .filter((item) => item?.showBadge)
      .sort((first, second) =>
        new Date(second.createdAt || 0).getTime() - new Date(first.createdAt || 0).getTime())[0]
      || {};
    const notificationId = urgentUpdate.id || status?.latest?.id || "";
    if (!urgentUpdate.showBadge || !notificationId) return false;
    if (browserNotificationLastShownRef.current === notificationId) return false;
    if (window.Notification.permission !== "granted") return false;

    const body = urgentUpdate.summary || status?.latest?.summary || "긴급 업데이트가 있습니다.";
    const icon = status?.delivery?.iconPath || "/favicon.svg";
    const targetView = urgentUpdate.clickTarget || "reports";
    const notification = new window.Notification(status?.appName || "주식채널+", {
      body,
      icon,
      badge: icon,
      tag: `finance-agent-gui-${notificationId}`,
      renotify: true,
      data: {
        id: notificationId,
        view: targetView,
      },
    });
    notification.onclick = (event) => {
      event.preventDefault();
      openBrowserNotificationTarget(targetView, notification);
    };
    browserNotificationLastShownRef.current = notificationId;
    writeLastBrowserNotificationId(notificationId);
    return true;
  }

  async function updateTransactionStatusHidden(menuHidden) {
    const nextSettings = await saveTransactionStatusHidden(menuHidden);
    if (nextSettings?.settings?.menuHidden && activeViewRef.current === "transaction-status") {
      setActiveView("stock");
    }
    return nextSettings;
  }

  async function updateWorldMemoryEnabled(enabled) {
    const nextSettings = await saveWorldMemoryEnabled(enabled);
    if (!nextSettings) return;

    setWorldMemoryAgentAction(null);
    setWorldMemoryFocusedChangeSuggestion(null);
    if (nextSettings.enabled) {
      void loadMagazineSettings({ quiet: true });
      return;
    }

    disableMagazineForWorldMemory();
    if (activeViewRef.current === "world-memory") {
      setActiveView("stock");
    }
  }

  async function executeWorldMemoryAgentAction(proposal) {
    if (!proposal?.action || worldMemoryActionBusy) return;
    const options =
      proposal.options && typeof proposal.options === "object"
        ? proposal.options
        : proposal.params && typeof proposal.params === "object"
          ? proposal.params
          : proposal.raw?.params && typeof proposal.raw.params === "object"
          ? proposal.raw.params
          : {};
    const focusedChangeSuggestion =
      proposal.acceptedChangeSuggestion?.section === "memory-change"
        ? proposal.acceptedChangeSuggestion
        : worldMemoryFocusedChangeSuggestion;
    const acceptedChangeSuggestion =
      focusedChangeSuggestion?.section === "memory-change"
        ? {
            ...focusedChangeSuggestion,
            action: proposal.action,
            label: proposal.label || proposal.raw?.label || "",
          }
        : null;
    const result = await runWorldMemoryAction(
      proposal.action,
      acceptedChangeSuggestion
        ? { ...options, acceptedChangeSuggestion, uiAgentActionId: proposal.id || "" }
        : { ...options, uiAgentActionId: proposal.id || "" }
    );
    if (!result?.ok) return;
    if (result?.ok && worldMemoryActionsNeedingReportRefresh.has(proposal.action)) {
      await runWorldMemoryAction("refreshReport", {
        sourceAction: proposal.action,
        reason: "agent-action-applied",
        ...(acceptedChangeSuggestion ? { acceptedChangeSuggestion } : {}),
      });
    }
    setWorldMemoryAgentAction(null);
    setWorldMemoryFocusedChangeSuggestion(null);
  }

  async function saveSharedChatMemory({
    createdAt,
    promptText,
    answerText,
    article,
    attachments = [],
    screen,
    taskType = "chat",
    memoryScope = "system-main",
    canvas = null,
    magazineArticleContext = null,
    stockArticleContext = null,
    provider = agentProvider,
    providerLabel = agentProviderLabel,
  }) {
    const summary = memorySummaryFromExchange(promptText, answerText);
    if (!summary) return;

    await saveSharedMemoryRecord({
          provider,
          providerLabel,
          screen,
          title: memoryTitleFromPrompt(promptText, taskType === "earning-analysis" ? "어닝 이벤트 분석" : "에이전트 채팅"),
          summary,
          tags: memoryTagsForExchange({
            screen,
            provider,
            article,
            attachments,
            taskType,
          }).concat(
            memoryScope === "portfolio-canvas"
              ? ["portfolio-canvas-memory"]
              : memoryScope === "world-memory"
                ? ["world-memory-chat-memory"]
                : ["system-main-memory"],
            canvas?.id ? [`canvas:${canvas.id}`] : []
          ),
          artifacts: attachments.map((attachment) => attachment.name).filter(Boolean),
          messages: [
            {
              role: "user",
              text: promptText,
              createdAt: new Date(createdAt).toISOString(),
            },
            {
              role: "assistant",
              text: answerText,
              createdAt: new Date().toISOString(),
            },
          ],
          contextPacket: {
            screen,
            userIntent: trimForMemory(promptText, 260),
            selectedProvider: provider,
            providerLabel,
            memoryScope,
            canvas: canvas
              ? {
                  id: canvas.id,
                  name: canvas.name,
                }
              : null,
            attachedArticle: article
              ? {
                  title: article.title || "",
                  url: article.url || article.href || "",
                }
              : null,
            magazineArticle: magazineArticleContext
              ? {
                  id: magazineArticleContext.id || "",
                  title: magazineArticleContext.title || "",
                  topics: Array.isArray(magazineArticleContext.topics) ? magazineArticleContext.topics.slice(0, 8) : [],
                  publishedAt: magazineArticleContext.publishedAt || "",
                  publishedTimeLabel: magazineArticleContext.publishedTimeLabel || "",
                }
              : null,
            stockChannelArticle: stockArticleContext
              ? {
                  id: stockArticleContext.id || "",
                  url: stockArticleContext.url || "",
                  title: stockArticleContext.title || "",
                  categoryLabel: stockArticleContext.categoryLabel || "",
                  author: stockArticleContext.author || "",
                  publishedAt: stockArticleContext.publishedAt || "",
                }
              : null,
            attachments: attachments.map((attachment) => ({
              name: attachment.name,
              type: attachment.type,
              size: attachment.size,
            })),
          },
          source: {
            surface:
              memoryScope === "portfolio-canvas"
                ? "portfolio-canvas-chat"
                : memoryScope === "world-memory"
                  ? "world-memory-chat"
                  : "sidebar-chat",
            screen,
            provider,
            providerLabel,
            writer: provider,
          },
    });
  }

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const expectedHash = hashForView(activeView);
    const currentHashView = viewFromHash(window.location.hash, null);
    if (currentHashView !== activeView && window.location.hash !== expectedHash) {
      window.history.pushState(null, "", expectedHash);
    }
  }, [activeView]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleHashChange = () => {
      const nextView = viewFromHash(window.location.hash, "stock");
      if (nextView !== activeViewRef.current) {
        setActiveView(nextView);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);


  useEffect(() => {
    notificationStatusRef.current = notificationStatus;
    showBrowserNotificationForStatus(notificationStatus);
  }, [
    notificationStatus?.latest?.id,
    notificationStatus?.reportsUrgentUpdate?.showBadge,
    notificationStatus?.dailyIntelligenceCriticalUpdate?.id,
    notificationStatus?.dailyIntelligenceCriticalUpdate?.showBadge,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setBrowserNotificationPermission("unsupported");
      return undefined;
    }
    setBrowserNotificationPermission(window.Notification.permission || "default");
    if (window.Notification.permission !== "default") return undefined;

    let cancelled = false;
    let cleanupDone = false;
    const cleanup = () => {
      if (cleanupDone) return;
      cleanupDone = true;
      window.removeEventListener("click", requestPermission);
      window.removeEventListener("keydown", requestPermission);
    };
    const requestPermission = () => {
      cleanup();
      window.Notification.requestPermission()
        .then((permission) => {
          if (cancelled) return;
          setBrowserNotificationPermission(permission || browserNotificationPermissionState());
          if (permission === "granted") {
            showBrowserNotificationForStatus(notificationStatusRef.current);
          }
        })
        .catch(() => {
          if (!cancelled) setBrowserNotificationPermission(browserNotificationPermissionState());
        });
    };

    window.addEventListener("click", requestPermission, { capture: true, once: true });
    window.addEventListener("keydown", requestPermission, { capture: true, once: true });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (activeView !== "transaction-status") return;
    if (transactionStatusHidden) {
      setActiveView("stock");
    }
  }, [activeView, transactionStatusHidden]);

  useEffect(() => {
    if (activeView !== "world-memory") return;
    if (!worldMemoryEnabled) {
      setActiveView("stock");
    }
  }, [activeView, worldMemoryEnabled]);

  useEffect(() => {
    if (activeView === "magazine" && !magazineEnabled) {
      setActiveView("stock");
    }
  }, [activeView, magazineEnabled]);

  function buildPendingAssistant(id, runtime = providerRuntimeForProvider(agentProvider)) {
    return {
      id,
      role: "assistant",
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
      blocks: [
        {
          type: "status",
          tone: "working",
          title: `${runtime.providerLabel} 응답 준비 중`,
          body:
            runtime.provider === ANTIGRAVITY_PROVIDER_ID
              ? `${runtime.selectedModelGroup?.label || "Gemini"} 모델에 대화 컨텍스트를 전달하고 있습니다.`
              : `${runtime.modelSummaryLabel} 모델을 읽기 전용 Codex CLI 세션으로 호출하고 있습니다.`,
        },
      ],
      providerLabel: runtime.providerLabel,
    };
  }

  function updateAssistantMessage(id, { status, text, extraBlocks = [] }, scope = { type: "system-main", canvasId: "" }) {
    updateChatMessagesForScope(scope, (messages) =>
      messages.map((message) => {
        if (message.id !== id) return message;
        const blocks = status ? [status] : [];
        if (text) {
          blocks.push({ type: "paragraph", text });
        }
        if (Array.isArray(extraBlocks) && extraBlocks.length) {
          blocks.push(...extraBlocks);
        }
        return { ...message, blocks };
      })
    );
  }

  function queuePortfolioWidgetActionFromAnswer(answer, request = {}) {
    const parsedAction = parsePortfolioWidgetJsonAction(answer);
    const requestWidgetId = request?.widget?.id || request?.widgetId || "";
    if (!parsedAction && !requestWidgetId) return false;
    const actionName = String(parsedAction?.action || parsedAction?.actionId || request?.action || "").toLowerCase();
    const looksLikeWidgetAction =
      Boolean(requestWidgetId) ||
      Boolean(parsedAction?.widget) ||
      Boolean(parsedAction?.widgetId) ||
      Boolean(parsedAction?.targetWidgetId) ||
      Boolean(parsedAction?.actionId) ||
      Boolean(parsedAction?.dataset || parsedAction?.data || parsedAction?.holdings || parsedAction?.chartSpec || parsedAction?.chart || parsedAction?.functionSpec || parsedAction?.strategySpec || parsedAction?.rules || parsedAction?.dataFiles || parsedAction?.dataSources || parsedAction?.files || parsedAction?.attachments || parsedAction?.metrics || parsedAction?.standardMetrics) ||
      /widget|delete|remove|artifact|chart|pie|allocation|function|strategy|signal|render_portfolio_artifact|import_holdings|refresh_canvas_latest_data|request_backtest_matrix_context|retrieve_backtest_matrix_context|get_backtest_matrix_context|load_backtest_matrix_context/.test(actionName);
    if (!looksLikeWidgetAction) return false;
    setPortfolioWidgetAgentAction({
      id: `portfolio_widget_action_${Date.now()}`,
      canvasId: parsedAction?.canvasId || request?.canvasId || "",
      widgetId: parsedAction?.widgetId || parsedAction?.targetWidgetId || parsedAction?.widget?.id || requestWidgetId,
      request,
      answer,
      receivedAt: new Date().toISOString(),
    });
    return true;
  }

  async function saveReportArtifactAction(action, request = {}) {
    if (!action?.artifact?.title || !action?.artifact?.content) return null;
    const payload = await postReportAction({
      action: action.action,
      classification: action.classification,
      artifact: action.artifact,
      source: {
        surface: "reports-sidebar-agent",
        screen: request.screen || "reports",
        prompt: request.promptText || "",
        provider: agentProvider,
        providerLabel: agentProviderLabel,
      },
    });
    setReportRefreshSignal((current) => current + 1);
    return payload;
  }

  async function recoverMissingReportArtifact({ promptText = "", answerText = "" } = {}) {
    const payload = await postReportAction({
      action: "recover_missing_report_artifact",
      prompt: promptText,
      answer: answerText,
      source: {
        surface: "reports-sidebar-agent-fallback",
        screen: "reports",
        provider: agentProvider,
        providerLabel: agentProviderLabel,
      },
    });
    if (payload.recovered && payload.saved) {
      setReportRefreshSignal((current) => current + 1);
    }
    return payload;
  }

  async function classifyReportGenerationRequest({ promptText = "", messages = [], signal } = {}) {
    const payload = await postReportAction({
      action: "classify_report_request",
      prompt: promptText,
      messages,
      source: {
        surface: "reports-sidebar-agent-preflight",
        screen: "reports",
        provider: agentProvider,
        providerLabel: agentProviderLabel,
      },
    }, { signal });
    return payload.decision || null;
  }

  async function saveChatAnswerToReports({ message, answerText } = {}) {
    const content = String(answerText || "").trim();
    if (!content) throw new Error("보고서에 저장할 답변이 없습니다.");
    const payload = await postReportAction({
      action: "save_chat_answer",
      artifact: { content, format: "markdown" },
      source: {
        surface: "agent-chat-answer-action",
        screen: activeView,
        provider: agentProvider,
        providerLabel: message?.providerLabel || agentProviderLabel,
        messageId: message?.id || "",
      },
    });
    setReportRefreshSignal((current) => current + 1);
    return payload;
  }

  async function sendPrompt(rawOptions = {}) {
    const options = rawOptions && typeof rawOptions === "object" && !("nativeEvent" in rawOptions) ? rawOptions : {};
    const overridePromptText = typeof options.promptText === "string" ? options.promptText : "";
    const hasOverridePrompt = Boolean(overridePromptText);
    const screenForMessage = typeof options.screen === "string" ? options.screen : activeView;
    const chatScope = options.chatScope || resolveChatScope(screenForMessage);
    const scopePrompt = promptForScope(chatScope);
    const scopeAttachments = attachmentsForScope(chatScope);
    const trimmed = (hasOverridePrompt ? overridePromptText : scopePrompt).trim();
    const attachmentsForMessage = Array.isArray(options.attachments)
      ? options.attachments
      : hasOverridePrompt
        ? []
        : scopeAttachments;
    if (!agentOptionsReady || (!trimmed && !attachmentsForMessage.length) || isChatScopeSending(chatScope)) return false;
    const createdAt = Date.now();
    const articleForMessage =
      options.article === undefined ? (hasOverridePrompt ? null : attachedArticleForScope(chatScope)) : options.article;
    const screenModelProviderId =
      worldMemoryEnabled && screenForMessage === "world-memory"
        ? worldMemoryManagementProviderId()
        : magazineEnabled && screenForMessage === "magazine"
          ? magazineWritingProviderId()
          : agentProvider;
    const messageProviderId = options.provider || screenModelProviderId;
    const messageRuntime = providerRuntimeForProvider(messageProviderId);
    const visibleScreenSnapshot =
      options.visibleScreenSnapshot !== undefined
        ? options.visibleScreenSnapshot
        : collectVisibleScreenSnapshot(screenForMessage);
    const requestedDisplayText =
      typeof options.displayText === "string" ? cleanPortfolioWidgetPrompt(options.displayText, 240) : "";
    const displayText = requestedDisplayText || trimmed || "첨부 파일을 확인해 주세요.";
    const promptTextForAgent = trimmed || displayText;
    const isPortfolioScreenForMessage = screenForMessage === "portfolio" || screenForMessage === "portfolio-canvas";
    const scopeCanvas = chatScope.type === "portfolio-canvas"
      ? portfolioCanvases.find((canvas) => canvas.id === chatScope.canvasId) || activePortfolioCanvas
      : null;
    const portfolioContextForMessage =
      options.portfolioContext !== undefined
        ? options.portfolioContext
        : isPortfolioScreenForMessage
          ? portfolioContext
          : null;
    const transactionStatusContextForMessage = screenForMessage === "transaction-status"
      ? transactionStatusContextRef.current
      : null;
    const portfolioActionInstructions = isPortfolioScreenForMessage
      ? (await import("./portfolio/agentPromptBuilder.js")).buildPortfolioChatActionInstructions(
          portfolioContextForMessage,
          {
            modeMeta: portfolioCanvasModeMeta(portfolioContextForMessage?.portfolioMode || portfolioContextForMessage?.canvas?.mode),
            assetCanvasModeId: PORTFOLIO_CANVAS_MODES.asset.id,
          }
        )
      : "";
    const promptWithContext = [
      buildPromptWithArticleContext(promptTextForAgent, articleForMessage),
      portfolioActionInstructions,
      attachmentsSummary(attachmentsForMessage),
    ].filter(Boolean).join("\n\n");
    const stockArticleContextForMessage =
      options.stockArticleContext !== undefined
        ? options.stockArticleContext
        : screenForMessage === "stock" && arcaReaderArticle
          ? buildStockArticleAgentContext(arcaReaderArticle)
          : null;
    const boardIndexContext =
      screenForMessage === "stock" && !articleForMessage && !stockArticleContextForMessage
        ? buildBoardIndexContextSnapshot(arcaBoard, boardFilters, {
            activeCategoryLabel,
            busy: arcaBoardBusy,
            error: arcaBoardError,
            showHiddenNotices,
          })
        : null;
    const calendarContext =
      screenForMessage === "earning-calendar"
        ? earningCalendarContext
        : screenForMessage === "economic-calendar"
          ? economicCalendarContext
          : null;
    const worldMemoryContext =
      options.worldMemoryContext !== undefined
        ? options.worldMemoryContext
        : worldMemoryEnabled && screenForMessage === "world-memory"
          ? buildWorldMemoryPageContextSnapshot(worldMemoryStatus, worldMemoryActionResult, worldMemoryFocusedChangeSuggestion)
          : null;
    const magazineArticleContextForMessage =
      options.magazineArticleContext !== undefined
        ? options.magazineArticleContext
        : screenForMessage === "magazine" && magazineActiveArticle
          ? buildMagazineArticleAgentContext(magazineActiveArticle)
          : null;
    const userMessage = {
      id: `user-${createdAt}`,
      role: "user",
      text: displayText,
      article: articleForMessage,
      attachments: attachmentsForMessage,
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    };
    const assistantId = `assistant-${createdAt}`;
    const history = chatMessagesForScope(chatScope).map((message) => ({
      role: message.role,
      text: messageToHistoryText(message),
    }));

    updateChatMessagesForScope(chatScope, (messages) => [...messages, userMessage, buildPendingAssistant(assistantId, messageRuntime)]);
    if (!hasOverridePrompt || options.clearComposerOnSend) {
      clearComposerForScope(chatScope);
    }
    setAttachmentErrorForScope(chatScope, "");
    setChatScopeSending(chatScope, true);

    let completedAnswer = "";
    let streamedText = "";
    let sharedAnswerForMemory = "";
    let visibleAssistantTextForCatch = (text) => text;
    const abortController = new AbortController();
    const chatScopeAbortKey = chatScopeKey(chatScope);
    activeChatAbortRefs.current.set(chatScopeAbortKey, abortController);
    const includeWorldMemoryPageContext =
      options.includeWorldMemoryContext !== undefined
        ? Boolean(options.includeWorldMemoryContext)
        : worldMemoryEnabled && screenForMessage === "world-memory";
    const includeWorldMemorySearchContext =
      options.includeWorldMemorySearchContext !== undefined
        ? Boolean(options.includeWorldMemorySearchContext)
        : worldMemoryEnabled;
    const includeNewsFeedSearchContext =
      options.includeNewsFeedSearchContext !== undefined ? Boolean(options.includeNewsFeedSearchContext) : true;

    try {
      let reportGenerationDecision = null;
      if (screenForMessage === "reports") {
        updateAssistantMessage(
          assistantId,
          {
            status: {
              type: "status",
              tone: "working",
              title: "보고서 작성 의도 확인 중",
              body: "요청을 일반 대화와 저장할 보고서 생성으로 의미 분류하고 있습니다.",
            },
            text: "",
          },
          chatScope
        );
        try {
          reportGenerationDecision = await classifyReportGenerationRequest({
            promptText: promptTextForAgent,
            messages: history,
            signal: abortController.signal,
          });
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          reportGenerationDecision = null;
        }
      }
      const shouldDirectSaveReport = Boolean(reportGenerationDecision?.shouldGenerateDirectly);
      let reportMarketProxyContext = null;
      if (shouldDirectSaveReport) {
        updateAssistantMessage(
          assistantId,
          {
            status: {
              type: "status",
              tone: "working",
              title: "24시간 프록시 시세 확인 중",
              body: "주요 ETF·원자재·암호자산의 Binance 24시간 시세를 보고서 보조 데이터로 확인하고 있습니다.",
            },
            text: "",
          },
          chatScope
        );
        reportMarketProxyContext = await loadReportMarketProxyContext({
          signal: abortController.signal,
        });
      }
      const response = await requestAgentChatStream({
          prompt: promptWithContext,
          messages: history,
          provider: messageRuntime.provider,
          model: messageRuntime.selectedModelGroup?.slug,
          reasoning: messageRuntime.selectedReasoning?.id,
          speed: messageRuntime.selectedSpeed?.id,
          approval: messageRuntime.selectedApproval?.id,
          personaMode:
            options.disablePersonaMode || !personaEligibleScreens.has(screenForMessage)
              ? "none"
              : personaMode,
          screen: screenForMessage,
          includeWorldMemoryContext: includeWorldMemoryPageContext,
          includeWorldMemorySnapshotContext: Boolean(options.includeWorldMemorySnapshotContext),
          includeWorldMemorySearchContext,
          worldMemoryContext,
          forceWorldMemoryVectorSearch: worldMemoryEnabled && Boolean(options.forceWorldMemoryVectorSearch),
          worldMemoryVectorSearchQuery: options.worldMemoryVectorSearchQuery || "",
          worldMemoryFocusContext: options.worldMemoryFocusContext || null,
          requireWebSearch: Boolean(options.requireWebSearch),
          includeReportCatalog:
            options.includeReportCatalog !== undefined
              ? Boolean(options.includeReportCatalog)
              : screenForMessage === "reports",
          reportGenerationMode: shouldDirectSaveReport ? "direct-save" : "legacy-artifact",
          reportMarketProxyContext,
          includeNewsFeedContext:
            options.includeNewsFeedContext !== undefined
              ? Boolean(options.includeNewsFeedContext)
              : screenForMessage === "news-feed",
          includeNewsFeedSearchContext,
          includeSharedMemory: chatScope.type !== "portfolio-canvas",
          memoryScope: chatScope.type,
          canvasId: scopeCanvas?.id || "",
          canvasTitle: scopeCanvas?.name || "",
          boardContext: boardIndexContext,
          calendarContext,
          magazineArticleContext: magazineArticleContextForMessage,
          stockArticleContext: stockArticleContextForMessage,
          portfolioContext: portfolioContextForMessage,
          portfolioRetrievalQuery: isPortfolioScreenForMessage ? promptTextForAgent : "",
          transactionStatusContext: transactionStatusContextForMessage,
          transactionStatusRetrievalQuery: screenForMessage === "transaction-status" ? promptTextForAgent : "",
          visibleScreenSnapshot,
          attachments: attachmentsForMessage.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
            dataUrl: attachment.dataUrl,
            text: attachment.text || "",
          })),
      }, { signal: abortController.signal });
      const shouldStripPortfolioWidgetAction = options.stripPortfolioWidgetActionBlocks || isPortfolioScreenForMessage;
      const shouldStripWorldMemoryAction = screenForMessage === "world-memory";
      const shouldStripReportArtifactAction = screenForMessage === "reports";
      const visibleAssistantText = (text) => {
        if (shouldDirectSaveReport) return "";
        let output = shouldStripPortfolioWidgetAction ? stripPortfolioWidgetActionBlocks(text) : text;
        if (shouldStripWorldMemoryAction) output = stripWorldMemoryActionBlocks(output);
        if (shouldStripReportArtifactAction) output = stripReportArtifactBlocks(output);
        return output;
      };
      visibleAssistantTextForCatch = visibleAssistantText;
      const streamResult = await consumeAgentChatStream(response, {
        runtime: messageRuntime,
        transformText: visibleAssistantText,
        onFirstDelta: options.onFirstDelta,
        onRawText: (text) => {
          streamedText = text;
        },
        onRender: ({ status, text }) => {
          updateAssistantMessage(assistantId, { status, text }, chatScope);
        },
      });
      streamedText = streamResult.rawText;
      completedAnswer = streamResult.answer;
      const latestStatus = streamResult.latestStatus;
      if (completedAnswer) {
        let reportArtifactSaveResult = null;
        if (screenForMessage === "reports") {
          if (shouldDirectSaveReport) {
            const reportMarkdown = stripReportArtifactBlocks(completedAnswer).trim();
            try {
              updateAssistantMessage(
                assistantId,
                {
                  status: {
                    type: "status",
                    tone: "working",
                    title: "보고서 완결성 확인 중",
                    body: "생성된 Markdown 전문을 의미 검증한 뒤 글 목록에 저장합니다.",
                  },
                  text: "",
                },
                chatScope
              );
              const recovery = await recoverMissingReportArtifact({
                promptText: promptTextForAgent,
                answerText: reportMarkdown,
              });
              if (!recovery.recovered || !recovery.saved) {
                throw new Error(recovery.decision?.reason || "완성된 보고서로 확인되지 않아 저장을 보류했습니다.");
              }
              reportArtifactSaveResult = recovery;
              sharedAnswerForMemory = `'${recovery.saved.title}' 보고서를 글 목록에 저장했습니다.`;
              updateAssistantMessage(
                assistantId,
                {
                  status: latestStatus,
                  text: "",
                  extraBlocks: [
                    {
                      type: "status",
                      tone: "done",
                      title: "보고서 저장됨",
                      body: `'${recovery.saved.title}' 보고서가 글 목록에 추가되었습니다.`,
                    },
                  ],
                },
                chatScope
              );
            } catch (error) {
              const saveError = error.message || "보고서 파일 저장에 실패했습니다.";
              sharedAnswerForMemory = reportMarkdown || saveError;
              updateAssistantMessage(
                assistantId,
                {
                  status: latestStatus,
                  text: reportMarkdown,
                  extraBlocks: [
                    {
                      type: "status",
                      tone: "error",
                      title: "보고서 저장 실패",
                      body: saveError,
                    },
                  ],
                },
                chatScope
              );
            }
          } else {
            const reportArtifactAction = parseReportArtifactAction(completedAnswer);
            let reportArtifactSaveError = "";
            if (reportArtifactAction) {
              try {
                reportArtifactSaveResult = await saveReportArtifactAction(reportArtifactAction, {
                  screen: screenForMessage,
                  promptText: displayText,
                });
              } catch (error) {
                reportArtifactSaveError = error.message || "보고서 파일 저장에 실패했습니다.";
              }
              updateAssistantMessage(
                assistantId,
                {
                  status: latestStatus,
                  text: visibleAssistantText(completedAnswer),
                  extraBlocks: [
                    {
                      type: "status",
                      tone: reportArtifactSaveResult ? "done" : "error",
                      title: reportArtifactSaveResult ? "보고서 저장됨" : "보고서 저장 실패",
                      body: reportArtifactSaveResult
                        ? `'${reportArtifactSaveResult.saved?.title || reportArtifactAction.artifact.title}' 보고서가 글 목록에 추가되었습니다.`
                        : reportArtifactSaveError,
                    },
                  ],
                },
                chatScope
              );
            } else {
              try {
                updateAssistantMessage(
                  assistantId,
                  {
                    status: {
                      type: "status",
                      tone: "working",
                      title: "보고서 저장 여부 확인 중",
                      body: "저장 액션이 누락되어 요청 의도와 완성도를 의미 기반으로 다시 확인하고 있습니다.",
                    },
                    text: visibleAssistantText(completedAnswer),
                  },
                  chatScope
                );
                const recovery = await recoverMissingReportArtifact({
                  promptText: promptTextForAgent,
                  answerText: visibleAssistantText(completedAnswer),
                });
                if (recovery.recovered && recovery.saved) {
                  reportArtifactSaveResult = recovery;
                  updateAssistantMessage(
                    assistantId,
                    {
                      status: latestStatus,
                      text: visibleAssistantText(completedAnswer),
                      extraBlocks: [
                        {
                          type: "status",
                          tone: "done",
                          title: "보고서 저장됨",
                          body: `'${recovery.saved.title}' 보고서가 글 목록에 추가되었습니다.`,
                        },
                      ],
                    },
                    chatScope
                  );
                } else {
                  updateAssistantMessage(
                    assistantId,
                    {
                      status: latestStatus,
                      text: visibleAssistantText(completedAnswer),
                    },
                    chatScope
                  );
                }
              } catch (error) {
                reportArtifactSaveError = error.message || "보고서 저장 의도 재확인에 실패했습니다.";
                updateAssistantMessage(
                  assistantId,
                  {
                    status: latestStatus,
                    text: visibleAssistantText(completedAnswer),
                    extraBlocks: [
                      {
                        type: "status",
                        tone: "error",
                        title: "보고서 저장 확인 실패",
                        body: reportArtifactSaveError,
                      },
                    ],
                  },
                  chatScope
                );
              }
            }
          }
        }
        if (screenForMessage === "world-memory") {
          const parsedWorldMemoryAction = parseWorldMemoryJsonAction(completedAnswer);
          const proposal = parsedWorldMemoryAction
            ? normalizeWorldMemoryActionProposal(
                parsedWorldMemoryAction,
                completedAnswer,
                options.worldMemoryFocusContext || worldMemoryContext?.pendingChangeSuggestion || null
              )
            : null;
          if (proposal) {
            setWorldMemoryAgentAction(proposal);
            updateAssistantMessage(
              assistantId,
              {
                status: latestStatus,
                text: visibleAssistantText(completedAnswer),
                extraBlocks: [
                  {
                    type: "world-memory-action",
                    action: proposal,
                  },
                ],
              },
              chatScope
            );
          }
        }
        await saveSharedChatMemory({
          createdAt,
          promptText: displayText,
          answerText:
            sharedAnswerForMemory || visibleAssistantText(completedAnswer) || "에이전트 액션을 생성했습니다.",
          article: articleForMessage,
          attachments: attachmentsForMessage,
          screen: screenForMessage,
          memoryScope: chatScope.type,
          magazineArticleContext: magazineArticleContextForMessage,
          stockArticleContext: stockArticleContextForMessage,
          provider: messageRuntime.provider,
          providerLabel: messageRuntime.providerLabel,
          canvas: scopeCanvas
            ? {
                id: scopeCanvas.id,
                name: scopeCanvas.name,
                mode: scopeCanvas.mode,
                modeLabel: portfolioCanvasModeMeta(scopeCanvas.mode).label,
              }
            : null,
        });
        if (typeof options.onComplete === "function") {
          options.onComplete({
            answer: completedAnswer,
            report: reportArtifactSaveResult?.saved || null,
            createdAt,
            displayText,
            screen: screenForMessage,
            memoryScope: chatScope.type,
            canvas: scopeCanvas
              ? {
                  id: scopeCanvas.id,
                  name: scopeCanvas.name,
                  mode: scopeCanvas.mode,
                  modeLabel: portfolioCanvasModeMeta(scopeCanvas.mode).label,
                }
              : null,
          });
        }
        if (isPortfolioScreenForMessage && options.applyPortfolioWidgetAction !== false) {
          queuePortfolioWidgetActionFromAnswer(
            completedAnswer,
            {
              ...(options.portfolioWidgetRequest || {
                action: "chat",
                prompt: displayText,
                canvasId: scopeCanvas?.id || portfolioContextForMessage?.canvas?.id || "",
              }),
              attachments: attachmentsForMessage.map((attachment) => ({
                id: attachment.id,
                name: attachment.name,
                type: attachment.type,
                size: attachment.size,
                dataUrl: attachment.dataUrl,
                text: attachment.text || "",
                source: "chat-attachment",
                status: "attached",
              })),
            }
          );
        }
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        updateAssistantMessage(
          assistantId,
          {
            status: {
              type: "status",
              tone: "done",
              title: "응답 중단됨",
              body: "사용자가 에이전트 실행을 정지했습니다.",
            },
            text: visibleAssistantTextForCatch(error.partialText ?? streamedText),
          },
          chatScope
        );
        return true;
      }
      if (typeof options.onError === "function") {
        options.onError(error);
      }
      updateChatMessagesForScope(chatScope, (messages) =>
        messages.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                blocks: [
                  {
                    type: "status",
                    tone: "error",
                    title: `${messageRuntime.providerLabel} 호출 실패`,
                    body: error.message,
                  },
                ],
              }
            : message
        )
      );
    } finally {
      if (activeChatAbortRefs.current.get(chatScopeAbortKey) === abortController) {
        activeChatAbortRefs.current.delete(chatScopeAbortKey);
      }
      setChatScopeSending(chatScope, false);
    }
    return true;
  }

  function askWorldMemoryReportItem(section, item, extra = {}) {
    if (!worldMemoryEnabled) return;
    const request = buildWorldMemoryAskRequest(section, item, extra);
    const isMemoryChangeSuggestion = section === "memory-change";
    setWorldMemoryFocusedChangeSuggestion(isMemoryChangeSuggestion ? request.focusContext : null);
    const worldMemoryContext = {
      ...buildWorldMemoryPageContextSnapshot(
        worldMemoryStatus,
        worldMemoryActionResult,
        isMemoryChangeSuggestion ? request.focusContext : worldMemoryFocusedChangeSuggestion
      ),
      focusedReportItem: request.focusContext,
    };
    void sendPrompt({
      promptText: request.promptText,
      displayText: request.displayText,
      screen: "world-memory",
      worldMemoryContext,
      forceWorldMemoryVectorSearch: true,
      worldMemoryVectorSearchQuery: request.vectorSearchQuery,
      worldMemoryFocusContext: request.focusContext,
      requireWebSearch: request.requireWebSearch ?? true,
      includeNewsFeedContext: true,
      disablePersonaMode: isMemoryChangeSuggestion,
    });
  }

  function handleReportsBoredResearch(request = {}) {
    const displayText = request.displayText || "숨은 이슈 리서치";
    const vectorQuery = [
      request.issue?.title,
      request.issue?.signal,
      request.angle?.promptFocus,
      displayText,
    ].filter(Boolean).join(" ");
    return sendPrompt({
      promptText: request.promptText,
      displayText,
      screen: "reports",
      forceWorldMemoryVectorSearch: true,
      worldMemoryVectorSearchQuery: vectorQuery,
      includeWorldMemorySnapshotContext: true,
      includeWorldMemorySearchContext: true,
      includeNewsFeedSearchContext: true,
      includeNewsFeedContext: false,
      includeReportCatalog: true,
      requireWebSearch: true,
      disablePersonaMode: true,
      onFirstDelta: request.onFirstDelta,
      onComplete: request.onComplete,
      onError: request.onError,
    });
  }

  async function handlePortfolioWidgetPromptRequest(request) {
    const requestWithId = {
      ...request,
      requestId: `portfolio_widget_request_${Date.now()}`,
      canvasId: activePortfolioCanvas?.id || "",
      canvasName: activePortfolioCanvas?.name || "",
      canvasMode: activePortfolioCanvas?.mode || PORTFOLIO_CANVAS_MODES.asset.id,
    };
    const requestAttachments = Array.isArray(requestWithId.attachments) && requestWithId.attachments.length
      ? requestWithId.attachments
      : selectPortfolioWidgetRequestAttachments({
          request: requestWithId,
          messages: activePortfolioCanvas?.chatMessages || [],
        });
    const requestWithAttachments = {
      ...requestWithId,
      attachments: requestAttachments,
    };
    const { buildPortfolioWidgetAgentPrompt } = await import("./portfolio/agentPromptBuilder.js");
    const agentPrompt = buildPortfolioWidgetAgentPrompt(requestWithAttachments, {
      modeMeta: portfolioCanvasModeMeta(requestWithId.canvasMode),
      assetCanvasModeId: PORTFOLIO_CANVAS_MODES.asset.id,
    });
    const title = request?.widget?.title || (request?.source === "scenario-panel" ? "기간 및 타임프레임" : "포트폴리오 위젯");
    const displayPrefix =
      request?.source === "scenario-panel"
        ? "시나리오 설정 요청"
        : request?.source === "canvas-empty-cell"
          ? "캔버스 위젯 요청"
          : request?.action === "edit"
            ? "위젯 수정 요청"
            : "위젯 생성 요청";
    const displayText = `${displayPrefix} · ${title}`;
    if (!agentOptionsReady || activePortfolioChatIsSending) {
      setPromptForScope({ type: "portfolio-canvas", canvasId: requestWithAttachments.canvasId || "" }, agentPrompt);
      setQueuedPortfolioWidgetRequest(requestWithAttachments);
      window.setTimeout(() => promptRef.current?.focus(), 0);
      return;
    }
    setQueuedPortfolioWidgetRequest(null);
    void sendPrompt({
      promptText: agentPrompt,
      displayText,
      attachments: requestAttachments,
      screen: "portfolio-canvas",
      clearComposerOnSend: true,
      stripPortfolioWidgetActionBlocks: true,
      portfolioWidgetRequest: requestWithAttachments,
      onError: (error) => {
        setPortfolioWidgetAgentAction({
          id: `portfolio_widget_action_${Date.now()}`,
          canvasId: requestWithAttachments.canvasId || "",
          widgetId: request?.widget?.id,
          request: requestWithAttachments,
          error: error.message,
          receivedAt: new Date().toISOString(),
        });
      },
    });
  }

  useEffect(() => {
    if (!queuedPortfolioWidgetRequest || !agentOptionsReady || activePortfolioChatIsSending) return;
    const request = queuedPortfolioWidgetRequest;
    setQueuedPortfolioWidgetRequest(null);
    void handlePortfolioWidgetPromptRequest(request);
  }, [queuedPortfolioWidgetRequest, agentOptionsReady, activePortfolioChatIsSending]);

  async function analyzeEarningEvent(event) {
    if (!agentOptionsReady || isSending || !event) return;

    const createdAt = Date.now();
    const displayText = `${displayEarningValue(event.symbol)} 어닝 이벤트 분석`;
    const promptWithContext = buildEarningAnalysisPrompt(event);
    const userMessage = {
      id: `user-${createdAt}`,
      role: "user",
      text: displayText,
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    };
    const assistantId = `assistant-${createdAt}`;
    const earningRuntime = providerRuntimeForProvider(agentProvider);
    const history = chatMessages.map((message) => ({
      role: message.role,
      text: messageToHistoryText(message),
    }));

    setChatMessages((messages) => [...messages, userMessage, buildPendingAssistant(assistantId, earningRuntime)]);
    setAttachmentErrorForScope(systemMainChatScope, "");
    setChatScopeSending(systemMainChatScope, true);

    let completedAnswer = "";

    try {
      const response = await requestAgentChatStream({
          prompt: promptWithContext,
          messages: history,
          provider: agentProvider,
          model: selectedModelGroup?.slug,
          reasoning: selectedReasoning?.id,
          speed: selectedSpeed?.id,
          approval: selectedApproval?.id,
          personaMode,
          screen: "earning-calendar",
          includeWorldMemoryContext: false,
          includeWorldMemorySearchContext: worldMemoryEnabled,
          includeNewsFeedContext: false,
          includeNewsFeedSearchContext: true,
          requireWebSearch: true,
          boardContext: null,
          calendarContext: earningCalendarContext,
          attachments: [],
      });
      const streamResult = await consumeAgentChatStream(response, {
        runtime: earningRuntime,
        mode: "earning",
        onRender: ({ status, text }) => {
          updateAssistantMessage(assistantId, { status, text });
        },
      });
      completedAnswer = streamResult.answer;
      if (completedAnswer) {
        await saveSharedChatMemory({
          createdAt,
          promptText: displayText,
          answerText: completedAnswer,
          article: null,
          attachments: [],
          screen: "earning-calendar",
          taskType: "earning-analysis",
        });
      }
    } catch (error) {
      setChatMessages((messages) =>
        messages.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                blocks: [
                  {
                    type: "status",
                    tone: "error",
                    title: `${agentProviderLabel} 어닝 분석 실패`,
                    body: error.message,
                  },
                ],
              }
            : message
        )
      );
    } finally {
      setChatScopeSending(systemMainChatScope, false);
    }
  }

  const defaultAgentRuntime = providerRuntimeForProvider(agentProvider);
  const worldMemoryAgentRuntime = worldMemoryManagementRuntime();
  const magazineAgentRuntime = magazineWritingRuntime();
  const sidebarAgentRuntime =
    activeView === "world-memory" && worldMemoryEnabled
      ? worldMemoryAgentRuntime
      : activeView === "magazine" && magazineEnabled
        ? magazineAgentRuntime
        : defaultAgentRuntime;
  const promotedTossInvestError = tossInvestError || tossInvestOrderSyncError;
  const promotedTossInvestErrorCode = tossInvestError
    ? tossInvestErrorCode
    : tossInvestOrderSyncError
      ? tossInvestOrderSyncErrorCode
      : tossInvestErrorCode;
  const tossInvestConnectionProps = {
    status: tossInvestStatus,
    busy: tossInvestBusy,
    action: tossInvestAction,
    error: promotedTossInvestError,
    errorCode: promotedTossInvestErrorCode,
    publicIp: tossInvestPublicIp,
    publicIpBusy: tossInvestPublicIpBusy,
    publicIpError: tossInvestPublicIpError,
    autoProbeAfterSave: true,
    autoProbeAfterUnlock: true,
    onReload: () => void loadTossInvestStatus(),
    onSaveCredentials: saveAndProbeTossInvestCredentials,
    onUnlockVault: unlockAndProbeTossInvestVault,
    onLockVault: lockTossInvestVault,
    onProbe: probeTossInvestConnection,
    onCheckPublicIp: checkTossInvestPublicIp,
    onDeleteCredentials: deleteTossInvestCredentials,
  };
  const tossInvestOrderSyncProps = {
    status: tossInvestOrderSyncStatus,
    busy: tossInvestOrderSyncBusy,
    action: tossInvestOrderSyncAction,
    error: tossInvestOrderSyncError,
    errorCode: tossInvestOrderSyncErrorCode,
    onReload: () => void loadTossInvestOrderSyncStatus(),
    onToggleEnabled: updateTossInvestOrderSyncEnabled,
    onRunSync: () => void runTossInvestOrderSync(),
  };
  const routeModels = {
    dailyIntelligence: () => ({
      onOpenOperations: () => setActiveView("research-operations"),
      onOpenMarketSectors: () => setActiveView("market-sectors"),
      onOpenCompanyResearch: () => setActiveView("company-research"),
      onOpenThesisJournal: () => setActiveView("thesis-journal"),
      onOpenInstitutionalPortfolio: () => setActiveView("institutional-portfolio"),
    }),
    marketSectors: () => ({
      onOpenDailyIntelligence: () => setActiveView("daily-intelligence"),
    }),
    companyResearch: () => ({
      onOpenDailyIntelligence: () => setActiveView("daily-intelligence"),
    }),
    thesisJournal: () => ({
      onOpenDailyIntelligence: () => setActiveView("daily-intelligence"),
    }),
    researchOperations: () => ({
      onOpenDailyIntelligence: () => setActiveView("daily-intelligence"),
    }),
    settings: () => ({
      newsFeed: newsFeedController,
      sharedMemory: sharedMemoryController,
      worldMemory: worldMemoryController,
      magazine: magazineController,
      transaction: transactionSettingsController,
      arca: arcaController,
      tossInvest: tossInvestConnectionProps,
      tossOrderSync: tossInvestOrderSyncProps,
      transactionStatusHidden,
      onToggleWorldMemoryEnabled: updateWorldMemoryEnabled,
      onToggleTransactionStatusHidden: updateTransactionStatusHidden,
      agent: {
        providerOptions,
        provider: agentProvider,
        onProviderChange: handleAgentProviderChange,
        providerStatus: selectedProvider,
        providerProfiles: agentProviderProfiles,
        onProviderEnabledChange: updateProviderEnabled,
        onProviderSettingChange: updateProviderSelection,
        approvalOptions: activeApprovalOptions,
        approval: selectedApproval?.id || approval,
        onApprovalChange: (nextApproval) => updateAgentSelection({ approval: nextApproval }),
        modelGroups: activeModelGroups,
        model: selectedModelGroup?.slug || model,
        onModelChange: (nextModel) => updateAgentSelection({ model: nextModel }),
        reasoningOptions,
        reasoning: selectedReasoning?.id || reasoning,
        onReasoningChange: (nextReasoning) => updateAgentSelection({ reasoning: nextReasoning }),
        speedOptions,
        speed,
        onSpeedChange: (nextSpeed) => updateAgentSelection({ speed: nextSpeed }),
        personaModeOptions,
        personaMode,
        onPersonaModeChange: updatePersonaMode,
        settingsError: agentSettingsError,
        loading: !agentOptionsReady,
        modelCatalogRefreshing,
        onReloadModelCatalog: reloadAgentModelCatalog,
      },
    }),
    chat: () => ({
      activeWorldMemoryActionId: worldMemoryAgentAction?.id || "",
      runningWorldMemoryAgentActionId: worldMemoryRunningAgentActionId,
      addChatAttachmentFiles,
      agentIcon,
      agentOptionsReady,
      agentProviderLabel,
      attachedArticle: activeAttachedArticle,
      attachmentError: activeAttachmentError,
      chatAttachments: activeChatAttachments,
      fileInputRef,
      handleComposerDragEnter,
      handleComposerDragLeave,
      handleComposerDragOver,
      handleComposerDrop,
      handleComposerPaste,
      isComposerDragging,
      isSending,
      messageStackRef,
      onClearAttachedArticle: () => clearAttachedArticleForScope(activeChatScope),
      onExecuteWorldMemoryAction: executeWorldMemoryAgentAction,
      onNewChat: startNewChat,
      onPromptChange: (nextPrompt) => setPromptForScope(activeChatScope, nextPrompt),
      onRemoveChatAttachment: removeChatAttachment,
      onSaveAnswerToReports: saveChatAnswerToReports,
      onSelectApproval: (nextApproval) => updateAgentSelection({ approval: nextApproval }),
      onSelectModel: (nextModel) => updateAgentSelection({ model: nextModel }),
      onSelectReasoning: (nextReasoning) => updateAgentSelection({ reasoning: nextReasoning }),
      onSelectSpeed: (nextSpeed) => updateAgentSelection({ speed: nextSpeed }),
      onStopSend: stopActiveChatResponse,
      prompt: activePrompt,
      promptHeight,
      promptOverflow,
      promptRef,
      sendPrompt,
      toolbarApprovalOptions,
      toolbarApprovalValue,
      toolbarModelGroups,
      toolbarModelValue,
      toolbarReasoningValue,
      toolbarSpeedValue,
      visibleChatMessages,
      worldMemoryActionBusy,
    }),
    reports: () => ({
      refreshSignal: reportRefreshSignal,
      agentIcon,
      agentProvider,
      agentProviderLabel,
      agentOptionsReady,
      agentModel: selectedModelGroup?.slug || model,
      agentReasoning: selectedReasoning?.id || reasoning,
      agentApproval: selectedApproval?.id || approval,
      isSending,
      worldMemoryEnabled,
      onResearchPrompt: handleReportsBoredResearch,
    }),
    transactionStatus: () => ({
      tossStatus: tossInvestStatus,
      tossBusy: tossInvestBusy,
      tossError: promotedTossInvestError,
      tossErrorCode: promotedTossInvestErrorCode,
      tossPublicIp: tossInvestPublicIp,
      tossPublicIpBusy: tossInvestPublicIpBusy,
      tossPublicIpError: tossInvestPublicIpError,
      onOpenSettings: openTossInvestDialog,
      onDeleteCredentials: deleteTossInvestCredentials,
      onCheckPublicIp: checkTossInvestPublicIp,
      onReload: () => void loadTossInvestStatus(),
      onContextChange: handleTransactionStatusContextChange,
    }),
    worldMemory: () => ({
      enabled: worldMemoryEnabled,
      viewProps: {
        status: worldMemoryStatus,
        busy: worldMemoryBusy,
        error: worldMemoryError,
        actionBusy: worldMemoryActionBusy,
        activeAction: worldMemoryRunningAction,
        agentActionBusy: Boolean(
          worldMemoryRunningAgentActionId && worldMemoryRunningAgentActionId === worldMemoryAgentAction?.id
        ),
        actionResult: worldMemoryActionResult,
        agentAction: worldMemoryAgentAction,
        agentIcon: worldMemoryAgentRuntime.icon,
        agentProvider: worldMemoryAgentRuntime.provider,
        agentOptionsReady,
        isSending: worldMemoryChatIsSending,
        onClearAgentAction: () => {
          setWorldMemoryAgentAction(null);
          setWorldMemoryFocusedChangeSuggestion(null);
        },
        onExecuteAgentAction: executeWorldMemoryAgentAction,
        onAskReportItem: askWorldMemoryReportItem,
        onReload: loadWorldMemoryStatus,
        onRunAction: runWorldMemoryAction,
      },
    }),
    newsFeed: () => ({
      onScroll: handleNewsFeedScroll,
      viewProps: {
        status: newsFeedStatus,
        items: newsFeedItems,
        busy: newsFeedBusy,
        refreshBusy: newsFeedRefreshBusy,
        loadingMore: newsFeedLoadingMore,
        error: newsFeedError,
        hasMore: newsFeedHasMore,
        translationModelLabel: newsFeedTranslationModelLabel,
        marketSummary: newsFeedMarketSummary,
        dailyDigest: newsFeedStatus?.dailyDigest || null,
        dailyDigestBusy: newsFeedDailyDigestBusy,
        marketSummaryCollapsed: newsFeedMarketSummaryCollapsed,
        onMarketSummaryCollapsedChange: updateNewsFeedMarketSummaryCollapsed,
        onGenerateDailyDigest: generateDailyDigest,
        onRefresh: refreshNewsFeed,
      },
    }),
    magazine: () => ({
      magazineActiveArticle,
      magazineCanvasRef,
      magazineStatus,
      magazineArticles,
      magazineStartNowBusy,
      magazineGenerateOneBusy,
      startMagazineNow,
      magazineGenerateOneToolVisible,
      generateOneMagazineArticle,
      magazineTopicCatalog,
      magazineActiveTopic,
      openMagazineTopic,
      magazineCoverHeadline,
      openMagazineArticle,
      magazineCoverCards,
      magazineActiveTopicEntry,
      closeMagazineTopic,
      magazineTopicArticles,
      magazineTopicModalRef,
      closeMagazineArticle,
      magazineCopyStatus,
      copyMagazineArticle,
      magazineCopyError,
      openMagazineDeleteDialog,
      magazineDeleting,
      magazineReaderArticleRef,
      selectedMagazinePreferenceIds,
      magazinePreferenceSavingId,
      saveMagazinePreference,
      magazinePreferenceNotice,
      magazinePreferenceNoticeFading,
      magazineComments,
      magazineCommentDraft,
      setMagazineCommentDraft,
      magazineCommentSubmitting,
      magazineCommentError,
      submitMagazineComment,
      magazineDeleteDialogOpen,
      confirmMagazineArticleDelete,
      magazineDeleteError,
      closeMagazineDeleteDialog,
    }),
    portfolio: () => ({
      onCreateCanvas: createPortfolioCanvasFromGuide,
    }),
    portfolioCanvas: () => ({
      canvas: activePortfolioCanvas,
      onCreateCanvas: createPortfolioCanvasFromGuide,
      workspaceProps: activePortfolioCanvas ? {
        onWorkspaceChange: updateActivePortfolioCanvasWorkspace,
        onRenameCanvas: (nextName) => renamePortfolioCanvasTo(activePortfolioCanvas.id, nextName),
        onOpenGuide: () => {
          setActiveView("portfolio");
          setPortfolioContext(null);
        },
        onContextChange: setPortfolioContext,
        onWidgetPromptRequest: handlePortfolioWidgetPromptRequest,
        agentWidgetAction: portfolioWidgetAgentAction,
        agentProvider,
        tossInvestStatus,
        tossInvestBusy,
        tossInvestError: promotedTossInvestError,
        tossInvestErrorCode: promotedTossInvestErrorCode,
        tossInvestPublicIp,
        tossInvestPublicIpBusy,
        tossInvestPublicIpError,
        tossInvestOrderSyncStatus,
        tossInvestOrderSyncBusy,
        tossInvestOrderSyncAction,
        tossInvestOrderSyncError,
        tossInvestOrderSyncErrorCode,
        onOpenSettings: openTossInvestDialog,
        onDeleteTossInvestCredentials: deleteTossInvestCredentials,
        onProbeTossInvestConnection: probeTossInvestConnection,
        onRunTossInvestOrderSync: () => void runTossInvestOrderSync(),
        onCheckTossInvestPublicIp: checkTossInvestPublicIp,
        onAgentWidgetActionConsumed: (actionId) =>
          setPortfolioWidgetAgentAction((current) => (current?.id === actionId ? null : current)),
      } : {},
    }),
    earningCalendar: () => ({
      agentIcon,
      analysisReady: agentOptionsReady,
      analysisBusy: isSending,
      onAnalyzeEarning: analyzeEarningEvent,
      onContextChange: setEarningCalendarContext,
    }),
    economicCalendar: () => ({
      onContextChange: setEconomicCalendarContext,
    }),
    stock: () => ({
      activeArticle: arcaReaderArticle,
      activeCategoryLabel,
      agentIcon,
      articleBusy: arcaReaderBusy,
      articleError: arcaReaderError,
      attachingArticleHref,
      board: arcaBoard,
      boardBusy: arcaBoardBusy,
      boardError: arcaBoardError,
      boardFilters,
      boardSearchInput,
      notificationBusy: arcaNotificationBusy,
      notificationActionBusy: arcaNotificationActionBusy,
      notificationActionError: arcaNotificationActionError,
      notificationHealth: arcaNotificationHealth,
      notificationStatus: arcaNotificationStatus,
      onAttachArticle: attachArticleContext,
      onBoardSearchInputChange: setBoardSearchInput,
      onCloseArticle: closeArcaArticleReader,
      onOpenArticle: (row) => void openArcaArticleReader(row),
      onMarkAllNotificationsRead: () => void markAllArcaNotificationsRead(),
      onOpenNotificationArticle: openArcaNotificationArticle,
      onRefreshBoard: refreshBoard,
      onRefreshNotifications: loadArcaNotifications,
      onResetBoard: resetBoard,
      onRetryArticle: retryArcaArticleReader,
      onSelectCategory: selectBoardCategory,
      onSubmitSearch: submitBoardSearch,
      onToggleHiddenNotices: toggleHiddenNotices,
      onUpdateFilters: updateBoardFilters,
      showHiddenNotices,
      canvasRef: arcaCanvasRef,
    }),
  };

  return (
    <main
      className={isFullWidthCanvasView ? "mockup-stage no-agent-sidebar" : "mockup-stage"}
      aria-label="에이전트 sidebar mockup"
    >
      <AppNavigation
        activePortfolioCanvas={activePortfolioCanvas}
        activeView={activeView}
        arcaNotificationHealth={arcaNotificationHealth}
        editingPortfolioCanvasId={editingPortfolioCanvasId}
        magazineStatus={magazineStatus}
        nameInputRef={portfolioCanvasNameInputRef}
        newsFeedMarketSummary={newsFeedMarketSummary}
        newsFeedStatus={newsFeedStatus}
        notificationStatus={notificationStatus}
        magazineEnabled={magazineEnabled}
        onDraftChange={setPortfolioCanvasNameDraft}
        onDraftKeyDown={handlePortfolioCanvasNameKeyDown}
        onDuplicateCanvas={duplicatePortfolioCanvas}
        onMenuToggle={(canvasId) =>
          setPortfolioCanvasMenuId((current) => (canvasId && current === canvasId ? "" : canvasId))
        }
        onRenameCanvas={startPortfolioCanvasRename}
        onRequestDeleteCanvas={requestDeletePortfolioCanvas}
        onSaveDraft={savePortfolioCanvasNameDraft}
        onSelectCanvas={selectPortfolioCanvas}
        onSelectItem={handleSidebarItemClick}
        onSelectUtility={handleSidebarItemClick}
        portfolioCanvasModeMeta={portfolioCanvasModeMeta}
        portfolioCanvasNameDraft={portfolioCanvasNameDraft}
        portfolioCanvasMenuId={portfolioCanvasMenuId}
        portfolioCanvases={portfolioCanvases}
        portfolioSidebarOpen={portfolioSidebarOpen}
        transactionStatusHidden={transactionStatusHidden}
        worldMemoryEnabled={worldMemoryEnabled}
        worldMemoryHealth={worldMemoryHealth}
      />

      {tossInvestDialogOpen ? (
        <div
          className="portfolio-asset-api-modal-backdrop"
          role="presentation"
          onMouseDown={closeTossInvestDialog}
        >
          <div
            className="portfolio-asset-api-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="toss-auth-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="portfolio-asset-api-modal-close"
              type="button"
              aria-label="토스증권 API 설정 닫기"
              title="닫기"
              onClick={closeTossInvestDialog}
            >
              <X size={18} strokeWidth={2.4} />
            </button>
            <div className="portfolio-asset-api-modal-body">
              <React.Suspense fallback={<RouteLoading label="토스증권 API 설정 불러오는 중" />}>
                <TossInvestConnectionSection
                  {...tossInvestConnectionProps}
                  onSaveCredentials={(credentials) =>
                    saveAndProbeTossInvestCredentials(credentials, { closeDialog: true })
                  }
                  onUnlockVault={(payload) => unlockAndProbeTossInvestVault(payload, { closeDialog: true })}
                />
              </React.Suspense>
            </div>
          </div>
        </div>
      ) : null}

      <AppRoutes activeView={activeView} models={routeModels} />
      {isFullWidthCanvasView ? null : (
        <AgentSidebar
          addChatAttachmentFiles={addChatAttachmentFiles}
          agentIcon={sidebarAgentRuntime.icon}
          agentOptionsReady={agentOptionsReady}
          agentProvider={sidebarAgentRuntime.provider}
          agentProviderAvailable={sidebarAgentRuntime.providerAvailable}
          agentProviderLabel={sidebarAgentRuntime.providerLabel}
          attachedArticle={activeAttachedArticle}
          attachmentError={activeAttachmentError}
          chatAttachments={activeChatAttachments}
          codexStatus={codexStatus}
          commandPreview={sidebarAgentRuntime.commandPreview}
          fileInputRef={fileInputRef}
          handleComposerDragEnter={handleComposerDragEnter}
          handleComposerDragLeave={handleComposerDragLeave}
          handleComposerDragOver={handleComposerDragOver}
          handleComposerDrop={handleComposerDrop}
          handleComposerPaste={handleComposerPaste}
          isComposerDragging={isComposerDragging}
          isSending={isSending}
          messageStackRef={messageStackRef}
          activeWorldMemoryActionId={worldMemoryAgentAction?.id || ""}
          runningWorldMemoryAgentActionId={worldMemoryRunningAgentActionId}
          onClearAttachedArticle={() => clearAttachedArticleForScope(activeChatScope)}
          onExecuteWorldMemoryAction={executeWorldMemoryAgentAction}
          onNewChat={startNewChat}
          onPromptChange={(nextPrompt) => setPromptForScope(activeChatScope, nextPrompt)}
          onRemoveChatAttachment={removeChatAttachment}
          onSaveAnswerToReports={saveChatAnswerToReports}
          onSelectApproval={(nextApproval) => updateProviderSelection(sidebarAgentRuntime.provider, { approval: nextApproval })}
          onSelectModel={(nextModel) => updateProviderSelection(sidebarAgentRuntime.provider, { model: nextModel })}
          onSelectReasoning={(nextReasoning) => updateProviderSelection(sidebarAgentRuntime.provider, { reasoning: nextReasoning })}
          onSelectSpeed={(nextSpeed) => updateProviderSelection(sidebarAgentRuntime.provider, { speed: nextSpeed })}
          onStopSend={stopActiveChatResponse}
          prompt={activePrompt}
          promptHeight={promptHeight}
          promptOverflow={promptOverflow}
          promptRef={promptRef}
          selectedProvider={sidebarAgentRuntime.selectedProvider}
          sendPrompt={sendPrompt}
          toolbarApprovalOptions={agentOptionsReady ? sidebarAgentRuntime.approvalOptions : loadingApprovalOptions}
          toolbarApprovalValue={agentOptionsReady ? sidebarAgentRuntime.selectedApproval?.id : "loading"}
          toolbarModelGroups={agentOptionsReady ? sidebarAgentRuntime.modelGroups : loadingModelGroups}
          toolbarModelValue={agentOptionsReady ? sidebarAgentRuntime.selectedModelGroup?.slug : "loading"}
          toolbarReasoningValue={agentOptionsReady ? sidebarAgentRuntime.selectedReasoning?.id : "loading"}
          toolbarSpeedValue={agentOptionsReady ? sidebarAgentRuntime.selectedSpeed?.id : "loading"}
          visibleChatMessages={visibleChatMessages}
          worldMemoryActionBusy={worldMemoryActionBusy}
        />
      )}

      <PortfolioCanvasDeleteDialog
        canvas={pendingDeletePortfolioCanvas}
        onCancel={cancelDeletePortfolioCanvas}
        onConfirm={confirmDeletePortfolioCanvas}
      />
    </main>
  );
}

export default App;
