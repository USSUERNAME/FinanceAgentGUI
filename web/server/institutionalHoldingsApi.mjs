import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_ROOT = resolve(WEB_ROOT, "..");
const CACHE_PATH = join(
  APP_ROOT,
  "data",
  "pb-daily-intelligence",
  "institutional-holdings-radar.json",
);
const DOTENV_PATH = join(APP_ROOT, ".env");
const SCHEMA_VERSION = "institutional_holdings_radar.v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_QUARTERS = 8;
const SEC_ORIGIN = "https://www.sec.gov";
const SEC_DATA_ORIGIN = "https://data.sec.gov";

export const DEFAULT_13F_MANAGERS = Object.freeze([
  { id: "berkshire", name: "Berkshire Hathaway", principal: "Warren Buffett", cik: "0001067983" },
  { id: "pershing-square", name: "Pershing Square", principal: "Bill Ackman", cik: "0001336528" },
  { id: "duquesne", name: "Duquesne Family Office", principal: "Stanley Druckenmiller", cik: "0001536411" },
  { id: "appaloosa", name: "Appaloosa", principal: "David Tepper", cik: "0001656456" },
  { id: "baupost", name: "Baupost Group", principal: "Seth Klarman", cik: "0001061768" },
  { id: "bridgewater", name: "Bridgewater Associates", principal: "Institutional team", cik: "0001350694" },
  { id: "soros", name: "Soros Fund Management", principal: "Institutional team", cik: "0001029160" },
  { id: "tiger-global", name: "Tiger Global Management", principal: "Chase Coleman", cik: "0001167483" },
  { id: "coatue", name: "Coatue Management", principal: "Philippe Laffont", cik: "0001135730" },
  { id: "scion", name: "Scion Asset Management", principal: "Michael Burry", cik: "0001649339" },
]);

const SECTORS = Object.freeze({
  XLC: "커뮤니케이션 서비스",
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
  ETF: "ETF·지수",
  UNKNOWN: "미분류",
});

const ISSUER_SECTOR_HINTS = Object.freeze([
  ["APPLE", "XLK"], ["MICROSOFT", "XLK"], ["NVIDIA", "XLK"], ["BROADCOM", "XLK"],
  ["ORACLE", "XLK"], ["SALESFORCE", "XLK"], ["ADOBE", "XLK"], ["PALANTIR", "XLK"],
  ["ALPHABET", "XLC"], ["META PLATFORMS", "XLC"], ["NETFLIX", "XLC"], ["WALT DISNEY", "XLC"],
  ["AMAZON", "XLY"], ["TESLA", "XLY"], ["HOME DEPOT", "XLY"], ["MCDONALDS", "XLY"],
  ["WALMART", "XLP"], ["COSTCO", "XLP"], ["PEPSICO", "XLP"], ["COCA COLA", "XLP"],
  ["EXXON", "XLE"], ["CHEVRON", "XLE"], ["CONOCOPHILLIPS", "XLE"], ["OCCIDENTAL", "XLE"],
  ["JPMORGAN", "XLF"], ["BANK OF AMERICA", "XLF"], ["WELLS FARGO", "XLF"],
  ["GOLDMAN SACHS", "XLF"], ["MORGAN STANLEY", "XLF"], ["VISA", "XLF"], ["MASTERCARD", "XLF"],
  ["ELI LILLY", "XLV"], ["UNITEDHEALTH", "XLV"], ["JOHNSON JOHNSON", "XLV"],
  ["ABBVIE", "XLV"], ["MERCK", "XLV"], ["PFIZER", "XLV"],
  ["CATERPILLAR", "XLI"], ["RTX", "XLI"], ["HONEYWELL", "XLI"], ["BOEING", "XLI"],
  ["LINDE", "XLB"], ["FREEPORT", "XLB"], ["NEWMONT", "XLB"], ["NUCOR", "XLB"],
  ["PROLOGIS", "XLRE"], ["EQUINIX", "XLRE"], ["AMERICAN TOWER", "XLRE"],
  ["NEXTERA", "XLU"], ["DUKE ENERGY", "XLU"], ["SOUTHERN CO", "XLU"],
  ["CONSTELLATION ENERGY", "XLU"], ["VISTRA", "XLU"],
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function cleanText(value, maxLength = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function finiteNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) ? number : 0;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? [value] : [];
}

function normalizeIssuerName(value) {
  return cleanText(value, 200)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b(THE|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|PLC|HOLDINGS?|GROUP|CLASS|CL|COM|NEW|DEL)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDotEnvValue(text, key) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] !== key) continue;
    return match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return "";
}

async function configuredSecUserAgent(env = process.env) {
  const direct = cleanText(env.SEC_13F_USER_AGENT || env.SEC_USER_AGENT, 300);
  if (direct) return direct;
  if (!existsSync(DOTENV_PATH)) return "";
  const dotenv = await readFile(DOTENV_PATH, "utf8").catch(() => "");
  return cleanText(
    parseDotEnvValue(dotenv, "SEC_13F_USER_AGENT")
      || parseDotEnvValue(dotenv, "SEC_USER_AGENT"),
    300,
  );
}

function validSecUserAgent(value) {
  const text = cleanText(value, 300);
  return text.length >= 12 && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text);
}

function filingSourceUrl(cik, accessionNumber) {
  const cikNumber = String(Number(cik));
  const accessionCompact = String(accessionNumber).replaceAll("-", "");
  return `${SEC_ORIGIN}/Archives/edgar/data/${cikNumber}/${accessionCompact}/${accessionNumber}-index.html`;
}

export function selectRecent13fFilings(submissions = {}, limit = MAX_QUARTERS) {
  const recent = submissions?.filings?.recent || {};
  const forms = asArray(recent.form);
  const rows = forms.map((form, index) => ({
    form: cleanText(form, 20).toUpperCase(),
    accessionNumber: cleanText(recent.accessionNumber?.[index], 40),
    reportDate: cleanText(recent.reportDate?.[index], 20),
    filingDate: cleanText(recent.filingDate?.[index], 20),
    primaryDocument: cleanText(recent.primaryDocument?.[index], 200),
  })).filter((row) => row.form === "13F-HR" && row.accessionNumber && row.reportDate);

  const byReportDate = new Map();
  for (const row of rows.sort((left, right) => right.filingDate.localeCompare(left.filingDate))) {
    if (!byReportDate.has(row.reportDate)) byReportDate.set(row.reportDate, row);
  }
  return [...byReportDate.values()]
    .sort((left, right) => right.reportDate.localeCompare(left.reportDate))
    .slice(0, Math.max(1, Number(limit) || MAX_QUARTERS));
}

export function parse13fInformationTable(xmlText = "") {
  const parsed = xmlParser.parse(String(xmlText || ""));
  const root = parsed?.informationTable || parsed?.form13FInformationTable || parsed;
  const rows = asArray(root?.infoTable || root?.informationTable?.infoTable);
  return rows.map((row) => {
    const shares = row?.shrsOrPrnAmt || {};
    const voting = row?.votingAuthority || {};
    const putCall = cleanText(row?.putCall, 20).toUpperCase();
    return {
      issuer: cleanText(row?.nameOfIssuer, 200),
      titleOfClass: cleanText(row?.titleOfClass, 100),
      cusip: cleanText(row?.cusip, 20).toUpperCase(),
      value: finiteNumber(row?.value),
      shares: finiteNumber(shares?.sshPrnamt),
      shareType: cleanText(shares?.sshPrnamtType, 20).toUpperCase() || "SH",
      putCall: ["PUT", "CALL"].includes(putCall) ? putCall : "",
      discretion: cleanText(row?.investmentDiscretion, 40),
      votingSole: finiteNumber(voting?.Sole),
      votingShared: finiteNumber(voting?.Shared),
      votingNone: finiteNumber(voting?.None),
    };
  }).filter((row) => row.issuer && row.cusip && row.value >= 0);
}

async function readSectorMembership(env = process.env) {
  const workspace = cleanText(env.PB_DAILY_INTELLIGENCE_DIR, 2000);
  if (!workspace) return { asOf: "", members: [] };
  const parent = join(resolve(workspace), "us_sector_holdings");
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  const dates = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const date of dates) {
    const filePath = join(parent, date, "sector_holdings.json");
    if (!existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(await readFile(filePath, "utf8"));
      if (payload?.schema_version !== "us_sector_holdings_proxy.v1") continue;
      const members = [];
      for (const sector of asArray(payload.sectors)) {
        const ticker = cleanText(sector?.sector_ticker, 10).toUpperCase();
        if (!SECTORS[ticker]) continue;
        for (const member of asArray(sector?.members)) {
          const normalizedName = normalizeIssuerName(member?.company_name);
          if (normalizedName) members.push({ normalizedName, ticker });
        }
      }
      return { asOf: date, members };
    } catch {
      // Continue to an older complete sector-membership artifact.
    }
  }
  return { asOf: "", members: [] };
}

function createSectorClassifier(sectorMembership = { members: [] }) {
  const exact = new Map(sectorMembership.members.map((item) => [item.normalizedName, item.ticker]));
  const memo = new Map();
  return (holding) => {
    const normalized = normalizeIssuerName(holding?.issuer);
    if (!normalized) return { ticker: "UNKNOWN", basis: "unmatched" };
    if (memo.has(normalized)) return memo.get(normalized);

    let ticker = exact.get(normalized) || "";
    let basis = ticker ? "spdr_sector_membership" : "";
    if (!ticker) {
      const partial = sectorMembership.members.find((item) => (
        item.normalizedName.length >= 7
        && normalized.length >= 7
        && (item.normalizedName.includes(normalized) || normalized.includes(item.normalizedName))
      ));
      if (partial) {
        ticker = partial.ticker;
        basis = "spdr_name_match";
      }
    }
    if (!ticker) {
      const hint = ISSUER_SECTOR_HINTS.find(([needle]) => normalized.includes(needle));
      if (hint) {
        ticker = hint[1];
        basis = "issuer_name_hint";
      }
    }
    if (!ticker && /\b(ETF|FUND|TRUST|ISHARES|SPDR|VANGUARD|INVESCO)\b/.test(normalized)) {
      ticker = "ETF";
      basis = "fund_name";
    }
    const result = { ticker: ticker || "UNKNOWN", basis: basis || "unmatched" };
    memo.set(normalized, result);
    return result;
  };
}

export function normalizeSnapshot({ manager, filing, holdings, classifySector }) {
  const normalizedHoldings = holdings.map((holding) => {
    const sector = classifySector(holding);
    return {
      ...holding,
      securityKey: `${holding.cusip}:${holding.titleOfClass}:${holding.putCall || "LONG"}`,
      sectorTicker: sector.ticker,
      sectorLabel: SECTORS[sector.ticker] || SECTORS.UNKNOWN,
      sectorBasis: sector.basis,
    };
  });
  const commonHoldings = normalizedHoldings.filter(
    (holding) => !holding.putCall && holding.shareType === "SH",
  );
  const totalValue = commonHoldings.reduce((sum, holding) => sum + holding.value, 0);
  const classifiedValue = commonHoldings
    .filter((holding) => holding.sectorTicker !== "UNKNOWN")
    .reduce((sum, holding) => sum + holding.value, 0);
  const withWeights = commonHoldings.map((holding) => ({
    ...holding,
    portfolioWeightPct: totalValue ? (holding.value / totalValue) * 100 : 0,
  }));
  const sectors = new Map();
  for (const holding of withWeights) {
    const current = sectors.get(holding.sectorTicker) || { value: 0, holdingCount: 0 };
    current.value += holding.value;
    current.holdingCount += 1;
    sectors.set(holding.sectorTicker, current);
  }
  return {
    reportDate: filing.reportDate,
    filingDate: filing.filingDate,
    accessionNumber: filing.accessionNumber,
    sourceUrl: filingSourceUrl(manager.cik, filing.accessionNumber),
    totalValue,
    holdingCount: withWeights.length,
    optionHoldingCount: normalizedHoldings.filter((holding) => Boolean(holding.putCall)).length,
    principalHoldingCount: normalizedHoldings.filter(
      (holding) => !holding.putCall && holding.shareType !== "SH",
    ).length,
    classificationCoveragePct: totalValue ? (classifiedValue / totalValue) * 100 : 0,
    holdings: withWeights,
    sectors: [...sectors.entries()].map(([ticker, row]) => ({
      ticker,
      label: SECTORS[ticker] || SECTORS.UNKNOWN,
      value: row.value,
      holdingCount: row.holdingCount,
      weightPct: totalValue ? (row.value / totalValue) * 100 : 0,
    })).sort((left, right) => right.value - left.value),
  };
}

function compareManagerSnapshots(current, previous) {
  if (!current || !previous) return [];
  const currentByKey = new Map(current.holdings.map((holding) => [holding.securityKey, holding]));
  const previousByKey = new Map((previous?.holdings || []).map((holding) => [holding.securityKey, holding]));
  const keys = new Set([...currentByKey.keys(), ...previousByKey.keys()]);
  const moves = [];
  for (const key of keys) {
    const next = currentByKey.get(key) || null;
    const prior = previousByKey.get(key) || null;
    if (next?.shareType && prior?.shareType && next.shareType !== prior.shareType) continue;
    const currentShares = next?.shares || 0;
    const previousShares = prior?.shares || 0;
    const deltaShares = currentShares - previousShares;
    let action = "unchanged";
    if (!prior && next) action = "new";
    else if (prior && !next) action = "exited";
    else if (deltaShares > 0) action = "increased";
    else if (deltaShares < 0) action = "decreased";
    if (action === "unchanged") continue;
    const currentWeightPct = next?.portfolioWeightPct || 0;
    const previousWeightPct = prior?.portfolioWeightPct || 0;
    moves.push({
      securityKey: key,
      issuer: next?.issuer || prior?.issuer || "",
      titleOfClass: next?.titleOfClass || prior?.titleOfClass || "",
      cusip: next?.cusip || prior?.cusip || "",
      sectorTicker: next?.sectorTicker || prior?.sectorTicker || "UNKNOWN",
      sectorLabel: next?.sectorLabel || prior?.sectorLabel || SECTORS.UNKNOWN,
      action,
      currentShares,
      previousShares,
      deltaShares,
      deltaSharesPct: previousShares ? (deltaShares / previousShares) * 100 : null,
      currentWeightPct,
      previousWeightPct,
      weightDeltaPp: currentWeightPct - previousWeightPct,
      actionImpact: (action === "new" || action === "increased" ? 1 : -1)
        * Math.max(currentWeightPct, previousWeightPct),
    });
  }
  return moves.sort((left, right) => Math.abs(right.actionImpact) - Math.abs(left.actionImpact));
}

export function buildInstitutionalHoldingsRadar({
  managerHistories = [],
  sectorMembershipAsOf = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const managers = managerHistories.map((history) => {
    const filings = asArray(history.filings)
      .sort((left, right) => right.reportDate.localeCompare(left.reportDate));
    const latest = filings[0] || null;
    const previous = filings[1] || null;
    const moves = compareManagerSnapshots(latest, previous);
    return {
      ...history.manager,
      status: history.error ? "failed" : latest ? "ready" : "unavailable",
      errorType: cleanText(history.errorType, 80),
      latest: latest ? {
        reportDate: latest.reportDate,
        filingDate: latest.filingDate,
        sourceUrl: latest.sourceUrl,
        totalValue: latest.totalValue,
        holdingCount: latest.holdingCount,
        optionHoldingCount: latest.optionHoldingCount,
        principalHoldingCount: latest.principalHoldingCount,
        classificationCoveragePct: latest.classificationCoveragePct,
        topHoldings: latest.holdings.slice().sort((a, b) => b.value - a.value).slice(0, 5),
        sectors: latest.sectors,
      } : null,
      previousReportDate: previous?.reportDate || "",
      moves: moves.slice(0, 8),
      allMoves: moves,
      history: filings.map((filing) => ({
        reportDate: filing.reportDate,
        filingDate: filing.filingDate,
        sourceUrl: filing.sourceUrl,
        totalValue: filing.totalValue,
        holdingCount: filing.holdingCount,
        classificationCoveragePct: filing.classificationCoveragePct,
        sectors: filing.sectors,
      })),
    };
  });

  const sectorAccumulator = new Map();
  const securityAccumulator = new Map();
  for (const manager of managers.filter((item) => item.status === "ready")) {
    const sectorImpacts = new Map();
    const managerSecurityAdds = new Map();
    for (const move of manager.allMoves) {
      if (move.sectorTicker === "UNKNOWN" || move.sectorTicker === "ETF") continue;
      sectorImpacts.set(
        move.sectorTicker,
        (sectorImpacts.get(move.sectorTicker) || 0) + move.actionImpact,
      );
      if (!["new", "increased"].includes(move.action)) continue;
      const securityKey = normalizeIssuerName(move.issuer);
      const priorMove = managerSecurityAdds.get(securityKey);
      if (!priorMove || move.action === "new") managerSecurityAdds.set(securityKey, move);
    }
    for (const [securityKey, move] of managerSecurityAdds) {
      const security = securityAccumulator.get(securityKey) || {
        issuer: move.issuer,
        sectorTicker: move.sectorTicker,
        sectorLabel: move.sectorLabel,
        managers: [],
        newManagerCount: 0,
        increasedManagerCount: 0,
      };
      security.managers.push(manager.name);
      if (move.action === "new") security.newManagerCount += 1;
      else security.increasedManagerCount += 1;
      securityAccumulator.set(securityKey, security);
    }
    const currentSectors = new Map(
      (manager.latest?.sectors || [])
        .filter((sector) => !["UNKNOWN", "ETF"].includes(sector.ticker))
        .map((sector) => [sector.ticker, sector]),
    );
    const sectorTickers = new Set([...currentSectors.keys(), ...sectorImpacts.keys()]);
    for (const ticker of sectorTickers) {
      const sector = currentSectors.get(ticker);
      const row = sectorAccumulator.get(ticker) || {
        ticker,
        label: sector?.label || SECTORS[ticker] || ticker,
        currentWeights: [],
        managerAdds: [],
        managerCuts: [],
      };
      row.currentWeights.push(sector?.weightPct || 0);
      const impact = sectorImpacts.get(ticker) || 0;
      if (impact >= 0.25) row.managerAdds.push(manager.name);
      if (impact <= -0.25) row.managerCuts.push(manager.name);
      sectorAccumulator.set(ticker, row);
    }
  }

  const sectorConsensus = [...sectorAccumulator.values()].map((row) => {
    const observationCount = row.managerAdds.length + row.managerCuts.length;
    const mappedCoverage = managers
      .filter((manager) => manager.latest)
      .reduce((sum, manager) => sum + manager.latest.classificationCoveragePct, 0)
      / Math.max(1, managers.filter((manager) => manager.latest).length);
    let signal = "mixed";
    if (row.managerAdds.length >= 3 && row.managerAdds.length > row.managerCuts.length) signal = "accumulation_candidate";
    if (row.managerCuts.length >= 3 && row.managerCuts.length > row.managerAdds.length) signal = "reduction_candidate";
    return {
      ...row,
      averageWeightPct: row.currentWeights.reduce((sum, value) => sum + value, 0) / Math.max(1, row.currentWeights.length),
      signal,
      confidence: observationCount >= 5 && mappedCoverage >= 65 ? "high" : observationCount >= 3 ? "medium" : "low",
      interpretation: signal === "accumulation_candidate"
        ? `${row.managerAdds.length}개 운용사에서 수량 기반 확대 흐름이 관찰됐습니다.`
        : signal === "reduction_candidate"
          ? `${row.managerCuts.length}개 운용사에서 수량 기반 축소 흐름이 관찰됐습니다.`
          : "운용사 사이의 방향이 엇갈리거나 관찰 수가 부족합니다.",
    };
  }).sort((left, right) => (
    (right.managerAdds.length - right.managerCuts.length)
    - (left.managerAdds.length - left.managerCuts.length)
  ));

  const candidates = [...securityAccumulator.values()]
    .map((row) => ({
      ...row,
      managerCount: row.managers.length,
      researchPriority: row.managers.length >= 3 ? "A" : row.managers.length === 2 ? "B" : "C",
      status: row.managers.length >= 2 ? "deeper_research_candidate" : "screen_flag_only",
      nextWorkflow: "공식 실적·밸류에이션·현재 노출 검증",
    }))
    .sort((left, right) => right.managerCount - left.managerCount)
    .slice(0, 20);

  const reportDates = managers.map((manager) => manager.latest?.reportDate).filter(Boolean).sort();
  const readyManagers = managers.filter((manager) => manager.status === "ready");
  const averageCoverage = readyManagers.reduce(
    (sum, manager) => sum + manager.latest.classificationCoveragePct,
    0,
  ) / Math.max(1, readyManagers.length);
  const publicManagers = managers.map(({ allMoves, ...manager }) => manager);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    source: {
      provider: "SEC EDGAR",
      form: "13F-HR",
      officialDatasetUrl: "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets",
      faqUrl: "https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f",
      sectorMembershipAsOf,
    },
    summary: {
      trackedManagerCount: managers.length,
      readyManagerCount: readyManagers.length,
      latestReportDate: reportDates.at(-1) || "",
      earliestReportDate: reportDates[0] || "",
      averageClassificationCoveragePct: averageCoverage,
      quarterDepth: Math.max(0, ...managers.map((manager) => manager.history.length)),
    },
    sectorConsensus,
    candidates,
    managers: publicManagers,
    limitations: [
      "13F는 분기 말 이후 최대 45일가량 늦게 공개될 수 있습니다.",
      "공매도·현금·비대상 해외증권과 전체 파생 포지션을 보여주지 않습니다.",
      "보통주 섹터 흐름에 집중하기 위해 신고된 put/call 및 원금(PRN) 단위 항목을 집계에서 제외합니다.",
      "정정 공시(13F-HR/A)는 아직 원 공시 이력에 병합하지 않습니다.",
      "섹터 분류는 SPDR 공식 구성 종목과 제한된 발행사명 보조 규칙에만 근거하며 미분류 종목은 추론하지 않습니다.",
      "확대·축소는 주식 수 변화를 우선 사용하지만 합병·분할·주식 종류 변경의 영향이 남을 수 있습니다.",
      "이 결과는 아이디어 우선순위이며 매수·매도 추천이 아닙니다.",
    ],
  };
}

async function secFetch(url, { userAgent, fetchImpl, pauseMs = 120, responseType = "json" }) {
  if (pauseMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, pauseMs));
  const response = await fetchImpl(url, {
    headers: {
      accept: responseType === "json" ? "application/json" : "application/xml,text/xml,*/*;q=0.8",
      "accept-encoding": "gzip, deflate",
      "user-agent": userAgent,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`SEC request failed (${response.status})`);
  return responseType === "json" ? response.json() : response.text();
}

async function collectManagerHistory({ manager, userAgent, fetchImpl, classifySector, pauseMs }) {
  const submissionsUrl = `${SEC_DATA_ORIGIN}/submissions/CIK${manager.cik}.json`;
  const submissions = await secFetch(submissionsUrl, { userAgent, fetchImpl, pauseMs });
  const filings = selectRecent13fFilings(submissions, MAX_QUARTERS);
  const snapshots = [];
  for (const filing of filings) {
    const cikNumber = String(Number(manager.cik));
    const accessionCompact = filing.accessionNumber.replaceAll("-", "");
    const archiveRoot = `${SEC_ORIGIN}/Archives/edgar/data/${cikNumber}/${accessionCompact}`;
    const index = await secFetch(`${archiveRoot}/index.json`, { userAgent, fetchImpl, pauseMs });
    const items = asArray(index?.directory?.item);
    const xmlDocument = items.find((item) => (
      /\.xml$/i.test(String(item?.name || ""))
      && !/^primary[_-]?doc/i.test(String(item?.name || ""))
      && item?.name !== filing.primaryDocument
    ));
    if (!xmlDocument?.name) continue;
    const xml = await secFetch(`${archiveRoot}/${xmlDocument.name}`, {
      userAgent,
      fetchImpl,
      pauseMs,
      responseType: "text",
    });
    const holdings = parse13fInformationTable(xml);
    if (!holdings.length) continue;
    snapshots.push(normalizeSnapshot({ manager, filing, holdings, classifySector }));
  }
  return { manager, filings: snapshots };
}

export async function collectInstitutionalHoldingsRadar({
  env = process.env,
  fetchImpl = globalThis.fetch,
  managers = DEFAULT_13F_MANAGERS,
  pauseMs = 120,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is required");
  const userAgent = await configuredSecUserAgent(env);
  if (!validSecUserAgent(userAgent)) {
    const error = new Error("SEC_13F_USER_AGENT must include an application name and contact email");
    error.code = "SEC_USER_AGENT_REQUIRED";
    throw error;
  }
  const sectorMembership = await readSectorMembership(env);
  const classifySector = createSectorClassifier(sectorMembership);
  const managerHistories = [];
  for (const manager of managers) {
    try {
      managerHistories.push(await collectManagerHistory({
        manager,
        userAgent,
        fetchImpl,
        classifySector,
        pauseMs,
      }));
    } catch (error) {
      managerHistories.push({
        manager,
        filings: [],
        error: true,
        errorType: error?.name || "CollectionError",
      });
    }
  }
  if (!managerHistories.some((history) => history.filings?.length)) {
    const error = new Error("SEC 13F collection did not produce any usable manager filings");
    error.name = "SecCollectionEmptyError";
    throw error;
  }
  return buildInstitutionalHoldingsRadar({
    managerHistories,
    sectorMembershipAsOf: sectorMembership.asOf,
    generatedAt,
  });
}

async function readCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const info = await stat(CACHE_PATH);
    if (!info.isFile() || info.size > 24 * 1024 * 1024) return null;
    const payload = JSON.parse(await readFile(CACHE_PATH, "utf8"));
    return payload?.schemaVersion === SCHEMA_VERSION ? payload : null;
  } catch {
    return null;
  }
}

async function writeCache(payload) {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  const temporaryPath = `${CACHE_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, CACHE_PATH);
}

export async function loadInstitutionalHoldingsRadar({
  env = process.env,
  forceRefresh = false,
  fetchImpl = globalThis.fetch,
  managers = DEFAULT_13F_MANAGERS,
  pauseMs = 120,
} = {}) {
  const userAgent = await configuredSecUserAgent(env);
  const configured = validSecUserAgent(userAgent);
  const cached = await readCache();
  const cacheAgeMs = cached?.generatedAt
    ? Math.max(0, Date.now() - new Date(cached.generatedAt).getTime())
    : null;
  if (!forceRefresh) {
    return {
      connection: {
        configured,
        available: Boolean(cached),
        stale: cacheAgeMs === null ? false : cacheAgeMs > CACHE_MAX_AGE_MS,
        cacheAgeMs,
        reason: cached ? "" : configured ? "not_collected" : "user_agent_required",
      },
      radar: cached,
    };
  }
  if (!configured) {
    return {
      connection: {
        configured: false,
        available: Boolean(cached),
        stale: Boolean(cached),
        cacheAgeMs,
        reason: "user_agent_required",
      },
      radar: cached,
    };
  }
  try {
    const radar = await collectInstitutionalHoldingsRadar({
      env,
      fetchImpl,
      managers,
      pauseMs,
    });
    await writeCache(radar);
    return {
      connection: {
        configured: true,
        available: true,
        stale: false,
        cacheAgeMs: 0,
        reason: "",
      },
      radar,
    };
  } catch (error) {
    return {
      connection: {
        configured: true,
        available: Boolean(cached),
        stale: Boolean(cached),
        cacheAgeMs,
        reason: cached ? "refresh_failed_using_cache" : "refresh_failed",
        errorType: error?.name || "CollectionError",
      },
      radar: cached,
    };
  }
}

export async function handleInstitutionalHoldingsEndpoint(req, res) {
  try {
    if (req.method === "GET") {
      const result = await loadInstitutionalHoldingsRadar();
      sendJson(res, { ok: true, ...result });
      return;
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req, 16 * 1024);
      if (body?.action !== "refresh") {
        sendJson(res, { ok: false, error: "unsupported action" }, 400);
        return;
      }
      const result = await loadInstitutionalHoldingsRadar({ forceRefresh: true });
      const statusCode = !result.connection.configured
        ? 409
        : result.connection.available
          ? 200
          : 502;
      sendJson(res, {
        ok: statusCode === 200,
        ...(statusCode === 409
          ? { error: "SEC_13F_USER_AGENT 설정이 필요합니다." }
          : statusCode === 502
            ? { error: "SEC 13F 원문을 한 건도 수집하지 못했습니다." }
            : {}),
        ...result,
      }, statusCode);
      return;
    }
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message || "institutional holdings request failed" }, 500);
  }
}
