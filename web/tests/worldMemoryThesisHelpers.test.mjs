import assert from "node:assert/strict";
import test from "node:test";

import {
  activeInvestmentTheses,
  investmentThesisDomId,
  investmentThesisStateLabel,
  relatedInvestmentTheses,
} from "../src/worldMemory/thesisHelpers.js";

const records = [
  {
    continuityId: "pb-sector-xlk",
    entityId: "XLK",
    title: "기술 섹터 가설",
    sectorLabel: "기술",
    kind: "sector",
    state: "watching",
    stateLabel: "추적 중",
    lastSeenAt: "2026-07-30",
  },
  {
    continuityId: "pb-stock-nvda",
    entityId: "NVDA",
    title: "NVDA 투자 가설",
    state: "candidate",
    lastSeenAt: "2026-07-29",
  },
  {
    continuityId: "pb-sector-xli",
    entityId: "XLI",
    title: "산업재 섹터 가설",
    sectorLabel: "산업재",
    kind: "sector",
    state: "watching",
    lastSeenAt: "2026-07-28",
  },
  {
    continuityId: "pb-stock-old",
    entityId: "OLD",
    title: "OLD 투자 가설",
    state: "archived",
    lastSeenAt: "2026-07-31",
  },
];

test("World Memory investment thesis helpers keep active records and Korean labels", () => {
  const active = activeInvestmentTheses({ records });
  assert.deepEqual(active.map((record) => record.entityId), ["XLK", "NVDA", "XLI"]);
  assert.equal(investmentThesisStateLabel(active[0]), "추적 중");
  assert.equal(investmentThesisStateLabel(active[1]), "후보");
  assert.equal(investmentThesisDomId(active[1]), "world-memory-thesis-pb-stock-nvda");
});

test("World Memory report links only theses mentioned by ticker or sector", () => {
  const related = relatedInvestmentTheses(
    {
      view: {
        summary: "장기금리 상승으로 기술 섹터 부담이 확대됐습니다.",
        highlights: [{ title: "NVDA와 AI 투자 확인", body: "실적 반응을 추적합니다." }],
      },
    },
    { records },
  );
  assert.deepEqual(related.map((record) => record.entityId), ["XLK", "NVDA"]);
});

test("World Memory report links sector theses through bounded market themes", () => {
  const related = relatedInvestmentTheses(
    {
      view: {
        summary: "AI 데이터센터 투자가 전력망 인프라로 확장되고 있습니다.",
      },
    },
    { records },
  );
  assert.deepEqual(related.map((record) => record.entityId), ["XLK", "XLI"]);
});
