import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const APP_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_TEMPLATE_DIR = join(APP_ROOT, "web", "public-report-reader");
const TEMPLATE_FILES = ["index.html", "styles.css", "app.js", "_headers"];
const REPORT_FILE_NAME = "reader_report.json";
const MAX_REPORTS = 90;

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
        if (item && typeof item === "object") {
          const nested = Object.fromEntries(
            Object.entries(item)
              .filter(([, nestedValue]) => ["string", "number", "boolean"].includes(typeof nestedValue))
              .slice(0, 24)
              .map(([nestedKey, nestedValue]) => [text(nestedKey, 80), typeof nestedValue === "string" ? text(nestedValue, 800) : nestedValue]),
          );
          return [key, nested];
        }
        return [key, null];
      })
      .filter(([, value]) => value !== null && value !== "" && (!Array.isArray(value) || value.length)),
  );
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
  if (source?.schema_version !== "v2_reader_report.v1") {
    throw new Error("unsupported reader report schema");
  }
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
    koreaConnection: safeScalarMap(source.korea_connection, ["status", "summary", "metrics"]),
    nextChecks: textList(source.next_checks, { limit: 20, maxLength: 1200 }),
    dataStatus: safeScalarMap(source.data_status, ["latest_price_as_of", "verified_event_count", "korea_data_status", "warnings"]),
    sources: sourceList(source.sources),
  };
}

async function findReaderReportFiles(root, depth = 0) {
  if (depth > 5) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await findReaderReportFiles(path, depth + 1)));
    else if (entry.isFile() && entry.name === REPORT_FILE_NAME) files.push(path);
  }
  return files;
}

async function collectReports(inputDir) {
  const byDate = new Map();
  for (const file of await findReaderReportFiles(inputDir)) {
    try {
      const report = sanitizeReaderReport(JSON.parse(await readFile(file, "utf8")));
      const current = byDate.get(report.reportDate);
      if (!current || String(report.generatedAt) > String(current.generatedAt)) byDate.set(report.reportDate, report);
    } catch (error) {
      console.warn(`Skipped ${basename(file)}: ${error.message}`);
    }
  }
  return [...byDate.values()]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, MAX_REPORTS);
}

async function previousReports(previousBundle) {
  if (!previousBundle) return [];
  try {
    const payload = JSON.parse(await readFile(resolve(previousBundle), "utf8"));
    if (payload?.schemaVersion !== "public_pb_reader_bundle.v1" || !Array.isArray(payload.reports)) return [];
    return payload.reports
      .filter((report) => report?.schemaVersion === "public_pb_reader.v1" && /^\d{4}-\d{2}-\d{2}$/.test(report?.reportDate || ""))
      .slice(0, MAX_REPORTS);
  } catch {
    return [];
  }
}

export async function buildPublicReportReader({ inputDir, outputDir, templateDir = DEFAULT_TEMPLATE_DIR, previousBundle = "", locked = false }) {
  const target = resolve(outputDir);
  await mkdir(target, { recursive: true });
  await Promise.all(TEMPLATE_FILES.map((file) => copyFile(join(templateDir, file), join(target, file))));
  const currentReports = locked ? [] : await collectReports(resolve(inputDir));
  const byDate = new Map((await previousReports(previousBundle)).map((report) => [report.reportDate, report]));
  currentReports.forEach((report) => byDate.set(report.reportDate, report));
  const reports = locked
    ? []
    : [...byDate.values()]
        .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.generatedAt.localeCompare(a.generatedAt))
        .slice(0, MAX_REPORTS);
  if (!locked && !reports.length) throw new Error(`no valid reader reports found in ${inputDir}`);
  const payload = {
    schemaVersion: "public_pb_reader_bundle.v1",
    generatedAt: new Date().toISOString(),
    locked: Boolean(locked),
    reports,
  };
  await writeFile(join(target, "reports.json"), `${JSON.stringify(payload)}\n`, "utf8");
  return { outputDir: target, reportCount: reports.length, locked: payload.locked };
}

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const locked = process.argv.includes("--locked");
  const inputDir = argument("input", join(APP_ROOT, "pipeline", "pb-daily-market-brief", "workspace", "v2_reader_reports"));
  const outputDir = argument("output", join(APP_ROOT, ".generated", "cloudflare-report-reader"));
  const previousBundle = argument("previous", "");
  buildPublicReportReader({ inputDir, outputDir, previousBundle, locked })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
