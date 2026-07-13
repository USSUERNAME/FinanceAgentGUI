import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import Bell from "lucide-react/dist/esm/icons/bell.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import Globe2 from "lucide-react/dist/esm/icons/globe-2.js";
import Info from "lucide-react/dist/esm/icons/info.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import LockKeyhole from "lucide-react/dist/esm/icons/lock-keyhole.js";
import LogIn from "lucide-react/dist/esm/icons/log-in.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import UnlockKeyhole from "lucide-react/dist/esm/icons/unlock-keyhole.js";
import X from "lucide-react/dist/esm/icons/x.js";

import { emptyMemoryStatus } from "../memory/sharedMemoryDefaults.js";
import { getSpeedOptionsForReasoning } from "../agent/agentOptions.js";
import { FeedSourceLabel } from "../news/FeedSourceLabel.jsx";
import { formatDateTime } from "../utils/formatters.js";
import { worldMemoryAuditValue, worldMemoryStatusLabel } from "../worldMemory/statusHelpers.js";

const agentModelProviderOptions = [
  { id: "default", label: "기본 대화 모델" },
  { id: "codex-cli", label: "Codex CLI" },
  { id: "antigravity-cli", label: "Antigravity CLI" },
];

const standardSpeedOption = {
  id: "standard",
  label: "표준",
  cli: "",
  detail: "기본 Codex CLI 속도입니다.",
};

const loadingSpeedOption = {
  id: "loading",
  label: "대기",
  cli: "",
  detail: "저장된 에이전트 설정을 불러오고 있습니다.",
};

const fallbackApprovalOptions = [
  {
    id: "on-request",
    label: "요청시 승인",
    cli: "--ask-for-approval on-request",
    detail: "Codex가 필요하다고 판단한 작업에 대해 사용자 승인을 요청합니다.",
  },
  {
    id: "untrusted",
    label: "신뢰 명령만",
    cli: "--ask-for-approval untrusted",
    detail: "안전한 읽기 명령 위주로 허용하고 나머지는 승인 흐름을 탑니다.",
  },
  {
    id: "never",
    label: "승인 없음",
    cli: "--ask-for-approval never",
    detail: "진단 전용 또는 제한된 allowlist 실행에만 사용해야 합니다.",
  },
];

const loadingApprovalOptions = [
  {
    id: "loading",
    label: "설정 로드",
    cli: "",
    detail: "저장된 에이전트 설정을 불러오고 있습니다.",
  },
];

const loadingModelGroups = [
  {
    id: "loading",
    slug: "loading",
    label: "설정 로드",
    displayName: "설정 불러오는 중",
    defaultReasoningLevel: "loading",
    reasoningLevels: [
      {
        id: "loading",
        label: "대기",
        cli: "",
        detail: "저장된 에이전트 설정을 불러오고 있습니다.",
      },
    ],
    speedOptions: [loadingSpeedOption],
  },
];

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

const fallbackProviderOptions = [
  {
    id: "codex-cli",
    label: "Codex CLI",
    available: false,
    status: "checking",
    detail: "Codex CLI 확인 중",
  },
  {
    id: "antigravity-cli",
    label: "Antigravity CLI",
    available: false,
    status: "checking",
    detail: "Antigravity CLI 확인 중",
    installCommand: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  },
];

const fallbackModelGroups = [
  {
    id: "gpt-5.5",
    slug: "gpt-5.5",
    label: "5.5",
    displayName: "GPT-5.5",
    defaultReasoningLevel: "high",
    reasoningLevels: [
      { id: "low", label: "낮음", cli: '-c model_reasoning_effort="low"', detail: "Fast responses with lighter reasoning" },
      { id: "medium", label: "보통", cli: '-c model_reasoning_effort="medium"', detail: "Balances speed and reasoning depth for everyday tasks" },
      { id: "high", label: "높음", cli: '-c model_reasoning_effort="high"', detail: "Greater reasoning depth for complex problems" },
      { id: "xhigh", label: "매우 높음", cli: '-c model_reasoning_effort="xhigh"', detail: "Extra high reasoning depth for complex problems" },
    ],
    speedOptions: [standardSpeedOption],
  },
];

const fallbackAntigravityReasoningOptions = [
  { id: "minimal", label: "최소", cli: "", detail: "Gemini thinking level minimal" },
  { id: "low", label: "낮음", cli: "", detail: "Gemini thinking level low" },
  { id: "medium", label: "보통", cli: "", detail: "Gemini thinking level medium" },
  { id: "high", label: "높음", cli: "", detail: "Gemini thinking level high" },
];

const fallbackPersonaModeOptions = [
  { id: "none", label: "사용하지 않음", detail: "일반 채팅도 기본 업무 응답으로 유지합니다." },
];

const NEWS_FEED_POLL_INTERVAL_OPTIONS = Array.from({ length: 10 }, (_, index) => {
  const minutes = index + 1;
  return {
    minutes,
    seconds: minutes * 60,
    label: String(minutes) + "분",
  };
});

const MAGAZINE_SCHEDULER_INTERVAL_OPTIONS = Array.from({ length: 10 }, (_, index) => {
  const hours = index + 1;
  return {
    hours,
    label: String(hours) + "시간",
  };
});

const MAGAZINE_MAX_ARTICLES_PER_CYCLE_OPTIONS = Array.from({ length: 3 }, (_, index) => {
  const count = index + 1;
  return {
    count,
    label: String(count) + "건",
  };
});

function normalizeRuntimeProviderId(value, fallback = "codex-cli") {
  return value === "antigravity-cli" || value === "codex-cli" ? value : fallback;
}

function normalizeMagazineProviderId(value) {
  return value === "default" || value === "antigravity-cli" || value === "codex-cli" ? value : "default";
}

function profileForProvider(providerId, providerProfiles = []) {
  return providerProfiles.find((profile) => profile.id === providerId) || null;
}

function featureModelGroupsForProvider(providerId, providerProfiles = []) {
  const profile = profileForProvider(providerId, providerProfiles);
  const groups = Array.isArray(profile?.modelGroups) ? profile.modelGroups : [];
  return groups.length ? groups : fallbackModelGroups;
}

function featureModelOptions(groups = []) {
  return groups.map((group, index) => ({
    id: group.slug,
    label: index === 0 ? `최신 버전 · ${group.displayName || group.slug}` : group.displayName || group.slug,
  }));
}

function selectedFeatureModelGroup(value, providerId, providerProfiles = []) {
  const profile = profileForProvider(providerId, providerProfiles);
  const groups = featureModelGroupsForProvider(providerId, providerProfiles);
  const candidate = String(value || "").trim();
  return groups.find((group) => group.slug === candidate) ||
    groups.find((group) => group.slug === profile?.model) ||
    groups[0] || fallbackModelGroups[0];
}

function featureReasoningOptions(modelGroup, providerId) {
  const options = Array.isArray(modelGroup?.reasoningLevels) ? modelGroup.reasoningLevels : [];
  if (options.length) return options;
  return providerId === "antigravity-cli" ? fallbackAntigravityReasoningOptions : fallbackModelGroups[0].reasoningLevels;
}

function featureReasoningValue(value, modelGroup, providerId, providerProfiles = []) {
  const profile = profileForProvider(providerId, providerProfiles);
  const options = featureReasoningOptions(modelGroup, providerId);
  const optionIds = new Set(options.map((option) => option.id));
  const candidate = String(value || "").trim();
  if (optionIds.has(candidate)) return candidate;
  if (optionIds.has(profile?.reasoning)) return profile.reasoning;
  const defaultReasoning = modelGroup?.defaultReasoningLevel || (providerId === "antigravity-cli" ? "medium" : "high");
  return optionIds.has(defaultReasoning) ? defaultReasoning : options[0]?.id || "";
}

function featureSpeedOptions(modelGroup, reasoning) {
  return getSpeedOptionsForReasoning(modelGroup, reasoning);
}

function NewsFeedPollIntervalBar({ valueSeconds, disabled, saving, onChange }) {
  const selectedMinutes = Math.max(1, Math.min(10, Math.round(Number(valueSeconds || 180) / 60)));
  return (
    <div className="settings-interval-control">
      <div className="settings-interval-bar" role="radiogroup" aria-label="News Feed 수집 간격">
        {NEWS_FEED_POLL_INTERVAL_OPTIONS.map((option) => {
          const selected = option.minutes === selectedMinutes;
          return (
            <button
              className={selected ? "settings-interval-step is-selected" : "settings-interval-step"}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${option.label}마다 수집`}
              disabled={disabled || saving}
              onClick={() => {
                if (!selected) onChange(option.seconds);
              }}
              key={option.seconds}
            >
              {option.minutes}
            </button>
          );
        })}
      </div>
      <div className="settings-interval-copy">
        <strong>{saving ? "저장 중" : `${selectedMinutes}분마다 수집`}</strong>
        <span>RSS 피드 폴링 주기를 조절합니다.</span>
      </div>
    </div>
  );
}

function tossAccountStatusLabel(account) {
  return String(account?.accountSeq || "").trim() === "1" ? "기본계좌 확인됨" : "옵션계좌 확인됨";
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

function tossSyncRangeLabel(store = {}) {
  const from = formatTossSyncKoreanDateTime(store.earliestOrderedAt);
  const to = formatTossSyncKoreanDateTime(store.latestOrderedAt);
  return from && to ? `동기화 됨: ${from} ~ ${to}` : "";
}

function latestTossSyncAt(store = {}) {
  const states = Array.isArray(store.states) ? store.states : [];
  return states
    .map((state) => state?.last_successful_sync_at || "")
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

const TOSS_AUTH_PASSPHRASE_HELP =
  "API Key와 Secret Key는 사용자 암호로 암호화 되어 저장소에서 보호됩니다. 향후 API Key 사용이 필요해졌을 때 저장소의 암호화 해제를 위한 사용자 암호 입력이 필요할 수 있습니다.";

function scoreTossPassphraseStrength(value) {
  const text = String(value || "");
  if (!text) return { score: 0, tone: "weak", label: "입력한 패스워드가 너무 짧습니다." };

  const chars = Array.from(text);
  const length = chars.length;
  const uniqueRatio = new Set(chars).size / Math.max(1, length);
  const tooShort = length < 10;
  const repeatedPattern = /(.)\1{2,}/.test(text);
  const sequencePattern = /(0123|1234|2345|3456|4567|5678|6789|7890|abcd|bcde|cdef|qwer|asdf|zxcv)/i.test(text);
  const commonPattern = /(password|pass|admin|secret|api|key|toss|0000|1111|1234)/i.test(text);
  const classCount = [
    /[a-z]/.test(text),
    /[A-Z]/.test(text),
    /[0-9]/.test(text),
    /[^A-Za-z0-9]/.test(text),
  ].filter(Boolean).length;

  let score = Math.min(38, length * 4);
  score += classCount * 12;
  score += Math.round(uniqueRatio * 20);
  if (classCount >= 3) score += 10;
  if (length >= 14) score += 8;
  if (tooShort) score = Math.min(score - 35, 44);
  if (repeatedPattern) score -= 15;
  if (sequencePattern) score -= 15;
  if (commonPattern) score -= 20;
  if (classCount === 1) score -= 14;
  if (commonPattern || sequencePattern || repeatedPattern) score = Math.min(score, 59);

  const normalizedScore = Math.max(1, Math.min(100, Math.round(score)));
  const weakLabel = tooShort
    ? "입력한 패스워드가 너무 짧습니다."
    : commonPattern
      ? "흔한 단어/패턴은 사용을 권장하지 않습니다"
      : sequencePattern || repeatedPattern
        ? "연속/키보드 패턴은 사용을 권장하지 않습니다"
        : "충분하지 못한 보안 수준의 패스워드";
  if (normalizedScore >= 72) {
    return { score: normalizedScore, tone: "strong", label: "안전한 패스워드" };
  }
  if (normalizedScore >= 45) {
    return { score: normalizedScore, tone: "medium", label: weakLabel };
  }
  return { score: normalizedScore, tone: "weak", label: weakLabel };
}

function TossPassphraseStrengthPie({ value }) {
  const text = String(value || "");
  if (!text) return null;

  const strength = scoreTossPassphraseStrength(text);
  return (
    <div
      className={`toss-auth-strength is-${strength.tone}`}
      aria-label={`패스워드 강도 ${strength.label}`}
      title={`패스워드 강도 ${strength.label}`}
    >
      <span
        className="toss-auth-strength-pie"
        style={{ "--strength-score": `${strength.score}%` }}
        aria-hidden="true"
      />
      <span className="toss-auth-strength-label">{strength.label}</span>
    </div>
  );
}

function TossStoragePassphraseHelp({ helpId, helpOpen, onToggleHelp, containerRef }) {
  return (
    <span className="toss-auth-help-anchor" ref={containerRef}>
      <button
        className="toss-auth-help-button"
        type="button"
        aria-label="저장소 패스워드 설명 보기"
        aria-controls={helpId}
        aria-expanded={helpOpen}
        onClick={onToggleHelp}
      >
        <span aria-hidden="true">?</span>
      </button>
      {helpOpen ? (
        <p className="toss-auth-help-popover" id={helpId}>
          {TOSS_AUTH_PASSPHRASE_HELP}
        </p>
      ) : null}
    </span>
  );
}

function TossInvestErrorAlert({
  error,
  errorCode,
  publicIp,
  publicIpBusy,
  publicIpError,
  onCheckPublicIp,
}) {
  const [copied, setCopied] = React.useState(false);
  const publicIpAddress = String(publicIp?.address || "").trim();

  async function handleCopyPublicIp() {
    if (!publicIpAddress) return;
    try {
      await navigator.clipboard.writeText(publicIpAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (!error) return null;
  if (errorCode === "toss_ip_allowlist") {
    const path = ["설정", "Open API", "허용 IP 관리", "IP 추가"];
    return (
      <div className="news-feed-alert toss-auth-alert">
        <AlertTriangle size={16} strokeWidth={2.2} />
        <span className="toss-auth-alert-copy">
          <strong className="toss-auth-alert-title">IP 연결 오류입니다.</strong>
          <span>
            토스 증권 PC 버전의{" "}
            <span className="toss-auth-alert-path" aria-label="토스 증권 PC 버전 설정 경로">
              {path.map((label, index) => (
                <React.Fragment key={label}>
                  {index ? <span className="toss-auth-alert-arrow">→</span> : null}
                  <span className="toss-auth-alert-step">{label}</span>
                </React.Fragment>
              ))}
            </span>{" "}
            메뉴에서 현재 사용중이신 회선의 IP 주소를 아직 등록하지 않았을 가능성이 있습니다.
          </span>
          <span className="toss-auth-alert-actions">
            <button
              className="toss-auth-alert-button"
              type="button"
              onClick={onCheckPublicIp}
              disabled={publicIpBusy}
            >
              {publicIpBusy ? (
                <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
              ) : (
                <Globe2 size={15} strokeWidth={2.2} />
              )}
              <span>{publicIpBusy ? "확인 중" : "현재 IP 주소 확인"}</span>
            </button>
            {publicIpAddress ? (
              <span className="toss-auth-ip-result">
                <span className="toss-auth-ip-family">{publicIp.family || "IP"}</span>
                <code>{publicIpAddress}</code>
                <button
                  className="toss-auth-ip-copy"
                  type="button"
                  onClick={handleCopyPublicIp}
                  aria-label="현재 IP 주소 복사"
                  title="현재 IP 주소 복사"
                >
                  {copied ? <Check size={14} strokeWidth={2.2} /> : <Copy size={14} strokeWidth={2.2} />}
                </button>
              </span>
            ) : null}
          </span>
          {publicIpError ? <span className="toss-auth-ip-error">{publicIpError}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <div className="news-feed-alert">
      <AlertTriangle size={16} strokeWidth={2.2} />
      <span>{error}</span>
    </div>
  );
}

export function TossInvestConnectionSection({
  status,
  busy,
  action,
  error,
  errorCode,
  publicIp,
  publicIpBusy,
  publicIpError,
  autoProbeAfterSave = false,
  autoProbeAfterUnlock = false,
  onReload,
  onSaveCredentials,
  onUnlockVault,
  onLockVault,
  onProbe,
  onCheckPublicIp,
  onDeleteCredentials,
  orderSync,
  transactionStatusVisibility,
}) {
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [savePassphrase, setSavePassphrase] = React.useState("");
  const [savePassphraseConfirm, setSavePassphraseConfirm] = React.useState("");
  const [unlockPassphrase, setUnlockPassphrase] = React.useState("");
  const [passphraseHelpOpen, setPassphraseHelpOpen] = React.useState(false);
  const passphraseHelpRef = React.useRef(null);
  const credentials = status?.credentials || {};
  const visibleError = error || orderSync?.error || "";
  const visibleErrorCode = errorCode || orderSync?.errorCode || "";
  const statusLoaded = Boolean(status?.credentials);
  const configured = Boolean(credentials.configured);
  const usable = Boolean(credentials.usable || credentials.unlocked);
  const locked = Boolean(credentials.locked);
  const connected = Boolean((status?.connected || status?.token?.cached) && usable);
  const sourceLabel =
    credentials.source === "env"
      ? "환경변수"
    : credentials.source === "vault"
        ? "암호화 저장소"
        : configured
          ? "설정됨"
          : "미설정";
  const storageLabel =
    credentials.source === "env"
      ? "환경변수"
      : credentials.storage === "aes-256-gcm-scrypt-local-vault"
        ? "AES-256-GCM + scrypt"
        : credentials.storage || "-";
  const vaultLabel =
    credentials.source === "env"
      ? "환경변수 관리"
      : credentials.invalid
        ? "파일 확인 필요"
        : locked
          ? "잠김"
          : usable
            ? "잠금 해제됨"
            : configured
              ? "저장됨"
              : "없음";
  const statusLabel = visibleError
    ? "확인 필요"
    : connected
      ? "연결 확인됨"
      : locked
        ? "저장소 잠겨있음"
        : usable
          ? "잠금 해제됨"
          : configured
            ? "키 저장됨"
            : credentials.legacyPlaintextPresent
              ? "재저장 필요"
              : "연결 없음";
  const diagnosticClass = busy
    ? "settings-agent-diagnostic is-loading"
    : visibleError || credentials.invalid
      ? "settings-agent-diagnostic is-error"
      : connected
        ? "settings-agent-diagnostic is-ok"
        : "settings-agent-diagnostic";
  const StatusIcon = busy ? LoaderCircle : visibleError ? AlertTriangle : connected || usable ? ShieldCheck : locked ? LockKeyhole : Database;
  const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
  const accountConnectionLabel = accounts.some((account) => String(account?.accountSeq || "").trim() === "1")
    ? "기본계좌 확인됨. "
    : accounts.length
      ? "옵션계좌 확인됨. "
      : "";
  const statusDetail = visibleError
    ? "토스증권 Open API 연결 상태를 확인해야 합니다."
    : connected
      ? `${accountConnectionLabel}주문 실행 API는 이 앱에서 제공하지 않습니다.`
    : locked
      ? "암호화된 키 저장소가 잠겨 있습니다. 패스워드로 잠금 해제한 뒤 계좌 조회를 확인합니다."
      : usable
        ? "복호화된 키는 현재 서버 메모리에만 있습니다. 연결 테스트로 계좌 조회를 확인할 수 있습니다."
        : configured
          ? `${sourceLabel}에서 키를 읽었습니다. 연결 테스트로 계좌 조회를 확인할 수 있습니다.`
          : "토스 증권 Open API Key를 입력하여 주식채널+와 연결할 수 있습니다.";
  const envManaged = credentials.source === "env";
  const canUnlock = !envManaged && locked && unlockPassphrase.length > 0 && !busy;
  const savePassphraseReady = savePassphrase.length > 0 && savePassphrase === savePassphraseConfirm;
  const savePassphraseStrength = scoreTossPassphraseStrength(savePassphrase);
  const savePassphraseSecureEnough = savePassphraseStrength.tone !== "weak";
  const savePassphraseMismatch = Boolean(savePassphraseConfirm && savePassphrase !== savePassphraseConfirm);
  const shouldShowCredentialForm = statusLoaded && !configured;
  const canSave =
    shouldShowCredentialForm &&
    !envManaged &&
    clientId.trim() &&
    clientSecret.trim() &&
    savePassphraseReady &&
    savePassphraseSecureEnough &&
    !busy;
  const canProbe = usable && !busy && action !== "probe";
  const canLock = !envManaged && usable && !locked && !busy;
  const canDelete = !envManaged && (configured || credentials.legacyPlaintextPresent);
  const shouldShowConnectionActions = configured || usable || locked || canDelete || busy || action;
  const shouldShowProbeActions = usable || connected || action === "probe";

  React.useEffect(() => {
    if (!passphraseHelpOpen) return undefined;

    function closePassphraseHelpOnOutsidePointer(event) {
      if (passphraseHelpRef.current?.contains(event.target)) return;
      setPassphraseHelpOpen(false);
    }

    window.addEventListener("pointerdown", closePassphraseHelpOnOutsidePointer, true);
    return () => window.removeEventListener("pointerdown", closePassphraseHelpOnOutsidePointer, true);
  }, [passphraseHelpOpen]);

  async function handleSave(event) {
    event.preventDefault();
    if (!canSave) return;
    const result = await onSaveCredentials({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      passphrase: savePassphrase,
    });
    if (result) {
      setClientId("");
      setClientSecret("");
      setSavePassphrase("");
      setSavePassphraseConfirm("");
    }
  }

  async function handleUnlock(event) {
    event.preventDefault();
    if (!canUnlock) return;
    const result = await onUnlockVault({ passphrase: unlockPassphrase });
    if (result) setUnlockPassphrase("");
  }

  return (
    <section className="settings-section toss-auth-section" aria-labelledby="toss-auth-settings-title">
      <div className="settings-section-header">
        <h2 id="toss-auth-settings-title">토스증권 읽기 전용 연결</h2>
        <span>{statusLabel}</span>
      </div>

      <div className={`toss-auth-grid${shouldShowConnectionActions ? "" : " is-status-only"}`}>
        <div className={diagnosticClass}>
          <StatusIcon size={17} strokeWidth={2.2} />
          <div className="toss-auth-status-copy">
            <p className="toss-auth-status-line">
            <strong>{statusLabel}</strong>
              <span className="toss-auth-status-separator" aria-hidden="true">-</span>
              <span className="toss-auth-status-detail">{statusDetail}</span>
            </p>
          </div>
        </div>

        {shouldShowConnectionActions ? (
          <div className="arca-auth-actions" aria-label="토스증권 연결 작업">
            {shouldShowProbeActions ? (
              <>
                <button
                  className="settings-memory-refresh"
                  type="button"
                  onClick={onProbe}
                  disabled={!canProbe}
                >
                  {action === "probe" ? (
                    <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
                  ) : (
                    <Check size={16} strokeWidth={2.2} />
                  )}
                  <span>연결 테스트</span>
                </button>
              </>
            ) : null}
            {canLock || action === "lock" ? (
              <button
                className="settings-memory-refresh"
                type="button"
                onClick={onLockVault}
                disabled={!canLock || action === "lock"}
              >
                {action === "lock" ? (
                  <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
                ) : (
                  <LockKeyhole size={16} strokeWidth={2.2} />
                )}
                <span>잠금</span>
              </button>
            ) : null}
            <button
              className="settings-memory-delete arca-auth-icon-action"
              type="button"
              onClick={onDeleteCredentials}
              disabled={busy || action === "delete" || !canDelete}
              aria-label="저장된 토스증권 API 키 삭제"
              title={envManaged ? "환경변수 키는 앱에서 삭제할 수 없습니다" : "저장된 API 키 삭제"}
            >
              {action === "delete" ? (
                <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
              ) : (
                <Trash2 size={16} strokeWidth={2.2} />
              )}
            </button>
          </div>
        ) : null}
      </div>

      {shouldShowCredentialForm ? (
        <div className="news-feed-alert toss-auth-setup-hint">
          <Info size={16} strokeWidth={2.2} />
          <span className="toss-auth-setup-hint-copy">
            토스증권 PC 버전에서 <code>설정</code>→<code>Open API</code> 메뉴에서 API Key와 Secret Key를
            생성할 수 있습니다.
          </span>
        </div>
      ) : null}

      <TossInvestErrorAlert
        error={visibleError}
        errorCode={visibleErrorCode}
        publicIp={publicIp}
        publicIpBusy={publicIpBusy}
        publicIpError={publicIpError}
        onCheckPublicIp={onCheckPublicIp}
      />

      {credentials.legacyPlaintextPresent ? (
        <div className="news-feed-alert">
          <AlertTriangle size={16} strokeWidth={2.2} />
          <span>
            이전 평문 키 파일이 감지되었습니다. 새 저장소 패스워드로 다시 저장하면 평문 파일은 제거됩니다.
          </span>
        </div>
      ) : null}

      {locked ? (
        <form className="toss-auth-unlock-form" onSubmit={handleUnlock}>
          <label className="toss-auth-field">
            <span>저장소 패스워드 입력</span>
            <input
              id="toss-auth-unlock-passphrase"
              type="password"
              value={unlockPassphrase}
              autoComplete="current-password"
              spellCheck="false"
              disabled={busy || envManaged}
              onChange={(event) => setUnlockPassphrase(event.target.value)}
              placeholder=""
            />
          </label>
          <button className="settings-memory-refresh toss-auth-save" type="submit" disabled={!canUnlock}>
            {action === "unlock" || (autoProbeAfterUnlock && action === "probe") ? (
              <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
            ) : (
              <UnlockKeyhole size={16} strokeWidth={2.2} />
            )}
            <span>{autoProbeAfterUnlock ? "잠금 해제하고 연결 테스트" : "잠금 해제"}</span>
          </button>
        </form>
      ) : null}

      {shouldShowCredentialForm ? (
        <form className="toss-auth-form" onSubmit={handleSave}>
          <div className="toss-auth-form-group">
            <h3 className="toss-auth-form-title">Open API Key 입력</h3>
            <label className="toss-auth-field">
              <span>API Key</span>
              <input
                type="text"
                value={clientId}
                autoComplete="off"
                spellCheck="false"
                disabled={busy || envManaged}
                onChange={(event) => setClientId(event.target.value)}
                placeholder=""
              />
            </label>
            <label className="toss-auth-field">
              <span>Secret Key</span>
              <input
                type="password"
                value={clientSecret}
                autoComplete="off"
                spellCheck="false"
                disabled={busy || envManaged}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder=""
              />
            </label>
          </div>
          <div className="toss-auth-form-group">
            <div className="toss-auth-form-title-row">
              <h3 className="toss-auth-form-title">저장소 패스워드 설정</h3>
              <TossStoragePassphraseHelp
                helpId="toss-auth-save-passphrase-help"
                helpOpen={passphraseHelpOpen}
                onToggleHelp={() => setPassphraseHelpOpen((current) => !current)}
                containerRef={passphraseHelpRef}
              />
            </div>
            <label className="toss-auth-field">
              <span>저장소 패스워드 설정하기</span>
              <input
                id="toss-auth-save-passphrase"
                type="password"
                value={savePassphrase}
                autoComplete="new-password"
                spellCheck="false"
                disabled={busy || envManaged}
                onChange={(event) => setSavePassphrase(event.target.value)}
                placeholder=""
              />
            </label>
            <label className="toss-auth-field">
              <span>저장소 패스워드 다시 입력하기</span>
              <input
                type="password"
                value={savePassphraseConfirm}
                autoComplete="new-password"
                spellCheck="false"
                disabled={busy || envManaged}
                onChange={(event) => setSavePassphraseConfirm(event.target.value)}
                placeholder=""
                aria-invalid={savePassphraseMismatch ? "true" : "false"}
              />
            </label>
            <TossPassphraseStrengthPie value={savePassphrase} />
          </div>
          <div className="toss-auth-form-actions">
            <button className="settings-memory-refresh toss-auth-save" type="submit" disabled={!canSave}>
              {action === "save" || (autoProbeAfterSave && action === "probe") ? (
                <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
              ) : (
                <Check size={16} strokeWidth={2.2} />
              )}
              <span>{autoProbeAfterSave ? "저장하고 연결 테스트" : "저장하기"}</span>
            </button>
          </div>
        </form>
      ) : null}

      <dl className="arca-auth-meta toss-auth-meta">
        <div>
          <dt>키 출처</dt>
          <dd>{sourceLabel}</dd>
        </div>
        <div>
          <dt>저장소 상태</dt>
          <dd>{vaultLabel}</dd>
        </div>
        <div>
          <dt>키 암호화</dt>
          <dd>{storageLabel}</dd>
        </div>
        <div>
          <dt>토큰 캐시</dt>
          <dd>{status?.token?.cached ? "암호화 메모리 보관 중" : "없음"}</dd>
        </div>
        <div>
          <dt>토큰 만료</dt>
          <dd>{formatDateTime(status?.token?.expiresAt)}</dd>
        </div>
        <div>
          <dt>토큰 암호화</dt>
          <dd>{status?.token?.encryptionLabel || "AES-256-GCM · 메모리 전용"}</dd>
        </div>
      </dl>

      {accounts.length ? (
        <div className="toss-auth-account-list" aria-label="토스증권 계좌 목록">
          <h3 className="toss-auth-account-list-title">계좌 목록</h3>
          <ul className="toss-auth-accounts">
            {accounts.map((account) => (
              <li className="toss-auth-account-row" key={`${account.accountSeq}-${account.accountNo}`}>
                <span className="toss-auth-account-status">{tossAccountStatusLabel(account)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {transactionStatusVisibility ? (
        <div
          className={
            transactionStatusVisibility.hidden
              ? "settings-feature-row is-enabled"
              : "settings-feature-row is-disabled"
          }
        >
          <div className="settings-source-main">
            <strong className="settings-feature-title">거래 현황 숨기기</strong>
            <em className={transactionStatusVisibility.error ? "is-error" : undefined}>
              {transactionStatusVisibility.error ||
                "토스 API를 사용하지 않는 경우 사이드바에서 거래 현황 메뉴를 숨깁니다."}
            </em>
          </div>
          <button
            type="button"
            className={transactionStatusVisibility.hidden ? "settings-toggle is-on" : "settings-toggle"}
            role="switch"
            aria-checked={transactionStatusVisibility.hidden}
            disabled={transactionStatusVisibility.busy || transactionStatusVisibility.saving}
            onClick={() => transactionStatusVisibility.onChange?.(!transactionStatusVisibility.hidden)}
          >
            <span className="settings-toggle-track">
              <span className="settings-toggle-thumb" />
            </span>
            <span>
              {transactionStatusVisibility.saving
                ? "저장 중"
                : transactionStatusVisibility.hidden
                  ? "켜짐"
                  : "꺼짐"}
            </span>
          </button>
        </div>
      ) : null}

      {orderSync && connected && !visibleError ? <TossInvestOrderSyncSection {...orderSync} connectionStatus={status} /> : null}
    </section>
  );
}

function TossInvestOrderSyncSection({
  status,
  busy,
  action,
  error,
  connectionStatus,
  onToggleEnabled,
  onRunSync,
}) {
  const settings = status?.settings || {};
  const store = status?.store || {};
  const enabled = Boolean(status?.enabled || settings.enabled);
  const credentials = connectionStatus?.credentials || {};
  const connectionUsable = Boolean(credentials.usable || credentials.unlocked);
  const connected = Boolean((connectionStatus?.connected || connectionStatus?.token?.cached) && connectionUsable);
  const orderCount = Number(store.orderCount || 0);
  const hasSyncedOrders = orderCount > 0;
  const syncStates = Array.isArray(store.states) ? store.states : [];
  const reconstruction = status?.reconstruction || {};
  const reconstructionRunning = reconstruction.status === "running";
  const reconstructionStale = reconstruction.status === "stale";
  const reconstructionComplete = reconstruction.ok === true;
  const reconstructionFailed = reconstruction.ok === false && !["deferred", "stale"].includes(reconstruction.status);
  const hasNext = Boolean(status?.sync?.hasNext) || syncStates.some((state) => Boolean(state?.has_next));
  const syncInProgress = busy && action === "sync";
  const snapshotInProgress = (busy && action === "snapshot") || reconstructionRunning;
  const snapshotProgress = formatTossSnapshotProgress(reconstruction);
  const snapshotProgressText = snapshotProgress.fullText;
  const snapshotPercentText = snapshotProgress.percentText;
  const syncRange = enabled ? tossSyncRangeLabel(store) : "";
  const syncStatusText = error
    ? "확인 필요"
    : snapshotInProgress
      ? snapshotProgressText
        ? `스냅샷 생성중 · ${snapshotProgressText}`
        : "스냅샷 생성중"
      : syncInProgress
        ? "과거 거래 내역 동기화 중"
        : hasNext
          ? "과거 거래 내역 더 있음"
          : reconstructionStale
            ? "스냅샷 생성 필요"
          : reconstructionFailed
            ? "스냅샷 확인 필요"
            : reconstructionComplete
              ? "스냅샷 생성 완료"
              : hasSyncedOrders
                ? "완료"
                : enabled
                  ? "동기화 대기 중"
                  : "꺼짐";
  const statusLabel = error
    ? "확인 필요"
    : snapshotInProgress
      ? "스냅샷 생성중"
      : reconstructionStale
        ? "생성 필요"
      : reconstructionFailed
        ? "확인 필요"
        : busy
          ? "동기화 중"
          : enabled
            ? "켜짐"
            : "꺼짐";
  const headerStatus =
    snapshotInProgress
      ? `${orderCount}건 · ${snapshotPercentText ? `스냅샷 ${snapshotPercentText}` : "스냅샷 생성중"} · SQLite`
      : reconstructionStale
        ? `${orderCount}건 · 스냅샷 필요 · SQLite`
      : reconstructionFailed
        ? `${orderCount}건 · 스냅샷 확인 필요 · SQLite`
      : reconstructionComplete
        ? `${orderCount}건 · 스냅샷 완료 · SQLite`
      : enabled && !error && !busy
      ? `${orderCount}건 · SQLite`
      : busy
        ? hasSyncedOrders
          ? `${orderCount}건 · 동기화 중 · SQLite`
          : "동기화 중 · SQLite"
        : error
          ? "확인 필요 · SQLite"
          : "SQLite";
  const statusNote =
    snapshotInProgress
      ? snapshotProgressText
        ? `거래내역 저장 완료 · 스냅샷 생성중 · ${snapshotProgressText}`
        : "거래내역 저장 완료 · 스냅샷 생성중"
      : reconstructionStale
        ? syncRange
          ? `스냅샷 생성 필요 · ${syncRange}`
          : "스냅샷 생성 필요"
      : reconstructionFailed
        ? reconstruction.error || "거래내역은 저장되었지만 포지션 스냅샷 생성 결과를 확인해야 합니다."
      : reconstructionComplete
        ? syncRange
          ? `스냅샷 생성 완료 · ${syncRange}`
          : "스냅샷 생성 완료"
      : syncInProgress
      ? hasSyncedOrders
        ? `과거 거래 내역 동기화 중 · ${orderCount}건 저장`
        : "과거 거래 내역 동기화 중"
      : syncRange || error || (busy ? "동기화 중" : enabled ? "동기화 대기 중" : "");
  const diagnosticClass = busy || snapshotInProgress
    ? "settings-agent-diagnostic is-loading"
    : error || reconstructionFailed
      ? "settings-agent-diagnostic is-error"
      : enabled && store.exists
        ? "settings-agent-diagnostic is-ok"
        : "settings-agent-diagnostic";
  const StatusIcon = busy || snapshotInProgress ? LoaderCircle : error || reconstructionFailed ? AlertTriangle : Database;
  const toggleDisabled = busy || reconstructionRunning || (!connected && !enabled);
  const runDisabled = busy || reconstructionRunning || !enabled || !connected;

  return (
    <div className="toss-order-sync-subsection" aria-labelledby="toss-order-sync-title">
      <div className="settings-subsection-header toss-order-sync-subheader">
        <div className="toss-order-sync-title-copy">
          <h3 id="toss-order-sync-title">거래내역 동기화</h3>
          {statusNote ? (
            <em className={syncRange ? "toss-order-sync-range" : error ? "is-error" : undefined}>{statusNote}</em>
          ) : null}
        </div>
        <div className="toss-order-sync-header-actions">
          <span className="toss-order-sync-storage-label">{headerStatus}</span>
          <button
            type="button"
            className={enabled ? "settings-toggle is-on" : "settings-toggle"}
            role="switch"
            aria-checked={enabled}
            disabled={toggleDisabled}
            onClick={() => onToggleEnabled?.(!enabled)}
          >
            <span className="settings-toggle-track">
              <span className="settings-toggle-thumb" />
            </span>
            <span>{action === "toggle" ? "저장 중" : enabled ? "켜짐" : "꺼짐"}</span>
          </button>
        </div>
      </div>

      <div className="settings-memory-grid toss-order-sync-grid">
        <div className={diagnosticClass}>
          <StatusIcon size={16} strokeWidth={2.2} />
          <div>
            <strong>
              {snapshotInProgress
                ? snapshotProgressText
                  ? `스냅샷 생성중 · ${snapshotProgressText}`
                  : "스냅샷 생성중"
                : syncInProgress
                  ? "과거 거래 내역 동기화 중"
                  : reconstructionStale
                    ? "포지션 스냅샷 생성 필요"
                  : reconstructionFailed
                    ? "포지션 스냅샷 확인 필요"
                    : reconstructionComplete
                      ? "포지션 스냅샷 생성 완료"
                      : enabled
                        ? "SQLite 거래내역 저장소"
                        : "SQLite 거래내역 저장소 대기"}
            </strong>
          </div>
        </div>
        <div className="arca-auth-actions" aria-label="거래내역 동기화 작업">
          <button className="settings-memory-refresh" type="button" onClick={onRunSync} disabled={runDisabled}>
            {(busy && (action === "sync" || action === "snapshot")) || reconstructionRunning ? (
              <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
            ) : (
              <RefreshCw size={15} strokeWidth={2.2} />
            )}
            <span>{snapshotInProgress ? (snapshotPercentText ? `스냅샷 ${snapshotPercentText}` : "스냅샷 생성중") : busy && action === "sync" ? "동기화 중" : reconstructionStale ? "스냅샷 생성" : "지금 동기화"}</span>
          </button>
        </div>
      </div>

      <dl className="arca-auth-meta toss-order-sync-meta">
        <div>
          <dt>저장된 거래 내역</dt>
          <dd>{orderCount}건</dd>
        </div>
        <div>
          <dt>최초 주문</dt>
          <dd>{formatTossSyncKoreanDateTime(store.earliestOrderedAt) || "-"}</dd>
        </div>
        <div>
          <dt>최근 주문</dt>
          <dd>{formatTossSyncKoreanDateTime(store.latestOrderedAt) || "-"}</dd>
        </div>
        <div>
          <dt>동기화 상태</dt>
          <dd>{syncStatusText}</dd>
        </div>
      </dl>
    </div>
  );
}

function MagazineSchedulerIntervalBar({ valueHours, disabled, saving, onChange }) {
  const selectedHours = Math.max(1, Math.min(10, Math.round(Number(valueHours || 6))));
  return (
    <div className={disabled ? "settings-interval-control is-disabled" : "settings-interval-control"}>
      <div className="settings-interval-bar" role="radiogroup" aria-label="Magazine 기사 생성 간격">
        {MAGAZINE_SCHEDULER_INTERVAL_OPTIONS.map((option) => {
          const selected = option.hours === selectedHours;
          return (
            <button
              className={selected ? "settings-interval-step is-selected" : "settings-interval-step"}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${option.label}마다 기사 생성`}
              disabled={disabled || saving}
              onClick={() => {
                if (!selected) onChange(option.hours);
              }}
              key={option.hours}
            >
              {option.hours}
            </button>
          );
        })}
      </div>
      <div className="settings-interval-copy">
        <strong>{saving ? "저장 중" : `${selectedHours}시간마다 기사 생성`}</strong>
        <span>{disabled ? "저장 중에는 생성 간격을 변경할 수 없습니다." : "자동 기사 생성 주기를 조절합니다."}</span>
      </div>
      <p className="settings-interval-warning">
        이 기능은 토큰 소모가 대단히 많아 기사 생성 간격을 좁히면 ChatGPT Plus / Gemini Pro 요금에제서는 토큰 사용 한계에 빠르게 도달할 수 있습니다.
      </p>
    </div>
  );
}

function MagazineMaxArticlesPerCycleBar({ valueCount, disabled, saving, onChange }) {
  const selectedCount = Math.max(1, Math.min(3, Math.round(Number(valueCount || 2))));
  return (
    <div className={disabled ? "settings-interval-control is-disabled" : "settings-interval-control"}>
      <div
        className="settings-interval-bar"
        role="radiogroup"
        aria-label="Magazine 생성 주기당 최대 기사 생성수"
        style={{ "--settings-interval-steps": MAGAZINE_MAX_ARTICLES_PER_CYCLE_OPTIONS.length }}
      >
        {MAGAZINE_MAX_ARTICLES_PER_CYCLE_OPTIONS.map((option) => {
          const selected = option.count === selectedCount;
          return (
            <button
              className={selected ? "settings-interval-step is-selected" : "settings-interval-step"}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`생성 주기당 최대 ${option.label}`}
              disabled={disabled || saving}
              onClick={() => {
                if (!selected) onChange(option.count);
              }}
              key={option.count}
            >
              {option.count}
            </button>
          );
        })}
      </div>
      <div className="settings-interval-copy">
        <strong>{saving ? "저장 중" : `최대 ${selectedCount}건까지 생성`}</strong>
        <span>
          {disabled
            ? "저장 중에는 최대 생성 수를 변경할 수 없습니다."
            : `모델이 0~${selectedCount}건 사이에서 판단합니다. 이 숫자는 확정 생성 수가 아닙니다.`}
        </span>
      </div>
    </div>
  );
}

function SettingsSelectField({
  id,
  label,
  value,
  options,
  onChange,
  description = "",
  disabled = false,
  getOptionLabel = (option) => option.label,
  actionLabel = "",
  actionBusy = false,
  onAction = null,
}) {
  const safeOptions = options.length ? options : [{ id: "", label: "대기" }];

  return (
    <div className="settings-select-field">
      <div className="settings-select-label-row">
        <label htmlFor={id}>{label}</label>
        {actionLabel && onAction ? (
          <button type="button" disabled={disabled || actionBusy} onClick={onAction}>
            <RefreshCw size={12} strokeWidth={2.2} aria-hidden="true" />
            <span>{actionBusy ? "불러오는 중" : actionLabel}</span>
          </button>
        ) : null}
      </div>
      <span className="settings-select-shell">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {safeOptions.map((option) => (
            <option value={option.id} key={option.id}>
              {getOptionLabel(option)}
            </option>
          ))}
        </select>
        <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
      </span>
      {description ? <span className="settings-select-description">{description}</span> : null}
    </div>
  );
}

function AgentSettingsSection({
  providerOptions,
  provider,
  onProviderChange,
  providerStatus,
  providerProfiles = [],
  onProviderEnabledChange = () => {},
  onProviderSettingChange = () => {},
  approvalOptions,
  approval,
  onApprovalChange,
  modelGroups,
  model,
  onModelChange,
  reasoningOptions,
  reasoning,
  onReasoningChange,
  speedOptions,
  speed,
  onSpeedChange,
  settingsError,
  loading = false,
  modelCatalogRefreshing = false,
  onReloadModelCatalog = () => {},
}) {
  const safeProviderOptions = loading
    ? [{ id: "loading", label: "설정 불러오는 중", available: false }]
    : providerOptions.length
      ? providerOptions
      : fallbackProviderOptions;
  const selectedProvider = loading
    ? safeProviderOptions[0]
    : safeProviderOptions.find((item) => item.id === provider) ?? safeProviderOptions[0];
  const safeApprovalOptions = loading
    ? loadingApprovalOptions
    : approvalOptions.length
      ? approvalOptions
      : fallbackApprovalOptions;
  const safeModelGroups = loading
    ? loadingModelGroups
    : modelGroups.length
      ? modelGroups
      : fallbackModelGroups;
  const safeReasoningOptions = loading
    ? loadingModelGroups[0].reasoningLevels
    : reasoningOptions.length
      ? reasoningOptions
      : fallbackModelGroups[0].reasoningLevels;
  const safeSpeedOptions = loading ? [loadingSpeedOption] : speedOptions.length ? speedOptions : [standardSpeedOption];
  const selectedApprovalOption =
    safeApprovalOptions.find((option) => option.id === approval) ?? safeApprovalOptions[0];
  const fallbackProfiles = safeProviderOptions.map((option) => ({
    id: option.id,
    label: option.label,
    enabled: option.id === provider,
    toggleDisabled: option.id === provider,
    status: option.id === provider ? providerStatus : option,
    approvalOptions: safeApprovalOptions,
    approval,
    modelGroups: safeModelGroups,
    model,
    reasoningOptions: safeReasoningOptions,
    reasoning,
    speedOptions: safeSpeedOptions,
    speed,
  }));
  const profiles = loading ? [] : providerProfiles.length ? providerProfiles : fallbackProfiles;
  const enabledProfiles = profiles.filter((profile) => profile.enabled);
  const defaultProviderOptions = enabledProfiles.length
    ? enabledProfiles.map((profile) => ({ id: profile.id, label: profile.label }))
    : [{ id: selectedProvider?.id || provider, label: selectedProvider?.label || "에이전트" }];
  const defaultProviderDisabled = loading || enabledProfiles.length < 2;

  return (
    <section className="settings-section" aria-labelledby="agent-settings-title">
      <div className="settings-section-header">
        <h2 id="agent-settings-title">에이전트 설정</h2>
        <span>config/agent-settings.user.json</span>
      </div>

      {loading ? (
        <div className="settings-agent-diagnostic is-loading">
          <LoaderCircle size={16} strokeWidth={2.2} />
          <div>
            <strong>에이전트 설정 불러오는 중</strong>
            <p>저장된 사용자 설정을 확인한 뒤 선택값을 표시합니다.</p>
          </div>
        </div>
      ) : null}

      {settingsError ? (
        <div className="settings-agent-diagnostic is-error">
          <AlertTriangle size={16} strokeWidth={2.2} />
          <div>
            <strong>에이전트 설정 저장 실패</strong>
            <p>{settingsError}</p>
          </div>
        </div>
      ) : null}

      <div className="settings-default-model-control">
        <SettingsSelectField
          id="agent-default-provider"
          label="기본 대화 모델"
          value={loading ? "loading" : selectedProvider?.id || provider}
          options={loading ? [{ id: "loading", label: "설정 로드" }] : defaultProviderOptions}
          onChange={onProviderChange}
          description={
            loading
              ? ""
              : defaultProviderDisabled
                ? "사용함 상태인 에이전트가 하나일 때는 자동으로 선택됩니다."
                : "오른쪽 기본 대화창과 일반 채팅 요청에 사용할 에이전트입니다."
          }
          disabled={defaultProviderDisabled}
        />
      </div>

      <div className="settings-agent-provider-list">
        {profiles.map((profile) => {
          const profileApprovalOptions = profile.approvalOptions?.length
            ? profile.approvalOptions
            : safeApprovalOptions;
          const profileModelGroups = profile.modelGroups?.length
            ? profile.modelGroups
            : safeModelGroups;
          const profileReasoningOptions = profile.reasoningOptions?.length
            ? profile.reasoningOptions
            : safeReasoningOptions;
          const profileSpeedOptions = profile.speedOptions?.length
            ? profile.speedOptions
            : safeSpeedOptions;
          const profileApproval =
            profileApprovalOptions.find((option) => option.id === profile.approval) ??
            profileApprovalOptions[0];
          const profileModelOptions = profileModelGroups.map((group, index) => ({
            id: group.slug,
            label:
              index === 0
                ? `최신 버전 · ${group.displayName || group.slug}`
                : group.displayName || group.slug,
          }));
          const profileModelGroup =
            profileModelGroups.find((group) => group.slug === profile.model) || profileModelGroups[0];
          const reasoningEmbedded = Boolean(profileModelGroup?.reasoningEmbedded);
          const diagnosticClass = profile.enabled
            ? profile.status?.available
              ? "settings-agent-diagnostic is-ok"
              : "settings-agent-diagnostic is-error"
            : "settings-agent-diagnostic";

          return (
            <article
              className={profile.enabled ? "settings-agent-provider-panel is-enabled" : "settings-agent-provider-panel"}
              key={profile.id}
            >
              <div className="settings-agent-provider-head">
                <div className="settings-agent-provider-title">
                  <strong>{profile.label}</strong>
                  <span>{profile.enabled ? "사용함" : "사용 안 함"}</span>
                </div>
                <button
                  type="button"
                  className={profile.enabled ? "settings-toggle is-on" : "settings-toggle"}
                  role="switch"
                  aria-checked={profile.enabled}
                  aria-label={`${profile.label} 사용 여부`}
                  disabled={loading || profile.toggleDisabled}
                  onClick={() => onProviderEnabledChange(profile.id, !profile.enabled)}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                  <span>{profile.enabled ? "사용함" : "사용 안 함"}</span>
                </button>
              </div>

              <div className={diagnosticClass}>
                {profile.enabled && profile.status?.available ? (
                  <CheckCircle2 size={16} strokeWidth={2.2} />
                ) : profile.enabled ? (
                  <AlertTriangle size={16} strokeWidth={2.2} />
                ) : (
                  <ShieldCheck size={16} strokeWidth={2.2} />
                )}
                <div>
                  <strong>
                    {profile.enabled
                      ? profile.status?.available
                        ? `${profile.label} 준비됨`
                        : `${profile.label} 확인 필요`
                      : `${profile.label} 대기`}
                  </strong>
                  <p>
                    {profile.enabled
                      ? profile.status?.detail || "연결 상태를 확인하고 있습니다."
                      : "사용함으로 전환하면 아래 세부 설정이 적용됩니다."}
                  </p>
                </div>
              </div>

              {profile.enabled ? (
                <div className="settings-agent-grid">
                  <SettingsSelectField
                    id={`agent-${profile.id}-approval-policy`}
                    label="에이전트 권한"
                    value={profile.approval}
                    options={profileApprovalOptions}
                    onChange={(nextApproval) => onProviderSettingChange(profile.id, { approval: nextApproval })}
                    description={profileApproval?.detail || selectedApprovalOption?.detail || ""}
                    disabled={loading}
                  />
                  <SettingsSelectField
                    id={`agent-${profile.id}-model-version`}
                    label="모델 버전"
                    value={profile.model}
                    options={profileModelOptions}
                    onChange={(nextModel) => onProviderSettingChange(profile.id, { model: nextModel })}
                    disabled={loading}
                    description={reasoningEmbedded
                      ? "추론 수준은 모델 변형에 포함됩니다. Antigravity CLI에는 별도 추론·속도 옵션이 없습니다."
                      : ""}
                    actionLabel={reasoningEmbedded ? "목록 다시 불러오기" : ""}
                    actionBusy={modelCatalogRefreshing}
                    onAction={onReloadModelCatalog}
                  />
                  {!reasoningEmbedded ? (
                    <SettingsSelectField
                      id={`agent-${profile.id}-reasoning-level`}
                      label="추론 수준"
                      value={profile.reasoning}
                      options={profileReasoningOptions}
                      onChange={(nextReasoning) => onProviderSettingChange(profile.id, { reasoning: nextReasoning })}
                      disabled={loading}
                      actionLabel="목록 다시 불러오기"
                      actionBusy={modelCatalogRefreshing}
                      onAction={onReloadModelCatalog}
                    />
                  ) : null}
                  {profileSpeedOptions.length > 1 ? (
                    <SettingsSelectField
                      id={`agent-${profile.id}-speed`}
                      label="속도"
                      value={profile.speed}
                      options={profileSpeedOptions}
                      onChange={(nextSpeed) => onProviderSettingChange(profile.id, { speed: nextSpeed })}
                      disabled={loading}
                      description={profileSpeedOptions.find((option) => option.id === profile.speed)?.detail || ""}
                    />
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PersonaModeSection({
  personaModeOptions = [],
  personaMode = "none",
  onPersonaModeChange = () => {},
  loading = false,
}) {
  const safePersonaModeOptions = personaModeOptions.length ? personaModeOptions : fallbackPersonaModeOptions;
  const selectedPersonaModeOption =
    safePersonaModeOptions.find((option) => option.id === personaMode) ?? safePersonaModeOptions[0];

  return (
    <section className="settings-section settings-persona-section" aria-labelledby="persona-mode-settings-title">
      <div className="settings-section-header">
        <h2 id="persona-mode-settings-title">페르소나 모드</h2>
        <span>일반 채팅 · 실적 분석</span>
      </div>

      <div className="settings-persona-control">
        <SettingsSelectField
          id="settings-persona-mode"
          label="페르소나 모드"
          value={loading ? "none" : selectedPersonaModeOption?.id || "none"}
          options={safePersonaModeOptions}
          onChange={onPersonaModeChange}
          description={
            loading
              ? ""
              : `${selectedPersonaModeOption?.detail || ""} 코딩, 월드 메모리, 번역, 보고서 작성에는 적용하지 않습니다.`
          }
          disabled={loading}
        />
      </div>
    </section>
  );
}

function MemoryRecordRow({ record, onDelete, deleting = false }) {
  return (
    <article className="settings-memory-row">
      <div className="settings-memory-row-main">
        <strong>{record.title || "공유 작업 메모리"}</strong>
        <p>{record.summary || "요약 없음"}</p>
        <div className="settings-memory-tags">
          {(record.tags || []).slice(0, 5).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <div className="settings-memory-row-meta">
        <span>{record.source?.providerLabel || record.source?.provider || "agent"}</span>
        <span>{formatDateTime(record.createdAt)}</span>
      </div>
      <button
        className="settings-memory-delete"
        type="button"
        aria-label={`${record.title || "공유 작업 메모리"} 기록 삭제`}
        title="기록 삭제"
        onClick={() => onDelete(record)}
        disabled={deleting}
      >
        {deleting ? <LoaderCircle size={15} strokeWidth={2.2} /> : <Trash2 size={15} strokeWidth={2.1} />}
      </button>
    </article>
  );
}

function SharedMemoryDialog({
  open,
  records,
  totalCount,
  hasMore,
  busy,
  error,
  deletingRecordId,
  onClose,
  onScroll,
  onDeleteRecord,
}) {
  if (!open) return null;

  return (
    <div className="memory-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="memory-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="memory-dialog-header">
          <div>
            <h2 id="memory-dialog-title">공유 메모리 전체 기록</h2>
            <p>{totalCount}개 기록 · 아래로 스크롤하면 이어서 불러옵니다.</p>
          </div>
          <button className="icon-button tooltip-button" type="button" onClick={onClose} aria-label="대화상자 닫기">
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>

        {error ? (
          <div className="news-feed-alert">
            <AlertTriangle size={16} strokeWidth={2.2} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="memory-dialog-list" onScroll={onScroll}>
          {records.map((record) => (
            <MemoryRecordRow
              record={record}
              key={record.id}
              onDelete={onDeleteRecord}
              deleting={deletingRecordId === record.id}
            />
          ))}

          {!records.length && !busy ? (
            <div className="settings-empty">아직 저장된 공유 메모리가 없습니다.</div>
          ) : null}

          {busy ? (
            <div className="settings-memory-loading">
              <LoaderCircle size={16} strokeWidth={2.2} />
              <span>기록을 불러오는 중</span>
            </div>
          ) : null}

          {!busy && records.length && !hasMore ? (
            <div className="settings-memory-end">마지막 기록입니다.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SharedMemorySection({
  status,
  busy,
  error,
  recentOpen,
  onToggleRecent,
  onReload,
  onOpenDialog,
  onDeleteRecord,
  deletingRecordId,
}) {
  const safeStatus = status || emptyMemoryStatus;
  const records = Array.isArray(safeStatus.records) ? safeStatus.records : [];
  const latestLabel = safeStatus.latestRecordAt ? formatDateTime(safeStatus.latestRecordAt) : "기록 없음";
  const canShowMore = Number(safeStatus.recordCount || 0) > records.length;

  return (
    <section className="settings-section settings-memory-section" aria-labelledby="shared-memory-title">
      <div className="settings-section-header">
        <h2 id="shared-memory-title">공유 메모리</h2>
        <span>{safeStatus.recordCount || 0}개 기록 · 로컬 전용</span>
      </div>

      <div className="settings-memory-grid">
        <div className={error ? "settings-agent-diagnostic is-error" : "settings-agent-diagnostic is-ok"}>
          {error ? <AlertTriangle size={16} strokeWidth={2.2} /> : <Database size={16} strokeWidth={2.2} />}
          <div>
            <strong>{error ? "메모리 상태 확인 실패" : "Codex · Antigravity 공용 저장소"}</strong>
            <p>{error || `${safeStatus.paths?.events || emptyMemoryStatus.paths.events} · Git 제외 · 최근 ${latestLabel}`}</p>
          </div>
        </div>

        <button className="settings-memory-refresh" type="button" onClick={onReload} disabled={busy}>
          {busy ? <LoaderCircle size={15} strokeWidth={2.2} /> : <RefreshCw size={15} strokeWidth={2.2} />}
          <span>{busy ? "다시 읽는 중" : "메모리 다시 읽어오기"}</span>
        </button>
      </div>

      <div className="settings-subsection" aria-labelledby="shared-memory-recent-title">
        <button
          className="settings-subsection-header settings-memory-collapse"
          type="button"
          aria-expanded={recentOpen}
          aria-controls="shared-memory-recent-list"
          onClick={onToggleRecent}
        >
          <div className="settings-memory-collapse-title">
            {recentOpen ? <ChevronDown size={16} strokeWidth={2.2} /> : <ChevronRight size={16} strokeWidth={2.2} />}
            <h3 id="shared-memory-recent-title">최근 기록</h3>
          </div>
          <span>{recentOpen ? `${records.length}개 표시` : "접힘"}</span>
        </button>

        {recentOpen ? (
          <div className="settings-memory-list" id="shared-memory-recent-list">
            {records.map((record) => (
              <MemoryRecordRow
                record={record}
                key={record.id}
                onDelete={onDeleteRecord}
                deleting={deletingRecordId === record.id}
              />
            ))}

            {!records.length ? (
              <div className="settings-empty">아직 저장된 공유 메모리가 없습니다.</div>
            ) : null}

            {canShowMore ? (
              <button className="settings-memory-more" type="button" onClick={onOpenDialog}>
                더 보기
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ArcaNotificationAuthSection({
  status,
  busy,
  action,
  error,
  onReload,
  onStartHandoff,
  onCaptureSession,
  onStopHandoff,
  onDeleteSession,
}) {
  const connected = Boolean(status?.connected);
  const handoff = status?.handoff || null;
  const handoffAlive = Boolean(handoff?.alive);
  const invalid = Boolean(status?.invalid);
  const statusLabel = invalid
    ? "세션 확인 필요"
    : connected
      ? "알림 세션 저장됨"
      : handoffAlive
        ? "로그인 진행 중"
        : "세션 없음";
  const statusDetail = invalid
    ? "저장된 세션을 다시 확인해야 합니다."
    : connected
      ? "알림 세션을 저장했습니다. 쿠키 값은 화면에 표시하지 않습니다."
      : handoffAlive
        ? "열린 전용 브라우저에서 로그인한 뒤 세션 저장을 누르세요."
        : "로그인 창을 열고 알림 수신용 세션만 저장합니다.";
  const diagnosticClass = busy
    ? "settings-agent-diagnostic is-loading"
    : invalid || error
      ? "settings-agent-diagnostic is-error"
      : connected
        ? "settings-agent-diagnostic is-ok"
        : "settings-agent-diagnostic";
  const StatusIcon = busy ? LoaderCircle : connected ? ShieldCheck : Bell;

  return (
    <section className="settings-section arca-auth-section" aria-labelledby="arca-auth-settings-title">
      <div className="settings-section-header">
        <h2 id="arca-auth-settings-title">아카라이브 알림</h2>
        <span>{statusLabel}</span>
      </div>

      <div className="arca-auth-grid">
        <div className={diagnosticClass}>
          <StatusIcon size={17} strokeWidth={2.2} />
          <div className="arca-auth-status-copy">
            <p className="arca-auth-status-line">
              <strong>{statusLabel}</strong>
              <span className="arca-auth-status-separator" aria-hidden="true">-</span>
              <span className="arca-auth-status-detail">{statusDetail}</span>
            </p>
          </div>
        </div>

        <div className="arca-auth-actions" aria-label="아카라이브 로그인 작업">
          <button
            className="settings-memory-refresh"
            type="button"
            onClick={onStartHandoff}
            disabled={busy || action === "start"}
          >
            {action === "start" ? (
              <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
            ) : (
              <LogIn size={16} strokeWidth={2.2} />
            )}
            <span>{handoffAlive ? "로그인 창 다시 열기" : "로그인 창 열기"}</span>
          </button>
          <button
            className="settings-memory-refresh"
            type="button"
            onClick={onCaptureSession}
            disabled={busy || action === "capture" || !handoffAlive}
          >
            {action === "capture" ? (
              <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
            ) : (
              <Check size={16} strokeWidth={2.2} />
            )}
            <span>세션 저장</span>
          </button>
          <button
            className="settings-memory-refresh"
            type="button"
            onClick={onReload}
            disabled={busy || action === "reload"}
          >
            {action === "reload" ? (
              <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
            ) : (
              <RefreshCw size={16} strokeWidth={2.2} />
            )}
            <span>상태 확인</span>
          </button>
          <button
            className="settings-memory-delete arca-auth-icon-action"
            type="button"
            onClick={onStopHandoff}
            disabled={busy || action === "stop" || !handoff}
            aria-label="아카라이브 로그인 브라우저 닫기"
            title="로그인 브라우저 닫기"
          >
            {action === "stop" ? (
              <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
            ) : (
              <X size={16} strokeWidth={2.2} />
            )}
          </button>
          <button
            className="settings-memory-delete arca-auth-icon-action"
            type="button"
            onClick={onDeleteSession}
            disabled={busy || action === "delete" || !connected}
            aria-label="저장된 아카라이브 세션 삭제"
            title="저장된 세션 삭제"
          >
            {action === "delete" ? (
              <LoaderCircle className="is-spinning" size={16} strokeWidth={2.2} />
            ) : (
              <Trash2 size={16} strokeWidth={2.2} />
            )}
          </button>
        </div>
      </div>

      {error ? (
        <div className="news-feed-alert">
          <AlertTriangle size={16} strokeWidth={2.2} />
          <span>{error}</span>
        </div>
      ) : null}

      <dl className="arca-auth-meta">
        <div>
          <dt>저장 시각</dt>
          <dd>{formatDateTime(status?.updatedAt || status?.capturedAt)}</dd>
        </div>
        <div>
          <dt>가장 이른 만료</dt>
          <dd>{formatDateTime(status?.expiresAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function SettingsView({
  settings,
  busy,
  savingFeedId,
  error,
  onReload,
  onToggleFeed,
  onPollIntervalChange,
  agentSettings,
  memoryStatus,
  memoryBusy,
  memoryError,
  memoryRecentOpen,
  onToggleMemoryRecent,
  onReloadMemory,
  onOpenMemoryDialog,
  onDeleteMemoryRecord,
  deletingMemoryRecordId,
  memoryDialog,
  worldMemoryStatus,
  worldMemoryBusy,
  worldMemoryError,
  worldMemoryTechOpen,
  worldMemorySettings,
  worldMemorySettingsBusy,
  worldMemorySettingsSaving,
  worldMemorySettingsError,
  magazineSettings,
  magazineSettingsBusy,
  magazineSettingsSaving,
  magazineSettingsError,
  onToggleWorldMemoryTech,
  onToggleWorldMemoryEnabled,
  onWorldMemoryManagementSettingsChange,
  onToggleMagazineEnabled,
  onMagazineWritingSettingsChange,
  onMagazineSchedulerIntervalChange,
  onMagazineMaxArticlesPerCycleChange,
  onReloadWorldMemory,
  tossInvest,
  tossOrderSync,
  transactionStatusVisibility,
  arcaAuth,
}) {
  const feeds = settings?.feeds || [];
  const savingPollInterval = savingFeedId === "poll-interval";
  const selectedPollIntervalMinutes = Math.max(
    1,
    Math.min(10, Math.round(Number(settings?.pollIntervalSeconds || 180) / 60))
  );
  const {
    personaModeOptions = [],
    personaMode = "none",
    onPersonaModeChange = () => {},
    loading: agentSettingsLoading = false,
    ...agentSettingsSection
  } = agentSettings || {};
  const agentProvider = agentSettingsSection.provider || "codex-cli";
  const agentProviderProfiles = agentSettingsSection.providerProfiles || [];

  return (
    <div className="settings-shell">
      <section className="settings-board" aria-labelledby="settings-title">
        <header className="settings-header">
          <div>
            <h1 id="settings-title">설정</h1>
          </div>
          <button className="board-refresh-button" type="button" onClick={onReload} disabled={busy}>
            {busy ? <LoaderCircle size={16} strokeWidth={2.2} /> : <RefreshCw size={16} strokeWidth={2.2} />}
            <span>{busy ? "확인 중" : "새로고침"}</span>
          </button>
        </header>

        {error ? (
          <div className="news-feed-alert">
            <AlertTriangle size={16} strokeWidth={2.2} />
            <span>{error}</span>
          </div>
        ) : null}

        <AgentSettingsSection {...agentSettingsSection} loading={agentSettingsLoading} />

        <SharedMemorySection
          status={memoryStatus}
          busy={memoryBusy}
          error={memoryError}
          recentOpen={memoryRecentOpen}
          onToggleRecent={onToggleMemoryRecent}
          onReload={onReloadMemory}
          onOpenDialog={onOpenMemoryDialog}
          onDeleteRecord={onDeleteMemoryRecord}
          deletingRecordId={deletingMemoryRecordId}
        />

        <WorldMemoryDiagnosticsSection
          status={worldMemoryStatus}
          busy={worldMemoryBusy}
          error={worldMemoryError}
          techOpen={worldMemoryTechOpen}
          settings={worldMemorySettings}
          settingsBusy={worldMemorySettingsBusy}
          settingsSaving={worldMemorySettingsSaving}
          settingsError={worldMemorySettingsError}
          magazineSettings={magazineSettings}
          magazineSettingsBusy={magazineSettingsBusy}
          magazineSettingsSaving={magazineSettingsSaving}
          magazineSettingsError={magazineSettingsError}
          onToggleTech={onToggleWorldMemoryTech}
          onToggleEnabled={onToggleWorldMemoryEnabled}
          onManagementSettingsChange={onWorldMemoryManagementSettingsChange}
          onToggleMagazineEnabled={onToggleMagazineEnabled}
          onMagazineWritingSettingsChange={onMagazineWritingSettingsChange}
          onMagazineSchedulerIntervalChange={onMagazineSchedulerIntervalChange}
          onMagazineMaxArticlesPerCycleChange={onMagazineMaxArticlesPerCycleChange}
          onReload={onReloadWorldMemory}
          agentProvider={agentProvider}
          agentProviderProfiles={agentProviderProfiles}
          agentSettingsLoading={agentSettingsLoading}
          modelCatalogRefreshing={Boolean(agentSettingsSection.modelCatalogRefreshing)}
          onReloadModelCatalog={agentSettingsSection.onReloadModelCatalog}
        />

        <TossInvestConnectionSection
          {...tossInvest}
          orderSync={tossOrderSync}
          transactionStatusVisibility={transactionStatusVisibility}
        />

        <ArcaNotificationAuthSection {...arcaAuth} />

        <section className="settings-section settings-news-feed-section" aria-labelledby="news-feed-settings-title">
          <div className="settings-section-header">
            <h2 id="news-feed-settings-title">News Feed</h2>
            <span>
              {feeds.length}개 출처 · {selectedPollIntervalMinutes}분
            </span>
          </div>

          <div className="settings-subsection" aria-labelledby="news-feed-source-settings-title">
            <div className="settings-subsection-header">
              <h3 id="news-feed-source-settings-title">출처</h3>
              <span>{feeds.length}개</span>
            </div>

            <div className="settings-source-list">
              {feeds.map((feed) => {
                const saving = savingFeedId === feed.id;
                return (
                  <div
                    className={feed.enabled ? "settings-source-row is-enabled" : "settings-source-row is-disabled"}
                    key={feed.id}
                  >
                    <div className="settings-source-main">
                      <FeedSourceLabel feedId={feed.id} title={feed.title} className="settings-source-title" />
                      {feed.lastError ? <em>{feed.lastError}</em> : null}
                    </div>
                    <button
                      type="button"
                      className={feed.enabled ? "settings-toggle is-on" : "settings-toggle"}
                      role="switch"
                      aria-checked={feed.enabled}
                      disabled={saving || busy}
                      onClick={() => onToggleFeed(feed.id, !feed.enabled)}
                    >
                      <span className="settings-toggle-track">
                        <span className="settings-toggle-thumb" />
                      </span>
                      <span>{saving ? "저장 중" : feed.enabled ? "켜짐" : "꺼짐"}</span>
                    </button>
                  </div>
                );
              })}

              {!feeds.length && !busy ? (
                <div className="settings-empty">등록된 News Feed 출처가 없습니다.</div>
              ) : null}
            </div>
          </div>

          <div className="settings-subsection" aria-labelledby="news-feed-interval-settings-title">
            <div className="settings-subsection-header">
              <h3 id="news-feed-interval-settings-title">수집간격</h3>
              <span>{selectedPollIntervalMinutes}분</span>
            </div>
            <NewsFeedPollIntervalBar
              valueSeconds={settings?.pollIntervalSeconds || 180}
              disabled={busy || !settings}
              saving={savingPollInterval}
              onChange={onPollIntervalChange}
            />
          </div>
        </section>

        <PersonaModeSection
          personaModeOptions={personaModeOptions}
          personaMode={personaMode}
          onPersonaModeChange={onPersonaModeChange}
          loading={agentSettingsLoading}
        />
      </section>

      <SharedMemoryDialog {...memoryDialog} onDeleteRecord={onDeleteMemoryRecord} />
    </div>
  );
}

function WorldMemoryDiagnosticsSection({
  status,
  busy,
  error,
  techOpen,
  settings,
  settingsBusy = false,
  settingsSaving = false,
  settingsError = "",
  magazineSettings = null,
  magazineSettingsBusy = false,
  magazineSettingsSaving = false,
  magazineSettingsError = "",
  onToggleTech,
  onToggleEnabled,
  onManagementSettingsChange = () => {},
  onToggleMagazineEnabled,
  onMagazineWritingSettingsChange = () => {},
  onMagazineSchedulerIntervalChange = () => {},
  onMagazineMaxArticlesPerCycleChange = () => {},
  onReload,
  agentProvider = "codex-cli",
  agentProviderProfiles = [],
  agentSettingsLoading = false,
  modelCatalogRefreshing = false,
  onReloadModelCatalog = () => {},
}) {
  const enabled = Boolean(settings?.enabled ?? status?.enabled);
  const toggleBusy = settingsBusy || settingsSaving;
  const managementProvider = settings?.settings?.managementProvider || settings?.managementProvider || "default";
  const managementSelectedProvider = normalizeMagazineProviderId(managementProvider);
  const managementEffectiveProvider = managementSelectedProvider === "default"
    ? normalizeRuntimeProviderId(agentProvider)
    : managementSelectedProvider;
  const managementProviderProfile = profileForProvider(managementEffectiveProvider, agentProviderProfiles);
  const managementModelGroup = selectedFeatureModelGroup(
    settings?.settings?.managementModel || settings?.managementModel,
    managementEffectiveProvider,
    agentProviderProfiles
  );
  const managementModelOptions = featureModelOptions(
    featureModelGroupsForProvider(managementEffectiveProvider, agentProviderProfiles)
  );
  const managementReasoningOptions = featureReasoningOptions(managementModelGroup, managementEffectiveProvider);
  const managementReasoning = featureReasoningValue(
    settings?.settings?.managementReasoning || settings?.managementReasoning,
    managementModelGroup,
    managementEffectiveProvider,
    agentProviderProfiles
  );
  const managementReasoningOption =
    managementReasoningOptions.find((option) => option.id === managementReasoning) || managementReasoningOptions[0];
  const managementSpeedOptions = featureSpeedOptions(managementModelGroup, managementReasoning);
  const managementSpeed = managementSpeedOptions.some(
    (option) => option.id === (settings?.settings?.managementSpeed || settings?.managementSpeed)
  )
    ? settings?.settings?.managementSpeed || settings?.managementSpeed
    : managementSpeedOptions[0]?.id || "standard";
  const managementProviderLabel =
    managementProviderProfile?.label || (managementEffectiveProvider === "antigravity-cli" ? "Antigravity CLI" : "Codex CLI");
  const magazineEnabled = enabled && Boolean(magazineSettings?.enabled);
  const magazineToggleBusy = magazineSettingsBusy || magazineSettingsSaving;
  const magazineToggleDisabled = !enabled || magazineToggleBusy;
  const magazineWritingProvider =
    magazineSettings?.settings?.writingProvider || magazineSettings?.writingProvider || "default";
  const magazineSelectedProvider = normalizeMagazineProviderId(magazineWritingProvider);
  const magazineEffectiveProvider = magazineSelectedProvider === "default"
    ? normalizeRuntimeProviderId(agentProvider)
    : magazineSelectedProvider;
  const magazineProviderProfile = profileForProvider(magazineEffectiveProvider, agentProviderProfiles);
  const magazineModelGroup = selectedFeatureModelGroup(
    magazineSettings?.settings?.writingModel || magazineSettings?.writingModel,
    magazineEffectiveProvider,
    agentProviderProfiles
  );
  const magazineModelOptions = featureModelOptions(
    featureModelGroupsForProvider(magazineEffectiveProvider, agentProviderProfiles)
  );
  const magazineReasoningOptions = featureReasoningOptions(magazineModelGroup, magazineEffectiveProvider);
  const magazineWritingReasoning = featureReasoningValue(
    magazineSettings?.settings?.writingReasoning || magazineSettings?.writingReasoning,
    magazineModelGroup,
    magazineEffectiveProvider,
    agentProviderProfiles
  );
  const magazineReasoningOption =
    magazineReasoningOptions.find((option) => option.id === magazineWritingReasoning) ||
    magazineReasoningOptions[0];
  const magazineSpeedOptions = featureSpeedOptions(magazineModelGroup, magazineWritingReasoning);
  const magazineWritingSpeed = magazineSpeedOptions.some(
    (option) => option.id === (magazineSettings?.settings?.writingSpeed || magazineSettings?.writingSpeed)
  )
    ? magazineSettings?.settings?.writingSpeed || magazineSettings?.writingSpeed
    : magazineSpeedOptions[0]?.id || "standard";
  const magazineReasoningProviderLabel =
    magazineProviderProfile?.label || (magazineEffectiveProvider === "antigravity-cli" ? "Antigravity CLI" : "Codex CLI");
  const magazineSchedulerIntervalHours = Math.max(
    1,
    Math.min(
      10,
      Math.round(
        Number(magazineSettings?.settings?.schedulerIntervalHours ?? magazineSettings?.schedulerIntervalHours ?? 6)
      )
    )
  );
  const magazineMaxArticlesPerCycle = Math.max(
    1,
    Math.min(
      3,
      Math.round(
        Number(
          magazineSettings?.settings?.schedulerMaxArticlesPerCycle ??
            magazineSettings?.schedulerMaxArticlesPerCycle ??
            2
        )
      )
    )
  );
  const displayError = enabled ? error : "";
  const dependencies = status?.dependencies;
  const dependencyIssues = dependencies?.issues || [];
  const rows = status?.audit?.json?.rows || [];
  const entriesCount = status?.list?.json?.count ?? worldMemoryAuditValue(status, "Total entries", 0);
  const dbReady = Boolean(status?.db?.exists);
  const techRows = [
    ["DB", dbReady ? "ready" : "not initialized"],
    ["Entries", entriesCount],
    ["States", status?.states?.json?.count ?? 0],
    ["Taxonomy", status?.taxonomy?.json?.count ?? 0],
    ["Embedding engine", status?.embedding?.engine || "-"],
    ["Embedding model", status?.embedding?.model || "-"],
    ["DB path", status?.paths?.dbPath || "-"],
    ["Prompt", "config/world-memory-collection.prompt.md"],
    ["Collector state", "data/world-memory/collector-state.json"],
  ];

  return (
    <section className="settings-section settings-memory-section" aria-labelledby="world-memory-settings-title">
      <div className="settings-section-header">
        <h2 id="world-memory-settings-title">World Memory Engine</h2>
        <span>{enabled ? `${worldMemoryStatusLabel(status)} · 6시간 주기` : "꺼짐 · 사이드바 숨김"}</span>
      </div>

      <div className={enabled ? "settings-feature-row is-enabled" : "settings-feature-row is-disabled"}>
        <div className="settings-source-main">
          <strong className="settings-feature-title">월드 메모리 사용</strong>
          <em className={settingsError ? "is-error" : undefined}>
            {settingsError ||
              (enabled
                ? "AI가 스스로 정보를 축적하고 분류하고 지속적으로 최신 이슈를 파악합니다."
                : "꺼짐 상태에서는 사이드바 메뉴와 에이전트 전역 컨텍스트를 숨깁니다.")}
          </em>
        </div>
        <button
          type="button"
          className={enabled ? "settings-toggle is-on" : "settings-toggle"}
          role="switch"
          aria-checked={enabled}
          disabled={toggleBusy}
          onClick={() => onToggleEnabled?.(!enabled)}
        >
          <span className="settings-toggle-track">
            <span className="settings-toggle-thumb" />
          </span>
          <span>{settingsSaving ? "저장 중" : enabled ? "켜짐" : "꺼짐"}</span>
        </button>
      </div>

      <div className="settings-memory-grid">
        <div className={displayError ? "settings-agent-diagnostic is-error" : enabled ? "settings-agent-diagnostic is-ok" : "settings-agent-diagnostic"}>
          {displayError ? <AlertTriangle size={16} strokeWidth={2.2} /> : <Database size={16} strokeWidth={2.2} />}
          <div>
            <strong>{displayError ? "월드 메모리 상태 확인 필요" : "독립 월드 메모리 저장소"}</strong>
            <p>
              {displayError ||
                (enabled
                  ? `${status?.paths?.dbPath || "data/world-memory/world_issue_log.sqlite3"} · 최근 성공 ${formatDateTime(
                      status?.collector?.lastSuccessfulAt
                    )}`
                  : `${settings?.configPath || "config/world-memory.user.json"} · 기본 꺼짐`)}
            </p>
          </div>
        </div>

        <button className="settings-memory-refresh" type="button" onClick={onReload} disabled={busy || !enabled}>
          {busy ? <LoaderCircle size={15} strokeWidth={2.2} /> : <RefreshCw size={15} strokeWidth={2.2} />}
          <span>{busy ? "다시 읽는 중" : "월드 메모리 다시 읽기"}</span>
        </button>
      </div>

      {enabled ? (
        <div className="settings-subsection" aria-labelledby="world-memory-tech-title">
          <button
            className="settings-subsection-header settings-memory-collapse"
            type="button"
            aria-expanded={techOpen}
            aria-controls="world-memory-tech-details"
            onClick={onToggleTech}
          >
            <div className="settings-memory-collapse-title">
              {techOpen ? <ChevronDown size={16} strokeWidth={2.2} /> : <ChevronRight size={16} strokeWidth={2.2} />}
              <h3 id="world-memory-tech-title">기술 세부사항</h3>
            </div>
            <span>{techOpen ? "펼침" : "접힘"}</span>
          </button>

          {techOpen ? (
            <div className="settings-world-memory-details" id="world-memory-tech-details">
              <div className="world-memory-dependency-list">
                {["pandas", "requests", "yfinance", "sentence_transformers"].map((name) => {
                  const installed = Boolean(dependencies?.modules?.[name]);
                  return (
                    <span className={installed ? "is-installed" : "is-missing"} key={name}>
                      {installed ? <CheckCircle2 size={14} strokeWidth={2.2} /> : <AlertTriangle size={14} strokeWidth={2.2} />}
                      {name}
                    </span>
                  );
                })}
              </div>

              {dependencyIssues.length ? (
                <div className="world-memory-issues">
                  {dependencyIssues.map((issue, index) => (
                    <p key={`${issue.code}-${index}`}>
                      <strong>{issue.status}</strong> {issue.message}
                      {issue.installCommand ? <code>{issue.installCommand}</code> : null}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="world-memory-table">
                {techRows.map(([label, value]) => (
                  <div className="world-memory-table-row" key={label}>
                    <span>{label}</span>
                    <strong>{String(value ?? "-")}</strong>
                  </div>
                ))}
              </div>

              <div className="world-memory-table">
                {rows.slice(0, 12).map((row) => (
                  <div className="world-memory-table-row" key={row.Metric}>
                    <span>{row.Metric}</span>
                    <strong>{String(row.Value ?? "")}</strong>
                  </div>
                ))}
                {!rows.length ? <div className="settings-empty">Audit 결과가 아직 없습니다.</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {enabled ? (
        <div className="settings-feature-control settings-feature-control-grid">
          <SettingsSelectField
            id="world-memory-management-provider"
            label="월드 메모리 관리 모델 제공자"
            value={managementProvider}
            options={agentModelProviderOptions}
            disabled={toggleBusy}
            onChange={(nextProvider) => {
              const nextSelectedProvider = normalizeMagazineProviderId(nextProvider);
              const nextEffectiveProvider = nextSelectedProvider === "default"
                ? normalizeRuntimeProviderId(agentProvider)
                : nextSelectedProvider;
              const nextGroup = selectedFeatureModelGroup("", nextEffectiveProvider, agentProviderProfiles);
              const nextReasoning = featureReasoningValue("", nextGroup, nextEffectiveProvider, agentProviderProfiles);
              onManagementSettingsChange({
                managementProvider: nextProvider,
                managementModel: nextGroup.slug,
                managementReasoning: nextReasoning,
                managementSpeed: featureSpeedOptions(nextGroup, nextReasoning)[0]?.id || "standard",
              });
            }}
            description="수집, 보고서/변경 제안 갱신, World Memory 화면 우측 채팅에 적용합니다."
          />
          <SettingsSelectField
            id="world-memory-management-model"
            label="월드 메모리 관리 모델"
            value={managementModelGroup.slug}
            options={managementModelOptions}
            disabled={toggleBusy || agentSettingsLoading}
            onChange={(nextModel) => {
              const nextGroup = selectedFeatureModelGroup(nextModel, managementEffectiveProvider, agentProviderProfiles);
              const nextReasoning = featureReasoningValue(
                managementReasoning,
                nextGroup,
                managementEffectiveProvider,
                agentProviderProfiles
              );
              onManagementSettingsChange({
                managementModel: nextGroup.slug,
                managementReasoning: nextReasoning,
                managementSpeed: featureSpeedOptions(nextGroup, nextReasoning)[0]?.id || "standard",
              });
            }}
            description={managementModelGroup.reasoningEmbedded
              ? "추론 수준은 모델 변형에 포함됩니다. Antigravity CLI에는 별도 추론·속도 옵션이 없습니다."
              : ""}
            actionLabel={managementModelGroup.reasoningEmbedded ? "목록 다시 불러오기" : ""}
            actionBusy={modelCatalogRefreshing}
            onAction={onReloadModelCatalog}
          />
          {!managementModelGroup.reasoningEmbedded ? (
            <SettingsSelectField
              id="world-memory-management-reasoning"
              label="월드 메모리 추론 수준"
              value={managementReasoning}
              options={managementReasoningOptions}
              disabled={toggleBusy || agentSettingsLoading}
              onChange={(nextReasoning) => {
                const nextSpeedOptions = featureSpeedOptions(managementModelGroup, nextReasoning);
                onManagementSettingsChange({
                  managementReasoning: nextReasoning,
                  managementSpeed: nextSpeedOptions.some((option) => option.id === managementSpeed)
                    ? managementSpeed
                    : "standard",
                });
              }}
              description={`${managementProviderLabel} · ${managementReasoningOption?.detail || "관리 작업에 적용합니다."}`}
              actionLabel="목록 다시 불러오기"
              actionBusy={modelCatalogRefreshing}
              onAction={onReloadModelCatalog}
            />
          ) : null}
          {managementSpeedOptions.length > 1 ? (
            <SettingsSelectField
              id="world-memory-management-speed"
              label="월드 메모리 처리 속도"
              value={managementSpeed}
              options={managementSpeedOptions}
              disabled={toggleBusy || agentSettingsLoading}
              onChange={(managementSpeed) => onManagementSettingsChange({ managementSpeed })}
              description={managementSpeedOptions.find((option) => option.id === managementSpeed)?.detail || ""}
            />
          ) : null}
        </div>
      ) : null}

      <div className={magazineEnabled ? "settings-feature-row is-enabled" : "settings-feature-row is-disabled"}>
        <div className="settings-source-main">
          <strong className="settings-feature-title">매거진 기능 사용</strong>
          <em className={magazineSettingsError ? "is-error" : undefined}>
            {magazineSettingsError ||
              (!enabled
                ? "월드 메모리를 켠 다음에만 매거진을 켤 수 있습니다."
                : "자동으로 생성되는 당신 만을 위한 경제/금융 매거진")}
          </em>
        </div>
        <button
          type="button"
          className={magazineEnabled ? "settings-toggle is-on" : "settings-toggle"}
          role="switch"
          aria-checked={magazineEnabled}
          disabled={magazineToggleDisabled}
          onClick={() => onToggleMagazineEnabled?.(!magazineEnabled)}
        >
          <span className="settings-toggle-track">
            <span className="settings-toggle-thumb" />
          </span>
          <span>{magazineSettingsSaving ? "저장 중" : magazineEnabled ? "켜짐" : "꺼짐"}</span>
        </button>
      </div>

      {magazineEnabled ? (
        <div className="settings-subsection" aria-labelledby="magazine-interval-settings-title">
          <div className="settings-subsection-header">
            <h3 id="magazine-interval-settings-title">기사 생성 간격</h3>
            <span>{magazineSchedulerIntervalHours}시간</span>
          </div>
          <MagazineSchedulerIntervalBar
            valueHours={magazineSchedulerIntervalHours}
            disabled={magazineToggleBusy}
            saving={magazineSettingsSaving}
            onChange={onMagazineSchedulerIntervalChange}
          />
        </div>
      ) : null}

      {magazineEnabled ? (
        <div className="settings-subsection" aria-labelledby="magazine-max-articles-settings-title">
          <div className="settings-subsection-header">
            <h3 id="magazine-max-articles-settings-title">생성 주기당 최대 기사 생성수</h3>
            <span>{magazineMaxArticlesPerCycle}건</span>
          </div>
          <MagazineMaxArticlesPerCycleBar
            valueCount={magazineMaxArticlesPerCycle}
            disabled={magazineToggleBusy}
            saving={magazineSettingsSaving}
            onChange={onMagazineMaxArticlesPerCycleChange}
          />
        </div>
      ) : null}

      {magazineEnabled ? (
        <div className="settings-feature-control settings-feature-control-grid">
          <SettingsSelectField
            id="magazine-writing-provider"
            label="매거진 작성 모델 제공자"
            value={magazineWritingProvider}
            options={agentModelProviderOptions}
            disabled={magazineToggleBusy}
            onChange={(nextProvider) => {
              const nextSelectedProvider = normalizeMagazineProviderId(nextProvider);
              const nextEffectiveProvider = nextSelectedProvider === "default"
                ? normalizeRuntimeProviderId(agentProvider)
                : nextSelectedProvider;
              const nextGroup = selectedFeatureModelGroup("", nextEffectiveProvider, agentProviderProfiles);
              const nextReasoning = featureReasoningValue("", nextGroup, nextEffectiveProvider, agentProviderProfiles);
              onMagazineWritingSettingsChange({
                writingProvider: nextProvider,
                writingModel: nextGroup.slug,
                writingReasoning: nextReasoning,
                writingSpeed: featureSpeedOptions(nextGroup, nextReasoning)[0]?.id || "standard",
              });
            }}
            description="자동 매거진 기사 수 산정과 기사 작성에 적용합니다."
          />
          <SettingsSelectField
            id="magazine-writing-model"
            label="매거진 작성 모델"
            value={magazineModelGroup.slug}
            options={magazineModelOptions}
            disabled={magazineToggleBusy || agentSettingsLoading}
            onChange={(nextModel) => {
              const nextGroup = selectedFeatureModelGroup(nextModel, magazineEffectiveProvider, agentProviderProfiles);
              const nextReasoning = featureReasoningValue(
                magazineWritingReasoning,
                nextGroup,
                magazineEffectiveProvider,
                agentProviderProfiles
              );
              onMagazineWritingSettingsChange({
                writingModel: nextGroup.slug,
                writingReasoning: nextReasoning,
                writingSpeed: featureSpeedOptions(nextGroup, nextReasoning)[0]?.id || "standard",
              });
            }}
            description={magazineModelGroup.reasoningEmbedded
              ? "추론 수준은 모델 변형에 포함됩니다. Antigravity CLI에는 별도 추론·속도 옵션이 없습니다."
              : ""}
            actionLabel={magazineModelGroup.reasoningEmbedded ? "목록 다시 불러오기" : ""}
            actionBusy={modelCatalogRefreshing}
            onAction={onReloadModelCatalog}
          />
          {!magazineModelGroup.reasoningEmbedded ? (
            <SettingsSelectField
              id="magazine-writing-reasoning"
              label="매거진 추론 수준"
              value={magazineWritingReasoning}
              options={magazineReasoningOptions}
              disabled={magazineToggleBusy || agentSettingsLoading}
              onChange={(nextReasoning) => {
                const nextSpeedOptions = featureSpeedOptions(magazineModelGroup, nextReasoning);
                onMagazineWritingSettingsChange({
                  writingReasoning: nextReasoning,
                  writingSpeed: nextSpeedOptions.some((option) => option.id === magazineWritingSpeed)
                    ? magazineWritingSpeed
                    : "standard",
                });
              }}
              actionLabel="목록 다시 불러오기"
              actionBusy={modelCatalogRefreshing}
              onAction={onReloadModelCatalog}
              description={
                agentSettingsLoading
                  ? "에이전트 설정을 불러온 뒤 CLI별 목록을 표시합니다."
                  : `${magazineReasoningProviderLabel} 기준 · ${magazineReasoningOption?.detail || "기사 수 산정과 기사 작성에 적용합니다."}`
              }
            />
          ) : null}
          {magazineSpeedOptions.length > 1 ? (
            <SettingsSelectField
              id="magazine-writing-speed"
              label="매거진 작성 속도"
              value={magazineWritingSpeed}
              options={magazineSpeedOptions}
              disabled={magazineToggleBusy || agentSettingsLoading}
              onChange={(writingSpeed) => onMagazineWritingSettingsChange({ writingSpeed })}
              description={magazineSpeedOptions.find((option) => option.id === magazineWritingSpeed)?.detail || ""}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
