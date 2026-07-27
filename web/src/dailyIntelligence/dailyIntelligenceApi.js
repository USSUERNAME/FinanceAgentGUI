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
