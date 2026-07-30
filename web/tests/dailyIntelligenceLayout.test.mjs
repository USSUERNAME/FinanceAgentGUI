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
const cssSource = readFileSync(
  new URL("../src/dailyIntelligence/daily-intelligence.css", import.meta.url),
  "utf8",
);
const operationsStart = viewSource.indexOf("if (operationsMode)");
const readerStart = viewSource.indexOf("PB DAILY MARKET INTELLIGENCE", operationsStart);
const operationsView = viewSource.slice(operationsStart, readerStart);
const readerView = viewSource.slice(readerStart);

test("Daily Intelligence leads with decisions and links to a separate operations surface", () => {
  const readingPath = [
    "<DecisionGate",
    "<DecisionCoach",
    "<h2>30초 결론</h2>",
    "<MarketSectorStockChain",
    "<StockDecisionComparison",
    "<InvestmentThesisMemory",
    "<h2>내 종목과 오늘의 리포트</h2>",
    "<h2>결론을 지지하는 시장 근거</h2>",
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
  assert.match(viewSource, /candidatePool=\{decisionChain\?\.ideaFunnel\?\.candidatePool \|\| \[\]\}/);
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
  assert.match(viewSource, /승인 전에는 PDF 원문을 다운로드하지 않음/);
  assert.match(viewSource, /승인 PDF 수집·분석/);
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
