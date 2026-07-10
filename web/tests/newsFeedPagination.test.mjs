import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeNewsFeedFirstPage,
  newsFeedContentRevision,
} from "../src/news/newsFeedPagination.js";

test("news feed content revision does not depend on the number of rendered items", () => {
  const snapshot = {
    itemCount: 711,
    latestItemId: "nf_latest",
    readState: { latestTranslatedAt: "2026-07-10T03:52:06.069Z" },
  };

  assert.equal(
    newsFeedContentRevision(snapshot),
    "711:nf_latest:2026-07-10T03:52:06.069Z"
  );
});

test("news feed content revision prefers the server content revision", () => {
  assert.equal(
    newsFeedContentRevision({ contentRevision: "server-revision", itemCount: 30 }),
    "server-revision"
  );
});

test("news feed first-page refresh preserves already loaded older items", () => {
  const currentItems = [
    { id: "nf_3", text: "old latest" },
    { id: "nf_2", text: "older" },
    { id: "nf_1", text: "oldest" },
  ];
  const firstPageItems = [
    { id: "nf_4", text: "new" },
    { id: "nf_3", text: "updated latest" },
  ];

  assert.deepEqual(mergeNewsFeedFirstPage(currentItems, firstPageItems), [
    { id: "nf_4", text: "new" },
    { id: "nf_3", text: "updated latest" },
    { id: "nf_2", text: "older" },
    { id: "nf_1", text: "oldest" },
  ]);
});
