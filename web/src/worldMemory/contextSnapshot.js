import { compactVisibleScreenText } from "../shell/screenSnapshot.js";
import { worldMemoryActionCatalog } from "./actionCatalog.js";
import { worldMemoryActionText } from "./statusHelpers.js";

function compactWorldMemoryReportForContext(report = {}) {
  const view = report?.view || null;
  return {
    status: compactVisibleScreenText(report?.status || "empty", 60),
    generatedAt: compactVisibleScreenText(report?.generatedAt || "", 80),
    title: compactVisibleScreenText(view?.title || report?.title || "", 180),
    asOf: compactVisibleScreenText(view?.asOf || report?.generatedAt || "", 80),
    stance: compactVisibleScreenText(view?.stance || "", 80),
    summary: compactVisibleScreenText(view?.summary || report?.summary || "", 700),
    narrative: compactVisibleScreenText(view?.narrative || report?.text || "", 900),
    signalRadar: Array.isArray(view?.signalRadar)
      ? view.signalRadar.slice(0, 8).map((signal) => ({
          label: compactVisibleScreenText(signal?.label, 80),
          score: Number(signal?.score || 0),
          tone: compactVisibleScreenText(signal?.tone, 40),
          note: compactVisibleScreenText(signal?.note, 220),
        }))
      : [],
    highlights: Array.isArray(view?.highlights)
      ? view.highlights.slice(0, 8).map((item) => ({
          tag: compactVisibleScreenText(item?.tag, 60),
          title: compactVisibleScreenText(item?.title, 140),
          body: compactVisibleScreenText(item?.body, 320),
          importance: compactVisibleScreenText(item?.importance, 40),
        }))
      : [],
    memoryChangeSuggestions: Array.isArray(view?.memoryChangeSuggestions)
      ? view.memoryChangeSuggestions.slice(0, 8).map((item) => compactVisibleScreenText(item, 240))
      : [],
    portfolioSuggestions: Array.isArray(view?.portfolioSuggestions)
      ? view.portfolioSuggestions.slice(0, 8).map((item) => compactVisibleScreenText(item, 240))
      : [],
    nextChecks: Array.isArray(view?.nextChecks)
      ? view.nextChecks.slice(0, 8).map((item) => compactVisibleScreenText(item, 220))
      : [],
    textFallback: compactVisibleScreenText(report?.text || "", 1000),
  };
}

export function buildWorldMemoryPageContextSnapshot(status, actionResult, focusedChangeSuggestion = null) {
  const collector = status?.collector || {};
  const schedule = status?.schedule || {};
  const report = status?.report || {};
  const reportChangeSuggestions = Array.isArray(report?.view?.memoryChangeSuggestions)
    ? report.view.memoryChangeSuggestions
    : Array.isArray(report.suggestions)
      ? report.suggestions
      : [];
  const pendingChangeSuggestion =
    focusedChangeSuggestion && typeof focusedChangeSuggestion === "object"
      ? {
          source: compactVisibleScreenText(focusedChangeSuggestion.source || "world-memory-report-item", 80),
          section: compactVisibleScreenText(focusedChangeSuggestion.section || "memory-change", 80),
          sectionLabel: compactVisibleScreenText(focusedChangeSuggestion.sectionLabel || "월드 메모리 변경 제안", 120),
          item:
            focusedChangeSuggestion.item && typeof focusedChangeSuggestion.item === "object"
              ? focusedChangeSuggestion.item
              : null,
        }
      : null;
  return {
    source: "world-memory-page-state",
    capturedAt: new Date().toISOString(),
    screen: "world-memory",
    collector: {
      status: collector.status || "idle",
      lastAction: collector.lastAction || "",
      lastSuccessfulAt: collector.lastSuccessfulAt || "",
      lastFinishedAt: collector.lastFinishedAt || "",
      lastError: collector.lastError || "",
    },
    schedule: {
      nextRunAt: schedule.nextRunAt || "",
      nextRetryAt: schedule.nextRetryAt || "",
      pausedUntil: schedule.pausedUntil || "",
      activeCycle: schedule.activeCycle || null,
    },
    report: compactWorldMemoryReportForContext(report),
    changeSuggestions: reportChangeSuggestions.slice(0, 10).map((item) => compactVisibleScreenText(item, 260)),
    pendingChangeSuggestion,
    recentRun: compactVisibleScreenText(worldMemoryActionText(actionResult) || collector.lastAction || "", 600),
    availableActions: Object.entries(worldMemoryActionCatalog).map(([id, meta]) => ({
      id,
      label: meta.label,
      riskLevel: meta.riskLevel,
    })),
  };
}
