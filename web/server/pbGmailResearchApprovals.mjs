import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { readJsonBody, sendJson } from "./codexProbe.mjs";
import { loadPbDailyIntelligenceSnapshot } from "./pbDailyIntelligenceApi.mjs";

const APPROVAL_SCHEMA = "gmail_research_attachment_approvals.v1";
const APPROVAL_RELATIVE_PATH = [
  "workspace",
  "gmail_research_approvals",
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
    throw new Error(`Gmail 첨부 승인 레지스트리를 읽지 못했습니다: ${error.message}`);
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
  const candidates = Array.isArray(snapshot?.gmailResearch?.candidates)
    ? snapshot.gmailResearch.candidates
    : [];
  return candidates.flatMap((candidate) => (
    Array.isArray(candidate.attachments) ? candidate.attachments : []
  )
    .filter((attachment) => attachment?.isPdf && attachment?.attachmentKey)
    .map((attachment) => ({
      attachmentKey: cleanText(attachment.attachmentKey, 128),
      filename: cleanText(attachment.filename, 500),
      mimeType: cleanText(attachment.mimeType, 120),
      size: Math.max(0, Number(attachment.size) || 0),
      publisher: cleanText(candidate.publisher, 160),
      messageTitle: cleanText(candidate.title, 300),
      publishedAt: cleanText(candidate.publishedAt, 80),
      sourceReference: cleanText(candidate.sourceReference, 300),
    })));
}

function completedAttachmentKeys(snapshot) {
  const candidates = Array.isArray(snapshot?.gmailResearch?.candidates)
    ? snapshot.gmailResearch.candidates
    : [];
  const keys = [];
  for (const candidate of candidates) {
    keys.push(cleanText(candidate?.gmailAttachmentKey, 128));
    const analyzedAttachments = Array.isArray(candidate?.analyzedAttachments)
      ? candidate.analyzedAttachments
      : [];
    for (const attachment of analyzedAttachments) {
      keys.push(cleanText(attachment?.attachmentKey, 128));
    }
  }
  return new Set(keys.filter(Boolean));
}

export function createPbGmailResearchApprovalService({
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
    const completed = completedAttachmentKeys(snapshot);
    const items = attachmentItems(snapshot).map((item) => {
      const decision = decisions.get(item.attachmentKey);
      const decisionState = ["approved", "excluded"].includes(
        cleanText(decision?.decision, 40)
      )
        ? cleanText(decision.decision, 40)
        : "pending";
      return {
        ...item,
        state: decisionState === "excluded"
          ? "excluded"
          : completed.has(item.attachmentKey)
            ? "ready"
            : decisionState,
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
        ready: count("ready"),
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
      throw new Error("현재 Gmail 수집 결과에서 첨부파일을 찾지 못했습니다.");
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
          decision: normalizedDecision,
          decided_at: now(),
        },
      ],
    });
    return status();
  }

  return { status, decide };
}

export const pbGmailResearchApprovalService = createPbGmailResearchApprovalService();

export async function handlePbGmailResearchApprovalsEndpoint(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, { ok: true, ...(await pbGmailResearchApprovalService.status()) });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const payload = await readJsonBody(req);
    sendJson(res, {
      ok: true,
      ...(await pbGmailResearchApprovalService.decide(payload)),
    });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
