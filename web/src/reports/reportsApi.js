export async function postReportAction(payload, { signal, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl("/api/reports", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || `HTTP ${response.status}`);
  }
  return result;
}
