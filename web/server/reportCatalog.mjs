import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const REPORT_CATALOG_PATH = join(GUIBUILD_ROOT, "config", "report-catalog.json");
const MAX_REPORT_TYPES = 32;
const PROMPT_TEXT_LIMIT = 260;

function cleanText(value, maxLength = 400) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function cleanList(value, limit = 12, itemLength = 180) {
  return Array.isArray(value)
    ? value
        .map((item) => cleanText(item, itemLength))
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function readCatalogFile() {
  if (!existsSync(REPORT_CATALOG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REPORT_CATALOG_PATH, "utf8"));
  } catch (error) {
    return {
      version: 0,
      source: "config/report-catalog.json",
      error: error.message,
      reportTypes: [],
    };
  }
}

function normalizeOutput(output = {}) {
  const source = output && typeof output === "object" ? output : {};
  return {
    format: cleanText(source.format, 80),
    defaultPath: cleanText(source.defaultPath, 160),
    candidateCommand: cleanText(source.candidateCommand, 220),
    requiredSections: cleanList(source.requiredSections, 16, 80),
    verification: cleanText(source.verification, 180),
  };
}

function normalizeReportType(type = {}) {
  if (!type || typeof type !== "object") return null;
  const id = cleanText(type.id, 80);
  const name = cleanText(type.name, 120);
  if (!id || !name) return null;
  return {
    id,
    name,
    category: cleanText(type.category, 80),
    description: cleanText(type.description, 260),
    useWhen: cleanList(type.useWhen, 6, 180),
    triggers: cleanList(type.triggers, 18, 80),
    evidence: cleanList(type.evidence, 10, 120),
    workflow: cleanList(type.workflow, 8, 180),
    output: normalizeOutput(type.output),
    agentGuidance: cleanText(type.agentGuidance, 260),
  };
}

export function readReportCatalog() {
  const raw = readCatalogFile() || {};
  const reportTypes = Array.isArray(raw.reportTypes)
    ? raw.reportTypes.map(normalizeReportType).filter(Boolean).slice(0, MAX_REPORT_TYPES)
    : [];

  return {
    version: Number(raw.version || 0),
    source: cleanText(raw.source || "config/report-catalog.json", 160),
    storagePolicy: raw.storagePolicy && typeof raw.storagePolicy === "object"
      ? {
          primaryReportDir: cleanText(raw.storagePolicy.primaryReportDir, 120),
          readableReportDirs: cleanList(raw.storagePolicy.readableReportDirs, 8, 120),
          generatedReportsAreRuntimeState: Boolean(raw.storagePolicy.generatedReportsAreRuntimeState),
        }
      : null,
    commonRules: cleanList(raw.commonRules, 12, 220),
    reportTypes,
    error: cleanText(raw.error || "", 220),
  };
}

export function compactReportCatalogForPrompt() {
  const catalog = readReportCatalog();
  return {
    version: catalog.version,
    source: catalog.source,
    storagePolicy: catalog.storagePolicy,
    commonRules: catalog.commonRules,
    reportTypes: catalog.reportTypes.map((type) => ({
      id: type.id,
      name: type.name,
      category: type.category,
      description: cleanText(type.description, PROMPT_TEXT_LIMIT),
      triggers: type.triggers.slice(0, 12),
      useWhen: type.useWhen.slice(0, 4),
      evidence: type.evidence.slice(0, 6),
      workflow: type.workflow.slice(0, 5),
      output: {
        format: type.output.format,
        defaultPath: type.output.defaultPath,
        candidateCommand: type.output.candidateCommand,
        requiredSections: type.output.requiredSections.slice(0, 10),
      },
      agentGuidance: cleanText(type.agentGuidance, PROMPT_TEXT_LIMIT),
    })),
    error: catalog.error,
  };
}

export function buildReportCatalogContextSection(payload = {}) {
  const screen = String(payload.screen || "").toLowerCase();
  if (screen !== "reports" && payload.includeReportCatalog !== true) return "";
  const catalog = compactReportCatalogForPrompt();
  return [
    "[보고서 생성 카탈로그]",
    "현재 사용자는 Reports 화면에 있다. 아래 JSON은 GUI에 이식된 보고서 절차 목록이다.",
    "사용자가 어떤 보고서를 뽑아야 하는지 묻거나 모호한 분석 요청을 하면, 이 카탈로그에서 가장 적합한 보고서 유형을 먼저 고르고 이유를 말한다.",
    "GUI job runner가 아직 없는 보고서는 실행 완료라고 말하지 말고, 필요한 입력과 승인 가능한 실행/저장 경로를 제안한다.",
    "사용자가 명확하게 보고서 작성, 리포트 생성, 분석보고서 작성, 저장 가능한 산출물 생성을 요청했고 충분한 입력이 있으면, 아래 스키마의 ```report_artifact 코드펜스를 정확히 하나 포함한다.",
    "일반 질문, 보고서 목록 탐색, 작성 방법 문의, 입력이 부족한 초안 상담, 단순 대화에는 report_artifact를 절대 포함하지 않는다.",
    "이 분류는 단어 매칭이 아니라 사용자 의도, 현재 화면, 최근 대화, 카탈로그 적합도, 필요한 입력 충족 여부를 함께 보는 의미 분류다. 명확하지 않으면 저장 액션 대신 확인 질문을 한다.",
    "보고서 작성 과정은 원래 금융 에이전트처럼 먼저 yfinance, FEED/News Feed, World Memory, 웹 검색, 공시/공식 자료를 내부적으로 대조한 뒤 핵심 판단으로 압축한다. 저장 경로나 md 파일 관습을 흉내 내는 것이 아니라, 확인-판단-서술의 리듬을 유지한다.",
    "보고서 본문은 핵심 요약, 빠른 판단, 투자포인트, 데이터 표, 시나리오, 결론의 독자 흐름을 먼저 만든다. World Memory 근거, News Feed 근거, 웹 확인 근거 같은 근거 묶음을 서두에 독립 섹션으로 박아 넣지 않는다.",
    "근거는 본문 판단을 지탱하는 방식으로 문장 속에 자연스럽게 귀속하고, 외부 URL이나 원출처 링크는 필요한 만큼 하단 각주/참고 링크 섹션에 모은다. 로컬 World Memory와 News Feed는 내부 맥락 또는 최신 신호로 쓰되 독자-facing 분량을 과도하게 차지하지 않게 한다.",
    "보고서 본문에는 생성 과정, 저장 경로, 파일 형식, 아티팩트 스키마를 설명하지 않는다. 그런 정보는 GUI 저장 동작을 위한 내부 처리로만 둔다.",
    "report_artifact는 GUI가 숨긴 뒤 검증해 data/reports/에 저장한다. artifact.content가 보고서 전문의 유일한 정본이다. 코드펜스 바깥에 보고서 본문을 중복 출력하지 말고 짧은 완료/요약 문장만 쓴다.",
    "출력 길이가 길어질 것 같아도 완전하고 파싱 가능한 report_artifact 코드펜스를 최우선으로 끝까지 작성한다. 보고서 본문만 먼저 출력하다 저장 액션을 생략하지 않는다.",
    [
      "스키마:",
      "```report_artifact",
      "{",
      "  \"action\": \"save_report_artifact\",",
      "  \"classification\": {",
      "    \"isReportRequest\": true,",
      "    \"confidence\": 0.9,",
      "    \"reportTypeId\": \"catalog-report-type-id-or-ad-hoc\",",
      "    \"reason\": \"왜 명확한 보고서 작성 요청인지 한 문장\"",
      "  },",
      "  \"artifact\": {",
      "    \"title\": \"보고서 제목\",",
      "    \"category\": \"카테고리\",",
      "    \"summary\": \"목록에 보여줄 짧은 요약\",",
      "    \"tags\": [\"태그\"],",
      "    \"format\": \"markdown\",",
      "    \"content\": \"# 보고서 제목\\n\\n## 핵심 요약\\n...\"",
      "  }",
      "}",
      "```",
    ].join("\n"),
    JSON.stringify(catalog, null, 2),
  ].join("\n");
}
