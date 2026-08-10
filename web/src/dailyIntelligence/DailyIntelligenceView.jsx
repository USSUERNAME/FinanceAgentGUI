import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import ArrowUpRight from "lucide-react/dist/esm/icons/arrow-up-right.js";
import BriefcaseBusiness from "lucide-react/dist/esm/icons/briefcase-business.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import CircleDashed from "lucide-react/dist/esm/icons/circle-dashed.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import FileText from "lucide-react/dist/esm/icons/file-text.js";
import Landmark from "lucide-react/dist/esm/icons/landmark.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Mail from "lucide-react/dist/esm/icons/mail.js";
import Radio from "lucide-react/dist/esm/icons/radio.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Send from "lucide-react/dist/esm/icons/send.js";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.js";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { PortfolioEChart } from "../portfolio/PortfolioEChart.jsx";
import { MarkdownText } from "../utils/MarkdownText.jsx";
import { useDailyIntelligenceController } from "./useDailyIntelligenceController.js";
import "./daily-intelligence.css";

const statusLabels = {
  sufficient: "정상",
  complete: "정상",
  insufficient: "자료 부족",
  stale: "지연",
  unknown: "확인 필요",
  risk_on: "위험선호",
  mild_risk_on: "완만한 위험선호",
  neutral: "중립",
  mixed: "혼재",
  selective_rotation: "선별적 순환매",
  mild_risk_off: "완만한 위험회피",
  risk_off: "위험회피",
  ready: "정상",
  partial: "일부 수집",
  blocked: "수집 차단",
  broadening: "확산",
  narrowing: "축소",
  mixed_rotation: "혼합 순환매",
};

const stylePairLabels = {
  growth_vs_value: "성장주 / 가치주",
  large_vs_small: "대형주 / 소형주",
  large_vs_mid: "대형주 / 중형주",
  momentum_vs_low_volatility: "모멘텀 / 저변동성",
  equal_weight_vs_cap_weight: "동일가중 / 시총가중",
};

const sectorLabels = {
  XLC: "커뮤니케이션",
  XLY: "경기소비재",
  XLP: "필수소비재",
  XLE: "에너지",
  XLF: "금융",
  XLV: "헬스케어",
  XLI: "산업재",
  XLB: "소재",
  XLRE: "부동산",
  XLK: "기술",
  XLU: "유틸리티",
};

const eventTypeLabels = {
  earnings_guidance: "실적·가이던스",
  regulation_policy: "정책·규제",
  macro_policy: "거시·정책",
  disclosure: "기업공시",
  other: "기타",
};

const extractionStatusLabels = {
  complete: "본문 추출 완료",
  completed: "본문 추출 완료",
  not_run: "본문 추출 대기",
  not_available: "본문 미확보",
  failed: "본문 추출 실패",
};

const researchStanceLabels = {
  positive: "긍정",
  neutral: "중립",
  cautious: "경계",
  negative: "부정",
  not_stated: "명시적 의견 없음",
};

const sectorSignalLabels = {
  positive: "긍정 의견 우세",
  neutral: "중립 의견",
  cautious: "경계 의견 우세",
  mixed: "의견 혼재",
  evidence_only: "방향성 미제시",
};

const valuationMetricLabels = {
  forward_pe: "선행 P/E",
  ev_to_ebitda: "EV/EBITDA",
};

const estimateMetricLabels = {
  diluted_eps: "EPS",
  eps: "EPS",
  revenue: "매출",
};

const valuationRelativeLabels = {
  discount_to_watchlist_peer_median: "비교기업 중앙값 하회",
  premium_to_watchlist_peer_median: "비교기업 중앙값 상회",
  near_watchlist_peer_median: "비교기업 중앙값 부근",
  insufficient_usable_peers: "비교기업 부족",
};

const researchAnalysisStatusLabels = {
  complete: "분석 완료",
  partial: "일부 분석",
  no_eligible_reports: "분석 대상 없음",
  not_available: "분석 대기",
};

const researchMarketScopeLabels = {
  KR: "국내",
  US: "미국",
  EU: "유럽",
  JP: "일본",
  GLOBAL: "글로벌",
  UNKNOWN: "미분류",
};

function formatGeneratedAt(value) {
  if (!value) return "미확인";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function StatusPill({ status = "unknown" }) {
  const normalized = String(status || "unknown").toLowerCase();
  return (
    <span className={`daily-intelligence-status is-${normalized}`}>
      {statusLabels[normalized] || normalized}
    </span>
  );
}

function EmptyConnection({ connection, onReload, busy }) {
  const configured = connection?.configured === true;
  return (
    <div className="daily-intelligence-empty">
      <Database size={30} strokeWidth={1.8} />
      <h1>{configured ? "연결된 리포트를 찾지 못했습니다" : "PB 리포트 엔진 연결이 필요합니다"}</h1>
      <p>
        {configured
          ? "지정 폴더에 완성된 reader_report.json이 있는지 확인하세요."
          : "PB_DAILY_INTELLIGENCE_DIR에 기존 프로젝트의 workspace 폴더를 지정하면 이 화면에 최신 결과가 표시됩니다."}
      </p>
      <button type="button" onClick={onReload} disabled={busy}>
        <RefreshCw size={16} /> 다시 확인
      </button>
    </div>
  );
}

function MetricCard({ label, value, detail, tone = "neutral", icon: Icon }) {
  return (
    <article className={`daily-intelligence-metric is-${tone}`}>
      <span className="daily-intelligence-metric-icon"><Icon size={18} /></span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function DailyWorkspaceShortcuts({
  candidateCount,
  thesisAlertCount,
  onOpenMarketSectors,
  onOpenCompanyResearch,
  onOpenThesisJournal,
  onOpenInstitutionalPortfolio,
}) {
  const items = [
    {
      eyebrow: "MARKET DESK",
      label: "시장·섹터",
      detail: "체제·리더십·한국시장 연결",
      meta: "시장 판단 근거 보기",
      icon: Landmark,
      onClick: onOpenMarketSectors,
    },
    {
      eyebrow: "COMPANY DESK",
      label: "기업 리서치",
      detail: "후보 비교·실적·추정치 변화",
      meta: `분석 후보 ${candidateCount || 0}개`,
      icon: FileText,
      onClick: onOpenCompanyResearch,
    },
    {
      eyebrow: "DECISION JOURNAL",
      label: "투자 가설·복기",
      detail: "가설 원장·반증·판단 습관",
      meta: `최근 변화 ${thesisAlertCount || 0}건`,
      icon: Database,
      onClick: onOpenThesisJournal,
    },
    {
      eyebrow: "OWNERSHIP RADAR",
      label: "기관 포트폴리오",
      detail: "13F 분기 보유와 섹터 흐름",
      meta: "기관별 누적 변화 보기",
      icon: BriefcaseBusiness,
      onClick: onOpenInstitutionalPortfolio,
    },
  ];

  return (
    <nav className="daily-intelligence-workspace-shortcuts" aria-label="전문 분석 화면 바로가기">
      <div className="daily-intelligence-workspace-shortcuts-heading">
        <div>
          <span>ANALYSIS DESKS</span>
          <strong>필요한 분석으로 바로 이동</strong>
        </div>
        <small>Daily는 결론, 전문 화면은 근거와 복기</small>
      </div>
      <div className="daily-intelligence-workspace-shortcuts-grid">
        {items.map(({ eyebrow, label, detail, meta, icon: Icon, onClick }) => (
          <button type="button" key={label} onClick={onClick}>
            <span className="daily-intelligence-workspace-shortcut-icon"><Icon size={18} /></span>
            <span className="daily-intelligence-workspace-shortcut-copy">
              <small>{eyebrow}</small>
              <strong>{label}</strong>
              <span>{detail}</span>
              <em>{meta}</em>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    </nav>
  );
}

function signed(value, digits = 2, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}${suffix}`;
}

function multiple(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}배` : "—";
}

function metricTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number >= 0 ? "is-positive" : "is-negative";
}

function Scoreboard({ scoreboard }) {
  if (!scoreboard?.cards?.length) {
    return <p className="daily-intelligence-muted">시장 스코어보드 데이터가 없습니다.</p>;
  }
  const maxRelative = Math.max(
    1,
    ...scoreboard.relativePerformance.map((item) => Math.abs(Number(item.value || 0)))
  );
  return (
    <>
      <div className="daily-intelligence-scoreboard-grid">
        {scoreboard.cards.map((card) => (
          <article key={card.id} className={`daily-intelligence-score-card is-${card.tone}`}>
            <span>{card.label}</span>
            <strong>{signed(card.value, 2, card.unit)}</strong>
            <small>
              {card.change === null ? `기준 ${card.asOf}` : `변화 ${signed(card.change, 2, card.unit)} · ${card.asOf}`}
            </small>
          </article>
        ))}
      </div>
      <div className="daily-intelligence-relative-bars">
        <div>
          <strong>5일 상대성과</strong>
          <span>SPY 대비 %p</span>
        </div>
        {scoreboard.relativePerformance.map((item) => {
          const width = Math.max(4, (Math.abs(item.value) / maxRelative) * 100);
          return (
            <div className="daily-intelligence-relative-row" key={item.label}>
              <span>{item.label}</span>
              <div>
                <i
                  className={item.value >= 0 ? "is-positive" : "is-negative"}
                  style={{ width: `${width}%` }}
                />
              </div>
              <strong className={item.value >= 0 ? "is-positive" : "is-negative"}>
                {signed(item.value, 2)}
              </strong>
            </div>
          );
        })}
      </div>
    </>
  );
}

function DecisionGate({ gate }) {
  if (!gate) return null;
  const ready = gate.status === "ready";
  return (
    <section
      className={`daily-intelligence-decision-gate ${ready ? "is-ready" : "is-blocked"}`}
      aria-live="polite"
    >
      <div>
        {ready ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        <span>
          <small>DECISION EVIDENCE GATE</small>
          <strong>{gate.labelKo}</strong>
        </span>
      </div>
      <p>{gate.summary}</p>
      {!ready && gate.blockers?.length ? (
        <ul>
          {gate.blockers.map((blocker) => (
            <li key={blocker.code}>{blocker.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function MarketSectorStockChain({ chain }) {
  if (!chain) return null;
  const blocked = chain.status === "blocked";
  return (
    <section className={`daily-intelligence-panel daily-intelligence-wide daily-intelligence-chain ${blocked ? "is-blocked" : ""}`}>
      <div className="daily-intelligence-panel-title">
        <div>
          <span>MARKET → SECTOR → STOCK</span>
          <h2>오늘의 투자 판단 연결 보드</h2>
        </div>
        <StatusPill status={blocked ? "판단 보류" : chain.status} />
      </div>
      <p className="daily-intelligence-chain-disclaimer">{chain.disclaimer}</p>

      <div className="daily-intelligence-chain-driver">
        <span>1 · 시장 동인</span>
        <h3>{chain.regime.label}</h3>
        <p>{chain.regime.primaryDriver}</p>
        {chain.regime.evidence?.length ? (
          <ul>
            {chain.regime.evidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
        {chain.regime.counterEvidence?.length ? (
          <div className="daily-intelligence-chain-counter">
            <strong>반대 근거</strong>
            {chain.regime.counterEvidence.map((item) => <p key={item}>{item}</p>)}
          </div>
        ) : null}
        <small>무효화 조건 · {chain.regime.invalidationCondition}</small>
      </div>

      {blocked ? (
        <div className="daily-intelligence-chain-blocked">
          데이터 근거 게이트가 해제되기 전에는 수혜·부담 섹터 연결을 제시하지 않습니다.
        </div>
      ) : (
        <div className="daily-intelligence-chain-sectors">
          <div className="daily-intelligence-chain-step">
            <span>2 · 섹터 경로</span>
            <strong>가격 리더십과 내부 확산</strong>
          </div>
          <div className="daily-intelligence-chain-sector-grid">
            {chain.sectors.map((sector) => (
              <article className={`is-${sector.stance}`} key={`${sector.stance}-${sector.ticker}`}>
                <header>
                  <div>
                    <span>{sector.stanceLabel}</span>
                    <h3>{sector.label} <small>{sector.ticker}</small></h3>
                  </div>
                  <strong>{signed(sector.return5d, 2, "%")}</strong>
                </header>
                <p>{sector.reason}</p>
                <ul>
                  {sector.evidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
                {sector.fundamentalGate ? (
                  <div className={`daily-intelligence-fundamental-gate is-${sector.fundamentalGate.status}`}>
                    <header>
                      <span>추정치·밸류에이션 게이트</span>
                      <strong>{sector.fundamentalGate.label}</strong>
                    </header>
                    <p>{sector.fundamentalGate.estimateLabel}</p>
                    <p>{sector.fundamentalGate.valuationLabel}</p>
                    <footer>
                      <span>
                        가이던스 {sector.fundamentalGate.guidanceCount}건 ·
                        리서치 {sector.fundamentalGate.researchReportCount}건
                      </span>
                      <small>기준 {sector.fundamentalGate.asOf || "미확인"}</small>
                    </footer>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="daily-intelligence-chain-candidates">
        <div className="daily-intelligence-chain-step">
          <span>3 · 조사 우선 종목</span>
          <strong>Why now와 첫 기각 조건</strong>
        </div>
        {chain.ideaFunnel ? (
          <>
            <div className="daily-intelligence-idea-funnel-summary">
              <p>
                이상 움직임 {chain.ideaFunnel.inputCount}개 중
                {" "}{chain.ideaFunnel.classifiedCount}개를 근거 수준별로 분류했습니다.
              </p>
              <div>
                {chain.ideaFunnel.stages.map((stage) => (
                  <article className={`is-${stage.id.toLowerCase()}`} key={stage.id}>
                    <span>{stage.label}</span>
                    <strong>{stage.count}</strong>
                    <small>{stage.rule}</small>
                  </article>
                ))}
              </div>
            </div>
          </>
        ) : null}
        {chain.candidates?.length ? (
          <div className="daily-intelligence-chain-candidate-grid">
            {chain.candidates.map((candidate) => (
              <article key={candidate.ticker}>
                <header>
                  <div>
                    <span className={`priority-${candidate.researchPriority.toLowerCase()}`}>
                      연구 {candidate.researchPriority}
                    </span>
                    <h3>{candidate.ticker} <small>{candidate.companyName}</small></h3>
                  </div>
                  <em className={candidate.exposureState === "linked" ? "is-linked" : ""}>
                    {candidate.exposureLabel}
                  </em>
                </header>
                <dl>
                  <div>
                    <dt>연결 섹터</dt>
                    <dd>{candidate.linkedSectorLabel}{candidate.linkedSectorTicker ? ` · ${candidate.linkedSectorTicker}` : ""}</dd>
                  </div>
                  <div>
                    <dt>Why now</dt>
                    <dd>{candidate.whyNow}</dd>
                  </div>
                  <div>
                    <dt>첫 기각 조건</dt>
                    <dd>{candidate.firstRejection}</dd>
                  </div>
                  <div>
                    <dt>승격 조건</dt>
                    <dd>{candidate.promotionCondition}</dd>
                  </div>
                </dl>
                {candidate.valuationScreen?.status === "screening_available" ? (
                  <section className="daily-intelligence-candidate-valuation">
                    <header>
                      <div>
                        <span>밸류에이션 스크리닝</span>
                        <strong>
                          {valuationRelativeLabels[candidate.valuationScreen.relativeStatus]
                            || candidate.valuationScreen.relativeStatus}
                        </strong>
                      </div>
                      <small>
                        비교기업 {candidate.valuationScreen.usablePeerCount}개
                      </small>
                    </header>
                    <div>
                      <p>
                        <span>{valuationMetricLabels[candidate.valuationScreen.primaryMetric]
                          || candidate.valuationScreen.primaryMetric}</span>
                        <strong>{multiple(candidate.valuationScreen.targetValue)}</strong>
                      </p>
                      <p>
                        <span>비교기업 중앙</span>
                        <strong>{multiple(candidate.valuationScreen.peerMedian)}</strong>
                      </p>
                      <p className={metricTone(candidate.valuationScreen.premiumDiscountPct)}>
                        <span>중앙값 괴리</span>
                        <strong>{signed(candidate.valuationScreen.premiumDiscountPct, 1, "%")}</strong>
                      </p>
                    </div>
                    {candidate.estimateRevision?.rows?.length ? (
                      <p className="daily-intelligence-candidate-revision">
                        <b>30일 전망치</b>
                        {candidate.estimateRevision.rows.slice(0, 2).map((row) => (
                          <span key={`${row.metricId}-${row.periodEnd}`}>
                            {estimateMetricLabels[row.metricId] || row.metricId || "지표"}{" "}
                            {signed(row.revisionPct30d, 1, "%")}
                          </span>
                        ))}
                      </p>
                    ) : null}
                    <p className="daily-intelligence-candidate-valuation-limit">
                      현재가와 제3자 연간 EPS 추정치로 산출한 비교 스크리닝입니다.
                      비교기업의 회계기간·사업구조가 달라 적정가치나 목표가격으로 해석하지 않습니다.
                    </p>
                  </section>
                ) : null}
                <footer>
                  <span>
                    {candidate.evidenceSummary} · {candidate.fundamentalGateLabel}
                  </span>
                  <strong>다음 · {candidate.nextWorkflow}</strong>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <p className="daily-intelligence-muted">조사 우선순위를 부여할 종목 후보가 없습니다.</p>
        )}
        {chain.ideaFunnel?.rejectedCandidates?.length ? (
          <div className="daily-intelligence-idea-rejections">
            <strong>제외 후보</strong>
            {chain.ideaFunnel.rejectedCandidates.map((candidate) => (
              <p key={candidate.ticker}>
                <span>{candidate.ticker}</span>
                {candidate.rejectionReason}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

const thesisStateLabels = {
  confirmed: "근거 확인",
  watching: "추적 중",
  candidate: "후보",
  weakened: "약화",
  invalidated: "무효화",
  archived: "보관",
};

const thesisImpactLabels = {
  supports: "가설 지지",
  contradicts: "가설 반박",
  neutral: "중립 근거",
};

const portfolioResponseLabels = {
  maintain: "현재 판단 유지",
  increase_monitoring: "관찰 강화",
  reduce_review: "축소 검토",
  exit_review: "청산 검토",
  no_position_change: "비중 변경 없음",
};

function ThesisOutcomeAlerts({ calibration, compact = false }) {
  const alerts = calibration?.alerts || [];
  if (compact && !alerts.length) return null;
  const outcomeLabels = {
    hit: "가설 확인",
    miss: "가설 반증",
  };
  const previousLabels = {
    hit: "확인",
    miss: "반증",
    inconclusive: "판정 보류",
    pending: "관측 누적",
    not_scoreable: "평가 전",
  };
  return (
    <section className={`daily-intelligence-panel daily-intelligence-wide daily-intelligence-thesis-alerts${compact ? " is-compact" : ""}`}>
      <div className="daily-intelligence-panel-title">
        <div>
          <span>THESIS CHANGE ALERT</span>
          <h2>{compact ? "오늘 바뀐 투자 가설" : "가설 판정 변화 알림"}</h2>
        </div>
        <span className="daily-intelligence-count">{alerts.length}</span>
      </div>
      {alerts.length ? (
        <div className="daily-intelligence-thesis-alert-list">
          {alerts.map((alert) => (
            <article
              key={alert.id}
              className={`is-${alert.status} is-priority-${alert.priorityLevel || "normal"}`}
            >
              <div className="daily-intelligence-thesis-alert-icon">
                {alert.status === "miss"
                  ? <AlertTriangle size={18} />
                  : <CheckCircle2 size={18} />}
              </div>
              <div>
                <header>
                  <strong>{alert.entityId} · {outcomeLabels[alert.status]}</strong>
                  <span>
                    {previousLabels[alert.previousStatus] || alert.previousStatus}
                    {" → "}
                    {outcomeLabels[alert.status]}
                  </span>
                </header>
                <p>{alert.reason}</p>
                {alert.affectedAssets?.length ? (
                  <div className="daily-intelligence-thesis-alert-assets">
                    {alert.affectedAssets.map((asset) => (
                      <span
                        key={`${alert.id}-${asset.ticker}`}
                        className={asset.roles.includes("portfolio") ? "is-portfolio" : "is-watchlist"}
                        title={asset.relationshipLabel}
                      >
                        {asset.roles.includes("portfolio") ? "보유" : "관심"} {asset.ticker}
                        {asset.relationship === "sector" ? ` · ${alert.entityId} 경유` : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
                {!compact ? (
                  <dl>
                    <div>
                      <dt>확인 조건</dt>
                      <dd>{alert.confirmationCondition || "추가 정의 필요"}</dd>
                    </div>
                    <div>
                      <dt>무효화 조건</dt>
                      <dd>{alert.invalidationCondition || "추가 정의 필요"}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
              <time>{alert.at}</time>
            </article>
          ))}
        </div>
      ) : (
        <p className="daily-intelligence-muted">
          오늘 새로 확인되거나 반증된 투자 가설이 없습니다.
        </p>
      )}
      {!compact ? (
        <p className="daily-intelligence-panel-note">
          직전 거래일 판정과 달라진 경우에만 표시합니다. 같은 판정이 유지되는 동안에는
          중복 알림을 만들지 않습니다.
        </p>
      ) : null}
    </section>
  );
}

function DecisionCoach({ memory }) {
  if (!memory) return null;
  const calibration = memory.portfolioResponseCalibration || {};

  const activeGoals = calibration.monthlyReview?.goals?.activeGoals || [];
  const activeRules = calibration.activeRules || [];
  const ruleImpactById = new Map(
    (calibration.ruleImpact || []).map((item) => [item.suggestionId, item]),
  );
  const causeImpactById = new Map(
    (calibration.failureCauseRuleImpact || [])
      .map((item) => [item.suggestionId, item]),
  );
  const reviewRules = activeRules.filter((rule) => (
    ruleImpactById.get(rule.suggestionId)?.status === "declined"
    || causeImpactById.get(rule.suggestionId)?.status === "worsened"
  ));

  return (
    <section className="daily-intelligence-decision-coach" aria-label="Decision Coach">
      <header>
        <div>
          <span>DECISION COACH</span>
          <h2>오늘 지킬 판단 원칙</h2>
        </div>
        <button
          type="button"
          onClick={() => document.getElementById("investment-thesis-memory")
            ?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          상세 기록 <ChevronRight size={15} />
        </button>
      </header>

      <div className="daily-intelligence-decision-coach-grid">
        <article>
          <span>활성 목표</span>
          <strong>{activeGoals.length}개</strong>
          {activeGoals.length ? (
            <>
              <p>{activeGoals[0].summary}</p>
              <small>
                {portfolioResponseLabels[activeGoals[0].action] || activeGoals[0].action}
                {" · "}
                현재 반대 비율 {Number(activeGoals[0].challengeRatePct || 0).toFixed(0)}%
              </small>
            </>
          ) : (
            <p>승인된 월간 개선 목표가 없습니다.</p>
          )}
        </article>

        <article>
          <span>필수 체크리스트</span>
          <strong>{activeRules.length}개</strong>
          {activeRules.length ? (
            <ul>
              {activeRules.slice(0, 2).map((rule) => (
                <li key={rule.suggestionId}>
                  {rule.origin === "failure_cause" && rule.causeLabel
                    ? `[${rule.causeLabel}] `
                    : ""}
                  {rule.proposal}
                </li>
              ))}
            </ul>
          ) : (
            <p>현재 적용 중인 검토 규칙이 없습니다.</p>
          )}
        </article>

        <article className={reviewRules.length ? "is-review" : "is-clear"}>
          <span>재검토 필요</span>
          <strong>{reviewRules.length}개</strong>
          {reviewRules.length ? (
            <>
              <p>{reviewRules[0].proposal}</p>
              <small>
                {causeImpactById.get(reviewRules[0].suggestionId)?.status === "worsened"
                  ? "동일 실패 원인의 재발률이 악화됐습니다."
                  : "규칙 적용 후 판단 부합률이 낮아졌습니다."}
              </small>
            </>
          ) : (
            <p>새 증거로 다시 볼 규칙이 없습니다.</p>
          )}
        </article>
      </div>
    </section>
  );
}

function PortfolioResponseForm({
  activity,
  activeRules = [],
  busy,
  onRecord,
}) {
  const [action, setAction] = React.useState("no_position_change");
  const matchingRules = activeRules.filter((rule) => rule.action === action);
  return (
    <form
      className="daily-intelligence-portfolio-response-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        onRecord?.({
          riskId: activity.riskId,
          reviewReportDate: activity.reportDate,
          portfolioResponseAction: action,
          note: String(formData.get("note") || ""),
          reviewDate: String(formData.get("reviewDate") || ""),
          acknowledgedRuleIds: matchingRules
            .filter((rule) => formData.get(`rule:${rule.suggestionId}`) === "on")
            .map((rule) => rule.suggestionId),
        });
      }}
    >
      <strong>포트폴리오 대응 기록</strong>
      <select
        name="portfolioResponseAction"
        value={action}
        onChange={(event) => setAction(event.target.value)}
        disabled={busy}
        aria-label={`${activity.title || activity.riskId} 포트폴리오 대응`}
      >
        {Object.entries(portfolioResponseLabels).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <input
        type="date"
        name="reviewDate"
        min={activity.reportDate || undefined}
        disabled={busy}
        aria-label={`${activity.title || activity.riskId} 포트폴리오 재검토일`}
      />
      <textarea
        name="note"
        rows="2"
        maxLength="500"
        required
        disabled={busy}
        placeholder="비중을 유지하거나 재검토하는 이유를 기록하세요."
        aria-label={`${activity.title || activity.riskId} 포트폴리오 판단 근거`}
      />
      {matchingRules.length ? (
        <div className="daily-intelligence-portfolio-response-rule-checklist">
          <strong>승인된 검토 규칙 확인</strong>
          {matchingRules.map((rule) => (
            <label key={rule.suggestionId}>
              <input
                type="checkbox"
                name={`rule:${rule.suggestionId}`}
                required
                disabled={busy}
              />
              <span>
                {rule.origin === "failure_cause" && rule.causeLabel
                  ? `[${rule.causeLabel}] `
                  : ""}
                {rule.proposal}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      <button type="submit" disabled={busy}>
        {busy ? "저장 중" : "대응 기록"}
      </button>
      <small>판단 일지만 저장하며 주문이나 보유 비중은 변경하지 않습니다.</small>
    </form>
  );
}

function PortfolioActiveRuleReviewForm({
  rule,
  busy,
  onReview,
}) {
  const [decision, setDecision] = React.useState("maintain");
  return (
    <form
      className="daily-intelligence-portfolio-active-rule-review"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        onReview?.({
          suggestionId: rule.suggestionId,
          managementDecision: decision,
          modifiedProposal: String(formData.get("modifiedProposal") || ""),
        });
      }}
    >
      <strong>효과 악화 · 규칙 재검토 필요</strong>
      <select
        value={decision}
        onChange={(event) => setDecision(event.target.value)}
        disabled={busy}
        aria-label={`${portfolioResponseLabels[rule.action] || rule.action} 규칙 재검토 결정`}
      >
        <option value="maintain">현재 규칙 유지</option>
        <option value="modify">규칙 문구 수정</option>
        <option value="deactivate">규칙 비활성화</option>
      </select>
      {decision === "modify" ? (
        <textarea
          name="modifiedProposal"
          rows="2"
          maxLength="1000"
          required
          defaultValue={rule.proposal}
          disabled={busy}
          aria-label={`${portfolioResponseLabels[rule.action] || rule.action} 수정 규칙`}
        />
      ) : null}
      <button type="submit" disabled={busy}>
        {busy ? "저장 중" : "재검토 결정 저장"}
      </button>
      <small>비활성화해도 과거 판단·검증 기록은 유지됩니다.</small>
    </form>
  );
}

function InvestmentThesisMemory({
  memory,
  busy,
  error,
  onSync,
  onReviewProposal,
  onRecordPortfolioResponse,
  onReviewPortfolioRuleSuggestion,
  onReviewPortfolioActiveRule,
  onReviewMonthlyGoal,
}) {
  const [expandedMonthlyGoalId, setExpandedMonthlyGoalId] = React.useState("");
  if (!memory) return null;
  const records = memory.activeRecords || [];
  const riskReviewProposals = memory.riskReviewProposals || [];
  const riskReviewActivity = memory.riskReviewActivity || [];
  const portfolioResponseCalibration = memory.portfolioResponseCalibration;
  const portfolioMonthlyReview = portfolioResponseCalibration?.monthlyReview;
  const portfolioRuleImpactById = new Map(
    (portfolioResponseCalibration?.ruleImpact || [])
      .map((item) => [item.suggestionId, item]),
  );
  const portfolioFailureCauseImpactById = new Map(
    (portfolioResponseCalibration?.failureCauseRuleImpact || [])
      .map((item) => [item.suggestionId, item]),
  );
  const pendingCount = memory.pendingCandidates?.length || 0;
  const calibration = memory.weeklyCalibration;
  const outcomeById = new Map(
    (calibration?.scored || []).map((item) => [item.continuityId, item]),
  );
  const outcomeLabels = {
    hit: "확인",
    miss: "반증",
    inconclusive: "판정 보류",
    pending: "관측 누적 중",
    not_scoreable: "평가 지표 없음",
  };
  return (
    <section
      id="investment-thesis-memory"
      className="daily-intelligence-panel daily-intelligence-wide daily-intelligence-thesis-memory"
    >
      <div className="daily-intelligence-panel-title">
        <div>
          <span>WORLD MEMORY · THESIS LEDGER</span>
          <h2>투자 가설과 승격·강등 이력</h2>
        </div>
        <button
          type="button"
          className="daily-intelligence-refresh"
          onClick={onSync}
          disabled={busy || !pendingCount}
        >
          <Database size={16} />
          {busy ? "반영 중" : "오늘 가설 반영"}
        </button>
      </div>
      <p className="daily-intelligence-panel-note">
        원문 뉴스와 전체 스캔 후보는 저장하지 않습니다. 화면에 선별된 섹터·종목 가설의
        확인 조건, 무효화 조건, 상태 변화만 로컬 World Memory에 누적합니다.
      </p>
      <div className="daily-intelligence-thesis-memory-meta">
        <span>누적 {memory.recordCount || 0}개</span>
        <span>오늘 반영 후보 {pendingCount}개</span>
        <span>최근 동기화 {memory.lastSyncedReportDate || "아직 없음"}</span>
      </div>
      {riskReviewProposals.length ? (
        <div className="daily-intelligence-thesis-review-proposals">
          <header>
            <div>
              <span>APPROVAL REQUIRED</span>
              <strong>위험 검토 결과의 가설 반영 대기</strong>
            </div>
            <em>{riskReviewProposals.length}건</em>
          </header>
          <p>
            위험 판정만으로 투자 가설을 자동 변경하지 않습니다. 근거와 대상을 확인한 뒤
            승인한 항목만 World Memory에 반영됩니다.
          </p>
          <div>
            {riskReviewProposals.map((proposal) => (
              <article key={proposal.proposalId}>
                <header>
                  <div>
                    <strong>{proposal.title || proposal.riskId}</strong>
                    <small>{proposal.reportDate}</small>
                  </div>
                  <span className={`is-${proposal.relation}`}>
                    {thesisImpactLabels[proposal.relation] || proposal.relation}
                  </span>
                </header>
                <p>{proposal.summary || "저장된 검토 메모가 없습니다."}</p>
                <div className="daily-intelligence-thesis-review-targets">
                  {(proposal.targets || []).map((target) => (
                    <span key={target.continuityId}>
                      {target.entityId} · {thesisStateLabels[target.state] || target.state}
                    </span>
                  ))}
                </div>
                {proposal.evidenceUrl ? (
                  <a href={proposal.evidenceUrl} target="_blank" rel="noreferrer">
                    검토 근거 열기
                  </a>
                ) : null}
                <footer>
                  <button
                    type="button"
                    className="is-reject"
                    disabled={busy}
                    onClick={() => onReviewProposal?.({
                      riskId: proposal.riskId,
                      reviewReportDate: proposal.reportDate,
                      decision: "rejected",
                    })}
                  >
                    제외
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onReviewProposal?.({
                      riskId: proposal.riskId,
                      reviewReportDate: proposal.reportDate,
                      decision: "approved",
                    })}
                  >
                    {busy ? "처리 중" : "가설에 반영"}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {riskReviewActivity.length ? (
        <details className="daily-intelligence-thesis-review-activity">
          <summary>
            <span>
              <strong>최근 가설 반영 결정</strong>
              <small>승인과 제외 기록을 최근 순서로 보관합니다.</small>
            </span>
            <em>{riskReviewActivity.length}건</em>
          </summary>
          <div>
            {riskReviewActivity.map((activity) => (
              <article key={activity.activityId}>
                <div>
                  <strong>{activity.title || activity.riskId}</strong>
                  <span>
                    {(activity.targets || []).map((target) => target.entityId).join(" · ")}
                    {" · "}
                    {thesisImpactLabels[activity.relation] || activity.relation}
                  </span>
                </div>
                <p>{activity.summary || "검토 메모 없음"}</p>
                <footer>
                  <span className={`is-${activity.decision}`}>
                    {activity.decision === "approved" ? "반영 승인" : "반영 제외"}
                  </span>
                  <time>
                    {activity.reviewedAt
                      ? new Date(activity.reviewedAt).toLocaleString("ko-KR")
                      : activity.reportDate}
                  </time>
                  {activity.evidenceUrl ? (
                    <a href={activity.evidenceUrl} target="_blank" rel="noreferrer">
                      근거
                    </a>
                  ) : null}
                </footer>
                {activity.decision === "approved" ? (
                  activity.portfolioResponseAction ? (
                    <div className="daily-intelligence-portfolio-response-record">
                      <header>
                        <strong>
                          포트폴리오 판단 · {
                            portfolioResponseLabels[activity.portfolioResponseAction]
                            || activity.portfolioResponseAction
                          }
                        </strong>
                        <time>
                          {activity.portfolioResponseRecordedAt
                            ? new Date(activity.portfolioResponseRecordedAt)
                              .toLocaleString("ko-KR")
                            : ""}
                        </time>
                      </header>
                      <p>{activity.portfolioResponseNote}</p>
                      {activity.portfolioResponseReviewDate ? (
                        <small>다음 재검토 {activity.portfolioResponseReviewDate}</small>
                      ) : null}
                      {activity.portfolioResponseRuleIds?.length ? (
                        <small>
                          승인된 검토 규칙 {activity.portfolioResponseRuleIds.length}건 확인
                        </small>
                      ) : null}
                      {activity.portfolioResponseEvaluation ? (
                        <div className={`daily-intelligence-portfolio-response-evaluation is-${activity.portfolioResponseEvaluation.status}`}>
                          <strong>{activity.portfolioResponseEvaluation.label}</strong>
                          <span>{activity.portfolioResponseEvaluation.summary}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <PortfolioResponseForm
                      activity={activity}
                      activeRules={portfolioResponseCalibration?.activeRules || []}
                      busy={busy}
                      onRecord={onRecordPortfolioResponse}
                    />
                  )
                ) : null}
              </article>
            ))}
          </div>
        </details>
      ) : null}
      {portfolioResponseCalibration?.totalCount ? (
        <div className="daily-intelligence-portfolio-response-calibration">
          <header>
            <div>
              <span>PORTFOLIO DECISION CALIBRATION</span>
              <strong>대응 판단 누적 검증</strong>
            </div>
            <em className={portfolioResponseCalibration.successRateVisible ? "is-ready" : ""}>
              {portfolioResponseCalibration.successRateVisible
                ? `부합률 ${portfolioResponseCalibration.successRatePct.toFixed(0)}%`
                : `표본 ${portfolioResponseCalibration.decisiveCount}/${portfolioResponseCalibration.minimumDecisiveSample}`}
            </em>
          </header>
          <div className="daily-intelligence-portfolio-response-calibration-kpis">
            <article>
              <span>판단 부합</span>
              <strong>{portfolioResponseCalibration.counts.supported}</strong>
            </article>
            <article>
              <span>판단과 반대</span>
              <strong>{portfolioResponseCalibration.counts.challenged}</strong>
            </article>
            <article>
              <span>미결·관측</span>
              <strong>
                {portfolioResponseCalibration.counts.inconclusive
                  + portfolioResponseCalibration.counts.observed}
              </strong>
            </article>
            <article>
              <span>대기·자료 없음</span>
              <strong>
                {portfolioResponseCalibration.counts.pending
                  + portfolioResponseCalibration.counts.unavailable}
              </strong>
            </article>
          </div>
          {portfolioResponseCalibration.byAction?.length ? (
            <div className="daily-intelligence-portfolio-response-by-action">
              {portfolioResponseCalibration.byAction.map((item) => (
                <span key={item.action}>
                  {portfolioResponseLabels[item.action] || item.action}
                  {" · "}
                  {item.total}건
                  {item.supported || item.challenged
                    ? ` · 부합 ${item.supported} / 반대 ${item.challenged}`
                    : ""}
                </span>
              ))}
            </div>
          ) : null}
          {portfolioResponseCalibration.warning ? (
            <p>{portfolioResponseCalibration.warning}</p>
          ) : null}
          {portfolioResponseCalibration.challenged?.length ? (
            <div className="daily-intelligence-portfolio-response-challenges">
              <strong>판단과 반대로 움직인 사례</strong>
              {portfolioResponseCalibration.challenged.map((item) => (
                <span key={item.activityId}>
                  {item.title || item.riskId} · {item.summary}
                </span>
              ))}
            </div>
          ) : null}
          {portfolioResponseCalibration.ruleSuggestions?.length ? (
            <div className="daily-intelligence-portfolio-rule-suggestions">
              <header>
                <div>
                  <strong>검토 규칙 개선 제안</strong>
                  <small>반대 결과가 반복된 대응만 제안합니다.</small>
                </div>
                <em>승인 전 · 자동 적용 안 됨</em>
              </header>
              {portfolioResponseCalibration.ruleSuggestions.map((suggestion) => (
                <article key={suggestion.suggestionId}>
                  <div>
                    <strong>
                      {portfolioResponseLabels[suggestion.action] || suggestion.action}
                    </strong>
                    <span>
                      {suggestion.origin === "failure_cause" && suggestion.causeLabel
                        ? `반복 원인 ${suggestion.causeLabel} · `
                        : ""}
                      결정 {suggestion.decisiveCount}건 중 반대 {suggestion.challengedCount}건
                      {" · "}
                      반대 비율 {suggestion.challengeRatePct.toFixed(0)}%
                    </span>
                  </div>
                  <p>{suggestion.proposal}</p>
                  {suggestion.evidence?.length ? (
                    <details>
                      <summary>근거 사례 {suggestion.evidence.length}건</summary>
                      {suggestion.evidence.map((evidence) => (
                        <span key={evidence.activityId}>
                          {evidence.reportDate} · {evidence.title} · {evidence.summary}
                        </span>
                      ))}
                    </details>
                  ) : null}
                  <small>
                    승인해도 검토 체크리스트만 활성화되며 주문이나 비중 변경은
                    실행하지 않습니다.
                  </small>
                  {suggestion.status === "pending_approval" ? (
                    <footer>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onReviewPortfolioRuleSuggestion?.({
                          suggestionId: suggestion.suggestionId,
                          decision: "rejected",
                        })}
                      >
                        제외
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onReviewPortfolioRuleSuggestion?.({
                          suggestionId: suggestion.suggestionId,
                          decision: "approved",
                        })}
                      >
                        검토 규칙 승인
                      </button>
                    </footer>
                  ) : (
                    <footer>
                      <em className={`is-${suggestion.status}`}>
                        {suggestion.status === "approved" ? "승인됨" : "제외됨"}
                      </em>
                    </footer>
                  )}
                </article>
              ))}
            </div>
          ) : null}
          {portfolioResponseCalibration.activeRules?.length ? (
            <div className="daily-intelligence-portfolio-active-rules">
              <strong>활성 검토 규칙</strong>
              {portfolioResponseCalibration.activeRules.map((rule) => (
                <article key={rule.suggestionId}>
                  <span>
                    {portfolioResponseLabels[rule.action] || rule.action}
                    {" · "}
                    {rule.origin === "failure_cause" && rule.causeLabel
                      ? `[${rule.causeLabel}] `
                      : ""}
                    {rule.proposal}
                  </span>
                  {(() => {
                    const impact = portfolioRuleImpactById.get(rule.suggestionId);
                    if (!impact) return null;
                    return (
                      <div className={`is-${impact.status}`}>
                        <strong>
                          {impact.comparisonReady
                            ? `적용 효과 ${impact.deltaPctPoint > 0 ? "+" : ""}${impact.deltaPctPoint.toFixed(1)}%p`
                            : `표본 전 ${impact.before.count}/${impact.minimumSamplePerGroup} · 후 ${impact.after.count}/${impact.minimumSamplePerGroup}`}
                        </strong>
                        <small>
                          {impact.comparisonReady
                            ? `부합률 ${impact.before.successRatePct.toFixed(0)}% → ${impact.after.successRatePct.toFixed(0)}%`
                            : impact.warning}
                        </small>
                      </div>
                    );
                  })()}
                  {rule.origin === "failure_cause" ? (() => {
                    const impact = portfolioFailureCauseImpactById.get(
                      rule.suggestionId,
                    );
                    if (!impact) return null;
                    return (
                      <div className={`daily-intelligence-portfolio-cause-rule-impact is-${impact.status}`}>
                        <strong>
                          {impact.comparisonReady
                            ? `동일 원인 재발 ${impact.recurrenceDeltaPctPoint > 0 ? "+" : ""}${impact.recurrenceDeltaPctPoint.toFixed(1)}%p`
                            : `재발률 표본 전 ${impact.before.count}/${impact.minimumSamplePerGroup} · 후 ${impact.after.count}/${impact.minimumSamplePerGroup}`}
                        </strong>
                        <small>
                          {impact.comparisonReady
                            ? `${impact.causeLabel} ${impact.before.recurrenceRatePct.toFixed(0)}% → ${impact.after.recurrenceRatePct.toFixed(0)}% · ${impact.warning}`
                            : impact.warning}
                        </small>
                      </div>
                    );
                  })() : null}
                  {(
                    portfolioRuleImpactById.get(rule.suggestionId)?.status === "declined"
                    || portfolioFailureCauseImpactById.get(rule.suggestionId)?.status
                      === "worsened"
                  ) ? (
                    <PortfolioActiveRuleReviewForm
                      rule={rule}
                      busy={busy}
                      onReview={onReviewPortfolioActiveRule}
                    />
                  ) : null}
                </article>
              ))}
              <small>검토 체크리스트에만 적용되며 주문이나 비중 변경은 실행하지 않습니다.</small>
            </div>
          ) : null}
        </div>
      ) : null}
      {portfolioMonthlyReview?.totalCount ? (
        <div className="daily-intelligence-portfolio-monthly-review">
          <header>
            <div>
              <span>MONTHLY DECISION REVIEW</span>
              <strong>{portfolioMonthlyReview.month.replace("-", "년 ")}월 판단 회고</strong>
            </div>
            <em className={portfolioMonthlyReview.successRateVisible ? "is-ready" : ""}>
              {portfolioMonthlyReview.successRateVisible
                ? `부합률 ${portfolioMonthlyReview.successRatePct.toFixed(0)}%`
                : `표본 ${portfolioMonthlyReview.decisiveCount}/${portfolioMonthlyReview.minimumRateSample}`}
            </em>
          </header>
          <div className="daily-intelligence-portfolio-monthly-kpis">
            <article>
              <span>대응 기록</span>
              <strong>{portfolioMonthlyReview.totalCount}</strong>
            </article>
            <article>
              <span>부합 / 반대</span>
              <strong>
                {portfolioMonthlyReview.counts.supported}
                {" / "}
                {portfolioMonthlyReview.counts.challenged}
              </strong>
            </article>
            <article>
              <span>규칙 승인·수정</span>
              <strong>
                {portfolioMonthlyReview.ruleActivity.approved}
                {" · "}
                {portfolioMonthlyReview.ruleActivity.modified}
              </strong>
            </article>
            <article>
              <span>활성 / 비활성화</span>
              <strong>
                {portfolioMonthlyReview.ruleActivity.active}
                {" · "}
                {portfolioMonthlyReview.ruleActivity.deactivated}
              </strong>
            </article>
          </div>
          {portfolioMonthlyReview.keepHabits?.length ? (
            <div className="daily-intelligence-portfolio-monthly-habits is-keep">
              <strong>유지할 판단 습관</strong>
              {portfolioMonthlyReview.keepHabits.map((habit) => (
                <span key={habit.action}>
                  {portfolioResponseLabels[habit.action] || habit.action}
                  {" · "}
                  부합률 {habit.successRatePct.toFixed(0)}%
                  {" · "}
                  {habit.summary}
                </span>
              ))}
            </div>
          ) : null}
          {portfolioMonthlyReview.reviewHabits?.length ? (
            <div className="daily-intelligence-portfolio-monthly-habits is-review">
              <strong>재검토할 판단 습관</strong>
              {portfolioMonthlyReview.reviewHabits.map((habit) => (
                <span key={habit.action}>
                  {portfolioResponseLabels[habit.action] || habit.action}
                  {" · "}
                  반대 비율 {habit.challengeRatePct.toFixed(0)}%
                  {" · "}
                  {habit.summary}
                </span>
              ))}
            </div>
          ) : null}
          {portfolioMonthlyReview.goals?.proposals?.length ? (
            <div className="daily-intelligence-portfolio-monthly-goals">
              <strong>다음 달 개선 목표 제안</strong>
              {portfolioMonthlyReview.goals.proposals.map((goal) => (
                <article key={goal.goalId}>
                  <div>
                    <span>
                      {portfolioResponseLabels[goal.action] || goal.action}
                      {" · "}
                      {goal.targetMonth.replace("-", "년 ")}월
                    </span>
                    <p>{goal.summary}</p>
                  </div>
                  {goal.status === "pending_approval" ? (
                    <footer>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onReviewMonthlyGoal?.({
                          goalId: goal.goalId,
                          decision: "rejected",
                        })}
                      >
                        제외
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onReviewMonthlyGoal?.({
                          goalId: goal.goalId,
                          decision: "approved",
                        })}
                      >
                        목표 승인
                      </button>
                    </footer>
                  ) : (
                    <em className={`is-${goal.status}`}>
                      {goal.status === "approved" ? "승인됨" : "제외됨"}
                    </em>
                  )}
                </article>
              ))}
            </div>
          ) : null}
          {portfolioMonthlyReview.goals?.activeGoals?.length ? (
            <div className="daily-intelligence-portfolio-monthly-goal-progress">
              <strong>승인된 개선 목표</strong>
              {portfolioMonthlyReview.goals.alerts?.length ? (
                <div className="daily-intelligence-portfolio-monthly-goal-alerts">
                  {portfolioMonthlyReview.goals.alerts.map((alert) => (
                    <article key={alert.id} className={`is-${alert.alertType}`}>
                      <AlertTriangle size={16} aria-hidden="true" />
                      <div>
                        <span>{alert.title}</span>
                        <p>{alert.summary}</p>
                        <button
                          type="button"
                          onClick={() => setExpandedMonthlyGoalId((current) =>
                            current === alert.goalId ? "" : alert.goalId
                          )}
                        >
                          {expandedMonthlyGoalId === alert.goalId
                            ? "근거 닫기"
                            : "판정 근거 보기"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
              {portfolioMonthlyReview.goals.activeGoals.map((goal) => (
                <article
                  key={goal.goalId}
                  className={
                    expandedMonthlyGoalId === goal.goalId ? "is-expanded" : ""
                  }
                >
                  <div>
                    <button
                      type="button"
                      className="daily-intelligence-portfolio-monthly-goal-toggle"
                      aria-expanded={expandedMonthlyGoalId === goal.goalId}
                      onClick={() => setExpandedMonthlyGoalId((current) =>
                        current === goal.goalId ? "" : goal.goalId
                      )}
                    >
                      {portfolioResponseLabels[goal.action] || goal.action}
                    </button>
                    <em className={`is-${goal.progressStatus}`}>
                      {{
                        scheduled: "시작 전",
                        in_progress: "진행 중",
                        achieved: "달성",
                        missed: "미달",
                      }[goal.progressStatus] || goal.progressStatus}
                    </em>
                  </div>
                  <p>{goal.summary}</p>
                  <small>
                    현재 반대 비율 {goal.challengeRatePct.toFixed(0)}%
                    {" · "}
                    목표 {goal.targetChallengeRatePct.toFixed(0)}% 이하
                    {" · "}
                    표본 {goal.decisiveCount}/{goal.minimumDecisiveSample}
                  </small>
                  {expandedMonthlyGoalId === goal.goalId ? (
                    <div className="daily-intelligence-portfolio-monthly-goal-evidence">
                      <strong>판정 근거 {goal.evidenceCases?.length || 0}건</strong>
                      {goal.failureCauseAnalysis?.challengedCount ? (
                        <div className={`daily-intelligence-portfolio-failure-causes is-${goal.failureCauseAnalysis.status}`}>
                          <header>
                            <strong>반복 실패 원인 후보</strong>
                            <em>
                              반대 사례 {goal.failureCauseAnalysis.challengedCount}건
                            </em>
                          </header>
                          {goal.failureCauseAnalysis.primaryCause ? (
                            <p>
                              가장 많이 반복된 단서:{" "}
                              <strong>{goal.failureCauseAnalysis.primaryCause.label}</strong>
                              {" · "}
                              {goal.failureCauseAnalysis.primaryCause.count}건
                            </p>
                          ) : null}
                          {goal.failureCauseAnalysis.categories?.length ? (
                            <div>
                              {goal.failureCauseAnalysis.categories.map((cause) => (
                                <span
                                  key={cause.id}
                                  className={cause.repeated ? "is-repeated" : ""}
                                >
                                  {cause.label} {cause.count}건
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <small>{goal.failureCauseAnalysis.warning}</small>
                        </div>
                      ) : null}
                      {goal.evidenceCases?.length ? (
                        goal.evidenceCases.map((evidence) => (
                          <article
                            key={evidence.activityId || `${evidence.reportDate}:${evidence.riskId}`}
                            className={`is-${evidence.status}`}
                          >
                            <header>
                              <span>{evidence.reportDate}</span>
                              <em>{evidence.label || (
                                evidence.status === "supported"
                                  ? "판단 부합"
                                  : "판단과 반대"
                              )}</em>
                            </header>
                            <strong>{evidence.title}</strong>
                            {evidence.targets?.length ? (
                              <small>{evidence.targets.join(" · ")}</small>
                            ) : null}
                            <p>{evidence.evaluationSummary || evidence.note || "세부 근거 없음"}</p>
                            {evidence.evidenceUrl ? (
                              <a
                                href={evidence.evidenceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                원문 근거
                              </a>
                            ) : null}
                          </article>
                        ))
                      ) : (
                        <p>아직 판정에 포함된 결정 사례가 없습니다.</p>
                      )}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
          {portfolioMonthlyReview.warning ? (
            <p>{portfolioMonthlyReview.warning}</p>
          ) : null}
        </div>
      ) : null}
      {calibration ? (
        <div className="daily-intelligence-calibration">
          <header>
            <div>
              <span>7-DAY CALIBRATION</span>
              <strong>{calibration.windowStart} ~ {calibration.asOfDate}</strong>
            </div>
            <em className={calibration.successRateVisible ? "is-ready" : ""}>
              {calibration.successRateVisible
                ? `적중률 ${calibration.successRatePct.toFixed(0)}%`
                : `최소 표본 ${calibration.resolvedCount}/${calibration.minimumResolvedSample}`}
            </em>
          </header>
          <div className="daily-intelligence-calibration-kpis">
            <article>
              <span>최근 가설</span>
              <strong>{calibration.recentThesisCount}</strong>
            </article>
            <article>
              <span>적중 / 실패</span>
              <strong>{calibration.counts.hit} / {calibration.counts.miss}</strong>
            </article>
            <article>
              <span>보류</span>
              <strong>{calibration.counts.pending + calibration.counts.inconclusive}</strong>
            </article>
            <article>
              <span>비점수 대상</span>
              <strong>{calibration.counts.not_scoreable}</strong>
            </article>
          </div>
          {calibration.warnings?.length ? (
            <ul>
              {calibration.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
          {calibration.transitions?.length ? (
            <div className="daily-intelligence-calibration-transitions">
              <strong>이번 주 승격·강등</strong>
              {calibration.transitions.slice(0, 4).map((transition) => (
                <p key={`${transition.continuityId}-${transition.at}`}>
                  <span>{transition.entityId}</span>
                  {thesisStateLabels[transition.fromState] || transition.fromState}
                  {" → "}
                  {thesisStateLabels[transition.toState] || transition.toState}
                  <small>{transition.at}</small>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="daily-intelligence-research-date-error">{error}</p> : null}
      {!memory.available ? (
        <p className="daily-intelligence-muted">{memory.error}</p>
      ) : records.length ? (
        <div className="daily-intelligence-thesis-memory-grid">
          {records.map((record) => {
            const latestTransition = record.history?.[record.history.length - 1];
            const latestOutcome = outcomeById.get(record.continuityId);
            const latestReviewEvidence = record.reviewEvidence?.[
              record.reviewEvidence.length - 1
            ];
            return (
              <article key={record.continuityId}>
                <header>
                  <div>
                    <span>{record.kind === "sector" ? "SECTOR" : "STOCK"}</span>
                    <h3>{record.entityId} <small>{record.sectorLabel}</small></h3>
                  </div>
                  <strong className={`is-${record.state}`}>
                    {thesisStateLabels[record.state] || record.stateLabel}
                  </strong>
                </header>
                <p>{record.thesis}</p>
                {latestOutcome ? (
                  <div className={`daily-intelligence-thesis-outcome is-${latestOutcome.status}`}>
                    <strong>{outcomeLabels[latestOutcome.status] || latestOutcome.status}</strong>
                    <span>{latestOutcome.reason}</span>
                  </div>
                ) : null}
                {latestReviewEvidence ? (
                  <div className={`daily-intelligence-thesis-linked-evidence is-${latestReviewEvidence.relation}`}>
                    <header>
                      <strong>
                        위험 검토 · {thesisImpactLabels[latestReviewEvidence.relation]
                          || latestReviewEvidence.relation}
                      </strong>
                      <time>{latestReviewEvidence.reportDate}</time>
                    </header>
                    <p>{latestReviewEvidence.summary}</p>
                    {latestReviewEvidence.url ? (
                      <a href={latestReviewEvidence.url} target="_blank" rel="noreferrer">
                        반영 근거 열기
                      </a>
                    ) : null}
                  </div>
                ) : null}
                <dl>
                  <div>
                    <dt>확인 조건</dt>
                    <dd>{record.confirmationCondition || "추가 정의 필요"}</dd>
                  </div>
                  <div>
                    <dt>무효화 조건</dt>
                    <dd>{record.invalidationCondition || "추가 정의 필요"}</dd>
                  </div>
                </dl>
                <footer>
                  <span>최초 {record.firstSeenAt} · 관측 {record.observationCount}회</span>
                  <small>
                    {latestTransition
                      ? `${latestTransition.at} · ${thesisStateLabels[latestTransition.toState] || latestTransition.toState}`
                      : "상태 변화 없음"}
                  </small>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="daily-intelligence-muted">
          아직 누적된 가설이 없습니다. 판단 근거 게이트를 통과한 날의 선별 가설만 반영됩니다.
        </p>
      )}
    </section>
  );
}

function SectorLeadership({ marketInternals }) {
  if (!marketInternals) {
    return <p className="daily-intelligence-muted">섹터 리더십 데이터가 없습니다.</p>;
  }
  const constituent = marketInternals.constituentBreadth;
  const sectorBreadth = marketInternals.sectorBreadth;
  const localAlpacaMissing =
    marketInternals.provider?.alpacaConfigurationStatus === "missing_credentials"
    || constituent?.dataGaps?.some((gap) => /Alpaca credentials/i.test(gap));
  const breadthCards = constituent ? [
    ["상승 종목", constituent.advancePct, "%"],
    ["상승 거래량", constituent.upVolumePct, "%"],
    ["50일선 상회", constituent.above50dPct, "%"],
    ["200일선 상회", constituent.above200dPct, "%"],
  ].filter(([, value]) => value !== null) : [];
  const returnRows = new Map();
  ["1d", "5d", "20d"].forEach((period) => {
    (marketInternals.sectors[period] || []).forEach((sector) => {
      const row = returnRows.get(sector.ticker) || {
        ticker: sector.ticker,
        sector: sector.sector,
      };
      row[period] = sector.returnPct;
      returnRows.set(sector.ticker, row);
    });
  });
  const breadthByTicker = new Map(
    (sectorBreadth?.sectors || []).map((row) => [row.ticker, row])
  );
  const sectorRows = [...returnRows.values()]
    .map((row) => ({ ...row, breadth: breadthByTicker.get(row.ticker) || null }))
    .sort((first, second) => Number(second["5d"] || 0) - Number(first["5d"] || 0));
  return (
    <>
      <div className="daily-intelligence-coverage">
        <span>시장 데이터 커버리지</span>
        <strong>{marketInternals.coverage.available}/{marketInternals.coverage.required}</strong>
        <div>
          <i
            style={{
              width: `${marketInternals.coverage.required
                ? (marketInternals.coverage.available / marketInternals.coverage.required) * 100
                : 0}%`,
            }}
          />
        </div>
      </div>
      {localAlpacaMissing ? (
        <p className="daily-intelligence-inline-warning">
          localhost의 전체 미국시장 수집이 차단됐습니다. 로컬 리포트 엔진에
          ALPACA_API_KEY와 ALPACA_SECRET_KEY 또는 APCA_API_KEY_ID와
          APCA_API_SECRET_KEY가 필요합니다. GitHub Actions Secrets는 이 서버에
          자동 전달되지 않습니다.
        </p>
      ) : null}
      {constituent ? (
        <div className="daily-intelligence-constituent-breadth">
          <div className="daily-intelligence-constituent-heading">
            <div>
              <span>실제 구성종목 브레드스</span>
              <strong>
                {constituent.membershipScope === "fund_holdings_proxy"
                  ? "SPY 보유종목 프록시"
                  : "S&P 500 구성종목"}
              </strong>
            </div>
            <StatusPill status={constituent.status} />
          </div>
          {breadthCards.length ? (
            <div className="daily-intelligence-constituent-grid">
              {breadthCards.map(([label, value, suffix]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{Number(value).toFixed(1)}{suffix}</strong>
                </article>
              ))}
              <article>
                <span>52주 신고가 / 신저가</span>
                <strong>
                  {constituent.newHighs ?? "-"} / {constituent.newLows ?? "-"}
                </strong>
              </article>
            </div>
          ) : (
            <p className="daily-intelligence-inline-warning">
              구성종목 유니버스는 준비됐지만 일봉 가격 수집이 아직 완료되지 않았습니다.
            </p>
          )}
          <small>
            가격 커버리지 {constituent.coveragePct?.toFixed(1) || "0.0"}%
            {constituent.asOf ? ` · 기준 ${constituent.asOf}` : ""}
          </small>
        </div>
      ) : null}
      {marketInternals.stylePairs?.length ? (
        <div className="daily-intelligence-style-matrix">
          <div className="daily-intelligence-subsection-heading">
            <div>
              <span>STYLE MATRIX</span>
              <strong>스타일 상대강도</strong>
            </div>
            <small>각 행 첫 번째 ETF의 두 번째 ETF 대비 격차</small>
          </div>
          <div className="daily-intelligence-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>스타일</th>
                  <th>5일 우위</th>
                  <th>1일</th>
                  <th>5일</th>
                  <th>20일</th>
                </tr>
              </thead>
              <tbody>
                {marketInternals.stylePairs.map((pair) => (
                  <tr key={pair.id}>
                    <th>
                      <strong>{stylePairLabels[pair.id] || pair.id}</strong>
                      <small>{pair.firstTicker} / {pair.secondTicker}</small>
                    </th>
                    <td>{pair.leader5d === "tie" ? "보합" : pair.leader5d}</td>
                    <td className={metricTone(pair.relative1d)}>
                      {signed(pair.relative1d, 2, "%p")}
                    </td>
                    <td className={metricTone(pair.relative5d)}>
                      {signed(pair.relative5d, 2, "%p")}
                    </td>
                    <td className={metricTone(pair.relative20d)}>
                      {signed(pair.relative20d, 2, "%p")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="daily-intelligence-sector-matrix">
        <div className="daily-intelligence-subsection-heading">
          <div>
            <span>SECTOR PRICE + INTERNAL BREADTH</span>
            <strong>11개 섹터 가격과 내부 확산</strong>
          </div>
          <small>
            내부 브레드스 {sectorBreadth?.readyCount || 0}/
            {sectorBreadth?.requiredCount || 11}
          </small>
        </div>
        <div className="daily-intelligence-table-scroll">
          <table>
            <thead>
              <tr>
                <th>섹터</th>
                <th>1일</th>
                <th>5일</th>
                <th>20일</th>
                <th>상승 종목</th>
                <th>50일선</th>
                <th>200일선</th>
              </tr>
            </thead>
            <tbody>
              {sectorRows.map((row) => (
                <tr key={row.ticker}>
                  <th>
                    <strong>{row.ticker}</strong>
                    <small>{sectorLabels[row.ticker] || row.sector}</small>
                  </th>
                  <td className={metricTone(row["1d"])}>
                    {signed(row["1d"], 2, "%")}
                  </td>
                  <td className={metricTone(row["5d"])}>
                    {signed(row["5d"], 2, "%")}
                  </td>
                  <td className={metricTone(row["20d"])}>
                    {signed(row["20d"], 2, "%")}
                  </td>
                  <td>{signed(row.breadth?.advancePct, 1, "%")}</td>
                  <td>{signed(row.breadth?.above50dPct, 1, "%")}</td>
                  <td>{signed(row.breadth?.above200dPct, 1, "%")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!sectorBreadth?.sectors?.length ? (
          <p className="daily-intelligence-inline-warning">
            섹터 ETF 가격은 표시되지만 구성종목 내부 브레드스는 아직 수집 대기입니다.
          </p>
        ) : null}
      </div>
      {marketInternals.coverage.missingTickers.length ? (
        <p className="daily-intelligence-inline-warning">
          현재 일부 섹터만 수집됨: 누락 {marketInternals.coverage.missingTickers.join(", ")}
        </p>
      ) : null}
    </>
  );
}

function SectorMetrics({ sectorMetrics }) {
  if (!sectorMetrics?.metrics?.length) {
    return <p className="daily-intelligence-muted">섹터 선행지표가 없습니다.</p>;
  }
  return (
    <div className="daily-intelligence-sector-metrics">
      {sectorMetrics.metrics.map((metric) => (
        <article key={metric.id}>
          <div>
            <span>{metric.sectorId.replaceAll("_", " ")}</span>
            <strong>{metric.label}</strong>
          </div>
          <div className="daily-intelligence-sector-score">
            <strong>{metric.score === null ? "—" : metric.score.toFixed(1)}</strong>
            <span>추세 점수</span>
          </div>
          <dl>
            <div><dt>1기간</dt><dd>{signed(metric.change1, 2, "%")}</dd></div>
            <div><dt>3기간</dt><dd>{signed(metric.change3, 2, "%")}</dd></div>
            <div><dt>12기간</dt><dd>{signed(metric.change12, 2, "%")}</dd></div>
          </dl>
          <p>{metric.limitation}</p>
          {metric.sourceUrl ? (
            <a href={metric.sourceUrl} target="_blank" rel="noreferrer">
              원자료 <ArrowUpRight size={13} />
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function StockCandidates({ stockCandidates }) {
  if (!stockCandidates?.candidates?.length) {
    return <p className="daily-intelligence-muted">분석 기준을 통과한 미국 개별주 후보가 없습니다.</p>;
  }
  const coverage = stockCandidates.universeCoverage || {};
  return (
    <>
      <p className="daily-intelligence-panel-note">
        가격·거래량 {stockCandidates.marketCoveredCount}/{stockCandidates.universeCount}종목 확인 ·
        이상 움직임 {stockCandidates.materialCandidateCount}종목 중 상위 {stockCandidates.candidates.length}개 표시 ·
        심층분석 가능 {stockCandidates.deepAnalysisCount}개
        <br />
        S&amp;P 500 프록시 {coverage.sp500Count || 0}종목 · Nasdaq-100 프록시{" "}
        {coverage.nasdaq100Count || 0}종목
        {!coverage.fullIndexScanReady ? " · Nasdaq-100 구성자료 연결 대기" : ""}
      </p>
      <div className="daily-intelligence-stock-list">
        {stockCandidates.candidates.map((candidate) => (
          <article key={candidate.ticker}>
            <header>
              <div>
                <span>{candidate.ticker}</span>
                <h3>{candidate.companyName}</h3>
              </div>
              <strong>{candidate.score}점</strong>
            </header>
            <div className="daily-intelligence-stock-reaction">
              <div><span>1일</span><strong>{signed(candidate.reaction.return1d, 2, "%")}</strong></div>
              <div><span>5일</span><strong>{signed(candidate.reaction.return5d, 2, "%")}</strong></div>
              <div><span>SPY 대비</span><strong>{signed(candidate.reaction.spyRelative1d, 2, "%p")}</strong></div>
              <div><span>거래량</span><strong>{signed(candidate.reaction.volumeRatio20d, 2, "x")}</strong></div>
            </div>
            <p>
              공식 근거 {candidate.evidence.filter((item) => item.primaryConfirmed).length}건 ·
              확인 사실 {candidate.evidence.reduce((sum, item) => sum + item.factCount, 0)}개
            </p>
            <div className="daily-intelligence-stock-sources">
              {candidate.evidence.map((item, evidenceIndex) => (
                <a
                  key={`${candidate.ticker}-${item.sourceUrl || item.title}-${evidenceIndex}`}
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title} <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

const portfolioEvidenceLabels = {
  primary_verified: "공식 근거 확인",
  unverified: "검증 대기 사건",
  quantitative_only: "정량·일정만 확인",
  no_direct_evidence: "직접 근거 없음",
};

const portfolioRiskReviewStatusLabels = {
  pending: "미검토",
  checked: "확인 완료",
  deferred: "보류",
  resolved: "위험 해소",
};

const portfolioRiskDeferReasonLabels = {
  data_gap: "데이터 부족",
  criteria_unclear: "판단 기준 불명확",
  event_wait: "이벤트 대기",
  other: "기타",
};

const portfolioRiskFollowUpStatusLabels = {
  not_started: "미착수",
  in_progress: "확인 중",
  completed: "완료",
};

function PortfolioRiskNextStep({
  nextStep,
  review,
  busy = false,
  onOpenOperations,
  onUpdateFollowUp,
}) {
  const [evidenceUrl, setEvidenceUrl] = React.useState(review?.followUpEvidenceUrl || "");
  const [evidenceNote, setEvidenceNote] = React.useState(review?.followUpEvidenceNote || "");
  React.useEffect(() => {
    setEvidenceUrl(review?.followUpEvidenceUrl || "");
    setEvidenceNote(review?.followUpEvidenceNote || "");
  }, [
    review?.reportDate,
    review?.riskId,
    review?.followUpEvidenceUrl,
    review?.followUpEvidenceNote,
  ]);
  if (!nextStep?.target) return null;
  const navigate = () => {
    if (nextStep.target === "research-operations") {
      onOpenOperations?.();
      return;
    }
    if (nextStep.targetType === "section") {
      document.getElementById(nextStep.target)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }
    window.location.hash = nextStep.target;
  };
  const updateFollowUp = (followUpStatus) => onUpdateFollowUp?.({
    riskId: review?.riskId,
    reviewReportDate: review?.reportDate,
    followUpStatus,
    evidenceUrl,
    evidenceNote,
  });
  const openNextStep = async () => {
    if (currentStatus === "not_started" && review?.riskId && onUpdateFollowUp) {
      const result = await updateFollowUp("in_progress");
      if (!result) return;
    }
    navigate();
  };
  const currentStatus = review?.followUpStatus || "not_started";
  return (
    <div className="daily-intelligence-portfolio-risk-follow-up">
      <button
        type="button"
        className="daily-intelligence-portfolio-risk-next-step"
        onClick={openNextStep}
        disabled={busy}
      >
        <strong>{nextStep.label}</strong>
        <span>{nextStep.description}</span>
      </button>
      <div className="daily-intelligence-portfolio-risk-follow-up-status" aria-label="후속 작업 상태">
        <strong>후속 작업</strong>
        {Object.entries(portfolioRiskFollowUpStatusLabels).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={currentStatus === value ? "is-active" : ""}
            disabled={busy}
            onClick={() => updateFollowUp(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="daily-intelligence-portfolio-risk-follow-up-evidence">
        <label>
          <span>근거 링크</span>
          <input
            type="url"
            value={evidenceUrl}
            disabled={busy}
            placeholder="공식자료·리서치·캘린더 URL"
            onChange={(event) => setEvidenceUrl(event.target.value)}
          />
        </label>
        <label>
          <span>근거 메모</span>
          <textarea
            rows="2"
            maxLength="500"
            value={evidenceNote}
            disabled={busy}
            placeholder="확인한 수치·문장과 판단 결과"
            onChange={(event) => setEvidenceNote(event.target.value)}
          />
        </label>
        {review?.followUpEvidenceUrl ? (
          <a href={review.followUpEvidenceUrl} target="_blank" rel="noreferrer">
            저장된 근거 열기 <ArrowUpRight size={11} />
          </a>
        ) : null}
        {review?.followUpCompletedAt ? (
          <small>
            완료 근거 저장 {new Date(review.followUpCompletedAt).toLocaleString("ko-KR")}
          </small>
        ) : (
          <small>완료하려면 링크 또는 메모 중 하나를 입력하세요.</small>
        )}
      </div>
    </div>
  );
}

const portfolioRiskDueStateLabels = {
  overdue: "기한 초과",
  due_today: "오늘 재검토",
  upcoming: "예정",
  unscheduled: "기한 미정",
};

function PortfolioRiskFollowUpInbox({
  queue,
  busy = "",
  error = "",
  onOpenOperations,
  onReviewRisk,
  onUpdateFollowUp,
}) {
  if (!queue?.items?.length) return null;
  return (
    <section className="daily-intelligence-portfolio-risk-inbox">
      <header>
        <div>
          <strong>후속 작업 우선순위함</strong>
          <small>최신 위험 기록 기준 · 기한 초과와 미착수 우선</small>
        </div>
        <div>
          <span className={queue.counts?.overdue ? "is-alert" : ""}>
            기한 초과 {queue.counts?.overdue || 0}
          </span>
          <span>미착수 {queue.counts?.notStarted || 0}</span>
          <span>확인 중 {queue.counts?.inProgress || 0}</span>
        </div>
      </header>
      <div className="daily-intelligence-portfolio-risk-inbox-list">
        {queue.items.map((item) => (
          <article
            key={`${item.reportDate}:${item.riskId}`}
            className={`is-${item.dueState} is-${item.followUpStatus}`}
          >
            <div className="daily-intelligence-portfolio-risk-inbox-title">
              <div>
                <strong>{item.title || item.riskId}</strong>
                <span>
                  {portfolioRiskDeferReasonLabels[item.deferReason] || "기타"}
                  {" · "}
                  재검토 {item.reviewDate || "미정"}
                  {item.daysOverdue ? ` · ${item.daysOverdue}일 초과` : ""}
                </span>
              </div>
              <em>{portfolioRiskDueStateLabels[item.dueState] || "확인 필요"}</em>
            </div>
            {item.note ? <p>{item.note}</p> : null}
            <PortfolioRiskNextStep
              nextStep={item.nextStep}
              review={item}
              busy={busy === item.riskId}
              onOpenOperations={onOpenOperations}
              onUpdateFollowUp={onUpdateFollowUp}
            />
            <form
              className="daily-intelligence-portfolio-risk-inbox-decision"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                onReviewRisk?.({
                  riskId: item.riskId,
                  status: String(formData.get("status") || "checked"),
                  note: String(
                    formData.get("note")
                    || item.followUpEvidenceNote
                    || "",
                  ),
                  reviewDate: String(formData.get("reviewDate") || ""),
                  reviewReportDate: item.reportDate,
                  deferReason: String(formData.get("deferReason") || item.deferReason || ""),
                  thesisImpact: String(formData.get("thesisImpact") || "neutral"),
                });
              }}
            >
              <strong>최종 판정</strong>
              <select
                name="status"
                defaultValue="checked"
                aria-label={`${item.title || item.riskId} 최종 판정`}
                disabled={Boolean(busy)}
              >
                <option value="checked">확인 완료</option>
                <option value="resolved">위험 해소</option>
                <option value="deferred">다시 보류</option>
              </select>
              <select
                name="deferReason"
                defaultValue={item.deferReason || "other"}
                aria-label={`${item.title || item.riskId} 보류 원인`}
                disabled={Boolean(busy)}
              >
                {Object.entries(portfolioRiskDeferReasonLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                name="thesisImpact"
                defaultValue={item.thesisImpact || "neutral"}
                aria-label={`${item.title || item.riskId} 투자 가설 영향`}
                disabled={Boolean(busy)}
              >
                {Object.entries(thesisImpactLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input
                type="date"
                name="reviewDate"
                min={queue.asOfDate || undefined}
                defaultValue={
                  item.reviewDate >= queue.asOfDate ? item.reviewDate : ""
                }
                aria-label={`${item.title || item.riskId} 다음 재검토일`}
                disabled={Boolean(busy)}
              />
              <textarea
                name="note"
                rows="2"
                maxLength="500"
                defaultValue={item.followUpEvidenceNote || ""}
                aria-label={`${item.title || item.riskId} 판정 근거`}
                placeholder="확인 결과 또는 다시 보류할 객관적 조건"
                disabled={Boolean(busy)}
              />
              <button type="submit" disabled={Boolean(busy)}>
                {busy === item.riskId
                  ? <LoaderCircle size={12} className="is-spinning" />
                  : null}
                판정 저장
              </button>
            </form>
          </article>
        ))}
      </div>
      {error ? (
        <p className="daily-intelligence-research-date-error">{error}</p>
      ) : null}
    </section>
  );
}

function PortfolioQuickAdd({
  candidates = [],
  busy = "",
  error = "",
  onQuickAddWatchlist,
  onQuickAddPortfolio,
}) {
  const quickCandidates = candidates
    .filter((candidate) =>
      candidate.deepAnalysisEligible
      || ["A", "B"].includes(candidate.researchPriority))
    .slice(0, 5);
  if (!quickCandidates.length) return null;
  return (
    <div className="daily-intelligence-watchlist-quick-add">
      <span>오늘 후보를 관심 또는 실제 보유로 연결</span>
      <div className="daily-intelligence-portfolio-quick-grid">
        {quickCandidates.map((candidate) => (
          <form
            key={candidate.ticker}
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              onQuickAddPortfolio(candidate.ticker, Number(formData.get("weight")));
            }}
          >
            <strong>{candidate.ticker}</strong>
            <button
              type="button"
              onClick={() => onQuickAddWatchlist(candidate.ticker)}
              disabled={Boolean(busy)}
              title={`${candidate.ticker}를 Daily Intelligence 관심종목 그룹에 추가`}
            >
              {busy === `watchlist:${candidate.ticker}`
                ? <LoaderCircle size={13} className="is-spinning" />
                : <BriefcaseBusiness size={13} />}
              관심
            </button>
            <label>
              <input
                type="number"
                name="weight"
                min="0.01"
                max="100"
                step="0.01"
                defaultValue="5"
                aria-label={`${candidate.ticker} 보유 비중`}
                disabled={Boolean(busy)}
              />
              <span>%</span>
            </label>
            <button
              type="submit"
              className="is-portfolio"
              disabled={Boolean(busy)}
              title={`${candidate.ticker}를 입력 비중으로 실제 보유종목에 등록`}
            >
              {busy === `portfolio:${candidate.ticker}`
                ? <LoaderCircle size={13} className="is-spinning" />
                : <BriefcaseBusiness size={13} />}
              보유
            </button>
          </form>
        ))}
      </div>
      <small>
        비중은 포트폴리오 전체 대비 백분율입니다. 같은 종목을 다시 등록하면 비중만 갱신합니다.
      </small>
      {error ? (
        <p className="daily-intelligence-research-date-error">{error}</p>
      ) : null}
    </div>
  );
}

function portfolioRiskTrendOption(trend = {}) {
  const rows = Array.isArray(trend?.rows) ? trend.rows : [];
  return {
    animation: false,
    color: ["#c75b5b", "#d9923b", "#7a6bc2", "#8795a8"],
    tooltip: { trigger: "axis" },
    legend: {
      bottom: 0,
      textStyle: { color: "#65768b", fontSize: 9 },
      data: ["종목 고위험", "섹터 고위험", "가설 충돌", "매핑 대기"],
    },
    grid: { left: 34, right: 12, top: 12, bottom: 38 },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.reportDate.slice(5)),
      axisLabel: { color: "#718198", fontSize: 9 },
      axisLine: { lineStyle: { color: "#d9e2eb" } },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: "#718198", fontSize: 9 },
      splitLine: { lineStyle: { color: "#edf1f5" } },
    },
    series: [
      { name: "종목 고위험", type: "bar", stack: "risk", data: rows.map((row) => row.stockHigh) },
      { name: "섹터 고위험", type: "bar", stack: "risk", data: rows.map((row) => row.sectorHigh) },
      { name: "가설 충돌", type: "bar", stack: "risk", data: rows.map((row) => row.thesisConflicts) },
      { name: "매핑 대기", type: "bar", stack: "risk", data: rows.map((row) => row.unmapped) },
    ],
  };
}

function PortfolioImpact({
  portfolioImpact,
  candidates = [],
  quickAddBusy = "",
  quickAddError = "",
  onQuickAddWatchlist,
  onQuickAddPortfolio,
  onRemovePortfolio,
  riskReviewBusy = "",
  riskReviewError = "",
  onReviewRisk,
  onUpdateFollowUp,
  onOpenOperations,
}) {
  if (!portfolioImpact?.configured) {
    return (
      <div className="daily-intelligence-portfolio-empty">
        <BriefcaseBusiness size={22} />
        <div>
          <strong>연결할 보유·관심종목이 없습니다.</strong>
          <p>
            포트폴리오 캔버스에 비중을 입력하거나 주식현황의 관심종목 그룹에 티커를
            추가하면, 다음 새로고침부터 관련 사건과 실적 일정을 이곳에 연결합니다.
          </p>
          <PortfolioQuickAdd
            candidates={candidates}
            busy={quickAddBusy}
            error={quickAddError}
            onQuickAddWatchlist={onQuickAddWatchlist}
            onQuickAddPortfolio={onQuickAddPortfolio}
          />
        </div>
      </div>
    );
  }
  return (
    <>
      <PortfolioQuickAdd
        candidates={candidates}
        busy={quickAddBusy}
        error={quickAddError}
        onQuickAddWatchlist={onQuickAddWatchlist}
        onQuickAddPortfolio={onQuickAddPortfolio}
      />
      <div className="daily-intelligence-portfolio-summary">
        <span>포트폴리오 {portfolioImpact.portfolioCount}종목</span>
        <span>관심종목 {portfolioImpact.watchlistCount}종목</span>
        <span>오늘 연결 {portfolioImpact.matchedCount}종목</span>
        <span>직접 근거 없음 {portfolioImpact.unmatchedCount}종목</span>
      </div>
      <div className="daily-intelligence-portfolio-weight-summary">
        <div>
          <strong>간편 보유 비중 합계</strong>
          <span>{portfolioImpact.quickPortfolioWeight || 0}% / 100%</span>
        </div>
        <div className="daily-intelligence-portfolio-weight-track">
          <span
            style={{ width: `${Math.min(100, portfolioImpact.quickPortfolioWeight || 0)}%` }}
          />
        </div>
        <small>
          남은 등록 가능 비중 {Math.max(0, 100 - (portfolioImpact.quickPortfolioWeight || 0)).toFixed(2)}%
        </small>
      </div>
      {portfolioImpact.riskReview?.hasWarnings
      || portfolioImpact.riskReview?.history?.trend?.sampleCount ? (
        <div
          id="portfolio-risk-review"
          className="daily-intelligence-portfolio-risk-review"
        >
          <div className="daily-intelligence-portfolio-risk-title">
            <AlertTriangle size={15} />
            <strong>보유 집중도와 현재 시장 가설 점검</strong>
          </div>
          {portfolioImpact.riskReview.history?.comparison ? (
            <div className={`daily-intelligence-portfolio-risk-change is-${
              portfolioImpact.riskReview.history.comparison.direction
            }`}>
              <strong>전일 대비</strong>
              <span>{portfolioImpact.riskReview.history.comparison.summary}</span>
              {portfolioImpact.riskReview.history.comparison.previousDate ? (
                <small>비교 기준 {portfolioImpact.riskReview.history.comparison.previousDate}</small>
              ) : null}
            </div>
          ) : null}
          {portfolioImpact.riskReview.history?.trend ? (
            <div className={`daily-intelligence-portfolio-weekly-review is-${
              portfolioImpact.riskReview.history.trend.status
            }`}>
              <div>
                <span>7일 포트폴리오 위험 리뷰</span>
                <strong>{portfolioImpact.riskReview.history.trend.label}</strong>
                <small>{portfolioImpact.riskReview.history.trend.summary}</small>
              </div>
              {portfolioImpact.riskReview.history.trend.rows?.length ? (
                <PortfolioEChart
                  option={portfolioRiskTrendOption(portfolioImpact.riskReview.history.trend)}
                  className="daily-intelligence-portfolio-risk-chart"
                  ariaLabel="최근 7일 포트폴리오 위험 경고 추이"
                />
              ) : null}
              {portfolioImpact.riskReview.history.trend.drivers?.added?.length
              || portfolioImpact.riskReview.history.trend.drivers?.removed?.length ? (
                <div className="daily-intelligence-portfolio-risk-drivers">
                  {portfolioImpact.riskReview.history.trend.drivers.added?.length ? (
                    <p className="is-added">
                      <strong>새로 발생</strong>
                      <span>
                        {portfolioImpact.riskReview.history.trend.drivers.added
                          .map((item) => `${item.kindLabel} · ${item.value}`)
                          .join(" / ")}
                      </span>
                    </p>
                  ) : null}
                  {portfolioImpact.riskReview.history.trend.drivers.removed?.length ? (
                    <p className="is-removed">
                      <strong>해소</strong>
                      <span>
                        {portfolioImpact.riskReview.history.trend.drivers.removed
                          .map((item) => `${item.kindLabel} · ${item.value}`)
                          .join(" / ")}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {portfolioImpact.riskReview.reviewAnalytics?.sampleCount ? (
            <div className={`daily-intelligence-portfolio-risk-analytics is-${
              portfolioImpact.riskReview.reviewAnalytics.status
            }`}>
              <header>
                <div>
                  <span>30일 위험 검토</span>
                  <strong>{portfolioImpact.riskReview.reviewAnalytics.label}</strong>
                </div>
                <small>
                  {portfolioImpact.riskReview.reviewAnalytics.eligible
                    ? `처리율 ${portfolioImpact.riskReview.reviewAnalytics.completionRate}%`
                    : `기록 ${portfolioImpact.riskReview.reviewAnalytics.sampleCount}건 · 5건부터 처리율 표시`}
                </small>
              </header>
              <div className="daily-intelligence-portfolio-risk-analytics-grid">
                <article>
                  <span>확인 완료</span>
                  <strong>{portfolioImpact.riskReview.reviewAnalytics.counts.checked}</strong>
                </article>
                <article>
                  <span>위험 해소</span>
                  <strong>{portfolioImpact.riskReview.reviewAnalytics.counts.resolved}</strong>
                </article>
                <article>
                  <span>현재 보류</span>
                  <strong>{portfolioImpact.riskReview.reviewAnalytics.counts.deferred}</strong>
                </article>
                <article className={
                  portfolioImpact.riskReview.reviewAnalytics.counts.overdue ? "is-alert" : ""
                }>
                  <span>기한 초과</span>
                  <strong>{portfolioImpact.riskReview.reviewAnalytics.counts.overdue}</strong>
                </article>
              </div>
              {portfolioImpact.riskReview.reviewAnalytics.deferReasons?.some(
                (item) => item.count,
              ) ? (
                <div className="daily-intelligence-portfolio-risk-reasons">
                  <strong>보류 원인</strong>
                  {portfolioImpact.riskReview.reviewAnalytics.deferReasons
                    .filter((item) => item.count)
                    .map((item) => (
                      <span key={item.id}>{item.label} {item.count}건</span>
                    ))}
                </div>
              ) : null}
              {portfolioImpact.riskReview.reviewAnalytics.counts.deferred ? (
                <div className="daily-intelligence-portfolio-risk-reasons">
                  <strong>후속 작업</strong>
                  {Object.entries(portfolioRiskFollowUpStatusLabels).map(([id, label]) => (
                    <span key={id}>
                      {label} {portfolioImpact.riskReview.reviewAnalytics.followUpCounts?.[id] || 0}건
                    </span>
                  ))}
                </div>
              ) : null}
              {portfolioImpact.riskReview.reviewAnalytics.repeatedDeferrals?.length ? (
                <div className="daily-intelligence-portfolio-risk-repeat">
                  <strong>반복 보류</strong>
                  {portfolioImpact.riskReview.reviewAnalytics.repeatedDeferrals.map((item) => (
                    <span key={item.riskId}>
                      {item.title} · {item.count}회 · {item.primaryReasonLabel}
                      · 다음 {item.nextReviewDate || "미정"}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <PortfolioRiskFollowUpInbox
            queue={portfolioImpact.riskReview.followUpQueue}
            busy={riskReviewBusy}
            error={riskReviewError}
            onOpenOperations={onOpenOperations}
            onReviewRisk={onReviewRisk}
            onUpdateFollowUp={onUpdateFollowUp}
          />
          {portfolioImpact.riskReview.actionChecklist?.length ? (
            <div className="daily-intelligence-portfolio-risk-actions">
              <header>
                <div>
                  <strong>원인별 확인·대응 체크리스트</strong>
                  <small>고위험 항목부터 재검토 순서로 정렬</small>
                </div>
                {portfolioImpact.riskReview.reviewSummary ? (
                  <span>
                    완료 {portfolioImpact.riskReview.reviewSummary.completed}
                    /{portfolioImpact.riskReview.reviewSummary.total}
                  </span>
                ) : null}
              </header>
              {portfolioImpact.riskReview.actionChecklist.map((item) => (
                <details
                  key={item.id}
                  className={`is-${item.severity}`}
                  open={item.severity === "high" && item.review?.status !== "resolved"}
                >
                  <summary>
                    <span>{item.title}</span>
                    <small className={`is-${item.review?.status || "pending"}`}>
                      {portfolioRiskReviewStatusLabels[item.review?.status]
                        || (item.severity === "high" ? "우선 확인" : "모니터링")}
                    </small>
                  </summary>
                  <p>{item.cause}</p>
                  <div>
                    <strong>확인할 것</strong>
                    <ul>
                      {item.checks.map((check) => <li key={check}>{check}</li>)}
                    </ul>
                  </div>
                  <div>
                    <strong>검토 행동</strong>
                    <ul>
                      {item.actions.map((action) => <li key={action}>{action}</li>)}
                    </ul>
                  </div>
                  <form
                    className="daily-intelligence-portfolio-risk-review-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const formData = new FormData(event.currentTarget);
                      onReviewRisk({
                        riskId: item.id,
                        status: String(formData.get("status") || "pending"),
                        note: String(formData.get("note") || ""),
                        reviewDate: String(formData.get("reviewDate") || ""),
                        reviewReportDate: item.review?.reportDate || "",
                        deferReason: String(formData.get("deferReason") || ""),
                        thesisImpact: String(formData.get("thesisImpact") || "neutral"),
                      });
                    }}
                  >
                    <label>
                      <span>검토 상태</span>
                      <select
                        name="status"
                        defaultValue={item.review?.status || "pending"}
                        disabled={Boolean(riskReviewBusy)}
                      >
                        {Object.entries(portfolioRiskReviewStatusLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>재검토일</span>
                      <input
                        type="date"
                        name="reviewDate"
                        min={item.review?.reportDate || undefined}
                        defaultValue={item.review?.reviewDate || ""}
                        disabled={Boolean(riskReviewBusy)}
                      />
                    </label>
                    <label>
                      <span>보류 원인</span>
                      <select
                        name="deferReason"
                        defaultValue={item.review?.deferReason || "other"}
                        disabled={Boolean(riskReviewBusy)}
                      >
                        {Object.entries(portfolioRiskDeferReasonLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>투자 가설 영향</span>
                      <select
                        name="thesisImpact"
                        defaultValue={item.review?.thesisImpact || "neutral"}
                        disabled={Boolean(riskReviewBusy)}
                      >
                        {Object.entries(thesisImpactLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="is-note">
                      <span>검토 메모</span>
                      <textarea
                        name="note"
                        rows="2"
                        maxLength="500"
                        defaultValue={item.review?.note || ""}
                        placeholder="확인한 근거, 다시 볼 조건, 검토 기한을 기록"
                        disabled={Boolean(riskReviewBusy)}
                      />
                    </label>
                    <button type="submit" disabled={Boolean(riskReviewBusy)}>
                      {riskReviewBusy === item.id
                        ? <LoaderCircle size={12} className="is-spinning" />
                        : null}
                      저장
                    </button>
                    {item.review?.updatedAt ? (
                      <small>
                        마지막 저장 {new Date(item.review.updatedAt).toLocaleString("ko-KR")}
                      </small>
                    ) : null}
                  </form>
                  <PortfolioRiskNextStep
                    nextStep={item.review?.nextStep}
                    review={item.review}
                    busy={riskReviewBusy === item.id}
                    onOpenOperations={onOpenOperations}
                    onUpdateFollowUp={onUpdateFollowUp}
                  />
                </details>
              ))}
              {riskReviewError ? (
                <p className="daily-intelligence-research-date-error">{riskReviewError}</p>
              ) : null}
            </div>
          ) : null}
          {portfolioImpact.riskReview.stockConcentration?.map((item) => (
            <p key={`stock-${item.ticker}`} className={`is-${item.severity}`}>
              <strong>{item.ticker} 종목 집중</strong>
              <span>간편 보유 비중 {item.weight}% · 기준 25% 이상</span>
            </p>
          ))}
          {portfolioImpact.riskReview.sectorConcentration?.map((item) => (
            <p key={`sector-${item.ticker}`} className={`is-${item.severity}`}>
              <strong>{item.label} 섹터 집중</strong>
              <span>{item.weight}% · {item.tickers.join(", ")} · 기준 40% 이상</span>
            </p>
          ))}
          {portfolioImpact.riskReview.thesisConflicts?.map((item) => (
            <p key={`conflict-${item.ticker}`} className="is-high">
              <strong>{item.ticker} · 현재 {item.sectorLabel} 부담 경로와 충돌</strong>
              <span>{item.reason}</span>
              <small>재확인: {item.confirmationCondition}</small>
            </p>
          ))}
          {portfolioImpact.riskReview.unmapped?.length ? (
            <p className="is-monitor">
              <strong>섹터 확인 필요</strong>
              <span>
                {portfolioImpact.riskReview.unmapped
                  .map((item) => `${item.ticker} ${item.weight}%`)
                  .join(" · ")}
              </span>
            </p>
          ) : null}
          <small className="daily-intelligence-panel-note">
            집중도와 가설 충돌은 자동 매매 신호가 아니라 재검토 우선순위입니다.
          </small>
        </div>
      ) : null}
      <p className="daily-intelligence-panel-note">
        리포트 결론을 종목별 매수·매도 신호로 바꾸지 않고, 관련 사건·가격 이상·실적
        일정과 근거 상태만 연결합니다.
      </p>
      <div className="daily-intelligence-portfolio-list">
        {portfolioImpact.assets.map((asset) => (
          <article
            key={asset.ticker}
            className={`daily-intelligence-portfolio-card is-${asset.attentionLevel}`}
          >
            <header>
              <div>
                <strong>{asset.ticker}</strong>
                <small>
                  {asset.roles.includes("portfolio") ? "보유" : ""}
                  {asset.roles.includes("portfolio") && asset.roles.includes("watchlist") ? " · " : ""}
                  {asset.roles.includes("watchlist") ? "관심" : ""}
                </small>
              </div>
              <span>{portfolioEvidenceLabels[asset.evidenceState] || asset.evidenceState}</span>
            </header>
            {asset.labels?.length ? (
              <p className="daily-intelligence-muted">{asset.labels.join(" · ")}</p>
            ) : null}
            {asset.roles.includes("portfolio") && asset.weights?.length ? (
              <p className="daily-intelligence-portfolio-weight">
                등록 비중 {asset.weights.map((weight) => `${weight}%`).join(" · ")}
              </p>
            ) : null}
            {asset.sources?.includes("quick_portfolio") ? (
              <form
                className="daily-intelligence-portfolio-manage"
                onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  onQuickAddPortfolio(asset.ticker, Number(formData.get("weight")));
                }}
              >
                <label>
                  <span>간편 보유 비중</span>
                  <input
                    type="number"
                    name="weight"
                    min="0.01"
                    max="100"
                    step="0.01"
                    defaultValue={asset.quickWeights?.[0] || 0}
                    aria-label={`${asset.ticker} 간편 보유 비중 수정`}
                    disabled={Boolean(quickAddBusy)}
                  />
                  <em>%</em>
                </label>
                <button type="submit" disabled={Boolean(quickAddBusy)}>
                  {quickAddBusy === `portfolio:${asset.ticker}`
                    ? <LoaderCircle size={13} className="is-spinning" />
                    : null}
                  비중 저장
                </button>
                <button
                  type="button"
                  className="is-remove"
                  disabled={Boolean(quickAddBusy)}
                  onClick={() => onRemovePortfolio(asset.ticker)}
                >
                  {quickAddBusy === `remove:${asset.ticker}`
                    ? <LoaderCircle size={13} className="is-spinning" />
                    : <X size={13} />}
                  삭제
                </button>
              </form>
            ) : null}
            {asset.candidate ? (
              <div className="daily-intelligence-portfolio-signal">
                <strong>가격·거래량 관찰</strong>
                <span>
                  후보점수 {asset.candidate.score}
                  {asset.candidate.reaction?.return1d !== null
                    ? ` · 1일 ${signed(asset.candidate.reaction.return1d, 2, "%")}`
                    : ""}
                </span>
              </div>
            ) : null}
            {asset.earnings ? (
              <div className="daily-intelligence-portfolio-signal">
                <strong>실적 관찰</strong>
                <span>
                  {asset.earnings.companyName || asset.ticker}
                  {asset.earnings.upcomingEvent?.eventDate
                    ? ` · ${asset.earnings.upcomingEvent.eventDate}`
                    : ""}
                </span>
              </div>
            ) : null}
            {asset.relatedEvents?.length ? (
              <div className="daily-intelligence-portfolio-events">
                {asset.relatedEvents.map((event) => (
                  <div key={event.eventId || event.title}>
                    <strong>{event.title}</strong>
                    {event.impact ? <p>{event.impact}</p> : null}
                    {event.confirmationCondition ? (
                      <small>확인: {event.confirmationCondition}</small>
                    ) : null}
                    {event.invalidationCondition ? (
                      <small>무효화: {event.invalidationCondition}</small>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="daily-intelligence-muted">
                오늘 리포트에서 이 종목과 직접 연결되는 검증 사건은 없습니다.
              </p>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function SourceLinks({ sources = [] }) {
  if (!sources.length) return <p className="daily-intelligence-muted">표시할 원자료가 없습니다.</p>;
  return (
    <div className="daily-intelligence-source-list">
      {sources.map((source) => (
        <a key={`${source.id}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">
          <span>
            <strong>{source.title}</strong>
            {source.asOf ? <small>기준 {source.asOf}</small> : null}
          </span>
          <ArrowUpRight size={15} />
        </a>
      ))}
    </div>
  );
}

function ReviewQueue({ items = [] }) {
  if (!items.length) {
    return <p className="daily-intelligence-muted">검증 대기 사건이 없습니다.</p>;
  }
  return (
    <div className="daily-intelligence-review-list">
      {items.map((item) => (
        <article key={item.eventId || item.title}>
          <div className="daily-intelligence-review-heading">
            <span>{eventTypeLabels[item.eventType] || item.eventType}</span>
            <strong>우선순위 {item.priorityScore}</strong>
          </div>
          <h3>{item.title || "제목 없는 사건"}</h3>
          <p>
            {extractionStatusLabels[item.extractionStatus] || item.extractionStatus} · 근거 준비도 {item.evidenceReadinessScore}
          </p>
          {item.sourceUrls[0] ? (
            <a href={item.sourceUrls[0]} target="_blank" rel="noreferrer">
              후보 원문 열기 <ArrowUpRight size={14} />
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function EarningsWatch({ earningsWatch }) {
  const companies = earningsWatch?.companies || [];
  if (!companies.length) {
    return (
      <p className="daily-intelligence-muted">
        미국 개별주 분석 후보가 확정되면 실적 서프라이즈, 회사 가이던스,
        제3자 전망치 변화를 이 영역에 연결합니다.
      </p>
    );
  }
  const revisionLabels = {
    positive_revision: "상향",
    negative_revision: "하향",
    mixed_revision: "혼조",
    insufficient_detail: "자료 부족",
    not_available: "자료 없음",
  };
  return (
    <div className="daily-intelligence-finding-list">
      {companies.map((company) => {
        const latest = company.historicalSurprises?.[0];
        const longTerm = company.longTermAnalysis || {};
        const financial = longTerm.financialSummary || {};
        const framework = longTerm.judgmentFramework || {};
        const decisionRows = [
          ["기업의 질", framework.decisions?.companyQuality],
          ["현재 주식 매력", framework.decisions?.stockAttractiveness],
          ["포트폴리오 적합성", framework.decisions?.portfolioFit],
        ].filter(([, decision]) => decision?.requiredCount);
        const hasLongTerm = Boolean(longTerm.companyQuality?.status);
        return (
          <article key={company.ticker || company.companyName}>
            <h3>{[company.ticker, company.companyName].filter(Boolean).join(" · ")}</h3>
            {company.upcomingEvent?.eventDate ? (
              <p>
                <b>다음 실적일</b> {company.upcomingEvent.eventDate}
                {" · "}
                {company.upcomingEvent.confidence === "confirmed" ? "공식 확인" : "예상 일정"}
              </p>
            ) : null}
            {company.estimateRevision?.rows?.length ? (
              <p>
                <b>제3자 전망치</b>{" "}
                {revisionLabels[company.estimateRevision.revisionDirection] || "자료 부족"}
                {company.estimateRevision.freezeAsOf
                  ? ` · 기준 ${company.estimateRevision.freezeAsOf}`
                  : ""}
              </p>
            ) : null}
            {company.guidance?.length ? (
              <p><b>회사 가이던스</b> {company.guidance.length}개 지표 확인</p>
            ) : null}
            {latest ? (
              <p>
                <b>최근 과거 실적</b>{" "}
                EPS 서프라이즈 {latest.surprisePct == null ? "확인 불가" : `${latest.surprisePct >= 0 ? "+" : ""}${latest.surprisePct.toFixed(2)}%`}
                {latest.reactionPct == null
                  ? ""
                  : ` · 종가 반응 ${latest.reactionPct >= 0 ? "+" : ""}${latest.reactionPct.toFixed(2)}%`}
              </p>
            ) : null}
            {String(company.postResultEstimateRevision?.status || "").startsWith("not_established") ? (
              <p className="daily-intelligence-muted">
                발표 후 동일 기간 갱신 전망치 대기
              </p>
            ) : null}
            {hasLongTerm ? (
              <section className="daily-intelligence-long-term-card">
                <header>
                  <strong>장기투자 점검</strong>
                  <em>{longTerm.action?.grade || "관망"}</em>
                </header>
                <div className="daily-intelligence-long-term-verdicts">
                  <article>
                    <span>기업의 질</span>
                    <strong>{longTerm.companyQuality?.label || "평가 보류"}</strong>
                    <small>{longTerm.companyQuality?.reason}</small>
                  </article>
                  <article>
                    <span>현재 주식 매력</span>
                    <strong>{longTerm.stockAttractiveness?.label || "평가 보류"}</strong>
                    <small>{longTerm.stockAttractiveness?.reason}</small>
                  </article>
                  <article>
                    <span>포트폴리오 적합성</span>
                    <strong>{longTerm.portfolioFit?.label || "평가 보류"}</strong>
                    <small>{longTerm.portfolioFit?.reason}</small>
                  </article>
                </div>
                <dl className="daily-intelligence-long-term-metrics">
                  <div><dt>영업이익 CAGR</dt><dd>{signed(financial.operating_income_cagr_pct, 1, "%")}</dd></div>
                  <div><dt>FCF CAGR</dt><dd>{signed(financial.fcf_cagr_pct, 1, "%")}</dd></div>
                  <div><dt>FCF 전환율</dt><dd>{signed(financial.median_fcf_conversion_pct, 1, "%")}</dd></div>
                  <div><dt>희석주식수 변화</dt><dd>{signed(financial.diluted_share_count_change_pct, 1, "%")}</dd></div>
                </dl>
                {decisionRows.length ? (
                  <section className="daily-intelligence-judgment-policy">
                    <header>
                      <strong>{framework.policyName || "판단 원칙"}</strong>
                      <small>사실 → 계산 → 판단 → 조건부 행동</small>
                    </header>
                    <div>
                      {decisionRows.map(([label, decision]) => (
                        <article key={label}>
                          <h4>
                            {label}
                            <span>{decision.metCount}/{decision.requiredCount}</span>
                          </h4>
                          <ul>
                            {(decision.gates || []).map((gate) => (
                              <li className={gate.status === "met" ? "is-met" : "is-missing"} key={gate.gateId}>
                                <b>{gate.status === "met" ? "확인" : "대기"}</b>
                                <span>{gate.label}</span>
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                    {longTerm.action?.nextRequiredEvidence?.length ? (
                      <p>
                        <b>다음 근거</b> {longTerm.action.nextRequiredEvidence.slice(0, 4).join(" · ")}
                      </p>
                    ) : null}
                  </section>
                ) : null}
                <p className="daily-intelligence-muted">
                  {longTerm.qualityGate?.status === "ready"
                    ? "5개년 핵심 재무 확인"
                    : `장기 데이터 보강: ${(longTerm.qualityGate?.missing || []).join(" · ") || "확인 중"}`}
                  {longTerm.scorecard?.overallScore == null
                    ? ` · 100점 환산 보류 (${longTerm.scorecard?.scoredPoints || 0}/${longTerm.scorecard?.scoredMax || 0}만 검증)`
                    : ` · 기업점수 ${longTerm.scorecard.overallScore}`}
                </p>
              </section>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function formatFilingMetric(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (unit === "shares") {
    return `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 2 }).format(number)}주`;
  }
  if (unit === "USD") {
    return `$${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 2 }).format(number)}`;
  }
  return `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 2 }).format(number)} ${unit || ""}`.trim();
}

function formatFilingChange(value, suffix = "%") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "비교 불가";
  return `${number > 0 ? "+" : ""}${number.toFixed(1)}${suffix}`;
}

function FilingBulletSection({ title, items, emptyText }) {
  return (
    <section>
      <strong>{title}</strong>
      {items?.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{emptyText}</p>}
    </section>
  );
}

function CompanyFilingSummaries({ companyFilings }) {
  const companies = companyFilings?.companies || [];
  if (!companies.length) {
    return (
      <p className="daily-intelligence-muted">
        미국 주목기업이 선정되면 최신 SEC 10-Q·10-K 수치와 사업·위험 기준선을 자동 요약합니다.
      </p>
    );
  }
  const thesisLabels = {
    supports: "가설 지지 후보",
    challenges: "가설 반증 후보",
    mixed: "혼재",
    insufficient_evidence: "판단 보류",
  };
  return (
    <div className="company-filing-summary-list">
      {companies.map((company) => (
        <article key={company.filingKey || `${company.ticker}-${company.filing?.filedDate}`}>
          <header>
            <div>
              <span>{company.filing?.form || "SEC"} · 제출 {company.filing?.filedDate || "날짜 미확인"}</span>
              <h3>{company.ticker} · {company.companyName}</h3>
            </div>
            <em className={`is-${company.analysis?.thesisEffect || "insufficient_evidence"}`}>
              {thesisLabels[company.analysis?.thesisEffect] || "판단 보류"}
            </em>
          </header>
          <p className="company-filing-summary-copy">{company.analysis?.summaryKo}</p>
          {company.metrics?.length ? (
            <dl className="company-filing-metrics">
              {company.metrics.slice(0, 6).map((metric) => (
                <div key={`${metric.metricId}-${metric.periodStart}-${metric.periodEnd}`}>
                  <dt>{metric.labelKo || metric.metricId}</dt>
                  <dd>{formatFilingMetric(metric.value, metric.unit)}</dd>
                  <small>{metric.periodStart ? `${metric.periodStart}~` : ""}{metric.periodEnd}</small>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="company-filing-takeaways">
            {company.analysis?.financialTakeawaysKo?.length ? (
              <section><strong>재무 핵심</strong><ul>{company.analysis.financialTakeawaysKo.map((item) => <li key={item}>{item}</li>)}</ul></section>
            ) : null}
            {company.analysis?.businessTakeawaysKo?.length ? (
              <section><strong>사업 해석</strong><ul>{company.analysis.businessTakeawaysKo.map((item) => <li key={item}>{item}</li>)}</ul></section>
            ) : null}
            {company.analysis?.risksKo?.length ? (
              <section><strong>주요 위험</strong><ul>{company.analysis.risksKo.map((item) => <li key={item}>{item}</li>)}</ul></section>
            ) : null}
          </div>
          <div className="company-filing-detail-sections">
            <section className="company-filing-detail-block">
              <div className="company-filing-detail-heading">
                <span>1</span>
                <div>
                  <strong>주요 재무지표</strong>
                  <small>{company.financialComparison?.calculationBasisKo || "SEC 공시 기준"}</small>
                </div>
              </div>
              {company.financialComparison?.rows?.length ? (
                <div className="company-filing-table-wrap">
                  <table className="company-filing-comparison-table">
                    <thead><tr><th>지표</th><th>최신 기간</th><th>최신값</th><th>전년 동기</th><th>증감률</th></tr></thead>
                    <tbody>
                      {company.financialComparison.rows.map((row) => (
                        <tr key={row.metricId}>
                          <th>{row.labelKo}</th>
                          <td>{row.periodStart ? `${row.periodStart}~` : ""}{row.periodEnd}</td>
                          <td>{formatFilingMetric(row.value, row.unit)}</td>
                          <td>{row.priorValue == null ? "근거 없음" : formatFilingMetric(row.priorValue, row.unit)}</td>
                          <td className={Number(row.changePct) > 0 ? "is-positive" : Number(row.changePct) < 0 ? "is-negative" : ""}>
                            {formatFilingChange(row.changePct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="company-filing-detail-empty">동일 기간 비교 공시값을 수집하는 중입니다.</p>}
              {company.financialComparison?.ratios?.length ? (
                <dl className="company-filing-ratio-list">
                  {company.financialComparison.ratios.map((ratio) => (
                    <div key={ratio.metricId}>
                      <dt>{ratio.labelKo}</dt>
                      <dd>{Number(ratio.value).toFixed(1)}%</dd>
                      <small>{ratio.priorValue == null ? "전년 비교 없음" : `전년 ${Number(ratio.priorValue).toFixed(1)}% · ${formatFilingChange(ratio.changePctPoint, "%p")}`}</small>
                    </div>
                  ))}
                </dl>
              ) : null}
              {company.financialComparison?.unavailableRatios?.length ? (
                <div className="company-filing-unavailable-ratios">
                  {company.financialComparison.unavailableRatios.map((ratio) => (
                    <span key={ratio.metricId} title={ratio.reasonKo}>{ratio.labelKo} 산출 보류</span>
                  ))}
                </div>
              ) : null}
              {company.analysis?.financialChangeReasonsKo?.length ? (
                <ul className="company-filing-change-reasons">
                  {company.analysis.financialChangeReasonsKo.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
              {company.financialComparison?.segmentRows?.length ? (
                <div className="company-filing-segment-table-wrap">
                  <strong>사업부문별 매출·영업이익</strong>
                  <div className="company-filing-table-wrap">
                    <table className="company-filing-comparison-table company-filing-segment-table">
                      <thead><tr><th>구분</th><th>사업부문·제품군</th><th>지표</th><th>최신값</th><th>전년 동기</th><th>증감률</th><th>근거</th></tr></thead>
                      <tbody>
                        {company.financialComparison.segmentRows.map((row) => (
                          <tr key={`${row.breakdownType}-${row.segmentId}-${row.metricId}`}>
                            <td>{row.breakdownType === "reportable_segment" ? "보고부문" : "제품군"}</td>
                            <th>{row.segmentLabel}</th>
                            <td>{row.metricId === "operating_income" ? "영업이익" : "매출"}</td>
                            <td>{formatFilingMetric(row.currentValue, row.unit)}</td>
                            <td>{row.priorValue == null ? "근거 없음" : formatFilingMetric(row.priorValue, row.unit)}</td>
                            <td>{formatFilingChange(row.changePct)}</td>
                            <td>{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">SEC <ArrowUpRight size={11} /></a> : "SEC XBRL"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              <p className="company-filing-segment-note">
                <b>사업부문별</b> {company.financialComparison?.segmentNoteKo || "회사별 확장 공시 표 검증 후 표시합니다."}
              </p>
            </section>

            <section className="company-filing-detail-block">
              <div className="company-filing-detail-heading">
                <span>2</span>
                <div><strong>산업 동향</strong><small>공시 기준선과 검증된 근거만 반영</small></div>
              </div>
              <div className="company-filing-industry-grid">
                <FilingBulletSection title="시장 영향·수급" items={company.analysis?.industryAnalysisKo?.marketDynamicsKo} emptyText="검증된 산업 수급 근거가 아직 없습니다." />
                <FilingBulletSection title="경쟁사 대비 포지셔닝" items={company.analysis?.industryAnalysisKo?.competitivePositioningKo} emptyText="동일 기준 경쟁사 비교가 아직 없습니다." />
                <FilingBulletSection title="향후 1~2년 성장동력" items={[...(company.analysis?.industryAnalysisKo?.growthDriversKo || []), ...(company.analysis?.industryAnalysisKo?.outlook12yKo || [])]} emptyText="회사 공시로 확인할 성장동력과 전망이 부족합니다." />
              </div>
            </section>

            <section className="company-filing-detail-block">
              <div className="company-filing-detail-heading">
                <span>3</span>
                <div><strong>최근 3개월 뉴스 요약</strong><small>전략·투자·리스크 중심 · 기준일 {company.analysisAsOfDate || company.filing?.filedDate || "미확인"}</small></div>
              </div>
              {company.analysis?.recentNewsKo?.length ? (
                <ol className="company-filing-news-list">
                  {company.analysis.recentNewsKo.map((item) => (
                    <li key={`${item.sourceId}-${item.date}`}>
                      <div><time>{item.date}</time><em>{item.category}</em><span>{item.publisher || item.sourceGrade || "확인 출처"}</span></div>
                      <p>{item.summaryKo}</p>
                      {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">출처 보기 <ArrowUpRight size={12} /></a> : null}
                    </li>
                  ))}
                </ol>
              ) : <p className="company-filing-detail-empty">최근 3개월 내 기업과 직접 연결된 검증 뉴스가 없습니다.</p>}
            </section>
          </div>
          <footer>
            <p><b>가설 영향</b> {company.analysis?.thesisEffectReasonKo || "분석 근거 보강 대기"}</p>
            {company.analysis?.monitoringPointsKo?.length ? (
              <p><b>다음 확인</b> {company.analysis.monitoringPointsKo.join(" · ")}</p>
            ) : null}
            <div>
              <span>{company.analysisStatus === "complete" ? "AI 문서 해석 완료" : "공식 수치만 반영"}</span>
              <span>가설 변경은 승인 후 반영</span>
              {company.filing?.sourceUrl ? (
                <a href={company.filing.sourceUrl} target="_blank" rel="noreferrer">
                  SEC 원문 <ArrowUpRight size={12} />
                </a>
              ) : null}
            </div>
          </footer>
        </article>
      ))}
    </div>
  );
}

function OperationsPanel({
  jobStatus,
  jobBusy,
  jobError,
  pendingPlan,
  onPlan,
  onExecute,
  onCancel,
}) {
  const connection = jobStatus?.connection || {};
  const run = jobStatus?.run || {};
  const running = run.status === "running";
  const runLabels = {
    idle: "대기",
    running: "실행 중",
    succeeded: "완료",
    failed: "실패",
  };
  return (
    <section
      id="pipeline-operations"
      className="daily-intelligence-panel daily-intelligence-operations daily-intelligence-wide"
    >
      <div className="daily-intelligence-panel-title">
        <div>
          <span>PIPELINE OPERATIONS</span>
          <h2>리포트 실행 제어</h2>
        </div>
        <span className={`daily-intelligence-run-status is-${run.status || "idle"}`}>
          {runLabels[run.status] || run.status || "대기"}
        </span>
      </div>

      {!connection.available ? (
        <div className="daily-intelligence-operation-notice">
          <AlertTriangle size={18} />
          <div>
            <strong>실행 연결이 준비되지 않았습니다.</strong>
            <p>{connection.reason || "PB 리포트 엔진 경로와 Python 실행 파일을 설정하세요."}</p>
          </div>
        </div>
      ) : (
        <div className="daily-intelligence-operation-actions">
          {(jobStatus?.jobs || [])
            .filter((job) => ![
              "telegram_refresh",
              "telegram_analyze",
              "gmail_refresh",
              "gmail_analyze",
            ].includes(job.id))
            .map((job) => (
            <button
              type="button"
              key={job.id}
              className={job.publish ? "is-publish" : ""}
              onClick={() => onPlan(job.id)}
              disabled={jobBusy || running}
            >
              {job.publish ? <Send size={16} /> : <Play size={16} />}
              <span>
                <strong>{job.label}</strong>
                <small>{job.description}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {jobError ? <p className="daily-intelligence-operation-error">{jobError}</p> : null}

      {pendingPlan && ![
        "telegram_refresh",
        "telegram_analyze",
        "gmail_refresh",
        "gmail_analyze",
      ].includes(pendingPlan.job?.id) ? (
        <div className={`daily-intelligence-confirmation ${pendingPlan.job?.publish ? "is-publish" : ""}`}>
          <div>
            <span>실행 전 확인</span>
            <h3>{pendingPlan.job?.label}</h3>
            <p>{pendingPlan.job?.effect}</p>
            <dl>
              <div><dt>실행</dt><dd>{pendingPlan.commandPreview}</dd></div>
              <div><dt>대상</dt><dd>{pendingPlan.target}</dd></div>
            </dl>
          </div>
          <div className="daily-intelligence-confirmation-actions">
            <button type="button" onClick={onCancel} disabled={jobBusy}>
              <X size={15} /> 취소
            </button>
            <button
              type="button"
              className={pendingPlan.job?.publish ? "is-publish" : ""}
              onClick={onExecute}
              disabled={jobBusy}
            >
              {jobBusy ? <LoaderCircle size={15} className="is-spinning" /> : <Play size={15} />}
              확인 후 실행
            </button>
          </div>
        </div>
      ) : null}

      {run.status && run.status !== "idle" ? (
        <div className="daily-intelligence-run-detail">
          <div>
            <strong>{run.label || "PB 파이프라인"}</strong>
            <span>{run.message || runLabels[run.status]}</span>
          </div>
          {run.thesisSync?.status && run.thesisSync.status !== "idle" ? (
            <div className={`daily-intelligence-thesis-sync is-${run.thesisSync.status}`}>
              <Database size={15} />
              <span>
                <strong>투자 가설 자동 반영</strong>
                <small>{run.thesisSync.message}</small>
              </span>
              {run.thesisSync.status === "succeeded" ? (
                <em>
                  {run.thesisSync.reportDate} · {run.thesisSync.candidateCount}개
                  {run.thesisSync.transitionCount
                    ? ` · 상태 변화 ${run.thesisSync.transitionCount}건`
                    : ""}
                </em>
              ) : null}
            </div>
          ) : null}
          {run.logTail?.length ? (
            <pre>{run.logTail.slice(-12).join("\n")}</pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TelegramSourceMonitor({
  telegramSources,
  jobStatus,
  jobBusy,
  jobError,
  pendingPlan,
  onPlan,
  onExecute,
  onCancel,
}) {
  const [attachmentQueue, setAttachmentQueue] = React.useState(null);
  const [attachmentBusy, setAttachmentBusy] = React.useState(false);
  const [attachmentError, setAttachmentError] = React.useState("");
  const loadAttachmentQueue = React.useCallback(async () => {
    setAttachmentBusy(true);
    setAttachmentError("");
    try {
      const response = await fetch(
        "/api/pb-daily-intelligence/telegram-attachment-approvals",
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setAttachmentQueue(payload);
    } catch (error) {
      setAttachmentError(
        error.message || "Telegram PDF 승인 목록을 불러오지 못했습니다.",
      );
    } finally {
      setAttachmentBusy(false);
    }
  }, []);
  const decideAttachment = React.useCallback(async (attachmentKey, decision) => {
    setAttachmentBusy(true);
    setAttachmentError("");
    try {
      const response = await fetch(
        "/api/pb-daily-intelligence/telegram-attachment-approvals",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachmentKey, decision }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setAttachmentQueue(payload);
    } catch (error) {
      setAttachmentError(
        error.message || "Telegram PDF 승인 결정을 저장하지 못했습니다.",
      );
    } finally {
      setAttachmentBusy(false);
    }
  }, []);
  React.useEffect(() => {
    if (!telegramSources?.configured) return;
    void loadAttachmentQueue();
  }, [
    loadAttachmentQueue,
    telegramSources?.collection?.lastCollectedAt,
    telegramSources?.configured,
  ]);

  if (!telegramSources?.configured) {
    return (
      <section
        id="telegram-intelligence"
        className="daily-intelligence-panel daily-intelligence-wide"
      >
        <div className="daily-intelligence-panel-title">
          <div>
            <span>TELEGRAM INTELLIGENCE</span>
            <h2>텔레그램 정보 채널</h2>
          </div>
          <AlertTriangle size={20} />
        </div>
        <p className="daily-intelligence-muted">
          Telegram 채널 레지스트리를 찾지 못했습니다. PB 리포트 엔진 경로와 telegram_channels.json을 확인하세요.
        </p>
      </section>
    );
  }

  const credentials = telegramSources.credentials || {};
  const collection = telegramSources.collection || {};
  const deduplication = telegramSources.deduplication || {};
  const attachmentItems = [...(attachmentQueue?.items || [])].sort((left, right) => {
    const stateOrder = { pending: 0, approved: 1, processing: 2, ready: 3, excluded: 4 };
    const stateDifference = (stateOrder[left.state] ?? 5) - (stateOrder[right.state] ?? 5);
    if (stateDifference) return stateDifference;
    return Number(right.priority?.score || 0) - Number(left.priority?.score || 0);
  });
  const collectionReady = credentials.ready === true;
  const telegramRun = jobStatus?.run?.jobId === "telegram_refresh"
    ? jobStatus.run
    : null;
  const refreshing = telegramRun?.status === "running";
  const telegramPlanPending = pendingPlan?.job?.id === "telegram_refresh";
  const telegramAnalysisRun = jobStatus?.run?.jobId === "telegram_analyze"
    ? jobStatus.run
    : null;
  const analyzingAttachments = telegramAnalysisRun?.status === "running";
  const telegramAnalysisPlanPending = pendingPlan?.job?.id === "telegram_analyze";
  const approvedAttachmentCount = Number(attachmentQueue?.counts?.approved || 0);
  const collectionLabels = {
    ok: "수집 완료",
    ok_with_filtered: "수집 완료 · 정책 필터 적용",
    skipped_or_notice: "설정 확인",
    not_run: "미실행",
  };
  return (
    <section
      id="telegram-intelligence"
      className="daily-intelligence-panel daily-intelligence-telegram daily-intelligence-wide"
    >
      <div className="daily-intelligence-panel-title">
        <div>
          <span>TELEGRAM INTELLIGENCE</span>
          <h2>PB 텔레그램 정보 채널</h2>
        </div>
        <div className="daily-intelligence-telegram-actions">
          <span className={`daily-intelligence-run-status is-${collectionReady ? "succeeded" : "failed"}`}>
            {collectionReady ? "인증 준비" : "인증 필요"}
          </span>
          <button
            type="button"
            onClick={() => onPlan("telegram_refresh")}
            disabled={!collectionReady || jobBusy || refreshing}
          >
            {refreshing
              ? <LoaderCircle size={15} className="is-spinning" />
              : <RefreshCw size={15} />}
            {refreshing ? "수집 중" : "텔레그램 지금 수집"}
          </button>
        </div>
      </div>

      <div className="daily-intelligence-telegram-summary">
        <article>
          <span>활성 채널</span>
          <strong>{telegramSources.enabledCount}/{telegramSources.channelCount}</strong>
          <small>공개 채널 레지스트리</small>
        </article>
        <article>
          <span>최근 수집</span>
          <strong>{collection.itemCount || 0}건</strong>
          <small>
            {collectionLabels[collection.status] || collection.status}
            {collection.lastCollectedAt
              ? ` · ${formatGeneratedAt(collection.lastCollectedAt)}`
              : ""}
          </small>
        </article>
        <article>
          <span>사건 통합</span>
          <strong>{deduplication.eventClusterCount || 0}건</strong>
          <small>원문 {deduplication.rawPostCount || 0}건에서 통합</small>
        </article>
        <article>
          <span>중복 절감</span>
          <strong>{deduplication.consolidatedPostCount || 0}건</strong>
          <small>동일 사건 반복 제거</small>
        </article>
      </div>

      {!collectionReady ? (
        <div className="daily-intelligence-operation-notice">
          <AlertTriangle size={18} />
          <div>
            <strong>Telegram 사용자 세션 연결이 필요합니다.</strong>
            <p>
              누락: {(credentials.missing || []).join(", ") || "인증 상태 확인 필요"}.
              값은 화면에 표시하거나 저장하지 않습니다.
            </p>
          </div>
        </div>
      ) : (
        <div className="daily-intelligence-telegram-ready">
          <ShieldCheck size={17} />
          <span>API ID·API Hash·사용자 세션이 준비됐습니다. 다음 수집부터 채널 글이 사건 파이프라인에 들어갑니다.</span>
        </div>
      )}

      {telegramPlanPending ? (
        <div className="daily-intelligence-confirmation">
          <div>
            <span>텔레그램 수집 실행 확인</span>
            <h3>{pendingPlan.job?.label}</h3>
            <p>{pendingPlan.job?.effect}</p>
            <dl>
              <div><dt>실행</dt><dd>{pendingPlan.commandPreview}</dd></div>
              <div><dt>외부 발행</dt><dd>없음 · 로컬 화면만 갱신</dd></div>
            </dl>
          </div>
          <div className="daily-intelligence-confirmation-actions">
            <button type="button" onClick={onCancel} disabled={jobBusy}>
              <X size={15} /> 취소
            </button>
            <button type="button" onClick={onExecute} disabled={jobBusy}>
              {jobBusy
                ? <LoaderCircle size={15} className="is-spinning" />
                : <Play size={15} />}
              확인 후 수집
            </button>
          </div>
        </div>
      ) : null}

      {jobError && (telegramPlanPending || telegramRun) ? (
        <p className="daily-intelligence-operation-error">{jobError}</p>
      ) : null}

      {telegramRun && telegramRun.status !== "idle" ? (
        <div className="daily-intelligence-telegram-run-detail">
          <strong>{telegramRun.message || "텔레그램 수집 상태 확인 중"}</strong>
          {telegramRun.finishedAt ? (
            <span>완료 {formatGeneratedAt(telegramRun.finishedAt)}</span>
          ) : null}
        </div>
      ) : null}

      {telegramSources.clusters?.length ? (
        <div className="daily-intelligence-telegram-events">
          <div className="daily-intelligence-telegram-events-title">
            <div>
              <span>DEDUPLICATED EVENTS</span>
              <strong>중복 제거된 최신 사건</strong>
            </div>
            <small>상위 {telegramSources.clusters.length}건</small>
          </div>
          <div className="daily-intelligence-telegram-event-grid">
            {telegramSources.clusters.map((cluster) => (
              <article key={cluster.eventId}>
                <header>
                  <span>{eventTypeLabels[cluster.eventType] || cluster.eventType || "시장 관점"}</span>
                  <strong>{cluster.postCount}개 글 통합</strong>
                </header>
                <h3>{cluster.title || "제목 없는 사건"}</h3>
                <p>
                  {cluster.channels.join(" · ") || "채널 미확인"}
                  {cluster.latestPublishedAt ? ` · ${formatGeneratedAt(cluster.latestPublishedAt)}` : ""}
                </p>
                <div>
                  {cluster.postUrls.map((url, index) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      원문 {index + 1} <ArrowUpRight size={12} />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <p className="daily-intelligence-muted">
          최근 수집 결과에 사건 클러스터가 없습니다. 후보 데이터 수집 후 드라이런 또는 사건 분류를 실행하세요.
        </p>
      )}

      <div className="daily-intelligence-gmail-attachment-approvals">
        <div className="daily-intelligence-subsection-heading">
          <div>
            <span>BROKER PDF INTAKE</span>
            <h3>공식 증권사 채널 PDF 승인 대기</h3>
          </div>
          <div className="daily-intelligence-approval-title-actions">
            <small>
              대기 {attachmentQueue?.counts?.pending || 0} ·
              우선 추천 {attachmentQueue?.recommendations?.high || 0} ·
              승인 {attachmentQueue?.counts?.approved || 0} ·
              처리 {attachmentQueue?.counts?.processing || 0} ·
              완료 {attachmentQueue?.counts?.ready || 0} ·
              제외 {attachmentQueue?.counts?.excluded || 0}
            </small>
            <button
              type="button"
              className="daily-intelligence-approval-text-button"
              onClick={loadAttachmentQueue}
              disabled={attachmentBusy}
            >
              <RefreshCw size={14} className={attachmentBusy ? "is-spinning" : ""} />
              새로고침
            </button>
            <button
              type="button"
              className="daily-intelligence-approval-text-button daily-intelligence-approval-run-button"
              onClick={() => onPlan("telegram_analyze")}
              disabled={
                !approvedAttachmentCount
                || attachmentBusy
                || jobBusy
                || analyzingAttachments
              }
            >
              {analyzingAttachments
                ? <LoaderCircle size={14} className="is-spinning" />
                : <Play size={14} />}
              {analyzingAttachments ? "분석 중" : "승인 PDF 수집·분석"}
            </button>
          </div>
        </div>
        {telegramAnalysisPlanPending ? (
          <div className="daily-intelligence-confirmation">
            <div>
              <span>승인 PDF 분석 실행 확인</span>
              <h3>{pendingPlan.job?.label}</h3>
              <p>{pendingPlan.job?.effect}</p>
              <dl>
                <div><dt>승인 자료</dt><dd>{approvedAttachmentCount}건</dd></div>
                <div><dt>외부 발행</dt><dd>없음 · 로컬 분석 결과만 갱신</dd></div>
              </dl>
            </div>
            <div className="daily-intelligence-confirmation-actions">
              <button type="button" onClick={onCancel} disabled={jobBusy}>
                <X size={15} /> 취소
              </button>
              <button type="button" onClick={onExecute} disabled={jobBusy}>
                {jobBusy
                  ? <LoaderCircle size={15} className="is-spinning" />
                  : <Play size={15} />}
                확인 후 수집·분석
              </button>
            </div>
          </div>
        ) : null}
        {telegramAnalysisRun && telegramAnalysisRun.status !== "idle" ? (
          <div className="daily-intelligence-telegram-run-detail">
            <strong>{telegramAnalysisRun.message || "승인 PDF 분석 상태 확인 중"}</strong>
            {telegramAnalysisRun.finishedAt ? (
              <span>완료 {formatGeneratedAt(telegramAnalysisRun.finishedAt)}</span>
            ) : null}
          </div>
        ) : null}
        {attachmentError ? (
          <p className="daily-intelligence-approval-error">
            <AlertTriangle size={15} /> {attachmentError}
          </p>
        ) : null}
        {attachmentItems.length ? (
          <div className="daily-intelligence-approval-list">
            {attachmentItems.map((item) => (
              <article key={item.attachmentKey}>
                <div>
                  <div className={`daily-intelligence-approval-priority is-${item.priority?.level || "low"}`}>
                    <span>{item.priority?.label || "후순위"}</span>
                    <small>{item.priority?.reason || "미국주식 관련성을 검토하세요."}</small>
                  </div>
                  <span>{item.channelName || `@${item.channelUsername}`} · 공식 채널 PDF</span>
                  <h3>{item.filename}</h3>
                  <small>
                    {item.title || "게시물 제목 없음"} ·
                    {item.size
                      ? ` ${Math.max(1, Math.round(item.size / 1024))}KB`
                      : " 크기 미확인"}
                    {item.postUrl ? (
                      <>
                        {" · "}
                        <a href={item.postUrl} target="_blank" rel="noreferrer">
                          게시물 확인 <ArrowUpRight size={12} />
                        </a>
                      </>
                    ) : null}
                  </small>
                  {item.state === "ready" && item.analysis ? (
                    <div className="daily-intelligence-attachment-analysis-preview">
                      <p>
                        {item.analysis.summary
                          || item.analysis.title
                          || "구조화 분석이 완료되었습니다."}
                      </p>
                      <div>
                        <span>
                          {researchStanceLabels[item.analysis.stance]
                            || item.analysis.stance
                            || "명시적 의견 없음"}
                        </span>
                        {(item.analysis.tickers || []).map((ticker) => (
                          <span key={`ticker-${item.attachmentKey}-${ticker}`}>
                            {ticker}
                          </span>
                        ))}
                        {(item.analysis.sectors || []).map((sector) => (
                          <span key={`sector-${item.attachmentKey}-${sector}`}>
                            {sector}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="daily-intelligence-approval-actions">
                  <span className="daily-intelligence-approval-status">
                    <span>
                      {item.state === "ready"
                        ? "분석 완료"
                        : item.state === "processing"
                          ? "수집 완료·분석 대기"
                          : item.state === "approved"
                            ? "분석 승인"
                            : item.state === "excluded"
                              ? "분석 제외"
                              : "승인 대기"}
                    </span>
                    <small>
                      {item.state === "ready"
                        ? "구조화 분석 결과가 애널리스트 리포트에 반영됨"
                        : item.state === "processing"
                          ? "PDF 수집·OCR 완료, 구조화 분석 결과 대기"
                          : item.state === "approved"
                            ? "다음 Telegram 수집에서 PDF 다운로드·OCR, 이후 드라이런에서 분석 반영"
                            : "승인 전에는 PDF 원문을 다운로드하지 않음"}
                    </small>
                    {item.state === "ready" ? (
                      <a href="#broker-research-analysis">
                        분석 결과 보기 <ArrowUpRight size={12} />
                      </a>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="is-approve"
                    onClick={() => decideAttachment(item.attachmentKey, "approved")}
                    disabled={
                      attachmentBusy
                      || ["approved", "processing", "ready"].includes(item.state)
                    }
                  >
                    <ShieldCheck size={14} /> 분석 승인
                  </button>
                  <button
                    type="button"
                    className="is-exclude"
                    onClick={() => decideAttachment(item.attachmentKey, "excluded")}
                    disabled={attachmentBusy || item.state === "excluded"}
                  >
                    <X size={14} /> 제외
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="daily-intelligence-muted">
            최근 공식 증권사 채널에서 수집된 PDF 첨부가 없습니다.
            텔레그램 수집 후 새로고침하면 승인 대상이 표시됩니다.
          </p>
        )}
        <p className="daily-intelligence-panel-note">
          PDF 자동 수집은 레지스트리에서 명시적으로 허용한 공식 증권사 채널에만 적용됩니다.
          분석 승인 전에는 파일을 내려받지 않으며, 승인 후에도 원문은 재배포하지 않습니다.
        </p>
      </div>

      <div className="daily-intelligence-telegram-channel-title">
        <strong>수집 대상 채널</strong>
        <span>{telegramSources.enabledCount}개 활성</span>
      </div>
      <div className="daily-intelligence-telegram-channels">
        {(telegramSources.channels || []).map((channel) => (
          <a
            key={channel.username}
            href={`https://t.me/${channel.username}`}
            target="_blank"
            rel="noreferrer"
            className={channel.enabled ? "" : "is-disabled"}
          >
            <Radio size={15} />
            <span>
              <strong>{channel.name}</strong>
              <small>
                @{channel.username} · {channel.category.replaceAll("_", " ")}
              </small>
            </span>
            <em>우선순위 {channel.priority}</em>
          </a>
        ))}
      </div>

      <p className="daily-intelligence-panel-note">
        텔레그램 글은 발견·관점 자료로만 수집합니다. 같은 사건은 하나로 묶고, 공식자료로 확인되기 전에는 독자용 사실로 승격하지 않습니다.
      </p>
    </section>
  );
}

function formatResearchDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : value;
}

function signedCount(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

function BrokerResearchIndex({ index, brokerResearch }) {
  const history = index?.history || [];
  const latest = index?.latest;
  const change = index?.change;
  if (!latest) return null;
  const targetSignals = (brokerResearch?.reports || [])
    .filter((report) => report.rating?.original || report.targetPrice?.value !== null)
    .slice(0, 6);
  const chartOption = history.length >= 2 ? {
    animation: false,
    grid: { left: 42, right: 48, top: 24, bottom: 36 },
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      textStyle: { color: "#94a3b8", fontSize: 10 },
      data: ["리포트 수", "방향성 균형"],
    },
    xAxis: {
      type: "category",
      data: history.map((point) => point.date.slice(5).replace("-", ".")),
      axisLine: { lineStyle: { color: "rgba(148,163,184,.25)" } },
      axisLabel: { color: "#94a3b8", fontSize: 10 },
    },
    yAxis: [
      {
        type: "value",
        min: 0,
        axisLabel: { color: "#94a3b8", fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } },
      },
      {
        type: "value",
        min: -100,
        max: 100,
        axisLabel: { color: "#94a3b8", fontSize: 10, formatter: "{value}" },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "리포트 수",
        type: "bar",
        data: history.map((point) => point.reportCount),
        itemStyle: { color: "#3b82f6", borderRadius: [5, 5, 0, 0] },
        barMaxWidth: 30,
      },
      {
        name: "방향성 균형",
        type: "line",
        yAxisIndex: 1,
        data: history.map((point) => point.directionalBalance),
        connectNulls: false,
        smooth: true,
        symbolSize: 7,
        lineStyle: { color: "#34d399", width: 2 },
        itemStyle: { color: "#34d399" },
      },
    ],
  } : null;
  return (
    <section className="daily-intelligence-research-index" aria-label="리서치 인덱스">
      <div className="daily-intelligence-broker-subtitle">
        <strong>리서치 인덱스</strong>
        <span>수집량과 명시적 의견의 방향 변화를 날짜별로 비교합니다.</span>
      </div>
      <div className="daily-intelligence-research-index-kpis">
        <article>
          <span>최신 수집량</span>
          <strong>{latest.reportCount}</strong>
          <small>{change ? `${signedCount(change.reportCount)}건` : "비교 기준 없음"}</small>
        </article>
        <article>
          <span>발행사</span>
          <strong>{latest.publisherCount}</strong>
          <small>{change ? `${signedCount(change.publisherCount)}곳` : "비교 기준 없음"}</small>
        </article>
        <article>
          <span>구조화율</span>
          <strong>
            {latest.reportCount
              ? `${Math.round((latest.structuredCount / latest.reportCount) * 100)}%`
              : "—"}
          </strong>
          <small>{latest.structuredCount}/{latest.reportCount}건</small>
        </article>
        <article>
          <span>방향성 균형</span>
          <strong>
            {latest.directionalBalance === null
              ? "표본 부족"
              : `${latest.directionalBalance > 0 ? "+" : ""}${latest.directionalBalance.toFixed(0)}`}
          </strong>
          <small>긍정 +100 · 경계/부정 -100</small>
        </article>
      </div>
      {chartOption ? (
        <div className="daily-intelligence-research-index-chart">
          <PortfolioEChart
            option={chartOption}
            ariaLabel="날짜별 리포트 수와 방향성 균형 차트"
          />
        </div>
      ) : null}
      {targetSignals.length ? (
        <div className="daily-intelligence-research-signals">
          <strong>투자의견·목표가 신호</strong>
          <div>
            {targetSignals.map((report) => (
              <article key={report.reportId || `${report.publisher}-${report.title}`}>
                <span>{report.publisher}</span>
                <h3>{report.title}</h3>
                <p>
                  {report.rating.original ? `원문 의견 ${report.rating.original}` : ""}
                  {report.rating.original && report.targetPrice.value !== null ? " · " : ""}
                  {report.targetPrice.value !== null
                    ? `목표가 ${report.targetPrice.currency || report.baseCurrency} ${report.targetPrice.value.toLocaleString()}`
                    : ""}
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      <p className="daily-intelligence-panel-note">
        방향성 균형은 명시적 의견이 있는 자료만 계산합니다. 목표가가 서로 다른 통화인 경우
        환산 기준 없이 합산하거나 평균 내지 않습니다.
      </p>
    </section>
  );
}

function SectorMappingQueue({ coverage, onChanged }) {
  const queue = React.useMemo(() => {
    const rows = [];
    const seen = new Set();
    for (const item of coverage || []) {
      if (item.sectorId || !item.sourceLabels?.length) continue;
      for (const sourceLabel of item.sourceLabels) {
        const key = sourceLabel.toLocaleLowerCase("en-US");
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          sourceLabel,
          reportCount: item.reportCount,
          publisherCount: item.publisherCount,
          suggestion: item.mappingSuggestion || null,
        });
      }
    }
    return rows;
  }, [coverage]);
  const [taxonomy, setTaxonomy] = React.useState(null);
  const [selections, setSelections] = React.useState({});
  const [busyLabel, setBusyLabel] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setSelections((current) => {
      const next = { ...current };
      for (const item of queue) {
        const recommended = item.suggestion?.confidence === "high"
          ? item.suggestion.candidates?.[0]?.sectorId
          : "";
        if (!next[item.sourceLabel] && recommended) {
          next[item.sourceLabel] = {
            primarySectorId: recommended,
            secondarySectorIds: [],
          };
        }
      }
      return next;
    });
  }, [queue]);

  React.useEffect(() => {
    if (!queue.length) return undefined;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/pb-daily-intelligence/sector-taxonomy", {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        if (active) setTaxonomy(payload.taxonomy);
      } catch (loadError) {
        if (active) setError(loadError.message || "섹터 마스터를 불러오지 못했습니다.");
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [queue.length]);

  if (!queue.length) return null;

  const taxonomyGroups = [
    {
      id: "cross_market",
      label: "시장·자산군",
      sectors: (taxonomy?.sectors || []).filter((sector) => sector.kind === "cross_market"),
    },
    {
      id: "sector",
      label: "기본 업종",
      sectors: (taxonomy?.sectors || []).filter((sector) => sector.kind === "sector"),
    },
    {
      id: "theme",
      label: "구조적 테마",
      sectors: (taxonomy?.sectors || []).filter(
        (sector) => !["cross_market", "sector"].includes(sector.kind),
      ),
    },
  ];

  const selectionFor = (sourceLabel) => selections[sourceLabel] || {
    primarySectorId: "",
    secondarySectorIds: [],
  };
  const updateSelection = (sourceLabel, patch) => {
    setSelections((current) => ({
      ...current,
      [sourceLabel]: {
        primarySectorId: "",
        secondarySectorIds: [],
        ...(current[sourceLabel] || {}),
        ...patch,
      },
    }));
  };
  const addSecondaryTheme = (sourceLabel, sectorId) => {
    if (!sectorId) return;
    const selection = selectionFor(sourceLabel);
    if (
      selection.primarySectorId === sectorId
      || selection.secondarySectorIds.includes(sectorId)
    ) return;
    updateSelection(sourceLabel, {
      secondarySectorIds: [...selection.secondarySectorIds, sectorId],
    });
  };
  const removeSecondaryTheme = (sourceLabel, sectorId) => {
    const selection = selectionFor(sourceLabel);
    updateSelection(sourceLabel, {
      secondarySectorIds: selection.secondarySectorIds.filter((id) => id !== sectorId),
    });
  };

  const saveAlias = async (sourceLabel) => {
    const selection = selectionFor(sourceLabel);
    if (!selection.primarySectorId) {
      setError("주 섹터를 먼저 선택해 주세요.");
      return;
    }
    setBusyLabel(sourceLabel);
    setError("");
    try {
      const response = await fetch("/api/pb-daily-intelligence/sector-taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: sourceLabel,
          primarySectorId: selection.primarySectorId,
          secondarySectorIds: selection.secondarySectorIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setTaxonomy(payload.taxonomy);
      await onChanged?.();
    } catch (saveError) {
      setError(saveError.message || "섹터 별칭을 저장하지 못했습니다.");
    } finally {
      setBusyLabel("");
    }
  };

  return (
    <div className="daily-intelligence-sector-mapping">
      <div className="daily-intelligence-broker-subtitle">
        <strong>섹터 매핑 대기</strong>
        <span>주 섹터 하나와 관련 구조적 테마를 함께 지정할 수 있습니다.</span>
      </div>
      {error ? <p className="daily-intelligence-research-date-error">{error}</p> : null}
      <div className="daily-intelligence-sector-mapping-list">
        {queue.map((item) => (
          <article key={item.sourceLabel}>
            <div>
              <strong>{item.sourceLabel}</strong>
              <small>{item.reportCount}건 · {item.publisherCount}개 발행사</small>
              {item.suggestion?.candidates?.length ? (
                <div className="daily-intelligence-sector-suggestions">
                  <span className={`is-${item.suggestion.confidence}`}>
                    {item.suggestion.confidence === "high" ? "추천" : "검토 필요"}
                  </span>
                  {item.suggestion.candidates.map((candidate) => (
                    <button
                      type="button"
                      key={candidate.sectorId}
                      onClick={() => updateSelection(item.sourceLabel, {
                        primarySectorId: candidate.sectorId,
                      })}
                      title={`${candidate.reason} · ${(candidate.score * 100).toFixed(0)}점`}
                    >
                      {candidate.nameKo}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="daily-intelligence-sector-mapping-controls">
              <select
                value={selectionFor(item.sourceLabel).primarySectorId}
                onChange={(event) => {
                  const primarySectorId = event.target.value;
                  updateSelection(item.sourceLabel, {
                    primarySectorId,
                    secondarySectorIds: selectionFor(item.sourceLabel).secondarySectorIds
                      .filter((sectorId) => sectorId !== primarySectorId),
                  });
                }}
                aria-label={`${item.sourceLabel} 주 섹터`}
                disabled={!taxonomy || busyLabel === item.sourceLabel}
              >
                <option value="">주 섹터 선택</option>
                {taxonomyGroups
                  .filter((group) => group.id !== "cross_market")
                  .map((group) => (
                    <optgroup key={group.id} label={group.label}>
                      {group.sectors.map((sector) => (
                        <option key={sector.id} value={sector.id}>
                          {sector.nameKo}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
              <select
                value=""
                onChange={(event) => addSecondaryTheme(item.sourceLabel, event.target.value)}
                aria-label={`${item.sourceLabel} 보조 테마 추가`}
                disabled={!taxonomy || busyLabel === item.sourceLabel}
              >
                <option value="">+ 보조 테마 추가</option>
                {taxonomyGroups.find((group) => group.id === "theme")?.sectors
                  .filter((sector) => (
                    sector.id !== selectionFor(item.sourceLabel).primarySectorId
                    && !selectionFor(item.sourceLabel).secondarySectorIds.includes(sector.id)
                  ))
                  .map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.nameKo}
                    </option>
                  ))}
              </select>
              {selectionFor(item.sourceLabel).secondarySectorIds.length ? (
                <div className="daily-intelligence-sector-theme-chips">
                  {selectionFor(item.sourceLabel).secondarySectorIds.map((sectorId) => {
                    const sector = taxonomy?.sectors?.find((row) => row.id === sectorId);
                    return (
                      <button
                        type="button"
                        key={sectorId}
                        onClick={() => removeSecondaryTheme(item.sourceLabel, sectorId)}
                        title="보조 테마 제거"
                      >
                        {sector?.nameKo || sectorId} ×
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => saveAlias(item.sourceLabel)}
              disabled={
                !selectionFor(item.sourceLabel).primarySectorId
                || busyLabel === item.sourceLabel
              }
            >
              {busyLabel === item.sourceLabel
                ? <LoaderCircle size={14} className="is-spinning" />
                : <CheckCircle2 size={14} />}
              연결
            </button>
          </article>
        ))}
      </div>
      <p className="daily-intelligence-panel-note">
        저장 결과는 <code>config/research-sector-taxonomy.json</code>에 남습니다.
        원문 리포트와 원래 섹터명은 변경하지 않으며, 보조 테마는 중복 집계 근거로 표시됩니다.
      </p>
    </div>
  );
}

function SectorImpactAlerts({ alerts = [], baseline = null, persistence = null }) {
  const directionLabels = {
    beneficiary: "우호",
    pressure: "부담",
    mixed: "상충",
    neutral: "미확인",
  };
  const strengthLabels = {
    strong: "강함",
    moderate: "보통",
    weak: "약함",
    unconfirmed: "미확인",
  };
  if (!baseline?.available) {
    return (
      <div className="daily-intelligence-sector-impact-alerts is-empty">
        <div>
          <strong>섹터 영향도 변화</strong>
          <span>직전 리서치 날짜와 같은 날짜의 시장 데이터가 쌓이면 전환 알림을 표시합니다.</span>
        </div>
        <em>비교 기준 축적 중</em>
      </div>
    );
  }
  return (
    <div className="daily-intelligence-sector-impact-alerts">
      <div className="daily-intelligence-broker-subtitle">
        <strong>섹터 영향도 변화</strong>
        <span>
          {baseline.previousDate} → {baseline.currentDate}
          {" · "}비교 가능 {baseline.comparableSectorCount}개
        </span>
      </div>
      {alerts.length ? (
        <div className="daily-intelligence-sector-impact-alert-list">
          {alerts.map((alert) => (
            <article key={`${alert.sectorId}-${alert.alertType}`} className={`is-${alert.severity}`}>
              <div>
                <span>{alert.title}</span>
                <strong>{alert.sector}</strong>
              </div>
              <p>
                {directionLabels[alert.previousDirection]} → {directionLabels[alert.currentDirection]}
                {" · "}{strengthLabels[alert.previousStrength]} → {strengthLabels[alert.currentStrength]}
                {alert.marketTicker ? ` · ${alert.marketTicker}` : ""}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="daily-intelligence-muted">
          비교 가능한 섹터에서 방향·강도·가격/리서치 괴리 변화가 없습니다.
        </p>
      )}
      <p className="daily-intelligence-panel-note">
        같은 날짜의 시장 내부지표가 없으면 가격 변화는 비교하지 않습니다.
        {" "}지속성 표본 {persistence?.historyPointCount || 0}회 ·
        판정 완료 {persistence?.decisiveCount || 0}건
        {persistence?.hitRatePct === null || persistence?.hitRatePct === undefined
          ? ` · 최소 ${persistence?.minimumPublicSample || 10}건 전 적중률 비공개`
          : ` · 적중률 ${persistence.hitRatePct}%`}
      </p>
    </div>
  );
}

function SectorWatchlistRanking({ watchlist = null }) {
  if (!watchlist) return null;
  const strengthLabels = {
    strong: "강함",
    moderate: "보통",
    weak: "약함",
    unconfirmed: "미확인",
  };
  const groups = [
    {
      id: "promoted",
      label: "승격",
      description: "모든 근거 게이트 통과",
      items: watchlist.promoted || [],
    },
    {
      id: "watch",
      label: "관찰",
      description: "우호 방향·종목 연결 확인",
      items: watchlist.watch || [],
    },
    {
      id: "caution",
      label: "경계",
      description: "부담 또는 상충 신호",
      items: watchlist.caution || [],
    },
  ];
  return (
    <div className="daily-intelligence-sector-watchlist">
      <div className="daily-intelligence-broker-subtitle">
        <strong>관심 섹터 승격 큐</strong>
        <span>{watchlist.summary?.promotionRule}</span>
      </div>
      <div className="daily-intelligence-sector-watchlist-grid">
        {groups.map((group) => (
          <section key={group.id} className={`is-${group.id}`}>
            <header>
              <div>
                <strong>{group.label}</strong>
                <small>{group.description}</small>
              </div>
              <em>{group.items.length}</em>
            </header>
            {group.items.length ? group.items.slice(0, 5).map((item) => (
              <article key={item.sectorId}>
                <div>
                  <span>#{item.rank}</span>
                  <strong>{item.sector}</strong>
                  <small>
                    {item.marketTicker || "ETF 연결 대기"}
                    {" · "}{strengthLabels[item.strength] || item.strength}
                    {" · "}{item.streakCount}회 지속
                  </small>
                </div>
                {item.relatedTickers?.length ? (
                  <p>{item.relatedTickers.map((ticker) => ticker.ticker).join(" · ")}</p>
                ) : null}
                <p>{item.rationale}</p>
                {item.missingRequirements?.length ? (
                  <small>보강: {item.missingRequirements.join(" · ")}</small>
                ) : null}
              </article>
            )) : (
              <p className="daily-intelligence-muted">
                {group.id === "promoted"
                  ? "현재 모든 승격 조건을 통과한 섹터가 없습니다."
                  : "해당 상태의 섹터가 없습니다."}
              </p>
            )}
          </section>
        ))}
      </div>
      {watchlist.notReadyCount ? (
        <p className="daily-intelligence-panel-note">
          활성 방향 또는 종목 근거가 부족한 {watchlist.notReadyCount}개 섹터는 순위에서 제외했습니다.
        </p>
      ) : null}
    </div>
  );
}

function StockDecisionComparison({
  shortlists = null,
  candidatePool = [],
  thesisMemory = null,
  brokerResearchDate = "",
  busy = false,
  error = "",
  onTrackStock,
  onAddWatchlist,
}) {
  const statusOrder = { qualified: 0, research: 1, hold: 2, excluded: 3 };
  const priorityOrder = { A: 0, B: 1, C: 2, REJECTED: 3 };
  const statusLabel = {
    qualified: "심층검토",
    research: "근거보강",
    hold: "관찰",
    excluded: "제외",
  };
  const revisionLabel = {
    positive_revision: "추정치 상향",
    negative_revision: "추정치 하향",
    mixed_revision: "추정치 혼재",
    not_available: "추정치 없음",
  };
  const seenTickers = new Set();
  const shortlistRows = (shortlists?.sectors || [])
    .flatMap((sector) => (sector.candidates || []).map((candidate) => ({
      ...candidate,
      sectorId: sector.sectorId,
      sector: sector.sector,
      sectorStatus: sector.sectorStatus,
      shortlistTrackable: ["qualified", "research"].includes(candidate.status),
    })));
  const shortlistByTicker = new Map(
    shortlistRows.map((candidate) => [candidate.ticker, candidate]),
  );
  const fallbackRows = (candidatePool || []).map((candidate) => {
    const shortlistCandidate = shortlistByTicker.get(candidate.ticker);
    if (shortlistCandidate) return { ...candidate, ...shortlistCandidate };
    const status = candidate.researchPriority === "A"
      ? "qualified"
      : candidate.researchPriority === "B"
        ? "research"
        : candidate.researchPriority === "REJECTED"
          ? "excluded"
          : "hold";
    return {
      ...candidate,
      sectorId: "",
      sector: candidate.linkedSectorLabel || "미분류",
      sectorStatus: "",
      status,
      shortlistTrackable: false,
      researchProfile: {
        whyNow: candidate.whyNow || "가격·거래량 이상 신호로 조사 후보에 포함됐습니다.",
        invalidationCondition: candidate.firstRejection
          || "기업 고유 촉매가 확인되지 않거나 섹터 상대강도가 반전되면 우선순위를 낮춥니다.",
      },
    };
  });
  const comparisonPool = [
    ...fallbackRows,
    ...shortlistRows.filter((candidate) =>
      !fallbackRows.some((fallback) => fallback.ticker === candidate.ticker)
    ),
  ]
    .sort((left, right) => (
      Number(statusOrder[left.status] ?? 9) - Number(statusOrder[right.status] ?? 9)
      || Number(priorityOrder[left.researchPriority] ?? 9)
        - Number(priorityOrder[right.researchPriority] ?? 9)
      || Number(right.candidateScore || 0) - Number(left.candidateScore || 0)
    ))
    .filter((candidate) => {
      if (!candidate.ticker || seenTickers.has(candidate.ticker)) return false;
      seenTickers.add(candidate.ticker);
      return candidate.status !== "excluded";
    })
    .slice(0, 5);
  const poolKey = comparisonPool.map((candidate) => candidate.ticker).join("|");
  const [selectedTickers, setSelectedTickers] = React.useState([]);

  React.useEffect(() => {
    setSelectedTickers((current) => {
      const valid = current
        .filter((ticker) => comparisonPool.some((candidate) => candidate.ticker === ticker))
        .slice(0, 3);
      const fill = comparisonPool
        .map((candidate) => candidate.ticker)
        .filter((ticker) => !valid.includes(ticker))
        .slice(0, Math.max(0, Math.min(3, comparisonPool.length) - valid.length));
      return [...valid, ...fill];
    });
  }, [poolKey]);

  if (comparisonPool.length < 2) return null;

  const selectedCandidates = selectedTickers
    .map((ticker) => comparisonPool.find((candidate) => candidate.ticker === ticker))
    .filter(Boolean);
  const trackedContinuityIds = new Set(
    [
      ...(thesisMemory?.records || []),
      ...(thesisMemory?.activeRecords || []),
    ].map((record) => record.continuityId),
  );
  const toggleCandidate = (ticker) => {
    setSelectedTickers((current) => {
      if (current.includes(ticker)) {
        return current.length > 2 ? current.filter((item) => item !== ticker) : current;
      }
      if (current.length >= 3) return current;
      return [...current, ticker];
    });
  };

  return (
    <section className="daily-intelligence-panel daily-intelligence-wide daily-intelligence-stock-comparison">
      <div className="daily-intelligence-panel-title">
        <div>
          <span>STOCK DECISION BOARD</span>
          <h2>종목 비교 의사결정판</h2>
        </div>
        <span className="daily-intelligence-count">{selectedCandidates.length}</span>
      </div>
      <p className="daily-intelligence-panel-note">
        상위 후보 5개 중 2~3개를 같은 근거로 비교합니다. 순위와 상태는 리서치
        우선순위이며 매수·매도 추천이 아닙니다.
      </p>

      <div className="daily-intelligence-stock-comparison-selector" role="group" aria-label="비교 종목 선택">
        {comparisonPool.map((candidate) => {
          const selected = selectedTickers.includes(candidate.ticker);
          const disabled = selected ? selectedTickers.length <= 2 : selectedTickers.length >= 3;
          return (
            <button
              type="button"
              key={candidate.ticker}
              className={selected ? "is-selected" : ""}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => toggleCandidate(candidate.ticker)}
            >
              <strong>{candidate.ticker}</strong>
              <span>{candidate.sector}</span>
              <em>{statusLabel[candidate.status] || candidate.status}</em>
            </button>
          );
        })}
      </div>

      <div className="daily-intelligence-stock-comparison-grid">
        {selectedCandidates.map((candidate) => {
          const valuation = candidate.valuationScreen || {};
          const revision = candidate.estimateRevision || {};
          const tracked = trackedContinuityIds.has(
            `pb-stock-${candidate.ticker.toLowerCase()}`,
          );
          const trackable = candidate.shortlistTrackable === true;
          return (
            <article key={candidate.ticker} className={`is-${candidate.status}`}>
              <header>
                <div>
                  <span>{candidate.sector} · {candidate.linkedSectorTicker || "ETF 미연결"}</span>
                  <h3>{candidate.ticker} <small>{candidate.companyName}</small></h3>
                </div>
                <em>{candidate.researchPriority || "C"} · {statusLabel[candidate.status]}</em>
              </header>

              <dl>
                <div>
                  <dt>왜 지금 보는가</dt>
                  <dd>{candidate.researchProfile?.whyNow || candidate.whyNow}</dd>
                </div>
                <div>
                  <dt>공식 근거</dt>
                  <dd>
                    {candidate.primaryEvidenceCount || 0}건
                    {" · "}
                    확인 사실 {candidate.verifiedFactCount || 0}개
                  </dd>
                </div>
                <div>
                  <dt>추정치 변화</dt>
                  <dd>
                    {revisionLabel[revision.revisionDirection]
                      || revision.revisionDirection
                      || "자료 없음"}
                    {revision.rows?.[0]?.revisionPct30d != null
                      ? ` · ${signed(revision.rows[0].revisionPct30d, 1, "%")}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>밸류에이션</dt>
                  <dd>
                    {valuation.status === "screening_available"
                      ? `${valuationMetricLabels[valuation.primaryMetric] || valuation.primaryMetric} ${multiple(valuation.targetValue)} · 비교기업 ${valuation.usablePeerCount || 0}개`
                      : "비교 가능한 근거 부족"}
                  </dd>
                </div>
                <div>
                  <dt>섹터 대비 5일</dt>
                  <dd>
                    {Number.isFinite(candidate.stockVsSector5d)
                      ? signed(candidate.stockVsSector5d, 2, "%p")
                      : "비교 자료 없음"}
                  </dd>
                </div>
                <div className="is-risk">
                  <dt>첫 기각 조건</dt>
                  <dd>{candidate.researchProfile?.invalidationCondition}</dd>
                </div>
              </dl>

              {candidate.missingRequirements?.length ? (
                <p className="daily-intelligence-stock-comparison-gap">
                  보강 필요 · {candidate.missingRequirements.slice(0, 3).join(" · ")}
                </p>
              ) : (
                <p className="daily-intelligence-stock-comparison-ready">
                  공식 촉매·추정치·비교 밸류에이션 게이트 통과
                </p>
              )}

              <footer>
                <button
                  type="button"
                  disabled={busy || !onAddWatchlist}
                  onClick={() => onAddWatchlist?.(candidate.ticker)}
                >
                  관심종목 추가
                </button>
                <button
                  type="button"
                  disabled={busy || !trackable || !onTrackStock}
                  onClick={() => onTrackStock?.({
                    ticker: candidate.ticker,
                    sectorId: candidate.sectorId,
                    brokerResearchDate,
                  })}
                >
                  {tracked ? "오늘 관측 갱신" : trackable ? "가설 후보 저장" : "근거 보강 대기"}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {error ? <p className="daily-intelligence-research-date-error">{error}</p> : null}
    </section>
  );
}

function SectorStockShortlists({
  shortlists = null,
  thesisMemory = null,
  thesisBusy = false,
  thesisError = "",
  brokerResearchDate = "",
  onTrackStock,
}) {
  const [selectedKey, setSelectedKey] = React.useState("");
  if (!shortlists?.sectors?.length) return null;
  const statusLabels = {
    qualified: "심층검토",
    research: "근거보강",
    hold: "관찰",
    excluded: "제외",
  };
  const revisionLabels = {
    positive_revision: "추정치 상향",
    negative_revision: "추정치 하향",
    mixed_revision: "추정치 혼재",
    not_available: "추정치 없음",
  };
  const candidateRows = shortlists.sectors.flatMap((sector) =>
    sector.candidates.map((candidate) => ({
      ...candidate,
      sectorId: sector.sectorId,
      sector: sector.sector,
      sectorStatus: sector.sectorStatus,
      selectionKey: `${sector.sectorId}:${candidate.ticker}`,
    })),
  );
  const selectedCandidate = candidateRows.find(
    (candidate) => candidate.selectionKey === selectedKey,
  );
  const trackedContinuityIds = new Set(
    (thesisMemory?.records || []).map((record) => record.continuityId),
  );
  const selectedTracked = selectedCandidate
    ? trackedContinuityIds.has(`pb-stock-${selectedCandidate.ticker.toLowerCase()}`)
    : false;
  const selectedTrackable = selectedCandidate
    ? ["qualified", "research"].includes(selectedCandidate.status)
    : false;
  return (
    <div className="daily-intelligence-sector-shortlists">
      <div className="daily-intelligence-broker-subtitle">
        <strong>섹터별 종목 쇼트리스트</strong>
        <span>{shortlists.qualificationRule}</span>
      </div>
      <div className="daily-intelligence-sector-shortlist-summary">
        {[
          ["qualified", "심층검토"],
          ["research", "근거보강"],
          ["hold", "관찰"],
          ["excluded", "제외"],
        ].map(([status, label]) => (
          <article key={status} className={`is-${status}`}>
            <span>{label}</span>
            <strong>{shortlists.totals?.[status] || 0}</strong>
          </article>
        ))}
      </div>
      <div className="daily-intelligence-sector-shortlist-grid">
        {shortlists.sectors.map((sector) => (
          <section key={sector.sectorId}>
            <header>
              <div>
                <span>{sector.sectorStatus === "promoted" ? "승격 섹터" : "관찰 섹터"}</span>
                <strong>{sector.sector}</strong>
              </div>
              <em>{sector.marketTicker || "ETF 미연결"}</em>
            </header>
            {sector.candidates.length ? sector.candidates.map((candidate) => {
              const selectionKey = `${sector.sectorId}:${candidate.ticker}`;
              return (
              <article
                key={candidate.ticker}
                className={`is-${candidate.status} ${selectedKey === selectionKey ? "is-selected" : ""}`}
              >
                <header>
                  <div>
                    <strong>{candidate.ticker}</strong>
                    <small>{candidate.companyName || candidate.exposureLabel}</small>
                  </div>
                  <em>{statusLabels[candidate.status]}</em>
                </header>
                <p>
                  {candidate.evidenceSummary}
                  {" · "}{revisionLabels[candidate.estimateRevision?.revisionDirection]
                    || candidate.estimateRevision?.revisionDirection
                    || "추정치 없음"}
                </p>
                <p>
                  밸류에이션 비교기업 {candidate.valuationScreen?.usablePeerCount || 0}개
                  {" · "}{candidate.exposureType === "direct" ? "리포트 직접 언급" : "섹터 간접 연결"}
                </p>
                {candidate.missingRequirements?.length ? (
                  <small>보강: {candidate.missingRequirements.join(" · ")}</small>
                ) : null}
                <footer>{candidate.nextAction}</footer>
                <button
                  type="button"
                  className="daily-intelligence-sector-shortlist-open"
                  aria-expanded={selectedKey === selectionKey}
                  onClick={() => setSelectedKey(
                    selectedKey === selectionKey ? "" : selectionKey,
                  )}
                >
                  {selectedKey === selectionKey ? "상세 닫기" : "심층분석 보기"}
                </button>
              </article>
              );
            }) : (
              <p className="daily-intelligence-muted">연결된 종목 후보가 없습니다.</p>
            )}
          </section>
        ))}
      </div>
      {selectedCandidate ? (
        <section className={`daily-intelligence-stock-deep-dive is-${selectedCandidate.status}`}>
          <header>
            <div>
              <span>STOCK RESEARCH GATE</span>
              <h3>{selectedCandidate.ticker} <small>{selectedCandidate.companyName}</small></h3>
              <p>{selectedCandidate.researchProfile?.researchQuestion}</p>
            </div>
            <button
              type="button"
              aria-label="종목 심층분석 닫기"
              onClick={() => setSelectedKey("")}
            >
              <X size={16} />
            </button>
          </header>

          <div className="daily-intelligence-stock-deep-dive-status">
            <article>
              <span>분석 상태</span>
              <strong>{selectedCandidate.researchProfile?.readinessLabel}</strong>
              <small>연구 우선순위 {selectedCandidate.researchPriority}</small>
            </article>
            <article>
              <span>공식 근거</span>
              <strong>{selectedCandidate.primaryEvidenceCount || 0}건</strong>
              <small>확인 사실 {selectedCandidate.verifiedFactCount || 0}개</small>
            </article>
            <article>
              <span>추정치</span>
              <strong>
                {revisionLabels[selectedCandidate.estimateRevision?.revisionDirection]
                  || selectedCandidate.estimateRevision?.revisionDirection
                  || "자료 없음"}
              </strong>
              <small>기준 {selectedCandidate.estimateRevision?.freezeAsOf || "미확인"}</small>
            </article>
            <article>
              <span>밸류에이션</span>
              <strong>{selectedCandidate.valuationScreen?.usablePeerCount || 0}개 비교</strong>
              <small>
                {valuationRelativeLabels[selectedCandidate.valuationScreen?.relativeStatus]
                  || "비교 불가"}
              </small>
            </article>
          </div>

          <div className="daily-intelligence-stock-deep-dive-grid">
            <article>
              <span>왜 지금 보는가</span>
              <p>{selectedCandidate.researchProfile?.whyNow}</p>
            </article>
            <article>
              <span>확인된 근거 경계</span>
              <ul>
                {selectedCandidate.researchProfile?.evidenceBasis?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article>
              <span>승격 조건</span>
              <p>{selectedCandidate.researchProfile?.confirmationCondition}</p>
            </article>
            <article>
              <span>무효화 조건</span>
              <p>{selectedCandidate.researchProfile?.invalidationCondition}</p>
            </article>
          </div>

          {selectedCandidate.estimateRevision?.rows?.length ? (
            <div className="daily-intelligence-stock-deep-dive-estimates">
              <strong>추정치 변화</strong>
              {selectedCandidate.estimateRevision.rows.slice(0, 4).map((row) => (
                <article key={`${row.metricId}-${row.periodEnd}`}>
                  <span>{estimateMetricLabels[row.metricId] || row.metricId || "지표"}</span>
                  <b>{row.periodEnd || "기간 미확인"}</b>
                  <em>{signed(row.revisionPct30d, 1, "%")}</em>
                  <small>표본 {row.analystCount || 0}</small>
                </article>
              ))}
            </div>
          ) : null}

          {selectedCandidate.valuationScreen?.status === "screening_available" ? (
            <div className="daily-intelligence-stock-deep-dive-valuation">
              <p>
                <span>{valuationMetricLabels[selectedCandidate.valuationScreen.primaryMetric]
                  || selectedCandidate.valuationScreen.primaryMetric}</span>
                <strong>{multiple(selectedCandidate.valuationScreen.targetValue)}</strong>
              </p>
              <p>
                <span>비교기업 중앙</span>
                <strong>{multiple(selectedCandidate.valuationScreen.peerMedian)}</strong>
              </p>
              <p>
                <span>중앙값 괴리</span>
                <strong>{signed(selectedCandidate.valuationScreen.premiumDiscountPct, 1, "%")}</strong>
              </p>
            </div>
          ) : null}

          <div className="daily-intelligence-stock-deep-dive-actions">
            <button
              type="button"
              disabled={!selectedTrackable || thesisBusy || !onTrackStock}
              onClick={() => onTrackStock?.({
                ticker: selectedCandidate.ticker,
                sectorId: selectedCandidate.sectorId,
                brokerResearchDate,
              })}
            >
              <Database size={15} />
              {thesisBusy
                ? "저장 중"
                : selectedTracked
                  ? "오늘 관측 갱신"
                  : selectedTrackable
                    ? "투자 가설 후보 저장"
                    : "근거 충족 후 저장"}
            </button>
            <span>
              {selectedTracked
                ? "World Memory에서 같은 continuity ID로 추적 중입니다."
                : "저장 후 같은 종목의 상태 변화가 날짜별 관측으로 누적됩니다."}
            </span>
          </div>
          {thesisError ? (
            <p className="daily-intelligence-research-date-error">{thesisError}</p>
          ) : null}

          <footer>
            <ShieldCheck size={15} />
            <span>{selectedCandidate.researchProfile?.evidenceBoundary}</span>
          </footer>
        </section>
      ) : null}
      <p className="daily-intelligence-panel-note">{shortlists.disclaimer}</p>
    </div>
  );
}

function SectorCoverageExplorer({ coverage, reports, sectorHistory, selectedDate }) {
  const [selectedKey, setSelectedKey] = React.useState("");
  const selected = coverage.find((item) => (item.sectorId || item.sector) === selectedKey)
    || coverage[0]
    || null;

  React.useEffect(() => {
    if (!coverage.length) {
      setSelectedKey("");
      return;
    }
    if (!coverage.some((item) => (item.sectorId || item.sector) === selectedKey)) {
      setSelectedKey(coverage[0].sectorId || coverage[0].sector);
    }
  }, [coverage, selectedKey]);

  if (!selected) return null;

  const selectedReports = reports.filter((report) => {
    if (selected.sectorId) {
      return report.standardSectors?.some((sector) => sector.id === selected.sectorId);
    }
    const sourceLabels = new Set(selected.sourceLabels || []);
    return report.sectors?.some((sector) => sourceLabels.has(sector));
  });
  const uniqueItems = (field, limit = 4) => {
    const seen = new Set();
    const values = [];
    for (const report of selectedReports) {
      for (const value of report[field] || []) {
        const key = value.toLocaleLowerCase("en-US");
        if (!value || seen.has(key)) continue;
        seen.add(key);
        values.push(value);
        if (values.length >= limit) return values;
      }
    }
    return values;
  };
  const claims = uniqueItems("keyClaims", 5);
  const catalysts = uniqueItems("catalysts", 4);
  const risks = uniqueItems("risks", 4);
  const monitoring = uniqueItems("monitoringConditions", 4);
  const trend = (sectorHistory || [])
    .filter((point) => !selectedDate || point.date <= selectedDate)
    .map((point) => ({
      date: point.date,
      sector: point.sectors?.find((item) => (
        selected.sectorId
          ? item.sectorId === selected.sectorId
          : item.sector === selected.sector
      )) || null,
    }))
    .filter((point) => point.sector);
  const latestTrend = trend.at(-1)?.sector || selected;
  const previousTrend = trend.at(-2)?.sector || null;
  const trendChange = previousTrend
    ? {
      reportCount: latestTrend.reportCount - previousTrend.reportCount,
      publisherCount: latestTrend.publisherCount - previousTrend.publisherCount,
      ratedCount: latestTrend.ratedCount - previousTrend.ratedCount,
    }
    : null;
  const textKey = (value) => String(value || "")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
  const diffTexts = (current = [], previous = []) => {
    const previousKeys = new Set(previous.map(textKey));
    const currentKeys = new Set(current.map(textKey));
    return {
      added: current.filter((value) => !previousKeys.has(textKey(value))).slice(0, 4),
      removed: previous.filter((value) => !currentKeys.has(textKey(value))).slice(0, 4),
    };
  };
  const narrativeChanges = [
    { id: "claims", label: "주요 주장", ...diffTexts(latestTrend.claims, previousTrend?.claims) },
    { id: "catalysts", label: "상승 촉매", ...diffTexts(latestTrend.catalysts, previousTrend?.catalysts) },
    { id: "risks", label: "핵심 위험", ...diffTexts(latestTrend.risks, previousTrend?.risks) },
  ];
  const hasNarrativeChange = narrativeChanges.some(
    (change) => change.added.length || change.removed.length,
  );
  const crossPublisherThemes = latestTrend.crossPublisherThemes || [];
  const crossPublisherTypeLabels = {
    claim: "주장",
    catalyst: "촉매",
    risk: "위험",
  };
  const publisherOpinion = latestTrend.publisherOpinion || {
    status: "no_sample",
    ratedPublisherCount: 0,
    mixedPublisherCount: 0,
    stances: {},
  };
  const publisherOpinionStatusLabels = {
    no_sample: "명시적 의견 없음",
    single_source: "단일 발행사 표본",
    aligned: "방향 정렬",
    divided: "의견 분산",
  };
  const publisherStanceLabels = {
    positive: "긍정",
    neutral: "중립",
    cautious: "경계",
    negative: "부정",
    mixed: "발행사 내부 혼재",
  };
  const visiblePublisherStances = Object.entries(publisherOpinion.stances || {})
    .filter(([, publishers]) => publishers?.length);
  const impact = selected.impactProfile || null;
  const persistence = impact?.persistence || null;
  const impactStrengthLabels = {
    strong: "강함",
    moderate: "보통",
    weak: "약함",
    unconfirmed: "미확인",
  };
  const impactEvidenceLabels = {
    cross_confirmed: "가격·리서치 교차 확인",
    partial_alignment: "부분 정렬",
    price_only: "가격 신호만 확인",
    research_only: "리서치 의견만 확인",
    conflicting: "가격·의견 상충",
    insufficient: "근거 부족",
  };
  const trendOption = trend.length >= 2 ? {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      textStyle: { color: "#94a3b8", fontSize: 10 },
      data: ["리포트", "발행사"],
    },
    xAxis: {
      type: "category",
      data: trend.map((point) => point.date.slice(5).replace("-", ".")),
      axisLine: { lineStyle: { color: "rgba(148,163,184,.25)" } },
      axisLabel: { color: "#94a3b8", fontSize: 10 },
    },
    yAxis: {
      type: "value",
      min: 0,
      minInterval: 1,
      axisLabel: { color: "#94a3b8", fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } },
    },
    series: [
      {
        name: "리포트",
        type: "bar",
        data: trend.map((point) => point.sector.reportCount),
        itemStyle: { color: "#3b82f6", borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 24,
      },
      {
        name: "발행사",
        type: "line",
        data: trend.map((point) => point.sector.publisherCount),
        smooth: true,
        symbolSize: 6,
        lineStyle: { color: "#34d399", width: 2 },
        itemStyle: { color: "#34d399" },
      },
    ],
  } : null;

  return (
    <div className="daily-intelligence-research-coverage">
      <div className="daily-intelligence-broker-subtitle">
        <strong>섹터 커버리지 지도</strong>
        <span>섹터를 선택하면 관련 리포트의 주장·촉매·위험을 한 화면에서 비교합니다.</span>
      </div>
      <div className="daily-intelligence-research-coverage-table-wrap">
        <table>
          <thead>
            <tr>
              <th>섹터</th>
              <th>리포트</th>
              <th>발행사</th>
              <th>시장 범위</th>
              <th>구조화</th>
              <th>명시적 의견</th>
              <th>커버리지</th>
              <th>주요 종목</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((item) => {
              const itemKey = item.sectorId || item.sector;
              const active = itemKey === (selected.sectorId || selected.sector);
              return (
                <tr key={itemKey} className={active ? "is-selected" : ""}>
                  <th scope="row">
                    <button
                      type="button"
                      className="daily-intelligence-coverage-sector-button"
                      onClick={() => setSelectedKey(itemKey)}
                      aria-pressed={active}
                    >
                      <span>{item.sector}</span>
                      {item.sourceLabels?.length ? (
                        <small>원문 · {item.sourceLabels.join(" · ")}</small>
                      ) : null}
                    </button>
                  </th>
                  <td>{item.reportCount}</td>
                  <td>{item.publisherCount}</td>
                  <td>
                    <span className="daily-intelligence-coverage-market">
                      국내 {item.domesticCount} · 해외 {item.overseasCount}
                      {item.unclassifiedCount ? ` · 미분류 ${item.unclassifiedCount}` : ""}
                    </span>
                  </td>
                  <td>{item.structuredCount}/{item.reportCount}</td>
                  <td>{item.ratedCount || "—"}</td>
                  <td>
                    <em className={`is-${item.depth}`}>
                      {item.depth === "multi_source"
                        ? "다원 확인"
                        : item.depth === "cross_checked"
                          ? "교차 확인"
                          : "단일 출처"}
                    </em>
                  </td>
                  <td>
                    {item.topTickers?.length
                      ? item.topTickers.map((ticker) => ticker.ticker).join(" · ")
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="daily-intelligence-sector-detail">
        <header>
          <div>
            <span>SECTOR DETAIL</span>
            <h3>{selected.sector}</h3>
          </div>
          <p>
            {selectedReports.length}건 · {[...new Set(selectedReports.map((report) => report.publisher))].length}개 발행사
          </p>
        </header>
        {impact ? (
          <section className={`daily-intelligence-sector-impact is-${impact.direction}`}>
            <header>
              <div>
                <span>IMPACT & EXPOSURE</span>
                <h4>섹터 영향도와 종목 노출</h4>
              </div>
              <strong>{impact.directionLabel}</strong>
            </header>
            <div className="daily-intelligence-sector-impact-summary">
              <article>
                <span>신호 강도</span>
                <strong>{impactStrengthLabels[impact.strength] || impact.strength}</strong>
                <small>{impactEvidenceLabels[impact.evidenceState] || impact.evidenceState}</small>
              </article>
              <article>
                <span>시장 확인</span>
                <strong>{impact.marketTicker || "연결 대기"}</strong>
                <small>
                  {impact.vsSpy5d === null
                    ? "5일 상대성과 없음"
                    : `SPY 대비 ${impact.vsSpy5d >= 0 ? "+" : ""}${impact.vsSpy5d.toFixed(2)}%p`}
                </small>
              </article>
              <article>
                <span>리서치 분류</span>
                <strong>{impact.attributionLabel}</strong>
                <small>명시적 의견 {impact.ratedOpinionCount}건</small>
              </article>
            </div>
            <div className="daily-intelligence-sector-exposure-grid">
              <div>
                <strong>직접 노출 종목</strong>
                {impact.directTickers?.length ? (
                  <ul>
                    {impact.directTickers.map((ticker) => (
                      <li key={ticker.ticker}>
                        <span>{ticker.ticker}</span>
                        <small>
                          {ticker.companyName || ticker.exposureLabel}
                          {ticker.reportCount ? ` · ${ticker.reportCount}건` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : <p>리포트에 명시된 종목 없음</p>}
              </div>
              <div>
                <strong>간접 연결 후보</strong>
                {impact.indirectTickers?.length ? (
                  <ul>
                    {impact.indirectTickers.map((ticker) => (
                      <li key={ticker.ticker}>
                        <span>{ticker.ticker}</span>
                        <small>
                          {ticker.companyName || ticker.exposureLabel}
                          {ticker.candidateScore !== null ? ` · 후보점수 ${ticker.candidateScore}` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : <p>후보 스캐너 연결 종목 없음</p>}
              </div>
            </div>
            {persistence ? (
              <div className="daily-intelligence-sector-persistence">
                <article>
                  <span>현재 지속성</span>
                  <strong>
                    {persistence.state === "persistent"
                      ? `${persistence.streakCount}회 연속`
                      : persistence.state === "emerging"
                        ? `${persistence.streakCount}회 관측`
                        : persistence.state === "inactive"
                          ? "활성 방향 없음"
                          : "표본 부족"}
                  </strong>
                  <small>
                    {persistence.streakStartDate
                      ? `${persistence.streakStartDate}부터`
                      : `관측 ${persistence.observationCount}회`}
                  </small>
                </article>
                <article>
                  <span>차기 반응 평가</span>
                  <strong>
                    {persistence.recentOutcome?.status === "hit"
                      ? "적중"
                      : persistence.recentOutcome?.status === "miss"
                        ? "실패"
                        : persistence.recentOutcome?.status === "inconclusive"
                          ? "불명확"
                          : "평가 대기"}
                  </strong>
                  <small>
                    {persistence.recentOutcome
                      ? `${persistence.recentOutcome.responseDate} · SPY 대비 ${persistence.recentOutcome.responseVsSpy1d >= 0 ? "+" : ""}${persistence.recentOutcome.responseVsSpy1d.toFixed(2)}%p`
                      : "다음 비교일 데이터 필요"}
                  </small>
                </article>
                <article>
                  <span>누적 성과</span>
                  <strong>
                    {persistence.hitRatePct === null
                      ? "표본 축적 중"
                      : `적중률 ${persistence.hitRatePct}%`}
                  </strong>
                  <small>
                    적중 {persistence.hitCount} · 실패 {persistence.missCount}
                    {" · "}불명확 {persistence.inconclusiveCount}
                  </small>
                </article>
              </div>
            ) : null}
            <p>{impact.limitation}</p>
            {persistence ? <p>{persistence.limitation}</p> : null}
          </section>
        ) : null}
        <div className="daily-intelligence-sector-trend-summary">
          <article>
            <span>리포트 변화</span>
            <strong>{latestTrend.reportCount}</strong>
            <small>{trendChange ? `${signedCount(trendChange.reportCount)}건` : "비교 기준 축적 중"}</small>
          </article>
          <article>
            <span>발행사 변화</span>
            <strong>{latestTrend.publisherCount}</strong>
            <small>{trendChange ? `${signedCount(trendChange.publisherCount)}곳` : "비교 기준 축적 중"}</small>
          </article>
          <article>
            <span>명시적 의견</span>
            <strong>{latestTrend.ratedCount || 0}</strong>
            <small>{trendChange ? `${signedCount(trendChange.ratedCount)}건` : "의견 표본 축적 중"}</small>
          </article>
        </div>
        {trendOption ? (
          <div className="daily-intelligence-sector-trend-chart">
            <PortfolioEChart
              option={trendOption}
              ariaLabel={`${selected.sector} 날짜별 리포트와 발행사 추이`}
            />
          </div>
        ) : null}
        <section className={`daily-intelligence-sector-opinion is-${publisherOpinion.status}`}>
          <header>
            <div>
              <span>PUBLISHER OPINION</span>
              <h4>발행사 의견 분포</h4>
            </div>
            <strong>{publisherOpinionStatusLabels[publisherOpinion.status]}</strong>
          </header>
          <div className="daily-intelligence-sector-opinion-summary">
            <p>
              명시적 의견 {publisherOpinion.ratedPublisherCount}개 발행사
              {publisherOpinion.mixedPublisherCount
                ? ` · 내부 혼재 ${publisherOpinion.mixedPublisherCount}곳`
                : ""}
            </p>
            {publisherOpinion.status === "aligned" ? (
              <p>
                {publisherStanceLabels[publisherOpinion.dominantStance]} 방향
                {" "}{publisherOpinion.dominantSharePct}%
              </p>
            ) : null}
          </div>
          {visiblePublisherStances.length ? (
            <div className="daily-intelligence-sector-opinion-grid">
              {visiblePublisherStances.map(([stance, publishers]) => (
                <article key={stance} className={`is-${stance}`}>
                  <span>{publisherStanceLabels[stance] || stance}</span>
                  <strong>{publishers.length}</strong>
                  <small>{publishers.join(" · ")}</small>
                </article>
              ))}
            </div>
          ) : (
            <p className="is-empty">방향성이 명시된 발행사 자료가 없습니다.</p>
          )}
          <p className="daily-intelligence-sector-opinion-note">
            발행사당 하나의 명시적 의견만 집계합니다. 동일 발행사 안에서 방향이 충돌하면 별도 혼재 표본으로 분리합니다.
          </p>
        </section>
        <section className="daily-intelligence-sector-cross-check">
          <header>
            <div>
              <span>CROSS-PUBLISHER CHECK</span>
              <h4>독립 발행사 반복 논점</h4>
            </div>
            <small>같은 구조화 문구를 2개 이상 발행사가 사용한 경우만 표시합니다.</small>
          </header>
          {crossPublisherThemes.length ? (
            <div className="daily-intelligence-sector-cross-check-list">
              {crossPublisherThemes.map((theme) => (
                <article key={`${theme.type}-${theme.text}`}>
                  <div>
                    <em className={`is-${theme.type}`}>
                      {crossPublisherTypeLabels[theme.type] || theme.type}
                    </em>
                    <strong>{theme.text}</strong>
                  </div>
                  <p>
                    {theme.publisherCount}개 발행사 · {theme.reportCount}건
                    <span>{theme.publishers.join(" · ")}</span>
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="is-empty">
              정확히 같은 문구를 사용한 독립 발행사 표본이 없습니다.
            </p>
          )}
          <p className="daily-intelligence-sector-cross-check-note">
            반복 문구는 시장의 정답이나 합의를 뜻하지 않으며, 독립 자료에서 동일하게 관측된 표현만 보여줍니다.
          </p>
        </section>
        <section className="daily-intelligence-sector-narrative-change">
          <header>
            <div>
              <span>NARRATIVE CHANGE</span>
              <h4>논점 변화</h4>
            </div>
            <small>구조화 문구를 그대로 비교하며 의미가 비슷한 표현을 임의로 합치지 않습니다.</small>
          </header>
          {!previousTrend ? (
            <p className="is-empty">이전 날짜의 비교 기준을 축적 중입니다.</p>
          ) : !hasNarrativeChange ? (
            <p className="is-empty">이전 리서치 날짜와 비교해 구조화 문구 변화가 없습니다.</p>
          ) : (
            <div className="daily-intelligence-sector-narrative-grid">
              {narrativeChanges.filter((change) => (
                change.added.length || change.removed.length
              )).map((change) => (
                <article key={change.id}>
                  <strong>{change.label}</strong>
                  {change.added.length ? (
                    <div className="is-added">
                      <span>새로 수집</span>
                      <ul>{change.added.map((item) => <li key={`added-${item}`}>{item}</li>)}</ul>
                    </div>
                  ) : null}
                  {change.removed.length ? (
                    <div className="is-removed">
                      <span>이전 자료에서 소멸</span>
                      <ul>{change.removed.map((item) => <li key={`removed-${item}`}>{item}</li>)}</ul>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          <p className="daily-intelligence-sector-narrative-note">
            ‘소멸’은 주장이 반박됐다는 뜻이 아니라 최신 수집 자료에 같은 문구가 없다는 뜻입니다.
          </p>
        </section>
        <div className="daily-intelligence-sector-detail-grid">
          <div className="daily-intelligence-sector-detail-evidence">
            {claims.length ? (
              <section>
                <strong>주요 주장</strong>
                <ul>{claims.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ) : null}
            {catalysts.length ? (
              <section className="is-catalyst">
                <strong>상승 촉매</strong>
                <ul>{catalysts.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ) : null}
            {risks.length ? (
              <section className="is-risk">
                <strong>핵심 위험</strong>
                <ul>{risks.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ) : null}
            {monitoring.length ? (
              <section>
                <strong>확인 조건</strong>
                <ul>{monitoring.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ) : null}
          </div>
          <div className="daily-intelligence-sector-detail-reports">
            <strong>관련 리포트</strong>
            {selectedReports.slice(0, 8).map((report) => (
              <article key={report.reportId || `${report.publisher}-${report.title}`}>
                <span>{report.publisher} · {researchMarketScopeLabels[report.marketScope] || report.marketScope}</span>
                <h4>{report.title}</h4>
                <p>{report.keyClaims?.[0] || report.summary || "구조화 분석 대기 중"}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <p className="daily-intelligence-panel-note">
        단일 출처는 내용의 오류를 뜻하지 않습니다. 같은 섹터를 독립된 발행사가
        교차 확인했는지 보여주는 커버리지 깊이 지표입니다.
      </p>
    </div>
  );
}

function BrokerResearchMonitor({
  brokerResearch,
  researchIndex,
  history,
  busy,
  error,
  onDateChange,
  onTaxonomyChanged,
  thesisMemory,
  thesisBusy,
  thesisError,
  onTrackStock,
}) {
  const [marketScopeFilter, setMarketScopeFilter] = React.useState("all");
  const availableDates = history?.availableDates || [];
  const selectedDate = history?.selectedDate || brokerResearch?.reportDate || "";
  const selectedIndex = availableDates.indexOf(selectedDate);
  const newerDate = selectedIndex > 0 ? availableDates[selectedIndex - 1] : "";
  const olderDate =
    selectedIndex >= 0 && selectedIndex < availableDates.length - 1
      ? availableDates[selectedIndex + 1]
      : "";
  const dateControls = availableDates.length ? (
    <div className="daily-intelligence-research-date-controls">
      <button
        type="button"
        onClick={() => onDateChange(olderDate)}
        disabled={!olderDate || busy}
        aria-label="이전 날짜 리포트"
        title="이전 날짜"
      >
        <ChevronLeft size={15} />
      </button>
      <label>
        <span className="sr-only">애널리스트 리포트 날짜</span>
        <select
          value={selectedDate}
          onChange={(event) => onDateChange(event.target.value)}
          disabled={busy}
          aria-label="애널리스트 리포트 날짜"
        >
          {availableDates.map((date) => (
            <option key={date} value={date}>
              {formatResearchDate(date)}
              {date === history?.latestDate ? " · 최신" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => onDateChange(newerDate)}
        disabled={!newerDate || busy}
        aria-label="다음 날짜 리포트"
        title="다음 날짜"
      >
        <ChevronRight size={15} />
      </button>
      {busy ? <LoaderCircle size={15} className="is-spinning" /> : null}
    </div>
  ) : null;

  if (!brokerResearch) {
    return (
      <section
        id="broker-research-results"
        className="daily-intelligence-panel daily-intelligence-wide"
      >
        <div className="daily-intelligence-panel-title">
          <div>
            <span>ANALYST RESEARCH</span>
            <h2>애널리스트 리포트</h2>
          </div>
          {dateControls || <CircleDashed size={20} />}
        </div>
        {error ? <p className="daily-intelligence-research-date-error">{error}</p> : null}
        <p className="daily-intelligence-muted">
          권한이 확인된 리포트가 아직 없습니다. Google Drive 또는 로컬 리서치 inbox에
          리포트와 권한 메타데이터를 함께 넣으면 이곳에서 가공 결과를 확인할 수 있습니다.
        </p>
      </section>
    );
  }
  const summary = brokerResearch.summary || {};
  const stanceCounts = summary.stanceCounts || {};
  const reports = brokerResearch.reports || [];
  const researchCoverage = brokerResearch.consensus?.coverage || [];
  const domesticCount = reports.filter((report) => report.marketScope === "KR").length;
  const overseasCount = reports.filter(
    (report) => !["KR", "UNKNOWN"].includes(report.marketScope),
  ).length;
  const unclassifiedCount = reports.filter((report) => report.marketScope === "UNKNOWN").length;
  const visibleReports = reports.filter((report) => {
    if (marketScopeFilter === "domestic") return report.marketScope === "KR";
    if (marketScopeFilter === "overseas") {
      return !["KR", "UNKNOWN"].includes(report.marketScope);
    }
    if (marketScopeFilter === "unknown") return report.marketScope === "UNKNOWN";
    return true;
  });
  return (
    <section
      id="broker-research-results"
      className="daily-intelligence-panel daily-intelligence-broker daily-intelligence-wide"
    >
      <div className="daily-intelligence-panel-title">
        <div>
          <span>ANALYST RESEARCH</span>
          <h2>애널리스트 리포트 컨센서스</h2>
        </div>
        <div className="daily-intelligence-research-title-actions">
          {dateControls}
          <span className="daily-intelligence-count">{summary.selectedReportCount || 0}</span>
        </div>
      </div>
      {error ? <p className="daily-intelligence-research-date-error">{error}</p> : null}

      <div className="daily-intelligence-broker-summary">
        <article><span>수집 리포트</span><strong>{summary.selectedReportCount || 0}</strong><small>{summary.publisherCount || 0}개 발행사</small></article>
        <article><span>국내 리서치</span><strong>{domesticCount}</strong><small>KR 시장 분류</small></article>
        <article><span>해외 리서치</span><strong>{overseasCount}</strong><small>미국·유럽·일본·글로벌</small></article>
        <article><span>구조화 완료</span><strong>{summary.structuredReportCount || 0}</strong><small>{researchAnalysisStatusLabels[summary.analysisStatus] || summary.analysisStatus || "요약·논거·촉매·위험"}</small></article>
        <article><span>긍정 / 중립</span><strong>{stanceCounts.positive || 0} / {stanceCounts.neutral || 0}</strong><small>리포트 관점 기준</small></article>
        <article><span>명시적 의견 없음</span><strong>{stanceCounts.not_stated || 0}</strong><small>촉매·위험은 별도 평가</small></article>
      </div>

      <div className="daily-intelligence-research-filter" role="group" aria-label="리서치 시장 구분">
        {[
          ["all", "전체", reports.length],
          ["domestic", "국내", domesticCount],
          ["overseas", "해외", overseasCount],
          ["unknown", "미분류", unclassifiedCount],
        ].map(([value, label, count]) => (
          <button
            type="button"
            key={value}
            className={marketScopeFilter === value ? "is-active" : ""}
            onClick={() => setMarketScopeFilter(value)}
          >
            {label} <span>{count}</span>
          </button>
        ))}
        <small>원문 등급·목표가는 발행사 표현을 보존하고 공통 등급은 별도로 집계합니다.</small>
      </div>

      <BrokerResearchIndex index={researchIndex} brokerResearch={brokerResearch} />

      <SectorImpactAlerts
        alerts={brokerResearch.consensus?.impactAlerts}
        baseline={brokerResearch.consensus?.impactBaseline}
        persistence={brokerResearch.consensus?.signalPersistence}
      />

      <SectorWatchlistRanking watchlist={brokerResearch.consensus?.sectorWatchlist} />

      <SectorStockShortlists
        shortlists={brokerResearch.consensus?.sectorStockShortlists}
        thesisMemory={thesisMemory}
        thesisBusy={thesisBusy}
        thesisError={thesisError}
        brokerResearchDate={selectedDate}
        onTrackStock={onTrackStock}
      />

      <SectorMappingQueue
        coverage={researchCoverage}
        onChanged={onTaxonomyChanged}
      />

      <SectorCoverageExplorer
        coverage={researchCoverage}
        reports={reports}
        sectorHistory={researchIndex?.sectorHistory}
        selectedDate={selectedDate}
      />

      {brokerResearch.consensus?.sectorAssessments?.length ? (
        <div className="daily-intelligence-sector-assessments">
          <div className="daily-intelligence-broker-subtitle">
            <strong>섹터별 리서치 평가</strong>
            <span>저자 의견과 구조화된 촉매·위험을 분리해 집계합니다.</span>
          </div>
          <div className="daily-intelligence-sector-assessment-grid">
            {brokerResearch.consensus.sectorAssessments.map((item) => (
              <article key={item.sector}>
                <header>
                  <div>
                    <span>{item.reportCount}개 리포트</span>
                    <h3>{item.sector}</h3>
                  </div>
                  <em className={`is-${item.signal}`}>
                    {sectorSignalLabels[item.signal] || item.signal}
                  </em>
                </header>
                {item.catalysts.length ? (
                  <div className="is-catalyst">
                    <strong>상승 촉매</strong>
                    <p>{item.catalysts[0]}</p>
                  </div>
                ) : null}
                {item.risks.length ? (
                  <div className="is-risk">
                    <strong>핵심 위험</strong>
                    <p>{item.risks[0]}</p>
                  </div>
                ) : null}
                {item.monitoringConditions.length ? (
                  <small>확인 조건 · {item.monitoringConditions[0]}</small>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {brokerResearch.consensus?.disagreements?.length ? (
        <div className="daily-intelligence-broker-disagreements">
          <strong>의견이 갈리는 주제</strong>
          {brokerResearch.consensus.disagreements.map((item) => (
            <span key={item.topic}>
              {item.topic} · {item.stances.map((stance) => researchStanceLabels[stance] || stance).join(" / ")} · {item.reportCount}건
            </span>
          ))}
        </div>
      ) : null}

      <div className="daily-intelligence-broker-grid">
        {visibleReports.map((report) => (
          <article key={report.reportId || `${report.publisher}-${report.title}`}>
            <header>
              <div>
                <span>
                  <b className={`daily-intelligence-market-scope is-${report.marketScope.toLowerCase()}`}>
                    {researchMarketScopeLabels[report.marketScope] || report.marketScope}
                  </b>
                  {report.publisher}{report.analyst ? ` · ${report.analyst}` : ""}
                </span>
                <h3>{report.title}</h3>
              </div>
              <em className={`is-${report.stance}`}>
                저자 의견 · {researchStanceLabels[report.stance] || report.stance}
              </em>
            </header>
            <p>
              {report.summary || "구조화 분석 대기 중 — 원문은 보관하되 화면에는 재배포하지 않습니다."}
            </p>
            {report.rating.original || report.targetPrice.value !== null ? (
              <div className="daily-intelligence-broker-terms">
                {report.rating.original ? (
                  <span>
                    원문 의견 <strong>{report.rating.original}</strong>
                    {report.rating.normalized !== "not_stated"
                      ? ` · 공통 분류 ${researchStanceLabels[report.rating.normalized] || report.rating.normalized}`
                      : ""}
                  </span>
                ) : null}
                {report.targetPrice.value !== null ? (
                  <span>
                    목표가 <strong>{report.targetPrice.currency || report.baseCurrency} {report.targetPrice.value.toLocaleString()}</strong>
                    {report.targetPrice.asOf ? ` · ${report.targetPrice.asOf.slice(0, 10)} 기준` : ""}
                  </span>
                ) : null}
              </div>
            ) : null}
            {report.keyClaims.length ? (
              <ul>{report.keyClaims.slice(0, 3).map((claim) => <li key={claim}>{claim}</li>)}</ul>
            ) : null}
            {report.catalysts.length || report.risks.length || report.monitoringConditions.length ? (
              <div className="daily-intelligence-broker-evaluation">
                {report.catalysts.length ? (
                  <section className="is-catalyst">
                    <strong>상승 촉매</strong>
                    <ul>{report.catalysts.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                ) : null}
                {report.risks.length ? (
                  <section className="is-risk">
                    <strong>핵심 위험</strong>
                    <ul>{report.risks.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                ) : null}
                {report.monitoringConditions.length ? (
                  <section className="is-monitor">
                    <strong>확인 조건</strong>
                    <ul>{report.monitoringConditions.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                ) : null}
              </div>
            ) : null}
            {report.linkedTelegramEvents.length ? (
              <div className="daily-intelligence-broker-telegram">
                <strong>텔레그램 교차 연결</strong>
                {report.linkedTelegramEvents.map((event) => (
                  <a key={event.eventId} href={event.url} target="_blank" rel="noreferrer">
                    {event.channel || "Telegram"} · {event.title} <ArrowUpRight size={11} />
                  </a>
                ))}
              </div>
            ) : null}
            <footer>
              <span>{[...report.tickers, ...report.sectors].slice(0, 5).join(" · ") || report.reportType}</span>
              {report.source.url ? (
                <a href={report.source.url} target="_blank" rel="noreferrer">
                  원문 링크 <ArrowUpRight size={12} />
                </a>
              ) : <small>{report.source.reference}</small>}
            </footer>
          </article>
        ))}
        {!visibleReports.length ? (
          <p className="daily-intelligence-muted">선택한 시장 구분에 해당하는 리포트가 없습니다.</p>
        ) : null}
      </div>

      <p className="daily-intelligence-panel-note">
        원문·표·이미지는 재배포하지 않습니다. 운영자가 분석 권한을 확인한 자료만 내부 가공하며,
        공개 리포트에는 요약과 출처 링크만 사용합니다.
      </p>
    </section>
  );
}

function GmailResearchStatus({
  gmailResearch,
  senderReviewQueue,
  senderReviewBusy,
  senderReviewError,
  attachmentApprovalQueue,
  attachmentApprovalBusy,
  attachmentApprovalError,
  jobStatus,
  jobBusy,
  jobError,
  pendingPlan,
  onPlan,
  onExecute,
  onCancel,
  onReloadAttachmentApprovals,
  onDecideAttachment,
  onReloadSenderReviews,
  onDecideSender,
}) {
  if (!gmailResearch) return null;
  const collection = gmailResearch.collection || {};
  const connected = Boolean(gmailResearch.configured);
  const senderDomains = gmailResearch.allowlistedSenderDomains || [];
  const candidates = gmailResearch.candidates || [];
  const gmailRun = jobStatus?.run?.jobId === "gmail_refresh"
    ? jobStatus.run
    : null;
  const gmailAnalysisRun = jobStatus?.run?.jobId === "gmail_analyze"
    ? jobStatus.run
    : null;
  const refreshing = gmailRun?.status === "running";
  const analyzing = gmailAnalysisRun?.status === "running";
  const gmailPlanPending = pendingPlan?.job?.id === "gmail_refresh";
  const gmailAnalysisPlanPending = pendingPlan?.job?.id === "gmail_analyze";
  const attachmentItems = attachmentApprovalQueue?.items || [];
  const senderReviewItems = senderReviewQueue?.items || [];
  const senderReasonLabels = {
    sender_not_allowlisted: "허용 목록 밖 발신자",
    sender_excluded: "검토에서 제외한 발신자",
    authentication_failed: "DKIM/DMARC 인증 실패",
    empty_body: "분석 가능한 본문 없음",
  };
  const collectionStatusLabels = {
    ok: "정상 수집",
    ok_with_filtered: "정상 수집 · 정책 필터 적용",
    partial: "일부 수집 · 확인 필요",
    skipped_or_notice: "설정 확인 필요",
    timeout: "시간 초과",
    error: "수집 실패",
    not_run: "미실행",
  };
  return (
    <section
      id="gmail-research-analysis"
      className="daily-intelligence-panel daily-intelligence-wide daily-intelligence-gmail"
    >
      <div className="daily-intelligence-panel-title">
        <div>
          <span>EMAIL RESEARCH</span>
          <h2>Gmail 해외 리서치 수집</h2>
        </div>
        <div className="daily-intelligence-gmail-actions">
          <span className={`daily-intelligence-run-status is-${connected ? "succeeded" : "failed"}`}>
            {connected ? "읽기 전용 연결" : "인증 필요"}
          </span>
          <button
            type="button"
            onClick={() => onPlan("gmail_refresh")}
            disabled={!connected || jobBusy || refreshing || analyzing}
          >
            {refreshing
              ? <LoaderCircle size={15} className="is-spinning" />
              : <RefreshCw size={15} />}
            {refreshing ? "수집 중" : "Gmail 지금 수집"}
          </button>
          <button
            type="button"
            onClick={() => onPlan("gmail_analyze")}
            disabled={!connected || jobBusy || refreshing || analyzing}
          >
            {analyzing
              ? <LoaderCircle size={15} className="is-spinning" />
              : <Sparkles size={15} />}
            {analyzing ? "수집·분석 중" : "Gmail 수집·분석"}
          </button>
        </div>
      </div>
      <div className="daily-intelligence-gmail-status">
        <article>
          <span>연결 상태</span>
          <strong>{connected ? "읽기 전용 연결" : "인증 필요"}</strong>
          <small>메일 전송·삭제·수정 권한 없음</small>
        </article>
        <article>
          <span>수집 라벨</span>
          <strong>{gmailResearch.label || "Stocks"}</strong>
          <small>해당 라벨이 붙은 메일만 확인</small>
        </article>
        <article>
          <span>최근 수집</span>
          <strong>{collection.itemCount || 0}건</strong>
          <small>
            {collectionStatusLabels[collection.status] || collection.status}
            {collection.lastCollectedAt
              ? ` · ${formatGeneratedAt(collection.lastCollectedAt)}`
              : " · 아직 실행되지 않음"}
          </small>
        </article>
        <article>
          <span>허용 발신자</span>
          <strong>{senderDomains.length}개 도메인</strong>
          <small>{senderDomains.join(" · ") || "허용 목록 설정 필요"}</small>
        </article>
      </div>
      {candidates.length ? (
        <div className="daily-intelligence-gmail-candidates">
          <div className="daily-intelligence-subsection-heading">
            <div>
              <span>COLLECTED RESEARCH</span>
              <h3>최근 해외 리서치 메일</h3>
            </div>
            <small>{candidates.length}건</small>
          </div>
          <div className="daily-intelligence-gmail-candidate-grid">
            {candidates.map((candidate) => (
              <article key={candidate.id}>
                <div className="daily-intelligence-gmail-candidate-meta">
                  <span>{candidate.publisher || "발행사 확인 필요"}</span>
                  <span>{candidate.marketScope || "GLOBAL"}</span>
                  <span>
                    {candidate.analysisState === "analyzed" ? "분석 완료" : "구조화 분석 준비"}
                  </span>
                </div>
                <h4>{candidate.title || "제목 없음"}</h4>
                <p>
                  {candidate.summary
                    || "메일 본문은 재배포하지 않고 기존 공식 근거 검증 작업에서 한국어 요약·핵심 주장·리스크를 추출합니다."}
                </p>
                {candidate.keyClaims?.length ? (
                  <div className="daily-intelligence-gmail-insight">
                    <strong>핵심 주장</strong>
                    <ul>
                      {candidate.keyClaims.slice(0, 3).map((claim) => (
                        <li key={claim}>{claim}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {candidate.catalysts?.length || candidate.risks?.length ? (
                  <div className="daily-intelligence-gmail-signal-row">
                    {candidate.catalysts?.length ? (
                      <span><strong>촉매</strong>{candidate.catalysts[0]}</span>
                    ) : null}
                    {candidate.risks?.length ? (
                      <span className="is-risk"><strong>위험</strong>{candidate.risks[0]}</span>
                    ) : null}
                  </div>
                ) : null}
                {candidate.monitoringConditions?.length ? (
                  <p className="daily-intelligence-gmail-monitor">
                    <strong>다음 확인</strong> {candidate.monitoringConditions[0]}
                  </p>
                ) : null}
                {candidate.analyzedAttachments?.length ? (
                  <div className="daily-intelligence-gmail-attachment-analysis">
                    <div className="daily-intelligence-gmail-attachment-analysis-heading">
                      <div>
                        <span>ATTACHMENT RESEARCH</span>
                        <strong>첨부 PDF 분석</strong>
                      </div>
                      <small>{candidate.analyzedAttachments.length}건</small>
                    </div>
                    {candidate.analyzedAttachments.map((attachment) => (
                      <section key={attachment.attachmentKey || attachment.id}>
                        <div className="daily-intelligence-gmail-attachment-title">
                          <strong>{attachment.filename || attachment.title || "첨부 리포트"}</strong>
                          <span>분석 완료</span>
                        </div>
                        <p>
                          {attachment.summary
                            || "첨부 PDF 구조화 분석은 완료됐으나 표시할 요약이 없습니다."}
                        </p>
                        {attachment.keyClaims?.length ? (
                          <div className="daily-intelligence-gmail-insight">
                            <strong>리포트 핵심 주장</strong>
                            <ul>
                              {attachment.keyClaims.slice(0, 3).map((claim) => (
                                <li key={claim}>{claim}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {attachment.catalysts?.length || attachment.risks?.length ? (
                          <div className="daily-intelligence-gmail-signal-row">
                            {attachment.catalysts?.length ? (
                              <span><strong>촉매</strong>{attachment.catalysts[0]}</span>
                            ) : null}
                            {attachment.risks?.length ? (
                              <span className="is-risk">
                                <strong>위험</strong>{attachment.risks[0]}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {attachment.monitoringConditions?.length ? (
                          <p className="daily-intelligence-gmail-monitor">
                            <strong>다음 확인</strong> {attachment.monitoringConditions[0]}
                          </p>
                        ) : null}
                        {attachment.sectors?.length || attachment.tickers?.length ? (
                          <div className="daily-intelligence-gmail-attachment-tags">
                            {[...(attachment.sectors || []), ...(attachment.tickers || [])]
                              .slice(0, 6)
                              .map((tag) => <span key={tag}>{tag}</span>)}
                          </div>
                        ) : null}
                      </section>
                    ))}
                  </div>
                ) : null}
                <div className="daily-intelligence-gmail-candidate-footer">
                  <span>
                    {candidate.analyst ? `${candidate.analyst} · ` : ""}
                    {formatGeneratedAt(candidate.publishedAt)}
                  </span>
                  {candidate.attachmentReviewRequired ? (
                    <strong>
                      PDF {candidate.pdfAttachmentCount || 1}개 · 별도 승인 필요
                    </strong>
                  ) : (
                    <strong>본문 분석 가능</strong>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <p className="daily-intelligence-muted daily-intelligence-gmail-empty">
          아직 수집된 해외 리서치 메일이 없습니다. 뉴스레터 도착 후
          <strong> Gmail 지금 수집</strong>을 실행하세요.
        </p>
      )}
      {attachmentItems.length ? (
        <div className="daily-intelligence-gmail-attachment-approvals">
          <div className="daily-intelligence-subsection-heading">
            <div>
              <span>PDF APPROVAL</span>
              <h3>Gmail PDF 첨부 승인 대기</h3>
            </div>
            <div className="daily-intelligence-approval-title-actions">
              <small>
                대기 {attachmentApprovalQueue?.counts?.pending || 0} ·
                승인 {attachmentApprovalQueue?.counts?.approved || 0} ·
                완료 {attachmentApprovalQueue?.counts?.ready || 0} ·
                제외 {attachmentApprovalQueue?.counts?.excluded || 0}
              </small>
              <button
                type="button"
                className="daily-intelligence-approval-text-button"
                onClick={onReloadAttachmentApprovals}
                disabled={attachmentApprovalBusy}
              >
                <RefreshCw size={14} className={attachmentApprovalBusy ? "is-spinning" : ""} />
                새로고침
              </button>
            </div>
          </div>
          {attachmentApprovalError ? (
            <p className="daily-intelligence-approval-error">
              <AlertTriangle size={15} /> {attachmentApprovalError}
            </p>
          ) : null}
          <div className="daily-intelligence-approval-list">
            {attachmentItems.map((item) => (
              <article key={item.attachmentKey}>
                <div>
                  <span>{item.publisher || "발행사 확인 필요"} · PDF 첨부</span>
                  <h3>{item.filename}</h3>
                  <small>
                    {item.messageTitle || "메일 제목 없음"} ·
                    {item.size ? ` ${Math.max(1, Math.round(item.size / 1024))}KB` : " 크기 미확인"}
                  </small>
                </div>
                <div className="daily-intelligence-approval-actions">
                  <span className="daily-intelligence-approval-status">
                    <span>
                      {item.state === "approved"
                        ? "분석 승인"
                        : item.state === "ready"
                          ? "분석 완료"
                        : item.state === "excluded"
                          ? "분석 제외"
                          : "승인 대기"}
                    </span>
                    <small>
                      {item.state === "approved"
                        ? "다음 Gmail 수집·분석에서 다운로드"
                        : item.state === "ready"
                          ? "PDF 구조화 분석 산출물 확인됨"
                        : "원문은 승인 전 다운로드하지 않음"}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="is-approve"
                    onClick={() => onDecideAttachment(item.attachmentKey, "approved")}
                    disabled={
                      attachmentApprovalBusy
                      || item.state === "approved"
                      || item.state === "ready"
                    }
                  >
                    <ShieldCheck size={14} /> 분석 승인
                  </button>
                  <button
                    type="button"
                    className="is-exclude"
                    onClick={() => onDecideAttachment(item.attachmentKey, "excluded")}
                    disabled={attachmentApprovalBusy || item.state === "excluded"}
                  >
                    <X size={14} /> 제외
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className="daily-intelligence-panel-note">
            승인만으로는 다운로드하지 않습니다. 결정 후 <strong>Gmail 수집·분석</strong>을
            실행하면 승인된 PDF만 내려받아 구조화 분석합니다.
          </p>
        </div>
      ) : null}
      {senderReviewItems.length ? (
        <div className="daily-intelligence-gmail-attachment-approvals daily-intelligence-gmail-sender-reviews">
          <div className="daily-intelligence-subsection-heading">
            <div>
              <span>SENDER REVIEW</span>
              <h3>차단 발신자 검토함</h3>
            </div>
            <div className="daily-intelligence-approval-title-actions">
              <small>
                대기 {senderReviewQueue?.counts?.pending || 0} ·
                허용 {senderReviewQueue?.counts?.approved || 0} ·
                제외 {senderReviewQueue?.counts?.excluded || 0}
              </small>
              <button
                type="button"
                className="daily-intelligence-approval-text-button"
                onClick={onReloadSenderReviews}
                disabled={senderReviewBusy}
              >
                <RefreshCw size={14} className={senderReviewBusy ? "is-spinning" : ""} />
                새로고침
              </button>
            </div>
          </div>
          {senderReviewError ? (
            <p className="daily-intelligence-approval-error">
              <AlertTriangle size={15} /> {senderReviewError}
            </p>
          ) : null}
          <div className="daily-intelligence-approval-list">
            {senderReviewItems.map((item) => (
              <article key={item.senderKey}>
                <div>
                  <span>
                    {senderReasonLabels[item.reason] || item.reason || "차단 사유 확인 필요"}
                    {item.messageCount > 1 ? ` · ${item.messageCount}건` : ""}
                  </span>
                  <h3>{item.senderName || item.senderEmail}</h3>
                  <small>{item.senderEmail} · {item.latestSubject || "제목 없음"}</small>
                </div>
                <div className="daily-intelligence-approval-actions">
                  <span className="daily-intelligence-approval-status">
                    <span>
                      {item.state === "approved"
                        ? "수집 허용"
                        : item.state === "excluded"
                          ? "계속 제외"
                          : "검토 대기"}
                    </span>
                    <small>
                      {item.reviewable
                        ? "정확한 메일주소 단위로만 허용"
                        : "보안 또는 본문 문제로 허용 불가"}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="is-approve"
                    onClick={() => onDecideSender(item.senderKey, "approved")}
                    disabled={senderReviewBusy || !item.reviewable || item.state === "approved"}
                  >
                    <ShieldCheck size={14} /> 발신자 허용
                  </button>
                  <button
                    type="button"
                    className="is-exclude"
                    onClick={() => onDecideSender(item.senderKey, "excluded")}
                    disabled={senderReviewBusy || item.state === "excluded"}
                  >
                    <X size={14} /> 계속 제외
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className="daily-intelligence-panel-note">
            허용해도 DKIM/DMARC 인증을 다시 통과해야 수집됩니다. 인증 실패와 빈 본문은 허용할 수 없습니다.
          </p>
        </div>
      ) : null}
      <p className="daily-intelligence-panel-note">
        발신자 인증을 통과한 공식 메일만 후보로 수집합니다. PDF 첨부파일은 자동 분석하지 않고
        별도 승인 대기로 남깁니다.
      </p>
      {gmailPlanPending ? (
        <div className="daily-intelligence-confirmation">
          <div>
            <span>Gmail 리서치 수집 실행 확인</span>
            <h3>{pendingPlan.job?.label}</h3>
            <p>{pendingPlan.job?.effect}</p>
            <dl>
              <div><dt>실행</dt><dd>{pendingPlan.commandPreview}</dd></div>
              <div><dt>외부 변경</dt><dd>없음 · 읽기 전용 수집 및 로컬 갱신</dd></div>
            </dl>
          </div>
          <div className="daily-intelligence-confirmation-actions">
            <button type="button" onClick={onCancel} disabled={jobBusy}>
              <X size={15} /> 취소
            </button>
            <button type="button" onClick={onExecute} disabled={jobBusy}>
              {jobBusy
                ? <LoaderCircle size={15} className="is-spinning" />
                : <Play size={15} />}
              확인 후 수집
            </button>
          </div>
        </div>
      ) : null}
      {gmailAnalysisPlanPending ? (
        <div className="daily-intelligence-confirmation">
          <div>
            <span>해외 리서치 수집·구조화 분석 실행 확인</span>
            <h3>{pendingPlan.job?.label}</h3>
            <p>{pendingPlan.job?.effect}</p>
            <dl>
              <div><dt>실행</dt><dd>{pendingPlan.commandPreview}</dd></div>
              <div><dt>외부 처리</dt><dd>Gmail 읽기 전용 수집 후 승인된 메일 본문을 OpenAI API로 구조화 분석</dd></div>
              <div><dt>외부 발행</dt><dd>없음 · 로컬 분석 산출물만 갱신</dd></div>
            </dl>
          </div>
          <div className="daily-intelligence-confirmation-actions">
            <button type="button" onClick={onCancel} disabled={jobBusy}>
              <X size={15} /> 취소
            </button>
            <button type="button" onClick={onExecute} disabled={jobBusy}>
              {jobBusy
                ? <LoaderCircle size={15} className="is-spinning" />
                : <Sparkles size={15} />}
              확인 후 분석
            </button>
          </div>
        </div>
      ) : null}
      {jobError && (gmailPlanPending || gmailAnalysisPlanPending || gmailRun || gmailAnalysisRun) ? (
        <p className="daily-intelligence-operation-error">{jobError}</p>
      ) : null}
    </section>
  );
}

function BrokerResearchApprovalQueue({
  approvalQueue,
  busy,
  error,
  onReload,
  onDecide,
}) {
  const items = approvalQueue?.items || [];
  const pendingItems = items.filter((item) => item.state === "pending");
  const decidedItems = items.filter((item) => item.state === "approved" || item.state === "excluded");
  const counts = approvalQueue?.counts || {};
  return (
    <section
      id="broker-research-analysis"
      className="daily-intelligence-panel daily-intelligence-approval-queue daily-intelligence-wide"
    >
      <div className="daily-intelligence-panel-title">
        <div>
          <span>DRIVE APPROVAL QUEUE</span>
          <h2>애널리스트 PDF 승인 대기</h2>
        </div>
        <div className="daily-intelligence-approval-title-actions">
          <span className="daily-intelligence-count">{counts.pending || 0}</span>
          <button type="button" onClick={onReload} disabled={busy} aria-label="승인 대기 새로고침">
            <RefreshCw size={15} className={busy ? "is-spinning" : ""} />
          </button>
        </div>
      </div>

      {error ? <p className="daily-intelligence-approval-error">{error}</p> : null}
      {busy && !approvalQueue ? (
        <p className="daily-intelligence-muted">Drive 승인 대기 목록을 불러오는 중입니다.</p>
      ) : pendingItems.length ? (
        <div className="daily-intelligence-approval-list">
          {pendingItems.map((item) => (
            <article key={item.fileId}>
              <div>
                <span>
                  <b className={`daily-intelligence-market-scope is-${String(item.inferred.market_scope || "UNKNOWN").toLowerCase()}`}>
                    {researchMarketScopeLabels[item.inferred.market_scope] || "미분류"}
                  </b>
                  {item.inferred.publisher} · {item.inferred.published_at.slice(0, 10)}
                </span>
                <h3>{item.inferred.title}</h3>
                <small>
                  {item.inferred.research_path?.length
                    ? `${item.inferred.research_path.join(" / ")} · `
                    : ""}
                  {item.fileName}
                </small>
              </div>
              <div className="daily-intelligence-approval-actions">
                <a href={item.driveUrl} target="_blank" rel="noreferrer">
                  원문 <ArrowUpRight size={12} />
                </a>
                <button
                  type="button"
                  className="is-approve"
                  disabled={busy}
                  onClick={() => onDecide(item.fileId, "approved")}
                >
                  <CheckCircle2 size={14} /> 분석 승인
                </button>
                <button
                  type="button"
                  className="is-exclude"
                  disabled={busy}
                  onClick={() => onDecide(item.fileId, "excluded")}
                >
                  <X size={14} /> 제외
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="daily-intelligence-muted">승인 대기 중인 Drive 리포트가 없습니다.</p>
      )}

      <div className="daily-intelligence-approval-status">
        <span>메타파일 확인 {counts.ready || 0}</span>
        <span>화면 승인 {counts.approved || 0}</span>
        <span>제외 {counts.excluded || 0}</span>
        {decidedItems.length ? <small>결정은 같은 파일에 대해 다시 변경할 수 있습니다.</small> : null}
      </div>
      <p className="daily-intelligence-panel-note">
        분석 승인은 내부 요약·분석만 허용하며 원문 재배포는 허용하지 않습니다.
        승인 후 <strong>공식 근거 검증 실행</strong>을 누르면 승인 자료를 최대 25건까지 5건 단위로
        분석하며, 이미 분석한 PDF는 캐시에서 재사용합니다.
      </p>
    </section>
  );
}

function ResearchIntelligenceShortcuts({ telegramSources, brokerResearch, gmailResearch }) {
  const telegramPosts = telegramSources?.deduplication?.rawPostCount || 0;
  const telegramClusters = telegramSources?.deduplication?.eventClusterCount || 0;
  const brokerReports = brokerResearch?.summary?.selectedReportCount || 0;
  const brokerStructured = brokerResearch?.summary?.structuredReportCount || 0;
  const gmailCollected = gmailResearch?.collection?.itemCount || 0;
  const gmailCandidates = gmailResearch?.candidates || [];
  const gmailAnalyzed = gmailCandidates.filter(
    (candidate) => candidate.analysisState === "analyzed"
  ).length;
  const gmailPdfPending = gmailCandidates.reduce(
    (count, candidate) => count + (
      candidate.attachmentReviewRequired
        ? Number(candidate.pdfAttachmentCount || 1)
        : 0
    ),
    0
  );
  return (
    <nav className="daily-intelligence-research-shortcuts" aria-label="리서치 분석 바로가기">
      <a href="#gmail-research-analysis">
        <Mail size={19} />
        <span>
          <small>EMAIL RESEARCH</small>
          <strong>Gmail 해외 리서치 분석</strong>
          <em>
            {gmailCollected}건 수집 · {gmailAnalyzed}건 분석
            {gmailPdfPending ? ` · PDF 승인 대기 ${gmailPdfPending}건` : ""}
          </em>
        </span>
      </a>
      <a href="#broker-research-analysis">
        <FileText size={19} />
        <span>
          <small>PDF RESEARCH</small>
          <strong>증권사 PDF 리포트 분석</strong>
          <em>{brokerReports}건 수집 · {brokerStructured}건 구조화</em>
        </span>
      </a>
      <a href="#telegram-intelligence">
        <Radio size={19} />
        <span>
          <small>TELEGRAM INTELLIGENCE</small>
          <strong>텔레그램 사건 분석</strong>
          <em>{telegramPosts}개 글 · {telegramClusters}개 사건</em>
        </span>
      </a>
    </nav>
  );
}

function MarketSectorsWorkspace({
  report,
  decisionGate,
  scoreboard,
  marketInternals,
  sectorMetrics,
  koreaStatus,
  busy,
  onReload,
  onOpenDailyIntelligence,
}) {
  return (
    <div className="daily-intelligence-shell market-sectors-shell">
      <header className="daily-intelligence-header">
        <div>
          <span className="daily-intelligence-eyebrow">MARKET &amp; SECTOR INTELLIGENCE</span>
          <h1>시장·섹터</h1>
          <p>{report.title} · 시장 구조와 한국시장 전달 경로</p>
        </div>
        <div className="daily-intelligence-header-actions">
          <button
            type="button"
            className="daily-intelligence-refresh"
            onClick={onOpenDailyIntelligence}
          >
            <ChevronLeft size={16} />
            Daily Intelligence
          </button>
          <button
            type="button"
            className="daily-intelligence-refresh"
            onClick={onReload}
            disabled={busy}
          >
            <RefreshCw size={16} className={busy ? "is-spinning" : ""} />
            새로고침
          </button>
        </div>
      </header>

      <section className="daily-intelligence-metrics" aria-label="시장·섹터 상태">
        <MetricCard
          label="시장 체제"
          value={
            decisionGate?.status === "blocked"
              ? "판단 보류"
              : statusLabels[scoreboard?.regime?.label] || scoreboard?.regime?.label || "확인 필요"
          }
          detail={
            Number.isFinite(scoreboard?.regime?.confidence)
              ? `판단 신뢰도 ${Math.round(scoreboard.regime.confidence * 100)}%`
              : "정량 근거 확인 필요"
          }
          tone={decisionGate?.status === "blocked" ? "warning" : "positive"}
          icon={Sparkles}
        />
        <MetricCard
          label="핵심 가격 커버리지"
          value={`${marketInternals?.coverage?.available || 0}/${marketInternals?.coverage?.required || 0}`}
          detail="시장 내부 구조 판단에 사용되는 가격 근거"
          tone={
            Number(marketInternals?.coverage?.required || 0) > 0
            && Number(marketInternals?.coverage?.available || 0)
              >= Number(marketInternals?.coverage?.required || 0)
              ? "positive"
              : "warning"
          }
          icon={Database}
        />
        <MetricCard
          label="한국시장 연결"
          value={statusLabels[koreaStatus] || koreaStatus || "확인 필요"}
          detail={`${report.koreaConnection.companyTransmissions?.length || 0}개 미국 기업 전달 경로`}
          tone={koreaStatus === "ready" || koreaStatus === "sufficient" ? "positive" : "warning"}
          icon={Landmark}
        />
      </section>

      <main className="daily-intelligence-grid market-sectors-grid">
        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>MARKET SCOREBOARD</span>
              <h2>시장 판단 스코어보드</h2>
            </div>
            <StatusPill
              status={
                decisionGate?.status === "blocked"
                  ? "판단 보류"
                  : scoreboard?.regime?.label || "unknown"
              }
            />
          </div>
          <Scoreboard scoreboard={scoreboard} />
        </section>

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>SECTOR &amp; STYLE LEADERSHIP</span>
              <h2>섹터와 스타일 리더십</h2>
            </div>
          </div>
          <SectorLeadership marketInternals={marketInternals} />
        </section>

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>STRUCTURAL SECTOR RADAR</span>
              <h2>미래 주도 섹터 선행지표</h2>
            </div>
            <span className="daily-intelligence-count">{sectorMetrics?.availableCount || 0}</span>
          </div>
          <SectorMetrics sectorMetrics={sectorMetrics} />
        </section>

        <section className="daily-intelligence-panel">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>MARKET STRUCTURE</span>
              <h2>시장 내부 구조</h2>
            </div>
          </div>
          <div className="daily-intelligence-finding-list">
            {report.findings.map((finding) => (
              <article key={`${finding.title}-${finding.body}`}>
                <h3>{finding.title}</h3>
                <MarkdownText text={finding.body} />
              </article>
            ))}
          </div>
        </section>

        <section className="daily-intelligence-panel">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>KOREA TRANSMISSION</span>
              <h2>한국시장 연결</h2>
            </div>
            <StatusPill status={koreaStatus} />
          </div>
          <MarkdownText text={report.koreaConnection.summary} />
          {report.koreaConnection.companyTransmissions?.length ? (
            <div className="daily-intelligence-korea-transmissions">
              {report.koreaConnection.companyTransmissions.map((transmission) => (
                <article key={`${transmission.sourceTicker}-${transmission.sectorNameKo}`}>
                  <header>
                    <div>
                      <span>{transmission.sourceTicker} → 한국</span>
                      <strong>{transmission.sectorNameKo || "산업 연결"}</strong>
                    </div>
                    <em className={transmission.marketConfirmationStatus === "ready" ? "is-ready" : "is-blocked"}>
                      {transmission.marketConfirmationStatus === "ready" ? "시장 확인" : "시장 확인 대기"}
                    </em>
                  </header>
                  {transmission.sourceSignalLabel ? (
                    <p><b>미국 기업 신호</b> {transmission.sourceSignalLabel}</p>
                  ) : null}
                  <ul>
                    {(transmission.targets || []).map((target) => (
                      <li key={`${transmission.sourceTicker}-${target.ticker}`}>
                        <div>
                          <strong>{target.ticker} · {target.companyName}</strong>
                          <span className={`is-${target.classification || "watch_candidate"}`}>
                            {target.classificationLabel || "관찰 후보"}
                          </span>
                        </div>
                        <p>{target.reason}</p>
                        {target.nextRequiredEvidence?.length ? (
                          <small>다음 근거: {target.nextRequiredEvidence.join(" · ")}</small>
                        ) : null}
                        {target.sourceUrls?.[0] ? (
                          <a href={target.sourceUrls[0]} target="_blank" rel="noreferrer">
                            공식 근거 열기 <ArrowUpRight size={12} />
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function CompanyResearchWorkspace({
  report,
  decisionChain,
  thesisMemory,
  stockCandidates,
  brokerResearch,
  brokerResearchHistory,
  thesisMemoryBusy,
  thesisMemoryError,
  watchlistQuickAddBusy,
  watchlistQuickAddError,
  busy,
  onReload,
  onOpenDailyIntelligence,
  onTrackStock,
  onAddWatchlist,
}) {
  const brokerResearchDate = (
    brokerResearchHistory?.selectedDate || brokerResearch?.reportDate || report.reportDate
  );
  const candidatePool = decisionChain?.ideaFunnel?.candidatePool || [];
  const screenedCandidates = stockCandidates?.candidates || [];
  const earningsCompanies = report.earningsWatch?.companies || [];
  const filingCompanies = report.companyFilings?.companies || [];

  return (
    <div className="daily-intelligence-shell company-research-shell">
      <header className="daily-intelligence-header">
        <div>
          <span className="daily-intelligence-eyebrow">COMPANY RESEARCH</span>
          <h1>기업 리서치</h1>
          <p>{report.title} · 후보 비교, 실적 변화, 후속 조사 연결</p>
        </div>
        <div className="daily-intelligence-header-actions">
          <button
            type="button"
            className="daily-intelligence-refresh"
            onClick={onOpenDailyIntelligence}
          >
            <ChevronLeft size={16} />
            Daily Intelligence
          </button>
          <button
            type="button"
            className="daily-intelligence-refresh"
            onClick={onReload}
            disabled={busy}
          >
            <RefreshCw size={16} className={busy ? "is-spinning" : ""} />
            새로고침
          </button>
        </div>
      </header>

      <section className="daily-intelligence-metrics" aria-label="기업 리서치 현황">
        <MetricCard
          label="오늘의 비교 후보"
          value={`${candidatePool.length}개`}
          detail="시장→섹터→종목 연결 보드에서 선별"
          tone={candidatePool.length ? "positive" : "neutral"}
          icon={CircleDashed}
        />
        <MetricCard
          label="정량 스크린 통과"
          value={`${screenedCandidates.length}개`}
          detail="미국 개별주 분석 후보"
          tone={screenedCandidates.length ? "positive" : "neutral"}
          icon={CheckCircle2}
        />
        <MetricCard
          label="실적 추적"
          value={`${filingCompanies.length}개`}
          detail="SEC 10-Q·10-K 자동 요약"
          tone={filingCompanies.length ? "positive" : "neutral"}
          icon={FileText}
        />
      </section>

      <main className="daily-intelligence-grid company-research-grid">
        <StockDecisionComparison
          shortlists={brokerResearch?.consensus?.sectorStockShortlists}
          candidatePool={candidatePool}
          thesisMemory={thesisMemory}
          brokerResearchDate={brokerResearchDate}
          busy={thesisMemoryBusy || watchlistQuickAddBusy}
          error={thesisMemoryError || watchlistQuickAddError}
          onTrackStock={onTrackStock}
          onAddWatchlist={onAddWatchlist}
        />

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>SEC FILING INTELLIGENCE</span>
              <h2>미국 주목기업 재무·사업보고서 요약</h2>
            </div>
            <span className="daily-intelligence-count">{filingCompanies.length}</span>
          </div>
          <p className="daily-intelligence-panel-note">
            SEC XBRL 수치는 자동 반영하고, AI 문서 해석은 공식 공시 범위 안에서만 제공합니다. 투자 가설 변경은 승인 전까지 보류됩니다.
          </p>
          <CompanyFilingSummaries companyFilings={report.companyFilings} />
        </section>

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>US EQUITY CANDIDATES</span>
              <h2>미국 개별주 분석 후보</h2>
            </div>
            <span className="daily-intelligence-count">{screenedCandidates.length}</span>
          </div>
          <StockCandidates stockCandidates={stockCandidates} />
        </section>

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>EARNINGS INTELLIGENCE</span>
              <h2>실적·가이던스·추정치 변화</h2>
            </div>
            <span className="daily-intelligence-count">{earningsCompanies.length}</span>
          </div>
          <p className="daily-intelligence-panel-note">
            전망치는 제3자 전망치, 가이던스는 회사 주장, 실제치는 공식 원문 확인 값으로 구분합니다.
          </p>
          <EarningsWatch earningsWatch={report.earningsWatch} />
        </section>
      </main>
    </div>
  );
}

function ThesisJournalWorkspace({
  report,
  thesisMemory,
  busy,
  thesisMemoryBusy,
  thesisMemoryError,
  onReload,
  onOpenDailyIntelligence,
  onSync,
  onReviewProposal,
  onRecordPortfolioResponse,
  onReviewPortfolioRuleSuggestion,
  onReviewPortfolioActiveRule,
  onReviewMonthlyGoal,
}) {
  const calibration = thesisMemory?.weeklyCalibration;
  const responseCalibration = thesisMemory?.portfolioResponseCalibration;
  const activeRecords = thesisMemory?.activeRecords || [];
  const changedTheses = calibration?.alerts || [];
  const activeGoals = responseCalibration?.monthlyReview?.goals?.activeGoals || [];

  return (
    <div className="daily-intelligence-shell thesis-journal-shell">
      <header className="daily-intelligence-header">
        <div>
          <span className="daily-intelligence-eyebrow">THESIS &amp; DECISION JOURNAL</span>
          <h1>투자 가설·판단 복기</h1>
          <p>{report.title} · 가설의 생성부터 반증, 판단 습관 교정까지 추적</p>
        </div>
        <div className="daily-intelligence-header-actions">
          <button
            type="button"
            className="daily-intelligence-refresh"
            onClick={onOpenDailyIntelligence}
          >
            <ChevronLeft size={16} />
            Daily Intelligence
          </button>
          <button
            type="button"
            className="daily-intelligence-refresh"
            onClick={onReload}
            disabled={busy}
          >
            <RefreshCw size={16} className={busy ? "is-spinning" : ""} />
            새로고침
          </button>
        </div>
      </header>

      <section className="daily-intelligence-metrics" aria-label="투자 가설과 판단 복기 현황">
        <MetricCard
          label="활성 투자 가설"
          value={`${activeRecords.length}개`}
          detail={`누적 ${thesisMemory?.recordCount || 0}개`}
          tone={activeRecords.length ? "positive" : "neutral"}
          icon={Database}
        />
        <MetricCard
          label="최근 판정 변화"
          value={`${changedTheses.length}건`}
          detail="가설 확인·반증 변화"
          tone={changedTheses.length ? "warning" : "positive"}
          icon={AlertTriangle}
        />
        <MetricCard
          label="진행 중 개선 목표"
          value={`${activeGoals.length}개`}
          detail="월간 판단 습관 교정"
          tone={activeGoals.length ? "positive" : "neutral"}
          icon={CheckCircle2}
        />
      </section>

      <main className="daily-intelligence-grid thesis-journal-grid">
        <ThesisOutcomeAlerts calibration={calibration} />

        <DecisionCoach memory={thesisMemory} />

        <InvestmentThesisMemory
          memory={thesisMemory}
          busy={thesisMemoryBusy}
          error={thesisMemoryError}
          onSync={onSync}
          onReviewProposal={onReviewProposal}
          onRecordPortfolioResponse={onRecordPortfolioResponse}
          onReviewPortfolioRuleSuggestion={onReviewPortfolioRuleSuggestion}
          onReviewPortfolioActiveRule={onReviewPortfolioActiveRule}
          onReviewMonthlyGoal={onReviewMonthlyGoal}
        />
      </main>
    </div>
  );
}

export default function DailyIntelligenceView({
  mode = "reader",
  onOpenOperations,
  onOpenDailyIntelligence,
  onOpenMarketSectors,
  onOpenCompanyResearch,
  onOpenThesisJournal,
  onOpenInstitutionalPortfolio,
}) {
  const operationsMode = mode === "operations";
  const marketSectorsMode = mode === "market-sectors";
  const companyResearchMode = mode === "company-research";
  const thesisJournalMode = mode === "thesis-journal";
  const {
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
    reviewRiskThesisProposal,
    recordRiskPortfolioResponse,
    reviewPortfolioResponseRuleSuggestion,
    reviewPortfolioResponseActiveRule,
    reviewMonthlyDecisionGoalProposal,
    updatePortfolioRiskFollowUp,
  } = useDailyIntelligenceController();
  const report = snapshot?.report;
  const pipeline = snapshot?.pipeline;
  const decisionGate = snapshot?.decisionGate;
  const decisionChain = snapshot?.decisionChain;
  const thesisMemory = snapshot?.thesisMemory;
  const scoreboard = snapshot?.scoreboard;
  const marketInternals = snapshot?.marketInternals;
  const sectorMetrics = snapshot?.sectorMetrics;
  const stockCandidates = snapshot?.stockCandidates;
  const portfolioImpact = snapshot?.portfolioImpact;
  const telegramSources = snapshot?.telegramSources;
  const gmailResearch = snapshot?.gmailResearch;
  const brokerResearch = snapshot?.brokerResearch;
  const brokerResearchHistory = snapshot?.brokerResearchHistory;
  const brokerResearchIndex = snapshot?.brokerResearchIndex;
  const [brokerApprovalQueue, setBrokerApprovalQueue] = React.useState(null);
  const [brokerApprovalBusy, setBrokerApprovalBusy] = React.useState(false);
  const [brokerApprovalError, setBrokerApprovalError] = React.useState("");
  const [gmailAttachmentApprovalQueue, setGmailAttachmentApprovalQueue] = React.useState(null);
  const [gmailAttachmentApprovalBusy, setGmailAttachmentApprovalBusy] = React.useState(false);
  const [gmailAttachmentApprovalError, setGmailAttachmentApprovalError] = React.useState("");
  const [gmailSenderReviewQueue, setGmailSenderReviewQueue] = React.useState(null);
  const [gmailSenderReviewBusy, setGmailSenderReviewBusy] = React.useState(false);
  const [gmailSenderReviewError, setGmailSenderReviewError] = React.useState("");

  const loadBrokerApprovalQueue = React.useCallback(async () => {
    setBrokerApprovalBusy(true);
    setBrokerApprovalError("");
    try {
      const response = await fetch("/api/pb-daily-intelligence/broker-approvals", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setBrokerApprovalQueue(payload);
    } catch (approvalError) {
      setBrokerApprovalError(approvalError.message || "승인 대기 목록을 불러오지 못했습니다.");
    } finally {
      setBrokerApprovalBusy(false);
    }
  }, []);

  const decideBrokerReport = React.useCallback(async (fileId, decision) => {
    setBrokerApprovalBusy(true);
    setBrokerApprovalError("");
    try {
      const response = await fetch("/api/pb-daily-intelligence/broker-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, decision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setBrokerApprovalQueue(payload);
    } catch (approvalError) {
      setBrokerApprovalError(approvalError.message || "승인 결정을 저장하지 못했습니다.");
    } finally {
      setBrokerApprovalBusy(false);
    }
  }, []);

  const loadGmailAttachmentApprovalQueue = React.useCallback(async () => {
    setGmailAttachmentApprovalBusy(true);
    setGmailAttachmentApprovalError("");
    try {
      const response = await fetch(
        "/api/pb-daily-intelligence/gmail-attachment-approvals",
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setGmailAttachmentApprovalQueue(payload);
    } catch (approvalError) {
      setGmailAttachmentApprovalError(
        approvalError.message || "Gmail 첨부 승인 목록을 불러오지 못했습니다.",
      );
    } finally {
      setGmailAttachmentApprovalBusy(false);
    }
  }, []);

  const decideGmailAttachment = React.useCallback(async (attachmentKey, decision) => {
    setGmailAttachmentApprovalBusy(true);
    setGmailAttachmentApprovalError("");
    try {
      const response = await fetch(
        "/api/pb-daily-intelligence/gmail-attachment-approvals",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachmentKey, decision }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setGmailAttachmentApprovalQueue(payload);
    } catch (approvalError) {
      setGmailAttachmentApprovalError(
        approvalError.message || "Gmail 첨부 승인 결정을 저장하지 못했습니다.",
      );
    } finally {
      setGmailAttachmentApprovalBusy(false);
    }
  }, []);

  const loadGmailSenderReviewQueue = React.useCallback(async () => {
    setGmailSenderReviewBusy(true);
    setGmailSenderReviewError("");
    try {
      const response = await fetch(
        "/api/pb-daily-intelligence/gmail-sender-reviews",
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setGmailSenderReviewQueue(payload);
    } catch (reviewError) {
      setGmailSenderReviewError(
        reviewError.message || "Gmail 차단 발신자 검토함을 불러오지 못했습니다.",
      );
    } finally {
      setGmailSenderReviewBusy(false);
    }
  }, []);

  const decideGmailSender = React.useCallback(async (senderKey, decision) => {
    const actionLabel = decision === "approved" ? "이 발신자를 수집 허용" : "이 발신자를 계속 제외";
    if (!window.confirm(`${actionLabel}할까요?`)) return;
    setGmailSenderReviewBusy(true);
    setGmailSenderReviewError("");
    try {
      const response = await fetch(
        "/api/pb-daily-intelligence/gmail-sender-reviews",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ senderKey, decision }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setGmailSenderReviewQueue(payload);
    } catch (reviewError) {
      setGmailSenderReviewError(
        reviewError.message || "Gmail 발신자 검토 결정을 저장하지 못했습니다.",
      );
    } finally {
      setGmailSenderReviewBusy(false);
    }
  }, []);

  React.useEffect(() => {
    if (!operationsMode) return;
    void loadBrokerApprovalQueue();
  }, [loadBrokerApprovalQueue, operationsMode]);

  React.useEffect(() => {
    if (!operationsMode) return;
    void loadGmailAttachmentApprovalQueue();
  }, [
    loadGmailAttachmentApprovalQueue,
    gmailResearch?.collection?.lastCollectedAt,
    operationsMode,
  ]);

  React.useEffect(() => {
    if (!operationsMode) return;
    void loadGmailSenderReviewQueue();
  }, [
    loadGmailSenderReviewQueue,
    gmailResearch?.collection?.lastCollectedAt,
    operationsMode,
  ]);

  if (busy && !snapshot) {
    return (
      <div className="daily-intelligence-loading">
        <LoaderCircle size={22} className="is-spinning" />
        <span>Daily Intelligence 불러오는 중</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="daily-intelligence-empty is-error">
        <AlertTriangle size={30} />
        <h1>Daily Intelligence를 불러오지 못했습니다</h1>
        <p>{error}</p>
        <button type="button" onClick={reload}>다시 시도</button>
      </div>
    );
  }
  if (!snapshot?.connection?.available || !report) {
    return <EmptyConnection connection={snapshot?.connection} onReload={reload} busy={busy} />;
  }

  const reviewCount = pipeline?.reviewQueue?.length || 0;
  const koreaStatus = report.koreaConnection?.status || "unknown";
  const driveApprovalCount = brokerApprovalQueue?.counts?.pending || 0;
  const gmailApprovalCount = (
    (gmailAttachmentApprovalQueue?.counts?.pending || 0)
    + (gmailSenderReviewQueue?.counts?.pending || 0)
  );

  if (operationsMode) {
    return (
      <div className="daily-intelligence-shell research-operations-shell">
        <header className="daily-intelligence-header">
          <div>
            <span className="daily-intelligence-eyebrow">RESEARCH OPERATIONS</span>
            <h1>수집·승인·검증 운영</h1>
            <p>
              {report.title} · 독자용 결론과 분리된 내부 운영 화면
            </p>
          </div>
          <div className="daily-intelligence-header-actions">
            <button
              type="button"
              className="daily-intelligence-refresh"
              onClick={onOpenDailyIntelligence}
            >
              <ChevronLeft size={16} />
              Daily Intelligence
            </button>
            <button
              type="button"
              className="daily-intelligence-refresh"
              onClick={reload}
              disabled={busy}
            >
              <RefreshCw size={16} className={busy ? "is-spinning" : ""} />
              새로고침
            </button>
          </div>
        </header>

        <section className="daily-intelligence-metrics" aria-label="운영 대기 현황">
          <MetricCard
            label="사건 검증"
            value={`${reviewCount}건`}
            detail="공식 원문 확인 전 독자 본문 제외"
            tone={reviewCount ? "warning" : "positive"}
            icon={ShieldCheck}
          />
          <MetricCard
            label="Drive PDF 승인"
            value={`${driveApprovalCount}건`}
            detail="애널리스트 리포트 분석 승인 대기"
            tone={driveApprovalCount ? "warning" : "positive"}
            icon={FileText}
          />
          <MetricCard
            label="Gmail 첨부 승인"
            value={`${gmailApprovalCount}건`}
            detail="허용 발신자의 PDF 첨부만 표시"
            tone={gmailApprovalCount ? "warning" : "positive"}
            icon={Mail}
          />
        </section>

        <main className="daily-intelligence-grid research-operations-grid">
          <ThesisOutcomeAlerts calibration={thesisMemory?.weeklyCalibration} />

          <ResearchIntelligenceShortcuts
            telegramSources={telegramSources}
            brokerResearch={brokerResearch}
            gmailResearch={gmailResearch}
          />

          <GmailResearchStatus
            gmailResearch={gmailResearch}
            senderReviewQueue={gmailSenderReviewQueue}
            senderReviewBusy={gmailSenderReviewBusy}
            senderReviewError={gmailSenderReviewError}
            attachmentApprovalQueue={gmailAttachmentApprovalQueue}
            attachmentApprovalBusy={gmailAttachmentApprovalBusy}
            attachmentApprovalError={gmailAttachmentApprovalError}
            jobStatus={jobStatus}
            jobBusy={jobBusy}
            jobError={jobError}
            pendingPlan={pendingPlan}
            onPlan={requestJobPlan}
            onExecute={executePendingPlan}
            onCancel={cancelPendingPlan}
            onReloadAttachmentApprovals={loadGmailAttachmentApprovalQueue}
            onDecideAttachment={decideGmailAttachment}
            onReloadSenderReviews={loadGmailSenderReviewQueue}
            onDecideSender={decideGmailSender}
          />

          <BrokerResearchApprovalQueue
            approvalQueue={brokerApprovalQueue}
            busy={brokerApprovalBusy}
            error={brokerApprovalError}
            onReload={loadBrokerApprovalQueue}
            onDecide={decideBrokerReport}
          />

          <BrokerResearchMonitor
            brokerResearch={brokerResearch}
            researchIndex={brokerResearchIndex}
            history={brokerResearchHistory}
            busy={brokerResearchBusy}
            error={brokerResearchError}
            onDateChange={selectBrokerResearchDate}
            onTaxonomyChanged={reload}
            thesisMemory={thesisMemory}
            thesisBusy={thesisMemoryBusy}
            thesisError={thesisMemoryError}
            onTrackStock={trackStockThesis}
          />

          <TelegramSourceMonitor
            telegramSources={telegramSources}
            jobStatus={jobStatus}
            jobBusy={jobBusy}
            jobError={jobError}
            pendingPlan={pendingPlan}
            onPlan={requestJobPlan}
            onExecute={executePendingPlan}
            onCancel={cancelPendingPlan}
          />

          <OperationsPanel
            jobStatus={jobStatus}
            jobBusy={jobBusy}
            jobError={jobError}
            pendingPlan={pendingPlan}
            onPlan={requestJobPlan}
            onExecute={executePendingPlan}
            onCancel={cancelPendingPlan}
          />

          <section
            id="verification-review-queue"
            className="daily-intelligence-panel daily-intelligence-review"
          >
            <div className="daily-intelligence-panel-title">
              <div>
                <span>RESEARCH QUEUE</span>
                <h2>검증 대기 사건</h2>
              </div>
              <span className="daily-intelligence-count">{reviewCount}</span>
            </div>
            <p className="daily-intelligence-panel-note">
              사실 확인 전에는 독자용 리포트에 자동 반영되지 않습니다.
            </p>
            <div className="daily-intelligence-operation-notice">
              <ShieldCheck size={18} />
              <div>
                <strong>검증 대기 사건 확인 방법</strong>
                <p>
                  후보 원문에서 발행 주체·날짜·핵심 수치를 확인한 뒤, 리포트 실행 제어의
                  공식 근거 검증을 실행하세요. 공식 원문 확인을 통과한 사건만 다음
                  새로고침에서 독자용 리포트 후보로 승격됩니다.
                </p>
                <a href="#pipeline-operations">
                  공식 근거 검증 실행으로 이동 <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
            <ReviewQueue items={pipeline?.reviewQueue || []} />
          </section>
        </main>
      </div>
    );
  }

  if (marketSectorsMode) {
    return (
      <MarketSectorsWorkspace
        report={report}
        decisionGate={decisionGate}
        scoreboard={scoreboard}
        marketInternals={marketInternals}
        sectorMetrics={sectorMetrics}
        koreaStatus={koreaStatus}
        busy={busy}
        onReload={reload}
        onOpenDailyIntelligence={onOpenDailyIntelligence}
      />
    );
  }

  if (companyResearchMode) {
    return (
      <CompanyResearchWorkspace
        report={report}
        decisionChain={decisionChain}
        thesisMemory={thesisMemory}
        stockCandidates={stockCandidates}
        brokerResearch={brokerResearch}
        brokerResearchHistory={brokerResearchHistory}
        thesisMemoryBusy={thesisMemoryBusy}
        thesisMemoryError={thesisMemoryError}
        watchlistQuickAddBusy={watchlistQuickAddBusy}
        watchlistQuickAddError={watchlistQuickAddError}
        busy={busy}
        onReload={reload}
        onOpenDailyIntelligence={onOpenDailyIntelligence}
        onTrackStock={trackStockThesis}
        onAddWatchlist={quickAddWatchlistTicker}
      />
    );
  }

  if (thesisJournalMode) {
    return (
      <ThesisJournalWorkspace
        report={report}
        thesisMemory={thesisMemory}
        busy={busy}
        thesisMemoryBusy={thesisMemoryBusy}
        thesisMemoryError={thesisMemoryError}
        onReload={reload}
        onOpenDailyIntelligence={onOpenDailyIntelligence}
        onSync={syncThesisMemory}
        onReviewProposal={reviewRiskThesisProposal}
        onRecordPortfolioResponse={recordRiskPortfolioResponse}
        onReviewPortfolioRuleSuggestion={reviewPortfolioResponseRuleSuggestion}
        onReviewPortfolioActiveRule={reviewPortfolioResponseActiveRule}
        onReviewMonthlyGoal={reviewMonthlyDecisionGoalProposal}
      />
    );
  }

  return (
    <div className="daily-intelligence-shell">
      <header className="daily-intelligence-header">
        <div>
          <span className="daily-intelligence-eyebrow">PB DAILY MARKET INTELLIGENCE</span>
          <h1>{report.title}</h1>
          <p>
            가격 기준 {report.dataStatus.latestPriceAsOf || "미확인"} · 생성 {formatGeneratedAt(report.generatedAt)}
          </p>
        </div>
        <button type="button" className="daily-intelligence-refresh" onClick={reload} disabled={busy}>
          <RefreshCw size={16} className={busy ? "is-spinning" : ""} />
          새로고침
        </button>
      </header>

      <section className="daily-intelligence-metrics" aria-label="오늘의 투자 판단">
        <MetricCard
          label="시장 체제"
          value={
            decisionGate?.status === "blocked"
              ? "판단 보류"
              : statusLabels[scoreboard?.regime?.label] || scoreboard?.regime?.label || "확인 필요"
          }
          detail={
            Number.isFinite(scoreboard?.regime?.confidence)
              ? `판단 신뢰도 ${Math.round(scoreboard.regime.confidence * 100)}%`
              : "정량 근거 확인 필요"
          }
          tone={decisionGate?.status === "blocked" ? "warning" : "positive"}
          icon={Sparkles}
        />
        <MetricCard
          label="판단 근거"
          value={decisionGate?.status === "ready" ? "사용 가능" : "보류"}
          detail={`검증 완료 ${report.dataStatus.verifiedEventCount}건 · 대기 ${reviewCount}건`}
          tone={decisionGate?.status === "ready" ? "positive" : "warning"}
          icon={ShieldCheck}
        />
        <MetricCard
          label="내 종목 연결"
          value={`${portfolioImpact?.matchedCount || 0}종목`}
          detail={
            portfolioImpact?.configured
              ? `보유 ${portfolioImpact.portfolioCount} · 관심 ${portfolioImpact.watchlistCount}`
              : "포트폴리오·관심종목 입력 대기"
          }
          tone={portfolioImpact?.matchedCount ? "positive" : "neutral"}
          icon={BriefcaseBusiness}
        />
      </section>

      <DailyWorkspaceShortcuts
        candidateCount={decisionChain?.ideaFunnel?.candidatePool?.length || 0}
        thesisAlertCount={thesisMemory?.weeklyCalibration?.alerts?.length || 0}
        onOpenMarketSectors={onOpenMarketSectors}
        onOpenCompanyResearch={onOpenCompanyResearch}
        onOpenThesisJournal={onOpenThesisJournal}
        onOpenInstitutionalPortfolio={onOpenInstitutionalPortfolio}
      />

      <main className="daily-intelligence-grid">
        <DecisionGate gate={decisionGate} />

        <ThesisOutcomeAlerts
          calibration={thesisMemory?.weeklyCalibration}
          compact
        />

        <section className="daily-intelligence-panel daily-intelligence-summary">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>EXECUTIVE VIEW</span>
              <h2>30초 결론</h2>
            </div>
            <CheckCircle2 size={21} />
          </div>
          {decisionGate?.status === "blocked" ? (
            <p className="daily-intelligence-summary-blocked">
              최신 데이터와 정량 근거의 일치 검증이 끝날 때까지 기존 결론을 숨깁니다.
              위 차단 사유를 해소한 뒤 분석을 다시 실행하세요.
            </p>
          ) : (
            <ol>
              {report.executiveSummary.map((item) => (
                <li key={item}><MarkdownText text={item} /></li>
              ))}
            </ol>
          )}
        </section>

        <MarketSectorStockChain chain={decisionChain} />

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>PORTFOLIO & WATCHLIST LINKAGE</span>
              <h2>내 종목과 오늘의 리포트</h2>
            </div>
            <span className="daily-intelligence-count">
              {portfolioImpact?.matchedCount || 0}
            </span>
          </div>
          <PortfolioImpact
            portfolioImpact={portfolioImpact}
            candidates={decisionChain?.ideaFunnel?.candidatePool || []}
            quickAddBusy={watchlistQuickAddBusy}
            quickAddError={watchlistQuickAddError}
            onQuickAddWatchlist={quickAddWatchlistTicker}
            onQuickAddPortfolio={quickAddPortfolioHolding}
            onRemovePortfolio={removePortfolioHolding}
            riskReviewBusy={portfolioRiskReviewBusy}
            riskReviewError={portfolioRiskReviewError}
            onReviewRisk={reviewPortfolioRisk}
            onUpdateFollowUp={updatePortfolioRiskFollowUp}
            onOpenOperations={onOpenOperations}
          />
        </section>

        <section className="daily-intelligence-panel">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>VERIFIED EVENTS</span>
              <h2>검증된 핵심 사건</h2>
            </div>
            <span className="daily-intelligence-count">{report.verifiedEvents.length}</span>
          </div>
          {report.verifiedEvents.length ? (
            <div className="daily-intelligence-finding-list">
              {report.verifiedEvents.map((event) => (
                <article key={event.eventId || event.title}>
                  <h3>{event.title}</h3>
                  {event.summary ? <MarkdownText text={event.summary} /> : null}
                  {event.facts.length ? (
                    <ul>{event.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="daily-intelligence-muted">
              공식 원문 사실 확인을 통과한 신규 사건이 없습니다. 미확인 해석은 독자 영역에 노출하지 않습니다.
            </p>
          )}
        </section>

        <section className="daily-intelligence-panel daily-intelligence-next-checks">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>NEXT CHECKS</span>
              <h2>오늘 확인할 조건</h2>
            </div>
          </div>
          <ul className="daily-intelligence-check-list">
            {report.nextChecks.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <details className="daily-intelligence-supporting-details daily-intelligence-wide">
          <summary>
            <span>
              <small>DATA QUALITY &amp; PRIMARY SOURCES</small>
              <strong>데이터 상태·원자료 확인</strong>
              <em>판단 근거의 경고와 공식 출처를 필요할 때 펼쳐봅니다.</em>
            </span>
            <span className="daily-intelligence-supporting-counts">
              경고 {report.dataStatus.warnings.length} · 출처 {report.sources?.length || 0}
              <ChevronRight size={17} />
            </span>
          </summary>
          <div className="daily-intelligence-supporting-grid">
            <section>
              <div className="daily-intelligence-panel-title">
                <div>
                  <span>DATA QUALITY</span>
                  <h2>데이터 상태</h2>
                </div>
              </div>
              {report.dataStatus.warnings.length ? (
                <ul className="daily-intelligence-warning-list">
                  {report.dataStatus.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : (
                <p className="daily-intelligence-muted">중요 데이터 경고가 없습니다.</p>
              )}
            </section>

            <section>
              <div className="daily-intelligence-panel-title">
                <div>
                  <span>PRIMARY SOURCES</span>
                  <h2>원자료</h2>
                </div>
              </div>
              <SourceLinks sources={report.sources} />
            </section>
          </div>
        </details>

        <section className="daily-intelligence-operations-link daily-intelligence-wide">
          <div>
            <span>DATA & EVIDENCE STATUS</span>
            <strong>
              핵심 가격 {marketInternals?.coverage?.available || 0}/
              {marketInternals?.coverage?.required || 0}
              {" · "}
              검증 대기 {reviewCount}건
            </strong>
            <p>수집 상태, PDF 승인, Telegram·Gmail 및 검증 대기열은 운영 화면에서 관리합니다.</p>
          </div>
          <button type="button" onClick={onOpenOperations}>
            Research Operations
            <ChevronRight size={16} />
          </button>
        </section>
      </main>
    </div>
  );
}
