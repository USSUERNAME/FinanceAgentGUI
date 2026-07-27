import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_LOG_LINES = 80;
const MAX_LOG_LINE_LENGTH = 500;

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
  }),
  publish: Object.freeze({
    id: "publish",
    label: "실제 리포트 발행",
    description: "전체 일일 파이프라인을 실행하고 구성된 Notion·Telegram 대상으로 발행합니다.",
    script: "run_daily_report.py",
    args: [],
    effect: "로컬 산출물 갱신 및 구성된 외부 발행 대상 변경",
    publish: true,
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

function publicJob(item) {
  return {
    id: item.id,
    label: item.label,
    description: item.description,
    effect: item.effect,
    publish: item.publish,
    requiresConfirmation: true,
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
    logTail: [],
  };
}

function publicConnection(config) {
  return {
    configured: config.configured,
    available: config.available,
    reason: config.reason,
    engineLabel: config.root ? basename(config.root) : "",
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
} = {}) {
  let config = configuredEngine(env);
  let run = emptyRun();
  let child = null;
  const plans = new Map();

  function refreshConfig() {
    config = configuredEngine(env);
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
      jobs: Object.values(JOB_CATALOG).map(publicJob),
      run: { ...run, logTail: [...run.logTail] },
    };
  }

  function plan(jobId) {
    prunePlans();
    refreshConfig();
    if (!config.available) {
      throw new Error(config.reason || "PB 파이프라인 실행 연결이 준비되지 않았습니다.");
    }
    if (run.status === "running") {
      throw new Error("이미 PB 파이프라인 작업이 실행 중입니다.");
    }
    const job = JOB_CATALOG[jobId];
    if (!job) throw new Error("허용되지 않은 PB 파이프라인 작업입니다.");
    const scriptPath = safeScriptPath(config.root, job.script);
    if (!existsSync(scriptPath)) throw new Error(`필수 실행 파일 누락: ${job.script}`);
    const token = uuid();
    const expiresAtMs = now() + PLAN_TTL_MS;
    const planRecord = {
      token,
      jobId: job.id,
      scriptPath,
      expiresAtMs,
    };
    plans.set(token, planRecord);
    return {
      token,
      job: publicJob(job),
      commandPreview: `${basename(config.python)} ${job.script}${job.args.length ? ` ${job.args.join(" ")}` : ""}`,
      target: job.publish ? "구성된 Notion·Telegram 발행 대상" : "로컬 PB 리포트 작업공간",
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  function appendLogs(chunk) {
    const nextLines = String(chunk || "")
      .split(/\r?\n/)
      .map(redactLogLine)
      .filter(Boolean);
    if (!nextLines.length) return;
    run = {
      ...run,
      logTail: [...run.logTail, ...nextLines].slice(-MAX_LOG_LINES),
      message: nextLines[nextLines.length - 1],
    };
  }

  function execute(token) {
    prunePlans();
    refreshConfig();
    if (!config.available) {
      throw new Error(config.reason || "PB 파이프라인 실행 연결이 준비되지 않았습니다.");
    }
    if (run.status === "running" || child) {
      throw new Error("이미 PB 파이프라인 작업이 실행 중입니다.");
    }
    const planRecord = plans.get(cleanText(token, 200));
    if (!planRecord) throw new Error("확인 계획이 만료됐거나 유효하지 않습니다.");
    plans.delete(planRecord.token);
    const job = JOB_CATALOG[planRecord.jobId];
    if (!job) throw new Error("허용되지 않은 PB 파이프라인 작업입니다.");
    const startedAt = new Date(now()).toISOString();
    run = {
      ...emptyRun(),
      id: uuid(),
      jobId: job.id,
      label: job.label,
      status: "running",
      startedAt,
      message: "작업을 시작했습니다.",
    };
    try {
      child = spawnImpl(config.python, [planRecord.scriptPath, ...job.args], {
        cwd: config.root,
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
    child.on("close", (code) => {
      const succeeded = Number(code) === 0;
      run = {
        ...run,
        status: succeeded ? "succeeded" : "failed",
        finishedAt: new Date(now()).toISOString(),
        exitCode: Number.isInteger(code) ? Number(code) : null,
        message: succeeded
          ? `${job.label} 작업이 완료됐습니다.`
          : `${job.label} 작업이 종료 코드 ${code ?? "미확인"}로 실패했습니다.`,
      };
      child = null;
    });
    return { ...run, logTail: [...run.logTail] };
  }

  return {
    status,
    plan,
    execute,
  };
}

export const pbDailyIntelligenceJobService = createPbDailyIntelligenceJobService();

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
