import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  deleteReportFile,
  listReportFiles,
  parsePbDailyReaderReport,
} from "../server/reportsApi.mjs";

function sampleReaderReport() {
  return {
    schema_version: "v2_reader_report.v1",
    report_date: "2026-08-08",
    generated_at: "2026-08-08T08:30:00+09:00",
    title: "2026-08-08 Daily Market Intelligence",
    executive_summary: ["금리 경로와 고용 둔화가 동시에 반영됐습니다."],
    market_findings: [{ title: "연준", body: "완화 기대와 물가 경계가 공존합니다." }],
    analyst_research: [{
      publisher: "Example Securities",
      analyst: "Kim",
      title: "반도체 업황 점검",
      summary: "수요 회복을 확인했습니다.",
      tickers: ["005930"],
      source: { url: "https://example.com/research" },
      full_text: "보관함에 노출되면 안 되는 원문",
    }],
    earnings_watch: { status: "awaiting_company_profiles", summary: { company_count: 0 } },
    next_checks: ["다음 고용 지표 확인"],
    sources: [{ title: "공식 통계", url: "https://example.com/source", as_of: "2026-08-08" }],
  };
}

test("PB reader report parser creates reader-friendly sections without exposing full text", () => {
  const report = parsePbDailyReaderReport(sampleReaderReport());

  assert.equal(report.reportDate, "2026-08-08");
  assert.equal(report.sections[0].heading, "핵심 요약");
  assert.ok(report.sections.some((section) => section.heading === "애널리스트 리서치"));
  assert.match(report.sections.find((section) => section.heading === "실적 관찰").body, /기업 수\*\*: 0/);
  assert.match(report.sections.find((section) => section.heading === "출처").body, /\[공식 통계\]\(https:\/\/example\.com\/source\)/);
  assert.doesNotMatch(report.sections.map((section) => section.body).join("\n"), /노출되면 안 되는 원문/);
});

test("PB reader reports are auto-discovered and protected from deletion", async (t) => {
  const previous = process.env.PB_DAILY_INTELLIGENCE_DIR;
  const workspace = await mkdtemp(join(tmpdir(), "finance-agent-pb-reports-"));
  const reportDir = join(workspace, "v2_reader_reports", "2026-08-08");
  const reportPath = join(reportDir, "reader_report.json");
  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, JSON.stringify(sampleReaderReport()), "utf8");
  process.env.PB_DAILY_INTELLIGENCE_DIR = workspace;
  t.after(async () => {
    if (previous === undefined) delete process.env.PB_DAILY_INTELLIGENCE_DIR;
    else process.env.PB_DAILY_INTELLIGENCE_DIR = previous;
    await rm(workspace, { recursive: true, force: true });
  });

  const reports = await listReportFiles();
  const archived = reports.find((report) => report.title === "2026-08-08 Daily Market Intelligence");
  assert.ok(archived);
  assert.equal(archived.type, "pb_daily");
  assert.equal(archived.category, "PB 데일리");
  assert.equal(archived.deletable, false);
  assert.equal(archived.source, "pb_daily_intelligence");

  const result = await deleteReportFile(archived.id);
  assert.equal(result.readonly, true);
  assert.equal(existsSync(reportPath), true);
});

test("reports UI exposes type filters and hides delete controls for read-only archives", async () => {
  const source = await readFile(
    fileURLToPath(new URL("../src/reports/ReportsView.jsx", import.meta.url)),
    "utf8",
  );
  assert.match(source, /value: "pb_daily", label: "PB 데일리"/);
  assert.match(source, /report\.deletable !== false/);
  assert.match(source, /report\.deletable === false/);
});
