import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { readJsonBody, sendJson } from "./codexProbe.mjs";
import {
  classifyResearchSector,
  researchSectorTaxonomyVersion,
  suggestResearchSectors,
} from "./researchSectorTaxonomy.mjs";
import { readPortfolioCanvasStoreSnapshot } from "./portfolioApi.mjs";
import {
  addTransactionWatchlistTicker,
  readTransactionSettings,
  removeTransactionPortfolioHolding,
  upsertTransactionPortfolioHolding,
} from "./transactionSettings.mjs";
import { pushSystemNotification } from "./notificationsApi.mjs";
import {
  buildPortfolioRiskActions,
  recordPortfolioRiskSnapshot,
} from "./portfolioRiskHistory.mjs";
import {
  attachPortfolioRiskReviews,
  readPortfolioRiskReviews,
  reviewPortfolioRiskThesisProposal,
  savePortfolioRiskResponse,
  savePortfolioRiskFollowUp,
  savePortfolioRiskReview,
} from "./portfolioRiskReviews.mjs";
import {
  attachPortfolioResponseRuleDecisions,
  buildMonthlyPortfolioDecisionReview,
  buildPortfolioFailureCauseRuleImpact,
  buildPortfolioResponseRuleImpact,
  readPortfolioResponseRuleDecisions,
  reviewPortfolioResponseActiveRule,
  reviewPortfolioResponseRuleSuggestion,
} from "./portfolioResponseRules.mjs";
import {
  attachMonthlyDecisionGoals,
  buildMonthlyFailureChecklistSuggestions,
  buildMonthlyDecisionGoalProposals,
  readPortfolioDecisionGoals,
  reviewMonthlyDecisionGoalProposal,
} from "./portfolioDecisionGoals.mjs";
import {
  applyRiskReviewEvidenceToInvestmentTheses,
  buildTrackedInvestmentTheses,
  buildWeeklyThesisCalibration,
  readInvestmentThesisMemory,
  syncInvestmentThesisMemory,
  syncSelectedStockThesisMemory,
} from "./pbInvestmentThesisMemory.mjs";

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const READER_SCHEMA = "v2_reader_report.v1";
const INTELLIGENCE_SCHEMA = "daily_market_intelligence.v2";
const MARKET_INTERNALS_SCHEMA = "us_market_internals.v1";
const SECTOR_METRICS_SCHEMA = "sector_metric_observations.v1";
const STOCK_CANDIDATES_SCHEMA = "us_equity_candidate_screen.v1";
const TELEGRAM_REGISTRY_SCHEMA = "telegram_channel_registry.v1";
const TELEGRAM_REFRESH_SCHEMA = "telegram_intelligence_refresh.v1";
const BROKER_RESEARCH_SCHEMA = "broker_research_digest.v1";
const BROKER_RESEARCH_ANALYSIS_SCHEMA = "broker_research_analysis.v1";

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

function parseDotEnv(text = "") {
  const values = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values.set(match[1], match[2].trim().replace(/^(['"])(.*)\1$/, "$2"));
  }
  return values;
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

async function latestGmailResearchCandidates(root, preferredDate, limit = 20) {
  const parent = join(root, "normalized_inbox");
  const dates = await dateFolders(parent);
  const selectedDate =
    preferredDate && dates.includes(preferredDate)
      ? preferredDate
      : dates[0];
  if (!selectedDate) return { date: preferredDate || "", candidates: [] };

  const dateRoot = join(parent, selectedDate);
  const entries = await readdir(dateRoot, { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((entry) => entry.isFile() && /^inbox_.*\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const seen = new Set();
  const candidates = [];
  for (const name of names) {
    let rows;
    try {
      rows = await readJsonFile(join(dateRoot, name));
    } catch {
      continue;
    }
    for (const row of cleanList(rows, 500)) {
      const tags = cleanList(row?.tags, 50).map((tag) => cleanText(tag, 120));
      if (!row?.gmail_message && !tags.includes("official_email_source")) continue;
      const id = cleanText(row?.id || row?.source_reference, 300);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const research = row?.research_metadata || {};
      const gmailMessage = row?.gmail_message || {};
      const gmailAttachmentKey = cleanText(
        row?.gmail_attachment?.attachment_key,
        128,
      );
      const gmailParentSourceReference = cleanText(
        row?.gmail_attachment?.parent_source_reference,
        300,
      );
      const gmailAttachmentFilename = cleanText(
        row?.gmail_attachment?.filename,
        500,
      );
      const attachments = cleanList(gmailMessage?.attachments, 30)
        .filter((attachment) => attachment && typeof attachment === "object")
        .map((attachment) => ({
          attachmentKey: cleanText(attachment.attachment_key, 128),
          filename: cleanText(attachment.filename, 500),
          mimeType: cleanText(attachment.mime_type, 120),
          size: Math.max(0, Number(attachment.size) || 0),
          isPdf: attachment.is_pdf === true,
          approvalState: ["approved", "excluded"].includes(
            cleanText(attachment.approval_state, 40)
          )
            ? cleanText(attachment.approval_state, 40)
            : "pending",
        }))
        .filter((attachment) => attachment.attachmentKey && attachment.filename);
      const hasAnalysis = Boolean(
        cleanText(research?.summary, 1200)
        || cleanList(research?.key_claims, 8).length
      );
      candidates.push({
        id,
        publisher: cleanText(row?.publisher || row?.source_id, 160),
        title: cleanText(row?.title, 300),
        publishedAt: cleanText(row?.published_at, 80),
        marketScope: cleanText(row?.market_scope, 40) || "GLOBAL",
        reportType: cleanText(research?.report_type, 80) || "market_strategy",
        stance: cleanText(research?.stance, 40) || "not_stated",
        analysisState: hasAnalysis ? "analyzed" : "ready",
        summary: cleanText(research?.summary, 600),
        attachmentCount: Number(gmailMessage?.attachment_count || 0),
        pdfAttachmentCount: Number(gmailMessage?.pdf_attachment_count || 0),
        attachmentReviewRequired: gmailMessage?.attachment_review_required === true,
        attachments,
        sourceReference: cleanText(row?.source_reference, 300),
        ...(gmailAttachmentKey ? {
          gmailAttachmentKey,
          gmailParentSourceReference,
          gmailAttachmentFilename,
        } : {}),
      });
      if (candidates.length >= limit) {
        return { date: selectedDate, candidates };
      }
    }
  }
  return { date: selectedDate, candidates };
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
    TELEGRAM_REFRESH_SCHEMA
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
    pdfAttachmentCount: Number(
      liveRefreshArtifact?.payload?.pdf_attachment_count
      ?? 0
    ),
    pdfAttachments: cleanList(
      liveRefreshArtifact?.payload?.pdf_attachments,
      100
    ).map((attachment) => ({
      attachmentKey: cleanText(attachment?.attachment_key, 128),
      filename: cleanText(attachment?.filename, 500),
      mimeType: cleanText(attachment?.mime_type, 120),
      size: Math.max(0, Number(attachment?.size) || 0),
      channelUsername: cleanText(attachment?.channel_username, 80),
      channelName: cleanText(attachment?.channel_name, 160),
      messageId: Number(attachment?.message_id || 0),
      postUrl: /^https:\/\/t\.me\//i.test(String(attachment?.post_url || ""))
        ? String(attachment.post_url)
        : "",
      publishedAt: cleanText(attachment?.published_at, 80),
      title: cleanText(attachment?.title, 240),
    })).filter((attachment) => attachment.attachmentKey && attachment.filename),
    clusters,
  };
}

async function loadGmailResearchOverview({ root, reportDate, engineRoot, env }) {
  const sourceStatusArtifact = await latestJsonInDateFolder(
    root,
    "source_status",
    reportDate,
    /^source_status_.*\.json$/i
  );
  const gmailSource = cleanList(sourceStatusArtifact?.payload?.sources, 100)
    .find((source) => source?.source_id === "gmail_research");
  const candidateArtifact = await latestGmailResearchCandidates(root, reportDate);
  const analysisArtifact = candidateArtifact.date
    ? await artifactForDate(
        root,
        "broker_research_analysis",
        "broker_research_analysis.json",
        BROKER_RESEARCH_ANALYSIS_SCHEMA,
        candidateArtifact.date
      )
    : null;
  const analysisById = new Map(
    cleanList(analysisArtifact?.payload?.reports, 100)
      .filter((row) => row && typeof row === "object")
      .map((row) => [cleanText(row.report_id, 300), row])
      .filter(([id]) => Boolean(id))
  );
  const analyzedCandidates = candidateArtifact.candidates.map((candidate) => {
    const analysis = analysisById.get(candidate.id);
    if (!analysis) return candidate;
    return {
      ...candidate,
      analyst: cleanText(analysis.analyst, 160),
      reportType: cleanText(analysis.report_type, 80) || candidate.reportType,
      stance: cleanText(analysis.stance, 40) || candidate.stance,
      analysisState: "analyzed",
      summary: cleanText(analysis.summary, 800),
      keyClaims: cleanList(analysis.key_claims, 6).map((value) => cleanText(value, 400)),
      catalysts: cleanList(analysis.catalysts, 5).map((value) => cleanText(value, 300)),
      risks: cleanList(analysis.risks, 5).map((value) => cleanText(value, 300)),
      sectors: cleanList(analysis.sectors, 6).map((value) => cleanText(value, 120)),
      tickers: cleanList(analysis.tickers, 10).map((value) => cleanText(value, 40)),
      monitoringConditions: cleanList(analysis.monitoring_conditions, 5)
        .map((value) => cleanText(value, 300)),
    };
  });
  const attachmentsByParent = new Map();
  for (const candidate of analyzedCandidates) {
    if (!candidate.gmailAttachmentKey || !candidate.gmailParentSourceReference) continue;
    const attachments = attachmentsByParent.get(candidate.gmailParentSourceReference) || [];
    attachments.push({
      id: candidate.id,
      attachmentKey: candidate.gmailAttachmentKey,
      filename: candidate.gmailAttachmentFilename || candidate.title,
      title: candidate.title,
      analyst: candidate.analyst || "",
      reportType: candidate.reportType,
      stance: candidate.stance,
      analysisState: candidate.analysisState,
      summary: candidate.summary,
      keyClaims: candidate.keyClaims || [],
      catalysts: candidate.catalysts || [],
      risks: candidate.risks || [],
      sectors: candidate.sectors || [],
      tickers: candidate.tickers || [],
      monitoringConditions: candidate.monitoringConditions || [],
    });
    attachmentsByParent.set(candidate.gmailParentSourceReference, attachments);
  }
  const candidates = analyzedCandidates
    .filter((candidate) => !candidate.gmailAttachmentKey)
    .map((candidate) => {
      const analyzedAttachments = attachmentsByParent.get(candidate.sourceReference) || [];
      return {
        ...candidate,
        ...(analyzedAttachments.length ? { analyzedAttachments } : {}),
      };
    });

  let dotenv = new Map();
  const envPath = engineRoot ? join(engineRoot, ".env") : "";
  if (envPath && existsSync(envPath)) {
    try {
      const info = await stat(envPath);
      if (info.isFile() && info.size <= 1024 * 1024) {
        dotenv = parseDotEnv(await readFile(envPath, "utf8"));
      }
    } catch {
      dotenv = new Map();
    }
  }
  const configuredValue = (name) => cleanText(env[name] || dotenv.get(name), 8000);
  const refreshTokenConfigured = Boolean(configuredValue("GOOGLE_GMAIL_REFRESH_TOKEN"));
  const label = configuredValue("GOOGLE_GMAIL_RESEARCH_LABEL") || "Stocks";

  let allowlistedSenderDomains = [];
  const sourcesPath = engineRoot ? join(engineRoot, "sources.json") : "";
  if (sourcesPath && existsSync(sourcesPath)) {
    try {
      const sources = await readJsonFile(sourcesPath);
      allowlistedSenderDomains = [
        ...new Set(
          cleanList(sources?.gmail_research?.sender_sources, 50)
            .flatMap((source) => cleanList(source?.sender_domains, 20))
            .map((item) => cleanText(item, 200))
            .filter(Boolean)
        ),
      ];
    } catch {
      allowlistedSenderDomains = [];
    }
  }

  return {
    configured: refreshTokenConfigured,
    label,
    readOnly: true,
    allowlistedSenderDomains,
    collection: {
      reportDate: sourceStatusArtifact?.date || reportDate,
      status: cleanText(gmailSource?.status, 80) || "not_run",
      itemCount: Number(gmailSource?.item_count || 0),
      lastCollectedAt:
        cleanText(gmailSource?.checked_at, 80)
        || cleanText(sourceStatusArtifact?.payload?.generated_at, 80),
    },
    candidates,
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

function normalizeEarningsWatch(value = {}) {
  const companies = cleanList(value.companies, 12).map((company) => ({
    ticker: cleanText(company?.ticker, 20),
    companyName: cleanText(company?.company_name, 180),
    upcomingEvent: {
      status: cleanText(company?.upcoming_event?.status, 60) || "not_available",
      eventDate: cleanText(company?.upcoming_event?.event_date, 40),
      confidence: cleanText(company?.upcoming_event?.confidence, 40),
    },
    estimateRevision: {
      status: cleanText(company?.estimate_revision?.status, 80) || "not_available",
      freezeAsOf: cleanText(company?.estimate_revision?.freeze_as_of, 40),
      revisionDirection: cleanText(
        company?.estimate_revision?.revision_direction,
        80,
      ) || "not_available",
      rows: cleanList(company?.estimate_revision?.rows, 4).map((row) => ({
        metricId: cleanText(row?.metric_id, 80),
        periodEnd: cleanText(row?.period_end, 40),
        value: Number.isFinite(Number(row?.value)) ? Number(row.value) : null,
        units: cleanText(row?.units, 60),
        revisionPct30d: Number.isFinite(Number(row?.revision_pct_30d))
          ? Number(row.revision_pct_30d)
          : null,
        analystCount: Number.isFinite(Number(row?.analyst_count))
          ? Number(row.analyst_count)
          : null,
        evidenceLabel: cleanText(row?.evidence_label, 80),
      })),
    },
    valuationScreen: {
      status: cleanText(company?.valuation_screen?.status, 80) || "not_available",
      relativeStatus: cleanText(
        company?.valuation_screen?.relative_valuation_status,
        100,
      ) || "insufficient_usable_peers",
      primaryMetric: cleanText(company?.valuation_screen?.primary_metric, 60),
      targetValue: Number.isFinite(Number(company?.valuation_screen?.target_value))
        ? Number(company.valuation_screen.target_value)
        : null,
      peerMedian: Number.isFinite(Number(company?.valuation_screen?.peer_median))
        ? Number(company.valuation_screen.peer_median)
        : null,
      premiumDiscountPct: Number.isFinite(
        Number(company?.valuation_screen?.premium_discount_pct),
      )
        ? Number(company.valuation_screen.premium_discount_pct)
        : null,
      usablePeerCount: Number(company?.valuation_screen?.usable_peer_count || 0),
      minimumPeerCount: Number(company?.valuation_screen?.minimum_peer_count || 2),
      evidenceLabel: cleanText(company?.valuation_screen?.evidence_label, 80),
      decisionLimit: cleanText(company?.valuation_screen?.decision_limit, 500),
    },
    guidance: cleanList(company?.guidance, 4).map((row) => ({
      metricId: cleanText(row?.metric_id, 80),
      periodEnd: cleanText(row?.period_end, 40),
      midpoint: Number.isFinite(Number(row?.midpoint)) ? Number(row.midpoint) : null,
      units: cleanText(row?.units, 60),
      currency: cleanText(row?.currency, 20),
      evidenceLabel: cleanText(row?.evidence_label, 80),
    })),
    historicalSurprises: cleanList(company?.historical_surprises, 4).map((row) => ({
      reportedDate: cleanText(row?.reported_date, 40),
      surprisePct: Number.isFinite(Number(row?.surprise_pct))
        ? Number(row.surprise_pct)
        : null,
      reactionPct: Number.isFinite(Number(row?.reaction_pct))
        ? Number(row.reaction_pct)
        : null,
    })),
    postResultEstimateRevision: {
      status: cleanText(company?.post_result_estimate_revision?.status, 100),
      modelUpdateApplied: company?.post_result_estimate_revision?.model_update_applied === true,
    },
  }));
  return {
    status: cleanText(value.status, 60) || "not_available",
    summary: {
      companyCount: Number(value.summary?.company_count || companies.length || 0),
      confirmedEventCount: Number(value.summary?.confirmed_event_count || 0),
      estimateRevisionCount: Number(value.summary?.estimate_revision_count || 0),
      guidanceCount: Number(value.summary?.guidance_count || 0),
      verifiedResultCount: Number(value.summary?.verified_result_count || 0),
    },
    companies,
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
    earningsWatch: normalizeEarningsWatch(reader.earnings_watch),
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
      quantitativeEvidence: cleanList(
        intelligence.market?.regime?.quantitative_evidence,
        12,
      ).map((item) => cleanText(item, 400)).filter(Boolean),
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

function buildDecisionGate({
  intelligence,
  scoreboard,
  marketInternals,
}) {
  const blockers = [];
  const addBlocker = (code, message) => {
    if (!blockers.some((item) => item.code === code)) {
      blockers.push({ code, message });
    }
  };
  if (!intelligence) {
    addBlocker("missing_intelligence", "시장 분석 산출물이 없습니다.");
  }
  if (!marketInternals) {
    addBlocker("missing_market_internals", "미국 시장 내부지표 산출물이 없습니다.");
  } else {
    if (marketInternals.status !== "ready") {
      addBlocker(
        "market_internals_not_ready",
        `미국 시장 내부지표 상태가 ${marketInternals.status || "미확인"}입니다.`,
      );
    }
    if (
      marketInternals.coverage.required > 0
      && marketInternals.coverage.available < marketInternals.coverage.required
    ) {
      addBlocker(
        "market_coverage_incomplete",
        `미국 가격·스타일 패널이 ${marketInternals.coverage.available}/${marketInternals.coverage.required}만 확보됐습니다.`,
      );
    }
    if (marketInternals.provider.freshnessStatus !== "current") {
      addBlocker(
        "market_data_stale",
        `시장 가격 신선도 상태가 ${marketInternals.provider.freshnessStatus || "미확인"}입니다.`,
      );
    }
    if (marketInternals.constituentBreadth?.status !== "ready") {
      addBlocker(
        "constituent_breadth_not_ready",
        "S&P 500 구성종목 브레드스가 준비되지 않았습니다.",
      );
    }
    const sectorBreadth = marketInternals.sectorBreadth;
    if (
      sectorBreadth.requiredCount > 0
      && sectorBreadth.readyCount < sectorBreadth.requiredCount
    ) {
      addBlocker(
        "sector_breadth_incomplete",
        `11개 섹터 내부지표가 ${sectorBreadth.readyCount}/${sectorBreadth.requiredCount}만 준비됐습니다.`,
      );
    }
    const internalsBreadthReady = cleanList(
      marketInternals?.sectors?.["5d"],
      20,
    ).length > 0 && marketInternals.coverage.available === marketInternals.coverage.required;
    const conclusionHasBreadth = Boolean(
      scoreboard?.cards?.some((card) => card.id === "breadth"),
    );
    if (internalsBreadthReady && !conclusionHasBreadth) {
      addBlocker(
        "derived_conclusion_outdated",
        "최신 시장 내부지표가 결론 스냅샷에 아직 반영되지 않았습니다.",
      );
    }
  }
  if ((scoreboard?.regime?.quantitativeEvidence || []).length < 2) {
    addBlocker(
      "insufficient_quantitative_evidence",
      "시장 결론을 뒷받침하는 정량 근거가 2개 미만입니다.",
    );
  }
  return {
    status: blockers.length ? "blocked" : "ready",
    labelKo: blockers.length ? "판단 보류" : "투자 판단 준비",
    summary: blockers.length
      ? "신선도·커버리지·근거 조건을 모두 통과할 때까지 방향성 결론을 노출하지 않습니다."
      : "최신 가격·브레드스·섹터 내부지표와 정량 근거가 결론에 반영됐습니다.",
    blockers,
  };
}

function normalizeMarketInternals(payload = {}) {
  const leadership = payload.sector_leadership || {};
  const marketSource = payload.market_source || {};
  const providerConfiguration = marketSource.provider_configuration || {};
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
    provider: {
      name: cleanText(marketSource.provider, 160),
      asOf: cleanText(marketSource.as_of, 40),
      freshnessStatus: cleanText(marketSource.freshness_status, 80),
      alpacaBatchEnabled: providerConfiguration.alpaca_batch_enabled === true,
      alpacaFeed: cleanText(providerConfiguration.alpaca_feed, 40),
      alpacaConfigurationStatus: cleanText(
        providerConfiguration.alpaca_configuration_status,
        80
      ),
    },
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
      dataGaps: cleanList(constituent.data_gaps, 20)
        .map((item) => cleanText(item, 500))
        .filter(Boolean),
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
    materialCandidateCount: Number(payload.material_candidate_count || 0),
    deepAnalysisCount: Number(payload.deep_analysis_count || 0),
    universeCoverage: {
      fullIndexScanReady: payload.universe_coverage?.full_index_scan_ready === true,
      sp500Count: Number(payload.universe_coverage?.membership_counts?.sp500 || 0),
      nasdaq100Count: Number(payload.universe_coverage?.membership_counts?.nasdaq100 || 0),
      membershipSourceCount: Number(
        payload.universe_coverage?.membership_source_count || 0,
      ),
    },
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

const RESEARCH_SECTOR_TO_MARKET_SECTOR = {
  semiconductors_ai_compute: "XLK",
  data_center_networking: "XLK",
  cloud_saas_cybersecurity: "XLK",
  data_center_power_cooling: "XLI",
  grid_electrification: "XLI",
  industrial_automation_robotics: "XLI",
  aerospace_defense: "XLI",
  shipbuilding_marine: "XLI",
  transportation_logistics: "XLI",
  nuclear_generation: "XLU",
  batteries_energy_storage: "XLY",
  electric_vehicles_autonomy: "XLY",
  biotech_healthcare_innovation: "XLV",
  financials_capital_markets: "XLF",
  consumer_internet_platforms: "XLC",
  energy_oil_gas: "XLE",
  metals_critical_materials: "XLB",
  construction_infrastructure: "XLI",
  reits_data_centers: "XLRE",
  renewable_energy_equipment: "XLI",
  media_gaming_entertainment: "XLC",
  consumer_brands_beauty: "XLY",
  technology_hardware_services: "XLK",
  communications_network_equipment: "XLK",
  industrials_machinery: "XLI",
  chemicals_specialty_materials: "XLB",
  consumer_staples_food_beverage: "XLP",
  consumer_discretionary_retail: "XLY",
  travel_leisure: "XLY",
  healthcare_services_medtech: "XLV",
  payments_fintech: "XLF",
  utilities_power: "XLU",
  real_estate_general: "XLRE",
};

const MARKET_SECTOR_LABELS = {
  XLC: "커뮤니케이션",
  XLY: "경기소비재",
  XLP: "필수소비재",
  XLE: "에너지",
  XLF: "금융",
  XLV: "헬스케어",
  XLI: "산업재",
  XLB: "소재",
  XLRE: "부동산",
  XLK: "기술",
  XLU: "유틸리티",
};

const CANDIDATE_REASON_LABELS = {
  abnormal_spy_relative_move: "시장 대비 비정상 상대수익",
  abnormal_sector_relative_move: "섹터 대비 비정상 상대수익",
  volume_anomaly: "거래량 이상",
  material_price_move: "유의미한 가격 변동",
  earnings_event: "실적 사건",
  filing_event: "주요 공시",
  verified_news_event: "검증된 뉴스 사건",
};

function readerEvidence(value) {
  return cleanText(value, 500)
    .replace(/\bAdvance_pct\b/gi, "상승 종목 비율")
    .replace(/\babove_50d_pct\b/gi, "50일선 상회 비율")
    .replace(/\bRSP\s+vs\s+SPY\b/gi, "RSP/SPY")
    .replace(/\bSPY\s+5일\s+수익률\b/gi, "SPY 5일 수익률")
    .replace(/-?\d+\.\d{3,}/g, (number) => Number(number).toFixed(2));
}

function candidateWhyNow(candidate) {
  if (candidate.reasons.length) {
    return candidate.reasons
      .slice(0, 2)
      .map((reason) => CANDIDATE_REASON_LABELS[reason] || reason.replaceAll("_", " "))
      .join(" · ");
  }
  const signals = [];
  if (candidate.reaction.return1d !== null) {
    signals.push(`1일 수익률 ${candidate.reaction.return1d >= 0 ? "+" : ""}${candidate.reaction.return1d.toFixed(2)}%`);
  }
  if (candidate.reaction.spyRelative1d !== null) {
    signals.push(`SPY 대비 ${candidate.reaction.spyRelative1d >= 0 ? "+" : ""}${candidate.reaction.spyRelative1d.toFixed(2)}%p`);
  }
  if (candidate.reaction.volumeRatio20d !== null) {
    signals.push(`20일 평균 대비 거래량 ${candidate.reaction.volumeRatio20d.toFixed(2)}배`);
  }
  return signals.join(" · ") || "가격·공시·뉴스 후보 스크린을 통과했습니다.";
}

function marketSectorTickersForCandidate(candidate) {
  return [...new Set(
    cleanList(candidate?.sectorIds, 20)
      .map((sectorId) => RESEARCH_SECTOR_TO_MARKET_SECTOR[sectorId])
      .filter(Boolean),
  )];
}

function researchReportIsAvailableAsOf(researchReport, reportDate) {
  const publishedDate = cleanText(researchReport?.publishedAt, 40).slice(0, 10);
  if (!publishedDate || !reportDate) return false;
  return publishedDate <= reportDate;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildSectorFundamentalGate({
  sectorTicker,
  report,
  stockCandidates,
  brokerResearch,
}) {
  const candidates = cleanList(stockCandidates?.candidates, 100);
  const candidateByTicker = new Map(
    candidates.filter((item) => item.ticker).map((item) => [item.ticker, item]),
  );
  const tickersInSector = new Set(
    candidates
      .filter((candidate) => marketSectorTickersForCandidate(candidate).includes(sectorTicker))
      .map((candidate) => candidate.ticker),
  );
  const reportDate = cleanText(report?.reportDate, 20);
  const availableResearch = cleanList(brokerResearch?.reports, 50)
    .filter((researchReport) => researchReportIsAvailableAsOf(researchReport, reportDate));
  for (const researchReport of availableResearch) {
    const standardizedTickers = cleanList(researchReport.standardSectors, 20)
      .map((sector) => RESEARCH_SECTOR_TO_MARKET_SECTOR[sector.id])
      .filter(Boolean);
    if (!standardizedTickers.includes(sectorTicker)) continue;
    for (const ticker of cleanList(researchReport.tickers, 20)) {
      if (ticker) tickersInSector.add(ticker);
    }
  }
  const revisions = [];
  let guidanceCount = 0;
  for (const company of cleanList(report?.earningsWatch?.companies, 30)) {
    if (!tickersInSector.has(company.ticker)) continue;
    for (const row of cleanList(company.estimateRevision?.rows, 10)) {
      if (row.revisionPct30d !== null) {
        revisions.push({
          ticker: company.ticker,
          metricId: row.metricId,
          revisionPct30d: row.revisionPct30d,
        });
      }
    }
    guidanceCount += cleanList(company.guidance, 10).length;
  }
  const eligibleResearch = availableResearch.filter((researchReport) => {
      const standardizedTickers = cleanList(researchReport.standardSectors, 20)
        .map((sector) => RESEARCH_SECTOR_TO_MARKET_SECTOR[sector.id])
        .filter(Boolean);
      if (standardizedTickers.includes(sectorTicker)) return true;
      return cleanList(researchReport.tickers, 20).some(
        (ticker) => tickersInSector.has(ticker),
      );
    });
  const valuationComparisons = [];
  const peerValuationComparisons = [];
  let targetPriceCoverage = 0;
  for (const company of cleanList(report?.earningsWatch?.companies, 30)) {
    if (!tickersInSector.has(company.ticker)) continue;
    const screen = company.valuationScreen || {};
    if (
      screen.status !== "screening_available"
      || screen.evidenceLabel !== "derived_screening_calculation"
      || screen.usablePeerCount < screen.minimumPeerCount
      || screen.premiumDiscountPct === null
      || !screen.primaryMetric
    ) {
      continue;
    }
    peerValuationComparisons.push({
      ticker: company.ticker,
      metric: screen.primaryMetric,
      targetValue: screen.targetValue,
      peerMedian: screen.peerMedian,
      premiumDiscountPct: screen.premiumDiscountPct,
      usablePeerCount: screen.usablePeerCount,
    });
  }
  for (const researchReport of eligibleResearch) {
    const target = researchReport.targetPrice || {};
    if (!(target.value > 0)) continue;
    targetPriceCoverage += 1;
    const comparableTicker = cleanList(researchReport.tickers, 20).find((ticker) => {
      const close = candidateByTicker.get(ticker)?.reaction?.close;
      return tickersInSector.has(ticker) && close > 0;
    });
    if (!comparableTicker) continue;
    const currentClose = candidateByTicker.get(comparableTicker).reaction.close;
    if (target.currency !== "USD") continue;
    valuationComparisons.push({
      ticker: comparableTicker,
      upsidePct: ((target.value / currentClose) - 1) * 100,
    });
  }
  const positiveRevisionCount = revisions.filter((item) => item.revisionPct30d > 0).length;
  const negativeRevisionCount = revisions.filter((item) => item.revisionPct30d < 0).length;
  const estimateStatus = revisions.length
    ? positiveRevisionCount > negativeRevisionCount
      ? "positive"
      : negativeRevisionCount > positiveRevisionCount
        ? "negative"
        : "mixed"
    : "unavailable";
  const valuationStatus = valuationComparisons.length || peerValuationComparisons.length
    ? "comparable"
    : targetPriceCoverage
      ? "coverage_only"
      : "unavailable";
  const gateStatus = estimateStatus === "negative"
    ? "caution"
    : estimateStatus === "positive" && valuationStatus !== "unavailable"
      ? "supported"
      : revisions.length || guidanceCount || eligibleResearch.length
        ? "watch"
        : "price_only";
  const gateLabels = {
    supported: "펀더멘털 확인",
    caution: "추정치 하향 경계",
    watch: "추가 확인 필요",
    price_only: "가격 신호만",
  };
  const medianRevisionPct30d = median(revisions.map((item) => item.revisionPct30d));
  const medianTargetUpsidePct = median(
    valuationComparisons.map((item) => item.upsidePct),
  );
  const medianPeerPremiumDiscountPct = median(
    peerValuationComparisons.map((item) => item.premiumDiscountPct),
  );
  return {
    status: gateStatus,
    label: gateLabels[gateStatus],
    estimateStatus,
    estimateLabel: revisions.length
      ? `30일 추정치 ${positiveRevisionCount}건 상향 · ${negativeRevisionCount}건 하향`
      : "비교 가능한 30일 추정치 변화 없음",
    revisionCount: revisions.length,
    medianRevisionPct30d,
    guidanceCount,
    valuationStatus,
    valuationLabel: valuationComparisons.length
      ? `비교 가능 ${valuationComparisons.length}건 · 목표가격 중앙 상승여력 ${medianTargetUpsidePct >= 0 ? "+" : ""}${medianTargetUpsidePct.toFixed(1)}%`
      : peerValuationComparisons.length
        ? `비교기업 ${peerValuationComparisons.length}건 · ${peerValuationComparisons[0].metric} 중앙 괴리 ${medianPeerPremiumDiscountPct >= 0 ? "+" : ""}${medianPeerPremiumDiscountPct.toFixed(1)}%`
      : targetPriceCoverage
        ? `목표가격 ${targetPriceCoverage}건 · 동일 통화 현재가 비교 대기`
        : "비교 가능한 밸류에이션 근거 없음",
    targetPriceCoverage,
    comparableValuationCount:
      valuationComparisons.length + peerValuationComparisons.length,
    peerValuationComparisons,
    medianTargetUpsidePct,
    researchReportCount: eligibleResearch.length,
    evidenceTickers: [...tickersInSector].slice(0, 6),
    asOf: reportDate,
    limitation: "목표가격은 증권사 의견이며, 현재가·통화·발행일이 일치할 때만 비교했습니다.",
  };
}

export function buildMarketSectorStockChain({
  report,
  decisionGate,
  scoreboard,
  marketInternals,
  stockCandidates,
  brokerResearch,
}) {
  if (!marketInternals) return null;
  const fiveDaySectors = cleanList(marketInternals.sectors?.["5d"], 20)
    .filter((item) => item.ticker && item.returnPct !== null)
    .sort((first, second) => second.returnPct - first.returnPct);
  const breadthByTicker = new Map(
    cleanList(marketInternals.sectorBreadth?.sectors, 20)
      .map((item) => [item.ticker, item]),
  );
  const fiveDaySectorReturnByTicker = new Map(
    fiveDaySectors.map((item) => [item.ticker, finiteNumber(item.returnPct)]),
  );
  const sectorPathway = (item, stance) => {
    const breadth = breadthByTicker.get(item.ticker);
    const versusMarket = item.vsSpyPctPoint;
    const direction = stance === "beneficiary" ? "상대강세" : "상대약세";
    const evidence = [
      `5일 ${item.returnPct >= 0 ? "+" : ""}${item.returnPct.toFixed(2)}%`,
      versusMarket === null
        ? ""
        : `SPY 대비 ${versusMarket >= 0 ? "+" : ""}${versusMarket.toFixed(2)}%p`,
      breadth?.advancePct === null || breadth?.advancePct === undefined
        ? ""
        : `상승 종목 ${breadth.advancePct.toFixed(1)}%`,
    ].filter(Boolean);
    return {
      ticker: item.ticker,
      label: MARKET_SECTOR_LABELS[item.ticker] || item.sector || item.ticker,
      stance,
      stanceLabel: stance === "beneficiary" ? "수혜 경로" : "부담 경로",
      reason: `${direction}가 관측됐습니다. 가격 리더십이 실제 업종 펀더멘털로 이어지는지 확인해야 합니다.`,
      evidence,
      return5d: item.returnPct,
      vsSpy5d: versusMarket,
      advancePct: breadth?.advancePct ?? null,
      above50dPct: breadth?.above50dPct ?? null,
      fundamentalGate: buildSectorFundamentalGate({
        sectorTicker: item.ticker,
        report,
        stockCandidates,
        brokerResearch,
      }),
    };
  };
  const leaders = fiveDaySectors.slice(0, 2).map((item) => sectorPathway(item, "beneficiary"));
  const leaderTickers = new Set(leaders.map((item) => item.ticker));
  const laggards = [...fiveDaySectors]
    .reverse()
    .filter((item) => !leaderTickers.has(item.ticker))
    .slice(0, 2)
    .map((item) => sectorPathway(item, "pressure"));
  const blocked = decisionGate?.status !== "ready";
  const sectorGateCache = new Map(
    [...leaders, ...laggards].map((sector) => [sector.ticker, sector.fundamentalGate]),
  );
  const gateForSector = (sectorTicker) => {
    if (!sectorTicker) return null;
    if (!sectorGateCache.has(sectorTicker)) {
      sectorGateCache.set(
        sectorTicker,
        buildSectorFundamentalGate({
          sectorTicker,
          report,
          stockCandidates,
          brokerResearch,
        }),
      );
    }
    return sectorGateCache.get(sectorTicker);
  };
  const earningsCompanyByTicker = new Map(
    cleanList(report?.earningsWatch?.companies, 30)
      .filter((company) => company.ticker)
      .map((company) => [company.ticker, company]),
  );
  const allCandidates = cleanList(stockCandidates?.candidates, 30)
    .slice()
    .sort((first, second) => second.score - first.score)
    .map((candidate) => {
      const linkedSectorTicker = candidate.sectorIds
        .map((sectorId) => RESEARCH_SECTOR_TO_MARKET_SECTOR[sectorId])
        .find(Boolean) || "";
      const fundamentalGate = gateForSector(linkedSectorTicker);
      const earningsCompany = earningsCompanyByTicker.get(candidate.ticker) || {};
      const primaryEvidenceCount = candidate.evidence.filter(
        (item) => item.primaryConfirmed,
      ).length;
      const verifiedFactCount = candidate.evidence.reduce(
        (sum, item) => sum + item.factCount,
        0,
      );
      const exposureVerified = Boolean(linkedSectorTicker);
      const sectorReturn5d = fiveDaySectorReturnByTicker.get(linkedSectorTicker) ?? null;
      const stockReturn5d = finiteNumber(candidate.reaction?.return5d);
      const stockVsSector5d = stockReturn5d !== null && sectorReturn5d !== null
        ? stockReturn5d - sectorReturn5d
        : null;
      const explicitRejection = /rejected|invalidated|false_positive|not_eligible/i
        .test(candidate.evidenceStatus);
      const fundamentalCaution = fundamentalGate?.status === "caution";
      const rejected = explicitRejection
        || (fundamentalCaution && primaryEvidenceCount === 0);
      const priority = rejected
        ? "REJECTED"
        : !blocked
          && candidate.deepAnalysisEligible
          && primaryEvidenceCount > 0
          && exposureVerified
          && fundamentalGate?.status === "supported"
          ? "A"
          : (primaryEvidenceCount > 0 || candidate.deepAnalysisEligible)
            && exposureVerified
            && !fundamentalCaution
            ? "B"
            : "C";
      const missingRequirements = [
        primaryEvidenceCount ? "" : "공식 촉매",
        exposureVerified ? "" : "표준 섹터 노출",
        candidate.deepAnalysisEligible ? "" : "심층분석 자격",
        fundamentalGate?.status === "supported" ? "" : "추정치·밸류에이션 확인",
      ].filter(Boolean);
      const rejectionReason = explicitRejection
        ? "입력 데이터에서 무효화 또는 분석 제외 상태로 판정됐습니다."
        : fundamentalCaution && primaryEvidenceCount === 0
          ? "추정치 하향 경계 상태이며 이를 상쇄할 공식 기업 근거가 없습니다."
          : "";
      return {
        ticker: candidate.ticker,
        companyName: candidate.companyName,
        score: candidate.score,
        deepAnalysisEligible: candidate.deepAnalysisEligible,
        researchPriority: priority,
        linkedSectorTicker,
        linkedSectorLabel: linkedSectorTicker
          ? MARKET_SECTOR_LABELS[linkedSectorTicker] || linkedSectorTicker
          : "연결 섹터 확인 필요",
        whyNow: candidateWhyNow(candidate),
        reaction: candidate.reaction || {},
        stockReturn5d,
        sectorReturn5d,
        stockVsSector5d,
        exposureState: exposureVerified ? "linked" : "needs_exposure_attribution",
        exposureLabel: exposureVerified ? "섹터 노출 연결" : "노출 근거 확인 필요",
        fundamentalGateStatus: fundamentalGate?.status || "not_available",
        fundamentalGateLabel: fundamentalGate?.label || "펀더멘털 연결 대기",
        estimateRevision: earningsCompany.estimateRevision || {
          status: "not_available",
          freezeAsOf: "",
          revisionDirection: "not_available",
          rows: [],
        },
        valuationScreen: earningsCompany.valuationScreen || {
          status: "not_available",
          relativeStatus: "insufficient_usable_peers",
          primaryMetric: "",
          targetValue: null,
          peerMedian: null,
          premiumDiscountPct: null,
          usablePeerCount: 0,
          minimumPeerCount: 2,
          evidenceLabel: "",
          decisionLimit: "",
        },
        primaryEvidenceCount,
        verifiedFactCount,
        evidenceSummary: primaryEvidenceCount
          ? `공식 근거 ${primaryEvidenceCount}건 · 확인 사실 ${verifiedFactCount}개`
          : "공식 원문 근거 확인 대기",
        firstRejection: exposureVerified
          ? "해당 섹터 상대강도가 꺾이거나 기업 고유의 공식 촉매가 확인되지 않으면 우선순위를 낮춥니다."
          : "표준 섹터 노출과 기업 고유 촉매가 확인되기 전에는 방향성 아이디어로 승격하지 않습니다.",
        missingRequirements,
        promotionCondition: priority === "A"
          ? "핵심 가정과 밸류에이션 민감도를 검증한 뒤 투자 논제로 전환"
          : missingRequirements.length
            ? `${missingRequirements.slice(0, 2).join("·")} 확보 시 상위 단계 재평가`
            : "공식 반증 여부를 재검토",
        rejectionReason,
        nextWorkflow: priority === "A"
          ? "실적·가이던스·밸류에이션 심층검토"
          : priority === "REJECTED"
            ? "신규 공식 근거 발생 전 보관"
            : "공식자료와 섹터 노출 확인",
      };
    });
  const funnelOrder = { A: 0, B: 1, C: 2, REJECTED: 3 };
  const funnelCandidates = allCandidates
    .slice()
    .sort(
      (first, second) =>
        funnelOrder[first.researchPriority] - funnelOrder[second.researchPriority]
        || second.score - first.score,
    );
  const candidates = funnelCandidates
    .filter((candidate) => candidate.researchPriority !== "REJECTED")
    .slice(0, 3);
  const rejectedCandidates = funnelCandidates
    .filter((candidate) => candidate.researchPriority === "REJECTED")
    .slice(0, 5);
  const priorityCounts = funnelCandidates.reduce(
    (counts, candidate) => {
      counts[candidate.researchPriority] += 1;
      return counts;
    },
    { A: 0, B: 0, C: 0, REJECTED: 0 },
  );
  const quantitativeEvidence = cleanList(scoreboard?.regime?.quantitativeEvidence, 8);
  const bottomSector = laggards[0];
  return {
    status: blocked ? "blocked" : candidates.length && fiveDaySectors.length ? "ready" : "partial",
    regime: {
      label: blocked ? "판단 보류" : scoreboard?.regime?.summary || report?.executiveSummary?.[0] || "시장 체제 확인 필요",
      primaryDriver: blocked
        ? decisionGate?.summary || "데이터 근거 게이트를 통과하지 못했습니다."
        : scoreboard?.regime?.summary || report?.executiveSummary?.[0] || "가격·브레드스 기반 시장 체제를 확인합니다.",
      evidence: blocked
        ? cleanList(decisionGate?.blockers, 4).map((item) => item.message)
        : quantitativeEvidence.slice(0, 4).map(readerEvidence),
      counterEvidence: bottomSector
        ? [`${bottomSector.label} 5일 ${bottomSector.return5d >= 0 ? "+" : ""}${bottomSector.return5d.toFixed(2)}%로 리더십 확산을 제약합니다.`]
        : [],
      invalidationCondition: "시장 폭과 현재 리더 섹터의 5일 상대강도가 함께 반전되면 이 연결 가설을 재검토합니다.",
    },
    sectors: blocked ? [] : [...leaders, ...laggards],
    ideaFunnel: {
      inputCount: Number(stockCandidates?.materialCandidateCount || funnelCandidates.length),
      classifiedCount: funnelCandidates.length,
      deepAnalysisEligibleCount: allCandidates.filter(
        (candidate) => candidate.deepAnalysisEligible,
      ).length,
      priorityCounts,
      stages: [
        {
          id: "A",
          label: "A · 심층검토",
          count: priorityCounts.A,
          rule: "공식 촉매·섹터 노출·추정치와 밸류에이션 근거를 모두 확인",
        },
        {
          id: "B",
          label: "B · 근거보강",
          count: priorityCounts.B,
          rule: "공식 근거나 심층분석 자격은 있으나 펀더멘털 연결이 일부 부족",
        },
        {
          id: "C",
          label: "C · 관찰",
          count: priorityCounts.C,
          rule: "가격·거래량 이상 신호 중심으로 공식 촉매와 섹터 노출 확인 대기",
        },
        {
          id: "REJECTED",
          label: "제외",
          count: priorityCounts.REJECTED,
          rule: "명시적 무효화 또는 추정치 하향을 상쇄할 공식 근거 부재",
        },
      ],
      candidatePool: funnelCandidates.slice(0, 30),
      rejectedCandidates,
    },
    candidates,
    disclaimer: "종목 표시는 연구 우선순위이며 매수·매도 추천이 아닙니다.",
  };
}

function cleanTicker(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker) ? ticker : "";
}

function portfolioWeightRows(weights) {
  if (Array.isArray(weights)) return weights;
  if (weights && typeof weights === "object") {
    return Object.entries(weights).map(([ticker, weight]) => ({ ticker, weight }));
  }
  return [];
}

export function extractPortfolioUniverse({
  transactionSettings = {},
  portfolioCanvasSnapshot = {},
} = {}) {
  const byTicker = new Map();
  const add = (rawTicker, role, label, weight = null, source = "") => {
    const ticker = cleanTicker(rawTicker);
    if (!ticker) return;
    const current = byTicker.get(ticker) || {
      ticker,
      roles: [],
      labels: [],
      weights: [],
      quickWeights: [],
      sources: [],
    };
    if (!current.roles.includes(role)) current.roles.push(role);
    const cleanLabel = cleanText(label, 100);
    if (cleanLabel && !current.labels.includes(cleanLabel)) current.labels.push(cleanLabel);
    const numericWeight = finiteNumber(weight);
    if (numericWeight !== null) current.weights.push(numericWeight);
    const cleanSource = cleanText(source, 80);
    if (cleanSource && !current.sources.includes(cleanSource)) current.sources.push(cleanSource);
    if (cleanSource === "quick_portfolio" && numericWeight !== null) {
      current.quickWeights.push(numericWeight);
    }
    byTicker.set(ticker, current);
  };

  for (const group of cleanList(transactionSettings?.watchlistGroups, 100)) {
    const label = cleanText(group?.name, 100) || "관심종목";
    for (const ticker of cleanList(group?.symbols, 500)) {
      add(ticker, "watchlist", label, null, "transaction_watchlist");
    }
    for (const instrument of cleanList(group?.instruments, 500)) {
      add(instrument?.symbol || instrument?.ticker, "watchlist", label, null, "transaction_watchlist");
    }
  }

  for (const holding of cleanList(transactionSettings?.portfolioHoldings, 500)) {
    add(
      holding?.ticker || holding?.symbol,
      "portfolio",
      holding?.label || "Daily Intelligence 간편 보유",
      holding?.weight,
      "quick_portfolio",
    );
  }

  const canvases = cleanList(portfolioCanvasSnapshot?.store?.canvases, 50);
  for (const canvas of canvases) {
    const canvasName = cleanText(canvas?.name, 100) || "포트폴리오";
    for (const strategy of cleanList(canvas?.workspace?.strategyPortfolios, 30)) {
      const strategyName = cleanText(strategy?.name, 100);
      const label = strategyName ? `${canvasName} · ${strategyName}` : canvasName;
      for (const row of portfolioWeightRows(strategy?.weights).slice(0, 300)) {
        add(
          row?.ticker || row?.symbol || row?.asset || row?.name,
          "portfolio",
          label,
          row?.weight ?? row?.targetWeight ?? row?.allocation,
          "portfolio_canvas",
        );
      }
    }
  }

  return [...byTicker.values()]
    .map((item) => ({
      ...item,
      weights: [...new Set(item.weights)],
      quickWeights: [...new Set(item.quickWeights)],
      sources: [...new Set(item.sources)],
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function eventTickers(item = {}) {
  const tickers = new Set();
  const ambiguousTokens = new Set([
    "AI", "US", "USA", "USD", "ETF", "SEC", "CPI", "PPI", "FOMC", "CEO", "EPS", "GDP",
  ]);
  const add = (value) => {
    const ticker = cleanTicker(
      value && typeof value === "object"
        ? value.ticker || value.symbol || value.code
        : value,
    );
    if (ticker && !ambiguousTokens.has(ticker)) tickers.add(ticker);
  };
  cleanList(item.listed_entities, 100).forEach(add);
  cleanList(item.tickers, 100).forEach(add);
  cleanList(item.attributed_research, 50)
    .flatMap((research) => cleanList(research?.tickers, 100))
    .forEach(add);
  const searchable = [
    item.title,
    item.summary,
    ...cleanList(item.common_facts, 20).map((fact) => fact?.claim || fact),
  ].join(" ");
  for (const match of searchable.matchAll(/(?:^|[^A-Z0-9])\$?([A-Z]{1,5}(?:[.-][A-Z0-9]{1,3})?)(?=$|[^A-Z0-9])/g)) {
    add(match[1]);
  }
  return [...tickers];
}

function portfolioEvent(item = {}) {
  const verification = item.verification || {};
  const impact = item.impact_analysis || {};
  const primaryVerified =
    verification.primary_fact_confirmed === true
    || verification.publication_eligible_as_fact === true;
  return {
    eventId: cleanText(item.event_id, 120),
    title: cleanText(item.title || item.summary, 240),
    eventType: cleanText(item.event_type, 80) || "other",
    evidenceState: primaryVerified ? "primary_verified" : "unverified",
    impact: cleanText(
      impact.summary || impact.interpretation || item.interpretation,
      600,
    ),
    confirmationCondition: cleanText(
      impact.confirmation_condition || item.confirmation_condition,
      500,
    ),
    invalidationCondition: cleanText(
      impact.invalidation_condition || item.invalidation_condition,
      500,
    ),
  };
}

function buildRiskThesisReviewProposals({
  reviews = [],
  thesisMemory = {},
} = {}) {
  const recordById = new Map(
    cleanList(thesisMemory?.records, 500)
      .map((record) => [cleanText(record?.continuityId, 120), record])
      .filter(([id]) => id),
  );
  const latestByRiskId = new Map();
  for (const review of cleanList(reviews, 500)) {
    if (review?.thesisProposalStatus !== "pending" || !review?.riskId) continue;
    const previous = latestByRiskId.get(review.riskId);
    if (
      !previous
      || String(review.reportDate || "") > String(previous.reportDate || "")
      || (
        review.reportDate === previous.reportDate
        && String(review.updatedAt || "") > String(previous.updatedAt || "")
      )
    ) {
      latestByRiskId.set(review.riskId, review);
    }
  }
  return [...latestByRiskId.values()]
    .map((review) => {
      const targets = cleanList(review.thesisContinuityIds, 8)
        .map((continuityId) => recordById.get(continuityId))
        .filter(Boolean)
        .map((record) => ({
          continuityId: record.continuityId,
          kind: record.kind,
          entityId: record.entityId,
          title: record.title,
          state: record.state,
          stateLabel: record.stateLabel,
        }));
      return {
        proposalId: `${review.reportDate}:${review.riskId}`,
        reportDate: review.reportDate,
        riskId: review.riskId,
        title: review.title || review.riskId,
        relation: review.thesisImpact || "neutral",
        summary: review.followUpEvidenceNote || review.note || "",
        evidenceUrl: review.followUpEvidenceUrl || "",
        targets,
        createdAt: review.updatedAt || "",
      };
    })
    .filter((proposal) => proposal.targets.length)
    .sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
      || a.riskId.localeCompare(b.riskId),
    );
}

export function buildRiskThesisReviewActivity({
  reviews = [],
  thesisMemory = {},
  stockCandidates = {},
  marketInternals = {},
  reportDate = "",
  limit = 12,
} = {}) {
  const recordById = new Map(
    cleanList(thesisMemory?.records, 500)
      .map((record) => [cleanText(record?.continuityId, 120), record])
      .filter(([id]) => id),
  );
  return cleanList(reviews, 500)
    .filter((review) =>
      ["approved", "rejected"].includes(review?.thesisProposalStatus)
      && review?.riskId
      && review?.thesisProposalReviewedAt
    )
    .sort((a, b) =>
      String(b.thesisProposalReviewedAt).localeCompare(String(a.thesisProposalReviewedAt)),
    )
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 12)))
    .map((review) => {
      const currentObservation = portfolioResponseObservation(review.riskId, {
        stockCandidates,
        marketInternals,
      });
      return {
        activityId: `${review.reportDate}:${review.riskId}:${review.thesisProposalStatus}`,
        reportDate: review.reportDate,
        riskId: review.riskId,
        title: review.title || review.riskId,
        relation: review.thesisImpact || "neutral",
        decision: review.thesisProposalStatus,
        summary: review.followUpEvidenceNote || review.note || "",
        evidenceUrl: review.followUpEvidenceUrl || "",
        reviewedAt: review.thesisProposalReviewedAt,
        portfolioResponseAction: review.portfolioResponseAction || "",
        portfolioResponseNote: review.portfolioResponseNote || "",
        portfolioResponseReviewDate: review.portfolioResponseReviewDate || "",
        portfolioResponseRecordedAt: review.portfolioResponseRecordedAt || "",
        portfolioResponseRuleIds: cleanList(review.portfolioResponseRuleIds, 10),
        portfolioResponseRuleAcknowledgedAt:
          review.portfolioResponseRuleAcknowledgedAt || "",
        portfolioResponseEvaluation: evaluatePortfolioResponse({
          action: review.portfolioResponseAction,
          metricId: review.portfolioResponseMetricId,
          metricLabel: review.portfolioResponseMetricLabel,
          metricTicker: review.portfolioResponseMetricTicker,
          baselineValue: review.portfolioResponseBaselineValue,
          baselineDate: review.portfolioResponseBaselineDate,
          currentObservation,
          currentReportDate: reportDate,
        }),
        targets: cleanList(review.thesisContinuityIds, 8).map((continuityId) => {
        const record = recordById.get(continuityId);
        return {
          continuityId,
          entityId: record?.entityId || continuityId.replace(/^pb-(?:stock|sector)-/, "").toUpperCase(),
          state: record?.state || "",
          stateLabel: record?.stateLabel || "",
        };
      }),
      };
    });
}

export function buildPortfolioResponseCalibration(activity = [], {
  minimumDecisiveSample = 10,
  minimumRuleReviewSample = 3,
  minimumRuleChallengeCount = 2,
  minimumRuleChallengeRatePct = 50,
} = {}) {
  const rows = cleanList(activity, 500)
    .filter((item) => item?.portfolioResponseAction)
    .map((item) => ({
      activityId: item.activityId,
      reportDate: item.reportDate,
      riskId: item.riskId,
      title: item.title,
      action: item.portfolioResponseAction,
      evaluation: item.portfolioResponseEvaluation,
    }));
  const counts = {
    supported: 0,
    challenged: 0,
    inconclusive: 0,
    observed: 0,
    pending: 0,
    unavailable: 0,
  };
  const actionMap = new Map();
  for (const row of rows) {
    const status = counts[row.evaluation?.status] === undefined
      ? "unavailable"
      : row.evaluation.status;
    counts[status] += 1;
    const action = actionMap.get(row.action) || {
      action: row.action,
      total: 0,
      supported: 0,
      challenged: 0,
      inconclusive: 0,
      observed: 0,
      pending: 0,
      unavailable: 0,
    };
    action.total += 1;
    action[status] += 1;
    actionMap.set(row.action, action);
  }
  const decisiveCount = counts.supported + counts.challenged;
  const minimumSample = Math.max(1, Number(minimumDecisiveSample) || 10);
  const successRateVisible = decisiveCount >= minimumSample;
  const successRatePct = decisiveCount
    ? Number(((counts.supported / decisiveCount) * 100).toFixed(1))
    : 0;
  const ruleReviewSample = Math.max(1, Number(minimumRuleReviewSample) || 3);
  const ruleChallengeCount = Math.max(1, Number(minimumRuleChallengeCount) || 2);
  const ruleChallengeRatePct = Math.max(
    1,
    Math.min(100, Number(minimumRuleChallengeRatePct) || 50),
  );
  const ruleProposalByAction = {
    maintain: "유지 판단 전에 상대강도와 핵심 가설 무효화 조건을 함께 확인하도록 기준을 보강합니다.",
    increase_monitoring: "관찰 강화의 종료일과 실제 대응으로 전환할 객관적 조건을 함께 기록하도록 기준을 보강합니다.",
    reduce_review: "비중 축소 검토 전에 가격 추세와 공식 펀더멘털 악화를 모두 확인하도록 기준을 보강합니다.",
    exit_review: "매도 검토 전에 핵심 가설 무효화와 섹터 대비 상대약세가 동시에 확인되는지 점검하도록 기준을 보강합니다.",
  };
  const ruleSuggestions = [...actionMap.values()]
    .map((action) => {
      const actionDecisiveCount = action.supported + action.challenged;
      const challengeRatePct = actionDecisiveCount
        ? Number(((action.challenged / actionDecisiveCount) * 100).toFixed(1))
        : 0;
      return {
        suggestionId: `portfolio-response-rule:${action.action}`,
        action: action.action,
        decisiveCount: actionDecisiveCount,
        challengedCount: action.challenged,
        challengeRatePct,
        proposal: ruleProposalByAction[action.action] || "",
        status: "pending_approval",
        autoApply: false,
        evidence: rows
          .filter((row) =>
            row.action === action.action
            && row.evaluation?.status === "challenged"
          )
          .slice(0, 3)
          .map((row) => ({
            activityId: row.activityId,
            reportDate: row.reportDate,
            title: row.title,
            summary: row.evaluation?.summary || "",
          })),
      };
    })
    .filter((suggestion) =>
      suggestion.proposal
      && suggestion.decisiveCount >= ruleReviewSample
      && suggestion.challengedCount >= ruleChallengeCount
      && suggestion.challengeRatePct >= ruleChallengeRatePct
    )
    .sort((a, b) =>
      b.challengeRatePct - a.challengeRatePct
      || b.challengedCount - a.challengedCount
      || a.action.localeCompare(b.action),
    );
  return {
    totalCount: rows.length,
    decisiveCount,
    minimumDecisiveSample: minimumSample,
    successRateVisible,
    successRatePct,
    counts,
    byAction: [...actionMap.values()].sort((a, b) =>
      b.total - a.total || a.action.localeCompare(b.action),
    ),
    challenged: rows
      .filter((row) => row.evaluation?.status === "challenged")
      .slice(0, 5)
      .map((row) => ({
        activityId: row.activityId,
        reportDate: row.reportDate,
        riskId: row.riskId,
        title: row.title,
        action: row.action,
        summary: row.evaluation.summary,
      })),
    ruleSuggestions,
    warning: successRateVisible
      ? ""
      : `결정 가능한 대응 판단 ${decisiveCount}건으로 성공률을 공개하지 않습니다. 최소 ${minimumSample}건이 필요합니다.`,
  };
}

export function portfolioResponseObservation(riskId = "", {
  stockCandidates = {},
  marketInternals = {},
} = {}) {
  const parts = cleanText(riskId, 160).split(":").filter(Boolean);
  const stockTicker = parts[0] === "stock"
    ? cleanTicker(parts[1])
    : parts[0] === "conflict"
      ? cleanTicker(parts[1])
      : "";
  if (stockTicker) {
    const candidate = cleanList(stockCandidates?.candidates, 500)
      .find((item) => cleanTicker(item?.ticker) === stockTicker);
    const rawClose = candidate?.reaction?.close;
    const close = rawClose === null || rawClose === undefined || rawClose === ""
      ? null
      : finiteNumber(rawClose);
    if (close !== null) {
      return {
        metricId: "stock_close",
        metricLabel: "종목 종가",
        ticker: stockTicker,
        value: close,
      };
    }
  }
  const sectorTicker = parts[0] === "sector"
    ? cleanTicker(parts[1])
    : parts[0] === "conflict"
      ? cleanTicker(parts[2])
      : "";
  if (sectorTicker) {
    const sector = cleanList(marketInternals?.sectors?.["5d"], 50)
      .find((item) => cleanTicker(item?.ticker) === sectorTicker);
    const rawRelativeReturn = sector?.vsSpyPctPoint;
    const relativeReturn =
      rawRelativeReturn === null
      || rawRelativeReturn === undefined
      || rawRelativeReturn === ""
        ? null
        : finiteNumber(rawRelativeReturn);
    if (relativeReturn !== null) {
      return {
        metricId: "sector_vs_spy_5d_pct_point",
        metricLabel: "섹터의 SPY 대비 5일 상대수익률",
        ticker: sectorTicker,
        value: relativeReturn,
      };
    }
  }
  return null;
}

export function evaluatePortfolioResponse({
  action = "",
  metricId = "",
  metricLabel = "",
  metricTicker = "",
  baselineValue = null,
  baselineDate = "",
  currentObservation = null,
  currentReportDate = "",
} = {}) {
  if (!action) return null;
  const baseline = baselineValue === null || baselineValue === undefined || baselineValue === ""
    ? null
    : finiteNumber(baselineValue);
  if (!metricId || baseline === null || !baselineDate) {
    return {
      status: "unavailable",
      label: "기준값 없음",
      summary: "판단 당시 비교 가능한 시장 기준값이 없어 성과를 계산하지 않습니다.",
    };
  }
  if (!currentObservation || currentObservation.metricId !== metricId) {
    return {
      status: "unavailable",
      label: "현재값 없음",
      summary: "현재 동일 지표가 수집되지 않아 다음 리포트에서 다시 평가합니다.",
    };
  }
  if (!currentReportDate || currentReportDate <= baselineDate) {
    return {
      status: "pending",
      label: "평가 전",
      summary: "판단 다음 거래일 데이터가 쌓인 뒤 평가합니다.",
    };
  }
  const current = currentObservation.value === null
    || currentObservation.value === undefined
    || currentObservation.value === ""
    ? null
    : finiteNumber(currentObservation.value);
  if (current === null) return null;
  const change = metricId === "stock_close" && baseline !== 0
    ? ((current / baseline) - 1) * 100
    : current - baseline;
  const unit = metricId === "stock_close" ? "%" : "%p";
  const threshold = metricId === "stock_close" ? 1 : 0.5;
  const movement = change > threshold
    ? "favorable"
    : change < -threshold
      ? "adverse"
      : "flat";
  const scored = ["maintain", "reduce_review", "exit_review"].includes(action);
  const supported = action === "maintain"
    ? movement === "favorable"
    : ["reduce_review", "exit_review"].includes(action)
      ? movement === "adverse"
      : false;
  const challenged = action === "maintain"
    ? movement === "adverse"
    : ["reduce_review", "exit_review"].includes(action)
      ? movement === "favorable"
      : false;
  const status = !scored
    ? "observed"
    : supported
      ? "supported"
      : challenged
        ? "challenged"
        : "inconclusive";
  const labels = {
    observed: "변화 관측",
    supported: "판단 부합",
    challenged: "판단과 반대",
    inconclusive: "변화 미미",
  };
  return {
    status,
    label: labels[status],
    ticker: currentObservation.ticker || metricTicker,
    metricLabel: currentObservation.metricLabel || metricLabel,
    baseline,
    current,
    change: Number(change.toFixed(4)),
    unit,
    baselineDate,
    currentReportDate,
    summary: `${currentObservation.ticker || metricTicker} ${metricLabel || currentObservation.metricLabel}: `
      + `${baseline.toFixed(2)} → ${current.toFixed(2)} (${change >= 0 ? "+" : ""}${change.toFixed(2)}${unit})`,
  };
}

export function buildPortfolioImpact({
  universe = [],
  intelligence = {},
  report = {},
  stockCandidates = null,
  candidatePool = [],
  sectorPaths = [],
} = {}) {
  const events = cleanList(intelligence?.events?.items, 200);
  const candidates = cleanList(candidatePool, 200).length
    ? cleanList(candidatePool, 200)
    : cleanList(stockCandidates?.candidates, 200);
  const earnings = cleanList(report?.earningsWatch?.companies, 100);
  const rows = universe.map((asset) => {
    const ticker = cleanTicker(asset?.ticker);
    const relatedEvents = events
      .filter((event) => eventTickers(event).includes(ticker))
      .slice(0, 5)
      .map(portfolioEvent);
    const candidate = candidates.find((item) => cleanTicker(item?.ticker) === ticker) || null;
    const earningsItem = earnings.find((item) => cleanTicker(item?.ticker) === ticker) || null;
    const verifiedEventCount = relatedEvents.filter(
      (event) => event.evidenceState === "primary_verified",
    ).length;
    const evidenceState = verifiedEventCount
      ? "primary_verified"
      : relatedEvents.length
        ? "unverified"
        : candidate?.deepAnalysisEligible || earningsItem
          ? "quantitative_only"
          : "no_direct_evidence";
    const attentionLevel = verifiedEventCount || candidate?.deepAnalysisEligible
      ? "high"
      : relatedEvents.length || earningsItem
        ? "monitor"
        : "none";
    return {
      ticker,
      roles: cleanList(asset?.roles, 5),
      labels: cleanList(asset?.labels, 10),
      weights: cleanList(asset?.weights, 20).map(finiteNumber).filter((value) => value !== null),
      quickWeights: cleanList(asset?.quickWeights, 5).map(finiteNumber).filter((value) => value !== null),
      sources: cleanList(asset?.sources, 10),
      attentionLevel,
      evidenceState,
      relatedEvents,
      candidate,
      earnings: earningsItem,
    };
  });
  const matched = rows.filter((item) => item.attentionLevel !== "none");
  const attentionRank = { high: 0, monitor: 1, none: 2 };
  const orderedAssets = [...rows].sort(
    (a, b) =>
      (attentionRank[a.attentionLevel] ?? 3) - (attentionRank[b.attentionLevel] ?? 3)
      || a.ticker.localeCompare(b.ticker),
  );
  const quickAssets = rows.filter((item) => item.sources?.includes("quick_portfolio"));
  const sectorPathByTicker = new Map(
    cleanList(sectorPaths, 50)
      .map((sector) => [cleanTicker(sector?.ticker), sector])
      .filter(([ticker]) => ticker),
  );
  const sectorWeights = new Map();
  const unmapped = [];
  for (const asset of quickAssets) {
    const weight = asset.quickWeights?.[0] || 0;
    const sectorTicker = cleanTicker(asset.candidate?.linkedSectorTicker);
    if (!sectorTicker) {
      unmapped.push({ ticker: asset.ticker, weight });
      continue;
    }
    const current = sectorWeights.get(sectorTicker) || {
      ticker: sectorTicker,
      label: cleanText(asset.candidate?.linkedSectorLabel, 100) || sectorTicker,
      weight: 0,
      tickers: [],
    };
    current.weight = Math.round((current.weight + weight) * 100) / 100;
    if (!current.tickers.includes(asset.ticker)) current.tickers.push(asset.ticker);
    sectorWeights.set(sectorTicker, current);
  }
  const stockConcentration = quickAssets
    .filter((asset) => (asset.quickWeights?.[0] || 0) >= 25)
    .map((asset) => ({
      ticker: asset.ticker,
      weight: asset.quickWeights[0],
      severity: asset.quickWeights[0] >= 40 ? "high" : "monitor",
    }))
    .sort((a, b) => b.weight - a.weight);
  const sectorConcentration = [...sectorWeights.values()]
    .filter((sector) => sector.weight >= 40)
    .map((sector) => ({
      ...sector,
      severity: sector.weight >= 60 ? "high" : "monitor",
    }))
    .sort((a, b) => b.weight - a.weight);
  const thesisConflicts = quickAssets
    .map((asset) => {
      const sectorTicker = cleanTicker(asset.candidate?.linkedSectorTicker);
      const sectorPath = sectorPathByTicker.get(sectorTicker);
      if (!sectorPath || sectorPath.stance !== "pressure") return null;
      return {
        ticker: asset.ticker,
        weight: asset.quickWeights?.[0] || 0,
        sectorTicker,
        sectorLabel: cleanText(sectorPath.label, 100) || sectorTicker,
        reason: cleanText(sectorPath.reason, 300) || "현재 시장 분석에서 부담 경로로 분류된 섹터입니다.",
        confirmationCondition: "섹터의 SPY 대비 5일 상대성과와 내부 브레드스가 함께 반등하는지 확인합니다.",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight);
  return {
    configured: rows.length > 0,
    portfolioCount: rows.filter((item) => item.roles.includes("portfolio")).length,
    watchlistCount: rows.filter((item) => item.roles.includes("watchlist")).length,
    quickPortfolioWeight: Math.round(
      rows
        .filter((item) => item.sources?.includes("quick_portfolio"))
        .reduce((sum, item) => sum + (item.quickWeights?.[0] || 0), 0) * 100,
    ) / 100,
    matchedCount: matched.length,
    unmatchedCount: rows.length - matched.length,
    riskReview: {
      stockConcentration,
      sectorConcentration,
      thesisConflicts,
      unmapped,
      actionChecklist: buildPortfolioRiskActions({
        stockConcentration,
        sectorConcentration,
        thesisConflicts,
        unmapped,
      }),
      hasWarnings: Boolean(
        stockConcentration.length
        || sectorConcentration.length
        || thesisConflicts.length
        || unmapped.length
      ),
      rules: {
        stockMonitorPct: 25,
        stockHighPct: 40,
        sectorMonitorPct: 40,
        sectorHighPct: 60,
      },
    },
    marketContext: {
      status: cleanText(report?.decisionGateStatus, 40) || "informational",
      summary: cleanList(report?.executiveSummary, 3).map((item) => cleanText(item, 500)),
    },
    assets: orderedAssets,
  };
}

export function linkThesisAlertsToPortfolio({
  alerts = [],
  portfolioImpact = {},
  candidatePool = [],
} = {}) {
  const assets = cleanList(portfolioImpact?.assets, 500);
  const assetByTicker = new Map(
    assets
      .map((asset) => [cleanTicker(asset?.ticker), asset])
      .filter(([ticker]) => ticker),
  );
  const candidates = cleanList(candidatePool, 500);
  const linkedTickersBySector = new Map();
  for (const candidate of candidates) {
    const ticker = cleanTicker(candidate?.ticker);
    const sectorTicker = cleanTicker(candidate?.linkedSectorTicker);
    if (!ticker || !sectorTicker || !assetByTicker.has(ticker)) continue;
    const linked = linkedTickersBySector.get(sectorTicker) || [];
    if (!linked.includes(ticker)) linked.push(ticker);
    linkedTickersBySector.set(sectorTicker, linked);
  }
  const enriched = cleanList(alerts, 50).map((alert) => {
    const entityId = cleanTicker(alert?.entityId);
    const affectedByTicker = new Map();
    const addAffected = (ticker, relationship) => {
      const asset = assetByTicker.get(ticker);
      if (!asset) return;
      const current = affectedByTicker.get(ticker);
      if (current?.relationship === "direct") return;
      affectedByTicker.set(ticker, {
        ticker,
        roles: cleanList(asset?.roles, 5),
        labels: cleanList(asset?.labels, 10),
        weights: cleanList(asset?.weights, 20)
          .map(finiteNumber)
          .filter((value) => value !== null),
        relationship,
        relationshipLabel: relationship === "direct"
          ? "종목 가설 직접 연결"
          : `${entityId} 섹터 경유`,
      });
    };
    if (alert?.kind === "stock") addAffected(entityId, "direct");
    if (alert?.kind === "sector") {
      for (const ticker of linkedTickersBySector.get(entityId) || []) {
        addAffected(ticker, "sector");
      }
    }
    const affectedAssets = [...affectedByTicker.values()].sort((first, second) => {
      const firstPortfolio = first.roles.includes("portfolio") ? 0 : 1;
      const secondPortfolio = second.roles.includes("portfolio") ? 0 : 1;
      return firstPortfolio - secondPortfolio || first.ticker.localeCompare(second.ticker);
    });
    const holdingCount = affectedAssets.filter((asset) =>
      asset.roles.includes("portfolio")).length;
    const watchlistCount = affectedAssets.filter((asset) =>
      asset.roles.includes("watchlist")).length;
    const directCount = affectedAssets.filter((asset) =>
      asset.relationship === "direct").length;
    const maximumWeight = Math.max(
      0,
      ...affectedAssets.flatMap((asset) => asset.weights),
    );
    const priorityScore =
      (alert?.status === "miss" ? 40 : 15)
      + holdingCount * 30
      + watchlistCount * 12
      + directCount * 18
      + Math.min(10, Math.max(0, maximumWeight) / 10);
    const priorityLevel =
      alert?.status === "miss" && holdingCount && directCount
        ? "critical"
        : alert?.status === "miss" && affectedAssets.length
          ? "high"
          : holdingCount
            ? "high"
            : affectedAssets.length
              ? "medium"
              : "normal";
    return {
      ...alert,
      affectedAssets,
      portfolioMatchCount: affectedAssets.length,
      holdingCount,
      watchlistCount,
      directCount,
      maximumWeight: maximumWeight || null,
      priorityScore: Number(priorityScore.toFixed(2)),
      priorityLevel,
      portfolioSummary: affectedAssets.length
        ? `보유 ${holdingCount} · 관심 ${watchlistCount} · ${affectedAssets.map((asset) => asset.ticker).join(", ")}`
        : "보유·관심종목 직접 연결 없음",
    };
  });
  const priorityRank = { critical: 0, high: 1, medium: 2, normal: 3 };
  return enriched.sort((first, second) =>
    Number(priorityRank[first.priorityLevel] ?? 9)
      - Number(priorityRank[second.priorityLevel] ?? 9)
    || second.priorityScore - first.priorityScore
    || first.entityId.localeCompare(second.entityId));
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
    if (report.researchScope && report.researchScope !== "sector") continue;
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
        mappingRoleCounts: { primary: 0, secondary: 0, unmapped: 0 },
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
      const mappingRole = ["primary", "secondary"].includes(sector.mappingRole)
        ? sector.mappingRole
        : sector.id
          ? "primary"
          : "unmapped";
      bucket.mappingRoleCounts[mappingRole] += 1;
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
        mappingRoleCounts: bucket.mappingRoleCounts,
        attributionRole:
          bucket.mappingRoleCounts.primary && bucket.mappingRoleCounts.secondary
            ? "mixed"
            : bucket.mappingRoleCounts.primary
              ? "primary"
              : bucket.mappingRoleCounts.secondary
                ? "secondary"
                : "unmapped",
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

export function buildBrokerSectorImpactProfiles({
  coverage = [],
  marketInternals = null,
  stockCandidates = null,
} = {}) {
  const marketByTicker = new Map(
    cleanList(marketInternals?.sectors?.["5d"], 30)
      .filter((item) => item.ticker)
      .map((item) => [item.ticker, item]),
  );
  const oneDayMarketByTicker = new Map(
    cleanList(marketInternals?.sectors?.["1d"], 30)
      .filter((item) => item.ticker)
      .map((item) => [item.ticker, item]),
  );
  const candidates = cleanList(stockCandidates?.candidates, 100);
  const candidateByTicker = new Map(
    candidates.filter((item) => item.ticker).map((item) => [item.ticker, item]),
  );
  const directionFor = (value, threshold) => (
    value >= threshold ? 1 : value <= -threshold ? -1 : 0
  );
  const directionLabels = {
    beneficiary: "우호 신호",
    pressure: "부담 신호",
    mixed: "상충 신호",
    neutral: "방향 미확인",
  };

  return cleanList(coverage, 50).map((item) => {
    const marketTicker = RESEARCH_SECTOR_TO_MARKET_SECTOR[item.sectorId] || "";
    const market = marketByTicker.get(marketTicker) || null;
    const oneDayMarket = oneDayMarketByTicker.get(marketTicker) || null;
    const vsSpy5d = finiteNumber(market?.vsSpyPctPoint);
    const marketDirection = vsSpy5d === null ? 0 : directionFor(vsSpy5d, 0.75);
    const stanceCounts = item.stanceCounts || {};
    const ratedCount = ["positive", "neutral", "cautious", "negative"]
      .reduce((sum, stance) => sum + Number(stanceCounts[stance] || 0), 0);
    const researchBalance = ratedCount
      ? (
        Number(stanceCounts.positive || 0)
        - Number(stanceCounts.negative || 0)
        - (Number(stanceCounts.cautious || 0) * 0.5)
      ) / ratedCount
      : null;
    const researchDirection = researchBalance === null
      ? 0
      : directionFor(researchBalance, 0.25);
    const direction = marketDirection && researchDirection && marketDirection !== researchDirection
      ? "mixed"
      : (marketDirection || researchDirection) > 0
        ? "beneficiary"
        : (marketDirection || researchDirection) < 0
          ? "pressure"
          : "neutral";
    const independentEvidenceCount = Number(Boolean(market)) + Number(ratedCount > 0);
    const aligned = marketDirection !== 0
      && researchDirection !== 0
      && marketDirection === researchDirection;
    const magnitude = Math.abs(vsSpy5d || 0);
    const strength = direction === "mixed" || direction === "neutral"
      ? "unconfirmed"
      : aligned && magnitude >= 2 && item.publisherOpinion?.ratedPublisherCount >= 2
        ? "strong"
        : independentEvidenceCount >= 2
          ? "moderate"
          : "weak";
    const evidenceState = direction === "mixed"
      ? "conflicting"
      : aligned
        ? "cross_confirmed"
        : market
          ? ratedCount
            ? "partial_alignment"
            : "price_only"
          : ratedCount
            ? "research_only"
            : "insufficient";

    const directTickers = cleanList(item.topTickers, 12).map((ticker) => {
      const candidate = candidateByTicker.get(ticker.ticker) || {};
      return {
        ticker: ticker.ticker,
        companyName: candidate.companyName || "",
        exposureType: "direct",
        exposureLabel: "리포트 직접 언급",
        reportCount: Number(ticker.reportCount || 0),
        candidateScore: finiteNumber(candidate.score),
      };
    });
    const directTickerSet = new Set(directTickers.map((ticker) => ticker.ticker));
    const indirectTickers = candidates
      .filter(
        (candidate) =>
          item.sectorId
          && !directTickerSet.has(candidate.ticker)
          && cleanList(candidate.sectorIds, 20).includes(item.sectorId),
      )
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .slice(0, 5)
      .map((candidate) => ({
        ticker: candidate.ticker,
        companyName: candidate.companyName || "",
        exposureType: "indirect",
        exposureLabel: "후보 스캐너 섹터 연결",
        reportCount: 0,
        candidateScore: finiteNumber(candidate.score),
      }));
    const attributionRole = item.attributionRole || "unmapped";
    return {
      ...item,
      impactProfile: {
        direction,
        directionLabel: directionLabels[direction],
        strength,
        evidenceState,
        independentEvidenceCount,
        marketTicker,
        marketLabel: marketTicker
          ? MARKET_SECTOR_LABELS[marketTicker] || marketTicker
          : "",
        return5d: finiteNumber(market?.returnPct),
        vsSpy5d,
        return1d: finiteNumber(oneDayMarket?.returnPct),
        vsSpy1d: finiteNumber(oneDayMarket?.vsSpyPctPoint),
        researchBalance:
          researchBalance === null ? null : Number(researchBalance.toFixed(3)),
        ratedOpinionCount: ratedCount,
        attributionRole,
        attributionLabel:
          attributionRole === "primary"
            ? "주 섹터 직접 분류"
            : attributionRole === "secondary"
              ? "보조 테마 간접 분류"
              : attributionRole === "mixed"
                ? "주·보조 분류 혼재"
                : "분류 대기",
        directTickers,
        indirectTickers,
        limitation:
          "수혜·부담은 5일 상대성과와 명시적 리서치 의견의 정렬 상태입니다. 인과관계나 매수·매도 판단을 뜻하지 않습니다.",
      },
    };
  });
}

export function buildBrokerSectorImpactChanges({
  currentCoverage = [],
  previousCoverage = [],
  currentDate = "",
  previousDate = "",
} = {}) {
  const previousBySector = new Map(
    cleanList(previousCoverage, 50)
      .filter((item) => item.sectorId)
      .map((item) => [item.sectorId, item]),
  );
  const strengthRank = { unconfirmed: 0, weak: 1, moderate: 2, strong: 3 };
  const alerts = [];
  const coverage = cleanList(currentCoverage, 50).map((item) => {
    const current = item.impactProfile || null;
    const previousItem = previousBySector.get(item.sectorId) || null;
    const previous = previousItem?.impactProfile || null;
    if (!current || !previous) {
      return {
        ...item,
        impactProfile: current
          ? {
            ...current,
            change: {
              status: "baseline_unavailable",
              previousDate: previousDate || "",
              directionChanged: false,
              strengthDelta: null,
            },
          }
          : current,
      };
    }

    const directionChanged = current.direction !== previous.direction;
    const strengthDelta = Number(strengthRank[current.strength] || 0)
      - Number(strengthRank[previous.strength] || 0);
    let alertType = "";
    let severity = "info";
    let title = "";
    if (current.evidenceState === "conflicting" && previous.evidenceState !== "conflicting") {
      alertType = "new_divergence";
      severity = "warning";
      title = "가격·리서치 괴리 발생";
    } else if (directionChanged && current.direction === "beneficiary") {
      alertType = "beneficiary_turn";
      severity = previous.direction === "pressure" ? "high" : "medium";
      title = "우호 신호 전환";
    } else if (directionChanged && current.direction === "pressure") {
      alertType = "pressure_turn";
      severity = previous.direction === "beneficiary" ? "high" : "medium";
      title = "부담 신호 전환";
    } else if (directionChanged && current.direction === "mixed") {
      alertType = "mixed_turn";
      severity = "warning";
      title = "상충 신호 전환";
    } else if (directionChanged && current.direction === "neutral") {
      alertType = "signal_neutralized";
      severity = "info";
      title = "방향 신호 소멸";
    } else if (strengthDelta > 0 && current.direction !== "neutral") {
      alertType = "strength_up";
      severity = strengthDelta >= 2 ? "medium" : "info";
      title = "신호 강도 상승";
    } else if (strengthDelta < 0 && previous.direction !== "neutral") {
      alertType = "strength_down";
      severity = "info";
      title = "신호 강도 하락";
    }
    const change = {
      status: alertType ? "changed" : "unchanged",
      previousDate,
      previousDirection: previous.direction,
      previousStrength: previous.strength,
      directionChanged,
      strengthDelta,
      alertType,
    };
    if (alertType) {
      alerts.push({
        sectorId: item.sectorId,
        sector: item.sector,
        alertType,
        severity,
        title,
        currentDate,
        previousDate,
        previousDirection: previous.direction,
        currentDirection: current.direction,
        previousStrength: previous.strength,
        currentStrength: current.strength,
        marketTicker: current.marketTicker,
        previousVsSpy5d: previous.vsSpy5d,
        currentVsSpy5d: current.vsSpy5d,
        evidenceState: current.evidenceState,
      });
    }
    return {
      ...item,
      impactProfile: {
        ...current,
        change,
      },
    };
  });
  const severityRank = { high: 0, warning: 1, medium: 2, info: 3 };
  alerts.sort(
    (left, right) =>
      Number(severityRank[left.severity] ?? 9) - Number(severityRank[right.severity] ?? 9)
      || left.sector.localeCompare(right.sector),
  );
  return {
    coverage,
    alerts: alerts.slice(0, 8),
    baseline: {
      available: Boolean(previousDate && previousCoverage.length),
      currentDate,
      previousDate,
      comparableSectorCount: coverage.filter(
        (item) => item.impactProfile?.change?.status !== "baseline_unavailable",
      ).length,
    },
  };
}

export function buildBrokerSectorSignalPersistence({
  history = [],
  minimumPublicSample = 10,
} = {}) {
  const points = cleanList(history, 20)
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(String(point?.date || "")))
    .slice()
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const latestPoint = points.at(-1) || { date: "", coverage: [] };
  const daysBetween = (left, right) => {
    const leftTime = Date.parse(`${left}T00:00:00Z`);
    const rightTime = Date.parse(`${right}T00:00:00Z`);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
    return Math.round((rightTime - leftTime) / 86_400_000);
  };
  const allOutcomes = [];
  const coverage = cleanList(latestPoint.coverage, 50).map((latestSector) => {
    const observations = points
      .map((point) => ({
        date: point.date,
        sector: cleanList(point.coverage, 50)
          .find((item) => item.sectorId === latestSector.sectorId) || null,
      }))
      .filter((point) => point.sector?.impactProfile);
    const latestImpact = latestSector.impactProfile || null;
    let streakCount = 0;
    let streakStartDate = "";
    if (latestImpact && latestImpact.direction !== "neutral") {
      for (let index = observations.length - 1; index >= 0; index -= 1) {
        const observation = observations[index];
        if (observation.sector.impactProfile.direction !== latestImpact.direction) break;
        streakCount += 1;
        streakStartDate = observation.date;
      }
    }
    const outcomes = [];
    for (let index = 0; index < observations.length - 1; index += 1) {
      const signalObservation = observations[index];
      const responseObservation = observations[index + 1];
      const gapDays = daysBetween(signalObservation.date, responseObservation.date);
      const signal = signalObservation.sector.impactProfile;
      const response = responseObservation.sector.impactProfile;
      if (
        !["beneficiary", "pressure"].includes(signal.direction)
        || gapDays === null
        || gapDays < 1
        || gapDays > 4
        || response.vsSpy1d === null
      ) {
        continue;
      }
      const signedReaction = signal.direction === "beneficiary"
        ? response.vsSpy1d
        : -response.vsSpy1d;
      const status = signedReaction >= 0.25
        ? "hit"
        : signedReaction <= -0.25
          ? "miss"
          : "inconclusive";
      const outcome = {
        sectorId: latestSector.sectorId,
        sector: latestSector.sector,
        signalDate: signalObservation.date,
        responseDate: responseObservation.date,
        gapDays,
        signalDirection: signal.direction,
        responseVsSpy1d: response.vsSpy1d,
        signedReaction: Number(signedReaction.toFixed(4)),
        status,
      };
      outcomes.push(outcome);
      allOutcomes.push(outcome);
    }
    const hitCount = outcomes.filter((item) => item.status === "hit").length;
    const missCount = outcomes.filter((item) => item.status === "miss").length;
    const inconclusiveCount = outcomes.filter((item) => item.status === "inconclusive").length;
    const decisiveCount = hitCount + missCount;
    const persistence = {
      observationCount: observations.length,
      streakCount,
      streakStartDate,
      state: latestImpact?.direction === "neutral"
        ? "inactive"
        : streakCount >= 3
          ? "persistent"
          : streakCount >= 1
            ? "emerging"
            : "insufficient",
      evaluatedCount: outcomes.length,
      decisiveCount,
      hitCount,
      missCount,
      inconclusiveCount,
      hitRatePct: decisiveCount >= minimumPublicSample
        ? Number(((hitCount / decisiveCount) * 100).toFixed(1))
        : null,
      sampleState: decisiveCount >= minimumPublicSample
        ? "publishable"
        : "insufficient_sample",
      minimumPublicSample,
      recentOutcome: outcomes.at(-1) || null,
      limitation:
        "다음 비교일의 1일 섹터 ETF 상대성과만 평가합니다. 날짜 간격이 4일을 넘으면 결과 표본에서 제외합니다.",
    };
    return {
      ...latestSector,
      impactProfile: latestImpact
        ? {
          ...latestImpact,
          persistence,
        }
        : latestImpact,
    };
  });
  const hitCount = allOutcomes.filter((item) => item.status === "hit").length;
  const missCount = allOutcomes.filter((item) => item.status === "miss").length;
  const inconclusiveCount = allOutcomes.filter((item) => item.status === "inconclusive").length;
  const decisiveCount = hitCount + missCount;
  return {
    coverage,
    summary: {
      historyPointCount: points.length,
      evaluatedCount: allOutcomes.length,
      decisiveCount,
      hitCount,
      missCount,
      inconclusiveCount,
      hitRatePct: decisiveCount >= minimumPublicSample
        ? Number(((hitCount / decisiveCount) * 100).toFixed(1))
        : null,
      sampleState: decisiveCount >= minimumPublicSample
        ? "publishable"
        : "insufficient_sample",
      minimumPublicSample,
    },
  };
}

export function buildSectorWatchlistRanking(coverage = []) {
  const strengthRank = { unconfirmed: 0, weak: 1, moderate: 2, strong: 3 };
  const evidenceRank = {
    insufficient: 0,
    research_only: 1,
    price_only: 1,
    partial_alignment: 2,
    conflicting: 2,
    cross_confirmed: 3,
  };
  const items = cleanList(coverage, 50)
    .filter((item) => item.sectorId && item.impactProfile)
    .map((item) => {
      const impact = item.impactProfile;
      const persistence = impact.persistence || {};
      const relatedTickers = [
        ...cleanList(impact.directTickers, 8),
        ...cleanList(impact.indirectTickers, 8),
      ].filter(
        (ticker, index, rows) =>
          ticker.ticker
          && rows.findIndex((candidate) => candidate.ticker === ticker.ticker) === index,
      ).slice(0, 5);
      const gates = {
        beneficiaryDirection: impact.direction === "beneficiary",
        persistentThree: Number(persistence.streakCount || 0) >= 3,
        crossConfirmed: impact.evidenceState === "cross_confirmed",
        positiveFollowThrough:
          Number(persistence.hitCount || 0) >= 1
          && persistence.recentOutcome?.status !== "miss",
        exposureLinked: relatedTickers.length > 0,
      };
      const promoted = Object.values(gates).every(Boolean);
      const status = promoted
        ? "promoted"
        : impact.direction === "beneficiary" && gates.exposureLinked
          ? "watch"
          : ["pressure", "mixed"].includes(impact.direction)
            ? "caution"
            : "not_ready";
      const missingRequirements = [
        gates.beneficiaryDirection ? "" : "우호 방향",
        gates.persistentThree ? "" : "3회 지속",
        gates.crossConfirmed ? "" : "가격·리서치 교차확인",
        gates.positiveFollowThrough ? "" : "후속 반응 적중",
        gates.exposureLinked ? "" : "관련 종목 연결",
      ].filter(Boolean);
      return {
        sectorId: item.sectorId,
        sector: item.sector,
        status,
        direction: impact.direction,
        directionLabel: impact.directionLabel,
        strength: impact.strength,
        evidenceState: impact.evidenceState,
        streakCount: Number(persistence.streakCount || 0),
        recentOutcome: persistence.recentOutcome || null,
        hitCount: Number(persistence.hitCount || 0),
        missCount: Number(persistence.missCount || 0),
        marketTicker: impact.marketTicker,
        vsSpy5d: impact.vsSpy5d,
        relatedTickers,
        gates,
        missingRequirements,
        rationale: promoted
          ? "지속성·교차근거·후속 반응·종목 연결을 모두 통과했습니다."
          : status === "watch"
            ? `우호 방향과 종목 연결은 확인됐지만 ${missingRequirements.slice(0, 2).join("·")} 보강이 필요합니다.`
            : status === "caution"
              ? "부담 또는 상충 신호가 관측돼 신규 아이디어 승격보다 위험 확인이 우선입니다."
              : "활성 방향이나 종목 연결 근거가 부족해 순위에서 제외합니다.",
        sortStrength: Number(strengthRank[impact.strength] || 0),
        sortEvidence: Number(evidenceRank[impact.evidenceState] || 0),
      };
    });
  items.sort(
    (left, right) =>
      right.sortStrength - left.sortStrength
      || right.sortEvidence - left.sortEvidence
      || right.streakCount - left.streakCount
      || (right.hitCount - right.missCount) - (left.hitCount - left.missCount)
      || left.sector.localeCompare(right.sector),
  );
  const publicItem = (item, rank) => {
    const { sortStrength, sortEvidence, ...visible } = item;
    return { ...visible, rank };
  };
  const groups = {};
  for (const status of ["promoted", "watch", "caution"]) {
    groups[status] = items
      .filter((item) => item.status === status)
      .map((item, index) => publicItem(item, index + 1));
  }
  return {
    ...groups,
    notReadyCount: items.filter((item) => item.status === "not_ready").length,
    summary: {
      promotedCount: groups.promoted.length,
      watchCount: groups.watch.length,
      cautionCount: groups.caution.length,
      notReadyCount: items.filter((item) => item.status === "not_ready").length,
      promotionRule:
        "우호 방향 + 3회 지속 + 가격·리서치 교차확인 + 후속 반응 적중 + 관련 종목 연결",
    },
  };
}

export function buildSectorStockShortlists({
  sectorWatchlist = null,
  candidatePool = [],
} = {}) {
  const poolByTicker = new Map(
    cleanList(candidatePool, 50)
      .filter((candidate) => candidate.ticker)
      .map((candidate) => [candidate.ticker, candidate]),
  );
  const sectorRows = [
    ...cleanList(sectorWatchlist?.promoted, 20),
    ...cleanList(sectorWatchlist?.watch, 20),
  ];
  const statusOrder = { qualified: 0, research: 1, hold: 2, excluded: 3 };
  const priorityOrder = { A: 0, B: 1, C: 2, REJECTED: 3 };
  const sectors = sectorRows.map((sector) => {
    const candidates = cleanList(sector.relatedTickers, 10).map((exposure) => {
      const candidate = poolByTicker.get(exposure.ticker) || {};
      const revisionDirection = cleanText(
        candidate.estimateRevision?.revisionDirection,
        80,
      );
      const estimateAvailable = candidate.estimateRevision?.status
        && candidate.estimateRevision.status !== "not_available"
        && cleanList(candidate.estimateRevision?.rows, 20).length > 0;
      const negativeRevision = /negative|down|cut|lower/i.test(revisionDirection);
      const valuation = candidate.valuationScreen || {};
      const valuationComparable = valuation.status === "screening_available"
        && Number(valuation.usablePeerCount || 0) >= Number(valuation.minimumPeerCount || 2);
      const gates = {
        promotedSector: sector.status === "promoted",
        exposureLinked: candidate.exposureState === "linked",
        officialCatalyst: Number(candidate.primaryEvidenceCount || 0) > 0,
        estimateSupport: Boolean(estimateAvailable && !negativeRevision),
        valuationComparable,
      };
      const explicitlyRejected = candidate.researchPriority === "REJECTED"
        || Boolean(candidate.rejectionReason)
        || negativeRevision;
      const status = explicitlyRejected
        ? "excluded"
        : Object.values(gates).every(Boolean)
          ? "qualified"
          : gates.exposureLinked
            && gates.officialCatalyst
            && (gates.estimateSupport || gates.valuationComparable)
            ? "research"
            : "hold";
      const missingRequirements = [
        gates.promotedSector ? "" : "섹터 승격",
        gates.exposureLinked ? "" : "표준 섹터 노출",
        gates.officialCatalyst ? "" : "공식 촉매",
        gates.estimateSupport ? "" : "추정치 지지",
        gates.valuationComparable ? "" : "비교 가능한 밸류에이션",
      ].filter(Boolean);
      const evidenceBasis = [
        gates.promotedSector ? `${sector.sector} 승격 섹터` : `${sector.sector} 관찰 섹터`,
        gates.exposureLinked
          ? `${candidate.linkedSectorLabel || sector.sector} 노출 연결`
          : "표준 섹터 노출 미확인",
        gates.officialCatalyst
          ? `공식 근거 ${Number(candidate.primaryEvidenceCount || 0)}건`
          : "공식 촉매 미확인",
        gates.estimateSupport
          ? `추정치 ${revisionDirection || "지지"}`
          : "비교 가능한 추정치 지지 없음",
        gates.valuationComparable
          ? `비교기업 ${Number(valuation.usablePeerCount || 0)}개`
          : "밸류에이션 비교 표본 부족",
      ];
      const researchProfile = {
        readiness: status === "qualified"
          ? "research_ready"
          : status === "research"
            ? "evidence_gap"
            : status === "excluded"
              ? "rejected"
              : "gate_blocked",
        readinessLabel: status === "qualified"
          ? "심층분석 준비"
          : status === "research"
            ? "근거 보강 필요"
            : status === "excluded"
              ? "분석 제외"
              : "분석 대기",
        researchQuestion:
          `${sector.sector} 경로가 ${exposure.ticker}의 실적 추정치와 밸류에이션으로 이어지는지 검증`,
        whyNow: candidate.whyNow || "섹터 연결 후보로 탐지됐으나 기업 고유 촉매는 추가 확인이 필요합니다.",
        evidenceBasis,
        confirmationCondition: candidate.promotionCondition
          || "공식 촉매와 비교 가능한 추정치·밸류에이션 근거가 확보되면 재평가합니다.",
        invalidationCondition: candidate.firstRejection
          || "섹터 상대강도가 반전되거나 기업 고유 근거가 확인되지 않으면 우선순위를 낮춥니다.",
        evidenceBoundary: status === "qualified"
          ? "공식 촉매·추정치·비교 밸류에이션을 통과했지만 적정가치나 매매 결론은 별도 검증 대상입니다."
          : `현재 ${missingRequirements.join("·") || "추가"} 근거가 부족해 투자 결론으로 승격하지 않습니다.`,
      };
      return {
        ticker: exposure.ticker,
        companyName: candidate.companyName || exposure.companyName || "",
        exposureType: exposure.exposureType || "indirect",
        exposureLabel: exposure.exposureLabel || "",
        status,
        researchPriority: candidate.researchPriority || "C",
        candidateScore: finiteNumber(candidate.score ?? exposure.candidateScore),
        gates,
        missingRequirements,
        primaryEvidenceCount: Number(candidate.primaryEvidenceCount || 0),
        verifiedFactCount: Number(candidate.verifiedFactCount || 0),
        estimateRevision: candidate.estimateRevision || {
          status: "not_available",
          revisionDirection: "not_available",
          rows: [],
        },
        valuationScreen: valuation,
        fundamentalGateStatus: candidate.fundamentalGateStatus || "not_available",
        evidenceSummary: candidate.evidenceSummary || "후보 스캐너 연결만 확인",
        whyNow: candidate.whyNow || "",
        linkedSectorTicker: candidate.linkedSectorTicker || sector.marketTicker || "",
        linkedSectorLabel: candidate.linkedSectorLabel || sector.sector,
        score: finiteNumber(candidate.score),
        deepAnalysisEligible: Boolean(candidate.deepAnalysisEligible),
        firstRejection: candidate.firstRejection || "",
        promotionCondition: candidate.promotionCondition || "",
        reaction: candidate.reaction || {},
        stockReturn5d: finiteNumber(candidate.stockReturn5d),
        sectorReturn5d: finiteNumber(candidate.sectorReturn5d),
        stockVsSector5d: finiteNumber(candidate.stockVsSector5d),
        researchProfile,
        nextAction: status === "qualified"
          ? "실적 가정·밸류에이션 민감도 심층검토"
          : status === "research"
            ? `${missingRequirements.slice(0, 2).join("·")} 보강`
            : status === "excluded"
              ? candidate.rejectionReason || "추정치 하향 또는 명시적 제외 근거 재검토"
              : `${missingRequirements.slice(0, 2).join("·")} 확보 전 관찰`,
      };
    }).sort(
      (left, right) =>
        Number(statusOrder[left.status] ?? 9) - Number(statusOrder[right.status] ?? 9)
        || Number(priorityOrder[left.researchPriority] ?? 9)
          - Number(priorityOrder[right.researchPriority] ?? 9)
        || Number(right.candidateScore || 0) - Number(left.candidateScore || 0),
    );
    return {
      sectorId: sector.sectorId,
      sector: sector.sector,
      sectorStatus: sector.status,
      marketTicker: sector.marketTicker,
      candidates,
      counts: candidates.reduce(
        (counts, candidate) => {
          counts[candidate.status] += 1;
          return counts;
        },
        { qualified: 0, research: 0, hold: 0, excluded: 0 },
      ),
    };
  });
  const totals = sectors.reduce(
    (counts, sector) => {
      for (const [status, count] of Object.entries(sector.counts)) {
        counts[status] += Number(count || 0);
      }
      return counts;
    },
    { qualified: 0, research: 0, hold: 0, excluded: 0 },
  );
  return {
    sectors,
    totals,
    candidateCount: Object.values(totals).reduce((sum, count) => sum + count, 0),
    qualificationRule:
      "승격 섹터 + 표준 노출 + 공식 촉매 + 추정치 지지 + 비교 가능한 밸류에이션",
    disclaimer: "쇼트리스트는 리서치 우선순위이며 매수·매도 추천이 아닙니다.",
  };
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
  const compactResearchLabel = (value) => cleanText(value, 120)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/g, "");
  const documentScopeFor = (sectors, reportType) => {
    const labels = new Set(sectors.map(compactResearchLabel));
    if (
      labels.has("데일리")
      || labels.has("아침시장")
      || labels.has("모닝브리프")
      || labels.has("모닝레터")
      || labels.has("daily")
      || labels.has("dailybrief")
      || labels.has("dailyresearch")
    ) {
      return "daily_digest";
    }
    if (
      labels.has("전체리서치")
      || labels.has("전체")
      || labels.has("종합")
      || labels.has("allresearch")
      || labels.has("multisector")
    ) {
      return "multi_sector_digest";
    }
    if (
      labels.has("market")
      || labels.has("strategy")
      || labels.has("지수")
      || labels.has("etf")
      || labels.has("포트폴리오")
      || labels.has("종목추천")
      || /macro|strategy|market/i.test(reportType)
    ) {
      return "market_strategy";
    }
    if (
      labels.has("채권")
      || labels.has("크레딧")
      || labels.has("cds")
      || labels.has("유가,cds")
      || labels.has("대체투자")
    ) {
      return "asset_class";
    }
    return "sector";
  };
  const isDocumentScopeLabel = (value) => {
    const label = compactResearchLabel(value);
    return new Set([
      "데일리",
      "아침시장",
      "모닝브리프",
      "모닝레터",
      "daily",
      "dailybrief",
      "dailyresearch",
      "전체리서치",
      "전체",
      "종합",
      "allresearch",
      "multisector",
      "market",
      "strategy",
      "지수",
      "etf",
      "포트폴리오",
      "종목추천",
      "채권",
      "크레딧",
      "cds",
      "유가,cds",
      "대체투자",
    ]).has(label);
  };
  const normalizedReports = cleanList(payload.reports, 20).map((item) => {
    const source = item?.source || {};
    const rating = item?.rating || item?.research?.rating || {};
    const targetPrice = item?.target_price || item?.research?.target_price || {};
    const sectors = cleanList(item?.sectors, 8).map((value) => cleanText(value, 120));
    const reportType = cleanText(item?.report_type, 80);
    const researchScope = documentScopeFor(sectors, reportType);
    const standardSectorMap = new Map();
    for (const sector of sectors) {
      if (isDocumentScopeLabel(sector)) continue;
      const classified = classifyResearchSector(sector);
      const mappedSectors = classified.matched
        ? [
          {
            id: classified.id,
            name: classified.name,
            nameEn: classified.nameEn || "",
            kind: classified.kind || "theme",
            mappingRole: "primary",
          },
          ...(classified.secondarySectors || []).map((secondary) => ({
            ...secondary,
            mappingRole: "secondary",
          })),
        ]
        : [{
          id: "",
          name: classified.name,
          nameEn: "",
          kind: "",
          mappingRole: "unmapped",
        }];
      for (const mappedSector of mappedSectors) {
        const key = mappedSector.id || mappedSector.name.toLocaleLowerCase("en-US");
        const existing = standardSectorMap.get(key);
        if (existing) {
          existing.sourceLabels = [...new Set([...existing.sourceLabels, sector])];
          if (mappedSector.mappingRole === "primary") existing.mappingRole = "primary";
        } else {
          standardSectorMap.set(key, {
            id: mappedSector.id,
            name: mappedSector.name,
            nameEn: mappedSector.nameEn || "",
            kind: mappedSector.kind || "",
            mappingRole: mappedSector.mappingRole,
            matched: classified.matched,
            sourceLabels: [sector],
          });
        }
      }
    }
    return {
      reportId: cleanText(item?.report_id, 120),
      publisher: cleanText(item?.publisher, 160),
      analyst: cleanText(item?.analyst, 120),
      title: cleanText(item?.title, 240),
      publishedAt: cleanText(item?.published_at, 80),
      reportType,
      researchScope,
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
  const researchScopeCounts = normalizedReports.reduce((counts, report) => {
    counts[report.researchScope] = Number(counts[report.researchScope] || 0) + 1;
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
      researchScopeCounts,
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
  const gmailResearch = await loadGmailResearchOverview({
    root: config.root,
    reportDate: readerArtifact.date,
    engineRoot: configuredEngineRoot(env, config.root),
    env,
  });
  const pipeline = intelligenceArtifact
    ? normalizePipeline(intelligenceArtifact.payload)
    : null;
  const scoreboard = intelligenceArtifact
    ? normalizeScoreboard(intelligenceArtifact.payload)
    : null;
  const marketInternals = marketInternalsArtifact
    ? normalizeMarketInternals(marketInternalsArtifact.payload)
    : null;
  const report = normalizeReaderReport(readerArtifact.payload);
  const decisionGate = buildDecisionGate({
    intelligence: intelligenceArtifact?.payload,
    scoreboard,
    marketInternals,
  });
  const stockCandidates = stockCandidatesArtifact
    ? normalizeStockCandidates(stockCandidatesArtifact.payload)
    : null;
  const selectedResearchDate = brokerResearchArtifact?.date || "";
  const previousResearchDate = brokerResearchDates.find(
    (date) => selectedResearchDate && date < selectedResearchDate,
  ) || "";
  const currentImpactMarketArtifact = selectedResearchDate
    ? await artifactForDate(
      config.root,
      "us_market_internals",
      "market_internals.json",
      MARKET_INTERNALS_SCHEMA,
      selectedResearchDate,
    )
    : null;
  const currentImpactStockArtifact = selectedResearchDate
    ? await artifactForDate(
      config.root,
      "us_equity_candidate_screen",
      "candidate_screen.json",
      STOCK_CANDIDATES_SCHEMA,
      selectedResearchDate,
    )
    : null;
  const previousImpactMarketArtifact = previousResearchDate
    ? await artifactForDate(
      config.root,
      "us_market_internals",
      "market_internals.json",
      MARKET_INTERNALS_SCHEMA,
      previousResearchDate,
    )
    : null;
  const previousImpactStockArtifact = previousResearchDate
    ? await artifactForDate(
      config.root,
      "us_equity_candidate_screen",
      "candidate_screen.json",
      STOCK_CANDIDATES_SCHEMA,
      previousResearchDate,
    )
    : null;
  const previousResearchPoint = brokerResearchIndex.sectorHistory.find(
    (point) => point.date === previousResearchDate,
  );
  const currentImpactCoverage = buildBrokerSectorImpactProfiles({
    coverage: brokerResearchNormalized?.consensus?.coverage,
    marketInternals: currentImpactMarketArtifact
      ? normalizeMarketInternals(currentImpactMarketArtifact.payload)
      : null,
    stockCandidates: currentImpactStockArtifact
      ? normalizeStockCandidates(currentImpactStockArtifact.payload)
      : null,
  });
  const previousImpactCoverage = buildBrokerSectorImpactProfiles({
    coverage: previousResearchPoint?.sectors,
    marketInternals: previousImpactMarketArtifact
      ? normalizeMarketInternals(previousImpactMarketArtifact.payload)
      : null,
    stockCandidates: previousImpactStockArtifact
      ? normalizeStockCandidates(previousImpactStockArtifact.payload)
      : null,
  });
  const impactChanges = buildBrokerSectorImpactChanges({
    currentCoverage: currentImpactCoverage,
    previousCoverage: previousImpactCoverage,
    currentDate: selectedResearchDate,
    previousDate: previousResearchDate,
  });
  const impactHistory = [];
  const eligibleImpactHistoryPoints = brokerResearchIndex.sectorHistory
    .filter((point) => !selectedResearchDate || point.date <= selectedResearchDate)
    .slice(-8);
  for (const point of eligibleImpactHistoryPoints) {
    if (point.date === selectedResearchDate) {
      impactHistory.push({ date: point.date, coverage: impactChanges.coverage });
      continue;
    }
    if (point.date === previousResearchDate) {
      impactHistory.push({ date: point.date, coverage: previousImpactCoverage });
      continue;
    }
    const [marketArtifact, candidateArtifact] = await Promise.all([
      artifactForDate(
        config.root,
        "us_market_internals",
        "market_internals.json",
        MARKET_INTERNALS_SCHEMA,
        point.date,
      ),
      artifactForDate(
        config.root,
        "us_equity_candidate_screen",
        "candidate_screen.json",
        STOCK_CANDIDATES_SCHEMA,
        point.date,
      ),
    ]);
    impactHistory.push({
      date: point.date,
      coverage: buildBrokerSectorImpactProfiles({
        coverage: point.sectors,
        marketInternals: marketArtifact
          ? normalizeMarketInternals(marketArtifact.payload)
          : null,
        stockCandidates: candidateArtifact
          ? normalizeStockCandidates(candidateArtifact.payload)
          : null,
      }),
    });
  }
  const signalPersistence = buildBrokerSectorSignalPersistence({
    history: impactHistory,
  });
  const sectorWatchlist = buildSectorWatchlistRanking(signalPersistence.coverage);
  const brokerResearchWithImpacts = brokerResearchNormalized
    ? {
      ...brokerResearchNormalized,
      consensus: {
        ...brokerResearchNormalized.consensus,
        coverage: signalPersistence.coverage,
        impactAlerts: impactChanges.alerts,
        impactBaseline: impactChanges.baseline,
        signalPersistence: signalPersistence.summary,
        sectorWatchlist,
      },
    }
    : null;
  const decisionChain = buildMarketSectorStockChain({
    report,
    decisionGate,
    scoreboard,
    marketInternals,
    stockCandidates,
    brokerResearch: brokerResearchWithImpacts,
  });
  const sectorStockShortlists = buildSectorStockShortlists({
    sectorWatchlist,
    candidatePool: decisionChain?.ideaFunnel?.candidatePool,
  });
  const brokerResearchFinal = brokerResearchWithImpacts
    ? {
      ...brokerResearchWithImpacts,
      consensus: {
        ...brokerResearchWithImpacts.consensus,
        sectorStockShortlists,
      },
    }
    : null;
  const thesisMemory = await readInvestmentThesisMemory({ env });
  thesisMemory.pendingCandidates = buildTrackedInvestmentTheses({
    decisionChain,
    reportDate: report.reportDate,
  });
  thesisMemory.weeklyCalibration = buildWeeklyThesisCalibration(thesisMemory, {
    asOfDate: report.reportDate,
  });
  let transactionSettings = {};
  let portfolioCanvasSnapshot = {};
  try {
    transactionSettings = readTransactionSettings();
  } catch {
    transactionSettings = {};
  }
  try {
    portfolioCanvasSnapshot = readPortfolioCanvasStoreSnapshot();
  } catch {
    portfolioCanvasSnapshot = {};
  }
  const portfolioUniverse = extractPortfolioUniverse({
    transactionSettings,
    portfolioCanvasSnapshot,
  });
  const portfolioImpact = buildPortfolioImpact({
    universe: portfolioUniverse,
    intelligence: intelligenceArtifact?.payload,
    report: {
      ...report,
      decisionGateStatus: decisionGate?.status,
    },
    stockCandidates,
    candidatePool: decisionChain?.ideaFunnel?.candidatePool,
    sectorPaths: decisionChain?.sectors,
  });
  thesisMemory.weeklyCalibration.alerts = linkThesisAlertsToPortfolio({
    alerts: thesisMemory.weeklyCalibration.alerts,
    portfolioImpact,
    candidatePool: decisionChain?.ideaFunnel?.candidatePool,
  });
  for (const alert of thesisMemory.weeklyCalibration.alerts.filter(
    (item) => item.priorityLevel === "critical",
  )) {
    await pushSystemNotification({
      level: "critical",
      source: "pb-investment-thesis",
      clickTarget: "daily-intelligence",
      dedupeKey: alert.id,
      summary: `${alert.entityId} 보유종목 가설 반증 · ${alert.reason}`,
    }).catch(() => null);
  }
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
    report,
    decisionGate,
    pipeline,
    scoreboard,
    marketInternals,
    decisionChain,
    thesisMemory,
    sectorMetrics: sectorMetricsArtifact ? normalizeSectorMetrics(sectorMetricsArtifact.payload) : null,
    stockCandidates,
    portfolioImpact,
    brokerResearch: brokerResearchFinal,
    brokerResearchIndex,
    brokerResearchHistory: {
      availableDates: brokerResearchDates,
      selectedDate: brokerResearchArtifact?.date || "",
      latestDate: brokerResearchDates[0] || "",
    },
    telegramSources,
    gmailResearch,
  };
}

export async function handlePbDailyIntelligenceEndpoint(req, res) {
  try {
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (![
        "syncInvestmentTheses",
        "trackStockThesis",
        "quickAddWatchlistTicker",
        "quickAddPortfolioHolding",
        "removePortfolioHolding",
        "reviewPortfolioRisk",
        "updatePortfolioRiskFollowUp",
        "reviewRiskThesisProposal",
        "recordRiskPortfolioResponse",
        "reviewPortfolioResponseRuleSuggestion",
        "reviewPortfolioResponseActiveRule",
        "reviewMonthlyDecisionGoalProposal",
      ].includes(body.action)) {
        sendJson(res, { ok: false, error: "unknown action" }, 422);
        return;
      }
      const snapshot = await loadPbDailyIntelligenceSnapshot({
        env: process.env,
        brokerResearchDate: cleanText(body.brokerResearchDate, 20),
      });
      if (!snapshot.connection?.available || !snapshot.report?.reportDate) {
        throw new Error("동기화할 Daily Intelligence가 없습니다.");
      }
      if (body.action === "reviewPortfolioRisk") {
        const riskId = cleanText(body.riskId, 160);
        const reviewReportDate = cleanText(body.reviewReportDate, 20)
          || snapshot.report.reportDate;
        const currentAction = cleanList(
          snapshot.portfolioImpact?.riskReview?.actionChecklist,
          100,
        ).find((item) => item?.id === riskId);
        const existingReview = readPortfolioRiskReviews({
          reportDate: reviewReportDate,
        }).find((item) => item?.riskId === riskId);
        if (!currentAction && (!existingReview || existingReview.status !== "deferred")) {
          throw new Error("현재 또는 재검토 대기 목록에서 해당 위험 항목을 찾지 못했습니다.");
        }
        const result = savePortfolioRiskReview({
          reportDate: reviewReportDate,
          riskId,
          status: body.status,
          note: body.note,
          reviewDate: body.reviewDate,
          deferReason: body.deferReason,
          thesisImpact: body.thesisImpact,
          title: currentAction?.title || existingReview?.title || riskId,
        });
        sendJson(res, { ok: true, ...result });
        return;
      }
      if (body.action === "updatePortfolioRiskFollowUp") {
        const result = savePortfolioRiskFollowUp({
          reportDate: body.reviewReportDate,
          riskId: body.riskId,
          status: body.followUpStatus,
          evidenceUrl: body.evidenceUrl,
          evidenceNote: body.evidenceNote,
        });
        sendJson(res, { ok: true, ...result });
        return;
      }
      if (body.action === "reviewRiskThesisProposal") {
        const reportDate = cleanText(body.reviewReportDate, 20);
        const riskId = cleanText(body.riskId, 160);
        const decision = cleanText(body.decision, 30);
        const review = readPortfolioRiskReviews({ reportDate })
          .find((item) => item.riskId === riskId);
        if (!review || review.thesisProposalStatus !== "pending") {
          throw new Error("승인 대기 중인 투자 가설 반영 제안을 찾지 못했습니다.");
        }
        let thesisMemory = null;
        if (decision === "approved") {
          thesisMemory = await applyRiskReviewEvidenceToInvestmentTheses({
            continuityIds: review.thesisContinuityIds,
            relation: review.thesisImpact,
            riskId,
            reportDate,
            summary: review.followUpEvidenceNote || review.note,
            evidenceUrl: review.followUpEvidenceUrl,
            env: process.env,
          });
        }
        const result = reviewPortfolioRiskThesisProposal({
          reportDate,
          riskId,
          decision,
        });
        sendJson(res, { ok: true, ...result, thesisMemory });
        return;
      }
      if (body.action === "recordRiskPortfolioResponse") {
        const activeRules = readPortfolioResponseRuleDecisions()
          .filter((item) =>
            item?.decision === "approved"
            && item?.lifecycleStatus !== "inactive"
            && item?.action === cleanText(body.portfolioResponseAction, 40)
          );
        const acknowledgedRuleIds = cleanList(body.acknowledgedRuleIds, 10)
          .map((item) => cleanText(item, 160));
        const missingRule = activeRules.find(
          (rule) => !acknowledgedRuleIds.includes(rule.suggestionId),
        );
        if (missingRule) {
          throw new Error("활성 검토 규칙을 확인해야 포트폴리오 대응을 기록할 수 있습니다.");
        }
        const observation = portfolioResponseObservation(body.riskId, {
          stockCandidates: snapshot.stockCandidates,
          marketInternals: snapshot.marketInternals,
        });
        const result = savePortfolioRiskResponse({
          reportDate: body.reviewReportDate,
          riskId: body.riskId,
          action: body.portfolioResponseAction,
          note: body.note,
          reviewDate: body.reviewDate,
          metricId: observation?.metricId,
          metricLabel: observation?.metricLabel,
          metricTicker: observation?.ticker,
          baselineValue: observation?.value,
          baselineDate: snapshot.report.reportDate,
          acknowledgedRuleIds,
        });
        sendJson(res, { ok: true, ...result });
        return;
      }
      if (body.action === "reviewPortfolioResponseRuleSuggestion") {
        const responseActivity = buildRiskThesisReviewActivity({
          reviews: readPortfolioRiskReviews(),
          thesisMemory: snapshot.thesisMemory,
          stockCandidates: snapshot.stockCandidates,
          marketInternals: snapshot.marketInternals,
          reportDate: snapshot.report.reportDate,
          limit: 500,
        });
        const monthlyReview = buildMonthlyPortfolioDecisionReview(
          responseActivity,
          readPortfolioResponseRuleDecisions(),
          { asOfDate: snapshot.report.reportDate },
        );
        monthlyReview.goals = attachMonthlyDecisionGoals(
          monthlyReview,
          buildMonthlyDecisionGoalProposals(monthlyReview),
          readPortfolioDecisionGoals(),
          {
            asOfDate: snapshot.report.reportDate,
            activity: responseActivity,
          },
        );
        const suggestion = [
          ...buildPortfolioResponseCalibration(responseActivity).ruleSuggestions,
          ...buildMonthlyFailureChecklistSuggestions(
            monthlyReview.goals.activeGoals,
          ),
        ].find((item) =>
          item?.suggestionId === cleanText(body.suggestionId, 160)
        );
        if (!suggestion) {
          throw new Error("현재 검토 대기 중인 규칙 개선 제안을 찾지 못했습니다.");
        }
        const result = reviewPortfolioResponseRuleSuggestion({
          suggestionId: suggestion.suggestionId,
          action: suggestion.action,
          proposal: suggestion.proposal,
          decision: body.decision,
          decisiveCount: suggestion.decisiveCount,
          challengedCount: suggestion.challengedCount,
          challengeRatePct: suggestion.challengeRatePct,
          origin: suggestion.origin,
          causeId: suggestion.causeId,
          causeLabel: suggestion.causeLabel,
          sourceGoalId: suggestion.sourceGoalId,
        });
        sendJson(res, { ok: true, ...result });
        return;
      }
      if (body.action === "reviewPortfolioResponseActiveRule") {
        const responseActivity = buildRiskThesisReviewActivity({
          reviews: readPortfolioRiskReviews(),
          thesisMemory: snapshot.thesisMemory,
          stockCandidates: snapshot.stockCandidates,
          marketInternals: snapshot.marketInternals,
          reportDate: snapshot.report.reportDate,
          limit: 500,
        });
        const responseRuleDecisions = readPortfolioResponseRuleDecisions();
        const impact = buildPortfolioResponseRuleImpact(
          responseActivity,
          responseRuleDecisions,
        ).find((item) => item.suggestionId === cleanText(body.suggestionId, 160));
        const causeImpact = buildPortfolioFailureCauseRuleImpact(
          responseActivity,
          responseRuleDecisions,
        ).find((item) => item.suggestionId === cleanText(body.suggestionId, 160));
        if (
          impact?.status !== "declined"
          && causeImpact?.status !== "worsened"
        ) {
          throw new Error("효과 악화가 확인된 활성 규칙만 재검토할 수 있습니다.");
        }
        const result = reviewPortfolioResponseActiveRule({
          suggestionId: impact?.suggestionId || causeImpact.suggestionId,
          managementDecision: body.managementDecision,
          modifiedProposal: body.modifiedProposal,
        });
        sendJson(res, { ok: true, ...result });
        return;
      }
      if (body.action === "reviewMonthlyDecisionGoalProposal") {
        const responseActivity = buildRiskThesisReviewActivity({
          reviews: readPortfolioRiskReviews(),
          thesisMemory: snapshot.thesisMemory,
          stockCandidates: snapshot.stockCandidates,
          marketInternals: snapshot.marketInternals,
          reportDate: snapshot.report.reportDate,
          limit: 500,
        });
        const monthlyReview = buildMonthlyPortfolioDecisionReview(
          responseActivity,
          readPortfolioResponseRuleDecisions(),
          { asOfDate: snapshot.report.reportDate },
        );
        const proposal = buildMonthlyDecisionGoalProposals(monthlyReview)
          .find((item) => item.goalId === cleanText(body.goalId, 180));
        if (!proposal) {
          throw new Error("현재 승인 대기 중인 월간 개선 목표를 찾지 못했습니다.");
        }
        const result = reviewMonthlyDecisionGoalProposal({
          proposal,
          decision: body.decision,
        });
        sendJson(res, { ok: true, ...result });
        return;
      }
      if (body.action === "quickAddWatchlistTicker") {
        const ticker = cleanTicker(body.ticker);
        const candidate = cleanList(
          snapshot.decisionChain?.ideaFunnel?.candidatePool,
          100,
        ).find((item) => cleanTicker(item?.ticker) === ticker);
        if (!candidate) throw new Error("현재 선별 후보에서 해당 종목을 찾지 못했습니다.");
        const result = addTransactionWatchlistTicker({ ticker });
        sendJson(res, {
          ok: true,
          added: result.added,
          ticker: result.ticker,
          groupId: result.groupId,
          groupName: result.groupName,
        });
        return;
      }
      if (body.action === "quickAddPortfolioHolding") {
        const ticker = cleanTicker(body.ticker);
        const candidate = cleanList(
          snapshot.decisionChain?.ideaFunnel?.candidatePool,
          100,
        ).find((item) => cleanTicker(item?.ticker) === ticker);
        if (!candidate) throw new Error("현재 선별 후보에서 해당 종목을 찾지 못했습니다.");
        const result = upsertTransactionPortfolioHolding({
          ticker,
          weight: body.weight,
        });
        sendJson(res, {
          ok: true,
          added: result.added,
          updated: result.updated,
          ticker: result.ticker,
          weight: result.weight,
        });
        return;
      }
      if (body.action === "removePortfolioHolding") {
        const ticker = cleanTicker(body.ticker);
        const existing = cleanList(snapshot.portfolioImpact?.assets, 500).find(
          (item) =>
            cleanTicker(item?.ticker) === ticker
            && cleanList(item?.sources, 10).includes("quick_portfolio"),
        );
        if (!existing) throw new Error("간편 보유목록에서 해당 종목을 찾지 못했습니다.");
        const result = removeTransactionPortfolioHolding({ ticker });
        sendJson(res, {
          ok: true,
          removed: result.removed,
          ticker: result.ticker,
        });
        return;
      }
      if (body.action === "trackStockThesis") {
        const ticker = cleanText(body.ticker, 20).toUpperCase();
        const sectorId = cleanText(body.sectorId, 120);
        const candidates = cleanList(
          snapshot.brokerResearch?.consensus?.sectorStockShortlists?.sectors,
          30,
        ).flatMap((sector) =>
          cleanList(sector.candidates, 20)
            .filter((candidate) =>
              candidate.ticker === ticker
              && (!sectorId || sector.sectorId === sectorId),
            ),
        );
        const candidate = candidates[0];
        if (!candidate) throw new Error("현재 쇼트리스트에서 해당 종목을 찾지 못했습니다.");
        const thesisMemory = await syncSelectedStockThesisMemory({
          candidate,
          reportDate: snapshot.brokerResearch?.reportDate
            || snapshot.report.reportDate,
          env: process.env,
        });
        sendJson(res, {
          ok: true,
          trackedTicker: candidate.ticker,
          thesisMemory,
        });
        return;
      }
      const thesisMemory = await syncInvestmentThesisMemory({
        decisionChain: snapshot.decisionChain,
        reportDate: snapshot.report.reportDate,
        env: process.env,
      });
      sendJson(res, { ok: true, thesisMemory });
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const requestUrl = new URL(req.url || "/api/pb-daily-intelligence", "http://127.0.0.1");
    const snapshot = await loadPbDailyIntelligenceSnapshot({
      brokerResearchDate: requestUrl.searchParams.get("brokerDate") || "",
    });
    if (snapshot.connection?.available && snapshot.portfolioImpact?.configured) {
      const recorded = recordPortfolioRiskSnapshot({
        reportDate: snapshot.report?.reportDate,
        riskReview: snapshot.portfolioImpact?.riskReview,
        quickPortfolioWeight: snapshot.portfolioImpact?.quickPortfolioWeight,
      });
      snapshot.portfolioImpact.riskReview.history = {
        persisted: recorded.persisted,
        path: recorded.path || "",
        snapshot: recorded.snapshot,
        comparison: recorded.comparison,
        trend: recorded.trend,
      };
      const riskReviews = attachPortfolioRiskReviews({
        reportDate: snapshot.report.reportDate,
        actions: snapshot.portfolioImpact.riskReview.actionChecklist,
      });
      snapshot.portfolioImpact.riskReview.actionChecklist = riskReviews.actions;
      snapshot.portfolioImpact.riskReview.reviewSummary = riskReviews.summary;
      snapshot.portfolioImpact.riskReview.dueFollowUps = riskReviews.dueFollowUps;
      snapshot.portfolioImpact.riskReview.followUpQueue = riskReviews.followUpQueue;
      snapshot.portfolioImpact.riskReview.reviewAnalytics = riskReviews.analytics;
      const allRiskReviews = readPortfolioRiskReviews();
      snapshot.thesisMemory.riskReviewProposals = buildRiskThesisReviewProposals({
        reviews: allRiskReviews,
        thesisMemory: snapshot.thesisMemory,
      });
      const responseActivity = buildRiskThesisReviewActivity({
        reviews: allRiskReviews,
        thesisMemory: snapshot.thesisMemory,
        stockCandidates: snapshot.stockCandidates,
        marketInternals: snapshot.marketInternals,
        reportDate: snapshot.report.reportDate,
        limit: 500,
      });
      snapshot.thesisMemory.riskReviewActivity = responseActivity.slice(0, 12);
      const responseRuleDecisions = readPortfolioResponseRuleDecisions();
      const responseMonthlyReview = buildMonthlyPortfolioDecisionReview(
          responseActivity,
          responseRuleDecisions,
          { asOfDate: snapshot.report.reportDate },
        );
      responseMonthlyReview.goals = attachMonthlyDecisionGoals(
        responseMonthlyReview,
        buildMonthlyDecisionGoalProposals(responseMonthlyReview),
        readPortfolioDecisionGoals(),
        {
          asOfDate: snapshot.report.reportDate,
          activity: responseActivity,
        },
      );
      const responseCalibration = buildPortfolioResponseCalibration(
        responseActivity,
      );
      responseCalibration.ruleSuggestions = [
        ...responseCalibration.ruleSuggestions,
        ...buildMonthlyFailureChecklistSuggestions(
          responseMonthlyReview.goals.activeGoals,
        ),
      ];
      snapshot.thesisMemory.portfolioResponseCalibration =
        attachPortfolioResponseRuleDecisions(
          responseCalibration,
          responseRuleDecisions,
        );
      snapshot.thesisMemory.portfolioResponseCalibration.ruleImpact =
        buildPortfolioResponseRuleImpact(responseActivity, responseRuleDecisions);
      snapshot.thesisMemory.portfolioResponseCalibration.failureCauseRuleImpact =
        buildPortfolioFailureCauseRuleImpact(
          responseActivity,
          responseRuleDecisions,
        );
      for (
        const impact of snapshot.thesisMemory.portfolioResponseCalibration
          .failureCauseRuleImpact.filter((item) => item.status === "worsened")
      ) {
        await pushSystemNotification({
          level: "watch",
          source: "portfolio-failure-cause-rule",
          clickTarget: "daily-intelligence",
          dedupeKey: `portfolio-failure-cause-rule:${impact.suggestionId}:${
            impact.latestAfterRecordedAt || "comparison"
          }`,
          summary: `${impact.causeLabel} 체크리스트 적용 후 동일 원인 재발률이 ${impact.before.recurrenceRatePct.toFixed(0)}%에서 ${impact.after.recurrenceRatePct.toFixed(0)}%로 높아져 재검토가 필요합니다.`,
        }).catch(() => null);
      }
      snapshot.thesisMemory.portfolioResponseCalibration.monthlyReview =
        responseMonthlyReview;
      for (const alert of responseMonthlyReview.goals.alerts || []) {
        await pushSystemNotification({
          level: alert.level,
          source: "portfolio-decision-goal",
          clickTarget: "daily-intelligence",
          dedupeKey: alert.id,
          summary: alert.summary,
        }).catch(() => null);
      }
      for (const followUp of riskReviews.dueFollowUps) {
        await pushSystemNotification({
          level: "watch",
          source: "portfolio-risk-review",
          clickTarget: "daily-intelligence",
          dedupeKey: `portfolio-risk-review-overdue:${followUp.reportDate}:${
            followUp.riskId
          }:${followUp.reviewDate}`,
          summary: `${followUp.title || followUp.riskId} 재검토 기한이 도래했습니다.`,
        }).catch(() => null);
      }
      if (recorded.comparison.previousDate) {
        for (const ticker of recorded.comparison.stockHigh.added) {
          await pushSystemNotification({
            level: "critical",
            source: "portfolio-risk",
            clickTarget: "daily-intelligence",
            dedupeKey: `portfolio-stock-high:${snapshot.report.reportDate}:${ticker}`,
            summary: `${ticker} 보유 비중이 40% 이상 집중 구간에 진입했습니다.`,
          }).catch(() => null);
        }
        for (const sectorTicker of recorded.comparison.sectorHigh.added) {
          await pushSystemNotification({
            level: "critical",
            source: "portfolio-risk",
            clickTarget: "daily-intelligence",
            dedupeKey: `portfolio-sector-high:${snapshot.report.reportDate}:${sectorTicker}`,
            summary: `${sectorTicker} 섹터 보유 비중이 60% 이상 집중 구간에 진입했습니다.`,
          }).catch(() => null);
        }
        for (const conflict of recorded.comparison.thesisConflicts.added) {
          const [ticker, sectorTicker] = conflict.split(":");
          await pushSystemNotification({
            level: "watch",
            source: "portfolio-risk",
            clickTarget: "daily-intelligence",
            dedupeKey: `portfolio-thesis-conflict:${snapshot.report.reportDate}:${conflict}`,
            summary: `${ticker} 보유가 현재 ${sectorTicker} 부담 가설과 충돌합니다.`,
          }).catch(() => null);
        }
      }
    }
    sendJson(res, { ok: true, ...snapshot });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
