async function readArcaResponse(response) {
  return response.json().catch(() => ({}));
}

function arcaError(response, payload) {
  return new Error(payload?.issues?.[0]?.message || payload?.error || `HTTP ${response.status}`);
}

export async function fetchArcaNotifications(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/arca/notifications", { cache: "no-store" });
  const payload = await readArcaResponse(response);
  if (!response.ok) throw arcaError(response, payload);
  return payload;
}

export async function markArcaNotificationsRead(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/arca/notifications", {
    method: "DELETE",
    cache: "no-store",
  });
  const payload = await readArcaResponse(response);
  if (!response.ok || !payload?.accepted) throw arcaError(response, payload);
  return payload;
}

export async function fetchArcaAuthStatus(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/arca/auth/status", { cache: "no-store" });
  const payload = await readArcaResponse(response);
  if (!response.ok || !payload?.ok) throw arcaError(response, payload);
  return payload;
}

export async function requestArcaAuthAction(endpoint, { method = "POST" } = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(endpoint, {
    method,
    headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
    cache: "no-store",
    body: method === "DELETE" ? undefined : "{}",
  });
  const payload = await readArcaResponse(response);
  if (!response.ok || !payload?.ok) throw arcaError(response, payload);
  return payload;
}

export async function fetchArcaBoard(filters, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/arca/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filters),
  });
  const payload = await readArcaResponse(response);
  if (!response.ok && !payload?.issues?.length) throw arcaError(response, payload);
  return payload;
}

export async function fetchArcaArticle(url, { signal } = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`/api/arca/article?url=${encodeURIComponent(url)}`, {
    cache: "no-store",
    signal,
  });
  const payload = await readArcaResponse(response);
  if (!response.ok || !payload?.ok) throw arcaError(response, payload);
  return payload;
}
