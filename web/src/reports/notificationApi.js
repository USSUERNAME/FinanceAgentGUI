async function requestNotification(path, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(path, {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export function fetchNotificationStatus(fetchImpl) {
  return requestNotification("/api/notifications/status", {}, fetchImpl);
}

export function markReportsNotificationsOpened(fetchImpl) {
  return requestNotification(
    "/api/notifications/read-state",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark-reports-opened" }),
    },
    fetchImpl
  );
}

export function markDailyIntelligenceNotificationsOpened(fetchImpl) {
  return requestNotification(
    "/api/notifications/read-state",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark-daily-intelligence-opened" }),
    },
    fetchImpl
  );
}
