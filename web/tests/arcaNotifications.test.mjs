import assert from "node:assert/strict";
import test from "node:test";

import {
  extractArcaNotificationsFromHtml,
  normalizeArcaNotificationApiPayload,
} from "../server/arcaApi.mjs";

test("아카라이브 알림 목록에서 읽음 상태와 채널 글 대상을 구조화한다", () => {
  const html = `
    <html>
      <head><title>알림</title></head>
      <body>
        <div class="notification-items">
          <div class="row section m-0">
            <input type="checkbox" name="notification-item" value="notification-1" />
            <div class="vrow-icon"></div>
            <div class="col row">
              <a href="/u/@alpha" data-filter="alpha#1234">alpha</a>님이
              <a href="/b/stock/123/456">주식채널 댓글 알림</a>에 답글을 남겼습니다.
              <time datetime="2026-07-21T13:19:34.000Z"></time>
            </div>
          </div>
          <div class="row section m-0">
            <input type="checkbox" name="notification-item" value="notification-2" />
            <div class="vrow-icon read"></div>
            <div class="col row read">
              <a href="/u/@beta" data-filter="beta">beta</a>님이
              <a href="/b/aiart/789">다른 채널 새 글</a>을 등록했습니다.
              <time datetime="2026-07-21T12:00:00.000Z"></time>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  const result = extractArcaNotificationsFromHtml(html);

  assert.equal(result.count, 1);
  assert.equal(result.countSource, "unread-section");
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    id: "notification-1",
    unread: true,
    title: "주식채널 댓글 알림",
    summary: "alpha님이주식채널 댓글 알림에 답글을 남겼습니다.",
    author: "alpha#1234",
    createdAt: "2026-07-21T13:19:34.000Z",
    targetUrl: "https://arca.live/b/stock/123/456",
    channel: "stock",
    articleId: "123",
    commentId: "456",
    isStockChannel: true,
  });
  assert.equal(result.items[1].unread, false);
  assert.equal(result.items[1].channel, "aiart");
  assert.equal(result.items[1].isStockChannel, false);
});

test("아카라이브 알림 JSON은 opaque token을 노출하지 않고 안전한 글 링크만 정규화한다", () => {
  const result = normalizeArcaNotificationApiPayload({
    notifications: [
      {
        token: "do-not-expose-this-token",
        type: "comment",
        time: 1784639974,
        title: "주식채널 댓글 알림",
        isRead: false,
        link: "/b/stock/123/456",
        username: "alpha#1234",
      },
      {
        token: "another-token",
        type: "board",
        time: 1784638800,
        title: "다른 채널 새 글",
        isRead: true,
        link: "/b/aiart/789",
        username: "beta",
      },
      {
        token: "external-token",
        type: "link",
        time: 1784638800,
        title: "외부 링크",
        isRead: false,
        link: "https://example.com/post/1",
        username: "gamma",
      },
    ],
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.unreadCount, 1);
  assert.equal(result.items[0].id.includes("do-not-expose"), false);
  assert.equal(result.items[0].isStockChannel, true);
  assert.equal(result.items[1].isStockChannel, false);
});

test("알림 항목이 아닌 채널 홈과 외부 링크는 목록 대상에서 제외한다", () => {
  const html = `
    <div class="notification-items">
      <div class="row section">
        <div class="vrow-icon"></div>
        <div class="col row">
          <a href="/b/stock">주식채널</a>
          <a href="https://example.com/post/1">외부 링크</a>
        </div>
      </div>
    </div>
  `;

  const result = extractArcaNotificationsFromHtml(html);
  assert.equal(result.items.length, 0);
});
