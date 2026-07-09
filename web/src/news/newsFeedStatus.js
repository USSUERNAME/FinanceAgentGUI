export function newsFeedStatusLabel(status) {
  return newsFeedHealthState(status).statusLabel;
}

const marketSummarySidebarStates = {
  none: {
    level: "none",
    title: "News Feed 시장 상태: 특이 긴급 신호 없음",
    ariaLabel: "News Feed 시장 상태 특이 긴급 신호 없음",
  },
  watch: {
    level: "watch",
    title: "News Feed 시장 상태: 관찰 필요",
    ariaLabel: "News Feed 시장 상태 관찰 필요",
  },
  urgent: {
    level: "urgent",
    title: "News Feed 시장 상태: 긴급 확인 필요",
    ariaLabel: "News Feed 시장 상태 긴급 확인 필요",
  },
  critical: {
    level: "critical",
    title: "News Feed 시장 상태: 비상 확인 필요",
    ariaLabel: "News Feed 시장 상태 비상 확인 필요",
  },
};

function normalizeMarketSummaryAlertLevel(summary) {
  const level = String(summary?.alertLevel || "none").trim().toLowerCase();
  return Object.hasOwn(marketSummarySidebarStates, level) ? level : "none";
}

export function newsFeedFeeds(status) {
  if (status?.feeds?.length) return status.feeds;
  return status?.configuredFeeds || [];
}

function newsFeedEnabledFeeds(status) {
  return newsFeedFeeds(status).filter((feed) => feed.enabled !== false);
}

function newsFeedFeedHealth(status) {
  const enabledFeeds = newsFeedEnabledFeeds(status);
  const okCount = enabledFeeds.filter((feed) => feed.lastFetchStatus === "ok").length;
  const errorCount = enabledFeeds.filter((feed) => feed.lastFetchStatus === "error" || feed.lastError).length;
  return {
    enabledCount: enabledFeeds.length,
    okCount,
    errorCount,
    allOk: enabledFeeds.length > 0 && okCount === enabledFeeds.length,
    hasAnyOk: okCount > 0,
    hasAnyError: errorCount > 0,
    hasPartialError: okCount > 0 && errorCount > 0,
  };
}

function newsFeedAllEnabledFeedsFailed(status) {
  const feedHealth = newsFeedFeedHealth(status);
  return feedHealth.enabledCount > 0 && feedHealth.okCount === 0 && feedHealth.errorCount === feedHealth.enabledCount;
}

function newsFeedHasPartialFeedError(status) {
  return newsFeedFeedHealth(status).hasPartialError;
}

function newsFeedCollectingLevel(status) {
  const collector = status?.collector || {};
  const feedHealth = newsFeedFeedHealth(status);
  if (feedHealth.hasAnyError) return "warning";
  if (collector.healthy || feedHealth.allOk || feedHealth.hasAnyOk) return "online";
  return "idle";
}

function newsFeedCollectingDetail(level) {
  if (level === "online") return "최근 피드 정상";
  if (level === "warning") return "일부 피드 확인 필요";
  return "상태 확인 중";
}

function newsFeedHasFeedError(status) {
  const enabledFeeds = newsFeedEnabledFeeds(status);
  return enabledFeeds.some((feed) => feed.lastFetchStatus === "error" || feed.lastError);
}

export function newsFeedHealthState(status) {
  const collector = status?.collector || {};
  const feedHealth = newsFeedFeedHealth(status);
  if (collector.inFlight) {
    const level = newsFeedCollectingLevel(status);
    const detail = newsFeedCollectingDetail(level);
    return {
      level,
      isCollecting: true,
      statusLabel: "수집 중",
      pillLabel: "수집 중",
      title: `News Feed 수집 중 · ${detail}`,
      ariaLabel: `News Feed 수집 중, ${detail}`,
    };
  }
  if (collector.healthy) {
    return {
      level: "online",
      statusLabel: "수집 정상",
      pillLabel: "정상",
      title: "News Feed 수집 정상",
      ariaLabel: "News Feed 수집 정상",
    };
  }
  if (feedHealth.allOk || (feedHealth.hasAnyOk && !feedHealth.hasAnyError)) {
    return {
      level: "online",
      statusLabel: "최근 피드 정상",
      pillLabel: "정상",
      title: "News Feed 최근 피드 정상",
      ariaLabel: "News Feed 최근 피드 정상",
    };
  }
  if (newsFeedHasPartialFeedError(status)) {
    return {
      level: "warning",
      statusLabel: "일부 오류",
      pillLabel: "일부 오류",
      title: collector.lastError ? `News Feed 일부 피드 오류: ${collector.lastError}` : "News Feed 일부 피드 오류",
      ariaLabel: "News Feed 일부 피드 오류",
    };
  }
  if (collector.lastError || newsFeedHasFeedError(status)) {
    return {
      level: "warning",
      statusLabel: "수집 오류",
      pillLabel: "확인 필요",
      title: collector.lastError ? `News Feed 수집 오류: ${collector.lastError}` : "News Feed 피드 오류",
      ariaLabel: "News Feed 수집 오류",
    };
  }
  return {
    level: "idle",
    statusLabel: "대기",
    pillLabel: "대기/오류",
    title: "News Feed 수집 대기",
    ariaLabel: "News Feed 수집 대기",
  };
}

export function newsFeedSidebarHealthState(status, marketSummary = null) {
  const base = newsFeedHealthState(status);
  if (newsFeedAllEnabledFeedsFailed(status)) {
    const collector = status?.collector || {};
    return {
      ...base,
      level: "network-error",
      sidebarLevel: "network-error",
      title: collector.lastError ? `News Feed 네트워크 오류: ${collector.lastError}` : "News Feed 네트워크 오류",
      ariaLabel: "News Feed 네트워크 오류",
      showSidebarDot: true,
    };
  }

  const alertLevel = normalizeMarketSummaryAlertLevel(marketSummary);
  const summaryState = marketSummarySidebarStates[alertLevel];
  const severityText = String(marketSummary?.severityKo || "").trim();
  return {
    ...base,
    level: summaryState.level,
    sidebarLevel: summaryState.level,
    title: severityText ? `${summaryState.title}: ${severityText}` : summaryState.title,
    ariaLabel: summaryState.ariaLabel,
    showSidebarDot: true,
  };
}
