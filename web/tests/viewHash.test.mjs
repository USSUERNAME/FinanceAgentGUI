import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hashForView,
  isHashView,
  viewFromHash,
} from "../src/shell/viewHash.js";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("Daily Intelligence screens have stable direct-entry hashes", () => {
  assert.equal(viewFromHash("#daily-intelligence"), "daily-intelligence");
  assert.equal(viewFromHash("#research-operations"), "research-operations");
  assert.equal(viewFromHash("#institutional-portfolio"), "institutional-portfolio");
  assert.equal(viewFromHash("#market-sectors"), "market-sectors");
  assert.equal(viewFromHash("#company-research"), "company-research");
  assert.equal(viewFromHash("#thesis-journal"), "thesis-journal");
  assert.equal(hashForView("daily-intelligence"), "#daily-intelligence");
  assert.equal(hashForView("research-operations"), "#research-operations");
  assert.equal(hashForView("institutional-portfolio"), "#institutional-portfolio");
  assert.equal(hashForView("market-sectors"), "#market-sectors");
  assert.equal(hashForView("company-research"), "#company-research");
  assert.equal(hashForView("thesis-journal"), "#thesis-journal");
});

test("Research Operations section anchors stay on the operations screen", () => {
  assert.equal(viewFromHash("#gmail-research-analysis"), "research-operations");
  assert.equal(viewFromHash("#broker-research-analysis"), "research-operations");
  assert.equal(viewFromHash("#telegram-intelligence"), "research-operations");
  assert.equal(viewFromHash("#pipeline-operations"), "research-operations");
  assert.equal(viewFromHash("#verification-review-queue"), "research-operations");
});

test("hash helpers normalize unknown views and portfolio canvas routes", () => {
  assert.equal(viewFromHash(""), "stock");
  assert.equal(viewFromHash("#unknown"), "stock");
  assert.equal(viewFromHash("#unknown", "reports"), "reports");
  assert.equal(hashForView("portfolio-canvas"), "#portfolio");
  assert.equal(hashForView("unknown"), "#stock");
  assert.equal(isHashView("reports"), true);
  assert.equal(isHashView("portfolio-canvas"), false);
});

test("App restores the initial hash and follows browser history changes", () => {
  assert.match(appSource, /viewFromHash\(window\.location\.hash, "stock"\)/);
  assert.match(appSource, /viewFromHash\(window\.location\.hash, null\)/);
  assert.match(appSource, /window\.history\.pushState\(null, "", expectedHash\)/);
  assert.match(appSource, /window\.addEventListener\("hashchange", handleHashChange\)/);
  assert.match(appSource, /window\.removeEventListener\("hashchange", handleHashChange\)/);
});
