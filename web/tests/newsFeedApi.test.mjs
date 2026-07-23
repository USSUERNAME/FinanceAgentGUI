import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchNewsFeedItems,
  fetchNewsFeedSettings,
  fetchNewsFeedStatus,
  markNewsFeedOpened,
  patchNewsFeedSettings,
  patchNewsFeedViewState,
  requestNewsFeedRefresh,
} from "../src/news/newsFeedApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("News Feed API client preserves endpoint and request contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };

  await fetchNewsFeedItems({ limit: 30, offset: 60 }, fetchImpl);
  await fetchNewsFeedSettings(fetchImpl);
  await fetchNewsFeedStatus(fetchImpl);
  await markNewsFeedOpened(fetchImpl);
  await patchNewsFeedSettings({ feedId: "feed-1", enabled: false }, fetchImpl);
  await requestNewsFeedRefresh(fetchImpl);
  await patchNewsFeedViewState({ marketSummaryCollapsed: true }, fetchImpl);

  assert.deepEqual(calls.map((item) => item.path), [
    "/api/news-feed/items?limit=30&offset=60",
    "/api/news-feed/settings",
    "/api/news-feed/status",
    "/api/news-feed/read-state",
    "/api/news-feed/settings",
    "/api/news-feed/refresh",
    "/api/news-feed/view-state",
  ]);
  assert.equal(calls[3].options.method, "POST");
  assert.equal(calls[4].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[4].options.body), { feedId: "feed-1", enabled: false });
  assert.equal(calls[5].options.method, "POST");
  assert.equal(calls[6].options.method, "PATCH");
});

test("News Feed API client surfaces structured server failures", async () => {
  const fetchImpl = async () => response(
    { ok: false, error: "collector unavailable" },
    { ok: false, status: 503 }
  );
  await assert.rejects(() => fetchNewsFeedStatus(fetchImpl), /collector unavailable/);
});
