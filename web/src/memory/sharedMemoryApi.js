async function requestSharedMemory(path, options = {}, fetchImpl = globalThis.fetch) {
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

export function fetchSharedMemory({ limit, offset = 0 } = {}, fetchImpl) {
  return requestSharedMemory(
    `/api/memory?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
    {},
    fetchImpl
  );
}

export function saveSharedMemory(payload, fetchImpl) {
  return requestSharedMemory(
    "/api/memory",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchImpl
  );
}

export function deleteSharedMemory({ id, limit, offset = 0 }, fetchImpl) {
  return requestSharedMemory(
    `/api/memory?id=${encodeURIComponent(id)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
    { method: "DELETE" },
    fetchImpl
  );
}
