export const ANTIGRAVITY_TRANSLATION_REASONING = "low";
export const ANTIGRAVITY_36_TRANSLATION_MIN_VERSION = "1.1.5";
export const ANTIGRAVITY_36_TRANSLATION_MODEL = "gemini-3.6-flash-low";
export const ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL = "Gemini 3.5 Flash (Low)";
export const ANTIGRAVITY_TRANSLATION_REASONING_ORDER = ["low", "medium", "high"];

export function antigravityModelBase(modelName = "") {
  return String(modelName || "")
    .replace(/\s*\([^)]+\)\s*$/, "")
    .replace(/[-_\s]+(?:low|medium|high)\s*$/i, "")
    .trim();
}

export function antigravityReasoningLevel(model = {}) {
  const explicit = String(model.reasoningLevel || model.defaultReasoningLevel || "").trim();
  if (explicit) return explicit.toLowerCase();
  const name = String(model.name || model.slug || model.id || "");
  const parenthesized = name.match(/\(([^)]+)\)\s*$/);
  if (parenthesized) return parenthesized[1].trim().toLowerCase();
  const slugSuffix = name.match(/[-_\s]+(low|medium|high)\s*$/i);
  return slugSuffix ? slugSuffix[1].toLowerCase() : "";
}

function parseVersion(value = "") {
  const match = String(value).match(/(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map((part) => Number.parseInt(part, 10)),
    prerelease: match[4] || "",
  };
}

export function isAntigravityCliVersionAtLeast(
  version,
  minimum = ANTIGRAVITY_36_TRANSLATION_MIN_VERSION,
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

function antigravityModelBaseKey(modelName = "") {
  return antigravityModelBase(modelName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeAntigravityModelEntry(model = {}) {
  const name = String(model.name || model.slug || model.id || "").trim();
  if (!name) return null;
  return {
    ...model,
    name,
    baseModel: antigravityModelBase(model.baseModel || name),
    baseModelKey: antigravityModelBaseKey(model.baseModel || name),
    reasoningLevel: antigravityReasoningLevel(model),
  };
}

export function selectAntigravityModelForReasoning(
  models = [],
  {
    cliVersion = "",
    currentModel = "",
    fallbackModel = ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
    preferredModel = ANTIGRAVITY_36_TRANSLATION_MODEL,
    reasoningOrder = ANTIGRAVITY_TRANSLATION_REASONING_ORDER,
  } = {},
) {
  const entries = models.map(normalizeAntigravityModelEntry).filter(Boolean);
  const useGemini36 = isAntigravityCliVersionAtLeast(cliVersion);
  const targetModel = useGemini36 ? preferredModel : fallbackModel;
  const targetBaseKey = antigravityModelBaseKey(targetModel);
  const fallbackBaseKey = antigravityModelBaseKey(fallbackModel);
  const currentBaseKey = antigravityModelBaseKey(currentModel);
  const wanted = reasoningOrder.map((level) => String(level || "").toLowerCase()).filter(Boolean);

  for (const level of wanted) {
    const targetFamily = entries.find(
      (entry) => entry.baseModelKey === targetBaseKey && entry.reasoningLevel === level,
    );
    if (targetFamily) return targetFamily.name;
  }

  if (useGemini36 && fallbackBaseKey !== targetBaseKey) {
    for (const level of wanted) {
      const legacyFamily = entries.find(
        (entry) => entry.baseModelKey === fallbackBaseKey && entry.reasoningLevel === level,
      );
      if (legacyFamily) return legacyFamily.name;
    }
  }

  if (currentBaseKey && currentBaseKey !== targetBaseKey && currentBaseKey !== fallbackBaseKey) {
    for (const level of wanted) {
      const currentFamily = entries.find(
        (entry) => entry.baseModelKey === currentBaseKey && entry.reasoningLevel === level,
      );
      if (currentFamily) return currentFamily.name;
    }
  }

  for (const level of wanted) {
    const anyMatch = entries.find((entry) => entry.reasoningLevel === level);
    if (anyMatch) return anyMatch.name;
  }

  return entries[0]?.name || targetModel || currentModel || fallbackModel;
}
