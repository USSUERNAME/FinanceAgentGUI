import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPersonaModeSection,
  buildTransactionStatusContext,
  transactionStatusContextForPrompt,
  transactionStatusRagContextForPrompt,
} from "../server/codexProbe.mjs";
import { buildTransactionStatusContextPacket } from "../src/transactions/contextPacketBuilder.js";

function overviewSurface(kind, accountType) {
  return {
    schemaVersion: "transaction-status-display-data.v1",
    id: kind,
    title: accountType === "simulator" ? "투자 시뮬레이터 1 첫 페이지" : "내 투자 첫 페이지",
    kind,
    exposure: "context",
    summary: {
      status: "ready",
      accountType,
      holdingCount: 2,
      visibleRowCount: 2,
      totalValue: 3000000,
      displayUnit: "KRW",
    },
    data: {
      sidebarItems: [
        { symbol: "AAPL", name: "애플", value: 1800000 },
        { symbol: "MSFT", name: "마이크로소프트", value: 1200000 },
      ],
      tableColumns: [
        { id: "ticker", label: "티커 / 종목번호" },
        { id: "value", label: "평가금" },
      ],
      tableRows: [
        { symbol: "AAPL", value: 1800000, profitPercent: 12.5 },
        { symbol: "MSFT", value: 1200000, profitPercent: -2.1 },
      ],
    },
  };
}

test("transaction status loads the complete selected persona canonical prompt", () => {
  for (const [personaMode, personaLabel, canonicalAnchor, minimumLength] of [
    ["choi-hayoung", "\ucd5c\ud558\uc601", "투자는 정답 맞히기 게임이 아니라", 25_000],
    ["won-myunghee", "\uc6d0\uba85\ud76c", "복리는 늘 일찍 온 사람에게 의자를 내어주거든", 38_000],
  ]) {
    const promptSection = buildPersonaModeSection({
      screen: "transaction-status",
      personaMode,
    });

    assert.match(promptSection, /\[\uc77c\ubc18 \ucc44\ud305 \ud398\ub974\uc18c\ub098 \ubaa8\ub4dc\]/);
    assert.match(promptSection, new RegExp(`\uc120\ud0dd\ub41c \ud398\ub974\uc18c\ub098: ${personaLabel}`));
    assert.match(promptSection, /\[캐릭터 정본 시작\]/);
    assert.match(promptSection, new RegExp(canonicalAnchor));
    assert.match(promptSection, /\[FinanceAgentGUI 런타임 호환 규칙\]/);
    assert.ok(promptSection.length > minimumLength);
    assert.doesNotMatch(promptSection, /rss\.app|CSV FEED|chatgpt\.com\/g\//i);
  }
  assert.equal(
    buildPersonaModeSection({ screen: "transaction-status", personaMode: "none" }),
    "",
  );
});

test("live investment overview keeps sidebar positions and main table rows in direct context", () => {
  const packet = buildTransactionStatusContextPacket({
    activeSection: "investment",
    viewMode: "live-investment-overview",
    account: { type: "live", id: "1", label: "내 투자" },
    surface: overviewSurface("live-investment-overview", "live"),
  });
  const context = transactionStatusContextForPrompt(packet);

  assert.equal(context.account.type, "live");
  assert.equal(context.viewMode, "live-investment-overview");
  assert.equal(context.surfaces[0].data.sidebarItems[0].symbol, "AAPL");
  assert.equal(context.surfaces[0].data.tableRows[1].profitPercent, -2.1);
  assert.equal(context.surfaces[0].data.tableColumns[1].label, "평가금");
});

test("watchlist overview keeps the selected group and visible main rows in direct context", () => {
  const packet = buildTransactionStatusContextPacket({
    activeSection: "watchlist",
    viewMode: "watchlist-overview",
    selectedWatchlistGroup: { id: "growth", name: "성장주", instrumentCount: 2 },
    surface: {
      schemaVersion: "transaction-status-display-data.v1",
      id: "watchlist-overview",
      title: "성장주 메인",
      kind: "watchlist-overview",
      exposure: "context",
      summary: { groupName: "성장주", rowCount: 2, averageReturnLabel: "+1.2%" },
      data: {
        selectedGroup: { id: "growth", name: "성장주" },
        tableRows: [
          { symbol: "NVDA", dailyReturnPercent: 2.3 },
          { symbol: "AVGO", dailyReturnPercent: 0.1 },
        ],
      },
    },
  });
  const context = transactionStatusContextForPrompt(packet);

  assert.equal(context.activeSection, "watchlist");
  assert.equal(context.selectedWatchlistGroup.name, "성장주");
  assert.equal(context.surfaces[0].data.tableRows[0].symbol, "NVDA");
});

test("simulator overview uses the same direct list and table contract without becoming a live account", () => {
  const packet = buildTransactionStatusContextPacket({
    activeSection: "investment",
    viewMode: "simulator-investment-overview",
    account: { type: "simulator", id: "sim-1", label: "투자 시뮬레이터 1" },
    surface: overviewSurface("simulator-investment-overview", "simulator"),
  });
  const context = transactionStatusContextForPrompt(packet);

  assert.equal(context.account.type, "simulator");
  assert.equal(context.surfaces[0].summary.accountType, "simulator");
  assert.equal(context.surfaces[0].data.sidebarItems.length, 2);
  assert.equal(context.surfaces[0].data.tableRows.length, 2);
});

test("chart context keeps the summary direct and retrieves matching full candle rows through local RAG", () => {
  const candles = Array.from({ length: 420 }, (_, index) => ({
    time: `candle-${String(index).padStart(3, "0")}`,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: index === 317 ? 987654321 : 101 + index,
    marker: index === 317 ? "needle-chart-delta" : "ordinary",
  }));
  const packet = buildTransactionStatusContextPacket({
    activeSection: "investment",
    viewMode: "live-investment-chart-detail",
    account: { type: "live", id: "1", label: "내 투자" },
    surface: {
      schemaVersion: "transaction-status-display-data.v1",
      id: "investment-chart-detail",
      title: "AAPL 차트뷰",
      kind: "investment-chart-detail",
      exposure: "rag",
      summary: { symbol: "AAPL", chartMode: "candles", intervalMode: "1d", candleCount: candles.length },
      data: { displayedCandles: candles, volumeSeries: [] },
    },
  });
  const compact = transactionStatusContextForPrompt(packet);
  assert.equal(compact.surfaces[0].summary.candleCount, 420);
  assert.equal(compact.surfaces[0].retrieval.fullDataAvailable, true);
  assert.equal("data" in compact.surfaces[0], false);

  const rag = transactionStatusRagContextForPrompt(packet, "AAPL needle-chart-delta 987654321 캔들");
  assert.ok(rag.totalChunkCount > 1);
  assert.ok(rag.chunks.some((chunk) => JSON.stringify(chunk.data).includes("needle-chart-delta")));
  assert.ok(rag.chunks.some((chunk) => JSON.stringify(chunk.data).includes("987654321")));

  const prompt = buildTransactionStatusContext({
    screen: "transaction-status",
    transactionStatusContext: packet,
    transactionStatusRetrievalQuery: "needle-chart-delta",
  });
  assert.match(prompt, /내 투자 또는 모의투자 첫 페이지/);
  assert.match(prompt, /관심 목록 첫 페이지/);
  assert.match(prompt, /거래현황 차트 데이터 RAG 검색 결과/);
  assert.match(prompt, /실제 주문·실계좌 보유로 혼동하지 않는다/);
});

test("transaction status runtime wires all four rendered modes into the sidebar request", () => {
  const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const viewSource = readFileSync(new URL("../src/transactions/TransactionStatusView.jsx", import.meta.url), "utf8");

  assert.match(appSource, /transactionStatusContextRef = useRef\(null\)/);
  assert.match(appSource, /onContextChange=\{handleTransactionStatusContextChange\}/);
  assert.match(appSource, /transactionStatusContext: transactionStatusContextForMessage/);
  assert.match(appSource, /transactionStatusRetrievalQuery: screenForMessage === "transaction-status" \? promptTextForAgent : ""/);

  assert.match(viewSource, /kind: "live-investment-overview"/);
  assert.match(viewSource, /kind: "simulator-investment-overview"/);
  assert.match(viewSource, /kind: "watchlist-overview"/);
  assert.match(viewSource, /kind: "investment-chart-detail"/);
  assert.match(viewSource, /sidebarItems: items\.map/);
  assert.match(viewSource, /transactionSidebarPositionView\(item, displayUnit, sidebarValueMode, usdKrwRate\)/);
  assert.match(viewSource, /tableRows: filteredItems\.map/);
  assert.match(viewSource, /tableRows: rows\.map\(transactionWatchlistContextRow\)/);
  assert.match(viewSource, /displayedCandles: visibleCandleRows/);
  assert.match(viewSource, /displayedDailyCandles: displayDailyCandleRows/);
  assert.match(viewSource, /onDisplayData=\{handleContextSurfaceData\}/);
  assert.match(viewSource, /account: activeSection === "watchlist"/);
});
