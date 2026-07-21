import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStockArticleContext,
  stockArticleContextForPrompt,
} from "../server/codexProbe.mjs";

test("주식채널 읽기 본문을 안전한 사이드바 컨텍스트로 정규화한다", () => {
  const context = stockArticleContextForPrompt({
    source: "stock-channel-reader",
    id: "123",
    url: "https://arca.live/b/stock/123",
    title: "테스트 글",
    categoryLabel: "정보",
    author: "작성자#1234",
    publishedAt: "2026-07-21T09:28:53.000Z",
    publishedTimeLabel: "2026년 7월 21일 오후 06:28",
    stats: { views: 10, recommendations: 4, comments: 2 },
    bodyText: "본문입니다.",
    images: ["https://ac-o.namu.la/image.png"],
  });

  assert.equal(context.title, "테스트 글");
  assert.equal(context.bodyText, "본문입니다.");
  assert.deepEqual(context.stats, { views: 10, recommendations: 4, comments: 2 });
  assert.deepEqual(context.images, ["https://ac-o.namu.la/image.png"]);
});

test("주식채널 화면에서만 현재 글 컨텍스트를 프롬프트에 넣는다", () => {
  const payload = {
    screen: "stock",
    stockArticleContext: {
      title: "상당한 성능의 국산 AI가 나왔다는 듯",
      bodyText: "현재 열린 글의 본문",
    },
  };

  const promptContext = buildStockArticleContext(payload);
  assert.match(promptContext, /\[현재 주식채널 글 컨텍스트\]/);
  assert.match(promptContext, /현재 열린 글의 본문/);
  assert.equal(buildStockArticleContext({ ...payload, screen: "magazine" }), "");
});
