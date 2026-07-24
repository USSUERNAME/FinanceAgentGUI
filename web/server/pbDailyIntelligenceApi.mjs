import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { sendJson } from "./codexProbe.mjs";

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const READER_SCHEMA = "v2_reader_report.v1";
const INTELLIGENCE_SCHEMA = "daily_market_intelligence.v2";
const MARKET_INTERNALS_SCHEMA = "us_market_internals.v1";
const SECTOR_METRICS_SCHEMA = "sector_metric_observations.v1";
const STOCK_CANDIDATES_SCHEMA = "us_equity_candidate_screen.v1";

function cleanText(value, maxLength = 1000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function cleanList(value, limit = 20) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, limit) : [];
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configuredRoot(env = process.env) {
  const raw = cleanText(env.PB_DAILY_INTELLIGENCE_DIR || "", 4000);
  if (!raw) return { configured: false, root: "" };
  return {
    configured: true,
    root: isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw),
  };
}

async function readJsonFile(filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("configured intelligence artifact is not a file");
  if (info.size > MAX_JSON_BYTES) throw new Error("configured intelligence artifact is too large");
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function dateFolders(root) {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

async function latestArtifact(root, folderName, fileName, expectedSchema, preferredDate = "") {
  const parent = join(root, folderName);
  const dates = await dateFolders(parent);
  const orderedDates =
    preferredDate && dates.includes(preferredDate)
      ? [preferredDate, ...dates.filter((date) => date !== preferredDate)]
      : dates;
  for (const date of orderedDates) {
    const filePath = join(parent, date, fileName);
    if (!existsSync(filePath)) continue;
    try {
      const payload = await readJsonFile(filePath);
      if (payload?.schema_version !== expectedSchema) continue;
      return { date, payload };
    } catch {
      // A broken older artifact must not hide a newer valid report.
    }
  }
  return null;
}

function normalizeFinding(item = {}) {
  const title = cleanText(item.title, 160);
  const body = cleanText(item.body, 1200);
  return title || body ? { title, body } : null;
}

function normalizeEvent(item = {}) {
  return {
    eventId: cleanText(item.event_id, 120),
    title: cleanText(item.title || item.summary || item.claim, 240),
    summary: cleanText(item.summary || item.interpretation || item.body, 1200),
    eventType: cleanText(item.event_type, 80),
    facts: cleanList(item.facts || item.confirmed_facts, 8).map((fact) =>
      cleanText(fact?.claim || fact?.fact || fact, 500)
    ).filter(Boolean),
    sources: cleanList(item.sources, 8)
      .map((source) => ({
        title: cleanText(source?.title || source?.source_id, 160),
        url: /^https?:\/\//i.test(String(source?.url || "")) ? String(source.url) : "",
      }))
      .filter((source) => source.title || source.url),
  };
}

function normalizeReviewItem(item = {}) {
  const verification = item.verification || {};
  const ranking = item.ranking || {};
  const sourceSummary = item.source_summary || {};
  return {
    eventId: cleanText(item.event_id, 120),
    title: cleanText(item.title, 240),
    eventType: cleanText(item.event_type, 80) || "other",
    priorityScore: Number(ranking.priority_score || 0),
    evidenceReadinessScore: Number(ranking.evidence_readiness_score || 0),
    verificationStatus: cleanText(
      verification.primary_fact_confirmed
        ? "primary_fact_confirmed"
        : verification.extraction_status || verification.cluster_status || "unverified",
      80
    ),
    extractionStatus: cleanText(verification.extraction_status || "not_available", 80),
    sourceUrls: cleanList(sourceSummary.source_urls, 4)
      .map((url) => String(url || ""))
      .filter((url) => /^https?:\/\//i.test(url)),
  };
}

function normalizeReaderReport(reader = {}) {
  const findings = cleanList(reader.market_findings, 12)
    .map(normalizeFinding)
    .filter(Boolean);
  const events = cleanList(reader.verified_events, 8)
    .map(normalizeEvent)
    .filter((event) => event.title || event.summary || event.facts.length);
  return {
    reportDate: cleanText(reader.report_date, 20),
    generatedAt: cleanText(reader.generated_at, 80),
    title: cleanText(reader.title, 240) || "Daily Market Intelligence",
    executiveSummary: cleanList(reader.executive_summary, 5)
      .map((item) => cleanText(item, 1200))
      .filter(Boolean),
    findings,
    todayChanges: cleanList(reader.today_changes, 12)
      .map(normalizeFinding)
      .filter(Boolean),
    verifiedEvents: events,
    koreaConnection: {
      status: cleanText(reader.korea_connection?.status, 40) || "unknown",
      summary: cleanText(reader.korea_connection?.summary, 1200),
      metrics: cleanList(reader.korea_connection?.metrics, 12),
    },
    nextChecks: cleanList(reader.next_checks, 12)
      .map((item) => cleanText(item, 500))
      .filter(Boolean),
    dataStatus: {
      latestPriceAsOf: cleanText(reader.data_status?.latest_price_as_of, 40),
      verifiedEventCount: Number(reader.data_status?.verified_event_count || events.length || 0),
      koreaDataStatus: cleanText(reader.data_status?.korea_data_status, 40) || "unknown",
      warnings: cleanList(reader.data_status?.warnings, 12)
        .map((item) => cleanText(item, 500))
        .filter(Boolean),
    },
    sources: cleanList(reader.sources, 30)
      .map((source) => ({
        id: cleanText(source?.source_id, 120),
        title: cleanText(source?.title || source?.source_id, 200),
        url: /^https?:\/\//i.test(String(source?.url || "")) ? String(source.url) : "",
        asOf: cleanText(source?.as_of, 40),
      }))
      .filter((source) => source.title),
  };
}

function normalizePipeline(intelligence = {}) {
  const eventState = intelligence.events || {};
  const items = Array.isArray(eventState.items) ? eventState.items.filter(Boolean) : [];
  return {
    clusterCount: Number(eventState.cluster_count || items.length || 0),
    selectedCount: Number(eventState.selected_count || 0),
    verifiedPrimaryFactCount: Number(eventState.verified_primary_fact_count || 0),
    synthesisStatus: cleanText(eventState.synthesis_status, 80) || "not_available",
    fallbackReason: cleanText(eventState.fallback_reason, 160),
    reviewQueue: items
      .filter((item) => item?.verification?.publication_eligible_as_fact !== true)
      .map(normalizeReviewItem)
      .sort((a, b) => b.priorityScore - a.priorityScore),
  };
}

function metricCard(id, label, value, change, unit, asOf, tone = "neutral") {
  return {
    id,
    label,
    value: finiteNumber(value),
    change: finiteNumber(change),
    unit,
    asOf: cleanText(asOf, 40),
    tone,
  };
}

function normalizeScoreboard(intelligence = {}) {
  const scoreboard = intelligence.market?.scoreboard || {};
  const breadth = scoreboard.breadth || {};
  const volatility = scoreboard.volatility || {};
  const credit = scoreboard.credit || {};
  const rates = scoreboard.rates || {};
  const participation = scoreboard.rule_based_signal?.participation || {};
  return {
    regime: {
      label: cleanText(intelligence.market?.regime?.label, 80) || "unknown",
      confidence: finiteNumber(intelligence.market?.regime?.confidence),
      summary: cleanText(intelligence.market?.regime?.summary, 1200),
    },
    cards: [
      metricCard(
        "breadth",
        "RSP/SPY",
        breadth.rsp_vs_spy_5d_pct,
        breadth.rsp_vs_spy_1d_pct,
        "%p",
        breadth.as_of,
        finiteNumber(breadth.rsp_vs_spy_5d_pct) >= 0 ? "positive" : "negative"
      ),
      metricCard(
        "vix",
        "VIX",
        volatility.vix?.value,
        volatility.vix?.change_1d,
        "",
        volatility.vix?.as_of,
        finiteNumber(volatility.vix?.value) < 20 ? "positive" : "warning"
      ),
      metricCard(
        "vix-term",
        "VIX/3개월",
        volatility.vix_term_ratio,
        null,
        "x",
        volatility.as_of,
        finiteNumber(volatility.vix_term_ratio) < 1 ? "positive" : "warning"
      ),
      metricCard(
        "credit",
        "하이일드 OAS",
        credit.high_yield_oas?.value,
        credit.high_yield_oas?.change_5_sessions,
        "%",
        credit.high_yield_oas?.as_of,
        finiteNumber(credit.high_yield_oas?.change_5_sessions) <= 0 ? "positive" : "warning"
      ),
      metricCard(
        "nominal-10y",
        "미국 10년물",
        rates.nominal_10y?.value,
        rates.nominal_10y?.change_5_sessions,
        "%",
        rates.nominal_10y?.as_of,
        "warning"
      ),
      metricCard(
        "real-10y",
        "10년 실질금리",
        rates.real_10y?.value,
        rates.real_10y?.change_5_sessions,
        "%",
        rates.real_10y?.as_of,
        "warning"
      ),
    ].filter((card) => card.value !== null),
    relativePerformance: [
      { label: "RSP/SPY", value: finiteNumber(breadth.rsp_vs_spy_5d_pct) },
      { label: "QQQ/SPY", value: finiteNumber(participation.qqq_vs_spy_5d_pct) },
      { label: "IWM/SPY", value: finiteNumber(participation.iwm_vs_spy_5d_pct) },
      { label: "GLD/SPY", value: finiteNumber(participation.gld_vs_spy_5d_pct) },
    ].filter((item) => item.value !== null),
  };
}

function normalizeMarketInternals(payload = {}) {
  const leadership = payload.sector_leadership || {};
  const normalizePeriod = (period) =>
    cleanList(leadership[period]?.all_sectors, 30).map((item) => ({
      ticker: cleanText(item.ticker, 20),
      sector: cleanText(item.sector, 80),
      returnPct: finiteNumber(item.return_pct),
      vsSpyPctPoint: finiteNumber(item.vs_spy_pct_point),
    }));
  return {
    status: cleanText(payload.collection_status, 80),
    classification: cleanText(payload.market_structure?.classification, 80),
    classificationReason: cleanText(payload.market_structure?.reason, 500),
    coverage: {
      available: Number(payload.coverage?.available_ticker_count || 0),
      required: Number(payload.coverage?.required_ticker_count || 0),
      missingTickers: cleanList(payload.coverage?.missing_tickers, 100).map(String),
    },
    sectors: {
      "1d": normalizePeriod("1d"),
      "5d": normalizePeriod("5d"),
      "20d": normalizePeriod("20d"),
    },
    stylePairs: cleanList(payload.style_pairs, 20).map((item) => ({
      id: cleanText(item.pair_id, 80),
      firstTicker: cleanText(item.first_ticker, 20),
      secondTicker: cleanText(item.second_ticker, 20),
      leader5d: cleanText(item.five_day_leader, 20),
      relative5d: finiteNumber(item.relative_returns_pct_point?.["5d"]),
    })),
    gaps: cleanList(payload.data_gaps, 30).map((item) => cleanText(item, 600)).filter(Boolean),
  };
}

function normalizeSectorMetrics(payload = {}) {
  return {
    status: cleanText(payload.collection_status, 80),
    availableCount: Number(payload.available_metric_count || 0),
    metrics: cleanList(payload.metrics, 100).map((item) => ({
      id: cleanText(item.metric_id, 120),
      sectorId: cleanText(item.sector_id, 120),
      label: cleanText(item.label_ko, 200),
      status: cleanText(item.status, 80),
      score: finiteNumber(item.score),
      confidence: cleanText(item.confidence, 40),
      latestValue: finiteNumber(item.latest_value),
      change1: finiteNumber(item.change_1_period_pct),
      change3: finiteNumber(item.change_3_period_pct),
      change12: finiteNumber(item.change_12_period_pct),
      observationDate: cleanText(item.observation_date, 40),
      ageDays: finiteNumber(item.age_days),
      sourceUrl: /^https?:\/\//i.test(String(item.source_url || "")) ? String(item.source_url) : "",
      limitation: cleanText(item.limitation_ko, 600),
    })),
  };
}

function normalizeStockCandidates(payload = {}) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates.filter(Boolean) : [];
  return {
    status: cleanText(payload.screen_status, 80),
    universeCount: Number(payload.universe_security_count || 0),
    marketCoveredCount: Number(payload.market_covered_security_count || 0),
    candidates: candidates.map((item) => {
      const reaction = item.market_reaction || {};
      const evidence = cleanList(item.event_evidence, 20);
      return {
        ticker: cleanText(item.ticker, 20),
        companyName: cleanText(item.company_name, 160),
        score: Number(item.selection_score || 0),
        sectorIds: cleanList(item.sector_ids, 20).map(String),
        reasons: cleanList(item.selection_reasons, 20).map(String),
        deepAnalysisEligible: item.deep_analysis_eligible === true,
        evidenceStatus: cleanText(item.evidence_status, 80),
        reaction: {
          close: finiteNumber(reaction.close),
          return1d: finiteNumber(reaction.return_1d_pct),
          return5d: finiteNumber(reaction.return_5d_pct),
          return20d: finiteNumber(reaction.return_20d_pct),
          volumeRatio20d: finiteNumber(reaction.volume_ratio_20d),
          spyRelative1d: finiteNumber(reaction.spy_relative_1d_pct),
          sectorRelative1d: finiteNumber(reaction.sector_relative_1d_pct),
        },
        evidence: evidence.map((row) => ({
          title: cleanText(row.title, 240),
          eventType: cleanText(row.event_type, 80),
          sourceGrade: cleanText(row.source_grade, 20),
          sourceUrl: /^https?:\/\//i.test(String(row.source_url || "")) ? String(row.source_url) : "",
          primaryConfirmed: row.primary_source_confirmed === true,
          factCount: Array.isArray(row.verified_facts) ? row.verified_facts.length : 0,
        })),
      };
    }),
    gaps: cleanList(payload.data_gaps, 30).map((item) => cleanText(item, 600)).filter(Boolean),
  };
}

export async function loadPbDailyIntelligenceSnapshot({ env = process.env } = {}) {
  const config = configuredRoot(env);
  if (!config.configured) {
    return {
      connection: { configured: false, available: false, reason: "not_configured" },
      report: null,
      pipeline: null,
    };
  }
  if (!existsSync(config.root)) {
    return {
      connection: { configured: true, available: false, reason: "directory_not_found" },
      report: null,
      pipeline: null,
    };
  }

  const readerArtifact = await latestArtifact(
    config.root,
    "v2_reader_reports",
    "reader_report.json",
    READER_SCHEMA
  );
  if (!readerArtifact) {
    return {
      connection: { configured: true, available: false, reason: "reader_report_not_found" },
      report: null,
      pipeline: null,
    };
  }

  const intelligenceArtifact = await latestArtifact(
    config.root,
    "intelligence",
    "daily_intelligence.json",
    INTELLIGENCE_SCHEMA,
    readerArtifact.date
  );
  const marketInternalsArtifact = await latestArtifact(
    config.root,
    "us_market_internals",
    "market_internals.json",
    MARKET_INTERNALS_SCHEMA,
    readerArtifact.date
  );
  const sectorMetricsArtifact = await latestArtifact(
    config.root,
    "sector_metrics",
    "sector_metrics.json",
    SECTOR_METRICS_SCHEMA,
    readerArtifact.date
  );
  const stockCandidatesArtifact = await latestArtifact(
    config.root,
    "us_equity_candidate_screen",
    "candidate_screen.json",
    STOCK_CANDIDATES_SCHEMA,
    readerArtifact.date
  );
  return {
    connection: {
      configured: true,
      available: true,
      reason: "",
      readerDate: readerArtifact.date,
      pipelineDate: intelligenceArtifact?.date || "",
      sameReportDate: Boolean(
        intelligenceArtifact && intelligenceArtifact.date === readerArtifact.date
      ),
    },
    report: normalizeReaderReport(readerArtifact.payload),
    pipeline: intelligenceArtifact ? normalizePipeline(intelligenceArtifact.payload) : null,
    scoreboard: intelligenceArtifact ? normalizeScoreboard(intelligenceArtifact.payload) : null,
    marketInternals: marketInternalsArtifact
      ? normalizeMarketInternals(marketInternalsArtifact.payload)
      : null,
    sectorMetrics: sectorMetricsArtifact ? normalizeSectorMetrics(sectorMetricsArtifact.payload) : null,
    stockCandidates: stockCandidatesArtifact
      ? normalizeStockCandidates(stockCandidatesArtifact.payload)
      : null,
  };
}

export async function handlePbDailyIntelligenceEndpoint(req, res) {
  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  try {
    sendJson(res, {
      ok: true,
      ...(await loadPbDailyIntelligenceSnapshot()),
    });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
