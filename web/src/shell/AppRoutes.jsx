import React from "react";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import { ChatCanvas } from "../agent/ChatCanvas.jsx";
import StockChannelView from "../arca/StockChannelView.jsx";
import { ARCA_NOTIFICATION_URL, ARCA_WRITE_URL } from "../arca/useArcaController.js";
import {
  portfolioCanvasModeList,
} from "../portfolio/canvasModes.jsx";
import {
  portfolioTheoryPrinciples,
} from "../portfolio/workspaceReferenceContent.js";

const SettingsView = React.lazy(() => import("../settings/SettingsView.jsx"));
const ReportsView = React.lazy(() => import("../reports/ReportsView.jsx"));
const NewsFeedView = React.lazy(() => import("../news/NewsFeedView.jsx"));
const TransactionStatusView = React.lazy(() => import("../transactions/TransactionStatusView.jsx"));
const WorldMemoryView = React.lazy(() => import("../worldMemory/WorldMemoryView.jsx"));
const MagazineWorkspace = React.lazy(() => import("../magazine/MagazineWorkspace.jsx"));
const EarningCalendarView = React.lazy(() =>
  import("../calendars/CalendarViews.jsx").then((module) => ({ default: module.EarningCalendarView }))
);
const EconomicCalendarView = React.lazy(() =>
  import("../calendars/CalendarViews.jsx").then((module) => ({ default: module.EconomicCalendarView }))
);
const PortfolioGuidePage = React.lazy(() =>
  import("../portfolio/PortfolioGuidePage.jsx").then((module) => ({ default: module.PortfolioGuidePage }))
);
const PortfolioWorkspace = React.lazy(() =>
  import("../portfolio/PortfolioWorkspace.jsx").then((module) => ({ default: module.PortfolioWorkspace }))
);

const sortOptions = [
  { id: "", label: "등록순" },
  { id: "recentComment", label: "최근댓글" },
  { id: "commentCount", label: "댓글순" },
  { id: "rating", label: "추천순" },
];

const cutRateOptions = [
  { id: "", label: "추천컷" },
  { id: "5", label: "5컷" },
  { id: "10", label: "10컷" },
  { id: "20", label: "20컷" },
];

const searchTargetOptions = [
  { id: "all", label: "전체" },
  { id: "title_content", label: "제목+본문" },
  { id: "title", label: "제목" },
  { id: "content", label: "본문" },
  { id: "nickname", label: "작성자" },
];

export function RouteLoading({ label = "화면 불러오는 중" }) {
  return (
    <div className="route-loading-state" role="status" aria-live="polite">
      <LoaderCircle size={18} strokeWidth={2.2} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function SettingsRoute({ model }) {
  const {
    newsFeed,
    sharedMemory,
    worldMemory,
    magazine,
    transaction,
    arca,
    agent,
    tossInvest,
    tossOrderSync,
    transactionStatusHidden,
    onToggleWorldMemoryEnabled,
    onToggleTransactionStatusHidden,
  } = model;
  const busy = Boolean(
    newsFeed.newsFeedSettingsBusy ||
    worldMemory.worldMemorySettingsBusy ||
    magazine.magazineSettingsBusy ||
    tossInvest.busy ||
    tossOrderSync.busy ||
    transaction.transactionSettingsBusy
  );

  return (
    <section className="workspace-canvas settings-canvas" aria-label="설정">
      <React.Suspense fallback={<RouteLoading label="설정 불러오는 중" />}>
        <SettingsView
          settings={newsFeed.newsFeedSettings}
          busy={busy}
          savingFeedId={newsFeed.newsFeedSettingsSavingId}
          error={newsFeed.newsFeedSettingsError}
          onReload={() => {
            void newsFeed.loadNewsFeedSettings();
            void worldMemory.loadWorldMemorySettings({ refreshStatus: true });
            void magazine.loadMagazineSettings({ quiet: true });
            void tossInvest.onReload();
            void tossOrderSync.onReload();
            void transaction.loadTransactionSettings();
          }}
          onToggleFeed={newsFeed.toggleNewsFeedSource}
          onPollIntervalChange={newsFeed.updateNewsFeedPollInterval}
          memoryStatus={sharedMemory.memoryStatus}
          memoryBusy={sharedMemory.memoryBusy}
          memoryError={sharedMemory.memoryError}
          memoryRecentOpen={sharedMemory.memoryRecentOpen}
          onToggleMemoryRecent={sharedMemory.toggleMemoryRecent}
          onReloadMemory={sharedMemory.loadSharedMemoryStatus}
          onOpenMemoryDialog={sharedMemory.openMemoryDialog}
          onDeleteMemoryRecord={sharedMemory.deleteMemoryRecord}
          deletingMemoryRecordId={sharedMemory.deletingMemoryRecordId}
          memoryDialog={{
            open: sharedMemory.memoryDialogOpen,
            records: sharedMemory.memoryDialogRecords,
            totalCount: sharedMemory.memoryDialogTotalCount,
            hasMore: sharedMemory.memoryDialogHasMore,
            busy: sharedMemory.memoryDialogBusy,
            error: sharedMemory.memoryDialogError,
            deletingRecordId: sharedMemory.deletingMemoryRecordId,
            onClose: sharedMemory.closeMemoryDialog,
            onScroll: sharedMemory.handleMemoryDialogScroll,
          }}
          worldMemoryStatus={worldMemory.worldMemoryStatus}
          worldMemoryBusy={worldMemory.worldMemoryBusy}
          worldMemoryError={worldMemory.worldMemoryError}
          worldMemoryTechOpen={worldMemory.worldMemoryTechOpen}
          worldMemorySettings={worldMemory.worldMemorySettings}
          worldMemorySettingsBusy={worldMemory.worldMemorySettingsBusy}
          worldMemorySettingsSaving={worldMemory.worldMemorySettingsSaving}
          worldMemorySettingsError={worldMemory.worldMemorySettingsError}
          magazineSettings={magazine.magazineSettings}
          magazineSettingsBusy={magazine.magazineSettingsBusy}
          magazineSettingsSaving={magazine.magazineSettingsSaving}
          magazineSettingsError={magazine.magazineSettingsError}
          onToggleWorldMemoryTech={worldMemory.toggleWorldMemoryTech}
          onToggleWorldMemoryEnabled={onToggleWorldMemoryEnabled}
          onToggleWorldMemoryAutopilot={worldMemory.updateWorldMemoryAutopilotEnabled}
          onWorldMemoryManagementSettingsChange={worldMemory.updateWorldMemoryManagementSettings}
          onToggleMagazineEnabled={magazine.updateMagazineEnabled}
          onMagazineWritingSettingsChange={magazine.updateMagazineWritingSettings}
          onMagazineSchedulerIntervalChange={magazine.updateMagazineSchedulerInterval}
          onMagazineMaxArticlesPerCycleChange={magazine.updateMagazineMaxArticlesPerCycle}
          onReloadWorldMemory={worldMemory.loadWorldMemoryStatus}
          tossInvest={tossInvest}
          tossOrderSync={tossOrderSync}
          transactionStatusVisibility={{
            hidden: transactionStatusHidden,
            busy: transaction.transactionSettingsBusy,
            saving: transaction.transactionSettingsSaving,
            error: transaction.transactionSettingsError,
            onChange: onToggleTransactionStatusHidden,
          }}
          arcaAuth={{
            status: arca.arcaAuthStatus,
            busy: arca.arcaAuthBusy,
            action: arca.arcaAuthAction,
            error: arca.arcaAuthError,
            onReload: () => void arca.loadArcaAuthStatus(),
            onStartHandoff: arca.startArcaLoginHandoff,
            onCaptureSession: arca.captureArcaLoginSession,
            onStopHandoff: arca.stopArcaLoginHandoff,
            onDeleteSession: arca.deleteArcaLoginSession,
          }}
          agentSettings={agent}
        />
      </React.Suspense>
    </section>
  );
}

function ReportsRoute({ model }) {
  return (
    <section className="workspace-canvas reports-canvas" aria-label="보고서">
      <React.Suspense fallback={<RouteLoading label="보고서 불러오는 중" />}>
        <ReportsView {...model} />
      </React.Suspense>
    </section>
  );
}

function TransactionStatusRoute({ model }) {
  return (
    <React.Suspense fallback={<RouteLoading label="거래현황 불러오는 중" />}>
      <TransactionStatusView {...model} />
    </React.Suspense>
  );
}

function WorldMemoryRoute({ model }) {
  return (
    <section className="workspace-canvas world-memory-canvas" aria-label="World Memory">
      <React.Suspense fallback={<RouteLoading label="World Memory 불러오는 중" />}>
        <WorldMemoryView {...model.viewProps} />
      </React.Suspense>
    </section>
  );
}

function NewsFeedRoute({ model }) {
  return (
    <section className="workspace-canvas news-feed-canvas" aria-label="News Feed" onScroll={model.onScroll}>
      <React.Suspense fallback={<RouteLoading label="News Feed 불러오는 중" />}>
        <NewsFeedView {...model.viewProps} />
      </React.Suspense>
    </section>
  );
}

function PortfolioGuideRoute({ model }) {
  return (
    <section className="workspace-canvas portfolio-canvas" aria-label="포트폴리오">
      <div className="portfolio-shell">
        <React.Suspense fallback={<RouteLoading label="포트폴리오 화면 불러오는 중" />}>
          <PortfolioGuidePage
            modes={portfolioCanvasModeList}
            principles={portfolioTheoryPrinciples}
            onCreateCanvas={model.onCreateCanvas}
          />
        </React.Suspense>
      </div>
    </section>
  );
}

function PortfolioCanvasRoute({ model }) {
  const { canvas, workspaceProps, onCreateCanvas } = model;
  return (
    <section
      className="workspace-canvas portfolio-canvas"
      aria-label={canvas ? `${canvas.name} 포트폴리오 캔버스` : "포트폴리오"}
    >
      <React.Suspense fallback={<RouteLoading label="포트폴리오 캔버스 불러오는 중" />}>
        {canvas ? (
          <PortfolioWorkspace key={canvas.id} canvas={canvas} {...workspaceProps} />
        ) : (
          <div className="portfolio-shell">
            <PortfolioGuidePage
              modes={portfolioCanvasModeList}
              principles={portfolioTheoryPrinciples}
              onCreateCanvas={onCreateCanvas}
            />
          </div>
        )}
      </React.Suspense>
    </section>
  );
}

function CalendarRoute({ type, model }) {
  if (type === "earning") {
    return (
      <section className="workspace-canvas calendar-canvas" aria-label="Earning Calendar">
        <React.Suspense fallback={<RouteLoading label="실적 캘린더 불러오는 중" />}>
          <EarningCalendarView {...model} />
        </React.Suspense>
      </section>
    );
  }
  return (
    <section className="workspace-canvas calendar-canvas" aria-label="Economic Calendar">
      <React.Suspense fallback={<RouteLoading label="경제 캘린더 불러오는 중" />}>
        <EconomicCalendarView {...model} />
      </React.Suspense>
    </section>
  );
}

function StockChannelRoute({ model }) {
  return (
    <StockChannelView
      {...model}
      cutRateOptions={cutRateOptions}
      searchTargetOptions={searchTargetOptions}
      sortOptions={sortOptions}
      writeUrl={ARCA_WRITE_URL}
      notificationUrl={ARCA_NOTIFICATION_URL}
    />
  );
}

export function AppRoutes({ activeView, models }) {
  if (activeView === "settings") return <SettingsRoute model={models.settings()} />;
  if (activeView === "chat") return <ChatCanvas {...models.chat()} />;
  if (activeView === "reports") return <ReportsRoute model={models.reports()} />;
  if (activeView === "transaction-status") {
    return <TransactionStatusRoute model={models.transactionStatus()} />;
  }
  if (activeView === "world-memory") {
    const worldMemoryModel = models.worldMemory();
    if (worldMemoryModel.enabled) return <WorldMemoryRoute model={worldMemoryModel} />;
  }
  if (activeView === "news-feed") return <NewsFeedRoute model={models.newsFeed()} />;
  if (activeView === "magazine") return <MagazineWorkspace {...models.magazine()} />;
  if (activeView === "portfolio") return <PortfolioGuideRoute model={models.portfolio()} />;
  if (activeView === "portfolio-canvas") {
    return <PortfolioCanvasRoute model={models.portfolioCanvas()} />;
  }
  if (activeView === "earning-calendar") {
    return <CalendarRoute type="earning" model={models.earningCalendar()} />;
  }
  if (activeView === "economic-calendar") {
    return <CalendarRoute type="economic" model={models.economicCalendar()} />;
  }
  return <StockChannelRoute model={models.stock()} />;
}
