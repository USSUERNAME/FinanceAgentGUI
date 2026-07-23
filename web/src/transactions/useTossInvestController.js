import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTossInvestOrderSyncStatus,
  fetchTossInvestPublicIp,
  fetchTossInvestStatus,
  patchTossInvestOrderSyncSettings,
  requestTossInvestAuthAction,
  requestTossInvestOrderSyncBatch,
  requestTossInvestSnapshotRebuild,
} from "./tossInvestApi.js";

const ORDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const ORDER_SYNC_PROGRESS_POLL_MS = 3000;
const ORDER_SYNC_BATCH_DELAY_MS = 2000;
const ORDER_SYNC_MAX_BATCHES = 100;

function mergeOrderSyncStatus(current, next) {
  const currentReconstruction = current?.reconstruction;
  if (!currentReconstruction || currentReconstruction.status !== "running") return next;
  const nextReconstruction = next?.reconstruction;
  if (!nextReconstruction) return { ...next, reconstruction: currentReconstruction };
  if (nextReconstruction.clientRunId === currentReconstruction.clientRunId) return next;
  const sameServerRun = currentReconstruction.runId && nextReconstruction.runId === currentReconstruction.runId;
  const serverRunStarted =
    nextReconstruction.status === "running" && (nextReconstruction.runId || nextReconstruction.progress);
  if (sameServerRun || serverRunStarted) {
    return {
      ...next,
      reconstruction: {
        ...currentReconstruction,
        ...nextReconstruction,
        clientRunId: currentReconstruction.clientRunId,
        startedAt: currentReconstruction.startedAt || nextReconstruction.startedAt || "",
      },
    };
  }
  return { ...next, reconstruction: currentReconstruction };
}

function failRunningReconstruction(current, error) {
  if (!current?.reconstruction || current.reconstruction.status !== "running") return current;
  return {
    ...current,
    reconstruction: {
      ...current.reconstruction,
      ok: false,
      status: "failed",
      error: error.message,
      finishedAt: new Date().toISOString(),
    },
  };
}

function orderSyncHasMore(payload) {
  if (payload?.sync?.hasNext) return true;
  const states = Array.isArray(payload?.store?.states) ? payload.store.states : [];
  return states.some((state) => Boolean(state?.has_next));
}

export function useTossInvestController({ activeView, assetPortfolioActive = false }) {
  const [tossInvestStatus, setTossInvestStatus] = useState(null);
  const [tossInvestBusy, setTossInvestBusy] = useState(false);
  const [tossInvestAction, setTossInvestAction] = useState("");
  const [tossInvestError, setTossInvestError] = useState("");
  const [tossInvestErrorCode, setTossInvestErrorCode] = useState("");
  const [tossInvestPublicIp, setTossInvestPublicIp] = useState(null);
  const [tossInvestPublicIpBusy, setTossInvestPublicIpBusy] = useState(false);
  const [tossInvestPublicIpError, setTossInvestPublicIpError] = useState("");
  const [tossInvestDialogOpen, setTossInvestDialogOpen] = useState(false);
  const [tossInvestOrderSyncStatus, setTossInvestOrderSyncStatus] = useState(null);
  const [tossInvestOrderSyncBusy, setTossInvestOrderSyncBusy] = useState(false);
  const [tossInvestOrderSyncAction, setTossInvestOrderSyncAction] = useState("");
  const [tossInvestOrderSyncError, setTossInvestOrderSyncError] = useState("");
  const [tossInvestOrderSyncErrorCode, setTossInvestOrderSyncErrorCode] = useState("");

  const tossBusyRef = useRef(false);
  const publicIpBusyRef = useRef(false);
  const orderSyncBusyRef = useRef(false);

  const loadTossInvestStatus = useCallback(async ({ actionLabel = "reload", quiet = false } = {}) => {
    if (!quiet) {
      setTossInvestBusy(true);
      setTossInvestAction(actionLabel);
      setTossInvestError("");
      setTossInvestErrorCode("");
    }
    try {
      const payload = await fetchTossInvestStatus();
      setTossInvestStatus(payload);
      if (!quiet) {
        setTossInvestError("");
        setTossInvestErrorCode("");
      }
      return payload;
    } catch (error) {
      if (!quiet) {
        setTossInvestError(error.message);
        setTossInvestErrorCode(error.errorCode || "");
      }
      return null;
    } finally {
      if (!quiet) {
        setTossInvestBusy(false);
        setTossInvestAction("");
      }
    }
  }, []);

  const runTossInvestAction = useCallback(async (
    actionName,
    endpoint,
    { method = "POST", body = null, confirmMessage = "" } = {}
  ) => {
    if (tossBusyRef.current) return null;
    if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) return null;
    tossBusyRef.current = true;
    setTossInvestBusy(true);
    setTossInvestAction(actionName);
    setTossInvestError("");
    setTossInvestErrorCode("");
    try {
      const payload = await requestTossInvestAuthAction(endpoint, { method, body });
      setTossInvestStatus(payload);
      setTossInvestErrorCode("");
      return payload;
    } catch (error) {
      setTossInvestError(error.message);
      setTossInvestErrorCode(error.errorCode || "");
      return null;
    } finally {
      tossBusyRef.current = false;
      setTossInvestBusy(false);
      setTossInvestAction("");
    }
  }, []);

  const probeTossInvestConnection = useCallback(
    () => runTossInvestAction("probe", "/api/tossinvest/auth/probe"),
    [runTossInvestAction]
  );

  const saveAndProbeTossInvestCredentials = useCallback(async (credentials, { closeDialog = false } = {}) => {
    const saved = await runTossInvestAction("save", "/api/tossinvest/auth/credentials", {
      method: "PUT",
      body: credentials,
    });
    if (!saved) return null;
    await probeTossInvestConnection();
    if (closeDialog) setTossInvestDialogOpen(false);
    return saved;
  }, [probeTossInvestConnection, runTossInvestAction]);

  const unlockAndProbeTossInvestVault = useCallback(async (payload, { closeDialog = false } = {}) => {
    const unlocked = await runTossInvestAction("unlock", "/api/tossinvest/auth/unlock", { body: payload });
    if (!unlocked) return null;
    await probeTossInvestConnection();
    if (closeDialog) setTossInvestDialogOpen(false);
    return unlocked;
  }, [probeTossInvestConnection, runTossInvestAction]);

  const checkTossInvestPublicIp = useCallback(async () => {
    if (publicIpBusyRef.current) return null;
    publicIpBusyRef.current = true;
    setTossInvestPublicIpBusy(true);
    setTossInvestPublicIpError("");
    try {
      const payload = await fetchTossInvestPublicIp();
      setTossInvestPublicIp(payload);
      return payload;
    } catch (error) {
      setTossInvestPublicIpError(error.message);
      return null;
    } finally {
      publicIpBusyRef.current = false;
      setTossInvestPublicIpBusy(false);
    }
  }, []);

  const loadTossInvestOrderSyncStatus = useCallback(async ({ actionLabel = "reload", quiet = false } = {}) => {
    if (!quiet) {
      setTossInvestOrderSyncBusy(true);
      setTossInvestOrderSyncAction(actionLabel);
      setTossInvestOrderSyncError("");
      setTossInvestOrderSyncErrorCode("");
    }
    try {
      const payload = await fetchTossInvestOrderSyncStatus();
      setTossInvestOrderSyncStatus((current) => mergeOrderSyncStatus(current, payload));
      if (!quiet) {
        setTossInvestOrderSyncError("");
        setTossInvestOrderSyncErrorCode("");
      }
      return payload;
    } catch (error) {
      if (!quiet) {
        setTossInvestOrderSyncError(error.message);
        setTossInvestOrderSyncErrorCode(error.errorCode || "");
      }
      return null;
    } finally {
      if (!quiet) {
        setTossInvestOrderSyncBusy(false);
        setTossInvestOrderSyncAction("");
      }
    }
  }, []);

  const requestOrderSyncSnapshotRebuild = useCallback(async ({ forceFull = false } = {}) => {
    const clientRunId = `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    setTossInvestOrderSyncStatus((current) => ({
      ...(current || {}),
      reconstruction: { ok: null, status: "running", clientRunId, startedAt },
    }));
    const payload = await requestTossInvestSnapshotRebuild({ forceFull });
    const reconstruction = payload.reconstruction
      ? {
          ...payload.reconstruction,
          clientRunId,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: payload.reconstruction.status || (payload.reconstruction.ok === true ? "completed" : "failed"),
        }
      : {
          ok: false,
          clientRunId,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: "failed",
          error: "포지션 스냅샷 생성 결과를 확인하지 못했습니다.",
        };
    const normalizedPayload = { ...payload, reconstruction };
    setTossInvestOrderSyncStatus((current) => mergeOrderSyncStatus(current, normalizedPayload));
    return normalizedPayload;
  }, []);

  const runTossInvestOrderSyncBatches = useCallback(async () => {
    let payload = null;
    for (let batchIndex = 0; batchIndex < ORDER_SYNC_MAX_BATCHES; batchIndex += 1) {
      if (batchIndex > 0) {
        await new Promise((resolveTimer) => window.setTimeout(resolveTimer, ORDER_SYNC_BATCH_DELAY_MS));
        await loadTossInvestOrderSyncStatus({ quiet: true });
      }
      payload = await requestTossInvestOrderSyncBatch();
      setTossInvestOrderSyncStatus((current) => mergeOrderSyncStatus(current, payload));
      if (!orderSyncHasMore(payload)) {
        const changedOrders =
          Number(payload?.sync?.insertedCount || 0) + Number(payload?.sync?.updatedCount || 0);
        setTossInvestOrderSyncAction("snapshot");
        return requestOrderSyncSnapshotRebuild({ forceFull: changedOrders > 0 });
      }
    }
    throw new Error("거래내역 동기화가 너무 오래 이어지고 있습니다. 잠시 후 다시 이어서 동기화해 주세요.");
  }, [loadTossInvestOrderSyncStatus, requestOrderSyncSnapshotRebuild]);

  const runTossInvestOrderSync = useCallback(async () => {
    if (orderSyncBusyRef.current) return null;
    orderSyncBusyRef.current = true;
    setTossInvestOrderSyncBusy(true);
    setTossInvestOrderSyncAction("sync");
    setTossInvestOrderSyncError("");
    setTossInvestOrderSyncErrorCode("");
    try {
      return await runTossInvestOrderSyncBatches();
    } catch (error) {
      setTossInvestOrderSyncStatus((current) => failRunningReconstruction(current, error));
      setTossInvestOrderSyncError(error.message);
      setTossInvestOrderSyncErrorCode(error.errorCode || "");
      return null;
    } finally {
      orderSyncBusyRef.current = false;
      setTossInvestOrderSyncBusy(false);
      setTossInvestOrderSyncAction("");
    }
  }, [runTossInvestOrderSyncBatches]);

  const updateTossInvestOrderSyncEnabled = useCallback(async (enabled) => {
    if (orderSyncBusyRef.current) return null;
    orderSyncBusyRef.current = true;
    setTossInvestOrderSyncBusy(true);
    setTossInvestOrderSyncAction("toggle");
    setTossInvestOrderSyncError("");
    setTossInvestOrderSyncErrorCode("");
    try {
      const payload = await patchTossInvestOrderSyncSettings({ enabled });
      setTossInvestOrderSyncStatus((current) => mergeOrderSyncStatus(current, payload));
      if (!enabled) return payload;
      setTossInvestOrderSyncAction("sync");
      return await runTossInvestOrderSyncBatches();
    } catch (error) {
      setTossInvestOrderSyncStatus((current) => failRunningReconstruction(current, error));
      setTossInvestOrderSyncError(error.message);
      setTossInvestOrderSyncErrorCode(error.errorCode || "");
      return null;
    } finally {
      orderSyncBusyRef.current = false;
      setTossInvestOrderSyncBusy(false);
      setTossInvestOrderSyncAction("");
    }
  }, [runTossInvestOrderSyncBatches]);

  const deleteTossInvestCredentials = useCallback(async () => {
    const deleted = await runTossInvestAction("delete", "/api/tossinvest/auth/credentials", {
      method: "DELETE",
      confirmMessage: "저장된 토스증권 API 키와 동기화된 거래내역 SQLite를 함께 삭제할까요?",
    });
    if (deleted) await loadTossInvestOrderSyncStatus({ quiet: true });
    return deleted;
  }, [loadTossInvestOrderSyncStatus, runTossInvestAction]);

  const credentials = tossInvestStatus?.credentials || {};
  const connectionUsable = Boolean(credentials.usable || credentials.unlocked);
  const connected = Boolean(
    (tossInvestStatus?.connected || tossInvestStatus?.token?.cached) && connectionUsable
  );
  const orderSyncEnabled = Boolean(
    tossInvestOrderSyncStatus?.enabled || tossInvestOrderSyncStatus?.settings?.enabled
  );

  useEffect(() => {
    if (!connected || !orderSyncEnabled) return undefined;
    const timer = window.setInterval(() => {
      if (!orderSyncBusyRef.current) void runTossInvestOrderSync();
    }, ORDER_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, orderSyncEnabled, runTossInvestOrderSync]);

  useEffect(() => {
    if (!tossInvestOrderSyncBusy || !["sync", "snapshot"].includes(tossInvestOrderSyncAction)) {
      return undefined;
    }
    void loadTossInvestOrderSyncStatus({ quiet: true });
    const timer = window.setInterval(() => {
      void loadTossInvestOrderSyncStatus({ quiet: true });
    }, ORDER_SYNC_PROGRESS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadTossInvestOrderSyncStatus, tossInvestOrderSyncAction, tossInvestOrderSyncBusy]);

  useEffect(() => {
    if (activeView === "settings") {
      void loadTossInvestStatus({ quiet: true });
      void loadTossInvestOrderSyncStatus({ quiet: true });
    }
    if (activeView === "transaction-status") void loadTossInvestStatus({ quiet: true });
  }, [activeView, loadTossInvestOrderSyncStatus, loadTossInvestStatus]);

  useEffect(() => {
    if (!assetPortfolioActive) return;
    void loadTossInvestStatus({ quiet: true });
    void loadTossInvestOrderSyncStatus({ quiet: true });
  }, [assetPortfolioActive, loadTossInvestOrderSyncStatus, loadTossInvestStatus]);

  useEffect(() => {
    if (!tossInvestDialogOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setTossInvestDialogOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tossInvestDialogOpen]);

  return {
    tossInvestStatus,
    tossInvestBusy,
    tossInvestAction,
    tossInvestError,
    tossInvestErrorCode,
    tossInvestPublicIp,
    tossInvestPublicIpBusy,
    tossInvestPublicIpError,
    tossInvestDialogOpen,
    tossInvestOrderSyncStatus,
    tossInvestOrderSyncBusy,
    tossInvestOrderSyncAction,
    tossInvestOrderSyncError,
    tossInvestOrderSyncErrorCode,
    loadTossInvestStatus,
    saveAndProbeTossInvestCredentials,
    unlockAndProbeTossInvestVault,
    lockTossInvestVault: () => runTossInvestAction("lock", "/api/tossinvest/auth/lock"),
    probeTossInvestConnection,
    checkTossInvestPublicIp,
    deleteTossInvestCredentials,
    loadTossInvestOrderSyncStatus,
    runTossInvestOrderSync,
    updateTossInvestOrderSyncEnabled,
    openTossInvestDialog: () => {
      setTossInvestDialogOpen(true);
      void loadTossInvestStatus({ quiet: true });
    },
    closeTossInvestDialog: () => setTossInvestDialogOpen(false),
  };
}
