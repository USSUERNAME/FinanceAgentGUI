import assert from "node:assert/strict";
import test from "node:test";

import {
  arcaArticleImageProxyPath,
  extractArcaArticleDetailFromHtml,
  extractArcaCommentsFromHtml,
  isAllowedArcaImageProxyUrl,
  isArcaImageClientDisconnectError,
  isArcaTwemojiSvgUrl,
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
  assert.match(article.contentHtml, /<p>첫 번째 문단입니다\.<\/p>/);
  assert.match(article.contentHtml, /<script>window\.bad = true<\/script>/);
});

test("댓글 원본 HTML과 링크 요약 박스 및 스크립트를 보존한다", () => {
  const html = `
    <html>
      <body>
        <div class="comment-item" id="c_123">
          <div class="user-info"><span data-filter="댓글작성자#1234"></span></div>
          <div class="message">
            <div class="text">
              <p>댓글 본문입니다.</p>
              <a class="domain-preview" href="/b/stock/321">
                <div class="domain-preview-title">요약 제목</div>
                <div class="domain-preview-description">요약 설명</div>
              </a>
              <script>window.commentPreviewReady = true;</script>
            </div>
          </div>
          <div class="info-row"><time datetime="2026-07-22T01:00:00.000Z"></time></div>
        </div>
      </body>
    </html>
  `;

  const payload = extractArcaCommentsFromHtml(html);
  const [comment] = payload.comments;

  assert.equal(comment.id, "123");
  assert.equal(comment.text.includes("댓글 본문입니다."), true);
  assert.match(comment.html, /class="domain-preview"/);
  assert.match(comment.html, /href="\/b\/stock\/321"/);
  assert.match(comment.html, /<script>window\.commentPreviewReady = true;<\/script>/);
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

test("아카라이브 Twemoji SVG는 이미지 오류 대상이 아니라 본문 이모지로 복원한다", () => {
  const html = `
    <html>
      <head><meta property="og:title" content="이모지 본문" /></head>
      <body>
        <div class="article-content">
          <p>지수가 <img src="/node_modules/twemoji/assets/svg/1f4c9.svg" alt="📉" /> 하락했습니다.</p>
        </div>
      </body>
    </html>
  `;

  const article = extractArcaArticleDetailFromHtml(html, {
    url: "https://arca.live/b/stock/999",
  });

  assert.equal(article.contentText, "지수가 📉 하락했습니다.");
  assert.deepEqual(article.contentBlocks, [{ type: "paragraph", text: "지수가 📉 하락했습니다." }]);
  assert.deepEqual(article.imageUrls, []);
  assert.deepEqual(article.readerImageSourceUrls, []);
});

test("본문의 목록, 표, 볼드, 링크와 인용 서식을 구조적으로 보존한다", () => {
  const html = `
    <html>
      <head><meta property="og:title" content="서식 본문" /></head>
      <body>
        <div class="article-content">
          <p>일반 <strong>중요 문장</strong>과 <a href="/b/stock/321">관련 링크</a>입니다.<br />다음 줄입니다.</p>
          <blockquote><b>인용 핵심</b>과 설명입니다.</blockquote>
          <ul><li>첫 항목</li><li><strong>둘째</strong> 항목</li></ul>
          <ol><li>첫 단계</li><li>둘째 단계</li></ol>
          <table>
            <thead><tr><th>종목</th><th>등락</th></tr></thead>
            <tbody><tr><td><strong>ABC</strong></td><td><a href="https://example.com/chart">+3%</a></td></tr></tbody>
          </table>
        </div>
      </body>
    </html>
  `;

  const article = extractArcaArticleDetailFromHtml(html, {
    url: "https://arca.live/b/stock/1000",
  });

  assert.deepEqual(
    article.contentBlocks.map((block) => block.type),
    ["paragraph", "quote", "list", "list", "table"]
  );
  assert.equal(article.contentBlocks[0].segments[1].bold, true);
  assert.equal(article.contentBlocks[0].segments[3].href, "https://arca.live/b/stock/321");
  assert.equal(article.contentBlocks[0].text, "일반 중요 문장과 관련 링크입니다.\n다음 줄입니다.");
  assert.equal(article.contentBlocks[0].segments.some((segment) => segment.lineBreak), true);
  assert.equal(article.contentBlocks[1].segments[0].bold, true);
  assert.equal(article.contentBlocks[2].ordered, false);
  assert.deepEqual(article.contentBlocks[2].items.map((item) => item.text), ["첫 항목", "둘째 항목"]);
  assert.equal(article.contentBlocks[2].items[1].segments[0].bold, true);
  assert.equal(article.contentBlocks[3].ordered, true);
  assert.deepEqual(article.contentBlocks[4].headers.map((cell) => cell.text), ["종목", "등락"]);
  assert.deepEqual(article.contentBlocks[4].rows[0].map((cell) => cell.text), ["ABC", "+3%"]);
  assert.equal(article.contentBlocks[4].rows[0][0].segments[0].bold, true);
  assert.equal(article.contentBlocks[4].rows[0][1].segments[0].href, "https://example.com/chart");
});

test("nbsp와 br만 있는 p 태그를 빈 문단 간격으로 보존한다", () => {
  const html = `
    <html>
      <head><meta property="og:title" content="빈 문단 본문" /></head>
      <body>
        <div class="article-content">
          <p>첫 문단</p>
          <p>&nbsp;</p>
          <p><span>&nbsp;</span></p>
          <p><br /></p>
          <p>마지막 문단</p>
        </div>
      </body>
    </html>
  `;

  const article = extractArcaArticleDetailFromHtml(html, {
    url: "https://arca.live/b/stock/1001",
  });

  assert.deepEqual(
    article.contentBlocks.map((block) => block.type),
    ["paragraph", "spacer", "spacer", "spacer", "paragraph"]
  );
  assert.equal(article.contentBlocks.filter((block) => block.type === "spacer").length, 3);
});

test("Twemoji 판별은 같은 Arca origin의 공식 SVG 경로에만 적용한다", () => {
  assert.equal(isArcaTwemojiSvgUrl("https://arca.live/node_modules/twemoji/assets/svg/1f4c9.svg"), true);
  assert.equal(isArcaTwemojiSvgUrl("/node_modules/twemoji/assets/svg/1f4c9.svg"), true);
  assert.equal(isArcaTwemojiSvgUrl("https://example.com/node_modules/twemoji/assets/svg/1f4c9.svg"), false);
  assert.equal(isArcaTwemojiSvgUrl("https://arca.live/assets/chart.svg"), false);
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
