import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildInstitutionalHoldingsRadar,
  normalizeSnapshot,
  parse13fInformationTable,
  selectRecent13fFilings,
} from "../server/institutionalHoldingsApi.mjs";

test("13F XML parser keeps common shares and option rows distinguishable", () => {
  const rows = parse13fInformationTable(`<?xml version="1.0" encoding="UTF-8"?>
    <ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
      <ns1:infoTable>
        <ns1:nameOfIssuer>Example Technology Inc</ns1:nameOfIssuer>
        <ns1:titleOfClass>COM</ns1:titleOfClass>
        <ns1:cusip>123456789</ns1:cusip>
        <ns1:value>1500000</ns1:value>
        <ns1:shrsOrPrnAmt><ns1:sshPrnamt>25000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
        <ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion>
        <ns1:votingAuthority><ns1:Sole>25000</ns1:Sole><ns1:Shared>0</ns1:Shared><ns1:None>0</ns1:None></ns1:votingAuthority>
      </ns1:infoTable>
      <ns1:infoTable>
        <ns1:nameOfIssuer>Example Technology Inc</ns1:nameOfIssuer>
        <ns1:titleOfClass>COM</ns1:titleOfClass>
        <ns1:cusip>123456789</ns1:cusip>
        <ns1:value>250000</ns1:value>
        <ns1:shrsOrPrnAmt><ns1:sshPrnamt>1000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
        <ns1:putCall>PUT</ns1:putCall>
        <ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion>
        <ns1:votingAuthority><ns1:Sole>0</ns1:Sole><ns1:Shared>0</ns1:Shared><ns1:None>0</ns1:None></ns1:votingAuthority>
      </ns1:infoTable>
    </ns1:informationTable>`);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].issuer, "Example Technology Inc");
  assert.equal(rows[0].shares, 25000);
  assert.equal(rows[0].putCall, "");
  assert.equal(rows[1].putCall, "PUT");
});

test("radar excludes principal-amount rows from common-equity sector weights", () => {
  const current = normalizeSnapshot({
    manager: { cik: "0000000001" },
    filing: {
      reportDate: "2026-03-31",
      filingDate: "2026-05-15",
      accessionNumber: "0000000001-26-000001",
    },
    holdings: [
      {
        issuer: "APPLE INC", titleOfClass: "COM", cusip: "037833100", value: 20000,
        shares: 200, shareType: "SH", putCall: "",
      },
      {
        issuer: "EXAMPLE NOTE", titleOfClass: "NOTE", cusip: "999999999", value: 50000,
        shares: 50000, shareType: "PRN", putCall: "",
      },
    ],
    classifySector: () => ({ ticker: "XLK", basis: "test" }),
  });
  const radar = buildInstitutionalHoldingsRadar({
    managerHistories: [{
      manager: { id: "manager", name: "Manager", principal: "Principal", cik: "0000000001" },
      filings: [current],
    }],
  });

  assert.equal(current.totalValue, 20000);
  assert.equal(current.holdingCount, 1);
  assert.equal(radar.managers[0].latest.principalHoldingCount, 1);
  assert.match(radar.limitations.join(" "), /원금\(PRN\)/);
});

test("recent filing selector keeps one original 13F filing per report quarter", () => {
  const selected = selectRecent13fFilings({
    filings: {
      recent: {
        form: ["13F-HR/A", "13F-HR", "13F-HR", "13F-HR"],
        accessionNumber: ["a-amend", "a-original", "b-original", "c-original"],
        reportDate: ["2026-03-31", "2026-03-31", "2025-12-31", "2025-09-30"],
        filingDate: ["2026-05-20", "2026-05-15", "2026-02-13", "2025-11-14"],
        primaryDocument: ["amend.xml", "primary.xml", "primary.xml", "primary.xml"],
      },
    },
  }, 2);

  assert.deepEqual(selected.map((row) => row.accessionNumber), ["a-original", "b-original"]);
});

function filing({ reportDate, shares, managerIndex }) {
  const value = shares * 100;
  return {
    reportDate,
    filingDate: reportDate === "2026-03-31" ? "2026-05-15" : "2026-02-13",
    sourceUrl: `https://www.sec.gov/example/${managerIndex}/${reportDate}`,
    totalValue: value,
    holdingCount: 1,
    optionHoldingCount: 0,
    classificationCoveragePct: 100,
    sectors: [{ ticker: "XLK", label: "기술", value, holdingCount: 1, weightPct: 100 }],
    holdings: [{
      securityKey: "037833100:COM:LONG",
      issuer: "APPLE INC",
      titleOfClass: "COM",
      cusip: "037833100",
      sectorTicker: "XLK",
      sectorLabel: "기술",
      shareType: "SH",
      shares,
      value,
      portfolioWeightPct: 100,
    }],
  };
}

test("radar treats shared manager additions as research candidates, not recommendations", () => {
  const managerHistories = [1, 2, 3].map((managerIndex) => ({
    manager: {
      id: `manager-${managerIndex}`,
      name: `Manager ${managerIndex}`,
      principal: `Principal ${managerIndex}`,
      cik: String(managerIndex).padStart(10, "0"),
    },
    filings: [
      filing({ reportDate: "2026-03-31", shares: 200 + managerIndex, managerIndex }),
      filing({ reportDate: "2025-12-31", shares: 100 + managerIndex, managerIndex }),
    ],
  }));
  const radar = buildInstitutionalHoldingsRadar({
    managerHistories,
    sectorMembershipAsOf: "2026-08-08",
    generatedAt: "2026-08-10T00:00:00.000Z",
  });

  assert.equal(radar.summary.readyManagerCount, 3);
  assert.equal(radar.sectorConsensus[0].ticker, "XLK");
  assert.equal(radar.sectorConsensus[0].signal, "accumulation_candidate");
  assert.equal(radar.sectorConsensus[0].managerAdds.length, 3);
  assert.equal(radar.candidates[0].issuer, "APPLE INC");
  assert.equal(radar.candidates[0].researchPriority, "A");
  assert.equal(radar.candidates[0].status, "deeper_research_candidate");
  assert.match(radar.limitations.at(-1), /추천이 아닙니다/);
});

test("radar does not treat a first observed filing as a new purchase", () => {
  const radar = buildInstitutionalHoldingsRadar({
    managerHistories: [{
      manager: { id: "new-manager", name: "New Manager", principal: "Principal", cik: "0000000001" },
      filings: [filing({ reportDate: "2026-03-31", shares: 200, managerIndex: 1 })],
    }],
  });

  assert.equal(radar.managers[0].moves.length, 0);
  assert.equal(radar.candidates.length, 0);
  assert.equal(radar.sectorConsensus[0].managerAdds.length, 0);
});

test("radar keeps a fully exited sector and counts each manager once per issuer", () => {
  const current = filing({ reportDate: "2026-03-31", shares: 300, managerIndex: 1 });
  current.holdings.push({
    ...current.holdings[0],
    securityKey: "037833200:CL A:LONG",
    titleOfClass: "CL A",
    cusip: "037833200",
    shares: 100,
    value: 10000,
  });
  const previous = filing({ reportDate: "2025-12-31", shares: 100, managerIndex: 1 });
  previous.holdings.push({
    securityKey: "999999999:COM:LONG",
    issuer: "EXAMPLE ENERGY INC",
    titleOfClass: "COM",
    cusip: "999999999",
    sectorTicker: "XLE",
    sectorLabel: "에너지",
    shareType: "SH",
    shares: 100,
    value: 10000,
    portfolioWeightPct: 50,
  });
  previous.sectors.push({ ticker: "XLE", label: "에너지", value: 10000, holdingCount: 1, weightPct: 50 });
  const radar = buildInstitutionalHoldingsRadar({
    managerHistories: [{
      manager: { id: "manager", name: "Manager", principal: "Principal", cik: "0000000001" },
      filings: [current, previous],
    }],
  });

  assert.equal(radar.candidates[0].managerCount, 1);
  assert.equal(radar.candidates[0].newManagerCount + radar.candidates[0].increasedManagerCount, 1);
  assert.deepEqual(radar.sectorConsensus.find((sector) => sector.ticker === "XLE").managerCuts, ["Manager"]);
});

test("institutional radar is registered as an independent application screen", () => {
  const viteServer = readFileSync(new URL("../server/viteCodexApi.mjs", import.meta.url), "utf8");
  const productionServer = readFileSync(new URL("../server/server.mjs", import.meta.url), "utf8");
  const dailyView = readFileSync(new URL("../src/dailyIntelligence/DailyIntelligenceView.jsx", import.meta.url), "utf8");
  const institutionalView = readFileSync(new URL("../src/institutionalPortfolio/InstitutionalPortfolioView.jsx", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../src/shell/AppNavigation.jsx", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../src/shell/AppRoutes.jsx", import.meta.url), "utf8");
  const component = readFileSync(new URL("../src/dailyIntelligence/InstitutionalPortfolioRadar.jsx", import.meta.url), "utf8");

  assert.match(viteServer, /\/api\/institutional-holdings/);
  assert.match(productionServer, /\/api\/institutional-holdings/);
  assert.doesNotMatch(dailyView, /<InstitutionalPortfolioRadar/);
  assert.match(institutionalView, /<InstitutionalPortfolioRadar/);
  assert.match(navigation, /label: "기관 포트폴리오", icon: Building2, view: "institutional-portfolio"/);
  assert.match(routes, /activeView === "institutional-portfolio"/);
  assert.match(component, /대가 포트폴리오 레이더/);
  assert.match(component, /추천이 아닌 후속 분석 대기열/);
});
