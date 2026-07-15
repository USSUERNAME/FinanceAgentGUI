import test from "node:test";
import assert from "node:assert/strict";

import { __earningsApiTestHooks } from "../server/earningsApi.mjs";

const {
  buildStoredEarningsEvents,
  eventCacheKey,
  filterEarningsEvents,
} = __earningsApiTestHooks;

const retentionStartDate = "2026-01-01";
const observedAt = "2026-07-14T09:00:00.000Z";
const beforeAnnouncementMs = Date.parse("2026-07-14T09:00:00.000Z");

function earningsEvent(overrides = {}) {
  return {
    id: "JPM-2026-07-14",
    dateKey: "2026-07-14",
    symbol: "JPM",
    company: "JPMorgan Chase & Co.",
    eventName: "Q2 2026 Earnings Announcement",
    callTime: "BMO",
    epsEstimate: "5.48",
    reportedEps: "-",
    surprise: "-",
    marketCap: "910.9B",
    marketCapValue: 910_900_000_000,
    eventStartUtc: "2026-07-14T10:45:00.000Z",
    kstDateTime: "2026-07-14T19:45:00+09:00",
    announcementDate: "2026-07-14",
    ...overrides,
  };
}

test("observed earnings persist immediately before the old 24-hour finalized boundary", () => {
  const stored = buildStoredEarningsEvents(
    [],
    [earningsEvent()],
    retentionStartDate,
    beforeAnnouncementMs,
    observedAt
  );

  assert.equal(stored.length, 1);
  assert.equal(stored[0].symbol, "JPM");
  assert.equal(stored[0].cachedObservedAt, observedAt);
  assert.equal(stored[0].cachedLastSeenAt, observedAt);
  assert.equal(stored[0].cachedFinalizedAt, undefined);
});

test("a previously observed earnings event survives when the provider removes it after reporting", () => {
  const firstSnapshot = buildStoredEarningsEvents(
    [],
    [earningsEvent()],
    retentionStartDate,
    beforeAnnouncementMs,
    observedAt
  );
  const afterProviderRemoval = buildStoredEarningsEvents(
    firstSnapshot,
    [],
    retentionStartDate,
    Date.parse("2026-07-14T13:00:00.000Z"),
    "2026-07-14T13:00:00.000Z"
  );

  assert.equal(afterProviderRemoval.length, 1);
  assert.equal(afterProviderRemoval[0].symbol, "JPM");
});

test("a later provider snapshot updates the same symbol and announcement date without duplication", () => {
  const firstSnapshot = buildStoredEarningsEvents(
    [],
    [earningsEvent({ eventStartUtc: "2026-07-14T10:32:00.000Z" })],
    retentionStartDate,
    beforeAnnouncementMs,
    observedAt
  );
  const updatedSnapshot = buildStoredEarningsEvents(
    firstSnapshot,
    [earningsEvent({ eventStartUtc: "2026-07-14T10:45:00.000Z", reportedEps: "5.91" })],
    retentionStartDate,
    Date.parse("2026-07-14T13:00:00.000Z"),
    "2026-07-14T13:00:00.000Z"
  );

  assert.equal(eventCacheKey(firstSnapshot[0]), eventCacheKey(updatedSnapshot[0]));
  assert.equal(updatedSnapshot.length, 1);
  assert.equal(updatedSnapshot[0].reportedEps, "5.91");
  assert.equal(updatedSnapshot[0].cachedObservedAt, observedAt);
});

test("daily display ranking keeps JPM among the six highest market-cap events", () => {
  const events = [
    earningsEvent(),
    ...[800, 700, 600, 500, 400, 300, 200].map((marketCapBillions, index) =>
      earningsEvent({
        id: `TEST-${index}`,
        symbol: `T${index}`,
        company: `Test ${index}`,
        marketCap: `${marketCapBillions}B`,
        marketCapValue: marketCapBillions * 1_000_000_000,
      })
    ),
  ];

  const displayed = filterEarningsEvents(events, "2026-07-14", "2026-07-15");
  assert.equal(displayed.length, 6);
  assert.equal(displayed[0].symbol, "JPM");
});
