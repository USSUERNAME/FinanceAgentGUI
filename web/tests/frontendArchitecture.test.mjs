import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const appRoutesSource = readFileSync(new URL("../src/shell/AppRoutes.jsx", import.meta.url), "utf8");
const agentRuntimeControllerSource = readFileSync(
  new URL("../src/agent/useAgentRuntimeController.js", import.meta.url),
  "utf8"
);
const chatComposerControllerSource = readFileSync(
  new URL("../src/agent/useChatComposerController.js", import.meta.url),
  "utf8"
);
const chatStreamRunnerSource = readFileSync(
  new URL("../src/agent/chatStreamRunner.js", import.meta.url),
  "utf8"
);
const newsFeedControllerSource = readFileSync(
  new URL("../src/news/useNewsFeedController.js", import.meta.url),
  "utf8"
);
const worldMemoryControllerSource = readFileSync(
  new URL("../src/worldMemory/useWorldMemoryController.js", import.meta.url),
  "utf8"
);
const magazineControllerSource = readFileSync(
  new URL("../src/magazine/useMagazineController.js", import.meta.url),
  "utf8"
);
const magazineReaderControllerSource = readFileSync(
  new URL("../src/magazine/useMagazineReaderController.js", import.meta.url),
  "utf8"
);
const arcaControllerSource = readFileSync(
  new URL("../src/arca/useArcaController.js", import.meta.url),
  "utf8"
);
const tossInvestControllerSource = readFileSync(
  new URL("../src/transactions/useTossInvestController.js", import.meta.url),
  "utf8"
);
const transactionSettingsControllerSource = readFileSync(
  new URL("../src/transactions/useTransactionSettingsController.js", import.meta.url),
  "utf8"
);
const sharedMemoryControllerSource = readFileSync(
  new URL("../src/memory/useSharedMemoryController.js", import.meta.url),
  "utf8"
);
const transactionStatusSource = readFileSync(
  new URL("../src/transactions/TransactionStatusView.jsx", import.meta.url),
  "utf8"
);
const transactionStatusRootSource = transactionStatusSource.slice(
  transactionStatusSource.indexOf("export default function TransactionStatusView")
);
const transactionStatusViewsSource = readFileSync(
  new URL("../src/transactions/TransactionStatusViews.jsx", import.meta.url),
  "utf8"
);
const transactionDisplaySettingsControllerSource = readFileSync(
  new URL("../src/transactions/useTransactionDisplaySettingsController.js", import.meta.url),
  "utf8"
);
const transactionMarketDataControllerSource = readFileSync(
  new URL("../src/transactions/useTransactionMarketDataController.js", import.meta.url),
  "utf8"
);
const globalStylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const agentShellStylesSource = readFileSync(
  new URL("../src/agent/agent-shell.css", import.meta.url),
  "utf8"
);
const magazineWorkspaceSource = readFileSync(
  new URL("../src/magazine/MagazineWorkspace.jsx", import.meta.url),
  "utf8"
);
const portfolioCanvasControllerSource = readFileSync(
  new URL("../src/portfolio/usePortfolioCanvasController.js", import.meta.url),
  "utf8"
);
const portfolioWorkspaceHeaderSource = readFileSync(
  new URL("../src/portfolio/PortfolioWorkspaceHeader.jsx", import.meta.url),
  "utf8"
);
const portfolioTossApiStatusStylesSource = readFileSync(
  new URL("../src/portfolio/portfolioTossApiStatus.css", import.meta.url),
  "utf8"
);
const portfolioStylesSource = readFileSync(
  new URL("../src/portfolio/portfolio.css", import.meta.url),
  "utf8"
);
const transactionStatusStylesSource = readFileSync(
  new URL("../src/transactions/transaction-status.css", import.meta.url),
  "utf8"
);
const mobileTransactionStatusStylesSource = transactionStatusStylesSource.slice(
  transactionStatusStylesSource.indexOf("@media (max-width: 860px)")
);
const mediumShellMediaStart = globalStylesSource.lastIndexOf("@media (max-width: 980px)");
const narrowShellMediaStart = globalStylesSource.indexOf(
  "@media (max-width: 760px)",
  mediumShellMediaStart
);
const narrowShellMediaEnd = globalStylesSource.indexOf(
  "@media (max-width: 340px)",
  narrowShellMediaStart
);
const mediumShellStylesSource = globalStylesSource.slice(mediumShellMediaStart, narrowShellMediaStart);
const narrowShellStylesSource = globalStylesSource.slice(narrowShellMediaStart, narrowShellMediaEnd);
const featureStyleOwners = [
  ["../src/agent/AgentSidebar.jsx", "agent-shell.css"],
  ["../src/arca/StockChannelView.jsx", "stock-channel.css"],
  ["../src/calendars/CalendarViews.jsx", "calendars.css"],
  ["../src/dailyIntelligence/DailyIntelligenceView.jsx", "daily-intelligence.css"],
  ["../src/magazine/MagazineWorkspace.jsx", "magazine.css"],
  ["../src/news/NewsFeedView.jsx", "news-feed.css"],
  ["../src/portfolio/PortfolioWorkspace.jsx", "portfolio.css"],
  ["../src/reports/ReportsView.jsx", "reports.css"],
  ["../src/settings/SettingsView.jsx", "settings.css"],
  ["../src/transactions/TransactionStatusView.jsx", "transaction-status.css"],
  ["../src/worldMemory/WorldMemoryView.jsx", "world-memory.css"],
];
const responsiveFeatureStyles = [
  ["../src/arca/stock-channel.css", ".stock-board-header"],
  ["../src/calendars/calendars.css", ".economic-calendar-header"],
  ["../src/dailyIntelligence/daily-intelligence.css", ".daily-intelligence-grid"],
  ["../src/magazine/magazine.css", ".magazine-reader-modal"],
  ["../src/news/news-feed.css", ".news-feed-header"],
  ["../src/portfolio/portfolio.css", ".portfolio-guide-hero"],
  ["../src/reports/reports.css", ".reports-layout"],
  ["../src/settings/settings.css", ".settings-header"],
  ["../src/worldMemory/world-memory.css", ".world-memory-shell"],
];

test("News Feed state, requests, and polling stay behind the feature controller", () => {
  assert.match(appSource, /useNewsFeedController/);
  assert.doesNotMatch(appSource, /fetch\([`\"]\/api\/news-feed\//);
  assert.doesNotMatch(appSource, /const \[newsFeed(?:Status|Items|Busy|Settings)/);
  assert.match(newsFeedControllerSource, /NEWS_FEED_STATUS_POLL_INTERVAL_MS/);
  assert.match(newsFeedControllerSource, /fetchNewsFeedStatus/);
  assert.match(newsFeedControllerSource, /loadNewsFeedItems/);
});

test("World Memory state and requests stay behind the feature controller", () => {
  assert.match(appSource, /useWorldMemoryController/);
  assert.doesNotMatch(appSource, /fetch\([`"]\/api\/world-memory\//);
  assert.doesNotMatch(appSource, /const \[worldMemory(?:Settings|Status|Busy|Error|ActionBusy|RunningAction|TechOpen)/);
  assert.match(worldMemoryControllerSource, /fetchWorldMemorySettings/);
  assert.match(worldMemoryControllerSource, /fetchWorldMemoryStatus/);
  assert.match(worldMemoryControllerSource, /requestWorldMemoryAction/);
});

test("Magazine data orchestration stays behind the feature controller", () => {
  assert.match(appSource, /useMagazineController/);
  assert.doesNotMatch(appSource, /fetch\([`"]\/api\/magazine\//);
  assert.doesNotMatch(appSource, /const \[magazine(?:Catalog|Status|Settings|StartNowBusy|GenerateOneBusy)/);
  assert.match(magazineControllerSource, /MAGAZINE_STATUS_POLL_INTERVAL_MS/);
  assert.match(magazineControllerSource, /fetchMagazineCatalog/);
  assert.match(magazineControllerSource, /fetchMagazineStatus/);
  assert.match(appSource, /useMagazineReaderController/);
  assert.doesNotMatch(appSource, /const \[magazine(?:Active|Preference|Comment|Delete|Copy)/);
  assert.match(magazineReaderControllerSource, /submitMagazineComment/);
  assert.match(magazineReaderControllerSource, /confirmMagazineArticleDelete/);
  assert.match(appRoutesSource, /React\.lazy\(\(\) => import\("\.\.\/magazine\/MagazineWorkspace\.jsx"\)\)/);
  assert.doesNotMatch(appSource, /className=[^\n]*magazine-canvas/);
  assert.match(magazineWorkspaceSource, /className=[^\n]*magazine-canvas/);
});

test("route rendering stays outside the application orchestration root", () => {
  assert.match(appSource, /import \{ AppRoutes, RouteLoading \} from ["']\.\/shell\/AppRoutes\.jsx["']/);
  assert.match(appSource, /<AppRoutes activeView=\{activeView\} models=\{routeModels\} \/>/);
  assert.doesNotMatch(appSource, /activeView === ["']settings["'] \? \(/);
  assert.doesNotMatch(appSource, /<SettingsView\b|<TransactionStatusView\b|<MagazineWorkspace\b/);
  assert.match(appRoutesSource, /function SettingsRoute\(/);
  assert.match(appRoutesSource, /function TransactionStatusRoute\(/);
  assert.match(appRoutesSource, /export function AppRoutes\(/);
});

test("agent provider settings and model-catalog lifecycle stay behind the runtime controller", () => {
  assert.match(appSource, /useAgentRuntimeController\(\)/);
  assert.doesNotMatch(appSource, /const \[(?:agentProvider|providerOptions|approvalOptions|modelGroups|personaMode|codexStatus)/);
  assert.doesNotMatch(appSource, /fetchAgentOptions|patchAgentSettings/);
  assert.doesNotMatch(appSource, /function (?:providerRuntimeForProvider|refreshAgentOptions|selectionForProvider)\(/);
  assert.match(agentRuntimeControllerSource, /export function useAgentRuntimeController\(/);
  assert.match(agentRuntimeControllerSource, /fetchAgentOptions/);
  assert.match(agentRuntimeControllerSource, /patchAgentSettings/);
  assert.match(agentRuntimeControllerSource, /function providerRuntimeForProvider\(/);
  assert.match(agentRuntimeControllerSource, /function refreshAgentOptions\(/);
  assert.match(appSource, /updatePersonaMode,/);
  assert.match(agentRuntimeControllerSource, /updatePersonaMode,/);
});

test("chat composer state and SSE consumption stay behind agent-owned boundaries", () => {
  assert.match(appSource, /useChatComposerController\(\{/);
  assert.doesNotMatch(appSource, /const \[(?:chatMessages|worldMemoryChatMessages|prompt|worldMemoryPrompt|sendingChatScopes|chatAttachments|worldMemoryChatAttachments|attachmentError|worldMemoryAttachmentError|isComposerDragging|attachingArticleHref)/);
  assert.match(chatComposerControllerSource, /export function useChatComposerController\(/);
  assert.match(chatComposerControllerSource, /function updateChatMessagesForScope\(/);
  assert.match(chatComposerControllerSource, /async function addChatAttachmentFiles\(/);
  assert.match(appSource, /consumeAgentChatStream\(response,/);
  assert.doesNotMatch(appSource, /parseSseEvent|response\.body\.getReader\(\)/);
  assert.match(chatStreamRunnerSource, /export async function consumeAgentChatStream\(/);
  assert.match(chatStreamRunnerSource, /parseSseEvent/);
  assert.match(chatStreamRunnerSource, /response\.body\.getReader\(\)/);
});

test("Arca board, auth, notification, and reader orchestration stay behind the feature controller", () => {
  assert.match(appSource, /useArcaController/);
  assert.doesNotMatch(appSource, /fetch\([`"]\/api\/arca\//);
  assert.doesNotMatch(appSource, /const \[(?:arca|boardFilters|boardSearchInput|showHiddenNotices)/);
  assert.match(arcaControllerSource, /ARCA_NOTIFICATION_POLL_INTERVAL_MS/);
  assert.match(arcaControllerSource, /fetchArcaBoard/);
  assert.match(arcaControllerSource, /fetchArcaNotifications/);
});

test("Toss Invest auth and order sync orchestration stay behind the feature controller", () => {
  assert.match(appSource, /useTossInvestController/);
  assert.doesNotMatch(appSource, /fetch\([`"]\/api\/tossinvest\//);
  assert.doesNotMatch(appSource, /const \[tossInvest/);
  assert.match(tossInvestControllerSource, /ORDER_SYNC_INTERVAL_MS/);
  assert.match(tossInvestControllerSource, /runTossInvestOrderSyncBatches/);
  assert.match(tossInvestControllerSource, /requestTossInvestSnapshotRebuild/);
});

test("Transaction menu settings stay behind their controller", () => {
  assert.match(appSource, /useTransactionSettingsController/);
  assert.doesNotMatch(appSource, /fetch\([`"]\/api\/transactions\/settings/);
  assert.doesNotMatch(appSource, /const \[transactionSettings/);
  assert.match(transactionSettingsControllerSource, /fetchTransactionSettings/);
  assert.match(transactionSettingsControllerSource, /saveTransactionStatusHidden/);
});

test("Shared Memory status, dialog, persistence, and polling stay behind the feature controller", () => {
  assert.match(appSource, /useSharedMemoryController/);
  assert.doesNotMatch(appSource, /fetch\([`"]\/api\/memory/);
  assert.doesNotMatch(appSource, /const \[memory(?:Status|Busy|Error|RecentOpen|Dialog)/);
  assert.match(sharedMemoryControllerSource, /MARKET_SUMMARY_POLL_INTERVAL_MS/);
  assert.match(sharedMemoryControllerSource, /saveSharedMemoryRecord/);
  assert.match(sharedMemoryControllerSource, /deleteMemoryRecord/);
});

test("Transaction Status root delegates mode state and settings persistence", () => {
  assert.match(transactionStatusRootSource, /useTransactionShellState/);
  assert.match(transactionStatusRootSource, /useTransactionWatchlistState/);
  assert.match(transactionStatusRootSource, /useTransactionSimulatorState/);
  assert.match(transactionStatusRootSource, /useTransactionMarketDataController/);
  assert.match(transactionStatusRootSource, /useTransactionDisplaySettingsController/);
  assert.doesNotMatch(transactionStatusRootSource, /useState\(/);
  assert.doesNotMatch(transactionStatusRootSource, /fetch\([`"]\/api\//);
  assert.doesNotMatch(transactionStatusSource, /function InvestmentSidebar/);
  assert.doesNotMatch(transactionStatusSource, /function WatchlistPlaceholder/);
  assert.match(transactionStatusViewsSource, /function InvestmentSidebar/);
  assert.match(transactionStatusViewsSource, /function WatchlistPlaceholder/);
  assert.match(transactionDisplaySettingsControllerSource, /fetchTransactionSettings/);
  assert.match(transactionDisplaySettingsControllerSource, /patchTransactionSettings/);
  assert.match(transactionMarketDataControllerSource, /fetchTossInvestmentStatus/);
  assert.match(transactionMarketDataControllerSource, /fetchTransactionWatchlistPrices/);
  assert.match(transactionMarketDataControllerSource, /visibilitychange/);
  assert.match(transactionMarketDataControllerSource, /transactionTossRateLimitFallbackMs/);
  assert.doesNotMatch(transactionStatusRootSource, /fetchTossInvestmentStatus/);
  assert.doesNotMatch(transactionStatusRootSource, /fetchTransactionWatchlistPrices/);
  assert.doesNotMatch(transactionStatusRootSource, /handleVisibilityChange/);
});

test("Feature styles stay with their owning modules instead of the global cascade", () => {
  for (const [sourcePath, stylesheet] of featureStyleOwners) {
    const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
    assert.match(source, new RegExp(`import ["']\\./${stylesheet.replace(".", "\\.")}["']`));
  }
  for (const selector of [
    ".magazine-canvas",
    ".world-memory-canvas",
    ".news-feed-canvas",
    ".transaction-status-canvas",
    ".settings-shell",
    ".portfolio-shell",
    ".reports-layout",
    ".stock-board",
    ".earning-calendar-board",
  ]) {
    assert.doesNotMatch(globalStylesSource, new RegExp(`\\${selector}\\b`));
  }
});

test("responsive feature rules stay out of the always-loaded agent shell stylesheet", () => {
  for (const forbiddenSelectorPrefix of [
    ".arca-notification-",
    ".board-index-",
    ".calendar-",
    ".daily-intelligence-",
    ".earning-",
    ".economic-",
    ".magazine-",
    ".memory-dialog",
    ".mockup-stage",
    ".news-feed-",
    ".portfolio-",
    ".report-",
    ".reports-",
    ".settings-",
    ".stock-board-",
    ".toss-auth-",
    ".toss-order-sync-",
    ".workspace-header",
    ".workspace-shell",
    ".world-memory-",
  ]) {
    assert.equal(
      agentShellStylesSource.includes(forbiddenSelectorPrefix),
      false,
      `agent-shell.css must not own ${forbiddenSelectorPrefix} rules`
    );
  }

  for (const [stylesheetPath, representativeSelector] of responsiveFeatureStyles) {
    const stylesheetSource = readFileSync(new URL(stylesheetPath, import.meta.url), "utf8");
    assert.match(stylesheetSource, /@media \(max-width:/);
    assert.equal(
      stylesheetSource.includes(representativeSelector),
      true,
      `${stylesheetPath} must own ${representativeSelector}`
    );
  }

  assert.match(mediumShellStylesSource, /\.codex-sidebar\s*{\s*display: none;/);
  assert.doesNotMatch(mediumShellStylesSource, /\.app-sidebar\s*{\s*display: none;/);
  assert.match(
    mediumShellStylesSource,
    /grid-template-columns: var\(--app-sidebar-width\) minmax\(0, 1fr\);/
  );
  assert.match(narrowShellStylesSource, /\.app-sidebar\s*{\s*display: none;/);
  assert.match(narrowShellStylesSource, /grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(globalStylesSource, /\.portfolio-asset-api-modal-backdrop/);
});

test("shared Toss API status owns and loads its styles wherever the component is reused", () => {
  assert.match(portfolioWorkspaceHeaderSource, /import ["']\.\/portfolioTossApiStatus\.css["']/);
  assert.match(portfolioWorkspaceHeaderSource, /export function PortfolioTossApiStatus/);
  assert.match(transactionStatusViewsSource, /<PortfolioTossApiStatus/);
  assert.match(portfolioTossApiStatusStylesSource, /\.portfolio-asset-api-status\s*\{/);
  assert.match(portfolioTossApiStatusStylesSource, /\.portfolio-asset-api-settings\s*\{/);
  assert.doesNotMatch(portfolioStylesSource, /\.portfolio-asset-api-status\s*\{/);
});

test("mobile Transaction Status keeps both the sidebar and detail pane reachable", () => {
  assert.match(
    transactionStatusStylesSource,
    /\.transaction-side-position-list\s*{[^}]*grid-auto-rows: max-content;/
  );
  assert.match(mobileTransactionStatusStylesSource, /\.transaction-status-canvas\s*{\s*display: block;/);
  assert.match(
    mobileTransactionStatusStylesSource,
    /grid-template-rows: clamp\(320px, 46vh, 420px\) minmax\(560px, auto\);/
  );
  assert.match(
    mobileTransactionStatusStylesSource,
    /\.transaction-section-rail\s*{\s*grid-row: 1 \/ -1;/
  );
  assert.match(
    mobileTransactionStatusStylesSource,
    /\.transaction-main-section\s*{[^}]*grid-row: 2;[^}]*min-height: 560px;/
  );
  assert.match(
    mobileTransactionStatusStylesSource,
    /\.transaction-watchlist-section\s*{[^}]*grid-row: 1 \/ -1;[^}]*grid-template-rows:/
  );
});

test("Portfolio canvas storage and lifecycle stay behind the portfolio controller", () => {
  assert.match(appSource, /usePortfolioCanvasController/);
  assert.doesNotMatch(appSource, /const \[portfolioCanvasStore/);
  assert.doesNotMatch(appSource, /loadPortfolioCanvasStoreFile|savePortfolioCanvasStoreFile/);
  assert.match(portfolioCanvasControllerSource, /loadPortfolioCanvasStoreFile/);
  assert.match(portfolioCanvasControllerSource, /savePortfolioCanvasStoreFile/);
  assert.match(portfolioCanvasControllerSource, /buildPortfolioCanvasCreateState/);
  assert.match(portfolioCanvasControllerSource, /buildPortfolioCanvasDeleteState/);
  assert.match(portfolioCanvasControllerSource, /updatePortfolioCanvasChatMessages/);
});

test("App does not call backend feature endpoints directly", () => {
  assert.doesNotMatch(appSource, /fetch\([`"]\/api\//);
});
