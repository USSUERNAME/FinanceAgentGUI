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

test("PB Daily Intelligence reports Telegram readiness and event consolidation without exposing secrets", async () => {
  const reportDate = "2026-07-24";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: reportDate, title: "Telegram monitor" }
  );
  await writeJson(
    join(tempRoot, "telegram_channels.json"),
    {
      schema_version: "telegram_channel_registry.v1",
      collection_policy: {},
      channels: [
        {
          username: "pb_channel_one",
          name: "PB 채널 1",
          category: "market_commentary",
          origin: "user_supplied",
          priority: 1,
          enabled: true,
          publication_policy: "internal_summary_with_attribution",
        },
        {
          username: "pb_channel_two",
          name: "PB 채널 2",
          category: "broker_research",
          origin: "user_supplied",
          priority: 2,
          enabled: true,
          publication_policy: "link_only_bounded_summary",
        },
      ],
    }
  );
  await writeFile(
    join(tempRoot, ".env"),
    [
      "TELEGRAM_API_ID=12345",
      "TELEGRAM_API_HASH=secret-hash",
      "TELEGRAM_SESSION_STRING=secret-session",
    ].join("\n"),
    "utf8"
  );
  await writeJson(
    join(tempRoot, "source_status", reportDate, "source_status_090000.json"),
    {
      report_date: reportDate,
      sources: [{ source_id: "telegram_channels", status: "ok", item_count: 3 }],
    }
  );
  await writeJson(
    join(tempRoot, "triaged", reportDate, "triaged_inbox.json"),
    [
      {
        id: "tg-1",
        title: "같은 시장 사건 첫 관점",
        url: "https://t.me/pb_channel_one/1",
        published_at: "2026-07-24T01:00:00Z",
        source_id: "telegram_pb_channel_one",
        source_type: "telegram_commentary",
        telegram: { channel_username: "pb_channel_one", channel_name: "PB 채널 1" },
        event_cluster: { event_id: "event-shared", event_type: "macro_policy" },
      },
      {
        id: "tg-2",
        title: "같은 시장 사건 두 번째 관점",
        url: "https://t.me/pb_channel_two/2",
        published_at: "2026-07-24T02:00:00Z",
        source_id: "telegram_pb_channel_two",
        source_type: "telegram_commentary",
        telegram: { channel_username: "pb_channel_two", channel_name: "PB 채널 2" },
        event_cluster: { event_id: "event-shared", event_type: "macro_policy" },
      },
      {
        id: "tg-3",
        title: "별도 시장 사건",
        url: "https://t.me/pb_channel_one/3",
        published_at: "2026-07-24T03:00:00Z",
        source_id: "telegram_pb_channel_one",
        source_type: "telegram_commentary",
        telegram: { channel_username: "pb_channel_one", channel_name: "PB 채널 1" },
        event_cluster: { event_id: "event-other" },
      },
    ]
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: {
      PB_DAILY_INTELLIGENCE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
    },
  });
  assert.equal(snapshot.telegramSources.channelCount, 2);
  assert.equal(snapshot.telegramSources.credentials.ready, true);
  assert.equal(snapshot.telegramSources.collection.itemCount, 3);
  assert.equal(snapshot.telegramSources.deduplication.rawPostCount, 3);
  assert.equal(snapshot.telegramSources.deduplication.eventClusterCount, 2);
  assert.equal(snapshot.telegramSources.deduplication.consolidatedPostCount, 1);
  assert.equal(snapshot.telegramSources.clusters[0].eventId, "event-shared");
  assert.equal(snapshot.telegramSources.clusters[0].postCount, 2);
  assert.deepEqual(snapshot.telegramSources.clusters[0].channels, ["PB 채널 1", "PB 채널 2"]);
  assert.equal(JSON.stringify(snapshot.telegramSources).includes("secret-session"), false);
  assert.equal(JSON.stringify(snapshot.telegramSources).includes("secret-hash"), false);
});

test("PB Daily Intelligence exposes a rights-safe analyst research digest", async () => {
  const reportDate = "2026-07-24";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: reportDate, title: "Research monitor" }
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", reportDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: reportDate,
      generated_at: "2026-07-24T08:00:00+09:00",
      summary: {
        archived_report_count: 2,
        selected_report_count: 2,
        structured_report_count: 1,
        awaiting_analysis_count: 1,
        publisher_count: 2,
        analysis_status: "complete",
        telegram_linked_report_count: 1,
        stance_counts: { positive: 1, cautious: 1 },
      },
      consensus: {
        top_tickers: [{ ticker: "NVDA", report_count: 2 }],
        disagreements: [
          { topic: "NVDA", stances: ["positive", "cautious"], report_count: 2 },
        ],
      },
      reports: [
        {
          report_id: "research-1",
          publisher: "Example Securities",
          analyst: "A. Analyst",
          title: "NVDA earnings review",
          published_at: "2026-07-24T07:00:00+09:00",
          report_type: "earnings",
          stance: "positive",
          tickers: ["NVDA"],
          sectors: ["semiconductor"],
          summary: "Demand remains constructive.",
          key_claims: ["Estimate direction improved."],
          catalysts: [],
          risks: ["Valuation"],
          source: { reference: "REF-1", url: "https://example.com/research-1" },
          processing: { structured_analysis_available: true, status: "ready" },
          linked_telegram_events: [
            {
              event_id: "event-nvda",
              title: "NVDA demand update",
              score: 5,
              match_reasons: ["ticker:NVDA"],
              telegram_url: "https://t.me/pb/1",
              channel: "PB Channel",
            },
          ],
        },
      ],
    }
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  assert.equal(snapshot.brokerResearch.summary.selectedReportCount, 2);
  assert.equal(snapshot.brokerResearch.reports[0].publisher, "Example Securities");
  assert.equal(snapshot.brokerResearch.consensus.disagreements[0].topic, "NVDA");
  assert.equal(snapshot.brokerResearch.summary.analysisStatus, "complete");
  assert.equal(snapshot.brokerResearch.reports[0].linkedTelegramEvents[0].eventId, "event-nvda");
  assert.equal(JSON.stringify(snapshot.brokerResearch).includes("raw_text"), false);
});

test("PB Daily Intelligence shows newer analyst research independently of the reader date", async () => {
  const readerDate = "2026-07-24";
  const researchDate = "2026-07-25";
  await writeJson(
    join(tempRoot, "v2_reader_reports", readerDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: readerDate, title: "Prior reader report" }
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", readerDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: readerDate,
      summary: { selected_report_count: 0, analysis_status: "no_eligible_reports" },
      consensus: {},
      reports: [],
    }
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", researchDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: researchDate,
      summary: {
        selected_report_count: 3,
        structured_report_count: 3,
        publisher_count: 1,
        analysis_status: "complete",
      },
      consensus: {},
      reports: [],
    }
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  assert.equal(snapshot.connection.readerDate, readerDate);
  assert.equal(snapshot.brokerResearch.reportDate, researchDate);
  assert.equal(snapshot.brokerResearch.summary.selectedReportCount, 3);
  assert.equal(snapshot.brokerResearch.summary.analysisStatus, "complete");
});
