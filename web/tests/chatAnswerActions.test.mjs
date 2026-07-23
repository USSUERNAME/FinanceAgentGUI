import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  formatChatAnswerClipboardHtml,
  formatChatAnswerClipboardText,
  writeChatAnswerToClipboard,
} from "../src/agent/chatAnswerActions.js";

test("chat answer clipboard formatting removes HTML spacing and keeps one blank line between blocks", () => {
  assert.equal(
    formatChatAnswerClipboardText(
      "# 제목\n&nbsp;\n## 개요\n첫 문단\n\n\n둘째 문단\n---\n마지막 문단",
    ),
    "# 제목\n\n## 개요\n\n첫 문단\n\n둘째 문단\n\n---\n\n마지막 문단",
  );
});

test("chat answer clipboard formatting separates progress prose from an appended H1", () => {
  assert.equal(
    formatChatAnswerClipboardText("정리할게요.# ✈️ 델타항공 실적 비트\n본문"),
    "정리할게요.\n\n# ✈️ 델타항공 실적 비트\n\n본문",
  );
});

test("chat answer HTML clipboard payload converts thematic breaks to hr", () => {
  const html = formatChatAnswerClipboardHtml("# 제목\n\n본문\n\n---\n\n결론");
  assert.match(html, /<hr>/);
  assert.doesNotMatch(html, />---</);
  assert.match(html, /<h1>제목<\/h1><br>/);
  assert.match(html, /결론/);
});

test("chat report copy preserves H1 spacing, source links, and semantic lists", () => {
  const html = formatChatAnswerClipboardHtml(
    [
      "# 어닝 분석",
      "",
      "- [공식 출처](https://example.com/official)",
      "- [교차 검증](https://example.com/check)",
      "",
      "## 개요",
      "",
      "- 기업명: Example Corp.",
      "- 결과: **어닝 비트**",
    ].join("\n"),
  );

  assert.match(html, /<h1>어닝 분석<\/h1><br>/);
  assert.equal((html.match(/<ul>/g) || []).length, 2);
  assert.equal((html.match(/<li>/g) || []).length, 4);
  assert.match(html, /<a href="https:\/\/example\.com\/official">공식 출처<\/a>/);
  assert.match(html, /<strong>어닝 비트<\/strong>/);
  assert.doesNotMatch(html, /white-space:pre-wrap/);
});

test("chat report copy keeps Markdown tables as semantic HTML tables", () => {
  const html = formatChatAnswerClipboardHtml(
    "| 항목 | 값 |\n|---|---:|\n| EPS | **$6.14** |\n| NII | $25.62B |",
  );
  assert.match(html, /<table>/);
  assert.equal((html.match(/<th>/g) || []).length, 2);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.match(html, /<strong>\$6\.14<\/strong>/);
});

test("chat answer copy writes only the trimmed answer body", async () => {
  const calls = [];
  const copied = await writeChatAnswerToClipboard("  # 답변\n\n본문  ", {
    async writeText(value) {
      calls.push(value);
    },
  });

  assert.equal(copied, "# 답변\n\n본문");
  assert.deepEqual(calls, ["# 답변\n\n본문"]);
});

test("chat answer copy falls back when the async clipboard rejects", async () => {
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
    focus() {},
    select() {},
    remove() {},
  };
  const documentRef = {
    body: { appendChild() {} },
    createElement() {
      return textarea;
    },
    execCommand(command) {
      return command === "copy";
    },
  };
  const copied = await writeChatAnswerToClipboard(
    "폴백 복사",
    { async writeText() { throw new Error("denied"); } },
    documentRef,
  );

  assert.equal(copied, "폴백 복사");
  assert.equal(textarea.value, "폴백 복사");
});

test("chat answer copy prefers the structured clipboard API when available", async () => {
  const writes = [];
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
    }
  }
  class FakeClipboardItem {
    constructor(payload) {
      this.payload = payload;
    }
  }
  const copied = await writeChatAnswerToClipboard(
    "구조화 복사",
    { async write(items) { writes.push(items); } },
    null,
    900,
    FakeClipboardItem,
    FakeBlob,
  );

  assert.equal(copied, "구조화 복사");
  assert.equal(writes[0][0].payload["text/plain"].parts[0], "구조화 복사");
  assert.equal(writes[0][0].payload["text/html"].type, "text/html");
});

test("structured chat clipboard includes hr HTML and preserves the Markdown rule in plain text", async () => {
  const writes = [];
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
    }
  }
  class FakeClipboardItem {
    constructor(payload) {
      this.payload = payload;
    }
  }
  await writeChatAnswerToClipboard(
    "앞 문단\n\n---\n\n뒤 문단",
    { async write(items) { writes.push(items); } },
    null,
    900,
    FakeClipboardItem,
    FakeBlob,
  );

  const payload = writes[0][0].payload;
  assert.match(payload["text/html"].parts[0], /<hr>/);
  assert.equal(payload["text/plain"].parts[0], "앞 문단\n\n---\n\n뒤 문단");
});

test("the shared chat renderer wires copy and report actions across both chat surfaces", () => {
  const messagesSource = readFileSync(new URL("../src/agent/ChatMessages.jsx", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../src/agent/AgentSidebar.jsx", import.meta.url), "utf8");
  const canvasSource = readFileSync(new URL("../src/agent/ChatCanvas.jsx", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const routesSource = readFileSync(new URL("../src/shell/AppRoutes.jsx", import.meta.url), "utf8");

  assert.match(messagesSource, /"답변 복사"/);
  assert.match(messagesSource, /"답변을 보고서에 저장"/);
  assert.match(messagesSource, /copyState === "success" \? Check : Copy/);
  assert.match(messagesSource, /reportState === "success" \? Check/);
  assert.match(sidebarSource, /onSaveAnswerToReports=\{onSaveAnswerToReports\}/);
  assert.match(canvasSource, /onSaveAnswerToReports=\{onSaveAnswerToReports\}/);
  assert.match(appSource, /onSaveAnswerToReports=\{saveChatAnswerToReports\}/);
  assert.match(appSource, /chat: \(\) => \(\{[\s\S]*?onSaveAnswerToReports: saveChatAnswerToReports,/);
  assert.match(routesSource, /<ChatCanvas \{\.\.\.models\.chat\(\)\} \/>/);
});
