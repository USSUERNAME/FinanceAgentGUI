import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/triangle-alert.js";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import CircleX from "lucide-react/dist/esm/icons/circle-x.js";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.js";
import FileCheck2 from "lucide-react/dist/esm/icons/file-check-2.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.js";
import { fetchDailyIntelligence } from "../dailyIntelligence/dailyIntelligenceApi.js";
import { buildStockResearchGatewaySnapshot } from "./stockCandidateVerification.js";
import StockAnalysisFrameworkCard from "./StockAnalysisFrameworkCard.jsx";
import StockTradePlanEditor from "./StockTradePlanEditor.jsx";
import "./stock-research-gateway.css";

function formatUpdatedAt(value) {
  if (!value) return "갱신 시각 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function openHash(hash) {
  window.location.hash = hash;
}

async function syncCandidatePerformance(candidates) {
  const response = await fetch("/api/stock-candidate-performance", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "sync",
      candidates: candidates.map((candidate) => ({
        ticker: candidate.ticker,
        companyName: candidate.companyName,
        grade: candidate.grade,
        asOf: candidate.asOf,
        close: candidate.reaction?.close,
        benchmarkReturn1d: Number.isFinite(Number(candidate.reaction?.return1d))
          && Number.isFinite(Number(candidate.reaction?.spyRelative1d))
          ? Number(candidate.reaction.return1d) - Number(candidate.reaction.spyRelative1d)
          : null,
        thesisReason: candidate.whyNow,
        invalidationConditions: candidate.invalidationConditions,
      })),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function reviewCandidatePerformance(ticker, thesisStatus) {
  const response = await fetch("/api/stock-candidate-performance", {
    method: "PATCH",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "review", ticker, thesisStatus }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function formatFinancialValue(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (unit === "USD" && Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(2)}B`;
  if (unit === "USD" && Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(number)}${unit ? ` ${unit}` : ""}`;
}

function ClaimLedger({ candidate }) {
  if (!candidate.claims.length) return null;
  return (
    <details className="stock-gateway-claim-ledger">
      <summary>주장별 근거 장부 <strong>{candidate.claims.length}</strong></summary>
      <div>
        {candidate.claims.slice(0, 8).map((claim) => (
          <article key={claim.id}>
            <span className={`is-${claim.evidenceType === "공식 사실" ? "official" : claim.evidenceType === "언론 보도" ? "media" : "inference"}`}>
              {claim.evidenceType}
            </span>
            <p>{claim.claim}</p>
            <dl>
              <div><dt>발행일</dt><dd>{claim.publishedAt || "미기재"}</dd></div>
              <div><dt>데이터 기준일</dt><dd>{claim.dataAsOf || candidate.asOf || "미기재"}</dd></div>
              <div><dt>조회일</dt><dd>{candidate.asOf || "미기재"}</dd></div>
            </dl>
            <a href={claim.sourceUrl} target="_blank" rel="noreferrer">{claim.sourceTitle}<ExternalLink size={12} /></a>
          </article>
        ))}
      </div>
    </details>
  );
}

function IntegratedResearchCard({ candidate }) {
  const research = candidate.integratedResearch;
  const summary = research.financialSummary || {};
  return (
    <details className="stock-gateway-integrated-card">
      <summary>
        <span>종목 통합 리서치 카드</span>
        <small>#stock → Daily Intelligence → 기업 리서치</small>
      </summary>
      <div className="stock-gateway-integrated-body">
        <section>
          <h4>사업·최근 실적</h4>
          <p>{research.businessSummary || "SEC 공시 기반 사업 요약 대기"}</p>
          {research.financialRows.length ? (
            <div className="stock-gateway-financial-grid">
              {research.financialRows.slice(0, 4).map((row) => (
                <div key={row.metricId}>
                  <span>{row.labelKo}</span>
                  <strong>{formatFinancialValue(row.value, row.unit)}</strong>
                  <small>{Number.isFinite(Number(row.changePct)) ? `전년동기 ${Number(row.changePct) >= 0 ? "+" : ""}${Number(row.changePct).toFixed(1)}%` : row.periodEnd}</small>
                </div>
              ))}
            </div>
          ) : null}
        </section>
        <section>
          <h4>장기 판단 원칙</h4>
          <dl className="stock-gateway-judgment-grid">
            <div><dt>기업의 질</dt><dd>{research.qualityStatus || "평가 대기"}</dd></div>
            <div><dt>주식 매력도</dt><dd>{research.attractivenessStatus || "평가 대기"}</dd></div>
            <div><dt>포트폴리오 적합성</dt><dd>{research.portfolioFitStatus || "평가 대기"}</dd></div>
            <div><dt>완성 재무연도</dt><dd>{summary.complete_core_years ?? "-"}년</dd></div>
            <div><dt>영업이익 CAGR</dt><dd>{summary.operating_income_cagr_pct ?? "-"}%</dd></div>
            <div><dt>FCF CAGR</dt><dd>{summary.fcf_cagr_pct ?? "-"}%</dd></div>
          </dl>
        </section>
        <section className="stock-gateway-scenarios">
          <h4>조건부 시나리오</h4>
          <div><strong>강세 확인</strong><p>{research.scenarios.bull || "확인 조건 미작성"}</p></div>
          <div><strong>기준 관찰</strong><p>{research.scenarios.base || "기준 가설 미작성"}</p></div>
          <div><strong>약세·폐기</strong><p>{research.scenarios.bear || "무효화 조건 미작성"}</p></div>
        </section>
        <section>
          <h4>다음 확인 항목</h4>
          {research.nextChecks.length ? <ul>{research.nextChecks.map((item) => <li key={item}>{item}</li>)}</ul> : <p>다음 확인일과 항목이 아직 작성되지 않았습니다.</p>}
        </section>
      </div>
    </details>
  );
}

function MacroTransmissionPath({ candidate }) {
  return (
    <details className="stock-gateway-macro-path">
      <summary>거시·한국시장 전파경로 <span>{candidate.macroPath.status === "linked" ? "연결" : "부분 연결"}</span></summary>
      <div>
        {candidate.macroPath.steps.map((step, index) => (
          <React.Fragment key={`${step.label}-${index}`}>
            <article>
              <span>{step.label}</span>
              <strong>{step.value}</strong>
              {step.detail ? <p>{step.detail}</p> : null}
              <small>{step.evidenceType}</small>
            </article>
            {index < candidate.macroPath.steps.length - 1 ? <ArrowRight size={15} /> : null}
          </React.Fragment>
        ))}
      </div>
    </details>
  );
}

function CandidatePerformance({ candidate, performance, busy, onReview }) {
  if (!performance) return null;
  const statusLabel = {
    watching: "관찰 중",
    hit: "가설 적중",
    invalidated: "가설 무효화",
  }[performance.thesisStatus] || "관찰 중";
  return (
    <section className="stock-gateway-performance">
      <header>
        <div><span>후보 사후 성과</span><strong>{performance.registeredAt} · {performance.registeredPrice}</strong></div>
        <em className={`is-${performance.thesisStatus || "watching"}`}>{statusLabel}</em>
      </header>
      <div>
        {performance.horizons.map((horizon) => (
          <article key={horizon.id}>
            <span>{horizon.label}</span>
            <strong>{horizon.status === "measured" && horizon.returnPct !== null ? `${horizon.returnPct >= 0 ? "+" : ""}${horizon.returnPct.toFixed(2)}%` : "대기"}</strong>
            <small>{horizon.excessReturnPct !== null ? `SPY 대비 ${horizon.excessReturnPct >= 0 ? "+" : ""}${horizon.excessReturnPct.toFixed(2)}%p` : `목표 ${horizon.targetDate}`}</small>
          </article>
        ))}
      </div>
      <footer aria-label={`${candidate.ticker} 투자 가설 사후 판정`}>
        {[{ id: "watching", label: "관찰 중" }, { id: "hit", label: "적중" }, { id: "invalidated", label: "무효화" }].map((item) => (
          <button type="button" className={performance.thesisStatus === item.id ? "is-active" : ""} disabled={busy} onClick={() => onReview(candidate.ticker, item.id)} key={item.id}>{item.label}</button>
        ))}
      </footer>
    </section>
  );
}

async function saveCandidateTradePlan(ticker, tradePlan) {
  const response = await fetch("/api/stock-candidate-performance", {
    method: "PATCH",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "trade_plan", ticker, tradePlan }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function GateRolloutSimulation({ simulation }) {
  if (!simulation?.candidateCount) return null;
  const holding = simulation.activationDecision === "hold_activation";
  return (
    <section className={`stock-gateway-rollout ${holding ? "is-hold" : "is-review"}`}>
      <div>
        <span>NEW GATE DRY RUN</span>
        <strong>{holding ? "새 게이트 활성화 보류" : "새 게이트 검토 가능"}</strong>
      </div>
      <dl>
        <div><dt>현재 통과</dt><dd>{simulation.currentPassingCount}</dd></div>
        <div><dt>근거 핵심 통과</dt><dd>{simulation.evidenceCorePassingCount}</dd></div>
        <div><dt>거래 적합성 포함</dt><dd>{simulation.targetPassingCount}</dd></div>
      </dl>
      <p>{simulation.reason} 현재 A/B/C 등급은 바꾸지 않았습니다.</p>
    </section>
  );
}

function CandidateCard({ candidate, performance, performanceBusy, onReviewPerformance, onSaveTradePlan }) {
  const visibleChecks = candidate.checks.filter((check) => check.id !== "dates");
  return (
    <article className={`stock-gateway-candidate is-grade-${candidate.grade.toLowerCase()}`}>
      <header>
        <span className="stock-gateway-grade">{candidate.grade}</span>
        <div>
          <h3>{candidate.ticker} <small>{candidate.companyName}</small></h3>
          <p>{candidate.whyNow || "후보 선정 근거 확인 대기"}</p>
        </div>
        {candidate.liquidityRisk.momentumRisk ? (
          <span className="stock-gateway-risk"><AlertTriangle size={14} /> 급등락 주의</span>
        ) : null}
      </header>

      <div className="stock-gateway-evidence-summary">
        <span>공식 근거 <strong>{candidate.primarySourceCount}</strong></span>
        <span>검증 사실 <strong>{candidate.verifiedFactCount}</strong></span>
        <span>분석 축 <strong>{Object.values(candidate.dimensions).filter(Boolean).length}/3</strong></span>
        <span>기준일 <strong>{candidate.asOf || "없음"}</strong></span>
      </div>

      <div className="stock-gateway-checks">
        {visibleChecks.map((check) => (
          <div className={check.passed ? "is-passed" : "is-missing"} key={check.id}>
            {check.passed ? <Check size={14} /> : <CircleX size={14} />}
            <span>{check.detail}</span>
          </div>
        ))}
      </div>

      {candidate.counterEvidence ? (
        <p className="stock-gateway-counter"><strong>반대 근거</strong>{candidate.counterEvidence}</p>
      ) : null}
      {candidate.invalidationConditions[0] ? (
        <p className="stock-gateway-invalidation"><strong>무효화 조건</strong>{candidate.invalidationConditions[0]}</p>
      ) : null}

      {candidate.sources.length ? (
        <div className="stock-gateway-sources" aria-label={`${candidate.ticker} 1차 출처`}>
          {candidate.sources.slice(0, 3).map((source) => (
            <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.title}`}>
              <FileCheck2 size={13} />
              <span>{source.title}</span>
              <small>{source.asOf || source.type}</small>
              <ExternalLink size={12} />
            </a>
          ))}
        </div>
      ) : null}

      <ClaimLedger candidate={candidate} />
      <IntegratedResearchCard candidate={candidate} />
      <StockAnalysisFrameworkCard framework={candidate.analysisFramework} />
      <MacroTransmissionPath candidate={candidate} />
      <CandidatePerformance
        candidate={candidate}
        performance={performance}
        busy={performanceBusy}
        onReview={onReviewPerformance}
      />
      <StockTradePlanEditor
        candidate={candidate}
        performance={performance}
        busy={performanceBusy}
        onSave={onSaveTradePlan}
      />

      <footer>
        <span className={candidate.allocationAllowed ? "is-allowed" : "is-blocked"}>
          {candidate.allocationAllowed
            ? "검증 게이트 통과 · 비중 판단은 기업 리서치에서"
            : `비중 제안 숨김 · ${candidate.missingRequirements.slice(0, 2).join(" · ")} 필요`}
        </span>
        <div>
          <button type="button" onClick={() => openHash("#daily-intelligence")}>Daily Intelligence <ArrowRight size={13} /></button>
          <button type="button" onClick={() => openHash("#company-research")}>기업 리서치 <ArrowRight size={13} /></button>
        </div>
      </footer>
    </article>
  );
}

export default function StockResearchGateway({ activeMode, onModeChange }) {
  const [snapshot, setSnapshot] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [performanceByTicker, setPerformanceByTicker] = React.useState({});
  const [performanceBusyTicker, setPerformanceBusyTicker] = React.useState("");

  const applyPerformancePayload = React.useCallback((payload) => {
    const next = {};
    for (const record of Array.isArray(payload?.records) ? payload.records : []) next[record.ticker] = record;
    setPerformanceByTicker(next);
  }, []);

  const load = React.useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const payload = await fetchDailyIntelligence();
      const nextSnapshot = buildStockResearchGatewaySnapshot(payload);
      setSnapshot(nextSnapshot);
      try {
        applyPerformancePayload(await syncCandidatePerformance(nextSnapshot.verifiedCandidates));
      } catch {
        // Performance tracking is supplementary; candidate verification remains usable.
      }
    } catch (loadError) {
      setError(loadError?.message || String(loadError));
    } finally {
      setBusy(false);
    }
  }, [applyPerformancePayload]);

  const reviewPerformance = React.useCallback(async (ticker, thesisStatus) => {
    setPerformanceBusyTicker(ticker);
    try {
      applyPerformancePayload(await reviewCandidatePerformance(ticker, thesisStatus));
    } finally {
      setPerformanceBusyTicker("");
    }
  }, [applyPerformancePayload]);

  const saveTradePlan = React.useCallback(async (ticker, tradePlan) => {
    setPerformanceBusyTicker(ticker);
    try {
      applyPerformancePayload(await saveCandidateTradePlan(ticker, tradePlan));
    } finally {
      setPerformanceBusyTicker("");
    }
  }, [applyPerformancePayload]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const verifiedCount = snapshot?.verifiedCandidates?.length || 0;
  const reviewCount = snapshot?.reviewCandidates?.length || 0;

  return (
    <section className="stock-research-gateway" aria-labelledby="stock-research-gateway-title">
      <header className="stock-gateway-hero">
        <div>
          <span><ShieldCheck size={16} /> STOCK RESEARCH GATEWAY</span>
          <h1 id="stock-research-gateway-title">후보 탐색에서 공식 근거 검증까지</h1>
          <p>커뮤니티 신호는 원문으로 보존하고, 검증 게이트를 통과한 종목만 투자 후보 영역에 올립니다.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="is-spinning" /> : <RefreshCw size={16} />}
          {busy ? "검증 중" : "후보 새로고침"}
        </button>
      </header>

      <nav className="stock-gateway-tabs" aria-label="주식 채널 보기">
        <button
          type="button"
          className={activeMode === "verified" ? "is-active" : ""}
          onClick={() => onModeChange("verified")}
        >
          <ShieldCheck size={17} />
          <span>검증된 투자 후보</span>
          <strong>{verifiedCount}</strong>
        </button>
        <button
          type="button"
          className={activeMode === "community" ? "is-active" : ""}
          onClick={() => onModeChange("community")}
        >
          <MessageSquare size={17} />
          <span>커뮤니티 원문·시장 심리</span>
        </button>
      </nav>

      {activeMode === "verified" ? (
        <div className="stock-gateway-body">
          {error ? (
            <div className="stock-gateway-state is-error">
              <AlertTriangle size={20} />
              <div><strong>후보 데이터를 불러오지 못했습니다.</strong><span>{error}</span></div>
              <button type="button" onClick={() => void load()}>다시 시도</button>
            </div>
          ) : busy && !snapshot ? (
            <div className="stock-gateway-state"><LoaderCircle size={20} className="is-spinning" /> 후보 게이트를 계산하고 있습니다.</div>
          ) : (
            <>
              <div className="stock-gateway-overview">
                <div><span>B등급 이상</span><strong>{verifiedCount}</strong><small>모든 필수 게이트 통과</small></div>
                <div><span>검증 대기</span><strong>{reviewCount}</strong><small>C등급 · 비중 제안 차단</small></div>
                <div><span>탐색 입력</span><strong>{snapshot?.sourceCandidateCount || 0}</strong><small>시장·이벤트 스크린</small></div>
                <div><span>마지막 갱신</span><strong>{snapshot?.asOf || "-"}</strong><small>{formatUpdatedAt(snapshot?.updatedAt)}</small></div>
              </div>
              <GateRolloutSimulation simulation={snapshot?.gateSimulation} />

              <div className="stock-gateway-section-heading">
                <div><h2>검증된 투자 후보</h2><p>공식 원문, 핵심 사실, 분석 축, 위험·반대 근거, 무효화 조건과 기준일을 모두 확인했습니다.</p></div>
                <span>B 이상만 표시</span>
              </div>
              {verifiedCount ? (
                <div className="stock-gateway-candidate-grid">
                  {snapshot.verifiedCandidates.map((candidate) => (
                    <CandidateCard
                      candidate={candidate}
                      performance={performanceByTicker[candidate.ticker]}
                      performanceBusy={performanceBusyTicker === candidate.ticker}
                      onReviewPerformance={reviewPerformance}
                      onSaveTradePlan={saveTradePlan}
                      key={candidate.ticker}
                    />
                  ))}
                </div>
              ) : (
                <div className="stock-gateway-empty">
                  <ShieldCheck size={25} />
                  <strong>현재 B등급 이상 후보가 없습니다.</strong>
                  <span>근거가 모자란 종목을 억지로 승격하지 않았습니다. 아래 검증 대기 목록에서 부족한 조건을 확인할 수 있습니다.</span>
                </div>
              )}

              {reviewCount ? (
                <details className="stock-gateway-review-queue" open={verifiedCount === 0}>
                  <summary><span>검증 대기 후보</span><strong>{reviewCount}</strong><small>C등급 · 투자 행동/비중 제안 숨김</small></summary>
                  <div className="stock-gateway-candidate-grid is-review">
                    {snapshot.reviewCandidates.map((candidate) => (
                      <CandidateCard
                        candidate={candidate}
                        performance={performanceByTicker[candidate.ticker]}
                        performanceBusy={performanceBusyTicker === candidate.ticker}
                        onReviewPerformance={reviewPerformance}
                        onSaveTradePlan={saveTradePlan}
                        key={candidate.ticker}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="stock-gateway-community-note">
          <MessageSquare size={18} />
          <div><strong>이 영역은 커뮤니티 원문과 심리 신호입니다.</strong><span>게시글의 목표비중·매수 행동은 검증된 투자 후보 판단으로 전달되지 않습니다.</span></div>
        </div>
      )}
    </section>
  );
}
