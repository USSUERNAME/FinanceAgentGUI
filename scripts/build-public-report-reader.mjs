import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const APP_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_TEMPLATE_DIR = join(APP_ROOT, "web", "public-report-reader");
const TEMPLATE_FILES = ["index.html", "styles.css", "app.js", "_headers"];
const REPORT_FILE_NAME = "reader_report.json";
const INTELLIGENCE_FILE_NAME = "daily_intelligence.json";
const TELEGRAM_FILE_NAME = "telegram_intelligence.json";
const MAX_REPORTS = 90;
const PRIVATE_KEY_PATTERN = /(token|secret|password|cookie|authorization|credential|refresh|full.?text|raw.?content|absolute.?path)/i;

function text(value, maxLength = 4000) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.slice(0, maxLength);
}

function prose(value, maxLength = 4000) {
  return text(value, maxLength)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function textList(value, { limit = 20, maxLength = 1600 } = {}) {
  return (Array.isArray(value) ? value : [])
    .map((item) => prose(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function safeUrl(value) {
  const candidate = text(value, 2000);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function safeTelegramUrl(value) {
  const candidate = safeUrl(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["t.me", "www.t.me"].includes(url.hostname.toLowerCase()) ? url.href : "";
  } catch {
    return "";
  }
}

function safeObject(value, { depth = 0, maxDepth = 5, arrayLimit = 30, keyLimit = 60 } = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return prose(value, 2400);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= maxDepth) return null;
  if (Array.isArray(value)) {
    return value
      .slice(0, arrayLimit)
      .map((item) => safeObject(item, { depth: depth + 1, maxDepth, arrayLimit, keyLimit }))
      .filter((item) => item !== null && item !== "");
  }
  if (typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_KEY_PATTERN.test(key))
      .slice(0, keyLimit)
      .map(([key, item]) => [text(key, 100), safeObject(item, { depth: depth + 1, maxDepth, arrayLimit, keyLimit })])
      .filter(([, item]) => item !== null && item !== "" && (!Array.isArray(item) || item.length)),
  );
}

function findingList(value, limit = 20) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (typeof item === "string") return { title: "", body: prose(item, 2200) };
      const source = item && typeof item === "object" ? item : {};
      return {
        title: prose(source.title || source.label || source.event, 240),
        body: prose(source.body || source.summary || source.note || source.description || source.status, 2200),
      };
    })
    .filter((item) => item.title || item.body)
    .slice(0, limit);
}

function analystResearch(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const source = item && typeof item === "object" ? item : {};
      return {
        publisher: text(source.publisher, 160),
        analyst: text(source.analyst, 160),
        title: prose(source.title || source.report_id, 360),
        publishedAt: text(source.published_at, 80),
        reportType: text(source.report_type, 80),
        stance: text(source.stance, 80),
        tickers: textList(source.tickers, { limit: 12, maxLength: 40 }),
        sectors: textList(source.sectors, { limit: 12, maxLength: 80 }),
        summary: prose(source.summary, 3200),
        keyClaims: textList(source.key_claims, { limit: 12, maxLength: 1600 }),
        catalysts: textList(source.catalysts, { limit: 10, maxLength: 1200 }),
        risks: textList(source.risks, { limit: 10, maxLength: 1200 }),
        source: {
          reference: text(source.source?.reference, 300),
          url: safeUrl(source.source?.url),
        },
      };
    })
    .filter((item) => item.title || item.summary)
    .slice(0, 25);
}

function safeScalarMap(source, allowedKeys) {
  const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return Object.fromEntries(
    allowedKeys
      .map((key) => {
        const item = value[key];
        if (Array.isArray(item)) return [key, textList(item, { limit: 20, maxLength: 1200 })];
        if (["string", "number", "boolean"].includes(typeof item)) return [key, typeof item === "string" ? text(item, 2400) : item];
        if (item && typeof item === "object") return [key, safeObject(item, { maxDepth: 3, arrayLimit: 20 })];
        return [key, null];
      })
      .filter(([, item]) => item !== null && item !== "" && (!Array.isArray(item) || item.length)),
  );
}

function koreaMetricDirection(metricId, metric = {}) {
  const isFlow = /^foreign_/i.test(metricId);
  const signal = Number(isFlow ? metric.value : metric.change_1d_pct);
  if (!Number.isFinite(signal)) return "";
  if (signal === 0) return isFlow ? "neutral" : "flat";
  if (isFlow) return signal > 0 ? "net_buy" : "net_sell";
  return signal > 0 ? "up" : "down";
}

function summarizeKoreaMetric(metricId, value) {
  const metric = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    metricId: text(metric.metric_id || metricId, 120),
    label: text(metric.label, 200),
    status: text(metric.status, 80),
    asOf: text(metric.as_of, 40),
    direction: koreaMetricDirection(metricId, metric),
    sourceGrade: text(metric.source_grade, 40),
    primarySourceConfirmed: Boolean(metric.primary_source_confirmed),
  };
}

function summarizeKoreaMetrics(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item, index) => {
      const metricId = text(item?.metric_id || item?.id || `metric_${index + 1}`, 120);
      return summarizeKoreaMetric(metricId, item);
    });
  }
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .slice(0, 20)
      .map(([metricId, metric]) => [text(metricId, 120), summarizeKoreaMetric(metricId, metric)]),
  );
}

function sanitizeKoreaTransmission(source = {}) {
  const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const gate = value.transmission_gate && typeof value.transmission_gate === "object" ? value.transmission_gate : {};
  return {
    reportDate: text(value.report_date, 20),
    collectionStatus: text(value.collection_status || value.status, 100),
    metrics: summarizeKoreaMetrics(value.metrics),
    transmissionGate: {
      status: text(gate.status, 120),
      dateAlignment: safeScalarMap(gate.date_alignment, [
        "status",
        "earliest_as_of",
        "latest_as_of",
        "calendar_day_gap",
        "business_day_gap",
        "max_allowed_business_day_gap",
      ]),
      decisionLimit: prose(gate.decision_limit, 1200),
    },
  };
}

function sourceList(value) {
  return (Array.isArray(value) ? value : [])
    .map((source) => ({
      title: text(source?.title || source?.source_id, 300),
      url: safeUrl(source?.url),
      asOf: text(source?.as_of, 80),
    }))
    .filter((source) => source.title || source.url)
    .slice(0, 80);
}

export function sanitizeReaderReport(source = {}) {
  if (source?.schema_version !== "v2_reader_report.v1") throw new Error("unsupported reader report schema");
  const reportDate = text(source.report_date, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("invalid reader report date");
  return {
    schemaVersion: "public_pb_reader.v1",
    reportDate,
    generatedAt: text(source.generated_at, 80),
    title: prose(source.title || `${reportDate} Daily Market Intelligence`, 400),
    executiveSummary: textList(source.executive_summary, { limit: 12, maxLength: 2200 }),
    marketFindings: findingList(source.market_findings, 16),
    todayChanges: findingList(source.today_changes, 16),
    verifiedEvents: findingList(source.verified_events, 16),
    analystResearch: analystResearch(source.analyst_research),
    earningsWatch: safeScalarMap(source.earnings_watch, ["status", "summary", "labels"]),
    koreaConnection: {
      ...safeScalarMap(source.korea_connection, ["status", "summary"]),
      metrics: summarizeKoreaMetrics(source.korea_connection?.metrics),
    },
    nextChecks: textList(source.next_checks, { limit: 20, maxLength: 1200 }),
    dataStatus: safeScalarMap(source.data_status, ["latest_price_as_of", "verified_event_count", "korea_data_status", "warnings"]),
    sources: sourceList(source.sources),
  };
}

function eventNarratives(value, limit = 12) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (typeof item === "string") return prose(item, 1800);
      if (!item || typeof item !== "object") return null;
      return safeObject(item, { maxDepth: 3, arrayLimit: 12, keyLimit: 24 });
    })
    .filter(Boolean)
    .slice(0, limit);
}

export function sanitizeDailyIntelligence(source = {}) {
  const reportDate = text(source.report_date, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("invalid daily intelligence date");
  const market = source.market && typeof source.market === "object" ? source.market : {};
  const events = source.events && typeof source.events === "object" ? source.events : {};
  const continuity = source.continuity && typeof source.continuity === "object" ? source.continuity : {};
  const earnings = source.earnings && typeof source.earnings === "object" ? source.earnings : {};
  const sourceState = source.source_state && typeof source.source_state === "object" ? source.source_state : {};
  return {
    schemaVersion: "private_daily_intelligence.v1",
    reportDate,
    generatedAt: text(source.generated_at, 80),
    audience: text(source.audience, 120),
    market: {
      dataCutoff: safeScalarMap(market.data_cutoff, ["report_timezone", "generated_at", "price_basis", "latest_price_as_of", "calendar_gap_days", "status", "note", "news_scope", "monthly_macro_note"]),
      regime: safeScalarMap(market.regime, ["label", "confidence", "summary", "quantitative_evidence"]),
      keyDrivers: (Array.isArray(market.key_drivers) ? market.key_drivers : []).slice(0, 12).map((item) => safeScalarMap(item, ["observation", "interpretation", "confirmation_condition", "invalidation_condition"])),
      conflictingSignals: textList(market.conflicting_signals, { limit: 16, maxLength: 1800 }),
      topRisks: textList(market.top_risks, { limit: 16, maxLength: 1800 }),
      scoreboard: safeObject(market.scoreboard, { maxDepth: 5, arrayLimit: 24, keyLimit: 80 }),
      dayOverDayChanges: safeObject(market.day_over_day_changes, { maxDepth: 4, arrayLimit: 24, keyLimit: 60 }),
      koreaTransmission: sanitizeKoreaTransmission(market.korea_transmission_inputs),
    },
    events: {
      clusterCount: Number(events.cluster_count) || 0,
      selectedCount: Number(events.selected_count) || 0,
      verifiedPrimaryFactCount: Number(events.verified_primary_fact_count) || 0,
      synthesisStatus: text(events.synthesis_status, 120),
      fallbackReason: prose(events.fallback_reason, 800),
      items: (Array.isArray(events.items) ? events.items : []).slice(0, 30).map((item) => ({
        eventId: text(item?.event_id, 160),
        eventType: text(item?.event_type, 120),
        title: prose(item?.title, 480),
        entities: safeObject(item?.entities, { maxDepth: 2, arrayLimit: 20, keyLimit: 20 }),
        listedEntities: safeObject(item?.listed_entities, { maxDepth: 2, arrayLimit: 20, keyLimit: 20 }),
        topicTags: textList(item?.topic_tags, { limit: 20, maxLength: 100 }),
        commonFacts: eventNarratives(item?.common_facts),
        reportedClaims: eventNarratives(item?.reported_claims),
        uniqueAngles: eventNarratives(item?.unique_angles),
        conflictingClaims: eventNarratives(item?.conflicting_claims),
        expectationGap: safeObject(item?.expectation_gap, { maxDepth: 4, arrayLimit: 20, keyLimit: 40 }),
        marketReaction: safeObject(item?.market_reaction, { maxDepth: 4, arrayLimit: 20, keyLimit: 40 }),
        impactAnalysis: safeObject(item?.impact_analysis, { maxDepth: 5, arrayLimit: 24, keyLimit: 60 }),
        ranking: safeObject(item?.ranking, { maxDepth: 3, arrayLimit: 12, keyLimit: 30 }),
      })).filter((item) => item.title || item.eventId),
    },
    continuity: {
      summary: safeObject(continuity.summary, { maxDepth: 3, arrayLimit: 20, keyLimit: 30 }),
      activeEntries: (Array.isArray(continuity.active_entries) ? continuity.active_entries : []).slice(0, 40).map((item) => safeObject(item, { maxDepth: 4, arrayLimit: 20, keyLimit: 40 })),
    },
    earnings: {
      status: text(earnings.status, 160),
      summary: safeObject(earnings.summary, { maxDepth: 3, arrayLimit: 20, keyLimit: 30 }),
      companies: (Array.isArray(earnings.companies) ? earnings.companies : []).slice(0, 30).map((item) => safeObject(item, { maxDepth: 5, arrayLimit: 24, keyLimit: 60 })),
    },
    crossSourceSummary: safeObject(source.cross_source_summary, { maxDepth: 3, arrayLimit: 20, keyLimit: 30 }),
    sourceQuality: safeObject(sourceState.quality ? {
      record_count: sourceState.quality.record_count,
      primary_source_confirmed_count: sourceState.quality.primary_source_confirmed_count,
      primary_confirmation_rate_pct: sourceState.quality.primary_confirmation_rate_pct,
      link_coverage_pct: sourceState.quality.link_coverage_pct,
      publication_allowed: sourceState.quality.publication_allowed,
      blockers: sourceState.quality.blockers,
      warnings: sourceState.quality.warnings,
      material_warnings: sourceState.quality.material_warnings,
      evidence_posture: sourceState.quality.evidence_posture,
    } : {}, { maxDepth: 4, arrayLimit: 20, keyLimit: 40 }),
    dataWarnings: textList(sourceState.data_warnings, { limit: 30, maxLength: 1800 }),
    calculationWarnings: textList(sourceState.calculation_warnings, { limit: 30, maxLength: 1800 }),
  };
}

export function sanitizeTelegramRefresh(source = {}) {
  if (source?.schema_version !== "telegram_intelligence_refresh.v1") {
    throw new Error("unsupported Telegram refresh schema");
  }
  const generatedAt = text(source.generated_at, 80);
  if (!generatedAt || Number.isNaN(new Date(generatedAt).getTime())) {
    throw new Error("invalid Telegram refresh timestamp");
  }
  return {
    schemaVersion: "private_telegram_intelligence.v1",
    generatedAt,
    status: text(source.status, 80),
    rawPostCount: Math.max(0, Number(source.raw_post_count) || 0),
    deduplicatedPostCount: Math.max(0, Number(source.deduplicated_post_count) || 0),
    eventClusterCount: Math.max(0, Number(source.event_cluster_count) || 0),
    representedChannelCount: Math.max(0, Number(source.represented_channel_count) || 0),
    pdfAttachmentCount: Math.max(0, Number(source.pdf_attachment_count) || 0),
    clusters: (Array.isArray(source.clusters) ? source.clusters : []).slice(0, 20).map((item) => ({
      eventId: text(item?.event_id, 160),
      title: prose(item?.title, 480),
      eventType: text(item?.event_type, 120),
      verificationStatus: text(item?.verification_status, 120),
      latestPublishedAt: text(item?.latest_published_at, 80),
      postCount: Math.max(0, Number(item?.post_count) || 0),
      channels: textList(item?.channels, { limit: 8, maxLength: 160 }),
      postUrls: (Array.isArray(item?.post_urls) ? item.post_urls : [])
        .map(safeTelegramUrl)
        .filter(Boolean)
        .slice(0, 4),
    })).filter((item) => item.title || item.eventId),
  };
}

function sanitizeWorldMemoryView(view = {}) {
  return {
    title: prose(view.title, 360),
    asOf: text(view.asOf, 80),
    stance: text(view.stance, 100),
    summary: prose(view.summary, 2400),
    narrative: prose(view.narrative, 5000),
    signalRadar: (Array.isArray(view.signalRadar) ? view.signalRadar : []).slice(0, 12).map((item) => ({
      label: text(item?.label, 120), score: Number(item?.score) || 0, tone: text(item?.tone, 80), note: prose(item?.note, 1200),
    })).filter((item) => item.label || item.note),
    highlights: (Array.isArray(view.highlights) ? view.highlights : []).slice(0, 20).map((item) => ({
      title: prose(item?.title, 320), body: prose(item?.body, 2400), tag: text(item?.tag, 100), importance: text(item?.importance, 80),
    })).filter((item) => item.title || item.body),
    portfolioSuggestions: textList(view.portfolioSuggestions, { limit: 20, maxLength: 1800 }),
    memoryChangeSuggestions: textList(view.memoryChangeSuggestions, { limit: 20, maxLength: 1800 }),
    nextChecks: textList(view.nextChecks, { limit: 30, maxLength: 1800 }),
  };
}

function sanitizeInvestmentTheses(source = {}) {
  return (Array.isArray(source.records) ? source.records : []).slice(0, 80).map((item) => ({
    continuityId: text(item?.continuityId, 160),
    kind: text(item?.kind, 100),
    entityId: text(item?.entityId, 100),
    title: prose(item?.title, 320),
    thesis: prose(item?.thesis, 2400),
    state: text(item?.state, 100),
    stateLabel: text(item?.stateLabel, 100),
    priority: text(item?.priority, 80),
    sectorTicker: text(item?.sectorTicker, 40),
    sectorLabel: text(item?.sectorLabel, 100),
    confirmationCondition: prose(item?.confirmationCondition, 1600),
    invalidationCondition: prose(item?.invalidationCondition, 1600),
    evidence: textList(item?.evidence, { limit: 20, maxLength: 1000 }),
    metricId: text(item?.metricId, 120),
    metricValue: typeof item?.metricValue === "number" ? item.metricValue : null,
    metricUnit: text(item?.metricUnit, 40),
    firstSeenAt: text(item?.firstSeenAt, 40),
    lastSeenAt: text(item?.lastSeenAt, 40),
    observationCount: Number(item?.observationCount) || 0,
  })).filter((item) => item.title || item.thesis);
}

export function buildWorldMemorySnapshot(collectorState = {}, investmentTheses = {}) {
  const report = collectorState.report && typeof collectorState.report === "object" ? collectorState.report : {};
  return {
    schemaVersion: "private_reader_world_memory.v1",
    generatedAt: text(report.generatedAt || collectorState.updatedAt, 80),
    collector: safeScalarMap(collectorState.collector, ["status", "lastSuccessfulAt", "lastReportSuccessfulAt", "lastAction"]),
    report: sanitizeWorldMemoryView(report.view || {}),
    thesesUpdatedAt: text(investmentTheses.updatedAt, 80),
    theses: sanitizeInvestmentTheses(investmentTheses),
  };
}

export function sanitizeWorldMemorySnapshot(source = {}) {
  if (!source || typeof source !== "object") return null;
  const snapshot = source.schemaVersion === "private_reader_world_memory.v1"
    ? source
    : buildWorldMemorySnapshot(source, {});
  const result = {
    schemaVersion: "private_reader_world_memory.v1",
    generatedAt: text(snapshot.generatedAt, 80),
    collector: safeScalarMap(snapshot.collector, ["status", "lastSuccessfulAt", "lastReportSuccessfulAt", "lastAction"]),
    report: sanitizeWorldMemoryView(snapshot.report || {}),
    thesesUpdatedAt: text(snapshot.thesesUpdatedAt, 80),
    theses: sanitizeInvestmentTheses({ records: snapshot.theses }),
  };
  return result.report.title || result.report.summary || result.theses.length ? result : null;
}

async function findNamedFiles(root, fileName, depth = 0) {
  if (!root || depth > 5) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await findNamedFiles(path, fileName, depth + 1)));
    else if (entry.isFile() && entry.name === fileName) files.push(path);
  }
  return files;
}

async function collectByDate(inputDir, fileName, sanitizer) {
  const byDate = new Map();
  for (const file of await findNamedFiles(inputDir, fileName)) {
    try {
      const item = sanitizer(JSON.parse(await readFile(file, "utf8")));
      const current = byDate.get(item.reportDate);
      if (!current || String(item.generatedAt) > String(current.generatedAt)) byDate.set(item.reportDate, item);
    } catch (error) {
      console.warn(`Skipped ${basename(file)}: ${error.message}`);
    }
  }
  return [...byDate.values()]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, MAX_REPORTS);
}

function sanitizePreviousTelegram(source) {
  if (source?.schemaVersion !== "private_telegram_intelligence.v1") return null;
  try {
    return sanitizeTelegramRefresh({
      schema_version: "telegram_intelligence_refresh.v1",
      generated_at: source.generatedAt,
      status: source.status,
      raw_post_count: source.rawPostCount,
      deduplicated_post_count: source.deduplicatedPostCount,
      event_cluster_count: source.eventClusterCount,
      represented_channel_count: source.representedChannelCount,
      pdf_attachment_count: source.pdfAttachmentCount,
      clusters: (source.clusters || []).map((item) => ({
        event_id: item.eventId,
        title: item.title,
        event_type: item.eventType,
        verification_status: item.verificationStatus,
        latest_published_at: item.latestPublishedAt,
        post_count: item.postCount,
        channels: item.channels,
        post_urls: item.postUrls,
      })),
    });
  } catch {
    return null;
  }
}

async function previousPayload(previousBundle) {
  if (!previousBundle) return { reports: [], intelligence: [], worldMemory: null, telegram: null };
  try {
    const payload = JSON.parse(await readFile(resolve(previousBundle), "utf8"));
    if (payload?.schemaVersion !== "public_pb_reader_bundle.v1") return { reports: [], intelligence: [], worldMemory: null, telegram: null };
    return {
      reports: (Array.isArray(payload.reports) ? payload.reports : []).filter((item) => item?.schemaVersion === "public_pb_reader.v1").slice(0, MAX_REPORTS),
      intelligence: (Array.isArray(payload.intelligence) ? payload.intelligence : []).filter((item) => item?.schemaVersion === "private_daily_intelligence.v1").slice(0, MAX_REPORTS),
      worldMemory: sanitizeWorldMemorySnapshot(payload.worldMemory),
      telegram: sanitizePreviousTelegram(payload.telegram),
    };
  } catch {
    return { reports: [], intelligence: [], worldMemory: null, telegram: null };
  }
}

async function readWorldMemorySnapshot(path) {
  if (!path) return null;
  try {
    return sanitizeWorldMemorySnapshot(JSON.parse(await readFile(resolve(path), "utf8")));
  } catch {
    return null;
  }
}

async function readLatestTelegramSnapshot(inputDir) {
  if (!inputDir) return null;
  let latest = null;
  for (const file of await findNamedFiles(resolve(inputDir), TELEGRAM_FILE_NAME)) {
    try {
      const item = sanitizeTelegramRefresh(JSON.parse(await readFile(file, "utf8")));
      if (!latest || item.generatedAt > latest.generatedAt) latest = item;
    } catch (error) {
      console.warn(`Skipped ${basename(file)}: ${error.message}`);
    }
  }
  return latest;
}

function mergeByDate(previous, current) {
  const byDate = new Map(previous.map((item) => [item.reportDate, item]));
  current.forEach((item) => byDate.set(item.reportDate, item));
  return [...byDate.values()]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, MAX_REPORTS);
}

export async function buildPublicReportReader({
  inputDir,
  intelligenceDir = "",
  telegramDir = "",
  worldMemoryFile = "",
  outputDir,
  templateDir = DEFAULT_TEMPLATE_DIR,
  previousBundle = "",
  locked = false,
}) {
  const target = resolve(outputDir);
  await mkdir(target, { recursive: true });
  await Promise.all(TEMPLATE_FILES.map((file) => copyFile(join(templateDir, file), join(target, file))));
  const previous = await previousPayload(previousBundle);
  const currentReports = locked ? [] : await collectByDate(resolve(inputDir), REPORT_FILE_NAME, sanitizeReaderReport);
  const resolvedIntelligenceDir = intelligenceDir || join(dirname(resolve(inputDir)), "intelligence");
  const currentIntelligence = locked ? [] : await collectByDate(resolve(resolvedIntelligenceDir), INTELLIGENCE_FILE_NAME, sanitizeDailyIntelligence);
  const reports = locked ? [] : mergeByDate(previous.reports, currentReports);
  const intelligence = locked ? [] : mergeByDate(previous.intelligence, currentIntelligence);
  const worldMemory = locked ? null : (await readWorldMemorySnapshot(worldMemoryFile)) || previous.worldMemory;
  const telegram = locked ? null : (await readLatestTelegramSnapshot(telegramDir)) || previous.telegram;
  if (!locked && !reports.length && !intelligence.length && !worldMemory && !telegram) throw new Error(`no valid private reader content found in ${inputDir}`);
  const payload = {
    schemaVersion: "public_pb_reader_bundle.v1",
    generatedAt: new Date().toISOString(),
    locked: Boolean(locked),
    reports,
    intelligence,
    worldMemory,
    telegram,
  };
  await writeFile(join(target, "reports.json"), `${JSON.stringify(payload)}\n`, "utf8");
  return { outputDir: target, reportCount: reports.length, intelligenceCount: intelligence.length, worldMemory: Boolean(worldMemory), telegram: Boolean(telegram), locked: payload.locked };
}

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const locked = process.argv.includes("--locked");
  const inputDir = argument("input", join(APP_ROOT, "pipeline", "pb-daily-market-brief", "workspace", "v2_reader_reports"));
  const intelligenceDir = argument("intelligence", "");
  const telegramDir = argument("telegram", "");
  const worldMemoryFile = argument("world-memory", "");
  const outputDir = argument("output", join(APP_ROOT, ".generated", "cloudflare-report-reader"));
  const previousBundle = argument("previous", "");
  buildPublicReportReader({ inputDir, intelligenceDir, telegramDir, worldMemoryFile, outputDir, previousBundle, locked })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
