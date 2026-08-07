import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const REVIEW_SCHEMA = "gmail_research_sender_reviews.v1";
const APPROVAL_SCHEMA = "gmail_research_sender_approvals.v1";
const REVIEW_RELATIVE_PATH = [
  "workspace",
  "gmail_research_reviews",
  "blocked_senders.json",
];
const APPROVAL_RELATIVE_PATH = [
  "workspace",
  "gmail_research_approvals",
  "senders.json",
];

function cleanText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/[\r\n\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function configuredEngineRoot(env = process.env) {
  const raw = cleanText(env.PB_DAILY_INTELLIGENCE_ENGINE_DIR, 4000);
  if (!raw) throw new Error("PB_DAILY_INTELLIGENCE_ENGINE_DIR가 설정되지 않았습니다.");
  return isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
}

async function readPayload(path, schema, listKey) {
  if (!existsSync(path)) return { schema_version: schema, [listKey]: [] };
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (payload?.schema_version !== schema || !Array.isArray(payload[listKey])) {
    throw new Error("Gmail 발신자 검토 파일 형식이 올바르지 않습니다.");
  }
  return payload;
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

export function createPbGmailSenderReviewService({
  env = process.env,
  now = () => new Date().toISOString(),
} = {}) {
  async function loadState() {
    const engineRoot = configuredEngineRoot(env);
    const reviewPath = resolve(engineRoot, ...REVIEW_RELATIVE_PATH);
    const approvalPath = resolve(engineRoot, ...APPROVAL_RELATIVE_PATH);
    const [reviews, approvals] = await Promise.all([
      readPayload(reviewPath, REVIEW_SCHEMA, "items"),
      readPayload(approvalPath, APPROVAL_SCHEMA, "decisions"),
    ]);
    const decisions = new Map(
      approvals.decisions
        .filter((item) => item && typeof item === "object")
        .map((item) => [cleanText(item.sender_email, 320).toLowerCase(), item]),
    );
    const items = reviews.items
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const senderEmail = cleanText(item.sender_email, 320).toLowerCase();
        const decision = decisions.get(senderEmail);
        const state = ["approved", "excluded"].includes(cleanText(decision?.decision, 40))
          ? cleanText(decision.decision, 40)
          : "pending";
        return {
          senderKey: cleanText(item.sender_key, 128),
          senderName: cleanText(item.sender_name, 200),
          senderEmail,
          senderDomain: cleanText(item.sender_domain, 255),
          latestSubject: cleanText(item.latest_subject, 500),
          latestPublishedAt: cleanText(item.latest_published_at, 80),
          reason: cleanText(item.reason, 80),
          reviewable: item.reviewable === true,
          messageCount: Math.max(1, Number(item.message_count) || 1),
          firstSeenAt: cleanText(item.first_seen_at, 80),
          lastSeenAt: cleanText(item.last_seen_at, 80),
          state,
          decidedAt: cleanText(decision?.decided_at, 80),
        };
      })
      .filter((item) => item.senderKey && item.senderEmail)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
    return { approvalPath, approvals, items };
  }

  async function status() {
    const state = await loadState();
    const count = (value) => state.items.filter((item) => item.state === value).length;
    return {
      configured: true,
      counts: {
        total: state.items.length,
        pending: count("pending"),
        approved: count("approved"),
        excluded: count("excluded"),
      },
      items: state.items,
    };
  }

  async function decide({ senderKey, decision }) {
    const normalizedKey = cleanText(senderKey, 128);
    const normalizedDecision = cleanText(decision, 40);
    if (!normalizedKey || !["approved", "excluded"].includes(normalizedDecision)) {
      throw new Error("발신자와 검토 결정을 확인하세요.");
    }
    const state = await loadState();
    const sender = state.items.find((item) => item.senderKey === normalizedKey);
    if (!sender) throw new Error("현재 검토함에서 발신자를 찾지 못했습니다.");
    if (normalizedDecision === "approved" && !sender.reviewable) {
      throw new Error("인증 실패나 빈 본문은 허용할 수 없습니다. 계속 제외만 선택할 수 있습니다.");
    }
    const remaining = state.approvals.decisions.filter(
      (item) => cleanText(item?.sender_email, 320).toLowerCase() !== sender.senderEmail,
    );
    await writeRegistry(state.approvalPath, {
      schema_version: APPROVAL_SCHEMA,
      updated_at: now(),
      decisions: [
        ...remaining,
        {
          sender_email: sender.senderEmail,
          sender_name: sender.senderName,
          decision: normalizedDecision,
          decided_at: now(),
        },
      ],
    });
    return status();
  }

  return { status, decide };
}

export const pbGmailSenderReviewService = createPbGmailSenderReviewService();

export async function handlePbGmailSenderReviewsEndpoint(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, { ok: true, ...(await pbGmailSenderReviewService.status()) });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const payload = await readJsonBody(req);
    sendJson(res, { ok: true, ...(await pbGmailSenderReviewService.decide(payload)) });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
