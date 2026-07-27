async function requestNewsFeed(path, options = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("News Feed request requires fetch");
  }
  const response = await fetchImpl(path, {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export function fetchNewsFeedItems({ limit, offset }, fetchImpl) {
  return requestNewsFeed(
    `/api/news-feed/items?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
    {},
    fetchImpl
  );
}

export function fetchNewsFeedSettings(fetchImpl) {
  return requestNewsFeed("/api/news-feed/settings", {}, fetchImpl);
}

export function patchNewsFeedSettings(patch, fetchImpl) {
  return requestNewsFeed(
    "/api/news-feed/settings",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    fetchImpl
  );
}

export function fetchNewsFeedStatus(fetchImpl) {
  return requestNewsFeed("/api/news-feed/status", {}, fetchImpl);
}

export function generateNewsFeedDailyDigest(fetchImpl) {
  return requestNewsFeed(
    "/api/news-feed/daily-digest",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    },
    fetchImpl
  );
}

export function markNewsFeedOpened(fetchImpl) {
  return requestNewsFeed(
    "/api/news-feed/read-state",
    { method: "POST" },
    fetchImpl
  );
}

export function requestNewsFeedRefresh(fetchImpl) {
  return requestNewsFeed(
    "/api/news-feed/refresh",
    { method: "POST" },
    fetchImpl
  );
}

export function patchNewsFeedViewState(patch, fetchImpl) {
  return requestNewsFeed(
    "/api/news-feed/view-state",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    fetchImpl
  );
}
