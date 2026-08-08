import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildPublicReportReader,
  sanitizeReaderReport,
} from "../../scripts/build-public-report-reader.mjs";

const templateDir = fileURLToPath(new URL("../public-report-reader", import.meta.url));

function privateReaderReport() {
  return {
    schema_version: "v2_reader_report.v1",
    report_date: "2026-08-08",
    generated_at: "2026-08-08T08:30:00+09:00",
    title: "2026-08-08 Daily Market Intelligence",
    executive_summary: ["시장 핵심 요약"],
    market_findings: [{ title: "금리", body: "실질금리 상승" }],
    analyst_research: [{
      publisher: "Example Securities",
      title: "반도체 점검",
      summary: "수요 회복을 확인했습니다.",
      tickers: ["005930"],
      key_claims: ["재고가 정상화되고 있습니다."],
      source: { url: "https://example.com/report" },
      full_text: "배포되면 안 되는 PDF 원문",
      rights: { full_text_included: true },
    }],
    sources: [
      { title: "공식 통계", url: "https://example.com/source", as_of: "2026-08-08" },
      { title: "위험 링크", url: "javascript:alert(1)" },
    ],
    private_token: "never-publish-this",
  };
}

test("public report sanitizer keeps summaries and drops private or full-text fields", () => {
  const report = sanitizeReaderReport(privateReaderReport());
  const serialized = JSON.stringify(report);

  assert.equal(report.reportDate, "2026-08-08");
  assert.equal(report.analystResearch[0].summary, "수요 회복을 확인했습니다.");
  assert.equal(report.sources[1].url, "");
  assert.doesNotMatch(serialized, /PDF 원문|never-publish-this|full_text|rights/);
});

test("reader builder emits a locked placeholder without report data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-locked-"));
  const outputDir = join(root, "output");
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await buildPublicReportReader({
    inputDir: join(root, "missing"),
    outputDir,
    templateDir,
    locked: true,
  });
  const payload = JSON.parse(await readFile(join(outputDir, "reports.json"), "utf8"));

  assert.equal(result.locked, true);
  assert.deepEqual(payload.reports, []);
});

test("reader builder discovers dated reports and never writes raw input fields", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-live-"));
  const inputDir = join(root, "input", "2026-08-08");
  const outputDir = join(root, "output");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "reader_report.json"), JSON.stringify(privateReaderReport()), "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await buildPublicReportReader({ inputDir: join(root, "input"), outputDir, templateDir });
  const serialized = await readFile(join(outputDir, "reports.json"), "utf8");
  const payload = JSON.parse(serialized);

  assert.equal(result.reportCount, 1);
  assert.equal(payload.reports[0].reportDate, "2026-08-08");
  assert.doesNotMatch(serialized, /PDF 원문|never-publish-this|full_text|rights/);
});

test("reader builder merges a prior sanitized bundle without keeping duplicate dates", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-history-"));
  const inputDir = join(root, "input", "2026-08-08");
  const outputDir = join(root, "output");
  const previousBundle = join(root, "previous.json");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "reader_report.json"), JSON.stringify(privateReaderReport()), "utf8");
  await writeFile(previousBundle, JSON.stringify({
    schemaVersion: "public_pb_reader_bundle.v1",
    reports: [
      { ...sanitizeReaderReport({ ...privateReaderReport(), report_date: "2026-08-07", title: "older" }) },
      { ...sanitizeReaderReport({ ...privateReaderReport(), title: "stale duplicate" }) },
    ],
  }), "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  await buildPublicReportReader({ inputDir: join(root, "input"), outputDir, templateDir, previousBundle });
  const payload = JSON.parse(await readFile(join(outputDir, "reports.json"), "utf8"));
  assert.deepEqual(payload.reports.map((report) => report.reportDate), ["2026-08-08", "2026-08-07"]);
  assert.equal(payload.reports[0].title, "2026-08-08 Daily Market Intelligence");
});

test("static reader renders with DOM APIs instead of injecting report HTML", async () => {
  const source = await readFile(join(templateDir, "app.js"), "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(source, /textContent/);
  assert.match(source, /rel = "noreferrer noopener"/);
});

test("Cloudflare workflow deploys a locked placeholder until Access protection is confirmed", async () => {
  const workflow = await readFile(
    fileURLToPath(new URL("../../.github/workflows/daily-brief.yml", import.meta.url)),
    "utf8",
  );
  assert.match(workflow, /REPORTS_PROTECTED: \$\{\{ vars\.CLOUDFLARE_REPORTS_PROTECTED \}\}/);
  assert.match(workflow, /if \[ "\$REPORTS_PROTECTED" != "true" \]; then\s+args\+=\(--locked\)/);
  assert.match(workflow, /if: vars\.CLOUDFLARE_REPORTS_PROTECTED == 'true'\s+uses: actions\/download-artifact@v4/);
  assert.match(workflow, /Cloudflare Pages project exists/);
});
