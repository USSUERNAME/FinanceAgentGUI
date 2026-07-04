import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const NOTIFICATION_DIR = join(GUIBUILD_ROOT, "data", "notifications");
const NOTIFICATION_STORE_PATH = join(NOTIFICATION_DIR, "stock-channel-notifications.json");
const EXTERNAL_MEMORY_BRIEFING_PATH = join(GUIBUILD_ROOT, "data", "shared-memory", "external_memory_briefing.md");
const APP_NAME = "주식채널+";
const MAX_RECORDS = 80;
const MAX_SUMMARY_LENGTH = 160;
const MAX_REPORT_INPUT_LENGTH = 5200;
const MAX_SCENARIO_ITEM_COUNT = 24;
const EMERGENCY_REPORT_MODEL_TIMEOUT_MS = 60 * 1000;
const EMERGENCY_DETECTION_MODEL_TIMEOUT_MS = 60 * 1000;
const REPORT_ALERT_LEVELS = new Set(["urgent", "critical"]);
const DETECTION_ALERT_LEVELS = new Set(["none", "watch", "urgent", "critical"]);
const URGENT_REPORT_UNCERTAINTY_NOTICE =
  "이 알림은 부정확할 수 있으며 현재 벌어지고 있는 사안에 대한 자세하고 정확한 정보 습득은 주식채널+의 정식 채팅 기능이나 다른 수단을 이용해야 할 수 있다.";

function defaultStore() {
  return {
    version: 1,
    records: [],
    readState: {
      reportsOpenedAt: "",
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
    };
  } catch {
    return defaultStore();
  }
}

function writeStore(store) {
  ensureNotificationDir();
  writeFileSync(NOTIFICATION_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
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
  return `stock_alert_${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

function normalizeLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  if (level === "critical") return "critical";
  if (level === "urgent") return "urgent";
  if (level === "watch") return "watch";
  return "info";
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

function emergencyDetectionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      alertLevel: { type: "string", enum: ["none", "watch", "urgent", "critical"] },
      shouldCreateReport: { type: "boolean" },
      rationaleKo: { type: "string" },
      signals: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["alertLevel", "shouldCreateReport", "rationaleKo", "signals"],
  };
}

function emergencyDetectionPrompt({ contextSummary, generatedAt = new Date().toISOString() } = {}) {
  return [
    "너는 FinanceAgentGUI의 비상 시장 업데이트 감지기다.",
    "입력은 번역/요약 모델이 만든 '월드메모리 이후 시장 요약'이다.",
    "웹검색을 하지 않는다. 원 뉴스피드 목록을 다시 열람하지 않는다. 입력 요약에 없는 사실을 추가하지 않는다.",
    "텍스트 매칭이 아니라 의미 기반으로 판정한다.",
    "일반적인 악재, 단순 변동성 확대, 평범한 지정학 긴장은 watch 이하로 둔다.",
    "시장 참여자가 즉시 알아야 하는 체제 변화, 전쟁 확전, 금융 시스템 장애, 주요 시장 폐쇄/거래 중단, 핵무기 사용, 대형 국가 부도/은행 유동성 위기, 전 세계 공급망 급변은 urgent 또는 critical로 판정한다.",
    "체제 붕괴급 사건이 아니더라도, 현재 이슈를 시장이 이미 상당히 부정적으로 해석하고 가격에 반영하고 있으면 urgent로 판정한다.",
    "예를 들어 주요 지수 급락, 금리·환율·신용스프레드·변동성의 급격한 재가격화, 안전자산 선호 급증, 특정 국가·섹터·자산군의 광범위한 매도, 정책·규제·중앙은행 결정에 대한 예상 밖의 위험회피가 함께 나타나면 urgent 후보로 본다.",
    "이 기준은 미국 연준뿐 아니라 ECB, BOJ, PBOC, 한국은행 등 모든 주요 중앙은행과 각국 정부·규제기관·정치·지정학 이벤트에 동일하게 적용한다.",
    "가격 반응이 약하거나 국지적이고, 시장이 아직 의미를 탐색하는 단계라면 watch로 둔다.",
    "입력 요약이 여러 출처의 보도처럼 서술하고 있으면, 불확실하더라도 그 입력 세계 안에서는 실제 상황으로 가정해 판정한다.",
    "critical은 '와 어떻게 이런 일이 생길 수가 있지? 이거 큰일났는데?' 수준의 급격한 시장 레짐 전환 신호에만 쓴다.",
    "urgent 또는 critical이면 shouldCreateReport는 true다. none/watch면 false다.",
    "출력은 JSON 객체 하나만 반환한다.",
    "",
    "반환 형식:",
    JSON.stringify({
      alertLevel: "critical",
      shouldCreateReport: true,
      rationaleKo: "비상 판정 이유",
      signals: ["핵심 신호"],
    }),
    "",
    "입력:",
    JSON.stringify(
      {
        generatedAt,
        sourcePolicy: "context-summary-only; no web search; no raw feed scan",
        contextSummary,
      },
      null,
      2
    ),
  ].join("\n");
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

function normalizeEmergencyDetectionCandidate(payload = {}) {
  const rawLevel = cleanText(payload.alertLevel || payload.level || "none", 32).toLowerCase();
  const alertLevel = DETECTION_ALERT_LEVELS.has(rawLevel) ? rawLevel : "none";
  const shouldCreateReport =
    payload.shouldCreateReport === true || (REPORT_ALERT_LEVELS.has(alertLevel) && payload.shouldCreateReport !== false);
  const rationaleKo = cleanText(payload.rationaleKo || payload.rationale || "", 600);
  const signals = cleanTextList(payload.signals, { limit: 6, maxLength: 240 });
  const issues = [];
  if (!rationaleKo) issues.push("rationaleKo is required");
  if (!signals.length) issues.push("signals must include at least one item");
  return {
    ok: issues.length === 0,
    alertLevel,
    shouldCreateReport: shouldCreateReport && REPORT_ALERT_LEVELS.has(alertLevel),
    rationaleKo,
    signals,
    error: issues.join(", "),
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
  const requestedLevel = normalizeLevel(payload.level || payload.severity || "urgent");
  const generatedAt = new Date().toISOString();
  const prompt = fastReportPrompt({ contextSummary, requestedLevel, generatedAt });
  const raw =
    modelInfo.provider === "antigravity-cli"
      ? runAntigravityJsonModel(prompt, modelInfo, EMERGENCY_REPORT_MODEL_TIMEOUT_MS)
      : runCodexJsonModel(prompt, fastReportSchema(), modelInfo, EMERGENCY_REPORT_MODEL_TIMEOUT_MS);
  const report = normalizeFastReportCandidate(raw);
  if (!report.ok) throw new Error(`fast report validation failed: ${report.error}`);
  const saved = await writeGeneratedReportFile({
    action: "save_report_artifact",
    title: report.reportTitle,
    slug: `urgent_market_update_${report.severity}`,
    content: renderFastReportMarkdown(report, { generatedAt }),
  });
  const pushed = await pushNotification({
    level: report.severity,
    source: "fast-emergency-report",
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

function runEmergencyDetection(contextSummary, { generatedAt = new Date().toISOString() } = {}) {
  const modelInfo = chooseSharedMemoryTranslationModel();
  const prompt = emergencyDetectionPrompt({ contextSummary, generatedAt });
  const raw =
    modelInfo.provider === "antigravity-cli"
      ? runAntigravityJsonModel(prompt, modelInfo, EMERGENCY_DETECTION_MODEL_TIMEOUT_MS)
      : runCodexJsonModel(prompt, emergencyDetectionSchema(), modelInfo, EMERGENCY_DETECTION_MODEL_TIMEOUT_MS);
  const detection = normalizeEmergencyDetectionCandidate(raw);
  if (!detection.ok) throw new Error(`emergency detection validation failed: ${detection.error}`);
  return {
    ...detection,
    model: {
      provider: modelInfo.provider,
      providerLabel: modelInfo.providerLabel,
      model: modelInfo.model,
      modelLabel: modelInfo.modelLabel || modelInfo.model,
      reasoning: modelInfo.reasoning,
    },
  };
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
  const detection = runEmergencyDetection(marketSummaryResult.text, { generatedAt });
  const shouldCreateReport = detection.shouldCreateReport && REPORT_ALERT_LEVELS.has(detection.alertLevel);
  const reportResult = shouldCreateReport
    ? await buildFastEmergencyReport({
        contextSummary: marketSummaryResult.text,
        level: detection.alertLevel,
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
  const store = readStore();
  const nextRecord = {
    ...record,
    delivery,
  };
  const records = [...store.records.filter((item) => item.id !== record.id), nextRecord].slice(-MAX_RECORDS);
  const nextStore = {
    ...store,
    records,
  };
  writeStore(nextStore);
  return {
    ok: delivery.ok || delivery.skipped === true,
    record: nextRecord,
    status: publicSnapshot(nextStore),
  };
}

function markReportsOpened() {
  const store = readStore();
  const nextStore = {
    ...store,
    readState: {
      ...(store.readState || {}),
      reportsOpenedAt: new Date().toISOString(),
    },
  };
  writeStore(nextStore);
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
