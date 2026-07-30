import React from "react";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import ChevronsRight from "lucide-react/dist/esm/icons/chevrons-right.js";
import Circle from "lucide-react/dist/esm/icons/circle.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import Eye from "lucide-react/dist/esm/icons/eye.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Pause from "lucide-react/dist/esm/icons/pause.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Target from "lucide-react/dist/esm/icons/target.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { MarkdownText } from "../utils/MarkdownText.jsx";
import { formatDateTime } from "../utils/formatters.js";
import { worldMemoryActionCatalog } from "./actionCatalog.js";
import { worldMemoryActionText, worldMemoryStatusLabel } from "./statusHelpers.js";
import { normalizeMemoryChangeSuggestionItem, worldMemorySuggestionCanAskAgent } from "./suggestionStatus.js";
import {
  activeInvestmentTheses,
  investmentThesisDomId,
  investmentThesisStateLabel,
  relatedInvestmentTheses,
} from "./thesisHelpers.js";
import "./world-memory.css";

function worldMemorySignalToneClass(tone) {
  if (tone === "positive") return "is-positive";
  if (tone === "negative") return "is-negative";
  return "is-neutral";
}

function isWorldMemoryCollectionStatus(status) {
  return status === "collecting" || status === "generating_briefs";
}

function worldMemoryAskAgentLabel(agentProvider = "") {
  return agentProvider === "antigravity-cli" ? "Antigravity에게 질문하기" : "Codex에게 질문하기";
}

function WorldMemoryAskButton({ agentIcon, label, disabled = false, onClick }) {
  return (
    <div className="world-memory-context-line">
      <button
        className="world-memory-context-button"
        type="button"
        disabled={disabled}
        title={label}
        aria-label={label}
        onClick={onClick}
      >
        <img className="agent-logo-image" src={agentIcon} alt="" />
        <span>{label}</span>
      </button>
    </div>
  );
}

function WorldMemoryChangeSuggestionStatusIcon({ status }) {
  if (status === "completed") {
    return <CheckCircle2 className="world-memory-change-status-icon is-completed" size={16} strokeWidth={2.2} aria-label="완료" />;
  }
  if (status === "watching") {
    return (
      <span className="world-memory-change-status-icon is-watching" role="img" aria-label="관찰 중">
        <Eye size={11} strokeWidth={2.2} />
      </span>
    );
  }
  return <ChevronsRight className="world-memory-change-status-icon is-open" size={14} strokeWidth={2.2} aria-hidden="true" />;
}

function WorldMemoryChangeSuggestionRow({ item, index, agentIcon, agentAskLabel, disabled = false, onAskItem }) {
  const suggestion = normalizeMemoryChangeSuggestionItem(item);
  const { text, status } = suggestion;
  const askLabel = status === "watching" ? agentAskLabel.replace("질문하기", "후속 확인하기") : agentAskLabel;
  return (
    <p className={`world-memory-change-suggestion-row is-${status}`}>
      <WorldMemoryChangeSuggestionStatusIcon status={status} />
      <span className="world-memory-change-suggestion-content">
        <span className="world-memory-change-suggestion-text">{text}</span>
        {worldMemorySuggestionCanAskAgent(suggestion) ? (
          <button
            className="board-codex-context-button world-memory-change-agent-button"
            type="button"
            disabled={disabled}
            aria-label={`${askLabel}: ${text}`}
            title={askLabel}
            onClick={() => onAskItem?.("memory-change", suggestion, { index })}
          >
            <img className="agent-logo-image" src={agentIcon} alt="" />
          </button>
        ) : null}
      </span>
    </p>
  );
}

function WorldMemoryRichReport({
  report,
  relatedTheses = [],
  agentIcon = "",
  agentAskLabel = "Codex에게 질문하기",
  askDisabled = false,
  onAskItem,
  onOpenThesis,
}) {
  const view = report?.view || null;
  if (!view) return null;
  const signals = Array.isArray(view.signalRadar) ? view.signalRadar : [];
  const highlights = Array.isArray(view.highlights) ? view.highlights : [];
  const portfolioSuggestions = Array.isArray(view.portfolioSuggestions) ? view.portfolioSuggestions : [];
  const memoryChangeSuggestions = Array.isArray(view.memoryChangeSuggestionItems)
    ? view.memoryChangeSuggestionItems
    : Array.isArray(view.memoryChangeSuggestions)
      ? view.memoryChangeSuggestions
      : [];
  const nextChecks = Array.isArray(view.nextChecks) ? view.nextChecks : [];

  return (
    <div className="world-memory-rich-report">
      <div className="world-memory-report-hero">
        <div>
          <span>{view.asOf || report.generatedAt || ""}</span>
          <h3>{view.title || report.title || "World Memory 시장 상황 인식"}</h3>
          <p>{view.summary || report.summary || ""}</p>
        </div>
        <strong>{view.stance || "mixed"}</strong>
      </div>

      {view.narrative ? <p className="world-memory-report-narrative">{view.narrative}</p> : null}

      {relatedTheses.length ? (
        <section className="world-memory-report-group" aria-labelledby="world-memory-related-thesis-title">
          <h4 id="world-memory-related-thesis-title" className="world-memory-subsection-title">
            이 보고서와 연결된 PB 투자 가설
          </h4>
          <div className="world-memory-related-thesis-list">
            {relatedTheses.map((record) => (
              <button
                type="button"
                key={record.continuityId}
                onClick={() => onOpenThesis?.(record)}
              >
                <Target size={15} strokeWidth={2.2} />
                <span>
                  <strong>{record.title}</strong>
                  <small>{investmentThesisStateLabel(record)} · {record.lastSeenAt || "관측일 미상"}</small>
                </span>
                <ChevronsRight size={14} strokeWidth={2.2} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {signals.length ? (
        <section className="world-memory-report-group" aria-labelledby="world-memory-signal-title">
          <h4 id="world-memory-signal-title" className="world-memory-subsection-title">
            시장 신호 점수
          </h4>
          <div className="world-memory-signal-radar" aria-label="시장 신호 레이더">
            {signals.map((signal, index) => {
              const numericScore = Number(signal.score);
              const score = Number.isFinite(numericScore) ? Math.max(0, Math.min(100, numericScore)) : 50;
              return (
                <article className={`world-memory-signal ${worldMemorySignalToneClass(signal.tone)}`} key={`${signal.label}-${index}`}>
                  <div className="world-memory-signal-head">
                    <strong>{signal.label}</strong>
                    <span>{score}</span>
                  </div>
                  <div className="world-memory-signal-bar">
                    <i style={{ width: `${score}%` }} />
                  </div>
                  {signal.note ? <p>{signal.note}</p> : null}
                  <WorldMemoryAskButton
                    agentIcon={agentIcon}
                    label={agentAskLabel}
                    disabled={askDisabled}
                    onClick={() => onAskItem?.("signal", signal, { score })}
                  />
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {highlights.length ? (
        <section className="world-memory-report-group" aria-labelledby="world-memory-topic-title">
          <h4 id="world-memory-topic-title" className="world-memory-subsection-title">
            주제별 변화
          </h4>
          <div className="world-memory-highlight-grid">
            {highlights.map((item, index) => (
              <article className={`world-memory-highlight is-${item.importance || "medium"}`} key={`${item.title}-${index}`}>
                <span>{item.tag || "market"}</span>
                <h4>{item.title}</h4>
                <p>{item.body}</p>
                <WorldMemoryAskButton
                  agentIcon={agentIcon}
                  label={agentAskLabel}
                  disabled={askDisabled}
                  onClick={() => onAskItem?.("highlight", item, { index })}
                />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="world-memory-report-group" aria-labelledby="world-memory-change-suggestion-title">
        <h4 id="world-memory-change-suggestion-title" className="world-memory-subsection-title">
          월드 메모리 변경 제안
        </h4>
        <div className="world-memory-report-columns">
          <section>
            {memoryChangeSuggestions.length ? (
              memoryChangeSuggestions.map((item, index) => (
                <WorldMemoryChangeSuggestionRow
                  item={item}
                  index={index}
                  agentIcon={agentIcon}
                  agentAskLabel={agentAskLabel}
                  disabled={askDisabled}
                  onAskItem={onAskItem}
                  key={`${item}-${index}`}
                />
              ))
            ) : (
              <p className="is-muted">아직 제안 없음</p>
            )}
          </section>
        </div>
      </section>

      <section className="world-memory-report-group" aria-labelledby="world-memory-suggestion-title">
        <h4 id="world-memory-suggestion-title" className="world-memory-subsection-title">
          관찰 및 실행 제안
        </h4>
        <div className="world-memory-report-columns">
          <section>
            <h4>포트폴리오/관찰 제안</h4>
            {portfolioSuggestions.length ? (
              portfolioSuggestions.map((item, index) => (
                <p key={`${item}-${index}`}>
                  <CheckCircle2 size={14} strokeWidth={2.2} />
                  <span>{item}</span>
                </p>
              ))
            ) : (
              <p className="is-muted">아직 제안 없음</p>
            )}
          </section>
          <section>
            <h4>다음 확인 지점</h4>
            {nextChecks.length ? (
              nextChecks.map((item, index) => (
                <p key={`${item}-${index}`}>
                  <Circle size={14} strokeWidth={2.2} />
                  <span>{item}</span>
                </p>
              ))
            ) : (
              <p className="is-muted">아직 체크포인트 없음</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function formatThesisMetric(record = {}) {
  const value = Number(record.metricValue);
  if (!Number.isFinite(value)) return "관측값 없음";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${record.metricUnit || ""}`;
}

function WorldMemoryInvestmentTheses({ memory = {}, focusedThesisId = "" }) {
  const records = Array.isArray(memory.records) ? memory.records : [];
  const activeRecords = activeInvestmentTheses(memory);
  const watchingCount = records.filter((record) => record.state === "watching").length;
  const candidateCount = records.filter((record) => record.state === "candidate").length;

  return (
    <section className="world-memory-section world-memory-thesis-section" aria-labelledby="world-memory-thesis-title">
      <div className="world-memory-section-header">
        <div>
          <h2 id="world-memory-thesis-title">PB 투자 가설 메모리</h2>
          <span>
            {memory.lastSyncedReportDate
              ? `${memory.lastSyncedReportDate} Daily Intelligence와 동기화`
              : "아직 Daily Intelligence와 동기화되지 않았습니다."}
          </span>
        </div>
        <span className={memory.available === false ? "world-memory-badge is-warn" : "world-memory-badge is-ok"}>
          {memory.available === false ? "연결 오류" : `${records.length}건`}
        </span>
      </div>

      {memory.error ? (
        <div className="news-feed-alert">
          <AlertTriangle size={16} strokeWidth={2.2} />
          <span>{memory.error}</span>
        </div>
      ) : null}

      <div className="world-memory-thesis-summary" aria-label="PB 투자 가설 현황">
        <article>
          <span>활성 가설</span>
          <strong>{activeRecords.length}</strong>
        </article>
        <article>
          <span>추적 중</span>
          <strong>{watchingCount}</strong>
        </article>
        <article>
          <span>후보</span>
          <strong>{candidateCount}</strong>
        </article>
      </div>

      {records.length ? (
        <div className="world-memory-thesis-grid">
          {records.map((record) => {
            const transition = Array.isArray(record.history) && record.history.length
              ? record.history[record.history.length - 1]
              : null;
            const focused = record.continuityId === focusedThesisId;
            return (
              <article
                id={investmentThesisDomId(record)}
                className={`world-memory-thesis-card is-${record.state || "unknown"}${focused ? " is-focused" : ""}`}
                key={record.continuityId}
              >
                <header>
                  <div>
                    <span>{record.kind === "sector" ? "섹터" : "종목"} · {record.entityId}</span>
                    <h3>{record.title}</h3>
                  </div>
                  <span className="world-memory-thesis-state">{investmentThesisStateLabel(record)}</span>
                </header>
                <p className="world-memory-thesis-copy">{record.thesis || "가설 설명이 아직 없습니다."}</p>
                <div className="world-memory-thesis-metric">
                  <span>{record.metricId || "평가 지표"}</span>
                  <strong>{formatThesisMetric(record)}</strong>
                </div>
                <dl>
                  <div>
                    <dt>확인 조건</dt>
                    <dd>{record.confirmationCondition || "아직 설정되지 않았습니다."}</dd>
                  </div>
                  <div>
                    <dt>무효화 조건</dt>
                    <dd>{record.invalidationCondition || "아직 설정되지 않았습니다."}</dd>
                  </div>
                </dl>
                {Array.isArray(record.evidence) && record.evidence.length ? (
                  <div className="world-memory-thesis-evidence">
                    {record.evidence.slice(0, 5).map((item, index) => (
                      <span key={`${record.continuityId}-evidence-${index}`}>{item}</span>
                    ))}
                  </div>
                ) : null}
                <footer>
                  <span>최근 관측 {record.lastSeenAt || "없음"} · 누적 {record.observationCount || 0}회</span>
                  {transition ? (
                    <span>최근 변화 {transition.fromState || "신규"} → {transition.toState || record.state}</span>
                  ) : null}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="world-memory-empty-report">
          <Target size={20} strokeWidth={2.1} />
          <strong>아직 저장된 PB 투자 가설이 없습니다.</strong>
          <p>Daily Intelligence 생성 후 가설 동기화를 실행하면 여기에 누적됩니다.</p>
        </div>
      )}
    </section>
  );
}

function WorldMemoryAgentActionCard({
  action,
  busy,
  disabled,
  onExecute,
  onClear,
}) {
  if (!action) return null;
  const catalog = worldMemoryActionCatalog[action.action] || {};
  const params =
    action.options && typeof action.options === "object"
      ? action.options
      : action.params && typeof action.params === "object"
        ? action.params
        : action.raw?.params && typeof action.raw.params === "object"
          ? action.raw.params
          : {};
  const paramsText = JSON.stringify(params, null, 2);
  return (
    <section className="world-memory-agent-action" aria-labelledby="world-memory-agent-action-title">
      <div className="world-memory-agent-action-main">
        <Database size={18} strokeWidth={2.2} />
        <div>
          <span>채팅에서 제안된 DB control</span>
          <h2 id="world-memory-agent-action-title">{action.label || catalog.label || action.action}</h2>
          {action.reason ? <p>{action.reason}</p> : null}
        </div>
      </div>
      <div className="world-memory-agent-action-meta">
        <span>{action.action}</span>
        <span>{action.riskLevel || catalog.riskLevel || "low"}</span>
      </div>
      {paramsText !== "{}" ? <pre>{paramsText}</pre> : null}
      <div className="world-memory-agent-action-buttons">
        <button type="button" data-testid="world-memory-agent-execute" onClick={() => onExecute(action)} disabled={disabled || busy}>
          {busy ? <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} /> : <Play size={15} strokeWidth={2.2} />}
          <span>{busy ? "실행 중" : "확인 후 실행"}</span>
        </button>
        <button type="button" onClick={onClear} disabled={disabled || busy}>
          <X size={15} strokeWidth={2.2} />
          <span>취소</span>
        </button>
      </div>
    </section>
  );
}

export default function WorldMemoryView({
  status,
  busy,
  error,
  actionBusy,
  activeAction,
  agentActionBusy,
  actionResult,
  agentAction,
  agentIcon,
  agentProvider,
  agentOptionsReady = true,
  isSending = false,
  onClearAgentAction,
  onExecuteAgentAction,
  onAskReportItem,
  onReload,
  onRunAction,
}) {
  const [activeMemoryTab, setActiveMemoryTab] = React.useState("events");
  const [focusedThesisId, setFocusedThesisId] = React.useState("");
  const actionText = worldMemoryActionText(actionResult);
  const canRun = !busy && !actionBusy;
  const collector = status?.collector || {};
  const schedule = status?.schedule || {};
  const report = status?.report || {};
  const reportText = report.text || "";
  const hasRichReport = Boolean(report.view);
  const legacySuggestions = !hasRichReport && Array.isArray(report.suggestions) ? report.suggestions : [];
  const nextCollection = schedule.nextRetryAt || schedule.pausedUntil || schedule.nextRunAt;
  const paused = schedule.pausedUntil && new Date(schedule.pausedUntil).getTime() > Date.now();
  const collectorStatus = String(collector.status || "");
  const collectBusy = Boolean(activeAction === "collectNow" || (collector.inFlight && isWorldMemoryCollectionStatus(collectorStatus)));
  const reportBusy = activeAction === "refreshReport" || collectorStatus === "writing_report";
  const askDisabled = !agentOptionsReady || isSending;
  const agentAskLabel = worldMemoryAskAgentLabel(agentProvider);
  const investmentTheses = status?.investmentTheses || {};
  const thesisRecords = Array.isArray(investmentTheses.records) ? investmentTheses.records : [];
  const relatedTheses = relatedInvestmentTheses(report, investmentTheses);
  const eventCount = Number(status?.list?.json?.count) || 0;

  React.useEffect(() => {
    if (activeMemoryTab !== "theses" || !focusedThesisId) return;
    const selected = thesisRecords.find((record) => record.continuityId === focusedThesisId);
    if (!selected) return;
    const timer = window.setTimeout(() => {
      document.getElementById(investmentThesisDomId(selected))?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeMemoryTab, focusedThesisId, thesisRecords]);

  function openInvestmentThesis(record = null) {
    setFocusedThesisId(record?.continuityId || "");
    setActiveMemoryTab("theses");
  }

  return (
    <div className="world-memory-shell">
      <section className="world-memory-board" aria-labelledby="world-memory-title">
        <header className="world-memory-header">
          <div>
            <h1 id="world-memory-title">World Memory</h1>
            <p>6시간마다 시장 맥락을 수집하고, 실패하면 30분 단위로 같은 회차를 재시도합니다.</p>
          </div>
          <div className="world-memory-header-actions">
            <button type="button" onClick={() => onRunAction("collectNow")} disabled={!canRun}>
              {collectBusy ? <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} /> : <Play size={16} strokeWidth={2.2} />}
              <span>{collectBusy ? "수집 중" : "수동 수집"}</span>
            </button>
            <button type="button" onClick={() => onRunAction("pause")} disabled={busy}>
              <Pause size={16} strokeWidth={2.2} />
              <span>{paused ? "6시간 더 연기" : "수집 일시정지"}</span>
            </button>
            <button type="button" onClick={() => onRunAction("refreshReport")} disabled={!canRun}>
              {reportBusy ? <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} /> : <RefreshCw size={16} strokeWidth={2.2} />}
              <span>{reportBusy ? "갱신 중" : "보고서 갱신"}</span>
            </button>
            <button type="button" onClick={onReload} disabled={busy} aria-label="월드 메모리 상태 새로고침" title="새로고침">
              {busy ? <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} /> : <RefreshCw size={16} strokeWidth={2.2} />}
            </button>
          </div>
        </header>

        {error ? (
          <div className="news-feed-alert">
            <AlertTriangle size={16} strokeWidth={2.2} />
            <span>{error}</span>
          </div>
        ) : null}

        <section className="world-memory-status-grid" aria-label="World Memory status">
          <article className="world-memory-stat">
            <span>상태</span>
            <strong>{worldMemoryStatusLabel(status)}</strong>
          </article>
          <article className="world-memory-stat">
            <span>다음 수집</span>
            <strong>{formatDateTime(nextCollection)}</strong>
          </article>
          <article className="world-memory-stat">
            <span>보고서</span>
            <strong>{report.generatedAt ? formatDateTime(report.generatedAt) : "대기"}</strong>
          </article>
        </section>

        <nav className="world-memory-tabs" aria-label="월드메모리 보기">
          <button
            type="button"
            className={activeMemoryTab === "events" ? "is-active" : ""}
            aria-selected={activeMemoryTab === "events"}
            onClick={() => setActiveMemoryTab("events")}
          >
            <Activity size={16} strokeWidth={2.2} />
            <span>시장 사건</span>
            <strong>{eventCount}</strong>
          </button>
          <button
            type="button"
            className={activeMemoryTab === "theses" ? "is-active" : ""}
            aria-selected={activeMemoryTab === "theses"}
            onClick={() => openInvestmentThesis()}
          >
            <Target size={16} strokeWidth={2.2} />
            <span>PB 투자 가설</span>
            <strong>{investmentTheses.recordCount ?? thesisRecords.length}</strong>
          </button>
        </nav>

        {activeMemoryTab === "events" ? (
          <>
            <WorldMemoryAgentActionCard
              action={agentAction}
              busy={agentActionBusy}
              disabled={actionBusy}
              onExecute={onExecuteAgentAction}
              onClear={onClearAgentAction}
            />

            <section className="world-memory-section world-memory-report-section" aria-labelledby="world-memory-report-title">
              <div className="world-memory-section-header">
                <div>
                  <h2 id="world-memory-report-title">현재 시장 상황 인식</h2>
                  <span>{report.generatedAt ? `${formatDateTime(report.generatedAt)} 작성` : "아직 작성된 보고서 없음"}</span>
                </div>
                <span className={report.status === "ready" ? "world-memory-badge is-ok" : "world-memory-badge"}>
                  {report.status === "ready" ? "ready" : "waiting"}
                </span>
              </div>
              {hasRichReport ? (
                <WorldMemoryRichReport
                  report={report}
                  relatedTheses={relatedTheses}
                  agentIcon={agentIcon}
                  agentAskLabel={agentAskLabel}
                  askDisabled={askDisabled}
                  onAskItem={onAskReportItem}
                  onOpenThesis={openInvestmentThesis}
                />
              ) : reportText ? (
                <div className="world-memory-report-body">
                  <MarkdownText text={reportText} />
                </div>
              ) : (
                <div className="world-memory-empty-report">
                  <Activity size={20} strokeWidth={2.1} />
                  <strong>수집이 끝나면 여기에 현재 시장 상황 보고서가 표시됩니다.</strong>
                  <p>상단의 수동 수집을 눌러 첫 회차를 바로 시작할 수 있습니다.</p>
                </div>
              )}
            </section>

            {!hasRichReport ? (
              <section className="world-memory-section" aria-labelledby="world-memory-suggestions-title">
                <div className="world-memory-section-header">
                  <div>
                    <h2 id="world-memory-suggestions-title">변경 제안</h2>
                    <span>수집 이후 memory/taxonomy 조정 후보</span>
                  </div>
                </div>
                {legacySuggestions.length ? (
                  <div className="world-memory-suggestion-list">
                    {legacySuggestions.map((item, index) => (
                      <div className="world-memory-suggestion" key={`${item}-${index}`}>
                        <CheckCircle2 size={15} strokeWidth={2.2} />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settings-empty">아직 표시할 변경 제안이 없습니다.</div>
                )}
              </section>
            ) : null}

            <section className="world-memory-section" aria-labelledby="world-memory-last-run-title">
              <div className="world-memory-section-header">
                <div>
                  <h2 id="world-memory-last-run-title">최근 실행</h2>
                  <span>{actionResult?.command || actionResult?.action || "아직 실행한 명령이 없습니다."}</span>
                </div>
                {actionResult ? (
                  <span className={actionResult.ok ? "world-memory-badge is-ok" : "world-memory-badge is-warn"}>
                    {actionResult.ok ? "ok" : "error"}
                  </span>
                ) : null}
              </div>
              <p className="world-memory-last-run">
                {actionText || collector.lastAction || "월드 메모리 수집 상태가 여기에 표시됩니다."}
              </p>
              {actionResult?.artifact?.path ? (
                <p className="world-memory-artifact">artifact: {actionResult.artifact.path}</p>
              ) : null}
            </section>
          </>
        ) : (
          <WorldMemoryInvestmentTheses
            memory={investmentTheses}
            focusedThesisId={focusedThesisId}
          />
        )}
      </section>
    </div>
  );
}
