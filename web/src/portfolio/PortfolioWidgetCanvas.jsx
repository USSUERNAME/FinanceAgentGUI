import React, { useMemo, useRef, useState } from "react";
import Move from "lucide-react/dist/esm/icons/move.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import X from "lucide-react/dist/esm/icons/x.js";
import {
  portfolioWidgetActionMeta,
  portfolioWidgetPrimaryAction,
  portfolioWidgetStatusLabel,
} from "./widgetActions.js";
import {
  clampPortfolioWidgetNumber,
  normalizePortfolioWidgetStatus,
} from "./widgetIdentity.js";
import {
  canPlacePortfolioWidget,
  portfolioGridModel,
} from "./widgetLayout.js";
import { normalizePortfolioWidgetVisualType } from "./widgetTypes.js";
import {
  PORTFOLIO_WIDGET_GRID_COLUMNS,
  PORTFOLIO_WIDGET_GRID_GAP,
  PORTFOLIO_WIDGET_GRID_ROW_HEIGHT,
  PORTFOLIO_WIDGET_MAX_HEIGHT,
  PORTFOLIO_WIDGET_MAX_ROWS,
} from "./workspaceState.js";
import {
  PortfolioWidgetProducedContent,
  PortfolioWidgetRelationMeta,
} from "./PortfolioWidgetContent.jsx";
import { PortfolioAssetHistoryPanel } from "./PortfolioAssetHistoryPanel.jsx";
import { PortfolioComparisonAssetDialog } from "./PortfolioComparisonAssetDialog.jsx";
import { PortfolioWidgetFlowMap } from "./PortfolioWidgetFlowMap.jsx";
import { PortfolioScenarioPanel } from "./PortfolioScenarioPanel.jsx";
import {
  portfolioAssetBetaBenchmark,
  portfolioWidgetIsAssetEvaluationTable,
} from "./portfolioAssetMetrics.js";

const PORTFOLIO_COMPARISON_ASSET_LIMIT = 5;

function normalizePortfolioComparisonAssets(widget = {}) {
  const source = widget?.chartSpec?.query?.comparisonAssets;
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  return source.slice(0, PORTFOLIO_COMPARISON_ASSET_LIMIT).flatMap((row) => {
    const symbol = String(row?.symbol || row?.ticker || row || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);
    if (!symbol || seen.has(symbol)) return [];
    seen.add(symbol);
    return [{
      symbol,
      name: String(row?.name || row?.label || symbol).trim().slice(0, 180),
      englishName: String(row?.englishName || "").trim().slice(0, 180),
      market: String(row?.market || "").trim().slice(0, 60),
    }];
  });
}

export function PortfolioWidgetCanvas({
  widgets,
  scenario = null,
  setWidgets,
  activityLog,
  canvasMode = "",
  assetHistoryPanel = null,
  onCreateCell,
  onCreateAssetWidget,
  onCreateAssetEvaluation,
  onDeleteWidget,
  onWidgetAction,
  onAssetHistoryCurrencyChange,
  onPositionStatusViewChange,
  onWidgetDisplayData,
  onScenarioPromptRequest,
  appendLog,
}) {
  const gridRef = useRef(null);
  const isStrategyCanvas = canvasMode === "strategy-research";
  const gridModel = useMemo(() => portfolioGridModel(widgets), [widgets]);
  const [activeWidgetInteraction, setActiveWidgetInteraction] = useState(null);
  const [activeAssetPickerCell, setActiveAssetPickerCell] = useState(null);
  const [comparisonOverlayWidgetId, setComparisonOverlayWidgetId] = useState("");
  const [comparisonAssetDialogWidgetId, setComparisonAssetDialogWidgetId] = useState("");
  const [comparisonDraftAssets, setComparisonDraftAssets] = useState([]);
  const showAssetHistoryPanel = Boolean(assetHistoryPanel && canvasMode === "asset-management");
  const isAssetCanvas = canvasMode === "asset-management";

  function assetPickerIsActive(cell) {
    return activeAssetPickerCell?.x === cell.x && activeAssetPickerCell?.y === cell.y;
  }

  function openAddCell(cell) {
    if (isAssetCanvas) {
      setActiveAssetPickerCell(cell);
      return;
    }
    onCreateCell?.(cell);
  }

  function createAssetWidget(cell, widgetType) {
    if (!widgetType) return;
    onCreateAssetWidget?.({ cell, widgetType });
    setActiveAssetPickerCell(null);
  }

  function assetHistoryCurrency(widget) {
    const value = String(
      widget?.chartSpec?.query?.currency ||
        widget?.chartSpec?.currency ||
        widget?.chartSpec?.valueCurrency ||
        widget?.currency ||
        "KRW"
    ).toUpperCase();
    return value === "USD" ? "USD" : "KRW";
  }

  function positionStatusView(widget) {
    return String(widget?.chartSpec?.query?.view || widget?.chartSpec?.view || "").toLowerCase() === "pie" ? "pie" : "bar";
  }

  function widgetUsesAssetHistoryCurrency(widgetVisualType) {
    return ["price-history", "position-status", "seasonal-comparison"].includes(widgetVisualType);
  }

  function changeAssetEvaluationBetaBenchmark(widget, nextBenchmarkId) {
    const nextBenchmark = portfolioAssetBetaBenchmark(nextBenchmarkId);
    setWidgets((current) => current.map((candidate) => (
      candidate.id === widget.id
        ? {
            ...candidate,
            chartSpec: {
              ...(candidate.chartSpec || {}),
              betaBenchmark: nextBenchmark.id,
            },
            version: Math.max(1, Number(candidate.version || 1)) + 1,
            updatedAt: new Date().toISOString(),
          }
        : candidate
    )));
    appendLog?.(`BETA 기준 변경 · ${widget.displayId || widget.title} → ${nextBenchmark.label}`);
  }

  function gridPointerMetrics(gridNode) {
    const style = window.getComputedStyle(gridNode);
    const columnGap = Number.parseFloat(style.columnGap) || PORTFOLIO_WIDGET_GRID_GAP;
    const rowGap = Number.parseFloat(style.rowGap) || PORTFOLIO_WIDGET_GRID_GAP;
    return {
      columnUnit: Math.max(80, (gridNode.clientWidth + columnGap) / PORTFOLIO_WIDGET_GRID_COLUMNS),
      rowUnit: PORTFOLIO_WIDGET_GRID_ROW_HEIGHT + rowGap,
    };
  }

  function scrollCanvasNearPointer(pointerEvent) {
    const gridNode = gridRef.current;
    const scrollNode = gridNode?.closest(".workspace-canvas");
    if (!scrollNode) return;
    const rect = scrollNode.getBoundingClientRect();
    const edgeSize = 86;
    if (pointerEvent.clientY > rect.bottom - edgeSize) {
      scrollNode.scrollTop += 22;
    } else if (pointerEvent.clientY < rect.top + edgeSize) {
      scrollNode.scrollTop -= 22;
    }
  }

  function applyWidgetLayout(widgetId, nextLayout) {
    setWidgets((current) =>
      current.map((item) =>
        item.id === widgetId
          ? {
              ...item,
              ...nextLayout,
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
  }

  function startMove(event, widget) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const gridNode = gridRef.current;
    const cardNode = event.currentTarget.closest(".portfolio-widget-card");
    if (!gridNode || !cardNode) return;
    const cardRect = cardNode.getBoundingClientRect();
    const pointerOffsetX = event.clientX - cardRect.left;
    const pointerOffsetY = event.clientY - cardRect.top;
    const startPointerX = event.clientX;
    const startPointerY = event.clientY;
    const startWidget = { ...widget };
    const startLayout = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
    let currentCandidate = startLayout;
    let currentIsValid = true;
    let didMove = false;

    function updateMove(moveEvent) {
      scrollCanvasNearPointer(moveEvent);
      const rect = gridNode.getBoundingClientRect();
      const { columnUnit, rowUnit } = gridPointerMetrics(gridNode);
      const pointerInsideGrid =
        moveEvent.clientX >= rect.left &&
        moveEvent.clientX <= rect.right &&
        moveEvent.clientY >= rect.top &&
        moveEvent.clientY <= rect.bottom;
      const candidate = {
        ...startWidget,
        x: clampPortfolioWidgetNumber(
          (moveEvent.clientX - rect.left - pointerOffsetX) / columnUnit,
          0,
          PORTFOLIO_WIDGET_GRID_COLUMNS - startWidget.w,
          startWidget.x
        ),
        y: clampPortfolioWidgetNumber(
          (moveEvent.clientY - rect.top - pointerOffsetY) / rowUnit,
          0,
          PORTFOLIO_WIDGET_MAX_ROWS - startWidget.h,
          startWidget.y
        ),
      };
      const candidateLayout = {
        x: candidate.x,
        y: candidate.y,
        w: candidate.w,
        h: candidate.h,
      };
      currentCandidate = candidateLayout;
      currentIsValid = pointerInsideGrid && canPlacePortfolioWidget(widgets, candidate, widget.id);
      didMove =
        didMove ||
        ((Math.abs(moveEvent.clientX - startPointerX) > 4 || Math.abs(moveEvent.clientY - startPointerY) > 4) &&
          (candidate.x !== startWidget.x || candidate.y !== startWidget.y));
      setActiveWidgetInteraction({
        type: "move",
        widgetId: widget.id,
        left: moveEvent.clientX - pointerOffsetX,
        top: moveEvent.clientY - pointerOffsetY,
        width: cardRect.width,
        height: cardRect.height,
        candidate: candidateLayout,
        isValid: currentIsValid,
      });
    }

    function finishMove(shouldCommit, finishEvent) {
      if (finishEvent) updateMove(finishEvent);
      window.removeEventListener("pointermove", updateMove);
      window.removeEventListener("pointerup", endMove);
      window.removeEventListener("pointercancel", cancelMove);
      setActiveWidgetInteraction(null);
      if (!didMove) return;
      if (shouldCommit && currentIsValid) {
        applyWidgetLayout(widget.id, { x: currentCandidate.x, y: currentCandidate.y });
        appendLog(`위젯 이동 · ${startWidget.title}`);
        return;
      }
      appendLog(`위젯 이동 취소 · ${startWidget.title}`);
    }

    function endMove(moveEvent) {
      finishMove(true, moveEvent);
    }

    function cancelMove() {
      finishMove(false, null);
    }

    updateMove(event);
    window.addEventListener("pointermove", updateMove);
    window.addEventListener("pointerup", endMove, { once: true });
    window.addEventListener("pointercancel", cancelMove, { once: true });
  }

  function startResize(event, widget, direction = "se") {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const gridNode = gridRef.current;
    const cardNode = event.currentTarget.closest(".portfolio-widget-card");
    if (!gridNode || !cardNode) return;
    const startPointerX = event.clientX;
    const startPointerY = event.clientY;
    const startWidget = { ...widget };
    const startLayout = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
    const fixedRight = startWidget.x + startWidget.w;
    const fixedBottom = startWidget.y + startWidget.h;
    let currentCandidate = startLayout;
    let currentIsValid = true;
    let didResize = false;

    function updateResize(moveEvent) {
      scrollCanvasNearPointer(moveEvent);
      const { columnUnit, rowUnit } = gridPointerMetrics(gridNode);
      const deltaCols = Math.round((moveEvent.clientX - startPointerX) / columnUnit);
      const deltaRows = Math.round((moveEvent.clientY - startPointerY) / rowUnit);
      const nextLayout = { ...startLayout };
      if (direction.includes("e")) {
        nextLayout.w = clampPortfolioWidgetNumber(
          startWidget.w + deltaCols,
          1,
          PORTFOLIO_WIDGET_GRID_COLUMNS - startWidget.x,
          startWidget.w
        );
      }
      if (direction.includes("w")) {
        nextLayout.x = clampPortfolioWidgetNumber(
          startWidget.x + deltaCols,
          Math.max(0, fixedRight - PORTFOLIO_WIDGET_GRID_COLUMNS),
          fixedRight - 1,
          startWidget.x
        );
        nextLayout.w = fixedRight - nextLayout.x;
      }
      if (direction.includes("s")) {
        nextLayout.h = clampPortfolioWidgetNumber(
          startWidget.h + deltaRows,
          1,
          Math.min(PORTFOLIO_WIDGET_MAX_HEIGHT, PORTFOLIO_WIDGET_MAX_ROWS - startWidget.y),
          startWidget.h
        );
      }
      if (direction.includes("n")) {
        nextLayout.y = clampPortfolioWidgetNumber(
          startWidget.y + deltaRows,
          Math.max(0, fixedBottom - PORTFOLIO_WIDGET_MAX_HEIGHT),
          fixedBottom - 1,
          startWidget.y
        );
        nextLayout.h = fixedBottom - nextLayout.y;
      }
      const candidate = {
        ...startWidget,
        ...nextLayout,
      };
      const candidateLayout = {
        x: candidate.x,
        y: candidate.y,
        w: candidate.w,
        h: candidate.h,
      };
      currentCandidate = candidateLayout;
      currentIsValid = canPlacePortfolioWidget(widgets, candidate, widget.id);
      didResize =
        didResize ||
        ((Math.abs(moveEvent.clientX - startPointerX) > 4 || Math.abs(moveEvent.clientY - startPointerY) > 4) &&
          (candidate.w !== startWidget.w || candidate.h !== startWidget.h));
      setActiveWidgetInteraction({
        type: "resize",
        widgetId: widget.id,
        candidate: candidateLayout,
        isValid: currentIsValid,
      });
    }

    function finishResize(shouldCommit, finishEvent) {
      if (finishEvent) updateResize(finishEvent);
      window.removeEventListener("pointermove", updateResize);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", cancelResize);
      setActiveWidgetInteraction(null);
      if (!didResize) return;
      if (shouldCommit && currentIsValid) {
        applyWidgetLayout(widget.id, currentCandidate);
        appendLog(`위젯 크기 조절 · ${startWidget.title} · ${currentCandidate.w}x${currentCandidate.h}`);
        return;
      }
      appendLog(`위젯 크기 조절 취소 · ${startWidget.title}`);
    }

    function endResize(moveEvent) {
      finishResize(true, moveEvent);
    }

    function cancelResize() {
      finishResize(false, null);
    }

    updateResize(event);
    window.addEventListener("pointermove", updateResize);
    window.addEventListener("pointerup", endResize, { once: true });
    window.addEventListener("pointercancel", cancelResize, { once: true });
  }

  function resizeZones(widget) {
    return [
      ["n", "위쪽"],
      ["e", "오른쪽"],
      ["s", "아래쪽"],
      ["w", "왼쪽"],
      ["ne", "오른쪽 위"],
      ["se", "오른쪽 아래"],
      ["sw", "왼쪽 아래"],
      ["nw", "왼쪽 위"],
    ].map(([direction, label]) => (
      <button
        className={`portfolio-widget-resize-zone is-${direction}`}
        type="button"
        key={`${widget.id}-resize-${direction}`}
        tabIndex={-1}
        onPointerDown={(event) => startResize(event, widget, direction)}
        aria-label={`${widget.title} ${label} 테두리 크기 조절`}
      />
    ));
  }

  const activeMoveInteraction = activeWidgetInteraction?.type === "move" ? activeWidgetInteraction : null;
  const activeResizeInteraction = activeWidgetInteraction?.type === "resize" ? activeWidgetInteraction : null;

  return (
    <div className="portfolio-widget-canvas">
      <PortfolioWidgetFlowMap widgets={widgets} />
      {showAssetHistoryPanel ? <PortfolioAssetHistoryPanel {...assetHistoryPanel} /> : null}
      {isStrategyCanvas ? <PortfolioScenarioPanel scenario={scenario} onPromptRequest={onScenarioPromptRequest} /> : null}

      <div
        className="portfolio-widget-grid"
        ref={gridRef}
        style={{
          gridTemplateRows: `repeat(${gridModel.rowCount}, minmax(120px, 132px))`,
        }}
      >
        {gridModel.emptyCells.map((cell) => (
          assetPickerIsActive(cell) ? (
            <div
              className="portfolio-widget-picker-cell"
              key={`picker-${cell.x}-${cell.y}`}
              style={{
                gridColumn: `${cell.x + 1} / span 1`,
                gridRow: `${cell.y + 1} / span 1`,
              }}
            >
              <span>위젯 선택하기</span>
              <select
                aria-label="자산관리 위젯 선택하기"
                defaultValue=""
                onChange={(event) => createAssetWidget(cell, event.currentTarget.value)}
              >
                <option value="" disabled>
                  선택
                </option>
                <option value="asset-investment-history">보유 자산 과거 내역 차트</option>
                <option value="asset-position-status">투자 종목 현황</option>
                <option value="asset-seasonal-comparison">시즌별 비교</option>
              </select>
            </div>
          ) : (
            <button
              className="portfolio-widget-add-cell"
              type="button"
              key={`empty-${cell.x}-${cell.y}`}
              style={{
                gridColumn: `${cell.x + 1} / span 1`,
                gridRow: `${cell.y + 1} / span 1`,
              }}
              onClick={() => openAddCell(cell)}
              aria-label={
                isAssetCanvas
                  ? `${cell.x + 1}열 ${cell.y + 1}행에 위젯 선택하기`
                  : `${cell.x + 1}열 ${cell.y + 1}행에 에이전트 위젯 요청`
              }
            >
              <Plus className="portfolio-widget-add-icon" size={22} strokeWidth={2.35} aria-hidden="true" />
            </button>
          )
        ))}

        {activeMoveInteraction?.candidate ? (
          <div
            className={[
              "portfolio-widget-drop-preview",
              activeMoveInteraction.isValid ? "is-valid" : "is-invalid",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              gridColumn: `${activeMoveInteraction.candidate.x + 1} / span ${activeMoveInteraction.candidate.w}`,
              gridRow: `${activeMoveInteraction.candidate.y + 1} / span ${activeMoveInteraction.candidate.h}`,
            }}
            aria-hidden="true"
          />
        ) : null}

        {widgets.map((widget) => {
          const widgetVisualType = normalizePortfolioWidgetVisualType(widget.visualType);
          const isAssetPriceHistoryWidget = widgetVisualType === "price-history";
          const isSeasonalComparisonWidget = widgetVisualType === "seasonal-comparison";
          const isPositionStatusWidget = widgetVisualType === "position-status";
          const isAssetEvaluationWidget = portfolioWidgetIsAssetEvaluationTable(widget);
          const selectedBetaBenchmark = isAssetEvaluationWidget
            ? portfolioAssetBetaBenchmark(widget?.chartSpec?.betaBenchmark)
            : null;
          const committedComparisonAssets = isAssetPriceHistoryWidget ? normalizePortfolioComparisonAssets(widget) : [];
          const comparisonOverlayIsOpen = isAssetPriceHistoryWidget && comparisonOverlayWidgetId === widget.id;
          const comparisonModeIsActive = comparisonOverlayIsOpen || committedComparisonAssets.length > 0;
          const evaluationTableIsActive = isAssetPriceHistoryWidget && widgets.some((candidate) =>
            portfolioWidgetIsAssetEvaluationTable(candidate, widget.id)
          );
          const selectedAssetHistoryCurrency = widgetUsesAssetHistoryCurrency(widgetVisualType) ? assetHistoryCurrency(widget) : "";
          const selectedPositionStatusView = isPositionStatusWidget ? positionStatusView(widget) : "";
          const isMovingWidget = activeMoveInteraction?.widgetId === widget.id;
          const isResizingWidget = activeResizeInteraction?.widgetId === widget.id;
          const resizeLayout =
            isResizingWidget && activeResizeInteraction?.candidate ? activeResizeInteraction.candidate : null;
          const renderedLayout = resizeLayout || {
            x: widget.x,
            y: widget.y,
            w: widget.w,
            h: widget.h,
          };
          const isCompactVisualWidget =
            ["allocation", "line", "price-history", "position-status", "seasonal-comparison"].includes(widgetVisualType) && Number(renderedLayout.h || 1) <= 2;
          const primaryAction = portfolioWidgetPrimaryAction(widget, canvasMode);
          const primaryActionMeta = primaryAction ? portfolioWidgetActionMeta(primaryAction, widget.status) : null;
          const originalWidgetGridStyle = {
            gridColumn: `${widget.x + 1} / span ${widget.w}`,
            gridRow: `${widget.y + 1} / span ${widget.h}`,
          };
          const widgetGridStyle = {
            gridColumn: `${renderedLayout.x + 1} / span ${renderedLayout.w}`,
            gridRow: `${renderedLayout.y + 1} / span ${renderedLayout.h}`,
          };
          const isActiveInvalid =
            (isMovingWidget && !activeMoveInteraction.isValid) ||
            (isResizingWidget && !activeResizeInteraction.isValid);
          const widgetStyle = isMovingWidget
            ? {
                ...originalWidgetGridStyle,
                position: "fixed",
                left: activeMoveInteraction.left,
                top: activeMoveInteraction.top,
                width: activeMoveInteraction.width,
                height: activeMoveInteraction.height,
                boxSizing: "border-box",
              }
            : widgetGridStyle;
          return (
            <React.Fragment key={widget.id}>
              {isMovingWidget ? (
                <div
                  className="portfolio-widget-origin-placeholder"
                  style={originalWidgetGridStyle}
                  aria-hidden="true"
                />
              ) : null}
              <article
                className={[
                  "portfolio-widget-card",
                  `is-${normalizePortfolioWidgetStatus(widget.status)}`,
                  ["allocation", "line", "price-history", "position-status", "seasonal-comparison"].includes(widgetVisualType) ? "is-visual-widget" : "",
                  isCompactVisualWidget ? "is-compact-visual" : "",
                  ["allocation", "line", "price-history", "position-status", "seasonal-comparison"].includes(widgetVisualType) && Number(renderedLayout.h || 1) <= 1
                    ? "is-minimal-height"
                    : "",
                  isMovingWidget ? "is-moving" : "",
                  isResizingWidget ? "is-resizing" : "",
                  isActiveInvalid ? "is-drop-invalid" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={widgetStyle}
              >
                <header>
                  <div>
                    <span>{widget.displayId || widget.id} · {widget.kind} · {portfolioWidgetStatusLabel(widget.status)}</span>
                    <h3>{widget.title}</h3>
                  </div>
                  <div className="portfolio-widget-card-actions">
                    {primaryAction && primaryActionMeta?.executable ? (
                      <button
                        className="portfolio-widget-run-handle"
                        type="button"
                        onClick={() => onWidgetAction?.(widget, primaryAction)}
                        aria-label={`${widget.title} ${primaryActionMeta.buttonLabel}`}
                        title={primaryActionMeta.footerLabel}
                      >
                        <RefreshCw size={14} strokeWidth={2.3} />
                      </button>
                    ) : null}
                    {isAssetPriceHistoryWidget ? (
                      <button
                        className={`portfolio-widget-compare-button portfolio-widget-evaluation-button ${evaluationTableIsActive ? "is-active" : ""}`}
                        type="button"
                        aria-pressed={evaluationTableIsActive}
                        aria-label={`${widget.title} 평가 테이블`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onCreateAssetEvaluation?.(widget);
                        }}
                      >
                        평가 테이블
                      </button>
                    ) : null}
                    {isAssetPriceHistoryWidget ? (
                      <button
                        className={`portfolio-widget-compare-button ${comparisonModeIsActive ? "is-active" : ""}`}
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={comparisonOverlayIsOpen}
                        aria-pressed={comparisonModeIsActive}
                        aria-label={`${widget.title} 비교하기`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setComparisonDraftAssets(normalizePortfolioComparisonAssets(widget));
                          setComparisonOverlayWidgetId(widget.id);
                        }}
                      >
                        비교하기
                      </button>
                    ) : null}
                    {isAssetPriceHistoryWidget ? (
                      <button
                        className="portfolio-widget-currency-toggle portfolio-widget-cycle-toggle"
                        type="button"
                        aria-label={`${widget.title} ${selectedAssetHistoryCurrency === "USD" ? "원으로" : "달러로"} 전환 · 현재 ${selectedAssetHistoryCurrency === "USD" ? "달러" : "원"}`}
                        title={`${selectedAssetHistoryCurrency === "USD" ? "원으로" : "달러로"} 전환`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onAssetHistoryCurrencyChange?.(
                            widget,
                            selectedAssetHistoryCurrency === "USD" ? "KRW" : "USD"
                          );
                        }}
                      >
                        <span className={selectedAssetHistoryCurrency === "USD" ? "is-selected" : ""} aria-hidden="true">
                          달러
                        </span>
                        <span className={selectedAssetHistoryCurrency === "KRW" ? "is-selected" : ""} aria-hidden="true">
                          원
                        </span>
                      </button>
                    ) : null}
                    {isSeasonalComparisonWidget ? (
                      <div
                        className="portfolio-widget-currency-toggle"
                        role="group"
                        aria-label={`${widget.title} 표시 통화`}
                      >
                        {[
                          ["USD", "달러"],
                          ["KRW", "원"],
                        ].map(([currency, label]) => (
                          <button
                            className={selectedAssetHistoryCurrency === currency ? "is-selected" : ""}
                            type="button"
                            key={`${widget.id}-${currency}`}
                            aria-pressed={selectedAssetHistoryCurrency === currency}
                            aria-label={`${widget.title} ${label}로 보기`}
                            title={`${label}로 보기`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (selectedAssetHistoryCurrency !== currency) {
                                onAssetHistoryCurrencyChange?.(widget, currency);
                              }
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {isPositionStatusWidget ? (
                      <button
                        className="portfolio-widget-currency-toggle portfolio-widget-cycle-toggle"
                        type="button"
                        aria-label={`${widget.title} ${selectedAssetHistoryCurrency === "USD" ? "원으로" : "달러로"} 전환 · 현재 ${selectedAssetHistoryCurrency === "USD" ? "달러" : "원"}`}
                        title={`${selectedAssetHistoryCurrency === "USD" ? "원으로" : "달러로"} 전환`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onAssetHistoryCurrencyChange?.(
                            widget,
                            selectedAssetHistoryCurrency === "USD" ? "KRW" : "USD"
                          );
                        }}
                      >
                        <span className={selectedAssetHistoryCurrency === "KRW" ? "is-selected" : ""} aria-hidden="true">
                          원
                        </span>
                        <span className={selectedAssetHistoryCurrency === "USD" ? "is-selected" : ""} aria-hidden="true">
                          달러
                        </span>
                      </button>
                    ) : null}
                    {isPositionStatusWidget ? (
                      <button
                        className="portfolio-widget-currency-toggle portfolio-widget-cycle-toggle"
                        type="button"
                        aria-label={`${widget.title} ${selectedPositionStatusView === "pie" ? "사각형" : "원"} 보기로 전환 · 현재 ${selectedPositionStatusView === "pie" ? "원" : "사각형"}`}
                        title={`${selectedPositionStatusView === "pie" ? "사각형" : "원"} 보기로 전환`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onPositionStatusViewChange?.(
                            widget,
                            selectedPositionStatusView === "pie" ? "bar" : "pie"
                          );
                        }}
                      >
                        <span className={selectedPositionStatusView === "pie" ? "is-selected" : ""} aria-hidden="true">
                          원
                        </span>
                        <span className={selectedPositionStatusView === "bar" ? "is-selected" : ""} aria-hidden="true">
                          사각형
                        </span>
                      </button>
                    ) : null}
                    {isAssetEvaluationWidget ? (
                      <div className="portfolio-widget-beta-control">
                        <span>BETA:</span>
                        <button
                          className="portfolio-widget-currency-toggle portfolio-widget-cycle-toggle portfolio-widget-beta-toggle"
                          type="button"
                          aria-label={`${widget.title} BETA 기준 ${selectedBetaBenchmark.id === "KODEX_200" ? "VOO" : "KODEX 200"}로 전환 · 현재 ${selectedBetaBenchmark.label}`}
                          title={`BETA 기준 ${selectedBetaBenchmark.id === "KODEX_200" ? "VOO" : "KODEX 200"}로 전환`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            changeAssetEvaluationBetaBenchmark(
                              widget,
                              selectedBetaBenchmark.id === "KODEX_200" ? "VOO" : "KODEX_200"
                            );
                          }}
                        >
                          <span className={selectedBetaBenchmark.id === "VOO" ? "is-selected" : ""} aria-hidden="true">
                            VOO
                          </span>
                          <span className={selectedBetaBenchmark.id === "KODEX_200" ? "is-selected" : ""} aria-hidden="true">
                            KODEX 200
                          </span>
                        </button>
                      </div>
                    ) : null}
                    <button
                      className="portfolio-widget-drag-handle"
                      type="button"
                      onPointerDown={(event) => startMove(event, widget)}
                      aria-label={`${widget.title} 이동`}
                      title="위젯 이동"
                    >
                      <Move size={14} strokeWidth={2.2} />
                    </button>
                  </div>
                </header>
                <PortfolioWidgetRelationMeta widget={widget} widgets={widgets} />
                {widget.agentSummary || widget.dataset?.length || widget.status === "ready" ? (
                  <PortfolioWidgetProducedContent
                    widget={widget}
                    widgets={widgets}
                    onWidgetDisplayData={onWidgetDisplayData}
                  />
                ) : (
                  <p>{widget.prompt || "프롬프트를 입력하면 이 위젯의 역할과 데이터 요구사항이 여기에 남습니다."}</p>
                )}
                <div className="portfolio-widget-card-footer">
                  <span>
                  {widget.displayId || widget.id} · {renderedLayout.w}x{renderedLayout.h} · {renderedLayout.x + 1}열 {renderedLayout.y + 1}행 · 이동/크기 조절 가능
                  </span>
                  <div className="portfolio-widget-card-footer-actions">
                    <button
                      className="portfolio-widget-delete-handle"
                      type="button"
                      onClick={() => onDeleteWidget?.(widget)}
                      aria-label={`${widget.title} 삭제`}
                      title="위젯 삭제"
                    >
                      <Trash2 size={14} strokeWidth={2.15} />
                    </button>
                  </div>
                </div>
                {comparisonOverlayIsOpen ? (
                  <div
                    className="portfolio-widget-comparison-overlay"
                    role="dialog"
                    aria-label={`${widget.title} 비교 자산 선택`}
                  >
                    <button
                      className="portfolio-widget-comparison-close"
                      type="button"
                      autoFocus
                      aria-label={`${widget.title} 비교 오버레이 닫기`}
                      title="닫기"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setComparisonAssetDialogWidgetId("");
                        setComparisonOverlayWidgetId("");
                      }}
                    >
                      <X size={16} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                    <div className={`portfolio-widget-comparison-body ${comparisonDraftAssets.length ? "has-assets" : ""}`}>
                      {comparisonDraftAssets.length ? (
                        <div className="portfolio-widget-comparison-selection">
                          <div className="portfolio-widget-comparison-list" aria-label="비교할 자산 목록">
                            {comparisonDraftAssets.map((asset) => (
                              <div className="portfolio-widget-comparison-row" key={`${widget.id}-${asset.symbol}`}>
                                <strong>{asset.symbol}</strong>
                                <span title={[asset.name, asset.englishName].filter(Boolean).join(" · ")}>
                                  {[asset.name, asset.englishName].filter(Boolean).join(" · ") || asset.symbol}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`${asset.symbol} 비교 자산에서 삭제`}
                                  title="비교 자산에서 삭제"
                                  onClick={() => {
                                    setComparisonDraftAssets((current) => current.filter((item) => item.symbol !== asset.symbol));
                                  }}
                                >
                                  <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                                </button>
                              </div>
                            ))}
                          </div>
                          {comparisonDraftAssets.length < PORTFOLIO_COMPARISON_ASSET_LIMIT ? (
                            <button
                              className="portfolio-widget-comparison-add-more"
                              type="button"
                              onClick={() => setComparisonAssetDialogWidgetId(widget.id)}
                            >
                              <Plus size={15} strokeWidth={2.35} aria-hidden="true" />
                              <span>비교할 자산 더 추가하기</span>
                            </button>
                          ) : (
                            <span className="portfolio-widget-comparison-limit">비교 자산 5개를 모두 추가했습니다</span>
                          )}
                        </div>
                      ) : (
                        <button
                          className="portfolio-widget-comparison-add"
                          type="button"
                          aria-describedby={`${widget.id}-comparison-overlay-description`}
                          onClick={() => setComparisonAssetDialogWidgetId(widget.id)}
                        >
                          <span className="portfolio-widget-comparison-add-icon" aria-hidden="true">
                            <Plus size={22} strokeWidth={2.4} />
                          </span>
                          <span className="portfolio-widget-comparison-add-copy">
                            <strong id={`${widget.id}-comparison-overlay-title`}>비교할 자산 추가하기</strong>
                            <span id={`${widget.id}-comparison-overlay-description`}>
                              현재 차트와 함께 볼 자산을 선택하세요
                            </span>
                          </span>
                        </button>
                      )}
                    </div>
                    <button
                      className="portfolio-widget-comparison-confirm"
                      type="button"
                      disabled={!comparisonDraftAssets.length && !committedComparisonAssets.length}
                      onClick={() => {
                        setWidgets((current) => current.map((item) => (
                          item.id === widget.id
                            ? {
                                ...item,
                                chartSpec: {
                                  ...(item.chartSpec || {}),
                                  chartType: comparisonDraftAssets.length ? "line" : "area",
                                  query: {
                                    ...(item.chartSpec?.query || {}),
                                    comparisonAssets: comparisonDraftAssets,
                                  },
                                },
                                updatedAt: new Date().toISOString(),
                              }
                            : item
                        )));
                        appendLog?.(`비교 자산 적용 · ${widget.displayId || widget.id} · ${comparisonDraftAssets.length}개`);
                        setComparisonAssetDialogWidgetId("");
                        setComparisonOverlayWidgetId("");
                      }}
                    >
                      확인
                    </button>
                  </div>
                ) : null}
                {comparisonAssetDialogWidgetId === widget.id ? (
                  <PortfolioComparisonAssetDialog
                    excludedSymbols={comparisonDraftAssets.map((asset) => asset.symbol)}
                    onCancel={() => setComparisonAssetDialogWidgetId("")}
                    onSubmit={(asset) => {
                      setComparisonDraftAssets((current) => (
                        current.length >= PORTFOLIO_COMPARISON_ASSET_LIMIT || current.some((item) => item.symbol === asset.symbol)
                          ? current
                          : [...current, asset]
                      ));
                      setComparisonAssetDialogWidgetId("");
                    }}
                  />
                ) : null}
                {resizeZones(widget)}
              </article>
            </React.Fragment>
          );
        })}
      </div>

      <section className="portfolio-widget-activity" aria-labelledby="portfolio-widget-activity-title">
        <h3 id="portfolio-widget-activity-title">최근 상태</h3>
        <ol>
          {activityLog.slice(-4).map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
