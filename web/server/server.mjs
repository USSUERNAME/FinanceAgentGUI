import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleArcaEndpoint } from "./arcaApi.mjs";
import { handleArcaAuthEndpoint } from "./arcaAuthApi.mjs";
import { ensureAstopObserverStatus } from "./astopObserver.mjs";
import { recoverPendingLlmObservations } from "./llmProcessObserver.mjs";
import { handleBinanceMarketDataEndpoint } from "./binanceMarketDataApi.mjs";
import { handleEconomicCalendarEndpoint } from "./economicCalendarApi.mjs";
import { handleEarningsEndpoint } from "./earningsApi.mjs";
import { handleInvestSimulatorEndpoint } from "./investSimulatorApi.mjs";
import { handleMemoryEndpoint, startSharedMemoryMaintenanceScheduler } from "./memoryApi.mjs";
import { handleMagazineEndpoint, startMagazineScheduler } from "./magazineApi.mjs";
import { handleMarketSymbolCatalogEndpoint } from "./marketSymbolCatalog.mjs";
import { handleNotificationsEndpoint } from "./notificationsApi.mjs";
import { handlePbDailyIntelligenceEndpoint } from "./pbDailyIntelligenceApi.mjs";
import { handlePbDailyIntelligenceJobsEndpoint } from "./pbDailyIntelligenceJobs.mjs";
import { handlePortfolioEndpoint } from "./portfolioApi.mjs";
import { handleReportsEndpoint } from "./reportsApi.mjs";
import { handleTossInvestEndpoint } from "./tossInvestApi.mjs";
import { handleTossEtfNameTranslationEndpoint } from "./tossEtfNameTranslation.mjs";
import { handleTransactionSettingsEndpoint } from "./transactionSettings.mjs";
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
  const immutableAssetsRoot = `${join(dist, "assets")}${sep}`;
  res.setHeader(
    "Cache-Control",
    filePath.startsWith(immutableAssetsRoot)
      ? "public, max-age=31536000, immutable"
      : "no-cache"
  );
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/market-data/instruments/search")) {
    await handleBinanceMarketDataEndpoint("instrument-search", req, res);
    return;
  }

  if (req.url?.startsWith("/api/market-data/instruments")) {
    await handleBinanceMarketDataEndpoint("instrument", req, res);
    return;
  }

  if (req.url?.startsWith("/api/market-data/quotes")) {
    await handleBinanceMarketDataEndpoint("quotes", req, res);
    return;
  }

  if (req.url?.startsWith("/api/market-data/candles")) {
    await handleBinanceMarketDataEndpoint("candles", req, res);
    return;
  }

  if (req.url?.startsWith("/api/market-data/execution-price")) {
    await handleBinanceMarketDataEndpoint("execution-price", req, res);
    return;
  }

  if (req.url?.startsWith("/api/market-data/providers/status")) {
    await handleBinanceMarketDataEndpoint("provider-status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/market-symbols/search")) {
    await handleMarketSymbolCatalogEndpoint("search", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/settings")) {
    await handleNewsFeedEndpoint("settings", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/status")) {
    await handleNewsFeedEndpoint("status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/daily-digest")) {
    await handleNewsFeedEndpoint("daily-digest", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/read-state")) {
    await handleNewsFeedEndpoint("read-state", req, res);
    return;
  }

  if (req.url?.startsWith("/api/news-feed/view-state")) {
    await handleNewsFeedEndpoint("view-state", req, res);
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

  if (req.url?.startsWith("/api/arca/comments")) {
    await handleArcaEndpoint("comments", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/comment")) {
    await handleArcaEndpoint("comment", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/emoticons")) {
    await handleArcaEndpoint("emoticons", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/media")) {
    await handleArcaEndpoint("media", req, res);
    return;
  }

  if (req.url?.startsWith("/api/arca/article/image")) {
    await handleArcaEndpoint("article-image", req, res);
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

  if (req.url?.startsWith("/api/tossinvest/auth/status")) {
    await handleTossInvestEndpoint("status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/auth/credentials")) {
    await handleTossInvestEndpoint("credentials", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/auth/unlock")) {
    await handleTossInvestEndpoint("unlock", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/auth/lock")) {
    await handleTossInvestEndpoint("lock", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/auth/probe")) {
    await handleTossInvestEndpoint("probe", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/network/public-ip")) {
    await handleTossInvestEndpoint("public-ip", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/order-sync/status")) {
    await handleTossInvestEndpoint("order-sync-status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/order-sync/settings")) {
    await handleTossInvestEndpoint("order-sync-settings", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/order-sync/run")) {
    await handleTossInvestEndpoint("order-sync-run", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/order-sync/rebuild")) {
    await handleTossInvestEndpoint("order-sync-rebuild", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/order-sync/investment-history")) {
    await handleTossInvestEndpoint("order-sync-investment-history", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/order-sync/position-status")) {
    await handleTossInvestEndpoint("order-sync-position-status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/investment-status")) {
    await handleTossInvestEndpoint("investment-status", req, res);
    return;
  }
  if (req.url?.startsWith("/api/tossinvest/etf-name-translations")) {
    await handleTossEtfNameTranslationEndpoint(req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/prices")) {
    await handleTossInvestEndpoint("prices", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/stocks")) {
    await handleTossInvestEndpoint("stocks", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/candles")) {
    await handleTossInvestEndpoint("candles", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/exchange-rate")) {
    await handleTossInvestEndpoint("exchange-rate", req, res);
    return;
  }

  if (req.url?.toLowerCase().startsWith("/api/tossinvest/market-calendar/kr")) {
    await handleTossInvestEndpoint("market-calendar-kr", req, res);
    return;
  }

  if (req.url?.toLowerCase().startsWith("/api/tossinvest/market-calendar/us")) {
    await handleTossInvestEndpoint("market-calendar-us", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/orders/detail")) {
    await handleTossInvestEndpoint("order", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/orders")) {
    await handleTossInvestEndpoint("orders", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/conditional-orders/detail")) {
    await handleTossInvestEndpoint("conditional-order", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/conditional-orders")) {
    await handleTossInvestEndpoint("conditional-orders", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/holdings")) {
    await handleTossInvestEndpoint("holdings", req, res);
    return;
  }

  if (req.url?.startsWith("/api/tossinvest/accounts")) {
    await handleTossInvestEndpoint("accounts", req, res);
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

  if (req.url?.startsWith("/api/transactions/settings")) {
    await handleTransactionSettingsEndpoint(req, res);
    return;
  }

  if (req.url?.startsWith("/api/invest-simulator/status")) {
    await handleInvestSimulatorEndpoint("status", req, res);
    return;
  }

  if (req.url?.startsWith("/api/invest-simulator/accounts")) {
    await handleInvestSimulatorEndpoint("accounts", req, res);
    return;
  }

  if (req.url?.startsWith("/api/invest-simulator/events")) {
    await handleInvestSimulatorEndpoint("events", req, res);
    return;
  }

  if (req.url?.startsWith("/api/invest-simulator/orders")) {
    await handleInvestSimulatorEndpoint("orders", req, res);
    return;
  }

  if (req.url?.startsWith("/api/invest-simulator/exchange")) {
    await handleInvestSimulatorEndpoint("exchange", req, res);
    return;
  }

  if (req.url?.startsWith("/api/reports")) {
    await handleReportsEndpoint("list", req, res);
    return;
  }

  if (req.url?.startsWith("/api/pb-daily-intelligence/jobs")) {
    await handlePbDailyIntelligenceJobsEndpoint(req, res);
    return;
  }

  if (req.url?.startsWith("/api/pb-daily-intelligence")) {
    await handlePbDailyIntelligenceEndpoint(req, res);
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
      const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
      sendJson(res, await getCodexOptionsAsync({ force: url.searchParams.get("refresh") === "1" }));
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
    ensureAstopObserverStatus();
    const llmRecovery = recoverPendingLlmObservations();
    if (llmRecovery.recovered || llmRecovery.failed) {
      console.log(
        `LLM astop recovery: recovered=${llmRecovery.recovered} failed=${llmRecovery.failed} ignored=${llmRecovery.ignored}`,
      );
    }
    startNewsFeedCollector();
    startWorldMemoryCollector();
    startMagazineScheduler();
    startSharedMemoryMaintenanceScheduler();
  }, 0);
});
