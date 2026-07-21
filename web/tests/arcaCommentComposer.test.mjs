import assert from "node:assert/strict";
import test from "node:test";

import {
  createArcaEmoticonCommentPayload,
  MAX_COMBOCON_ITEMS,
  shouldSubmitCommentFromKeyEvent,
} from "../src/arca/commentComposer.js";

test("일반 Enter만 댓글을 즉시 등록하고 Shift+Enter와 IME 확정 Enter는 보존한다", () => {
  assert.equal(shouldSubmitCommentFromKeyEvent({ key: "Enter" }), true);
  assert.equal(shouldSubmitCommentFromKeyEvent({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSubmitCommentFromKeyEvent({ key: "Enter", isComposing: true }), false);
  assert.equal(shouldSubmitCommentFromKeyEvent({ key: "Enter", nativeEvent: { isComposing: true } }), false);
  assert.equal(shouldSubmitCommentFromKeyEvent({ key: "Enter", keyCode: 229 }), false);
  assert.equal(shouldSubmitCommentFromKeyEvent({ key: "a" }), false);
});

test("아카콘과 콤보콘 요청은 최대 3개의 선택 순서를 유지한다", () => {
  assert.equal(MAX_COMBOCON_ITEMS, 3);
  assert.deepEqual(createArcaEmoticonCommentPayload([
    { packageId: 10, id: 101 },
    { packageId: 20, id: 202 },
    { packageId: 20, id: 202 },
  ]), {
    contentType: "emoticon",
    content: "",
    emoticons: [
      { emoticonId: 10, attachmentId: 101 },
      { emoticonId: 20, attachmentId: 202 },
      { emoticonId: 20, attachmentId: 202 },
    ],
  });
  assert.equal(createArcaEmoticonCommentPayload([]), null);
  assert.equal(createArcaEmoticonCommentPayload([
    { packageId: 1, id: 1 },
    { packageId: 1, id: 2 },
    { packageId: 1, id: 3 },
    { packageId: 1, id: 4 },
  ]), null);
});
