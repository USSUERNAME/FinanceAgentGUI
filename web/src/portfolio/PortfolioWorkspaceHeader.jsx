import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import Globe2 from "lucide-react/dist/esm/icons/globe-2.js";
import KeyRound from "lucide-react/dist/esm/icons/key-round.js";
import LockKeyhole from "lucide-react/dist/esm/icons/lock-keyhole.js";
import FileText from "lucide-react/dist/esm/icons/file-text.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Settings from "lucide-react/dist/esm/icons/settings.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import "./portfolioTossApiStatus.css";

function formatTossSnapshotProgress(reconstruction = {}) {
  const progress = reconstruction?.progress || {};
  const total = Number(progress.total || 0);
  const completed = Number(progress.completed || 0);
  const percent = Number(progress.percent);
  if (!Number.isFinite(total) || total <= 0) {
    return { fullText: "", percentText: "" };
  }
  const safeCompleted = Math.max(0, Math.min(total, Number.isFinite(completed) ? completed : 0));
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : (safeCompleted / total) * 100;
  const percentText = `${safePercent.toLocaleString("ko-KR", { maximumFractionDigits: safePercent % 1 === 0 ? 0 : 1 })}%`;
  return {
    fullText: `${safeCompleted.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")} · ${percentText}`,
    percentText,
  };
}

function tossApiStatusView(status, error = "") {
  const credentials = status?.credentials || {};
  const configured = Boolean(credentials.configured || credentials.legacyPlaintextPresent);
  const usable = Boolean(credentials.usable || credentials.unlocked);
  const locked = Boolean(credentials.locked);
  const connected = tossApiConnected(status);

  if (!status && !error) {
    return {
      tone: "checking",
      label: "저장소 상태 확인 중",
      detail: "토스증권 API 저장소 상태를 확인하고 있습니다.",
      Icon: RefreshCw,
    };
  }
  if (locked) {
    return {
      tone: "locked",
      label: "저장소 잠겨있음",
      detail: "설정에서 저장소 패스워드로 잠금 해제한 뒤 연결을 확인하세요.",
      Icon: LockKeyhole,
    };
  }
  if (error || credentials.invalid) {
    return {
      tone: "failed",
      label: "연결 실패",
      detail: error || "저장된 API키가 있지만 아직 연결 테스트를 통과하지 못했습니다.",
      Icon: AlertTriangle,
    };
  }
  if (connected) {
    return {
      tone: "connected",
      label: "연결됨",
      detail: "",
      Icon: CheckCircle2,
    };
  }
  if (configured || usable) {
    return {
      tone: "pending",
      label: "연결 테스트 진행 중",
      detail: "저장된 토스증권 API 키로 연결 상태를 확인하고 있습니다.",
      Icon: RefreshCw,
    };
  }
  return {
    tone: "missing",
    label: "저장된 Open API Key 없음",
    detail: "",
    Icon: KeyRound,
  };
}

function tossApiConnected(status) {
  const credentials = status?.credentials || {};
  const usable = Boolean(credentials.usable || credentials.unlocked);
  return Boolean((status?.connected || status?.token?.cached) && usable);
}

function tossApiSettingsActionLabel(tone) {
  if (tone === "failed") return "새로고침";
  if (tone === "missing") return "Key 등록하기";
  if (tone === "pending") return "연결 테스트";
  if (tone === "locked") return "잠금 해제";
  if (tone === "checking") return "상태 확인";
  return "설정";
}

function tossApiCredentialDiscardErrorCode(errorCode = "") {
  return ["toss_client_id_auth", "toss_client_secret_auth", "toss_client_auth"].includes(String(errorCode || ""));
}

export function PortfolioTossApiStatus({
  status,
  busy = false,
  error = "",
  errorCode = "",
  publicIp = null,
  publicIpBusy = false,
  publicIpError = "",
  orderSyncStatus = null,
  orderSyncBusy = false,
  orderSyncAction = "",
  orderSyncError = "",
  orderSyncErrorCode = "",
  showOrderSyncSummary = true,
  autoProbeConnection = true,
  onOpenSettings,
  onDeleteCredentials,
  onProbeConnection,
  onRunOrderSync,
  onCheckPublicIp,
}) {
  const syncError = String(orderSyncError || "").trim();
  const visibleError = error || syncError;
  const visibleErrorCode = error ? errorCode : orderSyncErrorCode;
  const isIpAllowlistError = visibleErrorCode === "toss_ip_allowlist";
  const statusView = tossApiStatusView(status, visibleError);
  const credentialDiscardAction = statusView.tone === "failed" && tossApiCredentialDiscardErrorCode(visibleErrorCode);
  const autoProbePending = autoProbeConnection && statusView.tone === "pending" && !visibleError;
  const manualProbeAction = statusView.tone === "pending" && !autoProbePending;
  const pendingAutoProbeKey = JSON.stringify({
    configured: Boolean(status?.credentials?.configured || status?.credentials?.legacyPlaintextPresent),
    usable: Boolean(status?.credentials?.usable || status?.credentials?.unlocked),
    locked: Boolean(status?.credentials?.locked),
    connected: Boolean(status?.connected || status?.token?.cached),
  });
  const lastAutoProbeKeyRef = React.useRef("");
  const StatusIcon = statusView.Icon;
  const activeTone = autoProbePending ? "checking" : statusView.tone;
  const detailText = busy || autoProbePending ? "저장된 토스증권 API 키로 연결 상태를 확인하고 있습니다." : statusView.detail;
  const labelText = busy || autoProbePending ? "연결 테스트 진행 중" : statusView.label;
  const refreshConnectionAction = Boolean(syncError || isIpAllowlistError || (statusView.tone === "failed" && !credentialDiscardAction));
  const settingsActionLabel = autoProbePending
    ? "확인 중"
    : credentialDiscardAction
      ? "저장소의 Key 버리기"
    : refreshConnectionAction
      ? "새로고침"
      : tossApiSettingsActionLabel(statusView.tone);
  const settingsActionIsDiscard = credentialDiscardAction;
  const SettingsActionIcon = autoProbePending || manualProbeAction || refreshConnectionAction ? RefreshCw : settingsActionIsDiscard ? Trash2 : Settings;
  const settingsActionHandler = autoProbePending
    ? onProbeConnection
    : manualProbeAction || refreshConnectionAction
      ? onProbeConnection
      : settingsActionIsDiscard
        ? onDeleteCredentials
        : onOpenSettings;
  const connected = !visibleError && (statusView.tone === "connected" || (!busy && tossApiConnected(status)));

  React.useEffect(() => {
    if (!autoProbeConnection || statusView.tone !== "pending" || visibleError) {
      lastAutoProbeKeyRef.current = "";
      return;
    }
    if (busy || !onProbeConnection || lastAutoProbeKeyRef.current === pendingAutoProbeKey) return;
    lastAutoProbeKeyRef.current = pendingAutoProbeKey;
    void onProbeConnection();
  }, [autoProbeConnection, busy, onProbeConnection, pendingAutoProbeKey, statusView.tone, visibleError]);

  return (
    <>
      <div className={`portfolio-asset-api-status is-${activeTone}`} aria-live="polite">
        <div className="portfolio-asset-api-status-icon" aria-hidden="true">
          <StatusIcon size={18} strokeWidth={2.4} />
        </div>
        <div className="portfolio-asset-api-status-copy">
          <span>토스 증권 API 연결상태</span>
          <strong>{labelText}</strong>
          {isIpAllowlistError ? <PortfolioTossIpAllowlistDetail /> : detailText ? <p>{detailText}</p> : null}
          {isIpAllowlistError ? (
            <PortfolioTossIpAllowlistActions
              publicIp={publicIp}
              publicIpBusy={publicIpBusy}
              publicIpError={publicIpError}
              onCheckPublicIp={onCheckPublicIp}
            />
          ) : null}
        </div>
        <button
          className="portfolio-asset-api-settings has-label"
          type="button"
          title={`토스증권 API ${settingsActionLabel}`}
          aria-label={`토스증권 API ${settingsActionLabel}`}
          onClick={settingsActionHandler}
          disabled={!settingsActionHandler || autoProbePending || ((manualProbeAction || refreshConnectionAction) && busy)}
        >
          <SettingsActionIcon size={17} strokeWidth={2.4} />
          <span>{settingsActionLabel}</span>
        </button>
      </div>

      {showOrderSyncSummary && connected ? (
        <PortfolioTossOrderSyncSummary
          status={orderSyncStatus}
          busy={orderSyncBusy}
          action={orderSyncAction}
          error={orderSyncError}
          onRunSync={onRunOrderSync}
        />
      ) : null}
    </>
  );
}

function PortfolioTossIpAllowlistDetail() {
  const path = ["설정", "Open API", "허용 IP 관리", "IP 추가"];
  return (
    <p>
      IP 연결 오류입니다. 토스 증권 PC 버전의{" "}
      <span className="toss-auth-alert-path" aria-label="토스 증권 PC 버전 설정 경로">
        {path.map((label, index) => (
          <React.Fragment key={label}>
            {index ? <span className="toss-auth-alert-arrow">→</span> : null}
            <span className="toss-auth-alert-step">{label}</span>
          </React.Fragment>
        ))}
      </span>{" "}
      메뉴에서 현재 사용중이신 회선의 IP 주소를 아직 등록하지 않았을 가능성이 있습니다.
    </p>
  );
}

function PortfolioTossIpAllowlistActions({
  publicIp,
  publicIpBusy = false,
  publicIpError = "",
  onCheckPublicIp,
}) {
  const [copied, setCopied] = React.useState(false);
  const publicIpAddress = String(publicIp?.address || "").trim();

  async function copyPublicIp() {
    if (!publicIpAddress) return;
    try {
      await navigator.clipboard.writeText(publicIpAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="portfolio-asset-api-ip-tools">
      <button
        className="portfolio-asset-api-ip-check"
        type="button"
        onClick={onCheckPublicIp}
        disabled={!onCheckPublicIp || publicIpBusy}
      >
        {publicIpBusy ? (
          <RefreshCw size={14} strokeWidth={2.3} />
        ) : (
          <Globe2 size={14} strokeWidth={2.3} />
        )}
        <span>{publicIpBusy ? "확인 중" : "현재 IP 주소 확인"}</span>
      </button>
      {publicIpAddress ? (
        <span className="portfolio-asset-api-ip-result">
          <span>{publicIp.family || "IP"}</span>
          <code>{publicIpAddress}</code>
          <button
            type="button"
            onClick={copyPublicIp}
            aria-label="현재 IP 주소 복사"
            title="현재 IP 주소 복사"
          >
            {copied ? <Check size={13} strokeWidth={2.3} /> : <Copy size={13} strokeWidth={2.3} />}
          </button>
        </span>
      ) : null}
      {publicIpError ? <span className="portfolio-asset-api-ip-error">{publicIpError}</span> : null}
    </div>
  );
}

function formatTossSyncKoreanDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return "";
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.hour}:${parts.minute}`;
}

function latestTossSyncAt(store = {}) {
  const states = Array.isArray(store.states) ? store.states : [];
  return states
    .map((state) => state?.last_successful_sync_at || "")
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function tossOrderSyncSummaryView({ status, busy = false, action = "", error = "" }) {
  if (!status && !error) {
    return {
      title: "거래내역 동기화 확인 중",
      detail: "토스증권 거래내역 저장소와 자동 동기화 설정을 불러오고 있습니다.",
      tone: "checking",
      metrics: [
        { label: "최근 동기화", value: "-" },
        { label: "수집 범위", value: "-" },
      ],
    };
  }

  const settings = status?.settings || {};
  const store = status?.store || {};
  const enabled = Boolean(status?.enabled || settings.enabled);
  const orderCount = Number(store.orderCount || 0);
  const states = Array.isArray(store.states) ? store.states : [];
  const reconstruction = status?.reconstruction || {};
  const reconstructionRunning = reconstruction.status === "running";
  const reconstructionStale = reconstruction.status === "stale";
  const reconstructionComplete = reconstruction.ok === true;
  const reconstructionFailed = reconstruction.ok === false && !["deferred", "stale"].includes(reconstruction.status);
  const hasNext = Boolean(status?.sync?.hasNext) || states.some((state) => Boolean(state?.has_next));
  const latestSyncLabel = formatTossSyncKoreanDateTime(latestTossSyncAt(store));
  const latestOrderLabel = formatTossSyncKoreanDateTime(store.latestOrderedAt);
  const earliestOrderLabel = formatTossSyncKoreanDateTime(store.earliestOrderedAt);
  const syncInProgress = busy && action === "sync";
  const snapshotInProgress = (busy && action === "snapshot") || reconstructionRunning;
  const snapshotProgress = formatTossSnapshotProgress(reconstruction);
  const snapshotProgressText = snapshotProgress.fullText;
  const snapshotPercentText = snapshotProgress.percentText;

  const title = error
    ? "거래내역 동기화 확인 필요"
    : snapshotInProgress
      ? snapshotPercentText
        ? `포지션 스냅샷 생성 중 · ${snapshotPercentText}`
        : "포지션 스냅샷 생성 중"
      : syncInProgress
        ? "거래내역 동기화 중"
        : hasNext
          ? "과거 거래내역 추가 동기화 필요"
          : reconstructionStale
            ? "포지션 스냅샷 생성 필요"
          : reconstructionFailed
            ? "포지션 스냅샷 확인 필요"
            : reconstructionComplete
              ? "포지션 스냅샷 생성 완료"
              : enabled && orderCount > 0
                ? "거래내역 동기화 완료"
                : enabled
                  ? "거래내역 동기화 대기 중"
                  : "거래내역 자동 동기화 꺼짐";
  const detail = error
    ? error
    : snapshotInProgress
      ? snapshotProgressText
        ? `저장된 거래내역으로 현재 보유 상태 스냅샷을 복원하고 있습니다. ${snapshotProgressText}`
        : "저장된 거래내역으로 현재 보유 상태 스냅샷을 복원하고 있습니다."
      : syncInProgress
        ? orderCount > 0
          ? `${orderCount.toLocaleString("ko-KR")}건 저장됨. 남은 페이지를 이어서 확인하고 있습니다.`
          : "토스증권 주문 내역을 SQLite 저장소에 반영하고 있습니다."
        : hasNext
          ? "토스증권 응답에 다음 페이지가 남아 있어 다음 동기화에서 이어받습니다."
          : reconstructionStale
            ? "최근 거래내역 동기화 이후 포지션 스냅샷을 다시 생성해야 합니다."
          : reconstructionFailed
            ? reconstruction.error || "거래내역은 저장되었지만 포지션 스냅샷 생성 결과를 확인해야 합니다."
            : reconstructionComplete || (enabled && orderCount > 0)
              ? ""
              : enabled
                ? "자동 동기화가 켜져 있습니다. 아직 저장된 주문 내역은 없습니다."
                : "API 연결은 살아 있지만 자동 거래내역 동기화는 꺼져 있습니다.";
  const tone = error || reconstructionFailed ? "error" : busy || snapshotInProgress ? "busy" : enabled && orderCount > 0 ? "ready" : "idle";

  return {
    title,
    detail,
    tone,
    snapshotPercentText,
    metrics: [
      { label: "최근 동기화", value: latestSyncLabel || "-" },
      ...(snapshotInProgress ? [{ label: "스냅샷 진행", value: snapshotProgressText || "계산 중" }] : []),
      { label: "수집 범위", value: earliestOrderLabel && latestOrderLabel ? `${earliestOrderLabel} ~ ${latestOrderLabel}` : "-" },
    ],
  };
}

function PortfolioTossOrderSyncSummary({
  status,
  busy = false,
  action = "",
  error = "",
  onRunSync,
}) {
  const view = tossOrderSyncSummaryView({ status, busy, action, error });
  const reconstructionRunning = status?.reconstruction?.status === "running";
  const StatusIcon = busy || reconstructionRunning || view.tone === "checking" ? RefreshCw : view.tone === "error" ? AlertTriangle : Database;
  const syncActionBusy = (busy && (action === "sync" || action === "snapshot")) || reconstructionRunning;
  const snapshotActionBusy = (busy && action === "snapshot") || reconstructionRunning;

  return (
    <section className={`portfolio-asset-sync-panel is-${view.tone}`} aria-labelledby="portfolio-asset-sync-title">
      <div className="portfolio-asset-sync-heading">
        <span className="portfolio-asset-sync-icon" aria-hidden="true">
          <StatusIcon size={17} strokeWidth={2.35} />
        </span>
        <div className="portfolio-asset-sync-copy">
          <span>동기화 정보</span>
          <strong id="portfolio-asset-sync-title">{view.title}</strong>
          {view.detail ? <p>{view.detail}</p> : null}
        </div>
      </div>
      <dl className="portfolio-asset-sync-metrics">
        {view.metrics.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <button
        className="portfolio-asset-sync-action"
        type="button"
        title="토스증권 거래내역 동기화"
        aria-label="토스증권 거래내역 동기화"
        onClick={onRunSync}
        disabled={!onRunSync || busy || reconstructionRunning}
      >
        <RefreshCw size={16} strokeWidth={2.4} />
        <span>{snapshotActionBusy ? view.snapshotPercentText || "생성 중" : syncActionBusy ? "동기화 중" : "동기화"}</span>
      </button>
    </section>
  );
}

export function PortfolioWorkspaceHeader({
  canvasName,
  modeMeta,
  isAssetMode,
  isWidgetCanvasMode,
  workspaceStatus,
  titleEditing,
  titleDraft,
  titleInputRef,
  onTitleDraftChange,
  onTitleDraftBlur,
  onTitleDraftKeyDown,
  onStartTitleEditing,
  onOpenGuide,
  onRefreshCanvas,
  canvasRefreshBusy = false,
  refreshableWidgetCount = 0,
}) {
  const CanvasModeIcon = modeMeta.Icon;
  const statusLabel =
    workspaceStatus === "review-ready"
      ? "백테스트 완료"
      : workspaceStatus === "remembered"
        ? "상태 기억됨"
        : "작업 중";
  const healthClass =
    !isWidgetCanvasMode && (workspaceStatus === "review-ready" || workspaceStatus === "remembered")
      ? "portfolio-health is-ready"
      : "portfolio-health";
  const description = isWidgetCanvasMode
    ? isAssetMode
      ? "실제 자산 데이터, 손익 추적, 비중 점검을 위젯으로 조립하는 캔버스입니다."
      : ""
    : "사용자와 에이전트가 함께 발전시키는 yfinance 기반 분석 캔버스";

  return (
    <header className="portfolio-header">
      <div className="portfolio-header-top">
        <span className={`portfolio-mode-label ${modeMeta.accentClass}`}>
          <CanvasModeIcon size={15} strokeWidth={2.3} />
          <span>{modeMeta.label}</span>
        </span>
        <div className="portfolio-header-actions">
          <button type="button" onClick={onOpenGuide}>
            <FileText size={14} strokeWidth={2.2} />
            <span>도움말</span>
          </button>
          {isWidgetCanvasMode ? null : (
            <div className={healthClass}>
              <span className="status-dot" />
              <span>{statusLabel}</span>
            </div>
          )}
        </div>
      </div>
      <div className="portfolio-title-row">
        <h1 id="portfolio-title" className="portfolio-title">
          {titleEditing ? (
            <input
              ref={titleInputRef}
              className="portfolio-title-input"
              value={titleDraft}
              aria-label="캔버스 이름"
              onChange={(event) => onTitleDraftChange?.(event.target.value)}
              onBlur={onTitleDraftBlur}
              onKeyDown={onTitleDraftKeyDown}
            />
          ) : (
            <button
              type="button"
              className="portfolio-title-button"
              title="캔버스 이름 변경"
              onClick={onStartTitleEditing}
            >
              {canvasName}
            </button>
          )}
        </h1>
        {isWidgetCanvasMode && !isAssetMode ? (
          <button
            type="button"
            className="portfolio-header-refresh"
            onClick={onRefreshCanvas}
            disabled={canvasRefreshBusy || !refreshableWidgetCount}
            title={
              refreshableWidgetCount
                ? "yfinance 기반 위젯을 의존성 순서대로 새로고침"
                : "새로고침할 yfinance 기반 위젯이 없습니다."
            }
          >
            <RefreshCw size={15} strokeWidth={2.4} />
            <span>{canvasRefreshBusy ? "새로고침 중" : "캔버스를 최신 정보로 새로고침"}</span>
          </button>
        ) : null}
      </div>
      {description ? <p>{description}</p> : null}
    </header>
  );
}
