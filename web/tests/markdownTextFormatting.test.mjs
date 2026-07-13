import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isMarkdownThematicBreak,
  normalizeMarkdownDisplayText,
} from "../src/utils/markdownTextUtils.js";

test("chat markdown display drops nonbreaking-space entities into ordinary blank lines", () => {
  assert.equal(
    normalizeMarkdownDisplayText("# 제목\n&nbsp;\n본문\n&#160;\n다음 문단"),
    "# 제목\n\n본문\n\n다음 문단",
  );
});

test("chat markdown display inserts a blank line before an H1 appended to progress prose", () => {
  assert.equal(
    normalizeMarkdownDisplayText(
      "영어 검색부터 시작해 공식 IR을 교차확인하겠습니다. 정리할게요.# ✈️ 델타항공 실적 비트",
    ),
    "영어 검색부터 시작해 공식 IR을 교차확인하겠습니다. 정리할게요.\n\n# ✈️ 델타항공 실적 비트",
  );
});

test("chat markdown boundary repair does not rewrite fenced code", () => {
  assert.equal(
    normalizeMarkdownDisplayText("```text\n문자열# 제목 아님\n```"),
    "```text\n문자열# 제목 아님\n```",
  );
});

test("chat markdown renderer preserves semantic H1 through H3 tags", () => {
  const source = readFileSync(new URL("../src/utils/MarkdownText.jsx", import.meta.url), "utf8");
  assert.match(source, /const Tag = `h\$\{headingLevel\}`/);
  assert.match(source, /markdown-heading-h\$\{headingLevel\}/);
  assert.doesNotMatch(source, /heading\[1\]\.length \+ 2/);
});

test("shared chat and report markdown renderer converts thematic breaks to hr", () => {
  assert.equal(isMarkdownThematicBreak("---"), true);
  assert.equal(isMarkdownThematicBreak("- - -"), true);
  assert.equal(isMarkdownThematicBreak("***"), true);
  assert.equal(isMarkdownThematicBreak("___"), true);
  assert.equal(isMarkdownThematicBreak("--"), false);
  assert.equal(isMarkdownThematicBreak("--- 설명"), false);

  const source = readFileSync(new URL("../src/utils/MarkdownText.jsx", import.meta.url), "utf8");
  assert.match(source, /isMarkdownThematicBreak\(line\)/);
  assert.match(source, /<hr className="markdown-thematic-break"/);
});

test("all chat provider prompts share the visible reasoning-to-answer line break contract", () => {
  const source = readFileSync(new URL("../server/codexProbe.mjs", import.meta.url), "utf8");
  const agentsSource = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");
  assert.match(source, /중간 판단 요약을 먼저 쓴 뒤 최종 답변을 이어 쓸 때는 반드시 빈 줄 하나/);
  assert.equal((source.match(/CHAT_MARKDOWN_BOUNDARY_INSTRUCTION/g) || []).length, 4);
  assert.match(agentsSource, /In every situation/);
  assert.match(agentsSource, /insert one blank line before the final answer/);
});
