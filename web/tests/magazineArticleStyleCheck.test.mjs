import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GUIBUILD_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CHECK_SCRIPT = join(GUIBUILD_ROOT, "scripts", "magazine_article_style_check.mjs");
const V2_CHECK_SCRIPT = join(GUIBUILD_ROOT, "scripts", "magazine_article_quality_check.mjs");

function makeArticleBody({ internalPhrase = "" } = {}) {
  const lead = internalPhrase
    ? `${internalPhrase} 최근 시장 기록도 같은 방향을 가리킵니다.`
    : "최근 시장 기록도 같은 방향을 가리킵니다.";
  const paragraphs = [
    `${lead} 전력망 병목은 기술주 서사와 유틸리티 투자 사이를 연결하며, 데이터센터 수요가 어느 지역에서 먼저 가격 신호로 바뀌는지 보여 줍니다.`,
    "International Energy Agency(IEA·국제에너지기구)에 따르면 데이터센터 전력 수요는 2030년까지 빠르게 늘 수 있고, 선진국 전력 수요 증가분에서도 큰 비중을 차지할 수 있습니다.",
    "Financial Times(FT·파이낸셜타임스)는 미국 전력·유틸리티 거래가 데이터센터 투자와 함께 커지고 있다고 전했습니다.",
    "시장에서는 반도체 주문서와 전력 구매계약이 같은 투자 논리 안으로 들어오고 있습니다.",
    "전력회사는 조용한 방어주에 머물지 않고, 송전망과 변전소 투자를 통해 AI 인프라의 병목을 풀어야 하는 당사자가 됐습니다.",
    "Guidi et al.(기디 등)은 미국 하이퍼스케일 데이터센터의 지역 집중과 전력 탄소집약도를 분석했다고 설명했습니다.",
    "이 숫자는 전국 총량보다 지역별 접속 대기열과 전력 믹스가 더 중요하다는 점을 보여 줍니다.",
    "Watten, Bistline and Blanford(와튼·비스트라인·블랜퍼드)는 데이터센터가 과거 평균 요금에는 다른 영향을 줬을 수 있다고 분석했습니다.",
    "그 반론은 단순히 요금이 오른다거나 내린다는 결론보다, 지역별 한계 비용과 규제 설계가 중요하다는 쪽으로 논쟁을 좁힙니다.",
    "Axios(악시오스)는 대형 기술기업들이 데이터센터의 물 사용과 에너지 사용을 함께 설명하려 한다고 전했습니다.",
    "물 냉각과 공기 냉각의 선택은 비용을 없애는 문제가 아니라, 전력과 물 사이에서 비용의 모양을 바꾸는 문제입니다.",
    "따라서 다음 데이터는 발표된 메가와트보다 실제 연결 시점, 변압기 납기, 송전 접속 대기열, 요금 배분 방식에 가까워집니다.",
  ];
  const expanded = paragraphs.map((paragraph) => `${paragraph} 한 전력시장 연구자는 "지역 병목이 비용 배분을 바꾼다"라고 설명했습니다. 이 문단은 같은 결론을 반복하지 않고 전력망, 금융, 규제, 공급망이 서로 다른 속도로 움직인다는 점을 덧붙입니다. 지역별 연결 시점, 장비 납기, 자본조달 비용, 소비자 요금 설계가 서로 맞물릴 때 같은 AI 투자라도 수혜와 부담은 다른 주소로 배분됩니다. 그래서 기사형 점검에서는 전국 총량보다 실제 접속 지점과 시간표, 그리고 누가 먼저 비용을 부담하는지가 더 중요한 장면으로 남습니다.`);
  return `<article class="magazine-article">
  <h2>전력망으로 내려온 성장주 이야기</h2>
  ${expanded.map((paragraph) => `<p>${paragraph}</p>`).join("\n  ")}
</article>`;
}

function fakePng() {
  const buffer = Buffer.alloc(12 * 1024);
  buffer[0] = 0x89;
  buffer.write("PNG", 1, "ascii");
  buffer.writeUInt32BE(640, 16);
  buffer.writeUInt32BE(360, 20);
  return buffer;
}

function readerToneDecision(patch = {}) {
  return {
    policy: "magazine-reader-tone-v1",
    method: "LLM_CLASSIFICATION_ONLY",
    noTextMatching: true,
    classifier: "magazine-reader-tone-llm",
    readerDirective: false,
    readerAddressedAsInvestor: false,
    checklistConclusion: false,
    lateSectionReviews: [
      {
        heading: "전력망으로 내려온 성장주 이야기",
        classification: "market_observation",
        rationale: "후반부는 시장 비용 배분의 의미를 설명하며 독자에게 행동을 지시하지 않습니다.",
      },
    ],
    ...patch,
  };
}

function quoteFlowDecision(patch = {}) {
  return {
    policy: "magazine-quote-flow-v1",
    method: "LLM_CLASSIFICATION_ONLY",
    noTextMatching: true,
    classifier: "magazine-quote-flow-llm",
    quoteFlowOk: true,
    directQuotePreferredWhenExactWordingVerified: true,
    directQuoteCoverageOk: true,
    indirectAttributionLimitedToUnverifiedWording: true,
    directQuoteAvoidance: false,
    repeatedIndirectBeforeDirectQuote: false,
    indirectAttributionOverused: false,
    ornamentalQuoteBlocks: false,
    reviews: [
      {
        location: "전력망으로 내려온 성장주 이야기",
        classification: "direct_quote_integrated",
        rationale: "직접 인용은 같은 주장을 앞에서 간접요약하지 않고 새 시장 맥락으로 연결됩니다.",
      },
    ],
    ...patch,
  };
}

function writeArticle(root, { articleId = "ai-power-bill-test", body, heroImage, topics = ["AI", "테크"], metadataPatch = {} } = {}) {
  const articleDir = join(root, "articles", articleId);
  mkdirSync(join(articleDir, "assets"), { recursive: true });
  const image = heroImage || {
    src: "assets/hero.png",
    alt: "전력망 설비 사진",
    credit: "U.S. Department of Energy",
    sourceUrl: "https://www.energy.gov/",
    license: "official-source",
  };
  writeFileSync(
    join(articleDir, "assets", image.src.endsWith(".svg") ? "hero.svg" : image.src.split("/").pop()),
    image.src.endsWith(".svg") ? "image-placeholder" : fakePng(),
  );
  writeFileSync(join(articleDir, "article.html"), body, "utf8");
  writeFileSync(
    join(articleDir, "metadata.json"),
    JSON.stringify(
      {
        title: "AI 전력 수요 확대가 유틸리티 비용을 흔듭니다",
        deck: "데이터센터 수요가 전력망 병목과 요금 배분 논쟁으로 번지고 있습니다.",
        summary: "전력 수요, 송전 장비, 유틸리티 자본조달이 AI 인프라의 새 가격표로 떠올랐습니다.",
        topics,
        articleType: "fact-brief",
        heroImage: image,
        sourceBasis: [
          "World Memory, local continuity evidence",
          "IEA, Energy and AI, 2025",
          "Financial Times, 2026",
          "Guidi et al., arXiv, 2026",
          "Axios, 2026",
        ],
        worldMemory: {
          retrievalPolicy: "mandatory-vector-search",
          query: "AI 데이터센터 전력 수요",
          vectorSearch: {
            engine: "sentence-transformers",
            model: "ibm-granite/granite-embedding-97m-multilingual-r2",
            hits: [{ eventId: "event-1", title: "AI 전력망 병목" }],
          },
        },
        researchMode: "mixed-research",
        editorialAngle: "policy-mechanics",
        storyFamily: "AI 물리 인프라 비즈니스",
        readerToneDecision: readerToneDecision(),
        quoteFlowDecision: quoteFlowDecision(),
        ...metadataPatch,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function runCheck(articleRoot) {
  return execFileSync(process.execPath, [CHECK_SCRIPT, "--strict", "--json"], {
    cwd: GUIBUILD_ROOT,
    env: { ...process.env, MAGAZINE_ARTICLES_DIR: join(articleRoot, "articles") },
    encoding: "utf8",
  });
}

function runCheckWithEnv(articleRoot, env = {}) {
  return execFileSync(process.execPath, [CHECK_SCRIPT, "--strict", "--json"], {
    cwd: GUIBUILD_ROOT,
    env: { ...process.env, ...env, MAGAZINE_ARTICLES_DIR: join(articleRoot, "articles") },
    encoding: "utf8",
  });
}

function runV2Check(articleRoot, env = {}) {
  return execFileSync(process.execPath, [V2_CHECK_SCRIPT, "--strict", "--json"], {
    cwd: GUIBUILD_ROOT,
    env: { ...process.env, ...env, MAGAZINE_ARTICLES_DIR: join(articleRoot, "articles") },
    encoding: "utf8",
  });
}

test("magazine style check allows World Memory evidence in metadata only", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-ok-"));
  writeArticle(articleRoot, { body: makeArticleBody() });

  const output = JSON.parse(runCheck(articleRoot));

  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
  assert.equal(output.warnings.length, 0);
});

test("magazine style check rejects reader chrome inside article body", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-body-chrome-"));
  const body = makeArticleBody().replace(
    "<h2>전력망으로 내려온 성장주 이야기</h2>",
    `<p class="article-kicker">AI 인프라</p>
  <h1>본문 안에 다시 들어간 제목</h1>
  <p class="article-deck">본문 안에 다시 들어간 덱입니다.</p>
  <h2>전력망으로 내려온 성장주 이야기</h2>`,
  );
  writeArticle(articleRoot, { body });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "article-body-h1"));
      assert.ok(output.errors.some((issue) => issue.code === "article-body-kicker"));
      assert.ok(output.errors.some((issue) => issue.code === "article-body-deck"));
      return true;
    },
  );
});

test("magazine style check rejects World Memory in reader-facing article copy", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-bad-"));
  writeArticle(articleRoot, { body: makeArticleBody({ internalPhrase: "World Memory에 쌓인" }) });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "internal-process-language"));
      return true;
    },
  );
});

test("magazine style check rejects reader action checklist sections", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-action-section-"));
  const body = makeArticleBody().replace(
    "</article>",
    `<h2>다음 확인 지점</h2>
  <p>앞으로 봐야 할 데이터는 명확합니다. 첫째, 지역별 전력 접속 대기열입니다. 둘째, 변압기 납기입니다. 셋째, 요금 배분 방식입니다.</p>
  <p>투자자는 이 세 가지를 함께 확인해야 합니다. 그래야 AI 인프라 투자가 실제 비용으로 내려오는 속도를 더 잘 읽을 수 있습니다.</p>
</article>`,
  );
  writeArticle(articleRoot, {
    body,
    metadataPatch: {
      readerToneDecision: readerToneDecision({
        checklistConclusion: true,
        lateSectionReviews: [
          {
            heading: "다음 확인 지점",
            classification: "checklist_conclusion",
            rationale: "LLM 판정: 후반부가 독자 체크리스트로 묶였습니다.",
          },
        ],
      }),
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "reader-action-section"));
      return true;
    },
  );
});

test("magazine style check rejects late reader directive prose without checklist heading", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-late-directive-"));
  const body = makeArticleBody().replace(
    "</article>",
    `<h2>시장 반응의 남은 거리</h2>
  <p>앞으로 봐야 할 데이터는 지역별 전력 접속 대기열과 변압기 납기입니다. 이 둘이 함께 움직이면 비용 부담이 유틸리티와 클라우드 사업자의 마진으로 내려오는 속도도 더 선명해집니다.</p>
</article>`,
  );
  writeArticle(articleRoot, {
    body,
    metadataPatch: {
      readerToneDecision: readerToneDecision({
        readerDirective: true,
        lateSectionReviews: [
          {
            heading: "시장 반응의 남은 거리",
            classification: "reader_directive",
            rationale: "LLM 판정: 후반부가 독자에게 확인할 과제를 부여합니다.",
          },
        ],
      }),
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "reader-directive"));
      return true;
    },
  );
});

test("magazine style check rejects addressing readers as investors", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-reader-investor-"));
  const body = makeArticleBody().replace(
    "</article>",
    `<h2>시장 반응의 남은 거리</h2>
  <p>투자자는 이 변수를 함께 확인해야 합니다. 그래야 전력망 병목이 반도체 주문과 유틸리티 비용으로 내려오는 속도를 읽을 수 있습니다.</p>
</article>`,
  );
  writeArticle(articleRoot, {
    body,
    metadataPatch: {
      readerToneDecision: readerToneDecision({
        readerAddressedAsInvestor: true,
        lateSectionReviews: [
          {
            heading: "시장 반응의 남은 거리",
            classification: "reader_directive",
            rationale: "LLM 판정: 독자를 투자자로 호명했습니다.",
          },
        ],
      }),
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "reader-as-investor-address"));
      return true;
    },
  );
});

test("magazine style check allows investors as third-party article subjects", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-third-party-investor-"));
  const body = makeArticleBody().replace(
    "시장에서는 반도체 주문서와 전력 구매계약이 같은 투자 논리 안으로 들어오고 있습니다.",
    "해외 투자자는 전력 구매계약을 반도체 주문서와 함께 가격에 반영하고 있다고 한 전략가는 설명했습니다. Trump 대통령은 투표자의 신원을 확인해야 한다고 말했습니다. 시장에서는 반도체 주문서와 전력 구매계약이 같은 투자 논리 안으로 들어오고 있습니다.",
  );
  writeArticle(articleRoot, {
    body,
    metadataPatch: {
      readerToneDecision: readerToneDecision({
        lateSectionReviews: [
          {
            heading: "전력망으로 내려온 성장주 이야기",
            classification: "third_party_market_participant",
            rationale: "LLM 판정: 투자자와 대통령 발언은 기사 속 제3자 설명이며 독자 지시가 아닙니다.",
          },
        ],
      }),
    },
  });

  const output = JSON.parse(runCheck(articleRoot));

  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
});

test("magazine style check requires an LLM quote-flow decision", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-quote-flow-missing-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      quoteFlowDecision: undefined,
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "quote-flow-decision-missing"));
      return true;
    },
  );
});

test("magazine style check rejects indirect paraphrase before a repeated direct quote", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-quote-flow-repeat-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      quoteFlowDecision: quoteFlowDecision({
        quoteFlowOk: false,
        repeatedIndirectBeforeDirectQuote: true,
        reviews: [
          {
            location: "전력망으로 내려온 성장주 이야기",
            classification: "indirect_then_direct_repetition",
            rationale: "LLM 판정: 같은 발언을 간접요약한 뒤 직접인용으로 다시 반복했습니다.",
          },
        ],
      }),
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "quote-flow-not-ok"));
      assert.ok(output.errors.some((issue) => issue.code === "indirect-before-direct-repetition"));
      assert.ok(output.errors.some((issue) => issue.code === "quote-flow-classification-invalid"));
      return true;
    },
  );
});

test("magazine style check rejects direct quote avoidance", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-direct-quote-avoidance-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      quoteFlowDecision: quoteFlowDecision({
        quoteFlowOk: false,
        directQuoteCoverageOk: false,
        directQuoteAvoidance: true,
        reviews: [
          {
            location: "전력망으로 내려온 성장주 이야기",
            classification: "direct_quote_avoidance",
            rationale: "LLM 판정: 검증된 이해관계자 발언이 있는데 직접인용을 모두 없애고 간접귀속으로만 처리했습니다.",
          },
        ],
      }),
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "quote-flow-not-ok"));
      assert.ok(output.errors.some((issue) => issue.code === "direct-quote-coverage-missing"));
      assert.ok(output.errors.some((issue) => issue.code === "direct-quote-avoidance"));
      assert.ok(output.errors.some((issue) => issue.code === "quote-flow-classification-invalid"));
      return true;
    },
  );
});

test("magazine style check rejects overused indirect attribution", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-indirect-overused-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      quoteFlowDecision: quoteFlowDecision({
        quoteFlowOk: false,
        indirectAttributionOverused: true,
        reviews: [
          {
            location: "전력망으로 내려온 성장주 이야기",
            classification: "indirect_attribution_overused",
            rationale: "LLM 판정: 직접 인용이 가능하거나 인용이 필요 없는 자리를 간접귀속으로 늘렸습니다.",
          },
        ],
      }),
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "quote-flow-not-ok"));
      assert.ok(output.errors.some((issue) => issue.code === "indirect-attribution-overused"));
      assert.ok(output.errors.some((issue) => issue.code === "quote-flow-classification-invalid"));
      return true;
    },
  );
});

test("magazine style check rejects SVG mock hero images", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-svg-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    heroImage: {
      src: "assets/hero.svg",
      alt: "전력망 벡터 목업",
      credit: "FinanceAgentGUI",
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "hero-image-vector-mock"));
      assert.ok(output.errors.some((issue) => issue.code === "hero-image-source-url-missing"));
      return true;
    },
  );
});

test("magazine style check rejects topics outside the configured catalog", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-topic-bad-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    topics: ["AI", "전력망"],
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "topics-outside-catalog"));
      return true;
    },
  );
});

test("magazine style check rejects articles without selected topics", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-topic-empty-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    topics: [],
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "topics-missing"));
      return true;
    },
  );
});

test("magazine style check rejects more than three article topics", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-topic-many-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    topics: ["시장", "금융", "경제", "산업"],
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "topics-too-many"));
      return true;
    },
  );
});

test("magazine style check follows a custom topic catalog", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-topic-custom-"));
  const topicConfigPath = join(articleRoot, "magazine-topics.json");
  writeFileSync(
    topicConfigPath,
    JSON.stringify({ topics: [{ label: "반도체", emoji: "칩", tone: "tech" }] }),
    "utf8",
  );
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    topics: ["반도체"],
  });

  const output = JSON.parse(runCheckWithEnv(articleRoot, { MAGAZINE_TOPICS_PATH: topicConfigPath }));

  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
});

test("magazine style check rejects cover stories without cover decision metadata", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-cover-bad-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      isCoverStory: true,
      coverRegisteredAt: "2026-06-30T00:00:00+09:00",
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "cover-decision-missing"));
      return true;
    },
  );
});

test("magazine style check accepts a cover story with world-memory comparison decision", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-cover-ok-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      isCoverStory: true,
      coverRegisteredAt: "2026-06-30T00:00:00+09:00",
      coverDecision: {
        policy: "world-memory-cover-v1",
        result: "promote",
        evaluatedAt: "2026-06-30T00:00:00+09:00",
        comparisonWindow: {
          basis: "upload-time",
          articleLimit: 5,
          articleIds: ["older-article-1", "older-article-2"],
        },
        worldMemorySignals: {
          mostImportantIssue: "AI 전력망 병목",
          mostRecentIssue: "전력장비 수급 압력",
          query: "AI 데이터센터 전력망 병목",
          hitIds: ["event-1"],
        },
        candidateScore: 91,
        bestPreviousScore: 82,
        rationale: "새 기사가 최근 비교창의 기사보다 현재 월드메모리 핵심 이슈에 더 직접 연결됩니다.",
      },
    },
  });

  const output = JSON.parse(runCheck(articleRoot));

  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
});

test("magazine style check rejects a v2 non-cover article when the independent classification is missing", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-cover-gate-missing-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      coverDecisionGate: "magazine-cover-classifier-v2",
      isCoverStory: false,
      coverRegisteredAt: null,
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "cover-decision-missing"));
      return true;
    },
  );
});

test("magazine style check accepts an explicit LLM do-not-promote classification", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-cover-gate-complete-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      coverDecisionGate: "magazine-cover-classifier-v2",
      isCoverStory: false,
      coverRegisteredAt: null,
      coverDecision: {
        policy: "world-memory-cover-v1",
        method: "LLM_CLASSIFICATION_ONLY",
        result: "do-not-promote",
        evaluatedAt: "2026-07-23T16:00:00+09:00",
        comparisonWindow: {
          basis: "upload-time",
          articleLimit: 5,
          articleIds: ["older-article-1", "older-article-2"],
          totalArticleCount: 400,
        },
        worldMemorySignals: {
          mostImportantIssue: "중동 운송 위험",
          mostRecentIssue: "새 해운 보험료",
          query: "운송 위험 보험료",
          hitIds: [],
        },
        candidateScore: 78,
        bestPreviousScore: 91,
        rationale: "비교창의 기존 기사가 현재 이슈와 더 직접 연결됩니다.",
      },
    },
  });

  const output = JSON.parse(runCheck(articleRoot));

  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
});

test("magazine style check accepts an LLM-ranked recent cover rebuild decision", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-cover-rebuild-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      coverDecisionGate: "magazine-cover-classifier-v2",
      isCoverStory: true,
      coverRegisteredAt: "2026-07-23T16:00:00+09:00",
      coverRank: 1,
      coverDecision: {
        policy: "world-memory-cover-v1",
        method: "LLM_CLASSIFICATION_ONLY",
        mode: "recent-cover-rebuild",
        result: "promote",
        evaluatedAt: "2026-07-23T16:00:00+09:00",
        comparisonWindow: {
          basis: "recent-upload-window",
          articleLimit: 6,
          articleIds: ["a", "b", "c", "d", "e", "f"],
          totalArticleCount: 400,
        },
        worldMemorySignals: {
          mostImportantIssue: "중동 운송 위험",
          mostRecentIssue: "새 해운 보험료",
          query: "운송 위험 보험료",
          hitIds: [],
        },
        candidateScore: 95,
        bestPreviousScore: 94,
        rationale: "최근 후보 가운데 파급 범위와 긴급성이 가장 높습니다.",
      },
    },
  });

  const output = JSON.parse(runCheck(articleRoot));

  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
});

test("magazine style check rejects News Feed items before the World Memory cutoff", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-news-feed-cutoff-bad-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      sourceBasis: [
        "News Feed, First Squawk, nf-before-cutoff",
        "IEA, Energy and AI, 2025",
        "Financial Times, 2026",
        "Guidi et al., arXiv, 2026",
        "Axios, 2026",
      ],
      newsFeed: {
        selectionPolicy: "post-world-memory-update-only",
        worldMemoryLastSuccessfulAt: "2026-06-30T00:00:00+09:00",
        items: [
          {
            id: "nf-before-cutoff",
            feedId: "first-squawk",
            feedTitle: "First Squawk",
            title: "컷오프 이전 피드",
            publishedAt: "2026-06-29T23:59:00+09:00",
          },
        ],
      },
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "news-feed-before-world-memory-cutoff"));
      return true;
    },
  );
});

test("magazine style check accepts News Feed evidence after the World Memory cutoff", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-news-feed-cutoff-ok-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      sourceBasis: [
        "News Feed, First Squawk, nf-after-cutoff",
        "IEA, Energy and AI, 2025",
        "Financial Times, 2026",
        "Guidi et al., arXiv, 2026",
        "Axios, 2026",
      ],
      researchMode: "news-feed-with-world-memory-backup",
      newsFeed: {
        selectionPolicy: "post-world-memory-update-only",
        worldMemoryLastSuccessfulAt: "2026-06-30T00:00:00+09:00",
        items: [
          {
            id: "nf-after-cutoff",
            feedId: "first-squawk",
            feedTitle: "First Squawk",
            title: "컷오프 이후 피드",
            publishedAt: "2026-06-30T00:01:00+09:00",
          },
        ],
      },
    },
  });

  const output = JSON.parse(runCheck(articleRoot));

  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
});

test("magazine style check rejects duplicate News Feed anchors inside a candidate set", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-duplicate-feed-"));
  const duplicateNewsFeed = {
    selectionPolicy: "post-world-memory-update-only",
    worldMemoryLastSuccessfulAt: "2026-06-30T00:00:00+09:00",
    items: [
      {
        id: "nf-duplicate",
        feedId: "first-squawk",
        feedTitle: "First Squawk",
        title: "같은 피드 항목",
        publishedAt: "2026-06-30T00:01:00+09:00",
      },
    ],
  };
  writeArticle(articleRoot, {
    articleId: "first-duplicate-article",
    body: makeArticleBody(),
    metadataPatch: {
      researchMode: "news-feed-with-world-memory-backup",
      newsFeed: duplicateNewsFeed,
    },
  });
  writeArticle(articleRoot, {
    articleId: "second-duplicate-article",
    body: makeArticleBody(),
    metadataPatch: {
      title: "같은 뉴스의 다른 옷",
      researchMode: "news-feed-with-world-memory-backup",
      newsFeed: duplicateNewsFeed,
      storyFamily: "다른 표면 라벨",
    },
  });

  assert.throws(
    () => runCheck(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "duplicate-news-feed-anchor"));
      return true;
    },
  );
});

test("magazine style check rejects staged articles that reuse recent production anchors", () => {
  const baselineRoot = mkdtempSync(join(tmpdir(), "magazine-style-baseline-"));
  const stagedRoot = mkdtempSync(join(tmpdir(), "magazine-style-staged-"));
  writeArticle(baselineRoot, {
    articleId: "baseline-steel-article",
    body: makeArticleBody(),
    metadataPatch: {
      title: "EU 철강 쿼터 첫 기사",
      storyFamily: "글로벌 보호무역과 공급망 재편",
      editorialAngle: "policy-mechanics",
      worldMemory: {
        retrievalPolicy: "mandatory-vector-search",
        query: "EU 철강 쿼터",
        vectorSearch: {
          engine: "sentence-transformers",
          model: "ibm-granite/granite-embedding-97m-multilingual-r2",
          hits: [{ eventId: "steel-event", title: "EU 철강 쿼터 축소" }],
        },
      },
    },
  });
  writeArticle(stagedRoot, {
    articleId: "staged-steel-article",
    body: makeArticleBody(),
    metadataPatch: {
      title: "EU 철강 쿼터 후속처럼 보이는 중복 기사",
      storyFamily: "글로벌 보호무역과 공급망 재편",
      editorialAngle: "external-research",
      worldMemory: {
        retrievalPolicy: "mandatory-vector-search",
        query: "EU 철강 쿼터 한국 수출",
        vectorSearch: {
          engine: "sentence-transformers",
          model: "ibm-granite/granite-embedding-97m-multilingual-r2",
          hits: [{ eventId: "steel-event", title: "EU 철강 쿼터 축소" }],
        },
      },
    },
  });

  assert.throws(
    () => runCheckWithEnv(stagedRoot, {
      MAGAZINE_BASELINE_ARTICLES_DIR: join(baselineRoot, "articles"),
    }),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "duplicate-world-memory-anchor"));
      assert.equal(output.baselineCount, 1);
      return true;
    },
  );
});

test("magazine style check allows reused continuity anchors when a fresh News Feed anchor changes the story", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-style-continuity-anchor-"));
  const heroImage = {
    src: "assets/hero.png",
    alt: "국방 장비 사진",
    credit: "UK Ministry of Defence",
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/RAF_Leeming_Photo_Task_2016_MOD_45162426.jpg",
    license: "Open Government Licence",
  };
  writeArticle(articleRoot, {
    articleId: "first-defence-article",
    body: makeArticleBody(),
    heroImage,
    metadataPatch: {
      title: "영국 국방 투자 패키지의 공급망 가격표",
      storyFamily: "영국 방위투자 패키지와 유럽 방산 공급망 재가격화",
      editorialAngle: "policy-mechanics",
      worldMemory: {
        retrievalPolicy: "mandatory-vector-search",
        query: "영국 방위투자 패키지",
        vectorSearch: {
          engine: "sentence-transformers",
          model: "ibm-granite/granite-embedding-97m-multilingual-r2",
          hits: [{ eventId: "uk-defence-event", title: "영국 방위투자 패키지" }],
        },
      },
    },
  });
  writeArticle(articleRoot, {
    articleId: "second-defence-article",
    body: makeArticleBody(),
    heroImage,
    metadataPatch: {
      title: "NATO 국방비 목표와 영국 재정 신뢰도",
      storyFamily: "NATO 국방비 목표와 영국 재정 신뢰도",
      editorialAngle: "data-anomaly",
      researchMode: "news-feed-with-world-memory-backup",
      newsFeed: {
        selectionPolicy: "post-world-memory-update-only",
        worldMemoryLastSuccessfulAt: "2026-06-30T00:00:00+09:00",
        items: [
          {
            id: "nf-nato-rutte-fresh",
            feedId: "financialjuice",
            feedTitle: "FinancialJuice",
            title: "NATO 사무총장이 영국 방위투자 계획을 3.5% 목표 진전으로 평가했다",
            publishedAt: "2026-06-30T10:27:02+09:00",
          },
        ],
      },
      worldMemory: {
        retrievalPolicy: "mandatory-vector-search",
        query: "영국 국방비 NATO",
        vectorSearch: {
          engine: "sentence-transformers",
          model: "ibm-granite/granite-embedding-97m-multilingual-r2",
          hits: [{ eventId: "uk-defence-event", title: "영국 방위투자 패키지" }],
        },
      },
    },
  });

  const output = JSON.parse(runCheck(articleRoot));
  assert.equal(output.ok, true);
});

test("magazine v2 quality check treats length and density as advisory without legacy self-certification", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-v2-advisory-"));
  const body = `<article class="magazine-article">
    <h2>짧지만 완결된 사건</h2>
    <p>공식 발표는 새로운 가격 조건과 시행 시점을 함께 제시했습니다.</p>
    <p>시장에 중요한 변화는 발표의 길이가 아니라 실제 계약과 가격에 반영되는 속도입니다.</p>
  </article>`;
  writeArticle(articleRoot, {
    body,
    metadataPatch: {
      sourceBasis: [
        "https://example.com/official-release",
        "https://example.com/market-data",
        "https://example.com/company-filing",
      ],
      worldMemory: null,
      researchMode: "external-research",
      readerToneDecision: null,
      quoteFlowDecision: null,
      editorialReviewDecision: {
        policy: "magazine-editorial-review-v2",
        method: "LLM_SEMANTIC_REVIEW",
        reviewer: "magazine-editorial-review-llm",
        summary: "짧지만 근거와 메커니즘이 연결된 기사입니다.",
        issues: [],
      },
    },
  });

  const output = JSON.parse(runV2Check(articleRoot));
  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
  assert.ok(output.advisories.some((issue) => issue.code === "body-too-short"));
  assert.ok(output.advisories.some((issue) => issue.code === "paragraph-count-low"));
  assert.equal(output.legacySummary.ignoredSelfCertificationIssues >= 2, true);
});

test("magazine v2 quality check blocks only explicit semantic publication issues", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-v2-blocking-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      editorialReviewDecision: {
        policy: "magazine-editorial-review-v2",
        method: "LLM_SEMANTIC_REVIEW",
        reviewer: "magazine-editorial-review-llm",
        summary: "핵심 수치의 근거 연결을 고쳐야 합니다.",
        issues: [
          {
            severity: "blocking",
            code: "unsupported-core-number",
            location: "도입부",
            rationale: "핵심 수치가 sourceBasis의 어느 근거와도 연결되지 않습니다.",
            suggestedFix: "근거를 확인하거나 수치를 삭제합니다.",
            confidence: 0.96,
          },
        ],
      },
    },
  });

  assert.throws(
    () => runV2Check(articleRoot),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.errors.some((issue) => issue.code === "unsupported-core-number"));
      return true;
    },
  );
});

test("magazine v2 quality check accepts an integrated one-shot editorial review", () => {
  const articleRoot = mkdtempSync(join(tmpdir(), "magazine-v2-integrated-review-"));
  writeArticle(articleRoot, {
    body: makeArticleBody(),
    metadataPatch: {
      editorialReviewDecision: {
        policy: "magazine-editorial-review-v2",
        method: "LLM_INTEGRATED_ONE_SHOT_REVIEW",
        reviewer: "magazine-simple-writer-integrated-review",
        suggestedTitle: "에너지 충격에 갇힌 ECB의 선택",
        publicationReady: true,
        summary: "근거와 시장 메커니즘을 같은 생성 턴에서 검토했습니다.",
        issues: [],
      },
    },
  });

  const output = JSON.parse(runV2Check(articleRoot));
  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
});
