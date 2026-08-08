const FIELD_LABELS = {
  status: "상태",
  summary: "요약",
  breadth: "시장 폭",
  proxy: "대리지표",
  source_grade: "자료 등급",
  as_of: "기준일",
  rsp_return_1d_pct: "RSP 1일 수익률(%)",
  spy_return_1d_pct: "SPY 1일 수익률(%)",
  rsp_vs_spy_1d_pct: "RSP의 SPY 대비 1일 상대수익률(%p)",
  rsp_vs_spy_5d_pct: "RSP의 SPY 대비 5일 상대수익률(%p)",
  rsp_vs_spy_20d_pct: "RSP의 SPY 대비 20일 상대수익률(%p)",
  volatility: "변동성",
  vix: "VIX",
  vix3m: "VIX 3개월물",
  vix_term_ratio: "VIX/3개월물 비율",
  series_id: "지표 코드",
  value: "값",
  change_1d: "1일 변화",
  change_5_sessions: "5거래일 변화",
  percentile_60_observations: "최근 60개 관측치 내 백분위",
  source: "자료 출처",
  evidence_label: "근거 분류",
  credit: "신용",
  high_yield_oas: "하이일드 OAS",
  spread_change_5d_pct_point: "스프레드 5일 변화(%p)",
  rates: "금리",
  nominal_10y: "미국 10년 명목금리",
  real_10y: "미국 10년 실질금리",
  real_yield_change_5d_pct_point: "실질금리 5일 변화(%p)",
  rule_based_signal: "규칙 기반 신호",
  score: "점수",
  range: "점수 범위",
  signals: "구성 신호",
  contribution: "기여도",
  participation: "상대 성과",
  qqq_vs_spy_5d_pct: "QQQ의 SPY 대비 5일 상대수익률(%p)",
  iwm_vs_spy_5d_pct: "IWM의 SPY 대비 5일 상대수익률(%p)",
  gld_vs_spy_5d_pct: "GLD의 SPY 대비 5일 상대수익률(%p)",
  risk_participation: "위험자산 참여도",
  growth: "성장주",
  small_caps: "소형주",
  classification_reason: "판정 이유",
  labels: "분류 기준",
  metrics: "지표",
  latest_price_as_of: "최신 가격 기준일",
  verified_event_count: "검증된 이벤트 수",
  korea_data_status: "한국 데이터 상태",
  warnings: "주의사항",
  label: "항목명",
  confidence: "신뢰도",
  quantitative_evidence: "정량 근거",
  report_timezone: "보고서 시간대",
  generated_at: "생성 시각",
  price_basis: "가격 기준",
  calendar_gap_days: "달력 공백 일수",
  note: "메모",
  news_scope: "뉴스 범위",
  monthly_macro_note: "월간 매크로 메모",
  record_count: "전체 근거 수",
  primary_source_confirmed_count: "1차 출처 확인 수",
  primary_confirmation_rate_pct: "1차 출처 확인율(%)",
  link_coverage_pct: "링크 포함률(%)",
  publication_allowed: "게시 가능",
  blockers: "게시 차단 요인",
  material_warnings: "중요 경고",
  evidence_posture: "근거 상태",
  active: "관찰 중",
  confirmed: "확인",
  unresolved: "미해결",
  unverified: "미검증",
  market_event: "시장 사건",
  market_hypothesis: "시장 가설",
  sector_thesis: "섹터 가설",
};

const FIELD_VALUES = {
  awaiting_company_profiles: "기업 프로필 대기",
  insufficient: "데이터 부족",
  mixed: "혼조",
  "CBOE VIX": "CBOE 변동성지수(VIX)",
  "CBOE 3-Month Volatility Index": "CBOE 3개월 변동성지수",
  "US High Yield Option-Adjusted Spread": "미국 하이일드 옵션조정스프레드",
  "US 10-Year Treasury Yield": "미국 10년 국채금리",
  "US 10-Year Real Yield": "미국 10년 실질금리",
  "FRED latest available observation": "FRED 최신 관측치",
  fact_provider_standardized: "표준화된 공급자 사실 데이터",
  "safe asset strength conflicts with risk participation": "안전자산 강세가 위험자산 참여 신호와 엇갈림",
  "Deterministic monitoring signal only; GPT analysis must discuss conflicts and may lower confidence.": "규칙 기반 모니터링 신호이며, AI 분석에서는 상충 신호를 함께 설명하고 신뢰도를 낮출 수 있습니다.",
};

const VIEW_META = {
  brief: { title: "리포트 보관함", eyebrow: "ARCHIVE", placeholder: "날짜·제목·종목 검색" },
  intelligence: { title: "전체 인텔리전스", eyebrow: "FULL DAILY", placeholder: "날짜·사건·지표 검색" },
  "world-memory": { title: "월드 메모리", eyebrow: "CONTINUITY", placeholder: "현재 스냅샷" },
};

const state = {
  payload: null,
  view: "brief",
  reports: [],
  filtered: [],
  activeId: "",
};

const listNode = document.querySelector("#report-list");
const readerNode = document.querySelector("#reader");
const countNode = document.querySelector("#report-count");
const searchNode = document.querySelector("#report-search");
const viewTabsNode = document.querySelector("#view-tabs");
const libraryTitleNode = document.querySelector("#library-title");
const libraryEyebrowNode = document.querySelector("#library-eyebrow");

function element(tag, className = "", content = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== "") node.textContent = String(content);
  return node;
}

function valueLabel(value) {
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value);
  }
  const normalized = String(value ?? "");
  const readable = normalized.replaceAll("_", " ");
  return FIELD_VALUES[normalized] || FIELD_VALUES[readable] || readable;
}

function fieldLabel(key) {
  return FIELD_LABELS[key] || String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value || "기준일 없음";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "시각 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function appendTextList(parent, values, className = "bullet-list") {
  if (!Array.isArray(values) || !values.length) return;
  const list = element("ul", className);
  values.forEach((value) => {
    if (value && typeof value === "object") {
      const item = element("li");
      appendRecord(item, value, 1);
      list.append(item);
    } else {
      list.append(element("li", "", value));
    }
  });
  parent.append(list);
}

function section(title, subtitle = "") {
  const node = element("section", "report-section");
  const heading = element("div", "section-heading");
  heading.append(element("h2", "section-title", title));
  if (subtitle) heading.append(element("p", "section-subtitle", subtitle));
  node.append(heading);
  return node;
}

function reportHeader({ eyebrow, title, date, meta = [] }) {
  const header = element("header", "report-header");
  header.append(element("span", "eyebrow", eyebrow));
  header.append(element("h1", "", title));
  if (date) header.append(element("time", "", formatDate(date)));
  if (meta.length) {
    const row = element("div", "header-meta");
    meta.filter(Boolean).forEach((item) => row.append(element("span", "", item)));
    header.append(row);
  }
  return header;
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
    if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) return;
    const row = element("div", "record-row");
    row.append(element("dt", "", fieldLabel(key)));
    const detail = element("dd");
    if (Array.isArray(value)) appendTextList(detail, value, "compact-list");
    else if (typeof value === "object") appendRecord(detail, value, depth + 1);
    else detail.textContent = valueLabel(value);
    row.append(detail);
    list.append(row);
  });
  if (list.childElementCount) parent.append(list);
}

function appendRecordSection(parent, title, value, subtitle = "") {
  if (!value || typeof value !== "object" || !Object.keys(value).length) return;
  const node = section(title, subtitle);
  appendRecord(node, value);
  parent.append(node);
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

function renderBrief(report) {
  const article = element("article", "report-document");
  article.append(reportHeader({ eyebrow: "DAILY MARKET BRIEF", title: report.title, date: report.reportDate }));
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
  [["실적 관찰", report.earningsWatch], ["한국 시장 연결", report.koreaConnection], ["데이터 상태", report.dataStatus]].forEach(([title, value]) => appendRecordSection(article, title, value));
  if (report.nextChecks?.length) {
    const checks = section("다음 확인");
    appendTextList(checks, report.nextChecks, "check-list");
    article.append(checks);
  }
  appendSources(article, report.sources);
  article.append(element("footer", "report-footer", "이 페이지는 인증된 사용자를 위한 읽기 전용 요약본입니다. 원문 저작권은 각 발행처에 있습니다."));
  return article;
}

function driverCards(values) {
  const grid = element("div", "finding-grid");
  (values || []).forEach((driver) => {
    const card = element("article", "finding-card");
    card.append(element("h3", "", driver.observation || "핵심 동인"));
    if (driver.interpretation) card.append(element("p", "", driver.interpretation));
    if (driver.confirmation_condition) card.append(element("small", "driver-condition is-confirm", `확인: ${driver.confirmation_condition}`));
    if (driver.invalidation_condition) card.append(element("small", "driver-condition is-invalidate", `무효화: ${driver.invalidation_condition}`));
    grid.append(card);
  });
  return grid;
}

function renderIntelligence(intelligence) {
  const article = element("article", "report-document intelligence-document");
  const regime = intelligence.market?.regime || {};
  article.append(reportHeader({
    eyebrow: "FULL DAILY INTELLIGENCE",
    title: `${intelligence.reportDate} 전체 데일리 인텔리전스`,
    date: intelligence.reportDate,
    meta: [regime.label && `시장 국면 ${regime.label}`, Number.isFinite(regime.confidence) && `신뢰도 ${regime.confidence}`, `선정 이벤트 ${intelligence.events?.selectedCount || 0}건`],
  }));

  if (regime.summary) {
    const lead = section("시장 국면");
    lead.classList.add("lead-section");
    lead.append(element("p", "lead-narrative", regime.summary));
    appendTextList(lead, regime.quantitative_evidence, "compact-list");
    article.append(lead);
  }
  if (intelligence.market?.keyDrivers?.length) {
    const drivers = section("핵심 동인");
    drivers.append(driverCards(intelligence.market.keyDrivers));
    article.append(drivers);
  }
  [["상충 신호", intelligence.market?.conflictingSignals], ["상위 위험", intelligence.market?.topRisks]].forEach(([title, values]) => {
    if (!values?.length) return;
    const node = section(title);
    appendTextList(node, values, title === "상위 위험" ? "risk-list" : "bullet-list");
    article.append(node);
  });
  appendRecordSection(article, "시장 스코어보드", intelligence.market?.scoreboard, "시장 폭·변동성·신용·금리·규칙 기반 신호");
  appendRecordSection(article, "전일 대비 변화", intelligence.market?.dayOverDayChanges);
  appendRecordSection(article, "한국 시장 전이", intelligence.market?.koreaTransmission);

  const events = intelligence.events?.items || [];
  if (events.length) {
    const node = section(`시장 이벤트 ${events.length}건`, `${intelligence.events?.verifiedPrimaryFactCount || 0}건의 1차 사실 검증 포함`);
    const stack = element("div", "research-stack");
    events.forEach((event, index) => {
      const details = element("details", "research-card event-card");
      if (index === 0) details.open = true;
      const summary = element("summary");
      const heading = element("span", "research-heading");
      heading.append(element("small", "", event.eventType || "MARKET EVENT"));
      heading.append(element("strong", "", event.title || event.eventId));
      summary.append(heading, element("span", "details-mark", "+"));
      details.append(summary);
      const body = element("div", "research-body");
      if (event.topicTags?.length) {
        const tags = element("div", "tag-row");
        event.topicTags.forEach((tag) => tags.append(element("span", "", tag)));
        body.append(tags);
      }
      [["공통 사실", event.commonFacts], ["보도 주장", event.reportedClaims], ["고유 관점", event.uniqueAngles], ["상충 주장", event.conflictingClaims]].forEach(([label, values]) => {
        if (!values?.length) return;
        body.append(element("h4", "", label));
        appendTextList(body, values, "compact-list");
      });
      [["기대 차이", event.expectationGap], ["시장 반응", event.marketReaction], ["영향 분석", event.impactAnalysis], ["우선순위", event.ranking]].forEach(([label, value]) => {
        if (!value || !Object.keys(value).length) return;
        body.append(element("h4", "", label));
        appendRecord(body, value, 1);
      });
      details.append(body);
      stack.append(details);
    });
    node.append(stack);
    article.append(node);
  }

  appendRecordSection(article, "연속성 요약", intelligence.continuity?.summary);
  if (intelligence.continuity?.activeEntries?.length) {
    const node = section("진행 중인 관찰 항목");
    const grid = element("div", "finding-grid compact-cards");
    intelligence.continuity.activeEntries.forEach((entry) => {
      const card = element("article", "finding-card");
      card.append(element("h3", "", entry.title || entry.continuity_id || "관찰 항목"));
      const meta = [entry.kind, entry.monitoring_state, entry.last_seen_date].filter(Boolean);
      if (meta.length) card.append(element("p", "card-meta", meta.join(" · ")));
      grid.append(card);
    });
    node.append(grid);
    article.append(node);
  }
  appendRecordSection(article, "실적 인텔리전스", { status: intelligence.earnings?.status, ...intelligence.earnings?.summary });
  if (intelligence.earnings?.companies?.length) appendRecordSection(article, "기업별 실적", { companies: intelligence.earnings.companies });
  appendRecordSection(article, "교차 출처 요약", intelligence.crossSourceSummary);
  appendRecordSection(article, "출처 품질", intelligence.sourceQuality);
  [["데이터 경고", intelligence.dataWarnings], ["계산 경고", intelligence.calculationWarnings]].forEach(([title, values]) => {
    if (!values?.length) return;
    const node = section(title);
    appendTextList(node, values, "risk-list");
    article.append(node);
  });
  article.append(element("footer", "report-footer", "운영 로그·원문 전문·인증정보를 제외한 읽기 전용 인텔리전스입니다."));
  return article;
}

function renderWorldMemory(memory) {
  const article = element("article", "report-document world-memory-document");
  const report = memory.report || {};
  article.append(reportHeader({
    eyebrow: "WORLD MEMORY",
    title: report.title || "월드 메모리",
    meta: [report.asOf && `기준 ${formatDateTime(report.asOf)}`, report.stance && `관점 ${report.stance}`, memory.collector?.status && `수집 ${memory.collector.status}`],
  }));
  const lead = section("현재 시장 상황");
  lead.classList.add("lead-section");
  if (report.summary) lead.append(element("p", "lead-narrative", report.summary));
  if (report.narrative) lead.append(element("p", "world-narrative", report.narrative));
  article.append(lead);

  if (report.signalRadar?.length) {
    const node = section("시그널 레이더");
    const grid = element("div", "signal-grid");
    report.signalRadar.forEach((signal) => {
      const card = element("article", "signal-card");
      const top = element("div", "signal-top");
      top.append(element("strong", "", signal.label));
      top.append(element("span", `signal-score tone-${signal.tone || "neutral"}`, signal.score));
      card.append(top);
      if (signal.note) card.append(element("p", "", signal.note));
      grid.append(card);
    });
    node.append(grid);
    article.append(node);
  }
  appendFindings(article, "주요 변화", report.highlights);
  [["포트폴리오 관찰 제안", report.portfolioSuggestions], ["메모리 변경 제안", report.memoryChangeSuggestions], ["다음 확인", report.nextChecks]].forEach(([title, values]) => {
    if (!values?.length) return;
    const node = section(title);
    appendTextList(node, values, title === "다음 확인" ? "check-list" : "summary-list");
    article.append(node);
  });

  if (memory.theses?.length) {
    const node = section(`PB 투자 가설 ${memory.theses.length}건`, memory.thesesUpdatedAt ? `최근 동기화 ${formatDateTime(memory.thesesUpdatedAt)}` : "");
    const stack = element("div", "research-stack");
    memory.theses.forEach((thesis, index) => {
      const details = element("details", "research-card thesis-card");
      if (index === 0) details.open = true;
      const summary = element("summary");
      const heading = element("span", "research-heading");
      heading.append(element("small", "", [thesis.priority, thesis.stateLabel || thesis.state].filter(Boolean).join(" · ") || "THESIS"));
      heading.append(element("strong", "", thesis.title || thesis.continuityId));
      summary.append(heading, element("span", "details-mark", "+"));
      details.append(summary);
      const body = element("div", "research-body");
      if (thesis.thesis) body.append(element("p", "research-summary", thesis.thesis));
      if (thesis.confirmationCondition) {
        body.append(element("h4", "", "확인 조건"));
        body.append(element("p", "research-summary", thesis.confirmationCondition));
      }
      if (thesis.invalidationCondition) {
        body.append(element("h4", "", "무효화 조건"));
        body.append(element("p", "research-summary", thesis.invalidationCondition));
      }
      if (thesis.evidence?.length) {
        body.append(element("h4", "", "근거"));
        appendTextList(body, thesis.evidence, "compact-list");
      }
      details.append(body);
      stack.append(details);
    });
    node.append(stack);
    article.append(node);
  }
  article.append(element("footer", "report-footer", "월드 메모리 원본 DB와 변경 기능은 로컬 앱에만 유지되며, 이 화면에는 민감정보를 제거한 읽기 전용 스냅샷만 표시됩니다."));
  return article;
}

function currentItems() {
  if (state.view === "brief") return state.payload?.reports || [];
  if (state.view === "intelligence") return state.payload?.intelligence || [];
  return state.payload?.worldMemory ? [state.payload.worldMemory] : [];
}

function itemId(item) {
  return state.view === "world-memory" ? "current" : item.reportDate;
}

function itemTitle(item) {
  if (state.view === "brief") return item.title;
  if (state.view === "intelligence") return `${item.reportDate} 전체 인텔리전스`;
  return item.report?.title || "현재 월드 메모리";
}

function itemSummary(item) {
  if (state.view === "brief") return item.executiveSummary?.[0] || "요약 없음";
  if (state.view === "intelligence") return item.market?.regime?.summary || `${item.events?.selectedCount || 0}개 이벤트`;
  return item.report?.summary || "월드 메모리 스냅샷";
}

function searchableText(item) {
  if (state.view === "brief") {
    return [item.reportDate, item.title, ...(item.executiveSummary || []), ...(item.marketFindings || []).flatMap((value) => [value.title, value.body]), ...(item.analystResearch || []).flatMap((value) => [value.publisher, value.title, ...(value.tickers || []), ...(value.sectors || [])])].join(" ").toLowerCase();
  }
  if (state.view === "intelligence") {
    return [item.reportDate, item.market?.regime?.label, item.market?.regime?.summary, ...(item.market?.topRisks || []), ...(item.events?.items || []).flatMap((value) => [value.title, ...(value.topicTags || [])]), ...(item.continuity?.activeEntries || []).map((value) => value.title)].join(" ").toLowerCase();
  }
  return [item.report?.title, item.report?.summary, item.report?.narrative, ...(item.report?.highlights || []).flatMap((value) => [value.title, value.body]), ...(item.theses || []).flatMap((value) => [value.title, value.thesis])].join(" ").toLowerCase();
}

function renderActive() {
  const item = state.filtered.find((value) => itemId(value) === state.activeId) || state.filtered[0];
  readerNode.replaceChildren();
  if (!item) {
    readerNode.append(element("div", "empty-state", state.view === "world-memory" ? "동기화된 월드 메모리가 없습니다." : "표시할 리포트가 없습니다."));
    return;
  }
  const documentNode = state.view === "brief" ? renderBrief(item) : state.view === "intelligence" ? renderIntelligence(item) : renderWorldMemory(item);
  readerNode.append(documentNode);
  readerNode.focus({ preventScroll: true });
}

function renderList() {
  listNode.replaceChildren();
  countNode.textContent = String(state.filtered.length);
  state.filtered.forEach((item) => {
    const id = itemId(item);
    const button = element("button", id === state.activeId ? "report-list-item is-active" : "report-list-item");
    button.type = "button";
    button.append(element("time", "", state.view === "world-memory" ? formatDateTime(item.generatedAt) : formatDate(item.reportDate)));
    button.append(element("strong", "", itemTitle(item)));
    button.append(element("span", "", itemSummary(item)));
    button.addEventListener("click", () => activate(id));
    listNode.append(button);
  });
}

function updateHash() {
  history.replaceState(null, "", `#${state.view}/${state.activeId || ""}`);
}

function activate(id, { updateLocation = true } = {}) {
  const item = state.filtered.find((value) => itemId(value) === id) || state.filtered[0];
  state.activeId = item ? itemId(item) : "";
  if (updateLocation) updateHash();
  renderList();
  renderActive();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setView(view, requestedId = "") {
  state.view = VIEW_META[view] ? view : "brief";
  const meta = VIEW_META[state.view];
  libraryTitleNode.textContent = meta.title;
  libraryEyebrowNode.textContent = meta.eyebrow;
  searchNode.value = "";
  searchNode.placeholder = meta.placeholder;
  searchNode.disabled = state.view === "world-memory";
  [...viewTabsNode.querySelectorAll("button")].forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
  state.reports = currentItems();
  state.filtered = [...state.reports];
  state.activeId = state.filtered.some((item) => itemId(item) === requestedId) ? requestedId : itemId(state.filtered[0] || {});
  renderList();
  renderActive();
  updateHash();
}

function showLocked() {
  searchNode.disabled = true;
  viewTabsNode.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  listNode.replaceChildren();
  countNode.textContent = "0";
  const card = element("section", "locked-state");
  card.append(element("span", "eyebrow", "SETUP IN PROGRESS"));
  card.append(element("h1", "", "비공개 리더를 준비하고 있습니다"));
  card.append(element("p", "", "접근 인증을 확인한 뒤 보고서가 안전하게 게시됩니다."));
  readerNode.replaceChildren(card);
}

viewTabsNode.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button || button.disabled) return;
  setView(button.dataset.view);
});

searchNode.addEventListener("input", () => {
  const query = searchNode.value.trim().toLowerCase();
  state.filtered = query ? state.reports.filter((item) => searchableText(item).includes(query)) : [...state.reports];
  if (!state.filtered.some((item) => itemId(item) === state.activeId)) state.activeId = itemId(state.filtered[0] || {});
  renderList();
  renderActive();
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
    state.payload = payload;
    const [requestedView, requestedId] = location.hash.slice(1).split("/");
    const legacyDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedView || "") ? requestedView : "";
    setView(legacyDate ? "brief" : requestedView, legacyDate || requestedId);
  })
  .catch(() => {
    readerNode.replaceChildren(element("div", "error-state", "리포트를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요."));
  });
