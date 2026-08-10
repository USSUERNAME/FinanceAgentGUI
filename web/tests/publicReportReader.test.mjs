import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildPublicReportReader,
  buildCandidatePerformance,
  buildWorldMemorySnapshot,
  sanitizeCompanyProfiles,
  sanitizePendingCandidateScreen,
  sanitizeDailyIntelligence,
  sanitizeReaderReport,
  sanitizeTelegramRefresh,
  sanitizeWorldMemorySnapshot,
} from "../../scripts/build-public-report-reader.mjs";

const templateDir = fileURLToPath(new URL("../public-report-reader", import.meta.url));
const sensitiveKey = (...parts) => parts.join("_");

function privateReaderReport() {
  return {
    schema_version: "v2_reader_report.v1",
    report_date: "2026-08-08",
    generated_at: "2026-08-08T08:30:00+09:00",
    title: "2026-08-08 Daily Market Intelligence",
    executive_summary: ["시장 핵심 요약"],
    market_findings: [{ title: "금리", body: "실질금리 상승" }],
    korea_connection: {
      status: "ready",
      summary: "Korea market ready",
      metrics: [{
        metric_id: "foreign_kospi_cash_net_buy_krw",
        label: "Foreign KOSPI cash flow",
        status: "available",
        value: 987654321,
        provider_value: 987.654321,
        source_provider: "private-provider",
        as_of: "2026-08-07",
        source_grade: "A",
        primary_source_confirmed: true,
      }],
    },
    analyst_research: [{
      publisher: "Example Securities",
      title: "반도체 점검",
      summary: "수요 회복을 확인했습니다.",
      tickers: ["005930"],
      key_claims: ["재고가 정상화되고 있습니다."],
      source: { url: "https://example.com/report" },
      full_text: "배포하면 안 되는 PDF 원문",
      rights: { full_text_included: true },
    }],
    sources: [
      { title: "공식 통계", url: "https://example.com/source", as_of: "2026-08-08" },
      { title: "위험 링크", url: "javascript:alert(1)" },
    ],
    [sensitiveKey("private", "token")]: "never-publish-this",
  };
}

function privateDailyIntelligence() {
  return {
    schema_version: "daily_market_intelligence.v2",
    report_date: "2026-08-08",
    generated_at: "2026-08-08T08:31:00+09:00",
    audience: "private-banker",
    market: {
      data_cutoff: { latest_price_as_of: "2026-08-07", status: "ready" },
      regime: { label: "중립", confidence: 0.72, summary: "유동성과 성장 신호가 엇갈립니다.", quantitative_evidence: ["VIX 18"] },
      key_drivers: [{ observation: "장기금리 상승", interpretation: "성장주 할인율 부담", confirmation_condition: "10년물 4.5% 상회", invalidation_condition: "4.2% 하회" }],
      conflicting_signals: ["신용은 안정적이지만 변동성은 상승"],
      top_risks: ["물가 재가속"],
      scoreboard: { rates: { nominal_10y: { value: 4.4 }, [sensitiveKey("api", "token")]: "drop-me" } },
      day_over_day_changes: { status: "changed" },
      korea_transmission_inputs: {
        report_date: "2026-08-08",
        collection_status: "complete",
        metrics: {
          usdkrw: { label: "USD/KRW", status: "available", value: 1400, change_1d_pct: 0.3, as_of: "2026-08-07", source_provider: "BOK", source_grade: "A", primary_source_confirmed: true },
          foreign_kospi_cash_net_buy_krw: { label: "Foreign KOSPI cash flow", status: "available", value: 987654321, provider_value: 987.654321, provider_unit: "million_krw", source_provider: "private-provider", as_of: "2026-08-07", source_grade: "A", primary_source_confirmed: true },
          foreign_kospi200_futures_net_buy_contracts: { label: "Foreign KOSPI200 futures flow", status: "available", value: -4321, provider_value: -4321, source_provider: "private-provider", as_of: "2026-08-07", source_grade: "A", primary_source_confirmed: true },
        },
        transmission_gate: {
          status: "ready_for_korea_transmission",
          date_alignment: { status: "aligned", earliest_as_of: "2026-08-07", latest_as_of: "2026-08-07", business_day_gap: 0, metric_dates: { usdkrw: "2026-08-07" } },
        },
      },
    },
    events: {
      selected_count: 1,
      verified_primary_fact_count: 1,
      items: [{
        event_id: "event-1",
        event_type: "macro",
        title: "연준 정책 경로 재평가",
        topic_tags: ["Fed", "rates"],
        common_facts: ["공식 발언이 공개됨"],
        impact_analysis: { equities: "멀티플 부담" },
        raw_content: "drop raw event body",
      }],
    },
    continuity: { summary: { entry_count: 1 }, active_entries: [{ title: "연준 정책 경로", monitoring_state: "active" }] },
    earnings: { status: "ready", summary: { company_count: 2 }, companies: [] },
    cross_source_summary: { event_count: 1 },
    source_state: {
      quality: { record_count: 10, primary_confirmation_rate_pct: 50, record_linkage: [{ [sensitiveKey("private", "token")]: "drop" }] },
      data_warnings: ["일부 브로커 리포트는 참조만 제공"],
    },
    [sensitiveKey("oauth", "refresh", "token")]: "drop-oauth",
  };
}

function privateWorldMemory() {
  return buildWorldMemorySnapshot({
    updatedAt: "2026-08-08T09:00:00+09:00",
    collector: { status: "idle", lastSuccessfulAt: "2026-08-08T08:58:00+09:00", [["se", "cret"].join("")]: "drop" },
    report: {
      generatedAt: "2026-08-08T09:00:00+09:00",
      view: {
        title: "현재 시장 상황 인식",
        asOf: "2026-08-08T09:00:00+09:00",
        stance: "관찰",
        summary: "정책과 성장 신호가 엇갈립니다.",
        narrative: "확인 조건을 중심으로 추적합니다.",
        signalRadar: [{ label: "금리", score: 72, tone: "risk", note: "실질금리 상승" }],
        highlights: [{ title: "연준", body: "완화 기대가 후퇴했습니다.", tag: "macro", importance: "high" }],
        portfolioSuggestions: ["듀레이션 노출 점검"],
        nextChecks: ["미국 CPI"],
      },
      rawText: "drop raw report",
    },
  }, {
    updatedAt: "2026-08-08T08:55:00+09:00",
    records: [{
      continuityId: "thesis-1",
      title: "반도체 사이클",
      thesis: "메모리 업황 회복을 관찰합니다.",
      confirmationCondition: "가격 상승",
      invalidationCondition: "재고 재증가",
      evidence: ["가격 지표"],
      [sensitiveKey("private", "token")]: "drop thesis token",
    }],
  });
}

function privateTelegramRefresh() {
  return {
    schema_version: "telegram_intelligence_refresh.v1",
    generated_at: "2026-08-08T12:17:00+09:00",
    status: "ok",
    raw_post_count: 155,
    deduplicated_post_count: 128,
    event_cluster_count: 2,
    represented_channel_count: 17,
    pdf_attachment_count: 18,
    pdf_attachments: [{ filename: "private-report.pdf", raw_content: "never publish" }],
    clusters: [{
      event_id: "telegram-event-1",
      title: "반도체 공급망 점검",
      event_type: "supply_chain",
      verification_status: "discovery_metadata_only",
      latest_published_at: "2026-08-08T11:50:00+09:00",
      post_count: 3,
      channels: ["채널 A", "채널 B"],
      post_urls: ["https://t.me/example/1", "https://example.com/not-telegram"],
      full_text: "drop this body",
    }],
    [sensitiveKey("telegram", "session", "token")]: "drop-session",
  };
}

function privateCompanyProfiles() {
  return {
    schema_version: "company_long_term_profiles.v2",
    report_date: "2026-08-08",
    profile_count: 1,
    profiles: [{
      ticker: "NVDA",
      company_name: "NVIDIA",
      as_of_date: "2026-08-08",
      candidate_origin: "verified_event_screen",
      company_quality: { status: "financial_compounding_supported", label: "재무 복리 확인", reason: "영업이익과 FCF가 확대됐습니다." },
      stock_attractiveness: { status: "evaluation_withheld", label: "평가 보류", reason: "3개 시나리오가 필요합니다." },
      portfolio_fit: { status: "evaluation_withheld", label: "평가 보류", score: null, reason: "개인 포트폴리오 정보가 없습니다." },
      judgment_framework: { source_gap_count: 4 },
      official_business_evidence: {
        status: "verified_primary",
        evidence_summary: "10-K Item 1에서 핵심 사업을 확인했습니다.",
        body_location: "10-K Item 1 Business",
        issuer_excerpt: "회사는 가속 컴퓨팅 플랫폼과 소프트웨어 생태계를 운영한다고 설명합니다.",
        evidence_class: "issuer_disclosed_fact_and_claim",
        source_url: "https://www.sec.gov/example-business",
      },
      issuer_competitive_claims: {
        status: "issuer_claims_available_not_independently_verified",
        verified: false,
        issuer_claims: ["회사는 생태계 규모가 경쟁력이라고 설명합니다."],
      },
      official_risk_factors: {
        status: "verified_primary",
        body_location: "10-K Item 1A Risk Factors",
        excerpt: "수요, 공급, 경쟁과 규제 변화가 실적에 영향을 줄 수 있습니다.",
      },
      management_execution_evidence: {
        status: "not_verified",
        verified: false,
        reason: "사업 설명만으로 실행력을 판정하지 않습니다.",
      },
      valuation_scenarios: {
        status: "supported_screening_model",
        model: "five_year_revenue_fcf_margin_terminal_multiple",
        evidence_class: "derived_calculation_from_primary_financials_and_dated_market_price",
        horizon_years: 5,
        required_return_pct: 10,
        current_price: 180,
        price_as_of: "2026-08-08",
        current_fcf_per_share: 4.2,
        fair_value_range: { low: 121.4, high: 248.6, currency: "USD" },
        implied_fcf_growth_pct: 15.2,
        base_case_fcf_growth_pct: 14.1,
        current_price_expectation: "requires_growth_near_base_case",
        scenarios: [{
          scenario: "bear", revenue_growth_pct: 8, operating_margin_pct: 45,
          fcf_margin_pct: 32, terminal_price_to_fcf: 18,
          terminal_fcf_per_share: 10, terminal_value_per_share: 180,
          present_value_per_share: 121.4, upside_downside_pct: -32.56,
        }, {
          scenario: "base", revenue_growth_pct: 14, operating_margin_pct: 55,
          fcf_margin_pct: 40, terminal_price_to_fcf: 24,
          terminal_fcf_per_share: 12, terminal_value_per_share: 288,
          present_value_per_share: 178.8, upside_downside_pct: -0.67,
        }, {
          scenario: "bull", revenue_growth_pct: 20, operating_margin_pct: 60,
          fcf_margin_pct: 44, terminal_price_to_fcf: 29,
          terminal_fcf_per_share: 14, terminal_value_per_share: 406,
          present_value_per_share: 248.6, upside_downside_pct: 38.11,
        }],
        assumption_limits: ["희석주식수는 최근 수준으로 고정했습니다."],
      },
      long_term_financials: {
        summary: { complete_core_years: 5, operating_income_cagr_pct: 22.5, fcf_cagr_pct: 25.1, median_fcf_conversion_pct: 84.2 },
        quality_gate: { status: "ready", complete_core_years: 5, missing: [] },
        periods: [{ period: "2025", revenue: 999999999 }],
      },
      scorecard: { status: "withheld_incomplete_evidence", overall_score: null, scored_points: 31, scored_max: 35, missing_components: ["moat"], reason: "근거 부족" },
      action: { grade: "관망", reason: "추가 근거가 필요합니다.", next_required_evidence: ["해자 검증"], confirmation_conditions: ["FCF 성장 지속"], invalidation_conditions: ["마진 훼손"], automatic_position_action: false },
      source_urls: ["https://www.sec.gov/example", "javascript:alert(1)"],
      full_text: "never publish company raw filing",
      [sensitiveKey("api", "token")]: "drop-company-token",
    }],
  };
}

function privateCandidateScreen() {
  return {
    schema_version: "us_equity_candidate_screen.v1",
    report_date: "2026-08-08",
    screen_status: "candidates_without_primary_evidence",
    material_candidate_count: 96,
    candidates: [{
      ticker: "TTD",
      company_name: "The Trade Desk",
      selection_score: 45,
      deep_analysis_eligible: false,
      selection_reasons: ["abnormal_spy_relative_move", "volume_anomaly"],
      evidence_status: "market_anomaly_without_primary_material",
      next_workflow: "anomaly_watchlist_only",
      market_reaction: {
        close: 13.79,
        return_1d_pct: -22.0023,
        return_5d_pct: -23.5588,
        volume_ratio_20d: 4.6256,
        raw_content: "drop market raw content",
      },
      score_breakdown: { abnormal_price_move: 20, volume_anomaly: 15, official_material: 0 },
      event_evidence: [],
      full_text: "drop candidate raw body",
      [sensitiveKey("api", "token")]: "drop-candidate-token",
    }],
  };
}

test("public report sanitizer keeps summaries and drops private or full-text fields", () => {
  const report = sanitizeReaderReport(privateReaderReport());
  const serialized = JSON.stringify(report);
  assert.equal(report.reportDate, "2026-08-08");
  assert.equal(report.analystResearch[0].summary, "수요 회복을 확인했습니다.");
  assert.equal(report.sources[1].url, "");
  assert.equal(report.koreaConnection.metrics[0].direction, "net_buy");
  assert.doesNotMatch(serialized, /PDF 원문|never-publish-this|full_text|rights|987654321|987\.654321|private-provider|provider_value/);
});

test("daily intelligence sanitizer keeps decision fields and drops raw, token, and linkage rows", () => {
  const report = sanitizeDailyIntelligence(privateDailyIntelligence());
  const serialized = JSON.stringify(report);
  assert.equal(report.market.regime.label, "중립");
  assert.equal(report.events.items[0].title, "연준 정책 경로 재평가");
  assert.equal(report.sourceQuality.record_count, 10);
  assert.equal(report.market.koreaTransmission.metrics.usdkrw.direction, "up");
  assert.equal(report.market.koreaTransmission.metrics.foreign_kospi_cash_net_buy_krw.direction, "net_buy");
  assert.equal(report.market.koreaTransmission.metrics.foreign_kospi200_futures_net_buy_contracts.direction, "net_sell");
  assert.equal(report.market.koreaTransmission.transmissionGate.dateAlignment.status, "aligned");
  assert.doesNotMatch(serialized, /drop-me|drop raw|drop-oauth|record_linkage|oauth_refresh_token|api_token|987654321|987\.654321|private-provider|provider_value|metric_dates/);
});

test("World Memory snapshot exposes report and theses without runtime state or secrets", () => {
  const memory = sanitizeWorldMemorySnapshot(privateWorldMemory());
  const serialized = JSON.stringify(memory);
  assert.equal(memory.report.signalRadar[0].score, 72);
  assert.equal(memory.theses[0].title, "반도체 사이클");
  assert.doesNotMatch(serialized, /drop raw|drop thesis|secret|rawText|private_token/);
});

test("Telegram refresh sanitizer keeps bounded discovery metadata only", () => {
  const telegram = sanitizeTelegramRefresh(privateTelegramRefresh());
  const serialized = JSON.stringify(telegram);
  assert.equal(telegram.rawPostCount, 155);
  assert.equal(telegram.clusters[0].title, "반도체 공급망 점검");
  assert.deepEqual(telegram.clusters[0].postUrls, ["https://t.me/example/1"]);
  assert.doesNotMatch(serialized, /private-report|never publish|drop this body|drop-session|pdf_attachments|full_text/);
});

test("company candidate sanitizer keeps judgment cards and drops raw financial rows", () => {
  const companies = sanitizeCompanyProfiles(privateCompanyProfiles());
  const serialized = JSON.stringify(companies);
  assert.equal(companies.profileCount, 1);
  assert.equal(companies.profiles[0].ticker, "NVDA");
  assert.equal(companies.profiles[0].action.grade, "관망");
  assert.equal(companies.profiles[0].officialBusinessEvidence.status, "verified_primary");
  assert.match(companies.profiles[0].officialBusinessEvidence.issuerExcerpt, /가속 컴퓨팅/);
  assert.equal(companies.profiles[0].issuerCompetitiveClaims.verified, false);
  assert.match(companies.profiles[0].officialRiskFactors.excerpt, /규제 변화/);
  assert.equal(companies.profiles[0].valuationScenarios.status, "supported_screening_model");
  assert.equal(companies.profiles[0].valuationScenarios.scenarios.length, 3);
  assert.equal(companies.profiles[0].valuationScenarios.fairValueRange.high, 248.6);
  assert.deepEqual(companies.profiles[0].sourceUrls, ["https://www.sec.gov/example"]);
  assert.doesNotMatch(serialized, /999999999|never publish company|drop-company-token|periods|full_text|api_token/);
});

test("pending candidate sanitizer keeps bounded market context without raw evidence", () => {
  const screen = sanitizePendingCandidateScreen(privateCandidateScreen());
  const serialized = JSON.stringify(screen);
  assert.equal(screen.materialCandidateCount, 96);
  assert.equal(screen.pendingCount, 1);
  assert.equal(screen.pendingCandidates[0].ticker, "TTD");
  assert.equal(screen.pendingCandidates[0].marketReaction.return_1d_pct, -22.0023);
  assert.doesNotMatch(serialized, /drop market raw|drop candidate raw|drop-candidate-token|full_text|api_token/);
});

test("candidate performance preserves first registration price and waits for unreached horizons", () => {
  const older = sanitizeCompanyProfiles(privateCompanyProfiles());
  const newer = sanitizeCompanyProfiles({
    ...privateCompanyProfiles(),
    report_date: "2026-08-16",
    profiles: privateCompanyProfiles().profiles.map((item) => ({
      ...item,
      valuation_scenarios: { ...item.valuation_scenarios, current_price: 198 },
    })),
  });
  const rows = buildCandidatePerformance([newer, older]);
  const nvda = rows.find((item) => item.ticker === "NVDA");
  assert.equal(nvda.firstSeenDate, "2026-08-08");
  assert.equal(nvda.firstPrice, 180);
  assert.equal(nvda.latestPrice, 198);
  assert.equal(nvda.return1wPct, 10);
  assert.equal(nvda.return1mPct, null);
  assert.equal(nvda.benchmarkExcessStatus, "pending_comparable_benchmark");
});

test("reader builder emits a locked placeholder without private data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-locked-"));
  const outputDir = join(root, "output");
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await buildPublicReportReader({ inputDir: join(root, "missing"), outputDir, templateDir, locked: true });
  const payload = JSON.parse(await readFile(join(outputDir, "reports.json"), "utf8"));
  assert.equal(result.locked, true);
  assert.deepEqual(payload.reports, []);
  assert.deepEqual(payload.intelligence, []);
  assert.deepEqual(payload.companies, []);
  assert.equal(payload.worldMemory, null);
  assert.equal(payload.telegram, null);
});

test("reader builder combines brief, full intelligence, company candidates, Telegram, and World Memory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-live-"));
  const inputDir = join(root, "workspace", "v2_reader_reports", "2026-08-08");
  const intelligenceDir = join(root, "workspace", "intelligence", "2026-08-08");
  const worldMemoryFile = join(root, "world-memory.json");
  const telegramDir = join(root, "workspace", "telegram_refresh", "2026-08-08");
  const companiesDir = join(root, "workspace", "company_long_term_profiles", "2026-08-08");
  const candidateScreensDir = join(root, "workspace", "us_equity_candidate_screen", "2026-08-08");
  const outputDir = join(root, "output");
  await mkdir(inputDir, { recursive: true });
  await mkdir(intelligenceDir, { recursive: true });
  await mkdir(telegramDir, { recursive: true });
  await mkdir(companiesDir, { recursive: true });
  await mkdir(candidateScreensDir, { recursive: true });
  await writeFile(join(inputDir, "reader_report.json"), JSON.stringify(privateReaderReport()), "utf8");
  await writeFile(join(intelligenceDir, "daily_intelligence.json"), JSON.stringify(privateDailyIntelligence()), "utf8");
  await writeFile(worldMemoryFile, JSON.stringify(privateWorldMemory()), "utf8");
  await writeFile(join(telegramDir, "telegram_intelligence.json"), JSON.stringify(privateTelegramRefresh()), "utf8");
  await writeFile(join(companiesDir, "company_long_term_profiles.json"), JSON.stringify(privateCompanyProfiles()), "utf8");
  await writeFile(join(candidateScreensDir, "candidate_screen.json"), JSON.stringify(privateCandidateScreen()), "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await buildPublicReportReader({ inputDir: join(root, "workspace", "v2_reader_reports"), intelligenceDir: join(root, "workspace", "intelligence"), companiesDir: join(root, "workspace", "company_long_term_profiles"), candidateScreensDir: join(root, "workspace", "us_equity_candidate_screen"), telegramDir: join(root, "workspace", "telegram_refresh"), worldMemoryFile, outputDir, templateDir });
  const serialized = await readFile(join(outputDir, "reports.json"), "utf8");
  const payload = JSON.parse(serialized);
  assert.equal(result.reportCount, 1);
  assert.equal(result.intelligenceCount, 1);
  assert.equal(result.worldMemory, true);
  assert.equal(result.telegram, true);
  assert.equal(result.companyProfileCount, 1);
  assert.equal(result.companyPendingCount, 1);
  assert.equal(payload.intelligence[0].events.items[0].eventId, "event-1");
  assert.equal(payload.worldMemory.theses.length, 1);
  assert.equal(payload.telegram.clusters[0].eventId, "telegram-event-1");
  assert.equal(payload.companies[0].profiles[0].ticker, "NVDA");
  assert.equal(payload.companies[0].pendingCandidates[0].ticker, "TTD");
  assert.equal(payload.candidatePerformance.some((item) => item.ticker === "NVDA"), true);
  assert.doesNotMatch(serialized, /PDF 원문|never-publish-this|drop-oauth|drop thesis|private_token|private-report|never publish|drop this body|drop-session/);
});

test("reader builder keeps a candidate-only date as a C-grade performance observation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-screen-only-"));
  const candidateScreensDir = join(root, "workspace", "us_equity_candidate_screen", "2026-08-08");
  const outputDir = join(root, "output");
  await mkdir(candidateScreensDir, { recursive: true });
  await writeFile(join(candidateScreensDir, "candidate_screen.json"), JSON.stringify(privateCandidateScreen()), "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await buildPublicReportReader({
    inputDir: join(root, "workspace", "v2_reader_reports"),
    companiesDir: join(root, "workspace", "company_long_term_profiles"),
    candidateScreensDir: join(root, "workspace", "us_equity_candidate_screen"),
    outputDir,
    templateDir,
  });
  const payload = JSON.parse(await readFile(join(outputDir, "reports.json"), "utf8"));
  assert.equal(result.companyDateCount, 1);
  assert.equal(result.companyProfileCount, 0);
  assert.equal(result.companyPendingCount, 1);
  assert.equal(payload.companies[0].pendingCandidates[0].ticker, "TTD");
  assert.equal(payload.candidatePerformance[0].ticker, "TTD");
  assert.equal(payload.candidatePerformance[0].grade, "C");
  assert.equal(payload.candidatePerformance[0].firstPrice, 13.79);
});

test("reader builder merges prior sanitized dates and preserves World Memory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-history-"));
  const inputDir = join(root, "input", "2026-08-08");
  const intelligenceDir = join(root, "intelligence", "2026-08-08");
  const outputDir = join(root, "output");
  const previousBundle = join(root, "previous.json");
  await mkdir(inputDir, { recursive: true });
  await mkdir(intelligenceDir, { recursive: true });
  await writeFile(join(inputDir, "reader_report.json"), JSON.stringify(privateReaderReport()), "utf8");
  await writeFile(join(intelligenceDir, "daily_intelligence.json"), JSON.stringify(privateDailyIntelligence()), "utf8");
  await writeFile(previousBundle, JSON.stringify({
    schemaVersion: "public_pb_reader_bundle.v1",
    reports: [sanitizeReaderReport({ ...privateReaderReport(), report_date: "2026-08-07", title: "older" })],
    intelligence: [sanitizeDailyIntelligence({ ...privateDailyIntelligence(), report_date: "2026-08-07" })],
    companies: [sanitizeCompanyProfiles({ ...privateCompanyProfiles(), report_date: "2026-08-07" })],
    worldMemory: privateWorldMemory(),
    telegram: sanitizeTelegramRefresh(privateTelegramRefresh()),
  }), "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  await buildPublicReportReader({ inputDir: join(root, "input"), intelligenceDir: join(root, "intelligence"), outputDir, templateDir, previousBundle });
  const payload = JSON.parse(await readFile(join(outputDir, "reports.json"), "utf8"));
  assert.deepEqual(payload.reports.map((report) => report.reportDate), ["2026-08-08", "2026-08-07"]);
  assert.deepEqual(payload.intelligence.map((report) => report.reportDate), ["2026-08-08", "2026-08-07"]);
  assert.deepEqual(payload.companies.map((report) => report.reportDate), ["2026-08-07"]);
  assert.equal(payload.worldMemory.report.title, "현재 시장 상황 인식");
  assert.equal(payload.telegram.clusters[0].title, "반도체 공급망 점검");
});

test("static reader uses DOM APIs and exposes all five read-only views", async () => {
  const source = await readFile(join(templateDir, "app.js"), "utf8");
  const html = await readFile(join(templateDir, "index.html"), "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(source, /textContent/);
  assert.match(source, /rel = "noreferrer noopener"/);
  assert.match(html, /data-view="brief"/);
  assert.match(html, /data-view="intelligence"/);
  assert.match(html, /data-view="telegram"/);
  assert.match(html, /data-view="stock"/);
  assert.match(source, /view === "companies" \? "stock" : view/);
  assert.match(source, /candidatePerformance/);
  assert.match(html, /data-view="world-memory"/);
  assert.match(source, /검증 대기 후보/);
  assert.match(source, /공식 공시·IR 본문과 수치/);
});

test("static reader localizes the market scoreboard for Korean readers", async () => {
  const source = await readFile(join(templateDir, "app.js"), "utf8");
  assert.match(source, /breadth: "시장 폭"/);
  assert.match(source, /source_grade: "자료 등급"/);
  assert.match(source, /rule_based_signal: "규칙 기반 신호"/);
  assert.match(source, /classification_reason: "판정 이유"/);
  assert.match(source, /mixed: "혼조"/);
  assert.match(source, /FIELD_VALUES\[readable\]/);
  assert.match(source, /시장 폭·변동성·신용·금리·상대성과/);
  assert.doesNotMatch(source, /"Breadth·변동성·신용·금리·규칙 기반 신호"/);
});

test("static reader localizes nested intelligence metadata and preserves original titles", async () => {
  const source = await readFile(join(templateDir, "app.js"), "utf8");
  assert.match(source, /schema_version: "스키마 버전"/);
  assert.match(source, /collection_status: "수집 상태"/);
  assert.match(source, /market_cutoff: "시장 데이터 기준"/);
  assert.match(source, /priority_score: "종합 우선순위 점수"/);
  assert.match(source, /source_policy: "출처 정책"/);
  assert.match(source, /adjacent_close_context_not_causal: "인접 종가 참고값이며 인과관계 아님"/);
  assert.match(source, /event\.topicTags\.forEach\(\(tag\) => tags\.append\(element\("span", "", valueLabel\(tag\)\)\)\)/);
  assert.match(source, /entry\.kind && valueLabel\(entry\.kind\)/);
  assert.match(source, /koreanSummaryForTitle\(event\.title, event\.commonFacts \|\| \[\]\)/);
  assert.match(source, /heading\.append\(element\("strong", "", event\.title \|\| event\.eventId\)\)/);
});

test("static reader renders intelligence as a visual dashboard", async () => {
  const source = await readFile(join(templateDir, "app.js"), "utf8");
  const css = await readFile(join(templateDir, "styles.css"), "utf8");
  assert.match(source, /appendIntelligenceOverview\(article, intelligence\)/);
  assert.match(source, /appendScoreboard\(article, intelligence\.market\?\.scoreboard\)/);
  assert.match(source, /scoreboard-card-grid/);
  assert.match(source, /relative-track/);
  assert.doesNotMatch(source, /appendRecordSection\(article, "시장 스코어보드"/);
  assert.match(css, /\.overview-grid/);
  assert.match(css, /\.scoreboard-signal/);
  assert.match(css, /\.scoreboard-card-grid/);
  assert.match(css, /@media \(max-width: 430px\)/);
});

test("Cloudflare workflow gates data and consumes encrypted World Memory secret", async () => {
  const workflow = await readFile(fileURLToPath(new URL("../../.github/workflows/daily-brief.yml", import.meta.url)), "utf8");
  assert.match(workflow, /REPORTS_PROTECTED: \$\{\{ vars\.CLOUDFLARE_REPORTS_PROTECTED \}\}/);
  assert.match(workflow, /if \[ "\$REPORTS_PROTECTED" != "true" \]; then\s+args\+=\(--locked\)/);
  assert.match(workflow, /if: vars\.CLOUDFLARE_REPORTS_PROTECTED == 'true'\s+uses: actions\/download-artifact@v4/);
  assert.match(workflow, /PRIVATE_READER_WORLD_MEMORY_JSON: \$\{\{ secrets\.PRIVATE_READER_WORLD_MEMORY_JSON \}\}/);
  assert.match(workflow, /--intelligence pipeline\/pb-daily-market-brief\/workspace\/intelligence/);
  assert.match(workflow, /--companies pipeline\/pb-daily-market-brief\/workspace\/company_long_term_profiles/);
  assert.match(workflow, /--candidate-screens pipeline\/pb-daily-market-brief\/workspace\/us_equity_candidate_screen/);
  assert.match(workflow, /--telegram pipeline\/pb-daily-market-brief\/workspace\/telegram_refresh/);
  assert.match(workflow, /--world-memory \.generated\/private-reader-world-memory\.json/);
  assert.match(workflow, /Cloudflare Pages project exists/);
});

test("three-hour Telegram workflow rebuilds and deploys the protected reader safely", async () => {
  const workflow = await readFile(fileURLToPath(new URL("../../.github/workflows/telegram-refresh.yml", import.meta.url)), "utf8");
  assert.match(workflow, /cron: "17 \*\/3 \* \* \*"/);
  assert.match(workflow, /Validate previous private-reader bundle/);
  assert.match(workflow, /--telegram pipeline\/pb-daily-market-brief\/workspace\/telegram_refresh/);
  assert.match(workflow, /Restore latest verified stock reader inputs/);
  assert.match(workflow, /stock-reader-inputs-v1-/);
  assert.match(workflow, /--candidate-screens pipeline\/pb-daily-market-brief\/workspace\/us_equity_candidate_screen/);
  assert.match(workflow, /Validate stock gate and performance observation/);
  assert.match(workflow, /Deploy Telegram monitor to Cloudflare Pages/);
  assert.match(workflow, /vars\.CLOUDFLARE_REPORTS_PROTECTED == 'true'/);
  assert.match(workflow, /private-reader-history-/);
});
