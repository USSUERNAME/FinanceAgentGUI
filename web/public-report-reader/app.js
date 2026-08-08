const FIELD_LABELS = {
  status: "상태",
  summary: "요약",
  labels: "표기 기준",
  metrics: "지표",
  latest_price_as_of: "최신 가격 기준일",
  verified_event_count: "검증된 이벤트 수",
  korea_data_status: "한국 데이터 상태",
  warnings: "주의사항",
  company_count: "기업 수",
  confirmed_event_count: "확인된 이벤트 수",
  estimate_revision_count: "추정치 변경 수",
  guidance_count: "가이던스 수",
  verified_result_count: "검증된 실적 수",
  estimate: "추정치",
  guidance: "가이던스",
  result: "실제치",
};

const FIELD_VALUES = {
  awaiting_company_profiles: "기업 프로필 대기",
  insufficient: "데이터 부족",
};

const state = { reports: [], filtered: [], activeId: "" };
const listNode = document.querySelector("#report-list");
const readerNode = document.querySelector("#reader");
const countNode = document.querySelector("#report-count");
const searchNode = document.querySelector("#report-search");

function element(tag, className = "", content = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== "") node.textContent = String(content);
  return node;
}

function valueLabel(value) {
  if (typeof value === "boolean") return value ? "예" : "아니오";
  const normalized = String(value ?? "");
  return FIELD_VALUES[normalized] || normalized.replaceAll("_", " ");
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(date);
}

function appendTextList(parent, values, className = "bullet-list") {
  if (!Array.isArray(values) || !values.length) return;
  const list = element("ul", className);
  values.forEach((value) => list.append(element("li", "", value)));
  parent.append(list);
}

function section(title) {
  const node = element("section", "report-section");
  node.append(element("h2", "section-title", title));
  return node;
}

function appendFindings(parent, title, values) {
  if (!Array.isArray(values) || !values.length) return;
  const node = section(title);
  const grid = element("div", "finding-grid");
  values.forEach((value) => {
    const card = element("article", "finding-card");
    if (value.title) card.append(element("h3", "", value.title));
    if (value.body) card.append(element("p", "", value.body));
    grid.append(card);
  });
  node.append(grid);
  parent.append(node);
}

function appendRecord(parent, record, depth = 0) {
  if (!record || typeof record !== "object") return;
  const list = element("dl", depth ? "record-list is-nested" : "record-list");
  Object.entries(record).forEach(([key, value]) => {
    if (value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length)) return;
    const row = element("div", "record-row");
    row.append(element("dt", "", FIELD_LABELS[key] || key.replaceAll("_", " ")));
    const detail = element("dd");
    if (Array.isArray(value)) appendTextList(detail, value, "compact-list");
    else if (typeof value === "object") appendRecord(detail, value, depth + 1);
    else detail.textContent = valueLabel(value);
    row.append(detail);
    list.append(row);
  });
  if (list.childElementCount) parent.append(list);
}

function appendAnalystResearch(parent, values) {
  if (!Array.isArray(values) || !values.length) return;
  const node = section("애널리스트 리서치");
  const stack = element("div", "research-stack");
  values.forEach((research, index) => {
    const details = element("details", "research-card");
    if (index === 0) details.open = true;
    const summary = element("summary");
    const heading = element("span", "research-heading");
    heading.append(element("small", "", research.publisher || "리서치"));
    heading.append(element("strong", "", research.title || "제목 없음"));
    summary.append(heading, element("span", "details-mark", "+"));
    details.append(summary);

    const body = element("div", "research-body");
    const metadata = [research.analyst, research.reportType, research.stance, research.publishedAt].filter(Boolean);
    if (metadata.length) body.append(element("p", "research-meta", metadata.join(" · ")));
    if (research.summary) body.append(element("p", "research-summary", research.summary));
    const tags = [...(research.tickers || []), ...(research.sectors || [])];
    if (tags.length) {
      const tagRow = element("div", "tag-row");
      tags.forEach((tag) => tagRow.append(element("span", "", tag)));
      body.append(tagRow);
    }
    [["핵심 주장", research.keyClaims], ["촉매", research.catalysts], ["위험", research.risks]].forEach(([label, items]) => {
      if (!items?.length) return;
      body.append(element("h4", "", label));
      appendTextList(body, items, "compact-list");
    });
    if (research.source?.url) {
      const link = element("a", "source-link", "원문 링크 열기");
      link.href = research.source.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      body.append(link);
    }
    details.append(body);
    stack.append(details);
  });
  node.append(stack);
  parent.append(node);
}

function appendSources(parent, values) {
  if (!Array.isArray(values) || !values.length) return;
  const node = section("출처");
  const list = element("ul", "source-list");
  values.forEach((source) => {
    const item = element("li");
    if (source.url) {
      const link = element("a", "", source.title || source.url);
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      item.append(link);
    } else {
      item.append(element("span", "", source.title));
    }
    if (source.asOf) item.append(element("small", "", source.asOf));
    list.append(item);
  });
  node.append(list);
  parent.append(node);
}

function renderReport(report) {
  readerNode.replaceChildren();
  const article = element("article", "report-document");
  const header = element("header", "report-header");
  header.append(element("span", "eyebrow", "DAILY MARKET INTELLIGENCE"));
  header.append(element("h1", "", report.title));
  header.append(element("time", "", formatDate(report.reportDate)));
  article.append(header);

  if (report.executiveSummary?.length) {
    const lead = section("핵심 요약");
    lead.classList.add("lead-section");
    appendTextList(lead, report.executiveSummary, "summary-list");
    article.append(lead);
  }
  appendFindings(article, "시장 판단", report.marketFindings);
  appendFindings(article, "오늘의 변화", report.todayChanges);
  appendFindings(article, "검증된 이벤트", report.verifiedEvents);
  appendAnalystResearch(article, report.analystResearch);
  [["실적 관찰", report.earningsWatch], ["한국 시장 연결", report.koreaConnection], ["데이터 상태", report.dataStatus]].forEach(([title, value]) => {
    if (!value || !Object.keys(value).length) return;
    const node = section(title);
    appendRecord(node, value);
    article.append(node);
  });
  if (report.nextChecks?.length) {
    const checks = section("다음 확인");
    appendTextList(checks, report.nextChecks, "check-list");
    article.append(checks);
  }
  appendSources(article, report.sources);
  article.append(element("footer", "report-footer", "본 페이지는 읽기 전용 요약본입니다. 원문 저작권은 각 발행처에 있습니다."));
  readerNode.append(article);
  readerNode.focus({ preventScroll: true });
}

function activate(reportDate, { updateHash = true } = {}) {
  const report = state.reports.find((item) => item.reportDate === reportDate) || state.filtered[0];
  if (!report) return;
  state.activeId = report.reportDate;
  if (updateHash) history.replaceState(null, "", `#${report.reportDate}`);
  renderList();
  renderReport(report);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderList() {
  listNode.replaceChildren();
  countNode.textContent = String(state.filtered.length);
  state.filtered.forEach((report) => {
    const button = element("button", report.reportDate === state.activeId ? "report-list-item is-active" : "report-list-item");
    button.type = "button";
    button.append(element("time", "", formatDate(report.reportDate)));
    button.append(element("strong", "", report.title));
    button.append(element("span", "", report.executiveSummary?.[0] || "요약 없음"));
    button.addEventListener("click", () => activate(report.reportDate));
    listNode.append(button);
  });
}

function searchableText(report) {
  return [
    report.reportDate,
    report.title,
    ...(report.executiveSummary || []),
    ...(report.marketFindings || []).flatMap((item) => [item.title, item.body]),
    ...(report.analystResearch || []).flatMap((item) => [item.publisher, item.title, ...(item.tickers || []), ...(item.sectors || [])]),
  ].join(" ").toLowerCase();
}

function showLocked() {
  searchNode.disabled = true;
  listNode.replaceChildren();
  countNode.textContent = "0";
  const card = element("section", "locked-state");
  card.append(element("span", "eyebrow", "SETUP IN PROGRESS"));
  card.append(element("h1", "", "비공개 리더를 준비하고 있습니다"));
  card.append(element("p", "", "접근 인증이 확인된 뒤 보고서가 안전하게 게시됩니다."));
  readerNode.replaceChildren(card);
}

searchNode.addEventListener("input", () => {
  const query = searchNode.value.trim().toLowerCase();
  state.filtered = query ? state.reports.filter((report) => searchableText(report).includes(query)) : [...state.reports];
  if (!state.filtered.some((report) => report.reportDate === state.activeId)) state.activeId = state.filtered[0]?.reportDate || "";
  renderList();
  if (state.activeId) renderReport(state.filtered.find((report) => report.reportDate === state.activeId));
  else readerNode.replaceChildren(element("div", "empty-state", "검색 결과가 없습니다."));
});

fetch("./reports.json", { cache: "no-store", credentials: "same-origin" })
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((payload) => {
    if (payload.locked) {
      showLocked();
      return;
    }
    state.reports = Array.isArray(payload.reports) ? payload.reports : [];
    state.filtered = [...state.reports];
    const requested = location.hash.slice(1);
    state.activeId = state.reports.some((report) => report.reportDate === requested)
      ? requested
      : state.reports[0]?.reportDate || "";
    if (!state.activeId) throw new Error("게시된 보고서가 없습니다.");
    renderList();
    renderReport(state.reports.find((report) => report.reportDate === state.activeId));
  })
  .catch(() => {
    readerNode.replaceChildren(element("div", "error-state", "리포트를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요."));
  });
