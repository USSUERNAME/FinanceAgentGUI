import assert from "node:assert/strict";
import test from "node:test";

import { isArcaLoginPage } from "../server/arcaApi.mjs";

test("알림 페이지의 일반 로그인 문구를 인증 실패로 오인하지 않는다", () => {
  const html = `
    <html>
      <head><title>알림</title></head>
      <body>
        <nav><a href="/u/login">다른 계정으로 로그인</a></nav>
        <div class="notification-items">
          <div class="row section">새 알림</div>
        </div>
      </body>
    </html>
  `;

  assert.equal(isArcaLoginPage({ url: "https://arca.live/u/notification" }, html), false);
});

test("로그인 URL은 인증 필요 상태로 판정한다", () => {
  assert.equal(isArcaLoginPage({ url: "https://arca.live/u/login?goto=%2Fu%2Fnotification" }, ""), true);
});

test("비밀번호 입력 폼은 인증 필요 상태로 판정한다", () => {
  const html = '<form class="account-form"><input type="password" name="password"></form>';

  assert.equal(isArcaLoginPage({ url: "https://arca.live/u/notification" }, html), true);
});
