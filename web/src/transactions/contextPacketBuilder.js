function cleanContextText(value = "", limit = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function buildTransactionStatusContextPacket({
  activeSection = "investment",
  viewMode = "live-investment-overview",
  account = null,
  selectedWatchlistGroup = null,
  displaySettings = null,
  surface = null,
} = {}) {
  const normalizedSurface = surface && typeof surface === "object" ? surface : null;
  return {
    screen: "transaction-status",
    source: "현재 거래현황 화면",
    activeSection: activeSection === "watchlist" ? "watchlist" : "investment",
    viewMode: cleanContextText(viewMode, 80),
    account: account && typeof account === "object"
      ? {
          type: cleanContextText(account.type, 40),
          id: cleanContextText(account.id, 120),
          label: cleanContextText(account.label, 120),
        }
      : null,
    selectedWatchlistGroup: selectedWatchlistGroup && typeof selectedWatchlistGroup === "object"
      ? {
          id: cleanContextText(selectedWatchlistGroup.id, 120),
          name: cleanContextText(selectedWatchlistGroup.name, 120),
          instrumentCount: Number(
            selectedWatchlistGroup.instrumentCount ??
            selectedWatchlistGroup.instruments?.length ??
            selectedWatchlistGroup.symbols?.length ??
            0
          ),
        }
      : null,
    displaySettings: displaySettings && typeof displaySettings === "object" ? displaySettings : null,
    surfaces: normalizedSurface ? [normalizedSurface] : [],
    dataAccessPolicy: {
      overview: "현재 목록과 메인 테이블 행은 Context Packet에 직접 포함",
      chart: "차트 요약은 Context Packet에 직접 포함하고 전체 시계열은 질문별 로컬 RAG로 검색",
      persistence: "request-only",
      instruction: "거래현황 수치가 필요하면 화면 요약과 검색 청크를 우선 사용하고 누락된 값을 추정하지 않습니다.",
    },
  };
}
