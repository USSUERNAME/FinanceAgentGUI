import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildAstopObserverCliSandboxArgs,
  buildAstopObserverSandboxPolicy,
  createAstopObserverRuntime,
  formatAstopObserverContextSection,
} from "../server/astopObserver.mjs";

function withConfigDir(run) {
  const configDir = mkdtempSync(join(tmpdir(), "finance-agent-astop-observer-"));
  writeFileSync(
    join(configDir, "astop-observer.defaults.json"),
    `${JSON.stringify({
      version: 1,
      enabled: "auto",
      macosOnly: true,
      recheckIntervalHours: 72,
      server: "http://127.0.0.1:9723",
    }, null, 2)}\n`,
  );
  try {
    run(configDir);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
}

test("macOS probe persists a healthy astop installation and reuses it for 72 hours", () => {
  withConfigDir((configDir) => {
    let currentTime = Date.parse("2026-07-20T00:00:00.000Z");
    let probeCalls = 0;
    const runtime = createAstopObserverRuntime({
      configDir,
      platform: "darwin",
      now: () => currentTime,
      probe: () => {
        probeCalls += 1;
        return {
          installed: true,
          serverHealthy: true,
          astopVersion: "0.3.3",
          command: "/usr/local/bin/astop",
          lastError: "",
        };
      },
    });

    const first = runtime.getStatus();
    assert.equal(first.installed, true);
    assert.equal(first.serverHealthy, true);
    assert.equal(first.useForAgentTasks, true);
    assert.equal(probeCalls, 1);

    const persisted = JSON.parse(
      readFileSync(join(configDir, "astop-observer.user.json"), "utf8"),
    );
    assert.equal(persisted.installed, true);
    assert.equal(persisted.serverHealthy, true);
    assert.equal(persisted.useForAgentTasks, true);

    currentTime += 48 * 60 * 60 * 1000;
    assert.equal(runtime.getStatus().source, "probe");
    assert.equal(probeCalls, 1);

    currentTime += 25 * 60 * 60 * 1000;
    runtime.getStatus();
    assert.equal(probeCalls, 2);
  });
});

test("an indeterminate probe is stored as null and retried after the cache interval", () => {
  withConfigDir((configDir) => {
    let currentTime = Date.parse("2026-07-20T00:00:00.000Z");
    let probeCalls = 0;
    const runtime = createAstopObserverRuntime({
      configDir,
      platform: "darwin",
      now: () => currentTime,
      probe: () => {
        probeCalls += 1;
        return {
          installed: null,
          serverHealthy: null,
          lastError: "temporary probe failure",
        };
      },
    });

    const first = runtime.getStatus();
    assert.equal(first.installed, null);
    assert.equal(first.serverHealthy, null);
    assert.equal(first.useForAgentTasks, false);
    assert.equal(probeCalls, 1);

    currentTime += 71 * 60 * 60 * 1000;
    runtime.getStatus();
    assert.equal(probeCalls, 1);

    currentTime += 2 * 60 * 60 * 1000;
    runtime.getStatus();
    assert.equal(probeCalls, 2);
  });
});

test("non-macOS platforms remain unsupported without probing", () => {
  withConfigDir((configDir) => {
    let probeCalls = 0;
    const runtime = createAstopObserverRuntime({
      configDir,
      platform: "win32",
      probe: () => {
        probeCalls += 1;
        return { installed: true, serverHealthy: true };
      },
    });

    const status = runtime.getStatus();
    assert.equal(status.supported, false);
    assert.equal(status.installed, null);
    assert.equal(status.serverHealthy, null);
    assert.equal(probeCalls, 0);
  });
});

test("healthy cached status injects the astop-observer contract into agent context", () => {
  const context = formatAstopObserverContextSection({
    supported: true,
    installed: true,
    serverHealthy: true,
    useForAgentTasks: true,
    astopVersion: "0.3.3",
    configPath: "config/astop-observer.user.json",
    checkedAt: "2026-07-20T00:00:00.000Z",
    nextCheckAt: "2026-07-23T00:00:00.000Z",
  });

  assert.match(context, /useForAgentTasks: true/);
  assert.match(context, /astop-observer 스킬을 적용한다/);
  assert.match(context, /astop으로 프로세스를 제어하지 않는다/);
});

test("healthy astop keeps the agent read-only while enabling observer API access", () => {
  const status = { useForAgentTasks: true };

  assert.deepEqual(buildAstopObserverSandboxPolicy(status), {
    type: "readOnly",
    networkAccess: true,
  });
  assert.deepEqual(buildAstopObserverCliSandboxArgs(status), [
    "-c",
    'default_permissions="finance-agent-observer"',
    "-c",
    'permissions.finance-agent-observer={extends=":read-only", network={enabled=true}}',
  ]);
});

test("inactive astop keeps the original read-only network-restricted sandbox", () => {
  const status = { useForAgentTasks: false };

  assert.deepEqual(buildAstopObserverSandboxPolicy(status), {
    type: "readOnly",
    networkAccess: false,
  });
  assert.deepEqual(buildAstopObserverCliSandboxArgs(status), [
    "--sandbox",
    "read-only",
  ]);
});

test("persisted server metadata removes credentials and query secrets", () => {
  withConfigDir((configDir) => {
    const runtime = createAstopObserverRuntime({
      configDir,
      platform: "darwin",
      env: {
        ASTOP_SERVER: "http://observer:secret@127.0.0.1:9723/?token=hidden#private",
      },
      probe: () => ({
        installed: true,
        serverHealthy: true,
        astopVersion: "0.3.3",
      }),
    });

    const status = runtime.getStatus();
    assert.equal(status.server, "http://127.0.0.1:9723");
    const persisted = readFileSync(
      join(configDir, "astop-observer.user.json"),
      "utf8",
    );
    assert.doesNotMatch(persisted, /secret|hidden|private/);
  });
});
