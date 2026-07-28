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

function signed(value, digits = 2, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}${suffix}`;
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
              {candidate.evidence.map((item) => (
                <a key={`${candidate.ticker}-${item.title}`} href={item.sourceUrl} target="_blank" rel="noreferrer">
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

function PortfolioImpact({ portfolioImpact }) {
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
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="daily-intelligence-portfolio-summary">
        <span>포트폴리오 {portfolioImpact.portfolioCount}종목</span>
        <span>관심종목 {portfolioImpact.watchlistCount}종목</span>
        <span>오늘 연결 {portfolioImpact.matchedCount}종목</span>
        <span>직접 근거 없음 {portfolioImpact.unmatchedCount}종목</span>
      </div>
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
          </article>
        );
      })}
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
            .filter((job) => !["telegram_refresh", "gmail_refresh", "gmail_analyze"].includes(job.id))
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

      {pendingPlan && !["telegram_refresh", "gmail_refresh", "gmail_analyze"].includes(pendingPlan.job?.id) ? (
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
  const collectionReady = credentials.ready === true;
  const telegramRun = jobStatus?.run?.jobId === "telegram_refresh"
    ? jobStatus.run
    : null;
  const refreshing = telegramRun?.status === "running";
  const telegramPlanPending = pendingPlan?.job?.id === "telegram_refresh";
  const collectionLabels = {
    ok: "수집 완료",
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
        if (!next[item.sourceLabel] && recommended) next[item.sourceLabel] = recommended;
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

  const saveAlias = async (sourceLabel) => {
    const sectorId = selections[sourceLabel] || "";
    if (!sectorId) {
      setError("표준 섹터를 먼저 선택해 주세요.");
      return;
    }
    setBusyLabel(sourceLabel);
    setError("");
    try {
      const response = await fetch("/api/pb-daily-intelligence/sector-taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: sourceLabel, sectorId }),
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
        <span>원문 섹터명을 표준 섹터에 연결하면 이후 리포트부터 자동 통합됩니다.</span>
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
                      onClick={() => setSelections((current) => ({
                        ...current,
                        [item.sourceLabel]: candidate.sectorId,
                      }))}
                      title={`${candidate.reason} · ${(candidate.score * 100).toFixed(0)}점`}
                    >
                      {candidate.nameKo}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <select
              value={selections[item.sourceLabel] || ""}
              onChange={(event) => setSelections((current) => ({
                ...current,
                [item.sourceLabel]: event.target.value,
              }))}
              aria-label={`${item.sourceLabel} 표준 섹터`}
              disabled={!taxonomy || busyLabel === item.sourceLabel}
            >
              <option value="">표준 섹터 선택</option>
              {(taxonomy?.sectors || []).map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.nameKo}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => saveAlias(item.sourceLabel)}
              disabled={!selections[item.sourceLabel] || busyLabel === item.sourceLabel}
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
        원문 리포트와 원래 섹터명은 변경하지 않습니다.
      </p>
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
}) {
  if (!gmailResearch) return null;
  const collection = gmailResearch.collection || {};
  const connected = Boolean(gmailResearch.configured);
  const collectionOk = collection.status === "ok";
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
            {collection.lastCollectedAt
              ? formatGeneratedAt(collection.lastCollectedAt)
              : "아직 실행되지 않음"}
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

export default function DailyIntelligenceView({
  mode = "reader",
  onOpenOperations,
  onOpenDailyIntelligence,
}) {
  const operationsMode = mode === "operations";
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
  } = useDailyIntelligenceController();
  const report = snapshot?.report;
  const pipeline = snapshot?.pipeline;
  const decisionGate = snapshot?.decisionGate;
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
  const gmailApprovalCount = gmailAttachmentApprovalQueue?.counts?.pending || 0;

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
          <ResearchIntelligenceShortcuts
            telegramSources={telegramSources}
            brokerResearch={brokerResearch}
            gmailResearch={gmailResearch}
          />

          <GmailResearchStatus
            gmailResearch={gmailResearch}
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

      <main className="daily-intelligence-grid">
        <DecisionGate gate={decisionGate} />

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
          <PortfolioImpact portfolioImpact={portfolioImpact} />
        </section>

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>MARKET SCOREBOARD</span>
              <h2>결론을 지지하는 시장 근거</h2>
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

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>SECTOR & STYLE LEADERSHIP</span>
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

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>US EQUITY CANDIDATES</span>
              <h2>미국 개별주 분석 후보</h2>
            </div>
            <span className="daily-intelligence-count">{stockCandidates?.candidates?.length || 0}</span>
          </div>
          <StockCandidates stockCandidates={stockCandidates} />
        </section>

        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>EARNINGS INTELLIGENCE</span>
              <h2>실적·가이던스·추정치 변화</h2>
            </div>
            <span className="daily-intelligence-count">
              {report.earningsWatch?.companies?.length || 0}
            </span>
          </div>
          <p className="daily-intelligence-panel-note">
            전망치는 제3자 전망치, 가이던스는 회사 주장, 실제치는 공식 원문 확인 값으로 구분합니다.
          </p>
          <EarningsWatch earningsWatch={report.earningsWatch} />
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
        </section>

        <section className="daily-intelligence-panel">
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

        <section className="daily-intelligence-panel">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>PRIMARY SOURCES</span>
              <h2>원자료</h2>
            </div>
          </div>
          <SourceLinks sources={report.sources} />
        </section>

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
