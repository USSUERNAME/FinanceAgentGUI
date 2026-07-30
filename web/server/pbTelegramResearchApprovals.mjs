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
    const items = attachmentItems(snapshot).map((item) => {
      const decision = decisions.get(item.attachmentKey);
      const state = ["approved", "excluded"].includes(cleanText(decision?.decision, 40))
        ? cleanText(decision.decision, 40)
        : "pending";
      return {
        ...item,
        state,
        decidedAt: cleanText(decision?.decided_at, 80),
      };
    });
    return { approvalPath, registry, items };
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
