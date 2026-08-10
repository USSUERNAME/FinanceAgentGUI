import React from "react";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import {
  fetchDailyIntelligence,
  fetchInstitutionalHoldingsRadar,
  refreshInstitutionalHoldingsRadar,
  trackDailyIntelligenceStockThesis,
} from "../dailyIntelligence/dailyIntelligenceApi.js";
import { InstitutionalPortfolioRadar } from "../dailyIntelligence/InstitutionalPortfolioRadar.jsx";
import "./institutional-portfolio-view.css";

export default function InstitutionalPortfolioView() {
  const [radarPayload, setRadarPayload] = React.useState(null);
  const [dailyContext, setDailyContext] = React.useState(null);
  const [radarBusy, setRadarBusy] = React.useState(true);
  const [radarError, setRadarError] = React.useState("");
  const [contextError, setContextError] = React.useState("");
  const [trackBusy, setTrackBusy] = React.useState(false);

  const loadDailyContext = React.useCallback(async () => {
    try {
      const next = await fetchDailyIntelligence();
      setDailyContext(next);
      setContextError("");
      return next;
    } catch (error) {
      setContextError(error.message || "현재 Daily Intelligence 연결 근거를 불러오지 못했습니다.");
      return null;
    }
  }, []);

  const reloadRadar = React.useCallback(async ({ refresh = false } = {}) => {
    setRadarBusy(true);
    setRadarError("");
    try {
      const next = refresh
        ? await refreshInstitutionalHoldingsRadar()
        : await fetchInstitutionalHoldingsRadar();
      setRadarPayload(next);
      return next;
    } catch (error) {
      if (error.connection) {
        setRadarPayload((current) => ({
          ...(current || {}),
          connection: error.connection,
        }));
      }
      setRadarError(error.message || "기관 포트폴리오 데이터를 불러오지 못했습니다.");
      return null;
    } finally {
      setRadarBusy(false);
    }
  }, []);

  const trackStock = React.useCallback(async ({ ticker, sectorId, brokerResearchDate }) => {
    setTrackBusy(true);
    setContextError("");
    try {
      const result = await trackDailyIntelligenceStockThesis({
        ticker,
        sectorId,
        brokerResearchDate,
      });
      await loadDailyContext();
      return result;
    } catch (error) {
      setContextError(error.message || "종목 투자 가설을 저장하지 못했습니다.");
      return null;
    } finally {
      setTrackBusy(false);
    }
  }, [loadDailyContext]);

  React.useEffect(() => {
    void loadDailyContext();
    void reloadRadar();
  }, [loadDailyContext, reloadRadar]);

  React.useEffect(() => {
    const refreshIntervalMs = Math.max(
      15 * 60 * 1000,
      Number(radarPayload?.connection?.refreshIntervalMs || 24 * 60 * 60 * 1000),
    );
    const timer = window.setInterval(() => {
      void reloadRadar();
    }, refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [radarPayload?.connection?.refreshIntervalMs, reloadRadar]);

  const report = dailyContext?.report;
  const brokerResearch = dailyContext?.brokerResearch;
  const brokerResearchHistory = dailyContext?.brokerResearchHistory;

  return (
    <div className="institutional-portfolio-shell">
      <header className="institutional-portfolio-page-header">
        <div>
          <span>INSTITUTIONAL OWNERSHIP</span>
          <h1>기관 포트폴리오</h1>
          <p>SEC 13F의 분기별 보유 변화를 시장 판단과 분리해 추적합니다.</p>
        </div>
        {radarBusy && !radarPayload ? (
          <div className="institutional-portfolio-loading" role="status">
            <LoaderCircle size={16} className="is-spinning" /> 공시 캐시 확인 중
          </div>
        ) : null}
      </header>

      <InstitutionalPortfolioRadar
        payload={radarPayload}
        busy={radarBusy}
        error={[radarError, contextError].filter(Boolean).join(" ")}
        onRefresh={reloadRadar}
        decisionChain={dailyContext?.decisionChain}
        stockCandidates={dailyContext?.stockCandidates}
        brokerResearchDate={
          brokerResearchHistory?.selectedDate || brokerResearch?.reportDate || report?.reportDate || ""
        }
        onTrackStock={trackStock}
        trackBusy={trackBusy}
      />
    </div>
  );
}
