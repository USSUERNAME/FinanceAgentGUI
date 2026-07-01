import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.js";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import FilePlus2 from "lucide-react/dist/esm/icons/file-plus-2.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import SendHorizontal from "lucide-react/dist/esm/icons/send-horizontal.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import codexLogo from "./assets/codex-logo-transparent.png";
import antigravityLogo from "./assets/antigravity-logo.png";
import stockChannelMagazineLogo from "./assets/stock-channel-magazine-logo.png";
import { AgentSidebar } from "./agent/AgentSidebar.jsx";
import { ChatCanvas } from "./agent/ChatCanvas.jsx";
import {
  antigravityModelGroups,
  antigravityPolicyOptions,
  emptyAgentSettings,
  fallbackApprovalOptions,
  fallbackModelGroups,
  fallbackProviderOptions,
  getSpeedOptions,
  loadingApprovalOptions,
  loadingModelGroups,
  modelGroupsFromAntigravityCatalog,
  personaModeOptions,
} from "./agent/agentOptions.js";
import {
  ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
  selectAntigravityModelForReasoning,
} from "./agent/antigravityModelSelection.js";
import { attachmentsSummary } from "./agent/attachments.js";
import { messageToHistoryText, parseSseEvent } from "./agent/chatProtocol.js";
import { buildPromptWithArticleContext } from "./arca/articleContext.js";
import StockChannelView from "./arca/StockChannelView.jsx";
import { buildEarningAnalysisPrompt, displayEarningValue } from "./calendars/earningPrompt.js";
import { emptyMemoryStatus } from "./memory/sharedMemoryDefaults.js";
import {
  parsePortfolioWidgetJsonAction,
  stripPortfolioWidgetActionBlocks,
} from "./portfolio/actionParser.js";
import {
  isPortfolioWidgetReferenceToken,
  parsePortfolioWidgetNumber,
} from "./portfolio/datasetParser.js";
import {
  buildPortfolioChatActionInstructions,
  buildPortfolioWidgetAgentPrompt,
} from "./portfolio/agentPromptBuilder.js";
import {
  selectPortfolioWidgetRequestAttachments,
} from "./portfolio/widgetRequestAttachments.js";
import {
  cleanPortfolioWidgetText as cleanPortfolioWidgetPrompt,
} from "./portfolio/widgetIdentity.js";
import {
  PortfolioCanvasDeleteDialog,
} from "./portfolio/PortfolioCanvasDeleteDialog.jsx";
import { PortfolioAssetApiDialog } from "./portfolio/PortfolioAssetApiDialog.jsx";
import {
  normalizePortfolioCanvasStore,
  normalizePortfolioChatMessages,
  portfolioCanvasStoreHasCanvases,
  readStoredPortfolioCanvasStore,
  writeStoredPortfolioCanvasStore,
} from "./portfolio/workspaceState.js";
import {
  PORTFOLIO_CANVAS_MODES,
  portfolioCanvasModeList,
  portfolioCanvasModeMeta,
} from "./portfolio/canvasModes.jsx";
import {
  portfolioSchemaTables,
  portfolioTheoryPrinciples,
} from "./portfolio/workspaceReferenceContent.js";
import {
  normalizePortfolioWidgetReferenceList,
} from "./portfolio/widgetRelations.js";
import {
  buildPortfolioCanvasCreateState,
  buildPortfolioCanvasDeleteState,
  buildPortfolioCanvasDuplicateState,
  buildPortfolioCanvasRenameState,
  buildPortfolioCanvasSelectState,
  buildPortfolioCanvasWorkspaceUpdateState,
} from "./portfolio/canvasStoreActions.js";
import { formatCount, formatDateTime, formatFileSize } from "./utils/formatters.js";
import { MarkdownText } from "./utils/MarkdownText.jsx";
import { parseReportArtifactAction, stripReportArtifactBlocks } from "./reports/reportArtifactAction.js";
import { AppNavigation } from "./shell/AppNavigation.jsx";
import { compactVisibleScreenText, collectVisibleScreenSnapshot } from "./shell/screenSnapshot.js";
import { worldMemoryActionCatalog } from "./worldMemory/actionCatalog.js";
import { buildWorldMemoryAskRequest } from "./worldMemory/askRequest.js";
import { worldMemoryActionText } from "./worldMemory/statusHelpers.js";

const SettingsView = React.lazy(() => import("./settings/SettingsView.jsx"));
const ReportsView = React.lazy(() => import("./reports/ReportsView.jsx"));
const NewsFeedView = React.lazy(() => import("./news/NewsFeedView.jsx"));
const WorldMemoryView = React.lazy(() => import("./worldMemory/WorldMemoryView.jsx"));
const MagazinePortfolioEChart = React.lazy(() =>
  import("./portfolio/PortfolioEChart.jsx").then((module) => ({ default: module.PortfolioEChart }))
);
const EarningCalendarView = React.lazy(() =>
  import("./calendars/CalendarViews.jsx").then((module) => ({ default: module.EarningCalendarView }))
);
const EconomicCalendarView = React.lazy(() =>
  import("./calendars/CalendarViews.jsx").then((module) => ({ default: module.EconomicCalendarView }))
);
const PortfolioGuidePage = React.lazy(() =>
  import("./portfolio/PortfolioGuidePage.jsx").then((module) => ({ default: module.PortfolioGuidePage }))
);
const PortfolioWorkspace = React.lazy(() =>
  import("./portfolio/PortfolioWorkspace.jsx").then((module) => ({ default: module.PortfolioWorkspace }))
);

const initialChatMessages = [];
const CODEX_PROVIDER_ID = "codex-cli";
const ANTIGRAVITY_PROVIDER_ID = "antigravity-cli";
const agentProviderIds = [CODEX_PROVIDER_ID, ANTIGRAVITY_PROVIDER_ID];
function normalizeAgentModelProvider(value) {
  return value === CODEX_PROVIDER_ID || value === ANTIGRAVITY_PROVIDER_ID ? value : "default";
}
const magazineFallbackTopics = [
  { label: "시장", emoji: "📈", tone: "market" },
  { label: "금융", emoji: "🏦", tone: "finance" },
  { label: "경제", emoji: "🌐", tone: "economy" },
  { label: "산업", emoji: "🏭", tone: "industry" },
  { label: "테크", emoji: "💻", tone: "tech" },
  { label: "정치", emoji: "🏛️", tone: "policy" },
  { label: "AI", emoji: "🤖", tone: "ai" },
  { label: "기후", emoji: "🌱", tone: "climate" },
  { label: "크립토", emoji: "🪙", tone: "crypto" },
];
const magazineToneSequence = ["market", "finance", "economy", "industry", "tech", "policy", "ai", "climate", "crypto"];
const MAGAZINE_ARTICLE_PAGE_SIZE = 5;
const MAGAZINE_GENERATE_ONE_TOOL_STORAGE_KEY = "finance-agent-gui:magazine-generate-one-tool";
const magazineDefaultFollowupOptions = [
  {
    id: "deeper-data",
    label: "데이터를 더 자세히",
    prompt: "이 주제의 핵심 데이터를 더 비교하는 후속 기사",
    tone: "market",
  },
  {
    id: "market-impact",
    label: "시장 영향 더 보기",
    prompt: "이 이슈가 자산 가격과 업종에 미치는 영향",
    tone: "finance",
  },
  {
    id: "company-map",
    label: "관련 기업으로 확장",
    prompt: "연결되는 기업, ETF, 산업 밸류체인을 정리하는 기사",
    tone: "industry",
  },
  {
    id: "next-signal",
    label: "다음 신호 추적",
    prompt: "이 이슈를 확인하거나 반박할 다음 지표와 일정",
    tone: "economy",
  },
];
const magazineHeadlineStory = {
  topic: "커버 스토리",
  title: "금리 이후의 시장, 성장주의 판이 다시 열리나",
  deck:
    "달러 약세, 금리 인하 기대, 실적 시즌의 방향성이 한 화면에 걸린 이번 주 시장의 중심축을 짚습니다. 성장주 반등이 단순한 유동성 랠리인지, 아니면 이익 전망과 투자 심리가 함께 되살아나는 초기 신호인지 구분하는 것이 핵심입니다. 이번 커버스토리는 반도체, AI 인프라, 금융 여건, 경기민감 업종의 움직임을 연결해 다음 시장 국면의 주도권이 어디로 이동하는지 살펴봅니다.",
  image:
    "https://images.unsplash.com/photo-1740199929970-1c884baae7d8?auto=format&fit=crop&w=1200&q=80",
  imageAlt: "도시 금융 지구의 고층 빌딩 전경",
  imageCredit: "사진: Unsplash",
};
const magazineFeatureStories = [
  {
    topic: "시장",
    title: "리스크 온의 재개, 지수보다 강한 섹터는 어디인가",
    image:
      "https://images.unsplash.com/photo-1742076553114-cfd4f27de46f?auto=format&fit=crop&w=900&q=80",
    imageAlt: "노트북 화면에 표시된 주식 시장 차트",
    imageCredit: "사진: Unsplash",
  },
  {
    topic: "AI",
    title: "데이터센터 전력 수요가 다시 CAPEX를 흔든다",
    image:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=900&q=80",
    imageAlt: "데이터센터 서버 랙",
    imageCredit: "사진: Unsplash",
  },
  {
    topic: "산업",
    title: "항만과 운임이 말하는 공급망의 온도",
    image:
      "https://images.unsplash.com/photo-1769144256207-bc4bb75b29db?auto=format&fit=crop&w=900&q=80",
    imageAlt: "컨테이너를 실은 화물선과 항만",
    imageCredit: "사진: Unsplash",
  },
  {
    topic: "기후",
    title: "재생에너지 투자, 금리 하락 국면의 수혜가 될까",
    image:
      "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=900&q=80",
    imageAlt: "넓게 펼쳐진 태양광 패널",
    imageCredit: "사진: Unsplash",
  },
];
const magazineFallbackCoverStories = [magazineHeadlineStory, ...magazineFeatureStories];
const magazineArticleList = [
  {
    topics: ["시장", "경제"],
    title: "달러 약세와 실적 기대가 만든 위험자산의 새 균형",
    image:
      "https://images.unsplash.com/photo-1742076553114-cfd4f27de46f?auto=format&fit=crop&w=900&q=80",
    imageAlt: "노트북 화면에 표시된 주식 시장 차트",
    imageCredit: "사진: Unsplash",
    summary:
      "금리 인하 기대가 선반영된 구간에서 환율, 이익 전망, 밸류에이션이 동시에 움직이는 흐름을 정리합니다. 최근 위험자산 반등은 단순한 유동성 기대만으로 설명하기 어렵고, 달러 약세와 기업 실적의 하향 안정이 함께 작동하고 있습니다. 이번 글은 시장이 어떤 조건에서 성장주와 경기민감주를 다시 가격에 반영하는지, 그리고 투자자가 확인해야 할 조기 신호가 무엇인지 분해합니다.",
  },
  {
    topics: ["AI", "테크"],
    title: "AI 인프라 병목은 GPU가 아니라 전력에서 시작된다",
    image:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=900&q=80",
    imageAlt: "데이터센터 서버 랙",
    imageCredit: "사진: Unsplash",
    summary:
      "데이터센터 증설 경쟁이 전력망, 냉각, 부동산, 클라우드 CAPEX로 번지는 경로를 기사 후보로 분해합니다. AI 수요는 여전히 GPU와 모델 경쟁으로 소비되지만, 실제 투자 병목은 전력 인입과 운영 효율에서 먼저 드러나는 중입니다. 이 글은 전력 계약, 서버 밀도, 클라우드 기업의 자본지출 계획을 연결해 AI 인프라 사이클의 다음 수혜 영역을 살펴봅니다.",
  },
  {
    topics: ["산업", "금융"],
    title: "운임 반등이 제조업 마진에 보내는 조기 신호",
    image:
      "https://images.unsplash.com/photo-1769144256207-bc4bb75b29db?auto=format&fit=crop&w=900&q=80",
    imageAlt: "컨테이너를 실은 화물선과 항만",
    imageCredit: "사진: Unsplash",
    summary:
      "항만 체류, 컨테이너 운임, 재고 사이클을 함께 보며 산업재와 소비재의 비용 압력을 추적합니다. 운임 반등이 일시적인 병목인지, 아니면 제조업 주문 회복의 신호인지에 따라 시장 해석은 크게 달라집니다. 이번 글은 물류 비용 변화가 기업 마진, 납기, 재고 보충 전략에 미치는 영향을 정리하고 관련 업종의 민감도를 비교합니다.",
  },
  {
    topics: ["기후", "정치"],
    title: "재생에너지 보조금 논쟁이 다시 투자 사이클을 흔든다",
    image:
      "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=900&q=80",
    imageAlt: "넓게 펼쳐진 태양광 패널",
    imageCredit: "사진: Unsplash",
    summary:
      "정책 불확실성과 금리 변화가 태양광, 배터리, 전력 인프라 기업의 투자 판단에 미치는 영향을 요약합니다. 재생에너지 섹터는 장기 수요가 분명해도 보조금, 인허가, 자금조달 비용에 따라 단기 주가가 크게 흔들립니다. 이 글은 정책 논쟁이 프로젝트 파이프라인과 밸류에이션에 어떤 경로로 반영되는지, 그리고 금리 하락이 실제 주문 회복으로 이어지는 조건을 살핍니다.",
  },
  {
    topics: ["크립토", "금융"],
    title: "ETF 자금 유입 이후 크립토 시장의 두 번째 관문",
    image:
      "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=900&q=80",
    imageAlt: "암호화폐 동전과 전자 회로 이미지",
    imageCredit: "사진: Unsplash",
    summary:
      "기관 자금 유입 이후 유동성, 규제, 스테이블코인 결제망이 다음 가격 발견 구간을 어떻게 만들지 살핍니다. ETF 출시 이후 시장은 단기 수급보다 제도권 금융과 온체인 생태계가 만나는 구조적 변화를 더 크게 반영하고 있습니다. 이 글은 거래소 유동성, 커스터디, 결제 인프라, 규제 리스크를 함께 놓고 크립토 시장의 두 번째 성장 관문을 점검합니다.",
  },
];
const magazineMockArticleSections = [
  {
    heading: "이슈의 핵심",
    body:
      "이번 목업 기사는 월드 메모리에서 감지한 주요 이슈를 하나의 매거진형 기사로 확장했을 때의 읽기 경험을 확인하기 위한 샘플입니다. 실제 구현에서는 이 위치에 핵심 배경, 시장 맥락, 관련 기업, 확인해야 할 데이터 포인트가 들어가게 됩니다.",
  },
  {
    heading: "시장이 보는 신호",
    body:
      "금리, 환율, 수급, 실적 전망은 서로 따로 움직이는 것처럼 보이지만 기사 작성 단계에서는 하나의 내러티브로 묶여야 합니다. 독자는 이 문단에서 단순한 뉴스 요약이 아니라 왜 지금 이 주제가 중요한지, 어떤 변수가 다음 국면을 바꿀 수 있는지를 빠르게 파악하게 됩니다.",
  },
  {
    heading: "다음 확인 포인트",
    body:
      "후속 기사에서는 관련 기업의 실적 발표, 정책 일정, 원자재 가격, ETF 자금 흐름, 산업별 주문 지표를 함께 비교할 수 있습니다. 이 목업은 그런 리서치 큐가 기사 본문으로 변환됐을 때 화면 안에서 충분히 읽을 만한지 확인하는 용도입니다.",
  },
];

function normalizeMagazineTopicCatalog(topics) {
  const sourceTopics = Array.isArray(topics) && topics.length ? topics : magazineFallbackTopics;
  const seen = new Set();
  const normalized = sourceTopics
    .map((topic, index) => {
      const label = String(topic?.label || topic || "").trim();
      if (!label || seen.has(label)) return null;
      seen.add(label);
      return {
        label,
        emoji: String(topic?.emoji || "").trim(),
        tone: String(topic?.tone || magazineToneSequence[index % magazineToneSequence.length] || "market").trim(),
      };
    })
    .filter(Boolean);
  return normalized.length ? normalized : magazineFallbackTopics;
}

function MagazineTopicRow({ topics, activeTopic = "", onSelectTopic, ariaLabel = "매거진 토픽" }) {
  return (
    <div className="magazine-topic-row" aria-label={ariaLabel}>
      {topics.map((topic) => (
        <button
          className={[
            "magazine-topic-badge",
            `is-${topic.tone}`,
            activeTopic === topic.label ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          key={topic.label}
          aria-pressed={activeTopic === topic.label}
          onClick={(event) => onSelectTopic(event, topic.label)}
        >
          {topic.emoji ? (
            <span className="magazine-topic-emoji" aria-hidden="true">
              {topic.emoji}
            </span>
          ) : null}
          <span>{topic.label}</span>
        </button>
      ))}
    </div>
  );
}

function magazineArticleTopics(article) {
  const topics = Array.isArray(article?.topics)
    ? article.topics
    : [article?.topic].filter(Boolean);
  return topics.map((topic) => String(topic || "").trim()).filter(Boolean);
}

const magazineArticlePublishedFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const magazineUpdateScheduleFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function magazineArticlePublishedTime(article) {
  const rawValue = article?.publishedAt || article?.createdAt || article?.updatedAt || "";
  if (!rawValue) return null;
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return null;
  return {
    dateTime: date.toISOString(),
    label: `송고 ${magazineArticlePublishedFormatter.format(date)}`,
  };
}

function MagazinePublishedTime({ article, className = "" }) {
  const publishedTime = magazineArticlePublishedTime(article);
  if (!publishedTime) return null;
  const classes = ["magazine-published-time", className].filter(Boolean).join(" ");
  return (
    <time className={classes} dateTime={publishedTime.dateTime}>
      {publishedTime.label}
    </time>
  );
}

function formatMagazineUpdateScheduleTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    magazineUpdateScheduleFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.hour}시 ${parts.minute}분`;
}

function magazineLatestUpdateTimestamp(status, articles = []) {
  return (
    status?.latestArticle?.publishedAt ||
    status?.readState?.latestArticleAt ||
    articles?.[0]?.publishedAt ||
    articles?.[0]?.createdAt ||
    articles?.[0]?.updatedAt ||
    ""
  );
}

function magazineNextUpdateLabel(status) {
  if (status?.scheduler?.running || status?.scheduler?.currentCycle || status?.scheduler?.manualStartPending) {
    return "모델 판단 중";
  }
  if (status?.scheduler?.generationInFlight || status?.scheduler?.generationLock) return "작성 중";
  const nextUpdate = formatMagazineUpdateScheduleTime(
    status?.scheduler?.nextRetryAt || status?.scheduler?.nextRunAt
  );
  if (nextUpdate) return nextUpdate;
  if (status?.scheduler?.enabled === false) return "예정 없음";
  return "대기 중";
}

function magazineSchedulerIsActive(status) {
  const scheduler = status?.scheduler || {};
  return Boolean(
    scheduler.running ||
      scheduler.currentCycle ||
      scheduler.activeCycle ||
      scheduler.generationInFlight ||
      scheduler.generationLock ||
      scheduler.manualStartPending ||
      scheduler.manualStartRequestedAt
  );
}

function magazineArticleCountDecisionLabel(status) {
  const scheduler = status?.scheduler || {};
  if (scheduler.manualStartPending || scheduler.manualStartRequestedAt) {
    return "모델 판단 중: 지금 새 기사로 만들 만한 각도가 있는지 확인하고 있습니다.";
  }
  if (scheduler.generationInFlight || scheduler.generationLock) {
    return "작성 작업 실행 중: 기존 작업이 끝난 뒤 다음 모델 판단을 진행합니다.";
  }
  const cycle = scheduler.currentCycle || scheduler.activeCycle || scheduler.lastCycle;
  const decision = cycle?.articleCountDecision;
  if (!decision && cycle?.reason === "generation-lock-active") {
    return "작성 작업 실행 중: 모델 판단은 기존 작업 완료 후 다시 진행됩니다.";
  }
  if (!decision) return "";
  const targetCount = Number.isFinite(Number(decision.targetCount)) ? Number(decision.targetCount) : 0;
  const maxCount = Number.isFinite(Number(decision.maxCount)) ? Number(decision.maxCount) : 3;
  const provider = decision.provider === "antigravity-cli" ? "Antigravity" : decision.provider === "codex-cli" ? "Codex" : "";
  const suffix = decision.fallback ? "fallback" : provider;
  const reason = String(decision.reason || "").trim();
  return [
    `모델 산정: ${targetCount}/${maxCount}`,
    suffix ? ` · ${suffix}` : "",
    reason ? ` · ${reason}` : "",
  ].join("");
}

function MagazineUpdateSchedule({
  status,
  articles,
  isStartingNow = false,
  isGeneratingOne = false,
  onStartNow,
  onGenerateOne,
}) {
  const lastUpdate =
    formatMagazineUpdateScheduleTime(magazineLatestUpdateTimestamp(status, articles)) || "기록 없음";
  const nextUpdate = magazineNextUpdateLabel(status);
  const decisionLabel = magazineArticleCountDecisionLabel(status);
  const schedulerActive = magazineSchedulerIsActive(status);
  const showStartButton =
    Boolean(onStartNow) &&
    !isStartingNow &&
    !schedulerActive &&
    status?.scheduler?.enabled !== false;
  const generateOneDisabled = isGeneratingOne || isStartingNow || schedulerActive;
  return (
    <div className="magazine-update-schedule">
      <div className="magazine-update-primary">
        <p>마지막 업데이트: {lastUpdate} / 다음 업데이트 예정: {nextUpdate}</p>
        {showStartButton || onGenerateOne ? (
          <div className="magazine-update-actions">
            {onGenerateOne ? (
              <button
                className="magazine-update-generate-one"
                type="button"
                onClick={onGenerateOne}
                disabled={generateOneDisabled}
                aria-label={isGeneratingOne ? "기사 1건 작성 중" : "기사 1건 작성"}
                title={isGeneratingOne ? "기사 1건 작성 중" : "기사 1건 작성"}
              >
                {isGeneratingOne ? (
                  <LoaderCircle size={14} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <FilePlus2 size={14} strokeWidth={2.2} aria-hidden="true" />
                )}
                <span>{isGeneratingOne ? "작성 중" : "기사 1건 작성"}</span>
              </button>
            ) : null}
            {showStartButton ? (
              <button
                className="magazine-update-refresh tooltip-button"
                type="button"
                aria-label="지금 매거진 작성 시작"
                title="지금 매거진 작성 시작"
                data-tooltip="지금 작성 시작"
                onClick={onStartNow}
              >
                <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {decisionLabel ? <p>{decisionLabel}</p> : null}
    </div>
  );
}

const MAGAZINE_AGENT_CONTEXT_BODY_LIMIT = 12000;

function compactMagazineAgentText(value, maxLength = 1200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function stripMagazineArticleHtml(html = "") {
  const source = String(html || "");
  if (!source) return "";
  if (typeof window !== "undefined" && typeof window.DOMParser === "function") {
    const parsed = new window.DOMParser().parseFromString(source, "text/html");
    return compactMagazineAgentText(parsed.body?.textContent || "", MAGAZINE_AGENT_CONTEXT_BODY_LIMIT);
  }
  return compactMagazineAgentText(
    source
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h1|h2|h3|li)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'"),
    MAGAZINE_AGENT_CONTEXT_BODY_LIMIT
  );
}

function magazineArticleWorldMemoryContext(worldMemory) {
  const source = worldMemory && typeof worldMemory === "object" ? worldMemory : null;
  if (!source) return null;
  const vectorSearch = source.vectorSearch && typeof source.vectorSearch === "object" ? source.vectorSearch : {};
  return {
    retrievalPolicy: compactMagazineAgentText(source.retrievalPolicy || "", 120),
    query: compactMagazineAgentText(source.query || "", 260),
    vectorSearch: {
      engine: compactMagazineAgentText(vectorSearch.engine || "", 80),
      model: compactMagazineAgentText(vectorSearch.model || "", 80),
      matchedCount: Number(vectorSearch.matchedCount || 0),
      hits: Array.isArray(vectorSearch.hits)
        ? vectorSearch.hits.slice(0, 8).map((hit) => ({
            eventId: compactMagazineAgentText(hit?.eventId || "", 80),
            title: compactMagazineAgentText(hit?.title || "", 220),
            storyFamily: compactMagazineAgentText(hit?.storyFamily || "", 120),
            createdAt: compactMagazineAgentText(hit?.createdAt || "", 80),
          }))
        : [],
    },
  };
}

function buildMagazineArticleAgentContext(article) {
  if (!article) return null;
  const publishedTime = magazineArticlePublishedTime(article);
  const bodyText =
    stripMagazineArticleHtml(article.bodyHtml) ||
    magazineMockArticleSections.map((section) => `${section.heading}\n${section.body}`).join("\n\n");
  return {
    source: "magazine-reader",
    id: compactMagazineAgentText(article.id || "", 120),
    articleType: compactMagazineAgentText(article.articleType || "", 80),
    title: compactMagazineAgentText(article.title || "", 240),
    topics: magazineArticleTopics(article).map((topic) => compactMagazineAgentText(topic, 60)).slice(0, 12),
    summary: compactMagazineAgentText(article.summary || "", 1400),
    publishedAt: compactMagazineAgentText(article.publishedAt || article.createdAt || article.updatedAt || "", 120),
    publishedTimeLabel: publishedTime?.label || "",
    image: {
      alt: compactMagazineAgentText(article.imageAlt || "", 180),
      credit: compactMagazineAgentText(article.imageCredit || "", 180),
    },
    sourceBasis: Array.isArray(article.sourceBasis)
      ? article.sourceBasis.map((item) => compactMagazineAgentText(item, 160)).filter(Boolean).slice(0, 8)
      : [],
    bodyText,
    bodyTruncated: bodyText.length >= MAGAZINE_AGENT_CONTEXT_BODY_LIMIT,
    chartBlocks: Array.isArray(article.chartBlocks)
      ? article.chartBlocks.slice(0, 8).map((chart) => ({
          id: compactMagazineAgentText(chart?.id || "", 80),
          title: compactMagazineAgentText(chart?.title || "", 180),
          note: compactMagazineAgentText(chart?.note || "", 360),
          ariaLabel: compactMagazineAgentText(chart?.ariaLabel || "", 180),
        }))
      : [],
    followupOptions: Array.isArray(article.followupOptions)
      ? article.followupOptions.slice(0, 6).map((option) => ({
          id: compactMagazineAgentText(option?.id || "", 80),
          label: compactMagazineAgentText(option?.label || "", 120),
          prompt: compactMagazineAgentText(option?.prompt || "", 260),
          topics: Array.isArray(option?.topics)
            ? option.topics.map((topic) => compactMagazineAgentText(topic, 60)).filter(Boolean).slice(0, 8)
            : [],
        }))
      : [],
    worldMemory: magazineArticleWorldMemoryContext(article.worldMemory),
  };
}

function MagazineArticleList({
  articles,
  onOpenArticle,
  emptyText = "아직 이 조건에 맞는 기사가 없습니다.",
  listKey = "articles",
}) {
  const safeArticles = Array.isArray(articles) ? articles : [];
  const sentinelRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(MAGAZINE_ARTICLE_PAGE_SIZE);
  const visibleArticles = safeArticles.slice(0, Math.min(visibleCount, safeArticles.length));
  const hasMore = visibleArticles.length < safeArticles.length;

  useEffect(() => {
    setVisibleCount(MAGAZINE_ARTICLE_PAGE_SIZE);
  }, [listKey]);

  useEffect(() => {
    setVisibleCount((current) => {
      const maxVisible = Math.max(MAGAZINE_ARTICLE_PAGE_SIZE, safeArticles.length);
      return Math.max(MAGAZINE_ARTICLE_PAGE_SIZE, Math.min(current, maxVisible));
    });
  }, [safeArticles.length]);

  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === "undefined") return undefined;
    const node = sentinelRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((current) => Math.min(current + MAGAZINE_ARTICLE_PAGE_SIZE, safeArticles.length));
      },
      { root: null, rootMargin: "320px 0px 420px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, safeArticles.length, visibleCount]);

  if (!safeArticles.length) {
    return <p className="magazine-topic-empty">{emptyText}</p>;
  }

  return (
    <div className="magazine-article-list">
      {visibleArticles.map((article) => (
        <article className="magazine-list-item" key={article.id || article.title}>
          <div className="magazine-list-copy">
            <div className="magazine-list-topic-row" aria-label="기사 토픽">
              {magazineArticleTopics(article).map((topic) => (
                <span className="magazine-list-topic" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
            <h3>
              <a
                className="magazine-article-link"
                href="#magazine-reader"
                onClick={(event) => onOpenArticle(event, article)}
              >
                {article.title}
              </a>
            </h3>
            <MagazinePublishedTime article={article} />
            <a
              className="magazine-image-link"
              href="#magazine-reader"
              onClick={(event) => onOpenArticle(event, article)}
              aria-label={`${article.title} 기사 열기`}
            >
              <div className="magazine-featured-image magazine-list-image">
                <img src={article.image} alt={article.imageAlt} />
              </div>
            </a>
            <p>{article.summary}</p>
          </div>
        </article>
      ))}
      {hasMore ? <div className="magazine-list-sentinel" ref={sentinelRef} aria-hidden="true" /> : null}
    </div>
  );
}

function normalizeMagazineReaderArticle(article) {
  const topics = Array.isArray(article?.topics)
    ? article.topics
    : [article?.topic].filter(Boolean);
  const followupOptions = Array.isArray(article?.followupOptions) && article.followupOptions.length
    ? article.followupOptions
    : magazineDefaultFollowupOptions;
  return {
    id: article?.id || "",
    topics: topics.length ? topics : ["매거진"],
    title: article?.title || "주식채널 매거진 기사",
    summary:
      article?.summary ||
      article?.deck ||
      "월드 메모리의 주요 이슈를 바탕으로 만든 매거진 기사 목업입니다.",
    image: article?.image || magazineHeadlineStory.image,
    imageAlt: article?.imageAlt || magazineHeadlineStory.imageAlt,
    imageCredit: article?.imageCredit || magazineHeadlineStory.imageCredit,
    bodyHtml: article?.bodyHtml || "",
    chartBlocks: Array.isArray(article?.chartBlocks) ? article.chartBlocks : [],
    followupOptions: followupOptions
      .map((option, index) => ({
        id: option?.id || `followup-${index + 1}`,
        label: option?.label || option?.title || `후속 기사 ${index + 1}`,
        prompt: option?.prompt || option?.label || "",
        topics: Array.isArray(option?.topics) && option.topics.length ? option.topics : topics,
        tone: option?.tone || magazineToneSequence[index % magazineToneSequence.length],
      }))
      .slice(0, 6),
    worldMemory: article?.worldMemory || null,
    generationAgent: article?.generationAgent || null,
    articleType: article?.articleType || "",
    publishedAt: article?.publishedAt || "",
    createdAt: article?.createdAt || "",
    updatedAt: article?.updatedAt || "",
    sourceBasis: Array.isArray(article?.sourceBasis) ? article.sourceBasis : [],
  };
}

const magazineClipboardExcludeSelector = [
  ".magazine-reader-topic-row",
  ".magazine-reader-followup",
  ".magazine-reader-comments",
  ".magazine-reader-return",
].join(", ");

const MAGAZINE_CLIPBOARD_IMAGE_ASPECT_RATIO = 16 / 9;

function magazineBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

function loadMagazineClipboardImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

async function magazineImageSrcToDataUrl(src, options = {}) {
  const shouldCrop = Boolean(options.cropToReaderFrame);
  if (!src) return src;
  if (src.startsWith("data:") && !shouldCrop) return src;
  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`이미지를 가져오지 못했습니다. (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("이미지 형식이 아닙니다.");
  const dataUrl = await magazineBlobToDataUrl(blob);
  if (!shouldCrop) return dataUrl;
  const sourceImage = await loadMagazineClipboardImage(dataUrl);
  const naturalWidth = sourceImage.naturalWidth || sourceImage.width;
  const naturalHeight = sourceImage.naturalHeight || sourceImage.height;
  if (!naturalWidth || !naturalHeight) return dataUrl;

  const targetAspectRatio = Number(options.aspectRatio) || MAGAZINE_CLIPBOARD_IMAGE_ASPECT_RATIO;
  const imageAspectRatio = naturalWidth / naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = naturalWidth;
  let sourceHeight = naturalHeight;

  if (imageAspectRatio > targetAspectRatio) {
    sourceWidth = naturalHeight * targetAspectRatio;
    sourceX = (naturalWidth - sourceWidth) / 2;
  } else if (imageAspectRatio < targetAspectRatio) {
    sourceHeight = naturalWidth / targetAspectRatio;
    sourceY = (naturalHeight - sourceHeight) / 2;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth);
  canvas.height = Math.round(sourceHeight);
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function inlineMagazineClipboardImages(sourceNode, cloneNode) {
  const sourceImages = Array.from(sourceNode.querySelectorAll("img"));
  const cloneImages = Array.from(cloneNode.querySelectorAll("img"));
  await Promise.all(
    cloneImages.map(async (image, index) => {
      const sourceImage = sourceImages[index];
      const source = sourceImage?.currentSrc || sourceImage?.src || image.currentSrc || image.src || image.getAttribute("src");
      if (!source) return;
      try {
        const shouldCropToReaderFrame = Boolean(sourceImage?.closest(".magazine-featured-image"));
        image.setAttribute("src", await magazineImageSrcToDataUrl(source, {
          cropToReaderFrame: shouldCropToReaderFrame,
          aspectRatio: MAGAZINE_CLIPBOARD_IMAGE_ASPECT_RATIO,
        }));
      } catch (error) {
        image.setAttribute("src", new URL(source, window.location.href).href);
        image.setAttribute("data-copy-image-warning", error.message || "image inline failed");
      }
    })
  );
}

function inlineMagazineClipboardCanvases(sourceNode, cloneNode) {
  const sourceCanvases = Array.from(sourceNode.querySelectorAll("canvas"));
  const cloneCanvases = Array.from(cloneNode.querySelectorAll("canvas"));
  cloneCanvases.forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index];
    if (!sourceCanvas) return;
    try {
      const image = document.createElement("img");
      image.src = sourceCanvas.toDataURL("image/png");
      image.alt = canvas.getAttribute("aria-label") || "기사 차트";
      image.width = sourceCanvas.width;
      image.height = sourceCanvas.height;
      canvas.replaceWith(image);
    } catch {
      canvas.remove();
    }
  });
}

function cleanMagazineClipboardNode(node) {
  node.querySelectorAll(magazineClipboardExcludeSelector).forEach((element) => element.remove());
  node.querySelectorAll("script, style, button, textarea, input").forEach((element) => element.remove());
  node.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("href", new URL(anchor.getAttribute("href"), window.location.href).href);
  });
  node.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));
}

function trimMagazineClipboardTrailingWhitespace(element) {
  if (element.classList?.contains("magazine-copy-heading-spacer")) return;
  let current = element.lastChild;
  while (current && current.nodeType === Node.TEXT_NODE && !current.nodeValue.trim()) {
    const previous = current.previousSibling;
    current.remove();
    current = previous;
  }
  if (current?.nodeType === Node.TEXT_NODE) {
    current.nodeValue = current.nodeValue.replace(/[ \t\u00a0]+$/g, "");
  }
}

const magazineClipboardBlockLikeSelector = [
  "article",
  "section",
  "div",
  "p",
  "blockquote",
  "figure",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "time",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
].join(", ");

const magazineClipboardWhitespaceContainerSelector = [
  "article",
  "section",
  "div",
  "blockquote",
  "figure",
  "figcaption",
  "ul",
  "ol",
  "table",
  "thead",
  "tbody",
  "tr",
].join(", ");

function isMagazineClipboardBlockLikeNode(node) {
  return node?.nodeType === Node.ELEMENT_NODE && node.matches(magazineClipboardBlockLikeSelector);
}

function shouldRemoveMagazineClipboardWhitespaceTextNode(textNode) {
  if (textNode.nodeValue.trim()) return false;
  const parent = textNode.parentElement;
  if (!parent || parent.closest("pre, code, textarea")) return false;
  if (isMagazineClipboardBlockLikeNode(textNode.previousSibling)) return true;
  if (isMagazineClipboardBlockLikeNode(textNode.nextSibling)) return true;
  return parent.matches(magazineClipboardWhitespaceContainerSelector);
}

function normalizeMagazineClipboardTextWhitespace(node) {
  const textNodes = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  textNodes.forEach((textNode) => {
    if (textNode.parentElement?.closest(".magazine-copy-heading-spacer")) return;
    textNode.nodeValue = textNode.nodeValue.replace(/\u00a0/g, " ");
    if (shouldRemoveMagazineClipboardWhitespaceTextNode(textNode)) {
      textNode.remove();
    }
  });
  node
    .querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, time")
    .forEach(trimMagazineClipboardTrailingWhitespace);
}

function stripMagazineClipboardInternalMarkers(node) {
  node.querySelectorAll(".magazine-copy-heading-spacer").forEach((element) => {
    element.classList.remove("magazine-copy-heading-spacer");
    if (!element.getAttribute("class")) {
      element.removeAttribute("class");
    }
  });
}

function createMagazineClipboardSpacer() {
  const spacer = document.createElement("p");
  spacer.className = "magazine-copy-spacer";
  spacer.appendChild(document.createElement("br"));
  return spacer;
}

function createMagazineClipboardHeadingSpacer({ trailingNbsp = false, withLineBreak = false } = {}) {
  const spacer = document.createElement("p");
  spacer.className = "magazine-copy-heading-spacer";
  spacer.appendChild(document.createTextNode("\u00a0"));
  if (withLineBreak) {
    spacer.appendChild(document.createElement("br"));
    if (trailingNbsp) {
      spacer.appendChild(document.createTextNode("\u00a0"));
    }
  }
  return spacer;
}

function nextMagazineClipboardElement(element) {
  let next = element.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) {
    next = next.nextSibling;
  }
  return next?.nodeType === Node.ELEMENT_NODE ? next : null;
}

function addMagazineClipboardBlockquoteLeadBreak(container) {
  const lead = container.firstElementChild;
  if (!lead?.matches("strong, b")) return false;
  const firstBreak = nextMagazineClipboardElement(lead);
  if (!firstBreak?.matches("br")) return false;
  const secondBreak = nextMagazineClipboardElement(firstBreak);
  if (secondBreak?.matches("br")) return true;
  firstBreak.insertAdjacentElement("afterend", document.createElement("br"));
  return true;
}

function insertMagazineClipboardBlockquoteBreaks(node) {
  node
    .querySelectorAll(".magazine-reader-html blockquote, .magazine-reader-section blockquote, .magazine-reader-chart-section blockquote")
    .forEach((quote) => {
      if (addMagazineClipboardBlockquoteLeadBreak(quote)) return;
      const firstParagraph = quote.firstElementChild;
      if (firstParagraph?.matches("p")) {
        addMagazineClipboardBlockquoteLeadBreak(firstParagraph);
      }
    });
}

function insertMagazineClipboardBreaks(node) {
  [
    ".magazine-reader-published-time",
    ".magazine-reader-summary",
  ].forEach((selector) => {
    const element = node.querySelector(selector);
    if (!element) return;
    element.insertAdjacentElement("afterend", createMagazineClipboardSpacer());
  });
  node.querySelectorAll("h2").forEach((heading) => {
    heading.insertAdjacentElement("beforebegin", createMagazineClipboardHeadingSpacer({ trailingNbsp: true, withLineBreak: true }));
    heading.insertAdjacentElement("afterend", createMagazineClipboardHeadingSpacer());
  });
  insertMagazineClipboardBlockquoteBreaks(node);
  node
    .querySelectorAll(".magazine-reader-html p, .magazine-reader-section p, .magazine-reader-chart-section p")
    .forEach((paragraph) => {
      if (
        paragraph.classList.contains("magazine-copy-spacer") ||
        paragraph.classList.contains("magazine-copy-heading-spacer") ||
        paragraph.closest("blockquote, figure, figcaption")
      ) {
        return;
      }
      const nextElement = nextMagazineClipboardElement(paragraph);
      if (!nextElement || !nextElement.matches("p, blockquote, ul, ol")) return;
      paragraph.insertAdjacentElement("afterend", createMagazineClipboardSpacer());
    });
  node
    .querySelectorAll(".magazine-reader-html blockquote, .magazine-reader-section blockquote, .magazine-reader-chart-section blockquote")
    .forEach((quote) => {
      const nextElement = nextMagazineClipboardElement(quote);
      if (nextElement?.classList?.contains("magazine-copy-spacer")) return;
      quote.insertAdjacentElement("afterend", createMagazineClipboardSpacer());
    });
}

function normalizeMagazineClipboardBodyHtml(node) {
  node.querySelectorAll(".magazine-reader-html").forEach((body) => {
    if (body.children.length !== 1) return;
    const onlyChild = body.firstElementChild;
    if (!onlyChild?.matches("article.magazine-article")) return;
    onlyChild.replaceWith(...Array.from(onlyChild.childNodes));
  });
}

function magazineClipboardProviderName(provider) {
  return provider === "antigravity-cli" ? "Antigravity" : "Codex";
}

function magazineClipboardAttributionText(provider) {
  return `주식채널+ 에이전트의 Stock Channel Magazine+에서 ${magazineClipboardProviderName(provider)}로 생성됨`;
}

function appendMagazineClipboardAttribution(node, provider) {
  for (let index = 0; index < 3; index += 1) {
    const spacer = document.createElement("p");
    spacer.appendChild(document.createElement("br"));
    node.appendChild(spacer);
  }
  const attribution = document.createElement("p");
  attribution.className = "magazine-copy-attribution";
  attribution.textContent = magazineClipboardAttributionText(provider);
  node.appendChild(attribution);
}

function magazinePlainTextFromNode(node) {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  holder.style.whiteSpace = "pre-wrap";
  holder.appendChild(node.cloneNode(true));
  document.body.appendChild(holder);
  const text = holder.innerText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  holder.remove();
  return text;
}

async function buildMagazineClipboardPayload(sourceNode, options = {}) {
  if (!sourceNode) throw new Error("복사할 기사 본문을 찾지 못했습니다.");
  const cloneNode = sourceNode.cloneNode(true);
  cleanMagazineClipboardNode(cloneNode);
  normalizeMagazineClipboardBodyHtml(cloneNode);
  insertMagazineClipboardBreaks(cloneNode);
  inlineMagazineClipboardCanvases(sourceNode, cloneNode);
  await inlineMagazineClipboardImages(sourceNode, cloneNode);
  normalizeMagazineClipboardTextWhitespace(cloneNode);
  stripMagazineClipboardInternalMarkers(cloneNode);
  const basePlainText = magazinePlainTextFromNode(cloneNode);
  appendMagazineClipboardAttribution(cloneNode, options.provider);
  const plainText = `${basePlainText}\n\n\n${magazineClipboardAttributionText(options.provider)}`.trim();
  const html = [
    "<!doctype html>",
    "<html>",
    "<head><meta charset=\"utf-8\"></head>",
    "<body>",
    cloneNode.outerHTML,
    "</body>",
    "</html>",
  ].join("");
  return { html, plainText };
}

async function writeMagazineArticleToClipboard(sourceNode, options = {}) {
  const payloadPromise = buildMagazineClipboardPayload(sourceNode, options);
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": payloadPromise.then(
            ({ html }) => new Blob([html], { type: "text/html" })
          ),
          "text/plain": payloadPromise.then(
            ({ plainText }) => new Blob([plainText], { type: "text/plain" })
          ),
        }),
      ]);
      return { mode: "html" };
    } catch (error) {
      const { plainText } = await payloadPromise;
      await navigator.clipboard.writeText(plainText);
      return { mode: "text", warning: error.message || "HTML 복사 실패" };
    }
  }
  const { plainText } = await payloadPromise;
  await navigator.clipboard.writeText(plainText);
  return { mode: "text" };
}

function normalizeMagazineCommentReply(reply) {
  if (!reply || typeof reply !== "object") return null;
  const text = String(reply.text || "").trim();
  const status = String(reply.status || (text ? "complete" : "waiting")).trim();
  return {
    id: reply.id || `reply-${Date.now()}`,
    author: reply.author || "매거진 편집자 AI",
    text,
    status,
    createdAt: reply.createdAt || "",
    biasEventIds: Array.isArray(reply.biasEventIds)
      ? reply.biasEventIds.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
  };
}

function normalizeMagazineComment(comment) {
  if (!comment || typeof comment !== "object") return null;
  const text = String(comment.text || "").trim();
  if (!text) return null;
  return {
    id: comment.id || `comment-${Date.now()}`,
    author: comment.author || "사용자",
    text,
    createdAt: comment.createdAt || "",
    reply: normalizeMagazineCommentReply(comment.reply),
  };
}

function normalizeMagazineCommentStore(payload, articleId = "") {
  const comments = Array.isArray(payload?.comments) ? payload.comments : [];
  return {
    articleId: payload?.articleId || articleId,
    updatedAt: payload?.updatedAt || "",
    commentCount: Number(payload?.commentCount || comments.length || 0),
    comments: comments.map(normalizeMagazineComment).filter(Boolean),
  };
}

function magazineCommentStatusText(status) {
  if (status === "waiting") return "답변 대기 중";
  if (status === "generating") return "답변 중";
  if (status === "error") return "답변 실패";
  return "";
}
const personaEligibleScreens = new Set([
  "chat",
  "stock",
  "news-feed",
  "magazine",
  "world-memory",
  "reports",
  "earning-calendar",
  "economic-calendar",
  "portfolio",
  "portfolio-canvas",
]);
const ARCA_WRITE_URL = "https://arca.live/b/stock/write";
const ARCA_NOTIFICATION_URL = "https://arca.live/u/notification";
const ARCA_NOTIFICATION_POLL_INTERVAL_MS = 30000;
const MAGAZINE_STATUS_POLL_INTERVAL_MS = 30000;
const MEMORY_RECENT_LIMIT = 5;
const MEMORY_DIALOG_PAGE_SIZE = 20;
const PORTFOLIO_CANVAS_FILE_SAVE_DEBOUNCE_MS = 450;
const initialBoardFilters = {
  channel: "stock",
  category: "",
  page: 1,
  best: false,
  sort: "",
  cutRate: "",
  target: "all",
  keyword: "",
};

const defaultWorldMemorySettings = {
  ok: true,
  enabled: false,
  managementProvider: "default",
  configPath: "config/world-memory.user.json",
  defaultConfigPath: "config/world-memory.defaults.json",
  settings: {
    version: 1,
    enabled: false,
    managementProvider: "default",
  },
};

const defaultMagazineSettings = {
  ok: true,
  enabled: false,
  worldMemoryEnabled: false,
  writingProvider: "default",
  schedulerIntervalHours: 6,
  disabledReason: "",
  configPath: "config/magazine.user.json",
  defaultConfigPath: "config/magazine.defaults.json",
  settings: {
    version: 1,
    enabled: false,
    writingProvider: "default",
    schedulerIntervalHours: 6,
  },
};

function readMagazineGenerateOneToolVisible() {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search || "");
    const paramValue = params.get("magazineGenerateOne");
    if (paramValue === "1" || paramValue === "true") {
      window.localStorage.setItem(MAGAZINE_GENERATE_ONE_TOOL_STORAGE_KEY, "1");
      return true;
    }
    if (paramValue === "0" || paramValue === "false") {
      window.localStorage.removeItem(MAGAZINE_GENERATE_ONE_TOOL_STORAGE_KEY);
      return false;
    }
    return window.localStorage.getItem(MAGAZINE_GENERATE_ONE_TOOL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

async function loadPortfolioCanvasStoreFile() {
  const response = await fetch("/api/portfolio/canvases", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return {
    ...payload,
    store: normalizePortfolioCanvasStore(payload.store),
  };
}

async function savePortfolioCanvasStoreFile(store) {
  const response = await fetch("/api/portfolio/canvases", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ store: normalizePortfolioCanvasStore(store) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

const MIN_PROMPT_HEIGHT = 42;
const MAX_PROMPT_HEIGHT = 132;
const MAX_CHAT_ATTACHMENTS = 6;
const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_INLINE_TEXT_CHARS = 300_000;
const NEWS_FEED_PAGE_SIZE = 30;
const BOARD_CONTEXT_NOTICE_LIMIT = 8;
const BOARD_CONTEXT_ARTICLE_LIMIT = 35;
const NEWS_FEED_POLL_INTERVAL_OPTIONS = Array.from({ length: 10 }, (_, index) => {
  const minutes = index + 1;
  return {
    minutes,
    seconds: minutes * 60,
    label: `${minutes}분`,
  };
});

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

const worldMemoryActionsNeedingReportRefresh = new Set([
  "stateAdd",
  "briefStoryBackfill",
  "storyLink",
  "taxonomyRefresh",
  "stateSync",
]);

const CHAT_STREAM_RENDER_INTERVAL_MS = 120;

function stripWorldMemoryActionBlocks(answer = "") {
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

function parseWorldMemoryJsonAction(answer = "") {
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

function normalizeWorldMemoryActionProposal(parsed, answer = "") {
  const action = String(parsed?.action || parsed?.actionId || "").trim();
  if (!action || !worldMemoryActionCatalog[action]) return null;
  const catalog = worldMemoryActionCatalog[action];
  const params =
    parsed?.params && typeof parsed.params === "object"
      ? parsed.params
      : parsed?.options && typeof parsed.options === "object"
        ? parsed.options
        : {};
  const label = cleanPortfolioWidgetPrompt(parsed?.label || parsed?.title || catalog.label, 120);
  const reason = cleanPortfolioWidgetPrompt(
    parsed?.reason || parsed?.summary || parsed?.description || stripWorldMemoryActionBlocks(answer),
    360
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
    raw: parsed,
    answer,
  };
}

function trimForMemory(value, maxLength = 420) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function memoryTitleFromPrompt(prompt, fallback = "에이전트 채팅") {
  const firstLine = String(prompt || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const text = trimForMemory(firstLine || fallback, 64);
  return text || fallback;
}

function memorySummaryFromExchange(prompt, answer) {
  return [
    `사용자: ${trimForMemory(prompt, 260)}`,
    `응답: ${trimForMemory(answer, 720)}`,
  ]
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

function memoryTagsForExchange({ screen, provider, article, attachments = [], taskType = "chat" }) {
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

async function fileToChatAttachment(file) {
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


function arcaNotificationHealthState(status) {
  const count = Math.max(0, Number(status?.count || 0));
  const connected = Boolean(status?.connected);
  const hasError = status?.status === "error" || status?.ok === false;

  if (hasError) {
    return {
      level: "error",
      count: 0,
      showSidebarDot: true,
      title: status?.error ? `아카라이브 알림 조회 불가: ${status.error}` : "아카라이브 알림 조회 불가",
      ariaLabel: "아카라이브 알림 조회 불가",
    };
  }

  if (!connected) {
    return {
      level: "idle",
      count: 0,
      showSidebarDot: false,
      title: status?.error || "아카라이브 알림 로그인 필요",
      ariaLabel: "아카라이브 알림 로그인 필요",
    };
  }

  if (count > 0) {
    return {
      level: "online",
      count,
      showSidebarDot: true,
      title: `아카라이브 알림 ${formatCount(count)}개`,
      ariaLabel: `아카라이브 알림 ${formatCount(count)}개`,
    };
  }

  return {
    level: "idle",
    count: 0,
    showSidebarDot: true,
    title: "아카라이브 알림 없음",
    ariaLabel: "아카라이브 알림 없음",
  };
}



function boardRowForContext(row, index) {
  return {
    rank: index + 1,
    type: row.type || "article",
    id: row.id || row.number || "",
    title: row.title || "",
    category: row.categoryLabel || "",
    author: row.author || "",
    comments: row.commentCount || 0,
    views: row.view || 0,
    recommendation: row.rate || 0,
    time: row.timeIso || row.timeLabel || "",
    url: row.href || "",
  };
}

function buildBoardIndexContextSnapshot(board, filters, options = {}) {
  const safeFilters = {
    channel: filters?.channel || "stock",
    category: filters?.category || "",
    page: filters?.page || 1,
    mode: filters?.best ? "best" : "all",
    sort: filters?.sort || "registered",
    cutRate: filters?.cutRate || "",
    searchTarget: filters?.target || "all",
    keyword: filters?.keyword || "",
  };

  if (!board) {
    return {
      available: false,
      screen: "stock",
      reason: "아카라이브 주식채널 목록이 아직 로드되지 않았습니다.",
      filters: safeFilters,
    };
  }

  const visibleNotices = [
    ...(Array.isArray(board.notices) ? board.notices : []),
    ...(options.showHiddenNotices && Array.isArray(board.hiddenNotices) ? board.hiddenNotices : []),
  ];
  const articles = Array.isArray(board.articles) ? board.articles : [];

  return {
    available: true,
    screen: "stock",
    source: "현재 화면에 렌더된 아카라이브 주식채널 인덱스 스냅샷",
    pageTitle: board.pageTitle || "주식 채널",
    endpoint: board.endpoint || "",
    fetchedAt: board.fetchedAt || "",
    uiState: {
      categoryLabel: options.activeCategoryLabel || "",
      loading: Boolean(options.busy),
      error: options.error || "",
      hiddenNoticesExpanded: Boolean(options.showHiddenNotices),
    },
    filters: safeFilters,
    counts: {
      noticesVisible: visibleNotices.length,
      hiddenNoticesTotal: Array.isArray(board.hiddenNotices) ? board.hiddenNotices.length : 0,
      articlesVisible: articles.length,
      adsVisible: Array.isArray(board.ads) ? board.ads.length : 0,
    },
    notices: visibleNotices.slice(0, BOARD_CONTEXT_NOTICE_LIMIT).map(boardRowForContext),
    articles: articles.slice(0, BOARD_CONTEXT_ARTICLE_LIMIT).map(boardRowForContext),
    nextActionHint:
      "사용자의 질문이 특정 제목이나 작성자에 관한 것 같으면 이 목록의 url을 열어 본문 컨텍스트를 확보해야 한다. 글 컨텍스트가 명시 첨부된 경우에는 이 인덱스 스냅샷보다 첨부 본문을 우선한다.",
  };
}


function RouteLoading({ label = "화면 불러오는 중" }) {
  return (
    <div className="route-loading-state" role="status" aria-live="polite">
      <LoaderCircle size={22} strokeWidth={2} />
      <span>{label}</span>
    </div>
  );
}

function compactWorldMemoryReportForContext(report = {}) {
  const view = report?.view || null;
  return {
    status: compactVisibleScreenText(report?.status || "empty", 60),
    generatedAt: compactVisibleScreenText(report?.generatedAt || "", 80),
    title: compactVisibleScreenText(view?.title || report?.title || "", 180),
    asOf: compactVisibleScreenText(view?.asOf || report?.generatedAt || "", 80),
    stance: compactVisibleScreenText(view?.stance || "", 80),
    summary: compactVisibleScreenText(view?.summary || report?.summary || "", 700),
    narrative: compactVisibleScreenText(view?.narrative || report?.text || "", 900),
    signalRadar: Array.isArray(view?.signalRadar)
      ? view.signalRadar.slice(0, 8).map((signal) => ({
          label: compactVisibleScreenText(signal?.label, 80),
          score: Number(signal?.score || 0),
          tone: compactVisibleScreenText(signal?.tone, 40),
          note: compactVisibleScreenText(signal?.note, 220),
        }))
      : [],
    highlights: Array.isArray(view?.highlights)
      ? view.highlights.slice(0, 8).map((item) => ({
          tag: compactVisibleScreenText(item?.tag, 60),
          title: compactVisibleScreenText(item?.title, 140),
          body: compactVisibleScreenText(item?.body, 320),
          importance: compactVisibleScreenText(item?.importance, 40),
        }))
      : [],
    memoryChangeSuggestions: Array.isArray(view?.memoryChangeSuggestions)
      ? view.memoryChangeSuggestions.slice(0, 8).map((item) => compactVisibleScreenText(item, 240))
      : [],
    portfolioSuggestions: Array.isArray(view?.portfolioSuggestions)
      ? view.portfolioSuggestions.slice(0, 8).map((item) => compactVisibleScreenText(item, 240))
      : [],
    nextChecks: Array.isArray(view?.nextChecks)
      ? view.nextChecks.slice(0, 8).map((item) => compactVisibleScreenText(item, 220))
      : [],
    textFallback: compactVisibleScreenText(report?.text || "", 1000),
  };
}

function buildWorldMemoryPageContextSnapshot(status, actionResult, focusedChangeSuggestion = null) {
  const collector = status?.collector || {};
  const schedule = status?.schedule || {};
  const report = status?.report || {};
  const reportChangeSuggestions = Array.isArray(report?.view?.memoryChangeSuggestions)
    ? report.view.memoryChangeSuggestions
    : Array.isArray(report.suggestions)
      ? report.suggestions
      : [];
  const pendingChangeSuggestion =
    focusedChangeSuggestion && typeof focusedChangeSuggestion === "object"
      ? {
          source: compactVisibleScreenText(focusedChangeSuggestion.source || "world-memory-report-item", 80),
          section: compactVisibleScreenText(focusedChangeSuggestion.section || "memory-change", 80),
          sectionLabel: compactVisibleScreenText(focusedChangeSuggestion.sectionLabel || "월드 메모리 변경 제안", 120),
          item:
            focusedChangeSuggestion.item && typeof focusedChangeSuggestion.item === "object"
              ? focusedChangeSuggestion.item
              : null,
        }
      : null;
  return {
    source: "world-memory-page-state",
    capturedAt: new Date().toISOString(),
    screen: "world-memory",
    collector: {
      status: collector.status || "idle",
      lastAction: collector.lastAction || "",
      lastSuccessfulAt: collector.lastSuccessfulAt || "",
      lastFinishedAt: collector.lastFinishedAt || "",
      lastError: collector.lastError || "",
    },
    schedule: {
      nextRunAt: schedule.nextRunAt || "",
      nextRetryAt: schedule.nextRetryAt || "",
      pausedUntil: schedule.pausedUntil || "",
      activeCycle: schedule.activeCycle || null,
    },
    report: compactWorldMemoryReportForContext(report),
    changeSuggestions: reportChangeSuggestions.slice(0, 10).map((item) => compactVisibleScreenText(item, 260)),
    pendingChangeSuggestion,
    recentRun: compactVisibleScreenText(worldMemoryActionText(actionResult) || collector.lastAction || "", 600),
    availableActions: Object.entries(worldMemoryActionCatalog).map(([id, meta]) => ({
      id,
      label: meta.label,
      riskLevel: meta.riskLevel,
    })),
  };
}

function App() {
  const [activeView, setActiveView] = useState("stock");
  const [agentProvider, setAgentProvider] = useState("codex-cli");
  const [providerOptions, setProviderOptions] = useState(fallbackProviderOptions);
  const [approvalOptions, setApprovalOptions] = useState(fallbackApprovalOptions);
  const [modelGroups, setModelGroups] = useState(fallbackModelGroups);
  const [antigravityCatalogGroups, setAntigravityCatalogGroups] = useState(antigravityModelGroups);
  const [agentUserSettings, setAgentUserSettings] = useState(emptyAgentSettings);
  const [agentSettingsError, setAgentSettingsError] = useState("");
  const [agentOptionsReady, setAgentOptionsReady] = useState(false);
  const [personaMode, setPersonaMode] = useState("none");
  const [chatMessages, setChatMessages] = useState(initialChatMessages);
  const [magazineActiveArticle, setMagazineActiveArticle] = useState(null);
  const [magazineActiveTopic, setMagazineActiveTopic] = useState("");
  const [magazineCatalog, setMagazineCatalog] = useState(null);
  const [magazineStatus, setMagazineStatus] = useState(null);
  const [magazinePreferenceStore, setMagazinePreferenceStore] = useState(null);
  const [magazinePreferenceSavingId, setMagazinePreferenceSavingId] = useState("");
  const [magazinePreferenceNotice, setMagazinePreferenceNotice] = useState("");
  const [magazinePreferenceNoticeFading, setMagazinePreferenceNoticeFading] = useState(false);
  const [magazineCommentStore, setMagazineCommentStore] = useState(null);
  const [magazineCommentDraft, setMagazineCommentDraft] = useState("");
  const [magazineCommentSubmitting, setMagazineCommentSubmitting] = useState(false);
  const [magazineCommentError, setMagazineCommentError] = useState("");
  const [magazineDeleteDialogOpen, setMagazineDeleteDialogOpen] = useState(false);
  const [magazineDeleting, setMagazineDeleting] = useState(false);
  const [magazineDeleteError, setMagazineDeleteError] = useState("");
  const [magazineCopyStatus, setMagazineCopyStatus] = useState("idle");
  const [magazineCopyError, setMagazineCopyError] = useState("");
  const [magazineStartNowBusy, setMagazineStartNowBusy] = useState(false);
  const [magazineGenerateOneBusy, setMagazineGenerateOneBusy] = useState(false);
  const [magazineGenerateOneToolVisible] = useState(() => readMagazineGenerateOneToolVisible());
  const [portfolioCanvasStore, setPortfolioCanvasStore] = useState(() => readStoredPortfolioCanvasStore());
  const [portfolioSidebarOpen, setPortfolioSidebarOpen] = useState(false);
  const [portfolioCanvasMenuId, setPortfolioCanvasMenuId] = useState("");
  const [editingPortfolioCanvasId, setEditingPortfolioCanvasId] = useState("");
  const [portfolioCanvasNameDraft, setPortfolioCanvasNameDraft] = useState("");
  const [pendingDeletePortfolioCanvas, setPendingDeletePortfolioCanvas] = useState(null);
  const [assetApiDialogOpen, setAssetApiDialogOpen] = useState(false);
  const portfolioCanvasNameInputRef = useRef(null);
  const magazineCanvasRef = useRef(null);
  const magazineTopicModalRef = useRef(null);
  const magazineReaderArticleRef = useRef(null);
  const magazineReturnScrollRef = useRef({ canvasTop: 0, topicTop: 0, hadTopic: false });
  const [codexStatus, setCodexStatus] = useState({
    available: false,
    label: "Codex CLI 확인 중",
    commandPreview: "",
  });
  const [approval, setApproval] = useState(fallbackApprovalOptions[0].id);
  const [model, setModel] = useState(fallbackModelGroups[0].slug);
  const [reasoning, setReasoning] = useState(fallbackModelGroups[0].defaultReasoningLevel);
  const [speed, setSpeed] = useState("standard");
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const activeChatAbortRef = useRef(null);
  const [promptHeight, setPromptHeight] = useState(MIN_PROMPT_HEIGHT);
  const [promptOverflow, setPromptOverflow] = useState(false);
  const [boardFilters, setBoardFilters] = useState(initialBoardFilters);
  const [boardSearchInput, setBoardSearchInput] = useState("");
  const [arcaBoard, setArcaBoard] = useState(null);
  const [arcaBoardBusy, setArcaBoardBusy] = useState(false);
  const [arcaBoardError, setArcaBoardError] = useState("");
  const [arcaAuthStatus, setArcaAuthStatus] = useState(null);
  const [arcaAuthBusy, setArcaAuthBusy] = useState(false);
  const [arcaAuthAction, setArcaAuthAction] = useState("");
  const [arcaAuthError, setArcaAuthError] = useState("");
  const [arcaNotificationStatus, setArcaNotificationStatus] = useState({
    ok: true,
    connected: false,
    status: "signed-out",
    count: 0,
    notificationUrl: ARCA_NOTIFICATION_URL,
  });
  const [arcaNotificationBusy, setArcaNotificationBusy] = useState(false);
  const [showHiddenNotices, setShowHiddenNotices] = useState(false);
  const [newsFeedStatus, setNewsFeedStatus] = useState(null);
  const [newsFeedItems, setNewsFeedItems] = useState([]);
  const [newsFeedBusy, setNewsFeedBusy] = useState(false);
  const [newsFeedLoadingMore, setNewsFeedLoadingMore] = useState(false);
  const [newsFeedHasMore, setNewsFeedHasMore] = useState(false);
  const [newsFeedError, setNewsFeedError] = useState("");
  const [newsFeedSettings, setNewsFeedSettings] = useState(null);
  const [newsFeedSettingsBusy, setNewsFeedSettingsBusy] = useState(false);
  const [newsFeedSettingsSavingId, setNewsFeedSettingsSavingId] = useState("");
  const [newsFeedSettingsError, setNewsFeedSettingsError] = useState("");
  const [memoryStatus, setMemoryStatus] = useState(emptyMemoryStatus);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [memoryRecentOpen, setMemoryRecentOpen] = useState(false);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [memoryDialogRecords, setMemoryDialogRecords] = useState([]);
  const [memoryDialogBusy, setMemoryDialogBusy] = useState(false);
  const [memoryDialogError, setMemoryDialogError] = useState("");
  const [memoryDialogHasMore, setMemoryDialogHasMore] = useState(false);
  const [memoryDialogTotalCount, setMemoryDialogTotalCount] = useState(0);
  const [deletingMemoryRecordId, setDeletingMemoryRecordId] = useState("");
  const [worldMemorySettings, setWorldMemorySettings] = useState(defaultWorldMemorySettings);
  const [worldMemorySettingsBusy, setWorldMemorySettingsBusy] = useState(false);
  const [worldMemorySettingsSaving, setWorldMemorySettingsSaving] = useState(false);
  const [worldMemorySettingsError, setWorldMemorySettingsError] = useState("");
  const [magazineSettings, setMagazineSettings] = useState(defaultMagazineSettings);
  const [magazineSettingsBusy, setMagazineSettingsBusy] = useState(false);
  const [magazineSettingsSaving, setMagazineSettingsSaving] = useState(false);
  const [magazineSettingsError, setMagazineSettingsError] = useState("");
  const [worldMemoryStatus, setWorldMemoryStatus] = useState(null);
  const [worldMemoryBusy, setWorldMemoryBusy] = useState(false);
  const [worldMemoryError, setWorldMemoryError] = useState("");
  const [worldMemoryActionBusy, setWorldMemoryActionBusy] = useState(false);
  const [worldMemoryActionResult, setWorldMemoryActionResult] = useState(null);
  const [worldMemoryAgentAction, setWorldMemoryAgentAction] = useState(null);
  const [worldMemoryTechOpen, setWorldMemoryTechOpen] = useState(false);
  const [worldMemoryFocusedChangeSuggestion, setWorldMemoryFocusedChangeSuggestion] = useState(null);
  const [reportRefreshSignal, setReportRefreshSignal] = useState(0);
  const [earningCalendarContext, setEarningCalendarContext] = useState(null);
  const [economicCalendarContext, setEconomicCalendarContext] = useState(null);
  const [portfolioContext, setPortfolioContext] = useState(null);
  const [portfolioWidgetAgentAction, setPortfolioWidgetAgentAction] = useState(null);
  const [queuedPortfolioWidgetRequest, setQueuedPortfolioWidgetRequest] = useState(null);
  const [attachedArticle, setAttachedArticle] = useState(null);
  const [chatAttachments, setChatAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [isComposerDragging, setIsComposerDragging] = useState(false);
  const [attachingArticleHref, setAttachingArticleHref] = useState("");
  const messageStackRef = useRef(null);
  const promptRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeViewRef = useRef(activeView);
  const portfolioCanvasStoreRef = useRef(portfolioCanvasStore);
  const portfolioCanvasFileReadyRef = useRef(false);
  const newsFeedItemsCountRef = useRef(0);
  const newsFeedLatestTranslatedAtRef = useRef("");
  const magazineArticleCountRef = useRef(0);
  const magazineLatestArticleAtRef = useRef("");
  const openMagazineTopic = useCallback((event, topicLabel) => {
    event.preventDefault();
    magazineCanvasRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setMagazineActiveArticle(null);
    setMagazineDeleteDialogOpen(false);
    setMagazineDeleting(false);
    setMagazineDeleteError("");
    setMagazineActiveTopic(topicLabel);
  }, []);
  const closeMagazineTopic = useCallback((event) => {
    event?.preventDefault();
    setMagazineActiveTopic("");
  }, []);
  const openMagazineArticle = useCallback((event, article) => {
    event?.preventDefault();
    magazineReturnScrollRef.current = {
      canvasTop: magazineCanvasRef.current?.scrollTop ?? 0,
      topicTop: magazineTopicModalRef.current?.scrollTop ?? 0,
      hadTopic: Boolean(magazineActiveTopic),
    };
    setMagazinePreferenceNotice("");
    setMagazinePreferenceNoticeFading(false);
    setMagazineCommentDraft("");
    setMagazineCommentError("");
    setMagazineCommentStore(null);
    setMagazineCopyStatus("idle");
    setMagazineCopyError("");
    setMagazineActiveArticle(normalizeMagazineReaderArticle(article));
  }, [magazineActiveTopic]);
  const closeMagazineArticle = useCallback(() => {
    const returnScroll = magazineReturnScrollRef.current;
    setMagazinePreferenceNotice("");
    setMagazinePreferenceNoticeFading(false);
    setMagazineCommentDraft("");
    setMagazineCommentError("");
    setMagazineCommentStore(null);
    setMagazineDeleteDialogOpen(false);
    setMagazineDeleting(false);
    setMagazineDeleteError("");
    setMagazineCopyStatus("idle");
    setMagazineCopyError("");
    setMagazineActiveArticle(null);
    window.requestAnimationFrame(() => {
      if (magazineCanvasRef.current) {
        magazineCanvasRef.current.scrollTop = returnScroll.canvasTop;
      }
      if (returnScroll.hadTopic && magazineTopicModalRef.current) {
        magazineTopicModalRef.current.scrollTop = returnScroll.topicTop;
      }
    });
  }, []);
  const openMagazineDeleteDialog = useCallback(() => {
    setMagazineDeleteError("");
    setMagazineDeleteDialogOpen(true);
  }, []);
  const closeMagazineDeleteDialog = useCallback(() => {
    if (magazineDeleting) return;
    setMagazineDeleteDialogOpen(false);
    setMagazineDeleteError("");
  }, [magazineDeleting]);
  const copyMagazineArticle = useCallback(async () => {
    if (magazineCopyStatus === "copying") return;
    setMagazineCopyStatus("copying");
    setMagazineCopyError("");
    try {
      const magazineRuntime = providerRuntimeForProvider(magazineWritingProviderId());
      const result = await writeMagazineArticleToClipboard(magazineReaderArticleRef.current, {
        provider: magazineActiveArticle?.generationAgent?.provider || magazineRuntime.provider,
      });
      setMagazineCopyStatus(result.mode === "text" ? "text" : "copied");
      setMagazineCopyError(result.warning || "");
      window.setTimeout(() => {
        setMagazineCopyStatus("idle");
        setMagazineCopyError("");
      }, 2200);
    } catch (error) {
      setMagazineCopyStatus("error");
      setMagazineCopyError(error.message || "기사를 복사하지 못했습니다.");
    }
  }, [agentProvider, agentUserSettings, approvalOptions, antigravityCatalogGroups, magazineActiveArticle, magazineCopyStatus, magazineSettings, modelGroups, providerOptions]);
  const confirmMagazineArticleDelete = useCallback(async () => {
    if (!magazineActiveArticle?.id || magazineDeleting) return;
    setMagazineDeleting(true);
    setMagazineDeleteError("");
    try {
      const response = await fetch(
        `/api/magazine/articles?id=${encodeURIComponent(magazineActiveArticle.id)}`,
        { method: "DELETE" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "기사를 삭제하지 못했습니다.");
      }
      setMagazineCatalog(payload);
      closeMagazineArticle();
    } catch (error) {
      setMagazineDeleteError(error.message);
      setMagazineDeleting(false);
    }
  }, [closeMagazineArticle, magazineActiveArticle?.id, magazineDeleting]);
  const selectedMagazinePreferenceIds = magazineActiveArticle?.id
    ? (magazinePreferenceStore?.activeByArticle?.[magazineActiveArticle.id] || [])
        .map((item) => item?.optionId)
        .filter(Boolean)
    : [];
  const magazineComments = Array.isArray(magazineCommentStore?.comments) ? magazineCommentStore.comments : [];
  const saveMagazinePreference = useCallback(async (option) => {
    if (!magazineActiveArticle?.id || !option?.id) return;
    setMagazinePreferenceSavingId(option.id);
    try {
      const response = await fetch("/api/magazine/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: magazineActiveArticle.id,
          optionId: option.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "매거진 편집 선호를 저장하지 못했습니다.");
      }
      setMagazinePreferenceStore(payload);
      setMagazinePreferenceNoticeFading(false);
      setMagazinePreferenceNotice(payload.message || "앞으로의 기사 편집에 반영하도록 하겠습니다");
    } catch (error) {
      console.warn("Magazine preference save failed", error);
      setMagazinePreferenceNoticeFading(false);
      setMagazinePreferenceNotice("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setMagazinePreferenceSavingId("");
    }
  }, [magazineActiveArticle]);
  const submitMagazineComment = useCallback(async (event) => {
    event.preventDefault();
    const text = magazineCommentDraft.trim();
    if (!magazineActiveArticle?.id || !text || magazineCommentSubmitting) return;
    const createdAt = new Date().toISOString();
    const tempId = `temp-${Date.now()}`;
    const pendingComment = normalizeMagazineComment({
      id: tempId,
      author: "사용자",
      text,
      createdAt,
      reply: {
        id: `reply-${tempId}`,
        author: "매거진 편집자 AI",
        text: "",
        status: "waiting",
        createdAt,
      },
    });
    setMagazineCommentDraft("");
    setMagazineCommentError("");
    setMagazineCommentSubmitting(true);
    setMagazineCommentStore((current) => {
      const normalized = normalizeMagazineCommentStore(current, magazineActiveArticle.id);
      return {
        ...normalized,
        updatedAt: createdAt,
        commentCount: normalized.comments.length + 1,
        comments: [...normalized.comments, pendingComment].filter(Boolean),
      };
    });
    window.setTimeout(() => {
      setMagazineCommentStore((current) => {
        const normalized = normalizeMagazineCommentStore(current, magazineActiveArticle.id);
        return {
          ...normalized,
          comments: normalized.comments.map((comment) =>
            comment.id === tempId && comment.reply?.status === "waiting"
              ? {
                  ...comment,
                  reply: {
                    ...comment.reply,
                    status: "generating",
                  },
                }
              : comment
          ),
        };
      });
    }, 700);

    try {
      const magazineRuntime = providerRuntimeForProvider(magazineWritingProviderId());
      const response = await fetch("/api/magazine/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: magazineActiveArticle.id,
          text,
          provider: magazineRuntime.provider,
          model: magazineRuntime.selectedModelGroup?.slug,
          reasoning: magazineRuntime.selectedReasoning?.id,
          approval: magazineRuntime.selectedApproval?.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "댓글 답변을 저장하지 못했습니다.");
      }
      setMagazineCommentStore(normalizeMagazineCommentStore(payload, magazineActiveArticle.id));
    } catch (error) {
      setMagazineCommentError(error.message);
      setMagazineCommentStore((current) => {
        const normalized = normalizeMagazineCommentStore(current, magazineActiveArticle.id);
        return {
          ...normalized,
          comments: normalized.comments.map((comment) =>
            comment.id === tempId
              ? {
                  ...comment,
                  reply: {
                    id: `reply-${tempId}`,
                    author: "매거진 편집자 AI",
                    text: `답변 생성에 실패했습니다. (${error.message})`,
                    status: "error",
                    createdAt: new Date().toISOString(),
                  },
                }
              : comment
          ),
        };
      });
    } finally {
      setMagazineCommentSubmitting(false);
    }
  }, [
    agentProvider,
    agentUserSettings,
    approval,
    approvalOptions,
    antigravityCatalogGroups,
    magazineActiveArticle,
    magazineCommentDraft,
    magazineCommentSubmitting,
    magazineSettings,
    model,
    modelGroups,
    providerOptions,
    reasoning,
    speed,
  ]);
  const magazineArticles = useMemo(() => {
    const catalogArticles = Array.isArray(magazineCatalog?.articles) ? magazineCatalog.articles : [];
    return catalogArticles.length ? catalogArticles : magazineArticleList;
  }, [magazineCatalog]);
  const magazineTopicCatalog = useMemo(
    () => normalizeMagazineTopicCatalog(magazineCatalog?.topicCatalog),
    [magazineCatalog],
  );
  const magazineActiveTopicEntry = magazineTopicCatalog.find((topic) => topic.label === magazineActiveTopic) || null;
  const magazineTopicArticles = useMemo(() => {
    if (!magazineActiveTopic) return [];
    return magazineArticles.filter((article) => magazineArticleTopics(article).includes(magazineActiveTopic));
  }, [magazineActiveTopic, magazineArticles]);
  const magazineCoverStories = useMemo(() => {
    const catalogCoverStories = Array.isArray(magazineCatalog?.coverStories) ? magazineCatalog.coverStories : [];
    if (catalogCoverStories.length) return catalogCoverStories;
    const catalogArticles = Array.isArray(magazineCatalog?.articles) ? magazineCatalog.articles : [];
    return catalogArticles.length ? catalogArticles.slice(0, 5) : magazineFallbackCoverStories;
  }, [magazineCatalog]);
  const magazineCoverHeadline = magazineCoverStories[0] ?? magazineArticles[0] ?? magazineHeadlineStory;
  const magazineCoverCards = magazineCoverStories.slice(1, 5);
  const activeModelGroups = agentProvider === ANTIGRAVITY_PROVIDER_ID ? antigravityCatalogGroups : modelGroups;
  const activeApprovalOptions = agentProvider === ANTIGRAVITY_PROVIDER_ID ? antigravityPolicyOptions : approvalOptions;
  const worldMemoryEnabled = Boolean(worldMemorySettings?.enabled);
  const magazineEnabled = worldMemoryEnabled && Boolean(magazineSettings?.enabled);
  const selectedModelGroup = useMemo(
    () => activeModelGroups.find((item) => item.slug === model) ?? activeModelGroups[0] ?? fallbackModelGroups[0],
    [model, activeModelGroups]
  );
  const reasoningOptions = selectedModelGroup?.reasoningLevels?.length
    ? selectedModelGroup.reasoningLevels
    : fallbackModelGroups[0].reasoningLevels;
  const selectedReasoning = useMemo(
    () =>
      reasoningOptions.find((item) => item.id === reasoning) ??
      reasoningOptions.find((item) => item.id === selectedModelGroup?.defaultReasoningLevel) ??
      reasoningOptions[0],
    [reasoning, reasoningOptions, selectedModelGroup]
  );
  const speedOptions = useMemo(() => getSpeedOptions(selectedModelGroup), [selectedModelGroup]);
  const selectedSpeed = useMemo(
    () => speedOptions.find((item) => item.id === speed) ?? speedOptions[0],
    [speed, speedOptions]
  );
  const arcaNotificationHealth = arcaNotificationHealthState(arcaNotificationStatus);
  const modelSummaryLabel = `${selectedModelGroup?.label || "모델"} ${selectedReasoning?.label || ""}`.trim();
  const selectedApproval = useMemo(
    () => activeApprovalOptions.find((item) => item.id === approval) ?? activeApprovalOptions[0],
    [approval, activeApprovalOptions]
  );
  const selectedProvider = useMemo(
    () => providerOptions.find((item) => item.id === agentProvider) ?? providerOptions[0] ?? fallbackProviderOptions[0],
    [agentProvider, providerOptions]
  );
  const agentProviderLabel = agentOptionsReady ? selectedProvider?.label || "Codex CLI" : "에이전트";
  const agentProviderAvailable = agentOptionsReady && Boolean(selectedProvider?.available);
  const agentIcon = agentOptionsReady && agentProvider === ANTIGRAVITY_PROVIDER_ID ? antigravityLogo : codexLogo;
  const portfolioCanvases = portfolioCanvasStore.canvases;
  const activePortfolioCanvas = useMemo(
    () => portfolioCanvases.find((canvas) => canvas.id === portfolioCanvasStore.activeCanvasId) || null,
    [portfolioCanvases, portfolioCanvasStore.activeCanvasId]
  );
  const isPortfolioCanvasView = activeView === "portfolio-canvas" && Boolean(activePortfolioCanvas);
  const isChatCanvasView = activeView === "chat";
  const activeChatScope = isPortfolioCanvasView
    ? { type: "portfolio-canvas", canvasId: activePortfolioCanvas.id }
    : { type: "system-main", canvasId: "" };
  const visibleChatMessages = isPortfolioCanvasView ? activePortfolioCanvas.chatMessages : chatMessages;

  useEffect(() => {
    if (!editingPortfolioCanvasId) return;
    portfolioCanvasNameInputRef.current?.focus();
    portfolioCanvasNameInputRef.current?.select();
  }, [editingPortfolioCanvasId]);

  const toolbarApprovalOptions = agentOptionsReady ? activeApprovalOptions : loadingApprovalOptions;
  const toolbarModelGroups = agentOptionsReady ? activeModelGroups : loadingModelGroups;
  const toolbarApprovalValue = agentOptionsReady ? selectedApproval?.id || approval : "loading";
  const toolbarModelValue = agentOptionsReady ? selectedModelGroup?.slug || model : "loading";
  const toolbarReasoningValue = agentOptionsReady ? selectedReasoning?.id || reasoning : "loading";
  const toolbarSpeedValue = agentOptionsReady ? speed : "loading";
  const newsFeedTranslationModelLabel = useMemo(() => {
    if (!agentOptionsReady) return "";
    if (agentProvider === ANTIGRAVITY_PROVIDER_ID) {
      const translationModel = selectAntigravityModelForReasoning(antigravityCatalogGroups, {
        currentModel: selectedModelGroup?.slug || model || ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
      });
      return `Antigravity CLI · ${translationModel}`;
    }

    const translationGroup = modelGroups[0] || selectedModelGroup;
    const supported = (translationGroup?.reasoningLevels || []).map((level) => level.id);
    const translationReasoning =
      ["minimal", "low", "medium", "high", "xhigh"].find((level) => supported.includes(level)) ||
      translationGroup?.defaultReasoningLevel ||
      supported[0] ||
      "low";
    return translationGroup?.slug ? `${translationGroup.slug} · ${translationReasoning}` : "";
  }, [agentOptionsReady, agentProvider, antigravityCatalogGroups, selectedModelGroup, model, modelGroups]);
  const activeCategoryLabel = useMemo(() => {
    const selected = arcaBoard?.categories?.find((category) => category.name === boardFilters.category);
    return selected?.label || "전체";
  }, [arcaBoard, boardFilters.category]);

  function modelGroupsForProvider(
    providerId,
    groups = modelGroups,
    nextAntigravityGroups = antigravityCatalogGroups
  ) {
    return providerId === ANTIGRAVITY_PROVIDER_ID
      ? nextAntigravityGroups.length
        ? nextAntigravityGroups
        : antigravityModelGroups
      : groups.length
        ? groups
        : fallbackModelGroups;
  }

  function selectionForProvider(
    providerId,
    preferred = {},
    groups = modelGroups,
    nextAntigravityGroups = antigravityCatalogGroups,
    approvals = approvalOptions
  ) {
    const nextGroups = modelGroupsForProvider(providerId, groups, nextAntigravityGroups);
    const nextApprovalOptions = providerId === ANTIGRAVITY_PROVIDER_ID
      ? antigravityPolicyOptions
      : approvals.length
        ? approvals
        : fallbackApprovalOptions;
    const nextApproval = nextApprovalOptions.some((item) => item.id === preferred.approval)
      ? preferred.approval
      : nextApprovalOptions[0]?.id || fallbackApprovalOptions[0].id;
    const nextGroup = nextGroups.find((item) => item.slug === preferred.model) ?? nextGroups[0] ?? fallbackModelGroups[0];
    const nextReasoningLevels = nextGroup.reasoningLevels?.length
      ? nextGroup.reasoningLevels
      : fallbackModelGroups[0].reasoningLevels;
    const nextReasoning = nextReasoningLevels.some((item) => item.id === preferred.reasoning)
      ? preferred.reasoning
      : nextGroup.defaultReasoningLevel || nextReasoningLevels[0]?.id || "medium";
    const nextSpeedOptions = getSpeedOptions(nextGroup);
    const nextSpeed = nextSpeedOptions.some((item) => item.id === preferred.speed)
      ? preferred.speed
      : "standard";

    return {
      provider: providerId,
      approval: nextApproval,
      model: nextGroup.slug,
      reasoning: nextReasoning,
      speed: nextSpeed,
    };
  }

  function agentProviderSettings(providerId, settings = agentUserSettings) {
    return settings?.providers?.[providerId] || {};
  }

  function isAgentProviderEnabled(providerId, settings = agentUserSettings) {
    const providerSettings = agentProviderSettings(providerId, settings);
    if (typeof providerSettings.enabled === "boolean") return providerSettings.enabled;
    return providerId === settings?.selectedProvider;
  }

  function enabledAgentProviders(settings = agentUserSettings) {
    return agentProviderIds.filter((providerId) => isAgentProviderEnabled(providerId, settings));
  }

  function applyAgentSelection(selection) {
    setApproval(selection.approval);
    setModel(selection.model);
    setReasoning(selection.reasoning);
    setSpeed(selection.speed);
  }

  async function saveAgentSettingsPatch(patch) {
    setAgentSettingsError("");
    try {
      const response = await fetch("/api/codex/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(patch),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setAgentUserSettings(payload.settings || emptyAgentSettings);
      return payload.settings || emptyAgentSettings;
    } catch (error) {
      setAgentSettingsError(error.message);
      return null;
    }
  }

  async function saveAgentSettings(selection) {
    return saveAgentSettingsPatch({
      selectedProvider: selection.provider,
      providers: {
        [selection.provider]: {
          enabled: true,
          approval: selection.approval,
          model: selection.model,
          reasoning: selection.reasoning,
          speed: selection.speed,
        },
      },
    });
  }

  async function savePersonaMode(nextPersonaMode) {
    setAgentSettingsError("");
    try {
      const response = await fetch("/api/codex/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ personaMode: nextPersonaMode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setAgentUserSettings(payload.settings || emptyAgentSettings);
      return payload.settings || emptyAgentSettings;
    } catch (error) {
      setAgentSettingsError(error.message);
      return null;
    }
  }

  function updatePersonaMode(nextPersonaMode) {
    const safePersonaMode = personaModeOptions.some((option) => option.id === nextPersonaMode)
      ? nextPersonaMode
      : "none";
    setPersonaMode(safePersonaMode);
    void savePersonaMode(safePersonaMode);
  }

  function handleAgentProviderChange(nextProvider) {
    setAgentProvider(nextProvider);
    const savedProviderSettings = agentProviderSettings(nextProvider);
    const nextSelection = selectionForProvider(nextProvider, savedProviderSettings);
    applyAgentSelection(nextSelection);
    void saveAgentSettings(nextSelection).then((settings) => {
      if (settings && nextProvider === ANTIGRAVITY_PROVIDER_ID) {
        void refreshAgentOptions();
      }
    });
  }

  function updateAgentSelection(patch) {
    const nextSelection = selectionForProvider(agentProvider, {
      approval: selectedApproval?.id || approval,
      model: selectedModelGroup?.slug || model,
      reasoning: selectedReasoning?.id || reasoning,
      speed: selectedSpeed?.id || speed,
      ...patch,
    });
    applyAgentSelection(nextSelection);
    void saveAgentSettings(nextSelection);
  }

  function updateProviderSelection(providerId, patch) {
    const currentProviderSettings = agentProviderSettings(providerId);
    const nextSelection = selectionForProvider(providerId, {
      ...currentProviderSettings,
      ...patch,
    });
    const providerPatch = {
      enabled: isAgentProviderEnabled(providerId),
      approval: nextSelection.approval,
      model: nextSelection.model,
      reasoning: nextSelection.reasoning,
      speed: nextSelection.speed,
    };

    setAgentUserSettings((current) => ({
      ...current,
      providers: {
        ...(current.providers || {}),
        [providerId]: {
          ...(current.providers?.[providerId] || {}),
          ...providerPatch,
        },
      },
    }));

    if (providerId === agentProvider) {
      applyAgentSelection(nextSelection);
    }

    void saveAgentSettingsPatch({
      providers: {
        [providerId]: providerPatch,
      },
    });
  }

  function updateProviderEnabled(providerId, enabled) {
    const currentEnabledProviders = enabledAgentProviders();
    if (!enabled && currentEnabledProviders.length <= 1 && currentEnabledProviders.includes(providerId)) {
      return;
    }

    const currentProviderSettings = agentProviderSettings(providerId);
    const providerSelection = selectionForProvider(providerId, currentProviderSettings);
    const nextSelectedProvider =
      !enabled && agentProvider === providerId
        ? currentEnabledProviders.find((id) => id !== providerId) || agentProvider
        : agentProvider;
    const nextSelectedSettings = agentProviderSettings(nextSelectedProvider);
    const nextSelection = selectionForProvider(nextSelectedProvider, nextSelectedSettings);
    const providerPatch = {
      enabled,
      approval: providerSelection.approval,
      model: providerSelection.model,
      reasoning: providerSelection.reasoning,
      speed: providerSelection.speed,
    };

    setAgentUserSettings((current) => ({
      ...current,
      selectedProvider: nextSelectedProvider,
      providers: {
        ...(current.providers || {}),
        [providerId]: {
          ...(current.providers?.[providerId] || {}),
          ...providerPatch,
        },
      },
    }));
    if (nextSelectedProvider !== agentProvider) {
      setAgentProvider(nextSelectedProvider);
      applyAgentSelection(nextSelection);
    }

    void saveAgentSettingsPatch({
      selectedProvider: nextSelectedProvider,
      providers: {
        [providerId]: providerPatch,
      },
    }).then((settings) => {
      if (settings && providerId === ANTIGRAVITY_PROVIDER_ID) {
        void refreshAgentOptions();
      }
    });
  }

  function configuredProviderId(setting) {
    const normalized = normalizeAgentModelProvider(setting);
    return normalized === "default" ? agentProvider : normalized;
  }

  function worldMemoryManagementProviderId() {
    return configuredProviderId(
      worldMemorySettings?.settings?.managementProvider || worldMemorySettings?.managementProvider
    );
  }

  function magazineWritingProviderId() {
    return configuredProviderId(
      magazineSettings?.settings?.writingProvider || magazineSettings?.writingProvider
    );
  }

  function commandPreviewForRuntime(runtime) {
    if (!agentOptionsReady) {
      return "에이전트 설정 불러오는 중";
    }
    if (runtime.provider === ANTIGRAVITY_PROVIDER_ID) {
      return runtime.selectedProvider?.available
        ? `agy --model "${runtime.selectedModelGroup?.slug || "Gemini 3.5 Flash (Medium)"}" · ${runtime.selectedApproval?.label || "Default"}`
        : runtime.selectedProvider?.installCommand || "curl -fsSL https://antigravity.google/cli/install.sh | bash";
    }
    const approvalFlag = runtime.selectedApproval?.cli || "";
    const modelFlag = runtime.selectedModelGroup?.slug ? `-m ${runtime.selectedModelGroup.slug}` : "";
    const reasoningFlag = runtime.selectedReasoning?.cli || "";
    const speedHint =
      runtime.selectedSpeed && runtime.selectedSpeed.id !== "standard"
        ? `[speed: ${runtime.selectedSpeed.label}${runtime.selectedSpeed.pending ? " · CLI config 확인 필요" : ""}]`
        : "";
    return ["codex", approvalFlag, modelFlag, reasoningFlag, speedHint].filter(Boolean).join(" ");
  }

  function providerRuntimeForProvider(providerId) {
    const runtimeProvider = providerId === ANTIGRAVITY_PROVIDER_ID ? ANTIGRAVITY_PROVIDER_ID : CODEX_PROVIDER_ID;
    const providerStatus =
      providerOptions.find((item) => item.id === runtimeProvider) ||
      fallbackProviderOptions.find((item) => item.id === runtimeProvider) ||
      { id: runtimeProvider, label: runtimeProvider };
    const providerModelGroups = modelGroupsForProvider(runtimeProvider);
    const providerApprovalOptions =
      runtimeProvider === ANTIGRAVITY_PROVIDER_ID
        ? antigravityPolicyOptions
        : approvalOptions.length
          ? approvalOptions
          : fallbackApprovalOptions;
    const providerSelection =
      runtimeProvider === agentProvider
        ? {
            provider: runtimeProvider,
            approval: selectedApproval?.id || approval,
            model: selectedModelGroup?.slug || model,
            reasoning: selectedReasoning?.id || reasoning,
            speed: selectedSpeed?.id || speed,
          }
        : selectionForProvider(runtimeProvider, agentProviderSettings(runtimeProvider));
    const providerModelGroup =
      providerModelGroups.find((item) => item.slug === providerSelection.model) ||
      providerModelGroups[0] ||
      fallbackModelGroups[0];
    const providerReasoningOptions = providerModelGroup?.reasoningLevels?.length
      ? providerModelGroup.reasoningLevels
      : fallbackModelGroups[0].reasoningLevels;
    const providerSpeedOptions = getSpeedOptions(providerModelGroup);
    const runtime = {
      provider: runtimeProvider,
      selectedProvider: providerStatus,
      providerLabel: agentOptionsReady
        ? providerStatus?.label || (runtimeProvider === ANTIGRAVITY_PROVIDER_ID ? "Antigravity CLI" : "Codex CLI")
        : "에이전트",
      providerAvailable: agentOptionsReady && Boolean(providerStatus?.available),
      icon: agentOptionsReady && runtimeProvider === ANTIGRAVITY_PROVIDER_ID ? antigravityLogo : codexLogo,
      approvalOptions: providerApprovalOptions,
      selectedApproval:
        providerApprovalOptions.find((item) => item.id === providerSelection.approval) || providerApprovalOptions[0],
      modelGroups: providerModelGroups,
      selectedModelGroup: providerModelGroup,
      reasoningOptions: providerReasoningOptions,
      selectedReasoning:
        providerReasoningOptions.find((item) => item.id === providerSelection.reasoning) || providerReasoningOptions[0],
      speedOptions: providerSpeedOptions,
      selectedSpeed: providerSpeedOptions.find((item) => item.id === providerSelection.speed) || providerSpeedOptions[0],
    };
    return {
      ...runtime,
      modelSummaryLabel: `${runtime.selectedModelGroup?.label || "모델"} ${runtime.selectedReasoning?.label || ""}`.trim(),
      commandPreview: commandPreviewForRuntime(runtime),
    };
  }

  function updatePortfolioCanvasStore(updater) {
    setPortfolioCanvasStore((current) => normalizePortfolioCanvasStore(updater(current)));
  }

  const updatePortfolioCanvasWorkspace = useCallback((canvasId, workspace) => {
    const targetCanvasId = String(canvasId || "").trim();
    if (!targetCanvasId) return;
    setPortfolioCanvasStore((current) =>
      buildPortfolioCanvasWorkspaceUpdateState(current, workspace, targetCanvasId)
    );
  }, []);

  const updateActivePortfolioCanvasWorkspace = useCallback(
    (workspace) => {
      if (!activePortfolioCanvas?.id) return;
      updatePortfolioCanvasWorkspace(activePortfolioCanvas.id, workspace);
    },
    [activePortfolioCanvas?.id, updatePortfolioCanvasWorkspace]
  );

  function updateChatMessagesForScope(scope, updater) {
    if (scope?.type === "portfolio-canvas" && scope.canvasId) {
      updatePortfolioCanvasStore((current) => ({
        ...current,
        canvases: current.canvases.map((canvas) => {
          if (canvas.id !== scope.canvasId) return canvas;
          const currentMessages = normalizePortfolioChatMessages(canvas.chatMessages);
          const nextMessages = typeof updater === "function" ? updater(currentMessages) : updater;
          return {
            ...canvas,
            chatMessages: normalizePortfolioChatMessages(nextMessages),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return;
    }
    setChatMessages((messages) => {
      const nextMessages = typeof updater === "function" ? updater(messages) : updater;
      return Array.isArray(nextMessages) ? nextMessages : initialChatMessages;
    });
  }

  function chatMessagesForScope(scope) {
    if (scope?.type === "portfolio-canvas" && scope.canvasId) {
      const canvas = portfolioCanvases.find((item) => item.id === scope.canvasId);
      return normalizePortfolioChatMessages(canvas?.chatMessages);
    }
    return chatMessages;
  }

  function startNewChat() {
    updateChatMessagesForScope(activeChatScope, initialChatMessages);
    setAttachedArticle(null);
    setChatAttachments([]);
    setAttachmentError("");
  }

  function resolveChatScope(screen) {
    if ((screen === "portfolio-canvas" || screen === "portfolio") && isPortfolioCanvasView && activePortfolioCanvas) {
      return { type: "portfolio-canvas", canvasId: activePortfolioCanvas.id };
    }
    return { type: "system-main", canvasId: "" };
  }

  function createPortfolioCanvasFromGuide(mode = PORTFOLIO_CANVAS_MODES.asset.id) {
    if (mode === PORTFOLIO_CANVAS_MODES.asset.id) {
      setAssetApiDialogOpen(true);
      return "";
    }
    let createdCanvasId = "";
    updatePortfolioCanvasStore((current) => {
      const result = buildPortfolioCanvasCreateState(current, mode);
      createdCanvasId = result.canvasId;
      return result.store;
    });
    setPortfolioSidebarOpen(true);
    setPortfolioCanvasMenuId("");
    setPortfolioContext(null);
    setActiveView("portfolio-canvas");
    return createdCanvasId;
  }

  function selectPortfolioCanvas(canvasId) {
    updatePortfolioCanvasStore((current) => buildPortfolioCanvasSelectState(current, canvasId));
    setPortfolioSidebarOpen(true);
    setPortfolioCanvasMenuId("");
    setPortfolioContext(null);
    setActiveView("portfolio-canvas");
  }

  function renamePortfolioCanvasTo(canvasId, nextName) {
    updatePortfolioCanvasStore((current) => buildPortfolioCanvasRenameState(current, canvasId, nextName).store);
  }

  function startPortfolioCanvasRename(canvas) {
    if (!canvas) return;
    setPortfolioSidebarOpen(true);
    setPortfolioCanvasMenuId("");
    setEditingPortfolioCanvasId(canvas.id);
    setPortfolioCanvasNameDraft(canvas.name || "");
  }

  function closePortfolioCanvasRename() {
    setEditingPortfolioCanvasId("");
    setPortfolioCanvasNameDraft("");
  }

  function savePortfolioCanvasNameDraft() {
    if (!editingPortfolioCanvasId) return;
    const currentCanvas = portfolioCanvases.find((canvas) => canvas.id === editingPortfolioCanvasId);
    const cleanName = cleanPortfolioWidgetPrompt(portfolioCanvasNameDraft, 80);
    if (currentCanvas && cleanName && cleanName !== currentCanvas.name) {
      renamePortfolioCanvasTo(currentCanvas.id, cleanName);
    }
    closePortfolioCanvasRename();
  }

  function handlePortfolioCanvasNameKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      savePortfolioCanvasNameDraft();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.dataset.cancelled = "true";
      closePortfolioCanvasRename();
    }
  }

  function renamePortfolioCanvas(canvas) {
    if (!canvas) return;
    startPortfolioCanvasRename(canvas);
  }

  function duplicatePortfolioCanvas(canvas) {
    if (!canvas) return;
    let duplicatedCanvasId = "";
    updatePortfolioCanvasStore((current) => {
      const result = buildPortfolioCanvasDuplicateState(current, canvas);
      duplicatedCanvasId = result.canvasId;
      return result.store;
    });
    setPortfolioSidebarOpen(true);
    setPortfolioCanvasMenuId("");
    setPortfolioContext(null);
    setActiveView("portfolio-canvas");
    return duplicatedCanvasId;
  }

  function requestDeletePortfolioCanvas(canvas) {
    setPendingDeletePortfolioCanvas(canvas || null);
    setPortfolioCanvasMenuId("");
  }

  function confirmDeletePortfolioCanvas() {
    const targetId = pendingDeletePortfolioCanvas?.id;
    if (!targetId) return;
    const visibleDeleteState = buildPortfolioCanvasDeleteState(portfolioCanvasStore, targetId);
    setPortfolioCanvasStore((current) => buildPortfolioCanvasDeleteState(current, targetId).store);
    if (visibleDeleteState.deletedActive) {
      setPortfolioContext(null);
      setActiveView(visibleDeleteState.nextActiveCanvasId ? "portfolio-canvas" : "portfolio");
    }
    if (editingPortfolioCanvasId === targetId) {
      closePortfolioCanvasRename();
    }
    setPendingDeletePortfolioCanvas(null);
  }

  function updateBoardFilters(nextPatch) {
    setBoardFilters((filters) => ({ ...filters, ...nextPatch }));
  }

  function selectBoardCategory(category) {
    setShowHiddenNotices(false);
    updateBoardFilters({ category, page: 1 });
  }

  function refreshBoard() {
    setBoardFilters((filters) => ({ ...filters }));
    void loadArcaNotifications();
  }

  function handleSidebarItemClick(item) {
    if (!item.view) return;
    if (item.view === "magazine" && activeView === "magazine" && (magazineActiveArticle || magazineActiveTopic)) {
      if (magazineActiveArticle) closeMagazineArticle();
      if (magazineActiveTopic) closeMagazineTopic();
      return;
    }
    if (item.view === "portfolio") {
      setActiveView("portfolio");
      setPortfolioContext(null);
      setPortfolioSidebarOpen((open) => !open);
      setPortfolioCanvasMenuId("");
      return;
    }
    if (item.view === "stock") {
      refreshBoard();
    }
    setActiveView(item.view);
  }

  async function loadNewsFeedItems({ reset = false } = {}) {
    if (reset ? newsFeedBusy : newsFeedLoadingMore || newsFeedBusy || !newsFeedHasMore) return;
    if (reset) {
      setNewsFeedBusy(true);
      setNewsFeedError("");
    } else {
      setNewsFeedLoadingMore(true);
    }

    try {
      const offset = reset ? 0 : newsFeedItems.length;
      const response = await fetch(`/api/news-feed/items?limit=${NEWS_FEED_PAGE_SIZE}&offset=${offset}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      setNewsFeedStatus((current) => ({
        ...(current || {}),
        itemCount: payload.itemCount,
        readState: payload.readState || current?.readState,
        offset: payload.offset,
        limit: payload.limit,
        hasMore: payload.hasMore,
      }));
      setNewsFeedHasMore(Boolean(payload.hasMore));
      setNewsFeedItems((current) => {
        const nextItems = reset ? payload.items || [] : [...current, ...(payload.items || [])];
        const seen = new Set();
        return nextItems.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      });
    } catch (error) {
      setNewsFeedError(error.message);
    } finally {
      setNewsFeedBusy(false);
      setNewsFeedLoadingMore(false);
    }
  }

  async function loadNewsFeedSettings() {
    setNewsFeedSettingsBusy(true);
    setNewsFeedSettingsError("");
    try {
      const response = await fetch("/api/news-feed/settings", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setNewsFeedSettings(payload);
    } catch (error) {
      setNewsFeedSettingsError(error.message);
    } finally {
      setNewsFeedSettingsBusy(false);
    }
  }

  async function loadSharedMemoryStatus() {
    setMemoryBusy(true);
    setMemoryError("");
    try {
      const response = await fetch(`/api/memory?limit=${MEMORY_RECENT_LIMIT}&offset=0`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setMemoryStatus(payload);
    } catch (error) {
      setMemoryError(error.message);
    } finally {
      setMemoryBusy(false);
    }
  }

  async function loadWorldMemorySettings({ quiet = false, refreshStatus = false } = {}) {
    if (!quiet) {
      setWorldMemorySettingsBusy(true);
      setWorldMemorySettingsError("");
    }
    try {
      const response = await fetch("/api/world-memory/settings", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const nextSettings = { ...defaultWorldMemorySettings, ...payload };
      setWorldMemorySettings(nextSettings);
      if (refreshStatus && nextSettings.enabled) {
        await loadWorldMemoryStatus();
      } else if (!nextSettings.enabled) {
        setWorldMemoryStatus((current) => ({
          ...(current || {}),
          ok: true,
          enabled: false,
          settings: nextSettings.settings,
          configPath: nextSettings.configPath,
          defaultConfigPath: nextSettings.defaultConfigPath,
          collector: {
            ...(current?.collector || {}),
            status: "disabled",
            schedulerStarted: false,
            inFlight: false,
          },
        }));
        setWorldMemoryError("");
      }
      return nextSettings;
    } catch (error) {
      setWorldMemorySettingsError(error.message);
      return null;
    } finally {
      if (!quiet) setWorldMemorySettingsBusy(false);
    }
  }

  async function loadMagazineSettings({ quiet = false } = {}) {
    if (!quiet) {
      setMagazineSettingsBusy(true);
      setMagazineSettingsError("");
    }
    try {
      const response = await fetch("/api/magazine/settings", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const nextSettings = { ...defaultMagazineSettings, ...payload };
      setMagazineSettings(nextSettings);
      setMagazineStatus((current) => ({
        ...(current || {}),
        settings: nextSettings,
        scheduler: current?.scheduler
          ? {
              ...current.scheduler,
              enabled: Boolean(nextSettings.enabled),
              settings: nextSettings,
              nextRunAt: nextSettings.enabled ? current.scheduler.nextRunAt : "",
            }
          : current?.scheduler,
      }));
      return nextSettings;
    } catch (error) {
      setMagazineSettingsError(error.message);
      return null;
    } finally {
      if (!quiet) setMagazineSettingsBusy(false);
    }
  }

  async function loadWorldMemoryStatus() {
    setWorldMemoryBusy(true);
    setWorldMemoryError("");
    try {
      const response = await fetch("/api/world-memory/status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setWorldMemoryStatus(payload);
      if (!payload.ok && payload.dependencies?.issues?.length) {
        const firstError = payload.dependencies.issues.find((issue) => issue.status === "error");
        setWorldMemoryError(firstError?.message || "");
      }
    } catch (error) {
      setWorldMemoryError(error.message);
    } finally {
      setWorldMemoryBusy(false);
    }
  }

  async function updateWorldMemoryEnabled(enabled) {
    if (worldMemorySettingsSaving) return;
    setWorldMemorySettingsSaving(true);
    setWorldMemorySettingsError("");
    try {
      const response = await fetch("/api/world-memory/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const nextSettings = { ...defaultWorldMemorySettings, ...payload };
      setWorldMemorySettings(nextSettings);
      setWorldMemoryAgentAction(null);
      setWorldMemoryFocusedChangeSuggestion(null);
      if (nextSettings.enabled) {
        await loadWorldMemoryStatus();
        void loadMagazineSettings({ quiet: true });
      } else {
        setMagazineSettings((current) => ({
          ...(current || defaultMagazineSettings),
          ok: true,
          enabled: false,
          worldMemoryEnabled: false,
          disabledReason: "world-memory-disabled",
          settings: {
            ...((current || defaultMagazineSettings).settings || {}),
            enabled: false,
            disabledReason: "world-memory-disabled",
          },
        }));
        setMagazineStatus((current) => ({
          ...(current || {}),
          settings: {
            ...(current?.settings || defaultMagazineSettings),
            enabled: false,
            worldMemoryEnabled: false,
            disabledReason: "world-memory-disabled",
          },
          scheduler: current?.scheduler
            ? {
                ...current.scheduler,
                enabled: false,
                nextRunAt: "",
              }
            : current?.scheduler,
        }));
        setMagazineSettingsError("");
        setWorldMemoryError("");
        setWorldMemoryStatus((current) => ({
          ...(current || {}),
          ok: true,
          enabled: false,
          settings: nextSettings.settings,
          configPath: nextSettings.configPath,
          defaultConfigPath: nextSettings.defaultConfigPath,
          collector: {
            ...(current?.collector || {}),
            status: "disabled",
            schedulerStarted: false,
            inFlight: false,
          },
        }));
        if (activeViewRef.current === "world-memory") {
          setActiveView("stock");
        }
      }
    } catch (error) {
      setWorldMemorySettingsError(error.message);
    } finally {
      setWorldMemorySettingsSaving(false);
    }
  }

  async function updateWorldMemoryManagementProvider(managementProvider) {
    if (worldMemorySettingsSaving) return;
    const safeProvider = normalizeAgentModelProvider(managementProvider);
    setWorldMemorySettingsSaving(true);
    setWorldMemorySettingsError("");
    try {
      const response = await fetch("/api/world-memory/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ managementProvider: safeProvider }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setWorldMemorySettings({ ...defaultWorldMemorySettings, ...payload });
      setWorldMemoryStatus((current) =>
        current
          ? {
              ...current,
              settings: payload.settings || current.settings,
            }
          : current
      );
    } catch (error) {
      setWorldMemorySettingsError(error.message);
    } finally {
      setWorldMemorySettingsSaving(false);
    }
  }

  async function updateMagazineEnabled(enabled) {
    if (magazineSettingsSaving) return;
    setMagazineSettingsSaving(true);
    setMagazineSettingsError("");
    try {
      const response = await fetch("/api/magazine/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const nextSettings = { ...defaultMagazineSettings, ...payload };
      setMagazineSettings(nextSettings);
      await refreshMagazineStatus();
    } catch (error) {
      setMagazineSettingsError(error.message);
    } finally {
      setMagazineSettingsSaving(false);
    }
  }

  async function updateMagazineWritingProvider(writingProvider) {
    if (magazineSettingsSaving) return;
    const safeProvider = normalizeAgentModelProvider(writingProvider);
    setMagazineSettingsSaving(true);
    setMagazineSettingsError("");
    try {
      const response = await fetch("/api/magazine/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ writingProvider: safeProvider }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const nextSettings = { ...defaultMagazineSettings, ...payload };
      setMagazineSettings(nextSettings);
      setMagazineStatus((current) => ({
        ...(current || {}),
        settings: nextSettings,
        scheduler: current?.scheduler
          ? {
              ...current.scheduler,
              settings: nextSettings,
            }
          : current?.scheduler,
      }));
    } catch (error) {
      setMagazineSettingsError(error.message);
    } finally {
      setMagazineSettingsSaving(false);
    }
  }

  async function updateMagazineSchedulerInterval(schedulerIntervalHours) {
    if (magazineSettingsSaving) return;
    const safeIntervalHours = Math.max(1, Math.min(10, Math.round(Number(schedulerIntervalHours || 6))));
    setMagazineSettingsSaving(true);
    setMagazineSettingsError("");
    try {
      const response = await fetch("/api/magazine/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ schedulerIntervalHours: safeIntervalHours }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const nextSettings = { ...defaultMagazineSettings, ...payload };
      setMagazineSettings(nextSettings);
      await refreshMagazineStatus();
    } catch (error) {
      setMagazineSettingsError(error.message);
    } finally {
      setMagazineSettingsSaving(false);
    }
  }

  async function loadArcaNotifications({ quiet = false } = {}) {
    if (!quiet) setArcaNotificationBusy(true);
    try {
      const response = await fetch("/api/arca/notifications", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setArcaNotificationStatus({
        notificationUrl: ARCA_NOTIFICATION_URL,
        ...payload,
        count: Math.max(0, Number(payload.count || 0)),
      });
      return payload;
    } catch (error) {
      const fallbackConnected = Boolean(arcaAuthStatus?.connected || arcaNotificationStatus?.connected);
      setArcaNotificationStatus((current) => ({
        ...(current || {}),
        ok: false,
        connected: fallbackConnected,
        status: "error",
        count: 0,
        notificationUrl: current?.notificationUrl || ARCA_NOTIFICATION_URL,
        error: error.message,
        checkedAt: new Date().toISOString(),
      }));
      return null;
    } finally {
      if (!quiet) setArcaNotificationBusy(false);
    }
  }

  async function loadArcaAuthStatus({ actionLabel = "reload", quiet = false } = {}) {
    if (!quiet) {
      setArcaAuthBusy(true);
      setArcaAuthAction(actionLabel);
      setArcaAuthError("");
    }
    try {
      const response = await fetch("/api/arca/auth/status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setArcaAuthStatus(payload);
      if (!quiet) setArcaAuthError("");
      return payload;
    } catch (error) {
      if (!quiet) setArcaAuthError(error.message);
      return null;
    } finally {
      if (!quiet) {
        setArcaAuthBusy(false);
        setArcaAuthAction("");
      }
    }
  }

  async function runArcaAuthAction(actionName, endpoint, { method = "POST", confirmMessage = "" } = {}) {
    if (arcaAuthBusy) return;
    if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) return;

    setArcaAuthBusy(true);
    setArcaAuthAction(actionName);
    setArcaAuthError("");
    try {
      const response = await fetch(endpoint, {
        method,
        headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
        cache: "no-store",
        body: method === "DELETE" ? undefined : "{}",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setArcaAuthStatus(payload);
      if (actionName === "capture") {
        setBoardFilters((current) => ({ ...current }));
      }
      void loadArcaNotifications({ quiet: true });
    } catch (error) {
      setArcaAuthError(error.message);
    } finally {
      setArcaAuthBusy(false);
      setArcaAuthAction("");
    }
  }

  function startArcaLoginHandoff() {
    void runArcaAuthAction("start", "/api/arca/auth/start");
  }

  function captureArcaLoginSession() {
    void runArcaAuthAction("capture", "/api/arca/auth/capture");
  }

  function stopArcaLoginHandoff() {
    void runArcaAuthAction("stop", "/api/arca/auth/stop");
  }

  function deleteArcaLoginSession() {
    void runArcaAuthAction("delete", "/api/arca/auth/session", {
      method: "DELETE",
      confirmMessage: "저장된 아카라이브 알림 세션을 삭제할까요?",
    });
  }

  async function runWorldMemoryAction(action, options = {}) {
    if (worldMemoryActionBusy) return;
    setWorldMemoryActionBusy(true);
    setWorldMemoryError("");
    try {
      const response = await fetch("/api/world-memory/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action, ...options }),
      });
      const payload = await response.json().catch(() => ({}));
      setWorldMemoryActionResult(payload);
      if (!response.ok || !payload.ok) {
        setWorldMemoryError(payload.error || `HTTP ${response.status}`);
      }
      await loadWorldMemoryStatus();
      return payload;
    } catch (error) {
      setWorldMemoryError(error.message);
      return { ok: false, error: error.message };
    } finally {
      setWorldMemoryActionBusy(false);
    }
  }

  async function executeWorldMemoryAgentAction(proposal) {
    if (!proposal?.action || worldMemoryActionBusy) return;
    const options =
      proposal.options && typeof proposal.options === "object"
        ? proposal.options
        : proposal.params && typeof proposal.params === "object"
          ? proposal.params
          : proposal.raw?.params && typeof proposal.raw.params === "object"
            ? proposal.raw.params
            : {};
    const result = await runWorldMemoryAction(proposal.action, options);
    if (!result?.ok) return;
    if (result?.ok && worldMemoryActionsNeedingReportRefresh.has(proposal.action)) {
      await runWorldMemoryAction("refreshReport", {
        sourceAction: proposal.action,
        reason: "agent-action-applied",
      });
    }
    setWorldMemoryAgentAction(null);
    setWorldMemoryFocusedChangeSuggestion(null);
  }

  async function loadMemoryDialogRecords({ reset = false } = {}) {
    if (memoryDialogBusy) return;
    const offset = reset ? 0 : memoryDialogRecords.length;
    if (!reset && !memoryDialogHasMore) return;

    setMemoryDialogBusy(true);
    setMemoryDialogError("");
    try {
      const response = await fetch(`/api/memory?limit=${MEMORY_DIALOG_PAGE_SIZE}&offset=${offset}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const nextRecords = payload.records || [];
      setMemoryDialogTotalCount(Number(payload.recordCount || 0));
      setMemoryDialogHasMore(Boolean(payload.hasMore));
      setMemoryDialogRecords((current) => {
        const combined = reset ? nextRecords : [...current, ...nextRecords];
        const seen = new Set();
        return combined.filter((record) => {
          if (!record?.id || seen.has(record.id)) return false;
          seen.add(record.id);
          return true;
        });
      });
    } catch (error) {
      setMemoryDialogError(error.message);
    } finally {
      setMemoryDialogBusy(false);
    }
  }

  function openMemoryDialog() {
    setMemoryDialogOpen(true);
    setMemoryDialogRecords([]);
    setMemoryDialogHasMore(false);
    setMemoryDialogTotalCount(0);
    void loadMemoryDialogRecords({ reset: true });
  }

  function handleMemoryDialogScroll(event) {
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 260) {
      void loadMemoryDialogRecords({ reset: false });
    }
  }

  async function deleteMemoryRecord(record) {
    if (!record?.id || deletingMemoryRecordId) return;
    const title = record.title || "공유 작업 메모리";
    if (!window.confirm(`"${title}" 기록을 삭제할까요?`)) return;

    setDeletingMemoryRecordId(record.id);
    setMemoryError("");
    setMemoryDialogError("");
    try {
      const response = await fetch(`/api/memory?id=${encodeURIComponent(record.id)}&limit=${MEMORY_RECENT_LIMIT}&offset=0`, {
        method: "DELETE",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setMemoryStatus(payload.status || emptyMemoryStatus);
      if (memoryDialogOpen) {
        setMemoryDialogRecords([]);
        setMemoryDialogHasMore(false);
        setMemoryDialogTotalCount(0);
        await loadMemoryDialogRecords({ reset: true });
      }
    } catch (error) {
      setMemoryError(error.message);
      setMemoryDialogError(error.message);
    } finally {
      setDeletingMemoryRecordId("");
    }
  }

  async function saveSharedChatMemory({
    createdAt,
    promptText,
    answerText,
    article,
    attachments = [],
    screen,
    taskType = "chat",
    memoryScope = "system-main",
    canvas = null,
    magazineArticleContext = null,
  }) {
    const summary = memorySummaryFromExchange(promptText, answerText);
    if (!summary) return;

    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          provider: agentProvider,
          providerLabel: agentProviderLabel,
          screen,
          title: memoryTitleFromPrompt(promptText, taskType === "earning-analysis" ? "어닝 이벤트 분석" : "에이전트 채팅"),
          summary,
          tags: memoryTagsForExchange({
            screen,
            provider: agentProvider,
            article,
            attachments,
            taskType,
          }).concat(
            memoryScope === "portfolio-canvas" ? ["portfolio-canvas-memory"] : ["system-main-memory"],
            canvas?.id ? [`canvas:${canvas.id}`] : []
          ),
          artifacts: attachments.map((attachment) => attachment.name).filter(Boolean),
          messages: [
            {
              role: "user",
              text: promptText,
              createdAt: new Date(createdAt).toISOString(),
            },
            {
              role: "assistant",
              text: answerText,
              createdAt: new Date().toISOString(),
            },
          ],
          contextPacket: {
            screen,
            userIntent: trimForMemory(promptText, 260),
            selectedProvider: agentProvider,
            providerLabel: agentProviderLabel,
            memoryScope,
            canvas: canvas
              ? {
                  id: canvas.id,
                  name: canvas.name,
                }
              : null,
            attachedArticle: article
              ? {
                  title: article.title || "",
                  url: article.url || article.href || "",
                }
              : null,
            magazineArticle: magazineArticleContext
              ? {
                  id: magazineArticleContext.id || "",
                  title: magazineArticleContext.title || "",
                  topics: Array.isArray(magazineArticleContext.topics) ? magazineArticleContext.topics.slice(0, 8) : [],
                  publishedAt: magazineArticleContext.publishedAt || "",
                  publishedTimeLabel: magazineArticleContext.publishedTimeLabel || "",
                }
              : null,
            attachments: attachments.map((attachment) => ({
              name: attachment.name,
              type: attachment.type,
              size: attachment.size,
            })),
          },
          source: {
            surface: memoryScope === "portfolio-canvas" ? "portfolio-canvas-chat" : "sidebar-chat",
            screen,
            provider: agentProvider,
            providerLabel: agentProviderLabel,
            writer: agentProvider,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setMemoryStatus(payload.status || emptyMemoryStatus);
      setMemoryError("");
    } catch (error) {
      setMemoryError(error.message);
    }
  }

  async function refreshNewsFeedStatus() {
    try {
      const response = await fetch("/api/news-feed/status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setNewsFeedStatus((current) =>
        payload.collector || payload.feeds
          ? payload
          : {
              ...(current || {}),
              itemCount: payload.itemCount,
              offset: payload.offset,
              limit: payload.limit,
              hasMore: payload.hasMore,
            }
      );
    } catch {
      // Settings toggles should still succeed even if the status probe is momentarily stale.
    }
  }

  async function markNewsFeedOpened() {
    try {
      const response = await fetch("/api/news-feed/read-state", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setNewsFeedStatus(payload);
      return payload;
    } catch {
      return null;
    }
  }

  function applyMagazineCatalogPayload(payload) {
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];
    setMagazineCatalog({
      articles,
      coverStories: Array.isArray(payload?.coverStories) ? payload.coverStories : [],
      topicCatalog: Array.isArray(payload?.topicCatalog) ? payload.topicCatalog : [],
    });
    setMagazineStatus((current) => ({
      ...(current || {}),
      ok: payload?.ok !== false,
      storage: payload?.storage || current?.storage || "files",
      articleCount: articles.length,
      readState: payload?.readState || current?.readState || null,
      settings: payload?.settings || current?.settings || null,
      scheduler: payload?.scheduler || current?.scheduler || null,
    }));
    if (payload?.settings) {
      setMagazineSettings({ ...defaultMagazineSettings, ...payload.settings });
    }
  }

  async function refreshMagazineCatalog({ signal } = {}) {
    const response = await fetch("/api/magazine/articles", {
      cache: "no-store",
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    applyMagazineCatalogPayload(payload);
    return payload;
  }

  async function refreshMagazineStatus({ signal } = {}) {
    const response = await fetch("/api/magazine/status", {
      cache: "no-store",
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    setMagazineStatus(payload);
    if (payload?.settings) {
      setMagazineSettings({ ...defaultMagazineSettings, ...payload.settings });
    }
    return payload;
  }

  async function markMagazineOpened() {
    try {
      const response = await fetch("/api/magazine/read-state", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setMagazineStatus(payload);
      return payload;
    } catch {
      return null;
    }
  }

  async function startMagazineNow() {
    if (magazineStartNowBusy || magazineSchedulerIsActive(magazineStatus)) return;
    setMagazineStartNowBusy(true);
    try {
      const response = await fetch("/api/magazine/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "runNow" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setMagazineStatus(payload);
      if (payload?.settings) {
        setMagazineSettings({ ...defaultMagazineSettings, ...payload.settings });
      }
    } catch (error) {
      setMagazineStatus((current) => ({
        ...(current || {}),
        ok: false,
        error: error.message,
      }));
      if (/cycle is active|already running/i.test(error.message || "")) {
        void refreshMagazineStatus().catch(() => {});
      }
    } finally {
      setMagazineStartNowBusy(false);
    }
  }

  async function generateOneMagazineArticle() {
    if (magazineGenerateOneBusy || magazineStartNowBusy || magazineSchedulerIsActive(magazineStatus)) return;
    setMagazineGenerateOneBusy(true);
    try {
      const response = await fetch("/api/magazine/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "generateWithCodex",
          count: 1,
          replace: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      applyMagazineCatalogPayload(payload);
      void refreshMagazineStatus().catch(() => {});
    } catch (error) {
      setMagazineStatus((current) => ({
        ...(current || {}),
        ok: false,
        error: error.message,
      }));
      if (/cycle is active|already running|generation is already running/i.test(error.message || "")) {
        void refreshMagazineStatus().catch(() => {});
      }
    } finally {
      setMagazineGenerateOneBusy(false);
    }
  }

  async function toggleNewsFeedSource(feedId, enabled) {
    setNewsFeedSettingsSavingId(feedId);
    setNewsFeedSettingsError("");
    try {
      const response = await fetch("/api/news-feed/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ feedId, enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setNewsFeedSettings(payload);
      await refreshNewsFeedStatus();
      if (activeView === "news-feed") {
        await loadNewsFeedItems({ reset: true });
      }
    } catch (error) {
      setNewsFeedSettingsError(error.message);
    } finally {
      setNewsFeedSettingsSavingId("");
    }
  }

  async function updateNewsFeedPollInterval(pollIntervalSeconds) {
    setNewsFeedSettingsSavingId("poll-interval");
    setNewsFeedSettingsError("");
    try {
      const response = await fetch("/api/news-feed/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ pollIntervalSeconds }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setNewsFeedSettings(payload);
      await refreshNewsFeedStatus();
    } catch (error) {
      setNewsFeedSettingsError(error.message);
    } finally {
      setNewsFeedSettingsSavingId("");
    }
  }

  async function refreshNewsFeed() {
    setNewsFeedBusy(true);
    setNewsFeedError("");
    try {
      const response = await fetch("/api/news-feed/refresh", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setNewsFeedStatus(payload);
      setNewsFeedItems(payload.items || []);
      setNewsFeedHasMore(Boolean(payload.hasMore));
    } catch (error) {
      setNewsFeedError(error.message);
    } finally {
      setNewsFeedBusy(false);
    }
  }

  function handleNewsFeedScroll(event) {
    if (activeView !== "news-feed" || newsFeedBusy || newsFeedLoadingMore || !newsFeedHasMore) return;
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 420) {
      void loadNewsFeedItems({ reset: false });
    }
  }

  function submitBoardSearch(event) {
    event.preventDefault();
    updateBoardFilters({ keyword: boardSearchInput.trim(), page: 1 });
  }

  async function attachArticleContext(row) {
    if (!row?.href || attachingArticleHref) return;
    setAttachingArticleHref(row.href);
    try {
      const response = await fetch(`/api/arca/article?url=${encodeURIComponent(row.href)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        const issueMessage = payload.issues?.[0]?.message || payload.error || `HTTP ${response.status}`;
        throw new Error(issueMessage);
      }
      setAttachedArticle({
        ...payload.article,
        id: row.id,
        number: row.number,
        title: payload.article?.title || row.title,
        author: payload.article?.author || row.author,
        url: payload.article?.url || row.href,
        href: row.href,
      });
      promptRef.current?.focus();
    } catch (error) {
      setAttachedArticle({
        id: row.id,
        number: row.number,
        title: row.title,
        author: row.author,
        url: row.href,
        href: row.href,
        error: `본문을 가져오지 못했습니다: ${error.message}`,
      });
    } finally {
      setAttachingArticleHref("");
    }
  }

  async function addChatAttachmentFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((file) => file && typeof file.size === "number");
    if (!incoming.length) return;

    setAttachmentError("");
    const remainingSlots = MAX_CHAT_ATTACHMENTS - chatAttachments.length;
    if (remainingSlots <= 0) {
      setAttachmentError(`첨부는 최대 ${MAX_CHAT_ATTACHMENTS}개까지 가능합니다.`);
      return;
    }

    const accepted = [];
    const rejected = [];
    let totalBytes = chatAttachments.reduce((sum, item) => sum + Number(item.size || 0), 0);

    for (const file of incoming.slice(0, remainingSlots)) {
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        rejected.push(`${file.name || "파일"}: ${formatFileSize(MAX_CHAT_ATTACHMENT_BYTES)} 초과`);
        continue;
      }
      if (totalBytes + file.size > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
        rejected.push(`${file.name || "파일"}: 전체 ${formatFileSize(MAX_CHAT_ATTACHMENT_TOTAL_BYTES)} 제한 초과`);
        continue;
      }
      accepted.push(file);
      totalBytes += file.size;
    }

    if (incoming.length > remainingSlots) {
      rejected.push(`최대 ${MAX_CHAT_ATTACHMENTS}개 제한으로 ${incoming.length - remainingSlots}개 제외`);
    }

    if (rejected.length) {
      setAttachmentError(rejected.join(" / "));
    }
    if (!accepted.length) return;

    try {
      const nextAttachments = await Promise.all(accepted.map(fileToChatAttachment));
      setChatAttachments((current) => [...current, ...nextAttachments].slice(0, MAX_CHAT_ATTACHMENTS));
      promptRef.current?.focus();
    } catch (error) {
      setAttachmentError(error.message || "첨부 파일을 읽지 못했습니다.");
    }
  }

  function removeChatAttachment(id) {
    setChatAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setAttachmentError("");
  }

  function hasFileTransfer(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function handleComposerDragEnter(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    setIsComposerDragging(true);
  }

  function handleComposerDragOver(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsComposerDragging(true);
  }

  function handleComposerDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsComposerDragging(false);
  }

  function handleComposerDrop(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    setIsComposerDragging(false);
    void addChatAttachmentFiles(event.dataTransfer.files);
  }

  function handleComposerPaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    void addChatAttachmentFiles(files);
  }

  async function refreshAgentOptions({ isCancelled = () => false } = {}) {
    try {
      const response = await fetch("/api/codex/options", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (isCancelled()) return;

      const nextProviderOptions = payload.providers?.length ? payload.providers : fallbackProviderOptions;
      const nextApprovalOptions = payload.approvalOptions?.length
        ? payload.approvalOptions
        : fallbackApprovalOptions;
      const nextModelGroups = payload.modelGroups?.length ? payload.modelGroups : fallbackModelGroups;
      const nextAntigravityModelGroups = modelGroupsFromAntigravityCatalog(payload.antigravityModelCatalog);
      const nextAgentSettings = payload.agentSettings?.settings || emptyAgentSettings;
      const selectedProviderFromSettings = payload.selected?.provider || nextAgentSettings.selectedProvider;
      const nextProvider = nextProviderOptions.some((item) => item.id === selectedProviderFromSettings)
        ? selectedProviderFromSettings
        : nextProviderOptions.some((item) => item.id === payload.selected?.provider)
          ? payload.selected.provider
          : "codex-cli";
      const nextSelection = selectionForProvider(
        nextProvider,
        payload.selected || nextAgentSettings.providers?.[nextProvider] || {},
        nextModelGroups,
        nextAntigravityModelGroups,
        nextApprovalOptions
      );

      setProviderOptions(nextProviderOptions);
      setAgentProvider(nextProvider);
      setApprovalOptions(nextApprovalOptions);
      setModelGroups(nextModelGroups);
      setAntigravityCatalogGroups(nextAntigravityModelGroups);
      setAgentUserSettings(nextAgentSettings);
      setPersonaMode(nextAgentSettings.personaMode || "none");
      applyAgentSelection(nextSelection);
      setAgentOptionsReady(true);
      setCodexStatus({
        available: Boolean(payload.codex?.available),
        label: payload.codex?.available
          ? "Codex CLI 연결됨"
          : payload.codex?.error || "Codex CLI 연결 실패",
        commandPreview: "",
      });
    } catch (error) {
      if (isCancelled()) return;
      setCodexStatus({
        available: false,
        label: `Codex CLI probe 실패: ${error.message}`,
        commandPreview: "",
      });
      setAgentOptionsReady(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void refreshAgentOptions({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadSharedMemoryStatus();
  }, []);

  useEffect(() => {
    void loadWorldMemorySettings({ quiet: true });
    void loadMagazineSettings({ quiet: true });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshMagazineCatalog({ signal: controller.signal }).catch((error) => {
      if (error.name !== "AbortError") {
        console.warn("Magazine catalog load failed", error);
      }
    });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadMagazinePreferences() {
      try {
        const response = await fetch("/api/magazine/preferences", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload?.ok) throw new Error(payload?.error || "매거진 편집 선호를 읽을 수 없습니다.");
        setMagazinePreferenceStore(payload);
      } catch (error) {
        if (error.name !== "AbortError") {
          console.warn("Magazine preferences load failed", error);
        }
      }
    }
    void loadMagazinePreferences();
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!magazineActiveArticle?.id) return undefined;
    const controller = new AbortController();
    async function loadMagazineComments() {
      try {
        const response = await fetch(`/api/magazine/comments?articleId=${encodeURIComponent(magazineActiveArticle.id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload?.ok) throw new Error(payload?.error || "매거진 댓글을 읽을 수 없습니다.");
        setMagazineCommentStore(normalizeMagazineCommentStore(payload, magazineActiveArticle.id));
      } catch (error) {
        if (error.name !== "AbortError") {
          console.warn("Magazine comments load failed", error);
          setMagazineCommentError(error.message);
        }
      }
    }
    void loadMagazineComments();
    return () => {
      controller.abort();
    };
  }, [magazineActiveArticle?.id]);

  useEffect(() => {
    if (!magazinePreferenceNotice) return undefined;
    setMagazinePreferenceNoticeFading(false);
    const fadeTimeoutId = window.setTimeout(() => {
      setMagazinePreferenceNoticeFading(true);
    }, 2000);
    const clearTimeoutId = window.setTimeout(() => {
      setMagazinePreferenceNotice("");
      setMagazinePreferenceNoticeFading(false);
    }, 2800);
    return () => {
      window.clearTimeout(fadeTimeoutId);
      window.clearTimeout(clearTimeoutId);
    };
  }, [magazinePreferenceNotice]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "magazine") {
      setMagazineActiveArticle(null);
      setMagazineActiveTopic("");
    }
  }, [activeView]);

  useEffect(() => {
    if (magazineActiveTopic && !magazineActiveTopicEntry) {
      setMagazineActiveTopic("");
    }
  }, [magazineActiveTopic, magazineActiveTopicEntry]);

  useEffect(() => {
    if (activeView !== "magazine" || (!magazineActiveArticle && !magazineActiveTopic)) return undefined;

    function handleMagazineReaderKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (magazineDeleteDialogOpen) {
        closeMagazineDeleteDialog();
        return;
      }
      if (magazineActiveArticle) {
        closeMagazineArticle();
        return;
      }
      closeMagazineTopic();
    }

    window.addEventListener("keydown", handleMagazineReaderKeyDown);
    return () => {
      window.removeEventListener("keydown", handleMagazineReaderKeyDown);
    };
  }, [activeView, closeMagazineArticle, closeMagazineDeleteDialog, closeMagazineTopic, magazineActiveArticle, magazineActiveTopic, magazineDeleteDialogOpen]);

  useEffect(() => {
    portfolioCanvasStoreRef.current = portfolioCanvasStore;
    writeStoredPortfolioCanvasStore(portfolioCanvasStore);
  }, [portfolioCanvasStore]);

  useEffect(() => {
    let cancelled = false;
    const browserStoreAtBoot = readStoredPortfolioCanvasStore();

    async function hydratePortfolioCanvasStore() {
      try {
        const payload = await loadPortfolioCanvasStoreFile();
        if (cancelled) return;
        const fileStore = normalizePortfolioCanvasStore(payload.store);
        const currentStore = normalizePortfolioCanvasStore(portfolioCanvasStoreRef.current);
        const userChangedBeforeHydration =
          portfolioCanvasStoreHasCanvases(currentStore) &&
          JSON.stringify(currentStore) !== JSON.stringify(normalizePortfolioCanvasStore(browserStoreAtBoot));
        const browserStore = portfolioCanvasStoreHasCanvases(currentStore) ? currentStore : browserStoreAtBoot;
        const nextStore =
          userChangedBeforeHydration || !portfolioCanvasStoreHasCanvases(fileStore)
            ? browserStore
            : fileStore;

        if (portfolioCanvasStoreHasCanvases(nextStore) || portfolioCanvasStoreHasCanvases(fileStore)) {
          setPortfolioCanvasStore(normalizePortfolioCanvasStore(nextStore));
          writeStoredPortfolioCanvasStore(nextStore);
        }
        portfolioCanvasFileReadyRef.current = true;

        if (
          portfolioCanvasStoreHasCanvases(nextStore) &&
          (userChangedBeforeHydration || !portfolioCanvasStoreHasCanvases(fileStore) || payload.source === "backup")
        ) {
          void savePortfolioCanvasStoreFile(nextStore).catch(() => {});
        }
      } catch {
        if (!cancelled) {
          portfolioCanvasFileReadyRef.current = false;
        }
      }
    }

    void hydratePortfolioCanvasStore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!portfolioCanvasFileReadyRef.current) return;
    const nextStore = normalizePortfolioCanvasStore(portfolioCanvasStore);
    const timer = window.setTimeout(() => {
      void savePortfolioCanvasStoreFile(nextStore).catch(() => {});
    }, PORTFOLIO_CANVAS_FILE_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [portfolioCanvasStore]);

  useEffect(() => {
    newsFeedItemsCountRef.current = newsFeedItems.length;
  }, [newsFeedItems.length]);

  useEffect(() => {
    newsFeedLatestTranslatedAtRef.current = newsFeedStatus?.readState?.latestTranslatedAt || "";
  }, [newsFeedStatus?.readState?.latestTranslatedAt]);

  useEffect(() => {
    magazineArticleCountRef.current = Number(
      magazineStatus?.articleCount || magazineCatalog?.articles?.length || 0
    );
  }, [magazineCatalog?.articles?.length, magazineStatus?.articleCount]);

  useEffect(() => {
    magazineLatestArticleAtRef.current = magazineStatus?.readState?.latestArticleAt || "";
  }, [magazineStatus?.readState?.latestArticleAt]);

  useEffect(() => {
    let cancelled = false;

    async function pollNewsFeedStatus() {
      try {
        const response = await fetch("/api/news-feed/status", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        if (cancelled) return;
        const latestTranslatedAt = payload.readState?.latestTranslatedAt || "";
        setNewsFeedStatus(payload);

        if (
          activeViewRef.current === "news-feed" &&
          (Number(payload.itemCount || 0) !== newsFeedItemsCountRef.current ||
            latestTranslatedAt !== newsFeedLatestTranslatedAtRef.current)
        ) {
          const itemsResponse = await fetch(`/api/news-feed/items?limit=${NEWS_FEED_PAGE_SIZE}&offset=0`, {
            cache: "no-store",
          });
          const itemsPayload = await itemsResponse.json().catch(() => ({}));
          if (!cancelled && itemsResponse.ok && itemsPayload.ok) {
            setNewsFeedStatus((current) => ({
              ...(current || {}),
              itemCount: itemsPayload.itemCount,
              readState: itemsPayload.readState || current?.readState,
              offset: itemsPayload.offset,
              limit: itemsPayload.limit,
              hasMore: itemsPayload.hasMore,
            }));
            setNewsFeedHasMore(Boolean(itemsPayload.hasMore));
            setNewsFeedItems(itemsPayload.items || []);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setNewsFeedStatus((current) => ({
            ...(current || {}),
            collector: {
              ...(current?.collector || {}),
              healthy: false,
              lastError: error.message,
            },
          }));
        }
      }
    }

    pollNewsFeedStatus();
    const timer = window.setInterval(pollNewsFeedStatus, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollMagazineStatus() {
      try {
        const payload = await refreshMagazineStatus();
        if (cancelled) return;
        const nextArticleCount = Number(payload.articleCount || 0);
        const nextLatestArticleAt = payload.readState?.latestArticleAt || "";
        const catalogChanged =
          nextArticleCount !== magazineArticleCountRef.current ||
          nextLatestArticleAt !== magazineLatestArticleAtRef.current;
        if (catalogChanged && activeViewRef.current === "magazine") {
          await refreshMagazineCatalog();
        }
      } catch (error) {
        if (!cancelled) {
          setMagazineStatus((current) => ({
            ...(current || {}),
            ok: false,
            error: error.message,
          }));
        }
      }
    }

    void pollMagazineStatus();
    const timer = window.setInterval(pollMagazineStatus, MAGAZINE_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollArcaNotifications() {
      try {
        const response = await fetch("/api/arca/notifications", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        if (cancelled) return;
        setArcaNotificationStatus({
          notificationUrl: ARCA_NOTIFICATION_URL,
          ...payload,
          count: Math.max(0, Number(payload.count || 0)),
        });
      } catch (error) {
        if (cancelled) return;
        setArcaNotificationStatus((current) => ({
          ...(current || {}),
          ok: false,
          connected: Boolean(current?.connected),
          status: "error",
          count: 0,
          notificationUrl: current?.notificationUrl || ARCA_NOTIFICATION_URL,
          error: error.message,
          checkedAt: new Date().toISOString(),
        }));
      }
    }

    pollArcaNotifications();
    const timer = window.setInterval(pollArcaNotifications, ARCA_NOTIFICATION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (activeView !== "news-feed") return;
    let cancelled = false;

    async function openNewsFeed() {
      await markNewsFeedOpened();
      if (cancelled) return;
      await loadNewsFeedItems({ reset: true });
      if (!cancelled) {
        void refreshNewsFeedStatus();
      }
    }

    void openNewsFeed();
    return () => {
      cancelled = true;
    };
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "magazine") return;
    let cancelled = false;

    async function openMagazine() {
      await markMagazineOpened();
      if (cancelled) return;
      try {
        await refreshMagazineCatalog();
      } catch (error) {
        if (error.name !== "AbortError") {
          console.warn("Magazine catalog refresh failed", error);
        }
      }
      if (!cancelled) {
        void refreshMagazineStatus().catch(() => {});
      }
    }

    void openMagazine();
    return () => {
      cancelled = true;
    };
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "settings") return;
    void loadNewsFeedSettings();
    void loadSharedMemoryStatus();
    void loadWorldMemorySettings({ refreshStatus: true });
    void loadMagazineSettings({ quiet: true });
    void loadArcaAuthStatus({ quiet: true });
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "world-memory") return;
    if (!worldMemoryEnabled) {
      setActiveView("stock");
      return;
    }
    void loadWorldMemoryStatus();
  }, [activeView, worldMemoryEnabled]);

  useEffect(() => {
    if (activeView === "magazine" && !magazineEnabled) {
      setActiveView("stock");
    }
  }, [activeView, magazineEnabled]);

  useEffect(() => {
    let cancelled = false;

    async function loadArcaBoard() {
      setArcaBoardBusy(true);
      setArcaBoardError("");
      try {
        const response = await fetch("/api/arca/articles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(boardFilters),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok && !payload.issues?.length) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        if (cancelled) return;
        setArcaBoard(payload);
        if (!payload.ok && payload.issues?.length) {
          setArcaBoardError(payload.issues.map((item) => item.message).join(" / "));
        }
      } catch (error) {
        if (cancelled) return;
        setArcaBoardError(error.message);
      } finally {
        if (!cancelled) setArcaBoardBusy(false);
      }
    }

    loadArcaBoard();
    return () => {
      cancelled = true;
    };
  }, [boardFilters]);

  useEffect(() => {
    if (!reasoningOptions.some((item) => item.id === reasoning)) {
      setReasoning(selectedModelGroup.defaultReasoningLevel || reasoningOptions[0]?.id || "medium");
    }
    if (speedOptions.length && !speedOptions.some((item) => item.id === speed)) {
      setSpeed("standard");
    }
    if (!speedOptions.length && speed !== "standard") {
      setSpeed("standard");
    }
  }, [reasoning, reasoningOptions, selectedModelGroup, speed, speedOptions]);

  useEffect(() => {
    const stack = messageStackRef.current;
    if (!stack) return;
    stack.scrollTop = stack.scrollHeight;
  }, [visibleChatMessages]);

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, MIN_PROMPT_HEIGHT),
      MAX_PROMPT_HEIGHT
    );
    setPromptHeight(nextHeight);
    setPromptOverflow(textarea.scrollHeight > MAX_PROMPT_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
  }, [prompt]);

  const commandPreview = useMemo(() => {
    if (!agentOptionsReady) {
      return "에이전트 설정 불러오는 중";
    }
    if (agentProvider === ANTIGRAVITY_PROVIDER_ID) {
      return selectedProvider?.available
        ? `agy --model "${selectedModelGroup?.slug || "Gemini 3.5 Flash (Medium)"}" · ${selectedApproval?.label || "Default"}`
        : selectedProvider?.installCommand || "curl -fsSL https://antigravity.google/cli/install.sh | bash";
    }
    const approvalFlag = selectedApproval?.cli || "";
    const modelFlag = selectedModelGroup?.slug ? `-m ${selectedModelGroup.slug}` : "";
    const reasoningFlag = selectedReasoning?.cli || "";
    const speedHint =
      selectedSpeed && selectedSpeed.id !== "standard"
        ? `[speed: ${selectedSpeed.label}${selectedSpeed.pending ? " · CLI config 확인 필요" : ""}]`
        : "";
    return ["codex", approvalFlag, modelFlag, reasoningFlag, speedHint].filter(Boolean).join(" ");
  }, [agentOptionsReady, agentProvider, selectedProvider, selectedApproval, selectedModelGroup, selectedReasoning, selectedSpeed]);

  function buildPendingAssistant(id, runtime = providerRuntimeForProvider(agentProvider)) {
    return {
      id,
      role: "assistant",
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
      blocks: [
        {
          type: "status",
          tone: "working",
          title: `${runtime.providerLabel} 응답 준비 중`,
          body:
            runtime.provider === ANTIGRAVITY_PROVIDER_ID
              ? `${runtime.selectedModelGroup?.label || "Gemini"} 모델에 대화 컨텍스트를 전달하고 있습니다.`
              : `${runtime.modelSummaryLabel} 모델을 읽기 전용 Codex CLI 세션으로 호출하고 있습니다.`,
        },
      ],
      providerLabel: runtime.providerLabel,
    };
  }

  function updateAssistantMessage(id, { status, text, extraBlocks = [] }, scope = { type: "system-main", canvasId: "" }) {
    updateChatMessagesForScope(scope, (messages) =>
      messages.map((message) => {
        if (message.id !== id) return message;
        const blocks = status ? [status] : [];
        if (text) {
          blocks.push({ type: "paragraph", text });
        }
        if (Array.isArray(extraBlocks) && extraBlocks.length) {
          blocks.push(...extraBlocks);
        }
        return { ...message, blocks };
      })
    );
  }

  function queuePortfolioWidgetActionFromAnswer(answer, request = {}) {
    const parsedAction = parsePortfolioWidgetJsonAction(answer);
    const requestWidgetId = request?.widget?.id || request?.widgetId || "";
    if (!parsedAction && !requestWidgetId) return false;
    const actionName = String(parsedAction?.action || parsedAction?.actionId || request?.action || "").toLowerCase();
    const looksLikeWidgetAction =
      Boolean(requestWidgetId) ||
      Boolean(parsedAction?.widget) ||
      Boolean(parsedAction?.widgetId) ||
      Boolean(parsedAction?.targetWidgetId) ||
      Boolean(parsedAction?.actionId) ||
      Boolean(parsedAction?.dataset || parsedAction?.data || parsedAction?.holdings || parsedAction?.chartSpec || parsedAction?.chart || parsedAction?.functionSpec || parsedAction?.strategySpec || parsedAction?.rules || parsedAction?.dataFiles || parsedAction?.dataSources || parsedAction?.files || parsedAction?.attachments || parsedAction?.metrics || parsedAction?.standardMetrics) ||
      /widget|delete|remove|artifact|chart|pie|allocation|function|strategy|signal|render_portfolio_artifact|import_holdings|refresh_canvas_latest_data|request_backtest_matrix_context|retrieve_backtest_matrix_context|get_backtest_matrix_context|load_backtest_matrix_context/.test(actionName);
    if (!looksLikeWidgetAction) return false;
    setPortfolioWidgetAgentAction({
      id: `portfolio_widget_action_${Date.now()}`,
      canvasId: parsedAction?.canvasId || request?.canvasId || "",
      widgetId: parsedAction?.widgetId || parsedAction?.targetWidgetId || parsedAction?.widget?.id || requestWidgetId,
      request,
      answer,
      receivedAt: new Date().toISOString(),
    });
    return true;
  }

  function stopActiveChatResponse() {
    activeChatAbortRef.current?.abort();
  }

  async function saveReportArtifactAction(action, request = {}) {
    if (!action?.artifact?.title || !action?.artifact?.content) return null;
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        action: action.action,
        classification: action.classification,
        artifact: action.artifact,
        source: {
          surface: "reports-sidebar-agent",
          screen: request.screen || "reports",
          prompt: request.promptText || "",
          provider: agentProvider,
          providerLabel: agentProviderLabel,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    setReportRefreshSignal((current) => current + 1);
    return payload;
  }

  async function sendPrompt(rawOptions = {}) {
    const options = rawOptions && typeof rawOptions === "object" && !("nativeEvent" in rawOptions) ? rawOptions : {};
    const overridePromptText = typeof options.promptText === "string" ? options.promptText : "";
    const hasOverridePrompt = Boolean(overridePromptText);
    const trimmed = (hasOverridePrompt ? overridePromptText : prompt).trim();
    const attachmentsForMessage = Array.isArray(options.attachments)
      ? options.attachments
      : hasOverridePrompt
        ? []
        : chatAttachments;
    if (!agentOptionsReady || (!trimmed && !attachmentsForMessage.length) || isSending) return false;
    const createdAt = Date.now();
    const articleForMessage = options.article === undefined ? (hasOverridePrompt ? null : attachedArticle) : options.article;
    const screenForMessage = typeof options.screen === "string" ? options.screen : activeView;
    const screenModelProviderId =
      worldMemoryEnabled && screenForMessage === "world-memory"
        ? worldMemoryManagementProviderId()
        : magazineEnabled && screenForMessage === "magazine"
          ? magazineWritingProviderId()
          : agentProvider;
    const messageProviderId = options.provider || screenModelProviderId;
    const messageRuntime = providerRuntimeForProvider(messageProviderId);
    const visibleScreenSnapshot =
      options.visibleScreenSnapshot !== undefined
        ? options.visibleScreenSnapshot
        : collectVisibleScreenSnapshot(screenForMessage);
    const requestedDisplayText =
      typeof options.displayText === "string" ? cleanPortfolioWidgetPrompt(options.displayText, 240) : "";
    const displayText = requestedDisplayText || trimmed || "첨부 파일을 확인해 주세요.";
    const promptTextForAgent = trimmed || displayText;
    const isPortfolioScreenForMessage = screenForMessage === "portfolio" || screenForMessage === "portfolio-canvas";
    const chatScope = options.chatScope || resolveChatScope(screenForMessage);
    const scopeCanvas = chatScope.type === "portfolio-canvas"
      ? portfolioCanvases.find((canvas) => canvas.id === chatScope.canvasId) || activePortfolioCanvas
      : null;
    const portfolioContextForMessage =
      options.portfolioContext !== undefined
        ? options.portfolioContext
        : isPortfolioScreenForMessage
          ? portfolioContext
          : null;
    const promptWithContext = [
      buildPromptWithArticleContext(promptTextForAgent, articleForMessage),
      isPortfolioScreenForMessage
        ? buildPortfolioChatActionInstructions(portfolioContextForMessage, {
            modeMeta: portfolioCanvasModeMeta(portfolioContextForMessage?.portfolioMode || portfolioContextForMessage?.canvas?.mode),
            assetCanvasModeId: PORTFOLIO_CANVAS_MODES.asset.id,
          })
        : "",
      attachmentsSummary(attachmentsForMessage),
    ].filter(Boolean).join("\n\n");
    const boardIndexContext =
      screenForMessage === "stock" && !articleForMessage
        ? buildBoardIndexContextSnapshot(arcaBoard, boardFilters, {
            activeCategoryLabel,
            busy: arcaBoardBusy,
            error: arcaBoardError,
            showHiddenNotices,
          })
        : null;
    const calendarContext =
      screenForMessage === "earning-calendar"
        ? earningCalendarContext
        : screenForMessage === "economic-calendar"
          ? economicCalendarContext
          : null;
    const worldMemoryContext =
      options.worldMemoryContext !== undefined
        ? options.worldMemoryContext
        : worldMemoryEnabled && screenForMessage === "world-memory"
          ? buildWorldMemoryPageContextSnapshot(worldMemoryStatus, worldMemoryActionResult, worldMemoryFocusedChangeSuggestion)
          : null;
    const magazineArticleContextForMessage =
      options.magazineArticleContext !== undefined
        ? options.magazineArticleContext
        : screenForMessage === "magazine" && magazineActiveArticle
          ? buildMagazineArticleAgentContext(magazineActiveArticle)
          : null;
    const userMessage = {
      id: `user-${createdAt}`,
      role: "user",
      text: displayText,
      article: articleForMessage,
      attachments: attachmentsForMessage,
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    };
    const assistantId = `assistant-${createdAt}`;
    const history = chatMessagesForScope(chatScope).map((message) => ({
      role: message.role,
      text: messageToHistoryText(message),
    }));

    updateChatMessagesForScope(chatScope, (messages) => [...messages, userMessage, buildPendingAssistant(assistantId, messageRuntime)]);
    if (!hasOverridePrompt || options.clearComposerOnSend) {
      setPrompt("");
      setAttachedArticle(null);
      setChatAttachments([]);
    }
    setAttachmentError("");
    setIsSending(true);

    let completedAnswer = "";
    let streamedText = "";
    let visibleAssistantTextForCatch = (text) => text;
    let flushAssistantMessageStream = () => {};
    const abortController = new AbortController();
    activeChatAbortRef.current = abortController;
    const includeWorldMemoryPageContext =
      options.includeWorldMemoryContext !== undefined
        ? Boolean(options.includeWorldMemoryContext)
        : worldMemoryEnabled && screenForMessage === "world-memory";
    const includeWorldMemorySearchContext =
      options.includeWorldMemorySearchContext !== undefined
        ? Boolean(options.includeWorldMemorySearchContext)
        : worldMemoryEnabled;
    const includeNewsFeedSearchContext =
      options.includeNewsFeedSearchContext !== undefined ? Boolean(options.includeNewsFeedSearchContext) : true;

    try {
      const response = await fetch("/api/codex/chat/stream", {
        method: "POST",
        signal: abortController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptWithContext,
          messages: history,
          provider: messageRuntime.provider,
          model: messageRuntime.selectedModelGroup?.slug,
          reasoning: messageRuntime.selectedReasoning?.id,
          approval: messageRuntime.selectedApproval?.id,
          personaMode:
            options.disablePersonaMode || !personaEligibleScreens.has(screenForMessage)
              ? "none"
              : personaMode,
          screen: screenForMessage,
          includeWorldMemoryContext: includeWorldMemoryPageContext,
          includeWorldMemorySnapshotContext: Boolean(options.includeWorldMemorySnapshotContext),
          includeWorldMemorySearchContext,
          worldMemoryContext,
          forceWorldMemoryVectorSearch: worldMemoryEnabled && Boolean(options.forceWorldMemoryVectorSearch),
          worldMemoryVectorSearchQuery: options.worldMemoryVectorSearchQuery || "",
          worldMemoryFocusContext: options.worldMemoryFocusContext || null,
          requireWebSearch: Boolean(options.requireWebSearch),
          includeReportCatalog:
            options.includeReportCatalog !== undefined
              ? Boolean(options.includeReportCatalog)
              : screenForMessage === "reports",
          includeNewsFeedContext:
            options.includeNewsFeedContext !== undefined
              ? Boolean(options.includeNewsFeedContext)
              : screenForMessage === "news-feed",
          includeNewsFeedSearchContext,
          includeSharedMemory: chatScope.type !== "portfolio-canvas",
          memoryScope: chatScope.type,
          canvasId: scopeCanvas?.id || "",
          canvasTitle: scopeCanvas?.name || "",
          boardContext: boardIndexContext,
          calendarContext,
          magazineArticleContext: magazineArticleContextForMessage,
          portfolioContext: portfolioContextForMessage,
          visibleScreenSnapshot,
          attachments: attachmentsForMessage.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
            dataUrl: attachment.dataUrl,
            text: attachment.text || "",
          })),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error("Streaming response body is unavailable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const shouldStripPortfolioWidgetAction = options.stripPortfolioWidgetActionBlocks || isPortfolioScreenForMessage;
      const shouldStripWorldMemoryAction = screenForMessage === "world-memory";
      const shouldStripReportArtifactAction = screenForMessage === "reports";
      const visibleAssistantText = (text) => {
        let output = shouldStripPortfolioWidgetAction ? stripPortfolioWidgetActionBlocks(text) : text;
        if (shouldStripWorldMemoryAction) output = stripWorldMemoryActionBlocks(output);
        if (shouldStripReportArtifactAction) output = stripReportArtifactBlocks(output);
        return output;
      };
      visibleAssistantTextForCatch = visibleAssistantText;
      let streamRenderTimer = null;
      let lastStreamRenderAt = 0;
      const renderAssistantStreamText = ({ immediate = false } = {}) => {
        const render = () => {
          if (streamRenderTimer) {
            window.clearTimeout(streamRenderTimer);
            streamRenderTimer = null;
          }
          lastStreamRenderAt = Date.now();
          updateAssistantMessage(assistantId, { status: latestStatus, text: visibleAssistantText(streamedText) }, chatScope);
        };
        if (immediate) {
          render();
          return;
        }
        const waitMs = CHAT_STREAM_RENDER_INTERVAL_MS - (Date.now() - lastStreamRenderAt);
        if (waitMs <= 0) {
          render();
          return;
        }
        if (!streamRenderTimer) {
          streamRenderTimer = window.setTimeout(render, waitMs);
        }
      };
      flushAssistantMessageStream = () => renderAssistantStreamText({ immediate: true });
      let latestStatus = {
        type: "status",
        tone: "working",
        title: `${messageRuntime.providerLabel} 응답 준비 중`,
        body:
          messageRuntime.provider === ANTIGRAVITY_PROVIDER_ID
            ? `${messageRuntime.selectedModelGroup?.label || "Gemini"} · ${messageRuntime.selectedApproval?.label || "Default"} 권한으로 대화 컨텍스트를 전달하고 있습니다.`
            : `${messageRuntime.modelSummaryLabel} 모델을 읽기 전용 Codex CLI 세션으로 호출하고 있습니다.`,
      };
      let firstAssistantTokenSeen = false;
      const notifyFirstAssistantToken = () => {
        if (firstAssistantTokenSeen) return;
        firstAssistantTokenSeen = true;
        if (typeof options.onFirstDelta === "function") {
          options.onFirstDelta();
        }
      };

      function applyStreamEvent(event) {
        const data = event.data || {};
        if (event.type === "started") {
          const providerName = data.providerLabel || messageRuntime.providerLabel;
          latestStatus = {
            type: "status",
            tone: "working",
            title: `${providerName} 세션 시작`,
            body: [
              data.model || messageRuntime.selectedModelGroup?.slug,
              data.reasoning || messageRuntime.selectedReasoning?.id,
              data.approval || messageRuntime.selectedApproval?.label,
            ].filter(Boolean).join(" · "),
          };
          renderAssistantStreamText({ immediate: true });
        }
        if (event.type === "status") {
          latestStatus = {
            type: "status",
            tone: "working",
            title: data.title || `${messageRuntime.providerLabel} 응답 생성 중`,
            body: data.body || `${messageRuntime.providerLabel}가 요청을 처리하고 있습니다.`,
          };
          renderAssistantStreamText({ immediate: true });
        }
        if (event.type === "delta") {
          const deltaText = data.text || data.delta || "";
          if (deltaText) notifyFirstAssistantToken();
          streamedText += deltaText;
          renderAssistantStreamText();
        }
        if (event.type === "message") {
          if (data.text) notifyFirstAssistantToken();
          streamedText = data.text || streamedText;
          latestStatus = {
            type: "status",
            tone: "working",
            title: "응답 수신 중",
            body: `${data.providerLabel || messageRuntime.providerLabel}에서 최종 메시지를 받았습니다.`,
          };
          renderAssistantStreamText({ immediate: true });
        }
        if (event.type === "done") {
          if (data.answer || streamedText) notifyFirstAssistantToken();
          streamedText = data.answer || streamedText || "응답이 비어 있습니다.";
          latestStatus = {
            type: "status",
            tone: "done",
            title: `${data.providerLabel || messageRuntime.providerLabel} 응답`,
            body: `${data.model || messageRuntime.selectedModelGroup?.slug} · ${data.reasoning || messageRuntime.selectedReasoning?.id} · ${Math.max(1, Math.round((data.elapsedMs || 0) / 1000))}초`,
          };
          renderAssistantStreamText({ immediate: true });
        }
        if (event.type === "error") {
          throw new Error(data.error || `${messageRuntime.providerLabel} stream failed`);
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n/);
        buffer = events.pop() || "";
        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;
          applyStreamEvent(parseSseEvent(rawEvent));
        }
      }

      const tail = buffer + decoder.decode();
      if (tail.trim()) {
        applyStreamEvent(parseSseEvent(tail));
      }
      flushAssistantMessageStream();
      completedAnswer = streamedText.trim();
      if (completedAnswer) {
        let reportArtifactSaveResult = null;
        if (screenForMessage === "reports") {
          const reportArtifactAction = parseReportArtifactAction(completedAnswer);
          if (reportArtifactAction) {
            let reportArtifactSaveError = "";
            try {
              reportArtifactSaveResult = await saveReportArtifactAction(reportArtifactAction, {
                screen: screenForMessage,
                promptText: displayText,
              });
            } catch (error) {
              reportArtifactSaveError = error.message || "보고서 파일 저장에 실패했습니다.";
            }
            updateAssistantMessage(
              assistantId,
              {
                status: latestStatus,
                text: visibleAssistantText(completedAnswer),
                extraBlocks: [
                  {
                    type: "status",
                    tone: reportArtifactSaveResult ? "done" : "error",
                    title: reportArtifactSaveResult ? "보고서 저장됨" : "보고서 저장 실패",
                    body: reportArtifactSaveResult
                      ? `'${reportArtifactSaveResult.saved?.title || reportArtifactAction.artifact.title}' 보고서가 글 목록에 추가되었습니다.`
                      : reportArtifactSaveError,
                  },
                ],
              },
              chatScope
            );
          }
        }
        if (screenForMessage === "world-memory") {
          const parsedWorldMemoryAction = parseWorldMemoryJsonAction(completedAnswer);
          const proposal = parsedWorldMemoryAction
            ? normalizeWorldMemoryActionProposal(parsedWorldMemoryAction, completedAnswer)
            : null;
          if (proposal) {
            setWorldMemoryAgentAction(proposal);
            updateAssistantMessage(
              assistantId,
              {
                status: latestStatus,
                text: visibleAssistantText(completedAnswer),
                extraBlocks: [
                  {
                    type: "world-memory-action",
                    action: proposal,
                  },
                ],
              },
              chatScope
            );
          }
        }
        await saveSharedChatMemory({
          createdAt,
          promptText: displayText,
          answerText: visibleAssistantText(completedAnswer) || "에이전트 액션을 생성했습니다.",
          article: articleForMessage,
          attachments: attachmentsForMessage,
          screen: screenForMessage,
          memoryScope: chatScope.type,
          magazineArticleContext: magazineArticleContextForMessage,
          canvas: scopeCanvas
            ? {
                id: scopeCanvas.id,
                name: scopeCanvas.name,
                mode: scopeCanvas.mode,
                modeLabel: portfolioCanvasModeMeta(scopeCanvas.mode).label,
              }
            : null,
        });
        if (typeof options.onComplete === "function") {
          options.onComplete({
            answer: completedAnswer,
            report: reportArtifactSaveResult?.saved || null,
            createdAt,
            displayText,
            screen: screenForMessage,
            memoryScope: chatScope.type,
            canvas: scopeCanvas
              ? {
                  id: scopeCanvas.id,
                  name: scopeCanvas.name,
                  mode: scopeCanvas.mode,
                  modeLabel: portfolioCanvasModeMeta(scopeCanvas.mode).label,
                }
              : null,
          });
        }
        if (isPortfolioScreenForMessage && options.applyPortfolioWidgetAction !== false) {
          queuePortfolioWidgetActionFromAnswer(
            completedAnswer,
            {
              ...(options.portfolioWidgetRequest || {
                action: "chat",
                prompt: displayText,
                canvasId: scopeCanvas?.id || portfolioContextForMessage?.canvas?.id || "",
              }),
              attachments: attachmentsForMessage.map((attachment) => ({
                id: attachment.id,
                name: attachment.name,
                type: attachment.type,
                size: attachment.size,
                dataUrl: attachment.dataUrl,
                text: attachment.text || "",
                source: "chat-attachment",
                status: "attached",
              })),
            }
          );
        }
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        flushAssistantMessageStream();
        updateAssistantMessage(
          assistantId,
          {
            status: {
              type: "status",
              tone: "done",
              title: "응답 중단됨",
              body: "사용자가 에이전트 실행을 정지했습니다.",
            },
            text: visibleAssistantTextForCatch(streamedText),
          },
          chatScope
        );
        return true;
      }
      if (typeof options.onError === "function") {
        options.onError(error);
      }
      flushAssistantMessageStream();
      updateChatMessagesForScope(chatScope, (messages) =>
        messages.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                blocks: [
                  {
                    type: "status",
                    tone: "error",
                    title: `${messageRuntime.providerLabel} 호출 실패`,
                    body: error.message,
                  },
                ],
              }
            : message
        )
      );
    } finally {
      if (activeChatAbortRef.current === abortController) {
        activeChatAbortRef.current = null;
      }
      setIsSending(false);
    }
    return true;
  }

  function askWorldMemoryReportItem(section, item, extra = {}) {
    if (!worldMemoryEnabled) return;
    const request = buildWorldMemoryAskRequest(section, item, extra);
    const isMemoryChangeSuggestion = section === "memory-change";
    setWorldMemoryFocusedChangeSuggestion(isMemoryChangeSuggestion ? request.focusContext : null);
    const worldMemoryContext = {
      ...buildWorldMemoryPageContextSnapshot(
        worldMemoryStatus,
        worldMemoryActionResult,
        isMemoryChangeSuggestion ? request.focusContext : worldMemoryFocusedChangeSuggestion
      ),
      focusedReportItem: request.focusContext,
    };
    void sendPrompt({
      promptText: request.promptText,
      displayText: request.displayText,
      screen: "world-memory",
      worldMemoryContext,
      forceWorldMemoryVectorSearch: true,
      worldMemoryVectorSearchQuery: request.vectorSearchQuery,
      worldMemoryFocusContext: request.focusContext,
      requireWebSearch: request.requireWebSearch ?? true,
      includeNewsFeedContext: true,
      disablePersonaMode: isMemoryChangeSuggestion,
    });
  }

  function handleReportsBoredResearch(request = {}) {
    const displayText = request.displayText || "숨은 이슈 리서치";
    const vectorQuery = [
      request.issue?.title,
      request.issue?.signal,
      request.angle?.promptFocus,
      displayText,
    ].filter(Boolean).join(" ");
    return sendPrompt({
      promptText: request.promptText,
      displayText,
      screen: "reports",
      forceWorldMemoryVectorSearch: true,
      worldMemoryVectorSearchQuery: vectorQuery,
      includeWorldMemorySnapshotContext: true,
      includeWorldMemorySearchContext: true,
      includeNewsFeedSearchContext: true,
      includeNewsFeedContext: false,
      includeReportCatalog: true,
      requireWebSearch: true,
      disablePersonaMode: true,
      onFirstDelta: request.onFirstDelta,
      onComplete: request.onComplete,
      onError: request.onError,
    });
  }

  function handlePortfolioWidgetPromptRequest(request) {
    const requestWithId = {
      ...request,
      requestId: `portfolio_widget_request_${Date.now()}`,
      canvasId: activePortfolioCanvas?.id || "",
      canvasName: activePortfolioCanvas?.name || "",
      canvasMode: activePortfolioCanvas?.mode || PORTFOLIO_CANVAS_MODES.asset.id,
    };
    const requestAttachments = Array.isArray(requestWithId.attachments) && requestWithId.attachments.length
      ? requestWithId.attachments
      : selectPortfolioWidgetRequestAttachments({
          request: requestWithId,
          messages: activePortfolioCanvas?.chatMessages || [],
        });
    const requestWithAttachments = {
      ...requestWithId,
      attachments: requestAttachments,
    };
    const agentPrompt = buildPortfolioWidgetAgentPrompt(requestWithAttachments, {
      modeMeta: portfolioCanvasModeMeta(requestWithId.canvasMode),
      assetCanvasModeId: PORTFOLIO_CANVAS_MODES.asset.id,
    });
    const title = request?.widget?.title || (request?.source === "scenario-panel" ? "기간 및 타임프레임" : "포트폴리오 위젯");
    const displayPrefix =
      request?.source === "scenario-panel"
        ? "시나리오 설정 요청"
        : request?.source === "canvas-empty-cell"
          ? "캔버스 위젯 요청"
          : request?.action === "edit"
            ? "위젯 수정 요청"
            : "위젯 생성 요청";
    const displayText = `${displayPrefix} · ${title}`;
    if (!agentOptionsReady || isSending) {
      setPrompt(agentPrompt);
      setQueuedPortfolioWidgetRequest(requestWithAttachments);
      window.setTimeout(() => promptRef.current?.focus(), 0);
      return;
    }
    setQueuedPortfolioWidgetRequest(null);
    void sendPrompt({
      promptText: agentPrompt,
      displayText,
      attachments: requestAttachments,
      screen: "portfolio-canvas",
      clearComposerOnSend: true,
      stripPortfolioWidgetActionBlocks: true,
      portfolioWidgetRequest: requestWithAttachments,
      onError: (error) => {
        setPortfolioWidgetAgentAction({
          id: `portfolio_widget_action_${Date.now()}`,
          canvasId: requestWithAttachments.canvasId || "",
          widgetId: request?.widget?.id,
          request: requestWithAttachments,
          error: error.message,
          receivedAt: new Date().toISOString(),
        });
      },
    });
  }

  useEffect(() => {
    if (!queuedPortfolioWidgetRequest || !agentOptionsReady || isSending) return;
    const request = queuedPortfolioWidgetRequest;
    setQueuedPortfolioWidgetRequest(null);
    handlePortfolioWidgetPromptRequest(request);
  }, [queuedPortfolioWidgetRequest, agentOptionsReady, isSending]);

  async function analyzeEarningEvent(event) {
    if (!agentOptionsReady || isSending || !event) return;

    const createdAt = Date.now();
    const displayText = `${displayEarningValue(event.symbol)} 어닝 이벤트 분석`;
    const promptWithContext = buildEarningAnalysisPrompt(event);
    const userMessage = {
      id: `user-${createdAt}`,
      role: "user",
      text: displayText,
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    };
    const assistantId = `assistant-${createdAt}`;
    const history = chatMessages.map((message) => ({
      role: message.role,
      text: messageToHistoryText(message),
    }));

    setChatMessages((messages) => [...messages, userMessage, buildPendingAssistant(assistantId)]);
    setAttachmentError("");
    setIsSending(true);

    let completedAnswer = "";
    let flushEarningMessageStream = () => {};

    try {
      const response = await fetch("/api/codex/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptWithContext,
          messages: history,
          provider: agentProvider,
          model: selectedModelGroup?.slug,
          reasoning: selectedReasoning?.id,
          approval: selectedApproval?.id,
          screen: "earning-calendar",
          includeWorldMemoryContext: false,
          includeWorldMemorySearchContext: worldMemoryEnabled,
          includeNewsFeedContext: false,
          includeNewsFeedSearchContext: true,
          boardContext: null,
          calendarContext: earningCalendarContext,
          attachments: [],
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error("Streaming response body is unavailable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedText = "";
      let streamRenderTimer = null;
      let lastStreamRenderAt = 0;
      let latestStatus = {
        type: "status",
        tone: "working",
        title: `${agentProviderLabel} 어닝 분석 준비 중`,
        body:
          agentProvider === ANTIGRAVITY_PROVIDER_ID
            ? `${selectedModelGroup?.label || "Gemini"} · ${selectedApproval?.label || "Default"} 권한으로 이벤트 컨텍스트를 전달하고 있습니다.`
            : `${modelSummaryLabel} 모델을 읽기 전용 Codex CLI 세션으로 호출하고 있습니다.`,
      };
      const renderAssistantStreamText = ({ immediate = false } = {}) => {
        const render = () => {
          if (streamRenderTimer) {
            window.clearTimeout(streamRenderTimer);
            streamRenderTimer = null;
          }
          lastStreamRenderAt = Date.now();
          updateAssistantMessage(assistantId, { status: latestStatus, text: streamedText });
        };
        if (immediate) {
          render();
          return;
        }
        const waitMs = CHAT_STREAM_RENDER_INTERVAL_MS - (Date.now() - lastStreamRenderAt);
        if (waitMs <= 0) {
          render();
          return;
        }
        if (!streamRenderTimer) {
          streamRenderTimer = window.setTimeout(render, waitMs);
        }
      };
      flushEarningMessageStream = () => renderAssistantStreamText({ immediate: true });

      function applyStreamEvent(eventChunk) {
        const data = eventChunk.data || {};
        if (eventChunk.type === "started") {
          const providerName = data.providerLabel || agentProviderLabel;
          latestStatus = {
            type: "status",
            tone: "working",
            title: `${providerName} 어닝 분석 시작`,
            body: [
              data.model || selectedModelGroup?.slug,
              data.reasoning || selectedReasoning?.id,
              data.approval || selectedApproval?.label,
            ].filter(Boolean).join(" · "),
          };
          renderAssistantStreamText({ immediate: true });
        }
        if (eventChunk.type === "status") {
          latestStatus = {
            type: "status",
            tone: "working",
            title: data.title || `${agentProviderLabel} 어닝 분석 중`,
            body: data.body || `${agentProviderLabel}가 이벤트 발생 여부와 관련 자료를 확인하고 있습니다.`,
          };
          renderAssistantStreamText({ immediate: true });
        }
        if (eventChunk.type === "delta") {
          streamedText += data.text || data.delta || "";
          renderAssistantStreamText();
        }
        if (eventChunk.type === "message") {
          streamedText = data.text || streamedText;
          latestStatus = {
            type: "status",
            tone: "working",
            title: "어닝 분석 수신 중",
            body: `${data.providerLabel || agentProviderLabel}에서 최종 메시지를 받았습니다.`,
          };
          renderAssistantStreamText({ immediate: true });
        }
        if (eventChunk.type === "done") {
          streamedText = data.answer || streamedText || "응답이 비어 있습니다.";
          latestStatus = {
            type: "status",
            tone: "done",
            title: `${data.providerLabel || agentProviderLabel} 어닝 분석`,
            body: `${data.model || selectedModelGroup?.slug} · ${data.reasoning || selectedReasoning?.id} · ${Math.max(1, Math.round((data.elapsedMs || 0) / 1000))}초`,
          };
          renderAssistantStreamText({ immediate: true });
        }
        if (eventChunk.type === "error") {
          throw new Error(data.error || `${agentProviderLabel} stream failed`);
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n/);
        buffer = events.pop() || "";
        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;
          applyStreamEvent(parseSseEvent(rawEvent));
        }
      }

      const tail = buffer + decoder.decode();
      if (tail.trim()) {
        applyStreamEvent(parseSseEvent(tail));
      }
      flushEarningMessageStream();
      completedAnswer = streamedText.trim();
      if (completedAnswer) {
        await saveSharedChatMemory({
          createdAt,
          promptText: displayText,
          answerText: completedAnswer,
          article: null,
          attachments: [],
          screen: "earning-calendar",
          taskType: "earning-analysis",
        });
      }
    } catch (error) {
      flushEarningMessageStream();
      setChatMessages((messages) =>
        messages.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                blocks: [
                  {
                    type: "status",
                    tone: "error",
                    title: `${agentProviderLabel} 어닝 분석 실패`,
                    body: error.message,
                  },
                ],
              }
            : message
        )
      );
    } finally {
      setIsSending(false);
    }
  }

  const defaultAgentRuntime = providerRuntimeForProvider(agentProvider);
  const worldMemoryAgentRuntime = providerRuntimeForProvider(worldMemoryManagementProviderId());
  const magazineAgentRuntime = providerRuntimeForProvider(magazineWritingProviderId());
  const sidebarAgentRuntime =
    activeView === "world-memory" && worldMemoryEnabled
      ? worldMemoryAgentRuntime
      : activeView === "magazine" && magazineEnabled
        ? magazineAgentRuntime
        : defaultAgentRuntime;
  const enabledAgentProviderIds = enabledAgentProviders();
  const agentProviderProfiles = agentProviderIds.map((providerId) => {
    const providerStatus =
      providerOptions.find((item) => item.id === providerId) ||
      fallbackProviderOptions.find((item) => item.id === providerId) ||
      { id: providerId, label: providerId };
    const providerApprovalOptions =
      providerId === ANTIGRAVITY_PROVIDER_ID
        ? antigravityPolicyOptions
        : approvalOptions.length
          ? approvalOptions
          : fallbackApprovalOptions;
    const providerModelGroups = modelGroupsForProvider(providerId);
    const savedProviderSettings = agentProviderSettings(providerId);
    const providerSelection =
      providerId === agentProvider
        ? {
            provider: providerId,
            approval: selectedApproval?.id || approval,
            model: selectedModelGroup?.slug || model,
            reasoning: selectedReasoning?.id || reasoning,
            speed: selectedSpeed?.id || speed,
          }
        : selectionForProvider(providerId, savedProviderSettings);
    const providerModelGroup =
      providerModelGroups.find((item) => item.slug === providerSelection.model) ||
      providerModelGroups[0] ||
      fallbackModelGroups[0];
    const providerReasoningOptions = providerModelGroup?.reasoningLevels?.length
      ? providerModelGroup.reasoningLevels
      : fallbackModelGroups[0].reasoningLevels;
    const providerSpeedOptions = getSpeedOptions(providerModelGroup);

    return {
      id: providerId,
      label: providerStatus.label || (providerId === ANTIGRAVITY_PROVIDER_ID ? "Antigravity CLI" : "Codex CLI"),
      enabled: isAgentProviderEnabled(providerId),
      toggleDisabled: isAgentProviderEnabled(providerId) && enabledAgentProviderIds.length <= 1,
      status: providerStatus,
      approvalOptions: providerApprovalOptions,
      approval: providerSelection.approval,
      modelGroups: providerModelGroups,
      model: providerSelection.model,
      reasoningOptions: providerReasoningOptions,
      reasoning: providerSelection.reasoning,
      speedOptions: providerSpeedOptions,
      speed: providerSelection.speed,
    };
  });

  return (
    <main
      className={isChatCanvasView ? "mockup-stage no-agent-sidebar" : "mockup-stage"}
      aria-label="에이전트 sidebar mockup"
    >
      <AppNavigation
        activePortfolioCanvas={activePortfolioCanvas}
        activeView={activeView}
        arcaNotificationHealth={arcaNotificationHealth}
        editingPortfolioCanvasId={editingPortfolioCanvasId}
        magazineStatus={magazineStatus}
        nameInputRef={portfolioCanvasNameInputRef}
        newsFeedStatus={newsFeedStatus}
        magazineEnabled={magazineEnabled}
        onDraftChange={setPortfolioCanvasNameDraft}
        onDraftKeyDown={handlePortfolioCanvasNameKeyDown}
        onDuplicateCanvas={duplicatePortfolioCanvas}
        onMenuToggle={(canvasId) =>
          setPortfolioCanvasMenuId((current) => (canvasId && current === canvasId ? "" : canvasId))
        }
        onRenameCanvas={startPortfolioCanvasRename}
        onRequestDeleteCanvas={requestDeletePortfolioCanvas}
        onSaveDraft={savePortfolioCanvasNameDraft}
        onSelectCanvas={selectPortfolioCanvas}
        onSelectItem={handleSidebarItemClick}
        onSelectUtility={(item) => setActiveView(item.view)}
        portfolioCanvasModeMeta={portfolioCanvasModeMeta}
        portfolioCanvasNameDraft={portfolioCanvasNameDraft}
        portfolioCanvasMenuId={portfolioCanvasMenuId}
        portfolioCanvases={portfolioCanvases}
        portfolioSidebarOpen={portfolioSidebarOpen}
        worldMemoryEnabled={worldMemoryEnabled}
      />

      {activeView === "settings" ? (
        <section className="workspace-canvas settings-canvas" aria-label="설정">
          <React.Suspense fallback={<RouteLoading label="설정 불러오는 중" />}>
            <SettingsView
              settings={newsFeedSettings}
              busy={newsFeedSettingsBusy || worldMemorySettingsBusy || magazineSettingsBusy}
              savingFeedId={newsFeedSettingsSavingId}
              error={newsFeedSettingsError}
              onReload={() => {
                void loadNewsFeedSettings();
                void loadWorldMemorySettings({ refreshStatus: true });
                void loadMagazineSettings({ quiet: true });
              }}
              onToggleFeed={toggleNewsFeedSource}
              onPollIntervalChange={updateNewsFeedPollInterval}
              memoryStatus={memoryStatus}
              memoryBusy={memoryBusy}
              memoryError={memoryError}
              memoryRecentOpen={memoryRecentOpen}
              onToggleMemoryRecent={() => setMemoryRecentOpen((open) => !open)}
              onReloadMemory={loadSharedMemoryStatus}
              onOpenMemoryDialog={openMemoryDialog}
              onDeleteMemoryRecord={deleteMemoryRecord}
              deletingMemoryRecordId={deletingMemoryRecordId}
              memoryDialog={{
                open: memoryDialogOpen,
                records: memoryDialogRecords,
                totalCount: memoryDialogTotalCount,
                hasMore: memoryDialogHasMore,
                busy: memoryDialogBusy,
                error: memoryDialogError,
                deletingRecordId: deletingMemoryRecordId,
                onClose: () => setMemoryDialogOpen(false),
                onScroll: handleMemoryDialogScroll,
              }}
              worldMemoryStatus={worldMemoryStatus}
              worldMemoryBusy={worldMemoryBusy}
              worldMemoryError={worldMemoryError}
              worldMemoryTechOpen={worldMemoryTechOpen}
              worldMemorySettings={worldMemorySettings}
              worldMemorySettingsBusy={worldMemorySettingsBusy}
              worldMemorySettingsSaving={worldMemorySettingsSaving}
              worldMemorySettingsError={worldMemorySettingsError}
              magazineSettings={magazineSettings}
              magazineSettingsBusy={magazineSettingsBusy}
              magazineSettingsSaving={magazineSettingsSaving}
              magazineSettingsError={magazineSettingsError}
              onToggleWorldMemoryTech={() => setWorldMemoryTechOpen((open) => !open)}
              onToggleWorldMemoryEnabled={updateWorldMemoryEnabled}
              onWorldMemoryManagementProviderChange={updateWorldMemoryManagementProvider}
              onToggleMagazineEnabled={updateMagazineEnabled}
              onMagazineWritingProviderChange={updateMagazineWritingProvider}
              onMagazineSchedulerIntervalChange={updateMagazineSchedulerInterval}
              onReloadWorldMemory={loadWorldMemoryStatus}
              arcaAuth={{
                status: arcaAuthStatus,
                busy: arcaAuthBusy,
                action: arcaAuthAction,
                error: arcaAuthError,
                onReload: () => void loadArcaAuthStatus(),
                onStartHandoff: startArcaLoginHandoff,
                onCaptureSession: captureArcaLoginSession,
                onStopHandoff: stopArcaLoginHandoff,
                onDeleteSession: deleteArcaLoginSession,
              }}
              agentSettings={{
                providerOptions,
                provider: agentProvider,
                onProviderChange: handleAgentProviderChange,
                providerStatus: selectedProvider,
                providerProfiles: agentProviderProfiles,
                onProviderEnabledChange: updateProviderEnabled,
                onProviderSettingChange: updateProviderSelection,
                approvalOptions: activeApprovalOptions,
                approval: selectedApproval?.id || approval,
                onApprovalChange: (nextApproval) => updateAgentSelection({ approval: nextApproval }),
                modelGroups: activeModelGroups,
                model: selectedModelGroup?.slug || model,
                onModelChange: (nextModel) => updateAgentSelection({ model: nextModel }),
                reasoningOptions,
                reasoning: selectedReasoning?.id || reasoning,
                onReasoningChange: (nextReasoning) => updateAgentSelection({ reasoning: nextReasoning }),
                speedOptions,
                speed,
                onSpeedChange: (nextSpeed) => updateAgentSelection({ speed: nextSpeed }),
                personaModeOptions,
                personaMode,
                onPersonaModeChange: updatePersonaMode,
                settingsError: agentSettingsError,
                loading: !agentOptionsReady,
              }}
            />
          </React.Suspense>
        </section>
      ) : activeView === "chat" ? (
        <ChatCanvas
          activeWorldMemoryActionId={worldMemoryAgentAction?.id || ""}
          addChatAttachmentFiles={addChatAttachmentFiles}
          agentIcon={agentIcon}
          agentOptionsReady={agentOptionsReady}
          agentProviderLabel={agentProviderLabel}
          attachedArticle={attachedArticle}
          attachmentError={attachmentError}
          chatAttachments={chatAttachments}
          fileInputRef={fileInputRef}
          handleComposerDragEnter={handleComposerDragEnter}
          handleComposerDragLeave={handleComposerDragLeave}
          handleComposerDragOver={handleComposerDragOver}
          handleComposerDrop={handleComposerDrop}
          handleComposerPaste={handleComposerPaste}
          isComposerDragging={isComposerDragging}
          isSending={isSending}
          messageStackRef={messageStackRef}
          onClearAttachedArticle={() => setAttachedArticle(null)}
          onExecuteWorldMemoryAction={executeWorldMemoryAgentAction}
          onNewChat={startNewChat}
          onPromptChange={setPrompt}
          onRemoveChatAttachment={removeChatAttachment}
          onSelectApproval={(nextApproval) => updateAgentSelection({ approval: nextApproval })}
          onSelectModel={(nextModel) => updateAgentSelection({ model: nextModel })}
          onSelectReasoning={(nextReasoning) => updateAgentSelection({ reasoning: nextReasoning })}
          onSelectSpeed={(nextSpeed) => updateAgentSelection({ speed: nextSpeed })}
          onStopSend={stopActiveChatResponse}
          prompt={prompt}
          promptHeight={promptHeight}
          promptOverflow={promptOverflow}
          promptRef={promptRef}
          sendPrompt={sendPrompt}
          toolbarApprovalOptions={toolbarApprovalOptions}
          toolbarApprovalValue={toolbarApprovalValue}
          toolbarModelGroups={toolbarModelGroups}
          toolbarModelValue={toolbarModelValue}
          toolbarReasoningValue={toolbarReasoningValue}
          toolbarSpeedValue={toolbarSpeedValue}
          visibleChatMessages={visibleChatMessages}
          worldMemoryActionBusy={worldMemoryActionBusy}
        />
      ) : activeView === "reports" ? (
        <section className="workspace-canvas reports-canvas" aria-label="보고서">
          <React.Suspense fallback={<RouteLoading label="보고서 불러오는 중" />}>
            <ReportsView
              refreshSignal={reportRefreshSignal}
              agentIcon={agentIcon}
              agentProvider={agentProvider}
              agentProviderLabel={agentProviderLabel}
              agentOptionsReady={agentOptionsReady}
              agentModel={selectedModelGroup?.slug || model}
              agentReasoning={selectedReasoning?.id || reasoning}
              agentApproval={selectedApproval?.id || approval}
              isSending={isSending}
              worldMemoryEnabled={worldMemoryEnabled}
              onResearchPrompt={handleReportsBoredResearch}
            />
          </React.Suspense>
        </section>
      ) : activeView === "world-memory" && worldMemoryEnabled ? (
        <section className="workspace-canvas world-memory-canvas" aria-label="World Memory">
          <React.Suspense fallback={<RouteLoading label="World Memory 불러오는 중" />}>
            <WorldMemoryView
              status={worldMemoryStatus}
              busy={worldMemoryBusy}
              error={worldMemoryError}
              actionBusy={worldMemoryActionBusy}
              actionResult={worldMemoryActionResult}
              agentAction={worldMemoryAgentAction}
              agentIcon={worldMemoryAgentRuntime.icon}
              agentProvider={worldMemoryAgentRuntime.provider}
              agentOptionsReady={agentOptionsReady}
              isSending={isSending}
              onClearAgentAction={() => setWorldMemoryAgentAction(null)}
              onExecuteAgentAction={executeWorldMemoryAgentAction}
              onAskReportItem={askWorldMemoryReportItem}
              onReload={loadWorldMemoryStatus}
              onRunAction={runWorldMemoryAction}
            />
          </React.Suspense>
        </section>
      ) : activeView === "news-feed" ? (
        <section className="workspace-canvas news-feed-canvas" aria-label="News Feed" onScroll={handleNewsFeedScroll}>
          <React.Suspense fallback={<RouteLoading label="News Feed 불러오는 중" />}>
            <NewsFeedView
              status={newsFeedStatus}
              items={newsFeedItems}
              busy={newsFeedBusy}
              loadingMore={newsFeedLoadingMore}
              error={newsFeedError}
              hasMore={newsFeedHasMore}
              translationModelLabel={newsFeedTranslationModelLabel}
              onRefresh={refreshNewsFeed}
            />
          </React.Suspense>
        </section>
      ) : activeView === "magazine" ? (
        <section
          className={`workspace-canvas magazine-canvas${magazineActiveArticle ? " is-reader-open" : ""}`}
          aria-label="주식채널 매거진+"
          ref={magazineCanvasRef}
        >
          <div className="magazine-empty-page">
            <MagazineUpdateSchedule
              status={magazineStatus}
              articles={magazineArticles}
              isStartingNow={magazineStartNowBusy}
              isGeneratingOne={magazineGenerateOneBusy}
              onStartNow={startMagazineNow}
              onGenerateOne={magazineGenerateOneToolVisible ? generateOneMagazineArticle : null}
            />
            <h1 className="magazine-logo-heading">
              <img
                className="magazine-logo-image"
                src={stockChannelMagazineLogo}
                alt="Stock Channel Magazine+"
              />
            </h1>
            <MagazineTopicRow
              topics={magazineTopicCatalog}
              activeTopic={magazineActiveTopic}
              onSelectTopic={openMagazineTopic}
            />
            <div className="magazine-issue-layout" aria-label="매거진 기사 목업">
              <article className="magazine-headline-story">
                <div className="magazine-headline-copy">
                  <span className="magazine-story-kicker">{magazineCoverHeadline.topic}</span>
                  <h2>
                    <a
                      className="magazine-article-link"
                      href="#magazine-reader"
                      onClick={(event) => openMagazineArticle(event, magazineCoverHeadline)}
                    >
                      {magazineCoverHeadline.title}
                    </a>
                  </h2>
                  <p>{magazineCoverHeadline.deck}</p>
                  <MagazinePublishedTime article={magazineCoverHeadline} />
                </div>
                <a
                  className="magazine-image-link"
                  href="#magazine-reader"
                  onClick={(event) => openMagazineArticle(event, magazineCoverHeadline)}
                  aria-label={`${magazineCoverHeadline.title} 기사 열기`}
                >
                  <div className="magazine-featured-image magazine-headline-image">
                    <img src={magazineCoverHeadline.image} alt={magazineCoverHeadline.imageAlt} />
                  </div>
                </a>
              </article>
              <div className="magazine-card-grid" aria-label="피처드 기사">
                {magazineCoverCards.map((story) => (
                  <article className="magazine-article-card" key={story.id || story.title}>
                    <a
                      className="magazine-image-link"
                      href="#magazine-reader"
                      onClick={(event) => openMagazineArticle(event, story)}
                      aria-label={`${story.title} 기사 열기`}
                    >
                      <div className="magazine-featured-image">
                        <img src={story.image} alt={story.imageAlt} />
                      </div>
                    </a>
                    <div className="magazine-card-copy">
                      <span className="magazine-story-kicker">{story.topic}</span>
                      <h3>
                        <a
                          className="magazine-article-link"
                          href="#magazine-reader"
                          onClick={(event) => openMagazineArticle(event, story)}
                        >
                          {story.title}
                        </a>
                      </h3>
                    </div>
                  </article>
                ))}
              </div>
              <section className="magazine-list-section" aria-labelledby="magazine-article-list-heading">
                <div className="magazine-section-heading">
                  <h2 id="magazine-article-list-heading">최신 기사</h2>
                </div>
                <MagazineArticleList
                  articles={magazineArticles}
                  listKey="latest"
                  onOpenArticle={openMagazineArticle}
                />
              </section>
            </div>
          </div>
          {magazineActiveTopicEntry ? (
            <div
              className="magazine-topic-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="magazine-topic-view-title"
              ref={magazineTopicModalRef}
            >
              <div className="magazine-topic-shell">
                <a className="magazine-topic-return-link" href="#magazine-all" onClick={closeMagazineTopic}>
                  ← 전체 기사 보기로 돌아가기
                </a>
                <header className="magazine-topic-view-header">
                  <h1>
                    <a className="magazine-title-link" href="#magazine-all" onClick={closeMagazineTopic}>
                      주식채널 매거진+
                    </a>
                  </h1>
                  <MagazineTopicRow
                    topics={magazineTopicCatalog}
                    activeTopic={magazineActiveTopic}
                    onSelectTopic={openMagazineTopic}
                    ariaLabel="매거진 토픽 필터"
                  />
                </header>
                <section className="magazine-list-section" aria-labelledby="magazine-topic-view-title">
                  <div className="magazine-section-heading">
                    <h2 id="magazine-topic-view-title">{magazineActiveTopic} 주제의 기사</h2>
                  </div>
                  <MagazineArticleList
                    articles={magazineTopicArticles}
                    listKey={`topic:${magazineActiveTopic}`}
                    onOpenArticle={openMagazineArticle}
                    emptyText={`${magazineActiveTopic} 주제로 분류된 기사가 아직 없습니다.`}
                  />
                </section>
              </div>
            </div>
          ) : null}
          {magazineActiveArticle ? (
            <div className="magazine-reader-modal" role="dialog" aria-modal="true" aria-labelledby="magazine-reader-title">
              <div className="magazine-reader-shell">
                <div className="magazine-reader-actions">
                  <div className="magazine-reader-left-actions">
                    <button className="magazine-reader-close" type="button" onClick={closeMagazineArticle}>
                      기사 닫기
                    </button>
                    <button
                      className={[
                        "magazine-reader-copy",
                        magazineCopyStatus !== "idle" ? `is-${magazineCopyStatus}` : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      onClick={copyMagazineArticle}
                      disabled={magazineCopyStatus === "copying"}
                      title={magazineCopyError || undefined}
                    >
                      <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
                      <span>
                        {magazineCopyStatus === "copying"
                          ? "복사 중"
                          : magazineCopyStatus === "copied"
                            ? "복사됨"
                            : magazineCopyStatus === "text"
                              ? "텍스트 복사됨"
                              : magazineCopyStatus === "error"
                                ? "복사 실패"
                                : "복사하기"}
                      </span>
                    </button>
                  </div>
                  <button
                    className="magazine-reader-delete"
                    type="button"
                    onClick={openMagazineDeleteDialog}
                    disabled={!magazineActiveArticle.id || magazineDeleting}
                  >
                    <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>기사 삭제</span>
                  </button>
                </div>
                <article className="magazine-reader-article" ref={magazineReaderArticleRef}>
                  <div className="magazine-reader-topic-row" aria-label="기사 토픽">
                    {magazineActiveArticle.topics.map((topic) => (
                      <span className="magazine-list-topic" key={topic}>
                        {topic}
                      </span>
                    ))}
                  </div>
                  <h1 id="magazine-reader-title">{magazineActiveArticle.title}</h1>
                  <MagazinePublishedTime article={magazineActiveArticle} className="magazine-reader-published-time" />
                  <p className="magazine-reader-summary">{magazineActiveArticle.summary}</p>
                  <figure className="magazine-reader-figure">
                    <div className="magazine-featured-image magazine-reader-image">
                      <img src={magazineActiveArticle.image} alt={magazineActiveArticle.imageAlt} />
                    </div>
                    {magazineActiveArticle.imageCredit ? (
                      <figcaption>{magazineActiveArticle.imageCredit}</figcaption>
                    ) : null}
                  </figure>
                  <div className="magazine-reader-body">
                    {magazineActiveArticle.bodyHtml ? (
                      <div
                        className="magazine-reader-html"
                        dangerouslySetInnerHTML={{ __html: magazineActiveArticle.bodyHtml }}
                      />
                    ) : (
                      magazineMockArticleSections.map((section) => (
                        <section className="magazine-reader-section" key={section.heading}>
                          <h2>{section.heading}</h2>
                          <p>{section.body}</p>
                        </section>
                      ))
                    )}
                    {magazineActiveArticle.chartBlocks.length ? (
                      <div className="magazine-reader-chart-list" aria-label="기사 데이터 차트">
                        {magazineActiveArticle.chartBlocks.map((chart, index) => (
                          <section className="magazine-reader-chart-section" key={chart.id || chart.title || index}>
                            <h2>{chart.title}</h2>
                            {chart.note ? <p>{chart.note}</p> : null}
                            <div className="magazine-reader-chart-frame">
                              <React.Suspense fallback={<div className="magazine-reader-chart-loading">차트 읽는 중</div>}>
                                <MagazinePortfolioEChart
                                  option={chart.option}
                                  className="magazine-reader-echart"
                                  ariaLabel={chart.ariaLabel || `${chart.title} 차트`}
                                />
                              </React.Suspense>
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : null}
                    {magazineActiveArticle.followupOptions.length ? (
                      <section className="magazine-reader-followup" aria-label="앞으로 알고 싶은 기사 방향">
                        <h2>앞으로 이 분야에 대해 더 알고 싶은 것이 있으신가요?</h2>
                        <div className="magazine-reader-followup-options">
                          {magazineActiveArticle.followupOptions.map((option, index) => {
                            const isSelected = selectedMagazinePreferenceIds.includes(option.id);
                            const isSaving = magazinePreferenceSavingId === option.id;
                            const tone = option.tone || magazineToneSequence[index % magazineToneSequence.length];
                            return (
                              <button
                                className={[
                                  "magazine-reader-followup-choice",
                                  `is-${tone}`,
                                  isSelected ? "is-selected" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                type="button"
                                key={option.id}
                                aria-pressed={isSelected}
                                disabled={Boolean(magazinePreferenceSavingId)}
                                onClick={() => saveMagazinePreference(option)}
                              >
                                {isSelected ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
                                <span>{isSaving ? "저장 중" : option.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        {magazinePreferenceNotice ? (
                          <div
                            className={[
                              "magazine-reader-followup-notice",
                              magazinePreferenceNoticeFading ? "is-fading" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            role="status"
                          >
                            {magazinePreferenceNotice}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                    <section className="magazine-reader-comments" aria-label="기사 댓글">
                      <h2>추가로 요청하고 싶은 것이 있거나 궁금하신 점이 있다면 알려주세요</h2>
                      <div className="magazine-reader-comment-list">
                        {magazineComments.length ? (
                          magazineComments.map((comment) => {
                            const replyStatusText = magazineCommentStatusText(comment.reply?.status);
                            return (
                              <article className="magazine-reader-comment" key={comment.id}>
                                <div className="magazine-reader-comment-meta">
                                  <strong>{comment.author || "사용자"}</strong>
                                  <span>{formatDateTime(comment.createdAt)}</span>
                                </div>
                                <p>{comment.text}</p>
                                {comment.reply ? (
                                  <div
                                    className={[
                                      "magazine-reader-comment-reply",
                                      comment.reply.status === "error" ? "is-error" : "",
                                      ["waiting", "generating"].includes(comment.reply.status) ? "is-pending" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                  >
                                    <div className="magazine-reader-comment-meta">
                                      <strong>{comment.reply.author || "매거진 편집자 AI"}</strong>
                                      <span>
                                        {replyStatusText || formatDateTime(comment.reply.createdAt)}
                                      </span>
                                    </div>
                                    {["waiting", "generating"].includes(comment.reply.status) ? (
                                      <div className="magazine-reader-comment-pending">
                                        <LoaderCircle size={16} strokeWidth={2.2} className="is-spinning" aria-hidden="true" />
                                        <span>{replyStatusText}</span>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="magazine-reader-comment-markdown">
                                          <MarkdownText text={comment.reply.text} splitSingleLineParagraphs />
                                        </div>
                                        {comment.reply.biasEventIds?.length ? (
                                          <div className="magazine-reader-comment-bias-applied" role="status">
                                            <span className="magazine-reader-comment-bias-icon" aria-hidden="true">
                                              <Check size={13} strokeWidth={2.7} />
                                            </span>
                                            <span>사용자의 편집 방향 수정 요청이 반영되었습니다</span>
                                          </div>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                ) : null}
                              </article>
                            );
                          })
                        ) : (
                          <p className="magazine-reader-comments-empty">아직 남겨진 코멘트가 없습니다.</p>
                        )}
                      </div>
                      <form className="magazine-reader-comment-form" onSubmit={submitMagazineComment}>
                        <label className="sr-only" htmlFor="magazine-comment-input">
                          기사 코멘트
                        </label>
                        <textarea
                          id="magazine-comment-input"
                          value={magazineCommentDraft}
                          maxLength={4000}
                          onChange={(event) => setMagazineCommentDraft(event.target.value)}
                          placeholder="궁금한 점이나 앞으로 보고 싶은 기사 방향을 적어주세요."
                          disabled={magazineCommentSubmitting}
                        />
                        <div className="magazine-reader-comment-form-row">
                          {magazineCommentError ? (
                            <span className="magazine-reader-comment-error">{magazineCommentError}</span>
                          ) : (
                            <span>{magazineCommentDraft.length.toLocaleString("ko-KR")} / 4,000</span>
                          )}
                          <button
                            className={[
                              "magazine-reader-comment-submit",
                              magazineCommentSubmitting ? "is-loading" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            type="submit"
                            disabled={!magazineCommentDraft.trim() || magazineCommentSubmitting}
                            aria-label={magazineCommentSubmitting ? "답변 준비 중" : "등록"}
                            title={magazineCommentSubmitting ? "답변 준비 중" : undefined}
                          >
                            {magazineCommentSubmitting ? (
                              <LoaderCircle size={16} strokeWidth={2.2} className="is-spinning" aria-hidden="true" />
                            ) : (
                              <>
                                <SendHorizontal size={16} strokeWidth={2.2} aria-hidden="true" />
                                <span>등록</span>
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </section>
                    <button className="magazine-reader-return" type="button" onClick={closeMagazineArticle}>
                      돌아가기
                    </button>
                  </div>
                </article>
              </div>
              {magazineDeleteDialogOpen ? (
                <div className="magazine-reader-delete-overlay">
                  <div
                    className="magazine-reader-delete-dialog"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="magazine-delete-dialog-title"
                    aria-describedby="magazine-delete-dialog-description"
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent?.isComposing || magazineDeleting) return;
                      event.preventDefault();
                      event.stopPropagation();
                      void confirmMagazineArticleDelete();
                    }}
                  >
                    <h2 id="magazine-delete-dialog-title">정말 삭제하시겠습니까?</h2>
                    <p id="magazine-delete-dialog-description">삭제한 기사는 되돌릴 수 없습니다.</p>
                    {magazineDeleteError ? (
                      <p className="magazine-reader-delete-error" role="alert">
                        {magazineDeleteError}
                      </p>
                    ) : null}
                    <div className="magazine-reader-delete-dialog-actions">
                      <button
                        className="magazine-reader-delete-cancel"
                        type="button"
                        onClick={closeMagazineDeleteDialog}
                        disabled={magazineDeleting}
                      >
                        취소
                      </button>
                      <button
                        className="magazine-reader-delete-confirm"
                        type="button"
                        onClick={confirmMagazineArticleDelete}
                        disabled={magazineDeleting}
                        autoFocus
                      >
                        {magazineDeleting ? (
                          <LoaderCircle size={15} strokeWidth={2.2} className="is-spinning" aria-hidden="true" />
                        ) : null}
                        <span>{magazineDeleting ? "삭제 중" : "확인"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : activeView === "portfolio" ? (
        <section className="workspace-canvas portfolio-canvas" aria-label="포트폴리오">
          <div className="portfolio-shell">
            <React.Suspense fallback={<RouteLoading label="포트폴리오 화면 불러오는 중" />}>
              <PortfolioGuidePage
                modes={portfolioCanvasModeList}
                principles={portfolioTheoryPrinciples}
                onCreateCanvas={createPortfolioCanvasFromGuide}
              />
            </React.Suspense>
          </div>
        </section>
      ) : activeView === "portfolio-canvas" ? (
        <section
          className="workspace-canvas portfolio-canvas"
          aria-label={activePortfolioCanvas ? `${activePortfolioCanvas.name} 포트폴리오 캔버스` : "포트폴리오"}
        >
          <React.Suspense fallback={<RouteLoading label="포트폴리오 캔버스 불러오는 중" />}>
            {activePortfolioCanvas ? (
              <PortfolioWorkspace
                key={activePortfolioCanvas.id}
                canvas={activePortfolioCanvas}
                onWorkspaceChange={updateActivePortfolioCanvasWorkspace}
                onRenameCanvas={(nextName) => renamePortfolioCanvasTo(activePortfolioCanvas.id, nextName)}
                onOpenGuide={() => {
                  setActiveView("portfolio");
                  setPortfolioContext(null);
                }}
                onContextChange={setPortfolioContext}
                onWidgetPromptRequest={handlePortfolioWidgetPromptRequest}
                agentWidgetAction={portfolioWidgetAgentAction}
                agentProvider={agentProvider}
                onAgentWidgetActionConsumed={(actionId) =>
                  setPortfolioWidgetAgentAction((current) => (current?.id === actionId ? null : current))
                }
              />
            ) : (
              <div className="portfolio-shell">
                <PortfolioGuidePage
                  modes={portfolioCanvasModeList}
                  principles={portfolioTheoryPrinciples}
                  onCreateCanvas={createPortfolioCanvasFromGuide}
                />
              </div>
            )}
          </React.Suspense>
        </section>
      ) : activeView === "earning-calendar" ? (
        <section className="workspace-canvas calendar-canvas" aria-label="Earning Calendar">
          <React.Suspense fallback={<RouteLoading label="실적 캘린더 불러오는 중" />}>
            <EarningCalendarView
              agentIcon={agentIcon}
              analysisReady={agentOptionsReady}
              analysisBusy={isSending}
              onAnalyzeEarning={analyzeEarningEvent}
              onContextChange={setEarningCalendarContext}
            />
          </React.Suspense>
        </section>
      ) : activeView === "economic-calendar" ? (
        <section className="workspace-canvas calendar-canvas" aria-label="Economic Calendar">
          <React.Suspense fallback={<RouteLoading label="경제 캘린더 불러오는 중" />}>
            <EconomicCalendarView onContextChange={setEconomicCalendarContext} />
          </React.Suspense>
        </section>
      ) : (
        <StockChannelView
          activeCategoryLabel={activeCategoryLabel}
          agentIcon={agentIcon}
          attachingArticleHref={attachingArticleHref}
          board={arcaBoard}
          boardBusy={arcaBoardBusy}
          boardError={arcaBoardError}
          boardFilters={boardFilters}
          boardSearchInput={boardSearchInput}
          cutRateOptions={cutRateOptions}
          notificationBusy={arcaNotificationBusy}
          notificationHealth={arcaNotificationHealth}
          onAttachArticle={attachArticleContext}
          onBoardSearchInputChange={setBoardSearchInput}
          onRefreshBoard={refreshBoard}
          onSelectCategory={selectBoardCategory}
          onSubmitSearch={submitBoardSearch}
          onToggleHiddenNotices={() => setShowHiddenNotices((next) => !next)}
          onUpdateFilters={updateBoardFilters}
          searchTargetOptions={searchTargetOptions}
          showHiddenNotices={showHiddenNotices}
          sortOptions={sortOptions}
          writeUrl={ARCA_WRITE_URL}
          notificationUrl={ARCA_NOTIFICATION_URL}
        />
      )}

      {isChatCanvasView ? null : (
        <AgentSidebar
          addChatAttachmentFiles={addChatAttachmentFiles}
          agentIcon={sidebarAgentRuntime.icon}
          agentOptionsReady={agentOptionsReady}
          agentProvider={sidebarAgentRuntime.provider}
          agentProviderAvailable={sidebarAgentRuntime.providerAvailable}
          agentProviderLabel={sidebarAgentRuntime.providerLabel}
          attachedArticle={attachedArticle}
          attachmentError={attachmentError}
          chatAttachments={chatAttachments}
          codexStatus={codexStatus}
          commandPreview={sidebarAgentRuntime.commandPreview}
          fileInputRef={fileInputRef}
          handleComposerDragEnter={handleComposerDragEnter}
          handleComposerDragLeave={handleComposerDragLeave}
          handleComposerDragOver={handleComposerDragOver}
          handleComposerDrop={handleComposerDrop}
          handleComposerPaste={handleComposerPaste}
          isComposerDragging={isComposerDragging}
          isSending={isSending}
          messageStackRef={messageStackRef}
          activeWorldMemoryActionId={worldMemoryAgentAction?.id || ""}
          onClearAttachedArticle={() => setAttachedArticle(null)}
          onExecuteWorldMemoryAction={executeWorldMemoryAgentAction}
          onNewChat={startNewChat}
          onPromptChange={setPrompt}
          onRemoveChatAttachment={removeChatAttachment}
          onSelectApproval={(nextApproval) => updateProviderSelection(sidebarAgentRuntime.provider, { approval: nextApproval })}
          onSelectModel={(nextModel) => updateProviderSelection(sidebarAgentRuntime.provider, { model: nextModel })}
          onSelectReasoning={(nextReasoning) => updateProviderSelection(sidebarAgentRuntime.provider, { reasoning: nextReasoning })}
          onSelectSpeed={(nextSpeed) => updateProviderSelection(sidebarAgentRuntime.provider, { speed: nextSpeed })}
          onStopSend={stopActiveChatResponse}
          prompt={prompt}
          promptHeight={promptHeight}
          promptOverflow={promptOverflow}
          promptRef={promptRef}
          selectedProvider={sidebarAgentRuntime.selectedProvider}
          sendPrompt={sendPrompt}
          toolbarApprovalOptions={agentOptionsReady ? sidebarAgentRuntime.approvalOptions : loadingApprovalOptions}
          toolbarApprovalValue={agentOptionsReady ? sidebarAgentRuntime.selectedApproval?.id : "loading"}
          toolbarModelGroups={agentOptionsReady ? sidebarAgentRuntime.modelGroups : loadingModelGroups}
          toolbarModelValue={agentOptionsReady ? sidebarAgentRuntime.selectedModelGroup?.slug : "loading"}
          toolbarReasoningValue={agentOptionsReady ? sidebarAgentRuntime.selectedReasoning?.id : "loading"}
          toolbarSpeedValue={agentOptionsReady ? sidebarAgentRuntime.selectedSpeed?.id : "loading"}
          visibleChatMessages={visibleChatMessages}
          worldMemoryActionBusy={worldMemoryActionBusy}
        />
      )}

      <PortfolioCanvasDeleteDialog
        canvas={pendingDeletePortfolioCanvas}
        onCancel={() => setPendingDeletePortfolioCanvas(null)}
        onConfirm={confirmDeletePortfolioCanvas}
      />
      <PortfolioAssetApiDialog
        open={assetApiDialogOpen}
        onConfirm={() => setAssetApiDialogOpen(false)}
      />
    </main>
  );
}

export default App;
