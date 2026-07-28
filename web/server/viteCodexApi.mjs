import { handleEconomicCalendarEndpoint } from "./economicCalendarApi.mjs";
import { handleEarningsEndpoint } from "./earningsApi.mjs";
import { ensureAstopObserverStatus } from "./astopObserver.mjs";
import { handleBinanceMarketDataEndpoint } from "./binanceMarketDataApi.mjs";
import { handleInvestSimulatorEndpoint } from "./investSimulatorApi.mjs";
import { recoverPendingLlmObservations } from "./llmProcessObserver.mjs";
import { handleMagazineEndpoint, startMagazineScheduler } from "./magazineApi.mjs";
import { handleMarketSymbolCatalogEndpoint } from "./marketSymbolCatalog.mjs";
import { handleMemoryEndpoint, startSharedMemoryMaintenanceScheduler } from "./memoryApi.mjs";
import { handleNotificationsEndpoint } from "./notificationsApi.mjs";
import { handlePbBrokerResearchApprovalsEndpoint } from "./pbBrokerResearchApprovals.mjs";
import { handlePbDailyIntelligenceEndpoint } from "./pbDailyIntelligenceApi.mjs";
import { handlePbDailyIntelligenceJobsEndpoint } from "./pbDailyIntelligenceJobs.mjs";
import { handlePbGmailResearchApprovalsEndpoint } from "./pbGmailResearchApprovals.mjs";
import { handleResearchSectorTaxonomyEndpoint } from "./researchSectorTaxonomy.mjs";
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

async function handleLazyArcaEndpoint(kind, req, res) {
  const { handleArcaEndpoint } = await import("./arcaApi.mjs");
  await handleArcaEndpoint(kind, req, res);
}

async function handleLazyArcaAuthEndpoint(kind, req, res) {
  const { handleArcaAuthEndpoint } = await import("./arcaAuthApi.mjs");
  await handleArcaAuthEndpoint(kind, req, res);
}

export function codexApiPlugin() {
  return {
    name: "finance-agent-codex-api",
    configureServer(server) {
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

      server.middlewares.use("/api/market-data/instruments/search", async (req, res) => {
        await handleBinanceMarketDataEndpoint("instrument-search", req, res);
      });

      server.middlewares.use("/api/market-data/instruments", async (req, res) => {
        await handleBinanceMarketDataEndpoint("instrument", req, res);
      });

      server.middlewares.use("/api/market-data/quotes", async (req, res) => {
        await handleBinanceMarketDataEndpoint("quotes", req, res);
      });

      server.middlewares.use("/api/market-data/candles", async (req, res) => {
        await handleBinanceMarketDataEndpoint("candles", req, res);
      });

      server.middlewares.use("/api/market-data/execution-price", async (req, res) => {
        await handleBinanceMarketDataEndpoint("execution-price", req, res);
      });

      server.middlewares.use("/api/market-data/providers/status", async (req, res) => {
        await handleBinanceMarketDataEndpoint("provider-status", req, res);
      });

      server.middlewares.use("/api/market-symbols/search", async (req, res) => {
        await handleMarketSymbolCatalogEndpoint("search", req, res);
      });

      server.middlewares.use("/api/news-feed/settings", async (req, res) => {
        await handleNewsFeedEndpoint("settings", req, res);
      });

      server.middlewares.use("/api/news-feed/status", async (req, res) => {
        await handleNewsFeedEndpoint("status", req, res);
      });

      server.middlewares.use("/api/news-feed/daily-digest", async (req, res) => {
        await handleNewsFeedEndpoint("daily-digest", req, res);
      });

      server.middlewares.use("/api/news-feed/read-state", async (req, res) => {
        await handleNewsFeedEndpoint("read-state", req, res);
      });

      server.middlewares.use("/api/news-feed/view-state", async (req, res) => {
        await handleNewsFeedEndpoint("view-state", req, res);
      });

      server.middlewares.use("/api/news-feed/items", async (req, res) => {
        await handleNewsFeedEndpoint("items", req, res);
      });

      server.middlewares.use("/api/news-feed/refresh", async (req, res) => {
        await handleNewsFeedEndpoint("refresh", req, res);
      });

      server.middlewares.use("/api/arca/articles", async (req, res) => {
        await handleLazyArcaEndpoint("articles", req, res);
      });

      server.middlewares.use("/api/arca/comments", async (req, res) => {
        await handleLazyArcaEndpoint("comments", req, res);
      });

      server.middlewares.use("/api/arca/comment", async (req, res) => {
        await handleLazyArcaEndpoint("comment", req, res);
      });

      server.middlewares.use("/api/arca/emoticons", async (req, res) => {
        await handleLazyArcaEndpoint("emoticons", req, res);
      });

      server.middlewares.use("/api/arca/media", async (req, res) => {
        await handleLazyArcaEndpoint("media", req, res);
      });

      server.middlewares.use("/api/arca/article/image", async (req, res) => {
        await handleLazyArcaEndpoint("article-image", req, res);
      });

      server.middlewares.use("/api/arca/article", async (req, res) => {
        await handleLazyArcaEndpoint("article", req, res);
      });

      server.middlewares.use("/api/arca/probe", async (req, res) => {
        await handleLazyArcaEndpoint("probe", req, res);
      });

      server.middlewares.use("/api/arca/notifications", async (req, res) => {
        await handleLazyArcaEndpoint("notifications", req, res);
      });

      server.middlewares.use("/api/arca/auth/status", async (req, res) => {
        await handleLazyArcaAuthEndpoint("status", req, res);
      });

      server.middlewares.use("/api/arca/auth/start", async (req, res) => {
        await handleLazyArcaAuthEndpoint("start", req, res);
      });

      server.middlewares.use("/api/arca/auth/capture", async (req, res) => {
        await handleLazyArcaAuthEndpoint("capture", req, res);
      });

      server.middlewares.use("/api/arca/auth/stop", async (req, res) => {
        await handleLazyArcaAuthEndpoint("stop", req, res);
      });

      server.middlewares.use("/api/arca/auth/session", async (req, res) => {
        await handleLazyArcaAuthEndpoint("session", req, res);
      });

      server.middlewares.use("/api/tossinvest/auth/status", async (req, res) => {
        await handleTossInvestEndpoint("status", req, res);
      });

      server.middlewares.use("/api/tossinvest/auth/credentials", async (req, res) => {
        await handleTossInvestEndpoint("credentials", req, res);
      });

      server.middlewares.use("/api/tossinvest/auth/unlock", async (req, res) => {
        await handleTossInvestEndpoint("unlock", req, res);
      });

      server.middlewares.use("/api/tossinvest/auth/lock", async (req, res) => {
        await handleTossInvestEndpoint("lock", req, res);
      });

      server.middlewares.use("/api/tossinvest/auth/probe", async (req, res) => {
        await handleTossInvestEndpoint("probe", req, res);
      });

      server.middlewares.use("/api/tossinvest/network/public-ip", async (req, res) => {
        await handleTossInvestEndpoint("public-ip", req, res);
      });

      server.middlewares.use("/api/tossinvest/order-sync/status", async (req, res) => {
        await handleTossInvestEndpoint("order-sync-status", req, res);
      });

      server.middlewares.use("/api/tossinvest/order-sync/settings", async (req, res) => {
        await handleTossInvestEndpoint("order-sync-settings", req, res);
      });

      server.middlewares.use("/api/tossinvest/order-sync/run", async (req, res) => {
        await handleTossInvestEndpoint("order-sync-run", req, res);
      });

      server.middlewares.use("/api/tossinvest/order-sync/rebuild", async (req, res) => {
        await handleTossInvestEndpoint("order-sync-rebuild", req, res);
      });

      server.middlewares.use("/api/tossinvest/order-sync/investment-history", async (req, res) => {
        await handleTossInvestEndpoint("order-sync-investment-history", req, res);
      });

      server.middlewares.use("/api/tossinvest/order-sync/position-status", async (req, res) => {
        await handleTossInvestEndpoint("order-sync-position-status", req, res);
      });

      server.middlewares.use("/api/tossinvest/investment-status", async (req, res) => {
        await handleTossInvestEndpoint("investment-status", req, res);
      });
      server.middlewares.use("/api/tossinvest/etf-name-translations", async (req, res) => {
        await handleTossEtfNameTranslationEndpoint(req, res);
      });

      server.middlewares.use("/api/tossinvest/prices", async (req, res) => {
        await handleTossInvestEndpoint("prices", req, res);
      });

      server.middlewares.use("/api/tossinvest/stocks", async (req, res) => {
        await handleTossInvestEndpoint("stocks", req, res);
      });

      server.middlewares.use("/api/tossinvest/candles", async (req, res) => {
        await handleTossInvestEndpoint("candles", req, res);
      });

      server.middlewares.use("/api/tossinvest/exchange-rate", async (req, res) => {
        await handleTossInvestEndpoint("exchange-rate", req, res);
      });

      server.middlewares.use("/api/tossinvest/market-calendar/kr", async (req, res) => {
        await handleTossInvestEndpoint("market-calendar-kr", req, res);
      });

      server.middlewares.use("/api/tossinvest/market-calendar/KR", async (req, res) => {
        await handleTossInvestEndpoint("market-calendar-kr", req, res);
      });

      server.middlewares.use("/api/tossinvest/market-calendar/us", async (req, res) => {
        await handleTossInvestEndpoint("market-calendar-us", req, res);
      });

      server.middlewares.use("/api/tossinvest/market-calendar/US", async (req, res) => {
        await handleTossInvestEndpoint("market-calendar-us", req, res);
      });

      server.middlewares.use("/api/tossinvest/orders/detail", async (req, res) => {
        await handleTossInvestEndpoint("order", req, res);
      });

      server.middlewares.use("/api/tossinvest/orders", async (req, res) => {
        await handleTossInvestEndpoint("orders", req, res);
      });

      server.middlewares.use("/api/tossinvest/conditional-orders/detail", async (req, res) => {
        await handleTossInvestEndpoint("conditional-order", req, res);
      });

      server.middlewares.use("/api/tossinvest/conditional-orders", async (req, res) => {
        await handleTossInvestEndpoint("conditional-orders", req, res);
      });

      server.middlewares.use("/api/tossinvest/holdings", async (req, res) => {
        await handleTossInvestEndpoint("holdings", req, res);
      });

      server.middlewares.use("/api/tossinvest/accounts", async (req, res) => {
        await handleTossInvestEndpoint("accounts", req, res);
      });

      server.middlewares.use("/api/earnings/upcoming", async (req, res) => {
        await handleEarningsEndpoint("upcoming", req, res);
      });

      server.middlewares.use("/api/economic-calendar/events", async (req, res) => {
        await handleEconomicCalendarEndpoint("events", req, res);
      });

      server.middlewares.use("/api/economic-calendar/settings", async (req, res) => {
        await handleEconomicCalendarEndpoint("settings", req, res);
      });

      server.middlewares.use("/api/economic-calendar/translations", async (req, res) => {
        await handleEconomicCalendarEndpoint("translations", req, res);
      });

      server.middlewares.use("/api/portfolio/canvases", async (req, res) => {
        await handlePortfolioEndpoint("canvases", req, res);
      });

      server.middlewares.use("/api/portfolio/backtest", async (req, res) => {
        await handlePortfolioEndpoint("backtest", req, res);
      });

      server.middlewares.use("/api/transactions/settings", async (req, res) => {
        await handleTransactionSettingsEndpoint(req, res);
      });

      server.middlewares.use("/api/invest-simulator/status", async (req, res) => {
        await handleInvestSimulatorEndpoint("status", req, res);
      });

      server.middlewares.use("/api/invest-simulator/accounts", async (req, res) => {
        await handleInvestSimulatorEndpoint("accounts", req, res);
      });

      server.middlewares.use("/api/invest-simulator/events", async (req, res) => {
        await handleInvestSimulatorEndpoint("events", req, res);
      });

      server.middlewares.use("/api/invest-simulator/orders", async (req, res) => {
        await handleInvestSimulatorEndpoint("orders", req, res);
      });

      server.middlewares.use("/api/invest-simulator/exchange", async (req, res) => {
        await handleInvestSimulatorEndpoint("exchange", req, res);
      });

      server.middlewares.use("/api/reports", async (req, res) => {
        await handleReportsEndpoint("list", req, res);
      });

      server.middlewares.use("/api/pb-daily-intelligence/jobs", async (req, res) => {
        await handlePbDailyIntelligenceJobsEndpoint(req, res);
      });

      server.middlewares.use("/api/pb-daily-intelligence/broker-approvals", async (req, res) => {
        await handlePbBrokerResearchApprovalsEndpoint(req, res);
      });

      server.middlewares.use("/api/pb-daily-intelligence/gmail-attachment-approvals", async (req, res) => {
        await handlePbGmailResearchApprovalsEndpoint(req, res);
      });

      server.middlewares.use("/api/pb-daily-intelligence/sector-taxonomy", async (req, res) => {
        await handleResearchSectorTaxonomyEndpoint(req, res);
      });

      server.middlewares.use("/api/pb-daily-intelligence", async (req, res) => {
        await handlePbDailyIntelligenceEndpoint(req, res);
      });

      server.middlewares.use("/api/magazine/assets", async (req, res) => {
        await handleMagazineEndpoint("assets", req, res);
      });

      server.middlewares.use("/api/magazine/comments", async (req, res) => {
        await handleMagazineEndpoint("comments", req, res);
      });

      server.middlewares.use("/api/magazine/preferences", async (req, res) => {
        await handleMagazineEndpoint("preferences", req, res);
      });

      server.middlewares.use("/api/magazine/bias", async (req, res) => {
        await handleMagazineEndpoint("bias", req, res);
      });

      server.middlewares.use("/api/magazine/settings", async (req, res) => {
        await handleMagazineEndpoint("settings", req, res);
      });

      server.middlewares.use("/api/magazine/status", async (req, res) => {
        await handleMagazineEndpoint("status", req, res);
      });

      server.middlewares.use("/api/magazine/read-state", async (req, res) => {
        await handleMagazineEndpoint("read-state", req, res);
      });

      server.middlewares.use("/api/magazine/articles", async (req, res) => {
        await handleMagazineEndpoint("articles", req, res);
      });

      server.middlewares.use("/api/world-memory/status", async (req, res) => {
        await handleWorldMemoryEndpoint("status", req, res);
      });

      server.middlewares.use("/api/world-memory/settings", async (req, res) => {
        await handleWorldMemoryEndpoint("settings", req, res);
      });

      server.middlewares.use("/api/world-memory/action", async (req, res) => {
        await handleWorldMemoryEndpoint("action", req, res);
      });

      server.middlewares.use("/api/memory/context", async (req, res) => {
        await handleMemoryEndpoint("context", req, res);
      });

      server.middlewares.use("/api/memory", async (req, res) => {
        await handleMemoryEndpoint("memory", req, res);
      });

      server.middlewares.use("/api/notifications/status", async (req, res) => {
        await handleNotificationsEndpoint("status", req, res);
      });

      server.middlewares.use("/api/notifications/push", async (req, res) => {
        await handleNotificationsEndpoint("push", req, res);
      });

      server.middlewares.use("/api/notifications/emergency-report", async (req, res) => {
        await handleNotificationsEndpoint("emergency-report", req, res);
      });

      server.middlewares.use("/api/notifications/emergency-scenario", async (req, res) => {
        await handleNotificationsEndpoint("emergency-scenario", req, res);
      });

      server.middlewares.use("/api/notifications/read-state", async (req, res) => {
        await handleNotificationsEndpoint("read-state", req, res);
      });

      server.middlewares.use("/api/codex/chat/stream", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, { error: "method not allowed" }, 405);
          return;
        }
        try {
          const payload = await readJsonBody(req);
          streamCodexChat(payload, res);
        } catch (error) {
          if (res.headersSent) {
            if (!res.writableEnded) res.end();
            return;
          }
          sendJson(res, { error: error.message }, 500);
        }
      });

      server.middlewares.use("/api/codex/settings", async (req, res) => {
        await handleAgentSettingsEndpoint(req, res);
      });

      server.middlewares.use("/api/codex/chat", async (req, res) => {
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
      });

      server.middlewares.use("/api/codex/options", async (req, res) => {
        try {
          const url = new URL(req.url || "/", "http://127.0.0.1");
          sendJson(res, await getCodexOptionsAsync({ force: url.searchParams.get("refresh") === "1" }));
        } catch (error) {
          sendJson(res, { error: error.message }, 500);
        }
      });

      server.middlewares.use("/api", (_req, res) => {
        sendJson(res, { ok: false, error: "unknown api endpoint" }, 404);
      });
    },
  };
}
