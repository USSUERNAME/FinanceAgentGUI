import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildBriefGenerationPrompt,
  completeWorldMemoryCollectionCollectorState,
  worldMemoryBriefImportCounts,
} from "../server/worldMemoryApi.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

test("world memory collection embeds imported briefs automatically", () => {
  const source = readFileSync(resolve(TEST_DIR, "../server/worldMemoryApi.mjs"), "utf8");
  assert.match(
    source,
    /"brief-import"[\s\S]*?"--skip-if-duplicate"[\s\S]*?"--embedding-mode"[\s\S]*?"auto"/u,
  );
});

test("world memory collection reports the actual inserted brief count", () => {
  const counts = worldMemoryBriefImportCounts({
    stdout: "inserted=2 skipped_duplicates=3 total_input=5",
  });
  assert.deepEqual(counts, {
    inserted: 2,
    skippedDuplicates: 3,
    totalInput: 5,
  });

  const collector = completeWorldMemoryCollectionCollectorState({}, {
    importedCandidates: counts.inserted,
  });
  assert.match(collector.lastAction, /수집·분석 완료/u);
  assert.match(collector.lastAction, /신규 브리프 2건/u);
});

test("world memory brief generation rejects keyword-only story routing", () => {
  const prompt = buildBriefGenerationPrompt({
    preflight: "existing stories",
    feedScan: "new feed",
  });

  assert.match(prompt, /사건 대상, 인과관계, 시장 전달경로/u);
  assert.match(prompt, /단어가 겹치는 것만으로 story를 연결하지 않는다/u);
  assert.match(prompt, /제재·자금세탁·암호화폐 우회결제 단속/u);
  assert.match(prompt, /story, story_thesis, story_checkpoint를 빈 문자열/u);
});
