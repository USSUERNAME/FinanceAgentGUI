import { parse } from "node-html-parser";
import { sendJson } from "./codexProbe.mjs";

const KRX_LISTED_COMPANIES_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const KRX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NYSE_QUOTES_FILTER_URL = "https://www.nyse.com/api/quotes/filter";
const NYSE_CACHE_TTL_MS = 60 * 60 * 1000;
const MARKET_SYMBOL_SOURCES = ["KRX KIND", "NYSE Listings Directory"];
const NYSE_MARKET_BY_MIC = {
  ARCX: "NYSE Arca",
  XASE: "NYSE American",
  XNAS: "NASDAQ",
  XNCM: "NASDAQ Capital Market",
  XNGS: "NASDAQ Global Select",
  XNMS: "NASDAQ Global Market",
  XNYS: "NYSE",
};

let krxListedCompanyCache = {
  fetchedAt: 0,
  rows: [],
  promise: null,
};

let nyseListingsSearchCache = new Map();

function cleanText(value, limit = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanQuery(value) {
  return cleanText(value, 80);
}

function cleanLimit(value, fallback = 12) {
  return Math.max(1, Math.min(Number(value) || fallback, 30));
}

function cleanKrxSymbol(value) {
  const symbol = String(value || "").replace(/\D/g, "").slice(0, 6);
  return symbol.length === 6 ? symbol : "";
}

function cleanUsSymbol(value) {
  return cleanText(value, 40).toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 32);
}

function normalizeSearchText(value) {
  return cleanText(value, 120).toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function normalizeKrxMarket(value) {
  const text = cleanText(value, 40);
  if (text.includes("유가")) return "KOSPI";
  if (text.includes("코스닥")) return "KOSDAQ";
  if (text.includes("코넥스")) return "KONEX";
  return text;
}

function rowText(cell) {
  return cleanText(cell?.structuredText || cell?.text || "", 500);
}

function shouldSearchKrxListedCompanies(query) {
  return /[0-9가-힣ㄱ-ㅎㅏ-ㅣ]/.test(String(query || ""));
}

function shouldSearchNyseListings(query) {
  return /[A-Za-z]/.test(String(query || ""));
}

function parseKrxListedCompaniesHtml(html) {
  const root = parse(html || "");
  const rows = [];
  const seenSymbols = new Set();
  for (const tr of root.querySelectorAll("tr")) {
    const cells = tr.querySelectorAll("td");
    if (cells.length < 3) continue;
    const name = rowText(cells[0]);
    const symbol = cleanKrxSymbol(rowText(cells[2]));
    if (!name || !symbol || seenSymbols.has(symbol)) continue;
    seenSymbols.add(symbol);
    rows.push({
      symbol,
      name,
      market: normalizeKrxMarket(rowText(cells[1])),
      sector: rowText(cells[3]),
      source: "KRX KIND",
    });
  }
  return rows;
}

async function fetchKrxListedCompanies() {
  const response = await fetch(KRX_LISTED_COMPANIES_URL, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent": "FinanceAgentGUI local symbol lookup",
    },
  });
  if (!response.ok) {
    throw new Error(`KRX 상장사 목록을 불러오지 못했습니다. HTTP ${response.status}`);
  }
  const html = new TextDecoder("euc-kr").decode(await response.arrayBuffer());
  const rows = parseKrxListedCompaniesHtml(html);
  if (!rows.length) {
    throw new Error("KRX 상장사 목록 파싱 결과가 비어 있습니다.");
  }
  return rows;
}

async function krxListedCompanies() {
  const now = Date.now();
  if (krxListedCompanyCache.rows.length && now - krxListedCompanyCache.fetchedAt < KRX_CACHE_TTL_MS) {
    return krxListedCompanyCache.rows;
  }
  if (!krxListedCompanyCache.promise) {
    krxListedCompanyCache.promise = fetchKrxListedCompanies()
      .then((rows) => {
        krxListedCompanyCache = {
          fetchedAt: Date.now(),
          rows,
          promise: null,
        };
        return rows;
      })
      .catch((error) => {
        krxListedCompanyCache.promise = null;
        throw error;
      });
  }
  return krxListedCompanyCache.promise;
}

function marketFromNyseQuoteUrl(url) {
  const micCode = cleanText(String(url || "").match(/\/quote\/([^:/?#]+):/)?.[1] || "", 12).toUpperCase();
  return NYSE_MARKET_BY_MIC[micCode] || micCode || "US";
}

function toNyseFriendlyName(value) {
  let source = cleanText(value, 180);
  for (let index = 0; index < 3; index += 1) {
    const nextSource = source.replace(
      /\s+(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|PLC|LLC|N\.V\.|NV|S\.A\.|SA|SE|AG)$/i,
      ""
    );
    if (nextSource === source) break;
    source = nextSource;
  }
  const cased = source.toLocaleLowerCase("en-US").replace(/(^|[\s&/.-])([a-z])/g, (match, prefix, letter) => (
    `${prefix}${letter.toLocaleUpperCase("en-US")}`
  ));
  return cased
    .replace(/\bAdr\b/g, "ADR")
    .replace(/\bEtf\b/g, "ETF")
    .replace(/\bReit\b/g, "REIT")
    .replace(/\bNv\b/g, "NV")
    .replace(/\bSa\b/g, "SA")
    .replace(/\bSe\b/g, "SE")
    .replace(/\bAg\b/g, "AG")
    .replace(/\bPlc\b/g, "PLC")
    .replace(/\bLlc\b/g, "LLC");
}

function normalizeNyseListingRow(item = {}) {
  const symbol = cleanUsSymbol(
    item.normalizedTicker || item.symbolExchangeTicker || item.symbolTicker || item.ticker || item.symbol
  );
  const name = cleanText(item.instrumentName || item.companyName || item.securityName || item.name || symbol, 180);
  if (!symbol || !name) return null;
  const market = cleanText(
    item.market || item.exchange || item.micCode || item.exchangeId || marketFromNyseQuoteUrl(item.url),
    40
  );
  const friendlyName = toNyseFriendlyName(name);
  return {
    symbol,
    name,
    englishName: friendlyName && friendlyName.toLocaleLowerCase("en-US") !== name.toLocaleLowerCase("en-US")
      ? friendlyName
      : "",
    market: NYSE_MARKET_BY_MIC[market.toUpperCase()] || market || "US",
    source: "NYSE Listings Directory",
  };
}

function normalizeNyseListingsPayload(payload) {
  const sourceRows = Array.isArray(payload?.result) ? payload.result : Array.isArray(payload) ? payload : [];
  const rows = [];
  const seenSymbols = new Set();
  for (const item of sourceRows) {
    const row = normalizeNyseListingRow(item);
    if (!row || seenSymbols.has(row.symbol)) continue;
    seenSymbols.add(row.symbol);
    rows.push(row);
  }
  return rows;
}

async function fetchNyseListingsSearch(query, limit = 12) {
  const filterToken = cleanQuery(query);
  if (!filterToken || !shouldSearchNyseListings(filterToken)) return [];
  const response = await fetch(NYSE_QUOTES_FILTER_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Origin": "https://www.nyse.com",
      "Referer": "https://www.nyse.com/listings_directory/stock",
      "User-Agent": "FinanceAgentGUI local symbol lookup",
    },
    body: JSON.stringify({
      instrumentType: "EQUITY",
      pageNumber: 1,
      sortColumn: "NORMALIZED_TICKER",
      sortOrder: "ASC",
      maxResultsPerPage: cleanLimit(limit, 12),
      filterToken,
    }),
  });
  if (!response.ok) {
    throw new Error(`NYSE 종목 검색을 불러오지 못했습니다. HTTP ${response.status}`);
  }
  return normalizeNyseListingsPayload(await response.json());
}

async function searchNyseListings(query, limit = 12) {
  const clean = cleanQuery(query);
  if (!clean || !shouldSearchNyseListings(clean)) return [];
  const normalizedLimit = cleanLimit(limit, 12);
  const cacheKey = `${normalizeSearchText(clean)}:${normalizedLimit}`;
  const now = Date.now();
  const cached = nyseListingsSearchCache.get(cacheKey);
  if (cached?.promise) return cached.promise;
  if (cached && Array.isArray(cached.rows) && now - cached.fetchedAt < NYSE_CACHE_TTL_MS) {
    return cached.rows;
  }
  const promise = fetchNyseListingsSearch(clean, normalizedLimit)
    .then((rows) => {
      nyseListingsSearchCache.set(cacheKey, {
        fetchedAt: Date.now(),
        rows,
        promise: null,
      });
      while (nyseListingsSearchCache.size > 120) {
        const oldestKey = nyseListingsSearchCache.keys().next().value;
        nyseListingsSearchCache.delete(oldestKey);
      }
      return rows;
    })
    .catch((error) => {
      nyseListingsSearchCache.delete(cacheKey);
      throw error;
    });
  nyseListingsSearchCache.set(cacheKey, { fetchedAt: now, rows: [], promise });
  return promise;
}

function scoreMarketSymbolRow(row, query) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(row.name);
  const normalizedEnglishName = normalizeSearchText(row.englishName);
  const symbol = cleanText(row.symbol, 40).toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
  if (!normalizedQuery) return 100;
  if (symbol === normalizedQuery) return 0;
  if (normalizedName === normalizedQuery || normalizedEnglishName === normalizedQuery) return 1;
  if (symbol.startsWith(normalizedQuery)) return 2;
  if (normalizedName.startsWith(normalizedQuery) || normalizedEnglishName.startsWith(normalizedQuery)) return 3;
  if (symbol.includes(normalizedQuery)) return 4;
  if (normalizedName.includes(normalizedQuery) || normalizedEnglishName.includes(normalizedQuery)) return 5;
  return 100;
}

function rankMarketSymbolRows(rows, query, limit = 12) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  return rows
    .map((row, index) => ({ row, index, score: scoreMarketSymbolRow(row, query) }))
    .filter((entry) => entry.score < 100)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, cleanLimit(limit, 12))
    .map((entry) => entry.row);
}

function searchKrxListedCompanies(rows, query, limit = 12) {
  return rankMarketSymbolRows(rows, query, limit);
}

function mergeMarketSymbolRows(rowGroups, query, limit = 12) {
  const rows = [];
  const seenSymbols = new Set();
  for (const group of rowGroups) {
    for (const row of Array.isArray(group) ? group : []) {
      const symbol = cleanText(row?.symbol, 40).toUpperCase();
      if (!symbol || seenSymbols.has(symbol)) continue;
      seenSymbols.add(symbol);
      rows.push(row);
    }
  }
  return rankMarketSymbolRows(rows, query, limit);
}

export async function handleMarketSymbolCatalogEndpoint(kind, req, res) {
  try {
    if (kind !== "search") {
      sendJson(res, { ok: false, error: "unknown endpoint" }, 404);
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const query = cleanQuery(url.searchParams.get("query") || url.searchParams.get("q") || "");
    if (!query) {
      sendJson(res, { ok: true, result: [], source: MARKET_SYMBOL_SOURCES.join(", ") });
      return;
    }
    const limit = cleanLimit(url.searchParams.get("limit"), 12);
    const sourceLookups = [];
    if (shouldSearchKrxListedCompanies(query)) {
      sourceLookups.push(
        krxListedCompanies().then((rows) => ({
          source: "KRX KIND",
          rows: searchKrxListedCompanies(rows, query, limit),
          fetchedAt: krxListedCompanyCache.fetchedAt,
        }))
      );
    }
    if (shouldSearchNyseListings(query)) {
      sourceLookups.push(
        searchNyseListings(query, limit).then((rows) => ({
          source: "NYSE Listings Directory",
          rows,
          fetchedAt: Date.now(),
        }))
      );
    }
    const settled = await Promise.allSettled(sourceLookups);
    const fulfilled = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
    const warnings = settled
      .filter((entry) => entry.status === "rejected")
      .map((entry) => entry.reason?.message || "종목 목록 일부를 불러오지 못했습니다.");
    if (!fulfilled.length && warnings.length) {
      sendJson(res, { ok: false, error: warnings[0] || "종목 목록 조회에 실패했습니다." }, 500);
      return;
    }
    sendJson(res, {
      ok: true,
      result: mergeMarketSymbolRows(fulfilled.map((entry) => entry.rows), query, limit),
      source: fulfilled.map((entry) => entry.source).join(", ") || MARKET_SYMBOL_SOURCES.join(", "),
      sources: fulfilled.map((entry) => ({
        name: entry.source,
        fetchedAt: entry.fetchedAt ? new Date(entry.fetchedAt).toISOString() : null,
      })),
      warnings,
    });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message || "종목 목록 조회에 실패했습니다." }, 500);
  }
}

export const __marketSymbolCatalogTestHooks = {
  parseKrxListedCompaniesHtml,
  normalizeNyseListingsPayload,
  searchNyseListings,
  searchKrxListedCompanies,
};
