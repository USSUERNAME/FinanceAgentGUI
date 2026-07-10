import { parsePortfolioWidgetJsonAction } from "./actionParser.js";
import { buildPortfolioWidgetFlowFromAction } from "./widgetFlowBuilder.js";
import {
  buildPortfolioWidgetPatchFromAgentAnswer,
  hasExplicitPortfolioWidgetTarget,
  resolvePortfolioWidgetTargetId,
} from "./widgetPatchParser.js";
import {
  buildPortfolioAgentCreatedWidgetState,
  portfolioAgentWidgetActionName,
  portfolioAgentWidgetCreateIntent,
  portfolioAgentWidgetHasPayload,
} from "./widgetAgentCreate.js";
import { buildPortfolioAgentUpdatedWidgets } from "./widgetAgentUpdate.js";
import {
  cleanPortfolioWidgetText,
  nextPortfolioWidgetDisplayId,
  nextPortfolioWidgetDisplayIndex,
} from "./widgetIdentity.js";
import { findPortfolioWidgetPlacement } from "./widgetLayout.js";
import {
  portfolioWidgetDownstreamDependents,
} from "./widgetRelations.js";
import {
  portfolioWidgetActionRunsBacktestChart,
} from "./widgetActions.js";
import {
  buildPortfolioBacktestMatrixContext,
  buildPortfolioBacktestMatrixPrompt,
  portfolioActionRequestsBacktestMatrixContext,
} from "./backtestMatrixContext.js";
import { portfolioWidgetAgentActionKey } from "./workspaceState.js";
import { portfolioWidgetLooksLikeMetricsTarget } from "./widgetRoleClassifier.js";
import { portfolioWidgetVisualTypeContractIssue } from "./widgetTypes.js";
import {
  normalizePortfolioPeriodComparison,
  normalizePortfolioScenarioSpec,
  portfolioActionDeclaresMultiplePeriodComparison,
  portfolioScenarioHasConcreteRuns,
} from "./scenarioContract.js";
import { portfolioWidgetIsMarkdownType } from "./markdownWidget.js";
import { markPortfolioWidgetMissingDependency } from "./widgetStateTransitions.js";
import { portfolioFunctionSpecMatrixDslContractIssue } from "./functionSpecParser.js";

function buildPortfolioAgentErrorPatch(error = "", now = new Date().toISOString()) {
  return {
    status: "error",
    agentSummary: cleanPortfolioWidgetText(error, 260),
    visualType: "checklist",
    requirements: ["사이드바 입력창의 요청을 직접 전송해야 합니다."],
    checks: ["에이전트 연결 상태와 진행 중 응답 여부를 확인합니다."],
    nextActions: ["send_agent_prompt"],
    updatedAt: now,
  };
}

function reservePortfolioWidgetDisplayIdFromState(currentWidgets = [], nextDisplayIndex = 1) {
  const index = Math.max(Number(nextDisplayIndex) || 1, nextPortfolioWidgetDisplayIndex(currentWidgets));
  const displayId = nextPortfolioWidgetDisplayId(currentWidgets, index);
  const nextIndex = Number(String(displayId).replace(/\D/g, "")) + 1;
  return {
    displayId,
    nextDisplayIndex: Math.max(nextIndex || index + 1, nextPortfolioWidgetDisplayIndex(currentWidgets)),
  };
}

function nextDisplayIndexForWidgets(widgets = [], nextDisplayIndex = 1) {
  return Math.max(Number(nextDisplayIndex) || 1, nextPortfolioWidgetDisplayIndex(widgets));
}

function patchWantsMarkdownWidget(patch = {}) {
  const markdownValues = [
    patch.markdown,
    patch.markdownText,
    patch.content,
    patch.document,
    patch.body,
    patch.report,
    patch.text,
  ];
  const hasMarkdownBody = markdownValues.some((value) => String(value || "").trim());
  const hasMarkdownChart =
    (Array.isArray(patch.echarts) && patch.echarts.length > 0) ||
    (Array.isArray(patch.echartsOptions) && patch.echartsOptions.length > 0) ||
    Boolean(patch.echartsOption && typeof patch.echartsOption === "object") ||
    Boolean(patch.echartsOptions && typeof patch.echartsOptions === "object" && !Array.isArray(patch.echartsOptions));
  return (
    portfolioWidgetIsMarkdownType(patch.visualType || patch.type || patch.chartSpec?.type) ||
    hasMarkdownBody ||
    hasMarkdownChart
  );
}

function parsedActionWantsMarkdownWidget(action = {}) {
  if (!action || typeof action !== "object") return false;
  if (patchWantsMarkdownWidget(action.widget || action)) return true;
  return Array.isArray(action.widgets) && action.widgets.some((widget) => patchWantsMarkdownWidget(widget));
}

function portfolioDeleteActionConfirmed(action = {}) {
  return (
    action?.confirmed === true ||
    action?.force === true ||
    action?.confirmDelete === true ||
    action?.deleteConfirmed === true ||
    action?.confirmation === "confirmed"
  );
}

function portfolioActionCreatesWidget(actionName = "", parsedAction = null) {
  const normalizedAction = String(actionName || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (
    normalizedAction === "create" ||
    /(?:^|_)create_(?:portfolio_)?widget(?:_flow)?(?:$|_)/.test(normalizedAction) ||
    normalizedAction === "render_portfolio_artifact" ||
    (Array.isArray(parsedAction?.widgets) && parsedAction.widgets.length > 0)
  );
}

function buildAssetWidgetCreationBlockedState({
  actionKey = "",
  consumeId = "",
  currentWidgets = [],
  nextDisplayIndex = 1,
} = {}) {
  return {
    status: "asset-widget-creation-disabled",
    actionKey,
    consumeId,
    widgets: currentWidgets,
    nextDisplayIndex,
    workspaceStarted: true,
    rememberWorkspace: false,
    logMessages: ["자산관리 위젯 생성 보류 · 캔버스 빈 칸의 + 버튼에서 직접 추가해 주세요."],
  };
}

export function buildPortfolioAgentWidgetActionApplyState({
  agentWidgetAction,
  canvasId = "",
  currentWidgets = [],
  currentScenario = null,
  processedActionKeys = new Set(),
  nextDisplayIndex = 1,
  canvasModeId = "",
  assetCanvasModeId = "asset-management",
  now = new Date().toISOString(),
  nowMs = Date.now(),
  findPlacement = findPortfolioWidgetPlacement,
} = {}) {
  if (!agentWidgetAction?.answer && !agentWidgetAction?.error) {
    return { status: "ignored", widgets: currentWidgets, nextDisplayIndex };
  }
  if (agentWidgetAction.canvasId && agentWidgetAction.canvasId !== canvasId) {
    return { status: "wrong-canvas", widgets: currentWidgets, nextDisplayIndex };
  }

  const parsedAction = parsePortfolioWidgetJsonAction(agentWidgetAction.answer);
  const actionKey = portfolioWidgetAgentActionKey(agentWidgetAction, parsedAction, canvasId);
  const consumeId = agentWidgetAction.id || "";
  if (actionKey && processedActionKeys.has(actionKey)) {
    return {
      status: "duplicate",
      actionKey,
      consumeId,
      widgets: currentWidgets,
      nextDisplayIndex,
    };
  }

  const actionName = portfolioAgentWidgetActionName(parsedAction, agentWidgetAction.request);
  const hasWidgetPayload = portfolioAgentWidgetHasPayload(parsedAction);
  const isAssetMode = canvasModeId === assetCanvasModeId;
  if (isAssetMode && portfolioActionCreatesWidget(actionName, parsedAction)) {
    return buildAssetWidgetCreationBlockedState({
      actionKey,
      consumeId,
      currentWidgets,
      nextDisplayIndex,
    });
  }
  const parsedScenario =
    parsedAction?.scenario && typeof parsedAction.scenario === "object"
      ? normalizePortfolioScenarioSpec(parsedAction.scenario, { backtestPeriod: currentScenario?.runs?.[0]?.period || "1y" })
      : null;
  const periodComparison = normalizePortfolioPeriodComparison(parsedAction?.periodComparison || parsedAction?.periodComparisonIntent);
  const periodComparisonScenario =
    periodComparison.periods.length > 1
      ? normalizePortfolioScenarioSpec(
          {
            title: "기간 및 타임프레임",
            status: "ready",
            runs: periodComparison.periods,
            dimensions: ["runId", "date", "asset", "field"],
            updatedAt: now,
          },
          { backtestPeriod: currentScenario?.runs?.[0]?.period || "1y", now }
        )
      : null;
  const resolvedScenario =
    parsedScenario && (!periodComparison.isMultiplePeriodComparison || portfolioScenarioHasConcreteRuns(parsedScenario))
      ? parsedScenario
      : periodComparisonScenario || parsedScenario;
  if (/refresh_canvas_latest_data/.test(actionName)) {
    return {
      status: "refresh-latest",
      actionKey,
      consumeId,
      widgets: currentWidgets,
      nextDisplayIndex,
      refreshCanvasLatestData: true,
    };
  }

  const targetRequest = {
    ...agentWidgetAction.request,
    widgetId: agentWidgetAction.widgetId,
  };
  const targetWidgetId = resolvePortfolioWidgetTargetId(currentWidgets, parsedAction, targetRequest);
  const targetWidget = currentWidgets.find((widget) => widget.id === targetWidgetId);
  if (portfolioActionRequestsBacktestMatrixContext(actionName)) {
    const inferredTargets = currentWidgets.filter(
      (widget) =>
        widget?.outputRole === "backtest_result" &&
        Array.isArray(widget?.chartSpec?.series) &&
        widget.chartSpec.series.length > 0
    );
    const matrixTarget = targetWidget || (inferredTargets.length === 1 ? inferredTargets[0] : null);
    if (!matrixTarget) {
      return {
        status: "missing-target",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        scenario: resolvedScenario,
        nextDisplayIndex,
        workspaceStarted: true,
        rememberWorkspace: false,
        logMessages: ["백테스트 행렬 조회 보류 · 대상 백테스트 위젯을 지정해야 합니다."],
      };
    }
    const matrixContext = buildPortfolioBacktestMatrixContext({
      widget: matrixTarget,
      action: parsedAction,
      now,
    });
    return {
      status: "backtest-matrix-context",
      actionKey,
      consumeId,
      widgets: currentWidgets,
      scenario: resolvedScenario,
      nextDisplayIndex,
      workspaceStarted: true,
      rememberWorkspace: false,
      backtestMatrixPrompt: buildPortfolioBacktestMatrixPrompt({
        originalPrompt: agentWidgetAction.request?.prompt || "",
        action: parsedAction,
        matrixContext,
      }),
      logMessages: [
        matrixContext.ok
          ? `백테스트 행렬 컨텍스트 조회 · ${matrixTarget.displayId || matrixTarget.title} ${matrixContext.matrix.returnedRowCount}/${matrixContext.matrix.rowCount}행`
          : `백테스트 행렬 컨텍스트 조회 실패 · ${matrixTarget.displayId || matrixTarget.title}`,
      ],
    };
  }
  const requestIsDependencyRepair = Boolean(
    agentWidgetAction.request?.repairWidgetDependencies ||
      agentWidgetAction.request?.refreshDerivedWidget ||
      agentWidgetAction.request?.derivedWidgetRefresh
  );
  if (portfolioWidgetActionRunsBacktestChart(actionName)) {
    if (!targetWidgetId || !targetWidget) {
      return {
        status: "missing-target",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        scenario: resolvedScenario,
        nextDisplayIndex,
        logMessages: ["백테스트 업데이트 보류 · 대상 위젯 없음"],
      };
    }
    return {
      status: "run-backtest-widget",
      actionKey,
      consumeId,
      widgets: currentWidgets,
      scenario: resolvedScenario,
      nextDisplayIndex,
      workspaceStarted: true,
      rememberWorkspace: false,
      runBacktestWidgetId: targetWidget.id,
      logMessages: [`에이전트 백테스트 업데이트 · ${targetWidget.displayId || targetWidget.title}`],
    };
  }
  if (
    requestIsDependencyRepair &&
    targetWidget &&
    !portfolioWidgetIsMarkdownType(targetWidget.visualType) &&
    parsedActionWantsMarkdownWidget(parsedAction)
  ) {
    return {
      status: "target-type-mismatch",
      actionKey,
      consumeId,
      widgets: currentWidgets,
      scenario: resolvedScenario,
      nextDisplayIndex,
      workspaceStarted: true,
      rememberWorkspace: false,
      logMessages: [
        `위젯 적용 보류 · ${targetWidget.displayId || targetWidget.title} 수리 요청은 기존 ${targetWidget.visualType || "위젯"} 역할을 유지해야 하므로 마크다운 위젯을 만들지 않습니다.`,
      ],
      contractError: {
        code: "repair_must_preserve_widget_type",
        widgetId: targetWidget.id,
        displayId: targetWidget.displayId,
        title: targetWidget.title,
        message: "관계 위젯 수리 응답은 기존 위젯 타입을 유지하는 update_widget이어야 합니다.",
      },
    };
  }
  if (/delete_(portfolio_)?widget|remove_(portfolio_)?widget/.test(actionName)) {
    if (!targetWidgetId || !targetWidget) {
      return {
        status: "missing-target",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        nextDisplayIndex,
        logMessages: ["위젯 삭제 보류 · 대상 위젯 없음"],
      };
    }
    const downstreamDependents = portfolioWidgetDownstreamDependents(targetWidget, currentWidgets);
    if (downstreamDependents.length && !portfolioDeleteActionConfirmed(parsedAction)) {
      return {
        status: "delete-confirmation-required",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        nextDisplayIndex,
        logMessages: [
          `위젯 삭제 확인 필요 · ${targetWidget.displayId || targetWidget.title} 아래 ${downstreamDependents.map((widget) => widget.displayId || widget.title).join(", ")} 의존성이 있습니다. 진짜로 지울건가요?`,
        ],
      };
    }
    const widgets = markPortfolioWidgetMissingDependency(
      currentWidgets.filter((widget) => widget.id !== targetWidget.id),
      targetWidget,
      targetWidget.displayId || targetWidget.title
    );
    return {
      status: "deleted",
      actionKey,
      consumeId,
      widgets,
      nextDisplayIndex,
      workspaceStarted: true,
      rememberWorkspace: true,
      logMessages: [`에이전트 삭제 · ${targetWidget.displayId || targetWidget.title}`],
    };
  }

  if (!agentWidgetAction.error) {
    const declaresMultiplePeriodComparison = portfolioActionDeclaresMultiplePeriodComparison(parsedAction);
    if (declaresMultiplePeriodComparison && !portfolioScenarioHasConcreteRuns(resolvedScenario)) {
      return {
        status: "scenario-required",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        nextDisplayIndex,
        workspaceStarted: true,
        rememberWorkspace: false,
        logMessages: ["복수 기간 비교 보류 · scenario.runs의 startDate/endDate 필요"],
      };
    }
    const actionForFlow = resolvedScenario && resolvedScenario !== parsedAction?.scenario
      ? { ...parsedAction, scenario: resolvedScenario }
      : parsedAction;
    const flow = buildPortfolioWidgetFlowFromAction(actionForFlow, agentWidgetAction.request, {
      currentWidgets,
      nextDisplayIndex,
      now,
      nowMs,
      findPlacement,
    });
    if (flow?.error) {
      return {
        status: "action-contract-invalid",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        scenario: resolvedScenario,
        nextDisplayIndex,
        workspaceStarted: true,
        rememberWorkspace: false,
        logMessages: [flow.error.message || "위젯 생성 보류 · 필수 구조 값이 부족합니다."],
        contractError: flow.error,
      };
    }
    if (flow) {
      return {
        status: "flow-created",
        actionKey,
        consumeId,
        widgets: flow.widgets,
        scenario: resolvedScenario,
        nextDisplayIndex: flow.nextDisplayIndex,
        workspaceStarted: true,
        rememberWorkspace: true,
        logMessages: [
          ...(resolvedScenario ? [`${parsedScenario ? "시나리오 갱신" : "시나리오 구조 적용"} · 기간 및 타임프레임`] : []),
          `위젯 플로우 생성 · ${flow.createdWidgets.map((widget) => widget.displayId).join(" → ")}`,
        ],
        createdWidgets: flow.createdWidgets,
      };
    }
    if (parsedScenario && !hasWidgetPayload) {
      return {
        status: "scenario-updated",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        scenario: parsedScenario,
        nextDisplayIndex,
        workspaceStarted: true,
        rememberWorkspace: true,
        logMessages: ["시나리오 갱신 · 기간 및 타임프레임"],
      };
    }
  }

  const patch = agentWidgetAction.error
    ? buildPortfolioAgentErrorPatch(agentWidgetAction.error, now)
    : buildPortfolioWidgetPatchFromAgentAnswer(agentWidgetAction.answer, agentWidgetAction.request);
  const hasExplicitTarget = hasExplicitPortfolioWidgetTarget(parsedAction, targetRequest);
  if (targetWidget && !portfolioWidgetIsMarkdownType(targetWidget.visualType) && patchWantsMarkdownWidget(patch)) {
    return {
      status: "action-contract-invalid",
      actionKey,
      consumeId,
      widgets: currentWidgets,
      scenario: resolvedScenario,
      nextDisplayIndex,
      workspaceStarted: true,
      rememberWorkspace: false,
      logMessages: [
        `위젯 적용 보류 · ${targetWidget.displayId || targetWidget.title}는 기존 ${targetWidget.visualType || "위젯"} 역할을 유지해야 하므로 마크다운 패치를 적용하지 않습니다.`,
      ],
      contractError: {
        code: "target_type_mismatch",
        widgetId: targetWidget.id,
        displayId: targetWidget.displayId,
        title: targetWidget.title,
        message: `${targetWidget.displayId || targetWidget.title || "대상 위젯"} 업데이트는 기존 ${targetWidget.visualType || "위젯"} visualType을 유지해야 합니다.`,
      },
    };
  }
  const patchContractIssue = portfolioFunctionSpecMatrixDslContractIssue(patch.functionSpec || {}, {
    ...targetWidget,
    ...patch,
    visualType: patch.visualType || targetWidget?.visualType,
    displayId: targetWidget?.displayId || patch.displayId,
    title: patch.title || targetWidget?.title,
  });
  if ((patch.visualType === "function" || targetWidget?.visualType === "function") && patchContractIssue) {
    return {
      status: "action-contract-invalid",
      actionKey,
      consumeId,
      widgets: currentWidgets,
      scenario: resolvedScenario,
      nextDisplayIndex,
      workspaceStarted: true,
      rememberWorkspace: false,
      logMessages: [patchContractIssue.message],
      contractError: patchContractIssue,
    };
  }

  if (!targetWidgetId || !targetWidget) {
    const { shouldCreateWidget, isAmbiguousUpdateWithPayload } = portfolioAgentWidgetCreateIntent({
      actionName,
      agentWidgetAction,
      hasExplicitTarget,
      hasWidgetPayload,
      hasParsedAction: Boolean(parsedAction),
    });
    if (!shouldCreateWidget) {
      return {
        status: "missing-target",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        nextDisplayIndex,
        logMessages: ["에이전트 적용 보류 · 대상 위젯 없음"],
      };
    }
    if (isAssetMode) {
      return buildAssetWidgetCreationBlockedState({
        actionKey,
        consumeId,
        currentWidgets,
        nextDisplayIndex,
      });
    }
    const visualTypeIssue = portfolioWidgetVisualTypeContractIssue(patch);
    if (visualTypeIssue) {
      return {
        status: "action-contract-invalid",
        actionKey,
        consumeId,
        widgets: currentWidgets,
        scenario: resolvedScenario,
        nextDisplayIndex,
        workspaceStarted: true,
        rememberWorkspace: false,
        logMessages: [visualTypeIssue.message],
        contractError: visualTypeIssue,
      };
    }

    const reserved = reservePortfolioWidgetDisplayIdFromState(currentWidgets, nextDisplayIndex);
    const createdState = buildPortfolioAgentCreatedWidgetState({
      currentWidgets,
      patch,
      request: agentWidgetAction.request,
      createdDisplayId: reserved.displayId,
      canvasModeId,
      assetCanvasModeId,
      now,
      nowMs,
      findPlacement,
    });
    const logMessages = [
      `${isAmbiguousUpdateWithPayload ? "대상 없는 업데이트 생성 처리" : "에이전트 생성"} · ${createdState.candidate.title || "위젯"}`,
    ];
    if (createdState.shouldCreateDefaultAllocationChart) {
      logMessages.push(`파이차트 자동 생성 · ${reserved.displayId || createdState.candidate.title || "위젯"}`);
    }
    return {
      status: "created",
      actionKey,
      consumeId,
      widgets: createdState.widgets,
      scenario: resolvedScenario,
      nextDisplayIndex: nextDisplayIndexForWidgets(createdState.widgets, reserved.nextDisplayIndex),
      workspaceStarted: true,
      rememberWorkspace: true,
      logMessages,
      candidate: createdState.candidate,
      allocationWidget: createdState.allocationWidget,
    };
  }

  const appliedTitle = patch.title || targetWidget.title;
  const widgets = buildPortfolioAgentUpdatedWidgets({
    currentWidgets,
    targetWidgetId,
    patch,
    request: agentWidgetAction.request,
    agentError: Boolean(agentWidgetAction.error),
  });
  return {
    status: "updated",
    actionKey,
    consumeId,
    widgets,
    scenario: resolvedScenario,
    nextDisplayIndex: nextDisplayIndexForWidgets(widgets, nextDisplayIndex),
    logMessages: [
      `${agentWidgetAction.error ? "에이전트 보류" : "에이전트 적용"} · ${appliedTitle || agentWidgetAction.request?.widget?.title || "위젯"}`,
    ],
  };
}
