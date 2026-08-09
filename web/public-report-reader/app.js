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
  schema_version: "스키마 버전",
  schemaVersion: "스키마 버전",
  report_date: "보고서 기준일",
  reportDate: "보고서 기준일",
  generatedAt: "생성 시각",
  audience: "대상 독자",
  collection_status: "수집 상태",
  source_provider: "자료 제공처",
  upstream_source: "원천 자료",
  source_url: "출처 링크",
  source_policy: "출처 정책",
  source_quality: "출처 품질",
  primary_source_confirmed: "1차 출처 확인",
  market_cutoff: "시장 데이터 기준",
  max_age_days: "허용 경과 일수",
  age_days: "경과 일수",
  change_1d_pct: "1일 변화율(%)",
  change_5d_pct: "5일 변화율(%)",
  change_5d_status: "5일 변화 산정 상태",
  change_5d_base_as_of: "5일 변화 비교 기준일",
  history_observation_count: "사용 관측치 수",
  transmission_gate: "한국 시장 전이 판정",
  available_metrics: "사용 가능 지표",
  missing_metrics: "누락 지표",
  decision_limit: "판단 제한",
  dayOverDayChanges: "전일 대비 변화",
  previous_report_date: "이전 보고서 기준일",
  sector_leader_changes: "섹터 주도주 변화",
  etf_close_changes_pct: "ETF 종가 변화율(%)",
  tracking_metric_changes: "추적 지표 변화",
  candidate_changes: "후보 변화",
  added: "추가",
  removed: "제외",
  event_id: "이벤트 ID",
  eventId: "이벤트 ID",
  eventType: "이벤트 유형",
  expectation_gap: "기대 차이",
  observations: "관측값",
  causal_attribution_permitted: "인과관계 표현 허용",
  required_event_window_measurements: "필수 이벤트 구간 측정값",
  ranking: "우선순위 평가",
  priority_score: "종합 우선순위 점수",
  maximum_score: "최대 점수",
  impact_priority_score: "시장 영향 우선순위 점수",
  evidence_readiness_score: "근거 준비도 점수",
  event_window_price_reaction: "이벤트 구간 가격 반응",
  event_window_price_reaction_measured: "이벤트 구간 가격 반응 측정",
  components: "평가 항목",
  market_impact_breadth: "시장 영향 범위",
  korean_market_relevance: "한국 시장 관련성",
  official_source_confirmation: "공식 출처 확인",
  recency: "최신성",
  penalties: "감점 항목",
  reason: "사유",
  points: "점수",
  korean_relevance_reasons: "한국 시장 관련성 근거",
  eligible_for_synthesis: "종합 분석 사용 가능",
  entry_count: "항목 수",
  state_counts: "상태별 항목 수",
  kind_counts: "유형별 항목 수",
  pending_suggestion_count: "대기 중 제안 수",
  company_count: "기업 수",
  confirmed_event_count: "확인된 이벤트 수",
  estimate_revision_count: "추정치 변경 수",
  guidance_count: "가이던스 수",
  verified_result_count: "검증된 실적 수",
  event_count: "이벤트 수",
  events_with_primary_sources: "1차 출처가 있는 이벤트",
  events_with_attributed_research: "출처가 명시된 리서치 포함 이벤트",
  unmatched_research_context_count: "연결되지 않은 리서치 수",
  duplicate_canonical_urls: "중복 대표 링크",
  ticker: "종목 코드",
  return_1d_pct: "1일 수익률(%)",
  return_5d_pct: "5일 수익률(%)",
  calendar_gap_days: "달력 공백 일수",
  monitoring_state: "관찰 상태",
  last_seen_date: "최근 확인일",
  continuity_id: "연속성 ID",
  commonFacts: "공통 사실",
  reportedClaims: "보도 주장",
  uniqueAngles: "고유 관점",
  conflictingClaims: "상충 주장",
  expectationGap: "기대 차이",
  marketReaction: "시장 반응",
  impactAnalysis: "영향 분석",
  fallbackReason: "대체 처리 사유",
  synthesisStatus: "종합 분석 상태",
  activeEntries: "진행 중인 관찰 항목",
  analyst: "애널리스트",
  analyst_count: "애널리스트 수",
  asOf: "기준 시각",
  body: "내용",
  broker_report_reference_only: "증권사 리포트 참조 전용",
  catalysts: "촉매",
  change: "변화",
  claim: "주장",
  clusterCount: "사건군 수",
  collector: "수집기",
  companies: "기업",
  company_name: "기업명",
  complete_core_years: "완성된 핵심 재무 연도",
  revenue_cagr_pct: "매출 CAGR(%)",
  operating_income_cagr_pct: "영업이익 CAGR(%)",
  fcf_cagr_pct: "FCF CAGR(%)",
  latest_operating_margin_pct: "최근 영업이익률(%)",
  latest_fcf_margin_pct: "최근 FCF 마진(%)",
  median_fcf_conversion_pct: "FCF 전환율 중앙값(%)",
  positive_operating_income_years: "영업이익 흑자 연도",
  positive_fcf_years: "FCF 흑자 연도",
  diluted_share_count_change_pct: "희석주식수 변화(%)",
  cumulative_returns_to_fcf_pct: "누적 주주환원/FCF(%)",
  company_thesis: "기업 투자 가설",
  comparability_limit: "비교 가능성 제한",
  confirmation_condition: "확인 조건",
  confirmationCondition: "확인 조건",
  conflictingSignals: "상충 신호",
  current: "현재 값",
  decision_limits: "판단 제한",
  derived_valuation: "파생 밸류에이션",
  entities: "관련 대상",
  entityId: "대상 ID",
  eps_estimate: "주당순이익 추정치",
  estimate: "추정치",
  estimate_as_of: "추정치 기준일",
  estimate_revision: "추정치 변경",
  event_date: "이벤트 일자",
  evidence: "근거",
  evidence_ids: "근거 ID",
  firstSeenAt: "최초 확인 시각",
  fiscal_period_end: "회계기간 종료일",
  foreign_kospi_cash_net_buy_krw: "외국인 코스피 현물 순매수",
  foreign_kospi200_futures_net_buy_contracts: "외국인 코스피200 선물 순매수 계약 수",
  freeze_as_of: "데이터 확정 기준",
  guidance: "회사 가이던스",
  importance: "중요도",
  interpretation: "해석",
  invalidation_condition: "무효화 조건",
  invalidationCondition: "무효화 조건",
  kind: "유형",
  kosdaq: "코스닥",
  kospi: "코스피",
  lastAction: "최근 처리",
  lastReportSuccessfulAt: "최근 보고서 성공 시각",
  lastSeenAt: "최근 확인 시각",
  lastSuccessfulAt: "최근 수집 성공 시각",
  latest_verified_result: "최신 검증 실적",
  listedEntities: "상장 관련 대상",
  locked: "잠금 상태",
  market_structure_change: "시장 구조 변화",
  metric: "지표",
  metric_id: "지표 ID",
  metricId: "지표 ID",
  metricUnit: "지표 단위",
  metricValue: "지표 값",
  minimum_peer_count: "최소 비교기업 수",
  model_update_applied: "모델 갱신 반영",
  narrative: "상황 설명",
  observation: "관측 사실",
  observationCount: "관측 횟수",
  peer_median: "비교기업 중앙값",
  period_end: "대상 기간 종료일",
  post_result_estimate_revision: "실적 발표 후 추정치 변경",
  premium_discount_pct: "프리미엄·할인율(%)",
  previous: "이전 값",
  price: "가격",
  price_as_of: "가격 기준일",
  primary_metric: "핵심 지표",
  priority: "우선순위",
  publishedAt: "발행 시각",
  publisher: "발행기관",
  reference: "참조 ID",
  regime: "시장 국면",
  relative_valuation_status: "상대 밸류에이션 상태",
  reportType: "리포트 유형",
  result: "공식 실적",
  revision_direction: "추정치 변경 방향",
  revision_pct_30d: "30일 추정치 변경률(%)",
  risks: "위험",
  rows: "세부 항목",
  samsung_electronics: "삼성전자",
  scoreboard: "시장 스코어보드",
  sectorLabel: "섹터명",
  sectors: "섹터",
  sectorTicker: "섹터 티커",
  selectedCount: "선정 이벤트 수",
  sk_hynix: "SK하이닉스",
  source_id: "출처 ID",
  source_index: "출처 순번",
  sourceQuality: "출처 품질",
  spy_return_5d_pct: "SPY 5일 수익률(%)",
  stance: "투자 관점",
  state: "상태",
  stateLabel: "상태명",
  statement: "공식 발표",
  tag: "분류",
  target_value: "목표값",
  thesesUpdatedAt: "투자 가설 갱신 시각",
  thesis: "투자 가설",
  tickers: "종목 코드",
  title: "제목",
  tone: "신호 성격",
  topicTags: "주제 태그",
  unit: "단위",
  units: "단위",
  upcoming_event: "예정 이벤트",
  url: "링크",
  usable_peer_count: "사용 가능 비교기업 수",
  usdkrw: "원/달러 환율",
  valuation_screen: "밸류에이션 점검",
};

const FIELD_VALUES = {
  awaiting_company_profiles: "기업 프로필 대기",
  insufficient: "데이터 부족",
  ready: "정상",
  changed: "변화 있음",
  not_available: "미제공",
  mixed: "혼조",
  "CBOE VIX": "CBOE 변동성지수(VIX)",
  "CBOE 3-Month Volatility Index": "CBOE 3개월 변동성지수",
  "US High Yield Option-Adjusted Spread": "미국 하이일드 옵션조정스프레드",
  "US 10-Year Treasury Yield": "미국 10년 국채금리",
  "US 10-Year Real Yield": "미국 10년 실질금리",
  "FRED latest available observation": "FRED 최신 관측치",
  fact_provider_standardized: "표준화된 공급자 사실 데이터",
  fact_source_reported: "출처가 보고한 사실",
  "safe asset strength conflicts with risk participation": "안전자산 강세가 위험자산 참여 신호와 엇갈림",
  "Deterministic monitoring signal only; GPT analysis must discuss conflicts and may lower confidence.": "규칙 기반 모니터링 신호이며, AI 분석에서는 상충 신호를 함께 설명하고 신뢰도를 낮출 수 있습니다.",
  active: "관찰 중",
  available: "사용 가능",
  blocked: "차단됨",
  broadening: "확산 중",
  candidate: "후보",
  cautious: "신중",
  collecting: "수집 중",
  compared: "비교 완료",
  confirmed: "확인",
  easing: "완화",
  expected: "예상",
  high: "높음",
  medium: "중간",
  negative: "부정적",
  neutral: "중립",
  partial: "일부 수집",
  positive: "긍정적",
  stale: "기준일 초과",
  strengthening: "강화",
  unresolved: "미해결",
  unverified: "미검증",
  watching: "관찰 중",
  weakening: "약화",
  no_previous_report: "이전 보고서 없음",
  previous_available_close: "직전 사용 가능 종가",
  latest_available_close_precedes_report_date: "최신 종가가 보고서 기준일보다 이전임",
  latest_available_daily_observation: "최신 일간 관측값",
  official_daily_close: "공식 일일 종가",
  calculated_from_six_official_closes: "공식 종가 6개로 계산",
  insufficient_data: "데이터 부족",
  insufficient_peer_data: "비교기업 데이터 부족",
  insufficient_usable_peers: "사용 가능한 비교기업 부족",
  insufficient_verified_korea_data: "검증된 한국 시장 데이터 부족",
  not_available_in_connected_krx_index_services: "연결된 KRX 지수 서비스에서 제공되지 않음",
  not_available_no_verified_result_input: "검증된 실적 입력값이 없어 제공되지 않음",
  not_established_missing_refreshed_estimates: "최신 추정치 부족으로 판단 불가",
  not_measured_stale_or_unaligned: "기준일 불일치 또는 오래된 데이터로 미측정",
  not_run: "미실행",
  not_stated: "의견 없음",
  monitoring_only: "관찰 전용",
  no_eligible_events: "분석 가능한 이벤트 없음",
  no_verified_primary_fact: "검증된 1차 사실 없음",
  adjacent_close_context_not_causal: "인접 종가 참고값이며 인과관계 아님",
  same_session_context_not_causal: "동일 세션 참고값이며 인과관계 아님",
  attributed_analysis: "출처가 명시된 분석",
  metadata_or_secondary_only: "메타데이터 또는 2차 출처만 존재",
  missing_required_primary_source: "필수 1차 출처 누락",
  missing_required_source: "필수 출처 누락",
  reported_secondary_unverified: "2차 보도이며 미검증",
  structured_extraction_unavailable: "구조화 추출 불가",
  derived_screening_calculation: "선별용 파생 계산",
  provider_records_present_in_the_normalized_inbox: "정규화된 수집함에 제공자 기록이 존재함",
  announcement_timestamp: "발표 시각",
  pre_30m: "발표 30분 전",
  post_5m: "발표 5분 후",
  post_1h: "발표 1시간 후",
  session_close: "당일 종가",
  next_session_close: "다음 거래일 종가",
  market_event: "시장 사건",
  market_hypothesis: "시장 가설",
  sector_thesis: "섹터 가설",
  monetary_policy: "통화정책",
  regulation_policy: "규제·정책",
  earnings_guidance: "실적·가이던스",
  market_structure: "시장 구조",
  macro: "거시경제",
  equities: "주식",
  etf: "ETF",
  company: "기업",
  rates: "금리",
  supply: "공급",
  tariff: "관세",
  guidance: "가이던스",
  profit: "이익",
  inflation: "물가",
  fed: "연준",
  war: "전쟁",
  iran: "이란",
  china: "중국",
  oil: "원유",
  ai: "AI",
  buyback: "자사주 매입",
  offering: "증권 발행",
  market_strategy: "시장전략",
  macro_company_interpretation: "거시·기업 해석",
  market_commentary_ideas: "시장 코멘터리",
  us_equities: "미국 주식",
  us_global_breaking_news: "미국·글로벌 속보",
  japan_us_company_research: "일본·미국 기업 리서치",
  domestic_sector_company_ideas: "국내 섹터·기업 아이디어",
  telegram: "텔레그램",
  telegram_priority_1: "텔레그램 우선순위 1",
  telegram_priority_2: "텔레그램 우선순위 2",
  telegram_priority_3: "텔레그램 우선순위 3",
  verified_event_screen: "공식 사건 선별",
  direct_user_watchlist: "직접 등록 후보",
  sector_research: "섹터 리서치 후보",
  financial_compounding_supported: "재무 복리 확인",
  evaluation_withheld: "평가 보류",
  broker_research: "증권사 리서치",
  broker_us_equity_research: "미국 주식 리서치",
  broker_asset_strategy: "자산전략 리서치",
  broker_market_strategy: "시장전략 리서치",
  broker_small_mid_cap_research: "중소형주 리서치",
  institutional_research: "기관 리서치",
  general_market_news: "일반 시장 뉴스",
  global_markets: "글로벌 시장",
  geopolitics: "지정학",
  economic_data: "경제지표",
  corporate_action: "기업 활동",
  commodity_supply: "원자재 공급",
  selective_rotation: "선별적 순환매",
  mixed_rotation: "혼조 순환매",
  breadth_positive_but_growth_or_small_caps_weak: "시장 폭은 양호하지만 성장주 또는 소형주가 약함",
  broad_korean_transmission_requires_confirmation: "광범위한 한국 시장 전이는 추가 확인 필요",
  safe_asset_strength_conflicts_with_risk_participation: "안전자산 강세와 위험자산 참여가 엇갈림",
  sector_connection_present: "연결된 섹터가 있음",
  index_points: "지수 포인트",
  krw_per_usd: "달러당 원화",
  usd_per_share: "주당 달러",
  research_grade: "리서치 등급",
  research_reader: "리서치 독자",
  private_banker: "프라이빗 뱅커",
  korea_market_snapshot_v1: "한국 시장 스냅샷 v1",
  usdkrw: "원/달러 환율",
  kospi: "코스피",
  kosdaq: "코스닥",
  foreign_kospi_cash_net_buy_krw: "외국인 코스피 현물 순매수",
  foreign_kospi200_futures_net_buy_contracts: "외국인 코스피200 선물 순매수 계약 수",
  samsung_electronics: "삼성전자",
  sk_hynix: "SK하이닉스",
  "Federal Reserve H.10": "미 연준 H.10",
  "Korea Exchange": "한국거래소",
  "Do not infer Korean-market direction from U.S. assets until verified KOSPI, KOSDAQ, and flow data are available.": "검증된 코스피·코스닥·수급 데이터가 확보되기 전에는 미국 자산 움직임만으로 한국 시장 방향을 추론하지 않습니다.",
  "USD/KRW uses FRED's Federal Reserve H.10 series. KRX indices and flows require an approved KRX Open API service or a separately verified official input.": "원/달러 환율은 FRED의 미 연준 H.10 시계열을 사용합니다. KRX 지수와 수급은 승인된 KRX Open API 또는 별도로 검증된 공식 입력값이 필요합니다.",
  "Daily and five-session returns are context only. They are not an announcement-window reaction and must not be described as caused by this event.": "1일·5거래일 수익률은 참고값일 뿐 발표 구간 반응이 아니며, 해당 이벤트가 원인이라고 표현할 수 없습니다.",
};

const VIEW_META = {
  brief: { title: "리포트 보관함", eyebrow: "ARCHIVE", placeholder: "날짜·제목·종목 검색" },
  intelligence: { title: "전체 인텔리전스", eyebrow: "FULL DAILY", placeholder: "날짜·사건·지표 검색" },
  companies: { title: "개별주식 후보", eyebrow: "LONG-TERM REVIEW", placeholder: "날짜·기업·종목 검색" },
  telegram: { title: "텔레그램 모니터", eyebrow: "3-HOUR REFRESH", placeholder: "사건·채널 검색" },
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
  const valueKey = normalized.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return FIELD_VALUES[normalized] || FIELD_VALUES[readable] || FIELD_VALUES[valueKey] || readable;
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
      list.append(element("li", "", valueLabel(value)));
    }
  });
  parent.append(list);
}

function koreanSummaryForTitle(title, summaries = []) {
  if (!title || /[가-힣]/.test(title)) return "";
  return summaries.find((value) => typeof value === "string" && /[가-힣]/.test(value)) || "";
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

function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metricValue(value) {
  if (value && typeof value === "object") return finiteNumber(value.value);
  return finiteNumber(value);
}

function metricDate(value, fallback = "") {
  if (value && typeof value === "object" && value.as_of) return value.as_of;
  return fallback;
}

function compactNumber(value, digits = 2) {
  const number = finiteNumber(value);
  if (number === null) return "자료 없음";
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(number);
}

function signedNumber(value, digits = 2, suffix = "") {
  const number = finiteNumber(value);
  if (number === null) return "자료 없음";
  return `${number > 0 ? "+" : ""}${compactNumber(number, digits)}${suffix}`;
}

function appendIntelligenceOverview(parent, intelligence) {
  const regime = intelligence.market?.regime || {};
  const cutoff = intelligence.market?.dataCutoff || {};
  const publicationAllowed = intelligence.sourceQuality?.publication_allowed;
  const statusReady = publicationAllowed === true || cutoff.status === "ready";
  const statusText = publicationAllowed === false
    ? "검토 필요"
    : statusReady
      ? "정상"
      : valueLabel(cutoff.status || "확인 필요");
  const confidence = finiteNumber(regime.confidence);
  const node = section("오늘의 시장 대시보드", "핵심 결론과 데이터 상태를 먼저 확인합니다.");
  node.classList.add("intelligence-overview");
  const grid = element("div", "overview-grid");

  const regimeCard = element("article", "overview-card is-primary");
  regimeCard.append(element("span", "overview-label", "시장 국면"));
  regimeCard.append(element("strong", "overview-primary-value", valueLabel(regime.label || "확인 필요")));
  if (regime.summary) regimeCard.append(element("p", "overview-summary", regime.summary));
  grid.append(regimeCard);

  [
    {
      label: "판단 신뢰도",
      value: confidence === null ? "확인 필요" : `${Math.round(confidence * 100)}%`,
      detail: confidence === null ? "정량 근거 확인 필요" : confidence >= 0.7 ? "높은 신뢰 구간" : confidence >= 0.5 ? "중간 신뢰 구간" : "보수적 해석 필요",
      tone: confidence !== null && confidence >= 0.7 ? "positive" : "warning",
    },
    {
      label: "검증 이벤트",
      value: `${intelligence.events?.verifiedPrimaryFactCount || 0}건`,
      detail: `선정 ${intelligence.events?.selectedCount || 0}건`,
      tone: intelligence.events?.verifiedPrimaryFactCount ? "positive" : "neutral",
    },
    {
      label: "가격 기준일",
      value: cutoff.latest_price_as_of || "확인 필요",
      detail: cutoff.price_basis ? valueLabel(cutoff.price_basis) : "최신 시장 데이터",
      tone: cutoff.latest_price_as_of ? "neutral" : "warning",
    },
    {
      label: "리포트 상태",
      value: statusText,
      detail: statusReady ? "보호된 리더 게시 가능" : "경고와 차단 요인 확인",
      tone: statusReady ? "positive" : "warning",
    },
  ].forEach((item) => {
    const card = element("article", `overview-card tone-${item.tone}`);
    card.append(element("span", "overview-label", item.label));
    card.append(element("strong", "overview-value", item.value));
    card.append(element("small", "overview-detail", item.detail));
    grid.append(card);
  });
  node.append(grid);
  parent.append(node);
}

function scoreboardMetrics(scoreboard) {
  const breadth = scoreboard?.breadth || {};
  const volatility = scoreboard?.volatility || {};
  const credit = scoreboard?.credit || {};
  const rates = scoreboard?.rates || {};
  const breadth5d = finiteNumber(breadth.rsp_vs_spy_5d_pct);
  const vix = metricValue(volatility.vix);
  const termRatio = finiteNumber(volatility.vix_term_ratio);
  const creditChange = finiteNumber(credit.high_yield_oas?.change_5_sessions);
  return [
    {
      label: "RSP/SPY 5일",
      value: breadth5d,
      unit: "%p",
      change: finiteNumber(breadth.rsp_vs_spy_1d_pct),
      changeLabel: "1일",
      asOf: breadth.as_of,
      tone: breadth5d === null ? "neutral" : breadth5d >= 0 ? "positive" : "negative",
    },
    {
      label: "VIX",
      value: vix,
      unit: "",
      change: finiteNumber(volatility.vix?.change_1d),
      changeLabel: "1일",
      asOf: metricDate(volatility.vix, volatility.as_of),
      tone: vix !== null && vix < 20 ? "positive" : "warning",
    },
    {
      label: "VIX/3개월물",
      value: termRatio,
      unit: "배",
      change: null,
      changeLabel: termRatio !== null && termRatio < 1 ? "콘탱고" : "백워데이션",
      asOf: volatility.as_of,
      tone: termRatio !== null && termRatio < 1 ? "positive" : "warning",
    },
    {
      label: "하이일드 OAS",
      value: metricValue(credit.high_yield_oas),
      unit: "%",
      change: creditChange,
      changeLabel: "5거래일",
      asOf: metricDate(credit.high_yield_oas),
      tone: creditChange === null ? "neutral" : creditChange <= 0 ? "positive" : "warning",
    },
    {
      label: "미국 10년 명목금리",
      value: metricValue(rates.nominal_10y),
      unit: "%",
      change: finiteNumber(rates.nominal_10y?.change_5_sessions),
      changeLabel: "5거래일",
      asOf: metricDate(rates.nominal_10y),
      tone: "neutral",
    },
    {
      label: "미국 10년 실질금리",
      value: metricValue(rates.real_10y),
      unit: "%",
      change: finiteNumber(rates.real_10y?.change_5_sessions),
      changeLabel: "5거래일",
      asOf: metricDate(rates.real_10y),
      tone: "neutral",
    },
  ].filter((item) => item.value !== null);
}

function relativePerformance(scoreboard) {
  const breadth = scoreboard?.breadth || {};
  const participation = scoreboard?.rule_based_signal?.participation || {};
  return [
    ["RSP", breadth.rsp_vs_spy_5d_pct],
    ["QQQ", participation.qqq_vs_spy_5d_pct],
    ["IWM", participation.iwm_vs_spy_5d_pct],
    ["GLD", participation.gld_vs_spy_5d_pct],
  ].map(([label, value]) => ({ label, value: finiteNumber(value) })).filter((item) => item.value !== null);
}

function appendScoreboard(parent, scoreboard) {
  if (!scoreboard || typeof scoreboard !== "object") return;
  const metrics = scoreboardMetrics(scoreboard);
  if (!metrics.length) return;
  const node = section("시장 스코어보드", "시장 폭·변동성·신용·금리·상대성과를 한눈에 비교합니다.");
  node.classList.add("scoreboard-section");

  const signal = scoreboard.rule_based_signal || {};
  if (Object.keys(signal).length) {
    const banner = element("article", "scoreboard-signal");
    const copy = element("div", "scoreboard-signal-copy");
    copy.append(element("span", "overview-label", "규칙 기반 시장 신호"));
    copy.append(element("strong", "scoreboard-signal-value", valueLabel(signal.label || "확인 필요")));
    const reason = valueLabel(signal.classification_reason || signal.note || "상충 신호를 함께 확인합니다.");
    copy.append(element("p", "scoreboard-signal-reason", reason));
    banner.append(copy);
    const score = element("div", "scoreboard-signal-score");
    score.append(element("span", "", "점수"));
    score.append(element("strong", "", compactNumber(signal.score, 0)));
    if (Array.isArray(signal.range) && signal.range.length >= 2) {
      score.append(element("small", "", `${signal.range[0]} ~ ${signal.range[1]}`));
    }
    banner.append(score);
    const chips = element("div", "scoreboard-signal-chips");
    (Array.isArray(signal.signals) ? signal.signals : []).forEach((item) => {
      const chip = element("span", "signal-chip");
      chip.append(element("b", "", valueLabel(item.label || "신호")));
      chip.append(element("em", finiteNumber(item.contribution) >= 0 ? "is-positive" : "is-negative", signedNumber(item.contribution, 0)));
      chips.append(chip);
    });
    if (chips.childElementCount) banner.append(chips);
    node.append(banner);
  }

  const grid = element("div", "scoreboard-card-grid");
  metrics.forEach((metric) => {
    const card = element("article", `scoreboard-card tone-${metric.tone}`);
    card.append(element("span", "scoreboard-card-label", metric.label));
    card.append(element("strong", "scoreboard-card-value", `${compactNumber(metric.value)}${metric.unit}`));
    const detail = metric.change === null
      ? metric.changeLabel
      : `${metric.changeLabel} ${signedNumber(metric.change, 2, metric.unit)}`;
    card.append(element("small", "scoreboard-card-change", detail));
    if (metric.asOf) card.append(element("time", "scoreboard-card-date", `기준 ${metric.asOf}`));
    grid.append(card);
  });
  node.append(grid);

  const relatives = relativePerformance(scoreboard);
  if (relatives.length) {
    const maxValue = Math.max(1, ...relatives.map((item) => Math.abs(item.value)));
    const panel = element("article", "relative-panel");
    const heading = element("div", "relative-heading");
    heading.append(element("strong", "", "SPY 대비 5일 상대성과"));
    heading.append(element("span", "", "%p"));
    panel.append(heading);
    relatives.forEach((item) => {
      const row = element("div", "relative-row");
      row.append(element("span", "relative-label", item.label));
      const track = element("div", "relative-track");
      const fill = element("i", item.value >= 0 ? "is-positive" : "is-negative");
      fill.style.width = `${Math.max(3, (Math.abs(item.value) / maxValue) * 48)}%`;
      fill.style[item.value >= 0 ? "left" : "right"] = "50%";
      track.append(fill);
      row.append(track);
      row.append(element("strong", item.value >= 0 ? "is-positive" : "is-negative", signedNumber(item.value, 2)));
      panel.append(row);
    });
    node.append(panel);
  }
  parent.append(node);
}

function renderIntelligence(intelligence) {
  const article = element("article", "report-document intelligence-document");
  const regime = intelligence.market?.regime || {};
  const confidence = finiteNumber(regime.confidence);
  article.append(reportHeader({
    eyebrow: "FULL DAILY INTELLIGENCE",
    title: `${intelligence.reportDate} 전체 데일리 인텔리전스`,
    date: intelligence.reportDate,
    meta: [regime.label && `시장 국면 ${valueLabel(regime.label)}`, confidence !== null && `신뢰도 ${Math.round(confidence * 100)}%`, `선정 이벤트 ${intelligence.events?.selectedCount || 0}건`],
  }));

  appendIntelligenceOverview(article, intelligence);
  if (regime.quantitative_evidence?.length) {
    const lead = section("시장 판단 근거");
    lead.classList.add("evidence-section");
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
  appendScoreboard(article, intelligence.market?.scoreboard);
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
      heading.append(element("small", "", valueLabel(event.eventType || "market_event")));
      heading.append(element("strong", "", event.title || event.eventId));
      const koreanSummary = koreanSummaryForTitle(event.title, event.commonFacts || []);
      if (koreanSummary) heading.append(element("span", "event-korean-summary", `한글 요약 · ${koreanSummary}`));
      summary.append(heading, element("span", "details-mark", "+"));
      details.append(summary);
      const body = element("div", "research-body");
      if (event.topicTags?.length) {
        const tags = element("div", "tag-row");
        event.topicTags.forEach((tag) => tags.append(element("span", "", valueLabel(tag))));
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
      const meta = [entry.kind && valueLabel(entry.kind), entry.monitoring_state && valueLabel(entry.monitoring_state), entry.last_seen_date].filter(Boolean);
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
    meta: [report.asOf && `기준 ${formatDateTime(report.asOf)}`, report.stance && `관점 ${valueLabel(report.stance)}`, memory.collector?.status && `수집 ${valueLabel(memory.collector.status)}`],
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

function renderTelegram(telegram) {
  const article = element("article", "report-document telegram-document");
  article.append(reportHeader({
    eyebrow: "TELEGRAM DISCOVERY MONITOR",
    title: "텔레그램 정보 채널",
    meta: [
      `최근 수집 ${formatDateTime(telegram.generatedAt)}`,
      `상태 ${valueLabel(telegram.status || "확인 필요")}`,
      "3시간 주기",
    ],
  }));
  article.append(element(
    "p",
    "telegram-disclaimer",
    "텔레그램 게시물은 발견·관점 자료입니다. 공식자료로 확인되기 전에는 사실이나 투자 판단 근거로 확정하지 않습니다.",
  ));

  const overview = section("수집 현황", "중복 제거와 사건 묶기 결과입니다.");
  const grid = element("div", "overview-grid telegram-overview");
  [
    ["수집 게시물", telegram.rawPostCount || 0],
    ["중복 제거 후", telegram.deduplicatedPostCount || 0],
    ["사건 묶음", telegram.eventClusterCount || 0],
    ["참여 채널", telegram.representedChannelCount || 0],
    ["PDF 승인 후보", telegram.pdfAttachmentCount || 0],
  ].forEach(([label, value]) => {
    const card = element("article", "overview-card");
    card.append(element("span", "overview-label", label));
    card.append(element("strong", "overview-value", `${value}건`));
    grid.append(card);
  });
  overview.append(grid);
  article.append(overview);

  if (telegram.clusters?.length) {
    const node = section(`최신 사건 ${telegram.clusters.length}개`, "같은 사건으로 추정되는 게시물을 채널별로 묶었습니다.");
    const stack = element("div", "research-stack");
    telegram.clusters.forEach((cluster, index) => {
      const details = element("details", "research-card telegram-card");
      if (index === 0) details.open = true;
      const summary = element("summary");
      const heading = element("span", "research-heading");
      heading.append(element("small", "", [valueLabel(cluster.eventType || "other"), `${cluster.postCount || 0}건`].join(" · ")));
      heading.append(element("strong", "", cluster.title || cluster.eventId || "제목 없음"));
      summary.append(heading, element("span", "details-mark", "+"));
      details.append(summary);
      const body = element("div", "research-body");
      const metadata = [
        cluster.latestPublishedAt && `최근 게시 ${formatDateTime(cluster.latestPublishedAt)}`,
        cluster.verificationStatus && `검증 ${valueLabel(cluster.verificationStatus)}`,
      ].filter(Boolean);
      if (metadata.length) body.append(element("p", "research-meta", metadata.join(" · ")));
      if (cluster.channels?.length) {
        const tags = element("div", "tag-row");
        cluster.channels.forEach((channel) => tags.append(element("span", "", channel)));
        body.append(tags);
      }
      if (cluster.postUrls?.length) {
        const links = element("div", "telegram-links");
        cluster.postUrls.forEach((url, linkIndex) => {
          const link = element("a", "source-link", `게시물 ${linkIndex + 1} 열기`);
          link.href = url;
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          links.append(link);
        });
        body.append(links);
      }
      details.append(body);
      stack.append(details);
    });
    node.append(stack);
    article.append(node);
  }
  article.append(element("footer", "report-footer", "채널명·제목·사건 분류·게시물 링크만 표시하며 게시물 원문과 PDF 본문은 배포하지 않습니다."));
  return article;
}

function companyMetricCards(profile) {
  const summary = profile.longTermSummary || {};
  const metrics = [
    ["영업이익 CAGR", summary.operating_income_cagr_pct, "%"],
    ["FCF CAGR", summary.fcf_cagr_pct, "%"],
    ["최근 영업이익률", summary.latest_operating_margin_pct, "%"],
    ["FCF 전환율", summary.median_fcf_conversion_pct, "%"],
  ].filter(([, value]) => finiteNumber(value) !== null);
  const grid = element("div", "company-metric-grid");
  metrics.forEach(([label, value, suffix]) => {
    const card = element("article", "company-metric-card");
    card.append(element("span", "overview-label", label));
    card.append(element("strong", "company-metric-value", `${compactNumber(value, 2)}${suffix}`));
    grid.append(card);
  });
  return grid;
}

function companyVerdictCard(title, verdict) {
  const card = element("article", "company-verdict-card");
  card.append(element("span", "company-verdict-title", title));
  card.append(element("strong", "company-verdict-label", verdict?.label || valueLabel(verdict?.status || "평가 보류")));
  if (verdict?.reason) card.append(element("p", "", verdict.reason));
  return card;
}

const candidateReasonLabels = {
  material_event: "중요 사건",
  abnormal_spy_relative_move: "시장 대비 이례적 변동",
  volume_anomaly: "거래량 이상",
  sector_or_stock_sector_divergence: "업종 대비 괴리",
  five_session_relative_strength: "5거래일 상대강도",
};

const candidateEvidenceLabels = {
  market_anomaly_without_primary_material: "공식 근거 확인 중",
  primary_metadata_only: "공식 문서 메타데이터 확인",
  primary_body_without_supported_facts: "공식 본문 수치 확인 필요",
};

function signedPercent(value) {
  const number = finiteNumber(value);
  if (number === null) return "확인 불가";
  return `${number > 0 ? "+" : ""}${compactNumber(number, 2)}%`;
}

function renderPendingCompanyCandidates(bundle) {
  const pending = bundle.pendingCandidates || [];
  const node = section(
    `검증 대기 후보 ${pending.length}개`,
    `전체 중요 후보 ${bundle.materialCandidateCount || pending.length}개 중 상위 후보입니다. 공식 공시·IR 본문과 수치가 확인되어야 심층분석으로 승격됩니다.`,
  );
  const stack = element("div", "research-stack pending-company-stack");
  pending.forEach((candidate, index) => {
    const details = element("details", "research-card pending-company-card");
    if (index === 0 && !(bundle.profiles || []).length) details.open = true;
    const summary = element("summary");
    const heading = element("span", "research-heading");
    heading.append(element("small", "", [candidate.ticker, `우선순위 ${candidate.selectionScore || 0}점`].filter(Boolean).join(" · ")));
    heading.append(element("strong", "", candidate.companyName || candidate.ticker || "검증 대기 후보"));
    summary.append(
      heading,
      element("span", "pending-status", candidateEvidenceLabels[candidate.evidenceStatus] || "근거 확인 중"),
      element("span", "details-mark", "+"),
    );
    details.append(summary);
    const body = element("div", "research-body");
    const metrics = element("div", "company-metric-grid pending-metric-grid");
    [
      ["1일 수익률", signedPercent(candidate.marketReaction?.return_1d_pct)],
      ["SPY 대비 1일", signedPercent(candidate.marketReaction?.spy_relative_1d_pct)],
      ["5일 수익률", signedPercent(candidate.marketReaction?.return_5d_pct)],
      ["20일 평균 대비 거래량", candidate.marketReaction?.volume_ratio_20d == null ? "확인 불가" : `${compactNumber(candidate.marketReaction.volume_ratio_20d, 2)}배`],
    ].forEach(([label, value]) => {
      const card = element("article", "company-metric-card");
      card.append(element("span", "overview-label", label));
      card.append(element("strong", "company-metric-value", value));
      metrics.append(card);
    });
    body.append(metrics);
    if (candidate.selectionReasons?.length) {
      const tags = element("div", "tag-row");
      candidate.selectionReasons.forEach((reason) => tags.append(element("span", "", candidateReasonLabels[reason] || valueLabel(reason))));
      body.append(tags);
    }
    body.append(element(
      "p",
      "pending-explanation",
      "이 종목은 시장 이상 움직임으로 발견됐지만 아직 장기투자 판단 대상이 아닙니다. 공식 본문에서 사건과 수치가 확인되면 기업의 질·현재 주식의 매력·포트폴리오 적합성을 분리해 분석합니다.",
    ));
    if (candidate.officialEvidence?.length) {
      const links = element("div", "company-source-links");
      candidate.officialEvidence.forEach((evidence, sourceIndex) => {
        if (!evidence.sourceUrl) return;
        const link = element("a", "source-link", evidence.title || `공식 근거 ${sourceIndex + 1}`);
        link.href = evidence.sourceUrl;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        links.append(link);
      });
      if (links.childElementCount) body.append(links);
    }
    details.append(body);
    stack.append(details);
  });
  if (!pending.length) node.append(element("p", "empty-inline", "현재 검증 대기 중인 중요 후보가 없습니다."));
  else node.append(stack);
  return node;
}

function renderCompanyCandidates(bundle) {
  const article = element("article", "report-document company-document");
  article.append(reportHeader({
    eyebrow: "LONG-TERM COMPANY REVIEW",
    title: `${bundle.reportDate} 개별주식 후보`,
    date: bundle.reportDate,
    meta: [`분석 후보 ${bundle.profileCount || 0}개`, "공식 근거 우선", "조건부 판단"],
  }));
  article.append(element(
    "p",
    "company-disclaimer",
    "후보 점수는 매수 신호가 아닙니다. 기업의 질, 현재 주식의 매력, 포트폴리오 적합성을 분리하고 근거가 부족하면 평가를 보류합니다.",
  ));
  article.append(renderPendingCompanyCandidates(bundle));
  const node = section(`분석 카드 ${bundle.profiles?.length || 0}개`, "공식 공시와 정규화된 장기 재무를 기준으로 작성했습니다.");
  const stack = element("div", "research-stack");
  (bundle.profiles || []).forEach((profile, index) => {
    const details = element("details", "research-card company-card");
    if (index === 0) details.open = true;
    const summary = element("summary");
    const heading = element("span", "research-heading");
    heading.append(element("small", "", [profile.ticker, valueLabel(profile.candidateOrigin || "research_candidate")].filter(Boolean).join(" · ")));
    heading.append(element("strong", "", profile.companyName || profile.ticker || "기업 후보"));
    summary.append(heading, element("span", "company-grade", profile.action?.grade || "평가 보류"), element("span", "details-mark", "+"));
    details.append(summary);
    const body = element("div", "research-body");
    if (profile.action?.reason) body.append(element("p", "company-action-summary", profile.action.reason));
    const verdicts = element("div", "company-verdict-grid");
    verdicts.append(
      companyVerdictCard("기업의 질", profile.companyQuality),
      companyVerdictCard("현재 주식의 매력", profile.stockAttractiveness),
      companyVerdictCard("포트폴리오 적합성", profile.portfolioFit),
    );
    body.append(verdicts);
    const metrics = companyMetricCards(profile);
    if (metrics.childElementCount) body.append(metrics);
    if (profile.officialBusinessEvidence?.status === "verified_primary") {
      body.append(element("h4", "", "공식 사업모델 근거"));
      if (profile.officialBusinessEvidence.summary) {
        body.append(element("p", "research-summary", profile.officialBusinessEvidence.summary));
      }
      if (profile.officialBusinessEvidence.issuerExcerpt) {
        body.append(element("p", "company-official-excerpt", profile.officialBusinessEvidence.issuerExcerpt));
        body.append(element(
          "p",
          "research-meta",
          "회사 공시의 사업 설명입니다. 독립 검증된 경쟁우위 판단과는 구분합니다.",
        ));
      }
      if (profile.issuerCompetitiveClaims?.claims?.length) {
        body.append(element("h4", "", "회사가 설명한 경쟁우위 단서"));
        appendTextList(body, profile.issuerCompetitiveClaims.claims, "compact-list");
        body.append(element(
          "p",
          "research-meta",
          "회사 연차보고서의 주장입니다. 고객·가격·점유율·유지율 자료로 독립 검증되기 전에는 해자로 확정하지 않습니다.",
        ));
      }
      if (profile.issuerCompetitiveClaims?.reason) {
        body.append(element("h4", "", profile.issuerCompetitiveClaims.verified ? "해자 정량 검증" : "해자 검증 상태"));
        body.append(element("p", "research-summary", profile.issuerCompetitiveClaims.reason));
      }
      if (profile.managementExecutionEvidence?.reason) {
        body.append(element("h4", "", profile.managementExecutionEvidence.verified ? "경영진 실행력 정량 검증" : "경영진 실행력 검증 상태"));
        body.append(element("p", "research-summary", profile.managementExecutionEvidence.reason));
      }
      if (profile.officialRiskFactors?.excerpt) {
        body.append(element("h4", "", "공식 위험요인"));
        body.append(element("p", "company-official-excerpt", profile.officialRiskFactors.excerpt));
      }
    }
    if (profile.valuationScenarios?.status === "supported_screening_model") {
      body.append(element("h4", "", "약세·기준·강세 가치평가"));
      body.append(element("p", "research-meta", [
        `${profile.valuationScenarios.priceAsOf || "기준일 확인 필요"} 가격 ${formatNumber(profile.valuationScenarios.currentPrice)}`,
        `${profile.valuationScenarios.horizonYears || 5}년`,
        `요구수익률 ${formatNumber(profile.valuationScenarios.requiredReturnPct)}%`,
      ].join(" · ")));
      const scenarioGrid = element("div", "company-scenario-grid");
      (profile.valuationScenarios.scenarios || []).forEach((row) => {
        const card = element("div", "company-scenario-card");
        card.append(
          element("strong", "", valueLabel(row.scenario)),
          element("span", "", `현재가치 ${formatNumber(row.present_value_per_share)}`),
          element("small", "", `매출 ${formatNumber(row.revenue_growth_pct)}% · FCF마진 ${formatNumber(row.fcf_margin_pct)}% · 종착 P/FCF ${formatNumber(row.terminal_price_to_fcf)}배`),
          element("small", "", `현재가 대비 ${formatNumber(row.upside_downside_pct)}%`),
        );
        scenarioGrid.append(card);
      });
      body.append(scenarioGrid);
      body.append(element(
        "p",
        "research-summary",
        `현재 가격이 요구하는 FCF 성장률 ${formatNumber(profile.valuationScenarios.impliedFcfGrowthPct)}% · 기준 시나리오 ${formatNumber(profile.valuationScenarios.baseCaseFcfGrowthPct)}%`,
      ));
      appendTextList(body, profile.valuationScenarios.assumptionLimits, "compact-list");
    }
    [["확인 조건", profile.action?.confirmationConditions], ["무효화 조건", profile.action?.invalidationConditions], ["다음 필요 근거", profile.action?.nextRequiredEvidence]].forEach(([title, values]) => {
      if (!values?.length) return;
      body.append(element("h4", "", title));
      appendTextList(body, values, "compact-list");
    });
    if (profile.scorecard?.reason) {
      body.append(element("h4", "", "점수 상태"));
      body.append(element("p", "research-summary", `${profile.scorecard.scoredPoints || 0}/${profile.scorecard.scoredMax || 0}점 범위만 계산 · ${profile.scorecard.reason}`));
    }
    if (profile.sourceUrls?.length) {
      const links = element("div", "company-source-links");
      profile.sourceUrls.forEach((url, sourceIndex) => {
        const link = element("a", "source-link", `공식 근거 ${sourceIndex + 1}`);
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        links.append(link);
      });
      body.append(links);
    }
    details.append(body);
    stack.append(details);
  });
  node.append(stack);
  article.append(node);
  article.append(element("footer", "report-footer", "개별주식 후보는 공개·공유용 장기투자 검토 자료이며 자동 주문이나 개인화된 매수 지시를 생성하지 않습니다."));
  return article;
}

function currentItems() {
  if (state.view === "brief") return state.payload?.reports || [];
  if (state.view === "intelligence") return state.payload?.intelligence || [];
  if (state.view === "companies") return state.payload?.companies || [];
  if (state.view === "telegram") return state.payload?.telegram ? [state.payload.telegram] : [];
  return state.payload?.worldMemory ? [state.payload.worldMemory] : [];
}

function itemId(item) {
  return ["world-memory", "telegram"].includes(state.view) ? "current" : item.reportDate;
}

function itemTitle(item) {
  if (state.view === "brief") return item.title;
  if (state.view === "intelligence") return `${item.reportDate} 전체 인텔리전스`;
  if (state.view === "companies") return `${item.reportDate} 개별주식 후보`;
  if (state.view === "telegram") return "최신 텔레그램 모니터";
  return item.report?.title || "현재 월드 메모리";
}

function itemSummary(item) {
  if (state.view === "brief") return item.executiveSummary?.[0] || "요약 없음";
  if (state.view === "intelligence") return item.market?.regime?.summary || `${item.events?.selectedCount || 0}개 이벤트`;
  if (state.view === "companies") return `${item.profileCount || 0}개 심층분석 · ${item.pendingCount || 0}개 검증 대기`;
  if (state.view === "telegram") return `${item.eventClusterCount || 0}개 사건 · ${item.representedChannelCount || 0}개 채널`;
  return item.report?.summary || "월드 메모리 스냅샷";
}

function searchableText(item) {
  if (state.view === "brief") {
    return [item.reportDate, item.title, ...(item.executiveSummary || []), ...(item.marketFindings || []).flatMap((value) => [value.title, value.body]), ...(item.analystResearch || []).flatMap((value) => [value.publisher, value.title, ...(value.tickers || []), ...(value.sectors || [])])].join(" ").toLowerCase();
  }
  if (state.view === "intelligence") {
    return [item.reportDate, item.market?.regime?.label, item.market?.regime?.summary, ...(item.market?.topRisks || []), ...(item.events?.items || []).flatMap((value) => [value.title, ...(value.topicTags || [])]), ...(item.continuity?.activeEntries || []).map((value) => value.title)].join(" ").toLowerCase();
  }
  if (state.view === "companies") {
    return [item.reportDate, ...(item.profiles || []).flatMap((value) => [value.ticker, value.companyName, value.action?.grade, value.action?.reason, value.companyQuality?.label, value.stockAttractiveness?.label]), ...(item.pendingCandidates || []).flatMap((value) => [value.ticker, value.companyName, value.evidenceStatus, ...(value.selectionReasons || [])])].join(" ").toLowerCase();
  }
  if (state.view === "telegram") {
    return [item.generatedAt, ...(item.clusters || []).flatMap((value) => [value.title, value.eventType, ...(value.channels || [])])].join(" ").toLowerCase();
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
  const documentNode = state.view === "brief"
    ? renderBrief(item)
    : state.view === "intelligence"
      ? renderIntelligence(item)
      : state.view === "companies"
        ? renderCompanyCandidates(item)
      : state.view === "telegram"
        ? renderTelegram(item)
        : renderWorldMemory(item);
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
    button.append(element("time", "", ["world-memory", "telegram"].includes(state.view) ? formatDateTime(item.generatedAt) : formatDate(item.reportDate)));
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
