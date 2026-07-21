import { parse } from "node-html-parser";
import { getArcaCookieHeader } from "./arcaAuthApi.mjs";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const DEFAULT_BASE_URL = "https://arca.live";
const DEFAULT_CHANNEL = "stock";
const MAX_ARTICLE_CONTEXT_LENGTH = 12000;
const MAX_ARTICLE_READER_TEXT_LENGTH = 60000;
const MAX_ARTICLE_READER_BLOCKS = 240;
const MAX_ARTICLE_READER_IMAGES = 24;
const MAX_ARTICLE_LIST_ITEMS = 200;
const MAX_ARTICLE_TABLE_ROWS = 120;
const MAX_ARTICLE_TABLE_COLUMNS = 24;
const MAX_ARTICLE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ARCA_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_COMMENT_LENGTH = 8000;
const MAX_COMBO_EMOTICONS = 3;
const MAX_ARCA_NOTIFICATION_ITEMS = 50;
const guardedArcaImageSockets = new WeakSet();

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function nodeText(node) {
  return decodeHtmlEntities(String(node?.structuredText || node?.text || "").replace(/\s+/g, " ").trim());
}

function parseInteger(value) {
  const digits = String(value ?? "").replace(/[^\d-]/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanClass(node, className) {
  return Boolean(node?.classNames?.includes(className));
}

function absoluteArcaUrl(href, baseUrl) {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function safeArticleAssetUrl(href, baseUrl) {
  const absolute = absoluteArcaUrl(href, baseUrl);
  if (!absolute) return "";
  try {
    const url = new URL(absolute);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function isArcaTwemojiSvgUrl(value, baseUrl = DEFAULT_BASE_URL) {
  try {
    const base = new URL(normalizeBaseUrl(baseUrl));
    const url = new URL(String(value || ""), base);
    return (
      url.origin === base.origin &&
      /^\/node_modules\/twemoji\/assets\/svg\/[0-9a-f-]+\.svg$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function articleImageUrls(node, config) {
  const originalUrl = safeArticleAssetUrl(
    node?.getAttribute?.("data-originalurl") || node?.getAttribute?.("data-src") || node?.getAttribute?.("src"),
    config.baseUrl
  );
  const readerUrl = safeArticleAssetUrl(
    node?.getAttribute?.("src") || node?.getAttribute?.("data-src") || node?.getAttribute?.("data-originalurl"),
    config.baseUrl
  );
  return {
    originalUrl,
    readerUrl: readerUrl || originalUrl,
  };
}

export function isAllowedArcaImageProxyUrl(value, baseUrl = DEFAULT_BASE_URL) {
  try {
    const url = new URL(String(value || ""));
    const baseHost = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase();
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (
        host === baseHost ||
        host.endsWith(`.${baseHost}`) ||
        host === "namu.la" ||
        host.endsWith(".namu.la") ||
        host === "secure.gravatar.com"
      )
    );
  } catch {
    return false;
  }
}

export function arcaArticleImageProxyPath(value) {
  return `/api/arca/article/image?url=${encodeURIComponent(String(value || ""))}`;
}

export function arcaMediaProxyPath(value) {
  return `/api/arca/media?url=${encodeURIComponent(String(value || ""))}`;
}

export function isArcaImageClientDisconnectError(error) {
  return ["EPIPE", "ECONNRESET", "ERR_STREAM_DESTROYED", "ERR_HTTP2_STREAM_CANCEL"].includes(
    String(error?.code || "").toUpperCase()
  );
}

function guardArcaImageProxyClient(req, res, controller) {
  const state = { disconnected: false };
  const disconnect = () => {
    state.disconnected = true;
    if (!controller.signal.aborted) controller.abort();
  };
  req.once?.("aborted", disconnect);
  res.once?.("close", () => {
    if (!res.writableEnded) disconnect();
  });
  res.on?.("error", (error) => {
    disconnect();
    if (!isArcaImageClientDisconnectError(error)) {
      console.error(`Arca image proxy response failed: ${error.message}`);
    }
  });
  const socket = res.socket || req.socket;
  if (socket && !guardedArcaImageSockets.has(socket)) {
    guardedArcaImageSockets.add(socket);
    socket.on("error", (error) => {
      if (!isArcaImageClientDisconnectError(error)) {
        console.error(`Arca image proxy socket failed: ${error.message}`);
      }
    });
  }
  return state;
}

function canWriteArcaImageProxyResponse(req, res, clientState) {
  return !clientState.disconnected && !req.aborted && !res.destroyed && !res.writableEnded;
}

function withArcaReaderImageProxies(article) {
  return {
    ...article,
    readerImageUrls: article.readerImageSourceUrls.map(arcaArticleImageProxyPath),
    contentBlocks: article.contentBlocks.map((block) =>
      block.type === "image"
        ? {
            ...block,
            sourceSrc: block.src,
            src: arcaArticleImageProxyPath(block.readerSrc || block.src),
          }
        : block
    ),
  };
}

function sameArticleInlineStyle(left, right) {
  return (
    Boolean(left?.lineBreak) === Boolean(right?.lineBreak) &&
    Boolean(left?.bold) === Boolean(right?.bold) &&
    Boolean(left?.italic) === Boolean(right?.italic) &&
    Boolean(left?.underline) === Boolean(right?.underline) &&
    Boolean(left?.strike) === Boolean(right?.strike) &&
    Boolean(left?.code) === Boolean(right?.code) &&
    String(left?.href || "") === String(right?.href || "")
  );
}

function articleInlineSegments(node, baseUrl, inherited = {}, output = [], skippedTags = new Set()) {
  if (!node) return output;
  const tagName = String(node.tagName || "").toLowerCase();
  if (skippedTags.has(tagName)) return output;
  if (!tagName) {
    const text = String(node.rawText || node.text || "");
    if (text) output.push({ text, ...inherited });
    return output;
  }
  if (tagName === "br") {
    output.push({ text: "\n", lineBreak: true, ...inherited });
    return output;
  }
  if (tagName === "img") {
    const source =
      node.getAttribute?.("data-originalurl") ||
      node.getAttribute?.("data-src") ||
      node.getAttribute?.("src") ||
      "";
    if (isArcaTwemojiSvgUrl(source, baseUrl)) {
      const text = String(node.getAttribute?.("alt") || node.getAttribute?.("title") || "");
      if (text) output.push({ text, ...inherited });
    }
    return output;
  }

  const inlineStyle = String(node.getAttribute?.("style") || "").toLowerCase();
  const href = tagName === "a" ? safeArticleAssetUrl(node.getAttribute?.("href"), baseUrl) : "";
  const next = {
    ...inherited,
    ...(["b", "strong"].includes(tagName) || /font-weight\s*:\s*(?:bold|[6-9]00)/.test(inlineStyle)
      ? { bold: true }
      : {}),
    ...(["i", "em"].includes(tagName) || /font-style\s*:\s*italic/.test(inlineStyle)
      ? { italic: true }
      : {}),
    ...(tagName === "u" || /text-decoration[^;]*underline/.test(inlineStyle) ? { underline: true } : {}),
    ...(["s", "strike", "del"].includes(tagName) || /text-decoration[^;]*line-through/.test(inlineStyle)
      ? { strike: true }
      : {}),
    ...(tagName === "code" ? { code: true } : {}),
    ...(href ? { href } : {}),
  };
  for (const child of node.childNodes || []) articleInlineSegments(child, baseUrl, next, output, skippedTags);
  if (["p", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "th", "td"].includes(tagName)) {
    output.push({ text: "\n", ...inherited });
  }
  return output;
}

function normalizeArticleInlineSegments(segments, { preserveLines = false } = {}) {
  const normalized = [];
  for (const segment of segments) {
    if (segment?.lineBreak) {
      normalized.push({ ...segment, text: "\n" });
      continue;
    }
    const decoded = decodeHtmlEntities(segment?.text || "");
    const text = preserveLines
      ? decoded.replace(/[^\S\n]+/g, " ").replace(/\n{2,}/g, "\n")
      : decoded.replace(/\s+/g, " ");
    if (!text) continue;
    const next = { ...segment, text };
    const previous = normalized.at(-1);
    if (previous && sameArticleInlineStyle(previous, next)) previous.text += next.text;
    else normalized.push(next);
  }
  if (!normalized.length) return [];
  normalized[0].text = normalized[0].text.trimStart();
  normalized[normalized.length - 1].text = normalized[normalized.length - 1].text.trimEnd();
  return normalized.filter((segment) => segment.text);
}

function articleInlineContent(
  node,
  { preserveLines = false, baseUrl = DEFAULT_BASE_URL, skippedTags = new Set() } = {}
) {
  const segments = normalizeArticleInlineSegments(
    articleInlineSegments(node, baseUrl, {}, [], skippedTags),
    { preserveLines }
  );
  const text = segments.map((segment) => segment.text).join("");
  const hasRichFormatting = segments.some(
    (segment) => segment.bold || segment.italic || segment.underline || segment.strike || segment.code || segment.href
  );
  return {
    text,
    ...(hasRichFormatting ? { segments } : {}),
  };
}

function articleBlockText(node, options = {}) {
  const content = articleInlineContent(node, options);
  if (content.text) return content.text;
  const source = String(node?.structuredText || node?.text || node?.rawText || "");
  if (!source) return "";
  const lines = decodeHtmlEntities(source)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return options.preserveLines ? lines.join("\n") : lines.join(" ");
}

function isArticleParagraphSpacer(node) {
  if (String(node?.tagName || "").toLowerCase() !== "p") return false;
  if ((node.querySelectorAll?.("img, video, audio, iframe, canvas, svg") || []).length) return false;
  const source = decodeHtmlEntities(String(node.rawText || node.text || "")).replaceAll("\u00a0", " ");
  return !source.trim();
}

function extractArticleContentBlocks(contentNode, config) {
  if (!contentNode) return [];

  const blocks = [];
  const skippedTags = new Set(["script", "style", "noscript", "template", "svg"]);
  const textBlockTags = new Set(["p", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const structuralTags = new Set([
    ...textBlockTags,
    "div",
    "section",
    "article",
    "figure",
    "ul",
    "ol",
    "table",
    "img",
  ]);
  let textLength = 0;
  let imageCount = 0;

  const pushText = (type, text, extra = {}) => {
    const normalized = String(text || "").trim();
    if (!normalized || textLength >= MAX_ARTICLE_READER_TEXT_LENGTH || blocks.length >= MAX_ARTICLE_READER_BLOCKS) {
      return;
    }
    const remaining = MAX_ARTICLE_READER_TEXT_LENGTH - textLength;
    const clipped = normalized.slice(0, remaining);
    blocks.push({ type, text: clipped, ...extra });
    textLength += clipped.length;
  };

  const pushImage = (node) => {
    if (imageCount >= MAX_ARTICLE_READER_IMAGES || blocks.length >= MAX_ARTICLE_READER_BLOCKS) return;
    const { originalUrl, readerUrl } = articleImageUrls(node, config);
    if (isArcaTwemojiSvgUrl(readerUrl || originalUrl, config.baseUrl)) return;
    if (!originalUrl) return;
    blocks.push({
      type: "image",
      src: originalUrl,
      readerSrc: readerUrl,
      alt: decodeHtmlEntities(node?.getAttribute?.("alt") || "게시글 이미지"),
    });
    imageCount += 1;
  };

  const clippedInlineContent = (node, options = {}) => {
    if (textLength >= MAX_ARTICLE_READER_TEXT_LENGTH) return null;
    const content = articleInlineContent(node, { ...options, baseUrl: config.baseUrl });
    if (!content.text) return null;
    const remaining = MAX_ARTICLE_READER_TEXT_LENGTH - textLength;
    const text = content.text.slice(0, remaining);
    if (!text) return null;
    let segments;
    if (content.segments) {
      let segmentRemaining = text.length;
      segments = [];
      for (const segment of content.segments) {
        if (segmentRemaining <= 0) break;
        const segmentText = segment.text.slice(0, segmentRemaining);
        if (segmentText) segments.push({ ...segment, text: segmentText });
        segmentRemaining -= segmentText.length;
      }
    }
    textLength += text.length;
    return { text, ...(segments?.length ? { segments } : {}) };
  };

  const pushInlineBlock = (type, content, extra = {}) => {
    if (!content || blocks.length >= MAX_ARTICLE_READER_BLOCKS) return;
    blocks.push({ type, text: content.text, ...(content.segments ? { segments: content.segments } : {}), ...extra });
  };

  const pushList = (node, ordered) => {
    if (blocks.length >= MAX_ARTICLE_READER_BLOCKS) return;
    const itemNodes = (node.childNodes || [])
      .filter((child) => String(child?.tagName || "").toLowerCase() === "li")
      .slice(0, MAX_ARTICLE_LIST_ITEMS);
    const items = itemNodes
      .map((item) => clippedInlineContent(item, { skippedTags: new Set(["ul", "ol", "table"]) }))
      .filter(Boolean);
    if (items.length) blocks.push({ type: "list", ordered: Boolean(ordered), items });
  };

  const pushTable = (node) => {
    if (blocks.length >= MAX_ARTICLE_READER_BLOCKS) return;
    const parsedRows = [];
    for (const row of (node.querySelectorAll?.("tr") || []).slice(0, MAX_ARTICLE_TABLE_ROWS)) {
      const directCells = (row.childNodes || []).filter((cell) =>
        ["th", "td"].includes(String(cell?.tagName || "").toLowerCase())
      );
      const cellNodes = (directCells.length ? directCells : row.querySelectorAll?.("th, td") || []).slice(
        0,
        MAX_ARTICLE_TABLE_COLUMNS
      );
      const cells = cellNodes
        .map((cell) => {
          const content = clippedInlineContent(cell);
          if (!content) return null;
          const colSpan = Math.min(Math.max(parseInteger(cell.getAttribute?.("colspan")) || 1, 1), MAX_ARTICLE_TABLE_COLUMNS);
          const rowSpan = Math.min(Math.max(parseInteger(cell.getAttribute?.("rowspan")) || 1, 1), MAX_ARTICLE_TABLE_ROWS);
          return {
            ...content,
            ...(String(cell?.tagName || "").toLowerCase() === "th" ? { header: true } : {}),
            ...(colSpan > 1 ? { colSpan } : {}),
            ...(rowSpan > 1 ? { rowSpan } : {}),
          };
        })
        .filter(Boolean);
      if (cells.length) {
        parsedRows.push({
          cells,
          hasHeader: cellNodes.some((cell) => String(cell?.tagName || "").toLowerCase() === "th"),
        });
      }
      if (textLength >= MAX_ARTICLE_READER_TEXT_LENGTH) break;
    }
    if (!parsedRows.length) return;
    const firstRowIsHeader = parsedRows[0].hasHeader;
    blocks.push({
      type: "table",
      headers: firstRowIsHeader ? parsedRows[0].cells : [],
      rows: parsedRows.slice(firstRowIsHeader ? 1 : 0).map((row) => row.cells),
    });
  };

  const visit = (node) => {
    if (!node || blocks.length >= MAX_ARTICLE_READER_BLOCKS) return;
    const tagName = String(node.tagName || "").toLowerCase();
    if (skippedTags.has(tagName)) return;
    if (tagName === "img") {
      pushImage(node);
      return;
    }

    if (tagName === "ul" || tagName === "ol") {
      pushList(node, tagName === "ol");
      for (const image of node.querySelectorAll?.("img") || []) pushImage(image);
      return;
    }

    if (tagName === "table") {
      pushTable(node);
      for (const image of node.querySelectorAll?.("img") || []) pushImage(image);
      return;
    }

    if (textBlockTags.has(tagName)) {
      const type = tagName === "blockquote" ? "quote" : tagName === "pre" ? "pre" : /^h[1-6]$/.test(tagName) ? "heading" : "paragraph";
      const content = clippedInlineContent(node, { preserveLines: tagName === "pre" });
      if (content) {
        pushInlineBlock(type, content, type === "heading" ? { level: Number(tagName.slice(1)) || 2 } : {});
      } else if (isArticleParagraphSpacer(node)) {
        blocks.push({ type: "spacer" });
      }
      for (const image of node.querySelectorAll?.("img") || []) pushImage(image);
      return;
    }

    const children = Array.isArray(node.childNodes) ? node.childNodes : [];
    const hasStructuralChild = children.some((child) => structuralTags.has(String(child?.tagName || "").toLowerCase()));
    if (tagName && !hasStructuralChild) {
      pushInlineBlock("paragraph", clippedInlineContent(node));
      return;
    }
    if (!tagName) {
      pushText("paragraph", articleBlockText(node, { baseUrl: config.baseUrl }));
      return;
    }
    children.forEach(visit);
  };

  const children = Array.isArray(contentNode.childNodes) ? contentNode.childNodes : [];
  children.forEach(visit);
  if (!blocks.length) pushInlineBlock("paragraph", clippedInlineContent(contentNode));
  return blocks;
}

function categoryNameFromHref(href) {
  if (!href) return "";
  try {
    const url = new URL(href, DEFAULT_BASE_URL);
    return url.searchParams.get("category") || "";
  } catch {
    return "";
  }
}

function formatBoardTime(isoString, fallback = "") {
  if (!isoString) return fallback;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return fallback;
  const timeZone = "Asia/Seoul";
  const parts = (value, options) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, ...options })
        .formatToParts(value)
        .map((part) => [part.type, part.value])
    );
  const nowParts = parts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
  const dateParts = parts(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const sameDay =
    nowParts.year === dateParts.year &&
    nowParts.month === dateParts.month &&
    nowParts.day === dateParts.day;
  if (sameDay) return `${dateParts.hour}:${dateParts.minute}`;
  return `${dateParts.year}.${dateParts.month}.${dateParts.day}`;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return DEFAULT_BASE_URL;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function normalizeChannel(value) {
  const channel = String(value || process.env.ARCA_CHANNEL || DEFAULT_CHANNEL).trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(channel) ? channel : "";
}

function getConfig() {
  return {
    baseUrl: normalizeBaseUrl(process.env.ARCA_BASE_URL),
    defaultChannel: normalizeChannel(process.env.ARCA_CHANNEL) || DEFAULT_CHANNEL,
    authSessionConfigured: Boolean(getArcaCookieHeader()),
    userAgentConfigured: Boolean(process.env.ARCA_USER_AGENT),
  };
}

function issue(code, status, message, recovery = "") {
  return { code, status, message, recovery };
}

function buildHeaders({ referer = "" } = {}) {
  const cookieHeader = getArcaCookieHeader();
  const headers = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
    "user-agent":
      process.env.ARCA_USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) FinanceAgentGUI/0.1 Safari/537.36",
  };
  if (referer) headers.referer = referer;
  if (cookieHeader) headers.cookie = cookieHeader;
  return headers;
}

function buildNotificationUrl(config) {
  return new URL("/u/notification", config.baseUrl);
}

function buildNotificationProbeUrl(config) {
  return new URL(`/b/${config.defaultChannel}`, config.baseUrl);
}

function buildNotificationReadAllUrl(config) {
  return new URL("/api/notification", config.baseUrl);
}

export function isArcaLoginPage(response, html) {
  const finalUrl = String(response?.url || "");
  const source = String(html || "");
  return /\/u\/login(?:[/?#]|$)/i.test(finalUrl) || /name=["']password["']|login-form/i.test(source);
}

function firstPositiveIntegerFromSelectors(root, selectors) {
  for (const selector of selectors) {
    for (const node of root.querySelectorAll(selector)) {
      const count = parseInteger(nodeText(node));
      if (count && count > 0) return { count, source: selector };
    }
  }
  return null;
}

function countUniqueNotificationNodes(root, selectors) {
  const seen = new Set();
  for (const selector of selectors) {
    for (const node of root.querySelectorAll(selector)) {
      const key =
        node.getAttribute("href") ||
        node.getAttribute("data-id") ||
        node.getAttribute("data-notification-id") ||
        nodeText(node);
      const normalized = String(key || "").replace(/\s+/g, " ").trim();
      if (normalized) seen.add(normalized);
    }
  }
  return seen.size;
}

function countUnreadNotificationSections(root) {
  let count = 0;
  for (const row of root.querySelectorAll(".notification-items .row.section, .user-notification .row.section")) {
    const rowText = nodeText(row);
    const iconClass = String(row.querySelector(".vrow-icon")?.getAttribute("class") || "");
    const contentClass = String(row.querySelector(".col.row")?.getAttribute("class") || "");
    if (!rowText) continue;
    if (/\bread\b/.test(iconClass) || /\bread\b/.test(contentClass)) continue;
    count += 1;
  }
  return count;
}

function extractNotificationCount(html) {
  const root = parse(html);
  const pageText = nodeText(root);

  const explicit = firstPositiveIntegerFromSelectors(root, [
    ".notification-count",
    ".notifications-count",
    ".notification-badge",
    ".notify-count",
    ".noti-count",
    ".badge-notification",
    ".badge-danger",
    "[data-notification-count]",
    "[data-unread-count]",
  ]);
  if (explicit) return { count: explicit.count, source: `explicit:${explicit.source}` };

  for (const node of root.querySelectorAll("[data-notification-count], [data-unread-count]")) {
    const count = parseInteger(node.getAttribute("data-notification-count") || node.getAttribute("data-unread-count"));
    if (count && count > 0) return { count, source: "explicit:data-attribute" };
  }

  const unreadCount = countUniqueNotificationNodes(root, [
    ".notification-item.unread",
    ".notification-list .unread",
    ".noti-item.unread",
    ".notify-item.unread",
    ".unread-notification",
    ".is-unread",
  ]);
  if (unreadCount > 0) return { count: unreadCount, source: "unread-selector" };

  const unreadSections = countUnreadNotificationSections(root);
  if (unreadSections > 0) return { count: unreadSections, source: "unread-section" };

  if (/알림이 없습니다|새로운 알림이 없습니다|받은 알림이 없습니다|no notifications/i.test(pageText)) {
    return { count: 0, source: "empty-message" };
  }

  return { count: 0, source: "no-unread-marker" };
}

function arcaNotificationArticleTarget(href, baseUrl) {
  const absolute = absoluteArcaUrl(href, baseUrl);
  if (!absolute) return null;
  try {
    const url = new URL(absolute);
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== base.hostname) return null;
    const match = url.pathname.match(/^\/b\/([A-Za-z0-9_-]{1,64})\/(\d+)(?:\/(\d+))?\/?$/);
    if (!match) return null;
    return {
      url: url.toString(),
      channel: match[1],
      articleId: match[2],
      commentId: match[3] || "",
    };
  } catch {
    return null;
  }
}

export function extractArcaNotificationsFromHtml(html, { baseUrl = DEFAULT_BASE_URL } = {}) {
  const root = parse(String(html || ""));
  const parsedCount = extractNotificationCount(html);
  const rows = root.querySelectorAll(".notification-items .row.section, .user-notification .row.section");
  const items = [];

  for (const row of rows) {
    if (items.length >= MAX_ARCA_NOTIFICATION_ITEMS) break;
    const contentNode = row.querySelector(".col.row") || row;
    const iconNode = row.querySelector(".vrow-icon");
    const targetEntry = row
      .querySelectorAll("a[href]")
      .map((link) => ({ link, target: arcaNotificationArticleTarget(link.getAttribute("href"), baseUrl) }))
      .find((entry) => entry.target);
    if (!targetEntry) continue;

    const authorLink = row.querySelector("a[data-filter]") || row.querySelector('a[href^="/u/@"]');
    const timeNode = row.querySelector("time");
    const checkbox = row.querySelector('input[name="notification-item"]');
    const unread = !parseBooleanClass(iconNode, "read") && !parseBooleanClass(contentNode, "read");
    const title = nodeText(targetEntry.link) || "알림 대상 글";
    const createdAt = String(timeNode?.getAttribute("datetime") || "").trim();

    items.push({
      id:
        String(checkbox?.getAttribute("value") || "").trim() ||
        `${targetEntry.target.channel}:${targetEntry.target.articleId}:${targetEntry.target.commentId || createdAt}`,
      unread,
      title,
      summary: nodeText(contentNode) || title,
      author: String(authorLink?.getAttribute("data-filter") || nodeText(authorLink) || "").trim(),
      createdAt,
      targetUrl: targetEntry.target.url,
      channel: targetEntry.target.channel,
      articleId: targetEntry.target.articleId,
      commentId: targetEntry.target.commentId,
      isStockChannel: targetEntry.target.channel === DEFAULT_CHANNEL,
    });
  }

  return {
    count: parsedCount.count,
    countSource: parsedCount.source,
    items,
  };
}

function notificationTimeIso(value) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function normalizeArcaNotificationApiPayload(payload, { baseUrl = DEFAULT_BASE_URL } = {}) {
  const rows = Array.isArray(payload?.notifications) ? payload.notifications : [];
  const items = [];

  for (const [index, row] of rows.entries()) {
    if (items.length >= MAX_ARCA_NOTIFICATION_ITEMS) break;
    const target = arcaNotificationArticleTarget(row?.link, baseUrl);
    if (!target) continue;
    const createdAt = notificationTimeIso(row?.time);
    const title = String(row?.title || "").replace(/\s+/g, " ").trim() || "알림 대상 글";
    const author = String(row?.username || "").trim();
    items.push({
      id: `${target.channel}:${target.articleId}:${target.commentId || createdAt || index}`,
      unread: !Boolean(row?.isRead),
      type: String(row?.type || "").trim(),
      title,
      summary: title,
      author,
      createdAt,
      targetUrl: target.url,
      channel: target.channel,
      articleId: target.articleId,
      commentId: target.commentId,
      isStockChannel: target.channel === DEFAULT_CHANNEL,
    });
  }

  return {
    items,
    unreadCount: items.reduce((count, item) => count + (item.unread ? 1 : 0), 0),
  };
}

async function readNotificationApiItems(config, notificationUrl) {
  const url = buildNotificationReadAllUrl(config);
  let response;
  let body = "";
  try {
    response = await fetchWithTimeout(url, {
      headers: {
        ...buildHeaders({ referer: notificationUrl.toString() }),
        accept: "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
      },
      redirect: "follow",
    });
    body = await readTextSafely(response);
  } catch {
    return null;
  }
  if (!response.ok || isCloudflareChallenge(response, body)) return null;
  try {
    return normalizeArcaNotificationApiPayload(JSON.parse(body), { baseUrl: config.baseUrl });
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readTextSafely(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function isCloudflareChallenge(response, html) {
  const mitigated = response.headers.get("cf-mitigated") || "";
  return (
    mitigated.toLowerCase() === "challenge" ||
    (response.status === 403 && /challenges\.cloudflare\.com|cf-ray|Just a moment/i.test(html))
  );
}

function extractPageTitle(html) {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : "";
}

function metaContent(root, selectors) {
  for (const selector of selectors) {
    const value = root.querySelector(selector)?.getAttribute("content");
    if (value) return decodeHtmlEntities(value);
  }
  return "";
}

function normalizeArticleUrl(payload = {}, config) {
  const rawUrl = String(payload.url || payload.href || "").trim();
  const channel = normalizeChannel(payload.channel) || config.defaultChannel;
  const id = parseInteger(payload.id);
  let url;

  try {
    url = rawUrl ? new URL(rawUrl, config.baseUrl) : id ? new URL(`/b/${channel}/${id}`, config.baseUrl) : null;
  } catch {
    return null;
  }

  if (!url) return null;
  const baseUrl = new URL(config.baseUrl);
  if (url.origin !== baseUrl.origin) return null;
  if (!/^\/b\/[A-Za-z0-9_-]+\/\d+/.test(url.pathname)) return null;
  return url;
}

function extractCategories(html, channel) {
  const categories = [];
  const seen = new Set();
  const pattern = new RegExp(
    `<a\\b[^>]*href=["']/b/${escapeRegExp(channel)}\\?category=([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>`,
    "gi"
  );
  for (const match of String(html).matchAll(pattern)) {
    const name = decodeURIComponent(match[1]);
    if (seen.has(name)) continue;
    seen.add(name);
    categories.push({ name, label: stripTags(match[2]) || name });
  }
  return categories;
}

function extractBoardCategories(root) {
  const categories = [];
  const seen = new Set();
  for (const link of root.querySelectorAll(".board-category a")) {
    const href = link.getAttribute("href") || "";
    const name = categoryNameFromHref(href);
    if (seen.has(name)) continue;
    seen.add(name);
    categories.push({
      name,
      label: nodeText(link) || (name ? name : "전체"),
      active: parseBooleanClass(link, "active"),
    });
  }
  return categories;
}

function extractPagination(root) {
  return root.querySelectorAll(".pagination .page-link").map((link, index, links) => {
    const href = link.getAttribute("href") || "";
    const text = nodeText(link);
    let label = text;
    if (!label && index === links.length - 2) label = ">";
    if (!label && index === links.length - 1) label = ">>";
    let page = null;
    try {
      const url = new URL(href, DEFAULT_BASE_URL);
      page = parseInteger(url.searchParams.get("p"));
    } catch {
      page = null;
    }
    return {
      label,
      page,
      href,
      active: parseBooleanClass(link.parentNode, "active"),
      disabled: parseBooleanClass(link.parentNode, "disabled"),
    };
  });
}

function extractArticleRows(root, config, channel) {
  const rows = [];
  for (const row of root.querySelectorAll("a.vrow.column")) {
    const classNames = row.classNames || [];
    const href = row.getAttribute("href") || "";
    const isAd = classNames.includes("notice-service");
    const isNotice = classNames.includes("notice") && !isAd;
    const isHidden = classNames.includes("filtered") || classNames.includes("filtered-notice");
    const idText = nodeText(row.querySelector(".col-id"));
    const title = nodeText(row.querySelector(".title")) || nodeText(row.querySelector(".col-title"));
    const categoryLabel = nodeText(row.querySelector(".badges .badge")) || nodeText(row.querySelector(".col-ad .badge"));
    const commentText = nodeText(row.querySelector(".comment-count"));
    const authorNode = row.querySelector(".col-author [data-filter]");
    const author = authorNode?.getAttribute("data-filter") || nodeText(row.querySelector(".col-author"));
    const timeNode = row.querySelector("time");
    const timeIso = timeNode?.getAttribute("datetime") || "";
    const timeText = nodeText(timeNode) || nodeText(row.querySelector(".col-time"));
    const id = parseInteger(idText);
    const view = parseInteger(nodeText(row.querySelector(".col-view")));
    const rate = parseInteger(nodeText(row.querySelector(".col-rate")));
    const commentCount = parseInteger(commentText);

    if (!title && !idText) continue;

    rows.push({
      id,
      number: idText,
      type: isAd ? "ad" : isNotice ? "notice" : "article",
      hidden: isHidden,
      title,
      categoryLabel,
      commentCount,
      author,
      authorFixed: Boolean(row.querySelector(".user-fixed")),
      authorManager: Boolean(row.querySelector(".user-manager")),
      accountUser: Boolean(row.querySelector(".ion-android-person")),
      timeIso,
      timeLabel: formatBoardTime(timeIso, timeText),
      view,
      rate,
      href: absoluteArcaUrl(href, config.baseUrl),
      rawHref: href,
      channel,
    });
  }
  return rows;
}

function extractArticleDetail(root, config, url) {
  const pageTitle = metaContent(root, ['meta[property="og:title"]', 'meta[name="title"]']) || "";
  const description =
    metaContent(root, ['meta[property="og:description"]', 'meta[name="description"]']) || "";
  const author = metaContent(root, ['meta[name="author"]']) || nodeText(root.querySelector(".article-info .user-info"));
  const contentNode = root.querySelector(".article-content") || root.querySelector(".article-body");
  const contentHtml = String(contentNode?.innerHTML || "").trim();
  const contentTextFull = articleBlockText(contentNode, { baseUrl: config.baseUrl }) || description;
  const contentBlocks = extractArticleContentBlocks(contentNode, config);
  const imageSources = (contentNode?.querySelectorAll("img") || [])
    .map((image) => articleImageUrls(image, config))
    .filter(
      (image) => image.originalUrl && !isArcaTwemojiSvgUrl(image.readerUrl || image.originalUrl, config.baseUrl)
    )
    .slice(0, MAX_ARTICLE_READER_IMAGES);
  const imageUrls = imageSources.map((image) => image.originalUrl);
  const readerImageSourceUrls = imageSources.map((image) => image.readerUrl);
  const canonicalHref =
    root.querySelector(".article-link a")?.getAttribute("href") ||
    metaContent(root, ['meta[property="og:url"]']) ||
    url.toString();
  const title = pageTitle.replace(/\s+-\s+.+$/, "").trim() || extractPageTitle(root.toString()).replace(/\s+-\s+.+$/, "").trim();
  const commentCount = parseInteger(nodeText(root.querySelector(".comment-count")));
  const timeNode = root.querySelector(".article-info time") || root.querySelector("time");
  const timeIso = timeNode?.getAttribute("datetime") || "";

  return {
    title,
    author,
    description,
    contentText: contentTextFull.slice(0, MAX_ARTICLE_CONTEXT_LENGTH),
    contentLength: contentTextFull.length,
    contentTruncated: contentTextFull.length > MAX_ARTICLE_CONTEXT_LENGTH,
    contentHtml,
    contentBlocks,
    imageUrls,
    readerImageSourceUrls,
    imageCount: imageUrls.length,
    commentCount,
    timeIso,
    url: absoluteArcaUrl(canonicalHref, config.baseUrl) || url.toString(),
  };
}

function commentParentId(commentNode) {
  const href = commentNode.querySelector('.info-row a[href*="#c_"]')?.getAttribute("href") || "";
  return href.match(/#c_(\d+)/)?.[1] || null;
}

function commentMedia(commentNode, config) {
  return commentNode.querySelectorAll(".message .emoticon").map((node) => {
    const tagName = String(node.tagName || "").toLowerCase();
    const source = safeArticleAssetUrl(node.getAttribute("src"), config.baseUrl);
    const posterSource = safeArticleAssetUrl(node.getAttribute("poster"), config.baseUrl);
    return {
      attachmentId: parseInteger(node.getAttribute("data-id")),
      type: tagName === "video" || /\.mp4(?:[?#]|$)/i.test(source) ? "video" : "image",
      src: source ? arcaMediaProxyPath(source) : "",
      poster: posterSource ? arcaMediaProxyPath(posterSource) : "",
    };
  }).filter((media) => media.src);
}

function commentDepth(comment, commentsById) {
  let depth = 0;
  let parentId = comment.parentId;
  const visited = new Set([comment.id]);
  while (parentId && depth < 12 && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = commentsById.get(parentId)?.parentId || null;
  }
  return depth;
}

function commentLinkContent(commentNode, baseUrl) {
  const cardNodes = commentNode
    .querySelectorAll("a.link-card-link")
    .filter((node) => node.querySelector(".link-card"));
  const cardsHtml = cardNodes.map((node) => node.toString()).join("\n").trim();
  const links = [];
  const seen = new Set();
  const hiddenTextNodes = commentNode
    .querySelectorAll(".text")
    .filter((node) => node.classNames.includes("d-none"));
  for (const hiddenTextNode of hiddenTextNodes) {
    const preNodes = hiddenTextNode.querySelectorAll("pre");
    const rawContents = preNodes.length
      ? preNodes.map((node) => node.innerHTML)
      : [hiddenTextNode.innerHTML];
    for (const rawContent of rawContents) {
      for (const node of parse(rawContent).querySelectorAll("a")) {
        const href = safeArticleAssetUrl(node.getAttribute("href"), baseUrl);
        if (!href || seen.has(href)) continue;
        seen.add(href);
        links.push({ href, label: nodeText(node) || href });
      }
    }
  }
  return { cardsHtml, links };
}

export function extractArcaCommentsFromHtml(
  html,
  { baseUrl = DEFAULT_BASE_URL } = {}
) {
  const config = { baseUrl: normalizeBaseUrl(baseUrl) };
  const root = parse(String(html || ""));
  const form = root.querySelector("#commentForm, form.reply-form.write");
  const comments = root.querySelectorAll(".comment-item").map((commentNode) => {
    const id = String(commentNode.getAttribute("id") || "").replace(/^c_/, "");
    const userInfo = commentNode.querySelector(".user-info");
    const authorNode = userInfo?.querySelector("[data-filter]");
    const messageTextNode = commentNode.querySelector(".message .text");
    const textNode = messageTextNode?.querySelector("pre") || messageTextNode;
    const linkContent = commentLinkContent(commentNode, config.baseUrl);
    const timeNode = commentNode.querySelector(".info-row time, time");
    const avatarNode = commentNode.querySelector(".avatar img");
    const avatarSource = safeArticleAssetUrl(avatarNode?.getAttribute("src"), config.baseUrl);
    return {
      id,
      parentId: commentParentId(commentNode),
      author: decodeHtmlEntities(authorNode?.getAttribute("data-filter") || nodeText(userInfo)),
      authorFixed: Boolean(userInfo?.querySelector(".user-fixed")),
      authorManager: Boolean(userInfo?.querySelector(".user-manager")),
      articleAuthor: Boolean(userInfo?.classNames?.includes("author")),
      accountUser: Boolean(userInfo?.querySelector(".ion-android-person")),
      timeIso: timeNode?.getAttribute("datetime") || "",
      text: decodeHtmlEntities(String(textNode?.structuredText || textNode?.text || "").trim()),
      html: [linkContent.cardsHtml, String(messageTextNode?.innerHTML || textNode?.innerHTML || "").trim()]
        .filter(Boolean)
        .join("\n"),
      links: linkContent.links,
      hasLinkCard: Boolean(linkContent.cardsHtml),
      deleted: Boolean(commentNode.querySelector(".deleted, .message.deleted")),
      avatar: avatarSource && isAllowedArcaImageProxyUrl(avatarSource, config.baseUrl)
        ? arcaMediaProxyPath(avatarSource)
        : "",
      emoticons: commentMedia(commentNode, config),
    };
  }).filter((comment) => /^\d+$/.test(comment.id));
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const currentUser = form?.querySelector(".reply-form-user-input")?.getAttribute("value") || "";
  const canComment = Boolean(form?.querySelector('input[name="_csrf"]')?.getAttribute("value"));

  return {
    comments: comments.map((comment) => ({ ...comment, depth: commentDepth(comment, commentsById) })),
    commenting: {
      canComment,
      currentUser: decodeHtmlEntities(currentUser),
      maxLength: MAX_COMMENT_LENGTH,
      supportsEmoticons: canComment,
      supportsVoice: false,
    },
  };
}

export function extractArcaArticleDetailFromHtml(
  html,
  { url = `${DEFAULT_BASE_URL}/b/${DEFAULT_CHANNEL}/1`, baseUrl = DEFAULT_BASE_URL } = {}
) {
  return extractArticleDetail(parse(String(html || "")), { baseUrl: normalizeBaseUrl(baseUrl) }, new URL(url));
}

function buildArticleListUrl(config, payload) {
  const channel = normalizeChannel(payload.channel) || config.defaultChannel;
  const url = new URL(`${config.baseUrl}/b/${channel}`);
  const page = Math.max(1, parseInteger(payload.page) || 1);
  url.searchParams.set("p", String(page));

  const category = String(payload.category || "").trim();
  if (category) url.searchParams.set("category", category);
  if (payload.best) url.searchParams.set("mode", "best");

  const sort = String(payload.sort || "").trim();
  if (sort && ["rating", "rating72", "ratingAll", "commentCount", "recentComment"].includes(sort)) {
    url.searchParams.set("sort", sort);
  }

  const cutRate = parseInteger(payload.cutRate);
  if (cutRate) url.searchParams.set("cut", String(cutRate));

  const keyword = String(payload.keyword || "").trim();
  const target = String(payload.target || "all").trim();
  if (keyword) {
    url.searchParams.set("keyword", keyword);
    url.searchParams.set(
      "target",
      ["all", "title_content", "title", "content", "nickname"].includes(target) ? target : "all"
    );
  }

  return { channel, page, url };
}

async function listChannelArticles(payload = {}) {
  const config = getConfig();
  const { channel, page, url } = buildArticleListUrl(config, payload);
  const issues = [];

  if (!channel) {
    return {
      ok: false,
      config,
      issues: [issue("ARCA_CHANNEL_INVALID", "error", "채널 ID가 비어 있거나 허용되지 않는 문자입니다.")],
    };
  }

  let response;
  let html = "";
  try {
    response = await fetchWithTimeout(url, {
      headers: buildHeaders(),
      redirect: "follow",
    });
    html = await readTextSafely(response);
  } catch (error) {
    return {
      ok: false,
      config,
      channel,
      endpoint: url.toString(),
      issues: [issue("ARCA_NETWORK_FAILED", "error", `아카라이브 글 목록 조회 실패: ${error.message}`)],
    };
  }

  if (isCloudflareChallenge(response, html)) {
    issues.push(
      issue(
        "ARCA_CLOUDFLARE_CHALLENGE",
        "error",
        "Cloudflare challenge로 글 목록 조회가 차단되었습니다.",
        "잠시 후 수동 갱신하거나 아카라이브 공식 페이지에서 직접 확인하세요."
      )
    );
  } else if (!response.ok) {
    issues.push(issue("ARCA_HTTP_ERROR", "error", `아카라이브가 HTTP ${response.status}를 반환했습니다.`));
  }

  const root = parse(html);
  const rows = extractArticleRows(root, config, channel);
  const visibleRows = rows.filter((row) => !row.hidden);
  const hiddenNoticeRows = rows.filter((row) => row.hidden && row.type === "notice");

  return {
    ok: response.ok && !issues.some((item) => item.status === "error"),
    config,
    channel,
    endpoint: url.toString(),
    status: response.status,
    page,
    pageTitle: extractPageTitle(html),
    categories: extractBoardCategories(root),
    notices: visibleRows.filter((row) => row.type === "notice"),
    ads: visibleRows.filter((row) => row.type === "ad"),
    articles: visibleRows.filter((row) => row.type === "article"),
    hiddenNotices: hiddenNoticeRows,
    pagination: extractPagination(root),
    issues,
    fetchedAt: new Date().toISOString(),
  };
}

async function readArticleDetail(payload = {}) {
  const config = getConfig();
  const url = normalizeArticleUrl(payload, config);
  const issues = [];

  if (!url) {
    return {
      ok: false,
      config,
      issues: [issue("ARCA_ARTICLE_URL_INVALID", "error", "허용된 아카라이브 게시글 URL이 아닙니다.")],
    };
  }

  let response;
  let html = "";
  try {
    response = await fetchWithTimeout(url, {
      headers: buildHeaders({ referer: `${config.baseUrl}/b/${config.defaultChannel}` }),
      redirect: "follow",
    });
    html = await readTextSafely(response);
  } catch (error) {
    return {
      ok: false,
      config,
      endpoint: url.toString(),
      issues: [issue("ARCA_ARTICLE_NETWORK_FAILED", "error", `게시글 본문 조회 실패: ${error.message}`)],
    };
  }

  if (isCloudflareChallenge(response, html)) {
    issues.push(
      issue(
        "ARCA_CLOUDFLARE_CHALLENGE",
        "error",
        "Cloudflare challenge로 게시글 본문 조회가 차단되었습니다.",
        "아카라이브 공식 페이지에서 직접 확인하거나 잠시 후 다시 시도하세요."
      )
    );
  } else if (!response.ok) {
    issues.push(issue("ARCA_HTTP_ERROR", "error", `아카라이브가 HTTP ${response.status}를 반환했습니다.`));
  }

  const root = parse(html);
  const commentData = extractArcaCommentsFromHtml(html, { baseUrl: config.baseUrl });
  return {
    ok: response.ok && !issues.some((item) => item.status === "error"),
    config,
    endpoint: url.toString(),
    status: response.status,
    article: {
      ...withArcaReaderImageProxies(extractArticleDetail(root, config, url)),
      ...commentData,
      commenting: {
        ...commentData.commenting,
        signedIn: config.authSessionConfigured,
      },
    },
    issues,
    fetchedAt: new Date().toISOString(),
  };
}

async function readArticleComments(payload = {}) {
  const config = getConfig();
  const url = normalizeArticleUrl(payload, config);
  if (!url) {
    return {
      ok: false,
      issues: [issue("ARCA_ARTICLE_URL_INVALID", "error", "허용된 아카라이브 게시글 URL이 아닙니다.")],
    };
  }

  let response;
  let html = "";
  try {
    response = await fetchWithTimeout(url, {
      headers: buildHeaders({ referer: `${config.baseUrl}/b/${config.defaultChannel}` }),
      redirect: "follow",
    });
    html = await readTextSafely(response);
  } catch (error) {
    return {
      ok: false,
      endpoint: url.toString(),
      issues: [issue("ARCA_COMMENT_NETWORK_FAILED", "error", `댓글 조회 실패: ${error.message}`)],
    };
  }

  if (isCloudflareChallenge(response, html)) {
    return {
      ok: false,
      endpoint: url.toString(),
      status: response.status,
      issues: [issue("ARCA_CLOUDFLARE_CHALLENGE", "error", "Cloudflare challenge로 댓글 조회가 차단되었습니다.")],
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      endpoint: url.toString(),
      status: response.status,
      issues: [issue("ARCA_HTTP_ERROR", "error", `아카라이브가 HTTP ${response.status}를 반환했습니다.`)],
    };
  }

  const commentData = extractArcaCommentsFromHtml(html, { baseUrl: config.baseUrl });
  return {
    ok: true,
    endpoint: url.toString(),
    status: response.status,
    ...commentData,
    commenting: {
      ...commentData.commenting,
      signedIn: config.authSessionConfigured,
    },
    fetchedAt: new Date().toISOString(),
  };
}

function normalizedEmoticonSelection(value) {
  const emoticonId = parseInteger(value?.emoticonId ?? value?.packageId);
  const attachmentId = parseInteger(value?.attachmentId ?? value?.id);
  if (emoticonId == null || emoticonId < 0 || !attachmentId) return null;
  return { emoticonId, attachmentId };
}

export function normalizeArcaCommentWrite(payload = {}) {
  const contentType = payload.contentType === "emoticon" ? "emoticon" : "text";
  const content = String(payload.content || "").trim();
  const parentId = parseInteger(payload.parentId);
  const providedEmoticons = Array.isArray(payload.emoticons) ? payload.emoticons : [];
  const emoticons = (providedEmoticons.length
    ? providedEmoticons
    : [{ emoticonId: payload.emoticonId, attachmentId: payload.attachmentId }]
  ).map(normalizedEmoticonSelection);

  if (contentType === "text" && (!content || content.length > MAX_COMMENT_LENGTH)) return null;
  if (
    contentType === "emoticon" &&
    (!emoticons.length || emoticons.length > MAX_COMBO_EMOTICONS || emoticons.some((item) => !item))
  ) return null;
  if (payload.parentId != null && payload.parentId !== "" && !parentId) return null;
  return {
    contentType,
    content,
    parentId,
    emoticons: contentType === "emoticon" ? emoticons : [],
  };
}

export function buildArcaCommentFormData(comment, csrf) {
  const formData = new URLSearchParams({
    _csrf: String(csrf || ""),
    contentType: comment.contentType,
    content: comment.content,
  });
  if (comment.parentId) formData.set("parentId", String(comment.parentId));
  for (const emoticon of comment.emoticons || []) {
    formData.append("emoticonId", String(emoticon.emoticonId));
    formData.append("attachmentId", String(emoticon.attachmentId));
  }
  return formData;
}

function upstreamCommentError(response, body) {
  try {
    const payload = JSON.parse(body);
    if (response.status >= 400 || payload?.result === false || payload?.ok === false) {
      return String(payload.message || payload.error || "").trim();
    }
    return "";
  } catch {
    return response.status >= 400 ? stripTags(body).slice(0, 300) : "";
  }
}

async function postArcaComment(payload = {}) {
  const config = getConfig();
  const url = normalizeArticleUrl(payload, config);
  const comment = normalizeArcaCommentWrite(payload);
  if (!url || !comment) {
    return {
      ok: false,
      issues: [issue("ARCA_COMMENT_INVALID", "error", "댓글 내용 또는 대상이 올바르지 않습니다.")],
    };
  }
  if (!getArcaCookieHeader()) {
    return {
      ok: false,
      issues: [issue("ARCA_AUTH_REQUIRED", "error", "댓글을 작성하려면 설정에서 아카라이브 로그인을 연결해야 합니다.")],
    };
  }

  const before = await readArticleComments({ url: url.toString() });
  if (!before.ok || !before.commenting?.canComment) {
    return {
      ok: false,
      issues: before.issues?.length
        ? before.issues
        : [issue("ARCA_COMMENT_NOT_ALLOWED", "error", "현재 계정이나 게시글에서는 댓글을 작성할 수 없습니다.")],
    };
  }

  let pageResponse;
  let pageHtml = "";
  try {
    pageResponse = await fetchWithTimeout(url, {
      headers: buildHeaders({ referer: `${config.baseUrl}/b/${config.defaultChannel}` }),
      redirect: "follow",
    });
    pageHtml = await readTextSafely(pageResponse);
  } catch (error) {
    return {
      ok: false,
      issues: [issue("ARCA_COMMENT_NETWORK_FAILED", "error", `댓글 작성 준비 실패: ${error.message}`)],
    };
  }

  const root = parse(pageHtml);
  const form = root.querySelector("#commentForm, form.reply-form.write");
  const csrf = form?.querySelector('input[name="_csrf"]')?.getAttribute("value") || "";
  const action = absoluteArcaUrl(form?.getAttribute("action"), config.baseUrl);
  const expectedPath = `${url.pathname.replace(/\/+$/, "")}/comment`;
  let actionUrl;
  try {
    actionUrl = new URL(action);
  } catch {
    actionUrl = null;
  }
  if (!csrf || !actionUrl || actionUrl.origin !== new URL(config.baseUrl).origin || actionUrl.pathname !== expectedPath) {
    return {
      ok: false,
      issues: [issue("ARCA_COMMENT_FORM_CHANGED", "error", "아카라이브 댓글 작성 폼의 규격이 변경되었거나 작성 권한이 없습니다.")],
    };
  }

  const formData = buildArcaCommentFormData(comment, csrf);

  let response;
  let responseBody = "";
  try {
    response = await fetchWithTimeout(actionUrl, {
      method: "POST",
      headers: {
        ...buildHeaders({ referer: url.toString() }),
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: formData,
      redirect: "manual",
    });
    responseBody = await readTextSafely(response);
  } catch (error) {
    return {
      ok: false,
      issues: [issue("ARCA_COMMENT_POST_FAILED", "error", `댓글 작성 요청 실패: ${error.message}`)],
    };
  }

  const upstreamError = upstreamCommentError(response, responseBody);
  if (response.status >= 400 || upstreamError) {
    return {
      ok: false,
      status: response.status,
      issues: [issue("ARCA_COMMENT_REJECTED", "error", upstreamError || `아카라이브가 HTTP ${response.status}를 반환했습니다.`)],
    };
  }

  const after = await readArticleComments({ url: url.toString() });
  const beforeIds = new Set((before.comments || []).map((item) => item.id));
  const createdComment = (after.comments || []).find((item) => {
    if (beforeIds.has(item.id) || String(item.parentId || "") !== String(comment.parentId || "")) return false;
    if (comment.contentType === "text") return item.text.trim() === comment.content;
    const postedIds = comment.emoticons.map((emoticon) => emoticon.attachmentId);
    const renderedIds = (item.emoticons || []).map((media) => media.attachmentId);
    return postedIds.length === renderedIds.length && postedIds.every((id, index) => id === renderedIds[index]);
  });

  return {
    ok: true,
    verified: Boolean(createdComment),
    createdCommentId: createdComment?.id || "",
    comments: after.comments || before.comments || [],
    commenting: after.commenting || before.commenting,
    fetchedAt: after.fetchedAt || new Date().toISOString(),
  };
}

async function readArcaEmoticons(payload = {}) {
  const config = getConfig();
  if (!getArcaCookieHeader()) {
    return {
      ok: false,
      issues: [issue("ARCA_AUTH_REQUIRED", "error", "보유한 아카콘을 불러오려면 아카라이브 로그인이 필요합니다.")],
    };
  }
  const hasPackageId = payload.packageId != null && String(payload.packageId).trim() !== "";
  const packageIdText = String(payload.packageId ?? "").trim();
  if (hasPackageId && !/^\d+$/.test(packageIdText)) {
    return { ok: false, issues: [issue("ARCA_EMOTICON_PACKAGE_INVALID", "error", "아카콘 패키지 ID가 올바르지 않습니다.")] };
  }
  const endpoint = hasPackageId ? `/api/emoticon2/${packageIdText}` : "/api/emoticon";
  const url = new URL(endpoint, config.baseUrl);
  let response;
  let json;
  try {
    response = await fetchWithTimeout(url, {
      headers: {
        ...buildHeaders({ referer: `${config.baseUrl}/b/${config.defaultChannel}` }),
        accept: "application/json",
      },
      redirect: "follow",
    });
    json = await response.json();
  } catch (error) {
    return {
      ok: false,
      issues: [issue("ARCA_EMOTICON_NETWORK_FAILED", "error", `아카콘 조회 실패: ${error.message}`)],
    };
  }
  if (!response.ok || !Array.isArray(json)) {
    return {
      ok: false,
      status: response.status,
      issues: [issue("ARCA_EMOTICON_HTTP_ERROR", "error", `아카콘 서버가 HTTP ${response.status}를 반환했습니다.`)],
    };
  }

  if (!hasPackageId) {
    return {
      ok: true,
      packages: json.map((item) => {
        const source = safeArticleAssetUrl(item.thumbnail, config.baseUrl);
        return {
          id: Number(item.id),
          title: String(item.title || "아카콘"),
          count: Number(item.count || 0),
          thumbnail: source ? arcaMediaProxyPath(source) : "",
        };
      }),
    };
  }

  return {
    ok: true,
    packageId: Number(packageIdText),
    items: json.map((item) => {
      const source = safeArticleAssetUrl(item.imageUrl, config.baseUrl);
      const posterSource = safeArticleAssetUrl(item.poster, config.baseUrl);
      return {
        id: Number(item.id),
        type: item.type === "video" ? "video" : "image",
        src: source ? arcaMediaProxyPath(source) : "",
        poster: posterSource ? arcaMediaProxyPath(posterSource) : "",
      };
    }).filter((item) => item.src),
  };
}

async function proxyArticleImage(payload = {}, req, res) {
  const config = getConfig();
  const rawUrl = String(payload.url || "").trim();
  const controller = new AbortController();
  const clientState = guardArcaImageProxyClient(req, res, controller);
  const sendProxyError = (error, statusCode) => {
    if (canWriteArcaImageProxyResponse(req, res, clientState)) {
      sendJson(res, { ok: false, error }, statusCode);
    }
  };
  if (!isAllowedArcaImageProxyUrl(rawUrl, config.baseUrl)) {
    sendProxyError("허용된 아카라이브 이미지 URL이 아닙니다.", 400);
    return;
  }

  let response;
  let body = null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  try {
    response = await fetch(rawUrl, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: {
        ...buildHeaders({ referer: `${config.baseUrl}/b/${config.defaultChannel}` }),
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (!response.ok) {
      void response.body?.cancel();
      sendProxyError(`게시글 이미지 서버가 HTTP ${response.status}를 반환했습니다.`, 502);
      return;
    }
    if (!/^image\/(?:png|jpe?g|webp|gif|avif|bmp)$/.test(contentType)) {
      void response.body?.cancel();
      sendProxyError("지원하지 않는 게시글 이미지 형식입니다.", 415);
      return;
    }
    if (contentLength > MAX_ARTICLE_IMAGE_BYTES) {
      void response.body?.cancel();
      sendProxyError("게시글 이미지가 허용 크기를 초과했습니다.", 413);
      return;
    }

    if (req.method !== "HEAD") {
      body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_ARTICLE_IMAGE_BYTES) {
        sendProxyError("게시글 이미지가 허용 크기를 초과했습니다.", 413);
        return;
      }
    }

    if (!canWriteArcaImageProxyResponse(req, res, clientState)) return;
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    if (body) {
      res.setHeader("Content-Length", String(body.length));
    } else if (contentLength > 0) {
      res.setHeader("Content-Length", String(contentLength));
    }
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(body || undefined);
  } catch (error) {
    if (clientState.disconnected) return;
    sendProxyError(
      timedOut ? "게시글 이미지 조회 시간이 초과되었습니다." : `게시글 이미지 조회 실패: ${error.message}`,
      502
    );
  } finally {
    clearTimeout(timer);
  }
}

async function proxyArcaMedia(payload = {}, req, res) {
  const config = getConfig();
  const rawUrl = String(payload.url || "").trim();
  const controller = new AbortController();
  const clientState = guardArcaImageProxyClient(req, res, controller);
  const sendProxyError = (error, statusCode) => {
    if (canWriteArcaImageProxyResponse(req, res, clientState)) sendJson(res, { ok: false, error }, statusCode);
  };
  if (!isAllowedArcaImageProxyUrl(rawUrl, config.baseUrl)) {
    sendProxyError("허용된 아카라이브 미디어 URL이 아닙니다.", 400);
    return;
  }

  let response;
  let body = null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  try {
    response = await fetch(rawUrl, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: {
        ...buildHeaders({ referer: `${config.baseUrl}/b/${config.defaultChannel}` }),
        accept: "video/mp4,video/webm,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (!response.ok) {
      void response.body?.cancel();
      sendProxyError(`아카라이브 미디어 서버가 HTTP ${response.status}를 반환했습니다.`, 502);
      return;
    }
    if (!/^(?:image\/(?:png|jpe?g|webp|gif|avif|bmp)|video\/(?:mp4|webm))$/.test(contentType)) {
      void response.body?.cancel();
      sendProxyError("지원하지 않는 아카라이브 미디어 형식입니다.", 415);
      return;
    }
    if (contentLength > MAX_ARCA_MEDIA_BYTES) {
      void response.body?.cancel();
      sendProxyError("아카라이브 미디어가 허용 크기를 초과했습니다.", 413);
      return;
    }
    if (req.method !== "HEAD") {
      body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_ARCA_MEDIA_BYTES) {
        sendProxyError("아카라이브 미디어가 허용 크기를 초과했습니다.", 413);
        return;
      }
    }
    if (!canWriteArcaImageProxyResponse(req, res, clientState)) return;
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (body) res.setHeader("Content-Length", String(body.length));
    res.end(body || undefined);
  } catch (error) {
    if (clientState.disconnected) return;
    sendProxyError(timedOut ? "아카라이브 미디어 조회 시간이 초과되었습니다." : `아카라이브 미디어 조회 실패: ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

async function readEndpointPayload(req) {
  if (["GET", "HEAD"].includes(req.method || "")) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    return Object.fromEntries(url.searchParams.entries());
  }
  return readJsonBody(req);
}

async function probeChannel(payload = {}) {
  const config = getConfig();
  const channel = normalizeChannel(payload.channel) || config.defaultChannel;
  const url = `${config.baseUrl}/b/${channel}`;
  const issues = [];

  if (!channel) {
    return {
      ok: false,
      config,
      issues: [issue("ARCA_CHANNEL_INVALID", "error", "채널 ID가 비어 있거나 허용되지 않는 문자입니다.")],
    };
  }

  let response;
  let html = "";
  try {
    response = await fetchWithTimeout(url, {
      headers: buildHeaders(),
      redirect: "follow",
    });
    html = await readTextSafely(response);
  } catch (error) {
    return {
      ok: false,
      config,
      channel,
      endpoint: url,
      issues: [issue("ARCA_NETWORK_FAILED", "error", `아카라이브 연결 실패: ${error.message}`, "네트워크, DNS, 프록시, Cloudflare 상태를 확인하세요.")],
    };
  }

  if (isCloudflareChallenge(response, html)) {
    issues.push(
      issue(
        "ARCA_CLOUDFLARE_CHALLENGE",
        "error",
        "Cloudflare challenge로 서버 직접 접근이 차단되었습니다.",
        "브라우저에서 통과한 세션 쿠키를 서버 환경 변수로 제공하거나 브라우저 세션 연동 방식을 사용해야 합니다."
      )
    );
  } else if (!response.ok) {
    issues.push(issue("ARCA_HTTP_ERROR", "error", `아카라이브가 HTTP ${response.status}를 반환했습니다.`));
  }

  return {
    ok: response.ok && !issues.some((item) => item.status === "error"),
    config,
    channel,
    endpoint: url,
    status: response.status,
    pageTitle: extractPageTitle(html),
    categories: extractCategories(html, channel).slice(0, 40),
    issues,
    checkedAt: new Date().toISOString(),
  };
}

async function readNotifications() {
  const config = getConfig();
  const cookieHeader = getArcaCookieHeader();
  const notificationUrl = buildNotificationUrl(config);
  const probeUrl = buildNotificationProbeUrl(config);
  const checkedAt = new Date().toISOString();

  if (!cookieHeader) {
    return {
      ok: true,
      config,
      connected: false,
      status: "signed-out",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      checkedAt,
    };
  }

  const apiItems = await readNotificationApiItems(config, probeUrl);
  let response;
  let html = "";
  try {
    response = await fetchWithTimeout(probeUrl, {
      headers: buildHeaders({ referer: `${config.baseUrl}/b/${config.defaultChannel}` }),
      redirect: "follow",
    });
    html = await readTextSafely(response);
  } catch (error) {
    return {
      ok: false,
      config,
      connected: true,
      status: "error",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      probeUrl: probeUrl.toString(),
      error: `아카라이브 알림 조회 실패: ${error.message}`,
      checkedAt,
    };
  }

  if (isCloudflareChallenge(response, html)) {
    return {
      ok: false,
      config,
      connected: true,
      status: "error",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      probeUrl: probeUrl.toString(),
      statusCode: response.status,
      pageTitle: extractPageTitle(html),
      error: "Cloudflare challenge로 알림 조회가 차단되었습니다.",
      checkedAt,
    };
  }

  if (isArcaLoginPage(response, html)) {
    return {
      ok: true,
      config,
      connected: false,
      status: "auth-required",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      probeUrl: probeUrl.toString(),
      statusCode: response.status,
      pageTitle: extractPageTitle(html),
      error: "저장된 세션으로 알림 페이지에 로그인하지 못했습니다.",
      checkedAt,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      config,
      connected: true,
      status: "error",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      probeUrl: probeUrl.toString(),
      statusCode: response.status,
      pageTitle: extractPageTitle(html),
      error: `아카라이브가 HTTP ${response.status}를 반환했습니다.`,
      checkedAt,
    };
  }

  const parsed = extractArcaNotificationsFromHtml(html, { baseUrl: config.baseUrl });
  const count = Math.max(parsed.count, apiItems?.unreadCount || 0);
  return {
    ok: true,
    config,
    connected: true,
    status: count > 0 ? "unread" : "idle",
    count,
    countSource: apiItems?.unreadCount > parsed.count ? "notification-api" : parsed.countSource,
    notificationUrl: notificationUrl.toString(),
    probeUrl: probeUrl.toString(),
    statusCode: response.status,
    pageTitle: extractPageTitle(html),
    items: apiItems?.items || [],
    itemsSource: apiItems ? "notification-api" : "unavailable",
    checkedAt,
  };
}

async function markAllNotificationsRead() {
  const config = getConfig();
  const cookieHeader = getArcaCookieHeader();
  const notificationUrl = buildNotificationUrl(config);
  const readAllUrl = buildNotificationReadAllUrl(config);
  const checkedAt = new Date().toISOString();

  if (!cookieHeader) {
    return {
      ok: false,
      config,
      connected: false,
      status: "auth-required",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      error: "아카라이브 로그인 후 모두 읽기를 사용할 수 있습니다.",
      checkedAt,
    };
  }

  let response;
  let body = "";
  try {
    response = await fetchWithTimeout(readAllUrl, {
      method: "DELETE",
      headers: {
        ...buildHeaders({ referer: notificationUrl.toString() }),
        accept: "application/json, text/javascript, */*; q=0.01",
        origin: config.baseUrl,
        "x-requested-with": "XMLHttpRequest",
      },
      redirect: "follow",
    });
    body = await readTextSafely(response);
  } catch (error) {
    return {
      ok: false,
      config,
      connected: true,
      status: "error",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      error: `아카라이브 알림 읽음 처리 실패: ${error.message}`,
      checkedAt,
    };
  }

  if (isCloudflareChallenge(response, body)) {
    return {
      ok: false,
      config,
      connected: true,
      status: "error",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      statusCode: response.status,
      error: "Cloudflare challenge로 알림 읽음 처리가 차단되었습니다.",
      checkedAt,
    };
  }

  let result = null;
  try {
    result = JSON.parse(body);
  } catch {
    result = null;
  }
  if (!response.ok || result?.result !== true) {
    return {
      ok: false,
      config,
      connected: true,
      status: "error",
      count: 0,
      items: [],
      notificationUrl: notificationUrl.toString(),
      statusCode: response.status,
      error: response.ok
        ? "아카라이브가 알림 읽음 처리를 확인하지 않았습니다."
        : `아카라이브가 HTTP ${response.status}를 반환했습니다.`,
      checkedAt,
    };
  }

  const refreshed = await readNotifications();
  const verified = Boolean(refreshed.ok && refreshed.connected && refreshed.count === 0);
  return {
    ...refreshed,
    accepted: true,
    markedAllRead: verified,
    verified,
    remainingUnreadCount: Math.max(0, Number(refreshed.count || 0)),
    markedAllReadAt: new Date().toISOString(),
  };
}

export async function handleArcaEndpoint(endpoint, req, res) {
  try {
    if (endpoint === "articles") {
      if (!["GET", "POST"].includes(req.method || "")) {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await listChannelArticles(await readEndpointPayload(req)));
      return;
    }

    if (endpoint === "article") {
      if (!["GET", "POST"].includes(req.method || "")) {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await readArticleDetail(await readEndpointPayload(req)));
      return;
    }

    if (endpoint === "comments") {
      if (req.method !== "GET") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await readArticleComments(await readEndpointPayload(req)));
      return;
    }

    if (endpoint === "comment") {
      if (req.method !== "POST") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await postArcaComment(await readEndpointPayload(req)));
      return;
    }

    if (endpoint === "emoticons") {
      if (req.method !== "GET") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await readArcaEmoticons(await readEndpointPayload(req)));
      return;
    }

    if (endpoint === "media") {
      if (!["GET", "HEAD"].includes(req.method || "")) {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      await proxyArcaMedia(await readEndpointPayload(req), req, res);
      return;
    }

    if (endpoint === "article-image") {
      if (!["GET", "HEAD"].includes(req.method || "")) {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      await proxyArticleImage(await readEndpointPayload(req), req, res);
      return;
    }

    if (endpoint === "probe") {
      if (!["GET", "POST"].includes(req.method || "")) {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await probeChannel(await readEndpointPayload(req)));
      return;
    }

    if (endpoint === "notifications") {
      if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, req.method === "DELETE" ? await markAllNotificationsRead() : await readNotifications());
      return;
    }

    sendJson(res, { ok: false, error: "unknown arca endpoint" }, 404);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
