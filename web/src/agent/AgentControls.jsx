import React, { useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import { getSpeedOptionsForReasoning } from "./agentOptions.js";

const standardSpeedOption = {
  id: "standard",
  label: "표준",
  cli: "",
  detail: "기본 Codex CLI 속도입니다.",
};

const fallbackReasoningLevels = [
  {
    id: "medium",
    label: "보통",
    cli: '-c model_reasoning_effort="medium"',
    detail: "Balances speed and reasoning depth for everyday tasks",
  },
];

const fallbackModelGroup = {
  id: "fallback-model",
  slug: "fallback-model",
  label: "모델",
  displayName: "모델",
  defaultReasoningLevel: "medium",
  reasoningLevels: fallbackReasoningLevels,
  speedOptions: [standardSpeedOption],
};

function useDismissableMenu(open, setOpen, { disabled = false } = {}) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open, setOpen]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      const root = rootRef.current;
      if (!root || root.contains(event.target)) return;
      setOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      setOpen(false);
      rootRef.current?.querySelector("button")?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  return rootRef;
}

export function Dropdown({ icon, value, options = [], onChange, align = "left", compact = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useDismissableMenu(open, setOpen, { disabled });
  const safeOptions = options.length ? options : [{ id: "empty", label: "대기", meta: "옵션 없음" }];
  const selected = safeOptions.find((item) => item.id === value) ?? safeOptions[0];

  return (
    <div className={`dropdown dropdown-${align}`} ref={rootRef}>
      <button
        type="button"
        className={`composer-chip ${compact ? "composer-chip-compact" : ""}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((next) => !next);
        }}
      >
        {icon}
        <span>{selected.label}</span>
        <ChevronDown size={18} strokeWidth={2.1} />
      </button>

      {open ? (
        <div className="dropdown-menu" role="menu">
          {safeOptions.map((option) => (
            <button
              type="button"
              className={`dropdown-item ${option.id === selected.id ? "is-selected" : ""}`}
              key={option.id}
              onClick={() => {
                setOpen(false);
                onChange(option.id);
              }}
            >
              <span className="dropdown-label">{option.label}</span>
              <span className="dropdown-meta">{option.cli ?? option.meta}</span>
              {option.detail ? <span className="dropdown-detail">{option.detail}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ModelControl({
  modelGroups = [],
  model,
  reasoning,
  speed,
  onModelChange,
  onReasoningChange,
  onSpeedChange,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState("main");
  const rootRef = useDismissableMenu(open, setOpen, { disabled });
  const safeGroups = modelGroups.length ? modelGroups : [fallbackModelGroup];
  const selectedGroup = safeGroups.find((item) => item.slug === model) ?? safeGroups[0];
  const reasoningLevels = selectedGroup?.reasoningLevels?.length
    ? selectedGroup.reasoningLevels
    : fallbackReasoningLevels;
  const selectedReasoning =
    reasoningLevels.find((item) => item.id === reasoning) ??
    reasoningLevels.find((item) => item.id === selectedGroup?.defaultReasoningLevel) ??
    reasoningLevels[0];
  const speedOptions = getSpeedOptionsForReasoning(selectedGroup, selectedReasoning?.id || reasoning);
  const selectedSpeed = speedOptions.find((item) => item.id === speed) ?? speedOptions[0];
  const hasSpeedMenu = speedOptions.length > 1;
  const reasoningEmbedded = Boolean(selectedGroup?.reasoningEmbedded);
  const chipLabel = reasoningEmbedded
    ? selectedGroup?.label || "모델"
    : `${selectedGroup?.label || "모델"} ${selectedReasoning?.label || ""}`.trim();

  function selectModel(nextGroup) {
    onModelChange(nextGroup.slug);
    const nextReasoningLevels = nextGroup.reasoningLevels?.length
      ? nextGroup.reasoningLevels
      : fallbackReasoningLevels;
    const nextReasoning = nextReasoningLevels.some((item) => item.id === reasoning)
      ? reasoning
      : nextGroup.defaultReasoningLevel || nextReasoningLevels[0]?.id || "medium";
    if (nextReasoning !== reasoning) onReasoningChange(nextReasoning);
    if (!getSpeedOptionsForReasoning(nextGroup, nextReasoning).some((item) => item.id === speed)) {
      onSpeedChange("standard");
    }
    setPanel("main");
    setOpen(false);
  }

  return (
    <div className="dropdown dropdown-right model-control" ref={rootRef}>
      <button
        type="button"
        className="composer-chip composer-chip-compact"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((next) => !next);
          setPanel("main");
        }}
        title={reasoningEmbedded
          ? selectedGroup?.displayName || selectedGroup?.slug
          : `${selectedGroup?.displayName || selectedGroup?.slug} · ${selectedReasoning?.label}`}
      >
        <span className="model-dot" aria-hidden="true" />
        <span>{chipLabel}</span>
        <ChevronDown size={18} strokeWidth={2.1} />
      </button>

      {open ? (
        <div className="dropdown-menu model-menu" role="menu">
          {panel === "main" ? (
            <>
              {!reasoningEmbedded ? (
                <>
                  <div className="menu-section-title">추론</div>
                  {reasoningLevels.map((option) => (
                    <button
                      type="button"
                      className="menu-row"
                      key={option.id}
                      onClick={() => {
                        if (!getSpeedOptionsForReasoning(selectedGroup, option.id).some((item) => item.id === speed)) {
                          onSpeedChange("standard");
                        }
                        onReasoningChange(option.id);
                        setOpen(false);
                      }}
                    >
                      <span className="menu-row-title">{option.label}</span>
                      {option.id === selectedReasoning?.id ? (
                        <Check className="menu-check" size={18} strokeWidth={2.1} />
                      ) : null}
                    </button>
                  ))}
                  <div className="menu-divider" />
                </>
              ) : null}

              <button type="button" className="menu-row is-nested" onClick={() => setPanel("model")}>
                <span className="menu-row-title">{selectedGroup?.displayName || selectedGroup?.slug}</span>
                <ChevronRight className="menu-chevron" size={20} strokeWidth={2} />
              </button>

              {hasSpeedMenu ? (
                <button type="button" className="menu-row is-nested" onClick={() => setPanel("speed")}>
                  <span className="menu-row-title">속도</span>
                  <span className="menu-row-value">{selectedSpeed?.label}</span>
                  <ChevronRight className="menu-chevron" size={20} strokeWidth={2} />
                </button>
              ) : null}
            </>
          ) : null}

          {panel === "model" ? (
            <>
              <button type="button" className="menu-section-title menu-back" onClick={() => setPanel("main")}>
                모델
              </button>
              {safeGroups.map((option) => (
                <button
                  type="button"
                  className="menu-row"
                  key={option.slug}
                  onClick={() => selectModel(option)}
                >
                  <span className="menu-row-title">{option.displayName || option.slug}</span>
                  {option.slug === selectedGroup?.slug ? (
                    <Check className="menu-check" size={18} strokeWidth={2.1} />
                  ) : null}
                </button>
              ))}
            </>
          ) : null}

          {panel === "speed" ? (
            <>
              <button type="button" className="menu-section-title menu-back" onClick={() => setPanel("main")}>
                속도
              </button>
              {speedOptions.map((option) => (
                <button
                  type="button"
                  className="menu-row"
                  key={option.id}
                  onClick={() => {
                    onSpeedChange(option.id);
                    setPanel("main");
                    setOpen(false);
                  }}
                >
                  <span className="menu-row-content">
                    <span className="menu-row-title">{option.label}</span>
                    {option.detail ? <span className="menu-row-subtitle">{option.detail}</span> : null}
                  </span>
                  {option.id === selectedSpeed?.id ? (
                    <Check className="menu-check" size={18} strokeWidth={2.1} />
                  ) : null}
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
