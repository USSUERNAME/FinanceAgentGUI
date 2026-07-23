async function readWorldMemoryResponse(response) {
  return response.json().catch(() => ({}));
}

function assertWorldMemoryResponse(response, payload, { requirePayloadOk = true } = {}) {
  if (!response.ok || (requirePayloadOk && !payload.ok)) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function fetchWorldMemorySettings(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/world-memory/settings", { cache: "no-store" });
  const payload = await readWorldMemoryResponse(response);
  return assertWorldMemoryResponse(response, payload);
}

export async function patchWorldMemorySettings(patch, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/world-memory/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(patch),
  });
  const payload = await readWorldMemoryResponse(response);
  return assertWorldMemoryResponse(response, payload);
}

export async function fetchWorldMemoryStatus({ summary = false } = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(
    summary ? "/api/world-memory/status?mode=summary" : "/api/world-memory/status",
    { cache: "no-store" }
  );
  const payload = await readWorldMemoryResponse(response);
  return assertWorldMemoryResponse(response, payload, { requirePayloadOk: false });
}

export async function requestWorldMemoryAction(action, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/world-memory/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, ...options }),
  });
  const payload = await readWorldMemoryResponse(response);
  return {
    payload,
    responseOk: response.ok,
  };
}
