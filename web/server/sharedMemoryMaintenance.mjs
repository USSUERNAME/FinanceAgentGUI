import { runEmergencyProcedureForMarketSummary } from "./notificationsApi.mjs";
import { sharedMemoryStatus } from "./sharedMemoryStore.mjs";

export async function maintainSharedMemory({
  readStatus = sharedMemoryStatus,
  runEmergencyProcedure = runEmergencyProcedureForMarketSummary,
} = {}) {
  const status = readStatus({ refresh: true, limit: 1, offset: 0 });
  const marketSummary = status.contextMemory?.marketSummary || null;
  if (!marketSummary || typeof marketSummary !== "object") {
    return { ok: true, skipped: true, reason: "market-summary-unavailable" };
  }
  const emergencyProcedure = await runEmergencyProcedure(marketSummary);
  return {
    ok: emergencyProcedure?.ok !== false,
    skipped: Boolean(emergencyProcedure?.skipped),
    marketSummaryUpdatedAt: marketSummary.updatedAt || "",
    alertLevel: marketSummary.alertLevel || "none",
    emergencyProcedure,
  };
}
