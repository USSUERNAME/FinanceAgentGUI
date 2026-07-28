import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { sendJson } from "./codexProbe.mjs";
import {
  classifyResearchSector,
  researchSectorTaxonomyVersion,
  suggestResearchSectors,
} from "./researchSectorTaxonomy.mjs";

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const READER_SCHEMA = "v2_reader_report.v1";
const INTELLIGENCE_SCHEMA = "daily_market_intelligence.v2";
const MARKET_INTERNALS_SCHEMA = "us_market_internals.v1";
const SECTOR_METRICS_SCHEMA = "sector_metric_observations.v1";
const STOCK_CANDIDATES_SCHEMA = "us_equity_candidate_screen.v1";
const TELEGRAM_REGISTRY_SCHEMA = "telegram_channel_registry.v1";
const TELEGRAM_REFRESH_SCHEMA = "telegram_intelligence_refresh.v1";
const BROKER_RESEARCH_SCHEMA = "broker_research_digest.v1";

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

function configuredEngineRoot(env = process.env, workspaceRoot = "") {
  const raw = cleanText(env.PB_DAILY_INTELLIGENCE_ENGINE_DIR || "", 4000);
  if (raw) {
    return isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
  }
  return workspaceRoot ? dirname(workspaceRoot) : "";
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

async function latestJsonInDateFolder(root, folderName, preferredDate, filePattern) {
  const parent = join(root, folderName);
  const dates = await dateFolders(parent);
  const orderedDates =
    preferredDate && dates.includes(preferredDate)
      ? [preferredDate, ...dates.filter((date) => date !== preferredDate)]
      : dates;
  for (const date of orderedDates) {
    const dateRoot = join(parent, date);
    const entries = await readdir(dateRoot, { withFileTypes: true }).catch(() => []);
    const names = entries
      .filter((entry) => entry.isFile() && filePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const name of names) {
      try {
        return { date, payload: await readJsonFile(join(dateRoot, name)) };
      } catch {
        // Continue to an older valid artifact when a runtime write is incomplete.
      }
    }
  }
  return null;
}

async function artifactForDate(root, folderName, fileName, expectedSchema, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
  const filePath = join(root, folderName, date, fileName);
  if (!existsSync(filePath)) return null;
  try {
    const payload = await readJsonFile(filePath);
    return payload?.schema_version === expectedSchema ? { date, payload } : null;
  } catch {
    return null;
  }
}

function parseDotEnvPresence(text = "") {
  const values = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^['"]|['"]$/g, "").trim();
    values.set(match[1], Boolean(value));
  }
  return values;
}

async function telegramCredentialReadiness(engineRoot, env = process.env) {
  let dotenv = new Map();
  const envPath = engineRoot ? join(engineRoot, ".env") : "";
  if (envPath && existsSync(envPath)) {
    try {
      const info = await stat(envPath);
      if (info.isFile() && info.size <= 1024 * 1024) {
        dotenv = parseDotEnvPresence(await readFile(envPath, "utf8"));
      }
    } catch {
      // Credential readiness remains process-environment-only when .env is unreadable.
    }
  }
  const ready = (name) => Boolean(String(env[name] || "").trim()) || dotenv.get(name) === true;
  const apiId = ready("TELEGRAM_API_ID");
  const apiHash = ready("TELEGRAM_API_HASH");
  let localSession = false;
  const localSessionPath = engineRoot
    ? join(engineRoot, "workspace", "local_secrets", "telegram_session_string.txt")
    : "";
  if (localSessionPath && existsSync(localSessionPath)) {
    try {
      const info = await stat(localSessionPath);
      localSession = info.isFile() && info.size > 0 && info.size <= 16_384;
    } catch {
      localSession = false;
    }
  }
  const session = ready("TELEGRAM_SESSION_STRING") || localSession;
  return {
    apiId,
    apiHash,
    session,
    sessionSource: ready("TELEGRAM_SESSION_STRING")
      ? "environment"
      : localSession
        ? "local_secret_file"
        : "missing",
    ready: apiId && apiHash && session,
    missing: [
      !apiId ? "TELEGRAM_API_ID" : "",
      !apiHash ? "TELEGRAM_API_HASH" : "",
      !session ? "TELEGRAM_SESSION_STRING" : "",
    ].filter(Boolean),
  };
}

async function loadTelegramOverview({ root, reportDate, engineRoot, env }) {
  const registryPath = engineRoot ? join(engineRoot, "telegram_channels.json") : "";
  let registry = null;
  if (registryPath && existsSync(registryPath)) {
    try {
      const payload = await readJsonFile(registryPath);
      if (payload?.schema_version === TELEGRAM_REGISTRY_SCHEMA && Array.isArray(payload.channels)) {
        registry = payload;
      }
    } catch {
      registry = null;
    }
  }

  const sourceStatusArtifact = await latestJsonInDateFolder(
    root,
    "source_status",
    reportDate,
    /^source_status_.*\.json$/i
  );
  const telegramSource = cleanList(sourceStatusArtifact?.payload?.sources, 100)
    .find((source) => source?.source_id === "telegram_channels");
  const liveRefreshArtifact = await latestArtifact(
    root,
    "telegram_refresh",
    "telegram_intelligence.json",
    TELEGRAM_REFRESH_SCHEMA,
    reportDate
  );

  const triagedPath = join(root, "triaged", reportDate, "triaged_inbox.json");
  let telegramRecords = [];
  if (existsSync(triagedPath)) {
    try {
      const records = await readJsonFile(triagedPath);
      telegramRecords = Array.isArray(records)
        ? records.filter((record) =>
          String(record?.source_id || "").startsWith("telegram_") ||
          record?.source_type === "telegram_commentary"
        )
        : [];
    } catch {
      telegramRecords = [];
    }
  }
  const clusteredRecords = telegramRecords.filter((record) => record?.event_cluster?.event_id);
  const clusterIds = new Set(clusteredRecords.map((record) => record.event_cluster.event_id));
  const channelsRepresented = new Set(
    telegramRecords
      .map((record) => record?.telegram?.channel_username || record?.publisher)
      .filter(Boolean)
  );
  const clusterMap = new Map();
  for (const record of clusteredRecords) {
    const eventId = cleanText(record.event_cluster.event_id, 120);
    if (!eventId) continue;
    const current = clusterMap.get(eventId) || {
      eventId,
      title: "",
      eventType: cleanText(record.event_cluster.event_type || record?.triage?.event_type, 80),
      verificationStatus: cleanText(record.event_cluster.verification_status, 80),
      latestPublishedAt: "",
      postCount: 0,
      channels: new Set(),
      postUrls: [],
    };
    current.postCount += 1;
    if (!current.title) current.title = cleanText(record.title, 240);
    const publishedAt = cleanText(record.published_at, 80);
    if (publishedAt > current.latestPublishedAt) {
      current.latestPublishedAt = publishedAt;
      current.title = cleanText(record.title, 240) || current.title;
    }
    const channel = cleanText(
      record?.telegram?.channel_name || record?.telegram?.channel_username || record?.publisher,
      160
    );
    if (channel) current.channels.add(channel);
    const postUrl = String(record.url || "");
    if (/^https:\/\/t\.me\//i.test(postUrl) && !current.postUrls.includes(postUrl)) {
      current.postUrls.push(postUrl);
    }
    clusterMap.set(eventId, current);
  }
  let clusters = [...clusterMap.values()]
    .sort((left, right) =>
      right.postCount - left.postCount ||
      right.latestPublishedAt.localeCompare(left.latestPublishedAt)
    )
    .slice(0, 20)
    .map((cluster) => ({
      eventId: cluster.eventId,
      title: cluster.title,
      eventType: cluster.eventType,
      verificationStatus: cluster.verificationStatus,
      latestPublishedAt: cluster.latestPublishedAt,
      postCount: cluster.postCount,
      channels: [...cluster.channels].slice(0, 8),
      postUrls: cluster.postUrls.slice(0, 4),
    }));
  if (liveRefreshArtifact?.payload) {
    clusters = cleanList(liveRefreshArtifact.payload.clusters, 20).map((cluster) => ({
      eventId: cleanText(cluster?.event_id, 120),
      title: cleanText(cluster?.title, 240),
      eventType: cleanText(cluster?.event_type, 80),
      verificationStatus: cleanText(cluster?.verification_status, 80),
      latestPublishedAt: cleanText(cluster?.latest_published_at, 80),
      postCount: Number(cluster?.post_count || 0),
      channels: cleanList(cluster?.channels, 8).map((item) => cleanText(item, 160)),
      postUrls: cleanList(cluster?.post_urls, 4)
        .map((item) => String(item || ""))
        .filter((item) => /^https:\/\/t\.me\//i.test(item)),
    }));
  }

  const channels = cleanList(registry?.channels, 100).map((channel) => ({
    username: cleanText(channel?.username, 80),
    name: cleanText(channel?.name || channel?.username, 160),
    category: cleanText(channel?.category, 100),
    origin: cleanText(channel?.origin, 40),
    priority: Number(channel?.priority || 3),
    enabled: channel?.enabled !== false,
    publicationPolicy: cleanText(channel?.publication_policy, 80),
  }));
  const credentials = await telegramCredentialReadiness(engineRoot, env);
  return {
    configured: Boolean(registry),
    registryValid: Boolean(registry),
    enabledCount: channels.filter((channel) => channel.enabled).length,
    channelCount: channels.length,
    channels,
    credentials,
    collection: {
      reportDate: liveRefreshArtifact?.date || sourceStatusArtifact?.date || reportDate,
      status:
        cleanText(liveRefreshArtifact?.payload?.status, 80)
        || cleanText(telegramSource?.status, 80)
        || "not_run",
      itemCount: Number(
        liveRefreshArtifact?.payload?.raw_post_count
        ?? telegramSource?.item_count
        ?? 0
      ),
      noticeCategory:
        cleanText(liveRefreshArtifact?.payload?.notice_category, 120)
        || cleanText(telegramSource?.notice_category, 120),
      lastCollectedAt:
        cleanText(liveRefreshArtifact?.payload?.generated_at, 80)
        || cleanText(telegramSource?.checked_at, 80)
        || cleanText(sourceStatusArtifact?.payload?.generated_at, 80),
    },
    deduplication: {
      rawPostCount: Number(
        liveRefreshArtifact?.payload?.raw_post_count
        ?? telegramRecords.length
      ),
      clusteredPostCount: Number(
        liveRefreshArtifact?.payload?.deduplicated_post_count
        ?? clusteredRecords.length
      ),
      eventClusterCount: Number(
        liveRefreshArtifact?.payload?.event_cluster_count
        ?? clusterIds.size
      ),
      consolidatedPostCount: Number(
        liveRefreshArtifact?.payload?.duplicate_post_count
        ?? Math.max(0, clusteredRecords.length - clusterIds.size)
      ),
      representedChannelCount: Number(
        liveRefreshArtifact?.payload?.represented_channel_count
        ?? channelsRepresented.size
      ),
    },
    clusters,
  };
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
  const constituent = payload.constituent_breadth || {};
  const constituentMetrics = constituent.breadth || {};
  const constituentSectors = constituent.sector_breadth || {};
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
    constituentBreadth: constituent.schema_version ? {
      status: cleanText(constituent.collection_status, 80),
      asOf: cleanText(constituent.as_of, 40),
      membershipScope: cleanText(constituent.universe?.membership_scope, 80),
      coveragePct: finiteNumber(constituent.coverage?.daily_price_pct),
      advancePct: finiteNumber(constituentMetrics.advance_decline?.advance_pct),
      declinePct: finiteNumber(constituentMetrics.advance_decline?.decline_pct),
      netAdvances: finiteNumber(constituentMetrics.advance_decline?.net_advances),
      upVolumePct: finiteNumber(constituentMetrics.volume?.up_volume_pct),
      above20dPct: finiteNumber(constituentMetrics.moving_averages?.["20d"]?.above_pct),
      above50dPct: finiteNumber(constituentMetrics.moving_averages?.["50d"]?.above_pct),
      above200dPct: finiteNumber(constituentMetrics.moving_averages?.["200d"]?.above_pct),
      newHighs: finiteNumber(constituentMetrics.highs_lows_52w?.new_highs),
      newLows: finiteNumber(constituentMetrics.highs_lows_52w?.new_lows),
    } : null,
    sectorBreadth: {
      status: cleanText(constituentSectors.collection_status, 80),
      availableCount: Number(
        constituentSectors.coverage?.available_sector_count || 0
      ),
      readyCount: Number(
        constituentSectors.coverage?.ready_sector_count || 0
      ),
      requiredCount: Number(
        constituentSectors.coverage?.required_sector_count || 0
      ),
      sectors: cleanList(constituentSectors.sectors, 20).map((item) => ({
        ticker: cleanText(item.sector_ticker, 20),
        sector: cleanText(item.sector_name, 80),
        status: cleanText(item.collection_status, 80),
        membershipAsOf: cleanText(item.membership_as_of, 40),
        coveragePct: finiteNumber(item.coverage?.daily_price_pct),
        advancePct: finiteNumber(item.breadth?.advance_decline?.advance_pct),
        upVolumePct: finiteNumber(item.breadth?.volume?.up_volume_pct),
        above50dPct: finiteNumber(
          item.breadth?.moving_averages?.["50d"]?.above_pct
        ),
        above200dPct: finiteNumber(
          item.breadth?.moving_averages?.["200d"]?.above_pct
        ),
        newHighs: finiteNumber(item.breadth?.highs_lows_52w?.new_highs),
        newLows: finiteNumber(item.breadth?.highs_lows_52w?.new_lows),
      })),
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
      relative1d: finiteNumber(item.relative_returns_pct_point?.["1d"]),
      relative5d: finiteNumber(item.relative_returns_pct_point?.["5d"]),
      relative20d: finiteNumber(item.relative_returns_pct_point?.["20d"]),
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

function brokerResearchCoverage(reports = []) {
  const buckets = new Map();
  const uniqueTexts = (rows, field, limit = 12) => {
    const seen = new Set();
    const values = [];
    for (const report of rows) {
      for (const value of report[field] || []) {
        const text = cleanText(value, 500);
        const key = text.toLocaleLowerCase("en-US");
        if (!text || seen.has(key)) continue;
        seen.add(key);
        values.push(text);
        if (values.length >= limit) return values;
      }
    }
    return values;
  };
  const crossPublisherTexts = (rows, field, limit = 8) => {
    const entries = new Map();
    for (const report of rows) {
      for (const value of report[field] || []) {
        const text = cleanText(value, 500);
        const key = text.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
        if (!key) continue;
        const entry = entries.get(key) || {
          text,
          publishers: new Set(),
          reportCount: 0,
        };
        if (report.publisher) entry.publishers.add(report.publisher);
        entry.reportCount += 1;
        entries.set(key, entry);
      }
    }
    return [...entries.values()]
      .filter((entry) => entry.publishers.size >= 2)
      .sort(
        (left, right) =>
          right.publishers.size - left.publishers.size
          || right.reportCount - left.reportCount
          || left.text.localeCompare(right.text),
      )
      .slice(0, limit)
      .map((entry) => ({
        text: entry.text,
        publisherCount: entry.publishers.size,
        reportCount: entry.reportCount,
        publishers: [...entry.publishers].sort((left, right) => left.localeCompare(right)),
      }));
  };
  const displaySector = (sector, reportType) => {
    const value = cleanText(sector, 120);
    if (/^(데일리|전체리서치|종합|market|strategy)$/i.test(value)) return "시장전략·종합";
    if (value) return value;
    if (/macro|strategy|market/i.test(reportType)) return "거시·시장전략";
    if (/company|earnings|stock/i.test(reportType)) return "개별기업";
    return "미분류";
  };
  const explicitStance = (report) => {
    const supported = ["positive", "neutral", "cautious", "negative"];
    const normalizedRating = report.rating?.normalized || "";
    if (supported.includes(normalizedRating)) return normalizedRating;
    return supported.includes(report.stance) ? report.stance : "";
  };

  for (const report of reports) {
    const sectors = report.standardSectors?.length
      ? report.standardSectors
      : [{
        id: "",
        name: displaySector("", report.reportType),
        nameEn: "",
        sourceLabels: [],
      }];
    for (const sector of sectors) {
      const sectorName = displaySector(sector.name, report.reportType);
      const bucketKey = sector.id || sectorName;
      const bucket = buckets.get(bucketKey) || {
        sectorId: sector.id || "",
        sector: sectorName,
        sectorNameEn: sector.nameEn || "",
        sourceLabels: new Set(),
        reports: [],
        publishers: new Set(),
        tickers: new Map(),
        marketScopes: new Map(),
        stanceCounts: { positive: 0, neutral: 0, cautious: 0, negative: 0 },
      };
      for (const sourceLabel of sector.sourceLabels || []) {
        if (sourceLabel) bucket.sourceLabels.add(sourceLabel);
      }
      bucket.reports.push(report);
      if (report.publisher) bucket.publishers.add(report.publisher);
      for (const ticker of report.tickers || []) {
        bucket.tickers.set(ticker, Number(bucket.tickers.get(ticker) || 0) + 1);
      }
      const scope = report.marketScope || "UNKNOWN";
      bucket.marketScopes.set(scope, Number(bucket.marketScopes.get(scope) || 0) + 1);
      const stance = explicitStance(report);
      if (stance) bucket.stanceCounts[stance] += 1;
      buckets.set(bucketKey, bucket);
    }
  }

  return [...buckets.values()]
    .map((bucket) => {
      const reportCount = bucket.reports.length;
      const publisherCount = bucket.publishers.size;
      const publisherStanceSets = new Map();
      for (const report of bucket.reports) {
        const stance = explicitStance(report);
        if (!stance || !report.publisher) continue;
        const stances = publisherStanceSets.get(report.publisher) || new Set();
        stances.add(stance);
        publisherStanceSets.set(report.publisher, stances);
      }
      const publisherStances = {
        positive: [],
        neutral: [],
        cautious: [],
        negative: [],
        mixed: [],
      };
      for (const [publisher, stances] of publisherStanceSets.entries()) {
        if (stances.size === 1) {
          publisherStances[[...stances][0]].push(publisher);
        } else {
          publisherStances.mixed.push(publisher);
        }
      }
      for (const publishers of Object.values(publisherStances)) {
        publishers.sort((left, right) => left.localeCompare(right));
      }
      const ratedPublisherCount = ["positive", "neutral", "cautious", "negative"]
        .reduce((sum, stance) => sum + publisherStances[stance].length, 0);
      const rankedPublisherStances = ["positive", "neutral", "cautious", "negative"]
        .map((stance) => ({ stance, count: publisherStances[stance].length }))
        .sort((left, right) => right.count - left.count || left.stance.localeCompare(right.stance));
      const dominantPublisherStance = rankedPublisherStances[0];
      const dominantShare = ratedPublisherCount
        ? dominantPublisherStance.count / ratedPublisherCount
        : 0;
      const publisherOpinionStatus = ratedPublisherCount === 0
        ? "no_sample"
        : ratedPublisherCount === 1
          ? "single_source"
          : dominantPublisherStance.count >= 2 && dominantShare >= 0.67
            ? "aligned"
            : "divided";
      const structuredCount = bucket.reports.filter(
        (report) => report.structuredAnalysisAvailable,
      ).length;
      const ratedCount = Object.values(bucket.stanceCounts).reduce(
        (sum, count) => sum + count,
        0,
      );
      const domesticCount = Number(bucket.marketScopes.get("KR") || 0);
      const overseasCount = [...bucket.marketScopes.entries()]
        .filter(([scope]) => !["KR", "UNKNOWN"].includes(scope))
        .reduce((sum, [, count]) => sum + count, 0);
      const depth = publisherCount >= 3 && reportCount >= 4
        ? "multi_source"
        : publisherCount >= 2
          ? "cross_checked"
          : "single_source";
      return {
        sectorId: bucket.sectorId,
        sector: bucket.sector,
        sectorNameEn: bucket.sectorNameEn,
        sourceLabels: [...bucket.sourceLabels].sort((left, right) => left.localeCompare(right)),
        mappingSuggestion: bucket.sectorId
          ? null
          : suggestResearchSectors([...bucket.sourceLabels][0] || bucket.sector),
        reportCount,
        publisherCount,
        structuredCount,
        ratedCount,
        domesticCount,
        overseasCount,
        unclassifiedCount: Number(bucket.marketScopes.get("UNKNOWN") || 0),
        depth,
        topTickers: [...bucket.tickers.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .slice(0, 4)
          .map(([ticker, count]) => ({ ticker, reportCount: count })),
        stanceCounts: bucket.stanceCounts,
        publisherOpinion: {
          status: publisherOpinionStatus,
          ratedPublisherCount,
          mixedPublisherCount: publisherStances.mixed.length,
          dominantStance: publisherOpinionStatus === "aligned"
            ? dominantPublisherStance.stance
            : "",
          dominantSharePct: publisherOpinionStatus === "aligned"
            ? Math.round(dominantShare * 100)
            : null,
          stances: publisherStances,
        },
        claims: uniqueTexts(bucket.reports, "keyClaims"),
        catalysts: uniqueTexts(bucket.reports, "catalysts"),
        risks: uniqueTexts(bucket.reports, "risks"),
        monitoringConditions: uniqueTexts(bucket.reports, "monitoringConditions"),
        crossPublisherThemes: [
          ...crossPublisherTexts(bucket.reports, "keyClaims").map((item) => ({
            ...item,
            type: "claim",
          })),
          ...crossPublisherTexts(bucket.reports, "catalysts").map((item) => ({
            ...item,
            type: "catalyst",
          })),
          ...crossPublisherTexts(bucket.reports, "risks").map((item) => ({
            ...item,
            type: "risk",
          })),
        ].sort(
          (left, right) =>
            right.publisherCount - left.publisherCount
            || right.reportCount - left.reportCount
            || left.text.localeCompare(right.text),
        ).slice(0, 8),
      };
    })
    .sort(
      (left, right) =>
        right.reportCount - left.reportCount
        || right.publisherCount - left.publisherCount
        || left.sector.localeCompare(right.sector),
    )
    .slice(0, 16);
}

function normalizeBrokerResearch(payload = {}) {
  const summary = payload.summary || {};
  const consensus = payload.consensus || {};
  const inferLegacyMarketScope = (item, source) => {
    const explicit = cleanText(
      item?.market_scope || source?.market_scope || item?.region,
      20,
    ).toUpperCase();
    if (explicit) return explicit;
    const publisher = cleanText(item?.publisher, 160);
    if (/증권|투자증권|자산운용|경제연구소/.test(publisher)) return "KR";
    if (
      /goldman|morgan stanley|j\.?p\.?\s*morgan|ubs|barclays|citigroup|citi\b|bofa|bank of america|deutsche|nomura|mizuho|jefferies|bernstein|hsbc/i
        .test(publisher)
    ) {
      return "GLOBAL";
    }
    return "UNKNOWN";
  };
  const normalizedReports = cleanList(payload.reports, 20).map((item) => {
    const source = item?.source || {};
    const rating = item?.rating || item?.research?.rating || {};
    const targetPrice = item?.target_price || item?.research?.target_price || {};
    const sectors = cleanList(item?.sectors, 8).map((value) => cleanText(value, 120));
    const standardSectorMap = new Map();
    for (const sector of sectors) {
      const classified = classifyResearchSector(sector);
      const key = classified.id || classified.name.toLocaleLowerCase("en-US");
      const existing = standardSectorMap.get(key);
      if (existing) {
        existing.sourceLabels = [...new Set([...existing.sourceLabels, sector])];
      } else {
        standardSectorMap.set(key, {
          id: classified.id,
          name: classified.name,
          nameEn: classified.nameEn || "",
          matched: classified.matched,
          sourceLabels: [sector],
        });
      }
    }
    return {
      reportId: cleanText(item?.report_id, 120),
      publisher: cleanText(item?.publisher, 160),
      analyst: cleanText(item?.analyst, 120),
      title: cleanText(item?.title, 240),
      publishedAt: cleanText(item?.published_at, 80),
      reportType: cleanText(item?.report_type, 80),
      marketScope: inferLegacyMarketScope(item, source),
      issuerCountry: cleanText(item?.issuer_country || source?.issuer_country, 20).toUpperCase(),
      originalLanguage: cleanText(
        item?.original_language || source?.original_language || item?.language,
        20,
      ).toLowerCase(),
      baseCurrency: cleanText(
        item?.base_currency || source?.base_currency || targetPrice?.currency,
        12,
      ).toUpperCase(),
      stance: cleanText(item?.stance, 20) || "not_stated",
      rating: {
        original: cleanText(
          item?.original_rating || rating?.original || item?.research?.original_rating,
          80,
        ),
        normalized: cleanText(
          item?.normalized_rating || rating?.normalized || item?.research?.normalized_rating,
          20,
        ) || "not_stated",
      },
      targetPrice: {
        value: finiteNumber(targetPrice?.value ?? targetPrice?.amount ?? item?.target_price_value),
        currency: cleanText(
          targetPrice?.currency || item?.target_currency || item?.research?.target_currency,
          12,
        ).toUpperCase(),
        asOf: cleanText(targetPrice?.as_of || item?.target_price_as_of, 80),
      },
      tickers: cleanList(item?.tickers, 12).map((value) => cleanText(value, 20)),
      sectors,
      standardSectors: [...standardSectorMap.values()],
      summary: cleanText(item?.summary, 1200),
      keyClaims: cleanList(item?.key_claims, 8).map((value) => cleanText(value, 500)),
      catalysts: cleanList(item?.catalysts, 6).map((value) => cleanText(value, 300)),
      risks: cleanList(item?.risks, 6).map((value) => cleanText(value, 300)),
      monitoringConditions: cleanList(item?.monitoring_conditions, 6)
        .map((value) => cleanText(value, 300)),
      opinionChange: item?.opinion_change || {},
      source: {
        reference: cleanText(source?.reference, 240),
        url: /^https?:\/\//i.test(String(source?.url || "")) ? String(source.url) : "",
      },
      processingStatus: cleanText(item?.processing?.status, 80),
      structuredAnalysisAvailable: item?.processing?.structured_analysis_available === true,
      linkedTelegramEvents: cleanList(item?.linked_telegram_events, 3).map((event) => ({
        eventId: cleanText(event?.event_id, 120),
        title: cleanText(event?.title, 240),
        score: Number(event?.score || 0),
        matchReasons: cleanList(event?.match_reasons, 8).map((value) => cleanText(value, 120)),
        url: /^https:\/\/t\.me\//i.test(String(event?.telegram_url || ""))
          ? String(event.telegram_url)
          : "",
        channel: cleanText(event?.channel, 160),
      })),
    };
  });
  const derivedMarketScopeCounts = normalizedReports.reduce((counts, report) => {
    const scope = report.marketScope || "UNKNOWN";
    counts[scope] = Number(counts[scope] || 0) + 1;
    return counts;
  }, {});
  return {
    reportDate: cleanText(payload.report_date, 20),
    generatedAt: cleanText(payload.generated_at, 80),
    summary: {
      archivedReportCount: Number(summary.archived_report_count || 0),
      selectedReportCount: Number(summary.selected_report_count || 0),
      structuredReportCount: Number(summary.structured_report_count || 0),
      awaitingAnalysisCount: Number(summary.awaiting_analysis_count || 0),
      publisherCount: Number(summary.publisher_count || 0),
      analysisStatus: cleanText(summary.analysis_status, 80) || "not_available",
      telegramLinkedReportCount: Number(summary.telegram_linked_report_count || 0),
      stanceCounts: summary.stance_counts || {},
      marketScopeCounts: Object.keys(summary.market_scope_counts || {}).length
        ? summary.market_scope_counts
        : derivedMarketScopeCounts,
      sectorTaxonomyVersion: researchSectorTaxonomyVersion(),
    },
    consensus: {
      topTickers: cleanList(consensus.top_tickers, 10).map((item) => ({
        ticker: cleanText(item?.ticker, 20),
        reportCount: Number(item?.report_count || 0),
      })),
      topSectors: cleanList(consensus.top_sectors, 10).map((item) => ({
        sector: cleanText(item?.sector, 120),
        reportCount: Number(item?.report_count || 0),
      })),
      disagreements: cleanList(consensus.disagreements, 10).map((item) => ({
        topic: cleanText(item?.topic, 120),
        stances: cleanList(item?.stances, 8).map((value) => cleanText(value, 20)),
        reportCount: Number(item?.report_count || 0),
      })),
      sectorAssessments: cleanList(consensus.sector_assessments, 8).map((item) => ({
        sector: cleanText(item?.sector, 120),
        reportCount: Number(item?.report_count || 0),
        signal: cleanText(item?.signal, 20) || "evidence_only",
        stanceCounts: item?.stance_counts || {},
        catalysts: cleanList(item?.catalysts, 3).map((value) => cleanText(value, 300)),
        risks: cleanList(item?.risks, 3).map((value) => cleanText(value, 300)),
        monitoringConditions: cleanList(item?.monitoring_conditions, 3)
          .map((value) => cleanText(value, 300)),
      })),
      coverage: brokerResearchCoverage(normalizedReports),
    },
    reports: normalizedReports,
  };
}

function brokerResearchIndexPoint(normalized) {
  const reports = normalized?.reports || [];
  const stanceCounts = normalized?.summary?.stanceCounts || {};
  const ratedCount = ["positive", "neutral", "cautious", "negative"]
    .reduce((sum, key) => sum + Number(stanceCounts[key] || 0), 0);
  const directionalBalance = ratedCount
    ? (
      (
        Number(stanceCounts.positive || 0)
        - Number(stanceCounts.cautious || 0)
        - Number(stanceCounts.negative || 0)
      ) / ratedCount
    ) * 100
    : null;
  return {
    date: normalized?.reportDate || "",
    reportCount: Number(normalized?.summary?.selectedReportCount || reports.length || 0),
    structuredCount: Number(normalized?.summary?.structuredReportCount || 0),
    publisherCount: Number(normalized?.summary?.publisherCount || 0),
    domesticCount: reports.filter((report) => report.marketScope === "KR").length,
    overseasCount: reports.filter(
      (report) => !["KR", "UNKNOWN"].includes(report.marketScope),
    ).length,
    unclassifiedCount: reports.filter((report) => report.marketScope === "UNKNOWN").length,
    ratedCount,
    directionalBalance: finiteNumber(directionalBalance),
    targetPriceCount: reports.filter((report) => report.targetPrice?.value !== null).length,
    ratingDisclosureCount: reports.filter((report) => report.rating?.original).length,
  };
}

async function loadBrokerResearchIndex(root, dates) {
  const points = [];
  const sectorHistory = [];
  for (const date of dates.slice(0, 16).reverse()) {
    const artifact = await artifactForDate(
      root,
      "broker_research_digest",
      "broker_research_digest.json",
      BROKER_RESEARCH_SCHEMA,
      date,
    );
    if (!artifact) continue;
    const normalized = normalizeBrokerResearch(artifact.payload);
    points.push(brokerResearchIndexPoint(normalized));
    sectorHistory.push({
      date: normalized.reportDate || date,
      sectors: normalized.consensus.coverage,
    });
  }
  const latest = points.at(-1) || null;
  const previous = points.at(-2) || null;
  return {
    history: points,
    sectorHistory,
    latest,
    change: latest && previous
      ? {
        reportCount: latest.reportCount - previous.reportCount,
        publisherCount: latest.publisherCount - previous.publisherCount,
        structuredCount: latest.structuredCount - previous.structuredCount,
        directionalBalance:
          latest.directionalBalance !== null && previous.directionalBalance !== null
            ? latest.directionalBalance - previous.directionalBalance
            : null,
      }
      : null,
  };
}

export async function loadPbDailyIntelligenceSnapshot({
  env = process.env,
  brokerResearchDate = "",
} = {}) {
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
  const brokerResearchDates = await dateFolders(join(config.root, "broker_research_digest"));
  const brokerResearchArtifact = await latestArtifact(
    config.root,
    "broker_research_digest",
    "broker_research_digest.json",
    BROKER_RESEARCH_SCHEMA,
    cleanText(brokerResearchDate, 20)
  );
  const brokerResearchNormalized = brokerResearchArtifact
    ? normalizeBrokerResearch(brokerResearchArtifact.payload)
    : null;
  const brokerResearchIndex = await loadBrokerResearchIndex(config.root, brokerResearchDates);
  const telegramSources = await loadTelegramOverview({
    root: config.root,
    reportDate: readerArtifact.date,
    engineRoot: configuredEngineRoot(env, config.root),
    env,
  });
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
    brokerResearch: brokerResearchNormalized,
    brokerResearchIndex,
    brokerResearchHistory: {
      availableDates: brokerResearchDates,
      selectedDate: brokerResearchArtifact?.date || "",
      latestDate: brokerResearchDates[0] || "",
    },
    telegramSources,
  };
}

export async function handlePbDailyIntelligenceEndpoint(req, res) {
  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  try {
    const requestUrl = new URL(req.url || "/api/pb-daily-intelligence", "http://127.0.0.1");
    sendJson(res, {
      ok: true,
      ...(await loadPbDailyIntelligenceSnapshot({
        brokerResearchDate: requestUrl.searchParams.get("brokerDate") || "",
      })),
    });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
