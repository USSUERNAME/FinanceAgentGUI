import { parentPort } from "node:worker_threads";
import { maintainSharedMemory } from "./sharedMemoryMaintenance.mjs";

try {
  const result = await maintainSharedMemory();
  parentPort?.postMessage(result);
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    skipped: true,
    reason: "shared-memory-maintenance-failed",
    error: error.message,
  });
}
