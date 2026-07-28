import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const taxonomyPath = fileURLToPath(
  new URL("../../config/research-sector-taxonomy.json", import.meta.url),
);

function normalizedAlias(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[&/·,_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function compactAlias(value) {
  return normalizedAlias(value).replace(/\s+/g, "");
}

function loadTaxonomy() {
  const payload = JSON.parse(readFileSync(taxonomyPath, "utf8"));
  const sectors = Array.isArray(payload.sectors) ? payload.sectors : [];
  const aliasMap = new Map();
  for (const sector of sectors) {
    const aliases = [sector.id, sector.nameKo, sector.nameEn, ...(sector.aliases || [])];
    for (const alias of aliases) {
      const key = normalizedAlias(alias);
      if (key && !aliasMap.has(key)) aliasMap.set(key, sector);
    }
  }
  return {
    schemaVersion: String(payload.schemaVersion || ""),
    sectors,
    aliasMap,
  };
}

let taxonomy = loadTaxonomy();

function publicTaxonomy() {
  return {
    schemaVersion: taxonomy.schemaVersion,
    sectors: taxonomy.sectors.map((sector) => ({
      id: String(sector.id || ""),
      nameKo: String(sector.nameKo || ""),
      nameEn: String(sector.nameEn || ""),
      aliases: Array.isArray(sector.aliases) ? sector.aliases.map(String) : [],
    })),
  };
}

export function classifyResearchSector(value) {
  const raw = String(value || "").trim();
  const match = taxonomy.aliasMap.get(normalizedAlias(raw));
  if (!match) {
    return {
      id: "",
      name: raw,
      matched: false,
      sourceLabel: raw,
    };
  }
  return {
    id: String(match.id || ""),
    name: String(match.nameKo || raw),
    nameEn: String(match.nameEn || ""),
    matched: true,
    sourceLabel: raw,
  };
}

export function researchSectorTaxonomyVersion() {
  return taxonomy.schemaVersion;
}

export function suggestResearchSectors(value, limit = 3) {
  const input = normalizedAlias(value)
    .replace(/(?:업종|산업|섹터|리서치)$/u, "")
    .trim();
  const compactInput = input.replace(/\s+/g, "");
  if (!input || !compactInput) return { confidence: "none", candidates: [] };
  const candidates = [];
  for (const sector of taxonomy.sectors) {
    let best = null;
    const aliases = [sector.nameKo, sector.nameEn, ...(sector.aliases || [])];
    for (const alias of aliases) {
      const normalized = normalizedAlias(alias);
      const compact = compactAlias(alias);
      if (!normalized || !compact) continue;
      let score = 0;
      let reason = "";
      if (input === normalized) {
        score = 1;
        reason = "정확히 일치";
      } else if (compact.length >= 2 && compactInput.includes(compact)) {
        score = Math.min(0.94, 0.62 + (0.32 * compact.length) / compactInput.length);
        reason = `포함 단어 · ${alias}`;
      } else if (compactInput.length >= 2 && compact.includes(compactInput)) {
        score = Math.min(0.86, 0.55 + (0.31 * compactInput.length) / compact.length);
        reason = `유사 표기 · ${alias}`;
      }
      if (score > Number(best?.score || 0)) {
        best = {
          sectorId: String(sector.id || ""),
          nameKo: String(sector.nameKo || ""),
          nameEn: String(sector.nameEn || ""),
          score: Number(score.toFixed(2)),
          reason,
        };
      }
    }
    if (best?.score > 0) candidates.push(best);
  }
  candidates.sort(
    (left, right) => right.score - left.score || left.nameKo.localeCompare(right.nameKo),
  );
  const selected = candidates.slice(0, Math.max(1, Math.min(Number(limit) || 3, 5)));
  const top = selected[0]?.score || 0;
  const gap = top - (selected[1]?.score || 0);
  const confidence = top >= 0.82 && gap >= 0.12
    ? "high"
    : top >= 0.65
      ? "review"
      : "none";
  return { confidence, candidates: selected };
}

export function addResearchSectorAliasToFile(
  { sectorId, alias } = {},
  filePath = taxonomyPath,
  { reload = filePath === taxonomyPath } = {},
) {
  const normalizedSectorId = String(sectorId || "").trim();
  const normalizedInput = String(alias || "").normalize("NFKC").trim();
  if (!normalizedSectorId) throw new Error("표준 섹터를 선택해 주세요.");
  if (!normalizedInput) throw new Error("추가할 원문 섹터명이 없습니다.");
  if (normalizedInput.length > 120) throw new Error("섹터 별칭은 120자 이하여야 합니다.");
  const target = taxonomy.sectors.find((sector) => String(sector.id || "") === normalizedSectorId);
  if (!target) throw new Error("선택한 표준 섹터를 찾을 수 없습니다.");
  const existing = taxonomy.aliasMap.get(normalizedAlias(normalizedInput));
  if (existing && String(existing.id || "") !== normalizedSectorId) {
    throw new Error(`이미 ${existing.nameKo || existing.id}에 연결된 별칭입니다.`);
  }
  if (existing) {
    return { changed: false, alias: normalizedInput, sector: target, taxonomy: publicTaxonomy() };
  }

  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  const payloadTarget = payload.sectors.find(
    (sector) => String(sector.id || "") === normalizedSectorId,
  );
  const aliases = Array.isArray(payloadTarget.aliases) ? payloadTarget.aliases.map(String) : [];
  payloadTarget.aliases = [...aliases, normalizedInput];
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  if (reload) taxonomy = loadTaxonomy();
  return {
    changed: true,
    alias: normalizedInput,
    sector: reload
      ? taxonomy.sectors.find((sector) => String(sector.id || "") === normalizedSectorId)
      : payloadTarget,
    taxonomy: publicTaxonomy(),
  };
}

export function addResearchSectorAlias(payload = {}) {
  return addResearchSectorAliasToFile(payload, taxonomyPath, { reload: true });
}

export async function handleResearchSectorTaxonomyEndpoint(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, { ok: true, taxonomy: publicTaxonomy() });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const payload = await readJsonBody(req);
    sendJson(res, { ok: true, ...addResearchSectorAlias(payload) });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 400);
  }
}
