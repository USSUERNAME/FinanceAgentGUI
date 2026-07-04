import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleArcaEndpoint } from "./arcaApi.mjs";
import { handleArcaAuthEndpoint } from "./arcaAuthApi.mjs";
import { handleEconomicCalendarEndpoint } from "./economicCalendarApi.mjs";
import { handleEarningsEndpoint } from "./earningsApi.mjs";
import { handleMemoryEndpoint } from "./memoryApi.mjs";
import { handleMagazineEndpoint, startMagazineScheduler } from "./magazineApi.mjs";
import { handleNotificationsEndpoint } from "./notificationsApi.mjs";
import { handlePortfolioEndpoint } from "./portfolioApi.mjs";
import { handleReportsEndpoint } from "./reportsApi.mjs";
import { handleWorldMemoryEndpoint, startWorldMemoryCollector } from "./worldMemoryApi.mjs";
import {
  getCodexOptionsAsync,
  handleAgentSettingsEndpoint,
  readJsonBody,
  runCodexChat,
  sendJson,
  streamCodexChat,
} from "./codexProbe.mjs";
import { handleNewsFeedEndpoint, startNewsFeedCollector } from "./newsFeedApi.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
const dist = join(root, "dist");
const host = process.env.FINANCE_AGENT_GUI_HOST || "127.0.0.1";
const port = Number(process.env.FINANCE_AGENT_GUI_PORT || process.env.PORT || 5173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = decodeURIComponent(url.pathname);
  let filePath = join(dist, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(dist)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(dist, "index.html");
  }
  res.setHeader("Content-Type", mimeTypes[extname(filePath)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/news-feed/settings")) {
    await handleNewsFeedEndpoint("settings", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/status")) {
    await handleNewsFeedEndpoint("status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/read-state")) {
    await handleNewsFeedEndpoint("read-state", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/items")) {
    await handleNewsFeedEndpoint("items", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/refresh")) {
    await handleNewsFeedEndpoint("refresh", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/articles")) {
    await handleArcaEndpoint("articles", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/article")) {
    await handleArcaEndpoint("article", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/probe")) {
    await handleArcaEndpoint("probe", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/notifications")) {
    await handleArcaEndpoint("notifications", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/auth/status")) {
    await handleArcaAuthEndpoint("status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/auth/start")) {
    await handleArcaAuthEndpoint("start", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/auth/capture")) {
    await handleArcaAuthEndpoint("capture", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/auth/stop")) {
    await handleArcaAuthEndpoint("stop", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/auth/session")) {
    await handleArcaAuthEndpoint("session", req, res);
    return;
  }

  if (req.url?.startsWith("/api/earnings/upcoming")) {
    await handleEarningsEndpoint("upcoming", req, res);
    return;
  }

  if (req.url?.startsWith("/api/economic-calendar/events")) {
    await handleEconomicCalendarEndpoint("events", req, res);
    return;
  }

  if (req.url?.startsWith("/api/economic-calendar/settings")) {
    await handleEconomicCalendarEndpoint("settings", req, res);
    return;
  }

  if (req.url?.startsWith("/api/economic-calendar/translations")) {
    await handleEconomicCalendarEndpoint("translations", req, res);
    return;
  }

  if (req.url?.startsWith("/api/portfolio/canvases")) {
    await handlePortfolioEndpoint("canvases", req, res);
    return;
  }

  if (req.url?.startsWith("/api/portfolio/backtest")) {
    await handlePortfolioEndpoint("backtest", req, res);
    return;
  }

  if (req.url?.startsWith("/api/reports")) {
    await handleReportsEndpoint("list", req, res);
    return;
  }

  if (req.url?.startsWith("/api/magazine/assets/")) {
    await handleMagazineEndpoint("assets", req, res);
    return;
  }

  if (req.url?.startsWith("/api/magazine/comments")) {
    await handleMagazineEndpoint("comments", req, res);
    return;
  }

  if (req.url?.startsWith("/api/magazine/preferences")) {
    await handleMagazineEndpoint("preferences", req, res);
    return;
  }

  if (req.url?.startsWith("/api/magazine/bias")) {
    await handleMagazineEndpoint("bias", req, res);
    return;
  }

  if (req.url?.startsWith("/api/magazine/settings")) {
    await handleMagazineEndpoint("settings", req, res);
    return;
  }

  if (req.url?.startsWith("/api/magazine/status")) {
    await handleMagazineEndpoint("status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/magazine/read-state")) {
    await handleMagazineEndpoint("read-state", req, res);
    return;
  }

  if (req.url?.startsWith("/api/magazine/articles")) {
    await handleMagazineEndpoint("articles", req, res);
    return;
  }

  if (req.url?.startsWith("/api/world-memory/settings")) {
    await handleWorldMemoryEndpoint("settings", req, res);
    return;
  }

  if (req.url?.startsWith("/api/world-memory/status")) {
    await handleWorldMemoryEndpoint("status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/world-memory/action")) {
    await handleWorldMemoryEndpoint("action", req, res);
    return;
  }

  if (req.url?.startsWith("/api/memory/context")) {
    await handleMemoryEndpoint("context", req, res);
    return;
  }

  if (req.url?.startsWith("/api/memory")) {
    await handleMemoryEndpoint("memory", req, res);
    return;
  }

  if (req.url?.startsWith("/api/notifications/status")) {
    await handleNotificationsEndpoint("status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/notifications/push")) {
    await handleNotificationsEndpoint("push", req, res);
    return;
  }

  if (req.url?.startsWith("/api/notifications/emergency-report")) {
    await handleNotificationsEndpoint("emergency-report", req, res);
    return;
  }

  if (req.url?.startsWith("/api/notifications/emergency-scenario")) {
    await handleNotificationsEndpoint("emergency-scenario", req, res);
    return;
  }

  if (req.url?.startsWith("/api/notifications/read-state")) {
    await handleNotificationsEndpoint("read-state", req, res);
    return;
  }

  if (req.url?.startsWith("/api/codex/chat/stream")) {
    if (req.method !== "POST") {
      sendJson(res, { error: "method not allowed" }, 405);
      return;
    }
    try {
      const payload = await readJsonBody(req);
      streamCodexChat(payload, res);
    } catch (error) {
      sendJson(res, { error: error.message }, 500);
    }
    return;
  }

  if (req.url?.startsWith("/api/codex/settings")) {
    await handleAgentSettingsEndpoint(req, res);
    return;
  }

  if (req.url?.startsWith("/api/codex/chat")) {
    if (req.method !== "POST") {
      sendJson(res, { error: "method not allowed" }, 405);
      return;
    }
    try {
      const payload = await readJsonBody(req);
      sendJson(res, await runCodexChat(payload));
    } catch (error) {
      sendJson(res, { error: error.message }, 500);
    }
    return;
  }

  if (req.url?.startsWith("/api/codex/options")) {
    try {
      sendJson(res, await getCodexOptionsAsync());
    } catch (error) {
      sendJson(res, { error: error.message }, 500);
    }
    return;
  }

  if (req.url?.startsWith("/api/")) {
    sendJson(res, { ok: false, error: "unknown api endpoint" }, 404);
    return;
  }

  serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`FinanceAgentGUI web server listening on http://${host}:${port}/`);
  setTimeout(() => {
    startNewsFeedCollector();
    startWorldMemoryCollector();
    startMagazineScheduler();
  }, 0);
});
