import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNewsFeedItems,
  fetchNewsFeedSettings,
  fetchNewsFeedStatus,
  markNewsFeedOpened,
  patchNewsFeedSettings,
  patchNewsFeedViewState,
  requestNewsFeedRefresh,
} from "./newsFeedApi.js";
import { mergeNewsFeedFirstPage, newsFeedContentRevision } from "./newsFeedPagination.js";

const NEWS_FEED_PAGE_SIZE = 30;
const NEWS_FEED_STATUS_POLL_INTERVAL_MS = 15_000;

export function useNewsFeedController({ activeView }) {
  const [newsFeedStatus, setNewsFeedStatus] = useState(null);
  const [newsFeedItems, setNewsFeedItems] = useState([]);
  const [newsFeedBusy, setNewsFeedBusy] = useState(false);
  const [newsFeedRefreshBusy, setNewsFeedRefreshBusy] = useState(false);
  const [newsFeedLoadingMore, setNewsFeedLoadingMore] = useState(false);
  const [newsFeedHasMore, setNewsFeedHasMore] = useState(false);
  const [newsFeedError, setNewsFeedError] = useState("");
  const [newsFeedSettings, setNewsFeedSettings] = useState(null);
  const [newsFeedSettingsBusy, setNewsFeedSettingsBusy] = useState(false);
  const [newsFeedSettingsSavingId, setNewsFeedSettingsSavingId] = useState("");
  const [newsFeedSettingsError, setNewsFeedSettingsError] = useState("");

  const activeViewRef = useRef(activeView);
  const itemsRef = useRef(newsFeedItems);
  const hasMoreRef = useRef(newsFeedHasMore);
  const pageBusyRef = useRef(false);
  const newsFeedContentRevisionRef = useRef("");

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    itemsRef.current = newsFeedItems;
  }, [newsFeedItems]);

  useEffect(() => {
    hasMoreRef.current = newsFeedHasMore;
  }, [newsFeedHasMore]);

  const loadNewsFeedItems = useCallback(async ({ reset = false } = {}) => {
    if (pageBusyRef.current || (!reset && !hasMoreRef.current)) return;
    pageBusyRef.current = true;
    if (reset) {
      setNewsFeedBusy(true);
      setNewsFeedError("");
    } else {
      setNewsFeedLoadingMore(true);
    }

    try {
      const offset = reset ? 0 : itemsRef.current.length;
      const payload = await fetchNewsFeedItems({ limit: NEWS_FEED_PAGE_SIZE, offset });
      newsFeedContentRevisionRef.current = newsFeedContentRevision(payload);
      setNewsFeedStatus((current) => ({
        ...(current || {}),
        itemCount: payload.itemCount,
        readState: payload.readState || current?.readState,
        offset: payload.offset,
        limit: payload.limit,
        hasMore: payload.hasMore,
      }));
      const nextHasMore = Boolean(payload.hasMore);
      hasMoreRef.current = nextHasMore;
      setNewsFeedHasMore(nextHasMore);
      setNewsFeedItems((current) => {
        const nextItems = reset ? payload.items || [] : [...current, ...(payload.items || [])];
        const seen = new Set();
        const uniqueItems = nextItems.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        itemsRef.current = uniqueItems;
        return uniqueItems;
      });
    } catch (error) {
      setNewsFeedError(error.message);
    } finally {
      pageBusyRef.current = false;
      setNewsFeedBusy(false);
      setNewsFeedLoadingMore(false);
    }
  }, []);

  const loadNewsFeedSettings = useCallback(async () => {
    setNewsFeedSettingsBusy(true);
    setNewsFeedSettingsError("");
    try {
      setNewsFeedSettings(await fetchNewsFeedSettings());
    } catch (error) {
      setNewsFeedSettingsError(error.message);
    } finally {
      setNewsFeedSettingsBusy(false);
    }
  }, []);

  const refreshNewsFeedStatus = useCallback(async () => {
    try {
      const payload = await fetchNewsFeedStatus();
      newsFeedContentRevisionRef.current = newsFeedContentRevision(payload);
      setNewsFeedStatus((current) =>
        payload.collector || payload.feeds
          ? payload
          : {
              ...(current || {}),
              itemCount: payload.itemCount,
              offset: payload.offset,
              limit: payload.limit,
              hasMore: payload.hasMore,
            }
      );
      return payload;
    } catch {
      return null;
    }
  }, []);

  const markOpened = useCallback(async () => {
    try {
      const payload = await markNewsFeedOpened();
      newsFeedContentRevisionRef.current = newsFeedContentRevision(payload);
      setNewsFeedStatus(payload);
      return payload;
    } catch {
      return null;
    }
  }, []);

  const toggleNewsFeedSource = useCallback(async (feedId, enabled) => {
    setNewsFeedSettingsSavingId(feedId);
    setNewsFeedSettingsError("");
    try {
      setNewsFeedSettings(await patchNewsFeedSettings({ feedId, enabled }));
      await refreshNewsFeedStatus();
      if (activeViewRef.current === "news-feed") {
        await loadNewsFeedItems({ reset: true });
      }
    } catch (error) {
      setNewsFeedSettingsError(error.message);
    } finally {
      setNewsFeedSettingsSavingId("");
    }
  }, [loadNewsFeedItems, refreshNewsFeedStatus]);

  const updateNewsFeedPollInterval = useCallback(async (pollIntervalSeconds) => {
    setNewsFeedSettingsSavingId("poll-interval");
    setNewsFeedSettingsError("");
    try {
      setNewsFeedSettings(await patchNewsFeedSettings({ pollIntervalSeconds }));
      await refreshNewsFeedStatus();
    } catch (error) {
      setNewsFeedSettingsError(error.message);
    } finally {
      setNewsFeedSettingsSavingId("");
    }
  }, [refreshNewsFeedStatus]);

  const refreshNewsFeed = useCallback(async () => {
    setNewsFeedRefreshBusy(true);
    setNewsFeedError("");
    try {
      const payload = await requestNewsFeedRefresh();
      newsFeedContentRevisionRef.current = newsFeedContentRevision(payload);
      setNewsFeedStatus(payload);
    } catch (error) {
      setNewsFeedError(error.message);
    } finally {
      setNewsFeedRefreshBusy(false);
    }
  }, []);

  const updateNewsFeedMarketSummaryCollapsed = useCallback(async (collapsed) => {
    const nextCollapsed = Boolean(collapsed);
    setNewsFeedStatus((current) => ({
      ...(current || {}),
      viewState: {
        ...(current?.viewState || {}),
        marketSummaryCollapsed: nextCollapsed,
      },
    }));
    try {
      setNewsFeedStatus(await patchNewsFeedViewState({ marketSummaryCollapsed: nextCollapsed }));
    } catch (error) {
      setNewsFeedError(error.message);
    }
  }, []);

  const handleNewsFeedScroll = useCallback((event) => {
    if (activeViewRef.current !== "news-feed" || pageBusyRef.current || !hasMoreRef.current) return;
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 420) {
      void loadNewsFeedItems({ reset: false });
    }
  }, [loadNewsFeedItems]);

  useEffect(() => {
    let cancelled = false;

    async function pollNewsFeedStatus() {
      try {
        const payload = await fetchNewsFeedStatus();
        if (cancelled) return;
        const previousContentRevision = newsFeedContentRevisionRef.current;
        const nextContentRevision = newsFeedContentRevision(payload);
        newsFeedContentRevisionRef.current = nextContentRevision;
        setNewsFeedStatus(payload);

        if (
          activeViewRef.current === "news-feed" &&
          previousContentRevision &&
          nextContentRevision !== previousContentRevision
        ) {
          const itemsPayload = await fetchNewsFeedItems({ limit: NEWS_FEED_PAGE_SIZE, offset: 0 });
          if (cancelled) return;
          newsFeedContentRevisionRef.current = newsFeedContentRevision(itemsPayload);
          setNewsFeedStatus((current) => ({
            ...(current || {}),
            itemCount: itemsPayload.itemCount,
            readState: itemsPayload.readState || current?.readState,
            offset: itemsPayload.offset,
            limit: itemsPayload.limit,
            hasMore: itemsPayload.hasMore,
          }));
          const nextHasMore = Boolean(itemsPayload.hasMore);
          hasMoreRef.current = nextHasMore;
          setNewsFeedHasMore(nextHasMore);
          setNewsFeedItems((current) => {
            const nextItems = mergeNewsFeedFirstPage(current, itemsPayload.items || []);
            itemsRef.current = nextItems;
            return nextItems;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setNewsFeedStatus((current) => ({
            ...(current || {}),
            collector: {
              ...(current?.collector || {}),
              healthy: false,
              lastError: error.message,
            },
          }));
        }
      }
    }

    void pollNewsFeedStatus();
    const timer = window.setInterval(pollNewsFeedStatus, NEWS_FEED_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (activeView !== "news-feed") return undefined;
    let cancelled = false;

    async function openNewsFeed() {
      await Promise.all([markOpened(), loadNewsFeedItems({ reset: true })]);
      if (!cancelled) void refreshNewsFeedStatus();
    }

    void openNewsFeed();
    return () => {
      cancelled = true;
    };
  }, [activeView, loadNewsFeedItems, markOpened, refreshNewsFeedStatus]);

  useEffect(() => {
    if (activeView === "settings") void loadNewsFeedSettings();
  }, [activeView, loadNewsFeedSettings]);

  return {
    newsFeedStatus,
    newsFeedItems,
    newsFeedBusy,
    newsFeedRefreshBusy,
    newsFeedLoadingMore,
    newsFeedHasMore,
    newsFeedError,
    newsFeedSettings,
    newsFeedSettingsBusy,
    newsFeedSettingsSavingId,
    newsFeedSettingsError,
    loadNewsFeedItems,
    loadNewsFeedSettings,
    refreshNewsFeedStatus,
    toggleNewsFeedSource,
    updateNewsFeedPollInterval,
    refreshNewsFeed,
    updateNewsFeedMarketSummaryCollapsed,
    handleNewsFeedScroll,
  };
}
