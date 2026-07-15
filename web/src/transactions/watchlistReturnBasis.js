function sessionValue(day = {}, key = "", field = "") {
  return String(day?.[key]?.[field] || "").trim();
}

export function resolveUsRegularSessionBasis({
  today = {},
  previousBusinessDay = {},
  sessionKey = "",
  priceTimestamp = "",
} = {}) {
  const todayRegularEnd = sessionValue(today, "regularMarket", "endTime");
  const previousRegularEnd = sessionValue(previousBusinessDay, "regularMarket", "endTime");
  const todayRegularEndMs = Date.parse(todayRegularEnd);
  const priceTimeMs = Date.parse(String(priceTimestamp || ""));
  const useTodayRegularClose = sessionKey === "afterMarket" || (
    Number.isFinite(todayRegularEndMs) &&
    Number.isFinite(priceTimeMs) &&
    priceTimeMs >= todayRegularEndMs
  );
  const boundary = useTodayRegularClose
    ? todayRegularEnd || previousRegularEnd
    : previousRegularEnd || todayRegularEnd;

  if (!boundary) return null;
  return {
    boundary,
    source: useTodayRegularClose
      ? "토스 1분봉 미국 정규장 마감 기준가"
      : "토스 1분봉 미국 전 영업일 정규장 기준가",
  };
}
