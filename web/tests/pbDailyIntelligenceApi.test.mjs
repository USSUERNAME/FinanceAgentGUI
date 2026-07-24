import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadPbDailyIntelligenceSnapshot } from "../server/pbDailyIntelligenceApi.mjs";

const tempRoot = join(process.cwd(), "data", ".test-pb-daily-intelligence");

async function writeJson(filePath, payload) {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload), "utf8");
}

test.afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("PB Daily Intelligence reports an explicit disconnected state", async () => {
  const snapshot = await loadPbDailyIntelligenceSnapshot({ env: {} });
  assert.deepEqual(snapshot.connection, {
    configured: false,
    available: false,
    reason: "not_configured",
  });
  assert.equal(snapshot.report, null);
});

test("PB Daily Intelligence separates verified reader content from review queue", async () => {
  const reportDate = "2026-07-23";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    {
      schema_version: "v2_reader_report.v1",
      report_date: reportDate,
      generated_at: "2026-07-24T08:00:00+09:00",
      title: "Daily Market Intelligence",
      executive_summary: ["선별적 순환매가 이어졌다."],
      market_findings: [{ title: "시장 폭", body: "동일가중이 우위였다." }],
      verified_events: [],
      korea_connection: { status: "insufficient", summary: "수급 데이터가 부족하다." },
      next_checks: ["외국인 선물 수급"],
      data_status: {
        latest_price_as_of: "2026-07-22",
        verified_event_count: 0,
        korea_data_status: "insufficient",
        warnings: ["한국시장 데이터 부족"],
      },
      sources: [{ source_id: "fred:DGS10", title: "US 10Y", url: "https://example.com" }],
    }
  );
  await writeJson(
    join(tempRoot, "intelligence", reportDate, "daily_intelligence.json"),
    {
      schema_version: "daily_market_intelligence.v2",
      events: {
        cluster_count: 15,
        selected_count: 15,
        verified_primary_fact_count: 0,
        synthesis_status: "not_run",
        fallback_reason: "no_eligible_events",
        items: Array.from({ length: 15 }, (_, index) => ({
            event_id: `event-${index + 1}`,
            title: `검증 전 후보 ${index + 1}`,
            event_type: "policy",
            source_summary: { source_urls: ["https://example.com/candidate"] },
            verification: {
              publication_eligible_as_fact: false,
              extraction_status: "not_run",
            },
            ranking: { priority_score: 42 - index, evidence_readiness_score: 15 },
          })),
      },
      market: {
        regime: { label: "selective_rotation", confidence: 0.6, summary: "순환매" },
        scoreboard: {
          breadth: {
            rsp_vs_spy_5d_pct: 0.86,
            rsp_vs_spy_1d_pct: 0.08,
            as_of: "2026-07-22",
          },
          volatility: {
            vix: { value: 17.05, change_1d: -1.6, as_of: "2026-07-21" },
            vix_term_ratio: 0.87,
            as_of: "2026-07-21",
          },
          rule_based_signal: {
            participation: { qqq_vs_spy_5d_pct: -0.75, iwm_vs_spy_5d_pct: 0.31 },
          },
        },
      },
    }
  );
  await writeJson(
    join(tempRoot, "us_market_internals", reportDate, "market_internals.json"),
    {
      schema_version: "us_market_internals.v1",
      collection_status: "partial_coverage",
      coverage: { available_ticker_count: 3, required_ticker_count: 11, missing_tickers: ["XLY"] },
      market_structure: { classification: "insufficient_data", reason: "partial" },
      sector_leadership: {
        "5d": {
          all_sectors: [
            { ticker: "XLE", sector: "Energy", return_pct: 4.7, vs_spy_pct_point: 5.8 },
          ],
        },
      },
      data_gaps: ["partial coverage"],
    }
  );
  await writeJson(
    join(tempRoot, "sector_metrics", reportDate, "sector_metrics.json"),
    {
      schema_version: "sector_metric_observations.v1",
      collection_status: "complete",
      available_metric_count: 1,
      metrics: [
        {
          metric_id: "semis",
          sector_id: "semiconductors_ai_compute",
          label_ko: "미국 반도체 산업생산",
          status: "available",
          score: 89.4,
          change_1_period_pct: 0.5,
          source_url: "https://example.com/semis",
        },
      ],
    }
  );
  await writeJson(
    join(tempRoot, "us_equity_candidate_screen", reportDate, "candidate_screen.json"),
    {
      schema_version: "us_equity_candidate_screen.v1",
      screen_status: "complete",
      candidates: [
        {
          ticker: "NVDA",
          company_name: "NVIDIA",
          selection_score: 39,
          market_reaction: { return_1d_pct: 2.3, spy_relative_1d_pct: 2.4 },
          event_evidence: [
            {
              title: "NVDA 8-K",
              source_url: "https://example.com/nvda",
              primary_source_confirmed: true,
              verified_facts: [{ field: "sec_item" }],
            },
          ],
        },
      ],
    }
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  assert.equal(snapshot.connection.available, true);
  assert.equal(snapshot.connection.sameReportDate, true);
  assert.equal(snapshot.report.verifiedEvents.length, 0);
  assert.equal(snapshot.pipeline.reviewQueue.length, 15);
  assert.equal(snapshot.pipeline.reviewQueue[0].title, "검증 전 후보 1");
  assert.equal(snapshot.pipeline.reviewQueue[0].priorityScore, 42);
  assert.equal(snapshot.scoreboard.cards[0].label, "RSP/SPY");
  assert.equal(snapshot.marketInternals.sectors["5d"][0].ticker, "XLE");
  assert.equal(snapshot.sectorMetrics.metrics[0].score, 89.4);
  assert.equal(snapshot.stockCandidates.candidates[0].ticker, "NVDA");
});

test("PB Daily Intelligence selects the newest valid reader artifact", async () => {
  await writeJson(
    join(tempRoot, "v2_reader_reports", "2026-07-22", "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: "2026-07-22", title: "Old" }
  );
  await writeJson(
    join(tempRoot, "v2_reader_reports", "2026-07-24", "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: "2026-07-24", title: "Latest" }
  );
  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  assert.equal(snapshot.report.title, "Latest");
  assert.equal(snapshot.connection.readerDate, "2026-07-24");
});
