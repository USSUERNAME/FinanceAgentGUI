import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const kpiMapPath = fileURLToPath(
  new URL("../../config/sector-kpi-map.json", import.meta.url),
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSectorKpiMap() {
  const payload = JSON.parse(readFileSync(kpiMapPath, "utf8"));
  if (payload.schemaVersion !== "sector_kpi_map.v1") {
    throw new Error(`Unsupported sector KPI map: ${payload.schemaVersion || "missing"}`);
  }
  return payload;
}

const kpiMap = loadSectorKpiMap();

export function sectorKpiMapVersion() {
  return kpiMap.schemaVersion;
}

export function sectorKpiDefinition(sectorId) {
  const normalizedSectorId = String(sectorId || "").trim();
  const override = kpiMap.sectors?.[normalizedSectorId];
  const definition = override || kpiMap.default;
  return {
    schemaVersion: kpiMap.schemaVersion,
    sectorId: normalizedSectorId,
    matched: Boolean(override),
    fallbackUsed: !override,
    missingPolicy: clone(kpiMap.missingPolicy),
    operatingKpis: clone(definition?.operatingKpis || []),
    valuationMetrics: clone(definition?.valuationMetrics || []),
    excludedMetrics: clone(definition?.excludedMetrics || []),
  };
}

export function resolveSectorKpiSet(sectorIds = []) {
  const normalizedIds = [...new Set(
    (Array.isArray(sectorIds) ? sectorIds : [sectorIds])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
  const definitions = normalizedIds.map(sectorKpiDefinition);
  if (!definitions.length) definitions.push(sectorKpiDefinition(""));

  const operatingKpis = new Map();
  const valuationMetrics = new Map();
  const excludedMetrics = new Set();
  for (const definition of definitions) {
    for (const metric of definition.operatingKpis) {
      if (!operatingKpis.has(metric.id)) operatingKpis.set(metric.id, metric);
    }
    for (const metric of definition.valuationMetrics) {
      if (!valuationMetrics.has(metric.id)) valuationMetrics.set(metric.id, metric);
    }
    for (const metricId of definition.excludedMetrics) excludedMetrics.add(metricId);
  }
  for (const metricId of excludedMetrics) valuationMetrics.delete(metricId);

  return {
    schemaVersion: kpiMap.schemaVersion,
    sectorIds: normalizedIds,
    matchedSectorIds: definitions.filter((item) => item.matched).map((item) => item.sectorId),
    fallbackUsed: definitions.every((item) => item.fallbackUsed),
    missingPolicy: clone(kpiMap.missingPolicy),
    operatingKpis: [...operatingKpis.values()],
    valuationMetrics: [...valuationMetrics.values()].sort(
      (left, right) => Number(left.priority || 99) - Number(right.priority || 99),
    ),
    excludedMetrics: [...excludedMetrics],
  };
}
