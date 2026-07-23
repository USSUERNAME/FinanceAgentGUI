import test from "node:test";
import assert from "node:assert/strict";
import {
  allEligibleNewsEvidence,
  articleMarkdownToHtml,
  buildAllCandidateTopicPrompt,
  buildSimpleMagazinePrompt,
  compactNewsEvidence,
  inspectCodexJsonl,
  normalizeDiscoveredTopic,
  normalizeSimpleArticle,
  selectNewsEvidence,
} from "../../scripts/magazine_generate_simple.mjs";

const topic = {
  title: "알파벳의 첫 현금흐름 적자",
  articleType: "analysis",
  storyFamily: "AI 자본지출",
  editorialAngle: "현금흐름과 매도 제한 자산을 분리해 본다",
};

const evidence = [
  {
    id: "nf_1",
    source: "Test Wire",
    publishedAt: "2026-07-23T00:00:00.000Z",
    headline: "알파벳이 첫 분기 잉여현금흐름 적자를 기록했다.",
    url: "https://example.com/1",
  },
];

test("simple prompt contains exactly three prose exemplars and no repository instructions", () => {
  const prompt = buildSimpleMagazinePrompt({
    topic,
    evidence,
    exemplars: [1, 2, 3].map((index) => ({
      id: `example-${index}`,
      title: `예시 ${index}`,
      article: `예시 본문 ${index}`,
    })),
  });
  assert.equal((prompt.match(/=== 문체 예시/g) || []).length, 3);
  assert.match(prompt, /도구, 웹 검색, 파일 읽기, 추가 조사를 하지 말고/);
  assert.match(prompt, /편집 표찰을 노출하지 말고 실제 주장이나 쟁점을 쓰십시오/);
  assert.match(prompt, /publicationReady=false/);
  assert.match(prompt, /알파벳의 첫 현금흐름 적자/);
  assert.doesNotMatch(prompt, /AGENTS\.md|docs\/magazine\.md|\[편집 지도\]/);
});

test("news evidence selector keeps only requested live items in requested order", () => {
  const newsFeed = {
    items: [
      {
        id: "nf_2",
        feedTitle: "Second",
        title: "SECOND",
        translatedTitle: "두 번째",
        sourceUrl: "https://example.com/2",
        publishedAt: "2026-07-23T02:00:00.000Z",
      },
      {
        id: "nf_1",
        feedTitle: "First",
        title: "FIRST",
        translatedTitle: "첫 번째",
        sourceUrl: "https://example.com/1",
        publishedAt: "2026-07-23T01:00:00.000Z",
      },
    ],
  };
  assert.deepEqual(
    selectNewsEvidence(newsFeed, ["nf_1", "nf_2"]).map((item) => item.id),
    ["nf_1", "nf_2"],
  );
  assert.equal(compactNewsEvidence(newsFeed.items[0]).headline, "두 번째");
  assert.throws(() => selectNewsEvidence(newsFeed, ["nf_missing"]), /찾을 수 없습니다/);
});

test("all-candidate discovery includes every item after the World Memory cutoff without a count cap", () => {
  const newsFeed = {
    items: Array.from({ length: 61 }, (_, index) => ({
      id: `nf_${index}`,
      feedTitle: "Test Wire",
      title: `headline ${index}`,
      translatedTitle: `후보 ${index}`,
      publishedAt: new Date(Date.parse("2026-07-23T00:00:00.000Z") + index * 1_000).toISOString(),
    })),
  };
  const eligible = allEligibleNewsEvidence(newsFeed, {
    collector: { lastSuccessfulAt: "2026-07-23T00:00:09.000Z" },
  });
  assert.equal(eligible.candidates.length, 51);
  assert.equal(eligible.candidates[0].id, "nf_60");
  assert.equal(eligible.candidates.at(-1).id, "nf_10");
  const prompt = buildAllCandidateTopicPrompt(eligible);
  assert.match(prompt, /51개 후보를 빠짐없이 모두 검토/);
  assert.match(prompt, /개수 할당량은 없습니다/);
  for (const candidate of eligible.candidates) assert.match(prompt, new RegExp(`"${candidate.id}"`));
});

test("semantic topic result may select any valid ids from the uncapped candidate pool", () => {
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    id: `nf_${index}`,
    source: "Test Wire",
    publishedAt: new Date(Date.parse("2026-07-23T00:00:00.000Z") + index * 1_000).toISOString(),
    headline: `후보 ${index}`,
    url: "",
  }));
  const discovered = normalizeDiscoveredTopic(
    {
      title: "유가 상승이 다시 금리의 문제가 됐습니다",
      brief: "해상 운송 충격과 유가 상승이 물가와 금리 경로를 동시에 압박하는 사건입니다.",
      articleType: "analysis",
      topics: ["시장", "경제", "산업"],
      storyFamily: "에너지 충격과 통화정책",
      editorialAngle: "유가 충격이 운임과 기대인플레이션을 거쳐 금리로 이동하는 경로",
      primaryEvent: "유조선 운항 차질이 유가와 금리 기대를 함께 끌어올렸다",
      marketMechanism: "운항 차질이 보험료와 운임을 높이고 물가 기대를 통해 채권 금리로 전이된다",
      selectionReason: "실물 공급과 금융 가격을 연결하는 독립 사건이기 때문입니다.",
      newsFeedIds: ["nf_39", "nf_3", "not-live"],
    },
    candidates,
  );
  assert.deepEqual(discovered.newsFeedIds, ["nf_39", "nf_3"]);
  assert.deepEqual(discovered.eventSignature.sourceIds, ["nf_39", "nf_3"]);
});

test("one-shot JSONL inspection counts turns, tools, and tokens", () => {
  const inspected = inspectCodexJsonl([
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    JSON.stringify({ type: "item.started", item: { type: "agent_message" } }),
    JSON.stringify({ type: "item.started", item: { type: "command_execution" } }),
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 1234, cached_input_tokens: 1000, output_tokens: 567 },
    }),
  ].join("\n"));
  assert.deepEqual(inspected, {
    turnCount: 1,
    toolCallCount: 1,
    threadId: "thread-1",
    tokenUsage: { inputTokens: 1234, cachedInputTokens: 1000, outputTokens: 567 },
  });
});

test("simple article normalizer enforces useful prose while preserving locked metadata", () => {
  const article = normalizeSimpleArticle(
    {
      articleId: "alphabet-cash-flow-spacex-stake",
      title: "알파벳의 현금과 지분은 같은 돈이 아닙니다",
      deck: "AI 설비투자로 빠져나간 현금과 매도 제한이 걸린 지분 가치는 서로 다른 시간표를 가집니다.",
      summary: "알파벳의 현금흐름 적자와 스페이스X 지분 가치를 분리해 재무적 완충력의 범위를 살펴봅니다.",
      topics: ["AI", "테크", "존재하지 않는 토픽"],
      articleMarkdown: "충분한 기사 본문입니다. ".repeat(200),
      eventSignature: {
        actor: "Alphabet Inc.",
        action: "AI 설비투자로 첫 분기 잉여현금흐름 적자를 기록했다",
        object: ["잉여현금흐름", "SpaceX 지분"],
        time: "2026-07-23T00:00:00.000Z",
        marketMechanism: "현재 현금 유출과 매도 제한 자산 가치의 시간표가 분리된다",
        sourceIds: ["nf_1", "not-live"],
      },
      editorialReview: {
        publicationReady: true,
        summary: "근거 범위 안에서 현금흐름과 자산가치의 차이를 완결된 논증으로 설명했습니다.",
        issues: [],
      },
    },
    { topic, evidence },
  );
  assert.deepEqual(article.topics, ["AI", "테크"]);
  assert.equal(article.articleId, "alphabet-cash-flow-spacex-stake");
  assert.equal(article.storyFamily, "AI 자본지출");
  assert.equal(article.sourceBasis.length, 1);
  assert.deepEqual(article.eventSignature.sourceIds, ["nf_1"]);
  assert.equal(article.editorialReviewDecision.method, "LLM_INTEGRATED_ONE_SHOT_REVIEW");
  assert.throws(
    () => normalizeSimpleArticle(
      {
        articleId: "short-article",
        title: "짧은 제목입니다",
        deck: "짧습니다.",
        summary: "짧습니다.",
        topics: ["AI"],
        articleMarkdown: "너무 짧습니다.",
        eventSignature: {
          actor: "Alphabet",
          action: "행동",
          object: [],
          time: "",
          marketMechanism: "메커니즘",
          sourceIds: ["nf_1"],
        },
        editorialReview: {
          publicationReady: true,
          summary: "검토 요약입니다.",
          issues: [],
        },
      },
      { topic, evidence },
    ),
    /덱이 너무 짧습니다/,
  );
});

test("simple article normalizer fails closed on an integrated blocking review", () => {
  assert.throws(
    () => normalizeSimpleArticle(
      {
        articleId: "blocked-article-draft",
        title: "근거가 부족한 기사는 발행하지 않습니다",
        deck: "통합 검토가 핵심 근거 부족을 발견하면 추가 작성 호출 없이 이번 회차를 중단합니다.",
        summary: "단일 작성 턴이 차단 문제를 보고했기 때문에 자동 수정 루프 대신 실패 상태로 종료합니다.",
        topics: ["시장"],
        articleMarkdown: "충분한 기사 본문입니다. ".repeat(200),
        eventSignature: {
          actor: "테스트 기업",
          action: "근거가 부족한 주장을 제시했다",
          object: ["핵심 수치"],
          time: "2026-07-23T00:00:00.000Z",
          marketMechanism: "검증되지 않은 주장이 가격 판단을 왜곡할 수 있다",
          sourceIds: ["nf_1"],
        },
        editorialReview: {
          publicationReady: false,
          summary: "핵심 주장을 뒷받침할 근거가 부족합니다.",
          issues: [{
            severity: "blocking",
            code: "unsupported-core-claim",
            location: "본문",
            rationale: "핵심 수치의 근거가 없습니다.",
            suggestedFix: "이번 회차를 중단합니다.",
          }],
        },
      },
      { topic, evidence },
    ),
    /출판을 차단했습니다/,
  );
});

test("simple Markdown conversion removes duplicate H1 and preserves article structure", () => {
  const html = articleMarkdownToHtml([
    "# 중복 제목",
    "",
    "첫 문단입니다.",
    "",
    "## 실제 쟁점",
    "",
    "둘째 문단에는 **강조**가 있습니다.",
  ].join("\n"));
  assert.doesNotMatch(html, /<h1>/);
  assert.match(html, /<p>첫 문단입니다.<\/p>/);
  assert.match(html, /<h2>실제 쟁점<\/h2>/);
  assert.match(html, /<strong>강조<\/strong>/);
});
