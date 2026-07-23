async function requestInvestSimulator(path, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(path, {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

function jsonRequest(method, payload, signal) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(payload || {}),
  };
}

export function fetchInvestSimulatorAccounts(signal, fetchImpl) {
  return requestInvestSimulator("/api/invest-simulator/accounts", { signal }, fetchImpl);
}

export function postInvestSimulatorAccount(payload = {}, signal, fetchImpl) {
  return requestInvestSimulator(
    "/api/invest-simulator/accounts",
    jsonRequest("POST", payload, signal),
    fetchImpl,
  );
}

export function patchInvestSimulatorAccount(payload = {}, signal, fetchImpl) {
  return requestInvestSimulator(
    "/api/invest-simulator/accounts",
    jsonRequest("PATCH", payload, signal),
    fetchImpl,
  );
}

export function deleteInvestSimulatorAccount(simulatorId, signal, fetchImpl) {
  const cleanId = String(simulatorId || "").trim();
  if (!cleanId) throw new Error("삭제할 시뮬레이터 계좌를 찾지 못했습니다.");
  return requestInvestSimulator(
    `/api/invest-simulator/accounts?simulatorId=${encodeURIComponent(cleanId)}`,
    { method: "DELETE", signal },
    fetchImpl,
  );
}

export function postInvestSimulatorExchange(payload = {}, signal, fetchImpl) {
  return requestInvestSimulator(
    "/api/invest-simulator/exchange",
    jsonRequest("POST", payload, signal),
    fetchImpl,
  );
}

export function postInvestSimulatorBuy(payload = {}, signal, fetchImpl) {
  return requestInvestSimulator(
    "/api/invest-simulator/orders",
    jsonRequest("POST", payload, signal),
    fetchImpl,
  );
}

export function postInvestSimulatorSell(payload = {}, signal, fetchImpl) {
  return postInvestSimulatorBuy({ ...(payload || {}), side: "sell" }, signal, fetchImpl);
}
