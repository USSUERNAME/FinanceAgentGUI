export async function fetchDailyIntelligence(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Daily Intelligence 요청에 fetch가 필요합니다.");
  }
  const response = await fetchImpl("/api/pb-daily-intelligence", {
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}
