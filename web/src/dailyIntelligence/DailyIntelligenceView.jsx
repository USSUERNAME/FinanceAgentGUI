import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import ArrowUpRight from "lucide-react/dist/esm/icons/arrow-up-right.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import CircleDashed from "lucide-react/dist/esm/icons/circle-dashed.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.js";
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

function SectorLeadership({ marketInternals }) {
  const periods = [
    ["1d", "1일"],
    ["5d", "5일"],
    ["20d", "20일"],
  ];
  if (!marketInternals) {
    return <p className="daily-intelligence-muted">섹터 리더십 데이터가 없습니다.</p>;
  }
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
      <div className="daily-intelligence-sector-columns">
        {periods.map(([period, label]) => (
          <section key={period}>
            <h3>{label} 리더십</h3>
            {(marketInternals.sectors[period] || []).map((sector) => (
              <div className="daily-intelligence-sector-row" key={`${period}-${sector.ticker}`}>
                <span><strong>{sector.ticker}</strong>{sector.sector}</span>
                <span>{signed(sector.returnPct, 2, "%")}</span>
                <strong className={sector.vsSpyPctPoint >= 0 ? "is-positive" : "is-negative"}>
                  {signed(sector.vsSpyPctPoint, 2, "%p")}
                </strong>
              </div>
            ))}
          </section>
        ))}
      </div>
      {marketInternals.gaps.length ? (
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
  return (
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

export default function DailyIntelligenceView() {
  const { snapshot, busy, error, reload } = useDailyIntelligenceController();
  const report = snapshot?.report;
  const pipeline = snapshot?.pipeline;
  const scoreboard = snapshot?.scoreboard;
  const marketInternals = snapshot?.marketInternals;
  const sectorMetrics = snapshot?.sectorMetrics;
  const stockCandidates = snapshot?.stockCandidates;

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

      <section className="daily-intelligence-metrics" aria-label="리포트 상태">
        <MetricCard
          label="검증 완료 사건"
          value={report.dataStatus.verifiedEventCount}
          detail="공식 원문 사실 확인 통과"
          tone={report.dataStatus.verifiedEventCount > 0 ? "positive" : "warning"}
          icon={ShieldCheck}
        />
        <MetricCard
          label="검증 대기"
          value={reviewCount}
          detail={`전체 사건 클러스터 ${pipeline?.clusterCount || 0}건`}
          tone={reviewCount ? "warning" : "positive"}
          icon={CircleDashed}
        />
        <MetricCard
          label="한국시장 연결"
          value={statusLabels[koreaStatus] || koreaStatus}
          detail={statusLabels[report.dataStatus.koreaDataStatus] || "상태 확인 필요"}
          tone={koreaStatus === "sufficient" || koreaStatus === "complete" ? "positive" : "warning"}
          icon={Database}
        />
      </section>

      <main className="daily-intelligence-grid">
        <section className="daily-intelligence-panel daily-intelligence-wide">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>MARKET SCOREBOARD</span>
              <h2>시장 스코어보드</h2>
            </div>
            <StatusPill status={scoreboard?.regime?.label || "unknown"} />
          </div>
          <Scoreboard scoreboard={scoreboard} />
        </section>

        <section className="daily-intelligence-panel daily-intelligence-summary">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>EXECUTIVE VIEW</span>
              <h2>30초 결론</h2>
            </div>
            <CheckCircle2 size={21} />
          </div>
          <ol>
            {report.executiveSummary.map((item) => (
              <li key={item}><MarkdownText text={item} /></li>
            ))}
          </ol>
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

        <section className="daily-intelligence-panel daily-intelligence-review">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>RESEARCH QUEUE</span>
              <h2>검증 대기 사건</h2>
            </div>
            <span className="daily-intelligence-count">{reviewCount}</span>
          </div>
          <p className="daily-intelligence-panel-note">
            이 영역은 운영 검토용입니다. 사실 확인 전에는 독자용 리포트에 자동 반영되지 않습니다.
          </p>
          <ReviewQueue items={pipeline?.reviewQueue || []} />
        </section>

        <section className="daily-intelligence-panel">
          <div className="daily-intelligence-panel-title">
            <div>
              <span>NEXT CHECKS</span>
              <h2>다음 확인 항목</h2>
            </div>
          </div>
          <ul className="daily-intelligence-check-list">
            {report.nextChecks.map((item) => <li key={item}>{item}</li>)}
          </ul>
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
      </main>
    </div>
  );
}
