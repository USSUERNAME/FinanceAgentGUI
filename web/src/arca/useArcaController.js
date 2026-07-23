import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchArcaArticle,
  fetchArcaAuthStatus,
  fetchArcaBoard,
  fetchArcaNotifications,
  markArcaNotificationsRead,
  requestArcaAuthAction,
} from "./arcaApi.js";

export const ARCA_WRITE_URL = "https://arca.live/b/stock/write";
export const ARCA_NOTIFICATION_URL = "https://arca.live/u/notification";
const ARCA_NOTIFICATION_POLL_INTERVAL_MS = 30_000;

export const initialBoardFilters = {
  channel: "stock",
  category: "",
  page: 1,
  best: false,
  sort: "",
  cutRate: "",
  target: "all",
  keyword: "",
};

function normalizedNotificationStatus(payload) {
  return {
    notificationUrl: ARCA_NOTIFICATION_URL,
    ...payload,
    count: Math.max(0, Number(payload?.count || 0)),
  };
}

export function useArcaController({ activeView }) {
  const [boardFilters, setBoardFilters] = useState(initialBoardFilters);
  const [boardSearchInput, setBoardSearchInput] = useState("");
  const [arcaBoard, setArcaBoard] = useState(null);
  const [arcaBoardBusy, setArcaBoardBusy] = useState(false);
  const [arcaBoardError, setArcaBoardError] = useState("");
  const [arcaReaderArticle, setArcaReaderArticle] = useState(null);
  const [arcaReaderBusy, setArcaReaderBusy] = useState(false);
  const [arcaReaderError, setArcaReaderError] = useState("");
  const [arcaAuthStatus, setArcaAuthStatus] = useState(null);
  const [arcaAuthBusy, setArcaAuthBusy] = useState(false);
  const [arcaAuthAction, setArcaAuthAction] = useState("");
  const [arcaAuthError, setArcaAuthError] = useState("");
  const [arcaNotificationStatus, setArcaNotificationStatus] = useState({
    ok: true,
    connected: false,
    status: "signed-out",
    count: 0,
    notificationUrl: ARCA_NOTIFICATION_URL,
  });
  const [arcaNotificationBusy, setArcaNotificationBusy] = useState(false);
  const [arcaNotificationActionBusy, setArcaNotificationActionBusy] = useState(false);
  const [arcaNotificationActionError, setArcaNotificationActionError] = useState("");
  const [showHiddenNotices, setShowHiddenNotices] = useState(false);

  const arcaCanvasRef = useRef(null);
  const arcaReaderAbortRef = useRef(null);
  const arcaReaderReturnScrollRef = useRef(0);
  const arcaAuthStatusRef = useRef(arcaAuthStatus);
  const arcaAuthBusyRef = useRef(false);
  const arcaNotificationStatusRef = useRef(arcaNotificationStatus);
  const arcaNotificationActionBusyRef = useRef(false);

  useEffect(() => {
    arcaAuthStatusRef.current = arcaAuthStatus;
  }, [arcaAuthStatus]);

  useEffect(() => {
    arcaNotificationStatusRef.current = arcaNotificationStatus;
  }, [arcaNotificationStatus]);

  const loadArcaNotifications = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setArcaNotificationBusy(true);
    try {
      const payload = await fetchArcaNotifications();
      setArcaNotificationStatus(normalizedNotificationStatus(payload));
      if (!quiet) setArcaNotificationActionError("");
      return payload;
    } catch (error) {
      const fallbackConnected = Boolean(
        arcaAuthStatusRef.current?.connected || arcaNotificationStatusRef.current?.connected
      );
      setArcaNotificationStatus((current) => ({
        ...(current || {}),
        ok: false,
        connected: fallbackConnected,
        status: "error",
        count: 0,
        notificationUrl: current?.notificationUrl || ARCA_NOTIFICATION_URL,
        error: error.message,
        checkedAt: new Date().toISOString(),
      }));
      return null;
    } finally {
      if (!quiet) setArcaNotificationBusy(false);
    }
  }, []);

  const markAllArcaNotificationsRead = useCallback(async () => {
    if (arcaNotificationActionBusyRef.current) return null;
    arcaNotificationActionBusyRef.current = true;
    setArcaNotificationActionBusy(true);
    setArcaNotificationActionError("");
    try {
      const payload = await markArcaNotificationsRead();
      setArcaNotificationStatus(normalizedNotificationStatus(payload));
      if (!payload?.verified) {
        setArcaNotificationActionError(
          payload?.error ||
            (payload?.remainingUnreadCount > 0
              ? `읽음 처리 후에도 새 알림 ${payload.remainingUnreadCount}개가 남아 있습니다.`
              : "읽음 처리는 접수됐지만 갱신 결과를 확인하지 못했습니다.")
        );
      }
      return payload;
    } catch (error) {
      setArcaNotificationActionError(error.message);
      return null;
    } finally {
      arcaNotificationActionBusyRef.current = false;
      setArcaNotificationActionBusy(false);
    }
  }, []);

  const loadArcaAuthStatus = useCallback(async ({ actionLabel = "reload", quiet = false } = {}) => {
    if (!quiet) {
      setArcaAuthBusy(true);
      setArcaAuthAction(actionLabel);
      setArcaAuthError("");
    }
    try {
      const payload = await fetchArcaAuthStatus();
      arcaAuthStatusRef.current = payload;
      setArcaAuthStatus(payload);
      if (!quiet) setArcaAuthError("");
      return payload;
    } catch (error) {
      if (!quiet) setArcaAuthError(error.message);
      return null;
    } finally {
      if (!quiet) {
        setArcaAuthBusy(false);
        setArcaAuthAction("");
      }
    }
  }, []);

  const runArcaAuthAction = useCallback(async (
    actionName,
    endpoint,
    { method = "POST", confirmMessage = "" } = {}
  ) => {
    if (arcaAuthBusyRef.current) return null;
    if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) return null;

    arcaAuthBusyRef.current = true;
    setArcaAuthBusy(true);
    setArcaAuthAction(actionName);
    setArcaAuthError("");
    try {
      const payload = await requestArcaAuthAction(endpoint, { method });
      arcaAuthStatusRef.current = payload;
      setArcaAuthStatus(payload);
      if (actionName === "capture") setBoardFilters((current) => ({ ...current }));
      void loadArcaNotifications({ quiet: true });
      return payload;
    } catch (error) {
      setArcaAuthError(error.message);
      return null;
    } finally {
      arcaAuthBusyRef.current = false;
      setArcaAuthBusy(false);
      setArcaAuthAction("");
    }
  }, [loadArcaNotifications]);

  const updateBoardFilters = useCallback((nextPatch) => {
    setBoardFilters((filters) => ({ ...filters, ...nextPatch }));
  }, []);

  const selectBoardCategory = useCallback((category) => {
    setShowHiddenNotices(false);
    updateBoardFilters({ category, page: 1 });
  }, [updateBoardFilters]);

  const refreshBoard = useCallback(() => {
    setBoardFilters((filters) => ({ ...filters }));
    void loadArcaNotifications();
  }, [loadArcaNotifications]);

  const resetBoard = useCallback(() => {
    setShowHiddenNotices(false);
    setBoardSearchInput("");
    setBoardFilters({ ...initialBoardFilters });
    void loadArcaNotifications();
  }, [loadArcaNotifications]);

  const submitBoardSearch = useCallback((event) => {
    event.preventDefault();
    updateBoardFilters({ keyword: boardSearchInput.trim(), page: 1 });
  }, [boardSearchInput, updateBoardFilters]);

  const openArcaArticleReader = useCallback(async (row, { rememberScroll = true } = {}) => {
    if (!row?.href) return;
    if (rememberScroll) arcaReaderReturnScrollRef.current = arcaCanvasRef.current?.scrollTop ?? 0;
    arcaReaderAbortRef.current?.abort();
    const controller = new AbortController();
    arcaReaderAbortRef.current = controller;
    setArcaReaderArticle({ ...row, url: row.href, href: row.href });
    setArcaReaderBusy(true);
    setArcaReaderError("");
    window.requestAnimationFrame(() => {
      if (arcaCanvasRef.current) arcaCanvasRef.current.scrollTop = 0;
    });

    try {
      const payload = await fetchArcaArticle(row.href, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setArcaReaderArticle({
        ...row,
        ...(payload.article || {}),
        id: row.id,
        number: row.number,
        title: payload.article?.title || row.title,
        author: payload.article?.author || row.author,
        url: payload.article?.url || row.href,
        href: row.href,
        categoryLabel: row.categoryLabel,
        view: row.view,
        rate: row.rate,
      });
    } catch (error) {
      if (error.name !== "AbortError") setArcaReaderError(error.message);
    } finally {
      if (arcaReaderAbortRef.current === controller) {
        arcaReaderAbortRef.current = null;
        setArcaReaderBusy(false);
      }
    }
  }, []);

  const retryArcaArticleReader = useCallback(() => {
    if (arcaReaderArticle?.href) {
      void openArcaArticleReader(arcaReaderArticle, { rememberScroll: false });
    }
  }, [arcaReaderArticle, openArcaArticleReader]);

  const closeArcaArticleReader = useCallback(() => {
    arcaReaderAbortRef.current?.abort();
    arcaReaderAbortRef.current = null;
    setArcaReaderArticle(null);
    setArcaReaderBusy(false);
    setArcaReaderError("");
    window.requestAnimationFrame(() => {
      if (arcaCanvasRef.current) arcaCanvasRef.current.scrollTop = arcaReaderReturnScrollRef.current;
    });
  }, []);

  const openArcaNotificationArticle = useCallback((item) => {
    if (!item?.isStockChannel || !item?.targetUrl) return;
    void openArcaArticleReader({
      type: "article",
      id: item.articleId || item.id || "",
      number: item.articleId || "",
      title: item.title || "주식채널 알림 글",
      author: item.author || "",
      href: item.targetUrl,
      url: item.targetUrl,
      categoryLabel: "",
    });
  }, [openArcaArticleReader]);

  useEffect(() => {
    let cancelled = false;
    async function loadBoard() {
      setArcaBoardBusy(true);
      setArcaBoardError("");
      try {
        const payload = await fetchArcaBoard(boardFilters);
        if (cancelled) return;
        setArcaBoard(payload);
        if (!payload.ok && payload.issues?.length) {
          setArcaBoardError(payload.issues.map((item) => item.message).join(" / "));
        }
      } catch (error) {
        if (!cancelled) setArcaBoardError(error.message);
      } finally {
        if (!cancelled) setArcaBoardBusy(false);
      }
    }
    void loadBoard();
    return () => {
      cancelled = true;
    };
  }, [boardFilters]);

  useEffect(() => {
    let cancelled = false;
    async function pollArcaNotifications() {
      if (arcaNotificationActionBusyRef.current) return;
      try {
        const payload = await fetchArcaNotifications();
        if (!cancelled) setArcaNotificationStatus(normalizedNotificationStatus(payload));
      } catch (error) {
        if (cancelled) return;
        setArcaNotificationStatus((current) => ({
          ...(current || {}),
          ok: false,
          connected: Boolean(current?.connected),
          status: "error",
          count: 0,
          notificationUrl: current?.notificationUrl || ARCA_NOTIFICATION_URL,
          error: error.message,
          checkedAt: new Date().toISOString(),
        }));
      }
    }
    void pollArcaNotifications();
    const timer = window.setInterval(pollArcaNotifications, ARCA_NOTIFICATION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (activeView === "settings") void loadArcaAuthStatus({ quiet: true });
  }, [activeView, loadArcaAuthStatus]);

  useEffect(() => () => arcaReaderAbortRef.current?.abort(), []);

  return {
    boardFilters,
    boardSearchInput,
    setBoardSearchInput,
    arcaBoard,
    arcaBoardBusy,
    arcaBoardError,
    arcaReaderArticle,
    arcaReaderBusy,
    arcaReaderError,
    arcaAuthStatus,
    arcaAuthBusy,
    arcaAuthAction,
    arcaAuthError,
    arcaNotificationStatus,
    arcaNotificationBusy,
    arcaNotificationActionBusy,
    arcaNotificationActionError,
    showHiddenNotices,
    arcaCanvasRef,
    loadArcaNotifications,
    markAllArcaNotificationsRead,
    loadArcaAuthStatus,
    startArcaLoginHandoff: () => void runArcaAuthAction("start", "/api/arca/auth/start"),
    captureArcaLoginSession: () => void runArcaAuthAction("capture", "/api/arca/auth/capture"),
    stopArcaLoginHandoff: () => void runArcaAuthAction("stop", "/api/arca/auth/stop"),
    deleteArcaLoginSession: () => void runArcaAuthAction("delete", "/api/arca/auth/session", {
      method: "DELETE",
      confirmMessage: "저장된 아카라이브 알림 세션을 삭제할까요?",
    }),
    updateBoardFilters,
    selectBoardCategory,
    refreshBoard,
    resetBoard,
    submitBoardSearch,
    openArcaArticleReader,
    retryArcaArticleReader,
    closeArcaArticleReader,
    openArcaNotificationArticle,
    toggleHiddenNotices: () => setShowHiddenNotices((next) => !next),
  };
}
