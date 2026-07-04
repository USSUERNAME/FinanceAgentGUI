import React from "react";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import ChevronsRight from "lucide-react/dist/esm/icons/chevrons-right.js";
import Circle from "lucide-react/dist/esm/icons/circle.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Pause from "lucide-react/dist/esm/icons/pause.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { MarkdownText } from "../utils/MarkdownText.jsx";
import { formatDateTime } from "../utils/formatters.js";
import { worldMemoryActionCatalog } from "./actionCatalog.js";
import { worldMemoryActionText, worldMemoryStatusLabel } from "./statusHelpers.js";

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

function normalizeMemoryChangeSuggestionItem(item) {
  if (item && typeof item === "object") {
    return {
      text: String(item.text || item.body || item.title || "").trim(),
      handled: Boolean(item.handled || item.status === "handled"),
      handledAt: String(item.handledAt || "").trim(),
    };
  }
  return { text: String(item || "").trim(), handled: false, handledAt: "" };
}

function WorldMemoryChangeSuggestionRow({ item, index, agentIcon, agentAskLabel, disabled = false, onAskItem }) {
  const suggestion = normalizeMemoryChangeSuggestionItem(item);
  const { text, handled } = suggestion;
  return (
    <p className={`world-memory-change-suggestion-row${handled ? " is-handled" : ""}`}>
      <ChevronsRight size={14} strokeWidth={2.2} />
      <span className="world-memory-change-suggestion-content">
        <span className="world-memory-change-suggestion-text">{handled ? <s>{text}</s> : text}</span>
        {!handled ? (
          <button
            className="board-codex-context-button world-memory-change-agent-button"
            type="button"
            disabled={disabled}
            aria-label={`${agentAskLabel}: ${text}`}
            title={agentAskLabel}
            onClick={() => onAskItem?.("memory-change", { text }, { index })}
          >
            <img className="agent-logo-image" src={agentIcon} alt="" />
          </button>
        ) : null}
      </span>
    </p>
  );
}

function WorldMemoryRichReport({ report, agentIcon = "", agentAskLabel = "Codex에게 질문하기", askDisabled = false, onAskItem }) {
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
              agentIcon={agentIcon}
              agentAskLabel={agentAskLabel}
              askDisabled={askDisabled}
              onAskItem={onAskReportItem}
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
      </section>
    </div>
  );
}
