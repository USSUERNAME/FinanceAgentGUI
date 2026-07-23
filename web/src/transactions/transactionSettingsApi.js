async function requestTransactionSettings(options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/transactions/settings", {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export function fetchTransactionSettings(fetchImpl, options = {}) {
  return requestTransactionSettings(options, fetchImpl);
}

export function patchTransactionSettings(patch, fetchImpl, options = {}) {
  return requestTransactionSettings(
    {
      ...options,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    fetchImpl
  );
}
