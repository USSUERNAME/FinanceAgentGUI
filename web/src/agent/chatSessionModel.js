import { cleanPortfolioWidgetText } from "../portfolio/widgetIdentity.js";
import { worldMemoryActionCatalog } from "../worldMemory/actionCatalog.js";

export const initialChatMessages = [];
export const systemMainChatScope = Object.freeze({ type: "system-main", canvasId: "" });
export const worldMemoryChatScope = Object.freeze({ type: "world-memory", canvasId: "" });
export const personaEligibleScreens = new Set([
  "chat",
  "stock",
  "news-feed",
  "magazine",
  "world-memory",
  "reports",
  "transaction-status",
  "earning-calendar",
  "economic-calendar",
  "portfolio",
  "portfolio-canvas",
]);
export const MIN_PROMPT_HEIGHT = 42;
export const MAX_PROMPT_HEIGHT = 132;
export const MAX_CHAT_ATTACHMENTS = 6;
export const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
export const CHAT_STREAM_RENDER_INTERVAL_MS = 120;
export const worldMemoryActionsNeedingReportRefresh = new Set([
  "stateAdd",
  "briefStoryBackfill",
  "storyLink",
  "taxonomyRefresh",
  "stateSync",
]);

const MAX_CHAT_ATTACHMENT_INLINE_TEXT_CHARS = 300_000;

export function isWorldMemoryChatScope(scope) {
  return scope?.type === "world-memory";
}

export function chatScopeKey(scope = systemMainChatScope) {
  if (scope?.type === "portfolio-canvas" && scope.canvasId) {
    return `portfolio-canvas:${scope.canvasId}`;
  }
  if (isWorldMemoryChatScope(scope)) return "world-memory";
  return "system-main";
}

export function normalizeChatMessageList(value) {
  return Array.isArray(value) ? value : initialChatMessages;
}

export function stripWorldMemoryActionBlocks(answer = "") {
  const text = String(answer || "");
  return text
    .replace(/```world_memory_action[\s\S]*?```/gi, "")
    .replace(/```world_memory_action[\s\S]*$/gi, "")
    .replace(/```json\s*([\s\S]*?)```/gi, (match, body) =>
      /world_memory|briefStoryBackfill|storyLink|storyFamilyReview|taxonomyRefresh|stateAdd|stateSync|semanticSearch|cleanupDryRun/i.test(body) ? "" : match
    )
    .replace(/\n?\s*world_memory_action\s*{[\s\S]*$/i, "")
    .trim();
}

export function parseWorldMemoryJsonAction(answer = "") {
  const raw = String(answer || "");
  const blocks = [...raw.matchAll(/```(?:world_memory_action|json)\s*([\s\S]*?)```/gi)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  const markerIndex = raw.toLowerCase().lastIndexOf("world_memory_action");
  const markerBody = markerIndex >= 0 ? raw.slice(markerIndex).replace(/^world_memory_action/i, "").trim() : "";
  const looseJson =
    raw.includes("{") && raw.includes("}") ? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1).trim() : "";
  const candidates = [...blocks, markerBody, looseJson, raw.trim()].filter(Boolean);

  for (const candidate of candidates) {
    const jsonCandidate =
      candidate.startsWith("{") && candidate.endsWith("}")
        ? candidate
        : candidate.includes("{") && candidate.includes("}")
          ? candidate.slice(candidate.indexOf("{"), candidate.lastIndexOf("}") + 1).trim()
          : "";
    if (!jsonCandidate) continue;
    try {
      const parsed = JSON.parse(jsonCandidate);
      const action = String(parsed?.action || parsed?.actionId || "").trim();
      if (action && worldMemoryActionCatalog[action]) return parsed;
    } catch {
      // Ignore prose or malformed JSON.
    }
  }
  return null;
}

export function normalizeWorldMemoryActionProposal(parsed, answer = "", focusContext = null) {
  const action = String(parsed?.action || parsed?.actionId || "").trim();
  if (!action || !worldMemoryActionCatalog[action]) return null;
  const catalog = worldMemoryActionCatalog[action];
  const params =
    parsed?.params && typeof parsed.params === "object"
      ? parsed.params
      : parsed?.options && typeof parsed.options === "object"
        ? parsed.options
        : {};
  const label = cleanPortfolioWidgetText(parsed?.label || parsed?.title || catalog.label, 120);
  const reason = cleanPortfolioWidgetText(
    parsed?.reason || parsed?.summary || parsed?.description || stripWorldMemoryActionBlocks(answer),
    360,
  );
  return {
    id: `world_memory_action_${Date.now()}`,
    action,
    label,
    reason,
    riskLevel: parsed?.riskLevel || catalog.riskLevel,
    options: {
      ...params,
      ...(parsed?.query && !params.query ? { query: parsed.query } : {}),
      ...(parsed?.days && !params.days ? { days: parsed.days } : {}),
      ...(parsed?.limit && !params.limit ? { limit: parsed.limit } : {}),
    },
    acceptedChangeSuggestion:
      focusContext?.section === "memory-change"
        ? {
            ...focusContext,
            action,
            label,
          }
        : null,
    raw: parsed,
    answer,
  };
}

export function trimForMemory(value, maxLength = 420) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

export function memoryTitleFromPrompt(prompt, fallback = "에이전트 채팅") {
  const firstLine = String(prompt || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const text = trimForMemory(firstLine || fallback, 64);
  return text || fallback;
}

export function memorySummaryFromExchange(prompt, answer) {
  return [
    `사용자: ${trimForMemory(prompt, 260)}`,
    `응답: ${trimForMemory(answer, 720)}`,
  ]
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

export function memoryTagsForExchange({ screen, provider, article, attachments = [], taskType = "chat" }) {
  return [
    "agent-chat",
    taskType,
    screen,
    provider,
    article ? "article-context" : "",
    attachments.length ? "attachments" : "",
  ].filter(Boolean);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function chatAttachmentCanInlineText(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return (
    type.startsWith("text/") ||
    [
      "application/json",
      "application/javascript",
      "application/xml",
      "application/x-yaml",
      "application/yaml",
      "application/vnd.ms-excel",
    ].includes(type) ||
    /\.(csv|tsv|txt|json|xml|yaml|yml|md)$/i.test(name)
  );
}

async function readFileAsInlineText(file) {
  if (!chatAttachmentCanInlineText(file)) return "";
  try {
    const text = await file.text();
    return String(text || "").slice(0, MAX_CHAT_ATTACHMENT_INLINE_TEXT_CHARS);
  } catch {
    return "";
  }
}

export async function fileToChatAttachment(file) {
  const [dataUrl, text] = await Promise.all([readFileAsDataUrl(file), readFileAsInlineText(file)]);
  const type = file.type || "application/octet-stream";
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name || (type.startsWith("image/") ? "pasted-image.png" : "attachment"),
    type,
    size: file.size,
    dataUrl,
    text,
    previewUrl: type.startsWith("image/") ? dataUrl : "",
    addedAt: new Date().toISOString(),
  };
}
