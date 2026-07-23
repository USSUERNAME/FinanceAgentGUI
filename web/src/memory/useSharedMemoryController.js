import { useCallback, useEffect, useRef, useState } from "react";
import { emptyMemoryStatus } from "./sharedMemoryDefaults.js";
import { deleteSharedMemory, fetchSharedMemory, saveSharedMemory } from "./sharedMemoryApi.js";

const RECENT_LIMIT = 5;
const DIALOG_PAGE_SIZE = 20;
const MARKET_SUMMARY_POLL_INTERVAL_MS = 15 * 60 * 1000;

export function useSharedMemoryController({ activeView } = {}) {
  const [memoryStatus, setMemoryStatus] = useState(emptyMemoryStatus);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [memoryRecentOpen, setMemoryRecentOpen] = useState(false);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [memoryDialogRecords, setMemoryDialogRecords] = useState([]);
  const [memoryDialogBusy, setMemoryDialogBusy] = useState(false);
  const [memoryDialogError, setMemoryDialogError] = useState("");
  const [memoryDialogHasMore, setMemoryDialogHasMore] = useState(false);
  const [memoryDialogTotalCount, setMemoryDialogTotalCount] = useState(0);
  const [deletingMemoryRecordId, setDeletingMemoryRecordId] = useState("");

  const dialogBusyRef = useRef(false);
  const dialogRecordsRef = useRef([]);
  const dialogHasMoreRef = useRef(false);
  const dialogOpenRef = useRef(false);
  const deletingRecordRef = useRef("");

  useEffect(() => {
    dialogRecordsRef.current = memoryDialogRecords;
  }, [memoryDialogRecords]);

  useEffect(() => {
    dialogHasMoreRef.current = memoryDialogHasMore;
  }, [memoryDialogHasMore]);

  useEffect(() => {
    dialogOpenRef.current = memoryDialogOpen;
  }, [memoryDialogOpen]);

  const loadSharedMemoryStatus = useCallback(async () => {
    setMemoryBusy(true);
    setMemoryError("");
    try {
      const payload = await fetchSharedMemory({ limit: RECENT_LIMIT, offset: 0 });
      setMemoryStatus(payload);
      return payload;
    } catch (error) {
      setMemoryError(error.message);
      return null;
    } finally {
      setMemoryBusy(false);
    }
  }, []);

  const loadMemoryDialogRecords = useCallback(async ({ reset = false } = {}) => {
    if (dialogBusyRef.current) return null;
    const offset = reset ? 0 : dialogRecordsRef.current.length;
    if (!reset && !dialogHasMoreRef.current) return null;
    dialogBusyRef.current = true;
    setMemoryDialogBusy(true);
    setMemoryDialogError("");
    try {
      const payload = await fetchSharedMemory({ limit: DIALOG_PAGE_SIZE, offset });
      const nextRecords = payload.records || [];
      setMemoryDialogTotalCount(Number(payload.recordCount || 0));
      dialogHasMoreRef.current = Boolean(payload.hasMore);
      setMemoryDialogHasMore(Boolean(payload.hasMore));
      setMemoryDialogRecords((current) => {
        const combined = reset ? nextRecords : [...current, ...nextRecords];
        const seen = new Set();
        const unique = combined.filter((record) => {
          if (!record?.id || seen.has(record.id)) return false;
          seen.add(record.id);
          return true;
        });
        dialogRecordsRef.current = unique;
        return unique;
      });
      return payload;
    } catch (error) {
      setMemoryDialogError(error.message);
      return null;
    } finally {
      dialogBusyRef.current = false;
      setMemoryDialogBusy(false);
    }
  }, []);

  const openMemoryDialog = useCallback(() => {
    dialogOpenRef.current = true;
    setMemoryDialogOpen(true);
    dialogRecordsRef.current = [];
    dialogHasMoreRef.current = false;
    setMemoryDialogRecords([]);
    setMemoryDialogHasMore(false);
    setMemoryDialogTotalCount(0);
    void loadMemoryDialogRecords({ reset: true });
  }, [loadMemoryDialogRecords]);

  const closeMemoryDialog = useCallback(() => {
    dialogOpenRef.current = false;
    setMemoryDialogOpen(false);
  }, []);

  const handleMemoryDialogScroll = useCallback((event) => {
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 260) void loadMemoryDialogRecords({ reset: false });
  }, [loadMemoryDialogRecords]);

  const deleteMemoryRecord = useCallback(async (record) => {
    if (!record?.id || deletingRecordRef.current) return null;
    const title = record.title || "공유 작업 메모리";
    if (!window.confirm(`"${title}" 기록을 삭제할까요?`)) return null;
    deletingRecordRef.current = record.id;
    setDeletingMemoryRecordId(record.id);
    setMemoryError("");
    setMemoryDialogError("");
    try {
      const payload = await deleteSharedMemory({ id: record.id, limit: RECENT_LIMIT, offset: 0 });
      setMemoryStatus(payload.status || emptyMemoryStatus);
      if (dialogOpenRef.current) {
        dialogRecordsRef.current = [];
        dialogHasMoreRef.current = false;
        setMemoryDialogRecords([]);
        setMemoryDialogHasMore(false);
        setMemoryDialogTotalCount(0);
        await loadMemoryDialogRecords({ reset: true });
      }
      return payload;
    } catch (error) {
      setMemoryError(error.message);
      setMemoryDialogError(error.message);
      return null;
    } finally {
      deletingRecordRef.current = "";
      setDeletingMemoryRecordId("");
    }
  }, [loadMemoryDialogRecords]);

  const saveSharedMemoryRecord = useCallback(async (record) => {
    try {
      const payload = await saveSharedMemory(record);
      setMemoryStatus(payload.status || emptyMemoryStatus);
      setMemoryError("");
      return payload;
    } catch (error) {
      setMemoryError(error.message);
      return null;
    }
  }, []);

  useEffect(() => {
    void loadSharedMemoryStatus();
    const timer = window.setInterval(loadSharedMemoryStatus, MARKET_SUMMARY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadSharedMemoryStatus]);

  useEffect(() => {
    if (activeView === "settings") void loadSharedMemoryStatus();
  }, [activeView, loadSharedMemoryStatus]);

  return {
    memoryStatus,
    memoryBusy,
    memoryError,
    memoryRecentOpen,
    memoryDialogOpen,
    memoryDialogRecords,
    memoryDialogBusy,
    memoryDialogError,
    memoryDialogHasMore,
    memoryDialogTotalCount,
    deletingMemoryRecordId,
    loadSharedMemoryStatus,
    toggleMemoryRecent: () => setMemoryRecentOpen((open) => !open),
    openMemoryDialog,
    closeMemoryDialog,
    handleMemoryDialogScroll,
    deleteMemoryRecord,
    saveSharedMemoryRecord,
  };
}
