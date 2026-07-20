import { spawnSync } from "node:child_process";
import {
  constants as fsConstants,
  accessSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_CONFIG_DIR = join(GUIBUILD_ROOT, "config");
const DEFAULT_RECHECK_INTERVAL_HOURS = 72;
const MIN_RECHECK_INTERVAL_HOURS = 1;
const MAX_RECHECK_INTERVAL_HOURS = 24 * 30;
const DEFAULT_SERVER = "http://127.0.0.1:9723";
const PROBE_TIMEOUT_MS = 3000;
const AGENT_PERMISSION_PROFILE_ID = "finance-agent-observer";
const AGENT_PERMISSION_PROFILE_TOML =
  '{extends=":read-only", network={enabled=true}}';

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function clampRecheckIntervalHours(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_RECHECK_INTERVAL_HOURS;
  return Math.min(
    MAX_RECHECK_INTERVAL_HOURS,
    Math.max(MIN_RECHECK_INTERVAL_HOURS, Math.round(numeric)),
  );
}

function normalizeEnabled(value) {
  if (value === true || value === false) return value;
  return "auto";
}

function normalizeTriState(value) {
  if (value === true || value === false) return value;
  return null;
}

function safeServerUrl(value) {
  const candidate = String(value || "").trim() || DEFAULT_SERVER;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_SERVER;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SERVER;
  }
}

function safeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/[\r\n\0]/g, "")
    .slice(0, 80);
}

function safeError(value) {
  return String(value || "")
    .trim()
    .replace(/[\r\n\0]/g, " ")
    .slice(0, 240);
}

function redactCommandPath(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  const userHome = homedir();
  if (userHome && candidate.startsWith(`${userHome}/`)) {
    return `$HOME/${candidate.slice(userHome.length + 1)}`;
  }
  return candidate.includes("/") ? candidate : basename(candidate);
}

function isoAt(timestamp) {
  return new Date(timestamp).toISOString();
}

function parseTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function commandCandidates(env, pathExists) {
  const configured = String(env.ASTOP_CLI_PATH || "").trim();
  const absoluteCandidates = [
    configured,
    "/usr/local/bin/astop",
    "/opt/homebrew/bin/astop",
    "/Library/Application Support/astop/astop",
  ].filter(Boolean);
  const candidates = [];
  for (const candidate of absoluteCandidates) {
    if (pathExists(candidate) && !candidates.includes(candidate)) candidates.push(candidate);
  }
  candidates.push("astop");
  return candidates;
}

function defaultPathExists(path) {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultProbe({ env = process.env, runCommand = spawnSync, pathExists = defaultPathExists } = {}) {
  let executableWasPresent = false;
  for (const command of commandCandidates(env, pathExists)) {
    const versionResult = runCommand(command, ["--version"], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      env: { ...env, NO_COLOR: "1" },
    });
    if (versionResult?.error?.code === "ENOENT") continue;
    executableWasPresent = executableWasPresent || command !== "astop" || !versionResult?.error;
    if (versionResult?.error || versionResult?.status !== 0) continue;

    const versionText = `${versionResult.stdout || ""} ${versionResult.stderr || ""}`
      .trim()
      .replace(/^astop\s+/i, "");
    const summaryResult = runCommand(command, ["agent-summary"], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      env: { ...env, NO_COLOR: "1" },
    });
    const serverHealthy = !summaryResult?.error && summaryResult?.status === 0;
    return {
      installed: true,
      serverHealthy,
      astopVersion: safeVersion(versionText),
      command: redactCommandPath(command),
      lastError: serverHealthy ? "" : "astop agent API is unavailable",
    };
  }

  return {
    installed: executableWasPresent ? true : false,
    serverHealthy: executableWasPresent ? false : null,
    astopVersion: "",
    command: "",
    lastError: executableWasPresent
      ? "astop executable was found but could not be verified"
      : "astop command not found",
  };
}

function normalizeDefaults(raw = {}, env = process.env) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    enabled: normalizeEnabled(source.enabled),
    macosOnly: source.macosOnly !== false,
    requireForLlmProcesses: source.requireForLlmProcesses !== false,
    recheckIntervalHours: clampRecheckIntervalHours(source.recheckIntervalHours),
    server: safeServerUrl(env.ASTOP_SERVER || source.server),
  };
}

function normalizeStatus(raw = {}, defaults, platform, source = "cache") {
  const installed = normalizeTriState(raw.installed);
  const serverHealthy = installed === true ? normalizeTriState(raw.serverHealthy) : null;
  const enabled = normalizeEnabled(raw.enabled ?? defaults.enabled);
  const supported = defaults.macosOnly ? platform === "darwin" : true;
  const available = installed === true && serverHealthy === true;
  return {
    version: 1,
    enabled,
    supported,
    platform,
    installed,
    serverHealthy,
    available,
    useForAgentTasks: supported && enabled !== false && available,
    astopVersion: safeVersion(raw.astopVersion),
    command: redactCommandPath(raw.command),
    server: safeServerUrl(raw.server || defaults.server),
    checkedAt: parseTimestamp(raw.checkedAt) ? String(raw.checkedAt) : null,
    nextCheckAt: parseTimestamp(raw.nextCheckAt) ? String(raw.nextCheckAt) : null,
    recheckIntervalHours: defaults.recheckIntervalHours,
    requireForLlmProcesses: defaults.requireForLlmProcesses,
    lastError: safeError(raw.lastError),
    source,
    configPath: "config/astop-observer.user.json",
    defaultConfigPath: "config/astop-observer.defaults.json",
  };
}

function writeJsonAtomic(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function createAstopObserverRuntime({
  configDir = DEFAULT_CONFIG_DIR,
  platform = process.platform,
  env = process.env,
  now = () => Date.now(),
  probe = defaultProbe,
} = {}) {
  const defaultPath = join(configDir, "astop-observer.defaults.json");
  const userPath = join(configDir, "astop-observer.user.json");
  let memoryStatus = null;

  function readDefaults() {
    return normalizeDefaults(readJsonFile(defaultPath) || {}, env);
  }

  function getStatus({ force = false } = {}) {
    const defaults = readDefaults();
    const currentTime = Number(now());
    const supported = defaults.macosOnly ? platform === "darwin" : true;
    if (!supported) {
      return normalizeStatus(
        {
          enabled: defaults.enabled,
          installed: null,
          serverHealthy: null,
          server: defaults.server,
        },
        defaults,
        platform,
        "unsupported-platform",
      );
    }

    const cached = memoryStatus || normalizeStatus(
      readJsonFile(userPath) || {},
      defaults,
      platform,
      "cache",
    );
    const nextCheckTime = parseTimestamp(cached.nextCheckAt);
    if (!force && nextCheckTime !== null && currentTime < nextCheckTime) {
      memoryStatus = cached;
      return cached;
    }

    let probeResult;
    try {
      probeResult = probe({ platform, env });
    } catch (error) {
      probeResult = {
        installed: null,
        serverHealthy: null,
        astopVersion: "",
        command: "",
        lastError: error instanceof Error ? error.message : String(error),
      };
    }

    const checkedAt = isoAt(currentTime);
    const nextCheckAt = isoAt(
      currentTime + defaults.recheckIntervalHours * 60 * 60 * 1000,
    );
    const next = normalizeStatus(
      {
        ...probeResult,
        enabled: cached.enabled ?? defaults.enabled,
        server: defaults.server,
        checkedAt,
        nextCheckAt,
      },
      defaults,
      platform,
      "probe",
    );
    writeJsonAtomic(userPath, {
      version: next.version,
      enabled: next.enabled,
      platform: next.platform,
      installed: next.installed,
      serverHealthy: next.serverHealthy,
      available: next.available,
      useForAgentTasks: next.useForAgentTasks,
      astopVersion: next.astopVersion,
      command: next.command,
      server: next.server,
      checkedAt: next.checkedAt,
      nextCheckAt: next.nextCheckAt,
      lastError: next.lastError,
      requireForLlmProcesses: next.requireForLlmProcesses,
    });
    memoryStatus = next;
    return next;
  }

  return { getStatus };
}

const defaultRuntime = createAstopObserverRuntime();

export function ensureAstopObserverStatus(options = {}) {
  return defaultRuntime.getStatus(options);
}

export function buildAstopObserverSandboxPolicy(
  status = ensureAstopObserverStatus(),
) {
  return {
    type: "readOnly",
    networkAccess: status.useForAgentTasks === true,
  };
}

export function buildAstopObserverCliSandboxArgs(
  status = ensureAstopObserverStatus(),
) {
  if (status.useForAgentTasks !== true) {
    return ["--sandbox", "read-only"];
  }
  return [
    "-c",
    `default_permissions="${AGENT_PERMISSION_PROFILE_ID}"`,
    "-c",
    `permissions.${AGENT_PERMISSION_PROFILE_ID}=${AGENT_PERMISSION_PROFILE_TOML}`,
  ];
}

export function formatAstopObserverContextSection(status = {}) {
  if (!status.supported) return "";
  const common = [
    "[astop 관찰 환경]",
    `설정 파일: ${status.configPath}`,
    `설치 상태: ${status.installed === null ? "null" : String(status.installed)}`,
    `서버 건강 상태: ${status.serverHealthy === null ? "null" : String(status.serverHealthy)}`,
    `useForAgentTasks: ${String(status.useForAgentTasks)}`,
    `마지막 확인: ${status.checkedAt || "미확인"}`,
    `다음 자동 확인: ${status.nextCheckAt || "미정"}`,
  ];
  if (status.useForAgentTasks) {
    return [
      ...common,
      `astop ${status.astopVersion || "버전 미상"}과 agent API가 확인되었다.`,
      "이 요청에는 astop-observer 스킬을 적용한다. 시작 시 preflight, 관련 pending terminal event 복구, agent-summary를 수행한다.",
      "정확한 PID를 안전하게 식별할 수 있는 로컬 작업은 astop에 등록하고 event wait로 완료를 관찰한다. astop으로 프로세스를 제어하지 않는다.",
    ].join("\n");
  }
  return [
    ...common,
    "현재 astop 관찰은 활성화되지 않았다. 설치나 데몬 변경을 임의로 수행하지 말고 기본 실행·대기 경로를 사용한다.",
  ].join("\n");
}

export function buildAstopObserverContextSection() {
  return formatAstopObserverContextSection(ensureAstopObserverStatus());
}
