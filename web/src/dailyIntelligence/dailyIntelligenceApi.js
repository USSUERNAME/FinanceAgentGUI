export async function fetchDailyIntelligence(
  fetchImpl = globalThis.fetch,
  { brokerResearchDate = "" } = {}
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Daily Intelligence 요청에 fetch가 필요합니다.");
  }
  const query = brokerResearchDate
    ? `?brokerDate=${encodeURIComponent(brokerResearchDate)}`
    : "";
  const response = await fetchImpl(`/api/pb-daily-intelligence${query}`, {
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function syncDailyIntelligenceTheses(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("투자 가설 동기화 요청에 fetch가 필요합니다.");
  }
  const response = await fetchImpl("/api/pb-daily-intelligence", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "syncInvestmentTheses" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function trackDailyIntelligenceStockThesis(
  {
    ticker,
    sectorId = "",
    brokerResearchDate = "",
  },
  fetchImpl = globalThis.fetch,
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("종목 투자 가설 저장 요청에 fetch가 필요합니다.");
  }
  const response = await fetchImpl("/api/pb-daily-intelligence", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "trackStockThesis",
      ticker,
      sectorId,
      brokerResearchDate,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function quickAddDailyIntelligenceWatchlistTicker(
  ticker,
  fetchImpl = globalThis.fetch,
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("관심종목 등록 요청에 fetch가 필요합니다.");
  }
  const response = await fetchImpl("/api/pb-daily-intelligence", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "quickAddWatchlistTicker",
      ticker,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function quickAddDailyIntelligencePortfolioHolding(
  ticker,
  weight,
  fetchImpl = globalThis.fetch,
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("보유종목 등록 요청에 fetch가 필요합니다.");
  }
  const response = await fetchImpl("/api/pb-daily-intelligence", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "quickAddPortfolioHolding",
      ticker,
      weight,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function removeDailyIntelligencePortfolioHolding(
  ticker,
  fetchImpl = globalThis.fetch,
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("보유종목 삭제 요청에 fetch가 필요합니다.");
  }
  const response = await fetchImpl("/api/pb-daily-intelligence", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "removePortfolioHolding",
      ticker,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function reviewDailyIntelligencePortfolioRisk(
  {
    riskId,
    status,
    note = "",
    reviewDate = "",
    reviewReportDate = "",
  },
  fetchImpl = globalThis.fetch,
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("포트폴리오 위험 검토 저장 요청에 fetch가 필요합니다.");
  }
  const response = await fetchImpl("/api/pb-daily-intelligence", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "reviewPortfolioRisk",
      riskId,
      status,
      note,
      reviewDate,
      reviewReportDate,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function requestDailyIntelligenceJob(payload = null, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Daily Intelligence 작업 요청에 fetch가 필요합니다.");
  }
  const response = await fetchImpl("/api/pb-daily-intelligence/jobs", {
    method: payload ? "POST" : "GET",
    cache: "no-store",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || `HTTP ${response.status}`);
  }
  return result;
}

export function fetchDailyIntelligenceJobStatus(fetchImpl = globalThis.fetch) {
  return requestDailyIntelligenceJob(null, fetchImpl);
}

export function planDailyIntelligenceJob(jobId, fetchImpl = globalThis.fetch) {
  return requestDailyIntelligenceJob({ action: "plan", jobId }, fetchImpl);
}

export function executeDailyIntelligenceJob(token, fetchImpl = globalThis.fetch) {
  return requestDailyIntelligenceJob({ action: "execute", token }, fetchImpl);
}
