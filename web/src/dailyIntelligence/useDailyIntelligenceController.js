import { useCallback, useEffect, useState } from "react";
import {
  executeDailyIntelligenceJob,
  fetchDailyIntelligence,
  fetchDailyIntelligenceJobStatus,
  planDailyIntelligenceJob,
} from "./dailyIntelligenceApi.js";

export function useDailyIntelligenceController() {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [jobStatus, setJobStatus] = useState(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobError, setJobError] = useState("");
  const [pendingPlan, setPendingPlan] = useState(null);

  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await fetchDailyIntelligence());
    } catch (requestError) {
      setError(requestError.message || "Daily Intelligence를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, []);

  const reloadJobStatus = useCallback(async () => {
    try {
      const next = await fetchDailyIntelligenceJobStatus();
      setJobStatus(next);
      setJobError("");
      return next;
    } catch (requestError) {
      setJobError(requestError.message || "PB 파이프라인 상태를 불러오지 못했습니다.");
      return null;
    }
  }, []);

  const requestJobPlan = useCallback(async (jobId) => {
    setJobBusy(true);
    setJobError("");
    try {
      const next = await planDailyIntelligenceJob(jobId);
      setJobStatus(next);
      setPendingPlan(next.plan || null);
    } catch (requestError) {
      setJobError(requestError.message || "PB 파이프라인 실행 계획을 만들지 못했습니다.");
    } finally {
      setJobBusy(false);
    }
  }, []);

  const executePendingPlan = useCallback(async () => {
    if (!pendingPlan?.token) return;
    setJobBusy(true);
    setJobError("");
    try {
      const next = await executeDailyIntelligenceJob(pendingPlan.token);
      setJobStatus(next);
      setPendingPlan(null);
    } catch (requestError) {
      setJobError(requestError.message || "PB 파이프라인 작업을 시작하지 못했습니다.");
    } finally {
      setJobBusy(false);
    }
  }, [pendingPlan]);

  const cancelPendingPlan = useCallback(() => {
    setPendingPlan(null);
  }, []);

  useEffect(() => {
    void reload();
    void reloadJobStatus();
  }, [reload, reloadJobStatus]);

  useEffect(() => {
    if (jobStatus?.run?.status !== "running") return undefined;
    const timer = globalThis.setInterval(async () => {
      const next = await reloadJobStatus();
      if (next?.run?.status === "succeeded") {
        void reload();
      }
    }, 1500);
    return () => globalThis.clearInterval(timer);
  }, [jobStatus?.run?.status, reload, reloadJobStatus]);

  return {
    snapshot,
    busy,
    error,
    reload,
    jobStatus,
    jobBusy,
    jobError,
    pendingPlan,
    requestJobPlan,
    executePendingPlan,
    cancelPendingPlan,
  };
}
