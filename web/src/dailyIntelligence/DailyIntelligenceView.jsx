import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import ArrowUpRight from "lucide-react/dist/esm/icons/arrow-up-right.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import CircleDashed from "lucide-react/dist/esm/icons/circle-dashed.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import FileText from "lucide-react/dist/esm/icons/file-text.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Radio from "lucide-react/dist/esm/icons/radio.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Send from "lucide-react/dist/esm/icons/send.js";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.js";
import X from "lucide-react/dist/esm/icons/x.js";
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
    <section className="daily-intelligence-panel daily-intelligence-operations daily-intelligence-wide">
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
          {(jobStatus?.jobs || []).map((job) => (
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

      {pendingPlan ? (
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

function TelegramSourceMonitor({ telegramSources }) {
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
        <span className={`daily-intelligence-run-status is-${collectionReady ? "succeeded" : "failed"}`}>
          {collectionReady ? "인증 준비" : "인증 필요"}
        </span>
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
          <small>{collectionLabels[collection.status] || collection.status}</small>
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

function BrokerResearchMonitor({ brokerResearch }) {
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
          <CircleDashed size={20} />
        </div>
        <p className="daily-intelligence-muted">
          권한이 확인된 리포트가 아직 없습니다. Google Drive 또는 로컬 리서치 inbox에
          리포트와 권한 메타데이터를 함께 넣으면 이곳에서 가공 결과를 확인할 수 있습니다.
        </p>
      </section>
    );
  }
  const summary = brokerResearch.summary || {};
  const stanceCounts = summary.stanceCounts || {};
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
        <span className="daily-intelligence-count">{summary.selectedReportCount || 0}</span>
      </div>

      <div className="daily-intelligence-broker-summary">
        <article><span>수집 리포트</span><strong>{summary.selectedReportCount || 0}</strong><small>{summary.publisherCount || 0}개 발행사</small></article>
        <article><span>구조화 완료</span><strong>{summary.structuredReportCount || 0}</strong><small>{summary.analysisStatus || "요약·논거·촉매·위험"}</small></article>
        <article><span>긍정 / 중립</span><strong>{stanceCounts.positive || 0} / {stanceCounts.neutral || 0}</strong><small>리포트 관점 기준</small></article>
        <article><span>경계 / 부정</span><strong>{stanceCounts.cautious || 0} / {stanceCounts.negative || 0}</strong><small>반대 논리 확인</small></article>
      </div>

      {brokerResearch.consensus?.disagreements?.length ? (
        <div className="daily-intelligence-broker-disagreements">
          <strong>의견이 갈리는 주제</strong>
          {brokerResearch.consensus.disagreements.map((item) => (
            <span key={item.topic}>
              {item.topic} · {item.stances.join(" / ")} · {item.reportCount}건
            </span>
          ))}
        </div>
      ) : null}

      <div className="daily-intelligence-broker-grid">
        {(brokerResearch.reports || []).map((report) => (
          <article key={report.reportId || `${report.publisher}-${report.title}`}>
            <header>
              <div>
                <span>{report.publisher}{report.analyst ? ` · ${report.analyst}` : ""}</span>
                <h3>{report.title}</h3>
              </div>
              <em className={`is-${report.stance}`}>{report.stance.replaceAll("_", " ")}</em>
            </header>
            <p>
              {report.summary || "구조화 분석 대기 중 — 원문은 보관하되 화면에는 재배포하지 않습니다."}
            </p>
            {report.keyClaims.length ? (
              <ul>{report.keyClaims.slice(0, 3).map((claim) => <li key={claim}>{claim}</li>)}</ul>
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
      </div>

      <p className="daily-intelligence-panel-note">
        원문·표·이미지는 재배포하지 않습니다. 운영자가 분석 권한을 확인한 자료만 내부 가공하며,
        공개 리포트에는 요약과 출처 링크만 사용합니다.
      </p>
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
                <span>{item.inferred.publisher} · {item.inferred.published_at.slice(0, 10)}</span>
                <h3>{item.inferred.title}</h3>
                <small>{item.fileName}</small>
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
        승인 후 후보 데이터 수집 또는 드라이런을 실행하면 최신 리포트에 반영됩니다.
      </p>
    </section>
  );
}

function ResearchIntelligenceShortcuts({ telegramSources, brokerResearch }) {
  const telegramPosts = telegramSources?.deduplication?.rawPostCount || 0;
  const telegramClusters = telegramSources?.deduplication?.eventClusterCount || 0;
  const brokerReports = brokerResearch?.summary?.selectedReportCount || 0;
  const brokerStructured = brokerResearch?.summary?.structuredReportCount || 0;
  return (
    <nav className="daily-intelligence-research-shortcuts" aria-label="리서치 분석 바로가기">
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

export default function DailyIntelligenceView() {
  const {
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
  } = useDailyIntelligenceController();
  const report = snapshot?.report;
  const pipeline = snapshot?.pipeline;
  const scoreboard = snapshot?.scoreboard;
  const marketInternals = snapshot?.marketInternals;
  const sectorMetrics = snapshot?.sectorMetrics;
  const stockCandidates = snapshot?.stockCandidates;
  const telegramSources = snapshot?.telegramSources;
  const brokerResearch = snapshot?.brokerResearch;
  const [brokerApprovalQueue, setBrokerApprovalQueue] = React.useState(null);
  const [brokerApprovalBusy, setBrokerApprovalBusy] = React.useState(false);
  const [brokerApprovalError, setBrokerApprovalError] = React.useState("");

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

  React.useEffect(() => {
    void loadBrokerApprovalQueue();
  }, [loadBrokerApprovalQueue]);

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

      <ResearchIntelligenceShortcuts
        telegramSources={telegramSources}
        brokerResearch={brokerResearch}
      />

      <main className="daily-intelligence-grid">
        <BrokerResearchApprovalQueue
          approvalQueue={brokerApprovalQueue}
          busy={brokerApprovalBusy}
          error={brokerApprovalError}
          onReload={loadBrokerApprovalQueue}
          onDecide={decideBrokerReport}
        />

        <BrokerResearchMonitor brokerResearch={brokerResearch} />

        <TelegramSourceMonitor telegramSources={telegramSources} />

        <OperationsPanel
          jobStatus={jobStatus}
          jobBusy={jobBusy}
          jobError={jobError}
          pendingPlan={pendingPlan}
          onPlan={requestJobPlan}
          onExecute={executePendingPlan}
          onCancel={cancelPendingPlan}
        />

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
