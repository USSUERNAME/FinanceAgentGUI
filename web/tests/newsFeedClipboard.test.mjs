import test from "node:test";
import assert from "node:assert/strict";

import { newsFeedClipboardSourceUrl } from "../src/news/newsFeedClipboard.js";

test("news feed clipboard rewrites x.com links to nitter.net", () => {
  assert.equal(
    newsFeedClipboardSourceUrl("https://x.com/FirstSquawk/status/123456789?ref_src=twsrc%5Etfw#reply"),
    "https://nitter.net/FirstSquawk/status/123456789?ref_src=twsrc%5Etfw#reply",
  );
});

test("news feed clipboard also normalizes www.x.com", () => {
  assert.equal(
    newsFeedClipboardSourceUrl("https://www.x.com/unusual_whales/status/987"),
    "https://nitter.net/unusual_whales/status/987",
  );
});

test("news feed clipboard rewrites Wall St Engine item URLs to nitter.net", () => {
  assert.equal(
    newsFeedClipboardSourceUrl("https://x.com/wallstengine/status/2079161533012328453"),
    "https://nitter.net/wallstengine/status/2079161533012328453",
  );
});

test("news feed clipboard leaves non-X and invalid URLs unchanged", () => {
  assert.equal(
    newsFeedClipboardSourceUrl("https://example.com/news/market-update"),
    "https://example.com/news/market-update",
  );
  assert.equal(newsFeedClipboardSourceUrl("not a URL"), "not a URL");
});
