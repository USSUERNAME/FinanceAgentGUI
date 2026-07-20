import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  constants as fsConstants,
  accessSync,
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAstopObserverStatus } from "./astopObserver.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_AUDIT_LOG = join(GUIBUILD_ROOT, "logs", "llm-observation.jsonl");
const DEFAULT_CONSUMER = "finance-agent-gui";
const OWNED_JOB_PREFIX = "finance-gui-llm-";
const DEFAULT_WAIT_GRACE_MS = 60_000;
const DEFAULT_WAIT_MS = 2 * 60 * 60 * 1000;
const MAX_AUDIT_LOG_BYTES = 5 * 1024 * 1024;
const WAIT_FOR_OBSERVER_GATE = 'IFS= read -r _ <&3 || exit 125; exec "$@"';
const REGISTER_SELF_AND_EXEC = [
  '"$ASTOP_LLM_COMMAND" watch start --name "$ASTOP_LLM_JOB" --pid "$$" || exit 125',
  '"$ASTOP_LLM_COMMAND" wait "$ASTOP_LLM_JOB" --until start --timeout 30s --json >/dev/null 2>&1 || exit 125',
  '"$ASTOP_LLM_COMMAND" wait "$ASTOP_LLM_JOB" --until exit --timeout "$ASTOP_LLM_TIMEOUT" --json >/dev/null 2>&1 &',
  'exec "$@"',
].join("\n");
const OBSERVATION_SYMBOL = Symbol.for("finance-agent-gui.llmObservation");
let pendingRecoveryAttempted = false;

function cleanLabel(value, fallback = "llm") {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return text || fallback;
}

function cleanAuditText(value, limit = 120) {
  return String(value || "")
    .replace(/[\r\n\0]/g, " ")
    .trim()
    .slice(0, limit);
}

function executable(path) {
  if (!path || !String(path).includes("/")) return false;
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expandHomePath(value) {
  const text = String(value || "").trim();
  if (text === "$HOME") return homedir();
  if (text.startsWith("$HOME/")) return join(homedir(), text.slice(6));
  return text;
}

function resolveAstopCommand(status, env = process.env) {
  const candidates = [
    expandHomePath(env.ASTOP_CLI_PATH),
    expandHomePath(status?.command),
    "/usr/local/bin/astop",
    "/opt/homebrew/bin/astop",
    "/Library/Application Support/astop/astop",
  ].filter(Boolean);
  return candidates.find(executable) || "astop";
}

function waitDuration(timeoutMs) {
  const numeric = Number(timeoutMs);
  const total = Number.isFinite(numeric) && numeric > 0
    ? numeric + DEFAULT_WAIT_GRACE_MS
    : DEFAULT_WAIT_MS;
  return `${Math.max(30, Math.ceil(total / 1000))}s`;
}

function parseEvent(output = "") {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object" && parsed.event_id) return parsed;
    } catch {
      // astop may print a compact registration line before its JSON event.
    }
  }
  return null;
}

function parseEventList(output = "") {
  try {
    const parsed = JSON.parse(String(output || "").trim() || "[]");
    return Array.isArray(parsed) ? parsed.filter((event) => event && typeof event === "object") : [];
  } catch {
    return [];
  }
}

function commandError(prefix, result = {}) {
  const detail = String(result.stderr || result.stdout || result.error?.message || "").trim();
  return new Error(`${prefix}${detail ? `: ${detail}` : ""}`);
}

function rotateAuditLog(path) {
  if (!existsSync(path)) return;
  try {
    if (statSync(path).size < MAX_AUDIT_LOG_BYTES) return;
    renameSync(path, `${path}.1`);
  } catch {
    // Observation must not expose or lose an LLM process because log rotation failed.
  }
}

function appendAudit(path, payload) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    rotateAuditLog(path);
    appendFileSync(path, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  } catch {
    // The durable astop event is authoritative; this local convenience log is best-effort.
  }
}

export function llmObservationPolicy(status = {}) {
  const required = status?.supported === true && status?.installed === true;
  const active = required && status?.serverHealthy === true;
  if (required && !active) {
    const detail = status?.lastError || "astop CLI 또는 agent API가 준비되지 않았습니다";
    throw new Error(`LLM 실행이 차단되었습니다. astop 관찰이 필수이지만 사용할 수 없습니다: ${detail}`);
  }
  return { active, required };
}

function currentLlmObserverStatus() {
  let status = ensureAstopObserverStatus();
  if (
    status?.supported === true &&
    (status?.installed !== true || status?.serverHealthy !== true)
  ) {
    status = ensureAstopObserverStatus({ force: true });
  }
  return status;
}

function directFallbackStatusAfterRegistrationFailure() {
  const refreshed = ensureAstopObserverStatus({ force: true });
  return {
    status: refreshed,
    policy: llmObservationPolicy(refreshed),
  };
}

function observerResultOk(result) {
  return !result?.error && result?.status === 0;
}

function runObserverSync(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: WEB_ROOT,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 256 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
    ...options,
  });
}

function createWaitPromise(child) {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding?.("utf8");
  child.stderr?.setEncoding?.("utf8");
  child.stdout?.on?.("data", (chunk) => { stdout += chunk; });
  child.stderr?.on?.("data", (chunk) => { stderr += chunk; });
  return new Promise((resolveWait, rejectWait) => {
    child.once("error", rejectWait);
    child.once("close", (code, signal) => resolveWait({ code, signal, stdout, stderr }));
  });
}

function registerPidWatch({ astopCommand, jobName, pid }) {
  const registration = runObserverSync(astopCommand, [
    "watch",
    "start",
    "--name",
    jobName,
    "--pid",
    String(pid),
  ]);
  if (!observerResultOk(registration)) {
    throw commandError("astop LLM watch 등록 실패", registration);
  }
}

function confirmPidObserved({ astopCommand, jobName }) {
  const started = runObserverSync(astopCommand, [
    "wait",
    jobName,
    "--until",
    "start",
    "--timeout",
    "30s",
    "--json",
  ], { timeout: 35_000 });
  if (!observerResultOk(started)) {
    throw commandError("astop LLM PID 관찰 확인 실패", started);
  }
}

function startWaitClient({ astopCommand, jobName, timeoutMs, stdio = ["ignore", "pipe", "pipe"] }) {
  return spawn(astopCommand, [
    "wait",
    jobName,
    "--until",
    "exit",
    "--timeout",
    waitDuration(timeoutMs),
    "--json",
  ], {
    cwd: WEB_ROOT,
    stdio,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function ackAndStop({ astopCommand, jobName, eventId }) {
  let ackError = null;
  try {
    const ack = runObserverSync(astopCommand, [
      "event",
      "ack",
      eventId,
      "--consumer",
      DEFAULT_CONSUMER,
    ]);
    if (!observerResultOk(ack)) ackError = commandError("astop LLM 종료 이벤트 ack 실패", ack);
  } finally {
    const stop = runObserverSync(astopCommand, ["watch", "stop", jobName]);
    if (!observerResultOk(stop) && !ackError) {
      ackError = commandError("astop LLM watch 정리 실패", stop);
    }
  }
  if (ackError) throw ackError;
}

function verifyEvent(event, { jobName, pid, exitCode }) {
  if (!event) throw new Error(`astop LLM 종료 이벤트가 없습니다: ${jobName}`);
  if (event.job !== jobName && event.watch_name !== jobName) {
    throw new Error(`astop LLM 종료 이벤트 job 불일치: ${jobName}`);
  }
  if (Number.isInteger(pid) && Number(event.pid) !== pid) {
    throw new Error(`astop LLM 종료 이벤트 PID 불일치: expected=${pid} actual=${event.pid}`);
  }
  if (Number.isInteger(exitCode) && Number.isInteger(event.exit_code) && Number(event.exit_code) !== exitCode) {
    throw new Error(`astop LLM 종료 코드 불일치: expected=${exitCode} actual=${event.exit_code}`);
  }
  return event;
}

function observationIdentity(metadata = {}) {
  const feature = cleanLabel(metadata.feature, "llm");
  const provider = cleanLabel(metadata.provider, "provider");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const readablePrefix = `${OWNED_JOB_PREFIX}${feature}-${provider}`.slice(0, 82);
  return {
    feature,
    provider,
    jobName: `${readablePrefix}-${suffix}`,
  };
}

function gatedStdio(stdio) {
  if (Array.isArray(stdio)) {
    const normalized = stdio.slice(0, 3);
    while (normalized.length < 3) normalized.push("pipe");
    normalized.push("pipe");
    return normalized;
  }
  const mode = stdio || "pipe";
  return [mode, mode, mode, "pipe"];
}

function stopUnreleasedChild(child) {
  try {
    child.stdio?.[3]?.destroy?.();
    child.kill?.("SIGTERM");
  } catch {
    // The gate has not released the LLM command, so cleanup is safe and best-effort.
  }
}

function directChild(command, args, options) {
  return spawn(command, args, options);
}

function directSync(command, args, options) {
  return spawnSync(command, args, options);
}

export function recoverPendingLlmObservations({
  status = currentLlmObserverStatus(),
  auditLogPath = DEFAULT_AUDIT_LOG,
  runObserver = runObserverSync,
} = {}) {
  if (
    status?.supported !== true ||
    status?.installed !== true ||
    status?.serverHealthy !== true
  ) {
    return { active: false, recovered: 0, failed: 0, ignored: 0 };
  }

  const astopCommand = resolveAstopCommand(status);
  const pendingResult = runObserver(astopCommand, ["notifications", "pending", "--json"]);
  if (!observerResultOk(pendingResult)) {
    return {
      active: true,
      recovered: 0,
      failed: 1,
      ignored: 0,
      error: commandError("astop LLM pending 복구 조회 실패", pendingResult).message,
    };
  }

  const pending = parseEventList(pendingResult.stdout);
  const owned = pending.filter((event) => String(event.job || event.watch_name || "").startsWith(OWNED_JOB_PREFIX));
  const result = {
    active: true,
    recovered: 0,
    failed: 0,
    ignored: pending.length - owned.length,
  };

  for (const event of owned) {
    const jobName = String(event.job || event.watch_name || "");
    const eventId = String(event.event_id || "");
    if (!jobName || !eventId) {
      result.failed += 1;
      continue;
    }
    appendAudit(auditLogPath, {
      type: "llm_observation_recovery_detected",
      at: new Date().toISOString(),
      job: jobName,
      eventId,
      pid: event.pid ?? null,
      exitCode: event.exit_code ?? null,
      terminalState: event.terminal_state || "",
    });
    try {
      const ack = runObserver(astopCommand, [
        "event",
        "ack",
        eventId,
        "--consumer",
        `${DEFAULT_CONSUMER}-recovery`,
      ]);
      if (!observerResultOk(ack)) throw commandError("astop LLM pending ack 실패", ack);
      const stop = runObserver(astopCommand, ["watch", "stop", jobName]);
      if (!observerResultOk(stop)) throw commandError("astop LLM pending watch 정리 실패", stop);
      appendAudit(auditLogPath, {
        type: "llm_observation_recovered",
        at: new Date().toISOString(),
        job: jobName,
        eventId,
        pid: event.pid ?? null,
        exitCode: event.exit_code ?? null,
        terminalState: event.terminal_state || "",
      });
      result.recovered += 1;
    } catch (error) {
      appendAudit(auditLogPath, {
        type: "llm_observation_recovery_failed",
        at: new Date().toISOString(),
        job: jobName,
        eventId,
        error: cleanAuditText(error.message, 240),
      });
      result.failed += 1;
    }
  }
  return result;
}

function recoverPendingLlmObservationsOnce(status) {
  if (pendingRecoveryAttempted) return;
  const result = recoverPendingLlmObservations({ status });
  if (result.failed === 0) pendingRecoveryAttempted = true;
}

export function spawnObservedLlm(command, args = [], options = {}, metadata = {}) {
  const status = currentLlmObserverStatus();
  const policy = llmObservationPolicy(status);
  if (!policy.active) return directChild(command, args, options);
  recoverPendingLlmObservationsOnce(status);

  const astopCommand = resolveAstopCommand(status);
  const identity = observationIdentity(metadata);
  let child;
  try {
    child = spawn(
      "/bin/bash",
      ["-c", WAIT_FOR_OBSERVER_GATE, "finance-agent-llm-gate", command, ...args],
      { ...options, stdio: gatedStdio(options.stdio) },
    );
    if (!Number.isInteger(child.pid)) throw new Error("LLM 관찰 게이트 PID를 확인할 수 없습니다");
    registerPidWatch({ astopCommand, jobName: identity.jobName, pid: child.pid });
    confirmPidObserved({ astopCommand, jobName: identity.jobName });
  } catch (error) {
    if (child) stopUnreleasedChild(child);
    runObserverSync(astopCommand, ["watch", "stop", identity.jobName]);
    const refreshed = directFallbackStatusAfterRegistrationFailure();
    if (!refreshed.policy.active) return directChild(command, args, options);
    throw error;
  }
  const waitChild = startWaitClient({
    astopCommand,
    jobName: identity.jobName,
    timeoutMs: metadata.timeoutMs,
  });
  const waitPromise = createWaitPromise(waitChild);

  const registeredAt = new Date().toISOString();
  appendAudit(metadata.auditLogPath || DEFAULT_AUDIT_LOG, {
    type: "llm_observation_registered",
    at: registeredAt,
    job: identity.jobName,
    pid: child.pid || null,
    feature: identity.feature,
    provider: identity.provider,
    model: cleanAuditText(metadata.model),
  });
  child.stdio[3].end("observed\n");

  let finished = false;
  const done = new Promise((resolveDone, rejectDone) => {
    child.once("error", (error) => {
      if (finished) return;
      finished = true;
      waitChild.kill("SIGTERM");
      runObserverSync(astopCommand, ["watch", "stop", identity.jobName]);
      rejectDone(error);
    });
    child.once("close", async (exitCode, signal) => {
      if (finished) return;
      finished = true;
      try {
        const waited = await waitPromise;
        const event = verifyEvent(parseEvent(waited.stdout), {
          jobName: identity.jobName,
          pid: child.pid,
          exitCode,
        });
        ackAndStop({ astopCommand, jobName: identity.jobName, eventId: event.event_id });
        const result = {
          active: true,
          jobName: identity.jobName,
          eventId: event.event_id,
          pid: event.pid,
          exitCode: event.exit_code,
          terminalState: event.terminal_state,
          signal: signal || event.signal || null,
        };
        appendAudit(metadata.auditLogPath || DEFAULT_AUDIT_LOG, {
          type: "llm_observation_completed",
          at: new Date().toISOString(),
          registeredAt,
          job: identity.jobName,
          eventId: event.event_id,
          pid: event.pid,
          exitCode: event.exit_code ?? null,
          terminalState: event.terminal_state || "",
          feature: identity.feature,
          provider: identity.provider,
          model: cleanAuditText(metadata.model),
        });
        resolveDone(result);
      } catch (error) {
        runObserverSync(astopCommand, ["watch", "stop", identity.jobName]);
        appendAudit(metadata.auditLogPath || DEFAULT_AUDIT_LOG, {
          type: "llm_observation_failed",
          at: new Date().toISOString(),
          job: identity.jobName,
          pid: child.pid || null,
          feature: identity.feature,
          provider: identity.provider,
          error: cleanAuditText(error.message, 240),
        });
        rejectDone(error);
      }
    });
  });
  done.catch(() => {});
  Object.defineProperty(child, OBSERVATION_SYMBOL, {
    value: { active: true, ...identity, done },
    enumerable: false,
  });
  return child;
}

export function waitForLlmObservation(child) {
  return child?.[OBSERVATION_SYMBOL]?.done || Promise.resolve({ active: false });
}

export function llmObservationForChild(child) {
  return child?.[OBSERVATION_SYMBOL] || { active: false };
}

export function spawnSyncObservedLlm(command, args = [], options = {}, metadata = {}) {
  const status = currentLlmObserverStatus();
  const policy = llmObservationPolicy(status);
  if (!policy.active) return directSync(command, args, options);
  recoverPendingLlmObservationsOnce(status);

  const astopCommand = resolveAstopCommand(status);
  const identity = observationIdentity(metadata);
  const registeredAt = new Date().toISOString();
  const result = spawnSync(
    "/bin/bash",
    ["-c", REGISTER_SELF_AND_EXEC, "finance-agent-llm-gate", command, ...args],
    {
      ...options,
      env: {
        ...(options.env || process.env),
        ASTOP_LLM_COMMAND: astopCommand,
        ASTOP_LLM_JOB: identity.jobName,
        ASTOP_LLM_TIMEOUT: waitDuration(metadata.timeoutMs),
      },
    },
  );
  try {
    appendAudit(metadata.auditLogPath || DEFAULT_AUDIT_LOG, {
      type: "llm_observation_registered",
      at: registeredAt,
      job: identity.jobName,
      pid: result.pid || null,
      feature: identity.feature,
      provider: identity.provider,
      model: cleanAuditText(metadata.model),
      synchronous: true,
    });
    const replay = runObserverSync(astopCommand, [
      "wait",
      identity.jobName,
      "--until",
      "exit",
      "--timeout", "30s",
      "--json",
    ], { timeout: 35_000 });
    const event = verifyEvent(parseEvent(replay.stdout), {
      jobName: identity.jobName,
      pid: result.pid,
      exitCode: result.status,
    });
    ackAndStop({ astopCommand, jobName: identity.jobName, eventId: event.event_id });
    appendAudit(metadata.auditLogPath || DEFAULT_AUDIT_LOG, {
      type: "llm_observation_completed",
      at: new Date().toISOString(),
      registeredAt,
      job: identity.jobName,
      eventId: event.event_id,
      pid: event.pid,
      exitCode: event.exit_code ?? null,
      terminalState: event.terminal_state || "",
      feature: identity.feature,
      provider: identity.provider,
      model: cleanAuditText(metadata.model),
      synchronous: true,
    });
    Object.defineProperty(result, "llmObservation", {
      value: {
        active: true,
        jobName: identity.jobName,
        eventId: event.event_id,
        pid: event.pid,
        terminalState: event.terminal_state,
      },
      enumerable: false,
    });
    return result;
  } catch (error) {
    runObserverSync(astopCommand, ["watch", "stop", identity.jobName]);
    const refreshed = directFallbackStatusAfterRegistrationFailure();
    if (!refreshed.policy.active) {
      appendAudit(metadata.auditLogPath || DEFAULT_AUDIT_LOG, {
        type: "llm_observation_direct_fallback",
        at: new Date().toISOString(),
        job: identity.jobName,
        pid: result.pid || null,
        feature: identity.feature,
        provider: identity.provider,
        reason: cleanAuditText(error.message, 240),
        synchronous: true,
      });
      return directSync(command, args, options);
    }
    appendAudit(metadata.auditLogPath || DEFAULT_AUDIT_LOG, {
      type: "llm_observation_failed",
      at: new Date().toISOString(),
      job: identity.jobName,
      pid: result.pid || null,
      feature: identity.feature,
      provider: identity.provider,
      error: cleanAuditText(error.message, 240),
      synchronous: true,
    });
    throw error;
  }
}

export const LLM_OBSERVATION_AUDIT_PATH = DEFAULT_AUDIT_LOG;
