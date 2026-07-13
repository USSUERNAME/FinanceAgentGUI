import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonBody, sendJson } from "./codexProbe.mjs";
import { writeGeneratedReportFile } from "./reportsApi.mjs";
import {
  buildMarketSummaryWithTranslationModel,
  chooseSharedMemoryTranslationModel,
  runAntigravityJsonModel,
  runCodexJsonModel,
} from "./sharedMemoryStore.mjs";
import { acquireRuntimeFileLease } from "./runtimeFileLease.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const NOTIFICATION_DIR = resolve(
  process.env.FINANCE_AGENT_GUI_NOTIFICATION_DIR || join(GUIBUILD_ROOT, "data", "notifications"),
);
const NOTIFICATION_STORE_PATH = join(NOTIFICATION_DIR, "stock-channel-notifications.json");
const NOTIFICATION_STORE_LOCK_PATH = join(NOTIFICATION_DIR, "stock-channel-notifications.lock");
const MARKET_SUMMARY_EMERGENCY_LOCK_PATH = join(NOTIFICATION_DIR, "market-summary-emergency.lock");
const EXTERNAL_MEMORY_BRIEFING_PATH = join(GUIBUILD_ROOT, "data", "shared-memory", "external_memory_briefing.md");
const APP_NAME = "주식채널+";
const MAX_RECORDS = 80;
const MAX_SUMMARY_LENGTH = 160;
const MAX_REPORT_INPUT_LENGTH = 5200;
const MAX_SCENARIO_ITEM_COUNT = 24;
const EMERGENCY_REPORT_MODEL_TIMEOUT_MS = 60 * 1000;
const REPORT_ALERT_LEVELS = new Set(["urgent", "critical"]);
const DETECTION_ALERT_LEVELS = new Set(["none", "watch", "urgent", "critical"]);
const REPORT_ALERT_LEVEL_RANK = {
  urgent: 1,
  critical: 2,
};
const MARKET_SUMMARY_EMERGENCY_SOURCE = "market-summary-emergency-procedure";
const marketSummaryEmergencyInFlightKeys = new Set();
const URGENT_REPORT_UNCERTAINTY_NOTICE =
  "이 알림은 부정확할 수 있으며 현재 벌어지고 있는 사안에 대한 자세하고 정확한 정보 습득은 주식채널+의 정식 채팅 기능이나 다른 수단을 이용해야 할 수 있다.";

function defaultStore() {
  return {
    version: 1,
    records: [],
    readState: {
      reportsOpenedAt: "",
    },
    emergencyProcedures: {
      marketSummary: {
        lastRunKey: "",
        lastRunAt: "",
        lastReportId: "",
        lastNotificationId: "",
        activeAlertLevel: "",
        activeStartedAt: "",
        lastResolvedAt: "",
        lastError: "",
      },
    },
  };
}

function ensureNotificationDir() {
  mkdirSync(NOTIFICATION_DIR, { recursive: true });
}

function readStore() {
  ensureNotificationDir();
  if (!existsSync(NOTIFICATION_STORE_PATH)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(NOTIFICATION_STORE_PATH, "utf8"));
    return {
      ...defaultStore(),
      ...parsed,
      records: Array.isArray(parsed?.records) ? parsed.records : [],
      readState: {
        ...defaultStore().readState,
        ...(parsed?.readState && typeof parsed.readState === "object" ? parsed.readState : {}),
      },
      emergencyProcedures: {
        ...defaultStore().emergencyProcedures,
        ...(parsed?.emergencyProcedures && typeof parsed.emergencyProcedures === "object" ? parsed.emergencyProcedures : {}),
        marketSummary: {
          ...defaultStore().emergencyProcedures.marketSummary,
          ...(parsed?.emergencyProcedures?.marketSummary && typeof parsed.emergencyProcedures.marketSummary === "object"
            ? parsed.emergencyProcedures.marketSummary
            : {}),
        },
      },
    };
  } catch {
    return defaultStore();
  }
}

function writeStore(store) {
  ensureNotificationDir();
  const temporaryPath = `${NOTIFICATION_STORE_PATH}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, NOTIFICATION_STORE_PATH);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function waitBriefly(milliseconds = 5) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function mutateStore(mutator) {
  const deadline = Date.now() + 2_000;
  let lease = null;
  while (Date.now() < deadline) {
    lease = acquireRuntimeFileLease(NOTIFICATION_STORE_LOCK_PATH, { staleAfterMs: 30_000 });
    if (lease.acquired) break;
    waitBriefly();
  }
  if (!lease?.acquired) throw new Error("notification store is busy");
  try {
    const currentStore = readStore();
    const nextStore = mutator(currentStore);
    writeStore(nextStore);
    return nextStore;
  } finally {
    lease.release();
  }
}

function cleanText(value, maxLength = MAX_SUMMARY_LENGTH) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function formatKstDateMinute(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.hour}시 ${parts.minute}분`;
  } catch {
    return date.toISOString();
  }
}

function notificationIdFor(record) {
  const basis = [record.createdAt, record.level, record.summary, record.source].join("\n");
  return `stock_alert_${hashText(basis).slice(0, 16)}`;
}

function hashText(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  if (level === "critical") return "critical";
  if (level === "urgent") return "urgent";
  if (level === "watch") return "watch";
  return "info";
}

function normalizeDetectionLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return DETECTION_ALERT_LEVELS.has(level) ? level : "none";
}

function reportAlertRank(value) {
  return REPORT_ALERT_LEVEL_RANK[normalizeDetectionLevel(value)] || 0;
}

function browserNotificationDelivery() {
  return {
    ok: true,
    channel: "browser",
    reason: "Stored for delivery by the open FinanceAgentGUI browser tab.",
    requiresOpenPage: true,
    requiresPermission: true,
    iconSupported: true,
    iconPath: "/favicon.svg",
    clickTarget: "reports",
    deliveredBy: "client",
  };
}

function activeReportsAlert(store) {
  const reportsOpenedMs = new Date(store.readState?.reportsOpenedAt || 0).getTime();
  const latest = [...store.records]
    .reverse()
    .find((record) => REPORT_ALERT_LEVELS.has(record.level));
  if (!latest) {
    return {
      showBadge: false,
      label: "긴급 업데이트",
      summary: "",
      level: "",
      createdAt: "",
      id: "",
    };
  }
  const latestMs = new Date(latest.createdAt || 0).getTime();
  return {
    showBadge: !Number.isFinite(reportsOpenedMs) || latestMs > reportsOpenedMs,
    label: "긴급 업데이트",
    summary: latest.summary,
    level: latest.level,
    createdAt: latest.createdAt,
    id: latest.id,
  };
}

function readExternalMarketBriefing(payload = {}) {
  const provided = cleanText(payload.contextSummary || payload.marketSummary || payload.briefing || "", MAX_REPORT_INPUT_LENGTH);
  if (provided) return provided;
  if (!existsSync(EXTERNAL_MEMORY_BRIEFING_PATH)) return "";
  return cleanText(readFileSync(EXTERNAL_MEMORY_BRIEFING_PATH, "utf8"), MAX_REPORT_INPUT_LENGTH);
}

function fastReportSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      severity: { type: "string", enum: ["urgent", "critical"] },
      reportTitle: { type: "string" },
      marketImpactSummary: { type: "string" },
      knownFacts: {
        type: "array",
        items: { type: "string" },
      },
      pushSummary: { type: "string" },
    },
    required: ["severity", "reportTitle", "marketImpactSummary", "knownFacts", "pushSummary"],
  };
}

function fastReportPrompt({ contextSummary, requestedLevel = "urgent", generatedAt = new Date().toISOString() } = {}) {
  return [
    "너는 FinanceAgentGUI의 긴급 시장 업데이트를 작성하는 번역/요약 모델이다.",
    "입력은 이미 컨텍스트 윈도우에 올리기 위해 생성된 '월드메모리 이후 시장 요약'이다.",
    "웹검색을 하지 않는다. 원 뉴스피드 목록을 다시 열람하지 않는다. 입력 요약에 없는 사실을 추가하지 않는다.",
    "보고서는 빠른 초안이다. 고정 주의문은 서버가 붙이므로 모델 출력에는 주의문을 쓰지 않는다.",
    "투자 조언, 매수/매도 지시, 확정적 예언을 쓰지 않는다.",
    "작성 방식, 모델명, 입력 요약, 근거 원문, 내부 처리 설명은 출력하지 않는다.",
    "출력은 JSON 객체 하나만 반환한다.",
    "",
    "작성 목표:",
    "- 어떤 일이 일어난 것으로 보이고, 이것이 시장에 어떤 영향을 줄 수 있는지 짧게 쓴다.",
    "- 현재까지 알려진 사실을 2-5개 bullet로 만든다.",
    "- pushSummary는 보고서 본문을 다시 한 줄로 압축한 한국어 문장이다. 90자 이내.",
    "",
    "반환 형식:",
    JSON.stringify({
      severity: "urgent",
      reportTitle: "긴급 시장 업데이트: 제목",
      marketImpactSummary: "어떤 일이 일어난 것으로 보이고, 이는 시장에 어떤 영향을 줄 수 있다.",
      knownFacts: ["현재까지 알려진 사실"],
      pushSummary: "한 줄 요약",
    }),
    "",
    "입력:",
    JSON.stringify(
      {
        generatedAt,
        requestedLevel,
        sourcePolicy: "context-summary-only; no web search; no raw feed scan",
        contextSummary,
      },
      null,
      2
    ),
  ].join("\n");
}

function cleanTextList(value, { limit = 5, maxLength = 260 } = {}) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeFastReportCandidate(payload = {}) {
  const severity = normalizeLevel(payload.severity || "urgent");
  const safeSeverity = REPORT_ALERT_LEVELS.has(severity) ? severity : "urgent";
  const reportTitle = cleanText(payload.reportTitle || "긴급 시장 업데이트", 120);
  const marketImpactSummary = cleanText(payload.marketImpactSummary || "", 900);
  const knownFacts = cleanTextList(payload.knownFacts, { limit: 5, maxLength: 320 });
  const pushSummary = cleanText(payload.pushSummary || marketImpactSummary, 110);
  const issues = [];
  if (!marketImpactSummary) issues.push("marketImpactSummary is required");
  if (!knownFacts.length) issues.push("knownFacts must include at least one item");
  if (!pushSummary) issues.push("pushSummary is required");
  return {
    ok: issues.length === 0,
    severity: safeSeverity,
    reportTitle,
    marketImpactSummary,
    knownFacts,
    pushSummary,
    error: issues.join(", "),
  };
}

function parseAlertLevelFromText(value = "") {
  const match = String(value || "").match(/(?:등급|심각도)\s*:\s*(none|watch|urgent|critical)\b/i);
  return normalizeDetectionLevel(match?.[1] || "");
}

function parseSeverityFromText(value = "") {
  const match = String(value || "").match(/^판단:\s*(.+)$/m);
  return cleanText(match?.[1] || "", 600);
}

function normalizeMarketSummaryDetection(payload = {}) {
  const text = payload.text || payload.contextSummary || payload.marketSummary || "";
  const alertLevel = normalizeDetectionLevel(payload.alertLevel || payload.level || parseAlertLevelFromText(text));
  const shouldCreateReport = REPORT_ALERT_LEVELS.has(alertLevel);
  const rationaleKo =
    cleanText(payload.rationaleKo || payload.severityKo || payload.rationale || parseSeverityFromText(text), 600) ||
    (shouldCreateReport ? "시장 요약에서 긴급 절차 실행 대상 심각도가 확인되었습니다." : "긴급 절차 실행 대상은 아닙니다.");
  const signals = cleanTextList(payload.signals, { limit: 6, maxLength: 240 });
  return {
    ok: true,
    alertLevel,
    shouldCreateReport,
    rationaleKo,
    signals: signals.length ? signals : [rationaleKo],
    error: "",
  };
}

function renderFastReportMarkdown(report, { generatedAt = new Date().toISOString() } = {}) {
  const factList = report.knownFacts.map((item) => `- ${item}`).join("\n");
  return [
    `# ${report.reportTitle}`,
    "",
    `생성 시각: ${formatKstDateMinute(generatedAt)}`,
    "",
    "## 시장 영향 가능성",
    "",
    report.marketImpactSummary,
    "",
    "## 현재까지 알려진 사실",
    "",
    factList,
    "",
    "## 주의",
    "",
    URGENT_REPORT_UNCERTAINTY_NOTICE,
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildFastEmergencyReport(payload = {}) {
  const contextSummary = readExternalMarketBriefing(payload);
  if (!contextSummary) {
    throw new Error("context market summary is empty");
  }
  const modelInfo = chooseSharedMemoryTranslationModel();
  const requestedLevel = normalizeLevel(payload.level || payload.severity || parseAlertLevelFromText(contextSummary) || "urgent");
  const generatedAt = new Date().toISOString();
  const prompt = fastReportPrompt({ contextSummary, requestedLevel, generatedAt });
  const raw =
    modelInfo.provider === "antigravity-cli"
      ? runAntigravityJsonModel(prompt, modelInfo, EMERGENCY_REPORT_MODEL_TIMEOUT_MS)
      : runCodexJsonModel(prompt, fastReportSchema(), modelInfo, EMERGENCY_REPORT_MODEL_TIMEOUT_MS);
  const candidate = normalizeFastReportCandidate(raw);
  if (!candidate.ok) throw new Error(`fast report validation failed: ${candidate.error}`);
  const report = {
    ...candidate,
    // Severity belongs to the already-evaluated market summary. The prose model
    // may not promote red to purple or demote purple while drafting the report.
    severity: REPORT_ALERT_LEVELS.has(requestedLevel) ? requestedLevel : "urgent",
  };
  const saved = await writeGeneratedReportFile({
    action: "save_report_artifact",
    title: report.reportTitle,
    slug: `urgent_market_update_${report.severity}`,
    content: renderFastReportMarkdown(report, { generatedAt }),
  });
  const pushed = await pushNotification({
    level: report.severity,
    source: cleanText(payload.source || "fast-emergency-report", 80),
    summary: report.pushSummary,
    reportId: saved.report?.id || "",
  });
  return {
    ok: true,
    generatedAt,
    mode: "context-summary-only",
    model: {
      provider: modelInfo.provider,
      providerLabel: modelInfo.providerLabel,
      model: modelInfo.model,
      modelLabel: modelInfo.modelLabel || modelInfo.model,
      reasoning: modelInfo.reasoning,
    },
    report,
    saved,
    notification: pushed.record,
    status: pushed.status,
  };
}

function normalizeScenarioNewsItems(value = []) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item, index) => ({
      id: cleanText(item?.id || `scenario-item-${index + 1}`, 160),
      publishedAt: cleanText(item?.publishedAt || item?.time || item?.createdAt || new Date().toISOString(), 60),
      fetchedAt: cleanText(item?.fetchedAt || "", 60),
      translatedAt: cleanText(item?.translatedAt || "", 60),
      feedId: cleanText(item?.feedId || item?.sourceId || "scenario-feed", 80),
      feedTitle: cleanText(item?.feedTitle || item?.source || "Scenario News Feed", 80),
      title: cleanText(item?.title || item?.translatedTitle || "", 220),
      translatedTitle: cleanText(item?.translatedTitle || item?.title || "", 220),
      originalText: cleanText(item?.originalText || item?.body || item?.summary || "", 900),
      translatedText: cleanText(item?.translatedText || item?.body || item?.summary || "", 900),
      sourceUrl: cleanText(item?.sourceUrl || item?.url || "", 300),
    }))
    .filter((item) => item.title || item.translatedTitle || item.originalText || item.translatedText)
    .slice(0, MAX_SCENARIO_ITEM_COUNT);
}

function marketSummaryEmergencyKey(marketSummary = {}, detection = {}) {
  const basis = [
    detection.alertLevel || "",
    marketSummary.basedOnWorldMemoryCollectionAt || "",
    marketSummary.newsItemsSummarized ?? marketSummary.newsItemsConsidered ?? "",
    marketSummary.text || marketSummary.contextSummary || marketSummary.marketSummary || "",
  ].join("\n");
  return `market_summary_${hashText(basis).slice(0, 24)}`;
}

function updateMarketSummaryProcedureState(nextState = {}) {
  const nextStore = mutateStore((store) => ({
    ...store,
    emergencyProcedures: {
      ...defaultStore().emergencyProcedures,
      ...(store.emergencyProcedures || {}),
      marketSummary: {
        ...defaultStore().emergencyProcedures.marketSummary,
        ...(store.emergencyProcedures?.marketSummary || {}),
        ...nextState,
      },
    },
  }));
  return nextStore.emergencyProcedures.marketSummary;
}

export async function runEmergencyProcedureForMarketSummary(
  marketSummary = {},
  {
    buildReport = buildFastEmergencyReport,
    emergencyLockPath = MARKET_SUMMARY_EMERGENCY_LOCK_PATH,
  } = {},
) {
  const contextSummary = cleanText(marketSummary.text || marketSummary.contextSummary || marketSummary.marketSummary || "", MAX_REPORT_INPUT_LENGTH);
  const detection = normalizeMarketSummaryDetection({
    ...marketSummary,
    text: contextSummary,
  });
  const key = marketSummaryEmergencyKey(marketSummary, detection);
  if (!contextSummary) {
    return { ok: true, skipped: true, reason: "empty-market-summary", key, detection };
  }
  const store = readStore();
  const procedure = store.emergencyProcedures?.marketSummary || defaultStore().emergencyProcedures.marketSummary;
  if (!detection.shouldCreateReport) {
    if (procedure.activeAlertLevel || procedure.activeStartedAt) {
      updateMarketSummaryProcedureState({
        activeAlertLevel: "",
        activeStartedAt: "",
        lastResolvedAt: new Date().toISOString(),
      });
    }
    return { ok: true, skipped: true, reason: "severity-not-reportable", key, detection };
  }

  const currentRank = reportAlertRank(detection.alertLevel);
  const coveredRank = reportAlertRank(procedure.activeAlertLevel);
  const isFirstReportableInEpisode = coveredRank === 0;
  const isSeverityEscalation = currentRank > coveredRank;
  if (!isFirstReportableInEpisode && !isSeverityEscalation) {
    return {
      ok: true,
      skipped: true,
      reason: "severity-already-covered",
      key,
      detection,
      activeAlertLevel: procedure.activeAlertLevel || "",
      reportId: procedure.lastReportId || "",
      notificationId: procedure.lastNotificationId || "",
    };
  }
  if (procedure.lastRunKey === key) {
    return {
      ok: true,
      skipped: true,
      reason: "already-ran-for-summary",
      key,
      detection,
      reportId: procedure.lastReportId || "",
      notificationId: procedure.lastNotificationId || "",
    };
  }
  if (marketSummaryEmergencyInFlightKeys.has(key)) {
    return {
      ok: true,
      skipped: true,
      reason: "already-running-for-summary",
      key,
      detection,
    };
  }

  const lease = acquireRuntimeFileLease(emergencyLockPath);
  if (!lease.acquired) {
    return {
      ok: true,
      skipped: true,
      reason: "already-running-market-summary-emergency",
      key,
      detection,
    };
  }

  marketSummaryEmergencyInFlightKeys.add(key);
  try {
    // The filesystem lease is shared by Vite reloads and worker threads. Re-read
    // after claiming it so only the winner can observe an uncovered episode.
    const lockedStore = readStore();
    const lockedProcedure =
      lockedStore.emergencyProcedures?.marketSummary || defaultStore().emergencyProcedures.marketSummary;
    const lockedCoveredRank = reportAlertRank(lockedProcedure.activeAlertLevel);
    if (lockedCoveredRank > 0 && currentRank <= lockedCoveredRank) {
      return {
        ok: true,
        skipped: true,
        reason: "severity-already-covered",
        key,
        detection,
        activeAlertLevel: lockedProcedure.activeAlertLevel || "",
        reportId: lockedProcedure.lastReportId || "",
        notificationId: lockedProcedure.lastNotificationId || "",
      };
    }
    if (lockedProcedure.lastRunKey === key) {
      return {
        ok: true,
        skipped: true,
        reason: "already-ran-for-summary",
        key,
        detection,
        reportId: lockedProcedure.lastReportId || "",
        notificationId: lockedProcedure.lastNotificationId || "",
      };
    }

    const result = await buildReport({
      contextSummary,
      level: detection.alertLevel,
      source: MARKET_SUMMARY_EMERGENCY_SOURCE,
    });
    const savedState = updateMarketSummaryProcedureState({
      lastRunKey: key,
      lastRunAt: result.generatedAt || new Date().toISOString(),
      lastReportId: result.saved?.report?.id || "",
      lastNotificationId: result.notification?.id || "",
      activeAlertLevel: detection.alertLevel,
      activeStartedAt: lockedProcedure.activeStartedAt || result.generatedAt || new Date().toISOString(),
      lastResolvedAt: "",
      lastError: "",
    });
    return {
      ok: true,
      skipped: false,
      reason: "emergency-procedure-ran",
      key,
      detection,
      reportId: savedState.lastReportId,
      notificationId: savedState.lastNotificationId,
      reportResult: result,
    };
  } catch (error) {
    updateMarketSummaryProcedureState({
      lastError: cleanText(error.message, 500),
    });
    return {
      ok: false,
      skipped: true,
      reason: "emergency-procedure-failed",
      key,
      detection,
      error: cleanText(error.message, 500),
    };
  } finally {
    marketSummaryEmergencyInFlightKeys.delete(key);
    lease.release();
  }
}

async function buildEmergencyScenarioEvaluation(payload = {}) {
  const generatedAt = new Date().toISOString();
  const builtAt = cleanText(payload.builtAt || generatedAt, 60);
  const items = normalizeScenarioNewsItems(payload.newsItems || payload.items || []);
  if (!items.length) throw new Error("scenario newsItems are empty");
  const worldReport =
    payload.worldReport && typeof payload.worldReport === "object"
      ? payload.worldReport
      : {
          generatedAt: cleanText(payload.worldMemoryGeneratedAt || "", 60),
          summary: cleanText(payload.worldMemorySummary || "기준 월드 메모리에는 해당 충격이 반영되어 있지 않다.", 1600),
        };
  const marketSummaryResult = buildMarketSummaryWithTranslationModel({
    worldReport,
    items,
    builtAt,
  });
  const detection = normalizeMarketSummaryDetection({
    ...marketSummaryResult,
    text: marketSummaryResult.text,
  });
  const shouldCreateReport = detection.shouldCreateReport && REPORT_ALERT_LEVELS.has(detection.alertLevel);
  const reportResult = shouldCreateReport
    ? await buildFastEmergencyReport({
        contextSummary: marketSummaryResult.text,
        level: detection.alertLevel,
        source: MARKET_SUMMARY_EMERGENCY_SOURCE,
      })
    : null;
  return {
    ok: true,
    generatedAt,
    mode: "scenario-newsfeed-summary-emergency-evaluation",
    scenario: {
      newsItems: items.length,
      builtAt,
    },
    marketSummary: marketSummaryResult,
    detection,
    action: {
      createdReport: Boolean(reportResult),
      notificationQueued: Boolean(reportResult?.notification),
      reportId: reportResult?.saved?.report?.id || "",
      notificationId: reportResult?.notification?.id || "",
    },
    reportResult,
  };
}

function publicSnapshot(store = readStore()) {
  return {
    ok: true,
    appName: APP_NAME,
    delivery: {
      channel: "browser",
      supported: true,
      requiresOpenPage: true,
      requiresPermission: true,
      iconSupported: true,
      iconPath: "/favicon.svg",
      clickTarget: "reports",
      platform: process.platform,
    },
    recordCount: store.records.length,
    latest: store.records[store.records.length - 1] || null,
    reportsUrgentUpdate: activeReportsAlert(store),
    readState: store.readState || defaultStore().readState,
    emergencyProcedures: store.emergencyProcedures || defaultStore().emergencyProcedures,
  };
}

async function pushNotification(payload) {
  const createdAt = new Date().toISOString();
  const record = {
    id: "",
    createdAt,
    appName: APP_NAME,
    level: normalizeLevel(payload?.level || "urgent"),
    source: cleanText(payload?.source || "manual", 80),
    summary: cleanText(payload?.summary || payload?.message || "긴급 업데이트가 있습니다."),
  };
  record.id = notificationIdFor(record);

  const delivery = browserNotificationDelivery(record);
  const nextRecord = {
    ...record,
    delivery,
  };
  const nextStore = mutateStore((store) => ({
    ...store,
    records: [...store.records.filter((item) => item.id !== record.id), nextRecord].slice(-MAX_RECORDS),
  }));
  return {
    ok: delivery.ok || delivery.skipped === true,
    record: nextRecord,
    status: publicSnapshot(nextStore),
  };
}

function markReportsOpened() {
  const nextStore = mutateStore((store) => ({
    ...store,
    readState: {
      ...(store.readState || {}),
      reportsOpenedAt: new Date().toISOString(),
    },
  }));
  return publicSnapshot(nextStore);
}

function methodNotAllowed(res) {
  sendJson(res, { ok: false, error: "method not allowed" }, 405);
}

export async function handleNotificationsEndpoint(kind, req, res) {
  try {
    if (kind === "status") {
      if (req.method !== "GET") {
        methodNotAllowed(res);
        return;
      }
      sendJson(res, publicSnapshot());
      return;
    }

    if (kind === "push") {
      if (req.method !== "POST") {
        methodNotAllowed(res);
        return;
      }
      const payload = await readJsonBody(req, 16 * 1024);
      const result = await pushNotification(payload);
      sendJson(res, result, result.record.delivery?.ok || result.record.delivery?.skipped ? 200 : 502);
      return;
    }

    if (kind === "emergency-report") {
      if (req.method !== "POST") {
        methodNotAllowed(res);
        return;
      }
      const payload = await readJsonBody(req, 32 * 1024).catch(() => ({}));
      const result = await buildFastEmergencyReport(payload);
      sendJson(res, result, 201);
      return;
    }

    if (kind === "emergency-scenario") {
      if (req.method !== "POST") {
        methodNotAllowed(res);
        return;
      }
      const payload = await readJsonBody(req, 128 * 1024).catch(() => ({}));
      const result = await buildEmergencyScenarioEvaluation(payload);
      sendJson(res, result, result.action.createdReport ? 201 : 200);
      return;
    }

    if (kind === "read-state") {
      if (req.method !== "POST") {
        methodNotAllowed(res);
        return;
      }
      const payload = await readJsonBody(req, 16 * 1024).catch(() => ({}));
      const action = String(payload?.action || "mark-reports-opened").trim();
      if (action !== "mark-reports-opened") {
        sendJson(res, { ok: false, error: "unknown notification read-state action" }, 400);
        return;
      }
      sendJson(res, markReportsOpened());
      return;
    }

    sendJson(res, { ok: false, error: "unknown notifications endpoint" }, 404);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
