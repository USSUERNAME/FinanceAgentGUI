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
      constituent_breadth: {
        schema_version: "us_constituent_breadth.v1",
        collection_status: "ready",
        as_of: "2026-07-22",
        universe: { membership_scope: "fund_holdings_proxy" },
        coverage: { daily_price_pct: 96.4 },
        breadth: {
          advance_decline: { advance_pct: 61.2, decline_pct: 38.0, net_advances: 116 },
          volume: { up_volume_pct: 58.3 },
          moving_averages: {
            "20d": { above_pct: 64.0 },
            "50d": { above_pct: 59.0 },
            "200d": { above_pct: 70.0 },
          },
          highs_lows_52w: { new_highs: 24, new_lows: 5 },
        },
        sector_breadth: {
          collection_status: "partial",
          coverage: {
            required_sector_count: 11,
            available_sector_count: 1,
            ready_sector_count: 1,
          },
          sectors: [
            {
              sector_ticker: "XLE",
              sector_name: "Energy",
              collection_status: "ready",
              membership_as_of: "2026-07-22",
              coverage: { daily_price_pct: 100 },
              breadth: {
                advance_decline: { advance_pct: 68.2 },
                volume: { up_volume_pct: 72.4 },
                moving_averages: {
                  "50d": { above_pct: 71.0 },
                  "200d": { above_pct: 64.0 },
                },
                highs_lows_52w: { new_highs: 4, new_lows: 0 },
              },
            },
          ],
        },
      },
      style_pairs: [
        {
          pair_id: "growth_vs_value",
          first_ticker: "IWF",
          second_ticker: "IWD",
          five_day_leader: "IWF",
          relative_returns_pct_point: { "1d": 0.2, "5d": 1.1, "20d": 2.4 },
        },
      ],
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
  assert.equal(snapshot.marketInternals.constituentBreadth.advancePct, 61.2);
  assert.equal(snapshot.marketInternals.constituentBreadth.above200dPct, 70);
  assert.equal(snapshot.marketInternals.sectorBreadth.readyCount, 1);
  assert.equal(snapshot.marketInternals.sectorBreadth.sectors[0].advancePct, 68.2);
  assert.equal(snapshot.marketInternals.stylePairs[0].relative1d, 0.2);
  assert.equal(snapshot.marketInternals.stylePairs[0].relative20d, 2.4);
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

test("PB Daily Intelligence prefers the latest Telegram-only refresh artifact", async () => {
  const reportDate = "2026-07-27";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: reportDate, title: "Live Telegram" }
  );
  await writeJson(
    join(tempRoot, "telegram_channels.json"),
    {
      schema_version: "telegram_channel_registry.v1",
      collection_policy: {},
      channels: [{
        username: "pb_channel_one",
        name: "PB 채널 1",
        category: "market_commentary",
        origin: "user_supplied",
        priority: 1,
        enabled: true,
        publication_policy: "internal_summary_with_attribution",
      }],
    }
  );
  await writeJson(
    join(tempRoot, "telegram_refresh", reportDate, "telegram_intelligence.json"),
    {
      schema_version: "telegram_intelligence_refresh.v1",
      generated_at: "2026-07-27T12:34:56+09:00",
      status: "ok",
      raw_post_count: 12,
      deduplicated_post_count: 9,
      duplicate_post_count: 3,
      event_cluster_count: 2,
      represented_channel_count: 1,
      clusters: [{
        event_id: "event-live",
        title: "실시간 텔레그램 사건",
        event_type: "market_structure",
        verification_status: "discovery_metadata_only",
        latest_published_at: "2026-07-27T03:00:00Z",
        post_count: 4,
        channels: ["PB 채널 1"],
        post_urls: ["https://t.me/pb_channel_one/10"],
      }],
    }
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: {
      PB_DAILY_INTELLIGENCE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
    },
  });
  assert.equal(snapshot.telegramSources.collection.lastCollectedAt, "2026-07-27T12:34:56+09:00");
  assert.equal(snapshot.telegramSources.collection.itemCount, 12);
  assert.equal(snapshot.telegramSources.deduplication.consolidatedPostCount, 3);
  assert.equal(snapshot.telegramSources.clusters[0].eventId, "event-live");
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
        sector_assessments: [
          {
            sector: "semiconductor",
            report_count: 2,
            signal: "mixed",
            stance_counts: { positive: 1, cautious: 1 },
            catalysts: ["AI demand"],
            risks: ["Valuation"],
            monitoring_conditions: ["Next earnings"],
          },
        ],
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
          market_scope: "US",
          issuer_country: "US",
          original_language: "en",
          base_currency: "USD",
          original_rating: "Overweight",
          normalized_rating: "positive",
          target_price: {
            value: 240,
            currency: "USD",
            as_of: "2026-07-24",
          },
          stance: "positive",
          tickers: ["NVDA"],
          sectors: ["semiconductor"],
          summary: "Demand remains constructive.",
          key_claims: ["Estimate direction improved."],
          catalysts: [],
          risks: ["Valuation"],
          monitoring_conditions: ["Next earnings"],
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
        {
          report_id: "research-2",
          publisher: "SK증권",
          analyst: "B. Analyst",
          title: "국내 반도체 업황",
          published_at: "2026-07-24T08:00:00+09:00",
          report_type: "industry",
          stance: "not_stated",
          tickers: ["005930"],
          sectors: ["반도체"],
          summary: "Legacy artifacts infer the domestic market from the publisher.",
          source: { reference: "REF-2", url: "" },
          processing: { structured_analysis_available: true, status: "ready" },
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
  assert.equal(snapshot.brokerResearch.consensus.sectorAssessments[0].signal, "mixed");
  assert.equal(
    snapshot.brokerResearch.consensus.sectorAssessments[0].monitoringConditions[0],
    "Next earnings"
  );
  assert.equal(snapshot.brokerResearch.reports[0].monitoringConditions[0], "Next earnings");
  assert.equal(snapshot.brokerResearch.summary.analysisStatus, "complete");
  assert.equal(snapshot.brokerResearch.reports[0].linkedTelegramEvents[0].eventId, "event-nvda");
  assert.equal(snapshot.brokerResearch.reports[0].marketScope, "US");
  assert.equal(snapshot.brokerResearch.reports[0].originalLanguage, "en");
  assert.equal(snapshot.brokerResearch.reports[0].rating.original, "Overweight");
  assert.equal(snapshot.brokerResearch.reports[0].targetPrice.value, 240);
  assert.equal(snapshot.brokerResearch.summary.marketScopeCounts.US, 1);
  assert.equal(snapshot.brokerResearch.summary.marketScopeCounts.KR, 1);
  assert.equal(snapshot.brokerResearch.reports[1].marketScope, "KR");
  assert.equal(snapshot.brokerResearchIndex.latest.reportCount, 2);
  assert.equal(snapshot.brokerResearchIndex.latest.domesticCount, 1);
  assert.equal(snapshot.brokerResearchIndex.latest.overseasCount, 1);
  assert.equal(snapshot.brokerResearchIndex.latest.targetPriceCount, 1);
  assert.equal(snapshot.brokerResearchIndex.history.length, 1);
  assert.equal(snapshot.brokerResearch.summary.sectorTaxonomyVersion, "research-sector-taxonomy.v1");
  assert.equal(snapshot.brokerResearch.reports[0].sectors[0], "semiconductor");
  assert.equal(
    snapshot.brokerResearch.reports[0].standardSectors[0].id,
    "semiconductors_ai_compute",
  );
  assert.equal(snapshot.brokerResearch.reports[1].sectors[0], "반도체");
  assert.equal(
    snapshot.brokerResearch.reports[1].standardSectors[0].id,
    "semiconductors_ai_compute",
  );
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].sectorId, "semiconductors_ai_compute");
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].sector, "반도체·AI 컴퓨트");
  assert.deepEqual(
    new Set(snapshot.brokerResearch.consensus.coverage[0].sourceLabels),
    new Set(["반도체", "semiconductor"]),
  );
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].reportCount, 2);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].publisherCount, 2);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].domesticCount, 1);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].overseasCount, 1);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].structuredCount, 2);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].ratedCount, 1);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].depth, "cross_checked");
  assert.deepEqual(
    snapshot.brokerResearch.consensus.coverage[0].topTickers,
    [
      { ticker: "005930", reportCount: 1 },
      { ticker: "NVDA", reportCount: 1 },
    ],
  );
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
  assert.deepEqual(snapshot.brokerResearchHistory.availableDates, [researchDate, readerDate]);
  assert.equal(snapshot.brokerResearchHistory.selectedDate, researchDate);
  assert.equal(snapshot.brokerResearchHistory.latestDate, researchDate);
  assert.equal(snapshot.brokerResearchIndex.history.length, 2);
  assert.equal(snapshot.brokerResearchIndex.latest.date, researchDate);
  assert.equal(snapshot.brokerResearchIndex.latest.reportCount, 3);
  assert.equal(snapshot.brokerResearchIndex.change.reportCount, 3);

  const priorSnapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
    brokerResearchDate: readerDate,
  });
  assert.equal(priorSnapshot.brokerResearch.reportDate, readerDate);
  assert.equal(priorSnapshot.brokerResearchHistory.selectedDate, readerDate);
});

test("PB Daily Intelligence tracks standardized sector coverage across research dates", async () => {
  const priorDate = "2026-07-27";
  const latestDate = "2026-07-28";
  await writeJson(
    join(tempRoot, "v2_reader_reports", latestDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: latestDate, title: "Sector trend" },
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", priorDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: priorDate,
      summary: {
        selected_report_count: 1,
        structured_report_count: 1,
        publisher_count: 1,
        analysis_status: "complete",
      },
      consensus: {},
      reports: [{
        report_id: "prior-semiconductor",
        publisher: "Prior Securities",
        title: "Memory update",
        market_scope: "US",
        sectors: ["Semiconductors"],
        stance: "positive",
        key_claims: ["Legacy memory thesis"],
        catalysts: ["Prior catalyst"],
        risks: ["Shared risk"],
        processing: { structured_analysis_available: true, status: "ready" },
      }],
    },
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", latestDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: latestDate,
      summary: {
        selected_report_count: 2,
        structured_report_count: 2,
        publisher_count: 2,
        analysis_status: "complete",
      },
      consensus: {},
      reports: [
        {
          report_id: "latest-semiconductor-1",
          publisher: "Latest Securities",
          title: "AI compute update",
          market_scope: "US",
          sectors: ["semiconductor"],
          normalized_rating: "positive",
          key_claims: ["AI demand expanded"],
          catalysts: ["New accelerator cycle"],
          risks: ["Shared risk"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
        {
          report_id: "latest-semiconductor-2",
          publisher: "국내증권",
          title: "메모리 업황",
          sectors: ["반도체"],
          stance: "neutral",
          key_claims: ["AI demand expanded"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
      ],
    },
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  const sectorHistory = snapshot.brokerResearchIndex.sectorHistory;
  assert.equal(sectorHistory.length, 2);
  assert.deepEqual(sectorHistory.map((point) => point.date), [priorDate, latestDate]);
  assert.equal(sectorHistory[0].sectors[0].sectorId, "semiconductors_ai_compute");
  assert.equal(sectorHistory[0].sectors[0].reportCount, 1);
  assert.equal(sectorHistory[0].sectors[0].publisherCount, 1);
  assert.deepEqual(sectorHistory[0].sectors[0].claims, ["Legacy memory thesis"]);
  assert.deepEqual(sectorHistory[0].sectors[0].catalysts, ["Prior catalyst"]);
  assert.deepEqual(sectorHistory[0].sectors[0].risks, ["Shared risk"]);
  assert.equal(sectorHistory[0].sectors[0].publisherOpinion.status, "single_source");
  assert.equal(sectorHistory[0].sectors[0].publisherOpinion.ratedPublisherCount, 1);
  assert.equal(sectorHistory[1].sectors[0].sectorId, "semiconductors_ai_compute");
  assert.equal(sectorHistory[1].sectors[0].reportCount, 2);
  assert.equal(sectorHistory[1].sectors[0].publisherCount, 2);
  assert.deepEqual(sectorHistory[1].sectors[0].claims, ["AI demand expanded"]);
  assert.deepEqual(sectorHistory[1].sectors[0].catalysts, ["New accelerator cycle"]);
  assert.deepEqual(sectorHistory[1].sectors[0].risks, ["Shared risk"]);
  assert.deepEqual(sectorHistory[1].sectors[0].publisherOpinion, {
    status: "divided",
    ratedPublisherCount: 2,
    mixedPublisherCount: 0,
    dominantStance: "",
    dominantSharePct: null,
    stances: {
      positive: ["Latest Securities"],
      neutral: ["국내증권"],
      cautious: [],
      negative: [],
      mixed: [],
    },
  });
  assert.deepEqual(sectorHistory[1].sectors[0].crossPublisherThemes, [{
    text: "AI demand expanded",
    publisherCount: 2,
    reportCount: 2,
    publishers: ["국내증권", "Latest Securities"],
    type: "claim",
  }]);
});
