import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { readJsonBody, sendJson } from "./codexProbe.mjs";
import { loadPbDailyIntelligenceSnapshot } from "./pbDailyIntelligenceApi.mjs";

const APPROVAL_SCHEMA = "telegram_research_attachment_approvals.v1";
const APPROVAL_RELATIVE_PATH = [
  "workspace",
  "telegram_research_approvals",
  "attachments.json",
];

function cleanText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/[\r\n\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function classifyAttachmentPriority(attachment) {
  const username = cleanText(attachment?.channelUsername, 80).toLowerCase();
  const haystack = cleanText(
    [
      attachment?.title,
      attachment?.filename,
      attachment?.channelName,
      username,
    ].join(" "),
    1200,
  );
  let score = 0;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  };

  if (/\b[A-Z]{1,5}\.US\b/i.test(haystack)) {
    add(65, "미국 상장 종목 티커가 명시됨");
  }
  if (/(?:미국\s*(?:전략|주식|증시|시장)|S&P\s*500|NASDAQ|나스닥|FOMC|Federal Reserve|연준)/i.test(haystack)) {
    add(55, "미국 시장·정책을 직접 다룸");
  }
  if (/(?:미국채|미\s*국채|달러|채권시장|기준금리|금리\s*경로)/i.test(haystack)) {
    add(25, "미국 주식의 할인율·유동성 판단에 연결됨");
  }
  if (/(?:글로벌\s*(?:전략|시장|자산배분)|global\s*(?:strategy|markets?))/i.test(haystack)) {
    add(30, "글로벌 자산배분·시장 전략 자료");
  }
  if (/(?:AI|인공지능|반도체|데이터센터|전력|원전|로보틱스)/i.test(haystack)) {
    add(18, "미국 성장주 핵심 구조 테마와 관련됨");
  }
  if (username === "hana_us_stock") {
    add(30, "미국주식 전용 공식 리서치 채널");
  }
  if (/(?:국내\s*주식|코스피|KOSPI|코스닥|KOSDAQ|\b\d{6}\.KS\b)/i.test(haystack)) {
    add(-35, "국내시장 중심 자료");
  }

  if (score >= 50) {
    return {
      level: "high",
      label: "우선 분석",
      score,
      reason: reasons.slice(0, 3).join(" · ") || "미국주식 판단과 직접 연결됨",
    };
  }
  if (score >= 20) {
    return {
      level: "medium",
      label: "검토 추천",
      score,
      reason: reasons.slice(0, 3).join(" · ") || "시장·섹터 연결 가능성 확인 필요",
    };
  }
  return {
    level: "low",
    label: "후순위",
    score,
    reason: reasons.slice(0, 3).join(" · ") || "미국주식 방향성과의 직접 연결 근거가 약함",
  };
}

function configuredEngineRoot(env = process.env) {
  const raw = cleanText(env.PB_DAILY_INTELLIGENCE_ENGINE_DIR, 4000);
  if (!raw) throw new Error("PB_DAILY_INTELLIGENCE_ENGINE_DIR가 설정되지 않았습니다.");
  return isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
}

async function readRegistry(path) {
  if (!existsSync(path)) {
    return { schema_version: APPROVAL_SCHEMA, updated_at: "", decisions: [] };
  }
  try {
    const payload = JSON.parse(await readFile(path, "utf8"));
    if (payload?.schema_version !== APPROVAL_SCHEMA || !Array.isArray(payload.decisions)) {
      throw new Error("승인 레지스트리 형식이 올바르지 않습니다.");
    }
    return payload;
  } catch (error) {
    throw new Error(`Telegram PDF 승인 레지스트리를 읽지 못했습니다: ${error.message}`);
  }
}

async function writeRegistry(path, payload) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function attachmentItems(snapshot) {
  return (Array.isArray(snapshot?.telegramSources?.pdfAttachments)
    ? snapshot.telegramSources.pdfAttachments
    : [])
    .filter((attachment) => attachment?.attachmentKey && attachment?.filename)
    .map((attachment) => ({
      attachmentKey: cleanText(attachment.attachmentKey, 128),
      filename: cleanText(attachment.filename, 500),
      mimeType: cleanText(attachment.mimeType, 120),
      size: Math.max(0, Number(attachment.size) || 0),
      channelUsername: cleanText(attachment.channelUsername, 80),
      channelName: cleanText(attachment.channelName, 160),
      messageId: Number(attachment.messageId || 0),
      postUrl: /^https:\/\/t\.me\//i.test(String(attachment.postUrl || ""))
        ? String(attachment.postUrl)
        : "",
      publishedAt: cleanText(attachment.publishedAt, 80),
      title: cleanText(attachment.title, 240),
    }));
}

function analyzedAttachments(snapshot) {
  const results = new Map();
  const reports = Array.isArray(snapshot?.brokerResearch?.reports)
    ? snapshot.brokerResearch.reports
    : [];
  for (const report of reports) {
    const reference = cleanText(report?.source?.reference, 500);
    const match = reference.match(/:attachment:([a-f0-9]{32,128})$/i);
    if (!match) continue;
    const standardSectors = Array.isArray(report?.standardSectors)
      ? report.standardSectors
        .map((item) => cleanText(item?.name, 120))
        .filter(Boolean)
      : [];
    results.set(match[1].toLowerCase(), {
      reportId: cleanText(report?.reportId, 160),
      title: cleanText(report?.title, 240),
      summary: cleanText(report?.summary, 700),
      stance: cleanText(report?.stance, 40) || "not_stated",
      tickers: (Array.isArray(report?.tickers) ? report.tickers : [])
        .map((item) => cleanText(item, 24))
        .filter(Boolean)
        .slice(0, 8),
      sectors: (
        standardSectors.length
          ? standardSectors
          : (Array.isArray(report?.sectors) ? report.sectors : [])
            .map((item) => cleanText(item, 120))
            .filter(Boolean)
      ).slice(0, 6),
      structuredAnalysisAvailable: report?.structuredAnalysisAvailable === true,
      processingStatus: cleanText(report?.processingStatus, 80),
    });
  }
  return results;
}

export function createPbTelegramResearchApprovalService({
  env = process.env,
  now = () => new Date().toISOString(),
  loadSnapshot = loadPbDailyIntelligenceSnapshot,
} = {}) {
  async function loadState() {
    const engineRoot = configuredEngineRoot(env);
    const approvalPath = resolve(engineRoot, ...APPROVAL_RELATIVE_PATH);
    const [snapshot, registry] = await Promise.all([
      loadSnapshot({ env }),
      readRegistry(approvalPath),
    ]);
    const decisions = new Map(
      registry.decisions
        .filter((item) => item && typeof item === "object")
        .map((item) => [cleanText(item.attachment_key, 128), item]),
    );
    const analysisResults = analyzedAttachments(snapshot);
    const items = attachmentItems(snapshot).map((item) => {
      const decision = decisions.get(item.attachmentKey);
      const decisionState = ["approved", "excluded"].includes(cleanText(decision?.decision, 40))
        ? cleanText(decision.decision, 40)
        : "pending";
      const analysis = analysisResults.get(item.attachmentKey.toLowerCase()) || null;
      const state = decisionState === "approved" && analysis
        ? analysis.structuredAnalysisAvailable
          ? "ready"
          : "processing"
        : decisionState;
      return {
        ...item,
        priority: classifyAttachmentPriority(item),
        state,
        decisionState,
        decidedAt: cleanText(decision?.decided_at, 80),
        analysis,
      };
    });
    return { approvalPath, registry, items };
  }

  async function status() {
    const state = await loadState();
    const count = (value) => state.items.filter((item) => item.state === value).length;
    const pendingItems = state.items.filter((item) => item.state === "pending");
    const recommendationCount = (level) => pendingItems
      .filter((item) => item.priority?.level === level)
      .length;
    return {
      configured: true,
      counts: {
        total: state.items.length,
        pending: count("pending"),
        approved: count("approved"),
        processing: count("processing"),
        ready: count("ready"),
        excluded: count("excluded"),
      },
      recommendations: {
        high: recommendationCount("high"),
        medium: recommendationCount("medium"),
        low: recommendationCount("low"),
      },
      items: state.items,
    };
  }

  async function decide({ attachmentKey, decision }) {
    const normalizedKey = cleanText(attachmentKey, 128);
    const normalizedDecision = cleanText(decision, 40);
    if (!normalizedKey || !["approved", "excluded"].includes(normalizedDecision)) {
      throw new Error("승인 대상과 결정값을 확인하세요.");
    }
    const state = await loadState();
    const attachment = state.items.find((item) => item.attachmentKey === normalizedKey);
    if (!attachment) {
      throw new Error("현재 Telegram 수집 결과에서 PDF 첨부를 찾지 못했습니다.");
    }
    const remaining = state.registry.decisions.filter(
      (item) => cleanText(item?.attachment_key, 128) !== normalizedKey,
    );
    await writeRegistry(state.approvalPath, {
      schema_version: APPROVAL_SCHEMA,
      updated_at: now(),
      decisions: [
        ...remaining,
        {
          attachment_key: normalizedKey,
          filename: attachment.filename,
          channel_username: attachment.channelUsername,
          decision: normalizedDecision,
          decided_at: now(),
        },
      ],
    });
    return status();
  }

  return { status, decide };
}

export const pbTelegramResearchApprovalService =
  createPbTelegramResearchApprovalService();

export async function handlePbTelegramResearchApprovalsEndpoint(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, { ok: true, ...(await pbTelegramResearchApprovalService.status()) });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const payload = await readJsonBody(req);
    sendJson(res, {
      ok: true,
      ...(await pbTelegramResearchApprovalService.decide(payload)),
    });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
