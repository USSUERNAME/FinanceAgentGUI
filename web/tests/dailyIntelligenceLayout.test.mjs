import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewSource = readFileSync(
  new URL("../src/dailyIntelligence/DailyIntelligenceView.jsx", import.meta.url),
  "utf8",
);
const navigationSource = readFileSync(
  new URL("../src/shell/AppNavigation.jsx", import.meta.url),
  "utf8",
);
const routesSource = readFileSync(
  new URL("../src/shell/AppRoutes.jsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../src/dailyIntelligence/daily-intelligence.css", import.meta.url),
  "utf8",
);
const operationsStart = viewSource.indexOf("if (operationsMode)");
const readerStart = viewSource.indexOf("PB DAILY MARKET INTELLIGENCE", operationsStart);
const operationsView = viewSource.slice(operationsStart, readerStart);
const readerView = viewSource.slice(readerStart);
const marketWorkspaceStart = viewSource.indexOf("function MarketSectorsWorkspace");
const companyWorkspaceStart = viewSource.indexOf("function CompanyResearchWorkspace");
const marketWorkspaceEnd = companyWorkspaceStart;
const marketWorkspace = viewSource.slice(marketWorkspaceStart, marketWorkspaceEnd);
const journalWorkspaceStart = viewSource.indexOf("function ThesisJournalWorkspace");
const companyWorkspaceEnd = journalWorkspaceStart;
const companyWorkspace = viewSource.slice(companyWorkspaceStart, companyWorkspaceEnd);
const journalWorkspaceEnd = viewSource.indexOf("export default function DailyIntelligenceView", journalWorkspaceStart);
const journalWorkspace = viewSource.slice(journalWorkspaceStart, journalWorkspaceEnd);

test("Daily Intelligence leads with decisions and links to a separate operations surface", () => {
  const readingPath = [
    "<DecisionGate",
    "<h2>30초 결론</h2>",
    "<MarketSectorStockChain",
    "<h2>내 종목과 오늘의 리포트</h2>",
    "<h2>검증된 핵심 사건</h2>",
    "<h2>오늘 확인할 조건</h2>",
    "Research Operations",
  ].map((needle) => readerView.indexOf(needle));

  assert.equal(readingPath.every((index) => index >= 0), true);
  assert.deepEqual(readingPath, [...readingPath].sort((a, b) => a - b));
  assert.doesNotMatch(readerView, /<GmailResearchStatus|<BrokerResearchMonitor|<TelegramSourceMonitor/);
  assert.doesNotMatch(readerView, /<details className="daily-intelligence-operations">/);
  assert.match(viewSource, /오늘의 투자 판단 연결 보드/);
  assert.match(viewSource, /Why now와 첫 기각 조건/);
  assert.match(viewSource, /추정치·밸류에이션 게이트/);
  assert.match(viewSource, /이상 움직임/);
  assert.match(viewSource, /근거 수준별로 분류/);
  assert.match(viewSource, /승격 조건/);
  assert.match(viewSource, /제외 후보/);
  assert.match(viewSource, /7-DAY CALIBRATION/);
  assert.match(viewSource, /최소 표본/);
  assert.match(viewSource, /DECISION COACH/);
  assert.match(viewSource, /오늘 지킬 판단 원칙/);
  assert.match(viewSource, /getElementById\("investment-thesis-memory"\)/);
  assert.match(viewSource, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(viewSource, /portfolioResponseCalibration \|\| \{\}/);
  assert.match(viewSource, /STOCK DECISION BOARD/);
  assert.match(viewSource, /종목 비교 의사결정판/);
  assert.match(viewSource, /상위 후보 5개 중 2~3개/);
  assert.match(viewSource, /첫 기각 조건/);
  assert.match(companyWorkspace, /const candidatePool = decisionChain\?\.ideaFunnel\?\.candidatePool \|\| \[\];/);
  assert.match(companyWorkspace, /candidatePool=\{candidatePool\}/);
  assert.match(viewSource, /shortlistTrackable: false/);
  assert.match(
    viewSource,
    /key=\{`\$\{candidate\.ticker\}-\$\{item\.sourceUrl \|\| item\.title\}-\$\{evidenceIndex\}`\}/,
  );
});

test("Research Operations owns collection, approval, and verification controls", () => {
  assert.match(operationsView, /<GmailResearchStatus/);
  assert.match(operationsView, /<BrokerResearchApprovalQueue/);
  assert.match(operationsView, /<BrokerResearchMonitor/);
  assert.match(operationsView, /<TelegramSourceMonitor/);
  assert.match(operationsView, /<OperationsPanel/);
  assert.match(operationsView, /<ReviewQueue/);
  assert.match(viewSource, /id="pipeline-operations"/);
  assert.match(operationsView, /id="verification-review-queue"/);
  assert.match(operationsView, /검증 대기 사건 확인 방법/);
  assert.match(operationsView, /href="#pipeline-operations"/);
  assert.match(viewSource, /투자 가설 자동 반영/);
  assert.match(viewSource, /if \(!operationsMode\) return;/);
  assert.match(viewSource, /공식 증권사 채널 PDF 승인 대기/);
  assert.match(
    viewSource,
    /\/api\/pb-daily-intelligence\/telegram-attachment-approvals/,
  );
  assert.match(viewSource, /\/api\/pb-daily-intelligence\/gmail-sender-reviews/);
  assert.match(viewSource, /승인 전에는 PDF 원문을 다운로드하지 않음/);
  assert.match(viewSource, /승인 PDF 수집·분석/);
  assert.match(viewSource, /구조화 분석 결과가 애널리스트 리포트에 반영됨/);
  assert.match(viewSource, /분석 결과 보기/);
  assert.match(viewSource, /daily-intelligence-attachment-analysis-preview/);
  assert.match(cssSource, /\.daily-intelligence-attachment-analysis-preview/);
  assert.match(
    viewSource,
    /daily-intelligence-approval-text-button daily-intelligence-approval-run-button/,
  );
  assert.match(
    cssSource,
    /\.daily-intelligence-approval-title-actions \.daily-intelligence-approval-run-button/,
  );
  assert.match(viewSource, /pendingPlan\?\.job\?\.id === "telegram_analyze"/);
});

test("sidebar and routes expose Research Operations as an independent screen", () => {
  assert.match(
    navigationSource,
    /label: "Research Operations", icon: ShieldCheck, view: "research-operations"/,
  );
  assert.match(routesSource, /activeView === "research-operations"/);
  assert.match(routesSource, /mode="operations"/);
});

test("institutional ownership stays outside the Daily Intelligence reading path", () => {
  assert.doesNotMatch(readerView, /<InstitutionalPortfolioRadar/);
  assert.match(
    navigationSource,
    /label: "기관 포트폴리오", icon: Building2, view: "institutional-portfolio"/,
  );
  assert.match(routesSource, /activeView === "institutional-portfolio"/);
  assert.match(routesSource, /<InstitutionalPortfolioView/);
});

test("market and sector detail panels live on an independent screen", () => {
  [
    "<h2>시장 판단 스코어보드</h2>",
    "<h2>섹터와 스타일 리더십</h2>",
    "<h2>미래 주도 섹터 선행지표</h2>",
    "<h2>시장 내부 구조</h2>",
    "<h2>한국시장 연결</h2>",
  ].forEach((heading) => assert.match(marketWorkspace, new RegExp(heading)));
  assert.doesNotMatch(readerView, /MARKET SCOREBOARD|SECTOR & STYLE LEADERSHIP|KOREA TRANSMISSION/);
  assert.match(
    navigationSource,
    /label: "시장·섹터", icon: ChartNoAxesCombined, view: "market-sectors"/,
  );
  assert.match(routesSource, /activeView === "market-sectors"/);
  assert.match(routesSource, /mode="market-sectors"/);
});

test("company research detail panels live on an independent screen", () => {
  assert.match(companyWorkspace, /<StockDecisionComparison/);
  assert.match(companyWorkspace, /<h2>미국 개별주 분석 후보<\/h2>/);
  assert.match(companyWorkspace, /<h2>실적·가이던스·추정치 변화<\/h2>/);
  assert.match(companyWorkspace, /onAddWatchlist=\{onAddWatchlist\}/);
  assert.doesNotMatch(
    readerView,
    /<StockDecisionComparison|US EQUITY CANDIDATES|EARNINGS INTELLIGENCE/,
  );
  assert.match(
    navigationSource,
    /label: "기업 리서치", icon: Search, view: "company-research"/,
  );
  assert.match(routesSource, /activeView === "company-research"/);
  assert.match(routesSource, /mode="company-research"/);
});

test("thesis journal owns decision coaching and calibration history", () => {
  assert.match(journalWorkspace, /<ThesisOutcomeAlerts calibration=\{calibration\}/);
  assert.match(journalWorkspace, /<DecisionCoach memory=\{thesisMemory\}/);
  assert.match(journalWorkspace, /<InvestmentThesisMemory/);
  assert.match(journalWorkspace, /onReviewMonthlyGoal=\{onReviewMonthlyGoal\}/);
  assert.doesNotMatch(readerView, /<DecisionCoach|<InvestmentThesisMemory/);
  assert.match(readerView, /<ThesisOutcomeAlerts[\s\S]*compact/);
  assert.match(
    navigationSource,
    /label: "투자 가설·복기", icon: BrainCircuit, view: "thesis-journal"/,
  );
  assert.match(routesSource, /activeView === "thesis-journal"/);
  assert.match(routesSource, /mode="thesis-journal"/);
});

test("Daily Intelligence is a compact decision home with specialist navigation", () => {
  assert.match(readerView, /<DailyWorkspaceShortcuts/);
  assert.match(readerView, /candidateCount=\{decisionChain\?\.ideaFunnel\?\.candidatePool\?\.length \|\| 0\}/);
  assert.match(readerView, /thesisAlertCount=\{thesisMemory\?\.weeklyCalibration\?\.alerts\?\.length \|\| 0\}/);
  assert.match(readerView, /daily-intelligence-supporting-details daily-intelligence-wide/);
  assert.match(readerView, /데이터 상태·원자료 확인/);
  assert.doesNotMatch(readerView, /<section className="daily-intelligence-panel">[\s\S]*?<span>DATA QUALITY<\/span>[\s\S]*?<\/section>[\s\S]*?<section className="daily-intelligence-panel">[\s\S]*?<span>PRIMARY SOURCES<\/span>/);
  assert.match(appSource, /onOpenMarketSectors: \(\) => setActiveView\("market-sectors"\)/);
  assert.match(appSource, /onOpenCompanyResearch: \(\) => setActiveView\("company-research"\)/);
  assert.match(appSource, /onOpenThesisJournal: \(\) => setActiveView\("thesis-journal"\)/);
  assert.match(appSource, /onOpenInstitutionalPortfolio: \(\) => setActiveView\("institutional-portfolio"\)/);
  assert.match(cssSource, /\.daily-intelligence-workspace-shortcuts-grid/);
  assert.match(cssSource, /\.daily-intelligence-supporting-details/);
});
