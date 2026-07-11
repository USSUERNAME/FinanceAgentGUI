import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { runAntigravityCliPrint } from "../server/codexProbe.mjs";

function fakeChild({ stdout = "", stderr = "", code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.emit("close", code);
  });
  return child;
}

test("Antigravity print mode passes the prompt as the -p argument instead of writing stdin", async () => {
  const prompt = "테스트 요청";
  let spawnCall = null;
  const result = await runAntigravityCliPrint({
    prompt,
    model: "Gemini 3.5 Flash (Medium)",
    approval: "turbo",
    timeoutMs: 1_000,
    cliPath: "/test/agy",
    cliVersion: "1.1.1",
    spawnProcess(path, args, options) {
      spawnCall = { path, args, options };
      return fakeChild({ stdout: "정상 응답" });
    },
  });

  assert.deepEqual(spawnCall.args.slice(-2), ["-p", prompt]);
  assert.equal(spawnCall.options.stdio[0], "ignore");
  assert.equal(result.answer, "정상 응답");
});

test("legacy Antigravity keeps the -p - plus stdin transport", async () => {
  const prompt = "레거시 테스트 요청";
  let spawnCall = null;
  let stdin = "";
  const result = await runAntigravityCliPrint({
    prompt,
    model: "Legacy Model",
    approval: "turbo",
    timeoutMs: 1_000,
    cliPath: "/test/agy",
    cliVersion: "1.0.9",
    spawnProcess(path, args, options) {
      const child = fakeChild({ stdout: "레거시 정상 응답" });
      child.stdin.on("data", (chunk) => {
        stdin += chunk.toString();
      });
      spawnCall = { path, args, options };
      return child;
    },
  });

  assert.deepEqual(spawnCall.args.slice(-2), ["-p", "-"]);
  assert.equal(spawnCall.options.stdio[0], "pipe");
  assert.equal(stdin, prompt);
  assert.equal(result.answer, "레거시 정상 응답");
});

test("an early Antigravity exit rejects only the request", async () => {
  await assert.rejects(
    runAntigravityCliPrint({
      prompt: "테스트 요청",
      model: "Gemini 3.5 Flash (Medium)",
      approval: "turbo",
      timeoutMs: 1_000,
      cliPath: "/test/agy",
      cliVersion: "1.1.1",
      spawnProcess: () => fakeChild({ stderr: "agy request failed", code: 2 }),
    }),
    /agy request failed/,
  );
});
