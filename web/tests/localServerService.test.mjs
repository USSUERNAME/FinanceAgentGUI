import assert from "node:assert/strict";
import test from "node:test";

import {
  isMacLaunchConfigFailure,
  macLaunchArguments,
  macPlist,
  pbServiceEnvironment,
  preservedServiceLogPath,
  windowsRunCommand,
  windowsTaskActionArgs,
} from "../../scripts/local-server-service.mjs";

test("macOS service bootstraps Vite inside Node without a Unicode WorkingDirectory", () => {
  const args = macLaunchArguments();
  const plist = macPlist();
  const normalizedArgs = args.map((arg) => arg.replaceAll("\\", "/"));

  assert.equal(args[0], "/usr/bin/env");
  assert.equal(args[1], "-i");
  assert.ok(args.some((arg) => arg.startsWith("LANG=")));
  assert.ok(args.some((arg) => arg.startsWith("LC_CTYPE=")));
  assert.ok(args.includes("-e"));
  assert.ok(args.some((arg) => arg.includes("pathToFileURL")));
  assert.ok(normalizedArgs.some((arg) => arg.endsWith("/web")));
  assert.ok(normalizedArgs.some((arg) => arg.endsWith("/vite/bin/vite.js")));
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

test("durable service forwards only allowlisted executable and PB connection paths", () => {
  const excludedCredentialValue = ["must", "not", "be", "forwarded"].join("-");
  const environment = pbServiceEnvironment({
    CODEX_CLI_PATH: "C:\\Tools\\codex.exe",
    PB_DAILY_INTELLIGENCE_DIR: "C:\\pb\\workspace",
    PB_DAILY_INTELLIGENCE_ENGINE_DIR: "C:\\pb",
    PB_DAILY_INTELLIGENCE_PYTHON: "C:\\Python\\python.exe",
    OPENAI_API_KEY: excludedCredentialValue,
    TELEGRAM_SESSION_STRING: excludedCredentialValue,
  });

  assert.deepEqual(
    environment.map((item) => item.name),
    [
      "CODEX_CLI_PATH",
      "PB_DAILY_INTELLIGENCE_DIR",
      "PB_DAILY_INTELLIGENCE_ENGINE_DIR",
      "PB_DAILY_INTELLIGENCE_PYTHON",
    ],
  );
  assert.equal(JSON.stringify(environment).includes("must-not-be-forwarded"), false);
});

test("Windows scheduled task includes configured PB connection parameters", () => {
  const previous = {
    codex: process.env.CODEX_CLI_PATH,
    workspace: process.env.PB_DAILY_INTELLIGENCE_DIR,
    engine: process.env.PB_DAILY_INTELLIGENCE_ENGINE_DIR,
    python: process.env.PB_DAILY_INTELLIGENCE_PYTHON,
  };
  process.env.CODEX_CLI_PATH = "C:\\Tools\\codex.exe";
  process.env.PB_DAILY_INTELLIGENCE_DIR = "C:\\pb path\\workspace";
  process.env.PB_DAILY_INTELLIGENCE_ENGINE_DIR = "C:\\pb path";
  process.env.PB_DAILY_INTELLIGENCE_PYTHON = "C:\\Python\\python.exe";
  try {
    const args = windowsTaskActionArgs();
    assert.match(args, /-PbDailyIntelligenceDir "C:\\pb path\\workspace"/);
    assert.match(args, /-PbDailyIntelligenceEngineDir "C:\\pb path"/);
    assert.match(args, /-PbDailyIntelligencePython "C:\\Python\\python.exe"/);
    assert.equal(windowsRunCommand(), `powershell.exe ${args}`);
  } finally {
    if (previous.codex === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previous.codex;
    if (previous.workspace === undefined) delete process.env.PB_DAILY_INTELLIGENCE_DIR;
    else process.env.PB_DAILY_INTELLIGENCE_DIR = previous.workspace;
    if (previous.engine === undefined) delete process.env.PB_DAILY_INTELLIGENCE_ENGINE_DIR;
    else process.env.PB_DAILY_INTELLIGENCE_ENGINE_DIR = previous.engine;
    if (previous.python === undefined) delete process.env.PB_DAILY_INTELLIGENCE_PYTHON;
    else process.env.PB_DAILY_INTELLIGENCE_PYTHON = previous.python;
  }
});
