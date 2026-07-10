export const CODEX_LUNA_TRANSLATION_MIN_VERSION = "0.144.0";
export const CODEX_LEGACY_TRANSLATION_MODEL = "gpt-5.5";
export const CODEX_LUNA_TRANSLATION_MODEL = "gpt-5.6-luna";

const CODEX_REASONING_ORDER = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

function parseVersion(value = "") {
  const match = String(value).match(/(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map((part) => Number.parseInt(part, 10)),
    prerelease: match[4] || "",
  };
}

export function isCodexCliVersionAtLeast(
  version,
  minimum = CODEX_LUNA_TRANSLATION_MIN_VERSION,
) {
  const current = parseVersion(version);
  const target = parseVersion(minimum);
  if (!current || !target) return false;

  for (let index = 0; index < 3; index += 1) {
    if (current.core[index] !== target.core[index]) {
      return current.core[index] > target.core[index];
    }
  }

  if (current.prerelease && !target.prerelease) return false;
  if (!current.prerelease && target.prerelease) return true;
  return current.prerelease.localeCompare(target.prerelease, "en", { numeric: true }) >= 0;
}

function modelSlug(model = {}) {
  return String(model.slug || model.id || model.name || "").trim();
}

function supportedReasoningLevels(model = {}) {
  const levels = Array.isArray(model.reasoningLevels)
    ? model.reasoningLevels
    : Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels
      : [];
  return levels
    .map((level) => String(level?.id || level?.effort || level || "").trim().toLowerCase())
    .filter(Boolean);
}

export function selectCodexTranslationModel({ cliVersion = "", models = [] } = {}) {
  const useLuna = isCodexCliVersionAtLeast(cliVersion);
  const model = useLuna ? CODEX_LUNA_TRANSLATION_MODEL : CODEX_LEGACY_TRANSLATION_MODEL;
  const catalogModel = (Array.isArray(models) ? models : []).find(
    (candidate) => modelSlug(candidate) === model,
  );
  const supported = supportedReasoningLevels(catalogModel);
  const reasoning = useLuna
    ? CODEX_REASONING_ORDER.find((level) => supported.includes(level)) || "low"
    : "low";

  return {
    model,
    modelLabel: model,
    reasoning,
    minimumVersion: CODEX_LUNA_TRANSLATION_MIN_VERSION,
  };
}
