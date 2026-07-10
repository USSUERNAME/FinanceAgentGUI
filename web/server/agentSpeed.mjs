const STANDARD_SPEED = "standard";
const PRIORITY_SPEED = "priority";

function cleanId(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeCodexSpeed(value, fallback = STANDARD_SPEED) {
  const candidate = cleanId(value);
  if (candidate === PRIORITY_SPEED || candidate === "fast") return PRIORITY_SPEED;
  if (candidate === STANDARD_SPEED) return STANDARD_SPEED;
  const safeFallback = cleanId(fallback);
  if (safeFallback === PRIORITY_SPEED || safeFallback === "fast") return PRIORITY_SPEED;
  return STANDARD_SPEED;
}

export function codexServiceTierArgs(speed) {
  return normalizeCodexSpeed(speed) === PRIORITY_SPEED
    ? ["-c", `service_tier="${PRIORITY_SPEED}"`]
    : [];
}

function reasoningIdsForModel(model = {}) {
  const levels = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
    : [];
  return levels
    .map((level) => cleanId(level?.effort || level))
    .filter(Boolean);
}

function reasoningIdsForTier(tier = {}, fallbackIds = []) {
  const levels = Array.isArray(tier.supported_reasoning_levels)
    ? tier.supported_reasoning_levels
    : Array.isArray(tier.reasoning_levels)
      ? tier.reasoning_levels
      : [];
  const ids = levels
    .map((level) => cleanId(level?.effort || level))
    .filter(Boolean);
  return ids.length ? ids : fallbackIds;
}

export function codexSpeedOptionsFromModel(model = {}) {
  const modelReasoningIds = reasoningIdsForModel(model);
  const serviceTiers = Array.isArray(model.service_tiers) ? model.service_tiers : [];
  const additionalTiers = Array.isArray(model.additional_speed_tiers) ? model.additional_speed_tiers : [];
  const options = [];

  for (const tier of serviceTiers) {
    const id = normalizeCodexSpeed(tier?.id || tier?.name || "");
    if (id === STANDARD_SPEED || options.some((option) => option.id === id)) continue;
    options.push({
      id,
      label: String(tier?.name || "").trim().toLowerCase() === "fast" ? "빠름" : String(tier?.name || id),
      cli: codexServiceTierArgs(id).join(" "),
      detail: tier?.description || "Codex 모델 카탈로그에서 제공하는 service tier입니다.",
      supportedReasoningLevels: reasoningIdsForTier(tier, modelReasoningIds),
      source: "codex-debug-models.service_tiers",
    });
  }

  for (const tier of additionalTiers) {
    const id = normalizeCodexSpeed(tier);
    if (id === STANDARD_SPEED || options.some((option) => option.id === id)) continue;
    options.push({
      id,
      label: "빠름",
      cli: codexServiceTierArgs(id).join(" "),
      detail: "Codex 모델 카탈로그에서 제공하는 추가 속도 tier입니다.",
      supportedReasoningLevels: modelReasoningIds,
      source: "codex-debug-models.additional_speed_tiers",
    });
  }

  if (!options.length) return [];
  return [
    {
      id: STANDARD_SPEED,
      label: "표준",
      cli: "",
      detail: "기본 Codex CLI 속도입니다.",
      supportedReasoningLevels: modelReasoningIds,
      source: "default",
    },
    ...options,
  ];
}
