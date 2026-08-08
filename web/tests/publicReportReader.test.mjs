import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildPublicReportReader,
  buildWorldMemorySnapshot,
  sanitizeDailyIntelligence,
  sanitizeReaderReport,
  sanitizeWorldMemorySnapshot,
} from "../../scripts/build-public-report-reader.mjs";

const templateDir = fileURLToPath(new URL("../public-report-reader", import.meta.url));
const sensitiveKey = (...parts) => parts.join("_");

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
      full_text: "배포하면 안 되는 PDF 원문",
      rights: { full_text_included: true },
    }],
    sources: [
      { title: "공식 통계", url: "https://example.com/source", as_of: "2026-08-08" },
      { title: "위험 링크", url: "javascript:alert(1)" },
    ],
    [sensitiveKey("private", "token")]: "never-publish-this",
  };
}

function privateDailyIntelligence() {
  return {
    schema_version: "daily_market_intelligence.v2",
    report_date: "2026-08-08",
    generated_at: "2026-08-08T08:31:00+09:00",
    audience: "private-banker",
    market: {
      data_cutoff: { latest_price_as_of: "2026-08-07", status: "ready" },
      regime: { label: "중립", confidence: 0.72, summary: "유동성과 성장 신호가 엇갈립니다.", quantitative_evidence: ["VIX 18"] },
      key_drivers: [{ observation: "장기금리 상승", interpretation: "성장주 할인율 부담", confirmation_condition: "10년물 4.5% 상회", invalidation_condition: "4.2% 하회" }],
      conflicting_signals: ["신용은 안정적이지만 변동성은 상승"],
      top_risks: ["물가 재가속"],
      scoreboard: { rates: { nominal_10y: { value: 4.4 }, [sensitiveKey("api", "token")]: "drop-me" } },
      day_over_day_changes: { status: "changed" },
      korea_transmission_inputs: { metrics: { usdkrw: { value: 1400 } } },
    },
    events: {
      selected_count: 1,
      verified_primary_fact_count: 1,
      items: [{
        event_id: "event-1",
        event_type: "macro",
        title: "연준 정책 경로 재평가",
        topic_tags: ["Fed", "rates"],
        common_facts: ["공식 발언이 공개됨"],
        impact_analysis: { equities: "멀티플 부담" },
        raw_content: "drop raw event body",
      }],
    },
    continuity: { summary: { entry_count: 1 }, active_entries: [{ title: "연준 정책 경로", monitoring_state: "active" }] },
    earnings: { status: "ready", summary: { company_count: 2 }, companies: [] },
    cross_source_summary: { event_count: 1 },
    source_state: {
      quality: { record_count: 10, primary_confirmation_rate_pct: 50, record_linkage: [{ [sensitiveKey("private", "token")]: "drop" }] },
      data_warnings: ["일부 브로커 리포트는 참조만 제공"],
    },
    [sensitiveKey("oauth", "refresh", "token")]: "drop-oauth",
  };
}

function privateWorldMemory() {
  return buildWorldMemorySnapshot({
    updatedAt: "2026-08-08T09:00:00+09:00",
    collector: { status: "idle", lastSuccessfulAt: "2026-08-08T08:58:00+09:00", [["se", "cret"].join("")]: "drop" },
    report: {
      generatedAt: "2026-08-08T09:00:00+09:00",
      view: {
        title: "현재 시장 상황 인식",
        asOf: "2026-08-08T09:00:00+09:00",
        stance: "관찰",
        summary: "정책과 성장 신호가 엇갈립니다.",
        narrative: "확인 조건을 중심으로 추적합니다.",
        signalRadar: [{ label: "금리", score: 72, tone: "risk", note: "실질금리 상승" }],
        highlights: [{ title: "연준", body: "완화 기대가 후퇴했습니다.", tag: "macro", importance: "high" }],
        portfolioSuggestions: ["듀레이션 노출 점검"],
        nextChecks: ["미국 CPI"],
      },
      rawText: "drop raw report",
    },
  }, {
    updatedAt: "2026-08-08T08:55:00+09:00",
    records: [{
      continuityId: "thesis-1",
      title: "반도체 사이클",
      thesis: "메모리 업황 회복을 관찰합니다.",
      confirmationCondition: "가격 상승",
      invalidationCondition: "재고 재증가",
      evidence: ["가격 지표"],
      [sensitiveKey("private", "token")]: "drop thesis token",
    }],
  });
}

test("public report sanitizer keeps summaries and drops private or full-text fields", () => {
  const report = sanitizeReaderReport(privateReaderReport());
  const serialized = JSON.stringify(report);
  assert.equal(report.reportDate, "2026-08-08");
  assert.equal(report.analystResearch[0].summary, "수요 회복을 확인했습니다.");
  assert.equal(report.sources[1].url, "");
  assert.doesNotMatch(serialized, /PDF 원문|never-publish-this|full_text|rights/);
});

test("daily intelligence sanitizer keeps decision fields and drops raw, token, and linkage rows", () => {
  const report = sanitizeDailyIntelligence(privateDailyIntelligence());
  const serialized = JSON.stringify(report);
  assert.equal(report.market.regime.label, "중립");
  assert.equal(report.events.items[0].title, "연준 정책 경로 재평가");
  assert.equal(report.sourceQuality.record_count, 10);
  assert.doesNotMatch(serialized, /drop-me|drop raw|drop-oauth|record_linkage|oauth_refresh_token|api_token/);
});

test("World Memory snapshot exposes report and theses without runtime state or secrets", () => {
  const memory = sanitizeWorldMemorySnapshot(privateWorldMemory());
  const serialized = JSON.stringify(memory);
  assert.equal(memory.report.signalRadar[0].score, 72);
  assert.equal(memory.theses[0].title, "반도체 사이클");
  assert.doesNotMatch(serialized, /drop raw|drop thesis|secret|rawText|private_token/);
});

test("reader builder emits a locked placeholder without private data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-locked-"));
  const outputDir = join(root, "output");
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await buildPublicReportReader({ inputDir: join(root, "missing"), outputDir, templateDir, locked: true });
  const payload = JSON.parse(await readFile(join(outputDir, "reports.json"), "utf8"));
  assert.equal(result.locked, true);
  assert.deepEqual(payload.reports, []);
  assert.deepEqual(payload.intelligence, []);
  assert.equal(payload.worldMemory, null);
});

test("reader builder combines brief, full intelligence, and World Memory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-live-"));
  const inputDir = join(root, "workspace", "v2_reader_reports", "2026-08-08");
  const intelligenceDir = join(root, "workspace", "intelligence", "2026-08-08");
  const worldMemoryFile = join(root, "world-memory.json");
  const outputDir = join(root, "output");
  await mkdir(inputDir, { recursive: true });
  await mkdir(intelligenceDir, { recursive: true });
  await writeFile(join(inputDir, "reader_report.json"), JSON.stringify(privateReaderReport()), "utf8");
  await writeFile(join(intelligenceDir, "daily_intelligence.json"), JSON.stringify(privateDailyIntelligence()), "utf8");
  await writeFile(worldMemoryFile, JSON.stringify(privateWorldMemory()), "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await buildPublicReportReader({ inputDir: join(root, "workspace", "v2_reader_reports"), intelligenceDir: join(root, "workspace", "intelligence"), worldMemoryFile, outputDir, templateDir });
  const serialized = await readFile(join(outputDir, "reports.json"), "utf8");
  const payload = JSON.parse(serialized);
  assert.equal(result.reportCount, 1);
  assert.equal(result.intelligenceCount, 1);
  assert.equal(result.worldMemory, true);
  assert.equal(payload.intelligence[0].events.items[0].eventId, "event-1");
  assert.equal(payload.worldMemory.theses.length, 1);
  assert.doesNotMatch(serialized, /PDF 원문|never-publish-this|drop-oauth|drop thesis|private_token/);
});

test("reader builder merges prior sanitized dates and preserves World Memory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "public-report-reader-history-"));
  const inputDir = join(root, "input", "2026-08-08");
  const intelligenceDir = join(root, "intelligence", "2026-08-08");
  const outputDir = join(root, "output");
  const previousBundle = join(root, "previous.json");
  await mkdir(inputDir, { recursive: true });
  await mkdir(intelligenceDir, { recursive: true });
  await writeFile(join(inputDir, "reader_report.json"), JSON.stringify(privateReaderReport()), "utf8");
  await writeFile(join(intelligenceDir, "daily_intelligence.json"), JSON.stringify(privateDailyIntelligence()), "utf8");
  await writeFile(previousBundle, JSON.stringify({
    schemaVersion: "public_pb_reader_bundle.v1",
    reports: [sanitizeReaderReport({ ...privateReaderReport(), report_date: "2026-08-07", title: "older" })],
    intelligence: [sanitizeDailyIntelligence({ ...privateDailyIntelligence(), report_date: "2026-08-07" })],
    worldMemory: privateWorldMemory(),
  }), "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  await buildPublicReportReader({ inputDir: join(root, "input"), intelligenceDir: join(root, "intelligence"), outputDir, templateDir, previousBundle });
  const payload = JSON.parse(await readFile(join(outputDir, "reports.json"), "utf8"));
  assert.deepEqual(payload.reports.map((report) => report.reportDate), ["2026-08-08", "2026-08-07"]);
  assert.deepEqual(payload.intelligence.map((report) => report.reportDate), ["2026-08-08", "2026-08-07"]);
  assert.equal(payload.worldMemory.report.title, "현재 시장 상황 인식");
});

test("static reader uses DOM APIs and exposes all three read-only views", async () => {
  const source = await readFile(join(templateDir, "app.js"), "utf8");
  const html = await readFile(join(templateDir, "index.html"), "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(source, /textContent/);
  assert.match(source, /rel = "noreferrer noopener"/);
  assert.match(html, /data-view="brief"/);
  assert.match(html, /data-view="intelligence"/);
  assert.match(html, /data-view="world-memory"/);
});

test("static reader localizes the market scoreboard for Korean readers", async () => {
  const source = await readFile(join(templateDir, "app.js"), "utf8");
  assert.match(source, /breadth: "시장 폭"/);
  assert.match(source, /source_grade: "자료 등급"/);
  assert.match(source, /rule_based_signal: "규칙 기반 신호"/);
  assert.match(source, /classification_reason: "판정 이유"/);
  assert.match(source, /mixed: "혼조"/);
  assert.match(source, /FIELD_VALUES\[readable\]/);
  assert.match(source, /시장 폭·변동성·신용·금리·규칙 기반 신호/);
  assert.doesNotMatch(source, /"Breadth·변동성·신용·금리·규칙 기반 신호"/);
});

test("Cloudflare workflow gates data and consumes encrypted World Memory secret", async () => {
  const workflow = await readFile(fileURLToPath(new URL("../../.github/workflows/daily-brief.yml", import.meta.url)), "utf8");
  assert.match(workflow, /REPORTS_PROTECTED: \$\{\{ vars\.CLOUDFLARE_REPORTS_PROTECTED \}\}/);
  assert.match(workflow, /if \[ "\$REPORTS_PROTECTED" != "true" \]; then\s+args\+=\(--locked\)/);
  assert.match(workflow, /if: vars\.CLOUDFLARE_REPORTS_PROTECTED == 'true'\s+uses: actions\/download-artifact@v4/);
  assert.match(workflow, /PRIVATE_READER_WORLD_MEMORY_JSON: \$\{\{ secrets\.PRIVATE_READER_WORLD_MEMORY_JSON \}\}/);
  assert.match(workflow, /--intelligence pipeline\/pb-daily-market-brief\/workspace\/intelligence/);
  assert.match(workflow, /--world-memory \.generated\/private-reader-world-memory\.json/);
  assert.match(workflow, /Cloudflare Pages project exists/);
});
