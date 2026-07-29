import { useCallback, useEffect, useState } from "react";
import {
  executeDailyIntelligenceJob,
  fetchDailyIntelligence,
  fetchDailyIntelligenceJobStatus,
  planDailyIntelligenceJob,
  quickAddDailyIntelligencePortfolioHolding,
  quickAddDailyIntelligenceWatchlistTicker,
  removeDailyIntelligencePortfolioHolding,
  reviewDailyIntelligencePortfolioRisk,
  syncDailyIntelligenceTheses,
  trackDailyIntelligenceStockThesis,
} from "./dailyIntelligenceApi.js";

export function useDailyIntelligenceController() {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [brokerResearchBusy, setBrokerResearchBusy] = useState(false);
  const [brokerResearchError, setBrokerResearchError] = useState("");
  const [jobStatus, setJobStatus] = useState(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobError, setJobError] = useState("");
  const [pendingPlan, setPendingPlan] = useState(null);
  const [thesisMemoryBusy, setThesisMemoryBusy] = useState(false);
  const [thesisMemoryError, setThesisMemoryError] = useState("");
  const [watchlistQuickAddBusy, setWatchlistQuickAddBusy] = useState("");
  const [watchlistQuickAddError, setWatchlistQuickAddError] = useState("");
  const [portfolioRiskReviewBusy, setPortfolioRiskReviewBusy] = useState("");
  const [portfolioRiskReviewError, setPortfolioRiskReviewError] = useState("");

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

  const selectBrokerResearchDate = useCallback(async (date) => {
    setBrokerResearchBusy(true);
    setBrokerResearchError("");
    try {
      setSnapshot(await fetchDailyIntelligence(globalThis.fetch, {
        brokerResearchDate: date,
      }));
    } catch (requestError) {
      setBrokerResearchError(
        requestError.message || "선택한 날짜의 애널리스트 리포트를 불러오지 못했습니다."
      );
    } finally {
      setBrokerResearchBusy(false);
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

  const syncThesisMemory = useCallback(async () => {
    setThesisMemoryBusy(true);
    setThesisMemoryError("");
    try {
      await syncDailyIntelligenceTheses();
      setSnapshot(await fetchDailyIntelligence());
    } catch (requestError) {
      setThesisMemoryError(
        requestError.message || "투자 가설을 World Memory에 반영하지 못했습니다.",
      );
    } finally {
      setThesisMemoryBusy(false);
    }
  }, []);

  const trackStockThesis = useCallback(async ({
    ticker,
    sectorId,
    brokerResearchDate,
  }) => {
    setThesisMemoryBusy(true);
    setThesisMemoryError("");
    try {
      const result = await trackDailyIntelligenceStockThesis({
        ticker,
        sectorId,
        brokerResearchDate,
      });
      setSnapshot(await fetchDailyIntelligence(globalThis.fetch, {
        brokerResearchDate,
      }));
      return result;
    } catch (requestError) {
      setThesisMemoryError(
        requestError.message || "종목 투자 가설을 저장하지 못했습니다.",
      );
      return null;
    } finally {
      setThesisMemoryBusy(false);
    }
  }, []);

  const quickAddWatchlistTicker = useCallback(async (ticker) => {
    setWatchlistQuickAddBusy(`watchlist:${ticker}`);
    setWatchlistQuickAddError("");
    try {
      const result = await quickAddDailyIntelligenceWatchlistTicker(ticker);
      setSnapshot(await fetchDailyIntelligence());
      return result;
    } catch (requestError) {
      setWatchlistQuickAddError(
        requestError.message || "관심종목에 추가하지 못했습니다.",
      );
      return null;
    } finally {
      setWatchlistQuickAddBusy("");
    }
  }, []);

  const quickAddPortfolioHolding = useCallback(async (ticker, weight) => {
    setWatchlistQuickAddBusy(`portfolio:${ticker}`);
    setWatchlistQuickAddError("");
    try {
      const result = await quickAddDailyIntelligencePortfolioHolding(ticker, weight);
      setSnapshot(await fetchDailyIntelligence());
      return result;
    } catch (requestError) {
      setWatchlistQuickAddError(
        requestError.message || "보유종목에 등록하지 못했습니다.",
      );
      return null;
    } finally {
      setWatchlistQuickAddBusy("");
    }
  }, []);

  const removePortfolioHolding = useCallback(async (ticker) => {
    setWatchlistQuickAddBusy(`remove:${ticker}`);
    setWatchlistQuickAddError("");
    try {
      const result = await removeDailyIntelligencePortfolioHolding(ticker);
      setSnapshot(await fetchDailyIntelligence());
      return result;
    } catch (requestError) {
      setWatchlistQuickAddError(
        requestError.message || "보유종목을 삭제하지 못했습니다.",
      );
      return null;
    } finally {
      setWatchlistQuickAddBusy("");
    }
  }, []);

  const reviewPortfolioRisk = useCallback(async ({
    riskId,
    status,
    note,
    reviewDate = "",
    reviewReportDate = "",
  }) => {
    setPortfolioRiskReviewBusy(riskId);
    setPortfolioRiskReviewError("");
    try {
      const result = await reviewDailyIntelligencePortfolioRisk({
        riskId,
        status,
        note,
        reviewDate,
        reviewReportDate,
      });
      setSnapshot(await fetchDailyIntelligence());
      return result;
    } catch (requestError) {
      setPortfolioRiskReviewError(
        requestError.message || "위험 검토 상태를 저장하지 못했습니다.",
      );
      return null;
    } finally {
      setPortfolioRiskReviewBusy("");
    }
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
    brokerResearchBusy,
    brokerResearchError,
    selectBrokerResearchDate,
    jobStatus,
    jobBusy,
    jobError,
    pendingPlan,
    requestJobPlan,
    executePendingPlan,
    cancelPendingPlan,
    thesisMemoryBusy,
    thesisMemoryError,
    syncThesisMemory,
    trackStockThesis,
    watchlistQuickAddBusy,
    watchlistQuickAddError,
    quickAddWatchlistTicker,
    quickAddPortfolioHolding,
    removePortfolioHolding,
    portfolioRiskReviewBusy,
    portfolioRiskReviewError,
    reviewPortfolioRisk,
  };
}
