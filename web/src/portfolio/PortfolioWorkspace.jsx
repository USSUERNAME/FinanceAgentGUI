import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  portfolioWidgetActionRoute,
  PORTFOLIO_WIDGET_ACTION_ROUTES,
} from "./widgetActions.js";
import { buildPortfolioAllocationChartActionState } from "./allocationActions.js";
import {
  portfolioWidgetCanRestoreTable,
  portfolioWidgetRestoreTableSource,
} from "./backtestResults.js";
import {
  formatPortfolioPercent,
  parsePortfolioInput,
  portfolioSummaryValueLabel,
  summarizePortfolioRows,
} from "./holdingsSummary.js";
import { buildPortfolioContextPacket } from "./contextPacketBuilder.js";
import {
  cleanPortfolioWidgetText as cleanPortfolioWidgetPrompt,
  nextPortfolioWidgetDisplayId,
  nextPortfolioWidgetDisplayIndex,
} from "./widgetIdentity.js";
import {
  canPlacePortfolioWidget,
  findPortfolioWidgetPlacement,
} from "./widgetLayout.js";
import {
  portfolioWidgetLooksLikeMetricsTarget as isPortfolioWidgetMetricsTarget,
  portfolioWidgetUsesYfinanceRefresh,
} from "./widgetRoleClassifier.js";
import { PortfolioWidgetCanvas } from "./PortfolioWidgetCanvas.jsx";
import { PortfolioGuidePage } from "./PortfolioGuidePage.jsx";
import { PortfolioWidgetDeleteDialog } from "./PortfolioWidgetDeleteDialog.jsx";
import { PortfolioWidgetModal } from "./PortfolioWidgetModal.jsx";
import {
  PortfolioTossApiStatus,
  PortfolioWorkspaceHeader,
} from "./PortfolioWorkspaceHeader.jsx";
import { PortfolioWorkspaceLegacyPanel } from "./PortfolioWorkspaceLegacyPanel.jsx";
import {
  PORTFOLIO_CANVAS_MODES,
  portfolioCanvasModeList,
  portfolioCanvasModeMeta,
} from "./canvasModes.jsx";
import {
  portfolioSchemaTables,
  portfolioTheoryPrinciples,
} from "./workspaceReferenceContent.js";
import {
  markPortfolioWidgetMissingDependency,
  sortPortfolioWidgetsForRefresh,
} from "./widgetStateTransitions.js";
import { selectPortfolioAutoRefreshCandidate } from "./widgetAutoRefresh.js";
import { buildPortfolioAgentWidgetActionApplyState } from "./widgetAgentActionApply.js";
import { buildDerivedPortfolioWidgetRefreshRequest } from "./widgetRefreshPrompts.js";
import { buildPortfolioMetricsTableSyncPatch } from "./widgetMetrics.js";
import {
  portfolioAssetEvaluationMetricColumns,
  portfolioWidgetIsAssetEvaluationTable,
} from "./portfolioAssetMetrics.js";
import { buildPortfolioRestoreTableActionState } from "./widgetRestore.js";
import {
  buildPortfolioBacktestChartPreparation,
  buildPortfolioBacktestFailureWidgets,
  buildPortfolioBacktestMissingSourceWidgets,
  buildPortfolioBacktestReadyWidgets,
  buildPortfolioBacktestRunningWidgets,
  buildPortfolioBacktestUnsupportedStrategyWidgets,
  executePortfolioBacktestChartRun,
} from "./backtestChartRun.js";
import {
  buildPortfolioLiveBacktestPayload,
  executePortfolioLiveBacktest,
} from "./liveBacktestRun.js";
import {
  clampPortfolioAssetHistoryRange,
  compactPortfolioWidget,
  normalizePortfolioAssetHistoryDate,
  normalizePortfolioAssetHistoryDisplayRange,
  normalizePortfolioAssetHistoryRange,
  normalizePortfolioAgentActionKeys,
  normalizePortfolioStrategyPortfolios,
  normalizePortfolioWidgets,
  normalizePortfolioWorkspaceState,
  portfolioAssetHistoryTodayDate,
  safePortfolioBacktestPayload,
} from "./workspaceState.js";
import {
  PORTFOLIO_SCENARIO_ROOT_ID,
  normalizePortfolioScenarioSpec,
} from "./scenarioContract.js";
import { portfolioWidgetDownstreamDependents } from "./widgetRelations.js";
import { normalizePortfolioWidgetVisualType } from "./widgetTypes.js";

function tossInvestConnectionIsReady(status, error = "", orderSyncError = "") {
  if (error || orderSyncError) return false;
  const credentials = status?.credentials || {};
  const usable = Boolean(credentials.usable || credentials.unlocked);
  return Boolean((status?.connected || status?.token?.cached) && usable);
}

function tossInvestSnapshotIsComplete(orderSyncStatus, busy = false, error = "") {
  if (busy || error) return false;
  const reconstruction = orderSyncStatus?.reconstruction || {};
  return reconstruction.ok === true;
}

function portfolioWidgetIsAssetPriceHistory(widget = {}) {
  return normalizePortfolioWidgetVisualType(widget?.visualType || widget?.chartSpec?.type) === "price-history";
}

function portfolioWidgetIsPositionStatus(widget = {}) {
  return normalizePortfolioWidgetVisualType(widget?.visualType || widget?.chartSpec?.type) === "position-status";
}

function portfolioWidgetIsSeasonalComparison(widget = {}) {
  return normalizePortfolioWidgetVisualType(widget?.visualType || widget?.chartSpec?.type) === "seasonal-comparison";
}

function portfolioWidgetUsesAssetHistoryCurrency(widget = {}) {
  return portfolioWidgetIsAssetPriceHistory(widget) || portfolioWidgetIsPositionStatus(widget) || portfolioWidgetIsSeasonalComparison(widget);
}

function normalizeAssetHistoryCurrency(value = "") {
  return String(value || "").toUpperCase() === "USD" ? "USD" : "KRW";
}

function normalizePositionStatusView(value = "") {
  return String(value || "").toLowerCase() === "pie" ? "pie" : "bar";
}

function assetHistoryCurrencyFromWidget(widget = {}) {
  return normalizeAssetHistoryCurrency(
    widget?.chartSpec?.query?.currency ||
      widget?.chartSpec?.currency ||
      widget?.chartSpec?.valueCurrency ||
      widget?.currency ||
      "KRW"
  );
}

function positionStatusViewFromWidget(widget = {}) {
  return normalizePositionStatusView(widget?.chartSpec?.query?.view || widget?.chartSpec?.view || widget?.view || "bar");
}

function assetHistoryChartQueryFromRange(range = {}, { minimumDate = "", maximumDate = "" } = {}) {
  const clamped = normalizePortfolioAssetHistoryDisplayRange(range, { minimumDate, maximumDate });
  const startIsCustom = Boolean(clamped.startDate);
  const endIsCustom = Boolean(clamped.endDate);
  return {
    startDate: clamped.startDate,
    startMode: startIsCustom ? "custom" : "first_trade",
    effectiveStartDate: startIsCustom ? clamped.startDate : minimumDate,
    endDate: clamped.endDate,
    endMode: endIsCustom ? "custom" : "latest",
    effectiveEndDate: endIsCustom ? clamped.endDate : "",
    effectiveEndLabel: endIsCustom ? "" : "latest",
    timeframe: clamped.timeframe || "1d",
  };
}

function positionStatusChartQueryFromRange(range = {}, { minimumDate = "", maximumDate = "" } = {}) {
  const clamped = normalizePortfolioAssetHistoryDisplayRange(range, { minimumDate, maximumDate });
  const endIsCustom = Boolean(clamped.endDate);
  return {
    endDate: clamped.endDate,
    endMode: endIsCustom ? "custom" : "latest",
    effectiveEndDate: endIsCustom ? clamped.endDate : "",
    effectiveEndLabel: endIsCustom ? "" : "latest",
  };
}

export function PortfolioWorkspace({
  canvas,
  onWorkspaceChange,
  onRenameCanvas,
  onOpenGuide,
  onContextChange,
  onWidgetPromptRequest,
  agentWidgetAction,
  onAgentWidgetActionConsumed,
  tossInvestError = "",
  tossInvestErrorCode = "",
  tossInvestBusy = false,
  tossInvestStatus = null,
  tossInvestPublicIp = null,
  tossInvestPublicIpBusy = false,
  tossInvestPublicIpError = "",
  tossInvestOrderSyncStatus = null,
  tossInvestOrderSyncBusy = false,
  tossInvestOrderSyncAction = "",
  tossInvestOrderSyncError = "",
  tossInvestOrderSyncErrorCode = "",
  onOpenSettings,
  onDeleteTossInvestCredentials,
  onProbeTossInvestConnection,
  onRunTossInvestOrderSync,
  onCheckTossInvestPublicIp,
}) {
  const initialWorkspaceState = useMemo(
    () => normalizePortfolioWorkspaceState(canvas?.workspace, { forceStarted: true }),
    [canvas?.id]
  );
  const canvasName = canvas?.name || "포트폴리오 캔버스";
  const canvasModeMeta = portfolioCanvasModeMeta(canvas?.mode);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(canvasName);
  const titleInputRef = useRef(null);
  const [workspaceStarted, setWorkspaceStarted] = useState(initialWorkspaceState.workspaceStarted);
  const [inputText, setInputText] = useState(initialWorkspaceState.inputText);
  const [backtestPeriod, setBacktestPeriod] = useState(initialWorkspaceState.backtestPeriod);
  const [assetHistoryRange, setAssetHistoryRange] = useState(initialWorkspaceState.assetHistoryRange);
  const [benchmark, setBenchmark] = useState(initialWorkspaceState.benchmark);
  const [workspaceStatus, setWorkspaceStatus] = useState(initialWorkspaceState.workspaceStatus);
  const [activityLog, setActivityLog] = useState(initialWorkspaceState.activityLog);
  const [liveBacktest, setLiveBacktest] = useState(initialWorkspaceState.liveBacktest);
  const [widgets, setWidgets] = useState(initialWorkspaceState.widgets);
  const [scenario, setScenario] = useState(initialWorkspaceState.scenario);
  const [nextWidgetDisplayIndex, setNextWidgetDisplayIndex] = useState(initialWorkspaceState.nextWidgetDisplayIndex);
  const [strategyPortfolios] = useState(initialWorkspaceState.strategyPortfolios);
  const [processedAgentActionKeys, setProcessedAgentActionKeys] = useState(initialWorkspaceState.processedAgentActionKeys);
  const [widgetDraft, setWidgetDraft] = useState(null);
  const [widgetModalError, setWidgetModalError] = useState("");
  const [pendingDeleteWidget, setPendingDeleteWidget] = useState(null);
  const [liveBacktestBusy, setLiveBacktestBusy] = useState(false);
  const [canvasRefreshBusy, setCanvasRefreshBusy] = useState(false);
  const [liveBacktestError, setLiveBacktestError] = useState("");
  const [widgetDisplayDataState, setWidgetDisplayDataState] = useState(() => ({
    canvasId: canvas?.id || "",
    byId: {},
  }));
  const nextWidgetDisplayIndexRef = useRef(initialWorkspaceState.nextWidgetDisplayIndex);
  const portfolioDependencyAutoRunIdsRef = useRef(new Set());
  const processedAgentActionKeysRef = useRef(new Set(initialWorkspaceState.processedAgentActionKeys));

  const holdings = useMemo(() => parsePortfolioInput(inputText), [inputText]);
  const summary = useMemo(() => summarizePortfolioRows(holdings), [holdings]);
  const hasLiveBacktest = Boolean(liveBacktest?.ok && Array.isArray(liveBacktest.series) && liveBacktest.series.length);
  const isWidgetCanvasMode = !holdings.length;
  const isAssetCanvasMode = canvasModeMeta.id === PORTFOLIO_CANVAS_MODES.asset.id;
  const canvasRefreshTargets = useMemo(
    () => isAssetCanvasMode ? [] : sortPortfolioWidgetsForRefresh(widgets.filter(portfolioWidgetUsesYfinanceRefresh), widgets),
    [isAssetCanvasMode, widgets]
  );
  const tossInvestReady = tossInvestConnectionIsReady(tossInvestStatus, tossInvestError, tossInvestOrderSyncError);
  const tossInvestSnapshotComplete = tossInvestSnapshotIsComplete(
    tossInvestOrderSyncStatus,
    tossInvestOrderSyncBusy,
    tossInvestOrderSyncError
  );
  const assetHistoryMinimumDate = normalizePortfolioAssetHistoryDate(
    tossInvestOrderSyncStatus?.store?.earliestOrderedAt || tossInvestOrderSyncStatus?.store?.earliestFilledAt || ""
  );
  const assetHistoryMaximumDate = portfolioAssetHistoryTodayDate();
  const showAssetHistoryPanel = Boolean(
    isWidgetCanvasMode &&
      isAssetCanvasMode &&
      tossInvestReady &&
      tossInvestSnapshotComplete &&
      assetHistoryMinimumDate
  );
  const visibleAssetHistoryRange = useMemo(
    () =>
      normalizePortfolioAssetHistoryDisplayRange(assetHistoryRange, {
        minimumDate: assetHistoryMinimumDate,
        maximumDate: assetHistoryMaximumDate,
      }),
    [assetHistoryMaximumDate, assetHistoryMinimumDate, assetHistoryRange]
  );
  const assetHistoryContextRange = useMemo(() => {
    if (!showAssetHistoryPanel) return null;
    const startIsCustom = Boolean(visibleAssetHistoryRange.startDate);
    const endIsCustom = Boolean(visibleAssetHistoryRange.endDate);
    return {
      ...visibleAssetHistoryRange,
      startMode: startIsCustom ? "custom" : "first_trade",
      effectiveStartDate: startIsCustom ? visibleAssetHistoryRange.startDate : assetHistoryMinimumDate,
      endMode: endIsCustom ? "custom" : "latest",
      effectiveEndDate: endIsCustom ? visibleAssetHistoryRange.endDate : "",
      effectiveEndLabel: endIsCustom ? "" : "latest",
    };
  }, [assetHistoryMinimumDate, showAssetHistoryPanel, visibleAssetHistoryRange]);
  const widgetDisplayDataById = widgetDisplayDataState.canvasId === (canvas?.id || "")
    ? widgetDisplayDataState.byId
    : {};

  const handleWidgetDisplayData = useCallback((widgetId, displayData) => {
    const cleanWidgetId = String(widgetId || "").trim();
    if (!cleanWidgetId) return;
    const canvasId = canvas?.id || "";
    setWidgetDisplayDataState((current) => {
      const currentById = current.canvasId === canvasId ? current.byId : {};
      if (!displayData) {
        if (!(cleanWidgetId in currentById)) return current;
        const nextById = { ...currentById };
        delete nextById[cleanWidgetId];
        return { canvasId, byId: nextById };
      }
      if (currentById[cleanWidgetId] === displayData) return current;
      return {
        canvasId,
        byId: { ...currentById, [cleanWidgetId]: displayData },
      };
    });
  }, [canvas?.id]);

  useEffect(() => {
    if (!titleEditing) {
      setTitleDraft(canvasName);
    }
  }, [canvasName, titleEditing]);

  useEffect(() => {
    if (!showAssetHistoryPanel) return;
    const current = normalizePortfolioAssetHistoryRange(assetHistoryRange);
    if (
      current.startDate === visibleAssetHistoryRange.startDate &&
      current.endDate === visibleAssetHistoryRange.endDate &&
      current.timeframe === visibleAssetHistoryRange.timeframe
    ) {
      return;
    }
    setAssetHistoryRange(visibleAssetHistoryRange);
  }, [assetHistoryRange, showAssetHistoryPanel, visibleAssetHistoryRange]);

  useEffect(() => {
    if (!titleEditing) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [titleEditing]);

  function saveCanvasTitleDraft() {
    const cleanName = cleanPortfolioWidgetPrompt(titleDraft, 80);
    if (cleanName && cleanName !== canvasName) {
      onRenameCanvas?.(cleanName);
      setTitleDraft(cleanName);
    } else {
      setTitleDraft(canvasName);
    }
    setTitleEditing(false);
  }

  function cancelCanvasTitleEdit() {
    setTitleDraft(canvasName);
    setTitleEditing(false);
  }

  function handleCanvasTitleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      saveCanvasTitleDraft();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelCanvasTitleEdit();
    }
  }

  const contextPacket = useMemo(
    () =>
      buildPortfolioContextPacket({
        canvas,
        canvasModeMeta,
        assetCanvasModeId: PORTFOLIO_CANVAS_MODES.asset.id,
        workspaceStarted,
        isWidgetCanvasMode,
        workspaceStatus,
        strategyPortfolios,
        scenario,
        assetHistoryRange: assetHistoryContextRange,
        widgets,
        canvasRefreshTargets,
        holdings,
        summary,
        backtestPeriod,
        benchmark,
        liveBacktestBusy,
        hasLiveBacktest,
        liveBacktestError,
        liveBacktest,
        portfolioSchemaTables,
        portfolioTheoryPrinciples,
        activityLog,
        widgetDisplayDataById,
      }),
    [
      activityLog,
      assetHistoryContextRange,
      showAssetHistoryPanel,
      backtestPeriod,
      benchmark,
      canvas?.id,
      canvas?.name,
      canvas?.mode,
      canvasModeMeta,
      canvasRefreshTargets,
      hasLiveBacktest,
      holdings,
      liveBacktest,
      liveBacktestBusy,
      liveBacktestError,
      summary,
      isWidgetCanvasMode,
      strategyPortfolios,
      scenario,
      widgets,
      workspaceStarted,
      workspaceStatus,
      widgetDisplayDataById,
    ]
  );

  useEffect(() => {
    onContextChange?.(contextPacket);
  }, [contextPacket, onContextChange]);

  useEffect(() => {
    nextWidgetDisplayIndexRef.current = Math.max(Number(nextWidgetDisplayIndex) || 1, nextPortfolioWidgetDisplayIndex(widgets));
  }, [nextWidgetDisplayIndex, widgets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = {
      workspaceStarted,
      inputText,
      backtestPeriod,
      assetHistoryRange: normalizePortfolioAssetHistoryRange(assetHistoryRange),
      benchmark,
      workspaceStatus,
      activityLog,
      liveBacktest: safePortfolioBacktestPayload(liveBacktest),
      widgets: normalizePortfolioWidgets(widgets).map(compactPortfolioWidget),
      scenario: normalizePortfolioScenarioSpec(scenario, { backtestPeriod }),
      nextWidgetDisplayIndex: Math.max(Number(nextWidgetDisplayIndex) || 1, nextPortfolioWidgetDisplayIndex(widgets)),
      strategyPortfolios: normalizePortfolioStrategyPortfolios(strategyPortfolios),
      processedAgentActionKeys: normalizePortfolioAgentActionKeys(processedAgentActionKeys),
    };
    onWorkspaceChange?.(payload);
  }, [activityLog, assetHistoryRange, backtestPeriod, benchmark, inputText, liveBacktest, nextWidgetDisplayIndex, onWorkspaceChange, processedAgentActionKeys, scenario, strategyPortfolios, widgets, workspaceStarted, workspaceStatus]);

  function appendLog(message) {
    setActivityLog((current) => [...current.slice(-7), message]);
  }

  function rememberProcessedAgentActionKey(key = "") {
    const normalizedKey = cleanPortfolioWidgetPrompt(key, 180);
    if (!normalizedKey || processedAgentActionKeysRef.current.has(normalizedKey)) return;
    processedAgentActionKeysRef.current.add(normalizedKey);
    setProcessedAgentActionKeys((current) => normalizePortfolioAgentActionKeys([...current, normalizedKey]));
  }

  function reservePortfolioWidgetDisplayId(currentWidgets = widgets) {
    const index = Math.max(Number(nextWidgetDisplayIndexRef.current) || 1, nextPortfolioWidgetDisplayIndex(currentWidgets));
    const nextIndex = index + 1;
    nextWidgetDisplayIndexRef.current = nextIndex;
    setNextWidgetDisplayIndex((current) => Math.max(Number(current) || 1, nextIndex));
    return nextPortfolioWidgetDisplayId(currentWidgets, index);
  }

  useEffect(() => {
    const applyState = buildPortfolioAgentWidgetActionApplyState({
      agentWidgetAction,
      canvasId: canvas?.id,
      currentWidgets: widgets,
      currentScenario: scenario,
      processedActionKeys: processedAgentActionKeysRef.current,
      nextDisplayIndex: nextWidgetDisplayIndexRef.current,
      canvasModeId: canvasModeMeta.id,
      assetCanvasModeId: PORTFOLIO_CANVAS_MODES.asset.id,
    });
    if (["ignored", "wrong-canvas"].includes(applyState.status)) return;
    if (applyState.consumeId) onAgentWidgetActionConsumed?.(applyState.consumeId);
    if (applyState.status === "duplicate") return;
    rememberProcessedAgentActionKey(applyState.actionKey);
    if (applyState.refreshCanvasLatestData) {
      void refreshPortfolioCanvasLatestData();
      return;
    }
    if (applyState.runBacktestWidgetId) {
      if (applyState.workspaceStarted) setWorkspaceStarted(true);
      if (applyState.scenario) setScenario(applyState.scenario);
      (applyState.logMessages || []).forEach(appendLog);
      const targetWidget = widgets.find((widget) => widget.id === applyState.runBacktestWidgetId);
      if (targetWidget) {
        void runPortfolioWidgetBacktestChart(targetWidget, [], {
          scenarioOverride: applyState.scenario || scenario,
        });
      } else {
        appendLog("백테스트 업데이트 보류 · 대상 위젯 없음");
      }
      return;
    }
    if (applyState.backtestMatrixPrompt) {
      if (applyState.workspaceStarted) setWorkspaceStarted(true);
      if (applyState.scenario) setScenario(applyState.scenario);
      (applyState.logMessages || []).forEach(appendLog);
      onWidgetPromptRequest?.({
        ...(agentWidgetAction.request || {}),
        action: agentWidgetAction.request?.action || "create",
        prompt: applyState.backtestMatrixPrompt,
        source: "backtest-matrix-context",
        backtestMatrixContext: true,
      });
      return;
    }
    if (applyState.workspaceStarted) setWorkspaceStarted(true);
    if (applyState.rememberWorkspace) {
      setWorkspaceStatus((current) => (current === "draft" ? "remembered" : current));
    }
    if (applyState.scenario) setScenario(applyState.scenario);
    setWidgets(applyState.widgets);
    nextWidgetDisplayIndexRef.current = applyState.nextDisplayIndex;
    setNextWidgetDisplayIndex((current) => Math.max(Number(current) || 1, applyState.nextDisplayIndex));
    (applyState.logMessages || []).forEach(appendLog);
    const contractRetryCount = Math.max(0, Number(agentWidgetAction?.request?.contractRetryCount || 0) || 0);
    if (applyState.status === "action-contract-invalid" && applyState.contractError && contractRetryCount < 3) {
      const originalPrompt = cleanPortfolioWidgetPrompt(agentWidgetAction?.request?.prompt || "", 1200);
      const retryTargetWidget = widgets.find(
        (widget) =>
          widget.id === applyState.contractError.widgetId ||
          widget.displayId === applyState.contractError.displayId
      );
      const contractGuidance = {
        target_type_mismatch: [
          "기존 table/function/line/metrics 위젯을 markdown으로 바꾸거나 markdown 새 위젯으로 우회하지 마세요.",
          "수정이면 같은 widgetId/widgetDisplayId를 대상으로 기존 visualType을 유지한 update_widget을 보내고, 별도 문서가 필요하면 action=create_widget으로 명확히 분리하세요.",
        ],
        repair_must_preserve_widget_type: [
          "관계/의존성 수리 응답은 기존 위젯 타입을 유지하는 update_widget이어야 합니다.",
          "마크다운 설명 대신 dependsOn, derivedFrom, chartSpec, functionSpec, nextActions 같은 실행 계약 필드를 고치세요.",
        ],
        matrix_dsl_program_required: [
          "portfolio-matrix-dsl 함수 위젯을 만들려면 functionSpec.program 배열을 완성해서 포함해야 합니다.",
          "strategy-dsl, signal-rules, threshold_rebalance 같은 레거시 함수 경로는 더 이상 허용되지 않습니다.",
        ],
        matrix_dsl_required: [
          "함수 위젯은 portfolio-matrix-dsl만 사용할 수 있습니다.",
          "functionSpec.language='portfolio-matrix-dsl', executionMode='matrix-dsl', outputs=['signal_matrix'], program=[...]을 제공하세요.",
        ],
        missing_widget_visual_type: [
          "모든 새 widget에는 canonical widget.visualType을 명시해야 합니다: table, function, line, price-history, position-status, seasonal-comparison, metrics-table, markdown, allocation, checklist.",
          "memo 또는 프롬프트 위젯 fallback은 저장 대상이 아닙니다. 원래 요청에 맞는 실제 산출물 타입으로 다시 작성하세요.",
        ],
        missing_backtest_source: [
          "백테스트 line 위젯은 source_matrix table/allocation 위젯을 dependsOn 또는 chartSpec.sourceWidgetIds로 참조해야 합니다.",
          "필요하면 먼저 포트폴리오 입력 table 위젯을 만들고, 백테스트 위젯이 그 id를 참조하게 하세요.",
        ],
        missing_metric_rows: [
          "metrics-table 위젯은 chartSpec.metrics rows를 직접 갖거나 backtest_result line 위젯을 dependsOn으로 참조해야 합니다.",
          "계산되지 않은 지표표를 문서/markdown으로 대체하지 마세요.",
        ],
        missing_asset_comparison_sources: [
          "복수 ETF/자산 비교는 각 비교 대상을 독립 source_matrix 위젯으로 만들고 백테스트 위젯이 2개 이상을 참조해야 합니다.",
          "단일 포트폴리오 표에 여러 종목을 넣으면 혼합 포트폴리오로 계산됩니다.",
        ],
      };
      const retryPrompt = [
        "직전 포트폴리오 위젯 액션이 GUI 계약 하네스에서 거절되었습니다.",
        `거절 사유: ${applyState.contractError.message}`,
        "같은 사용자 요청을 다시 처리하세요.",
        ...(contractGuidance[applyState.contractError.code] || [
          "거절된 계약을 보강한 complete portfolio_widget_action JSON으로 다시 응답하세요.",
        ]),
        originalPrompt ? `원래 사용자 요청: ${originalPrompt}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      appendLog(`계약 오류 재요청 · ${applyState.contractError.displayId || applyState.contractError.title || "함수 위젯"}`);
      onWidgetPromptRequest?.({
        ...(agentWidgetAction.request || {}),
        action: retryTargetWidget ? "edit" : agentWidgetAction.request?.action || "create",
        widgetId: retryTargetWidget?.id || agentWidgetAction.request?.widgetId || applyState.contractError.widgetId || "",
        widgetDisplayId:
          retryTargetWidget?.displayId ||
          agentWidgetAction.request?.widgetDisplayId ||
          applyState.contractError.displayId ||
          "",
        widget: retryTargetWidget || agentWidgetAction.request?.widget,
        prompt: retryPrompt,
        source: "contract-harness",
        contractRetryCount: contractRetryCount + 1,
        contractError: applyState.contractError,
      });
    }
  }, [agentWidgetAction]);

  function startPortfolioWorkspace() {
    setWorkspaceStarted(true);
    setWorkspaceStatus((current) => (current === "draft" ? "remembered" : current));
    appendLog("캔버스 시작");
  }

  function reopenPortfolioGuide() {
    onOpenGuide?.();
    appendLog("도움말 페이지 열림");
  }

  function openWidgetCreateModal(cell) {
    setWidgetModalError("");
    setWidgetDraft({
      mode: "agent-create",
      x: cell.x,
      y: cell.y,
      prompt: "",
    });
  }

  function openScenarioPromptModal() {
    setWidgetModalError("");
    setWidgetDraft({
      mode: "scenario",
      x: 0,
      y: 0,
      prompt: "",
    });
  }

  function closeWidgetModal() {
    setWidgetDraft(null);
    setWidgetModalError("");
  }

  function submitWidgetDraft(form) {
    if (!widgetDraft) return;
    const promptText = cleanPortfolioWidgetPrompt(form?.prompt || "", 1200);
    if (!promptText) {
      setWidgetModalError("사이드바 에이전트에게 보낼 프롬프트를 입력해 주세요.");
      return;
    }
    const attachments = Array.isArray(form?.attachments) ? form.attachments : [];
    const isScenarioRequest = widgetDraft.mode === "scenario";
    const prompt = isScenarioRequest
      ? [
          "고정 시나리오 패널 설정 요청입니다.",
          `현재 기본값: 기간 ${scenario?.runs?.[0]?.period || backtestPeriod}, 타임프레임 ${scenario?.runs?.[0]?.timeframe || "1d"}.`,
          "사용자가 입력한 기간/타임프레임 또는 여러 기간을 해석해 시나리오 격자와 필요한 위젯 플로우를 제안해 주세요.",
          "",
          promptText,
        ].join("\n")
      : promptText;
    onWidgetPromptRequest?.({
      action: "create",
      prompt,
      attachments,
      source: isScenarioRequest ? "scenario-panel" : "canvas-empty-cell",
      scenario,
      widget: isScenarioRequest
        ? null
        : {
            x: widgetDraft.x,
            y: widgetDraft.y,
            w: 1,
            h: 1,
            title: "에이전트 위젯 요청",
            prompt: promptText,
          },
    });
    appendLog(`${isScenarioRequest ? "시나리오" : "빈 칸"} 에이전트 요청 · ${promptText.slice(0, 48)}`);
    closeWidgetModal();
  }

  function deletePortfolioWidgets(widgetIds = []) {
    const requestedIds = new Set(widgetIds.filter(Boolean));
    if (!requestedIds.size) return;
    const targets = widgets.filter((widget) => requestedIds.has(widget.id));
    setWidgets((current) => {
      const removed = current.filter((widget) => requestedIds.has(widget.id));
      let next = current.filter((widget) => !requestedIds.has(widget.id));
      for (const target of removed) {
        next = markPortfolioWidgetMissingDependency(next, target, target.displayId || target.title);
      }
      return next;
    });
    appendLog(`위젯 삭제 · ${targets.map((target) => target.title).filter(Boolean).join(", ") || [...requestedIds].join(", ")}`);
  }

  function deletePortfolioWidget(widgetId) {
    deletePortfolioWidgets([widgetId]);
  }

  function requestDeletePortfolioWidget(widget) {
    if (!widget?.id) return;
    const dependents = portfolioWidgetDownstreamDependents(widget, widgets);
    if (dependents.length) {
      const cascadeDependents = dependents.filter((candidate) =>
        portfolioWidgetIsAssetEvaluationTable(candidate, widget.id)
      );
      setPendingDeleteWidget({ target: widget, dependents, cascadeDependents });
      appendLog(`위젯 삭제 확인 필요 · ${widget.displayId || widget.title} → 하위 ${dependents.length}개`);
      return;
    }
    deletePortfolioWidget(widget.id);
  }

  function cancelDeletePortfolioWidget() {
    setPendingDeleteWidget(null);
  }

  function confirmDeletePortfolioWidget() {
    const target = pendingDeleteWidget?.target;
    if (!target?.id) return;
    deletePortfolioWidgets([
      target.id,
      ...(pendingDeleteWidget?.cascadeDependents || []).map((widget) => widget.id),
    ]);
    setPendingDeleteWidget(null);
  }

  function createAssetEvaluationTable(sourceWidget) {
    if (!portfolioWidgetIsAssetPriceHistory(sourceWidget)) return;
    const existing = widgets.find((widget) => portfolioWidgetIsAssetEvaluationTable(widget, sourceWidget.id));
    if (existing) {
      deletePortfolioWidget(existing.id);
      return;
    }
    const now = new Date().toISOString();
    const displayId = reservePortfolioWidgetDisplayId(widgets);
    const id = `asset_evaluation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const preferredPlacement = {
      x: 0,
      y: Math.max(0, Number(sourceWidget.y || 0) + Number(sourceWidget.h || 1)),
      w: 3,
      h: 2,
    };
    const placement = canPlacePortfolioWidget(widgets, preferredPlacement)
      ? preferredPlacement
      : findPortfolioWidgetPlacement(widgets, 3, 2);
    const evaluationWidget = {
      id,
      displayId,
      graphRole: "process_node",
      scenarioId: sourceWidget.scenarioId || PORTFOLIO_SCENARIO_ROOT_ID,
      outputRole: "metrics",
      ...placement,
      title: "포트폴리오 평가 테이블",
      prompt: "보유 자산 과거 내역과 비교 자산의 선택 기간 성과 지표",
      kind: "포트폴리오 평가 테이블",
      status: "ready",
      agentSummary: "연결된 보유 자산 과거 내역의 기간과 비교 자산을 따라 평가 지표를 자동 계산합니다.",
      visualType: "metrics-table",
      dataset: [],
      chartSpec: {
        type: "metrics-table",
        role: "asset_history_evaluation",
        sourceWidgetId: sourceWidget.id,
        sourceWidgetIds: [sourceWidget.id],
        metricColumns: portfolioAssetEvaluationMetricColumns,
        betaBenchmark: "VOO",
      },
      functionSpec: null,
      signalMatrix: null,
      dataFiles: [],
      badges: ["자동 평가"],
      requirements: [],
      checks: [],
      nextActions: [],
      lastAgentAnswer: "",
      dependsOn: [sourceWidget.id],
      derivedFrom: [{
        widgetId: sourceWidget.id,
        field: "chartSpec.query",
        role: "asset_history_evaluation",
      }],
      updatePolicy: "auto",
      version: 1,
      lastComputedFrom: { [sourceWidget.id]: Number(sourceWidget.version || 1) },
      staleReason: "",
      staleSince: "",
      createdAt: now,
      updatedAt: now,
    };
    setWorkspaceStarted(true);
    setWorkspaceStatus((current) => (current === "draft" ? "remembered" : current));
    setWidgets((current) => current.some((widget) => portfolioWidgetIsAssetEvaluationTable(widget, sourceWidget.id))
      ? current
      : [...current, evaluationWidget]);
    appendLog(`평가 테이블 생성 · ${displayId} ← ${sourceWidget.displayId || sourceWidget.title}`);
  }

  function createAllocationChartFromWidget(sourceWidget) {
    const now = new Date().toISOString();
    const existingActionState = buildPortfolioAllocationChartActionState({
      currentWidgets: widgets,
      sourceWidget,
      now,
    });
    if (existingActionState.status === "missing-data") {
      appendLog(`파이차트 보류 · ${sourceWidget?.displayId || sourceWidget?.title || "위젯"} 보유 데이터 없음`);
      return;
    }
    const shouldCreate = existingActionState.status === "created";
    const displayId = shouldCreate ? reservePortfolioWidgetDisplayId(widgets) : "";
    const widgetId = shouldCreate ? `portfolio_widget_${Date.now()}` : "";
    setWorkspaceStarted(true);
    setWorkspaceStatus((current) => (current === "draft" ? "remembered" : current));
    setWidgets((current) => {
      const actionState = buildPortfolioAllocationChartActionState({
        currentWidgets: current,
        sourceWidget,
        id: widgetId,
        displayId,
        now,
      });
      return actionState.widgets;
    });
    appendLog(`${shouldCreate ? "파이차트 생성" : "파이차트 업데이트"} · ${sourceWidget.displayId || sourceWidget.title}`);
  }

  function freezeWorkspaceDraft() {
    setWorkspaceStatus("remembered");
    appendLog(`작업실 상태 기억 · ${holdings.length}개 holdings · ${portfolioSummaryValueLabel(summary)} · ${backtestPeriod}/${benchmark || "벤치마크 없음"}`);
  }

  function refreshInference() {
    setWorkspaceStatus("draft");
    setLiveBacktest(null);
    setLiveBacktestError("");
    appendLog(`스키마 재추론 · ${summary.classRows.length}개 자산군 · 상위3 ${formatPortfolioPercent(summary.top3Weight)}`);
  }

  function updateInputText(value) {
    setInputText(value);
    setWorkspaceStatus("draft");
    setLiveBacktest(null);
    setLiveBacktestError("");
  }

  async function refreshPortfolioCanvasLatestData() {
    if (canvasRefreshBusy) return;
    if (isAssetCanvasMode) {
      appendLog("캔버스 새로고침 보류 · 자산관리는 토스 증권 Open API 동기화 상태를 사용합니다.");
      return;
    }
    const targets = sortPortfolioWidgetsForRefresh(widgets.filter(portfolioWidgetUsesYfinanceRefresh), widgets);
    if (!targets.length) {
      appendLog("캔버스 새로고침 보류 · yfinance 기반 위젯이 없습니다.");
      return;
    }
    setCanvasRefreshBusy(true);
    setWorkspaceStatus("remembered");
    appendLog("캔버스 최신 정보 새로고침 시작 · yfinance");
    try {
      for (const target of targets) {
        await runPortfolioWidgetBacktestChart(target);
      }
      appendLog("캔버스 최신 정보 새로고침 완료");
    } finally {
      setCanvasRefreshBusy(false);
    }
  }

  function updateAssetHistoryRange(nextRange) {
    const normalizedRange = clampPortfolioAssetHistoryRange(nextRange, {
      minimumDate: assetHistoryMinimumDate,
      maximumDate: assetHistoryMaximumDate,
    });
    const query = assetHistoryChartQueryFromRange(normalizedRange, {
      minimumDate: assetHistoryMinimumDate,
      maximumDate: assetHistoryMaximumDate,
    });
    const updatedAt = new Date().toISOString();
    setAssetHistoryRange(normalizedRange);
    setWidgets((current) =>
      current.map((widget) => {
        if (portfolioWidgetIsAssetPriceHistory(widget)) {
          return {
              ...widget,
              chartSpec: {
                ...(widget.chartSpec || {}),
                query: {
                  ...(widget.chartSpec?.query || {}),
                  ...query,
                  currency: assetHistoryCurrencyFromWidget(widget),
                },
              },
              updatedAt,
          };
        }
        if (portfolioWidgetIsPositionStatus(widget)) {
          return {
            ...widget,
            chartSpec: {
              ...(widget.chartSpec || {}),
              query: {
                ...positionStatusChartQueryFromRange(normalizedRange, {
                  minimumDate: assetHistoryMinimumDate,
                  maximumDate: assetHistoryMaximumDate,
                }),
                currency: assetHistoryCurrencyFromWidget(widget),
                view: positionStatusViewFromWidget(widget),
              },
            },
            updatedAt,
          };
        }
        return widget;
      })
    );
  }

  function createAssetWidgetFromPicker({ cell, widgetType } = {}) {
    if (!["asset-investment-history", "asset-position-status", "asset-seasonal-comparison"].includes(widgetType)) return;
    const now = new Date().toISOString();
    const displayId = reservePortfolioWidgetDisplayId(widgets);
    const isPositionStatusWidget = widgetType === "asset-position-status";
    const isSeasonalComparisonWidget = widgetType === "asset-seasonal-comparison";
    const idPrefix = isPositionStatusWidget
      ? "asset_position_status"
      : isSeasonalComparisonWidget
        ? "asset_seasonal_comparison"
        : "asset_history";
    const id = `${idPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const preferredPlacement = {
      x: 0,
      y: Math.max(0, Number(cell?.y || 0)),
      w: 3,
      h: 3,
    };
    const placement = canPlacePortfolioWidget(widgets, preferredPlacement)
      ? preferredPlacement
      : findPortfolioWidgetPlacement(widgets, 3, 3);
    const query = assetHistoryChartQueryFromRange(visibleAssetHistoryRange, {
      minimumDate: assetHistoryMinimumDate,
      maximumDate: assetHistoryMaximumDate,
    });
    const positionStatusQuery = positionStatusChartQueryFromRange(visibleAssetHistoryRange, {
      minimumDate: assetHistoryMinimumDate,
      maximumDate: assetHistoryMaximumDate,
    });
    const seasonalComparisonQuery = {
      startDate: "",
      startMode: "first_trade",
      effectiveStartDate: assetHistoryMinimumDate,
      endDate: "",
      endMode: "latest",
      effectiveEndDate: "",
      effectiveEndLabel: "latest",
      timeframe: "1d",
      currency: "KRW",
      returnMode: "year_to_date",
    };
    const widgetMeta = isPositionStatusWidget
      ? {
          outputRole: "position_status",
          title: "투자 종목 현황",
          prompt: "토스 증권 Open API 거래내역 동기화 스냅샷의 기준일별 보유 종목 구성",
          kind: "투자 종목 현황",
          visualType: "position-status",
          badges: ["토스 증권 Open API"],
          chartSpec: {
            type: "position-status",
            engine: "react-css",
            chartType: "stacked-bar",
            role: "investment_position_status",
            dataProvider: "토스 증권 Open API",
            source: "tossinvest-position-reconstruction",
            query: {
              ...positionStatusQuery,
              currency: "KRW",
              view: "bar",
            },
          },
        }
      : isSeasonalComparisonWidget
        ? {
            outputRole: "seasonal_comparison",
            title: "시즌별 비교",
            prompt: "토스 증권 Open API 거래내역 동기화 스냅샷의 첫 거래 연도부터 최신 시점까지 연도별 YTD 수익률 비교",
            kind: "시즌별 비교",
            visualType: "seasonal-comparison",
            badges: ["Lightweight Charts"],
            chartSpec: {
              type: "seasonal-comparison",
              engine: "lightweight-charts",
              chartType: "line",
              role: "annual_return_overlay",
              dataProvider: "토스 증권 Open API",
              source: "tossinvest-position-reconstruction",
              query: seasonalComparisonQuery,
            },
          }
        : {
            outputRole: "asset_history",
            title: "보유 자산 과거 내역",
            prompt: "토스 증권 Open API 거래내역 동기화 스냅샷의 투자 원금 변경 내역",
            kind: "보유 자산 과거 내역 차트",
            visualType: "price-history",
            badges: ["Lightweight Charts"],
            chartSpec: {
              type: "price-history",
              engine: "lightweight-charts",
              chartType: "area",
              role: "asset_cost_basis_history",
              dataProvider: "토스 증권 Open API",
              source: "tossinvest-position-reconstruction",
              query: {
                ...query,
                currency: "KRW",
              },
            },
          };
    const widget = {
      id,
      displayId,
      graphRole: "process_node",
      scenarioId: PORTFOLIO_SCENARIO_ROOT_ID,
      outputRole: widgetMeta.outputRole,
      ...placement,
      title: widgetMeta.title,
      prompt: widgetMeta.prompt,
      kind: widgetMeta.kind,
      status: "ready",
      agentSummary: "",
      visualType: widgetMeta.visualType,
      dataset: [],
      chartSpec: widgetMeta.chartSpec,
      functionSpec: null,
      signalMatrix: null,
      dataFiles: [],
      badges: widgetMeta.badges,
      requirements: [],
      checks: [],
      nextActions: [],
      lastAgentAnswer: "",
      dependsOn: [],
      derivedFrom: [],
      updatePolicy: "auto",
      version: 1,
      lastComputedFrom: {},
      staleReason: "",
      staleSince: "",
      createdAt: now,
      updatedAt: now,
    };
    setWorkspaceStarted(true);
    setWorkspaceStatus((current) => (current === "draft" ? "remembered" : current));
    setWidgets((current) => [...current, widget]);
    appendLog(`위젯 생성 · ${displayId} ${widgetMeta.kind}`);
  }

  function updateAssetHistoryCurrency(widget, currency) {
    if (!portfolioWidgetUsesAssetHistoryCurrency(widget)) return;
    const nextCurrency = normalizeAssetHistoryCurrency(currency);
    const updatedAt = new Date().toISOString();
    setWidgets((current) =>
      current.map((item) =>
        item.id === widget.id && portfolioWidgetUsesAssetHistoryCurrency(item)
          ? {
              ...item,
              chartSpec: {
                ...(item.chartSpec || {}),
                currency: nextCurrency,
                valueCurrency: nextCurrency,
                query: {
                  ...(item.chartSpec?.query || {}),
                  currency: nextCurrency,
                },
              },
              updatedAt,
            }
          : item
      )
    );
    appendLog(`통화 전환 · ${widget.displayId || widget.title} · ${nextCurrency === "USD" ? "달러" : "원"}`);
  }

  function updatePositionStatusView(widget, view) {
    if (!portfolioWidgetIsPositionStatus(widget)) return;
    const nextView = normalizePositionStatusView(view);
    const updatedAt = new Date().toISOString();
    setWidgets((current) =>
      current.map((item) =>
        item.id === widget.id && portfolioWidgetIsPositionStatus(item)
          ? {
              ...item,
              chartSpec: {
                ...(item.chartSpec || {}),
                view: nextView,
                chartType: nextView === "pie" ? "pie" : "stacked-bar",
                query: {
                  ...(item.chartSpec?.query || {}),
                  view: nextView,
                },
              },
              updatedAt,
            }
          : item
      )
    );
    appendLog(`보기 전환 · ${widget.displayId || widget.title} · ${nextView === "pie" ? "원" : "사각형"}`);
  }

  async function runPortfolioWidgetBacktestChart(widget, overrideSources = [], options = {}) {
    if (!widget) return;
    const effectiveScenario = options.scenarioOverride || scenario;
    const preparation = buildPortfolioBacktestChartPreparation({
      widget,
      widgets,
      overrideSources,
      fallbackBenchmark: benchmark,
      scenario: effectiveScenario,
      backtestPeriod,
    });
    if (preparation.status === "missing-source") {
      setWidgets((current) =>
        buildPortfolioBacktestMissingSourceWidgets({
          currentWidgets: current,
          widgetId: widget.id,
        })
      );
      appendLog(`백테스트 차트 보류 · ${widget.title}`);
      return;
    }
    if (preparation.status === "unsupported-strategy") {
      setWidgets((current) =>
        buildPortfolioBacktestUnsupportedStrategyWidgets({
          currentWidgets: current,
          widgetId: widget.id,
          preparation,
        })
      );
      appendLog(`전략 백테스트 보류 · ${preparation.unsupportedText}`);
      return;
    }

    if (preparation.includeBenchmark) {
      setBenchmark(preparation.normalizedBenchmark);
    }
    setWidgets((current) =>
      buildPortfolioBacktestRunningWidgets({
        currentWidgets: current,
        widgetId: widget.id,
        preparation,
      })
    );
    appendLog(`백테스트 차트 실행 · ${preparation.backtestRequests.map((request) => request.label).join(", ")}`);

    try {
      const { results, resultModel, dependencyModel } = await executePortfolioBacktestChartRun({
        backtestRequests: preparation.backtestRequests,
        backtestPeriod,
        benchmarkPreference: preparation.benchmarkPreference,
        betaReferenceLabel: preparation.betaReferenceLabel,
        betaReferenceHoldings: preparation.betaReferenceHoldings,
        includeBenchmark: preparation.includeBenchmark,
        normalizedBenchmark: preparation.normalizedBenchmark,
        widget,
        runnableSources: preparation.runnableSources,
        supportedStrategySpecs: preparation.supportedStrategySpecs,
        betaReferenceSources: preparation.betaReferenceSources,
      });

      setWorkspaceStatus("review-ready");
      setWidgets((current) =>
        buildPortfolioBacktestReadyWidgets({
          currentWidgets: current,
          widget,
          resultModel,
          dependencyModel,
          preparation,
          backtestPeriod,
          isMetricsTarget: isPortfolioWidgetMetricsTarget,
        })
      );
      appendLog(`백테스트 차트 완료 · ${results.length}개 변형 · ${resultModel.xLabels.length}거래일`);
    } catch (error) {
      setWidgets((current) =>
        buildPortfolioBacktestFailureWidgets({
          currentWidgets: current,
          widgetId: widget.id,
          errorMessage: error.message,
        })
      );
      appendLog(`백테스트 차트 실패 · ${error.message}`);
    }
  }

  function runPortfolioWidgetAction(widget, action = "") {
    const route = portfolioWidgetActionRoute(action);
    if (route === PORTFOLIO_WIDGET_ACTION_ROUTES.allocation) {
      createAllocationChartFromWidget(widget);
      return;
    }
    if (route === PORTFOLIO_WIDGET_ACTION_ROUTES.restoreTable) {
      const source = portfolioWidgetRestoreTableSource(widget, widgets);
      const now = new Date().toISOString();
      const restoreState = buildPortfolioRestoreTableActionState({
        currentWidgets: widgets,
        targetWidget: widget,
        source,
        now,
      });
      setWidgets(restoreState.widgets);
      if (restoreState.missingSource) {
        appendLog(`테이블 복원 보류 · ${widget.title}`);
        return;
      }
      appendLog(`테이블로 되돌리기 · ${widget.displayId || widget.title} ← ${source.displayId || source.title}`);
      return;
    }
    if (route === PORTFOLIO_WIDGET_ACTION_ROUTES.refreshDerived) {
      if (isPortfolioWidgetMetricsTarget(widget)) {
        const syncedWidget = buildPortfolioMetricsTableSyncPatch(widget, widgets);
        if (syncedWidget) {
          setWidgets((current) => current.map((item) => (item.id === widget.id ? buildPortfolioMetricsTableSyncPatch(item, current) || syncedWidget : item)));
          appendLog(`지표표 동기화 · ${widget.displayId || widget.title}`);
          return;
        }
      }
      const { prompt, nextWidget } = buildDerivedPortfolioWidgetRefreshRequest({
        widget,
        widgets,
      });
      setWidgets((current) => current.map((item) => (item.id === widget.id ? nextWidget : item)));
      appendLog(`관계 위젯 갱신 요청 · ${widget.title}`);
      onWidgetPromptRequest?.({ action: "edit", widget: nextWidget, prompt, repairWidgetDependencies: true });
      return;
    }
    if (route === PORTFOLIO_WIDGET_ACTION_ROUTES.runBacktestChart) {
      void runPortfolioWidgetBacktestChart(widget);
      return;
    }
    onWidgetPromptRequest?.({
      action: "edit",
      widget,
      prompt: `${widget.displayId || widget.title} 위젯을 어떻게 갱신해야 할지 판단해 주세요.`,
    });
  }

  useEffect(() => {
    const autoRefresh = selectPortfolioAutoRefreshCandidate({
      widgets,
      processedKeys: portfolioDependencyAutoRunIdsRef.current,
    });
    if (!autoRefresh) return undefined;
    portfolioDependencyAutoRunIdsRef.current.add(autoRefresh.key);
    const timer = window.setTimeout(() => runPortfolioWidgetAction(autoRefresh.candidate, autoRefresh.action), 350);
    return () => window.clearTimeout(timer);
  }, [widgets]);

  async function runLiveBacktest() {
    if (liveBacktestBusy || !holdings.length) return;
    const { normalizedBenchmark, includeBenchmark } = buildPortfolioLiveBacktestPayload({
      holdings,
      period: backtestPeriod,
      benchmark,
    });
    setBenchmark(normalizedBenchmark);
    setLiveBacktestBusy(true);
    setLiveBacktestError("");
    appendLog(`yfinance 실제 가격 백테스트 요청 · ${backtestPeriod}/${includeBenchmark ? normalizedBenchmark : "벤치마크 없음"}`);

    try {
      const { payload } = await executePortfolioLiveBacktest({
        holdings,
        period: backtestPeriod,
        benchmark: normalizedBenchmark,
      });
      setLiveBacktest(payload);
      setWorkspaceStatus("review-ready");
      appendLog(
        `yfinance 완료 · ${payload.metrics?.periodStart || "-"}~${payload.metrics?.periodEnd || "-"} · ${payload.metrics?.tradingDays || 0}거래일`
      );
    } catch (error) {
      setLiveBacktest(null);
      setLiveBacktestError(error.message);
      appendLog(`yfinance 실패 · ${error.message}`);
    } finally {
      setLiveBacktestBusy(false);
    }
  }

  if (!workspaceStarted) {
    return (
      <div className="portfolio-shell">
        <PortfolioGuidePage
          modes={portfolioCanvasModeList}
          principles={portfolioTheoryPrinciples}
          onCreateCanvas={startPortfolioWorkspace}
        />
      </div>
    );
  }

  return (
    <div className="portfolio-shell">
      <section className="portfolio-board" aria-labelledby="portfolio-title">
        <PortfolioWorkspaceHeader
          canvasName={canvasName}
          modeMeta={canvasModeMeta}
          isAssetMode={isAssetCanvasMode}
          isWidgetCanvasMode={isWidgetCanvasMode}
          workspaceStatus={workspaceStatus}
          titleEditing={titleEditing}
          titleDraft={titleDraft}
          titleInputRef={titleInputRef}
          onTitleDraftChange={setTitleDraft}
          onTitleDraftBlur={saveCanvasTitleDraft}
          onTitleDraftKeyDown={handleCanvasTitleKeyDown}
          onStartTitleEditing={() => setTitleEditing(true)}
          onOpenGuide={reopenPortfolioGuide}
          onRefreshCanvas={refreshPortfolioCanvasLatestData}
          canvasRefreshBusy={canvasRefreshBusy}
          refreshableWidgetCount={canvasRefreshTargets.length}
        />

        {isWidgetCanvasMode && isAssetCanvasMode ? (
          <PortfolioTossApiStatus
            status={tossInvestStatus}
            busy={tossInvestBusy}
            error={tossInvestError}
            errorCode={tossInvestErrorCode}
            publicIp={tossInvestPublicIp}
            publicIpBusy={tossInvestPublicIpBusy}
            publicIpError={tossInvestPublicIpError}
            orderSyncStatus={tossInvestOrderSyncStatus}
            orderSyncBusy={tossInvestOrderSyncBusy}
            orderSyncAction={tossInvestOrderSyncAction}
            orderSyncError={tossInvestOrderSyncError}
            orderSyncErrorCode={tossInvestOrderSyncErrorCode}
            onOpenSettings={onOpenSettings}
            onDeleteCredentials={onDeleteTossInvestCredentials}
            onProbeConnection={onProbeTossInvestConnection}
            onRunOrderSync={onRunTossInvestOrderSync}
            onCheckPublicIp={onCheckTossInvestPublicIp}
          />
        ) : null}

        {isWidgetCanvasMode ? (
          <>
            <PortfolioWidgetCanvas
              widgets={widgets}
              scenario={scenario}
              setWidgets={setWidgets}
              activityLog={activityLog}
              canvasMode={canvasModeMeta.id}
              assetHistoryPanel={
                showAssetHistoryPanel
                  ? {
                      range: visibleAssetHistoryRange,
                      minimumDate: assetHistoryMinimumDate,
                      maximumDate: assetHistoryMaximumDate,
                      onRangeChange: updateAssetHistoryRange,
                    }
                  : null
              }
              onCreateCell={openWidgetCreateModal}
              onCreateAssetWidget={createAssetWidgetFromPicker}
              onCreateAssetEvaluation={createAssetEvaluationTable}
              onDeleteWidget={requestDeletePortfolioWidget}
              onWidgetAction={runPortfolioWidgetAction}
              onAssetHistoryCurrencyChange={updateAssetHistoryCurrency}
              onPositionStatusViewChange={updatePositionStatusView}
              onWidgetDisplayData={handleWidgetDisplayData}
              onScenarioPromptRequest={openScenarioPromptModal}
              appendLog={appendLog}
            />
            <PortfolioWidgetModal
              draft={widgetDraft}
              error={widgetModalError}
              onClose={closeWidgetModal}
              onSubmit={submitWidgetDraft}
            />
            <PortfolioWidgetDeleteDialog
              target={pendingDeleteWidget?.target}
              dependents={pendingDeleteWidget?.dependents || []}
              cascadeDependents={pendingDeleteWidget?.cascadeDependents || []}
              onCancel={cancelDeletePortfolioWidget}
              onConfirm={confirmDeletePortfolioWidget}
            />
          </>
        ) : (
          <PortfolioWorkspaceLegacyPanel
            activityLog={activityLog}
            backtestPeriod={backtestPeriod}
            benchmark={benchmark}
            holdings={holdings}
            inputText={inputText}
            liveBacktest={liveBacktest}
            liveBacktestBusy={liveBacktestBusy}
            liveBacktestError={liveBacktestError}
            onBacktestPeriodChange={setBacktestPeriod}
            onBenchmarkChange={setBenchmark}
            onFreezeWorkspaceDraft={freezeWorkspaceDraft}
            onInputTextChange={updateInputText}
            onRefreshInference={refreshInference}
            onRunLiveBacktest={runLiveBacktest}
            portfolioSchemaTables={portfolioSchemaTables}
            portfolioTheoryPrinciples={portfolioTheoryPrinciples}
            summary={summary}
          />
        )}
      </section>
    </div>
  );
}
