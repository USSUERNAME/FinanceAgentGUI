async function requestMagazine(path, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(path, {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export function fetchMagazineSettings(fetchImpl) {
  return requestMagazine("/api/magazine/settings", {}, fetchImpl);
}

export function patchMagazineSettings(patch, fetchImpl) {
  return requestMagazine(
    "/api/magazine/settings",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    fetchImpl
  );
}

export function fetchMagazineCatalog({ signal } = {}, fetchImpl) {
  return requestMagazine("/api/magazine/articles", { signal }, fetchImpl);
}

export function fetchMagazineStatus({ signal } = {}, fetchImpl) {
  return requestMagazine("/api/magazine/status", { signal }, fetchImpl);
}

export function markMagazineOpened(fetchImpl) {
  return requestMagazine("/api/magazine/read-state", { method: "POST" }, fetchImpl);
}

export function requestMagazineRunNow(fetchImpl) {
  return requestMagazine(
    "/api/magazine/status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "runNow" }),
    },
    fetchImpl
  );
}

export function requestMagazineGenerateOne(fetchImpl) {
  return requestMagazine(
    "/api/magazine/articles",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generateWithCodex", count: 1, replace: false }),
    },
    fetchImpl
  );
}

export function deleteMagazineArticle(articleId, fetchImpl) {
  return requestMagazine(
    `/api/magazine/articles?id=${encodeURIComponent(articleId)}`,
    { method: "DELETE" },
    fetchImpl
  );
}

export function fetchMagazinePreferences({ signal } = {}, fetchImpl) {
  return requestMagazine("/api/magazine/preferences", { signal }, fetchImpl);
}

export function saveMagazinePreference({ articleId, optionId }, fetchImpl) {
  return requestMagazine(
    "/api/magazine/preferences",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId, optionId }),
    },
    fetchImpl
  );
}

export function fetchMagazineComments({ articleId, signal } = {}, fetchImpl) {
  return requestMagazine(
    `/api/magazine/comments?articleId=${encodeURIComponent(articleId)}`,
    { signal },
    fetchImpl
  );
}

export function submitMagazineComment(payload, fetchImpl) {
  return requestMagazine(
    "/api/magazine/comments",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchImpl
  );
}
