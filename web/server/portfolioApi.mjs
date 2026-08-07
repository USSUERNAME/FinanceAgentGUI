import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const BACKTEST_SCRIPT = join(GUIBUILD_ROOT, "scripts", "portfolio_backtest_yfinance.py");
const BACKTEST_TIMEOUT_MS = 60000;
const PORTFOLIO_DATA_DIR = join(GUIBUILD_ROOT, "data", "portfolio");
const PORTFOLIO_CANVASES_PATH = join(PORTFOLIO_DATA_DIR, "portfolio-canvases.json");
const PORTFOLIO_CANVASES_BACKUP_PATH = join(PORTFOLIO_DATA_DIR, "portfolio-canvases.backup.json");
const PORTFOLIO_CANVASES_SCHEMA_VERSION = "finance-agent-gui.portfolio-canvases.v1";

function emptyPortfolioCanvasStore() {
  return { canvases: [], activeCanvasId: "" };
}

function portfolioCanvasStoreHasCanvases(store = {}) {
  return Array.isArray(store?.canvases) && store.canvases.length > 0;
}

function normalizePortfolioCanvasStoreForFile(value = {}) {
  const input = value?.store && typeof value.store === "object" ? value.store : value;
  const canvases = Array.isArray(input?.canvases) ? input.canvases : [];
  const requestedActiveCanvasId = String(input?.activeCanvasId || "").trim();
  const activeCanvasId = canvases.some((canvas) => String(canvas?.id || "") === requestedActiveCanvasId)
    ? requestedActiveCanvasId
    : String(canvases[0]?.id || "");
  return { canvases, activeCanvasId };
}

function publicPortfolioCanvasPaths() {
  return {
    primary: "data/portfolio/portfolio-canvases.json",
    backup: "data/portfolio/portfolio-canvases.backup.json",
  };
}

function ensurePortfolioDataDir() {
  mkdirSync(PORTFOLIO_DATA_DIR, { recursive: true });
}

function readPortfolioCanvasStoreFromPath(path) {
  const payload = JSON.parse(readFileSync(path, "utf8"));
  return normalizePortfolioCanvasStoreForFile(payload);
}

function readPortfolioCanvasStoreFile() {
  ensurePortfolioDataDir();
  if (existsSync(PORTFOLIO_CANVASES_PATH)) {
    try {
      return {
        store: readPortfolioCanvasStoreFromPath(PORTFOLIO_CANVASES_PATH),
        source: "file",
        recovered: false,
      };
    } catch {
      if (existsSync(PORTFOLIO_CANVASES_BACKUP_PATH)) {
        return {
          store: readPortfolioCanvasStoreFromPath(PORTFOLIO_CANVASES_BACKUP_PATH),
          source: "backup",
          recovered: true,
        };
      }
      throw new Error("portfolio canvas store is not valid JSON");
    }
  }
  if (existsSync(PORTFOLIO_CANVASES_BACKUP_PATH)) {
    return {
      store: readPortfolioCanvasStoreFromPath(PORTFOLIO_CANVASES_BACKUP_PATH),
      source: "backup",
      recovered: true,
    };
  }
  return {
    store: emptyPortfolioCanvasStore(),
    source: "empty",
    recovered: false,
  };
}

export function readPortfolioCanvasStoreSnapshot() {
  return readPortfolioCanvasStoreFile();
}

function writePortfolioCanvasStoreFile(store = {}) {
  ensurePortfolioDataDir();
  const normalizedStore = normalizePortfolioCanvasStoreForFile(store);
  const payload = {
    schemaVersion: PORTFOLIO_CANVASES_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    store: normalizedStore,
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const tmpPath = `${PORTFOLIO_CANVASES_PATH}.tmp`;
  writeFileSync(tmpPath, body);
  renameSync(tmpPath, PORTFOLIO_CANVASES_PATH);
  if (portfolioCanvasStoreHasCanvases(normalizedStore)) {
    const backupTmpPath = `${PORTFOLIO_CANVASES_BACKUP_PATH}.tmp`;
    writeFileSync(backupTmpPath, body);
    renameSync(backupTmpPath, PORTFOLIO_CANVASES_BACKUP_PATH);
  }
  return normalizedStore;
}

function runYfinanceBacktest(payload) {
  return new Promise((resolveRun) => {
    if (!existsSync(BACKTEST_SCRIPT)) {
      resolveRun({
        ok: false,
        code: "BACKTEST_SCRIPT_MISSING",
        error: "scripts/portfolio_backtest_yfinance.py was not found.",
      });
      return;
    }

    const python = process.env.FINANCE_AGENT_GUI_PYTHON || process.env.PYTHON || "python3";
    const child = spawn(python, [BACKTEST_SCRIPT], {
      cwd: GUIBUILD_ROOT,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolveRun({
        ok: false,
        code: "YFINANCE_BACKTEST_TIMEOUT",
        error: `yfinance backtest exceeded ${Math.round(BACKTEST_TIMEOUT_MS / 1000)}s.`,
      });
    }, BACKTEST_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({
        ok: false,
        code: "YFINANCE_BACKTEST_SPAWN_FAILED",
        error: error.message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        resolveRun({
          ok: false,
          code: "YFINANCE_BACKTEST_FAILED",
          error: stderr.trim() || `python exited with code ${code}`,
        });
        return;
      }

      try {
        const payloadJson = JSON.parse(stdout.trim());
        resolveRun({
          ...payloadJson,
          stderrTail: stderr.trim().split(/\r?\n/).slice(-5).join("\n"),
        });
      } catch (error) {
        resolveRun({
          ok: false,
          code: "YFINANCE_BACKTEST_BAD_JSON",
          error: error.message,
          stdoutTail: stdout.trim().slice(-1000),
          stderrTail: stderr.trim().slice(-1000),
        });
      }
    });

    child.stdin.end(JSON.stringify(payload || {}));
  });
}

export async function handlePortfolioEndpoint(kind, req, res) {
  if (kind === "canvases") {
    try {
      if (req.method === "GET") {
        const result = readPortfolioCanvasStoreFile();
        sendJson(res, {
          ok: true,
          ...result,
          paths: publicPortfolioCanvasPaths(),
        });
        return;
      }
      if (req.method === "PUT" || req.method === "POST") {
        const body = await readJsonBody(req);
        const store = writePortfolioCanvasStoreFile(body?.store || body);
        sendJson(res, {
          ok: true,
          store,
          source: "file",
          paths: publicPortfolioCanvasPaths(),
        });
        return;
      }
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 500);
    }
    return;
  }

  if (kind !== "backtest") {
    sendJson(res, { ok: false, error: "unknown portfolio endpoint" }, 404);
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await runYfinanceBacktest(body);
    sendJson(res, result, result.ok ? 200 : 422);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
