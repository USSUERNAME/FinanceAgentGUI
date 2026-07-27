import assert from "node:assert/strict";
import test from "node:test";
import {
  clusterNewsDigestItems,
  completedNewsDigestWindow,
  normalizeNewsDailyDigestCandidate,
} from "../server/newsFeedApi.mjs";

test("completed digest window uses the latest closed 07:30 KST boundary", () => {
  const afterCutoff = completedNewsDigestWindow(new Date("2026-07-27T01:00:00.000Z"));
  assert.equal(afterCutoff.key, "2026-07-27");
  assert.equal(afterCutoff.startAt, "2026-07-25T22:30:00.000Z");
  assert.equal(afterCutoff.endAt, "2026-07-26T22:30:00.000Z");

  const beforeCutoff = completedNewsDigestWindow(new Date("2026-07-26T21:00:00.000Z"));
  assert.equal(beforeCutoff.key, "2026-07-26");
  assert.equal(beforeCutoff.startAt, "2026-07-24T22:30:00.000Z");
  assert.equal(beforeCutoff.endAt, "2026-07-25T22:30:00.000Z");
});

test("daily digest clustering merges cross-feed copies and keeps distinct events", () => {
  const window = completedNewsDigestWindow(new Date("2026-07-27T01:00:00.000Z"));
  const items = [
    {
      id: "a",
      feedId: "one",
      feedTitle: "Feed One",
      sourceUrl: "https://example.com/story?utm_source=rss",
      translatedTitle: "연준 의장이 금리 경로에 대해 신중한 입장을 밝혔다",
      publishedAt: "2026-07-26T12:00:00.000Z",
    },
    {
      id: "b",
      feedId: "two",
      feedTitle: "Feed Two",
      sourceUrl: "https://example.com/story",
      translatedTitle: "연준 의장이 금리 경로에 신중한 입장을 밝혔다",
      publishedAt: "2026-07-26T12:05:00.000Z",
    },
    {
      id: "c",
      feedId: "three",
      feedTitle: "Feed Three",
      sourceUrl: "https://example.com/oil",
      translatedTitle: "원유 재고 감소로 국제유가가 상승했다",
      publishedAt: "2026-07-26T13:00:00.000Z",
    },
    {
      id: "outside",
      feedId: "four",
      translatedTitle: "구간 밖 뉴스",
      publishedAt: "2026-07-25T20:00:00.000Z",
    },
  ];

  const clusters = clusterNewsDigestItems(items, window);
  assert.equal(clusters.length, 2);
  const merged = clusters.find((cluster) => cluster.itemIds.includes("a"));
  assert.equal(merged.itemCount, 2);
  assert.equal(merged.sourceCount, 2);
  assert.equal(merged.verificationStatus, "multi_source");
});

test("digest normalization preserves only valid cluster references and source links", () => {
  const clusters = [
    {
      id: "event-1",
      itemCount: 3,
      sources: ["A", "B"],
      sourceUrls: ["https://example.com/a"],
    },
  ];
  const result = normalizeNewsDailyDigestCandidate(
    {
      summaryKo: "금리와 원자재가 전일 시장의 핵심 변수였습니다.",
      events: [
        {
          titleKo: "금리 경로 재평가",
          summaryKo: "복수 피드에서 금리 관련 발언이 포착됐습니다.",
          whyItMattersKo: "성장주 할인율과 달러 방향에 영향을 줄 수 있습니다.",
          relatedAssets: ["미국 국채", "달러"],
          verificationStatus: "metadata_only",
          clusterIds: ["event-1", "missing"],
        },
      ],
    },
    clusters,
  );

  assert.equal(result.ok, true);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0].clusterIds, ["event-1"]);
  assert.equal(result.events[0].verificationStatus, "multi_source");
  assert.deepEqual(result.events[0].sourceUrls, ["https://example.com/a"]);
});
