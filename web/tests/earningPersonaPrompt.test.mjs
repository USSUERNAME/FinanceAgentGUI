import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildEarningPersonaModeSection,
  buildPersonaModeSection,
} from "../server/codexProbe.mjs";

const sourceFiles = [
  "earnings-persona-routing.txt",
  "choi-hayoung-instructions.txt",
  "won-myunghee-instructions.txt",
  "druckenmiller-soros-quotes.txt",
  "buffett-dalio-quotes.txt",
  "output-example.txt",
];

test("earning analysis loads all six canon sources for either enabled persona", () => {
  const hayoung = buildEarningPersonaModeSection({
    screen: "earning-calendar",
    personaMode: "choi-hayoung",
  });
  const myunghee = buildEarningPersonaModeSection({
    screen: "earning-calendar",
    personaMode: "won-myunghee",
  });

  assert.equal(hayoung, myunghee);
  assert.ok(hayoung.length > 40_000);
  assert.match(hayoung, /설정에서 선택된 인물은 이번 실적 분석의 화자를 고정하지 않는다/);
  assert.match(hayoung, /캐릭터는 사용자를 '너'라고 부른다/);
  assert.match(hayoung, /하영&명희의 확률은 약 10%/);
  assert.match(hayoung, /## 하영과 명희가 설명하는 현황 및 전망/);
  assert.match(hayoung, /첫 줄은 반드시 '# '로 시작하는 H1 Markdown 제목/);
  assert.match(hayoung, /중간 추론 문장은 최종 답변 본문에 쓰지 않는다/);
  assert.match(hayoung, /상태 문장 끝에 # 제목을 이어 붙이지 않는다/);
  assert.doesNotMatch(hayoung, /&nbsp;|&#160;/i);

  for (const fileName of sourceFiles) {
    const source = readFileSync(
      resolve("../config/earnings-analysis", fileName),
      "utf8",
    ).trim();
    assert.ok(hayoung.includes(source), `${fileName} must be included verbatim`);
  }
});

test("earning analysis canon is disabled only when persona mode is off", () => {
  assert.equal(
    buildEarningPersonaModeSection({ screen: "earning-calendar", personaMode: "none" }),
    "",
  );
  assert.equal(
    buildEarningPersonaModeSection({ screen: "economic-calendar", personaMode: "choi-hayoung" }),
    "",
  );
  assert.equal(
    buildPersonaModeSection({ screen: "earning-calendar", personaMode: "choi-hayoung" }),
    buildEarningPersonaModeSection({ screen: "earning-calendar", personaMode: "choi-hayoung" }),
  );
});

test("earning analysis request forwards persona state and requires web research", () => {
  const appSource = readFileSync(resolve("src/App.jsx"), "utf8");
  const analysisStart = appSource.indexOf("async function analyzeEarningEvent(event)");
  const analysisEnd = appSource.indexOf("const defaultAgentRuntime", analysisStart);
  const analysisSource = appSource.slice(analysisStart, analysisEnd);

  assert.match(analysisSource, /personaMode,\s*screen: "earning-calendar"/);
  assert.match(analysisSource, /requireWebSearch: true/);
});
