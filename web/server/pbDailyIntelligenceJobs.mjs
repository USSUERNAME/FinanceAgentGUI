import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readJsonBody, sendJson } from "./codexProbe.mjs";
import { loadPbDailyIntelligenceSnapshot } from "./pbDailyIntelligenceApi.mjs";
import { syncInvestmentThesisMemory } from "./pbInvestmentThesisMemory.mjs";

const PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_LOG_LINES = 80;
const MAX_LOG_LINE_LENGTH = 500;
const SERVER_DIR = fileURLToPath(new URL(".", import.meta.url));
const APP_ROOT = resolve(SERVER_DIR, "../..");
const DEFAULT_REMOTE_RUNNER = join(APP_ROOT, "scripts", "pb-remote-runner.mjs");
const DEFAULT_REMOTE_USER_CONFIG = join(
  APP_ROOT,
  "config",
  "pb-daily-intelligence.remote.user.json"
);

const JOB_CATALOG = Object.freeze({
  telegram_refresh: Object.freeze({
    id: "telegram_refresh",
    label: "텔레그램 지금 수집",
    description: "등록된 텔레그램 채널을 수집하고 중복 사건을 다시 묶습니다.",
    script: "refresh_telegram_intelligence.py",
    args: [],
    effect: "텔레그램 후보·중복 제거·사건 클러스터 로컬 갱신",
    publish: false,
  }),
  telegram_analyze: Object.freeze({
    id: "telegram_analyze",
    label: "Telegram 승인 PDF 수집·분석",
    description:
      "승인된 공식 증권사 채널 PDF를 수집하고 구조화 분석한 뒤 로컬 결과를 갱신합니다.",
    script: "run_daily_report.py",
    args: ["--verification-dry-run"],
    effect: "승인 Telegram PDF 다운로드·OCR·구조화 분석 · 외부 발행 없음",
    publish: false,
    syncTheses: true,
    remoteMode: "verification_dry_run",
  }),
  gmail_refresh: Object.freeze({
    id: "gmail_refresh",
    label: "Gmail 리서치 지금 수집",
    description: "Stocks 라벨의 허용된 공식 리서치 메일만 읽기 전용으로 수집합니다.",
    script: "collect_all.py",
    args: ["--sources", "gmail_research", "--source-timeout-seconds", "90"],
    effect: "Gmail Stocks 라벨 후보와 수집 상태 로컬 갱신",
    publish: false,
  }),
  gmail_analyze: Object.freeze({
    id: "gmail_analyze",
    label: "Gmail 수집·분석",
    description:
      "Gmail과 Drive의 승인된 리서치만 수집해 분석하고 기존 분석 캐시를 재사용합니다.",
    script: "run_research_inbox_analysis.py",
    args: [],
    effect: "Gmail·Drive 리서치 요약·핵심 주장·촉매·위험 갱신 · 외부 발행 없음",
    publish: false,
    syncTheses: true,
    remoteMode: "verification_dry_run",
  }),
  collect: Object.freeze({
    id: "collect",
    label: "후보 데이터 수집",
    description: "활성화된 공식 API와 승인된 후보 소스에서 데이터를 수집합니다.",
    script: "collect_all.py",
    args: [],
    effect: "외부 데이터 요청과 로컬 inbox 갱신",
    publish: false,
  }),
  dry_run: Object.freeze({
    id: "dry_run",
    label: "드라이런 생성·검증",
    description: "전체 일일 파이프라인을 실행하지만 Notion·Telegram에는 발행하지 않습니다.",
    script: "run_daily_report.py",
    args: ["--dry-run"],
    effect: "로컬 산출물 생성·검증, 외부 발행 없음",
    publish: false,
    syncTheses: true,
    remoteMode: "dry_run",
  }),
  verification_dry_run: Object.freeze({
    id: "verification_dry_run",
    label: "공식 근거 검증 실행",
    description:
      "승인된 애널리스트 PDF를 최대 25건까지 5건 단위로 구조화 분석하고 공식 원문을 확인하되 Notion·Telegram에는 발행하지 않습니다.",
    script: "run_daily_report.py",
    args: ["--verification-dry-run"],
    effect: "공식 근거·사건 분석 산출물 갱신 · 외부 발행 없음",
    publish: false,
    syncTheses: true,
    remoteMode: "verification_dry_run",
  }),
  publish: Object.freeze({
    id: "publish",
    label: "실제 리포트 발행",
    description: "전체 일일 파이프라인을 실행하고 구성된 Notion·Telegram 대상으로 발행합니다.",
    script: "run_daily_report.py",
    args: [],
    effect: "로컬 산출물 갱신 및 구성된 외부 발행 대상 변경",
    publish: true,
    syncTheses: true,
    remoteMode: "publish",
  }),
});

function cleanText(value, maxLength = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function redactLogLine(value) {
  return cleanText(value, MAX_LOG_LINE_LENGTH)
    .replace(/\b(sk|gho|ghp|github_pat|xox[baprs])-[-A-Za-z0-9_]{8,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [REDACTED]")
    .replace(
      /\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|ACCESS_?KEY)[A-Z0-9_]*)\s*=\s*\S+/gi,
      "$1=[REDACTED]"
    );
}

function configuredEngine(env = process.env) {
  const rawRoot = cleanText(env.PB_DAILY_INTELLIGENCE_ENGINE_DIR || "", 4000);
  const rawPython = cleanText(
    env.PB_DAILY_INTELLIGENCE_PYTHON || env.FINANCE_AGENT_GUI_PYTHON || env.PYTHON || "",
    4000
  );
  if (!rawRoot) {
    return {
      configured: false,
      available: false,
      reason: "PB_DAILY_INTELLIGENCE_ENGINE_DIR가 설정되지 않았습니다.",
      root: "",
      python: rawPython || "python",
    };
  }
  const root = isAbsolute(rawRoot) ? resolve(rawRoot) : resolve(process.cwd(), rawRoot);
  const python = rawPython || (process.platform === "win32" ? "python" : "python3");
  const missingScripts = [...new Set(Object.values(JOB_CATALOG).map((item) => item.script))]
    .filter((script) => !existsSync(join(root, script)));
  return {
    configured: true,
    available: missingScripts.length === 0,
    reason: missingScripts.length
      ? `필수 실행 파일 누락: ${missingScripts.join(", ")}`
      : "",
    root,
    python,
  };
}

function loadRemoteUserConfig(configPath = DEFAULT_REMOTE_USER_CONFIG) {
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return { configError: `원격 PB 설정 파일 오류: ${cleanText(error.message || error, 300)}` };
  }
}

function configuredRemote(
  env = process.env,
  userConfig = loadRemoteUserConfig(),
  runnerPath = DEFAULT_REMOTE_RUNNER
) {
  const enabled = userConfig.enabled === true
    || /^(1|true|yes|on)$/i.test(cleanText(env.PB_DAILY_INTELLIGENCE_REMOTE_ENABLED, 20));
  const repository = cleanText(
    env.PB_DAILY_INTELLIGENCE_REMOTE_REPO || userConfig.repository || "",
    200
  );
  const workflow = cleanText(
    env.PB_DAILY_INTELLIGENCE_REMOTE_WORKFLOW || userConfig.workflow || "daily-brief.yml",
    160
  );
  const ref = cleanText(env.PB_DAILY_INTELLIGENCE_REMOTE_REF || userConfig.ref || "main", 200);
  const rawWorkspace = cleanText(
    env.PB_DAILY_INTELLIGENCE_DIR || userConfig.workspace || "",
    4000
  );
  const workspace = rawWorkspace
    ? (isAbsolute(rawWorkspace) ? resolve(rawWorkspace) : resolve(process.cwd(), rawWorkspace))
    : "";
  const configuredGh = cleanText(
    env.PB_DAILY_INTELLIGENCE_GH || userConfig.ghPath || "",
    4000
  );
  const windowsGh = "C:\\Program Files\\GitHub CLI\\gh.exe";
  const ghPath = configuredGh || (process.platform === "win32" && existsSync(windowsGh) ? windowsGh : "gh");
  const structuralErrors = [
    userConfig.configError || "",
    !repository ? "원격 PB 저장소가 설정되지 않았습니다." : "",
    repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
      ? "원격 PB 저장소는 owner/name 형식이어야 합니다."
      : "",
    !/^[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow) ? "원격 workflow 파일명이 올바르지 않습니다." : "",
    !workspace ? "PB_DAILY_INTELLIGENCE_DIR 또는 원격 동기화 workspace가 필요합니다." : "",
    !existsSync(runnerPath) ? "PB 원격 실행 helper가 없습니다." : "",
    isAbsolute(ghPath) && !existsSync(ghPath) ? `GitHub CLI를 찾을 수 없습니다: ${ghPath}` : "",
  ].filter(Boolean);
  return {
    enabled,
    configured: enabled && Boolean(repository),
    available: enabled && structuralErrors.length === 0,
    reason: enabled ? structuralErrors[0] || "" : "",
    repository,
    workflow,
    ref,
    workspace,
    ghPath,
    runnerPath,
  };
}

function combinedConfiguration(env, userConfig, runnerPath) {
  return {
    local: configuredEngine(env),
    remote: configuredRemote(env, userConfig, runnerPath),
  };
}

function publicJob(item, config = null) {
  const remote = Boolean(item.remoteMode && config?.remote?.enabled);
  return {
    id: item.id,
    label: item.label,
    description: remote
      ? `${item.description} GitHub Actions의 저장소 Secrets를 사용합니다.`
      : item.description,
    effect: remote
      ? `${item.effect} · 완료 artifact를 로컬 작업공간에 자동 동기화`
      : item.effect,
    publish: item.publish,
    requiresConfirmation: true,
    executionMode: remote ? "github_actions" : "local",
  };
}

function emptyRun() {
  return {
    id: "",
    jobId: "",
    label: "",
    status: "idle",
    startedAt: "",
    finishedAt: "",
    exitCode: null,
    message: "",
    errorSummary: "",
    logTail: [],
    thesisSync: {
      status: "idle",
      reportDate: "",
      candidateCount: 0,
      createdCount: 0,
      transitionCount: 0,
      message: "",
    },
  };
}

async function syncLatestInvestmentTheses({ env }) {
  if (!cleanText(env.PB_DAILY_INTELLIGENCE_DIR, 4000)) {
    return {
      status: "skipped",
      message: "PB_DAILY_INTELLIGENCE_DIR가 없어 가설 자동 반영을 건너뛰었습니다.",
    };
  }
  const snapshot = await loadPbDailyIntelligenceSnapshot({ env });
  if (!snapshot.connection?.available || !snapshot.report?.reportDate) {
    return {
      status: "skipped",
      message: "완성된 Daily Intelligence를 찾지 못해 가설 자동 반영을 건너뛰었습니다.",
    };
  }
  if (snapshot.decisionChain?.status === "blocked") {
    return {
      status: "skipped",
      reportDate: snapshot.report.reportDate,
      message: "판단 근거 게이트가 차단되어 가설 자동 반영을 건너뛰었습니다.",
    };
  }
  const memory = await syncInvestmentThesisMemory({
    decisionChain: snapshot.decisionChain,
    reportDate: snapshot.report.reportDate,
    env,
  });
  return {
    status: "succeeded",
    reportDate: snapshot.report.reportDate,
    candidateCount: memory.candidateCount,
    createdCount: memory.createdCount,
    transitionCount: memory.transitionCount,
    message: `가설 ${memory.candidateCount}개를 World Memory에 반영했습니다.`,
  };
}

function publicConnection(config) {
  if (config.remote.enabled) {
    return {
      configured: config.remote.configured,
      available: config.remote.available,
      reason: config.remote.reason,
      engineLabel: config.remote.repository,
      executionMode: "github_actions",
      repository: config.remote.repository,
      workflow: config.remote.workflow,
      ref: config.remote.ref,
    };
  }
  return {
    configured: config.local.configured,
    available: config.local.available,
    reason: config.local.reason,
    engineLabel: config.local.root ? basename(config.local.root) : "",
    executionMode: "local",
  };
}

function safeScriptPath(root, script) {
  const scriptPath = resolve(root, script);
  const rootPrefix = `${resolve(root)}${sep}`;
  if (!scriptPath.startsWith(rootPrefix)) {
    throw new Error("허용되지 않은 PB 파이프라인 실행 경로입니다.");
  }
  return scriptPath;
}

export function createPbDailyIntelligenceJobService({
  env = process.env,
  now = () => Date.now(),
  uuid = () => randomUUID(),
  spawnImpl = spawn,
  syncThesesImpl = syncLatestInvestmentTheses,
  remoteUserConfig = {},
  remoteRunnerPath = DEFAULT_REMOTE_RUNNER,
} = {}) {
  let config = combinedConfiguration(
    env,
    remoteUserConfig === null ? loadRemoteUserConfig() : remoteUserConfig,
    remoteRunnerPath
  );
  let run = emptyRun();
  let child = null;
  const plans = new Map();

  function refreshConfig() {
    config = combinedConfiguration(
      env,
      remoteUserConfig === null ? loadRemoteUserConfig() : remoteUserConfig,
      remoteRunnerPath
    );
    return config;
  }

  function prunePlans() {
    const timestamp = now();
    for (const [token, plan] of plans.entries()) {
      if (plan.expiresAtMs <= timestamp) plans.delete(token);
    }
  }

  function status() {
    prunePlans();
    refreshConfig();
    return {
      connection: publicConnection(config),
      jobs: Object.values(JOB_CATALOG).map((job) => publicJob(job, config)),
      run: { ...run, logTail: [...run.logTail] },
    };
  }

  function plan(jobId) {
    prunePlans();
    refreshConfig();
    if (run.status === "running") {
      throw new Error("이미 PB 파이프라인 작업이 실행 중입니다.");
    }
    const job = JOB_CATALOG[jobId];
    if (!job) throw new Error("허용되지 않은 PB 파이프라인 작업입니다.");
    const useRemote = Boolean(job.remoteMode && config.remote.enabled);
    if (useRemote && !config.remote.available) {
      throw new Error(config.remote.reason || "GitHub Actions 원격 실행 연결이 준비되지 않았습니다.");
    }
    if (!useRemote && !config.local.available) {
      throw new Error(config.local.reason || "PB 파이프라인 실행 연결이 준비되지 않았습니다.");
    }
    const scriptPath = useRemote ? config.remote.runnerPath : safeScriptPath(config.local.root, job.script);
    if (!existsSync(scriptPath)) {
      throw new Error(useRemote ? "PB 원격 실행 helper가 없습니다." : `필수 실행 파일 누락: ${job.script}`);
    }
    const token = uuid();
    const requestId = useRemote
      ? `finance-agent-${cleanText(uuid(), 80).replace(/[^A-Za-z0-9_-]/g, "-")}`
      : "";
    const expiresAtMs = now() + PLAN_TTL_MS;
    const planRecord = {
      token,
      jobId: job.id,
      scriptPath,
      expiresAtMs,
      executionMode: useRemote ? "github_actions" : "local",
      requestId,
    };
    plans.set(token, planRecord);
    return {
      token,
      job: publicJob(job, config),
      commandPreview: useRemote
        ? `gh workflow run ${config.remote.workflow} -R ${config.remote.repository} -f run_mode=${job.remoteMode}`
        : `${basename(config.local.python)} ${job.script}${job.args.length ? ` ${job.args.join(" ")}` : ""}`,
      target: useRemote
        ? job.publish
          ? "GitHub Actions의 구성된 Notion·Telegram 발행 대상 + 로컬 artifact 동기화"
          : "GitHub Actions 원격 검증 + 로컬 PB 리포트 작업공간 동기화"
        : job.publish
          ? "구성된 Notion·Telegram 발행 대상"
          : "로컬 PB 리포트 작업공간",
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  function appendLogs(chunk) {
    const nextLines = String(chunk || "")
      .split(/\r?\n/)
      .map(redactLogLine)
      .filter(Boolean);
    if (!nextLines.length) return;
    const detectedError = [...nextLines].reverse().find((line) => (
      /OpenAI returned HTTP|timed out|Remote PB run failed|GitHub Actions run .*finished|Artifact download failed|(?:^|\s)(?:Error|Exception):|No such file|not found/i
        .test(line)
    ));
    run = {
      ...run,
      logTail: [...run.logTail, ...nextLines].slice(-MAX_LOG_LINES),
      message: nextLines[nextLines.length - 1],
      errorSummary: detectedError || run.errorSummary,
    };
  }

  function execute(token) {
    prunePlans();
    refreshConfig();
    if (run.status === "running" || child) {
      throw new Error("이미 PB 파이프라인 작업이 실행 중입니다.");
    }
    const planRecord = plans.get(cleanText(token, 200));
    if (!planRecord) throw new Error("확인 계획이 만료됐거나 유효하지 않습니다.");
    plans.delete(planRecord.token);
    const job = JOB_CATALOG[planRecord.jobId];
    if (!job) throw new Error("허용되지 않은 PB 파이프라인 작업입니다.");
    const useRemote = planRecord.executionMode === "github_actions";
    if (useRemote && !config.remote.available) {
      throw new Error(config.remote.reason || "GitHub Actions 원격 실행 연결이 준비되지 않았습니다.");
    }
    if (!useRemote && !config.local.available) {
      throw new Error(config.local.reason || "PB 파이프라인 실행 연결이 준비되지 않았습니다.");
    }
    const startedAt = new Date(now()).toISOString();
    run = {
      ...emptyRun(),
      id: uuid(),
      jobId: job.id,
      label: job.label,
      status: "running",
      startedAt,
      message: useRemote
        ? "GitHub Actions 작업을 요청하고 있습니다. 완료 후 artifact를 자동 동기화합니다."
        : "작업을 시작했습니다.",
    };
    try {
      const command = useRemote ? process.execPath : config.local.python;
      const commandArgs = useRemote
        ? [
            planRecord.scriptPath,
            "--repo", config.remote.repository,
            "--workflow", config.remote.workflow,
            "--ref", config.remote.ref,
            "--run-mode", job.remoteMode,
            "--request-id", planRecord.requestId,
            "--workspace", config.remote.workspace,
            "--gh", config.remote.ghPath,
            ...(job.id === "telegram_analyze"
              ? [
                  "--telegram-approvals",
                  join(
                    config.remote.workspace,
                    "telegram_research_approvals",
                    "attachments.json",
                  ),
                ]
              : []),
          ]
        : [planRecord.scriptPath, ...job.args];
      child = spawnImpl(command, commandArgs, {
        cwd: useRemote ? APP_ROOT : config.local.root,
        env: {
          ...env,
          COLLECTOR_TIMEOUT_AUTHORIZED_REPORT_DROP_SECONDS:
            env.COLLECTOR_TIMEOUT_AUTHORIZED_REPORT_DROP_SECONDS || "300",
          COLLECTOR_TIMEOUT_GOOGLE_DRIVE_RESEARCH_INBOX_SECONDS:
            env.COLLECTOR_TIMEOUT_GOOGLE_DRIVE_RESEARCH_INBOX_SECONDS || "300",
          OPENAI_BROKER_RESEARCH_MAX_REPORTS:
            env.OPENAI_BROKER_RESEARCH_MAX_REPORTS || "25",
        },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      child = null;
      run = {
        ...run,
        status: "failed",
        finishedAt: new Date(now()).toISOString(),
        message: cleanText(error.message || error, 500),
      };
      throw error;
    }
    child.stdout?.on("data", appendLogs);
    child.stderr?.on("data", appendLogs);
    child.on("error", (error) => {
      run = {
        ...run,
        status: "failed",
        finishedAt: new Date(now()).toISOString(),
        message: cleanText(error.message || error, 500),
      };
      child = null;
    });
    child.on("close", async (code) => {
      const succeeded = Number(code) === 0;
      const failureMessage = useRemote
        ? `${job.label} GitHub Actions 실행 또는 artifact 동기화가 실패했습니다.`
        : `${job.label} 작업이 종료 코드 ${code ?? "미확인"}로 실패했습니다.`;
      run = {
        ...run,
        status: succeeded && job.syncTheses ? "running" : succeeded ? "succeeded" : "failed",
        finishedAt: succeeded && job.syncTheses ? "" : new Date(now()).toISOString(),
        exitCode: Number.isInteger(code) ? Number(code) : null,
        message: succeeded
          ? job.syncTheses
            ? `${job.label} 작업이 완료되어 투자 가설을 자동 반영하고 있습니다.`
            : `${job.label} 작업이 완료됐습니다.`
          : run.errorSummary
            ? `${failureMessage} 원인: ${run.errorSummary}`
            : failureMessage,
      };
      child = null;
      if (!succeeded || !job.syncTheses) return;
      run = {
        ...run,
        thesisSync: {
          ...run.thesisSync,
          status: "running",
          message: "최신 가설을 World Memory에 반영하고 있습니다.",
        },
      };
      try {
        const thesisSync = await syncThesesImpl({ env, jobId: job.id });
        run = {
          ...run,
          status: "succeeded",
          finishedAt: new Date(now()).toISOString(),
          thesisSync: {
            ...emptyRun().thesisSync,
            ...thesisSync,
          },
          message: thesisSync.status === "succeeded"
            ? `${job.label} 작업이 완료됐고 ${thesisSync.message}`
            : `${job.label} 작업이 완료됐습니다. ${thesisSync.message}`,
        };
      } catch (error) {
        run = {
          ...run,
          status: "succeeded",
          finishedAt: new Date(now()).toISOString(),
          thesisSync: {
            ...emptyRun().thesisSync,
            status: "failed",
            message: `가설 자동 반영 실패: ${cleanText(error.message || error, 400)}`,
          },
          message: `${job.label} 작업은 완료됐지만 가설 자동 반영에 실패했습니다.`,
        };
      }
    });
    return { ...run, logTail: [...run.logTail] };
  }

  return {
    status,
    plan,
    execute,
  };
}

export const pbDailyIntelligenceJobService = createPbDailyIntelligenceJobService({
  remoteUserConfig: null,
});

export async function handlePbDailyIntelligenceJobsEndpoint(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, { ok: true, ...pbDailyIntelligenceJobService.status() });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const payload = await readJsonBody(req);
    if (payload?.action === "plan") {
      sendJson(res, {
        ok: true,
        plan: pbDailyIntelligenceJobService.plan(payload.jobId),
        ...pbDailyIntelligenceJobService.status(),
      });
      return;
    }
    if (payload?.action === "execute") {
      sendJson(res, {
        ok: true,
        run: pbDailyIntelligenceJobService.execute(payload.token),
        ...pbDailyIntelligenceJobService.status(),
      });
      return;
    }
    sendJson(res, { ok: false, error: "unsupported action" }, 400);
  } catch (error) {
    const statusCode = /이미 .*실행 중|만료|유효하지|허용되지/.test(String(error?.message || ""))
      ? 409
      : 500;
    sendJson(res, { ok: false, error: cleanText(error?.message || error, 500) }, statusCode);
  }
}
