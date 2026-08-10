import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveSectorKpiSet,
  sectorKpiDefinition,
  sectorKpiMapVersion,
} from "../server/sectorKpiMap.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, "..", "..");

test("sector KPI map uses taxonomy IDs and never contains company values", () => {
  const taxonomy = JSON.parse(readFileSync(
    resolve(rootDir, "config/research-sector-taxonomy.json"),
    "utf8",
  ));
  const map = JSON.parse(readFileSync(
    resolve(rootDir, "config/sector-kpi-map.json"),
    "utf8",
  ));
  const taxonomyIds = new Set(taxonomy.sectors.map((sector) => sector.id));

  assert.equal(sectorKpiMapVersion(), "sector_kpi_map.v1");
  assert.equal(map.missingPolicy.prohibitSyntheticValues, true);
  for (const [sectorId, definition] of Object.entries(map.sectors)) {
    assert.ok(taxonomyIds.has(sectorId), `${sectorId} is not in the research taxonomy`);
    for (const metric of [...definition.operatingKpis, ...definition.valuationMetrics]) {
      assert.equal(Object.hasOwn(metric, "value"), false, `${sectorId}.${metric.id} contains a value`);
    }
  }
});

test("REITs prefer P/FFO and explicitly exclude P/E", () => {
  const definition = sectorKpiDefinition("reits_data_centers");
  assert.equal(definition.matched, true);
  assert.equal(definition.valuationMetrics[0].id, "price_to_ffo");
  assert.ok(definition.operatingKpis.some((metric) => metric.id === "ffo_per_share"));
  assert.ok(definition.excludedMetrics.includes("pe"));
});

test("SaaS keeps issuer-only ARR and NRR as optional instead of fabricating them", () => {
  const definition = sectorKpiDefinition("cloud_saas_cybersecurity");
  const nrr = definition.operatingKpis.find((metric) => metric.id === "nrr");
  assert.equal(nrr.optional, true);
  assert.equal(definition.missingPolicy.issuerDisclosedOnly, true);
  assert.equal(definition.missingPolicy.defaultStatus, "insufficient");
});

test("combined sector sets deduplicate metrics and honor excluded valuation metrics", () => {
  const definition = resolveSectorKpiSet([
    "reits_data_centers",
    "financials_capital_markets",
  ]);
  assert.equal(definition.matchedSectorIds.length, 2);
  assert.equal(definition.valuationMetrics.some((metric) => metric.id === "pe"), false);
  assert.equal(
    new Set(definition.operatingKpis.map((metric) => metric.id)).size,
    definition.operatingKpis.length,
  );
});

test("unknown sectors use the general fallback without pretending to match", () => {
  const definition = sectorKpiDefinition("unknown_sector");
  assert.equal(definition.matched, false);
  assert.equal(definition.fallbackUsed, true);
  assert.equal(definition.valuationMetrics[0].id, "fcf_yield");
});
