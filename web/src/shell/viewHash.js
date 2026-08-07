const HASH_VIEW_IDS = new Set([
  "stock",
  "transaction-status",
  "news-feed",
  "magazine",
  "earning-calendar",
  "economic-calendar",
  "chat",
  "daily-intelligence",
  "research-operations",
  "reports",
  "portfolio",
  "world-memory",
  "settings",
]);

const HASH_SECTION_VIEWS = new Map([
  ["gmail-research-analysis", "research-operations"],
  ["broker-research-analysis", "research-operations"],
  ["telegram-intelligence", "research-operations"],
  ["pipeline-operations", "research-operations"],
  ["verification-review-queue", "research-operations"],
]);

function normalizedHashValue(hash) {
  const rawValue = String(hash || "").replace(/^#/, "").trim();
  if (!rawValue) return "";

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

export function viewFromHash(hash, fallback = "stock") {
  const view = normalizedHashValue(hash);
  if (HASH_VIEW_IDS.has(view)) return view;
  return HASH_SECTION_VIEWS.get(view) || fallback;
}

export function hashForView(view) {
  if (view === "portfolio-canvas") return "#portfolio";
  return HASH_VIEW_IDS.has(view) ? `#${view}` : "#stock";
}

export function isHashView(view) {
  return HASH_VIEW_IDS.has(view);
}
