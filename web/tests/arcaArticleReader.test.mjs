import assert from "node:assert/strict";
import test from "node:test";

import {
  arcaArticleImageProxyPath,
  extractArcaArticleDetailFromHtml,
  isAllowedArcaImageProxyUrl,
  isArcaImageClientDisconnectError,
} from "../server/arcaApi.mjs";

test("아카라이브 글 본문을 안전한 읽기 블록 순서로 추출한다", () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="테스트 글 - 주식 채널" />
        <meta property="og:url" content="https://arca.live/b/stock/123" />
        <meta name="author" content="작성자#1234" />
      </head>
      <body>
        <div class="article-info"><time datetime="2026-07-21T09:28:53.000Z"></time></div>
        <div class="article-content">
          <p>첫 번째 문단입니다.</p>
          <blockquote>인용문입니다.</blockquote>
          <h2>소제목</h2>
          <p>두 번째 문단입니다.<img src="/assets/chart.png" alt="차트" /></p>
          <script>window.bad = true</script>
        </div>
        <span class="comment-count">[37]</span>
      </body>
    </html>
  `;

  const article = extractArcaArticleDetailFromHtml(html, {
    url: "https://arca.live/b/stock/123",
  });

  assert.equal(article.title, "테스트 글");
  assert.equal(article.author, "작성자#1234");
  assert.equal(article.commentCount, 37);
  assert.deepEqual(
    article.contentBlocks.map((block) => block.type),
    ["paragraph", "quote", "heading", "paragraph", "image"]
  );
  assert.equal(article.contentBlocks[0].text, "첫 번째 문단입니다.");
  assert.equal(article.contentBlocks[4].src, "https://arca.live/assets/chart.png");
  assert.equal(article.contentBlocks.some((block) => block.text?.includes("window.bad")), false);
});

test("읽기 블록 이미지 URL은 http와 https만 허용한다", () => {
  const html = `
    <html>
      <head><meta property="og:title" content="이미지 보안" /></head>
      <body>
        <div class="article-content">
          <p>본문</p>
          <img src="javascript:alert(1)" alt="차단 이미지" />
          <img src="https://cdn.example.com/safe.png" alt="안전 이미지" />
        </div>
      </body>
    </html>
  `;

  const article = extractArcaArticleDetailFromHtml(html, {
    url: "https://arca.live/b/stock/456",
  });

  assert.deepEqual(article.imageUrls, ["https://cdn.example.com/safe.png"]);
  assert.deepEqual(
    article.contentBlocks.filter((block) => block.type === "image").map((block) => block.src),
    ["https://cdn.example.com/safe.png"]
  );
});

test("읽기 화면은 CDN 표시용 이미지를 쓰고 원본 URL을 별도로 보존한다", () => {
  const html = `
    <html>
      <head><meta property="og:title" content="표시 이미지" /></head>
      <body>
        <div class="article-content">
          <img
            src="//ac-p1.namu.la/preview.jpg?key=test"
            data-originalurl="https://ac-o.namu.la/original.jpg?key=test&type=orig"
            alt="테스트 이미지"
          />
        </div>
      </body>
    </html>
  `;

  const article = extractArcaArticleDetailFromHtml(html, {
    url: "https://arca.live/b/stock/789",
  });

  assert.deepEqual(article.imageUrls, ["https://ac-o.namu.la/original.jpg?key=test&type=orig"]);
  assert.deepEqual(article.readerImageSourceUrls, ["https://ac-p1.namu.la/preview.jpg?key=test"]);
  assert.equal(article.contentBlocks[0].src, "https://ac-o.namu.la/original.jpg?key=test&type=orig");
  assert.equal(article.contentBlocks[0].readerSrc, "https://ac-p1.namu.la/preview.jpg?key=test");
});

test("이미지 프록시는 아카라이브, namu.la CDN, 기본 Gravatar만 허용한다", () => {
  assert.equal(isAllowedArcaImageProxyUrl("https://arca.live/assets/image.png"), true);
  assert.equal(isAllowedArcaImageProxyUrl("https://ac-o.namu.la/20260721/image.png?key=test"), true);
  assert.equal(isAllowedArcaImageProxyUrl("https://secure.gravatar.com/avatar/hash?d=retro&f=y"), true);
  assert.equal(isAllowedArcaImageProxyUrl("http://ac-o.namu.la/image.png"), false);
  assert.equal(isAllowedArcaImageProxyUrl("https://namu.la.example.com/image.png"), false);
  assert.equal(isAllowedArcaImageProxyUrl("https://secure.gravatar.com.example.com/avatar/hash"), false);
  assert.equal(isAllowedArcaImageProxyUrl("https://images.gravatar.com/avatar/hash"), false);
  assert.equal(isAllowedArcaImageProxyUrl("https://127.0.0.1/private.png"), false);
});

test("기존 아카라이브 API 아래의 로컬 이미지 경로를 만든다", () => {
  const source = "https://ac-o.namu.la/image.png?expires=1&key=a b";
  assert.equal(
    arcaArticleImageProxyPath(source),
    `/api/arca/article/image?url=${encodeURIComponent(source)}`
  );
});

test("브라우저가 이미지 연결을 취소해도 서버 종료 오류로 취급하지 않는다", () => {
  assert.equal(isArcaImageClientDisconnectError({ code: "EPIPE" }), true);
  assert.equal(isArcaImageClientDisconnectError({ code: "ECONNRESET" }), true);
  assert.equal(isArcaImageClientDisconnectError({ code: "ETIMEDOUT" }), false);
});
