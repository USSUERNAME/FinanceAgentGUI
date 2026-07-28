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
  assert.equal(researchSectorTaxonomyVersion(), "research-sector-taxonomy.v1");
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
