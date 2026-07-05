import { handleEconomicCalendarEndpoint } from "./economicCalendarApi.mjs";
import { handleEarningsEndpoint } from "./earningsApi.mjs";
import { handleMagazineEndpoint, startMagazineScheduler } from "./magazineApi.mjs";
import { handleMemoryEndpoint } from "./memoryApi.mjs";
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
      startNewsFeedCollector();
      startWorldMemoryCollector();
      startMagazineScheduler();

      server.middlewares.use("/api/news-feed/settings", async (req, res) => {
        await handleNewsFeedEndpoint("settings", req, res);
      });

      server.middlewares.use("/api/news-feed/status", async (req, res) => {
        await handleNewsFeedEndpoint("status", req, res);
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

      server.middlewares.use("/api/reports", async (req, res) => {
        await handleReportsEndpoint("list", req, res);
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

      server.middlewares.use("/api/codex/options", async (_req, res) => {
        try {
          sendJson(res, await getCodexOptionsAsync());
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
