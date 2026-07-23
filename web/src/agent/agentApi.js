export async function patchAgentSettings(patch, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/codex/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(patch),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function fetchAgentOptions({ force = false } = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(
    force ? "/api/codex/options?refresh=1" : "/api/codex/options",
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function requestAgentChatStream(payload, { signal, fetchImpl = globalThis.fetch } = {}) {
  return fetchImpl("/api/codex/chat/stream", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
