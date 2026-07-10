import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/transactions/TransactionStatusView.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("일별 시세 표는 상단 차트 주기와 독립적인 1일봉 페이지를 사용한다", () => {
  assert.match(source, /fetchTransactionInvestmentDetailCandles\(candleInstrument, "1d", controller\.signal, \{ force: true \}\)/);
  assert.match(source, /const dailyCandleRows = useMemo/);
  assert.match(source, /const displayDailyCandleRows = useMemo/);
  assert.match(source, /transactionInvestmentDisplayCandleRows\(dailyCandleRows, itemUnit, displayUnit, usdKrwRate\)/);
  assert.match(source, /<TransactionAssetDailyTable\s+rows=\{displayDailyCandleRows\}\s+unit=\{displayUnit\}/);
  assert.doesNotMatch(source, /<TransactionAssetDailyTable rows=\{rawCandleRows\}/);
  assert.doesNotMatch(source, /\.slice\(-12\)/);
});

test("일별 시세 표 하단은 before 커서로 이전 1일봉을 이어 불러온다", () => {
  assert.match(source, /function TransactionAssetDailyTable\(\{/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /rootMargin: "0px 0px 120px 0px"/);
  assert.match(source, /fetchTransactionInvestmentDetailCandles\(candleInstrument, "1d", controller\.signal, \{ before \}\)/);
  assert.match(source, /dailyCandleLoadedBeforeRef\.current\.has\(before\)/);
  assert.match(source, /mergeTransactionInvestmentCandleRows\(currentRows, nextRows, "1d"\)/);
  assert.match(source, /hasMore: nextPayload\?\.hasMore !== false && hasNewOlderRows/);
});

test("일별 시세 카드가 내부 스크롤 높이보다 작게 수축하지 않는다", () => {
  assert.match(
    styles,
    /\.transaction-asset-detail-scroll\s*\{[^}]*grid-auto-rows:\s*max-content;/s
  );
});
