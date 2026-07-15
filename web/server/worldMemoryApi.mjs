import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCodexOptions, readJsonBody, runAntigravityGenerate, runCodexChat, sendJson } from "./codexProbe.mjs";
import {
  isWorldMemoryEnabled,
  publicWorldMemorySettingsSnapshot,
  readWorldMemorySettings,
  writeWorldMemorySettingsPatch,
} from "./worldMemorySettings.mjs";
import { disableMagazineSettings } from "./magazineSettings.mjs";
import { stopMagazineScheduler } from "./magazineApi.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const CONFIG_DIR = join(GUIBUILD_ROOT, "config");
const WORLD_MEMORY_BASE_DIR = join(GUIBUILD_ROOT, "data", "world-memory");
const WORLD_MEMORY_BASE_ARG = relative(GUIBUILD_ROOT, WORLD_MEMORY_BASE_DIR) || WORLD_MEMORY_BASE_DIR;
const WORLD_MEMORY_DB_FILE = "world_issue_log.sqlite3";
const WORLD_MEMORY_DB_PATH = join(WORLD_MEMORY_BASE_DIR, WORLD_MEMORY_DB_FILE);
const WORLD_MEMORY_STATE_PATH = join(WORLD_MEMORY_BASE_DIR, "collector-state.json");
const WORLD_MEMORY_PROMPT_PATH = join(CONFIG_DIR, "world-memory-collection.prompt.md");
const WORLD_MEMORY_LOG_DIR = join(GUIBUILD_ROOT, "logs", "world-memory");
const WORLD_MEMORY_CLI = join(GUIBUILD_ROOT, "scripts", "world_memory_cli.py");
const WORLD_MEMORY_HARNESS = join(GUIBUILD_ROOT, "scripts", "world_memory_harness.py");
const MARKET_ANALYZER = join(GUIBUILD_ROOT, "scripts", "analyze_market.py");
const WORLD_MEMORY_EMBEDDING_ENGINE = "sentence-transformers";
const WORLD_MEMORY_EMBEDDING_MODEL = "ibm-granite/granite-embedding-97m-multilingual-r2";
const COMMAND_TIMEOUT_MS = 120000;
const FEED_SCAN_TIMEOUT_MS = 180000;
const WORLD_MEMORY_MODEL_TIMEOUT_MS = 240000;
const WORLD_MEMORY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WORLD_MEMORY_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const WORLD_MEMORY_CONNECTIVITY_RETRY_INTERVAL_MS = 10 * 60 * 1000;
const WORLD_MEMORY_CONNECTIVITY_TIMEOUT_MS = 5000;
const WORLD_MEMORY_CONNECTIVITY_PROBE_URLS = [
  "https://www.gstatic.com/generate_204",
  "https://www.cloudflare.com/cdn-cgi/trace",
];
const WORLD_MEMORY_HISTORY_LIMIT = 16;
const WORLD_MEMORY_HANDLED_CHANGE_SUGGESTION_LIMIT = 40;
const OUTPUT_LIMIT = 1024 * 1024;
const STEP_TEXT_LIMIT = 24 * 1024;
const MODEL_INPUT_SECTION_LIMIT = 48 * 1024;
const MODEL_PREFLIGHT_LIMIT = 180 * 1024;
const MODEL_JSON_SECTION_LIMIT = 96 * 1024;
const MODEL_FEED_SCAN_LIMIT = 64 * 1024;
const WORLD_MEMORY_CONNECTIVITY_STALE_IN_FLIGHT_MS =
  WORLD_MEMORY_CONNECTIVITY_TIMEOUT_MS * WORLD_MEMORY_CONNECTIVITY_PROBE_URLS.length + 5000;
const runtimeKey = Symbol.for("financeAgentGui.worldMemoryCollector");
const changeSuggestionMutationActions = new Set([
  "stateAdd",
  "briefStoryBackfill",
  "storyLink",
  "taxonomyRefresh",
  "stateSync",
]);

export function worldMemorySuggestionStatusForAction(action = "") {
  return changeSuggestionMutationActions.has(String(action || "").trim()) ? "completed" : "watching";
}

const actionCatalog = [
  { id: "collectNow", label: "수동 수집", riskLevel: "network" },
  { id: "pause", label: "다음 수집 6시간 연기", riskLevel: "low" },
  { id: "init", label: "DB shell 초기화", riskLevel: "low" },
  { id: "audit", label: "Audit JSON", riskLevel: "low" },
  { id: "harness", label: "유지보수 하네스", riskLevel: "low" },
  { id: "list", label: "최근 엔트리 조회", riskLevel: "low" },
  { id: "states", label: "상태 스냅샷 조회", riskLevel: "low" },
  { id: "taxonomy", label: "Taxonomy 조회", riskLevel: "low" },
  { id: "taxonomyRefresh", label: "Taxonomy 재색인", riskLevel: "medium" },
  { id: "cleanupDryRun", label: "Cleanup dry-run", riskLevel: "low" },
  { id: "briefStoryBackfill", label: "Brief story backfill", riskLevel: "medium" },
  { id: "storyLink", label: "스토리 관계 기록", riskLevel: "medium" },
  { id: "storyMap", label: "스토리 맵 조회", riskLevel: "low" },
  { id: "storyFamilyReview", label: "스토리 패밀리 리뷰", riskLevel: "low" },
  { id: "stateAdd", label: "Watch state 기록", riskLevel: "medium" },
  { id: "embedStatus", label: "임베딩 커버리지", riskLevel: "low" },
  { id: "semanticSearch", label: "의미 검색", riskLevel: "low" },
  { id: "refreshReport", label: "보고서/변경 제안 갱신", riskLevel: "low" },
  { id: "report", label: "월드 메모리 보고서", riskLevel: "low" },
  { id: "stateSync", label: "파생 상태 동기화", riskLevel: "medium" },
  { id: "feedScan", label: "원본 FEED 수집 스캔", riskLevel: "network" },
];

function ensureWorldMemoryDirs() {
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(WORLD_MEMORY_BASE_DIR, { recursive: true });
  mkdirSync(WORLD_MEMORY_LOG_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function addMs(dateLike, ms) {
  const base = new Date(dateLike || Date.now()).getTime();
  const safeBase = Number.isFinite(base) ? base : Date.now();
  return new Date(safeBase + ms).toISOString();
}

function timestampMs(dateLike) {
  const value = new Date(dateLike || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function isConnectivityHttpStatus(statusCode) {
  const code = Number(statusCode || 0);
  return Number.isFinite(code) && code > 0 && code < 500;
}

function isCollectorScheduleDue(state = {}, now = Date.now()) {
  const schedule = state.schedule || {};
  const pausedUntilMs = timestampMs(schedule.pausedUntil);
  if (pausedUntilMs > now) return false;

  const retryAtMs = timestampMs(schedule.nextRetryAt);
  if (schedule.activeCycle && retryAtMs) return now >= retryAtMs;

  const nextRunMs = timestampMs(schedule.nextRunAt);
  return Boolean(nextRunMs && now >= nextRunMs);
}

function requestConnectivityProbe(url, timeoutMs = WORLD_MEMORY_CONNECTIVITY_TIMEOUT_MS) {
  return new Promise((resolveProbe) => {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolveProbe({ ok: false, url, error: error.message });
      return;
    }

    const client = parsed.protocol === "http:" ? http : https;
    const req = client.request(
      parsed,
      {
        method: "HEAD",
        timeout: timeoutMs,
        headers: {
          "user-agent": "FinanceAgentGUI/WorldMemoryConnectivityProbe",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const statusCode = Number(res.statusCode || 0);
          resolveProbe({
            ok: isConnectivityHttpStatus(statusCode),
            url,
            statusCode,
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolveProbe({ ok: false, url, error: "timeout" });
    });
    req.on("error", (error) => {
      resolveProbe({ ok: false, url, error: error.message });
    });
    req.end();
  });
}

async function probeInternetConnectivity() {
  if (process.env.WORLD_MEMORY_ASSUME_ONLINE === "1") {
    return { ok: true, checkedAt: nowIso(), forced: true, probes: [] };
  }
  if (process.env.WORLD_MEMORY_ASSUME_ONLINE === "0") {
    return {
      ok: false,
      checkedAt: nowIso(),
      forced: true,
      error: "WORLD_MEMORY_ASSUME_ONLINE=0",
      probes: [],
    };
  }

  const probes = [];
  for (const url of WORLD_MEMORY_CONNECTIVITY_PROBE_URLS) {
    const probe = await requestConnectivityProbe(url);
    probes.push(probe);
    if (probe.ok) {
      return { ok: true, checkedAt: nowIso(), probes };
    }
  }
  return {
    ok: false,
    checkedAt: nowIso(),
    error: probes.map((probe) => `${probe.url}: ${probe.statusCode || probe.error || "failed"}`).join("; "),
    probes,
  };
}

export function applyWorldMemoryOfflineWaitState(
  state = {},
  {
    cycleId = "",
    trigger = "scheduled",
    scheduledAt = nowIso(),
    deadlineAt = "",
    attempt = 1,
    checkedAt = nowIso(),
    connectivity = {},
  } = {}
) {
  const nextRetryAt = addMs(checkedAt, WORLD_MEMORY_CONNECTIVITY_RETRY_INTERVAL_MS);
  const reason = connectivity.error || "인터넷 연결 확인 실패";
  return appendHistory(
    {
      ...state,
      collector: {
        ...(state.collector || {}),
        running: false,
        status: "offline_wait",
        lastAction: "인터넷 연결 대기 · 연결 확인 후 자동 재시도",
        lastError: reason,
        lastFinishedAt: checkedAt,
        lastTrigger: trigger,
        attempt,
      },
      schedule: {
        ...(state.schedule || {}),
        nextRetryAt,
        activeCycle: {
          id: cycleId || `wm_offline_${Date.now()}`,
          trigger,
          scheduledAt,
          deadlineAt,
          attempt,
          awaitingConnectivity: true,
          checkedAt,
          nextRetryAt,
        },
      },
    },
    {
      type: "collection",
      status: "offline_wait",
      trigger,
      scheduledAt,
      finishedAt: checkedAt,
      attempts: attempt,
      nextRetryAt,
      error: reason,
    }
  );
}

function safeRelative(path) {
  return path ? relative(GUIBUILD_ROOT, path) : "";
}

function safeArtifactPath(path) {
  if (!path) return "";
  const text = String(path);
  return text.startsWith(GUIBUILD_ROOT) ? safeRelative(text) : text;
}

function runtimeState() {
  if (!globalThis[runtimeKey]) {
    globalThis[runtimeKey] = {
      started: false,
      timer: null,
      inFlight: null,
      inFlightStartedAt: "",
      inFlightCycleId: "",
      nextTimerAt: "",
    };
  }
  return globalThis[runtimeKey];
}

export function shouldClearWorldMemoryConnectivityInFlight(state = {}, runtime = {}, now = Date.now()) {
  if (!runtime?.inFlight) return false;
  const collector = state.collector || {};
  const schedule = state.schedule || {};
  const activeCycle = schedule.activeCycle || {};
  const retryAtMs = timestampMs(activeCycle.nextRetryAt || schedule.nextRetryAt);
  const waitingForConnectivity = collector.status === "offline_wait" || activeCycle.awaitingConnectivity === true;
  if (!waitingForConnectivity || collector.running || !retryAtMs || now < retryAtMs) return false;

  const startedAtMs = timestampMs(runtime.inFlightStartedAt);
  if (!startedAtMs) return true;
  return now - startedAtMs > WORLD_MEMORY_CONNECTIVITY_STALE_IN_FLIGHT_MS;
}

function clearStaleWorldMemoryConnectivityInFlight(state = {}, now = Date.now()) {
  const runtime = runtimeState();
  if (!shouldClearWorldMemoryConnectivityInFlight(state, runtime, now)) return false;
  runtime.inFlight = null;
  runtime.inFlightStartedAt = "";
  runtime.inFlightCycleId = "";
  return true;
}

function defaultCollectorState() {
  const nextRunAt = addMs(Date.now(), WORLD_MEMORY_INTERVAL_MS);
  return {
    version: 1,
    updatedAt: nowIso(),
    collector: {
      running: false,
      status: "idle",
      lastAction: "대기 중",
      lastError: "",
      lastStartedAt: "",
      lastFinishedAt: "",
      lastSuccessfulAt: "",
      lastReportSuccessfulAt: "",
      lastFailedAt: "",
      lastTrigger: "",
      attempt: 0,
    },
    schedule: {
      intervalMs: WORLD_MEMORY_INTERVAL_MS,
      retryIntervalMs: WORLD_MEMORY_RETRY_INTERVAL_MS,
      retryWindowMs: WORLD_MEMORY_INTERVAL_MS,
      nextRunAt,
      nextRetryAt: "",
      pausedUntil: "",
      activeCycle: null,
    },
    modelPolicy: defaultModelPolicy(),
    report: emptyReportState(),
    changeSuggestionLedger: {
      version: 1,
      handled: [],
    },
    history: [],
  };
}

function emptyReportState() {
  return {
    status: "empty",
    title: "World Memory 시장 상황 인식",
    generatedAt: "",
    path: "",
    htmlPath: "",
    jsonPath: "",
    summary: "아직 작성된 시장 상황 보고서가 없습니다.",
    suggestions: [
      "첫 수동 수집을 실행해 FEED 스캔과 빈 월드 메모리 저장소 초기화를 시작합니다.",
    ],
    text: "",
    view: null,
  };
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(path, payload) {
  ensureWorldMemoryDirs();
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function latestWorldMemoryReportArtifact() {
  ensureWorldMemoryDirs();
  let entries = [];
  try {
    entries = readdirSync(WORLD_MEMORY_LOG_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && /^world_memory_market_situation_\d{8}_\d{6}\.json$/.test(entry.name))
    .map((entry) => {
      const jsonPath = join(WORLD_MEMORY_LOG_DIR, entry.name);
      const view = readJsonFile(jsonPath);
      if (!view || typeof view !== "object" || Array.isArray(view)) return null;
      let stats = null;
      try {
        stats = statSync(jsonPath);
      } catch {
        return null;
      }
      const stem = entry.name.replace(/\.json$/, "");
      const htmlPath = join(WORLD_MEMORY_LOG_DIR, `${stem}.html`);
      const textPath = join(WORLD_MEMORY_LOG_DIR, `${stem}.txt`);
      return {
        view,
        jsonPath,
        htmlPath: existsSync(htmlPath) ? htmlPath : "",
        textPath: existsSync(textPath) ? textPath : "",
        generatedAt: stats.mtime instanceof Date ? stats.mtime.toISOString() : nowIso(),
        mtimeMs: stats.mtimeMs || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.jsonPath.localeCompare(a.jsonPath));

  return candidates[0] || null;
}

function readWorldMemoryDbSnapshot() {
  if (!existsSync(WORLD_MEMORY_DB_PATH)) return null;
  const python = findPythonCommand();
  if (!python) return null;

  const script = [
    "import json, sqlite3, sys",
    "db_path = sys.argv[1]",
    "payload = {'entryCount': 0, 'maxAsOf': '', 'maxLoggedAt': ''}",
    "try:",
    "    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)",
    "    try:",
    "        row = conn.execute('select count(*), max(as_of), max(logged_at) from world_issue_entries').fetchone()",
    "        if row:",
    "            payload = {'entryCount': int(row[0] or 0), 'maxAsOf': row[1] or '', 'maxLoggedAt': row[2] or ''}",
    "    finally:",
    "        conn.close()",
    "except Exception as exc:",
    "    payload = {'entryCount': 0, 'maxAsOf': '', 'maxLoggedAt': '', 'error': str(exc)}",
    "print(json.dumps(payload, ensure_ascii=False))",
  ].join("\n");

  const result = spawnSync(python.command, [...python.argsPrefix, "-c", script, WORLD_MEMORY_DB_PATH], {
    cwd: GUIBUILD_ROOT,
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.error || result.status !== 0) return null;
  const parsed = tryParseJson(result.stdout);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function latestDbSnapshotTimestamp(dbSnapshot = {}) {
  for (const value of [dbSnapshot.maxLoggedAt, dbSnapshot.maxAsOf]) {
    if (timestampMs(value)) return value;
  }
  return "";
}

function stateNeedsArtifactRecovery(state = {}) {
  const collector = state.collector || {};
  const report = state.report || {};
  return (
    !collector.lastSuccessfulAt ||
    !collector.lastReportSuccessfulAt ||
    report.status !== "ready" ||
    !report.generatedAt ||
    !report.view
  );
}

export function recoverWorldMemoryCollectorStateFromArtifacts(state = {}, options = {}) {
  if (!stateNeedsArtifactRecovery(state) && !options.force) {
    return { state, recovered: false };
  }

  const hasDbSnapshot = Object.prototype.hasOwnProperty.call(options, "dbSnapshot");
  const hasReportArtifact = Object.prototype.hasOwnProperty.call(options, "reportArtifact");
  const dbSnapshot = hasDbSnapshot ? options.dbSnapshot : readWorldMemoryDbSnapshot();
  const reportArtifact = hasReportArtifact ? options.reportArtifact : latestWorldMemoryReportArtifact();
  const recoveredCollectionAt = latestDbSnapshotTimestamp(dbSnapshot || {});
  const recoveredReportAt = reportArtifact?.generatedAt || "";
  const reportArtifactMs = timestampMs(recoveredReportAt);
  const currentReportMs = timestampMs(state.report?.generatedAt);
  let next = {
    ...state,
    collector: { ...(state.collector || {}) },
    schedule: { ...(state.schedule || {}) },
    report: { ...(state.report || {}) },
  };
  let recovered = false;

  if (
    reportArtifact?.view &&
    (!next.report.view || next.report.status !== "ready" || !currentReportMs || reportArtifactMs > currentReportMs)
  ) {
    const reportView = filterWorldMemoryReportView(reportArtifact.view, {
      handledChangeSuggestions: next.changeSuggestionLedger?.handled,
    });
    next.report = {
      ...next.report,
      status: "ready",
      title: reportView.title || "World Memory 시장 상황 인식",
      generatedAt: recoveredReportAt || nowIso(),
      path: safeArtifactPath(reportArtifact.htmlPath || reportArtifact.jsonPath),
      htmlPath: safeArtifactPath(reportArtifact.htmlPath),
      jsonPath: safeArtifactPath(reportArtifact.jsonPath),
      textPath: safeArtifactPath(reportArtifact.textPath),
      summary: reportView.summary || next.report.summary || "",
      suggestions: reportChangeSuggestions(reportView),
      text: reportPlainText(reportView),
      view: reportView,
    };
    recovered = true;
  }

  if (recoveredCollectionAt && !next.collector.lastSuccessfulAt) {
    next.collector.lastSuccessfulAt = recoveredCollectionAt;
    recovered = true;
  }
  if (recoveredReportAt && !next.collector.lastReportSuccessfulAt) {
    next.collector.lastReportSuccessfulAt = recoveredReportAt;
    recovered = true;
  }

  if (!recovered) return { state, recovered: false };

  const finishedAt = [recoveredReportAt, recoveredCollectionAt, next.collector.lastFinishedAt]
    .filter(Boolean)
    .sort((a, b) => timestampMs(b) - timestampMs(a))[0] || nowIso();
  const recoveredNextRunAt = recoveredCollectionAt ? addMs(recoveredCollectionAt, WORLD_MEMORY_INTERVAL_MS) : "";
  const currentNextRunMs = timestampMs(next.schedule.nextRunAt);
  const recoveredNextRunMs = timestampMs(recoveredNextRunAt);

  next.collector = {
    ...next.collector,
    running: false,
    status: "ok",
    lastAction: "월드 메모리 상태 파일을 DB/보고서 로그에서 복구했습니다.",
    lastError: "",
    lastFinishedAt: finishedAt,
    lastTrigger: next.collector.lastTrigger || "artifact-recovery",
  };
  if (!next.schedule.activeCycle && !next.schedule.pausedUntil && recoveredNextRunMs) {
    next.schedule.nextRunAt =
      !currentNextRunMs || currentNextRunMs > recoveredNextRunMs
        ? recoveredNextRunAt
        : next.schedule.nextRunAt;
  }
  next.schedule.nextRetryAt = next.schedule.nextRetryAt || "";
  next.schedule.activeCycle = next.schedule.activeCycle || null;

  next = appendHistory(next, {
    type: "state_recovery",
    status: "ok",
    trigger: "artifact-recovery",
    recoveredCollectionAt,
    recoveredReportAt,
    dbEntryCount: Number(dbSnapshot?.entryCount || 0),
    reportJsonPath: safeArtifactPath(reportArtifact?.jsonPath || ""),
  });

  return { state: next, recovered: true };
}

function readCollectorState() {
  ensureWorldMemoryDirs();
  const raw = readJsonFile(WORLD_MEMORY_STATE_PATH);
  const base = defaultCollectorState();
  if (!raw || typeof raw !== "object") {
    const recovery = recoverWorldMemoryCollectorStateFromArtifacts(base);
    return writeCollectorState(recovery.state);
  }

  const report = { ...base.report, ...(raw.report || {}) };
  if (report.view && typeof report.view === "object" && !Array.isArray(report.view)) {
    report.view = filterWorldMemoryReportView(report.view, {
      handledChangeSuggestions: raw.changeSuggestionLedger?.handled,
    });
    report.suggestions = reportChangeSuggestions(report.view);
    report.text = reportPlainText(report.view);
  }
  const state = {
    ...base,
    ...raw,
    collector: { ...base.collector, ...(raw.collector || {}) },
    schedule: { ...base.schedule, ...(raw.schedule || {}) },
    modelPolicy: { ...base.modelPolicy, ...(raw.modelPolicy || {}) },
    report,
    changeSuggestionLedger: normalizeChangeSuggestionLedger(raw.changeSuggestionLedger),
    history: compactCollectorHistory(raw.history),
  };
  const recovery = recoverWorldMemoryCollectorStateFromArtifacts(state);
  if (recovery.recovered) return writeCollectorState(recovery.state);
  return recovery.state;
}

function compactCollectorHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(0, WORLD_MEMORY_HISTORY_LIMIT)
    .map((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return record;
      return {
        ...record,
        steps: Array.isArray(record.steps)
          ? record.steps.map((step) => {
              if (!step || typeof step !== "object" || Array.isArray(step)) return step;
              if (!Object.prototype.hasOwnProperty.call(step, "text")) return step;
              return { ...step, text: safeOutput(step.text, STEP_TEXT_LIMIT) };
            })
          : record.steps,
      };
    });
}

function writeCollectorState(state) {
  const next = {
    ...state,
    updatedAt: nowIso(),
    history: compactCollectorHistory(state.history),
  };
  writeJsonFile(WORLD_MEMORY_STATE_PATH, next);
  return next;
}

export function completeWorldMemoryReportRefreshCollectorState(collector = {}, finishedAt = nowIso()) {
  return {
    ...collector,
    running: false,
    status: "ok",
    lastAction: "월드 메모리 보고서와 변경 제안 갱신 완료",
    lastError: "",
    lastFinishedAt: finishedAt,
    lastReportSuccessfulAt: finishedAt,
  };
}

export function completeWorldMemoryCollectionCollectorState(
  collector = {},
  { collectionSuccessfulAt = "", reportFinishedAt = nowIso(), importedCandidates = 0, attempt = 0 } = {}
) {
  return {
    ...collector,
    running: false,
    status: "ok",
    lastAction: `월드 메모리 수집 완료 · 신규 후보 ${Number(importedCandidates || 0)}건`,
    lastError: "",
    lastFinishedAt: reportFinishedAt,
    lastSuccessfulAt: collectionSuccessfulAt || collector.lastSuccessfulAt || "",
    lastReportSuccessfulAt: reportFinishedAt,
    attempt,
  };
}

function buildWorldMemoryDisabledStatus(settings = readWorldMemorySettings()) {
  const runtime = runtimeState();
  return {
    ok: true,
    enabled: false,
    settings,
    configPath: "config/world-memory.user.json",
    defaultConfigPath: "config/world-memory.defaults.json",
    disabledReason: "월드 메모리 사용 설정이 꺼져 있습니다.",
    paths: {
      root: GUIBUILD_ROOT,
      baseDir: WORLD_MEMORY_BASE_ARG,
      dbFile: WORLD_MEMORY_DB_FILE,
      dbPath: relative(GUIBUILD_ROOT, WORLD_MEMORY_DB_PATH),
      logDir: relative(GUIBUILD_ROOT, WORLD_MEMORY_LOG_DIR),
      cli: relative(GUIBUILD_ROOT, WORLD_MEMORY_CLI),
      harness: relative(GUIBUILD_ROOT, WORLD_MEMORY_HARNESS),
      analyzer: relative(GUIBUILD_ROOT, MARKET_ANALYZER),
    },
    db: {
      exists: existsSync(WORLD_MEMORY_DB_PATH),
      path: safeRelative(WORLD_MEMORY_DB_PATH),
    },
    embedding: {
      engine: WORLD_MEMORY_EMBEDDING_ENGINE,
      model: WORLD_MEMORY_EMBEDDING_MODEL,
      dependency: "sentence-transformers>=5.0.0",
      note: "월드 메모리 사용을 켜면 semantic-search와 embed-status에서 사용합니다.",
    },
    collector: {
      ...defaultCollectorState().collector,
      status: "disabled",
      lastAction: "월드 메모리 사용 꺼짐",
      schedulerStarted: false,
      inFlight: Boolean(runtime.inFlight),
      nextTimerAt: "",
    },
    schedule: defaultCollectorState().schedule,
    modelPolicy: defaultModelPolicy(),
    report: emptyReportState(),
    history: [],
    dependencies: {
      ok: true,
      modules: {},
      issues: [],
    },
    actions: actionCatalog,
    init: null,
    audit: null,
    list: null,
    states: null,
    taxonomy: null,
    embeddings: null,
  };
}

function updateCollectorState(mutator) {
  const current = readCollectorState();
  const next = typeof mutator === "function" ? mutator(current) : { ...current, ...(mutator || {}) };
  return writeCollectorState(next);
}

function appendHistory(state, record) {
  return {
    ...state,
    history: compactCollectorHistory([
      {
        id: record.id || `wm_${Date.now()}`,
        at: nowIso(),
        ...record,
      },
      ...(Array.isArray(state.history) ? state.history : []),
    ]),
  };
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function parseEnum(value, allowed, fallback) {
  const text = String(value || "").trim();
  return allowed.includes(text) ? text : fallback;
}

function commandTextArg(value, fieldName, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`${fieldName} is required`);
  return text.slice(0, maxLength);
}

function optionalCommandTextArg(value, maxLength = 400) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : "";
}

export function normalizeWorldMemorySuggestionFingerprint(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[\s.,;:!?()[\]{}<>\\/|]+/g, "")
    .trim();
}

function normalizeWorldMemorySuggestionContinuityId(value = "") {
  const normalized = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(normalized) ? normalized : "";
}

function normalizeChangeSuggestionTarget(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rawEventIds = Array.isArray(source.eventIds)
    ? source.eventIds
    : Array.isArray(source.event_ids)
      ? source.event_ids
      : source.eventId || source.event_id
        ? [source.eventId || source.event_id]
        : [];
  return {
    stateKey: optionalCommandTextArg(source.stateKey || source.state_key || "", 180),
    stateLabel: optionalCommandTextArg(source.stateLabel || source.state_label || source.state || source.title || "", 180),
    story: optionalCommandTextArg(source.story || source.storyLabel || "", 180),
    storyFamily: optionalCommandTextArg(source.storyFamily || source.story_family || "", 180),
    relatedStory: optionalCommandTextArg(source.relatedStory || source.related_story || source.relatedStoryLabel || "", 180),
    relation: optionalCommandTextArg(source.relation || source.relationType || source.relation_type || "", 80),
    eventIds: rawEventIds.map((item) => optionalCommandTextArg(item, 120)).filter(Boolean).slice(0, 20),
  };
}

function normalizeAcceptedChangeSuggestion(value, { action = "", params = {} } = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const item = raw.item && typeof raw.item === "object" ? raw.item : {};
  const text = optionalCommandTextArg(
    typeof value === "string"
      ? value
      : raw.text || raw.suggestion || item.text || item.suggestion || item.body || item.title || raw.body || raw.title,
    1400
  );
  if (!text) return null;
  return {
    text,
    fingerprint: normalizeWorldMemorySuggestionFingerprint(text),
    continuityId: normalizeWorldMemorySuggestionContinuityId(
      raw.continuityId || raw.continuity_id || item.continuityId || item.continuity_id
    ),
    source: optionalCommandTextArg(raw.source || "world-memory-report-item", 80),
    section: optionalCommandTextArg(raw.section || "memory-change", 80),
    sectionLabel: optionalCommandTextArg(raw.sectionLabel || "월드 메모리 변경 제안", 120),
    action: optionalCommandTextArg(raw.action || action, 80),
    label: optionalCommandTextArg(raw.label || "", 180),
    target: normalizeChangeSuggestionTarget(params),
  };
}

function normalizeHandledChangeSuggestionRecord(value) {
  const source = value && typeof value === "object" ? value : {};
  const text = optionalCommandTextArg(source.text, 1400);
  const fingerprint = optionalCommandTextArg(source.fingerprint || normalizeWorldMemorySuggestionFingerprint(text), 1500);
  if (!text || !fingerprint) return null;
  const action = optionalCommandTextArg(source.action || "", 80);
  const rawStatus = optionalCommandTextArg(source.status || "", 40).toLowerCase();
  const status = rawStatus === "watching" || rawStatus === "observing" ? "watching" : "completed";
  const continuityId = normalizeWorldMemorySuggestionContinuityId(
    source.continuityId || source.continuity_id || source.id
  );
  const recordId = continuityId || `handled_${Date.now()}`;
  return {
    id: recordId,
    continuityId: recordId,
    text,
    fingerprint,
    status,
    action,
    label: optionalCommandTextArg(source.label || "", 180),
    handledAt: optionalCommandTextArg(source.handledAt || source.at || nowIso(), 80),
    source: optionalCommandTextArg(source.source || "world-memory-report-item", 80),
    section: optionalCommandTextArg(source.section || "memory-change", 80),
    sectionLabel: optionalCommandTextArg(source.sectionLabel || "월드 메모리 변경 제안", 120),
    target: normalizeChangeSuggestionTarget(source.target || {}),
  };
}

function normalizeChangeSuggestionLedger(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const handled = asArray(raw.handled)
    .map((item) => normalizeHandledChangeSuggestionRecord(item))
    .filter(Boolean);
  const seen = new Set();
  return {
    version: 1,
    handled: handled.filter((item) => {
      const recordKey = item.continuityId || item.fingerprint;
      if (seen.has(recordKey)) return false;
      seen.add(recordKey);
      return true;
    }).slice(0, WORLD_MEMORY_HANDLED_CHANGE_SUGGESTION_LIMIT),
  };
}

function rememberChangeSuggestionStatus(state, suggestion, status) {
  const normalized = normalizeHandledChangeSuggestionRecord({ ...suggestion, status });
  if (!normalized) return state;
  const ledger = normalizeChangeSuggestionLedger(state.changeSuggestionLedger);
  const existing = ledger.handled.find((item) =>
    item.continuityId === normalized.continuityId || item.fingerprint === normalized.fingerprint
  );
  const nextRecord = existing?.status === "completed" && normalized.status === "watching"
    ? existing
    : {
        ...normalized,
        id: existing?.id || normalized.id,
        continuityId: existing?.continuityId || normalized.continuityId,
      };
  const nextHandled = [
    nextRecord,
    ...ledger.handled.filter((item) =>
      item.continuityId !== nextRecord.continuityId && item.fingerprint !== nextRecord.fingerprint
    ),
  ].slice(0, WORLD_MEMORY_HANDLED_CHANGE_SUGGESTION_LIMIT);
  return {
    ...state,
    changeSuggestionLedger: {
      version: 1,
      handled: nextHandled,
    },
  };
}

function handledTargetMatchesSuggestion(suggestion, handled) {
  const suggestionKey = normalizeWorldMemorySuggestionFingerprint(suggestion);
  const target = handled?.target && typeof handled.target === "object" ? handled.target : {};
  const targetLabels = [
    target.stateLabel,
    target.story,
    target.storyFamily,
    target.relatedStory,
  ]
    .map((item) => normalizeWorldMemorySuggestionFingerprint(item))
    .filter((item) => item.length >= 4);
  if (!targetLabels.length) return false;
  if (!targetLabels.some((label) => suggestionKey.includes(label))) return false;

  const handledTokens = new Set(
    String(handled.text || "")
      .normalize("NFKC")
      .replace(/[`"'“”‘’.,;:!?()[\]{}<>\\/|]/g, " ")
      .split(/\s+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length >= 2)
  );
  if (!handledTokens.size) return false;
  const suggestionTokens = new Set(
    String(suggestion || "")
      .normalize("NFKC")
      .replace(/[`"'“”‘’.,;:!?()[\]{}<>\\/|]/g, " ")
      .split(/\s+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length >= 2)
  );
  const overlap = [...handledTokens].filter((token) => suggestionTokens.has(token)).length;
  return overlap >= Math.min(6, Math.ceil(handledTokens.size * 0.45));
}

function normalizeGeneratedMemoryChangeSuggestionItem(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const text = optionalCommandTextArg(value.text || value.suggestion || value.body || value.title, 1400);
    if (!text) return null;
    return {
      text,
      continuityId: normalizeWorldMemorySuggestionContinuityId(
        value.continuityId || value.continuity_id || value.continuesSuggestionId || value.continues_suggestion_id
      ),
    };
  }
  const text = optionalCommandTextArg(value, 1400);
  return text ? { text, continuityId: "" } : null;
}

export function normalizeWorldMemoryGeneratedSuggestionItems(value, allowedContinuityIds = []) {
  const allowed = new Set(
    asArray(allowedContinuityIds)
      .map((item) => normalizeWorldMemorySuggestionContinuityId(item))
      .filter(Boolean)
  );
  const normalized = asArray(value)
    .map((item) => normalizeGeneratedMemoryChangeSuggestionItem(item))
    .filter(Boolean)
    .map((item) => ({
      ...item,
      continuityId: item.continuityId && allowed.has(item.continuityId) ? item.continuityId : "",
    }))
    .slice(0, 8);
  const lastIndexByContinuityId = new Map();
  normalized.forEach((item, index) => {
    if (item.continuityId) lastIndexByContinuityId.set(item.continuityId, index);
  });
  return normalized.filter((item, index) =>
    !item.continuityId || lastIndexByContinuityId.get(item.continuityId) === index
  );
}

export function validateWorldMemorySuggestionContinuityOutput(value, handledChangeSuggestions = []) {
  const watchingRecords = asArray(handledChangeSuggestions)
    .map((item) => normalizeHandledChangeSuggestionRecord(item))
    .filter((item) => item?.status === "watching");
  if (!watchingRecords.length) return { ok: true, issues: [] };

  const allowedContinuityIds = new Set(watchingRecords.map((item) => item.continuityId));
  const issues = [];
  asArray(value).forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push(`memoryChangeSuggestions[${index}] must be an object with text and continuityId`);
      return;
    }
    const hasContinuityDecision =
      Object.prototype.hasOwnProperty.call(item, "continuityId") ||
      Object.prototype.hasOwnProperty.call(item, "continuity_id");
    if (!hasContinuityDecision) {
      issues.push(`memoryChangeSuggestions[${index}] is missing continuityId`);
      return;
    }
    const rawContinuityId = String(item.continuityId ?? item.continuity_id ?? "").trim();
    if (rawContinuityId && !allowedContinuityIds.has(rawContinuityId)) {
      issues.push(`memoryChangeSuggestions[${index}] references an unknown continuityId`);
    }
  });
  return { ok: issues.length === 0, issues };
}

function suggestionText(value) {
  return value && typeof value === "object" ? String(value.text || "").trim() : String(value || "").trim();
}

function suggestionContinuityId(value) {
  return value && typeof value === "object"
    ? normalizeWorldMemorySuggestionContinuityId(value.continuityId || value.continuity_id)
    : "";
}

function shouldHideHandledChangeSuggestion(suggestion, handledChangeSuggestions = []) {
  const text = suggestionText(suggestion);
  const continuityId = suggestionContinuityId(suggestion);
  const fingerprint = normalizeWorldMemorySuggestionFingerprint(text);
  if (!fingerprint) return false;
  return asArray(handledChangeSuggestions).some((item) => {
    const handled = normalizeHandledChangeSuggestionRecord(item);
    if (!handled) return false;
    if (handled.status !== "completed") return false;
    return (
      (continuityId && handled.continuityId === continuityId) ||
      handled.fingerprint === fingerprint ||
      handledTargetMatchesSuggestion(text, handled)
    );
  });
}

function handledRecordForSuggestion(suggestion, handledChangeSuggestions = []) {
  const text = suggestionText(suggestion);
  const continuityId = suggestionContinuityId(suggestion);
  const fingerprint = normalizeWorldMemorySuggestionFingerprint(text);
  if (!fingerprint) return null;
  for (const item of asArray(handledChangeSuggestions)) {
    const handled = normalizeHandledChangeSuggestionRecord(item);
    if (!handled) continue;
    if (
      (continuityId && handled.continuityId === continuityId) ||
      handled.fingerprint === fingerprint ||
      handledTargetMatchesSuggestion(text, handled)
    ) return handled;
  }
  return null;
}

function buildMemoryChangeSuggestionItems(
  suggestions = [],
  handledChangeSuggestions = [],
  { handledDisplayMode = "mark", appendHandledChangeSuggestions = [] } = {}
) {
  const handledRecords = asArray(handledChangeSuggestions)
    .map((item) => normalizeHandledChangeSuggestionRecord(item))
    .filter(Boolean);
  const appendedHandledRecords = asArray(appendHandledChangeSuggestions)
    .map((item) => normalizeHandledChangeSuggestionRecord(item))
    .filter(Boolean);
  const allowedContinuityIds = handledRecords.map((item) => item.continuityId);
  const items = normalizeWorldMemoryGeneratedSuggestionItems(suggestions, allowedContinuityIds)
    .map((suggestion) => {
      const handled = handledRecordForSuggestion(suggestion, handledRecords);
      const status = handled?.status || "open";
      return {
        text: suggestion.text,
        continuityId: handled?.continuityId || suggestion.continuityId || "",
        handled: status === "completed",
        watching: status === "watching",
        status,
        handledAt: handled?.handledAt || "",
        action: handled?.action || "",
      };
    })
    .filter((item) => !(handledDisplayMode === "omit" && item.status === "completed"));
  const existingFingerprints = new Set(items.map((item) => normalizeWorldMemorySuggestionFingerprint(item.text)));
  const existingContinuityIds = new Set(items.map((item) => item.continuityId).filter(Boolean));
  const persistentWatchingRecords = handledRecords.filter((item) => item.status === "watching");
  const missingHandledItems = [...appendedHandledRecords, ...persistentWatchingRecords]
    .filter((item, index, records) => records.findIndex((candidate) => candidate.fingerprint === item.fingerprint) === index)
    .filter((item) => !existingContinuityIds.has(item.continuityId))
    .filter((item) => !existingFingerprints.has(item.fingerprint))
    .map((item) => ({
      text: item.text,
      continuityId: item.continuityId,
      handled: item.status === "completed",
      watching: item.status === "watching",
      status: item.status,
      handledAt: item.handledAt,
      action: item.action,
    }));
  return [...missingHandledItems, ...items];
}

export function filterWorldMemoryReportView(
  reportView,
  {
    handledChangeSuggestions = [],
    handledDisplayMode = "mark",
    appendHandledChangeSuggestions = [],
  } = {}
) {
  const view = reportView && typeof reportView === "object" && !Array.isArray(reportView) ? reportView : fallbackReportView("");
  const generatedSuggestionItems = Array.isArray(view.memoryChangeSuggestionItems) && view.memoryChangeSuggestionItems.length
    ? view.memoryChangeSuggestionItems
    : view.memoryChangeSuggestions;
  const memoryChangeSuggestionItems = buildMemoryChangeSuggestionItems(generatedSuggestionItems, handledChangeSuggestions, {
    handledDisplayMode,
    appendHandledChangeSuggestions,
  });
  return {
    ...view,
    memoryChangeSuggestions: memoryChangeSuggestionItems.map((item) => item.text),
    memoryChangeSuggestionItems,
  };
}

function formatHandledChangeSuggestionsForPrompt(handledChangeSuggestions = [], status = "completed") {
  const rows = asArray(handledChangeSuggestions)
    .map((item) => normalizeHandledChangeSuggestionRecord(item))
    .filter((item) => item?.status === status)
    .slice(0, 12)
    .map((item, index) => {
      const target = item.target || {};
      const targetBits = [
        target.stateLabel ? `state=${target.stateLabel}` : "",
        target.story ? `story=${target.story}` : "",
        target.storyFamily ? `family=${target.storyFamily}` : "",
        target.relatedStory ? `related=${target.relatedStory}` : "",
        target.relation ? `relation=${target.relation}` : "",
      ].filter(Boolean);
      return `${index + 1}. continuityId=${item.continuityId} / ${item.text}${item.action ? ` / action=${item.action}` : ""}${targetBits.length ? ` / ${targetBits.join(", ")}` : ""}`;
    });
  return rows.length ? rows.join("\n") : "없음";
}

function filterStoredReport(report = {}, handledChangeSuggestions = []) {
  if (!report?.view || typeof report.view !== "object" || Array.isArray(report.view)) return report;
  const view = filterWorldMemoryReportView(report.view, { handledChangeSuggestions });
  return {
    ...report,
    suggestions: reportChangeSuggestions(view),
    text: reportPlainText(view),
    view,
  };
}

function commandFloat(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function defaultModelPolicy() {
  return {
    preferredProvider: "codex-cli",
    configuredProvider: "default",
    codex: {
      provider: "codex-cli",
      providerLabel: "Codex CLI",
      model: "gpt-5.5",
      modelLabel: "latest available Codex model",
      reasoning: "high",
      speed: "standard",
      role: "collection + report generation",
    },
    antigravity: {
      provider: "antigravity-cli",
      providerLabel: "Antigravity CLI",
      model: "Gemini 3.5 Flash (Medium)",
      modelLabel: "latest available Antigravity model",
      reasoning: "medium",
      speed: "standard",
      role: "collection + report generation",
    },
    resolvedAt: "",
    source: "fallback",
  };
}

function normalizeWorldMemoryProviderSetting(value) {
  return value === "codex-cli" || value === "antigravity-cli" ? value : "default";
}

function resolvePreferredWorldMemoryProvider(setting, options = {}) {
  const configuredProvider = normalizeWorldMemoryProviderSetting(setting);
  if (configuredProvider !== "default") return configuredProvider;
  return options?.selected?.provider === "antigravity-cli" ? "antigravity-cli" : "codex-cli";
}

function resolveWorldMemoryModelPolicy() {
  const fallback = defaultModelPolicy();
  try {
    const options = getCodexOptions();
    const settings = readWorldMemorySettings();
    const configuredProvider = normalizeWorldMemoryProviderSetting(settings.managementProvider);
    const preferredProvider = resolvePreferredWorldMemoryProvider(settings.managementProvider, options);
    const codexGroups = Array.isArray(options.modelGroups) ? options.modelGroups : [];
    const agentProviderSettings = options.agentSettings?.settings?.providers || {};
    const codexPreferredModel = settings.managementModel || agentProviderSettings["codex-cli"]?.model || "";
    const codexGroup =
      codexGroups.find((group) => group?.slug === codexPreferredModel) || codexGroups[0] || null;
    const codexReasoningLevels = Array.isArray(codexGroup?.reasoningLevels)
      ? codexGroup.reasoningLevels.map((level) => level.id)
      : [];
    const antigravityModels = Array.isArray(options.antigravityModelCatalog?.models)
      ? options.antigravityModelCatalog.models.filter((item) => item?.selectable && item?.name)
      : [];
    const antigravityPreferredModel = settings.managementModel || agentProviderSettings["antigravity-cli"]?.model || "";
    const antigravityModelEntry =
      antigravityModels.find((item) => item.name === antigravityPreferredModel) || antigravityModels[0] || null;
    const antigravityModel =
      antigravityModelEntry?.name ||
      options.antigravity?.defaultModel ||
      agentProviderSettings["antigravity-cli"]?.model ||
      fallback.antigravity.model;
    const codexPreferredReasoning = settings.managementReasoning || agentProviderSettings["codex-cli"]?.reasoning || "";
    const codexReasoning = codexReasoningLevels.includes(codexPreferredReasoning)
      ? codexPreferredReasoning
      : codexReasoningLevels.includes(codexGroup?.defaultReasoningLevel)
        ? codexGroup.defaultReasoningLevel
        : codexReasoningLevels.includes("high")
          ? "high"
          : codexReasoningLevels[0] || "high";
    const codexSpeedOptions = Array.isArray(codexGroup?.speedOptions) ? codexGroup.speedOptions : [];
    const codexPreferredSpeed = settings.managementSpeed || agentProviderSettings["codex-cli"]?.speed || "standard";
    const codexSpeed = codexSpeedOptions.some((option) => {
      if (option?.id !== codexPreferredSpeed) return false;
      const supported = Array.isArray(option.supportedReasoningLevels) ? option.supportedReasoningLevels : [];
      return !supported.length || supported.includes(codexReasoning);
    })
      ? codexPreferredSpeed
      : "standard";
    const antigravityReasoning =
      settings.managementReasoning ||
      agentProviderSettings["antigravity-cli"]?.reasoning ||
      String(antigravityModel.match(/\(([^)]+)\)\s*$/)?.[1] || "medium").toLowerCase();

    return {
      preferredProvider,
      configuredProvider,
      codex: {
        ...fallback.codex,
        available: Boolean(options.codex?.available),
        model: codexGroup?.slug || options.codex?.config?.model || fallback.codex.model,
        modelLabel: codexGroup?.displayName || codexGroup?.slug || fallback.codex.modelLabel,
        reasoning: codexReasoning,
        speed: codexSpeed,
      },
      antigravity: {
        ...fallback.antigravity,
        available: Boolean(options.antigravity?.ready),
        model: antigravityModel,
        modelLabel: antigravityModelEntry?.displayName || antigravityModel,
        reasoning: antigravityReasoning,
        speed: "standard",
        credentialMode: options.antigravity?.credentialMode || "",
      },
      resolvedAt: nowIso(),
      source: "runtime-options",
    };
  } catch (error) {
    return {
      ...fallback,
      preferredProvider: fallback.preferredProvider,
      configuredProvider: fallback.configuredProvider,
      resolvedAt: nowIso(),
      source: "fallback",
      error: error.message,
    };
  }
}

function safeOutput(text, limit = OUTPUT_LIMIT) {
  const source = String(text || "");
  const maxLength = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.floor(Number(limit))
    : OUTPUT_LIMIT;
  if (source.length <= maxLength) return source;
  return `${source.slice(0, maxLength)}\n...[truncated ${source.length - maxLength} chars]`;
}

function safeStepText(result) {
  return safeOutput(stepText(result), STEP_TEXT_LIMIT);
}

function promptTextFromResult(result, limit = MODEL_INPUT_SECTION_LIMIT) {
  return safeOutput(result?.outputText || result?.stdout || "", limit);
}

function jsonForPrompt(value, limit = MODEL_JSON_SECTION_LIMIT) {
  return safeOutput(JSON.stringify(value || {}, null, 2), limit);
}

function tryParseJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseJsonPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("모델 응답이 비어 있습니다.");
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw new Error("모델 응답을 JSON으로 해석하지 못했습니다.");
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.briefs)) return value.briefs;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.entries)) return value.entries;
  return [];
}

function normalizeBriefRows(payload) {
  const rows = asArray(payload)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      ...item,
      title: String(item.title || "").trim(),
      summary: String(item.summary || "").trim(),
      why_it_matters: String(item.why_it_matters || item.whyItMatters || "").trim(),
      portfolio_link: String(item.portfolio_link || item.portfolioLink || "").trim(),
      dedupe_key: String(item.dedupe_key || item.dedupeKey || item.title || "").trim(),
      sources: Array.isArray(item.sources) ? item.sources : [],
    }))
    .filter((item) => item.title && item.summary && item.sources.length);

  return rows.slice(0, 8);
}

function findPythonCommand() {
  const localVenvPython =
    process.platform === "win32"
      ? join(GUIBUILD_ROOT, ".venv", "Scripts", "python.exe")
      : join(GUIBUILD_ROOT, ".venv", "bin", "python");
  const candidates =
    process.platform === "win32"
      ? [
          { command: localVenvPython, argsPrefix: [], display: ".venv/Scripts/python.exe" },
          { command: "py", argsPrefix: ["-3"], display: "py -3" },
          { command: "python", argsPrefix: [], display: "python" },
          { command: "python3", argsPrefix: [], display: "python3" },
        ]
      : [
          { command: localVenvPython, argsPrefix: [], display: ".venv/bin/python" },
          { command: "python3", argsPrefix: [], display: "python3" },
          { command: "python", argsPrefix: [], display: "python" },
        ];

  for (const candidate of candidates) {
    if (candidate.command.includes(".venv") && !existsSync(candidate.command)) continue;
    const result = spawnSync(candidate.command, [...candidate.argsPrefix, "--version"], {
      encoding: "utf8",
      timeout: 3000,
    });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function probePythonDependencies(python) {
  if (!python) {
    return {
      ok: false,
      python: null,
      modules: {},
      missingRequired: ["python"],
      issues: [{ code: "PYTHON_NOT_FOUND", status: "error", message: "Python 실행 파일을 찾을 수 없습니다." }],
    };
  }

  const script = [
    "import importlib.util, json, sys",
    "mods = ['pandas', 'requests', 'yfinance', 'sentence_transformers']",
    "payload = {'python': sys.executable, 'modules': {m: bool(importlib.util.find_spec(m)) for m in mods}}",
    "print(json.dumps(payload))",
  ].join("\n");
  const result = spawnSync(python.command, [...python.argsPrefix, "-c", script], {
    cwd: GUIBUILD_ROOT,
    encoding: "utf8",
    timeout: 8000,
  });
  const parsed = tryParseJson(result.stdout);
  const modules = parsed?.modules || {};
  const missingRequired = ["pandas"].filter((name) => !modules[name]);
  const issues = [];
  if (result.error || result.status !== 0) {
    issues.push({
      code: "PYTHON_DEPENDENCY_PROBE_FAILED",
      status: "error",
      message: result.error?.message || result.stderr || `python exited ${result.status}`,
    });
  }
  for (const name of missingRequired) {
    issues.push({
      code: "WORLD_MEMORY_REQUIRED_DEP_MISSING",
      status: "error",
      message: `${name}가 없어 world_memory_cli.py를 import할 수 없습니다.`,
      installCommand: `${python.display} -m pip install -r requirements.txt`,
    });
  }
  for (const name of ["yfinance", "sentence_transformers"]) {
    if (!modules[name]) {
      issues.push({
        code: "WORLD_MEMORY_OPTIONAL_DEP_MISSING",
        status: "warning",
        message:
          name === "yfinance"
            ? "yfinance가 없어 FEED 스캔의 시장 스냅샷과 일부 자료수집이 제한됩니다."
            : "sentence-transformers가 없어 semantic-search/embed-build는 설치 전까지 사용할 수 없습니다.",
        installCommand: `${python.display} -m pip install -r requirements.txt`,
      });
    }
  }

  return {
    ok: issues.every((issue) => issue.status !== "error"),
    python: {
      command: python.command,
      display: python.display,
      executable: parsed?.python || "",
    },
    modules,
    missingRequired,
    issues,
  };
}

function runPythonScript({ scriptPath, args = [], timeoutMs = COMMAND_TIMEOUT_MS }) {
  return new Promise((resolveRun) => {
    const python = findPythonCommand();
    if (!python) {
      resolveRun({
        ok: false,
        code: "PYTHON_NOT_FOUND",
        error: "Python 실행 파일을 찾을 수 없습니다.",
        stdout: "",
        stderr: "",
        command: "",
      });
      return;
    }
    if (!existsSync(scriptPath)) {
      resolveRun({
        ok: false,
        code: "WORLD_MEMORY_SCRIPT_MISSING",
        error: `${relative(GUIBUILD_ROOT, scriptPath)} 파일을 찾을 수 없습니다.`,
        stdout: "",
        stderr: "",
        command: "",
      });
      return;
    }

    const startedAt = Date.now();
    const commandArgs = [...python.argsPrefix, scriptPath, ...args];
    const child = spawn(python.command, commandArgs, {
      cwd: GUIBUILD_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolveRun({
        ok: false,
        code: "WORLD_MEMORY_COMMAND_TIMEOUT",
        error: `월드 메모리 명령이 ${Math.round(timeoutMs / 1000)}초 제한을 초과했습니다.`,
        stdout: safeOutput(stdout),
        stderr: safeOutput(stderr),
        command: `${python.display} ${[relative(GUIBUILD_ROOT, scriptPath), ...args].join(" ")}`,
        durationMs: Date.now() - startedAt,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({
        ok: false,
        code: "WORLD_MEMORY_COMMAND_SPAWN_FAILED",
        error: error.message,
        stdout: safeOutput(stdout),
        stderr: safeOutput(stderr),
        command: `${python.display} ${[relative(GUIBUILD_ROOT, scriptPath), ...args].join(" ")}`,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({
        ok: code === 0,
        code: code === 0 ? "OK" : "WORLD_MEMORY_COMMAND_FAILED",
        exitCode: code,
        error: code === 0 ? "" : stderr.trim() || stdout.trim() || `python exited ${code}`,
        stdout: safeOutput(stdout),
        stderr: safeOutput(stderr),
        command: `${python.display} ${[relative(GUIBUILD_ROOT, scriptPath), ...args].join(" ")}`,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function worldMemoryBaseArgs() {
  return ["--base-dir", WORLD_MEMORY_BASE_ARG, "--db-file", WORLD_MEMORY_DB_FILE];
}

function stampForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

function commandForAction(body = {}) {
  const action = String(body.action || "").trim();
  const days = clampInteger(body.days, action === "report" ? 14 : 30, 1, 3650);
  const limit = clampInteger(body.limit, 50, 1, 1000);
  const entryMode = parseEnum(body.entryMode, ["all", "issue", "brief"], "all");
  const base = worldMemoryBaseArgs();

  if (action === "init") {
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "init"], output: "text" };
  }
  if (action === "audit") {
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "audit", "--days", String(days), "--format", "json"], output: "json" };
  }
  if (action === "harness") {
    return {
      scriptPath: WORLD_MEMORY_HARNESS,
      args: ["--base-dir", WORLD_MEMORY_BASE_ARG, "--db-file", WORLD_MEMORY_DB_FILE, "--days", String(days), "--format", "json"],
      output: "json",
    };
  }
  if (action === "list") {
    return {
      scriptPath: WORLD_MEMORY_CLI,
      args: [...base, "list", "--days", String(days), "--entry-mode", entryMode, "--limit", String(limit), "--format", "json"],
      output: "json",
    };
  }
  if (action === "states") {
    const status = parseEnum(body.status, ["all", "active", "watch", "resolved", "overridden"], "all");
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "states", "--status", status, "--limit", String(limit), "--format", "json"], output: "json" };
  }
  if (action === "taxonomy") {
    const type = parseEnum(body.type, ["all", "category", "region", "importance", "entry_mode", "story", "story_family", "story_relation", "tag", "ticker", "subject", "subject_type", "industry", "event_kind", "state_key", "net_effect"], "all");
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "taxonomy", "--type", type, "--limit", String(limit), "--format", "json"], output: "json" };
  }
  if (action === "taxonomyRefresh") {
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "taxonomy", "--refresh", "--type", "all", "--limit", String(limit), "--format", "json"], output: "json" };
  }
  if (action === "cleanupDryRun") {
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "cleanup", "--dry-run"], output: "text" };
  }
  if (action === "briefStoryBackfill") {
    const rawEventIds = Array.isArray(body.eventIds)
      ? body.eventIds
      : Array.isArray(body.event_ids)
        ? body.event_ids
        : body.eventId || body.event_id
          ? [body.eventId || body.event_id]
          : [];
    const eventIds = rawEventIds
      .map((item) => optionalCommandTextArg(item, 120))
      .filter(Boolean)
      .slice(0, 20);
    if (!eventIds.length) throw new Error("briefStoryBackfill requires eventIds");
    const story = commandTextArg(body.story || body.storyLabel, "story", 180);
    const storyFamily = optionalCommandTextArg(body.storyFamily || body.story_family || story, 180) || story;
    const note = optionalCommandTextArg(body.note || body.rationale || body.reason, 700);
    const confidence = commandFloat(body.confidence, 0.7, 0, 1);
    const args = [
      ...base,
      "brief-story-backfill",
      "--story",
      story,
      "--story-family",
      storyFamily,
      "--confidence",
      String(confidence),
      "--format",
      "json",
    ];
    for (const eventId of eventIds) args.push("--event-id", eventId);
    if (note) args.push("--note", note);
    if (body.replaceExisting === true || body.replace_existing === true) args.push("--replace-existing");
    if (body.dryRun === true || body.dry_run === true) args.push("--dry-run");
    return { scriptPath: WORLD_MEMORY_CLI, args, output: "json" };
  }
  if (action === "storyLink") {
    const story = commandTextArg(body.story || body.storyLabel, "story");
    const relatedStory = commandTextArg(body.relatedStory || body.related_story || body.relatedStoryLabel, "relatedStory");
    const relation = parseEnum(
      body.relation || body.relationType || body.relation_type,
      ["evolves_from", "branches_from", "confirms", "conflicts_with", "replaces", "same_family"],
      "branches_from"
    );
    const storyKey = optionalCommandTextArg(body.storyKey || body.story_key, 160);
    const relatedStoryKey = optionalCommandTextArg(body.relatedStoryKey || body.related_story_key, 160);
    const storyFamily = optionalCommandTextArg(body.storyFamily || body.story_family, 200);
    const sourceEventId = optionalCommandTextArg(body.sourceEventId || body.source_event_id, 160);
    const note = optionalCommandTextArg(body.note, 500);
    const confidence = commandFloat(body.confidence, 0.7, 0, 1);
    const args = [
      ...base,
      "story-link",
      "--story",
      story,
      "--related-story",
      relatedStory,
      "--relation",
      relation,
      "--confidence",
      String(confidence),
    ];
    if (storyKey) args.push("--story-key", storyKey);
    if (relatedStoryKey) args.push("--related-story-key", relatedStoryKey);
    if (storyFamily) args.push("--story-family", storyFamily);
    if (sourceEventId) args.push("--source-event-id", sourceEventId);
    if (note) args.push("--note", note);
    if (body.dryRun === true) args.push("--dry-run");
    return { scriptPath: WORLD_MEMORY_CLI, args, output: "json" };
  }
  if (action === "storyMap") {
    const view = parseEnum(body.view, ["nodes", "links"], "nodes");
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "story-map", "--view", view, "--days", String(days), "--limit", String(limit), "--format", "json"], output: "json" };
  }
  if (action === "storyFamilyReview") {
    const status = parseEnum(body.status, ["all", "suggested", "accepted", "rejected"], "suggested");
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "story-family-review", "--status", status, "--limit", String(limit), "--format", "json"], output: "json" };
  }
  if (action === "stateAdd") {
    const title = commandTextArg(body.title || body.state || body.stateLabel || body.label, "title", 180);
    const summary = commandTextArg(body.summary || body.note || body.description || body.rationale, "summary", 700);
    const watchItems = Array.isArray(body.watchItems)
      ? body.watchItems.map((item) => optionalCommandTextArg(item, 120)).filter(Boolean)
      : [];
    const rationaleBase = optionalCommandTextArg(body.rationale || body.reason || body.why || body.note || summary, 900);
    const watchText = watchItems.length ? `감시 항목: ${watchItems.join(", ")}` : "";
    const stateRationale = optionalCommandTextArg([rationaleBase, watchText].filter(Boolean).join(" "), 1100) || summary;
    const story = optionalCommandTextArg(body.story || body.storyLabel || body.storyFamily || body.story_family, 180);
    const storyFamily = optionalCommandTextArg(body.storyFamily || body.story_family || story, 180);
    const stateKey = commandTextArg(body.stateKey || body.state_key || title, "stateKey", 180);
    const stateLabel = optionalCommandTextArg(body.stateLabel || body.state_label || body.state || title, 180) || title;
    const category = parseEnum(body.category, ["stock_bond", "geopolitics", "emerging"], "geopolitics");
    const region = parseEnum(body.region, ["US", "KR", "GLOBAL"], "GLOBAL");
    const importance = parseEnum(body.importance, ["high", "medium", "low"], "medium");
    const stateStatus = parseEnum(body.stateStatus || body.state_status || body.status, ["active", "watch"], "watch");
    const stateBias = parseEnum(body.stateBias || body.state_bias || body.bias, ["bullish", "bearish", "neutral", "mixed"], "mixed");
    const netEffect = optionalCommandTextArg(body.netEffect || body.net_effect || "mixed_watch", 100);
    const horizon = optionalCommandTextArg(body.horizon, 80) || "수일~수주";
    const portfolioLink = optionalCommandTextArg(body.portfolioLink || body.portfolio_link || "", 360);
    const tags = [
      "world_memory",
      "watch_state",
      ...(
        Array.isArray(body.tags)
          ? body.tags
          : String(body.tags || "")
              .split(",")
      ),
    ]
      .map((item) => optionalCommandTextArg(item, 40))
      .filter(Boolean)
      .slice(0, 12)
      .join(",");
    const industries = (
      Array.isArray(body.industries)
        ? body.industries
        : String(body.industries || "energy,oil,shipping").split(",")
    )
      .map((item) => optionalCommandTextArg(item, 60))
      .filter(Boolean)
      .slice(0, 10)
      .join(",");
    const confidence = commandFloat(body.confidence, 0.7, 0, 1);
    const dedupeKey = optionalCommandTextArg(body.dedupeKey || body.dedupe_key || `gui-state-add-${stateKey}`, 180);
    const args = [
      ...base,
      "add",
      "--category",
      category,
      "--region",
      region,
      "--importance",
      importance,
      "--title",
      title,
      "--summary",
      summary,
      "--why-it-matters",
      stateRationale,
      "--horizon",
      horizon,
      "--tags",
      tags,
      "--industries",
      industries,
      "--event-kind",
      "world_memory_state_watch",
      "--state-key",
      stateKey,
      "--state-label",
      stateLabel,
      "--state-status",
      stateStatus,
      "--state-bias",
      stateBias,
      "--net-effect",
      netEffect,
      "--state-summary",
      summary,
      "--state-rationale",
      stateRationale,
      "--state-confidence",
      String(confidence),
      "--source",
      "FinanceAgentGUI|local://world-memory-change-suggestion||사용자 승인 월드메모리 변경 제안",
      "--dedupe-key",
      dedupeKey,
      "--skip-if-duplicate",
      "--dedupe-days",
      "14",
    ];
    if (story) args.push("--story", story);
    if (storyFamily) args.push("--story-family", storyFamily);
    if (portfolioLink) args.push("--portfolio-link", portfolioLink);
    if (body.supersedesActive === true || body.supersedes_active === true) args.push("--supersedes-active");
    return { scriptPath: WORLD_MEMORY_CLI, args, output: "text" };
  }
  if (action === "embedStatus") {
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "embed-status", "--format", "json"], output: "json" };
  }
  if (action === "semanticSearch") {
    const query = String(body.query || "").trim();
    if (!query) throw new Error("semanticSearch requires query");
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "semantic-search", query, "--limit", String(limit), "--format", "json"], output: "json" };
  }
  if (action === "report") {
    const preset = parseEnum(body.preset, ["default", "recent_industry_trends"], "default");
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "report", "--days", String(days), "--entry-mode", entryMode, "--preset", preset, "--max-items", String(Math.min(limit, 20))], output: "text" };
  }
  if (action === "stateSync") {
    return { scriptPath: WORLD_MEMORY_CLI, args: [...base, "state-sync"], output: "text" };
  }
  if (action === "feedScan") {
    const outPath = join(WORLD_MEMORY_LOG_DIR, `world_memory_feed_scan_${stampForFile()}.md`);
    return {
      scriptPath: MARKET_ANALYZER,
      args: [
        "--news-style",
        "brief",
        "--news-language",
        "original",
        "--max-news-items",
        String(clampInteger(body.maxNewsItems, 120, 20, 500)),
        "--timeline-items",
        String(clampInteger(body.timelineItems, 60, 5, 200)),
        "--timeout",
        String(clampInteger(body.timeoutSeconds, 20, 5, 90)),
        "--out",
        outPath,
      ],
      output: "markdown-file",
      outPath,
      timeoutMs: FEED_SCAN_TIMEOUT_MS,
    };
  }

  throw new Error(`unknown world memory action: ${action || "(empty)"}`);
}

function readCollectionPromptTemplate() {
  if (existsSync(WORLD_MEMORY_PROMPT_PATH)) {
    return readFileSync(WORLD_MEMORY_PROMPT_PATH, "utf8");
  }
  return [
    "월드 메모리 업데이트 절차를 수행한다.",
    "FEED는 빠른 탐지 레이어이며 저장 전 가능한 한 신뢰 가능한 원출처나 정규 언론으로 재확인한다.",
    "한 번 실행할 때 의미 있는 brief 3~8건을 고른다.",
    "같은 subject에 과도하게 쏠리지 않도록 하고, 같은 주체는 최대 2건 정도로 제한한다.",
    "brief-import 입력은 항상 JSON 배열만 사용한다.",
  ].join("\n");
}

function buildBriefGenerationPrompt({ preflight, feedScan }) {
  return [
    readCollectionPromptTemplate().trim(),
    "",
    "반환은 JSON 배열 하나만 출력한다. 설명, 마크다운, 코드펜스는 넣지 않는다.",
    "각 row는 scripts/world_memory_cli.py brief-import가 읽을 수 있어야 한다.",
    "",
    "필수/권장 필드:",
    "- title",
    "- summary",
    "- why_it_matters",
    "- portfolio_link",
    "- category: stock_bond | geopolitics | emerging",
    "- region: US | KR | GLOBAL",
    "- importance: high | medium | low",
    "- horizon",
    "- subjects: [{name, type}]",
    "- industries: string[]",
    "- event_kind",
    "- dedupe_key",
    "- sources: [{name, url, published_at, note}]",
    "- tags, tickers, story, story_thesis, story_checkpoint",
    "",
    "선택 기준:",
    "- FEED 단독으로 불확실한 항목은 제외하거나 importance를 낮춘다.",
    "- 어닝, 가이던스, 정책, 중앙은행, 지정학, 공급망, 자본배분, 산업 실행 신호를 우선한다.",
    "- 중복 헤드라인은 하나의 durable brief로 압축한다.",
    "",
    "사전 월드 메모리 상태:",
    preflight,
    "",
    "FEED 스캔 원문:",
    feedScan,
  ].join("\n");
}

function buildSituationReportPrompt({
  listJson,
  statesJson,
  auditJson,
  feedScan,
  importSummary,
  harnessSummary,
  handledChangeSuggestions = [],
}) {
  return [
    "World Memory 자동 수집 직후 현재 시장 상황 인식 보고서를 한국어로 작성한다.",
    "보고서는 사용자가 메인 페이지에서 바로 읽는 HTML 기반 운영 보고서다. DB 경로, 명령어, 의존성 같은 기술 스탯은 쓰지 않는다.",
    "보고서 하단 제안 영역은 반드시 월드 메모리 변경 제안을 먼저 쓰고, 관찰 및 실행 제안을 그 다음에 쓴다.",
    "이미 처리/수용된 월드 메모리 변경 제안은 새 미처리 제안처럼 다시 쓰지 않는다. 동일 취지의 재표현도 피한다.",
    "계속 관찰 중인 월드 메모리 변경 제안은 완료로 단정하거나 새 제안으로 재포장하지 말고 후속 검증 대상으로 유지한다.",
    "각 변경 제안을 아래 계속 관찰 목록과 의미 기준으로 분류한다. 같은 문제의 수치·시점·표현만 갱신한 후속 제안이면 해당 continuityId를 정확히 재사용하고, 별개 문제면 continuityId를 빈 문자열로 둔다.",
    "문자열 포함 여부나 단어 겹침만으로 분류하지 말고, 제안의 대상·의도·요구되는 후속 행동이 같은지 판단한다. 같은 continuityId는 결과 배열에 한 번만 쓰고 최신 문장만 남긴다.",
    "근거가 부족하면 부족하다고 말하고, 실제 행동 제안은 감시/확인/보류처럼 검증 가능한 수준으로 제안한다.",
    "마크다운이 아니라 JSON 객체 하나만 반환한다. 설명, 코드펜스, HTML 태그는 넣지 않는다.",
    "",
    "반환 schema:",
    JSON.stringify(
      {
        title: "World Memory 시장 상황 인식",
        asOf: "KST 기준 시각",
        stance: "risk-on | neutral | defensive | mixed",
        summary: "첫 화면 요약 1문장",
        narrative: "현재 시장 해석 1~2문단",
        signalRadar: [
          { label: "유동성", score: 65, tone: "positive", note: "점수 근거" },
          { label: "정책", score: 45, tone: "neutral", note: "점수 근거" },
          { label: "지정학", score: 70, tone: "negative", note: "점수 근거" }
        ],
        highlights: [
          { title: "핵심 변화", body: "근거와 의미", tag: "macro", importance: "high" }
        ],
        memoryChangeSuggestions: [
          {
            text: "월드 메모리 story/state/taxonomy 변경 제안",
            continuityId: "같은 관찰 제안의 후속이면 제공된 continuityId, 새 제안이면 빈 문자열",
          },
        ],
        portfolioSuggestions: ["검증 가능한 관찰/비중/헤지 제안"],
        nextChecks: ["다음 회차에서 확인할 데이터"],
      },
      null,
      2
    ),
    "",
    "월드 메모리 최근 로그 JSON:",
    jsonForPrompt(listJson),
    "",
    "현재 state JSON:",
    jsonForPrompt(statesJson),
    "",
    "audit JSON:",
    jsonForPrompt(auditJson, 32 * 1024),
    "",
    "이번 import 요약:",
    importSummary || "import 요약 없음",
    "",
    "harness 요약:",
    harnessSummary || "harness 요약 없음",
    "",
    "이미 처리된 월드 메모리 변경 제안:",
    formatHandledChangeSuggestionsForPrompt(handledChangeSuggestions, "completed"),
    "",
    "계속 관찰 중인 월드 메모리 변경 제안:",
    formatHandledChangeSuggestionsForPrompt(handledChangeSuggestions, "watching"),
    "",
    "이번 FEED 스캔:",
    safeOutput(feedScan || "FEED 스캔 없음", MODEL_FEED_SCAN_LIMIT),
  ].join("\n");
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeTextList(value, limit = 6) {
  return asArray(value)
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeSignalRadar(value) {
  return asArray(value)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      label: String(item.label || "").trim() || "Signal",
      score: clampScore(item.score),
      tone: parseEnum(String(item.tone || "").trim(), ["positive", "neutral", "negative"], "neutral"),
      note: String(item.note || "").trim(),
    }))
    .slice(0, 8);
}

function normalizeHighlights(value) {
  return asArray(value)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      title: String(item.title || "").trim() || "주요 변화",
      body: String(item.body || item.summary || "").trim(),
      tag: String(item.tag || "").trim() || "market",
      importance: parseEnum(String(item.importance || "").trim(), ["high", "medium", "low"], "medium"),
    }))
    .filter((item) => item.body)
    .slice(0, 8);
}

function fallbackReportView(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    title: "World Memory 시장 상황 인식",
    asOf: nowIso(),
    stance: "mixed",
    summary: lines.find((line) => !line.startsWith("#")) || "보고서가 생성되었습니다.",
    narrative: lines.filter((line) => !line.startsWith("#")).slice(0, 4).join("\n"),
    signalRadar: [
      { label: "시장", score: 50, tone: "neutral", note: "구조화 점수 없음" },
      { label: "정책", score: 50, tone: "neutral", note: "구조화 점수 없음" },
      { label: "리스크", score: 50, tone: "neutral", note: "구조화 점수 없음" },
    ],
    highlights: [],
    portfolioSuggestions: [],
    memoryChangeSuggestions: [],
    nextChecks: [],
  };
}

function normalizeReportView(payload, fallbackText = "", handledChangeSuggestions = []) {
  const raw = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const allowedContinuityIds = asArray(handledChangeSuggestions)
    .map((item) => normalizeHandledChangeSuggestionRecord(item)?.continuityId)
    .filter(Boolean);
  const memoryChangeSuggestionItems = normalizeWorldMemoryGeneratedSuggestionItems(
    raw.memoryChangeSuggestions || raw.memory_change_suggestions,
    allowedContinuityIds
  );
  const view = {
    ...fallbackReportView(fallbackText),
    title: String(raw.title || "").trim() || "World Memory 시장 상황 인식",
    asOf: String(raw.asOf || raw.as_of || nowIso()).trim(),
    stance: parseEnum(String(raw.stance || "").trim(), ["risk-on", "neutral", "defensive", "mixed"], "mixed"),
    summary: String(raw.summary || "").trim() || fallbackReportView(fallbackText).summary,
    narrative: String(raw.narrative || raw.body || "").trim() || fallbackReportView(fallbackText).narrative,
    signalRadar: normalizeSignalRadar(raw.signalRadar || raw.signal_radar),
    highlights: normalizeHighlights(raw.highlights),
    portfolioSuggestions: normalizeTextList(raw.portfolioSuggestions || raw.portfolio_suggestions),
    memoryChangeSuggestions: memoryChangeSuggestionItems.map((item) => item.text),
    memoryChangeSuggestionItems,
    nextChecks: normalizeTextList(raw.nextChecks || raw.next_checks),
  };
  if (!view.signalRadar.length) view.signalRadar = fallbackReportView(fallbackText).signalRadar;
  return view;
}

function reportChangeSuggestions(reportView) {
  return normalizeTextList(reportView?.memoryChangeSuggestions, 5);
}

function reportMemoryChangeSuggestionItems(view) {
  if (Array.isArray(view?.memoryChangeSuggestionItems)) {
    return view.memoryChangeSuggestionItems
      .filter((item) => item && typeof item === "object" && item.text)
      .map((item) => ({
        text: String(item.text || "").trim(),
        continuityId: normalizeWorldMemorySuggestionContinuityId(item.continuityId || item.continuity_id),
        status:
          item.status === "watching" || item.status === "observing"
            ? "watching"
            : item.handled || item.status === "handled" || item.status === "completed"
              ? "completed"
              : "open",
      }))
      .filter((item) => item.text);
  }
  return normalizeTextList(view?.memoryChangeSuggestions, 8).map((text) => ({ text, continuityId: "", status: "open" }));
}

function reportMemoryChangeSuggestionLabel(item) {
  if (item.status === "completed") return `[완료] ${item.text}`;
  if (item.status === "watching") return `[관찰 중] ${item.text}`;
  return item.text;
}

function reportPlainText(view) {
  return [
    `# ${view.title}`,
    "",
    view.summary,
    "",
    view.narrative,
    "",
    "## 주요 변화",
    ...view.highlights.map((item) => `- ${item.title}: ${item.body}`),
    "",
    "## 월드 메모리 변경 제안",
    ...reportMemoryChangeSuggestionItems(view).map((item) => `- ${reportMemoryChangeSuggestionLabel(item)}`),
    "",
    "## 포트폴리오/관찰 제안",
    ...view.portfolioSuggestions.map((item) => `- ${item}`),
    "",
    "## 다음 확인 지점",
    ...view.nextChecks.map((item) => `- ${item}`),
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderReportHtmlDocument(view) {
  const signals = view.signalRadar
    .map(
      (item) => `
        <article class="signal ${escapeHtml(item.tone)}">
          <div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.note)}</span></div>
          <div class="bar"><i style="width:${clampScore(item.score)}%"></i></div>
          <b>${clampScore(item.score)}</b>
        </article>`
    )
    .join("");
  const highlights = view.highlights
    .map(
      (item) => `
        <article class="highlight ${escapeHtml(item.importance)}">
          <small>${escapeHtml(item.tag)}</small>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(item.body)}</p>
        </article>`
    )
    .join("");
  const list = (title, items) => `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>아직 제안 없음</li>"}</ul>
    </section>`;
  const memoryChangeList = (title, items) => `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <ul>${
        items.map((item) => `<li>${escapeHtml(reportMemoryChangeSuggestionLabel(item))}</li>`).join("") ||
        "<li>아직 제안 없음</li>"
      }</ul>
    </section>`;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(view.title)}</title>
  <style>
    body{margin:0;background:#f7f7f5;color:#171717;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1040px;margin:0 auto;padding:32px 22px 48px}
    header{border-bottom:1px solid #deded8;padding-bottom:18px;margin-bottom:18px}
    h1{margin:0;font-size:34px;letter-spacing:0;line-height:1.1}
    .meta{margin-top:8px;color:#6d6d67}
    .summary{font-size:18px;font-weight:760}
    .signals{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:22px 0}
    .signal,.highlight,section{border:1px solid #dfdfd8;border-radius:10px;background:#fff;padding:15px}
    .signal{display:grid;gap:10px}
    .signal div:first-child{display:grid;gap:2px}
    .signal span{color:#666;font-size:12px}
    .bar{height:9px;border-radius:99px;background:#ecece7;overflow:hidden}
    .bar i{display:block;height:100%;border-radius:inherit;background:#537f68}
    .signal.negative .bar i{background:#a45b45}.signal.positive .bar i{background:#3f8759}
    .signal b{font-size:20px}
    .highlights{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:18px 0}
    .highlight small{text-transform:uppercase;color:#6d6d67;font-weight:800}
    .highlight h2,section h2{margin:5px 0 8px;font-size:17px;letter-spacing:0}
    .highlight p{margin:0}
    section{margin-top:12px}
    li{margin:6px 0}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(view.title)}</h1>
      <div class="meta">${escapeHtml(view.asOf)} · ${escapeHtml(view.stance)}</div>
    </header>
    <p class="summary">${escapeHtml(view.summary)}</p>
    <p>${escapeHtml(view.narrative)}</p>
    <div class="signals">${signals}</div>
    <div class="highlights">${highlights}</div>
	    ${memoryChangeList("월드 메모리 변경 제안", reportMemoryChangeSuggestionItems(view))}
    ${list("포트폴리오/관찰 제안", view.portfolioSuggestions)}
    ${list("다음 확인 지점", view.nextChecks)}
  </main>
</body>
</html>
`;
}

async function runWorldMemoryModelText({ prompt, modelPolicy, taskType }) {
  const preferredProvider =
    modelPolicy?.preferredProvider === "antigravity-cli" ? "antigravity-cli" : "codex-cli";

  if (preferredProvider === "antigravity-cli") {
    if (!modelPolicy?.antigravity?.available || modelPolicy.antigravity.credentialMode !== "google-oauth") {
      throw new Error("월드 메모리 관리 모델로 선택된 Antigravity CLI를 사용할 수 없습니다.");
    }
    const result = await runAntigravityGenerate({
      prompt,
      model: modelPolicy.antigravity.model,
      approval: "default",
      timeoutMs: WORLD_MEMORY_MODEL_TIMEOUT_MS,
    });
    return {
      answer: String(result.answer || "").trim(),
      provider: "antigravity-cli",
      model: result.model || modelPolicy.antigravity.model,
      reasoning: modelPolicy.antigravity.reasoning || "medium",
      elapsedMs: result.elapsedMs,
    };
  }

  if (modelPolicy?.codex?.available === false) {
    throw new Error("월드 메모리 관리 모델로 선택된 Codex CLI를 사용할 수 없습니다.");
  }

  try {
    const result = await runCodexChat({
      provider: "codex-cli",
      prompt,
      model: modelPolicy.codex.model,
      reasoning: modelPolicy.codex.reasoning || "high",
      speed: modelPolicy.codex.speed || "standard",
      approval: "never",
      taskType,
      timeoutMs: WORLD_MEMORY_MODEL_TIMEOUT_MS,
    });
    return {
      answer: String(result.answer || "").trim(),
      provider: "codex-cli",
      model: result.model,
      reasoning: result.reasoning || modelPolicy.codex.reasoning || "high",
      elapsedMs: result.elapsedMs,
    };
  } catch (error) {
    throw new Error(`Codex 모델 호출 실패: ${error.message}`);
  }
}

async function runBriefGeneration({ preflight, feedScan, modelPolicy }) {
  const prompt = buildBriefGenerationPrompt({ preflight, feedScan });
  const result = await runWorldMemoryModelText({
    prompt,
    taskType: "world-memory-collection",
    modelPolicy,
  });
  const parsed = parseJsonPayload(result.answer);
  const rows = normalizeBriefRows(parsed);
  return {
    ok: true,
    rows,
    raw: result.answer,
    provider: result.provider,
    model: result.model,
    reasoning: result.reasoning,
    elapsedMs: result.elapsedMs,
  };
}

async function runSituationReportGeneration({
  listJson,
  statesJson,
  auditJson,
  feedScan,
  importSummary,
  harnessSummary,
  handledChangeSuggestions = [],
  modelPolicy,
}) {
  const result = await runWorldMemoryModelText({
    prompt: buildSituationReportPrompt({
      listJson,
      statesJson,
      auditJson,
      feedScan,
      importSummary,
      harnessSummary,
      handledChangeSuggestions,
    }),
    taskType: "world-memory-report",
    modelPolicy,
  });
  let parsed = null;
  try {
    parsed = parseJsonPayload(result.answer);
  } catch {
    parsed = null;
  }
  const continuityHarness = validateWorldMemorySuggestionContinuityOutput(
    parsed?.memoryChangeSuggestions || parsed?.memory_change_suggestions,
    handledChangeSuggestions
  );
  if (!continuityHarness.ok) {
    throw new Error(`월드 메모리 변경 제안 연속성 분류 하네스 실패: ${continuityHarness.issues.join("; ")}`);
  }
  const view = normalizeReportView(parsed, result.answer, handledChangeSuggestions);
  return {
    view,
    text: reportPlainText(view),
    raw: String(result.answer || "").trim(),
    provider: result.provider,
    model: result.model,
    reasoning: result.reasoning,
    elapsedMs: result.elapsedMs,
  };
}

async function runCommandFromBody(body) {
  const command = commandForAction(body);
  const result = await runPythonScript({
    scriptPath: command.scriptPath,
    args: command.args,
    timeoutMs: command.timeoutMs || COMMAND_TIMEOUT_MS,
  });
  const json = command.output === "json" ? tryParseJson(result.stdout) : null;
  let artifact = null;
  let outputText = result.stdout;
  if (command.output === "markdown-file" && command.outPath) {
    artifact = {
      path: safeRelative(command.outPath),
      exists: existsSync(command.outPath),
    };
    if (artifact.exists) {
      outputText = readFileSync(command.outPath, "utf8");
    }
  }
  return {
    ...result,
    action: String(body.action || ""),
    outputKind: command.output,
    json,
    artifact,
    outputText: safeOutput(outputText),
  };
}

async function refreshWorldMemoryReportSnapshot({
  sourceAction = "",
  reason = "",
  acceptedChangeSuggestion = null,
} = {}) {
  const startedAt = nowIso();
  const modelPolicy = resolveWorldMemoryModelPolicy();
  const steps = [];

  updateCollectorState((state) => ({
    ...state,
    modelPolicy,
    collector: {
      ...state.collector,
      running: true,
      status: "writing_report",
      lastAction: "월드 메모리 보고서와 변경 제안 갱신 중",
      lastError: "",
      lastStartedAt: startedAt,
      lastTrigger: "report-refresh",
    },
  }));

  try {
    const init = await runCommandFromBody({ action: "init" });
    steps.push({ id: "init", ok: init.ok, text: safeStepText(init) });
    if (!init.ok) throw new Error(init.error || "월드 메모리 DB 초기화 실패");

    const [taxonomyRefresh, auditAfter, harnessAfter, embedAfter, listAfter, statesAfter] = await Promise.all([
      runCommandFromBody({ action: "taxonomyRefresh", limit: 160 }),
      runCommandFromBody({ action: "audit", days: 30 }),
      runCommandFromBody({ action: "harness", days: 30 }),
      runCommandFromBody({ action: "embedStatus" }),
      runCommandFromBody({ action: "list", days: 30, entryMode: "all", limit: 80 }),
      runCommandFromBody({ action: "states", status: "all", limit: 80 }),
    ]);
    steps.push(
      { id: "taxonomy-refresh", ok: taxonomyRefresh.ok, text: safeStepText(taxonomyRefresh) },
      { id: "audit-after", ok: auditAfter.ok, text: safeStepText(auditAfter) },
      { id: "harness-after", ok: harnessAfter.ok, text: safeStepText(harnessAfter) },
      { id: "embed-after", ok: embedAfter.ok, text: safeStepText(embedAfter) },
      { id: "list-after", ok: listAfter.ok, text: safeStepText(listAfter) },
      { id: "states-after", ok: statesAfter.ok, text: safeStepText(statesAfter) }
    );
    if (!auditAfter.ok) throw new Error(auditAfter.error || "audit 실패");
    if (!harnessAfter.ok) throw new Error(harnessAfter.error || "harness 실패");

    const generatedReport = await runSituationReportGeneration({
      listJson: listAfter.json,
      statesJson: statesAfter.json,
      auditJson: auditAfter.json,
      feedScan: [
        "새 FEED 스캔 없이 현재 로컬 월드메모리 DB와 state를 기준으로 보고서/변경 제안을 재생성한다.",
        sourceAction ? `직전 변경 액션: ${sourceAction}` : "",
        reason ? `갱신 사유: ${reason}` : "",
      ].filter(Boolean).join("\n"),
      importSummary: sourceAction ? `사용자 승인 변경 액션 이후 제안 목록 재계산: ${sourceAction}` : "보고서/변경 제안 수동 갱신",
      harnessSummary: safeStepText(harnessAfter),
      handledChangeSuggestions: readCollectorState().changeSuggestionLedger?.handled || [],
      modelPolicy,
    });

    const reportStem = `world_memory_market_situation_${stampForFile()}`;
    const reportHtmlPath = join(WORLD_MEMORY_LOG_DIR, `${reportStem}.html`);
    const reportJsonPath = join(WORLD_MEMORY_LOG_DIR, `${reportStem}.json`);
    const reportTextPath = join(WORLD_MEMORY_LOG_DIR, `${reportStem}.txt`);
    const handledChangeSuggestions = readCollectorState().changeSuggestionLedger?.handled || [];
    const reportView = filterWorldMemoryReportView(generatedReport.view || fallbackReportView(generatedReport.text), {
      handledChangeSuggestions,
      handledDisplayMode: "omit",
      appendHandledChangeSuggestions: acceptedChangeSuggestion ? [acceptedChangeSuggestion] : [],
    });
    const reportText = reportPlainText(reportView);
    writeFileSync(reportHtmlPath, renderReportHtmlDocument(reportView));
    writeFileSync(reportJsonPath, `${JSON.stringify(reportView, null, 2)}\n`);
    writeFileSync(reportTextPath, `${reportText.trim()}\n`);

    const finishedAt = nowIso();
    const nextState = updateCollectorState((state) => {
      const report = {
        status: "ready",
        title: reportView.title || "World Memory 시장 상황 인식",
        generatedAt: finishedAt,
        path: safeRelative(reportHtmlPath),
        htmlPath: safeRelative(reportHtmlPath),
        jsonPath: safeRelative(reportJsonPath),
        textPath: safeRelative(reportTextPath),
        summary: reportView.summary,
        suggestions: reportChangeSuggestions(reportView),
        text: reportText,
        view: reportView,
        provider: generatedReport.provider,
        model: generatedReport.model,
        reasoning: generatedReport.reasoning,
      };
      return appendHistory(
        {
          ...state,
          report,
          collector: completeWorldMemoryReportRefreshCollectorState(state.collector, finishedAt),
        },
        {
          id: `report_refresh_${finishedAt}`,
          trigger: "report-refresh",
          sourceAction,
          startedAt,
          finishedAt,
          ok: true,
          steps,
        }
      );
    });

    return {
      ok: true,
      action: "refreshReport",
      outputKind: "report-refresh",
      outputText: "월드 메모리 보고서와 변경 제안을 새로 생성했습니다.",
      report: nextState.report,
      steps,
      status: await buildWorldMemoryStatus(),
    };
  } catch (error) {
    const failedAt = nowIso();
    updateCollectorState((state) => ({
      ...state,
      collector: {
        ...state.collector,
        running: false,
        status: "error",
        lastAction: "월드 메모리 보고서와 변경 제안 갱신 실패",
        lastError: error.message,
        lastFailedAt: failedAt,
        lastFinishedAt: failedAt,
      },
    }));
    throw error;
  }
}

function stepText(result) {
  return result?.outputText || result?.stdout || result?.error || "";
}

async function executeWorldMemoryCycle({ trigger = "manual", scheduledAt = nowIso(), attempt = 1 } = {}) {
  const runtime = runtimeState();
  if (runtime.inFlight) return runtime.inFlight;

  const cycleId = `wm_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "")}`;
  const startedAt = nowIso();
  runtime.inFlightStartedAt = startedAt;
  runtime.inFlightCycleId = cycleId;
  runtime.inFlight = (async () => {
    const deadlineAt = addMs(scheduledAt, WORLD_MEMORY_INTERVAL_MS);
    const modelPolicy = resolveWorldMemoryModelPolicy();
    const steps = [];
    const connectivity = await probeInternetConnectivity();
    if (!connectivity.ok) {
      const checkedAt = connectivity.checkedAt || nowIso();
      updateCollectorState((state) =>
        applyWorldMemoryOfflineWaitState(state, {
          cycleId,
          trigger,
          scheduledAt,
          deadlineAt,
          attempt,
          checkedAt,
          connectivity,
        })
      );
      return {
        ok: false,
        cycleId,
        skipped: true,
        code: "WORLD_MEMORY_OFFLINE",
        error: connectivity.error || "인터넷 연결 확인 실패",
      };
    }

    updateCollectorState((state) => ({
      ...state,
      modelPolicy,
      collector: {
        ...state.collector,
        running: true,
        status: "collecting",
        lastAction: trigger === "manual" ? "수동 월드 메모리 수집 중" : "자동 월드 메모리 수집 중",
        lastError: "",
        lastStartedAt: startedAt,
        lastTrigger: trigger,
        attempt,
      },
      schedule: {
        ...state.schedule,
        nextRetryAt: "",
        activeCycle: {
          id: cycleId,
          trigger,
          scheduledAt,
          deadlineAt,
          attempt,
          startedAt,
        },
      },
    }));

    try {
      const init = await runCommandFromBody({ action: "init" });
      steps.push({ id: "init", ok: init.ok, text: safeStepText(init) });
      if (!init.ok) throw new Error(init.error || "월드 메모리 DB 초기화 실패");

      const [listBefore, statesBefore, taxonomyRefresh, stateKeyTaxonomy, subjectTaxonomy, embedBefore] =
        await Promise.all([
          runCommandFromBody({ action: "list", days: 30, entryMode: "all", limit: 80 }),
          runCommandFromBody({ action: "states", status: "active", limit: 80 }),
          runCommandFromBody({ action: "taxonomyRefresh", limit: 160 }),
          runCommandFromBody({ action: "taxonomy", type: "state_key", limit: 160 }),
          runCommandFromBody({ action: "taxonomy", type: "subject", limit: 160 }),
          runCommandFromBody({ action: "embedStatus" }),
        ]);
      steps.push(
        { id: "list-before", ok: listBefore.ok, text: safeStepText(listBefore) },
        { id: "states-before", ok: statesBefore.ok, text: safeStepText(statesBefore) },
        { id: "taxonomy-refresh", ok: taxonomyRefresh.ok, text: safeStepText(taxonomyRefresh) },
        { id: "taxonomy-state-key", ok: stateKeyTaxonomy.ok, text: safeStepText(stateKeyTaxonomy) },
        { id: "taxonomy-subject", ok: subjectTaxonomy.ok, text: safeStepText(subjectTaxonomy) },
        { id: "embed-before", ok: embedBefore.ok, text: safeStepText(embedBefore) }
      );

      const feedScan = await runCommandFromBody({ action: "feedScan" });
      steps.push({ id: "feed-scan", ok: feedScan.ok, text: safeStepText(feedScan), artifact: feedScan.artifact });
      if (!feedScan.ok) throw new Error(feedScan.error || "FEED 스캔 실패");

      const preflight = [
        "# list --days 30 --entry-mode all",
        promptTextFromResult(listBefore),
        "# states --status active",
        promptTextFromResult(statesBefore),
        "# taxonomy --refresh",
        promptTextFromResult(taxonomyRefresh),
        "# taxonomy --type state_key",
        promptTextFromResult(stateKeyTaxonomy),
        "# taxonomy --type subject",
        promptTextFromResult(subjectTaxonomy),
        "# embed-status",
        promptTextFromResult(embedBefore),
      ].join("\n\n");

      updateCollectorState((state) => ({
        ...state,
        collector: {
          ...state.collector,
          status: "generating_briefs",
          lastAction: "FEED 스캔을 월드 메모리 brief 후보로 변환 중",
        },
      }));

      const generated = await runBriefGeneration({
        preflight: safeOutput(preflight, MODEL_PREFLIGHT_LIMIT),
        feedScan: safeOutput(feedScan.outputText, MODEL_FEED_SCAN_LIMIT),
        modelPolicy,
      });
      const briefPath = join(WORLD_MEMORY_LOG_DIR, `world_memory_briefs_${stampForFile()}.json`);
      writeFileSync(briefPath, `${JSON.stringify(generated.rows, null, 2)}\n`);
      steps.push({
        id: "brief-generation",
        ok: true,
        text: `generated=${generated.rows.length} model=${generated.model} reasoning=${generated.reasoning}`,
        artifact: { path: safeRelative(briefPath), exists: true },
      });

      let briefImport = {
        ok: true,
        outputText: "저장할 신규 brief 후보가 없습니다.",
        stdout: "저장할 신규 brief 후보가 없습니다.",
      };
      if (generated.rows.length) {
        briefImport = await runPythonScript({
          scriptPath: WORLD_MEMORY_CLI,
          args: [
            ...worldMemoryBaseArgs(),
            "brief-import",
            "--from-file",
            briefPath,
            "--skip-if-duplicate",
          ],
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        briefImport = { ...briefImport, outputText: briefImport.stdout };
      }
      steps.push({ id: "brief-import", ok: briefImport.ok, text: safeStepText(briefImport) });
      if (!briefImport.ok) throw new Error(briefImport.error || "brief-import 실패");

      const [auditAfter, harnessAfter, embedAfter, listAfter, statesAfter] = await Promise.all([
        runCommandFromBody({ action: "audit", days: 30 }),
        runCommandFromBody({ action: "harness", days: 30 }),
        runCommandFromBody({ action: "embedStatus" }),
        runCommandFromBody({ action: "list", days: 30, entryMode: "all", limit: 80 }),
        runCommandFromBody({ action: "states", status: "all", limit: 80 }),
      ]);
      steps.push(
        { id: "audit-after", ok: auditAfter.ok, text: safeStepText(auditAfter) },
        { id: "harness-after", ok: harnessAfter.ok, text: safeStepText(harnessAfter) },
        { id: "embed-after", ok: embedAfter.ok, text: safeStepText(embedAfter) },
        { id: "list-after", ok: listAfter.ok, text: safeStepText(listAfter) },
        { id: "states-after", ok: statesAfter.ok, text: safeStepText(statesAfter) }
      );
      if (!auditAfter.ok) throw new Error(auditAfter.error || "audit 실패");
      if (!harnessAfter.ok) throw new Error(harnessAfter.error || "harness 실패");

      const collectionSuccessfulAt = nowIso();
      updateCollectorState((state) => ({
        ...state,
        collector: {
          ...state.collector,
          status: "writing_report",
          lastAction: "현재 시장 상황 인식 보고서 작성 중",
          lastSuccessfulAt: collectionSuccessfulAt,
        },
      }));

      const generatedReport = await runSituationReportGeneration({
        listJson: listAfter.json,
        statesJson: statesAfter.json,
        auditJson: auditAfter.json,
        feedScan: safeOutput(feedScan.outputText, MODEL_FEED_SCAN_LIMIT),
        importSummary: safeStepText(briefImport),
        harnessSummary: safeStepText(harnessAfter),
        handledChangeSuggestions: readCollectorState().changeSuggestionLedger?.handled || [],
        modelPolicy,
      });
      const reportStem = `world_memory_market_situation_${stampForFile()}`;
      const reportHtmlPath = join(WORLD_MEMORY_LOG_DIR, `${reportStem}.html`);
      const reportJsonPath = join(WORLD_MEMORY_LOG_DIR, `${reportStem}.json`);
      const reportTextPath = join(WORLD_MEMORY_LOG_DIR, `${reportStem}.txt`);
      const handledChangeSuggestions = readCollectorState().changeSuggestionLedger?.handled || [];
      const reportView = filterWorldMemoryReportView(generatedReport.view || fallbackReportView(generatedReport.text), {
        handledChangeSuggestions,
        handledDisplayMode: "omit",
      });
      const reportText = reportPlainText(reportView);
      writeFileSync(reportHtmlPath, renderReportHtmlDocument(reportView));
      writeFileSync(reportJsonPath, `${JSON.stringify(reportView, null, 2)}\n`);
      writeFileSync(reportTextPath, `${reportText.trim()}\n`);
      const finishedAt = nowIso();

      updateCollectorState((state) => {
        const nextRunAt =
          trigger === "manual"
            ? state.schedule.nextRunAt
            : addMs(scheduledAt, WORLD_MEMORY_INTERVAL_MS);
        const report = {
          status: "ready",
          title: reportView.title || "World Memory 시장 상황 인식",
          generatedAt: finishedAt,
          path: safeRelative(reportHtmlPath),
          htmlPath: safeRelative(reportHtmlPath),
          jsonPath: safeRelative(reportJsonPath),
          textPath: safeRelative(reportTextPath),
          summary: reportView.summary,
          suggestions: reportChangeSuggestions(reportView),
          text: reportText,
          view: reportView,
          provider: generatedReport.provider,
          model: generatedReport.model,
          reasoning: generatedReport.reasoning,
        };
        return appendHistory(
          {
            ...state,
            report,
            collector: completeWorldMemoryCollectionCollectorState(state.collector, {
              collectionSuccessfulAt,
              reportFinishedAt: finishedAt,
              importedCandidates: generated.rows.length,
              attempt,
            }),
            schedule: {
              ...state.schedule,
              nextRunAt,
              nextRetryAt: "",
              activeCycle: null,
              pausedUntil: "",
            },
          },
          {
            type: "collection",
            status: "ok",
            trigger,
            scheduledAt,
            startedAt,
            finishedAt,
            attempts: attempt,
            importedCandidates: generated.rows.length,
            reportPath: safeRelative(reportHtmlPath),
            reportJsonPath: safeRelative(reportJsonPath),
            feedScanPath: feedScan.artifact?.path || "",
            briefPath: safeRelative(briefPath),
            steps,
          }
        );
      });

      return { ok: true, cycleId, steps };
    } catch (error) {
      const failedAt = nowIso();
      const canRetry =
        trigger !== "manual" &&
        timestampMs(addMs(Date.now(), WORLD_MEMORY_RETRY_INTERVAL_MS)) < timestampMs(deadlineAt);
      updateCollectorState((state) => {
        const nextRetryAt = canRetry ? addMs(Date.now(), WORLD_MEMORY_RETRY_INTERVAL_MS) : "";
        const nextRunAt = canRetry ? state.schedule.nextRunAt : addMs(scheduledAt, WORLD_MEMORY_INTERVAL_MS);
        return appendHistory(
          {
            ...state,
            collector: {
              ...state.collector,
              running: false,
              status: canRetry ? "retry_wait" : "failed",
              lastAction: canRetry ? "수집 실패 · 30분 뒤 재시도 대기" : "수집 회차 실패",
              lastError: error.message,
              lastFinishedAt: failedAt,
              lastFailedAt: failedAt,
              attempt,
            },
            schedule: {
              ...state.schedule,
              nextRetryAt,
              nextRunAt,
              activeCycle: canRetry
                ? {
                    id: cycleId,
                    trigger,
                    scheduledAt,
                    deadlineAt,
                    attempt,
                    failedAt,
                  }
                : null,
            },
          },
          {
            type: "collection",
            status: canRetry ? "retry_wait" : "failed",
            trigger,
            scheduledAt,
            startedAt,
            finishedAt: failedAt,
            attempts: attempt,
            error: error.message,
            nextRetryAt,
            steps,
          }
        );
      });
      if (trigger !== "manual") scheduleWorldMemoryCollector();
      return { ok: false, cycleId, error: error.message, steps };
    } finally {
      if (runtime.inFlightCycleId === cycleId) {
        runtime.inFlight = null;
        runtime.inFlightStartedAt = "";
        runtime.inFlightCycleId = "";
      }
      scheduleWorldMemoryCollector();
    }
  })();

  return runtime.inFlight;
}

function normalizeMissedSchedules(state) {
  const now = Date.now();
  let nextRunMs = timestampMs(state.schedule.nextRunAt);
  if (!nextRunMs) nextRunMs = now + WORLD_MEMORY_INTERVAL_MS;
  let nextState = state;

  while (now >= nextRunMs + WORLD_MEMORY_INTERVAL_MS) {
    const scheduledAt = new Date(nextRunMs).toISOString();
    nextState = appendHistory(
      {
        ...nextState,
        collector: {
          ...nextState.collector,
          status: "failed",
          lastAction: "예정 회차 미수집으로 실패 처리",
          lastError: "서버가 예정 회차와 6시간 재시도 창을 모두 놓쳤습니다.",
          lastFailedAt: nowIso(),
        },
      },
      {
        type: "collection",
        status: "failed",
        trigger: "scheduled",
        scheduledAt,
        finishedAt: nowIso(),
        error: "missed retry window",
      }
    );
    nextRunMs += WORLD_MEMORY_INTERVAL_MS;
  }

  nextState.schedule.nextRunAt = new Date(nextRunMs).toISOString();
  return nextState;
}

function scheduleWorldMemoryCollector(delayOverrideMs = null) {
  const runtime = runtimeState();
  if (
    !runtime.started ||
    process.env.WORLD_MEMORY_COLLECTOR_DISABLED === "1" ||
    !isWorldMemoryEnabled()
  ) {
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = null;
    runtime.nextTimerAt = "";
    return;
  }
  if (runtime.timer) clearTimeout(runtime.timer);

  let state = normalizeMissedSchedules(readCollectorState());
  clearStaleWorldMemoryConnectivityInFlight(state);
  state = writeCollectorState(state);
  const now = Date.now();
  const pausedUntilMs = timestampMs(state.schedule.pausedUntil);
  const retryAtMs = timestampMs(state.schedule.nextRetryAt);
  const nextRunMs = timestampMs(state.schedule.nextRunAt) || now + WORLD_MEMORY_INTERVAL_MS;
  let targetMs = nextRunMs;

  if (pausedUntilMs > now) targetMs = pausedUntilMs;
  if (state.schedule.activeCycle && retryAtMs > now) {
    targetMs = retryAtMs;
  } else if (retryAtMs > now) {
    targetMs = Math.min(targetMs, retryAtMs);
  }

  const delayMs = delayOverrideMs === null ? Math.max(0, targetMs - now) : Math.max(0, delayOverrideMs);
  runtime.nextTimerAt = new Date(now + delayMs).toISOString();
  runtime.timer = setTimeout(() => {
    runtime.timer = null;
    void handleWorldMemoryTimer();
  }, delayMs);
}

async function handleWorldMemoryTimer() {
  const runtime = runtimeState();
  if (!isWorldMemoryEnabled()) {
    stopWorldMemoryCollector();
    return;
  }
  const currentState = readCollectorState();
  clearStaleWorldMemoryConnectivityInFlight(currentState);
  if (runtime.inFlight) {
    scheduleWorldMemoryCollector(WORLD_MEMORY_RETRY_INTERVAL_MS);
    return;
  }

  let state = normalizeMissedSchedules(currentState);
  state = writeCollectorState(state);
  const now = Date.now();
  const pausedUntilMs = timestampMs(state.schedule.pausedUntil);
  if (pausedUntilMs > now) {
    scheduleWorldMemoryCollector();
    return;
  }

  const activeCycle = state.schedule.activeCycle;
  const retryAtMs = timestampMs(state.schedule.nextRetryAt);
  if (activeCycle && retryAtMs && now >= retryAtMs) {
    const deadlineAtMs = timestampMs(activeCycle.deadlineAt);
    if (deadlineAtMs && now >= deadlineAtMs && !activeCycle.awaitingConnectivity) {
      updateCollectorState((current) =>
        appendHistory(
          {
            ...current,
            collector: {
              ...current.collector,
              status: "failed",
              lastAction: "재시도 창 만료로 회차 실패",
              lastError: "다음 6시간 회차가 도래했습니다.",
              lastFailedAt: nowIso(),
            },
            schedule: {
              ...current.schedule,
              activeCycle: null,
              nextRetryAt: "",
              nextRunAt: addMs(activeCycle.scheduledAt, WORLD_MEMORY_INTERVAL_MS),
            },
          },
          {
            type: "collection",
            status: "failed",
            trigger: "scheduled",
            scheduledAt: activeCycle.scheduledAt,
            finishedAt: nowIso(),
            attempts: activeCycle.attempt,
            error: "retry window expired",
          }
        )
      );
      scheduleWorldMemoryCollector(0);
      return;
    }
    void executeWorldMemoryCycle({
      trigger: "scheduled",
      scheduledAt: activeCycle.awaitingConnectivity ? nowIso() : activeCycle.scheduledAt,
      attempt: activeCycle.awaitingConnectivity
        ? Number(activeCycle.attempt || 1)
        : Number(activeCycle.attempt || 1) + 1,
    });
    return;
  }
  if (activeCycle && retryAtMs && now < retryAtMs) {
    scheduleWorldMemoryCollector();
    return;
  }

  const nextRunMs = timestampMs(state.schedule.nextRunAt);
  if (nextRunMs && now >= nextRunMs) {
    void executeWorldMemoryCycle({
      trigger: "scheduled",
      scheduledAt: state.schedule.nextRunAt,
      attempt: 1,
    });
    return;
  }

  scheduleWorldMemoryCollector();
}

export function startWorldMemoryCollector() {
  const runtime = runtimeState();
  if (!isWorldMemoryEnabled()) {
    stopWorldMemoryCollector({ persist: false });
    return false;
  }
  if (runtime.started) {
    scheduleWorldMemoryCollector();
    return true;
  }
  ensureWorldMemoryDirs();
  runtime.started = true;
  updateCollectorState((state) => ({
    ...state,
    modelPolicy: resolveWorldMemoryModelPolicy(),
  }));
  scheduleWorldMemoryCollector();
  return true;
}

export function stopWorldMemoryCollector({ persist = true } = {}) {
  const runtime = runtimeState();
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.nextTimerAt = "";
  runtime.started = false;

  if (persist && existsSync(WORLD_MEMORY_STATE_PATH)) {
    updateCollectorState((state) => ({
      ...state,
      collector: {
        ...state.collector,
        status: runtime.inFlight ? state.collector.status : "disabled",
        running: Boolean(runtime.inFlight),
        lastAction: runtime.inFlight ? state.collector.lastAction : "월드 메모리 사용 꺼짐",
      },
      schedule: {
        ...state.schedule,
        nextRetryAt: "",
        activeCycle: runtime.inFlight ? state.schedule.activeCycle : null,
      },
    }));
  }

  return true;
}

function pauseWorldMemoryCollection() {
  const pausedUntil = addMs(Date.now(), WORLD_MEMORY_INTERVAL_MS);
  const state = updateCollectorState((current) => ({
    ...current,
    collector: {
      ...current.collector,
      status: current.collector.running ? current.collector.status : "paused",
      lastAction: "다음 월드 메모리 수집을 6시간 연기했습니다.",
      lastError: "",
    },
    schedule: {
      ...current.schedule,
      pausedUntil,
      nextRunAt: pausedUntil,
      nextRetryAt: "",
      activeCycle: current.collector.running ? current.schedule.activeCycle : null,
    },
  }));
  scheduleWorldMemoryCollector();
  return state;
}

function buildWorldMemorySummaryStatus() {
  const settings = readWorldMemorySettings();
  if (!settings.enabled) {
    return buildWorldMemoryDisabledStatus(settings);
  }

  ensureWorldMemoryDirs();
  const collectorState = readCollectorState();
  const runtime = runtimeState();
  const dbExists = existsSync(WORLD_MEMORY_DB_PATH);
  return {
    ok: dbExists,
    enabled: true,
    diagnosticsDeferred: true,
    settings,
    configPath: "config/world-memory.user.json",
    defaultConfigPath: "config/world-memory.defaults.json",
    db: {
      exists: dbExists,
      path: safeRelative(WORLD_MEMORY_DB_PATH),
    },
    collector: {
      ...collectorState.collector,
      schedulerStarted: runtime.started,
      inFlight: Boolean(runtime.inFlight),
      nextTimerAt: runtime.nextTimerAt,
    },
    schedule: collectorState.schedule,
    report: filterStoredReport(
      collectorState.report,
      collectorState.changeSuggestionLedger?.handled || []
    ),
  };
}

async function buildWorldMemoryStatus() {
  const settings = readWorldMemorySettings();
  if (!settings.enabled) {
    return buildWorldMemoryDisabledStatus(settings);
  }

  ensureWorldMemoryDirs();
  const collectorState = readCollectorState();
  const runtime = runtimeState();
  clearStaleWorldMemoryConnectivityInFlight(collectorState);
  if (runtime.started && !runtime.inFlight && isCollectorScheduleDue(collectorState)) {
    scheduleWorldMemoryCollector(0);
  }
  const python = findPythonCommand();
  const dependencies = probePythonDependencies(python);
  let init = null;
  let audit = null;
  let list = null;
  let states = null;
  let taxonomy = null;
  let embeddings = null;

  if (dependencies.ok) {
    init = await runPythonScript({ scriptPath: WORLD_MEMORY_CLI, args: [...worldMemoryBaseArgs(), "init"] });
    if (init.ok) {
      const [auditResult, listResult, stateResult, taxonomyResult, embedResult] = await Promise.all([
        runPythonScript({ scriptPath: WORLD_MEMORY_CLI, args: [...worldMemoryBaseArgs(), "audit", "--days", "30", "--format", "json"] }),
        runPythonScript({ scriptPath: WORLD_MEMORY_CLI, args: [...worldMemoryBaseArgs(), "list", "--days", "30", "--entry-mode", "all", "--limit", "12", "--format", "json"] }),
        runPythonScript({ scriptPath: WORLD_MEMORY_CLI, args: [...worldMemoryBaseArgs(), "states", "--status", "all", "--limit", "12", "--format", "json"] }),
        runPythonScript({ scriptPath: WORLD_MEMORY_CLI, args: [...worldMemoryBaseArgs(), "taxonomy", "--type", "all", "--limit", "40", "--format", "json"] }),
        runPythonScript({ scriptPath: WORLD_MEMORY_CLI, args: [...worldMemoryBaseArgs(), "embed-status", "--format", "json"] }),
      ]);
      audit = { ...auditResult, json: tryParseJson(auditResult.stdout) };
      list = { ...listResult, json: tryParseJson(listResult.stdout) };
      states = { ...stateResult, json: tryParseJson(stateResult.stdout) };
      taxonomy = { ...taxonomyResult, json: tryParseJson(taxonomyResult.stdout) };
      embeddings = { ...embedResult, json: tryParseJson(embedResult.stdout) };
    }
  }

  const publicReport = filterStoredReport(
    collectorState.report,
    collectorState.changeSuggestionLedger?.handled || []
  );

  return {
    ok: dependencies.ok && (!init || init.ok),
    enabled: true,
    settings,
    configPath: "config/world-memory.user.json",
    defaultConfigPath: "config/world-memory.defaults.json",
    paths: {
      root: GUIBUILD_ROOT,
      baseDir: WORLD_MEMORY_BASE_ARG,
      dbFile: WORLD_MEMORY_DB_FILE,
      dbPath: relative(GUIBUILD_ROOT, WORLD_MEMORY_DB_PATH),
      logDir: relative(GUIBUILD_ROOT, WORLD_MEMORY_LOG_DIR),
      cli: relative(GUIBUILD_ROOT, WORLD_MEMORY_CLI),
      harness: relative(GUIBUILD_ROOT, WORLD_MEMORY_HARNESS),
      analyzer: relative(GUIBUILD_ROOT, MARKET_ANALYZER),
    },
    db: {
      exists: existsSync(WORLD_MEMORY_DB_PATH),
      path: safeRelative(WORLD_MEMORY_DB_PATH),
    },
    embedding: {
      engine: WORLD_MEMORY_EMBEDDING_ENGINE,
      model: WORLD_MEMORY_EMBEDDING_MODEL,
      dependency: "sentence-transformers>=5.0.0",
      note: "semantic-search, embed-status, embed-build sidecar profile",
    },
    collector: {
      ...collectorState.collector,
      schedulerStarted: runtime.started,
      inFlight: Boolean(runtime.inFlight),
      nextTimerAt: runtime.nextTimerAt,
    },
    schedule: collectorState.schedule,
    modelPolicy: collectorState.modelPolicy,
    report: publicReport,
    changeSuggestionLedger: collectorState.changeSuggestionLedger,
    history: collectorState.history,
    dependencies,
    actions: actionCatalog,
    init,
    audit,
    list,
    states,
    taxonomy,
    embeddings,
  };
}

async function runWorldMemoryAction(body = {}) {
  if (!isWorldMemoryEnabled()) {
    return {
      ok: false,
      action: String(body.action || "").trim(),
      outputKind: "settings",
      error: "월드 메모리 사용 설정이 꺼져 있습니다.",
      status: buildWorldMemoryDisabledStatus(),
    };
  }

  ensureWorldMemoryDirs();
  const action = String(body.action || "").trim();
  const acceptedChangeSuggestion = normalizeAcceptedChangeSuggestion(
    body.acceptedChangeSuggestion || body.accepted_change_suggestion,
    { action, params: body }
  );
  if (action === "collectNow") {
    const runtime = runtimeState();
    if (runtime.inFlight) {
      return {
        ok: true,
        action,
        outputKind: "scheduler",
        outputText: "이미 월드 메모리 수집이 실행 중입니다.",
        status: await buildWorldMemoryStatus(),
      };
    }
    void executeWorldMemoryCycle({ trigger: "manual", scheduledAt: nowIso(), attempt: 1 });
    return {
      ok: true,
      action,
      outputKind: "scheduler",
      outputText: "월드 메모리 수동 수집을 시작했습니다.",
      status: await buildWorldMemoryStatus(),
    };
  }
  if (action === "pause") {
    const state = pauseWorldMemoryCollection();
    return {
      ok: true,
      action,
      outputKind: "scheduler",
      outputText: `다음 수집을 ${state.schedule.pausedUntil}까지 연기했습니다.`,
      status: await buildWorldMemoryStatus(),
    };
  }
  if (action === "refreshReport" || action === "report") {
    const result = await refreshWorldMemoryReportSnapshot({
      sourceAction: String(body.sourceAction || body.source_action || "").trim(),
      reason: String(body.reason || "").trim() || (action === "report" ? "manual-report-action" : ""),
      acceptedChangeSuggestion,
    });
    if (result.ok && acceptedChangeSuggestion) {
      const suggestionStatus = worldMemorySuggestionStatusForAction(acceptedChangeSuggestion.action || action);
      updateCollectorState((state) => rememberChangeSuggestionStatus(state, acceptedChangeSuggestion, suggestionStatus));
    }
    return result;
  }
  const result = await runCommandFromBody(body);
  if (result.ok && acceptedChangeSuggestion) {
    const suggestionStatus = worldMemorySuggestionStatusForAction(acceptedChangeSuggestion.action || action);
    updateCollectorState((state) => rememberChangeSuggestionStatus(state, acceptedChangeSuggestion, suggestionStatus));
  }
  return result;
}

export async function handleWorldMemoryEndpoint(kind, req, res) {
  if (kind === "settings") {
    try {
      if (req.method === "GET") {
        sendJson(res, publicWorldMemorySettingsSnapshot());
        return;
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = await readJsonBody(req);
        const settings = writeWorldMemorySettingsPatch(body);
        if (settings.enabled) {
          startWorldMemoryCollector();
        } else {
          stopWorldMemoryCollector();
          disableMagazineSettings("world-memory-disabled");
          stopMagazineScheduler();
        }
        sendJson(res, publicWorldMemorySettingsSnapshot());
        return;
      }

      sendJson(res, { ok: false, error: "method not allowed" }, 405);
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 500);
    }
    return;
  }

  if (kind === "status") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      sendJson(
        res,
        url.searchParams.get("mode") === "summary"
          ? buildWorldMemorySummaryStatus()
          : await buildWorldMemoryStatus()
      );
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 500);
    }
    return;
  }

  if (kind === "action") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req);
      const result = await runWorldMemoryAction(body);
      sendJson(res, result, result.ok ? 200 : 422);
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 500);
    }
    return;
  }

  sendJson(res, { ok: false, error: "unknown world memory endpoint" }, 404);
}
