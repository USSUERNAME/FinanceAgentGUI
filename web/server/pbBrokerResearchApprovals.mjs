import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, resolve } from "node:path";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const APPROVAL_SCHEMA = "google_drive_broker_research_approvals.v1";
const APPROVAL_RELATIVE_PATH = join(
  "workspace",
  "broker_research_approvals",
  "google_drive.json",
);
const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const SUPPORTED_SUFFIXES = new Set([".pdf", ".md", ".txt"]);
const MAX_RESPONSE_FILES = 100;
const MAX_FOLDER_DEPTH = 3;

const MARKET_SCOPE_ALIASES = new Map([
  ["KR", "KR"],
  ["KOREA", "KR"],
  ["국내", "KR"],
  ["한국", "KR"],
  ["US", "US"],
  ["USA", "US"],
  ["미국", "US"],
  ["EU", "EU"],
  ["EUROPE", "EU"],
  ["유럽", "EU"],
  ["JP", "JP"],
  ["JAPAN", "JP"],
  ["일본", "JP"],
  ["GLOBAL", "GLOBAL"],
  ["INTERNATIONAL", "GLOBAL"],
  ["해외", "GLOBAL"],
]);

const MARKET_DEFAULTS = {
  KR: { language: "ko", currency: "KRW", issuerCountry: "KR" },
  US: { language: "en", currency: "USD", issuerCountry: "US" },
  EU: { language: "en", currency: "EUR", issuerCountry: "EU" },
  JP: { language: "ja", currency: "JPY", issuerCountry: "JP" },
  GLOBAL: { language: "en", currency: "USD", issuerCountry: "" },
  UNKNOWN: { language: "", currency: "", issuerCountry: "" },
};

function cleanText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/[\r\n\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function configuredEngineRoot(env = process.env) {
  const raw = cleanText(env.PB_DAILY_INTELLIGENCE_ENGINE_DIR, 4000);
  if (!raw) throw new Error("PB_DAILY_INTELLIGENCE_ENGINE_DIR가 설정되지 않았습니다.");
  return isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
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

async function driveCredentials(engineRoot, env = process.env) {
  const envPath = join(engineRoot, ".env");
  let dotenv = new Map();
  if (existsSync(envPath)) {
    const info = await stat(envPath);
    if (info.isFile() && info.size <= 1024 * 1024) {
      dotenv = parseDotEnv(await readFile(envPath, "utf8"));
    }
  }
  const value = (name) => cleanText(env[name] || dotenv.get(name), 8000);
  const credentials = {
    clientId: value("GOOGLE_DRIVE_CLIENT_ID"),
    clientSecret: value("GOOGLE_DRIVE_CLIENT_SECRET"),
    refreshToken: value("GOOGLE_DRIVE_REFRESH_TOKEN"),
    folderId: value("GOOGLE_DRIVE_RESEARCH_FOLDER_ID"),
  };
  const missing = Object.entries(credentials)
    .filter(([, item]) => !item)
    .map(([key]) => key);
  if (missing.length) throw new Error("Google Drive 리서치 폴더 연결이 완료되지 않았습니다.");
  return credentials;
}

async function jsonResponse(response, operation) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google Drive ${operation} 실패 (HTTP ${response.status})`);
  }
  return payload;
}

async function driveAccessToken(credentials, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token",
  });
  const payload = await jsonResponse(
    await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
    "인증",
  );
  const token = cleanText(payload.access_token, 8000);
  if (!token) throw new Error("Google Drive 액세스 토큰을 받지 못했습니다.");
  return token;
}

async function listDriveFolder(token, folderId, fetchImpl = fetch) {
  const query = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,modifiedTime,size,md5Checksum,parents)",
    orderBy: "modifiedTime desc",
    pageSize: String(MAX_RESPONSE_FILES),
  });
  const payload = await jsonResponse(
    await fetchImpl(`${DRIVE_FILES_API}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    "파일 목록 조회",
  );
  return Array.isArray(payload.files) ? payload.files : [];
}

async function listDriveFiles(credentials, fetchImpl = fetch) {
  const token = await driveAccessToken(credentials, fetchImpl);
  const files = [];
  const queue = [{ id: credentials.folderId, path: [], depth: 0 }];
  const visited = new Set();
  while (queue.length) {
    const folder = queue.shift();
    if (!folder?.id || visited.has(folder.id)) continue;
    visited.add(folder.id);
    const children = await listDriveFolder(token, folder.id, fetchImpl);
    for (const child of children) {
      const name = cleanText(child?.name, 500);
      if (!name) continue;
      if (child.mimeType === DRIVE_FOLDER_MIME) {
        if (folder.depth < MAX_FOLDER_DEPTH) {
          queue.push({
            id: cleanText(child.id, 300),
            path: [...folder.path, name],
            depth: folder.depth + 1,
          });
        }
        continue;
      }
      files.push({ ...child, researchPath: folder.path });
    }
  }
  return files;
}

function dateFromFileName(fileName, modifiedTime = "") {
  const match = parse(fileName).name.match(/^(\d{4})(\d{2})(\d{2})(?:_|$)/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(modifiedTime);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function normalizedMarketScope(value) {
  return MARKET_SCOPE_ALIASES.get(cleanText(value, 40).toUpperCase()) || "";
}

function inferMarketScope(file, parts, offset) {
  let folderFallback = "";
  for (const segment of Array.isArray(file.researchPath) ? file.researchPath : []) {
    const scope = normalizedMarketScope(segment);
    if (scope === "GLOBAL") folderFallback = scope;
    if (scope && scope !== "GLOBAL") return { scope, consumedFileToken: false };
  }
  if (folderFallback) return { scope: folderFallback, consumedFileToken: false };
  const fromFileName = normalizedMarketScope(parts[offset]);
  if (fromFileName) return { scope: fromFileName, consumedFileToken: true };
  const publisher = cleanText(parts[offset], 180);
  if (/증권|투자증권|자산운용|경제연구소/.test(publisher)) {
    return { scope: "KR", consumedFileToken: false };
  }
  return { scope: "UNKNOWN", consumedFileToken: false };
}

export function inferDriveReportMetadata(file = {}) {
  const fileName = cleanText(file.name, 500);
  const stem = parse(fileName).name;
  const parts = stem.split("_").map((item) => cleanText(item, 180)).filter(Boolean);
  const hasDate = /^\d{8}$/.test(parts[0] || "");
  let offset = hasDate ? 1 : 0;
  const market = inferMarketScope(file, parts, offset);
  if (market.consumedFileToken) offset += 1;
  const publisher = parts[offset] || "발행처 미확인";
  const sector = parts[offset + 1] || "";
  const title = parts.slice(offset + 2).join(" · ") || sector || stem;
  const reportDate = dateFromFileName(fileName, file.modifiedTime);
  const marketDefaults = MARKET_DEFAULTS[market.scope] || MARKET_DEFAULTS.UNKNOWN;
  return {
    publisher,
    title,
    published_at: `${reportDate}T00:00:00+09:00`,
    market_scope: market.scope,
    issuer_country: marketDefaults.issuerCountry,
    original_language: marketDefaults.language,
    base_currency: marketDefaults.currency,
    source_type: "sell_side_research",
    research_path: Array.isArray(file.researchPath)
      ? file.researchPath.map((item) => cleanText(item, 120)).filter(Boolean)
      : [],
    source_reference: `drive:${cleanText(file.id, 300)}`,
    source_url: "",
    acquisition_mode: "operator_authorized_drive",
    analysis_allowed: true,
    redistribution_allowed: false,
    publication_policy: "summary_and_link_only",
    rights_review_status: "operator_confirmed",
    rights_label: "Operator approved private analysis; source-text redistribution is prohibited.",
    tags: sector ? [sector] : [],
    tickers: [],
    research: {
      stance: "not_stated",
      original_rating: "",
      normalized_rating: "not_stated",
      target_price: null,
      target_currency: marketDefaults.currency,
      key_claims: [],
      catalysts: [],
      risks: [],
      sectors: sector ? [sector] : [],
    },
  };
}

async function readApprovalRegistry(path) {
  if (!existsSync(path)) {
    return { schema_version: APPROVAL_SCHEMA, updated_at: "", decisions: [] };
  }
  try {
    const payload = JSON.parse(await readFile(path, "utf8"));
    if (payload?.schema_version !== APPROVAL_SCHEMA || !Array.isArray(payload.decisions)) {
      throw new Error("승인 레지스트리 형식이 올바르지 않습니다.");
    }
    return payload;
  } catch (error) {
    throw new Error(`승인 레지스트리를 읽지 못했습니다: ${error.message}`);
  }
}

async function writeApprovalRegistry(path, payload) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function publicDriveItem(file, sidecars, decisions) {
  const fileId = cleanText(file.id, 300);
  const fileName = cleanText(file.name, 500);
  const sidecarName = `${parse(fileName).name}.meta.json`;
  const decision = decisions.get(fileId);
  const state = sidecars.has(sidecarName)
    ? "ready"
    : decision?.file_name === fileName
      ? decision.decision
      : "pending";
  return {
    fileId,
    fileName,
    modifiedTime: cleanText(file.modifiedTime, 80),
    size: Number(file.size) || 0,
    state,
    inferred: inferDriveReportMetadata(file),
    driveUrl: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`,
    decidedAt: cleanText(decision?.decided_at, 80),
  };
}

export function createPbBrokerResearchApprovalService({
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
} = {}) {
  async function loadState() {
    const engineRoot = configuredEngineRoot(env);
    const credentials = await driveCredentials(engineRoot, env);
    const approvalPath = join(engineRoot, APPROVAL_RELATIVE_PATH);
    const [files, registry] = await Promise.all([
      listDriveFiles(credentials, fetchImpl),
      readApprovalRegistry(approvalPath),
    ]);
    const sidecars = new Set(
      files.map((file) => cleanText(file.name, 500)).filter((name) => name.endsWith(".meta.json")),
    );
    const decisions = new Map(
      registry.decisions
        .filter((item) => item && typeof item === "object")
        .map((item) => [cleanText(item.file_id, 300), item]),
    );
    const items = files
      .filter((file) => SUPPORTED_SUFFIXES.has(parse(cleanText(file.name, 500)).ext.toLowerCase()))
      .map((file) => publicDriveItem(file, sidecars, decisions));
    return {
      engineRoot,
      approvalPath,
      registry,
      files,
      items,
    };
  }

  async function status() {
    const state = await loadState();
    const count = (name) => state.items.filter((item) => item.state === name).length;
    return {
      configured: true,
      counts: {
        total: state.items.length,
        pending: count("pending"),
        approved: count("approved"),
        excluded: count("excluded"),
        ready: count("ready"),
      },
      items: state.items,
    };
  }

  async function decide({ fileId, decision }) {
    const normalizedFileId = cleanText(fileId, 300);
    const normalizedDecision = cleanText(decision, 40);
    if (!normalizedFileId || !["approved", "excluded"].includes(normalizedDecision)) {
      throw new Error("승인 대상과 결정값을 확인하세요.");
    }
    const state = await loadState();
    const file = state.files.find((item) => cleanText(item.id, 300) === normalizedFileId);
    if (!file || !SUPPORTED_SUFFIXES.has(parse(cleanText(file.name, 500)).ext.toLowerCase())) {
      throw new Error("Drive 폴더에서 승인 대상을 찾지 못했습니다.");
    }
    const nextDecision = {
      file_id: normalizedFileId,
      file_name: cleanText(file.name, 500),
      decision: normalizedDecision,
      decided_at: now(),
      metadata: normalizedDecision === "approved" ? inferDriveReportMetadata(file) : undefined,
    };
    const remaining = state.registry.decisions.filter(
      (item) => cleanText(item?.file_id, 300) !== normalizedFileId,
    );
    await writeApprovalRegistry(state.approvalPath, {
      schema_version: APPROVAL_SCHEMA,
      updated_at: now(),
      decisions: [...remaining, nextDecision],
    });
    return status();
  }

  return { status, decide };
}

export const pbBrokerResearchApprovalService = createPbBrokerResearchApprovalService();

export async function handlePbBrokerResearchApprovalsEndpoint(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, { ok: true, ...(await pbBrokerResearchApprovalService.status()) });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const payload = await readJsonBody(req);
    sendJson(res, {
      ok: true,
      ...(await pbBrokerResearchApprovalService.decide(payload)),
    });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
