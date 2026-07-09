import { spawn, spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const CONFIG_DIR = join(GUIBUILD_ROOT, "config");
const SECRETS_DIR = join(GUIBUILD_ROOT, "data", "secrets");
const VAULT_PATH = join(SECRETS_DIR, "tossinvest-credentials.vault.json");
const LEGACY_CREDENTIALS_PATH = join(SECRETS_DIR, "tossinvest-credentials.json");
const ORDER_SYNC_DEFAULT_SETTINGS_PATH = join(CONFIG_DIR, "tossinvest-sync.defaults.json");
const ORDER_SYNC_USER_SETTINGS_PATH = join(CONFIG_DIR, "tossinvest-sync.user.json");
const ORDER_SYNC_STORE_SCRIPT = join(GUIBUILD_ROOT, "scripts", "tossinvest_ledger_store.py");
const ORDER_SYNC_POSITION_RECONSTRUCT_SCRIPT = join(GUIBUILD_ROOT, "scripts", "tossinvest_position_reconstruct.py");
const ORDER_SYNC_DATA_DIR = join(GUIBUILD_ROOT, "data", "tossinvest");
const ORDER_SYNC_LEDGER_PATH = join(GUIBUILD_ROOT, "data", "tossinvest", "tossinvest-ledger.sqlite3");
let orderSyncPythonCommand = null;
let orderSyncReconstructionRun = null;
const VAULT_SCHEMA_VERSION = "finance-agent-gui.tossinvest-credentials.v2";
const VAULT_STORAGE = "aes-256-gcm-scrypt-local-vault";
const VAULT_CIPHER = "aes-256-gcm";
const VAULT_KEY_BYTES = 32;
const VAULT_IV_BYTES = 12;
const VAULT_SALT_BYTES = 16;
const TOKEN_CACHE_SCHEMA_VERSION = "finance-agent-gui.tossinvest-token-cache.v1";
const TOKEN_CACHE_STORAGE = "aes-256-gcm-process-memory";
const TOKEN_CACHE_LABEL = "AES-256-GCM · 메모리 전용";
const TOKEN_CACHE_CIPHER = "aes-256-gcm";
const TOKEN_CACHE_KEY_BYTES = 32;
const TOKEN_CACHE_IV_BYTES = 12;
const MIN_PASSPHRASE_LENGTH = 1;
const SCRYPT_OPTIONS = Object.freeze({
  name: "scrypt",
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const DEFAULT_BASE_URL = "https://openapi.tossinvest.com";
const TOKEN_REFRESH_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const PUBLIC_IP_TIMEOUT_MS = 6_000;
const ORDER_SYNC_STATUS_SCRIPT_TIMEOUT_MS = 15_000;
const ORDER_SYNC_UPSERT_SCRIPT_TIMEOUT_MS = 90_000;
const ORDER_SYNC_RECONSTRUCT_SCRIPT_TIMEOUT_MS = 180_000;
const ORDER_SYNC_LIMIT = 100;
const ORDER_SYNC_DEFAULT_LOOKBACK_DAYS = 3;
const ORDER_SYNC_DEFAULT_MAX_PAGES = 50;
const ORDER_SYNC_MAX_PAGES_PER_RUN = 50;
const ORDER_SYNC_DEFAULT_PAGE_DELAY_MS = 2_000;
const ORDER_SYNC_MIN_PAGE_DELAY_MS = 1_000;
const ORDER_SYNC_MAX_PAGE_DELAY_MS = 10_000;
const MARKET_DATA_CONCURRENCY = 3;
const MARKET_CANDLE_PAGE_LIMIT = 30;
const LIVE_INVESTMENT_STATUS_CACHE_TTL_MS = 900;
const LIVE_INVESTMENT_STATUS_REFRESH_MS = 1_000;
const LIVE_INVESTMENT_STATUS_RETRY_OPTIONS = { retries: 1, retryRateLimited: false };
const TOSS_RATE_LIMIT_GROUPS = Object.freeze({
  ACCOUNT: { maxPerSecond: 3, minIntervalMs: 350 },
  ASSET: { maxPerSecond: 3, minIntervalMs: 350 },
  MARKET_INFO: { maxPerSecond: 3, minIntervalMs: 350 },
  MARKET_DATA: { maxPerSecond: 10, minIntervalMs: 120 },
  MARKET_DATA_CHART: { maxPerSecond: 5, minIntervalMs: 220 },
  STOCK: { maxPerSecond: 3, minIntervalMs: 350 },
});

const READ_ONLY_CAPABILITIES = [
  "oauth2-token",
  "accounts",
  "holdings",
  "prices",
  "candles",
  "stocks",
  "exchange-rate",
  "market-calendar",
  "order-history",
  "conditional-order-history",
];

const TOSS_IP_ALLOWLIST_ERROR_MESSAGE =
  "IP 연결 오류입니다.\n토스 증권 PC 버전의 설정 → Open API → 허용 IP 관리 → IP 추가 메뉴에서 현재 사용중이신 회선의 IP 주소를 아직 등록하지 않았을 가능성이 있습니다.";
const TOSS_IP_ALLOWLIST_ERROR_CODE = "toss_ip_allowlist";
const TOSS_CLIENT_ID_AUTH_ERROR_CODE = "toss_client_id_auth";
const TOSS_CLIENT_SECRET_AUTH_ERROR_CODE = "toss_client_secret_auth";
const TOSS_CLIENT_AUTH_ERROR_CODE = "toss_client_auth";
const TOSS_CLIENT_ID_AUTH_ERROR_MESSAGE =
  "입력된 API Key가 인증에 실패했습니다. (정확한 API Key를 입력했는지 확인해 보세요)";
const TOSS_CLIENT_SECRET_AUTH_ERROR_MESSAGE =
  "입력된 Secret Key가 인증에 실패했습니다. (정확한 Secret Key를 입력했는지 확인해 보세요)";
const TOSS_CLIENT_AUTH_ERROR_MESSAGE =
  "입력된 API Key 또는 Secret Key가 인증에 실패했습니다. (정확한 키를 입력했는지 확인해 보세요)";
const TOSS_TOKEN_INVALID_ERROR_MESSAGE =
  "토스증권 인증 토큰이 만료되었거나 유효하지 않습니다. 상태 확인을 다시 눌러 연결을 갱신해 보세요.";
const TOSS_PERMISSION_ERROR_MESSAGE =
  "토스증권 API 권한이 거부되었습니다. Open API 사용 권한과 허용 IP 설정을 확인해 보세요.";
const TOSS_REQUEST_FORMAT_ERROR_MESSAGE =
  "토스증권 API 요청 형식이 올바르지 않습니다. 입력값을 확인한 뒤 다시 시도해 보세요.";

const BLOCKED_WRITE_CAPABILITIES = [
  "order-create",
  "order-modify",
  "order-cancel",
  "conditional-order-create",
  "conditional-order-modify",
  "conditional-order-cancel",
];

const PUBLIC_IP_SOURCES = [
  { family: "IPv4", url: "https://api4.ipify.org?format=json", jsonField: "ip" },
  { family: "IPv4", url: "https://ipv4.icanhazip.com" },
  { family: "IPv6", url: "https://api6.ipify.org?format=json", jsonField: "ip" },
  { family: "IPv6", url: "https://ipv6.icanhazip.com" },
];

let tokenCache = null;
let tokenRequestPromise = null;
let tokenRequestPromiseScope = "";
let unlockedCredentialSession = null;
let tokenEncryptionKey = randomBytes(TOKEN_CACHE_KEY_BYTES);
const liveInvestmentStatusCache = new Map();
const liveInvestmentStatusInFlight = new Map();

function ensureSecretsDir() {
  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(SECRETS_DIR, 0o700);
  } catch {
    // Best effort on platforms that do not support POSIX modes.
  }
}

function ensureConfigDir() {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

function relativeAppPath(path) {
  return path.startsWith(GUIBUILD_ROOT) ? relative(GUIBUILD_ROOT, path) || "." : path;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return DEFAULT_BASE_URL;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function baseUrl() {
  return normalizeBaseUrl(process.env.TOSSINVEST_BASE_URL);
}

function cleanText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function cleanDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || "").trim());
  if (!match) return "";
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ? date : "";
}

function maskSecret(value, visibleStart = 5, visibleEnd = 4) {
  const text = cleanText(value, 300);
  if (!text) return "";
  if (text.length <= visibleStart + visibleEnd + 3) return `${text.slice(0, 2)}...`;
  return `${text.slice(0, visibleStart)}...${text.slice(-visibleEnd)}`;
}

function hashFingerprint(value, length = 12) {
  const text = cleanText(value, 4000);
  if (!text) return "";
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

function base64Encode(value) {
  return Buffer.from(value).toString("base64");
}

function base64Decode(value, field) {
  try {
    const buffer = Buffer.from(String(value || ""), "base64");
    if (!buffer.length) throw new Error("empty");
    return buffer;
  } catch {
    throw inputError(`${field} 형식이 올바르지 않습니다.`);
  }
}

function inputError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function passphraseFromPayload(payload = {}) {
  const passphrase = String(payload.passphrase || payload.password || "");
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw inputError("저장소 패스워드를 입력해야 합니다.");
  }
  return passphrase;
}

function deriveVaultKey(passphrase, salt, kdf = {}) {
  const N = Math.max(16384, Number(kdf.N || SCRYPT_OPTIONS.N));
  const r = Math.max(8, Number(kdf.r || SCRYPT_OPTIONS.r));
  const p = Math.max(1, Number(kdf.p || SCRYPT_OPTIONS.p));
  const maxmem = Math.max(Number(kdf.maxmem || 0), SCRYPT_OPTIONS.maxmem, 128 * N * r * 2);
  return scryptSync(passphrase, salt, VAULT_KEY_BYTES, { N, r, p, maxmem });
}

function safeJsonParseFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  return safeJsonParseFile(path);
}

function clampInteger(value, fallback, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeStoredCredentials(payload = {}) {
  const clientId = cleanText(payload.clientId || payload.client_id || payload.appKey || "", 300);
  const clientSecret = cleanText(payload.clientSecret || payload.client_secret || payload.secretKey || "", 1000);
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    updatedAt: cleanText(payload.updatedAt || "", 80),
  };
}

function validVaultPayload(payload) {
  return Boolean(
    payload &&
      payload.schemaVersion === VAULT_SCHEMA_VERSION &&
      payload.storage === VAULT_STORAGE &&
      payload.kdf?.name === SCRYPT_OPTIONS.name &&
      payload.kdf?.salt &&
      payload.cipher?.name === VAULT_CIPHER &&
      payload.cipher?.iv &&
      payload.cipher?.tag &&
      payload.cipher?.ciphertext
  );
}

function vaultPayload() {
  if (!existsSync(VAULT_PATH)) return null;
  return safeJsonParseFile(VAULT_PATH);
}

function encryptedVaultExists() {
  return existsSync(VAULT_PATH);
}

function legacyPlaintextExists() {
  return existsSync(LEGACY_CREDENTIALS_PATH);
}

function vaultFingerprint(payload) {
  if (!payload) return "";
  return hashFingerprint(`${payload.schemaVersion}:${payload.updatedAt}:${payload.cipher?.ciphertext || ""}`, 16);
}

function rotateTokenEncryptionKey() {
  try {
    tokenEncryptionKey.fill(0);
  } catch {
    // Best effort only; the process-local key is replaced below.
  }
  tokenEncryptionKey = randomBytes(TOKEN_CACHE_KEY_BYTES);
}

function clearTokenCache({ rotateKey = true } = {}) {
  tokenCache = null;
  tokenRequestPromise = null;
  tokenRequestPromiseScope = "";
  if (rotateKey) rotateTokenEncryptionKey();
}

function clearLiveInvestmentStatusCache() {
  liveInvestmentStatusCache.clear();
  liveInvestmentStatusInFlight.clear();
}

function encryptTokenForCache(accessToken) {
  const token = cleanText(accessToken, 4000);
  if (!token) throw new Error("암호화할 토큰이 없습니다.");
  const iv = randomBytes(TOKEN_CACHE_IV_BYTES);
  const cipher = createCipheriv(TOKEN_CACHE_CIPHER, tokenEncryptionKey, iv);
  cipher.setAAD(Buffer.from(TOKEN_CACHE_SCHEMA_VERSION, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(token, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    schemaVersion: TOKEN_CACHE_SCHEMA_VERSION,
    storage: TOKEN_CACHE_STORAGE,
    cipher: {
      name: TOKEN_CACHE_CIPHER,
      iv: base64Encode(iv),
      tag: base64Encode(tag),
      ciphertext: base64Encode(ciphertext),
    },
  };
}

function decryptTokenFromCache(cache = tokenCache) {
  if (!cache?.encryptedAccessToken?.cipher) {
    throw new Error("토큰 캐시 형식이 올바르지 않습니다.");
  }
  const payload = cache.encryptedAccessToken;
  if (payload.schemaVersion !== TOKEN_CACHE_SCHEMA_VERSION || payload.storage !== TOKEN_CACHE_STORAGE) {
    throw new Error("토큰 캐시 형식이 올바르지 않습니다.");
  }
  const iv = base64Decode(payload.cipher.iv, "토큰 캐시 iv");
  const tag = base64Decode(payload.cipher.tag, "토큰 캐시 tag");
  const ciphertext = base64Decode(payload.cipher.ciphertext, "토큰 캐시 ciphertext");
  try {
    const decipher = createDecipheriv(TOKEN_CACHE_CIPHER, tokenEncryptionKey, iv);
    decipher.setAAD(Buffer.from(TOKEN_CACHE_SCHEMA_VERSION, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    clearTokenCache();
    throw inputError("토큰 캐시를 복호화하지 못했습니다. 다시 연결 테스트를 실행해 주세요.", 401);
  }
}

function vaultMetadata() {
  const exists = encryptedVaultExists();
  const payload = exists ? vaultPayload() : null;
  const valid = validVaultPayload(payload);
  return {
    exists,
    valid,
    invalid: exists && !valid,
    updatedAt: valid ? cleanText(payload.updatedAt || "", 80) : "",
    storage: valid ? cleanText(payload.storage || VAULT_STORAGE, 80) : "",
    cipher: valid ? cleanText(payload.cipher?.name || VAULT_CIPHER, 40) : "",
    kdf: valid ? cleanText(payload.kdf?.name || SCRYPT_OPTIONS.name, 40) : "",
    fingerprint: valid ? vaultFingerprint(payload) : "",
  };
}

function encryptCredentials(credentials, passphrase) {
  const salt = randomBytes(VAULT_SALT_BYTES);
  const iv = randomBytes(VAULT_IV_BYTES);
  const key = deriveVaultKey(passphrase, salt, SCRYPT_OPTIONS);
  try {
    const plaintext = Buffer.from(
      JSON.stringify({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        encryptedAt: new Date().toISOString(),
      }),
      "utf8"
    );
    const cipher = createCipheriv(VAULT_CIPHER, key, iv);
    cipher.setAAD(Buffer.from(VAULT_SCHEMA_VERSION, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      schemaVersion: VAULT_SCHEMA_VERSION,
      storage: VAULT_STORAGE,
      updatedAt: new Date().toISOString(),
      kdf: {
        name: SCRYPT_OPTIONS.name,
        N: SCRYPT_OPTIONS.N,
        r: SCRYPT_OPTIONS.r,
        p: SCRYPT_OPTIONS.p,
        salt: base64Encode(salt),
      },
      cipher: {
        name: VAULT_CIPHER,
        iv: base64Encode(iv),
        tag: base64Encode(tag),
        ciphertext: base64Encode(ciphertext),
      },
    };
  } finally {
    key.fill(0);
  }
}

function decryptCredentials(payload, passphrase) {
  if (!validVaultPayload(payload)) {
    throw inputError("토스증권 키 저장소 형식이 올바르지 않습니다.", 500);
  }
  const salt = base64Decode(payload.kdf.salt, "저장소 salt");
  const iv = base64Decode(payload.cipher.iv, "저장소 iv");
  const tag = base64Decode(payload.cipher.tag, "저장소 tag");
  const ciphertext = base64Decode(payload.cipher.ciphertext, "저장소 ciphertext");
  const key = deriveVaultKey(passphrase, salt, payload.kdf);
  try {
    const decipher = createDecipheriv(VAULT_CIPHER, key, iv);
    decipher.setAAD(Buffer.from(VAULT_SCHEMA_VERSION, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const credentials = normalizeStoredCredentials(JSON.parse(plaintext));
    if (!credentials) throw new Error("missing credentials");
    return credentials;
  } catch {
    throw inputError("저장소 패스워드가 올바르지 않거나 파일이 손상되었습니다.", 401);
  } finally {
    key.fill(0);
  }
}

function envCredentials() {
  const clientId = cleanText(process.env.TOSSINVEST_CLIENT_ID || process.env.TOSS_INVEST_CLIENT_ID || "", 300);
  const clientSecret = cleanText(
    process.env.TOSSINVEST_CLIENT_SECRET || process.env.TOSS_INVEST_CLIENT_SECRET || "",
    1000
  );
  if (!clientId || !clientSecret) return null;
  return {
    source: "env",
    clientId,
    clientSecret,
    updatedAt: "",
  };
}

function sessionCredentials() {
  const metadata = vaultMetadata();
  if (!unlockedCredentialSession?.clientId || !unlockedCredentialSession?.clientSecret) return null;
  if (!metadata.valid || metadata.fingerprint !== unlockedCredentialSession.vaultFingerprint) return null;
  return {
    source: "vault",
    clientId: unlockedCredentialSession.clientId,
    clientSecret: unlockedCredentialSession.clientSecret,
    updatedAt: unlockedCredentialSession.updatedAt || metadata.updatedAt,
    unlockedAt: unlockedCredentialSession.unlockedAt || "",
  };
}

function readCredentials() {
  return envCredentials() || sessionCredentials();
}

function readCredentialsOrThrow() {
  const credentials = readCredentials();
  if (credentials?.clientId && credentials?.clientSecret && !credentials.invalid) {
    return credentials;
  }
  const metadata = vaultMetadata();
  if (metadata.valid) {
    throw inputError("토스증권 API 키 저장소가 잠겨 있습니다. 설정에서 패스워드로 잠금 해제하세요.", 423);
  }
  if (metadata.invalid) {
    throw inputError("토스증권 API 키 저장소 형식이 올바르지 않습니다.", 500);
  }
  throw inputError("토스증권 API 키가 설정되어 있지 않습니다.", 404);
}

function credentialCacheScope(credentials = {}) {
  return [
    credentials.source || "unknown",
    hashFingerprint(credentials.clientId || ""),
    hashFingerprint(credentials.clientSecret || ""),
    credentials.updatedAt || "",
    credentials.unlockedAt || "",
  ].join(":");
}

function publicCredentialsStatus() {
  const env = envCredentials();
  const session = sessionCredentials();
  const metadata = vaultMetadata();
  const credentials = env || session;
  const usable = Boolean(credentials?.clientId && credentials?.clientSecret);
  const configured = Boolean(env || metadata.exists);
  const source = env ? "env" : metadata.exists ? "vault" : "";
  return {
    configured,
    usable,
    unlocked: Boolean(env || session),
    locked: Boolean(!env && metadata.valid && !session),
    invalid: Boolean(!env && metadata.invalid),
    source,
    storage: env ? "environment" : metadata.storage,
    cipher: metadata.cipher,
    kdf: metadata.kdf,
    clientIdMasked: usable ? maskSecret(credentials.clientId) : "",
    clientIdFingerprint: usable ? hashFingerprint(credentials.clientId) : "",
    updatedAt: env ? "" : credentials?.updatedAt || metadata.updatedAt || "",
    unlockedAt: env ? "" : credentials?.unlockedAt || "",
    credentialsFile: relativeAppPath(VAULT_PATH),
    legacyCredentialsFile: relativeAppPath(LEGACY_CREDENTIALS_PATH),
    legacyPlaintextPresent: legacyPlaintextExists(),
    envKeys: ["TOSSINVEST_CLIENT_ID", "TOSSINVEST_CLIENT_SECRET"],
    minPassphraseLength: MIN_PASSPHRASE_LENGTH,
  };
}

function publicTokenStatus() {
  const expiresAtMs = Number(tokenCache?.expiresAtMs || 0);
  const now = Date.now();
  return {
    cached: Boolean(tokenCache?.encryptedAccessToken && expiresAtMs > now),
    expiresAt: expiresAtMs > 0 ? new Date(expiresAtMs).toISOString() : "",
    ttlSeconds: expiresAtMs > now ? Math.max(0, Math.floor((expiresAtMs - now) / 1000)) : 0,
    tokenType: tokenCache?.tokenType || "",
    tokenFingerprint: tokenCache?.fingerprint || "",
    encryption: TOKEN_CACHE_STORAGE,
    encryptionLabel: TOKEN_CACHE_LABEL,
    encrypted: Boolean(tokenCache?.encryptedAccessToken),
  };
}

function publicStatus(extra = {}) {
  return {
    ok: true,
    readOnly: true,
    baseUrl: baseUrl(),
    credentials: publicCredentialsStatus(),
    token: publicTokenStatus(),
    allowedCapabilities: READ_ONLY_CAPABILITIES,
    blockedWriteCapabilities: BLOCKED_WRITE_CAPABILITIES,
    ...extra,
  };
}

function writeCredentials(payload = {}) {
  const clientId = cleanText(payload.clientId || payload.client_id || "", 300);
  const clientSecret = cleanText(payload.clientSecret || payload.client_secret || "", 1000);
  if (!clientId || !clientSecret) {
    throw inputError("API Key와 Secret Key를 모두 입력해야 합니다.");
  }
  const passphrase = passphraseFromPayload(payload);
  ensureSecretsDir();
  const vault = encryptCredentials({ clientId, clientSecret }, passphrase);
  const body = `${JSON.stringify(vault, null, 2)}\n`;
  const tmpPath = `${VAULT_PATH}.tmp`;
  writeFileSync(tmpPath, body, { mode: 0o600 });
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    // Best effort on platforms that do not support POSIX modes.
  }
  renameSync(tmpPath, VAULT_PATH);
  try {
    chmodSync(VAULT_PATH, 0o600);
  } catch {
    // Best effort on platforms that do not support POSIX modes.
  }
  if (legacyPlaintextExists()) {
    rmSync(LEGACY_CREDENTIALS_PATH, { force: true });
  }
  unlockedCredentialSession = {
    clientId,
    clientSecret,
    updatedAt: vault.updatedAt,
    unlockedAt: new Date().toISOString(),
    vaultFingerprint: vaultFingerprint(vault),
  };
  clearTokenCache();
  clearLiveInvestmentStatusCache();
}

function deleteOrderSyncLedger() {
  const candidates = [
    ORDER_SYNC_LEDGER_PATH,
    `${ORDER_SYNC_LEDGER_PATH}-wal`,
    `${ORDER_SYNC_LEDGER_PATH}-shm`,
    `${ORDER_SYNC_LEDGER_PATH}-journal`,
  ];
  if (existsSync(ORDER_SYNC_DATA_DIR)) {
    for (const filename of readdirSync(ORDER_SYNC_DATA_DIR)) {
      if (filename.startsWith("position-reconstruction-")) {
        candidates.push(join(ORDER_SYNC_DATA_DIR, filename));
      }
    }
    candidates.push(join(ORDER_SYNC_DATA_DIR, "market-candles"));
    candidates.push(join(ORDER_SYNC_DATA_DIR, "fx-usdkrw-tossinvest.json"));
    candidates.push(join(ORDER_SYNC_DATA_DIR, "fx-usdkrw-yfinance.json"));
  }
  let deleted = false;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true, recursive: true });
      deleted = true;
    }
  }
  return deleted;
}

function deleteCredentials() {
  let deletedCredentials = false;
  if (existsSync(VAULT_PATH)) {
    rmSync(VAULT_PATH, { force: true });
    deletedCredentials = true;
  }
  if (existsSync(LEGACY_CREDENTIALS_PATH)) {
    rmSync(LEGACY_CREDENTIALS_PATH, { force: true });
    deletedCredentials = true;
  }
  const deletedOrderSyncLedger = deleteOrderSyncLedger();
  unlockedCredentialSession = null;
  clearTokenCache();
  clearLiveInvestmentStatusCache();
  return { deletedCredentials, deletedOrderSyncLedger };
}

function unlockCredentials(payload = {}) {
  const env = envCredentials();
  if (env) return;
  if (!encryptedVaultExists()) {
    throw inputError("저장된 토스증권 키 저장소가 없습니다.", 404);
  }
  const passphrase = passphraseFromPayload(payload);
  const vault = vaultPayload();
  const credentials = decryptCredentials(vault, passphrase);
  unlockedCredentialSession = {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    updatedAt: credentials.updatedAt || vault.updatedAt || "",
    unlockedAt: new Date().toISOString(),
    vaultFingerprint: vaultFingerprint(vault),
  };
  clearTokenCache();
  clearLiveInvestmentStatusCache();
}

function lockCredentials() {
  unlockedCredentialSession = null;
  clearTokenCache();
  clearLiveInvestmentStatusCache();
}

function cachedTokenValid(credentialsScope = "") {
  return Boolean(
    tokenCache?.encryptedAccessToken &&
      tokenCache?.credentialScope === credentialsScope &&
      Number(tokenCache.expiresAtMs || 0) - TOKEN_REFRESH_SKEW_MS > Date.now()
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePublicIp(value, expectedFamily) {
  const candidate = cleanText(value, 120).replace(/^"|"$/g, "");
  const version = isIP(candidate);
  if (!version) return "";
  const family = version === 4 ? "IPv4" : "IPv6";
  return family === expectedFamily ? candidate : "";
}

async function fetchPublicIpFromSource(source) {
  const response = await fetchWithTimeout(
    source.url,
    { method: "GET", headers: { Accept: "application/json, text/plain;q=0.9" } },
    PUBLIC_IP_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  let value = text;
  if (source.jsonField) {
    try {
      value = JSON.parse(text)?.[source.jsonField] || "";
    } catch {
      value = "";
    }
  }
  const address = normalizePublicIp(value, source.family);
  if (!address) throw new Error("invalid public IP response");
  return address;
}

async function lookupPublicIp() {
  const failures = [];
  for (const source of PUBLIC_IP_SOURCES) {
    try {
      const address = await fetchPublicIpFromSource(source);
      return {
        ok: true,
        address,
        family: source.family,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      failures.push({ family: source.family, source: new URL(source.url).hostname, error: error.message });
    }
  }
  const error = inputError("현재 공인 IP 주소를 확인하지 못했습니다. 네트워크 연결 또는 VPN 설정을 확인해 주세요.", 502);
  error.failures = failures;
  throw error;
}

function normalizeOrderSyncSettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    enabled: source.enabled === true,
    lookbackDays: clampInteger(source.lookbackDays, ORDER_SYNC_DEFAULT_LOOKBACK_DAYS, 1, 30),
    maxPagesPerRun: clampInteger(source.maxPagesPerRun, ORDER_SYNC_DEFAULT_MAX_PAGES, 1, ORDER_SYNC_MAX_PAGES_PER_RUN),
    pageDelayMs: clampInteger(
      source.pageDelayMs,
      ORDER_SYNC_DEFAULT_PAGE_DELAY_MS,
      ORDER_SYNC_MIN_PAGE_DELAY_MS,
      ORDER_SYNC_MAX_PAGE_DELAY_MS
    ),
    updatedAt: cleanText(source.updatedAt || "", 80),
  };
}

function readOrderSyncSettings() {
  ensureConfigDir();
  return normalizeOrderSyncSettings({
    version: 1,
    enabled: false,
    lookbackDays: ORDER_SYNC_DEFAULT_LOOKBACK_DAYS,
    maxPagesPerRun: ORDER_SYNC_DEFAULT_MAX_PAGES,
    pageDelayMs: ORDER_SYNC_DEFAULT_PAGE_DELAY_MS,
    ...(readJsonFile(ORDER_SYNC_DEFAULT_SETTINGS_PATH) || {}),
    ...(readJsonFile(ORDER_SYNC_USER_SETTINGS_PATH) || {}),
  });
}

function writeOrderSyncSettingsPatch(patch = {}) {
  ensureConfigDir();
  const source = patch && typeof patch === "object" ? patch : {};
  const current = readOrderSyncSettings();
  const hasEnabled = Object.prototype.hasOwnProperty.call(source, "enabled");
  const hasLookbackDays = Object.prototype.hasOwnProperty.call(source, "lookbackDays");
  const hasMaxPagesPerRun = Object.prototype.hasOwnProperty.call(source, "maxPagesPerRun");
  const hasPageDelayMs = Object.prototype.hasOwnProperty.call(source, "pageDelayMs");
  if (!hasEnabled && !hasLookbackDays && !hasMaxPagesPerRun && !hasPageDelayMs) {
    throw inputError("enabled, lookbackDays, maxPagesPerRun, or pageDelayMs is required");
  }
  const nextSettings = normalizeOrderSyncSettings({
    ...current,
    ...(hasEnabled ? { enabled: source.enabled === true } : {}),
    ...(hasLookbackDays ? { lookbackDays: source.lookbackDays } : {}),
    ...(hasMaxPagesPerRun ? { maxPagesPerRun: source.maxPagesPerRun } : {}),
    ...(hasPageDelayMs ? { pageDelayMs: source.pageDelayMs } : {}),
    updatedAt: new Date().toISOString(),
  });
  writeFileSync(ORDER_SYNC_USER_SETTINGS_PATH, `${JSON.stringify(nextSettings, null, 2)}\n`);
  return nextSettings;
}

function sleep(ms) {
  const delayMs = Math.max(0, Number(ms || 0));
  if (!delayMs) return Promise.resolve();
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

function createOrderHistoryPacer(pageDelayMs) {
  let nextAllowedAt = 0;
  return async () => {
    const now = Date.now();
    if (nextAllowedAt > now) {
      await sleep(nextAllowedAt - now);
    }
    nextAllowedAt = Date.now() + Math.max(0, Number(pageDelayMs || 0));
  };
}

function createTossRateLimitPacer({ groups = TOSS_RATE_LIMIT_GROUPS, now = () => Date.now(), delay = sleep } = {}) {
  const stateByGroup = new Map();
  return async function pace(groupName) {
    const group = groups[groupName] ? groupName : "MARKET_INFO";
    const config = groups[group];
    const current = stateByGroup.get(group) || { nextAllowedAt: 0, chain: Promise.resolve() };
    const chain = current.chain.catch(() => {}).then(async () => {
      const state = stateByGroup.get(group) || current;
      const waitMs = Math.max(0, Number(state.nextAllowedAt || 0) - now());
      if (waitMs) await delay(waitMs);
      state.nextAllowedAt = now() + config.minIntervalMs;
      stateByGroup.set(group, state);
    });
    stateByGroup.set(group, { nextAllowedAt: current.nextAllowedAt, chain });
    await chain;
  };
}

let paceTossRateLimitGroup = createTossRateLimitPacer();

function tossRateLimitGroupForPath(path) {
  const normalized = String(path || "").toLowerCase();
  if (normalized.startsWith("/api/v1/prices") || normalized.startsWith("/api/v1/orderbook") || normalized.startsWith("/api/v1/trades")) {
    return "MARKET_DATA";
  }
  if (normalized.startsWith("/api/v1/candles")) return "MARKET_DATA_CHART";
  if (normalized.startsWith("/api/v1/stocks")) return "STOCK";
  if (normalized.startsWith("/api/v1/accounts")) return "ACCOUNT";
  if (normalized.startsWith("/api/v1/holdings")) return "ASSET";
  if (normalized.startsWith("/api/v1/exchange-rate") || normalized.startsWith("/api/v1/market-calendar")) return "MARKET_INFO";
  return "MARKET_INFO";
}

function findPythonCommand() {
  if (orderSyncPythonCommand) return orderSyncPythonCommand;
  const localVenvPython =
    process.platform === "win32"
      ? join(GUIBUILD_ROOT, ".venv", "Scripts", "python.exe")
      : join(GUIBUILD_ROOT, ".venv", "bin", "python");
  const candidates =
    process.platform === "win32"
      ? [
          { command: localVenvPython, argsPrefix: [], display: ".venv/Scripts/python.exe" },
          { command: "py", argsPrefix: ["-3"], display: "py -3" },
          { command: "python", argsPrefix: [], display: "python" },
          { command: "python3", argsPrefix: [], display: "python3" },
        ]
      : [
          { command: localVenvPython, argsPrefix: [], display: ".venv/bin/python" },
          { command: "python3", argsPrefix: [], display: "python3" },
          { command: "python", argsPrefix: [], display: "python" },
        ];

  for (const candidate of candidates) {
    if (candidate.command.includes(".venv") && !existsSync(candidate.command)) continue;
    const result = spawnSync(candidate.command, [...candidate.argsPrefix, "--version"], {
      encoding: "utf8",
      timeout: 3000,
    });
    if (!result.error && result.status === 0) {
      orderSyncPythonCommand = candidate;
      return candidate;
    }
  }
  return null;
}

function orderSyncStoreTimeoutMessage() {
  return "거래내역 SQLite 저장소 응답 시간이 초과되었습니다. 진행 중인 동기화가 끝난 뒤 다시 시도해 주세요.";
}

function runPythonJsonScript(
  scriptPath,
  args = [],
  payload = null,
  {
    timeoutMs = ORDER_SYNC_STATUS_SCRIPT_TIMEOUT_MS,
    missingMessage = "Python 스크립트를 찾지 못했습니다.",
    timeoutMessage = "Python 스크립트 응답 시간이 초과되었습니다.",
    failureMessage = "Python 스크립트 작업에 실패했습니다.",
  } = {}
) {
  const python = findPythonCommand();
  if (!python) {
    throw inputError("Python 실행 파일을 찾지 못했습니다.", 500);
  }
  if (!existsSync(scriptPath)) {
    throw inputError(missingMessage, 500);
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(python.command, [...python.argsPrefix, scriptPath, ...args], {
      cwd: GUIBUILD_ROOT,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2000);
    }, timeoutMs);

    function finish(error, status = 0) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectPromise(inputError(error.message || failureMessage, 500));
        return;
      }
      const parsed = safeJsonTextParse(stdout);
      if (timedOut || status !== 0 || !parsed?.ok) {
        const message = timedOut
          ? timeoutMessage
          : parsed?.error || stderr.trim() || failureMessage;
        rejectPromise(inputError(message, 500));
        return;
      }
      resolvePromise({
        ...parsed,
        python: {
          display: python.display,
        },
      });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (status) => finish(null, status ?? 1));
    child.stdin.end(payload ? JSON.stringify(payload) : "");
  });
}

function runOrderSyncStore(command, payload = null, { timeoutMs = ORDER_SYNC_STATUS_SCRIPT_TIMEOUT_MS } = {}) {
  return runPythonJsonScript(ORDER_SYNC_STORE_SCRIPT, [command], payload, {
    timeoutMs,
    missingMessage: "거래내역 저장 스크립트를 찾지 못했습니다.",
    timeoutMessage: orderSyncStoreTimeoutMessage(),
    failureMessage: "거래내역 저장소 작업에 실패했습니다.",
  });
}

async function rebuildOrderSyncPositionSnapshots(payload = null) {
  try {
    const marketContext = await runPythonJsonScript(ORDER_SYNC_POSITION_RECONSTRUCT_SCRIPT, ["market-context"], payload, {
      timeoutMs: ORDER_SYNC_STATUS_SCRIPT_TIMEOUT_MS,
      missingMessage: "거래내역 복원 스크립트를 찾지 못했습니다.",
      timeoutMessage: "거래내역 시장데이터 요청 범위를 계산하지 못했습니다.",
      failureMessage: "거래내역 시장데이터 요청 범위 계산에 실패했습니다.",
    });
    if (payload?.runId && orderSyncReconstructionRun?.runId === payload.runId) {
      const totalSnapshots = Number(marketContext?.dailyTargetCount || 0) + Number(marketContext?.monthlyTargetCount || 0);
      orderSyncReconstructionRun = {
        ...orderSyncReconstructionRun,
        phase: "market-data",
        asOf: marketContext?.endDate || "",
        progress: {
          completed: 0,
          total: Number.isFinite(totalSnapshots) ? totalSnapshots : 0,
          percent: 0,
          rowCount: 0,
          dailyTargetCount: Number(marketContext?.dailyTargetCount || 0),
          monthlyTargetCount: Number(marketContext?.monthlyTargetCount || 0),
        },
      };
    }
    const marketData = marketContext?.symbolCount
      ? await buildTossInvestMarketData(marketContext)
      : {
          ok: false,
          source: "tossinvest-openapi",
          fetchedAt: new Date().toISOString(),
          startDate: marketContext?.startDate || "",
          endDate: marketContext?.endDate || "",
          candlesBySymbol: {},
          fxRates: {},
          errors: [],
        };
    return await runPythonJsonScript(ORDER_SYNC_POSITION_RECONSTRUCT_SCRIPT, ["rebuild"], { ...(payload || {}), marketData }, {
      timeoutMs: ORDER_SYNC_RECONSTRUCT_SCRIPT_TIMEOUT_MS,
      missingMessage: "거래내역 복원 스크립트를 찾지 못했습니다.",
      timeoutMessage: "거래내역 스냅샷 복원 시간이 초과되었습니다. 거래내역 동기화는 저장되었지만 스냅샷은 나중에 다시 생성해 주세요.",
      failureMessage: "거래내역 스냅샷 복원에 실패했습니다.",
    });
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || "").includes("missing ledger DB")
        ? "거래내역 SQLite 저장소가 아직 없습니다."
        : error.message,
    };
  }
}

function safeJsonTextParse(text) {
  try {
    return JSON.parse(String(text || "").trim());
  } catch {
    return null;
  }
}

function orderSyncStoreStatus() {
  return runOrderSyncStore("status");
}

async function latestOrderSyncReconstructionStatus(store = null) {
  const payload = await runPythonJsonScript(ORDER_SYNC_POSITION_RECONSTRUCT_SCRIPT, ["rebuild-status"], null, {
    timeoutMs: ORDER_SYNC_STATUS_SCRIPT_TIMEOUT_MS,
    missingMessage: "거래내역 복원 스크립트를 찾지 못했습니다.",
    timeoutMessage: "거래내역 스냅샷 상태 확인 시간이 초과되었습니다.",
    failureMessage: "거래내역 스냅샷 상태 확인에 실패했습니다.",
  }).catch(() => null);
  const reconstruction = payload?.reconstruction || null;
  if (!reconstruction) return null;
  const latestOrderDate = cleanDateKey(store?.latestOrderedAt || "");
  const reconstructionAsOfDate = cleanDateKey(reconstruction.asOf || "");
  const staleByOrder = Boolean(latestOrderDate && reconstructionAsOfDate && reconstructionAsOfDate < latestOrderDate);
  const stale = staleByOrder;
  return {
    ...reconstruction,
    ok: reconstruction.ok === true && !stale,
    status: stale ? "stale" : reconstruction.status || "unknown",
    latestOrderDate,
    staleReason: staleByOrder ? "orders-newer-than-snapshot" : "",
  };
}

async function currentHoldingsPayloadForRebuild(store) {
  const accountSeqs = [
    ...new Set(
      (Array.isArray(store?.states) ? store.states : [])
        .map((state) => cleanText(state?.account_seq || "", 40))
        .filter(Boolean)
    ),
  ];
  const accounts = [];
  for (const accountSeq of accountSeqs) {
    const holdings = await tossGet("/api/v1/holdings", { accountSeq });
    const result = holdings?.result && typeof holdings.result === "object" ? holdings.result : {};
    accounts.push({
      accountSeq,
      items: Array.isArray(result.items) ? result.items : [],
    });
  }
  return {
    source: "tossinvest-holdings",
    collectedAt: new Date().toISOString(),
    accountCount: accounts.length,
    accounts,
  };
}

async function publicOrderSyncStatus(extra = {}) {
  const settings = readOrderSyncSettings();
  const store = await orderSyncStoreStatus();
  const latestReconstruction = await latestOrderSyncReconstructionStatus(store);
  const activeReconstruction =
    orderSyncReconstructionRun &&
    (!latestReconstruction?.runId || !orderSyncReconstructionRun.runId || latestReconstruction.runId === orderSyncReconstructionRun.runId)
      ? {
          ...orderSyncReconstructionRun,
          ...(latestReconstruction || {}),
          status: latestReconstruction?.status || orderSyncReconstructionRun.status,
          ok: latestReconstruction?.ok ?? orderSyncReconstructionRun.ok,
        }
      : orderSyncReconstructionRun;
  const reconstruction =
    Object.prototype.hasOwnProperty.call(extra, "reconstruction")
      ? extra.reconstruction
      : activeReconstruction || latestReconstruction;
  return {
    ok: true,
    enabled: settings.enabled,
    settings,
    store,
    reconstruction,
    configPath: "config/tossinvest-sync.user.json",
    defaultConfigPath: "config/tossinvest-sync.defaults.json",
    ...extra,
  };
}

function kstTodayDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function subtractDaysFromDateString(dateString, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateString || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - Math.max(0, Number(days || 0)));
  return date.toISOString().slice(0, 10);
}

function addDaysToDateString(dateString, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function dateTimeEndOfKstDay(dateString) {
  const day = cleanDateKey(dateString);
  return day ? `${day}T23:59:59+09:00` : "";
}

function normalizeMarketSymbol(value) {
  const symbol = cleanText(value, 80).toUpperCase();
  return /^[A-Z0-9.-]+$/.test(symbol) ? symbol : "";
}

function numericText(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? text : "";
}

function normalizeTossCandle(raw = {}, fallbackSymbol = "") {
  if (!raw || typeof raw !== "object") return null;
  const timestamp = cleanText(raw.timestamp || raw.dateTime || raw.time || raw.date || "", 80);
  const date = cleanDateKey(raw.date || timestamp);
  const closePrice = numericText(raw.closePrice || raw.close || raw.lastPrice || raw.price);
  if (!date || !closePrice) return null;
  return {
    symbol: normalizeMarketSymbol(raw.symbol || fallbackSymbol),
    date,
    timestamp,
    openPrice: numericText(raw.openPrice || raw.open),
    highPrice: numericText(raw.highPrice || raw.high),
    lowPrice: numericText(raw.lowPrice || raw.low),
    closePrice,
    volume: numericText(raw.volume),
    currency: cleanText(raw.currency || "", 12).toUpperCase(),
  };
}

function mergeCandleRows(existing = [], incoming = [], symbol = "") {
  const byDate = new Map();
  for (const raw of [...existing, ...incoming]) {
    const candle = normalizeTossCandle(raw, symbol);
    if (!candle) continue;
    byDate.set(candle.date, candle);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function parseTossCandlesResult(response) {
  const result = response?.result || {};
  const candles = Array.isArray(result.candles) ? result.candles : Array.isArray(result) ? result : [];
  return {
    candles,
    nextBefore: cleanText(result.nextBefore || "", 100),
  };
}

async function fetchTossDailyCandlesPage(symbol, before = "") {
  return tossGetWithRetry("/api/v1/candles", {
    configureUrl: (url) => {
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("interval", "1d");
      url.searchParams.set("count", "200");
      url.searchParams.set("adjusted", "true");
      if (before) url.searchParams.set("before", before);
    },
  });
}

async function refreshTossDailyCandleCache(symbol, { startDate = "", endDate = "" } = {}) {
  const normalized = normalizeMarketSymbol(symbol);
  const start = cleanDateKey(startDate);
  const end = cleanDateKey(endDate);
  if (!normalized || !start || !end) return { symbol: normalized, candles: [], fetchedCount: 0, error: "invalid candle request" };

  let before = dateTimeEndOfKstDay(end);
  let allCandles = [];
  let fetchedCount = 0;

  for (let pageIndex = 0; pageIndex < MARKET_CANDLE_PAGE_LIMIT; pageIndex += 1) {
    const page = await fetchTossDailyCandlesPage(normalized, before);
    const parsed = parseTossCandlesResult(page);
    const normalizedRows = mergeCandleRows([], parsed.candles, normalized);
    if (!normalizedRows.length) break;

    fetchedCount += normalizedRows.length;
    allCandles = mergeCandleRows(allCandles, normalizedRows, normalized);
    const earliest = normalizedRows[0]?.date || "";
    if (earliest && earliest <= start) break;

    const fallbackBeforeDate = earliest ? addDaysToDateString(earliest, -1) : "";
    const nextBefore = cleanText(parsed.nextBefore || "", 100) || dateTimeEndOfKstDay(fallbackBeforeDate);
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;
  }

  return { symbol: normalized, candles: allCandles, fetchedCount, cached: false };
}

function filterCandlesForRange(candles = [], startDate = "", endDate = "") {
  const normalized = mergeCandleRows(candles, [], "");
  const beforeStart = normalized.filter((candle) => startDate && candle.date < startDate).slice(-1);
  const inRange = normalized.filter((candle) => (!startDate || candle.date >= startDate) && (!endDate || candle.date <= endDate));
  return [...beforeStart, ...inRange];
}

async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await callback(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function tossMarketCandleFetchPlans(context = {}, symbols = [], startDate = "", endDate = "") {
  const cachedSymbols = new Set(
    (Array.isArray(context.cachedSymbols) ? context.cachedSymbols : [])
      .map(normalizeMarketSymbol)
      .filter(Boolean)
  );
  const explicitMissing = Array.isArray(context.missingSymbols)
    ? context.missingSymbols.map(normalizeMarketSymbol).filter(Boolean)
    : [];
  const missingSymbols = new Set(
    explicitMissing.length
      ? explicitMissing
      : symbols.filter((symbol) => !cachedSymbols.has(symbol))
  );
  const refreshLatestDate = Boolean(endDate && endDate === kstTodayDateString());
  return symbols
    .map((symbol) => {
      if (missingSymbols.has(symbol) || !cachedSymbols.has(symbol)) {
        return { symbol, startDate, endDate, reason: "missing-range" };
      }
      if (refreshLatestDate) {
        return { symbol, startDate: endDate, endDate, reason: "latest-date-refresh" };
      }
      return null;
    })
    .filter(Boolean);
}

async function fetchTossUsdKrwRate(date) {
  const dateTime = dateTimeEndOfKstDay(date);
  const response = await tossGetWithRetry("/api/v1/exchange-rate", {
    configureUrl: (url) => {
      url.searchParams.set("baseCurrency", "USD");
      url.searchParams.set("quoteCurrency", "KRW");
      url.searchParams.set("dateTime", dateTime);
    },
  });
  const result = response?.result || {};
  const rate = numericText(result.rate || result.midRate);
  if (!rate) throw new Error(`USD/KRW rate missing for ${date}`);
  return rate;
}

async function refreshTossFxCacheForDates(dates = []) {
  const uniqueDates = [...new Set(dates.map(cleanDateKey).filter(Boolean))].sort();
  const rates = {};
  const missing = uniqueDates;
  const errors = [];

  await mapLimit(missing, MARKET_DATA_CONCURRENCY, async (date) => {
    try {
      rates[date] = await fetchTossUsdKrwRate(date);
    } catch (error) {
      errors.push({ date, error: cleanText(error.message || "exchange-rate fetch failed", 300) });
    }
  });

  return { rates, requestedCount: uniqueDates.length, fetchedCount: missing.length - errors.length, errorCount: errors.length, errors };
}

async function buildTossInvestMarketData(context = {}) {
  const symbols = Array.isArray(context.symbols) ? context.symbols.map(normalizeMarketSymbol).filter(Boolean) : [];
  const startDate = cleanDateKey(context.startDate || "");
  const endDate = cleanDateKey(context.endDate || kstTodayDateString());
  const targetDates = Array.isArray(context.targetDates) ? context.targetDates.map(cleanDateKey).filter(Boolean) : [];
  const candleFetchPlans = tossMarketCandleFetchPlans(context, symbols, startDate, endDate);
  const refreshLatestDate = Boolean(endDate && endDate === kstTodayDateString());
  const fxDatesToFetch = new Set(
    (Array.isArray(context.missingFxDates)
      ? context.missingFxDates.map(cleanDateKey).filter(Boolean)
      : targetDates)
  );
  if (refreshLatestDate && targetDates.includes(endDate)) {
    fxDatesToFetch.add(endDate);
  }
  const errors = [];
  const candleResults = await mapLimit(candleFetchPlans, MARKET_DATA_CONCURRENCY, async (plan) => {
    try {
      return {
        ...(await refreshTossDailyCandleCache(plan.symbol, {
          startDate: plan.startDate,
          endDate: plan.endDate,
        })),
        requestRange: {
          startDate: plan.startDate,
          endDate: plan.endDate,
          reason: plan.reason,
        },
      };
    } catch (error) {
      errors.push({ symbol: plan.symbol, error: cleanText(error.message || "daily candle fetch failed", 300) });
      return { symbol: plan.symbol, candles: [], fetchedCount: 0, error: error.message, requestRange: plan };
    }
  });
  const fx = await refreshTossFxCacheForDates([...fxDatesToFetch]);
  const candlesBySymbol = {};
  const candleRangesBySymbol = {};
  for (const result of candleResults) {
    const symbol = normalizeMarketSymbol(result?.symbol || "");
    if (!symbol) continue;
    const range = result.requestRange || {};
    candlesBySymbol[symbol] = filterCandlesForRange(result.candles, range.startDate || startDate, range.endDate || endDate);
    candleRangesBySymbol[symbol] = {
      startDate: range.startDate || startDate,
      endDate: range.endDate || endDate,
      reason: range.reason || "",
    };
  }
  return {
    ok: errors.length === 0 && fx.errorCount === 0,
    source: "tossinvest-openapi",
    fetchedAt: new Date().toISOString(),
    startDate,
    endDate,
    targetDateCount: targetDates.length,
    symbolCount: symbols.length,
    fetchedSymbolCount: candleFetchPlans.length,
    skippedCachedSymbolCount: Math.max(0, symbols.length - candleFetchPlans.length),
    latestDateRefresh: refreshLatestDate,
    candleCachePath: `${relativeAppPath(ORDER_SYNC_LEDGER_PATH)}:market_candles`,
    fxCachePath: `${relativeAppPath(ORDER_SYNC_LEDGER_PATH)}:fx_rates`,
    candlesBySymbol,
    candleRangesBySymbol,
    fxRates: fx.rates,
    fetchSummary: {
      candleFetchedCount: candleResults.reduce((sum, item) => sum + Number(item?.fetchedCount || 0), 0),
      fxRequestedCount: fx.requestedCount,
      fxFetchedCount: fx.fetchedCount,
      latestDateRefreshCount: candleFetchPlans.filter((plan) => plan.reason === "latest-date-refresh").length,
      candleErrorCount: errors.length,
      fxErrorCount: fx.errorCount,
    },
    errors: [...errors, ...fx.errors],
  };
}

function orderSyncAccountState(store, accountSeq) {
  const states = Array.isArray(store?.states) ? store.states : [];
  return states.find((state) => String(state?.account_seq || "") === String(accountSeq || "")) || null;
}

function configureOrderSyncQuery({ state, settings, cursor }, url) {
  url.searchParams.set("status", "CLOSED");
  url.searchParams.set("limit", String(ORDER_SYNC_LIMIT));
  if (cursor) {
    url.searchParams.set("cursor", cursor);
    const lastFrom = cleanText(state?.last_from_date || "", 20);
    const lastTo = cleanText(state?.last_to_date || "", 20);
    if (lastFrom) url.searchParams.set("from", lastFrom);
    if (lastTo) url.searchParams.set("to", lastTo);
    return { from: lastFrom, to: lastTo };
  }
  const latestOrderedAt = cleanText(state?.last_ordered_at || "", 80);
  if (!latestOrderedAt) return { from: "", to: "" };
  const from = subtractDaysFromDateString(latestOrderedAt, settings.lookbackDays);
  const to = kstTodayDateString();
  if (from) url.searchParams.set("from", from);
  if (to) url.searchParams.set("to", to);
  return { from, to };
}

async function syncTossInvestOrderHistory({ force = false } = {}) {
  const settings = readOrderSyncSettings();
  if (!settings.enabled && !force) {
    throw inputError("거래내역 동기화가 꺼져 있습니다.", 409);
  }
  const startedAt = new Date().toISOString();
  const accountsResponse = await tossGet("/api/v1/accounts");
  const accounts = Array.isArray(accountsResponse.result) ? accountsResponse.result : [];
  const beforeStore = await orderSyncStoreStatus();
  const accountResults = [];
  const paceOrderHistoryRequest = createOrderHistoryPacer(settings.pageDelayMs);

  for (const account of accounts) {
    const accountSeq = cleanText(account?.accountSeq || "", 40);
    if (!accountSeq) continue;
    const state = orderSyncAccountState(beforeStore, accountSeq);
    let cursor = state?.has_next && state?.last_cursor ? state.last_cursor : "";
    let fetchedCount = 0;
    let pagesFetched = 0;
    let insertedCount = 0;
    let updatedCount = 0;
    let seenCount = 0;
    let hasNext = false;
    let nextCursor = "";
    let queryWindow = { from: "", to: "" };
    let latestStore = null;

    for (let pageIndex = 0; pageIndex < settings.maxPagesPerRun; pageIndex += 1) {
      let pageQueryWindow = { from: "", to: "" };
      await paceOrderHistoryRequest();
      const ordersResponse = await tossGet("/api/v1/orders", {
        accountSeq,
        configureUrl: (url) => {
          pageQueryWindow = configureOrderSyncQuery({ state, settings, cursor }, url);
        },
      });
      queryWindow = pageQueryWindow;
      const result = ordersResponse.result || {};
      const orders = Array.isArray(result.orders) ? result.orders : [];
      fetchedCount += orders.length;
      pagesFetched += 1;
      hasNext = Boolean(result.hasNext && result.nextCursor);
      nextCursor = hasNext ? cleanText(result.nextCursor || "", 500) : "";

      latestStore = await runOrderSyncStore(
        "upsert",
        {
          accountSeq,
          orders,
          sync: {
            enabled: settings.enabled,
            status: "ok",
            startedAt,
            finishedAt: new Date().toISOString(),
            fetchedCount,
            pagesFetched,
            nextCursor,
            hasNext,
            from: queryWindow.from,
            to: queryWindow.to,
          },
        },
        { timeoutMs: ORDER_SYNC_UPSERT_SCRIPT_TIMEOUT_MS }
      );
      insertedCount += Number(latestStore?.upsert?.inserted || 0);
      updatedCount += Number(latestStore?.upsert?.updated || 0);
      seenCount += Number(latestStore?.upsert?.seen || 0);

      if (!hasNext) break;
      cursor = nextCursor;
    }

    if (!latestStore && pagesFetched === 0) {
      latestStore = await runOrderSyncStore(
        "upsert",
        {
          accountSeq,
          orders: [],
          sync: {
            enabled: settings.enabled,
            status: "ok",
            startedAt,
            finishedAt: new Date().toISOString(),
            fetchedCount: 0,
            pagesFetched: 0,
            nextCursor: "",
            hasNext: false,
            from: "",
            to: "",
          },
        },
        { timeoutMs: ORDER_SYNC_UPSERT_SCRIPT_TIMEOUT_MS }
      );
    }

    accountResults.push({
      accountSeqMasked: maskSecret(accountSeq, 1, 1),
      fetchedCount,
      pagesFetched,
      insertedCount,
      updatedCount,
      seenCount,
      hasNext,
      nextCursorPresent: Boolean(nextCursor),
      from: queryWindow.from,
      to: queryWindow.to,
    });
  }

  const syncSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    accountCount: accounts.length,
    fetchedCount: accountResults.reduce((sum, item) => sum + item.fetchedCount, 0),
    insertedCount: accountResults.reduce((sum, item) => sum + item.insertedCount, 0),
    updatedCount: accountResults.reduce((sum, item) => sum + item.updatedCount, 0),
    seenCount: accountResults.reduce((sum, item) => sum + item.seenCount, 0),
    pagesFetched: accountResults.reduce((sum, item) => sum + item.pagesFetched, 0),
    hasNext: accountResults.some((item) => item.hasNext),
    accounts: accountResults,
  };
  return publicOrderSyncStatus({ sync: syncSummary });
}

async function rebuildCompletedOrderSyncSnapshots({ forceFull = false } = {}) {
  const store = await orderSyncStoreStatus();
  if (!store?.exists) {
    return publicOrderSyncStatus({
      reconstruction: {
        ok: false,
        status: "missing-ledger",
        error: "거래내역 SQLite 저장소가 아직 없습니다.",
      },
    });
  }
  if ((Array.isArray(store.states) ? store.states : []).some((state) => Boolean(state?.has_next))) {
    return publicOrderSyncStatus({
      reconstruction: {
        ok: false,
        status: "deferred",
        error: "거래내역 동기화가 아직 끝나지 않았습니다.",
      },
    });
  }
  const startedAt = new Date().toISOString();
  const runId = `rebuild-${randomBytes(12).toString("hex")}`;
  orderSyncReconstructionRun = {
    ok: null,
    status: "running",
    runId,
    startedAt,
    progress: {
      completed: 0,
      total: 0,
      percent: 0,
      rowCount: 0,
    },
  };
  try {
    const currentHoldings = await currentHoldingsPayloadForRebuild(store);
    const reconstruction = await rebuildOrderSyncPositionSnapshots({ currentHoldings, runId, forceFull });
    const completedReconstruction = {
      ...reconstruction,
      status: reconstruction?.status || (reconstruction?.ok === true ? "completed" : "failed"),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    return publicOrderSyncStatus({ reconstruction: completedReconstruction });
  } finally {
    orderSyncReconstructionRun = null;
  }
}

async function readTossResponse(response) {
  const text = await response.text();
  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 1000) };
    }
  }
  const requestId = response.headers.get("x-request-id") || response.headers.get("x-amz-cf-id") || "";
  const rateLimit = {
    limit: response.headers.get("x-ratelimit-limit") || "",
    remaining: response.headers.get("x-ratelimit-remaining") || "",
    reset: response.headers.get("x-ratelimit-reset") || "",
    retryAfter: response.headers.get("retry-after") || "",
  };
  return { payload, requestId, rateLimit };
}

function isTossIpAllowlistError(message) {
  const text = String(message || "").trim();
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  return (
    /ip\s+address\s+(is\s+)?not\s+allowed/.test(normalized) ||
    /허용되지\s*않은\s*ip\s*주소/.test(normalized)
  );
}

function isTossClientIdAuthError(message) {
  const text = String(message || "").trim();
  return /^client authentication failed:\s*client_id$/i.test(text);
}

function isTossClientSecretAuthError(message) {
  const text = String(message || "").trim();
  return /^client authentication failed:\s*client_secret$/i.test(text);
}

function isTossClientAuthError(message) {
  const text = String(message || "").trim();
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  return (
    /^client authentication failed$/i.test(text) ||
    normalized === "invalid client" ||
    /invalid\s+client\s+(id|secret|credentials?)/.test(normalized) ||
    /client\s+authentication\s+failed/.test(normalized)
  );
}

function isTossTokenInvalidError(message) {
  const text = String(message || "").trim();
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  return /invalid\s+token|expired\s+token|token\s+expired|unauthorized/.test(normalized);
}

function isTossPermissionError(message) {
  const text = String(message || "").trim();
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  return /forbidden|permission\s+denied|access\s+denied|not\s+authorized/.test(normalized);
}

function isTossRequestFormatError(message) {
  const text = String(message || "").trim();
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  return /invalid\s+request|unsupported\s+grant\s+type|invalid\s+grant|invalid\s+scope/.test(normalized);
}

function publicTossErrorMessage(message) {
  const text = String(message || "").trim();
  if (isTossClientIdAuthError(text)) {
    return TOSS_CLIENT_ID_AUTH_ERROR_MESSAGE;
  }
  if (isTossClientSecretAuthError(text)) {
    return TOSS_CLIENT_SECRET_AUTH_ERROR_MESSAGE;
  }
  if (isTossClientAuthError(text)) {
    return TOSS_CLIENT_AUTH_ERROR_MESSAGE;
  }
  if (isTossIpAllowlistError(text)) {
    return TOSS_IP_ALLOWLIST_ERROR_MESSAGE;
  }
  if (isTossTokenInvalidError(text)) {
    return TOSS_TOKEN_INVALID_ERROR_MESSAGE;
  }
  if (isTossPermissionError(text)) {
    return TOSS_PERMISSION_ERROR_MESSAGE;
  }
  if (isTossRequestFormatError(text)) {
    return TOSS_REQUEST_FORMAT_ERROR_MESSAGE;
  }
  return text;
}

function publicTossErrorCode(...messages) {
  if (messages.some((message) => isTossIpAllowlistError(message))) return TOSS_IP_ALLOWLIST_ERROR_CODE;
  if (messages.some((message) => isTossClientIdAuthError(message))) return TOSS_CLIENT_ID_AUTH_ERROR_CODE;
  if (messages.some((message) => isTossClientSecretAuthError(message))) return TOSS_CLIENT_SECRET_AUTH_ERROR_CODE;
  if (messages.some((message) => isTossClientAuthError(message))) return TOSS_CLIENT_AUTH_ERROR_CODE;
  return "";
}

function tossErrorMessage(payload, fallback) {
  if (payload?.error_description) return publicTossErrorMessage(payload.error_description);
  if (payload?.error?.message) return publicTossErrorMessage(payload.error.message);
  if (payload?.error?.code) return publicTossErrorMessage(payload.error.code);
  if (payload?.error) {
    return publicTossErrorMessage(typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error));
  }
  return publicTossErrorMessage(fallback);
}

async function issueToken() {
  const credentials = readCredentialsOrThrow();
  const credentialsScope = credentialCacheScope(credentials);
  if (cachedTokenValid(credentialsScope)) return tokenCache;
  if (tokenRequestPromise && tokenRequestPromiseScope === credentialsScope) return tokenRequestPromise;

  const requestPromise = (async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", credentials.clientId);
    body.set("client_secret", credentials.clientSecret);
    const response = await fetchWithTimeout(`${baseUrl()}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    const { payload, requestId, rateLimit } = await readTossResponse(response);
    if (!response.ok) {
      const message = tossErrorMessage(payload, `토큰 발급 실패: HTTP ${response.status}`);
      const error = new Error(message);
      error.statusCode = response.status;
      error.errorCode = publicTossErrorCode(
        payload?.error_description,
        payload?.error?.message,
        payload?.error?.code,
        payload?.error
      );
      error.requestId = requestId;
      error.rateLimit = rateLimit;
      throw error;
    }
    const accessToken = cleanText(payload.access_token || "", 4000);
    const tokenType = cleanText(payload.token_type || "Bearer", 40);
    const expiresInSeconds = Math.max(0, Number(payload.expires_in || 0));
    if (!accessToken || tokenType.toLowerCase() !== "bearer" || !expiresInSeconds) {
      throw new Error("토큰 발급 응답 형식이 올바르지 않습니다.");
    }
    tokenCache = {
      encryptedAccessToken: encryptTokenForCache(accessToken),
      tokenType,
      expiresAtMs: Date.now() + expiresInSeconds * 1000,
      fingerprint: hashFingerprint(accessToken),
      credentialScope: credentialsScope,
      issuedAt: new Date().toISOString(),
      requestId,
      rateLimit,
    };
    return tokenCache;
  })();
  tokenRequestPromise = requestPromise;
  tokenRequestPromiseScope = credentialsScope;

  try {
    return await requestPromise;
  } finally {
    if (tokenRequestPromise === requestPromise) {
      tokenRequestPromise = null;
      tokenRequestPromiseScope = "";
    }
  }
}

function accountSeqFromRequest(req) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const accountSeq = cleanText(url.searchParams.get("accountSeq") || url.searchParams.get("account") || "", 40);
  if (!accountSeq || !/^\d+$/.test(accountSeq)) {
    throw new Error("accountSeq가 필요합니다.");
  }
  return accountSeq;
}

function boundedLimit(value, fallback = 100) {
  const number = Math.round(Number(value || fallback));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, number));
}

function copyQueryParam(source, target, key, pattern = null) {
  const value = cleanText(source.searchParams.get(key) || "", 200);
  if (!value) return;
  if (pattern && !pattern.test(value)) {
    throw new Error(`${key} 파라미터 형식이 올바르지 않습니다.`);
  }
  target.searchParams.set(key, value);
}

function appendOrderQuery(req, targetUrl) {
  const sourceUrl = new URL(req.url || "/", "http://127.0.0.1");
  const status = cleanText(sourceUrl.searchParams.get("status") || "CLOSED", 20).toUpperCase();
  if (!["OPEN", "CLOSED"].includes(status)) throw new Error("status는 OPEN 또는 CLOSED만 허용합니다.");
  targetUrl.searchParams.set("status", status);
  copyQueryParam(sourceUrl, targetUrl, "symbol", /^[A-Za-z0-9.-]+$/);
  copyQueryParam(sourceUrl, targetUrl, "from", /^\d{4}-\d{2}-\d{2}$/);
  copyQueryParam(sourceUrl, targetUrl, "to", /^\d{4}-\d{2}-\d{2}$/);
  copyQueryParam(sourceUrl, targetUrl, "cursor");
  targetUrl.searchParams.set("limit", String(boundedLimit(sourceUrl.searchParams.get("limit"), 100)));
}

function appendConditionalOrderQuery(req, targetUrl) {
  const sourceUrl = new URL(req.url || "/", "http://127.0.0.1");
  const status = cleanText(sourceUrl.searchParams.get("status") || "CLOSED", 20).toUpperCase();
  if (!["OPEN", "CLOSED"].includes(status)) throw new Error("status는 OPEN 또는 CLOSED만 허용합니다.");
  targetUrl.searchParams.set("status", status);
  copyQueryParam(sourceUrl, targetUrl, "symbol", /^[A-Za-z0-9.-]+$/);
  copyQueryParam(sourceUrl, targetUrl, "cursor");
  targetUrl.searchParams.set("limit", String(boundedLimit(sourceUrl.searchParams.get("limit"), 100)));
}

function appendPricesQuery(req, targetUrl) {
  const sourceUrl = new URL(req.url || "/", "http://127.0.0.1");
  const symbols = cleanText(sourceUrl.searchParams.get("symbols") || sourceUrl.searchParams.get("symbol") || "", 2000);
  if (!symbols || !/^[A-Za-z0-9.,-]+$/.test(symbols)) {
    throw new Error("symbols 파라미터 형식이 올바르지 않습니다.");
  }
  targetUrl.searchParams.set("symbols", symbols);
}

function appendStocksQuery(req, targetUrl) {
  const sourceUrl = new URL(req.url || "/", "http://127.0.0.1");
  const symbols = cleanText(sourceUrl.searchParams.get("symbols") || sourceUrl.searchParams.get("symbol") || "", 2000);
  if (!symbols || !/^[A-Za-z0-9.,-]+$/.test(symbols)) {
    throw new Error("symbols 파라미터 형식이 올바르지 않습니다.");
  }
  targetUrl.searchParams.set("symbols", symbols);
}

function appendCandlesQuery(req, targetUrl) {
  const sourceUrl = new URL(req.url || "/", "http://127.0.0.1");
  const symbol = cleanText(sourceUrl.searchParams.get("symbol") || "", 80);
  if (!symbol || !/^[A-Za-z0-9.-]+$/.test(symbol)) {
    throw new Error("symbol 파라미터 형식이 올바르지 않습니다.");
  }
  const interval = cleanText(sourceUrl.searchParams.get("interval") || "1d", 10);
  if (!["1m", "1d"].includes(interval)) {
    throw new Error("interval은 1m 또는 1d만 허용합니다.");
  }
  targetUrl.searchParams.set("symbol", symbol);
  targetUrl.searchParams.set("interval", interval);
  targetUrl.searchParams.set("count", String(clampInteger(sourceUrl.searchParams.get("count"), 100, 1, 200)));
  copyQueryParam(sourceUrl, targetUrl, "before", /^\d{4}-\d{2}-\d{2}T.+/);
  const adjusted = cleanText(sourceUrl.searchParams.get("adjusted") || "", 10);
  if (adjusted) targetUrl.searchParams.set("adjusted", adjusted === "false" ? "false" : "true");
}

function appendExchangeRateQuery(req, targetUrl) {
  const sourceUrl = new URL(req.url || "/", "http://127.0.0.1");
  const baseCurrency = cleanText(sourceUrl.searchParams.get("baseCurrency") || "USD", 8).toUpperCase();
  const quoteCurrency = cleanText(sourceUrl.searchParams.get("quoteCurrency") || "KRW", 8).toUpperCase();
  if (!["KRW", "USD"].includes(baseCurrency) || !["KRW", "USD"].includes(quoteCurrency) || baseCurrency === quoteCurrency) {
    throw new Error("baseCurrency/quoteCurrency 파라미터 형식이 올바르지 않습니다.");
  }
  targetUrl.searchParams.set("baseCurrency", baseCurrency);
  targetUrl.searchParams.set("quoteCurrency", quoteCurrency);
  copyQueryParam(sourceUrl, targetUrl, "dateTime", /^\d{4}-\d{2}-\d{2}T.+/);
}

function appendMarketCalendarQuery(req, targetUrl) {
  const sourceUrl = new URL(req.url || "/", "http://127.0.0.1");
  copyQueryParam(sourceUrl, targetUrl, "date", /^\d{4}-\d{2}-\d{2}$/);
}

function optionalAccountSeqFromRequest(req) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const accountSeq = cleanText(url.searchParams.get("accountSeq") || url.searchParams.get("account") || "", 40);
  if (!accountSeq) return "";
  if (!/^\d+$/.test(accountSeq)) {
    throw new Error("accountSeq 파라미터 형식이 올바르지 않습니다.");
  }
  return accountSeq;
}

function decimalNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function ratePercent(value, fallback = 0) {
  return decimalNumber(value, fallback / 100) * 100;
}

function amountByCurrency(source, currency) {
  const key = String(currency || "").toLowerCase();
  if (!source || typeof source !== "object") return 0;
  return decimalNumber(source[key] ?? source[key.toUpperCase()] ?? 0);
}

function normalizeCurrency(value, fallback = "KRW") {
  const currency = cleanText(value || fallback, 8).toUpperCase();
  if (currency === "USD" || currency === "KRW") return currency;
  return fallback;
}

function normalizeAccountList(accounts) {
  return (Array.isArray(accounts) ? accounts : []).map((account) => ({
    accountNo: cleanText(account?.accountNo || "", 80),
    accountSeq: cleanText(account?.accountSeq || "", 40),
    accountType: cleanText(account?.accountType || "", 80),
  }));
}

function choosePrimaryCurrency(overview, requestedCurrency = "KRW") {
  const totalKrw = amountByCurrency(overview?.marketValue?.amountAfterCost || overview?.marketValue?.amount, "KRW");
  const totalUsd = amountByCurrency(overview?.marketValue?.amountAfterCost || overview?.marketValue?.amount, "USD");
  const requested = normalizeCurrency(requestedCurrency, "KRW");
  if (requested === "USD" && totalUsd) return "USD";
  if (requested === "KRW" && totalKrw) return "KRW";
  if (totalUsd && !totalKrw) return "USD";
  return "KRW";
}

function priceMapFromResponses(responses) {
  const map = new Map();
  for (const response of responses) {
    const rows = Array.isArray(response?.result) ? response.result : [];
    for (const row of rows) {
      const symbol = cleanText(row?.symbol || "", 80).toUpperCase();
      if (!symbol) continue;
      map.set(symbol, {
        symbol,
        lastPrice: decimalNumber(row?.lastPrice),
        currency: normalizeCurrency(row?.currency || "KRW"),
        timestamp: cleanText(row?.timestamp || "", 80),
      });
    }
  }
  return map;
}

function normalizeLiveHoldingItem(item, priceMap) {
  const symbol = cleanText(item?.symbol || "", 80).toUpperCase();
  const price = priceMap.get(symbol) || null;
  const currency = normalizeCurrency(item?.currency || price?.currency || "KRW");
  const value = decimalNumber(item?.marketValue?.amountAfterCost ?? item?.marketValue?.amount);
  const rawValue = decimalNumber(item?.marketValue?.amount);
  const costBasis = decimalNumber(item?.marketValue?.purchaseAmount);
  const profit = decimalNumber(item?.profitLoss?.amountAfterCost ?? item?.profitLoss?.amount ?? value - costBasis);
  const dailyProfit = decimalNumber(item?.dailyProfitLoss?.amount);
  const currentPrice = decimalNumber(price?.lastPrice ?? item?.lastPrice);
  return {
    symbol,
    label: cleanText(item?.name || symbol, 120),
    marketCountry: cleanText(item?.marketCountry || "", 20),
    currency,
    displayCurrency: currency,
    quantity: decimalNumber(item?.quantity),
    currentPrice,
    currentPriceTimestamp: price?.timestamp || "",
    averageKnownCost: decimalNumber(item?.averagePurchasePrice),
    value,
    rawValue,
    costBasis,
    profit,
    profitPercent: ratePercent(item?.profitLoss?.rateAfterCost ?? item?.profitLoss?.rate),
    dailyProfit,
    dailyReturnPercent: ratePercent(item?.dailyProfitLoss?.rate),
    commission: decimalNumber(item?.cost?.commission),
    tax: item?.cost?.tax === null || item?.cost?.tax === undefined ? null : decimalNumber(item?.cost?.tax),
    marketValueKrw: currency === "KRW" ? value : 0,
    marketValueUsd: currency === "USD" ? value : 0,
  };
}

function totalsForCurrency(overview, currency) {
  const marketValue = overview?.marketValue || {};
  const profitLoss = overview?.profitLoss || {};
  const dailyProfitLoss = overview?.dailyProfitLoss || {};
  return {
    totalValue: amountByCurrency(marketValue.amountAfterCost || marketValue.amount, currency),
    totalRawValue: amountByCurrency(marketValue.amount, currency),
    totalCostBasis: amountByCurrency(overview?.totalPurchaseAmount, currency),
    totalProfit: amountByCurrency(profitLoss.amountAfterCost || profitLoss.amount, currency),
    dailyProfit: amountByCurrency(dailyProfitLoss.amount, currency),
  };
}

function tossRateLimitPublicSummary() {
  return Object.fromEntries(
    Object.entries(TOSS_RATE_LIMIT_GROUPS).map(([group, config]) => [
      group,
      {
        maxPerSecond: config.maxPerSecond,
        minIntervalMs: config.minIntervalMs,
      },
    ])
  );
}

function retryAfterMsFromRateLimit(rateLimit = null) {
  const raw = String(rateLimit?.retryAfter || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(300_000, Math.round(seconds * 1000));
  }
  const retryAtMs = Date.parse(raw);
  if (!Number.isFinite(retryAtMs)) return 0;
  return Math.min(300_000, Math.max(0, retryAtMs - Date.now()));
}

function buildLiveInvestmentStatusPayload({
  accountsResponse,
  holdingsResponse,
  priceResponses,
  selectedAccountSeq,
  requestedCurrency,
  requestSummary,
  cacheHit = false,
}) {
  const accounts = normalizeAccountList(accountsResponse?.result);
  const overview = holdingsResponse?.result && typeof holdingsResponse.result === "object" ? holdingsResponse.result : {};
  const priceMap = priceMapFromResponses(priceResponses);
  const items = (Array.isArray(overview.items) ? overview.items : [])
    .map((item) => normalizeLiveHoldingItem(item, priceMap))
    .filter((item) => item.symbol);
  const primaryCurrency = choosePrimaryCurrency(overview, requestedCurrency);
  const primaryTotals = totalsForCurrency(overview, primaryCurrency);
  const krwTotals = totalsForCurrency(overview, "KRW");
  const usdTotals = totalsForCurrency(overview, "USD");
  const retryAfterMs = retryAfterMsFromRateLimit(requestSummary?.priceIssue?.rateLimit);
  const now = new Date().toISOString();
  return {
    ok: true,
    source: "토스 증권 API",
    sourceMode: "live",
    fetchedAt: now,
    cached: cacheHit,
    accountSeq: selectedAccountSeq,
    accounts,
    accountCount: accounts.length,
    unit: primaryCurrency,
    displayCurrency: primaryCurrency,
    totalValue: primaryTotals.totalValue,
    totalRawValue: primaryTotals.totalRawValue,
    totalCostBasis: primaryTotals.totalCostBasis,
    totalProfit: primaryTotals.totalProfit,
    totalProfitPercent: ratePercent(overview?.profitLoss?.rateAfterCost ?? overview?.profitLoss?.rate),
    dailyProfit: primaryTotals.dailyProfit,
    dailyReturnPercent: ratePercent(overview?.dailyProfitLoss?.rate),
    totalValueKrw: krwTotals.totalValue,
    totalValueUsd: usdTotals.totalValue,
    totalCostBasisKrw: krwTotals.totalCostBasis,
    totalCostBasisUsd: usdTotals.totalCostBasis,
    totalProfitKrw: krwTotals.totalProfit,
    totalProfitUsd: usdTotals.totalProfit,
    dailyProfitKrw: krwTotals.dailyProfit,
    dailyProfitUsd: usdTotals.dailyProfit,
    items,
    refresh: {
      recommendedIntervalMs: Math.max(LIVE_INVESTMENT_STATUS_REFRESH_MS, retryAfterMs),
      cacheTtlMs: LIVE_INVESTMENT_STATUS_CACHE_TTL_MS,
      retryAfterMs,
    },
    rateLimitPolicy: tossRateLimitPublicSummary(),
    requestSummary,
    upstream: {
      accountsRequestId: accountsResponse?.requestId || "",
      holdingsRequestId: holdingsResponse?.requestId || "",
      priceRequestIds: priceResponses.map((response) => response?.requestId || "").filter(Boolean),
      latestPriceTimestamp: items.map((item) => item.currentPriceTimestamp).filter(Boolean).sort().at(-1) || "",
    },
  };
}

async function fetchPriceResponsesForSymbols(symbols) {
  const cleanSymbols = [...new Set(symbols.map((symbol) => cleanText(symbol || "", 80).toUpperCase()).filter(Boolean))];
  const responses = [];
  for (let index = 0; index < cleanSymbols.length; index += 200) {
    const chunk = cleanSymbols.slice(index, index + 200);
    if (!chunk.length) continue;
    responses.push(
      await tossGetWithRetry(
        "/api/v1/prices",
        { configureUrl: (url) => url.searchParams.set("symbols", chunk.join(",")) },
        LIVE_INVESTMENT_STATUS_RETRY_OPTIONS
      )
    );
  }
  return responses;
}

async function buildLiveInvestmentStatus({ accountSeq = "", requestedCurrency = "KRW" } = {}) {
  const accountsResponse = await tossGetWithRetry("/api/v1/accounts", {}, LIVE_INVESTMENT_STATUS_RETRY_OPTIONS);
  const accounts = normalizeAccountList(accountsResponse.result);
  const selectedAccountSeq = accountSeq || cleanText(accounts[0]?.accountSeq || "", 40);
  if (!selectedAccountSeq) {
    return buildLiveInvestmentStatusPayload({
      accountsResponse,
      holdingsResponse: { ok: true, result: { items: [] } },
      priceResponses: [],
      selectedAccountSeq: "",
      requestedCurrency,
      requestSummary: { accounts: 1, holdings: 0, prices: 0 },
    });
  }

  const holdingsResponse = await tossGetWithRetry(
    "/api/v1/holdings",
    { accountSeq: selectedAccountSeq },
    LIVE_INVESTMENT_STATUS_RETRY_OPTIONS
  );
  const rawItems = Array.isArray(holdingsResponse?.result?.items) ? holdingsResponse.result.items : [];
  const symbols = rawItems.map((item) => item?.symbol);
  let priceResponses = [];
  let priceIssue = null;
  try {
    priceResponses = await fetchPriceResponsesForSymbols(symbols);
  } catch (error) {
    priceIssue = endpointErrorResponse(error);
  }
  return buildLiveInvestmentStatusPayload({
    accountsResponse,
    holdingsResponse,
    priceResponses,
    selectedAccountSeq,
    requestedCurrency,
    requestSummary: { accounts: 1, holdings: 1, prices: priceResponses.length, priceIssue },
  });
}

async function liveInvestmentStatusFromRequest(req) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const accountSeq = optionalAccountSeqFromRequest(req);
  const requestedCurrency = normalizeCurrency(url.searchParams.get("currency") || url.searchParams.get("unit") || "KRW");
  const force = ["1", "true", "yes"].includes(cleanText(url.searchParams.get("force") || "", 10).toLowerCase());
  const credentialsScope = credentialCacheScope(readCredentialsOrThrow());
  const cacheKey = `${credentialsScope}:${accountSeq || "default"}:${requestedCurrency}`;
  const cached = liveInvestmentStatusCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.createdAtMs <= LIVE_INVESTMENT_STATUS_CACHE_TTL_MS) {
    return {
      ...cached.payload,
      cached: true,
      cacheAgeMs: Date.now() - cached.createdAtMs,
    };
  }
  if (liveInvestmentStatusInFlight.has(cacheKey)) {
    return liveInvestmentStatusInFlight.get(cacheKey);
  }
  const promise = buildLiveInvestmentStatus({ accountSeq, requestedCurrency }).then((payload) => {
    liveInvestmentStatusCache.set(cacheKey, { createdAtMs: Date.now(), payload });
    return payload;
  });
  liveInvestmentStatusInFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    liveInvestmentStatusInFlight.delete(cacheKey);
  }
}

async function tossGet(path, { accountSeq = "", configureUrl = null } = {}) {
  const token = await issueToken();
  const accessToken = decryptTokenFromCache(token);
  const url = new URL(path, baseUrl());
  if (configureUrl) configureUrl(url);
  await paceTossRateLimitGroup(tossRateLimitGroupForPath(path));
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  if (accountSeq) headers["X-Tossinvest-Account"] = accountSeq;
  const response = await fetchWithTimeout(url.toString(), { method: "GET", headers });
  const { payload, requestId, rateLimit } = await readTossResponse(response);
  if (!response.ok) {
    const message = tossErrorMessage(payload, `토스증권 API 호출 실패: HTTP ${response.status}`);
    const error = new Error(message);
    error.statusCode = response.status;
    error.errorCode = publicTossErrorCode(
      payload?.error_description,
      payload?.error?.message,
      payload?.error?.code,
      payload?.error
    );
    error.requestId = requestId;
    error.rateLimit = rateLimit;
    error.payload = payload;
    throw error;
  }
  return {
    ok: true,
    result: payload.result ?? payload,
    requestId,
    rateLimit,
    token: publicTokenStatus(),
  };
}

async function tossGetWithRetry(path, options = {}, { retries = 2, retryRateLimited = true } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await tossGet(path, options);
    } catch (error) {
      lastError = error;
      const retryAfterSeconds = Number(error?.rateLimit?.retryAfter || 0);
      const rateLimited = error?.statusCode === 429 || retryAfterSeconds > 0;
      const retryable = rateLimited && retryRateLimited;
      if (!retryable || attempt >= retries) throw error;
      const delayMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 600 * 2 ** attempt;
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function endpointErrorResponse(error) {
  return {
    ok: false,
    error: error.message,
    errorCode: error.errorCode || "",
    requestId: error.requestId || "",
    rateLimit: error.rateLimit || null,
  };
}

async function handleCredentials(req, res) {
  if (req.method === "PUT" || req.method === "POST") {
    const payload = await readJsonBody(req, 8192);
    writeCredentials(payload);
    sendJson(res, publicStatus({ saved: true }));
    return;
  }
  if (req.method === "DELETE") {
    const deleted = deleteCredentials();
    sendJson(res, publicStatus({ deleted: true, ...deleted }));
    return;
  }
  sendJson(res, { ok: false, error: "method not allowed" }, 405);
}

async function handleUnlock(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  const payload = await readJsonBody(req, 4096);
  unlockCredentials(payload);
  sendJson(res, publicStatus({ unlocked: true }));
}

async function handleLock(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  lockCredentials();
  sendJson(res, publicStatus({ locked: true }));
}

async function handleProbe(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  const token = await issueToken();
  const accounts = await tossGet("/api/v1/accounts");
  sendJson(res, {
    ...publicStatus({
      connected: true,
      token: publicTokenStatus(),
      tokenRequestId: token.requestId || "",
      accounts: accounts.result,
      accountCount: Array.isArray(accounts.result) ? accounts.result.length : 0,
      requestId: accounts.requestId,
      rateLimit: accounts.rateLimit,
    }),
  });
}

async function handlePublicIp(req, res) {
  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  sendJson(res, await lookupPublicIp());
}

async function handleOrderSyncStatus(req, res) {
  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  sendJson(res, await publicOrderSyncStatus());
}

async function handleOrderSyncSettings(req, res) {
  if (req.method !== "PATCH" && req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  const payload = await readJsonBody(req, 4096);
  writeOrderSyncSettingsPatch(payload);
  sendJson(res, await publicOrderSyncStatus());
}

async function handleOrderSyncRun(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  const payload = await readJsonBody(req, 4096).catch(() => ({}));
  sendJson(res, await syncTossInvestOrderHistory({ force: payload?.force === true }));
}

async function handleOrderSyncRebuild(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  const payload = await readJsonBody(req, 4096).catch(() => ({}));
  sendJson(res, await rebuildCompletedOrderSyncSnapshots({ forceFull: payload?.forceFull === true }));
}

async function handleOrderSyncInvestmentHistory(req, res) {
  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const payload = await runPythonJsonScript(
    ORDER_SYNC_POSITION_RECONSTRUCT_SCRIPT,
    [
      "investment-history",
      "--start-date",
      cleanDateKey(url.searchParams.get("startDate") || url.searchParams.get("start") || ""),
      "--end-date",
      cleanDateKey(url.searchParams.get("endDate") || url.searchParams.get("end") || ""),
      "--timeframe",
      cleanText(url.searchParams.get("timeframe") || url.searchParams.get("interval") || "1d", 20),
      "--currency",
      cleanText(url.searchParams.get("currency") || url.searchParams.get("unit") || "KRW", 10),
    ],
    null,
    {
      timeoutMs: ORDER_SYNC_STATUS_SCRIPT_TIMEOUT_MS,
      missingMessage: "거래내역 복원 스크립트를 찾지 못했습니다.",
      timeoutMessage: "투자 내역 스냅샷 조회 시간이 초과되었습니다.",
      failureMessage: "투자 내역 스냅샷 조회에 실패했습니다.",
    }
  );
  sendJson(res, payload);
}

async function handleOrderSyncPositionStatus(req, res) {
  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const payload = await runPythonJsonScript(
    ORDER_SYNC_POSITION_RECONSTRUCT_SCRIPT,
    [
      "position-status",
      "--end-date",
      cleanDateKey(url.searchParams.get("endDate") || url.searchParams.get("end") || ""),
      "--currency",
      cleanText(url.searchParams.get("currency") || url.searchParams.get("unit") || "KRW", 10),
      "--view",
      cleanText(url.searchParams.get("view") || url.searchParams.get("chartView") || "bar", 20),
    ],
    null,
    {
      timeoutMs: ORDER_SYNC_STATUS_SCRIPT_TIMEOUT_MS,
      missingMessage: "거래내역 복원 스크립트를 찾지 못했습니다.",
      timeoutMessage: "보유 종목 스냅샷 조회 시간이 초과되었습니다.",
      failureMessage: "보유 종목 스냅샷 조회에 실패했습니다.",
    }
  );
  sendJson(res, payload);
}

async function handleReadOnlyGet(kind, req, res) {
  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }

  if (kind === "accounts") {
    sendJson(res, await tossGet("/api/v1/accounts"));
    return;
  }
  if (kind === "investment-status") {
    sendJson(res, await liveInvestmentStatusFromRequest(req));
    return;
  }
  if (kind === "holdings") {
    sendJson(res, await tossGet("/api/v1/holdings", { accountSeq: accountSeqFromRequest(req) }));
    return;
  }
  if (kind === "prices") {
    sendJson(res, await tossGet("/api/v1/prices", { configureUrl: (url) => appendPricesQuery(req, url) }));
    return;
  }
  if (kind === "stocks") {
    sendJson(res, await tossGet("/api/v1/stocks", { configureUrl: (url) => appendStocksQuery(req, url) }));
    return;
  }
  if (kind === "candles") {
    sendJson(res, await tossGet("/api/v1/candles", { configureUrl: (url) => appendCandlesQuery(req, url) }));
    return;
  }
  if (kind === "exchange-rate") {
    sendJson(res, await tossGet("/api/v1/exchange-rate", { configureUrl: (url) => appendExchangeRateQuery(req, url) }));
    return;
  }
  if (kind === "market-calendar-kr") {
    sendJson(res, await tossGet("/api/v1/market-calendar/KR", { configureUrl: (url) => appendMarketCalendarQuery(req, url) }));
    return;
  }
  if (kind === "market-calendar-us") {
    sendJson(res, await tossGet("/api/v1/market-calendar/US", { configureUrl: (url) => appendMarketCalendarQuery(req, url) }));
    return;
  }
  if (kind === "orders") {
    sendJson(
      res,
      await tossGet("/api/v1/orders", {
        accountSeq: accountSeqFromRequest(req),
        configureUrl: (url) => appendOrderQuery(req, url),
      })
    );
    return;
  }
  if (kind === "order") {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const orderId = cleanText(url.searchParams.get("orderId") || "", 200);
    if (!orderId) throw new Error("orderId가 필요합니다.");
    sendJson(res, await tossGet(`/api/v1/orders/${encodeURIComponent(orderId)}`, { accountSeq: accountSeqFromRequest(req) }));
    return;
  }
  if (kind === "conditional-orders") {
    sendJson(
      res,
      await tossGet("/api/v1/conditional-orders", {
        accountSeq: accountSeqFromRequest(req),
        configureUrl: (url) => appendConditionalOrderQuery(req, url),
      })
    );
    return;
  }
  if (kind === "conditional-order") {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const conditionalOrderId = cleanText(url.searchParams.get("conditionalOrderId") || "", 200);
    if (!conditionalOrderId) throw new Error("conditionalOrderId가 필요합니다.");
    sendJson(
      res,
      await tossGet(`/api/v1/conditional-orders/${encodeURIComponent(conditionalOrderId)}`, {
        accountSeq: accountSeqFromRequest(req),
      })
    );
    return;
  }

  sendJson(res, { ok: false, error: "unknown endpoint" }, 404);
}

export async function handleTossInvestEndpoint(kind, req, res) {
  try {
    if (kind === "status") {
      if (req.method !== "GET") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, publicStatus());
      return;
    }
    if (kind === "credentials") {
      await handleCredentials(req, res);
      return;
    }
    if (kind === "unlock") {
      await handleUnlock(req, res);
      return;
    }
    if (kind === "lock") {
      await handleLock(req, res);
      return;
    }
    if (kind === "probe") {
      await handleProbe(req, res);
      return;
    }
    if (kind === "public-ip") {
      await handlePublicIp(req, res);
      return;
    }
    if (kind === "order-sync-status") {
      await handleOrderSyncStatus(req, res);
      return;
    }
    if (kind === "order-sync-settings") {
      await handleOrderSyncSettings(req, res);
      return;
    }
    if (kind === "order-sync-run") {
      await handleOrderSyncRun(req, res);
      return;
    }
    if (kind === "order-sync-rebuild") {
      await handleOrderSyncRebuild(req, res);
      return;
    }
    if (kind === "order-sync-investment-history") {
      await handleOrderSyncInvestmentHistory(req, res);
      return;
    }
    if (kind === "order-sync-position-status") {
      await handleOrderSyncPositionStatus(req, res);
      return;
    }
    if (
      kind === "prices" ||
      kind === "stocks" ||
      kind === "candles" ||
      kind === "exchange-rate" ||
      kind === "market-calendar-kr" ||
      kind === "market-calendar-us"
    ) {
      await handleReadOnlyGet(kind, req, res);
      return;
    }
    await handleReadOnlyGet(kind, req, res);
  } catch (error) {
    sendJson(res, endpointErrorResponse(error), error.statusCode || 500);
  }
}

export const __tossInvestTestHooks = {
  buildLiveInvestmentStatusPayload,
  clearRuntimeState: () => {
    tokenRequestPromise = null;
    clearTokenCache();
    liveInvestmentStatusCache.clear();
    liveInvestmentStatusInFlight.clear();
    paceTossRateLimitGroup = createTossRateLimitPacer();
  },
  createTossRateLimitPacer,
  tossRateLimitGroupForPath,
  tossRateLimitPublicSummary,
};
