import assert from "node:assert/strict";
import test from "node:test";

import {
  codexCommandSpec,
  resolveCodexCommandPath,
} from "../server/codexProbe.mjs";

test("Codex path resolution uses where.exe on Windows and prefers the executable", () => {
  const calls = [];
  const path = resolveCodexCommandPath({
    platform: "win32",
    env: {},
    execFile(command, args) {
      calls.push({ command, args });
      return [
        "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex",
        "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe",
      ].join("\r\n");
    },
  });

  assert.equal(
    path,
    "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe",
  );
  assert.deepEqual(calls, [{ command: "where.exe", args: ["codex"] }]);
});

test("Codex path resolution keeps the POSIX command lookup", () => {
  const calls = [];
  const path = resolveCodexCommandPath({
    platform: "linux",
    env: {},
    execFile(command, args) {
      calls.push({ command, args });
      return "/usr/local/bin/codex\n";
    },
  });

  assert.equal(path, "/usr/local/bin/codex");
  assert.deepEqual(calls, [
    { command: "sh", args: ["-lc", "command -v codex"] },
  ]);
});

test("Codex path resolution prefers the executable npm package entrypoint on Windows", () => {
  let probed = false;
  const path = resolveCodexCommandPath({
    platform: "win32",
    env: { APPDATA: "C:\\Users\\operator\\AppData\\Roaming" },
    pathExists(candidate) {
      return candidate.endsWith("\\@openai\\codex\\bin\\codex.js");
    },
    execFile() {
      probed = true;
      return "";
    },
  });

  assert.equal(
    path,
    "C:\\Users\\operator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
  );
  assert.equal(probed, false);
});

test("Codex command spec runs a Windows JavaScript entrypoint through Node", () => {
  assert.deepEqual(
    codexCommandSpec(
      "C:\\Users\\operator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
      {
        platform: "win32",
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
      },
    ),
    {
      command: "C:\\Program Files\\nodejs\\node.exe",
      argsPrefix: [
        "C:\\Users\\operator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
      ],
    },
  );
});

test("Codex path resolution honors an explicit service path without probing", () => {
  let probed = false;
  const path = resolveCodexCommandPath({
    platform: "win32",
    env: { CODEX_CLI_PATH: "C:\\Tools\\codex.exe" },
    execFile() {
      probed = true;
      return "";
    },
  });

  assert.equal(path, "C:\\Tools\\codex.exe");
  assert.equal(probed, false);
});
