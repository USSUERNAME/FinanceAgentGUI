import { parse } from "node-html-parser";
import { getArcaCookieHeader } from "./arcaAuthApi.mjs";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const DEFAULT_BASE_URL = "https://arca.live";
const DEFAULT_CHANNEL = "stock";
const MAX_ARTICLE_CONTEXT_LENGTH = 12000;

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
  const digits = String(value || "").replace(/[^\d-]/g, "");
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
  const contentTextFull = nodeText(contentNode) || description;
  const imageUrls = (contentNode?.querySelectorAll("img") || [])
    .map((image) => absoluteArcaUrl(image.getAttribute("data-originalurl") || image.getAttribute("src"), config.baseUrl))
    .filter(Boolean)
    .slice(0, 8);
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
    imageUrls,
    imageCount: imageUrls.length,
    commentCount,
    timeIso,
    url: absoluteArcaUrl(canonicalHref, config.baseUrl) || url.toString(),
  };
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
  return {
    ok: response.ok && !issues.some((item) => item.status === "error"),
    config,
    endpoint: url.toString(),
    status: response.status,
    article: extractArticleDetail(root, config, url),
    issues,
    fetchedAt: new Date().toISOString(),
  };
}

async function readEndpointPayload(req) {
  if (req.method === "GET") {
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
  const url = buildNotificationUrl(config);
  const checkedAt = new Date().toISOString();

  if (!cookieHeader) {
    return {
      ok: true,
      config,
      connected: false,
      status: "signed-out",
      count: 0,
      notificationUrl: url.toString(),
      checkedAt,
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
      connected: true,
      status: "error",
      count: 0,
      notificationUrl: url.toString(),
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
      notificationUrl: url.toString(),
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
      notificationUrl: url.toString(),
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
      notificationUrl: url.toString(),
      statusCode: response.status,
      pageTitle: extractPageTitle(html),
      error: `아카라이브가 HTTP ${response.status}를 반환했습니다.`,
      checkedAt,
    };
  }

  const parsed = extractNotificationCount(html);
  return {
    ok: true,
    config,
    connected: true,
    status: parsed.count > 0 ? "unread" : "idle",
    count: parsed.count,
    countSource: parsed.source,
    notificationUrl: url.toString(),
    statusCode: response.status,
    pageTitle: extractPageTitle(html),
    checkedAt,
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

    if (endpoint === "probe") {
      if (!["GET", "POST"].includes(req.method || "")) {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await probeChannel(await readEndpointPayload(req)));
      return;
    }

    if (endpoint === "notifications") {
      if (!["GET", "POST"].includes(req.method || "")) {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await readNotifications());
      return;
    }

    sendJson(res, { ok: false, error: "unknown arca endpoint" }, 404);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
