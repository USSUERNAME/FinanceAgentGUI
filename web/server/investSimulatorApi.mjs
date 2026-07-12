import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBinanceExecutionQuote } from "./binanceMarketDataApi.mjs";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const STORE_SCRIPT = join(GUIBUILD_ROOT, "scripts", "invest_simulator_store.py");
const STORE_TIMEOUT_MS = 10_000;

function pythonCandidates() {
  const localVenvPython =
    process.platform === "win32"
      ? join(GUIBUILD_ROOT, ".venv", "Scripts", "python.exe")
      : join(GUIBUILD_ROOT, ".venv", "bin", "python");
  return process.platform === "win32"
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
}

function runStoreWithCandidate(candidate, command, payload = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(candidate.command, [...candidate.argsPrefix, STORE_SCRIPT, command], {
      cwd: GUIBUILD_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, error: `${candidate.display} timed out while running ${command}` });
    }, STORE_TIMEOUT_MS);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun(result);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim() || "{}");
      } catch (error) {
        finish({ ok: false, error: `invalid ${candidate.display} simulator output: ${error.message}` });
        return;
      }
      if (code !== 0 || parsed?.ok === false) {
        finish({ ok: false, error: parsed?.error || stderr.trim() || `${candidate.display} exited ${code}` });
        return;
      }
      finish({ ...parsed, python: candidate.display });
    });
    child.stdin.end(`${JSON.stringify(payload || {})}\n`);
  });
}

async function runStore(command, payload = {}) {
  const errors = [];
  for (const candidate of pythonCandidates()) {
    if (candidate.command.includes(".venv") && !existsSync(candidate.command)) continue;
    const result = await runStoreWithCandidate(candidate, command, payload);
    if (result.ok) return result;
    errors.push(`${candidate.display}: ${result.error || "failed"}`);
  }
  throw new Error(errors.join("; ") || "Python executable not found");
}

function queryPayload(req) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  return Object.fromEntries(url.searchParams.entries());
}

function cleanOrderText(value) {
  return String(value ?? "").trim();
}

function isBinanceOrderPayload(payload = {}) {
  return cleanOrderText(payload?.provider).toLowerCase() === "binance" ||
    /^binance:(spot|usdm):/i.test(cleanOrderText(payload?.instrumentId));
}

export function requireOrderIdempotencyKey(payload = {}) {
  const idempotencyKey = cleanOrderText(payload?.idempotencyKey).slice(0, 160);
  if (idempotencyKey) return idempotencyKey;
  const error = new Error("idempotencyKey is required for simulator orders");
  error.code = "SIMULATOR_IDEMPOTENCY_KEY_REQUIRED";
  error.statusCode = 400;
  error.retryable = false;
  throw error;
}

export async function prepareInvestSimulatorOrderPayload(
  payload = {},
  side = "buy",
  executionResolver = getBinanceExecutionQuote,
) {
  const source = payload && typeof payload === "object" ? payload : {};
  if (!isBinanceOrderPayload(source)) return source;
  const symbol = cleanOrderText(source.symbol).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const instrumentId = cleanOrderText(source.instrumentId) || (symbol ? `binance:spot:${symbol}` : "");
  const execution = await executionResolver(instrumentId);
  const instrument = execution?.instrument || {};
  const quote = execution?.quote || {};
  const price = Number(execution?.executionPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Binance current execution price is invalid");
  }
  const normalizedSide = cleanOrderText(side).toLowerCase() === "sell" ? "sell" : "buy";
  const settlementAmount = Number(source.settlementAmount ?? source.grossAmount ?? source.amount);
  const requestedQuantity = Number(source.quantity);
  const quantity = normalizedSide === "buy" && Number.isFinite(settlementAmount) && settlementAmount > 0
    ? settlementAmount / price
    : requestedQuantity;
  return {
    ...source,
    ...instrument,
    instrumentId: instrument.instrumentId,
    provider: "binance",
    venue: instrument.venue || "BINANCE_SPOT",
    assetClass: instrument.assetClass || "crypto",
    symbol: instrument.symbol,
    displaySymbol: instrument.displaySymbol,
    baseAsset: instrument.baseAsset,
    quoteAsset: instrument.quoteAsset,
    nativeQuoteAsset: instrument.nativeQuoteAsset || instrument.quoteAsset,
    settlementAsset: "USD",
    settlementCurrency: "USD",
    currency: "USD",
    status: "TRADING",
    sessionPolicy: "24x7",
    market: instrument.market || instrument.venue || "BINANCE_SPOT",
    marketCountry: "GLOBAL",
    price,
    executionPrice: price,
    priceCurrency: "USD",
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : source.quantity,
    feeAmount: 0,
    feeCurrency: "USD",
    feeAssumption: "zero-no-public-account-rate",
    marketSession: "24x7",
    priceTimestamp: quote.timestamp || "",
    priceSource: quote.source || "binance-market-data",
  };
}

export async function handleInvestSimulatorEndpoint(kind, req, res) {
  try {
    if (kind === "status") {
      if (req.method !== "GET") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await runStore("status", {}));
      return;
    }
    if (kind === "accounts") {
      if (req.method === "GET") {
        sendJson(res, await runStore("accounts", {}));
        return;
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, await runStore("create-account", body || {}));
        return;
      }
      if (req.method === "PATCH") {
        const body = await readJsonBody(req);
        sendJson(res, await runStore("rename-account", body || {}));
        return;
      }
      if (req.method === "DELETE") {
        sendJson(res, await runStore("archive-account", queryPayload(req)));
        return;
      }
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    if (kind === "events") {
      if (req.method !== "GET") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, await runStore("events", queryPayload(req)));
      return;
    }
    if (kind === "exchange") {
      if (req.method !== "POST") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      const body = await readJsonBody(req);
      sendJson(res, await runStore("exchange", body || {}));
      return;
    }
    if (kind === "orders") {
      if (req.method !== "POST") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      const body = await readJsonBody(req);
      const side = String(body?.side || "buy").trim().toLowerCase();
      const command = side === "sell" ? "sell" : "buy";
      const idempotencyKey = requireOrderIdempotencyKey(body || {});
      const orderPayload = await prepareInvestSimulatorOrderPayload(
        { ...(body || {}), idempotencyKey },
        command,
      );
      sendJson(res, await runStore(command, orderPayload));
      return;
    }
    sendJson(res, { ok: false, error: "unknown invest simulator endpoint" }, 404);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(
      res,
      {
        ok: false,
        error: error.message || "invest simulator API failed",
        code: error?.code || "INVEST_SIMULATOR_API_FAILED",
        retryable: error?.retryable !== false,
        details: error?.details || null,
      },
      statusCode,
    );
  }
}
