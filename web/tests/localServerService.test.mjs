import assert from "node:assert/strict";
import test from "node:test";

import {
  isMacLaunchConfigFailure,
  macLaunchArguments,
  macPlist,
  preservedServiceLogPath,
} from "../../scripts/local-server-service.mjs";

test("macOS service bootstraps Vite inside Node without a Unicode WorkingDirectory", () => {
  const args = macLaunchArguments();
  const plist = macPlist();

  assert.equal(args[0], "/usr/bin/env");
  assert.equal(args[1], "-i");
  assert.ok(args.some((arg) => arg.startsWith("LANG=")));
  assert.ok(args.some((arg) => arg.startsWith("LC_CTYPE=")));
  assert.ok(args.includes("-e"));
  assert.ok(args.some((arg) => arg.includes("pathToFileURL")));
  assert.ok(args.some((arg) => arg.endsWith("/web")));
  assert.ok(args.some((arg) => arg.endsWith("/vite/bin/vite.js")));
  assert.doesNotMatch(plist, /<key>WorkingDirectory<\/key>/);
  assert.match(plist, /<key>StandardOutPath<\/key>/);
  assert.match(plist, /<key>StandardErrorPath<\/key>/);
});

test("macOS service recognizes launchd EX_CONFIG and preserves stale logs", () => {
  assert.equal(isMacLaunchConfigFailure("last exit code = 78: EX_CONFIG"), true);
  assert.equal(isMacLaunchConfigFailure("last exit code = 1"), false);
  assert.equal(
    preservedServiceLogPath("/tmp/service.log", Date.UTC(2026, 6, 16, 2, 30, 45)),
    "/tmp/service.log.pre-ex-config-20260716T023045Z",
  );
});
