import test from "node:test";
import assert from "node:assert/strict";

test("shared memory scheduler stays singleton across cache-busted Vite module reloads", async () => {
  const first = await import(`../server/memoryApi.mjs?scheduler-test-a-${Date.now()}`);
  const second = await import(`../server/memoryApi.mjs?scheduler-test-b-${Date.now()}`);
  first.stopSharedMemoryMaintenanceScheduler({ terminateWorker: true });

  try {
    assert.equal(
      first.startSharedMemoryMaintenanceScheduler({ initialDelayMs: 60_000, intervalMs: 60_000 }),
      true,
    );
    assert.equal(
      second.startSharedMemoryMaintenanceScheduler({ initialDelayMs: 60_000, intervalMs: 60_000 }),
      false,
    );
  } finally {
    assert.equal(second.stopSharedMemoryMaintenanceScheduler({ terminateWorker: true }), true);
    assert.equal(first.stopSharedMemoryMaintenanceScheduler({ terminateWorker: true }), false);
  }
});
