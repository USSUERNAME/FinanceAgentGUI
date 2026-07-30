function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const sectorThemeTerms = {
  XLB: ["소재", "금속", "철강", "화학", "원자재"],
  XLC: ["커뮤니케이션", "미디어", "광고", "플랫폼"],
  XLE: ["에너지", "원유", "천연가스", "정유"],
  XLF: ["금융", "은행", "보험", "증권"],
  XLI: ["산업재", "전력망", "인프라", "설비", "운송"],
  XLK: ["기술", "성장주", "ai", "반도체", "데이터센터", "소프트웨어"],
  XLP: ["필수소비재", "방어소비", "생활용품"],
  XLRE: ["부동산", "리츠"],
  XLU: ["유틸리티", "전력", "전기", "가스"],
  XLV: ["헬스케어", "바이오", "제약", "의료"],
  XLY: ["경기소비재", "고급소비", "자동차", "소매"],
};

function uniqueRecords(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    const id = cleanText(record?.continuityId);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function activeInvestmentTheses(memory = {}) {
  const records = Array.isArray(memory?.records)
    ? memory.records
    : Array.isArray(memory?.activeRecords)
      ? memory.activeRecords
      : [];
  return uniqueRecords(records)
    .filter((record) => !["invalidated", "archived"].includes(cleanText(record?.state)))
    .sort((first, second) => {
      const dateOrder = cleanText(second?.lastSeenAt).localeCompare(cleanText(first?.lastSeenAt));
      if (dateOrder) return dateOrder;
      return cleanText(first?.title).localeCompare(cleanText(second?.title), "ko");
    });
}

export function investmentThesisStateLabel(record = {}) {
  return cleanText(record?.stateLabel) || {
    confirmed: "근거 확인",
    watching: "추적 중",
    candidate: "후보",
    weakened: "약화",
    invalidated: "무효화",
    archived: "보관",
  }[cleanText(record?.state)] || "상태 미정";
}

function reportSearchText(report = {}) {
  const view = report?.view || {};
  return [
    report?.title,
    report?.summary,
    report?.text,
    view?.title,
    view?.summary,
    view?.narrative,
    ...(Array.isArray(view?.highlights)
      ? view.highlights.flatMap((item) => [item?.title, item?.body, item?.tag])
      : []),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function thesisSearchTerms(record = {}) {
  const titleTerm = cleanText(record?.title)
    .replace(/\s*(섹터|투자)?\s*가설$/u, "")
    .trim();
  const entityId = cleanText(record?.entityId).toUpperCase();
  return [
    record?.entityId,
    record?.ticker,
    record?.sectorTicker,
    record?.sectorLabel,
    titleTerm,
    ...(record?.kind === "sector" ? sectorThemeTerms[entityId] || [] : []),
  ]
    .map((item) => cleanText(item).toLowerCase())
    .filter((item) => item.length >= 2);
}

export function relatedInvestmentTheses(report = {}, memory = {}, limit = 3) {
  const searchText = reportSearchText(report);
  if (!searchText) return [];
  return activeInvestmentTheses(memory)
    .map((record) => ({
      record,
      score: thesisSearchTerms(record).reduce(
        (score, term) => score + (searchText.includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((item) => item.record);
}

export function investmentThesisDomId(record = {}) {
  const safeId = cleanText(record?.continuityId)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `world-memory-thesis-${safeId || "unknown"}`;
}
