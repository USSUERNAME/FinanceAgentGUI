import React from "react";
import BookOpenText from "lucide-react/dist/esm/icons/book-open-text.js";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import FileText from "lucide-react/dist/esm/icons/file-text.js";
import Home from "lucide-react/dist/esm/icons/home.js";
import Landmark from "lucide-react/dist/esm/icons/landmark.js";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.js";
import Newspaper from "lucide-react/dist/esm/icons/newspaper.js";
import PieChart from "lucide-react/dist/esm/icons/chart-pie.js";
import ReceiptText from "lucide-react/dist/esm/icons/receipt-text.js";
import Settings from "lucide-react/dist/esm/icons/settings.js";
import TrendingUp from "lucide-react/dist/esm/icons/trending-up.js";
import { newsFeedSidebarHealthState } from "../news/newsFeedStatus.js";
import { PortfolioCanvasNavList } from "../portfolio/PortfolioCanvasNavList.jsx";

const leftSidebarSections = [
  {
    title: "작업",
    items: [
      { label: "주식채널", icon: Home, view: "stock", statusKey: "arcaNotifications" },
      { label: "거래 현황", icon: ReceiptText, view: "transaction-status" },
      { label: "News Feed", icon: Newspaper, view: "news-feed", statusKey: "newsFeed" },
      { label: "Magazine", icon: BookOpenText, view: "magazine" },
      { label: "Earning Calendar", icon: CalendarDays, view: "earning-calendar" },
      { label: "Economic Calendar", icon: Landmark, view: "economic-calendar" },
      { label: "채팅", icon: MessageSquare, view: "chat" },
      { label: "Daily Intelligence", icon: TrendingUp, view: "daily-intelligence" },
      { label: "보고서", icon: FileText, view: "reports" },
      { label: "포트폴리오", icon: PieChart, view: "portfolio" },
    ],
  },
];

const sidebarUtilityItems = [
  { label: "World Memory", icon: Database, view: "world-memory", statusKey: "worldMemory" },
  { label: "설정", icon: Settings, view: "settings" },
];

function NavStatusDot({ health }) {
  if (!health || health.showSidebarDot === false) return null;
  const level = health.sidebarLevel || health.level;
  return (
    <span
      className={[
        "nav-status-dot",
        level ? `is-${level}` : "",
        health.isCollecting ? "is-collecting" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={health.ariaLabel}
    />
  );
}

function formatUnreadBadgeCount(value) {
  const count = Math.max(0, Math.trunc(Number(value || 0)));
  return count.toLocaleString("ko-KR");
}

export function AppNavigation({
  activePortfolioCanvas,
  activeView,
  arcaNotificationHealth,
  editingPortfolioCanvasId,
  magazineStatus,
  magazineEnabled = false,
  nameInputRef,
  newsFeedMarketSummary,
  newsFeedStatus,
  notificationStatus,
  onDraftChange,
  onDraftKeyDown,
  onDuplicateCanvas,
  onMenuToggle,
  onRenameCanvas,
  onRequestDeleteCanvas,
  onSaveDraft,
  onSelectCanvas,
  onSelectItem,
  onSelectUtility,
  portfolioCanvasModeMeta,
  portfolioCanvasNameDraft,
  portfolioCanvasMenuId,
  portfolioCanvases,
  portfolioSidebarOpen,
  transactionStatusHidden = false,
  worldMemoryEnabled = false,
  worldMemoryHealth,
}) {
  const PortfolioChevron = portfolioSidebarOpen ? ChevronDown : ChevronRight;

  return (
    <aside className="app-sidebar" aria-label="FinanceAgentGUI navigation">
      <div className="app-sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          <TrendingUp size={15} strokeWidth={2.4} />
        </span>
        <span>주식채널+</span>
      </div>

      <nav className="app-sidebar-nav" aria-label="주요 작업">
        {leftSidebarSections.map((section) => (
          <section className="nav-section" key={section.title}>
            <h2>{section.title}</h2>
            <div className="nav-list">
              {section.items
                .filter((item) => item.view !== "world-memory" || worldMemoryEnabled)
                .filter((item) => item.view !== "magazine" || magazineEnabled)
                .filter((item) => item.view !== "transaction-status" || !transactionStatusHidden)
                .map((item) => {
                  const Icon = item.icon;
                  const itemStatusHealth =
                    item.statusKey === "newsFeed"
                      ? newsFeedSidebarHealthState(newsFeedStatus, newsFeedMarketSummary)
                      : item.statusKey === "arcaNotifications"
                        ? arcaNotificationHealth
                        : null;
                  const isPortfolioItem = item.view === "portfolio";
                  const isPortfolioSurface = activeView === "portfolio" || activeView === "portfolio-canvas";
                  const isActiveItem = isPortfolioItem ? isPortfolioSurface : item.view === activeView;
                  const showReportsUrgentUpdateBadge =
                    item.view === "reports" && notificationStatus?.reportsUrgentUpdate?.showBadge;
                  const reportsUrgentUpdateSummary = notificationStatus?.reportsUrgentUpdate?.summary || "";
                  const arcaNotificationCount =
                    item.statusKey === "arcaNotifications"
                      ? Math.max(0, Math.trunc(Number(itemStatusHealth?.count || 0)))
                      : 0;
                  const showArcaNotificationBadge =
                    item.statusKey === "arcaNotifications" && itemStatusHealth?.showNotificationCount === true;
                  const showNewsFeedUnreadBadge = item.statusKey === "newsFeed";
                  const newsFeedUnreadCount =
                    showNewsFeedUnreadBadge
                      ? Math.max(0, Math.trunc(Number(newsFeedStatus?.readState?.unreadTranslatedCount || 0)))
                      : 0;
                  const newsFeedUnreadText = formatUnreadBadgeCount(newsFeedUnreadCount);
                  const showMagazineArticleBadge = item.view === "magazine";
                  const magazineUnreadCount = showMagazineArticleBadge
                    ? Math.max(0, Math.trunc(Number(magazineStatus?.readState?.unreadArticleCount || 0)))
                    : 0;
                  const magazineUnreadText = formatUnreadBadgeCount(magazineUnreadCount);
                  return (
                    <React.Fragment key={item.label}>
                      <button
                        className={[
                          "nav-item",
                          isActiveItem ? "is-active" : "",
                          showReportsUrgentUpdateBadge ? "is-critical-alert" : "",
                          isPortfolioItem ? "has-children" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        onClick={() => onSelectItem(item)}
                        title={
                          showReportsUrgentUpdateBadge
                            ? `긴급 업데이트${reportsUrgentUpdateSummary ? `: ${reportsUrgentUpdateSummary}` : ""}`
                            : itemStatusHealth
                              ? itemStatusHealth.title
                              : item.label
                        }
                        aria-expanded={isPortfolioItem ? portfolioSidebarOpen : undefined}
                      >
                        <Icon size={16} strokeWidth={2} />
                        <span className="nav-item-label">
                          <span className="nav-item-text">{item.label}</span>
                          {showArcaNotificationBadge ? (
                            <span
                              className="nav-unread-count nav-arca-count"
                              aria-label={`아카라이브 알림 ${formatUnreadBadgeCount(arcaNotificationCount)}개`}
                            >
                              {formatUnreadBadgeCount(arcaNotificationCount)}
                            </span>
                          ) : null}
                          {showNewsFeedUnreadBadge ? (
                            <span
                              className="nav-unread-count"
                              aria-label={`안 읽은 News Feed ${formatUnreadBadgeCount(newsFeedUnreadCount)}개`}
                            >
                              {newsFeedUnreadText}
                            </span>
                          ) : null}
                          {showMagazineArticleBadge ? (
                            <span
                              className="nav-unread-count nav-magazine-count"
                              aria-label={`확인 안 한 Magazine 새 글 ${formatUnreadBadgeCount(magazineUnreadCount)}개`}
                            >
                              {magazineUnreadText}
                            </span>
                          ) : null}
                          {showReportsUrgentUpdateBadge ? (
                            <span
                              className="nav-unread-count nav-critical-update-badge"
                              aria-label="보고서 긴급 업데이트"
                            >
                              긴급 업데이트
                            </span>
                          ) : null}
                        </span>
                        <NavStatusDot health={itemStatusHealth} />
                        {isPortfolioItem ? (
                          <PortfolioChevron className="nav-item-chevron" size={15} strokeWidth={2.2} />
                        ) : null}
                      </button>
                      {isPortfolioItem && portfolioSidebarOpen ? (
                        <PortfolioCanvasNavList
                          activeCanvasId={activePortfolioCanvas?.id || ""}
                          activeView={activeView}
                          canvases={portfolioCanvases}
                          editingCanvasId={editingPortfolioCanvasId}
                          menuCanvasId={portfolioCanvasMenuId}
                          nameDraft={portfolioCanvasNameDraft}
                          nameInputRef={nameInputRef}
                          onDraftChange={onDraftChange}
                          onDraftKeyDown={onDraftKeyDown}
                          onDuplicateCanvas={onDuplicateCanvas}
                          onMenuToggle={onMenuToggle}
                          onRenameCanvas={onRenameCanvas}
                          onRequestDeleteCanvas={onRequestDeleteCanvas}
                          onSaveDraft={onSaveDraft}
                          onSelectCanvas={onSelectCanvas}
                          portfolioCanvasModeMeta={portfolioCanvasModeMeta}
                        />
                      ) : null}
                    </React.Fragment>
                  );
                })}
            </div>
          </section>
        ))}
      </nav>

      <nav className="app-sidebar-footer" aria-label="시스템">
        {sidebarUtilityItems
          .filter((item) => item.view !== "world-memory" || worldMemoryEnabled)
          .map((item) => {
            const Icon = item.icon;
            const itemStatusHealth = item.statusKey === "worldMemory" ? worldMemoryHealth : null;
            return (
              <button
                className={item.view === activeView ? "nav-item is-active" : "nav-item"}
                type="button"
                key={item.label}
                onClick={() => onSelectUtility(item)}
                title={itemStatusHealth ? itemStatusHealth.title : item.label}
              >
                <Icon size={16} strokeWidth={2} />
                <span className="nav-item-text">{item.label}</span>
                <NavStatusDot health={itemStatusHealth} />
              </button>
            );
          })}
      </nav>
    </aside>
  );
}
