import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addResearchSectorAliasToFile,
  classifyResearchSector,
  researchSectorTaxonomyVersion,
  setResearchSectorMappingToFile,
  suggestResearchSectors,
} from "../server/researchSectorTaxonomy.mjs";

test("research sector taxonomy merges Korean and English semiconductor labels", () => {
  const korean = classifyResearchSector("반도체");
  const english = classifyResearchSector("Semiconductors");
  assert.equal(korean.id, "semiconductors_ai_compute");
  assert.equal(english.id, korean.id);
  assert.equal(korean.name, "반도체·AI 컴퓨트");
  assert.equal(english.name, korean.name);
});

test("research sector taxonomy normalizes punctuation and case", () => {
  const sector = classifyResearchSector("  OIL & GAS ");
  assert.equal(sector.id, "energy_oil_gas");
  assert.equal(sector.matched, true);
});

test("research sector taxonomy preserves unknown source labels", () => {
  const sector = classifyResearchSector("양자센서");
  assert.equal(sector.id, "");
  assert.equal(sector.name, "양자센서");
  assert.equal(sector.sourceLabel, "양자센서");
  assert.equal(sector.matched, false);
  assert.equal(researchSectorTaxonomyVersion(), "research-sector-taxonomy.v3");
});

test("research sector taxonomy maps transport operators without merging shipbuilders", () => {
  assert.equal(classifyResearchSector("운송").id, "transportation_logistics");
  assert.equal(classifyResearchSector("logistics").id, "transportation_logistics");
  assert.equal(classifyResearchSector("해운").id, "transportation_logistics");
  assert.equal(classifyResearchSector("조선").id, "shipbuilding_marine");
  assert.equal(classifyResearchSector("항공우주").id, "aerospace_defense");
});

test("research sector taxonomy persists an approved alias to an isolated config", () => {
  const directory = mkdtempSync(join(tmpdir(), "research-sector-taxonomy-"));
  const source = fileURLToPath(
    new URL("../../config/research-sector-taxonomy.json", import.meta.url),
  );
  const target = join(directory, "taxonomy.json");
  copyFileSync(source, target);
  try {
    const result = addResearchSectorAliasToFile(
      { sectorId: "semiconductors_ai_compute", alias: "AI 가속기" },
      target,
      { reload: false },
    );
    const payload = JSON.parse(readFileSync(target, "utf8"));
    const sector = payload.sectors.find((item) => item.id === "semiconductors_ai_compute");
    assert.equal(result.changed, true);
    assert.equal(sector.aliases.includes("AI 가속기"), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("research sector taxonomy recommends a clear suffix variant", () => {
  const suggestion = suggestResearchSectors("미디어업종");
  assert.equal(suggestion.confidence, "high");
  assert.equal(suggestion.candidates[0].sectorId, "media_gaming_entertainment");
  assert.equal(suggestion.candidates[0].score, 1);
});

test("research sector taxonomy keeps compound labels in human review", () => {
  const suggestion = suggestResearchSectors("인터넷게임");
  assert.equal(suggestion.confidence, "review");
  assert.deepEqual(
    new Set(suggestion.candidates.map((item) => item.sectorId)),
    new Set(["consumer_internet_platforms", "media_gaming_entertainment"]),
  );
});

test("research taxonomy separates broad sectors, themes, and cross-market research", () => {
  const technology = classifyResearchSector("IT");
  const carbon = classifyResearchSector("탄소");
  const credit = classifyResearchSector("크레딧");
  const index = classifyResearchSector("지수");

  assert.equal(technology.id, "technology_hardware_services");
  assert.equal(technology.kind, "sector");
  assert.equal(carbon.id, "carbon_decarbonization");
  assert.equal(carbon.kind, "theme");
  assert.equal(credit.id, "fixed_income_credit");
  assert.equal(credit.kind, "cross_market");
  assert.equal(index.id, "etf_index_strategy");
  assert.equal(index.kind, "cross_market");
});

test("generic AI remains unmapped instead of forcing a semiconductor classification", () => {
  const genericAi = classifyResearchSector("AI");
  assert.equal(genericAi.matched, false);
  assert.equal(genericAi.id, "");
});

test("compound report labels expose one primary sector and secondary themes", () => {
  const compound = classifyResearchSector("AI인터넷게임");
  assert.equal(compound.id, "consumer_internet_platforms");
  assert.deepEqual(compound.sectorIds, [
    "consumer_internet_platforms",
    "media_gaming_entertainment",
  ]);
  assert.deepEqual(
    compound.secondarySectors.map((sector) => sector.id),
    ["media_gaming_entertainment"],
  );
});

test("research sector taxonomy persists a multi-sector mapping to an isolated config", () => {
  const directory = mkdtempSync(join(tmpdir(), "research-sector-mapping-"));
  const source = fileURLToPath(
    new URL("../../config/research-sector-taxonomy.json", import.meta.url),
  );
  const target = join(directory, "taxonomy.json");
  copyFileSync(source, target);
  try {
    const result = setResearchSectorMappingToFile(
      {
        alias: "AI 소프트웨어",
        primarySectorId: "technology_hardware_services",
        secondarySectorIds: ["cloud_saas_cybersecurity"],
      },
      target,
      { reload: false },
    );
    const payload = JSON.parse(readFileSync(target, "utf8"));
    const mapping = payload.aliasMappings.find((item) => item.alias === "AI 소프트웨어");
    assert.equal(result.changed, true);
    assert.equal(mapping.primarySectorId, "technology_hardware_services");
    assert.deepEqual(mapping.secondarySectorIds, ["cloud_saas_cybersecurity"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("new foundational US sectors map common source labels", () => {
  assert.equal(classifyResearchSector("필수소비재").id, "consumer_staples_food_beverage");
  assert.equal(classifyResearchSector("통신장비").id, "communications_network_equipment");
  assert.equal(classifyResearchSector("의료기기").id, "healthcare_services_medtech");
  assert.equal(classifyResearchSector("부동산").id, "real_estate_general");
});
