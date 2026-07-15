import test from "node:test";
import assert from "node:assert/strict";

import {
  applyNewsFeedTranslationBatch,
  mergeNewsFeedItemsPreservingLatest,
  normalizeNewsFeedTranslationCandidate,
  parseFeedXml,
  selectPendingNewsFeedTranslationBatch,
} from "../server/newsFeedApi.mjs";

test("news feed translation harness accepts Korean body without translating RSS title", () => {
  const candidate = normalizeNewsFeedTranslationCandidate(
    {
      title: "ECB's Wunsch: We might need another hike.",
      originalText: "ECB's Wunsch: We might need another hike.",
    },
    {
      bodyKo: "ECB 운슈: 추가 인상이 필요할 수 있다.",
    },
  );

  assert.equal(candidate.ok, true);
  assert.equal(Object.hasOwn(candidate, "titleKo"), false);
  assert.equal(candidate.bodyKo, "ECB 운슈: 추가 인상이 필요할 수 있다.");
});

test("news feed translation harness keeps blank Gemini output in retry queue", () => {
  const candidate = normalizeNewsFeedTranslationCandidate(
    {
      title: "EMIRATES NBD IS IN DISCUSSIONS TO PURCHASE HSBC'S OPERATIONS IN TURKEY.",
      originalText: "EMIRATES NBD IS IN DISCUSSIONS TO PURCHASE HSBC'S OPERATIONS IN TURKEY.",
    },
    {
      bodyKo: "",
    },
  );

  assert.equal(candidate.ok, false);
  assert.match(candidate.error, /보류/);
  assert.match(candidate.error, /bodyKo가 비어 있습니다/);
});

test("news feed translation harness rejects untranslated English copies", () => {
  const source = "Ireland is set to spend more than three times as much as Cyprus and Denmark.";
  const candidate = normalizeNewsFeedTranslationCandidate(
    {
      title: source,
      originalText: source,
    },
    {
      bodyKo: source,
    },
  );

  assert.equal(candidate.ok, false);
  assert.match(candidate.error, /영문 원문과 같습니다/);
});

test("news feed translation harness rejects English-only paraphrases", () => {
  const candidate = normalizeNewsFeedTranslationCandidate(
    {
      title: "GERMAN DEFENCE MINISTER PISTORIUS: NATO headquarters show resolve.",
      originalText: "GERMAN DEFENCE MINISTER PISTORIUS: NATO headquarters show resolve.",
    },
    {
      bodyKo: "German Defence Minister Pistorius says NATO headquarters show resolve",
    },
  );

  assert.equal(candidate.ok, false);
  assert.match(candidate.error, /한국어가 없습니다/);
});

test("news feed translation harness rejects Unicode replacement characters", () => {
  const candidate = normalizeNewsFeedTranslationCandidate(
    {
      title: "FRANCE TO HOLD FIRST ROUND OF PRESIDENTIAL ELECTION APRIL 18, 2027",
      originalText: "FRANCE TO HOLD FIRST ROUND OF PRESIDENTIAL ELECTION APRIL 18, 2027",
    },
    {
      bodyKo: "프랑스가 2027년 4월 18일에 대통령 선거 1차 투표를 실시\uFFFD\uFFFD 예정이다.",
    },
  );

  assert.equal(candidate.ok, false);
  assert.match(candidate.error, /유니코드 대체 문자/);
});

test("news feed parser preserves RSS item URLs as sourceUrl", () => {
  const parsed = parseFeedXml(
    `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <item>
          <title>Market update</title>
          <link>https://example.com/news/market-update</link>
          <description>Stocks moved higher.</description>
          <pubDate>Tue, 30 Jun 2026 10:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`,
    { id: "test-feed", title: "Test Feed" },
  );

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].sourceUrl, "https://example.com/news/market-update");
});

test("news feed parser preserves Atom alternate links as sourceUrl", () => {
  const parsed = parseFeedXml(
    `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      <entry>
        <title>Policy update</title>
        <link rel="alternate" href="https://example.com/news/policy-update" />
        <id>tag:example.com,2026:policy-update</id>
        <summary>Central bank officials spoke.</summary>
        <updated>2026-06-30T10:00:00Z</updated>
      </entry>
    </feed>`,
    { id: "atom-feed", title: "Atom Feed" },
  );

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].sourceUrl, "https://example.com/news/policy-update");
});

test("news feed refresh merge preserves translations written during collection", () => {
  const stalePendingItem = {
    id: "nf_same",
    sourceFingerprint: "same-fingerprint",
    feedId: "test-feed",
    title: "Stocks moved higher.",
    originalText: "Stocks moved higher.",
    translatedText: "",
    translatedAt: "",
    translationStatus: "pending",
    publishedAt: "2026-07-05T10:00:00.000Z",
  };
  const latestTranslatedItem = {
    ...stalePendingItem,
    translatedText: "주가가 상승했다.",
    translatedAt: "2026-07-05T10:01:00.000Z",
    translationStatus: "translated",
  };
  const newlyCollectedItem = {
    id: "nf_new",
    sourceFingerprint: "new-fingerprint",
    feedId: "test-feed",
    title: "Bond yields fell.",
    originalText: "Bond yields fell.",
    translatedText: "",
    translatedAt: "",
    translationStatus: "pending",
    publishedAt: "2026-07-05T10:02:00.000Z",
  };

  const merged = mergeNewsFeedItemsPreservingLatest(
    [latestTranslatedItem],
    [newlyCollectedItem, stalePendingItem],
  );

  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === "nf_same").translationStatus, "translated");
  assert.equal(merged.find((item) => item.id === "nf_same").translatedText, "주가가 상승했다.");
  assert.equal(merged.find((item) => item.id === "nf_new").translationStatus, "pending");
});

test("news feed translation commits each completed batch without touching the remaining queue", () => {
  const first = {
    id: "nf_first",
    originalText: "Stocks moved higher after the inflation report.",
    translatedText: "",
    translatedAt: "",
    translationStatus: "pending",
  };
  const second = {
    id: "nf_second",
    originalText: "Bond yields fell during the session.",
    translatedText: "",
    translatedAt: "",
    translationStatus: "pending",
  };
  const untouched = {
    id: "nf_later",
    originalText: "Oil prices were unchanged.",
    translatedText: "",
    translatedAt: "",
    translationStatus: "pending",
  };

  const applied = applyNewsFeedTranslationBatch(
    { collector: {}, items: [first, second, untouched] },
    [first, second],
    {
      translations: [
        { id: "nf_first", bodyKo: "물가 보고서 발표 후 주가가 상승했다." },
        { id: "nf_second", bodyKo: "장중 채권 금리가 하락했다." },
      ],
      model: "gpt-5.6-luna",
      reasoning: "low",
    },
  );

  assert.equal(applied.translatedCount, 2);
  assert.equal(applied.retryCount, 0);
  assert.equal(applied.store.items[0].translationStatus, "translated");
  assert.equal(applied.store.items[1].translationStatus, "translated");
  assert.equal(applied.store.items[2].translationStatus, "pending");
  assert.equal(applied.store.items[2].translatedText, "");
});

test("news feed translation keeps only a missing batch result pending", () => {
  const first = {
    id: "nf_first",
    originalText: "Stocks moved higher after the inflation report.",
    translatedText: "",
    translatedAt: "",
    translationStatus: "pending",
  };
  const second = {
    id: "nf_second",
    originalText: "Bond yields fell during the session.",
    translatedText: "",
    translatedAt: "",
    translationStatus: "pending",
  };

  const applied = applyNewsFeedTranslationBatch(
    { collector: {}, items: [first, second] },
    [first, second],
    {
      translations: [{ id: "nf_first", bodyKo: "물가 보고서 발표 후 주가가 상승했다." }],
      model: "gpt-5.6-luna",
      reasoning: "low",
    },
  );

  assert.equal(applied.translatedCount, 1);
  assert.equal(applied.retryCount, 1);
  assert.equal(applied.store.items[0].translationStatus, "translated");
  assert.equal(applied.store.items[1].translationStatus, "pending");
  assert.match(applied.store.items[1].translationError, /재시도 대기열/);
});

test("news feed translation fills a batch from the newest pending items while skipping translated rows", () => {
  const item = (id, publishedAt, translationStatus = "pending") => ({
    id,
    publishedAt,
    fetchedAt: publishedAt,
    translationStatus,
  });
  const items = [
    item("nf_oldest", "2026-07-15T08:00:00.000Z"),
    item("nf_newest", "2026-07-15T12:00:00.000Z"),
    item("nf_already_done", "2026-07-15T11:30:00.000Z", "translated"),
    item("nf_second", "2026-07-15T11:00:00.000Z"),
    item("nf_also_done", "2026-07-15T10:30:00.000Z", "translated"),
    item("nf_third", "2026-07-15T10:00:00.000Z"),
    item("nf_older", "2026-07-15T09:00:00.000Z"),
  ];

  const batch = selectPendingNewsFeedTranslationBatch(items, 3);

  assert.deepEqual(
    batch.map((entry) => entry.id),
    ["nf_newest", "nf_second", "nf_third"],
  );
});
