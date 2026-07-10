export function worldMemoryAuditValue(status, metricName, fallback = "-") {
  const rows = Array.isArray(status?.audit?.json?.rows) ? status.audit.json.rows : [];
  const row = rows.find((item) => String(item.Metric || "").trim() === metricName);
  return row?.Value ?? fallback;
}

export function worldMemoryActionText(result) {
  if (!result) return "";
  return result.outputText || result.stdout || result.error || "";
}

export function worldMemoryStatusLabel(status) {
  const raw = String(status?.collector?.status || "idle");
  const labels = {
    idle: "대기",
    collecting: "수집 중",
    generating_briefs: "후보 정리 중",
    writing_report: "보고서 작성 중",
    retry_wait: "재시도 대기",
    failed: "실패",
    ok: "정상",
    paused: "일시정지",
    disabled: "꺼짐",
  };
  return labels[raw] || raw;
}

function auditRows(status) {
  return Array.isArray(status?.audit?.json?.rows) ? status.audit.json.rows : [];
}

function auditValue(status, metricName, fallback = null) {
  return worldMemoryAuditValue(status, metricName, fallback);
}

function numericAuditValue(status, metricName, fallback = 0) {
  const value = auditValue(status, metricName, fallback);
  const numeric = Number(String(value ?? "").replace("%", "").replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resultFailed(result) {
  return result && result.ok === false;
}

function embeddingRows(status) {
  return Array.isArray(status?.embeddings?.json?.rows) ? status.embeddings.json.rows : [];
}

function embeddingIssueCounts(status) {
  return embeddingRows(status).reduce(
    (counts, row) => {
      const stale = Number(row.Stale || row.stale || 0);
      const missing = Number(row.Missing || row.missing || 0);
      return {
        stale: counts.stale + (Number.isFinite(stale) ? stale : 0),
        missing: counts.missing + (Number.isFinite(missing) ? missing : 0),
      };
    },
    { stale: 0, missing: 0 }
  );
}

function hasDependencyIssue(status, severity) {
  const issues = Array.isArray(status?.dependencies?.issues) ? status.dependencies.issues : [];
  return issues.some((issue) => issue.status === severity);
}

function worldMemoryHasCriticalMaintenanceDebt(status) {
  const storyFillRate = numericAuditValue(status, "Story fill rate", 100);
  const briefStoryFillRate = numericAuditValue(status, "Brief story fill rate", 100);
  const dedupeFillRate = numericAuditValue(status, "Brief dedupe fill rate", 100);
  const cleanupCandidates = numericAuditValue(status, "Cleanup candidates", 0);
  const legacyBlankIssues = numericAuditValue(status, "Legacy blank issues", 0);
  const orphanBriefs = numericAuditValue(status, "Orphan briefs with metadata", 0);
  const totalEntries = Math.max(1, numericAuditValue(status, "Total entries", 1));
  const suggestedFamilySplits = numericAuditValue(status, "Suggested family splits", 0);
  const embeddingIssues = embeddingIssueCounts(status);

  return (
    storyFillRate < 50 ||
    briefStoryFillRate < 45 ||
    dedupeFillRate < 70 ||
    cleanupCandidates >= 25 ||
    legacyBlankIssues >= 10 ||
    orphanBriefs / totalEntries >= 0.5 ||
    suggestedFamilySplits >= 8 ||
    embeddingIssues.stale + embeddingIssues.missing >= 50
  );
}

function worldMemoryHasMaintenanceWarning(status) {
  const storyFillRate = numericAuditValue(status, "Story fill rate", 100);
  const briefStoryFillRate = numericAuditValue(status, "Brief story fill rate", 100);
  const dedupeFillRate = numericAuditValue(status, "Brief dedupe fill rate", 100);
  const cleanupCandidates = numericAuditValue(status, "Cleanup candidates", 0);
  const legacyBlankIssues = numericAuditValue(status, "Legacy blank issues", 0);
  const orphanBriefs = numericAuditValue(status, "Orphan briefs with metadata", 0);
  const totalEntries = Math.max(1, numericAuditValue(status, "Total entries", 1));
  const suggestedFamilySplits = numericAuditValue(status, "Suggested family splits", 0);
  const embeddingIssues = embeddingIssueCounts(status);

  return (
    storyFillRate < 65 ||
    briefStoryFillRate < 60 ||
    dedupeFillRate < 90 ||
    cleanupCandidates > 0 ||
    legacyBlankIssues > 0 ||
    orphanBriefs / totalEntries >= 0.35 ||
    suggestedFamilySplits > 0 ||
    embeddingIssues.stale + embeddingIssues.missing > 0 ||
    hasDependencyIssue(status, "warning") ||
    resultFailed(status?.list) ||
    resultFailed(status?.states) ||
    resultFailed(status?.taxonomy) ||
    resultFailed(status?.embeddings) ||
    status?.report?.status !== "ready"
  );
}

export function worldMemoryHealthState(status, { error = "", busy = false, enabled = true } = {}) {
  const collector = status?.collector || {};
  const collectorStatus = String(collector.status || "");
  if (!enabled || status?.enabled === false || collectorStatus === "disabled") {
    return {
      level: "idle",
      showSidebarDot: false,
      statusLabel: "꺼짐",
      title: "World Memory 꺼짐",
      ariaLabel: "World Memory 꺼짐",
    };
  }

  if (!status) {
    const checking = Boolean(busy);
    return {
      level: "warning",
      showSidebarDot: true,
      isCollecting: checking,
      statusLabel: checking ? "상태 확인 중" : "상태 확인 필요",
      title: checking ? "World Memory 상태 확인 중" : "World Memory 상태 확인 필요",
      ariaLabel: checking ? "World Memory 상태 확인 중" : "World Memory 상태 확인 필요",
    };
  }

  const hardFailure =
    Boolean(error) ||
    status.ok === false ||
    status?.dependencies?.ok === false ||
    hasDependencyIssue(status, "error") ||
    resultFailed(status?.init) ||
    resultFailed(status?.audit) ||
    collectorStatus === "failed" ||
    worldMemoryHasCriticalMaintenanceDebt(status);

  if (hardFailure) {
    return {
      level: "error",
      showSidebarDot: true,
      statusLabel: "관리 필요",
      title: error ? `World Memory 관리 필요: ${error}` : "World Memory 관리 필요",
      ariaLabel: "World Memory 관리 필요",
    };
  }

  if (status.diagnosticsDeferred) {
    const warning =
      collectorStatus === "retry_wait" ||
      Boolean(collector.lastError) ||
      status?.report?.status !== "ready";
    if (warning) {
      return {
        level: "warning",
        showSidebarDot: true,
        isCollecting: Boolean(collector.inFlight || collector.running || busy),
        statusLabel: "경고",
        title: "World Memory 수집 상태 확인 필요",
        ariaLabel: "World Memory 수집 상태 경고",
      };
    }
    return {
      level: "online",
      showSidebarDot: true,
      isCollecting: Boolean(collector.inFlight || collector.running || busy),
      statusLabel: "수집 정상",
      title: "World Memory 수집 상태 정상 · 정밀 점검은 화면 진입 시 실행",
      ariaLabel: "World Memory 수집 상태 정상",
    };
  }

  const warning =
    collectorStatus === "retry_wait" ||
    Boolean(collector.lastError) ||
    !auditRows(status).length ||
    worldMemoryHasMaintenanceWarning(status);

  if (warning) {
    return {
      level: "warning",
      showSidebarDot: true,
      isCollecting: Boolean(collector.inFlight || collector.running || busy),
      statusLabel: "경고",
      title: "World Memory 정리 상태 확인 필요",
      ariaLabel: "World Memory 정리 상태 경고",
    };
  }

  return {
    level: "online",
    showSidebarDot: true,
    isCollecting: Boolean(collector.inFlight || collector.running || busy),
    statusLabel: "정리 양호",
    title: "World Memory 정리 상태 양호",
    ariaLabel: "World Memory 정리 상태 양호",
  };
}
