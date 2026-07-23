async function tossInvestRequest(path, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(path, {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.errorCode = payload?.errorCode || "";
    throw error;
  }
  return payload;
}

export function fetchTossInvestStatus(fetchImpl) {
  return tossInvestRequest("/api/tossinvest/auth/status", {}, fetchImpl);
}

export function requestTossInvestAuthAction(endpoint, { method = "POST", body = null } = {}, fetchImpl) {
  return tossInvestRequest(
    endpoint,
    {
      method,
      headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
      body: method === "DELETE" ? undefined : body ? JSON.stringify(body) : "{}",
    },
    fetchImpl
  );
}

export function fetchTossInvestPublicIp(fetchImpl) {
  return tossInvestRequest("/api/tossinvest/network/public-ip", {}, fetchImpl);
}

export function fetchTossInvestOrderSyncStatus(fetchImpl) {
  return tossInvestRequest("/api/tossinvest/order-sync/status", {}, fetchImpl);
}

export function requestTossInvestOrderSyncBatch(fetchImpl) {
  return tossInvestRequest(
    "/api/tossinvest/order-sync/run",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    fetchImpl
  );
}

export function requestTossInvestSnapshotRebuild({ forceFull = false } = {}, fetchImpl) {
  return tossInvestRequest(
    "/api/tossinvest/order-sync/rebuild",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forceFull }),
    },
    fetchImpl
  );
}

export function patchTossInvestOrderSyncSettings(patch, fetchImpl) {
  return tossInvestRequest(
    "/api/tossinvest/order-sync/settings",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    fetchImpl
  );
}
