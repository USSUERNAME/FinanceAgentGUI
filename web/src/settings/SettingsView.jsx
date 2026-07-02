import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import Bell from "lucide-react/dist/esm/icons/bell.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import LogIn from "lucide-react/dist/esm/icons/log-in.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import X from "lucide-react/dist/esm/icons/x.js";

import { emptyMemoryStatus } from "../memory/sharedMemoryDefaults.js";
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
}) {
  const safeOptions = options.length ? options : [{ id: "", label: "대기" }];

  return (
    <label className="settings-select-field" htmlFor={id}>
      <span>{label}</span>
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
    </label>
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
                  />
                  <SettingsSelectField
                    id={`agent-${profile.id}-reasoning-level`}
                    label="추론 수준"
                    value={profile.reasoning}
                    options={profileReasoningOptions}
                    onChange={(nextReasoning) => onProviderSettingChange(profile.id, { reasoning: nextReasoning })}
                    disabled={loading}
                  />
                  <SettingsSelectField
                    id={`agent-${profile.id}-speed`}
                    label="속도"
                    value={profile.speed}
                    options={profileSpeedOptions}
                    onChange={(nextSpeed) => onProviderSettingChange(profile.id, { speed: nextSpeed })}
                    disabled={loading}
                  />
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
        <span>일반 채팅</span>
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
  const cookieNames = status?.cookieNames?.length ? status.cookieNames.join(", ") : "-";
  const domains = status?.domains?.length ? status.domains.join(", ") : "-";
  const statusLabel = invalid
    ? "저장 파일 확인 필요"
    : connected
      ? "알림 세션 저장됨"
      : handoffAlive
        ? "로그인 진행 중"
        : "세션 없음";
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
          <div>
            <strong>{statusLabel}</strong>
            <p>
              {connected
                ? `${status.sessionFile}에 세션을 저장했습니다. 쿠키 값은 화면에 표시하지 않습니다.`
                : handoffAlive
                  ? "열린 전용 브라우저에서 로그인한 뒤 세션 저장을 누르세요."
                  : "전용 브라우저 프로필로 로그인 창을 열고 알림 수신용 세션만 저장합니다."}
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
          <dt>저장 파일</dt>
          <dd>{status?.sessionFile || "data/secrets/arca-session.json"}</dd>
        </div>
        <div>
          <dt>브라우저 프로필</dt>
          <dd>{status?.profileDir || "data/arca-browser-profile"}</dd>
        </div>
        <div>
          <dt>쿠키 이름</dt>
          <dd>{cookieNames}</dd>
        </div>
        <div>
          <dt>도메인</dt>
          <dd>{domains}</dd>
        </div>
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
  onWorldMemoryManagementProviderChange,
  onToggleMagazineEnabled,
  onMagazineWritingProviderChange,
  onMagazineSchedulerIntervalChange,
  onMagazineMaxArticlesPerCycleChange,
  onReloadWorldMemory,
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
          onManagementProviderChange={onWorldMemoryManagementProviderChange}
          onToggleMagazineEnabled={onToggleMagazineEnabled}
          onMagazineWritingProviderChange={onMagazineWritingProviderChange}
          onMagazineSchedulerIntervalChange={onMagazineSchedulerIntervalChange}
          onMagazineMaxArticlesPerCycleChange={onMagazineMaxArticlesPerCycleChange}
          onReload={onReloadWorldMemory}
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
  onManagementProviderChange = () => {},
  onToggleMagazineEnabled,
  onMagazineWritingProviderChange = () => {},
  onMagazineSchedulerIntervalChange = () => {},
  onMagazineMaxArticlesPerCycleChange = () => {},
  onReload,
}) {
  const enabled = Boolean(settings?.enabled ?? status?.enabled);
  const toggleBusy = settingsBusy || settingsSaving;
  const managementProvider = settings?.settings?.managementProvider || settings?.managementProvider || "default";
  const magazineEnabled = enabled && Boolean(magazineSettings?.enabled);
  const magazineToggleBusy = magazineSettingsBusy || magazineSettingsSaving;
  const magazineToggleDisabled = !enabled || magazineToggleBusy;
  const magazineWritingProvider =
    magazineSettings?.settings?.writingProvider || magazineSettings?.writingProvider || "default";
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
        <div className="settings-feature-control">
          <SettingsSelectField
            id="world-memory-management-provider"
            label="월드 메모리 관리 모델"
            value={managementProvider}
            options={agentModelProviderOptions}
            disabled={toggleBusy}
            onChange={onManagementProviderChange}
            description="수집, 보고서/변경 제안 갱신, World Memory 화면 우측 채팅에 적용합니다."
          />
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
        <div className="settings-feature-control">
          <SettingsSelectField
            id="magazine-writing-provider"
            label="매거진 작성 모델"
            value={magazineWritingProvider}
            options={agentModelProviderOptions}
            disabled={magazineToggleBusy}
            onChange={onMagazineWritingProviderChange}
            description="자동 매거진 기사 수 산정과 기사 작성에 적용합니다."
          />
        </div>
      ) : null}
    </section>
  );
}
