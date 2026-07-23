import { normalizePortfolioCanvasStore } from "./workspaceState.js";

async function requestPortfolioCanvasStore(options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/portfolio/canvases", {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function loadPortfolioCanvasStoreFile(fetchImpl) {
  const payload = await requestPortfolioCanvasStore({}, fetchImpl);
  return {
    ...payload,
    store: normalizePortfolioCanvasStore(payload.store),
  };
}

export function savePortfolioCanvasStoreFile(store, fetchImpl) {
  return requestPortfolioCanvasStore(
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: normalizePortfolioCanvasStore(store) }),
    },
    fetchImpl
  );
}
