import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_DATA_DIR = join(GUIBUILD_ROOT, "data", "pb-daily-intelligence");
const HISTORY_FILE_NAME = "portfolio-risk-history.json";
const MAX_HISTORY_DAYS = 90;

function cleanText(value, limit = 120) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanTicker(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker) ? ticker : "";
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))].sort();
}

export function portfolioRiskSnapshot({
  reportDate,
  riskReview = {},
  quickPortfolioWeight = 0,
} = {}) {
  const stockHigh = (riskReview.stockConcentration || [])
    .filter((item) => item?.severity === "high")
    .map((item) => cleanTicker(item?.ticker))
    .filter(Boolean);
  const sectorHigh = (riskReview.sectorConcentration || [])
    .filter((item) => item?.severity === "high")
    .map((item) => cleanTicker(item?.ticker))
    .filter(Boolean);
  const thesisConflicts = (riskReview.thesisConflicts || [])
    .map((item) => {
      const ticker = cleanTicker(item?.ticker);
      const sectorTicker = cleanTicker(item?.sectorTicker);
      return ticker && sectorTicker ? `${ticker}:${sectorTicker}` : "";
    })
    .filter(Boolean);
  const unmapped = (riskReview.unmapped || [])
    .map((item) => cleanTicker(item?.ticker))
    .filter(Boolean);
  return {
    reportDate: cleanText(reportDate, 20),
    capturedAt: new Date().toISOString(),
    quickPortfolioWeight: Number(quickPortfolioWeight || 0),
    stockHigh: uniqueSorted(stockHigh),
    sectorHigh: uniqueSorted(sectorHigh),
    thesisConflicts: uniqueSorted(thesisConflicts),
    unmapped: uniqueSorted(unmapped),
  };
}

function changes(current = [], previous = []) {
  const previousSet = new Set(previous);
  const currentSet = new Set(current);
  return {
    added: current.filter((item) => !previousSet.has(item)),
    removed: previous.filter((item) => !currentSet.has(item)),
  };
}

export function comparePortfolioRiskSnapshots(current = {}, previous = null) {
  const stockHigh = changes(current.stockHigh || [], previous?.stockHigh || []);
  const sectorHigh = changes(current.sectorHigh || [], previous?.sectorHigh || []);
  const thesisConflicts = changes(
    current.thesisConflicts || [],
    previous?.thesisConflicts || [],
  );
  const unmapped = changes(current.unmapped || [], previous?.unmapped || []);
  const addedCount =
    stockHigh.added.length
    + sectorHigh.added.length
    + thesisConflicts.added.length
    + unmapped.added.length;
  const removedCount =
    stockHigh.removed.length
    + sectorHigh.removed.length
    + thesisConflicts.removed.length
    + unmapped.removed.length;
  return {
    previousDate: previous?.reportDate || "",
    stockHigh,
    sectorHigh,
    thesisConflicts,
    unmapped,
    addedCount,
    removedCount,
    direction: addedCount > removedCount
      ? "worsened"
      : removedCount > addedCount
        ? "improved"
        : "unchanged",
    summary: !previous
      ? "첫 포트폴리오 위험 기준점을 저장했습니다."
      : addedCount || removedCount
        ? `전일 대비 신규 위험 ${addedCount}건 · 해소 ${removedCount}건`
        : "전일 대비 집중도·가설 충돌 변화가 없습니다.",
  };
}

export function updatePortfolioRiskHistory(history = [], snapshot = {}) {
  const normalizedHistory = Array.isArray(history)
    ? history.filter((item) => item?.reportDate && item.reportDate !== snapshot.reportDate)
    : [];
  const previous = [...normalizedHistory]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0] || null;
  const comparison = comparePortfolioRiskSnapshots(snapshot, previous);
  const nextHistory = [...normalizedHistory, snapshot]
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    .slice(-MAX_HISTORY_DAYS);
  return { history: nextHistory, comparison };
}

function riskCounts(snapshot = {}) {
  const stockHigh = (snapshot.stockHigh || []).length;
  const sectorHigh = (snapshot.sectorHigh || []).length;
  const thesisConflicts = (snapshot.thesisConflicts || []).length;
  const unmapped = (snapshot.unmapped || []).length;
  return {
    stockHigh,
    sectorHigh,
    thesisConflicts,
    unmapped,
    total: stockHigh + sectorHigh + thesisConflicts + unmapped,
    score: stockHigh * 3 + sectorHigh * 3 + thesisConflicts * 2 + unmapped,
  };
}

const RISK_KIND_LABELS = {
  stockHigh: "종목 고위험",
  sectorHigh: "섹터 고위험",
  thesisConflicts: "가설 충돌",
  unmapped: "섹터 매핑 대기",
};

function riskTrendDrivers(first = {}, last = {}) {
  const added = [];
  const removed = [];
  for (const key of Object.keys(RISK_KIND_LABELS)) {
    const change = changes(last[key] || [], first[key] || []);
    added.push(...change.added.map((value) => ({
      kind: key,
      kindLabel: RISK_KIND_LABELS[key],
      value,
    })));
    removed.push(...change.removed.map((value) => ({
      kind: key,
      kindLabel: RISK_KIND_LABELS[key],
      value,
    })));
  }
  return { added, removed };
}

export function buildPortfolioRiskActions(riskReview = {}) {
  const actions = [];
  for (const item of riskReview.stockConcentration || []) {
    const ticker = cleanTicker(item?.ticker);
    if (!ticker) continue;
    const weight = Number(item?.weight || 0);
    actions.push({
      id: `stock:${ticker}`,
      kind: "stock_concentration",
      severity: item?.severity === "high" ? "high" : "monitor",
      title: `${ticker} 종목 집중`,
      cause: `간편 보유 비중 ${weight}%로 종목 집중 기준을 넘었습니다.`,
      checks: [
        `${ticker}의 최근 실적·가이던스·공시에서 투자 논리를 훼손하는 변화가 있는지 확인`,
        "동일 섹터 ETF 대비 5일 상대성과와 거래량 이상 여부 확인",
      ],
      actions: [
        "추가 비중 확대 전 단일 종목 집중 한도와 허용 손실 범위를 재검토",
        "핵심 확인 조건과 무효화 조건을 투자 가설 메모리에 기록",
      ],
    });
  }
  for (const item of riskReview.sectorConcentration || []) {
    const sectorTicker = cleanTicker(item?.ticker);
    if (!sectorTicker) continue;
    const tickers = uniqueSorted((item?.tickers || []).map(cleanTicker)).join(", ");
    actions.push({
      id: `sector:${sectorTicker}`,
      kind: "sector_concentration",
      severity: item?.severity === "high" ? "high" : "monitor",
      title: `${cleanText(item?.label, 100) || sectorTicker} 섹터 집중`,
      cause: `합산 비중 ${Number(item?.weight || 0)}%${
        tickers ? ` · 구성 ${tickers}` : ""
      }`,
      checks: [
        `${sectorTicker}의 SPY 대비 5일·20일 상대성과와 섹터 내부 브레드스 확인`,
        "보유 종목들이 같은 매크로·실적 촉매에 동시에 노출되는지 확인",
      ],
      actions: [
        "종목 수가 아니라 공통 위험요인 기준으로 실질 분산 여부 재검토",
        "섹터 가설이 반증될 때 영향을 받는 보유종목을 함께 표시",
      ],
    });
  }
  for (const item of riskReview.thesisConflicts || []) {
    const ticker = cleanTicker(item?.ticker);
    const sectorTicker = cleanTicker(item?.sectorTicker);
    if (!ticker || !sectorTicker) continue;
    actions.push({
      id: `conflict:${ticker}:${sectorTicker}`,
      kind: "thesis_conflict",
      severity: "high",
      title: `${ticker} · ${cleanText(item?.sectorLabel, 100) || sectorTicker} 가설 충돌`,
      cause: cleanText(item?.reason, 300)
        || "현재 시장 분석에서 보유 섹터가 부담 경로로 분류됐습니다.",
      checks: [
        cleanText(item?.confirmationCondition, 300)
          || "섹터 상대성과와 내부 브레드스가 함께 반등하는지 확인",
        `${ticker} 고유의 실적·가이던스가 섹터 약세를 상쇄하는지 확인`,
      ],
      actions: [
        "시장 공통 위험과 기업 고유 논거를 분리해 투자 가설을 다시 평가",
        "충돌이 해소될 객관적 조건과 검토 기한을 기록",
      ],
    });
  }
  for (const item of riskReview.unmapped || []) {
    const ticker = cleanTicker(item?.ticker);
    if (!ticker) continue;
    actions.push({
      id: `unmapped:${ticker}`,
      kind: "unmapped",
      severity: "monitor",
      title: `${ticker} 섹터 매핑 필요`,
      cause: `간편 보유 비중 ${Number(item?.weight || 0)}%가 섹터 집중도 계산에서 제외됐습니다.`,
      checks: [
        "주요 매출원과 실적 민감도를 기준으로 1차·2차 섹터를 확인",
        "연결할 섹터 ETF와 비교 지표가 적절한지 확인",
      ],
      actions: [
        "섹터 매핑 승인 후 집중도와 가설 충돌을 다시 계산",
      ],
    });
  }
  return actions.sort((a, b) => {
    const rank = { high: 0, monitor: 1 };
    return (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2)
      || a.title.localeCompare(b.title);
  });
}

export function buildPortfolioRiskTrend(history = [], { days = 7 } = {}) {
  const selectedHistory = (Array.isArray(history) ? history : [])
    .filter((item) => item?.reportDate)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    .slice(-Math.max(2, Math.min(30, Number(days) || 7)));
  const rows = selectedHistory
    .map((item) => ({
      reportDate: item.reportDate,
      quickPortfolioWeight: Number(item.quickPortfolioWeight || 0),
      ...riskCounts(item),
    }));
  if (rows.length < 2) {
    return {
      sampleCount: rows.length,
      status: "insufficient_sample",
      label: "표본 부족",
      summary: "서로 다른 날짜의 기록이 2개 이상 쌓이면 주간 위험 방향을 평가합니다.",
      scoreChange: null,
      warningChange: null,
      drivers: { added: [], removed: [] },
      rows,
    };
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const drivers = riskTrendDrivers(selectedHistory[0], selectedHistory[selectedHistory.length - 1]);
  const scoreChange = last.score - first.score;
  const warningChange = last.total - first.total;
  const status = scoreChange > 0 ? "worsened" : scoreChange < 0 ? "improved" : "unchanged";
  const labels = {
    worsened: "악화",
    improved: "개선",
    unchanged: "유지",
  };
  return {
    sampleCount: rows.length,
    status,
    label: labels[status],
    summary: `${first.reportDate} 대비 위험점수 ${
      scoreChange > 0 ? "+" : ""
    }${scoreChange} · 경고 ${
      warningChange > 0 ? "+" : ""
    }${warningChange}건`,
    scoreChange,
    warningChange,
    drivers,
    rows,
  };
}

function readHistory(path) {
  if (!existsSync(path)) return [];
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(payload?.history) ? payload.history : [];
  } catch {
    return [];
  }
}

export function recordPortfolioRiskSnapshot({
  reportDate,
  riskReview,
  quickPortfolioWeight,
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const snapshot = portfolioRiskSnapshot({
    reportDate,
    riskReview,
    quickPortfolioWeight,
  });
  if (!snapshot.reportDate) {
    return {
      snapshot,
      comparison: comparePortfolioRiskSnapshots(snapshot, null),
      history: [],
      trend: buildPortfolioRiskTrend([]),
      persisted: false,
    };
  }
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, HISTORY_FILE_NAME);
  const updated = updatePortfolioRiskHistory(readHistory(path), snapshot);
  const trend = buildPortfolioRiskTrend(updated.history);
  const payload = {
    schemaVersion: "portfolio-risk-history.v1",
    updatedAt: new Date().toISOString(),
    history: updated.history,
  };
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmpPath, path);
  return {
    ...updated,
    trend,
    snapshot,
    persisted: true,
    path: "data/pb-daily-intelligence/portfolio-risk-history.json",
  };
}
