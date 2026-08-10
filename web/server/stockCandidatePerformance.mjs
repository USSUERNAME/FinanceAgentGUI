import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = join(MODULE_DIR, "..", "..", "data", "stock-candidate-performance.json");
const HORIZONS = [
  { id: "1w", days: 7, label: "1주" },
  { id: "1m", days: 30, label: "1개월" },
  { id: "3m", days: 90, label: "3개월" },
];

function text(value, max = 500) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function ticker(value) {
  const normalized = text(value, 20).toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(normalized) ? normalized : "";
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateKey(value) {
  const match = text(value, 40).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function percentChange(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return Number((((current / base) - 1) * 100).toFixed(4));
}

export function emptyCandidatePerformanceStore() {
  return { schemaVersion: "stock_candidate_performance.v1", updatedAt: "", records: [] };
}

export function syncCandidatePerformanceStore(store = emptyCandidatePerformanceStore(), candidates = [], now = new Date()) {
  const next = {
    ...emptyCandidatePerformanceStore(),
    ...store,
    records: Array.isArray(store?.records) ? structuredClone(store.records) : [],
  };
  const byTicker = new Map(next.records.map((record) => [ticker(record.ticker), record]));
  const syncedAt = now.toISOString();

  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const symbol = ticker(raw?.ticker);
    const asOf = dateKey(raw?.asOf);
    const close = finite(raw?.close);
    if (!symbol || !asOf || close === null || close <= 0) continue;
    let record = byTicker.get(symbol);
    if (!record) {
      record = {
        ticker: symbol,
        companyName: text(raw?.companyName, 180),
        gradeAtRegistration: ["A", "B"].includes(raw?.grade) ? raw.grade : "B",
        registeredAt: asOf,
        registeredPrice: close,
        benchmark: "SPY",
        thesisStatus: "watching",
        thesisNote: "",
        observations: [],
      };
      next.records.push(record);
      byTicker.set(symbol, record);
    }
    const observations = Array.isArray(record.observations) ? record.observations : [];
    const previous = observations.at(-1);
    const benchmarkReturn1d = finite(raw?.benchmarkReturn1d);
    const previousIndex = finite(previous?.benchmarkIndex) ?? 100;
    const benchmarkIndex = previous && benchmarkReturn1d !== null
      ? Number((previousIndex * (1 + benchmarkReturn1d / 100)).toFixed(8))
      : previous ? null : 100;
    const observation = {
      asOf,
      price: close,
      benchmarkReturn1d,
      benchmarkIndex,
      observedAt: syncedAt,
    };
    const existingIndex = observations.findIndex((item) => dateKey(item?.asOf) === asOf);
    if (existingIndex >= 0) observations[existingIndex] = observation;
    else observations.push(observation);
    observations.sort((a, b) => dateKey(a.asOf).localeCompare(dateKey(b.asOf)));
    record.observations = observations;
    record.companyName = record.companyName || text(raw?.companyName, 180);
    record.lastObservedAt = asOf;
    record.lastObservedPrice = close;
  }
  next.updatedAt = syncedAt;
  return next;
}

function horizonResult(record, horizon) {
  const targetDate = addDays(record.registeredAt, horizon.days);
  const observation = (record.observations || []).find((item) => dateKey(item.asOf) >= targetDate);
  if (!observation) {
    return { ...horizon, targetDate, status: "pending", observedAt: "", returnPct: null, benchmarkReturnPct: null, excessReturnPct: null };
  }
  const stockReturn = percentChange(finite(observation.price), finite(record.registeredPrice));
  const baseBenchmark = finite(record.observations?.[0]?.benchmarkIndex);
  const currentBenchmark = finite(observation.benchmarkIndex);
  const benchmarkReturn = baseBenchmark !== null && currentBenchmark !== null
    ? percentChange(currentBenchmark, baseBenchmark)
    : null;
  return {
    ...horizon,
    targetDate,
    status: "measured",
    observedAt: dateKey(observation.asOf),
    returnPct: stockReturn,
    benchmarkReturnPct: benchmarkReturn,
    excessReturnPct: stockReturn !== null && benchmarkReturn !== null
      ? Number((stockReturn - benchmarkReturn).toFixed(4))
      : null,
  };
}

export function candidatePerformanceSnapshot(store = emptyCandidatePerformanceStore()) {
  return {
    schemaVersion: store.schemaVersion || "stock_candidate_performance.v1",
    updatedAt: store.updatedAt || "",
    records: (store.records || []).map((record) => ({
      ...record,
      observationCount: Array.isArray(record.observations) ? record.observations.length : 0,
      horizons: HORIZONS.map((horizon) => horizonResult(record, horizon)),
    })),
  };
}

function resolveStorePath(env = process.env) {
  return text(env.STOCK_CANDIDATE_PERFORMANCE_PATH, 4000) || DEFAULT_STORE_PATH;
}

function readStore(path) {
  if (!existsSync(path)) return emptyCandidatePerformanceStore();
  try {
    return { ...emptyCandidatePerformanceStore(), ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return emptyCandidatePerformanceStore();
  }
}

function writeStore(path, store) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

export async function handleStockCandidatePerformanceEndpoint(req, res) {
  try {
    const path = resolveStorePath();
    if (req.method === "GET") {
      sendJson(res, { ok: true, ...candidatePerformanceSnapshot(readStore(path)) });
      return;
    }
    if (req.method !== "POST" && req.method !== "PATCH") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const body = await readJsonBody(req, 256 * 1024);
    const action = text(body.action, 40) || "sync";
    let store = readStore(path);
    if (action === "sync") {
      store = syncCandidatePerformanceStore(store, body.candidates);
    } else if (action === "review") {
      const symbol = ticker(body.ticker);
      const record = store.records.find((item) => ticker(item.ticker) === symbol);
      if (!record) throw new Error("tracked candidate not found");
      record.thesisStatus = ["watching", "hit", "invalidated"].includes(body.thesisStatus)
        ? body.thesisStatus : record.thesisStatus;
      record.thesisNote = text(body.thesisNote, 1000);
      store.updatedAt = new Date().toISOString();
    } else {
      sendJson(res, { ok: false, error: "unknown action" }, 422);
      return;
    }
    writeStore(path, store);
    sendJson(res, { ok: true, ...candidatePerformanceSnapshot(store) });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message || "candidate performance tracking failed" }, 400);
  }
}
