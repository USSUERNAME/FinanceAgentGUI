import { normalizePortfolioWidgetDataFiles } from "./functionSpecParser.js";
import { cleanPortfolioWidgetText } from "./widgetIdentity.js";
import { portfolioWidgetRelationLabel } from "./widgetRelations.js";

function fallbackPortfolioModeMeta(mode = "") {
  const id = String(mode || "asset-management").trim() || "asset-management";
  return {
    id,
    label: id === "strategy-research" ? "전략 연구" : "자산 관리",
    actionGuidance:
      id === "strategy-research"
        ? "전략 연구는 실제 투자금보다 비율, 가정, 데이터 출처, 비교 조건을 우선 확인해야 합니다."
        : "실제 자산 데이터는 금액, 수량, 원금, 평가금액, 데이터 출처를 우선 확인해야 합니다.",
  };
}

function portfolioPromptModeMeta(mode = "", explicitModeMeta = null) {
  return explicitModeMeta && typeof explicitModeMeta === "object" ? explicitModeMeta : fallbackPortfolioModeMeta(mode);
}

function portfolioPromptIsAssetMode(modeMeta = {}, assetCanvasModeId = "asset-management") {
  return modeMeta.id === assetCanvasModeId;
}

function portfolioPromptCurrentDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function portfolioPromptAssetHistoryActionExample({ canvasId = "", canvasMode = "asset-management" } = {}) {
  return {
    action: "create_widget",
    actionId: "render_portfolio_artifact",
    canvasId,
    canvasMode,
    classification: {
      taskFamily: "asset_management",
      operation: "create_widget",
      analysisKind: "asset_cost_basis_history",
      isMultiplePeriodComparison: false,
      isMultipleAssetComparison: false,
      comparisonAxis: "",
      primaryOutput: "asset_history_chart",
      requiresMarketData: false,
      requiresBacktestExecution: false,
      confidence: "high",
    },
    periodComparison: {
      isMultiplePeriodComparison: false,
      periods: [],
      confidence: "",
      note: "",
    },
    widget: {
      title: "보유 자산 과거 내역",
      kind: "보유 자산 과거 내역 차트",
      visualType: "price-history",
      summary: "토스 증권 Open API 동기화 스냅샷의 투자 원금 흐름을 표시합니다.",
      dataset: [],
      chartSpec: {
        type: "price-history",
        engine: "lightweight-charts",
        chartType: "area",
        role: "asset_cost_basis_history",
        dataProvider: "토스 증권 Open API",
        source: "tossinvest-position-reconstruction",
        query: {
          startDate: "",
          startMode: "first_trade",
          endDate: "",
          endMode: "latest",
          timeframe: "1d",
          currency: "KRW",
        },
      },
      scenarioId: "portfolio_scenario_root",
      graphRole: "process_node",
      outputRole: "asset_history",
      badges: ["Lightweight Charts"],
      dependsOn: [],
      derivedFrom: [],
      updatePolicy: "auto",
      w: 3,
      h: 3,
    },
  };
}

const DEFAULT_USER_WIDGET_PROMPT_LIMIT = 1200;
const BACKTEST_MATRIX_CONTEXT_PROMPT_LIMIT = 750000;

export function buildPortfolioWidgetAgentPrompt(
  {
    action = "create",
    widget,
    prompt,
    canvasId = "",
    canvasName = "",
    canvasMode = "",
    requestId = "",
    scenario: requestScenario = null,
    source = "",
    backtestMatrixContext = false,
  },
  { modeMeta: explicitModeMeta = null, assetCanvasModeId = "asset-management" } = {}
) {
  const requestLabel = action === "edit" ? "수정" : "생성";
  const safeWidget = widget || {};
  const isEditingFunctionWidget = requestLabel === "수정" && safeWidget.visualType === "function";
  const functionSpecTemplate = isEditingFunctionWidget
    ? safeWidget.functionSpec && typeof safeWidget.functionSpec === "object" && !Array.isArray(safeWidget.functionSpec)
      ? safeWidget.functionSpec
      : {
          language: "portfolio-matrix-dsl",
          version: 1,
          executionMode: "matrix-dsl",
          inputs: ["source_matrix"],
          outputs: ["signal_matrix"],
          program: [],
          dataSources: [],
          riskControls: [],
        }
    : null;
  const promptLimit =
    backtestMatrixContext || source === "backtest-matrix-context"
      ? BACKTEST_MATRIX_CONTEXT_PROMPT_LIMIT
      : DEFAULT_USER_WIDGET_PROMPT_LIMIT;
  const safePrompt = cleanPortfolioWidgetText(prompt || safeWidget.prompt || "", promptLimit);
  const modeMeta = portfolioPromptModeMeta(canvasMode, explicitModeMeta);
  const isAssetMode = portfolioPromptIsAssetMode(modeMeta, assetCanvasModeId);
  const scenario = requestScenario && typeof requestScenario === "object" ? requestScenario : null;
  const currentDate = portfolioPromptCurrentDate();
  return [
    `포트폴리오 위젯 ${requestLabel} 요청입니다.`,
    "",
    "[Canvas]",
    `requestId: ${requestId || ""}`,
    `canvasId: ${canvasId || ""}`,
    `canvasName: ${canvasName || ""}`,
    `canvasMode: ${modeMeta.id} (${modeMeta.label})`,
    `currentDate: ${currentDate}`,
    `modeGuidance: ${modeMeta.actionGuidance}`,
    scenario ? `scenarioRoot: ${scenario.title || "기간 및 타임프레임"} / runs=${Array.isArray(scenario.runs) ? scenario.runs.length : 0}` : "",
    "",
    "[Widget Request]",
    `id: ${safeWidget.id || ""}`,
    `displayId: ${safeWidget.displayId || ""}`,
    `title: ${safeWidget.title || "새 포트폴리오 위젯"}`,
    `kind: ${safeWidget.kind || "프롬프트 위젯"}`,
    `visualType: ${safeWidget.visualType || ""}`,
    isEditingFunctionWidget
      ? `currentFunctionSpec: ${JSON.stringify(functionSpecTemplate)}`
      : "",
    `layout: ${safeWidget.w || 1}x${safeWidget.h || 1} @ (${Number(safeWidget.x || 0) + 1}, ${Number(safeWidget.y || 0) + 1})`,
    "",
    "[User Widget Prompt]",
    safePrompt || "사용자가 빈 위젯을 만들었습니다. 필요한 질문과 최소 위젯 초안을 제안해 주세요.",
    "",
    "이 요청을 현재 포트폴리오 작업실의 Context Packet과 함께 해석하세요.",
    "Portfolio widget developer contract는 docs/portfolio-widgets.md 입니다. 그 문서를 런타임 기준처럼 따르세요.",
    "중요: 로컬 GUI는 자연어 키워드로 widget.visualType, dataset, functionSpec, 의존성 그래프를 추정하지 않습니다. 의미 분류와 실행 계획은 반드시 아래 classification/periodComparison/scenario/widget 필드에 명시하세요.",
    "classification에는 taskFamily, operation, analysisKind, isMultiplePeriodComparison, isMultipleAssetComparison, comparisonAxis, primaryOutput, requiresMarketData, requiresBacktestExecution, confidence를 넣으세요. 예: primaryOutput='backtest_line_chart' | 'metrics_table' | 'source_table' | 'function_widget' | 'markdown' | 'allocation_chart' | 'asset_history_chart' | 'position_status_chart' | 'seasonal_comparison_chart'.",
    "명시되지 않은 widget.visualType/dataset/functionSpec은 실행 가능한 값으로 추론되지 않습니다. 모든 새 widget은 canonical visualType(table/function/line/price-history/position-status/seasonal-comparison/metrics-table/markdown/allocation/checklist)을 반드시 가져야 하며, memo/프롬프트 위젯 fallback은 계약 오류로 거절됩니다.",
    "확신이 없으면 visualType='checklist' 또는 visualType='markdown' 위젯으로 보류하고 필요한 확인 질문을 남기세요.",
    "절차형 요청은 하나의 거대한 위젯으로 압축하지 말고 action='create_widget_flow'와 widgets 배열로 table/function/chart 노드를 나누세요.",
    "응답 JSON의 canvasId는 위 [Canvas]의 canvasId와 같아야 하며, 다른 캔버스의 위젯을 추정해서 수정하지 마세요.",
    "위젯을 수정하는 경우 내부 id와 displayId를 모두 참고하세요. 내부 id는 실제 적용용, displayId는 사용자가 화면에서 보는 짧은 식별자입니다.",
    isEditingFunctionWidget
      ? "현재 대상은 기존 함수 위젯입니다. action='update_widget'을 사용하고 같은 widgetId/widgetDisplayId를 유지하세요. widget.visualType='function'과 widget.functionSpec.language='portfolio-matrix-dsl', executionMode='matrix-dsl', outputs=['signal_matrix'], program=[...] 전체 배열을 반드시 다시 보내세요. 별도 문서를 만들라는 요청이 아니면 markdown 위젯이나 markdown 본문으로 우회하지 마세요."
      : "",
    "이 위젯이 다른 위젯의 dataset/chartSpec/summary에서 파생되면 widget.dependsOn과 widget.derivedFrom을 반드시 선언하세요.",
    "관계 위젯은 입력 위젯 변경 시 stale 상태가 되며 updatePolicy에 따라 사용자가 갱신할 수 있습니다. 표/차트는 auto 또는 manual, 투자 해석은 manual 또는 confirm을 권장합니다.",
    isAssetMode
      ? "이 캔버스는 자산 관리 모드입니다. 실제 자산 데이터, 투자금, 원금, 평가금액, 수량, 손익, 데이터 출처를 가정 없이 확인하고 추적해야 합니다."
      : "이 캔버스는 전략 연구 모드입니다. 실제 투자금은 선택 사항이며, 전략 포트폴리오별 비율, 가정, 백테스트 조건, yfinance 및 사용자 업로드 CSV 같은 외부 데이터 출처를 분리해 다루세요.",
    isAssetMode
      ? ""
      : "전략 연구 캔버스에는 이동 불가능한 단일 시나리오 루트가 이미 있습니다. 새 scenario 위젯을 만들지 말고 모든 프로세스 위젯은 scenarioId='portfolio_scenario_root'를 유지하세요.",
    isAssetMode
      ? ""
      : "사용자 요청을 처리하기 전에 내부적으로 '복수의 기간 비교인가'를 Y/N으로 분류하세요. 추론 과정은 출력하지 말고 JSON의 periodComparison.isMultiplePeriodComparison에만 결과를 남기세요.",
    isAssetMode
      ? ""
      : "사용자 요청을 처리하기 전에 내부적으로 '복수 자산/ETF/전략 포트폴리오 후보의 독립 비교인가'를 Y/N으로 분류하세요. 추론 과정은 출력하지 말고 classification.isMultipleAssetComparison에만 결과를 남기세요.",
    isAssetMode
      ? ""
      : "periodComparison.isMultiplePeriodComparison=true이면 top-level periodComparison.periods와 top-level scenario.runs에 같은 실행 구간을 반드시 넣으세요. 각 run은 runId, label, period:'custom', startDate:'YYYY-MM-DD', endDate:'YYYY-MM-DD', timeframe:'1d'를 가져야 합니다. startDate/endDate 없이 label만 만들거나 period:'1y'로 대체하지 마세요.",
    isAssetMode
      ? ""
      : "classification.isMultipleAssetComparison=true인 백테스트 비교는 각 후보를 별도 source_matrix table 위젯으로 만들고, 하나의 backtest_result line 위젯이 그 source 위젯들을 모두 dependsOn으로 참조해야 합니다. source table 하나에 50/50처럼 여러 종목을 넣으면 독립 비교가 아니라 혼합 포트폴리오입니다.",
    isAssetMode
      ? ""
      : `금년, 이번주, 최근 N거래일, 3월 3일부터 3월 8일까지 같은 상대/부분 기간은 위 currentDate(${currentDate}) 기준으로 구체 startDate/endDate를 계산하세요. 날짜 경계를 확정할 수 없으면 백테스트 line/metrics 실행 위젯을 만들지 말고 확인 질문이나 마크다운/체크리스트로 보류하세요.`,
    isAssetMode
      ? ""
      : "예: 2020년 vs 2021년은 scenario.runs=[{runId:'2020Y',label:'2020년',period:'custom',startDate:'2020-01-01',endDate:'2020-12-31',timeframe:'1d'}, {runId:'2021Y',label:'2021년',period:'custom',startDate:'2021-01-01',endDate:'2021-12-31',timeframe:'1d'}] 입니다. '이번주 5거래일 vs 3월 3일~3월 8일'도 같은 방식으로 두 run을 명시해야 합니다.",
    isAssetMode
      ? ""
      : "전략 연구 위젯의 데이터 흐름은 scenario_grid → source_matrix → signal_matrix → backtest_result → metrics 입니다. 포트폴리오 table은 outputRole='source_matrix', 함수 위젯은 outputRole='signal_matrix', 백테스트 line은 outputRole='backtest_result', 지표 표는 outputRole='metrics'로 두세요.",
    isAssetMode
      ? ""
      : "기간별 수익률 비교 요청은 계산 전 metrics-table이 아니라 실행 가능한 백테스트 line 위젯입니다. 사용자 요청에 '지표 표', 'CAGR/MDD/Sharpe', '테이블'이 명시된 경우에만 별도 metrics-table을 만들고, 그때도 가능하면 백테스트 line 위젯에 dependsOn으로 연결하세요.",
    isAssetMode
      ? ""
      : "함수 위젯은 CSV 파일 자체를 백테스트에 제출하는 서류함이 아니라, 시나리오 격자 위에서 신호/목표비중 행렬을 산출하는 프로세스입니다. 원문 CSV는 provenance/dataSources로 보존하고, widget.signalMatrix에는 role/status/dimensions/schema/rows를 남기며, 백테스트 위젯은 완성된 source_matrix와 signal_matrix를 입력으로 받는 구조로 선언하세요.",
    isAssetMode
      ? "사용자가 포트폴리오 보유 종목/비중/수량/평가금액을 입력하면 기본적으로 테이블 위젯을 생성하거나 갱신합니다. 자산 업데이트 요청이면 기존 자산 테이블을 업데이트할지 새 스냅샷 테이블을 만들지 판단하되, 기존 위젯을 수정하려면 반드시 widgetId 또는 widgetDisplayId를 포함하세요."
      : "사용자가 포트폴리오 종목/비율/전략안을 입력하면 기본적으로 새 전략 포트폴리오 테이블 위젯을 생성합니다. 사용자가 바꾸자, 수정하자, 업데이트하자처럼 기존 위젯 변경을 명시하지 않았다면 기존 전략 테이블을 덮어쓰지 말고 새 포트폴리오 추가로 처리하세요.",
    isAssetMode
      ? "자산 관리 모드에서 명시적 비중 또는 평가금액이 있는 보유 table은 파이/도넛 allocation 위젯의 원본입니다. GUI는 로컬 생성 가능한 table에 대해 파이차트를 자동으로 붙일 수 있으므로, 에이전트는 표와 차트를 같은 위젯으로 합치지 말고 필요하면 별도 allocation 위젯을 dependsOn으로 연결하세요."
      : "",
    isAssetMode
      ? "사용자가 '보유자산 차트', '보유 자산 과거 내역 차트', '보유자산 과거 내역', '투자 원금 히스토리'처럼 동기화된 보유자산 흐름 차트를 요청하면 table/allocation/line/backtest가 아니라 widget.visualType='price-history'를 사용하세요. dataset은 비우고 chartSpec.type='price-history', engine='lightweight-charts', role='asset_cost_basis_history', dataProvider='토스 증권 Open API', source='tossinvest-position-reconstruction', outputRole='asset_history', updatePolicy='auto'를 지정하세요. 날짜가 명시되지 않으면 query.startDate=''와 query.endDate=''로 두어 첫 거래일~최신 시점을 사용합니다."
      : "",
    isAssetMode
      ? "사용자가 '투자 종목 현황', '보유 종목 현황', '보유 종목 비중', '종목 구성', '종목 비율'처럼 조회 종료 기준 보유 종목 구성 위젯을 요청하면 일반 allocation이나 table이 아니라 widget.visualType='position-status'를 사용하세요. dataset은 비우고 chartSpec.type='position-status', engine='react-css', role='investment_position_status', dataProvider='토스 증권 Open API', source='tossinvest-position-reconstruction', outputRole='position_status', updatePolicy='auto'를 지정하세요. 날짜가 명시되지 않으면 query.endDate=''로 두어 최신 시점을 사용하고 query.view는 기본 'bar'입니다."
      : "",
    isAssetMode
      ? "사용자가 '시즌별 비교', '연도별 수익률 비교', 'YTD 수익률 비교', '각 해 수익률을 겹쳐 보기'처럼 동기화된 보유자산 스냅샷의 연간 수익률 오버레이를 요청하면 widget.visualType='seasonal-comparison'을 사용하세요. dataset은 비우고 chartSpec.type='seasonal-comparison', engine='lightweight-charts', chartType='line', role='annual_return_overlay', dataProvider='토스 증권 Open API', source='tossinvest-position-reconstruction', outputRole='seasonal_comparison', updatePolicy='auto'를 지정하세요. 기본 query는 startDate='', startMode='first_trade', endDate='', endMode='latest', timeframe='1d', currency='KRW', returnMode='year_to_date'입니다."
      : "",
    "사용자의 목적, 투자 기간, 손실 감내도, 데이터 공백을 먼저 확인하고, 현대 포트폴리오 이론, 분산, 리스크 예산, 벤치마크 비교, 비용, 세금, 유동성 관점을 반영해 주세요.",
    "메인 캔버스에 들어갈 위젯은 단일 기능이어야 합니다. 차트 위젯은 차트 데이터와 차트 스펙만, 설명 위젯은 짧은 설명만, 체크리스트 위젯은 확인 항목만 담아 주세요.",
    "데이터 설명, 웹 검색 결과, 투자 해설, 조사 메모처럼 문서형 문자열을 보여줘야 하면 새 widget.kind='마크다운 위젯', widget.visualType='markdown' 위젯을 만드세요. 기존 table/function/line/metrics 위젯을 markdown으로 변환하지 마세요.",
    "마크다운 위젯은 입력값과 리턴값이 없는 문서 위젯입니다. widget.markdown에는 본문 문자열을 넣고, 선택적 ECharts는 widget.echarts=[{title, body, option}]에 넣으세요. dataset, functionSpec, signalMatrix, dependsOn, derivedFrom, nextActions는 비워 두고 outputRole='note'를 사용하세요.",
    "ECharts option은 JSON으로 직렬화 가능한 값만 사용하세요. 배열형 data tooltip에서 값 인덱스를 표시할 때는 {value[0]}, {value[1]}, {value[2]}처럼 쓰세요. GUI 렌더러가 이를 안전한 runtime formatter로 변환합니다.",
    "백테스트 결과 위젯이 이미 Context Packet에 있는 상태에서 추가 계산/해석을 요청받으면, 표준 백테스트 평가 지표(CAGR/MDD/Sharpe/Sortino/Calmar/Ulcer/UPI/BETA 등) 표만 metrics-table로 만드세요. 그 외 효율적 프론티어, 위험-수익 산점도, 롤링 상관, 구간별 손익, 드로다운 분포, 민감도/시나리오 해석은 markdown 위젯으로 만들고 widget.markdown에는 마크다운 표를, widget.echarts 또는 markdown의 fenced echarts/chart JSON에는 line/scatter/bar 등 ECharts option을 적극적으로 넣으세요. 이 문서형 후속 분석은 백테스트 위젯을 컨텍스트로 읽어 작성하므로 dependsOn/derivedFrom/nextActions는 비워 둬도 됩니다.",
    "Context Packet에 백테스트 위젯의 존재와 backtestMatrixContext 핸들이 있지만 필요한 수열이 샘플뿐이면 값을 추정하지 마세요. 먼저 actionId='request_backtest_matrix_context' portfolio_widget_action을 내고 widgetId 또는 widgetDisplayId와 matrixRequest를 지정하세요. matrixRequest는 transform(raw/returns/drawdown/monthly_returns/yearly_returns), frequency(daily/monthly/yearly), seriesNames, assets/tickers, startDate, endDate, maxPoints, nextPrompt를 지원합니다.",
    "차트 위젯에는 긴 본문, 요구사항 목록, 검증 목록을 섞지 말고 필요한 설명은 summary 한 문장 이하로 제한하세요.",
    "종목 목록, 균등배분 포트폴리오 표시, 단순 보유 구성 표시는 별도 차트 요청이 아니라면 widget.visualType을 table로 두고 widget.dataset에 label/ticker/name과 weight/value를 넣으세요.",
    "사용자가 어떤 조건에서 사고 어떤 조건에서 파는지, 매수/매도/리밸런싱 규칙, 매매전략, 함수 위젯을 요청하면 widget.visualType='function', widget.kind='함수 위젯'으로 만들고 widget.functionSpec에 안전한 portfolio-matrix-dsl program을 넣으세요. kind='함수 위젯' 라벨만 붙은 markdown은 함수 위젯이 아닙니다. 임의 JS/Python 코드를 실행 대상으로 만들지 말고 검토 가능한 행렬 변환 사양으로 저장하세요.",
    "함수 위젯은 docs/portfolio-widgets.md의 Function Widget v2 계약만 사용하세요: functionSpec.language='portfolio-matrix-dsl', version=1, executionMode='matrix-dsl', outputs=['signal_matrix'], program=[indicator/rolling/rank/swap/portfolio_swap/allocation_event/rebalance/dca/contribution/rule/emit]. functionSpec.program 배열은 필수입니다.",
    "RSI 20/80 같은 지표 전략은 가능하면 portfolio-matrix-dsl로 표현하세요. 예: program=[{op:'indicator',name:'rsi',period:14,field:'close',outputField:'rsi'}, {op:'rule',when:'rsi < 20',emit:{field:'target_weight',value:1}}, {op:'rule',when:'rsi > 80',emit:{field:'target_weight',value:0}}].",
    "N개월 뒤 한 종목을 다른 종목으로 교체하는 요청은 함수 위젯에서 스왑 의도만 선언하세요. 예: program=[{op:'swap',fromAsset:'META',toAsset:'LLY',effective:{anchor:'run_start',offsetMonths:6,snap:'next_trading_day'},weightPolicy:'preserve_value'}]. yfinance 조회, 거래일 확정, NAV 계산은 백테스트 실행 위젯이 담당합니다.",
    "'3개월 뒤 A를 B로, 다시 6개월 뒤 B를 C로'처럼 다시/그 뒤/이후 표현이 있으면 두 번째 offsetMonths는 실행 시작 기준 9개월입니다. 사용자가 명시적으로 '실행 시작 6개월차'라고 할 때만 offsetMonths:6을 쓰세요.",
    "조건이 충족되면 포트폴리오 A 전체를 포트폴리오 B 비중으로 바꾸는 요청은 단일 종목 swap으로 축소하지 말고 portfolio_swap을 쓰세요. 예: program=[{op:'indicator',name:'rsi',period:14,field:'close',outputField:'rsi'}, {op:'portfolio_swap',when:'rsi < 40',fromLabel:'A 공격 포트폴리오',toLabel:'B 방어 포트폴리오',targetWeights:{TLT:0.6,GLD:0.25,SHY:0.15}}]. 6개월 뒤 전환은 when:'months_since_run_start >= 6'처럼 런타임 시간 필드를 사용하세요. 첫 버전은 조건이 처음 참이 된 뒤 B로 전환해 유지하는 one-way 스왑입니다.",
    "DCA/적립식/매월 납입/분할매수 요청은 함수 위젯에서 납입 규칙만 선언하세요. 예: program=[{op:'dca',amount:1000,frequency:'monthly',dayOfMonth:1,targetWeights:{QQQ:0.7,TLT:0.3}}]. targetWeights가 없으면 입력 포트폴리오 비중으로 납입하고, 실제 납입일 확정/현금흐름/IRR/TWR 계산은 백테스트 실행 위젯이 담당합니다.",
    "10%p 이탈, 허용 밴드 초과, 목표 비중 대비 drift 조건 리밸런싱은 legacy threshold_rebalance가 아니라 program=[{op:'rebalance',method:'threshold_band',threshold:0.10,assets:['QQQ','QLD'],target:'target_weights'}]로 표현하세요.",
    "월 1회 또는 매월 목표비중 리밸런싱은 legacy periodic_rebalance가 아니라 program=[{op:'rebalance',method:'periodic',frequency:'monthly',target:'target_weights'}]로 표현하세요.",
    "strategy-dsl, signal-rules, periodic_rebalance, threshold_rebalance, supertrend, indicator_signal, external_signal, universe_rotation은 제거된 레거시 경로입니다. 새 액션에 사용하지 마세요.",
    "외부 파일/CSV 기반 전략도 임의 실행 경로로 보내지 말고 portfolio-matrix-dsl의 source/data 계약과 program으로 표현하세요. 지원하지 못하는 데이터 변환은 checklist 또는 markdown으로 실행 불가 사유를 표시하세요.",
    "함수 위젯은 기본적으로 작고 조밀한 규칙 노드입니다. 사용자가 크게 보자고 하지 않았다면 w=1, h=1로 생성하세요.",
    "함수 위젯은 외부 데이터 파일을 입력으로 가질 수 있습니다. TradingView CSV, 엑셀, 사용자 업로드 가격/지표 파일이 필요하거나 첨부된 경우 widget.dataFiles와 widget.functionSpec.dataSources에 name/type/size/source/role/status/requiredColumns/dateColumn/symbolColumn/valueColumn/frequency/timezone/notes를 넣으세요.",
    "리밸런싱 비교 요청은 docs/portfolio-widgets.md의 예제처럼 포트폴리오 table 위젯, 주기별 function 위젯, 결과 line 차트 위젯을 create_widget_flow로 함께 생성하세요.",
    "리밸런싱/백테스트 결과 line 차트에는 종목/비중 holdings dataset을 넣지 마세요. 결과 차트는 chartSpec.xField='date', nextActions=['run_backtest_chart_widget'], dependsOn/derivedFrom 관계만 선언하고, 실행 후 날짜 xLabels와 Buy & Hold/전략별 series를 받습니다.",
    "사용자가 기존 백테스트 결과 위젯(W-005 등)을 업데이트/재실행/새로고침해 달라고 하면 새 위젯, 마크다운, 보고서 패치를 만들지 말고 actionId='run_backtest_chart_widget'과 widgetId 또는 widgetDisplayId만 포함한 portfolio_widget_action을 보내세요. 기간도 함께 바꾸는 요청이면 top-level scenario.runs를 함께 포함하세요.",
    "Buy & Hold는 별도 함수 위젯이 아닙니다. 원본 source_matrix table 위젯을 백테스트 line 차트에 연결하면 GUI가 자동으로 Buy & Hold baseline을 계산합니다. 사용자가 'MACD vs Buy & Hold'처럼 비교를 요청하면 source table 1개 + MACD function 1개 + backtest line 1개만 만들고, Buy & Hold function 위젯은 만들지 마세요.",
    "백테스트 line 차트는 기본적으로 SPY나 KODEX 200 같은 benchmark 비교선을 넣지 않습니다. chartSpec.includeBenchmark=false, chartSpec.benchmarkMode='none', chartSpec.benchmark=''를 기본값으로 두세요. 사용자가 차트 안의 비교선을 명시적으로 요청한 경우에만 benchmarkMode='inline'을 사용합니다.",
    "BETA나 벤치마크 상대 지표가 필요하면 SPY/KODEX 200 등을 차트 비교선으로 넣지 말고 별도 table 위젯(kind='베타 기준 포트폴리오', chartSpec.role='beta_benchmark')으로 만들고, 결과 chartSpec.benchmarkSourceWidgetIds와 betaBenchmarkWidgetIds에 연결하세요.",
    "베타 기준 포트폴리오를 자동 선택해야 하면 미국 상장 주식/ETF의 기본 베타 기준은 SPY입니다. QQQ는 사용자가 나스닥100/기술주/QQQ 기준을 명시했을 때만 쓰고, 원본 포트폴리오가 QQQ라고 해서 QQQ 100% 베타 기준 테이블을 복사해 만들지 마세요.",
    "여러 포트폴리오를 비교 백테스트하라는 요청은 해당 table 위젯들을 dependsOn으로 참조하는 별도 line 차트 위젯을 create_widget 또는 create_widget_flow로 생성하세요. 포트폴리오 table 위젯 자체를 백테스트 차트로 변환하지 마세요.",
    "하나의 포트폴리오를 Buy & Hold와 전략 기반으로 비교하라는 요청은 포트폴리오 table 위젯과 전략 function 위젯을 분리하고, 백테스트 차트 위젯에는 widget.kind='백테스트 비교', widget.visualType='line', widget.nextActions=['run_backtest_chart_widget'], widget.dependsOn=[table 위젯 id, function 위젯 id]를 넣으세요. GUI 실행기는 table을 Buy & Hold로 한 번, functionSpec 전략을 적용해서 한 번 더 계산합니다.",
    "라인/백테스트 차트를 로그 차트로 바꾸라는 요청은 원본 series/data 값을 변환하지 말고 chartSpec.yScale='log'만 설정하세요. 선형축 복귀는 chartSpec.yScale='linear'입니다.",
    "백테스트 평가 지표 표 요청은 widget.kind='백테스트 지표', widget.visualType='metrics-table'로 만들고 chartSpec.metrics rows를 사용하세요. 기본 화면 컬럼 순서는 포트폴리오 | Ending Value | Total Contribution | Cumulative Return | CAGR | MDD | Volatility | Sharpe | Sortino | Calmar | Ulcer | UPI | BETA 입니다. DCA/적립식/납입형 백테스트 지표표는 새 위젯 타입이 아니라 chartSpec.metricProfile='dca'를 쓰고, 백테스트 metrics row에 totalContribution, netProfit, contributionReturn, irr, twr, contributionCount, averageContribution을 넣으면 평가 위젯이 납입형 컬럼을 표시합니다.",
    "metrics-table은 계산 위젯이 아니라 backtest_result line 위젯의 chartSpec.metrics를 표시하는 파생 지표 뷰입니다. 지표표를 수리할 때 새 markdown/report 위젯을 만들지 말고 기존 metrics-table의 dependsOn/chartSpec.metricColumns/status만 유지하거나 갱신하세요.",
    "'백테스트의 테이블 버전', '백테스트 결과를 표로', '벤치마크 테이블'은 종목/비중 table이 아니라 metrics-table 요청입니다. 계산 전 실행 준비표가 필요할 때만 table + run_backtest_chart_widget을 사용하고 결과처럼 보이게 꾸미지 마세요.",
    "",
    "응답 마지막에는 GUI가 실제 위젯을 갱신할 수 있도록 아래 fenced JSON action을 반드시 포함해 주세요.",
    "```portfolio_widget_action",
    JSON.stringify(
      {
        action: "update_widget",
        canvasId: canvasId || "",
        widgetId: safeWidget.id || "",
        widgetDisplayId: safeWidget.displayId || "",
        classification: {
          taskFamily: "portfolio_research",
          operation: requestLabel === "수정" ? "update_widget" : "create_widget",
          analysisKind: "",
          isMultiplePeriodComparison: false,
          isMultipleAssetComparison: false,
          comparisonAxis: "",
          primaryOutput: "",
          requiresMarketData: false,
          requiresBacktestExecution: false,
          confidence: "",
        },
        periodComparison: {
          isMultiplePeriodComparison: false,
          periods: [],
          confidence: "",
          note: "",
        },
        widget: {
          displayId: safeWidget.displayId || "",
          title: safeWidget.title || "새 포트폴리오 위젯",
          kind: safeWidget.kind || "프롬프트 위젯",
          visualType: safeWidget.visualType || "",
          summary: "위젯에 표시할 한 문장 캡션 또는 설명",
          dataset: [],
          chartSpec: {
            type: safeWidget.visualType || "",
            dataset: [],
            yScale: "",
          },
          markdown: "",
          echarts: [],
          functionSpec: functionSpecTemplate,
          signalMatrix: isEditingFunctionWidget
            ? {
                role: "signal_matrix",
                status: "pending-source",
                dimensions: ["runId", "date", "asset", "field"],
                schema: ["runId", "date", "asset", "field", "value", "ruleId", "source"],
                language: "portfolio-matrix-dsl",
                executionMode: "matrix-dsl",
                outputs: ["signal_matrix"],
                program: functionSpecTemplate?.program || [],
                rowCount: 0,
                rows: [],
              }
            : undefined,
          dataFiles: [],
          scenarioId: "portfolio_scenario_root",
          graphRole: "process_node",
          outputRole: "",
          dependsOn: safeWidget.dependsOn || [],
          derivedFrom: safeWidget.derivedFrom || [],
          updatePolicy: safeWidget.updatePolicy || "manual",
          checks: [],
          nextActions: [],
        },
      },
      null,
      2
    ),
    "```",
  ].join("\n");
}

export function buildPortfolioChatActionInstructions(
  contextPacket,
  { modeMeta: explicitModeMeta = null, assetCanvasModeId = "asset-management" } = {}
) {
  const widgets = Array.isArray(contextPacket?.widgets) ? contextPacket.widgets : [];
  const canvas = contextPacket?.canvas && typeof contextPacket.canvas === "object" ? contextPacket.canvas : null;
  const canvasId = canvas?.id || "";
  const modeMeta = portfolioPromptModeMeta(contextPacket?.portfolioMode || canvas?.mode, explicitModeMeta);
  const isAssetMode = portfolioPromptIsAssetMode(modeMeta, assetCanvasModeId);
  const scenario = contextPacket?.scenario && typeof contextPacket.scenario === "object" ? contextPacket.scenario : null;
  const currentDate = portfolioPromptCurrentDate();
  return [
    "[Portfolio Widget Action Contract]",
    canvas ? `현재 캔버스: ${canvas.name || "이름 없는 캔버스"} (${canvas.id || "canvas id 없음"})` : "",
    `현재 캔버스 모드: ${modeMeta.id} (${modeMeta.label})`,
    `현재 날짜: ${currentDate}`,
    "개발자 문서 기준: docs/portfolio-widgets.md. 포트폴리오 위젯 생성/수정은 이 계약과 예제를 우선 따르세요.",
    "중요: 로컬 GUI는 자연어 키워드로 widget.visualType, dataset, functionSpec, 의존성 그래프를 추정하지 않습니다. 의미 분류와 실행 계획은 반드시 portfolio_widget_action JSON의 classification/periodComparison/scenario/widget 필드에 명시하세요.",
    "classification에는 taskFamily, operation, analysisKind, isMultiplePeriodComparison, isMultipleAssetComparison, comparisonAxis, primaryOutput, requiresMarketData, requiresBacktestExecution, confidence를 넣으세요. 예: primaryOutput='backtest_line_chart' | 'metrics_table' | 'source_table' | 'function_widget' | 'markdown' | 'allocation_chart' | 'asset_history_chart' | 'position_status_chart' | 'seasonal_comparison_chart'.",
    "명시되지 않은 widget.visualType/dataset/functionSpec은 실행 가능한 값으로 추론되지 않습니다. 모든 새 widget은 canonical visualType(table/function/line/price-history/position-status/seasonal-comparison/metrics-table/markdown/allocation/checklist)을 반드시 가져야 하며, memo/프롬프트 위젯 fallback은 계약 오류로 거절됩니다.",
    "확신이 없으면 visualType='checklist' 또는 visualType='markdown' 위젯으로 보류하고 필요한 확인 질문을 남기세요.",
    scenario ? `현재 시나리오 루트: ${scenario.title || "기간 및 타임프레임"} / runs=${Array.isArray(scenario.runs) ? scenario.runs.length : 0} / dimensions=${Array.isArray(scenario.dimensions) ? scenario.dimensions.join(", ") : ""}` : "",
    isAssetMode
      ? "자산 관리 모드에서는 실제 투자금, 원금, 평가금액, 수량, 손익, 데이터 출처를 우선 확인하고 추적하세요. 불확실한 값은 초안 또는 확인 필요로 표시하세요."
      : "전략 연구 모드에서는 실제 투자금보다 전략별 비율, 가정, 백테스트 조건, CSV/yfinance 같은 데이터 출처를 우선 다루세요. A/B/C 전략 포트폴리오를 비교 가능한 초안으로 만들 수 있습니다.",
    isAssetMode
      ? ""
      : "전략 연구 캔버스의 노드 출발점은 단일 고정 시나리오 루트입니다. 시나리오를 일반 위젯으로 추가하지 말고, 모든 신규 프로세스 위젯에는 scenarioId='portfolio_scenario_root'와 적절한 outputRole을 남기세요.",
    isAssetMode
      ? ""
      : "사용자 요청을 처리하기 전에 내부적으로 '복수의 기간 비교인가'를 Y/N으로 분류하세요. 추론 과정은 출력하지 말고 portfolio_widget_action JSON의 periodComparison.isMultiplePeriodComparison에만 결과를 남기세요.",
    isAssetMode
      ? ""
      : "사용자 요청을 처리하기 전에 내부적으로 '복수 자산/ETF/전략 포트폴리오 후보의 독립 비교인가'를 Y/N으로 분류하세요. 추론 과정은 출력하지 말고 portfolio_widget_action JSON의 classification.isMultipleAssetComparison에만 결과를 남기세요.",
    isAssetMode
      ? ""
      : "periodComparison.isMultiplePeriodComparison=true이면 top-level periodComparison.periods와 top-level scenario.runs에 같은 실행 구간을 반드시 넣으세요. 각 run은 runId, label, period:'custom', startDate:'YYYY-MM-DD', endDate:'YYYY-MM-DD', timeframe:'1d'를 가져야 합니다. startDate/endDate 없이 label만 만들거나 period:'1y'로 대체하지 마세요.",
    isAssetMode
      ? ""
      : "classification.isMultipleAssetComparison=true인 백테스트 비교는 각 후보를 별도 source_matrix table 위젯으로 만들고, 하나의 backtest_result line 위젯이 그 source 위젯들을 모두 dependsOn으로 참조해야 합니다. source table 하나에 50/50처럼 여러 종목을 넣으면 독립 비교가 아니라 혼합 포트폴리오입니다.",
    isAssetMode
      ? ""
      : `금년, 이번주, 최근 N거래일, 3월 3일부터 3월 8일까지 같은 상대/부분 기간은 현재 날짜(${currentDate}) 기준으로 구체 startDate/endDate를 계산하세요. 날짜 경계를 확정할 수 없으면 백테스트 line/metrics 실행 위젯을 만들지 말고 확인 질문이나 마크다운/체크리스트로 보류하세요.`,
    isAssetMode
      ? ""
      : "예: 'QQQ의 2020년 수익과 2021년 수익 비교'는 scenario.runs를 2020-01-01~2020-12-31, 2021-01-01~2021-12-31 두 실행으로 바꾸고, source_matrix table → backtest_result line 위젯을 create_widget_flow로 만드세요.",
    isAssetMode
      ? ""
      : "전략 연구의 일방향 산출물 역할은 source_matrix, signal_matrix, backtest_result, metrics 입니다. 데이터 요구가 거꾸로 흐르지 않도록 백테스트 위젯은 원본 파일을 요구하지 말고 source_matrix와 signal_matrix 준비 상태를 참조하세요.",
    isAssetMode
      ? ""
      : "수익률 비교만 요청받았는데 아직 계산된 chartSpec.metrics가 없다면 metrics-table 위젯을 단독 생성하지 마세요. 먼저 visualType='line', kind='백테스트 비교', outputRole='backtest_result', nextActions=['run_backtest_chart_widget'] 위젯을 만들고 yfinance 실행으로 값을 채우게 하세요.",
    isAssetMode
      ? "포트폴리오 보유 데이터가 입력되면 기본 산출물은 테이블 위젯입니다. 자산 업데이트/갱신 요청에서는 기존 보유 테이블 업데이트와 새 스냅샷 테이블 생성을 상황에 따라 고르되, 기존 위젯을 고칠 때는 반드시 widgetId 또는 widgetDisplayId를 포함하세요."
      : "전략 연구 모드에서 포트폴리오 데이터가 입력되면 기본 산출물은 새 테이블 위젯입니다. 사용자가 바꾸자/수정/업데이트를 명시하지 않으면 기존 위젯 변경이 아니라 새 전략 포트폴리오 추가로 간주하고 create_widget을 사용하세요.",
    isAssetMode
      ? "자산 관리 모드의 기본 시각화는 파이/도넛 allocation 위젯입니다. 명시적 weight/비중/percent/ratio 또는 평가금액/marketValue/amount/value가 있는 table은 별도 allocation 위젯으로 파생될 수 있지만, 티커 이름만 있는 목록에서 비중을 꾸며내지는 마세요."
      : "",
    isAssetMode
      ? "사용자가 '보유자산 차트', '보유 자산 과거 내역 차트', '보유자산 과거 내역', '투자 원금 히스토리'처럼 동기화된 보유자산 흐름 차트를 요청하면 table/allocation/line/backtest가 아니라 widget.visualType='price-history'를 사용하세요. dataset은 비우고 chartSpec.type='price-history', engine='lightweight-charts', role='asset_cost_basis_history', dataProvider='토스 증권 Open API', source='tossinvest-position-reconstruction', outputRole='asset_history', updatePolicy='auto'를 지정하세요. 날짜가 명시되지 않으면 query.startDate=''와 query.endDate=''로 두어 첫 거래일~최신 시점을 사용합니다."
      : "",
    isAssetMode
      ? "사용자가 '투자 종목 현황', '보유 종목 현황', '보유 종목 비중', '종목 구성', '종목 비율'처럼 조회 종료 기준 보유 종목 구성 위젯을 요청하면 일반 allocation이나 table이 아니라 widget.visualType='position-status'를 사용하세요. dataset은 비우고 chartSpec.type='position-status', engine='react-css', role='investment_position_status', dataProvider='토스 증권 Open API', source='tossinvest-position-reconstruction', outputRole='position_status', updatePolicy='auto'를 지정하세요. 날짜가 명시되지 않으면 query.endDate=''로 두어 최신 시점을 사용하고 query.view는 기본 'bar'입니다."
      : "",
    isAssetMode
      ? "사용자가 '시즌별 비교', '연도별 수익률 비교', 'YTD 수익률 비교', '각 해 수익률을 겹쳐 보기'처럼 동기화된 보유자산 스냅샷의 연간 수익률 오버레이를 요청하면 widget.visualType='seasonal-comparison'을 사용하세요. dataset은 비우고 chartSpec.type='seasonal-comparison', engine='lightweight-charts', chartType='line', role='annual_return_overlay', dataProvider='토스 증권 Open API', source='tossinvest-position-reconstruction', outputRole='seasonal_comparison', updatePolicy='auto'를 지정하세요. 기본 query는 startDate='', startMode='first_trade', endDate='', endMode='latest', timeframe='1d', currency='KRW', returnMode='year_to_date'입니다."
      : "",
    "사용자가 포트폴리오 위젯, 차트, 표, 색상, 데이터셋, 크기, 제목, 본문, 시각화 방식을 만들거나 수정해 달라고 하면 설명만 하지 말고 응답 끝에 반드시 portfolio_widget_action JSON block을 포함하세요.",
    "현재 캔버스에 위젯이 없어도 생성 요청이면 새 위젯을 만들 수 있는 action을 반드시 포함하세요.",
    "새 위젯 생성은 action=create_widget 또는 actionId=render_portfolio_artifact를 사용하고, canvasId는 현재 캔버스 id와 같아야 합니다. 생성 요청에서는 widgetId를 비워도 됩니다.",
    "한 요청이 여러 단계의 절차를 만들면 action=create_widget_flow와 widgets 배열을 사용하세요. 예: 포트폴리오 table → 1개월 function → 3개월 function → 결과 line chart.",
    "사용자가 캔버스 전체 최신 정보 반영, yfinance 재조회, 새로고침을 요청하면 새 위젯을 만들거나 첫 번째 위젯을 덮어쓰지 말고 actionId='refresh_canvas_latest_data'를 제안하세요. GUI는 yfinance 기반 위젯을 Context Packet의 canvasRefresh.dependencyOrder 순서로 실행합니다.",
    "사용자가 기존 백테스트 결과 위젯(W-005 등)을 업데이트/재실행/새로고침해 달라고 하면 새 위젯, 마크다운, 보고서 패치를 만들지 말고 actionId='run_backtest_chart_widget'과 widgetId 또는 widgetDisplayId만 포함한 portfolio_widget_action을 보내세요. 기간도 함께 바꾸는 요청이면 top-level scenario.runs를 함께 포함하세요.",
    "widgetId 또는 widgetDisplayId가 명확하지 않은 update_widget/update_current_widget은 기존 위젯 수정으로 처리되지 않습니다. 대상이 불명확한 새 표/차트/분석 결과는 create_widget으로 보내세요.",
    "portfolio_widget_action에는 가능한 경우 canvasId, widgetId, widgetDisplayId를 함께 넣으세요.",
    "사용자가 위젯 삭제를 요청하면 action='delete_widget' 또는 actionId='delete_portfolio_widget'을 사용하고, 대상 widgetId 또는 widgetDisplayId를 반드시 넣으세요.",
    "삭제 대상 위젯을 참조하는 하위 위젯이 있으면 즉시 삭제 액션을 보내지 말고, 어떤 위젯들이 영향을 받는지 말한 뒤 '진짜로 지울건가요?'라고 확인하세요. 사용자가 확인한 뒤에는 delete_widget action에 confirmed=true를 포함하세요.",
    "각 위젯은 단일 기능이어야 합니다. 차트 위젯은 chartSpec/dataset 중심, 설명 위젯은 summary 중심, 체크리스트 위젯은 checks 중심으로만 갱신하세요.",
    "데이터 설명, 웹 검색 결과, 투자 해설, 조사 메모처럼 문서형 문자열을 보여줘야 하면 새 widget.kind='마크다운 위젯', widget.visualType='markdown' 위젯을 만드세요. 기존 table/function/line/metrics 위젯을 markdown으로 변환하지 마세요.",
    "마크다운 위젯은 입력값과 리턴값이 없는 문서 위젯입니다. widget.markdown에는 본문 문자열을 넣고, 선택적 ECharts는 widget.echarts=[{title, body, option}]에 넣으세요. dataset, functionSpec, signalMatrix, dependsOn, derivedFrom, nextActions는 비워 두고 outputRole='note'를 사용하세요.",
    "ECharts option은 JSON으로 직렬화 가능한 값만 사용하세요. 배열형 data tooltip에서 값 인덱스를 표시할 때는 {value[0]}, {value[1]}, {value[2]}처럼 쓰세요. GUI 렌더러가 이를 안전한 runtime formatter로 변환합니다.",
    "백테스트 결과 위젯이 이미 Context Packet에 있는 상태에서 추가 계산/해석을 요청받으면, 표준 백테스트 평가 지표(CAGR/MDD/Sharpe/Sortino/Calmar/Ulcer/UPI/BETA 등) 표만 metrics-table로 만드세요. 그 외 효율적 프론티어, 위험-수익 산점도, 롤링 상관, 구간별 손익, 드로다운 분포, 민감도/시나리오 해석은 markdown 위젯으로 만들고 widget.markdown에는 마크다운 표를, widget.echarts 또는 markdown의 fenced echarts/chart JSON에는 line/scatter/bar 등 ECharts option을 적극적으로 넣으세요. 이 문서형 후속 분석은 백테스트 위젯을 컨텍스트로 읽어 작성하므로 dependsOn/derivedFrom/nextActions는 비워 둬도 됩니다.",
    "Context Packet에 백테스트 위젯의 존재와 backtestMatrixContext 핸들이 있지만 필요한 수열이 샘플뿐이면 값을 추정하지 마세요. 먼저 actionId='request_backtest_matrix_context' portfolio_widget_action을 내고 widgetId 또는 widgetDisplayId와 matrixRequest를 지정하세요. matrixRequest는 transform(raw/returns/drawdown/monthly_returns/yearly_returns), frequency(daily/monthly/yearly), seriesNames, assets/tickers, startDate, endDate, maxPoints, nextPrompt를 지원합니다.",
    "차트 위젯을 수정할 때는 긴 본문이나 requirements/checks를 넣지 말고 dataset, chartSpec, visualType, title만 우선 갱신하세요.",
    "매수 조건, 매도 조건, 리밸런싱 규칙, 종목 스왑, 포트폴리오 A/B 스왑, DCA/적립식 납입, 매매전략, 신호 규칙은 함수 위젯입니다. kind='함수 위젯' 라벨만 붙은 markdown은 함수 위젯이 아닙니다. action=create_widget 또는 대상이 명확한 update_widget으로 widget.visualType='function', widget.functionSpec={language:'portfolio-matrix-dsl', version:1, executionMode:'matrix-dsl', inputs:[], outputs:['signal_matrix'], program:[{op:'indicator'|'rolling'|'rank'|'swap'|'portfolio_swap'|'allocation_event'|'rebalance'|'dca'|'contribution'|'rule'|'emit', ...}], dataSources:[], riskControls:[]}를 제공하세요. widget.signalMatrix에는 컴파일 결과나 pending-source 상태의 signal_matrix 계약을 둡니다.",
    "strategy-dsl, signal-rules, periodic_rebalance, threshold_rebalance, supertrend, indicator_signal, external_signal, universe_rotation은 제거된 레거시 경로입니다. 새 액션에 사용하지 마세요.",
    "10%p 이탈, 허용 밴드 초과, 목표 비중 대비 drift 조건 리밸런싱은 program=[{op:'rebalance',method:'threshold_band',threshold:0.10,assets:['QQQ','QLD'],target:'target_weights'}]로 표현하세요.",
    "월 1회 또는 매월 목표비중 리밸런싱은 legacy periodic_rebalance가 아니라 program=[{op:'rebalance',method:'periodic',frequency:'monthly',target:'target_weights'}]로 표현하세요.",
    "N개월 뒤 META를 LLY로 교체 같은 요청은 program=[{op:'swap',fromAsset:'META',toAsset:'LLY',effective:{anchor:'run_start',offsetMonths:6,snap:'next_trading_day'},weightPolicy:'preserve_value'}]처럼 표현하세요. 함수 위젯은 의도만 만들고 가격 조회와 실제 스왑 적용은 백테스트 실행 위젯이 합니다.",
    "'3개월 뒤 A를 B로, 다시 6개월 뒤 B를 C로'처럼 다시/그 뒤/이후 표현이 있으면 두 번째 스왑은 첫 스왑 후 6개월이므로 실행 시작 기준 offsetMonths:9입니다. 사용자가 '실행 시작 6개월차'라고 명시한 경우에만 offsetMonths:6입니다.",
    "조건에 따라 포트폴리오 A에서 포트폴리오 B로 갈아타는 요청은 program=[{op:'portfolio_swap',when:'조건식',fromLabel:'A',toLabel:'B',targetWeights:{...}}]로 표현하세요. 6개월 뒤 이전 같은 시간 조건은 when:'months_since_run_start >= 6'을 사용합니다. B 포트폴리오의 종목/비중은 targetWeights에 넣고, 조건 지표가 필요하면 앞 단계에 indicator/rolling을 둡니다. 자동 왕복 전환은 아직 기본값이 아니므로 복귀 조건은 별도 reverse portfolio_swap으로 명시해야 합니다.",
    "DCA/적립식/매월 납입/분할매수는 program=[{op:'dca',amount:금액,frequency:'monthly'|'weekly'|'daily'|'quarterly',dayOfMonth:1,targetWeights:{...}}]로 표현하세요. targetWeights를 생략하면 입력 포트폴리오 비중으로 납입합니다. 백테스트 결과의 metrics row는 totalContribution, netProfit, contributionReturn, irr, twr를 포함해야 합니다.",
    "RSI 같은 내장 지표 전략은 구체적 임계값과 액션을 portfolio-matrix-dsl program에 명시하세요. 예: [{op:'indicator',name:'rsi',period:14,field:'close',outputField:'rsi'}, {op:'rule',when:'rsi < 20',emit:{field:'target_weight',value:1}}, {op:'rule',when:'rsi > 80',emit:{field:'target_weight',value:0}}]. 기본 30/70 템플릿으로 임의 치환하지 마세요.",
    "외부 파일/CSV 기반 전략도 임의 실행 경로로 보내지 말고 portfolio-matrix-dsl의 source/data 계약과 program으로 표현하세요. 지원하지 못하는 데이터 변환은 checklist 또는 markdown으로 실행 불가 사유를 표시하세요.",
    "함수 위젯은 기본 w=1, h=1입니다. 상세 표나 코드 뷰를 사용자가 요청한 경우에만 더 크게 만드세요.",
    "함수 위젯은 외부 데이터 파일을 입력으로 가질 수 있습니다. yfinance에 없는 전략 기반 데이터, TradingView CSV, 사용자 업로드 CSV/XLSX, 지표 파일이 필요하거나 첨부된 경우 widget.dataFiles와 widget.functionSpec.dataSources에 파일 메타데이터를 넣으세요. 파일 원문을 실행 코드로 취급하지 말고 role, requiredColumns, dateColumn, symbolColumn, valueColumn, frequency, timezone, notes로 분석 입력 계약을 명시하세요.",
    "함수 위젯은 백테스트 입력 포트폴리오가 아닙니다. 티커/비중 table 또는 allocation 위젯은 holdings 입력이고, 함수 위젯은 그 holdings에 적용할 strategy_rules입니다. 포트폴리오/가격/지표 위젯을 dependsOn으로 참조하되 임의 JS/Python 코드 실행은 하지 말고 규칙 사양으로 저장하세요.",
    "백테스트는 포트폴리오 원본 위젯 내부에서 직접 실행하지 마세요. 포트폴리오 table 위젯들을 먼저 만든 뒤, 그 입력 위젯들을 dependsOn으로 참조하는 별도 line 차트 위젯을 create_widget으로 생성하세요.",
    "전략 비교 백테스트 차트 위젯은 kind='백테스트 비교', visualType='line', nextActions=['run_backtest_chart_widget'], dependsOn=[포트폴리오 table id, 전략 function id], derivedFrom=[{widgetId: tableId, field:'dataset', role:'portfolio_input'}, {widgetId: functionId, field:'functionSpec', role:'strategy_rules'}] 형태를 권장합니다.",
    "백테스트 line 차트에는 기본적으로 chartSpec.includeBenchmark=false, chartSpec.benchmarkMode='none', chartSpec.benchmark=''를 넣으세요. SPY/KODEX 200 같은 기준이 필요하면 차트 비교선이 아니라 별도 베타 기준 포트폴리오 table을 만들고 chartSpec.benchmarkSourceWidgetIds/betaBenchmarkWidgetIds로 연결하세요. 차트 안에 비교선을 명시 요청받은 경우에만 benchmarkMode='inline'을 사용하세요.",
    "베타 기준 포트폴리오를 자동 선택해야 하면 미국 상장 주식/ETF의 기본 베타 기준은 SPY입니다. QQQ는 사용자가 나스닥100/기술주/QQQ 기준을 명시했을 때만 쓰고, 원본 포트폴리오가 QQQ라고 해서 QQQ 100% 베타 기준 테이블을 복사해 만들지 마세요.",
    "전략/리밸런싱 비교 line 차트의 X축은 종목이 아니라 날짜입니다. 결과 차트에 holdings dataset을 복사하지 말고 chartSpec.xField='date'와 실행 action/관계만 선언하세요.",
    "Buy & Hold는 별도 함수 위젯으로 만들지 마세요. 기존 source_matrix table 위젯이 백테스트에서 자동 Buy & Hold baseline으로 실행됩니다. 전략 비교에서는 source table + 전략 function + backtest line 관계만 선언하세요.",
    "백테스트 평가 지표를 표로 보여 달라는 요청은 kind='백테스트 지표', visualType='metrics-table' 위젯을 생성하세요. 이미 백테스트 차트 위젯이 있으면 새로 계산하지 말고 그 위젯을 dependsOn으로 참조해 chartSpec.metrics를 표로 렌더링하세요. 기본 컬럼은 포트폴리오 | Ending Value | Total Contribution | Cumulative Return | CAGR | MDD | Volatility | Sharpe | Sortino | Calmar | Ulcer | UPI | BETA 순서입니다. DCA/적립식/납입형 평가표는 chartSpec.metricProfile='dca'를 설정하고 metrics row에 totalContribution, netProfit, contributionReturn, irr, twr, contributionCount, averageContribution을 사용하세요.",
    "metrics-table은 계산 위젯이 아니라 backtest_result line 위젯의 chartSpec.metrics를 표시하는 파생 지표 뷰입니다. 지표표를 수리할 때 새 markdown/report 위젯을 만들지 말고 기존 metrics-table의 dependsOn/chartSpec.metricColumns/status만 유지하거나 갱신하세요.",
    "'백테스트의 테이블 버전', '백테스트 결과를 표로', '벤치마크 테이블'은 holdings/dataset table이 아니라 metrics-table입니다. 입력 종목 목록을 결과 표처럼 새로 만들지 말고, 결과 값이 없으면 metrics-table 대기 상태 또는 기존 백테스트 차트 dependsOn으로 처리하세요.",
    "현재 위젯을 고치는 요청이면 action은 update_current_widget을 사용하세요. 특정 위젯 id가 명확하면 widgetId를 넣고, 사용자가 W-001 같은 짧은 ID로 지칭하면 widgetDisplayId도 넣으세요. 명시적 대상 없이 첫 번째/최근 위젯을 추정해 덮어쓰지 마세요.",
    "위젯이 다른 위젯 데이터에서 파생되면 widget.dependsOn에는 내부 id 또는 W-001 같은 displayId 배열을, widget.derivedFrom에는 {widgetId, field, role} 배열을 넣으세요.",
    "관계 위젯의 updatePolicy는 데이터/표/차트처럼 재계산 가능한 위젯이면 auto 또는 manual, 모델 해석/투자 판단 위젯이면 manual 또는 confirm으로 두세요.",
    "A/B 위젯에서 C를 만들고 C 해석으로 D를 만들면 C.dependsOn=[A,B], D.dependsOn=[C]처럼 그래프를 명시하세요. 순환 의존성은 만들지 마세요.",
    "원형/파이/도넛 차트 요청은 widget.visualType을 pie 또는 allocation으로 두고 widget.dataset에 label 또는 ticker, name, weight 값을 넣으세요. 종목 목록만 있고 정확한 비중이 없으면 holdings 배열을 넣고 equal_weight 초안임을 basis 또는 summary에 표시하세요.",
    "라인 차트 요청은 widget.visualType을 line으로 두고 가능한 경우 widget.chartSpec.dataset 또는 chartSpec.series를 넣으세요.",
    "라인/백테스트 차트를 로그 차트로 바꾸라는 요청은 series/data 값을 로그 변환하지 말고 chartSpec.yScale='log'만 설정하세요. 선형축 복귀는 chartSpec.yScale='linear'입니다.",
    "종목 목록, 균등배분 포트폴리오 표시, 보유 구성 표시는 별도 차트 요청이 아니라면 widget.visualType을 table로 두고 widget.dataset에 label/ticker/name과 weight/value를 넣으세요.",
    "지원 필드: action, actionId, canvasId, widgetId, widgetDisplayId, confirmed, matrixRequest, matrixRequest.transform, matrixRequest.frequency, matrixRequest.seriesNames, matrixRequest.assets, matrixRequest.startDate, matrixRequest.endDate, matrixRequest.maxPoints, matrixRequest.nextPrompt, periodComparison, periodComparison.isMultiplePeriodComparison, periodComparison.periods, scenario, scenario.runs, holdings, basis, widget.displayId, widget.title, widget.kind, widget.visualType, widget.summary, widget.markdown, widget.echarts, widget.dataset, widget.chartSpec, widget.functionSpec, widget.signalMatrix, widget.dataFiles, widget.dataSources, widget.metrics, widget.checks, widget.badges, widget.scenarioId, widget.graphRole, widget.outputRole, widget.nextActions, widget.dependsOn, widget.derivedFrom, widget.updatePolicy.",
    "현재 위젯 후보:",
    ...(widgets.length
      ? widgets.slice(0, 5).map((widget) => {
          const relationLabel = portfolioWidgetRelationLabel(widget, widgets);
          const dataFileCount = normalizePortfolioWidgetDataFiles(widget.dataFiles, widget.functionSpec?.dataSources).length;
          return `- ${widget.displayId || ""} (${widget.id}): ${widget.title} / ${widget.kind} / ${widget.visualType || "memo"} / ${widget.outputRole || "role 없음"} / ${widget.status} / v${widget.version || 1}${dataFileCount ? ` / dataFiles ${dataFileCount}` : ""}${relationLabel ? ` / ${relationLabel}` : ""}`;
        })
      : ["- 현재 위젯 없음: 차트/표/위젯 생성 요청은 새 위젯 생성 action으로 처리해야 합니다."]),
    "생성 action 예시:",
    "```portfolio_widget_action",
    JSON.stringify(
      isAssetMode
      ? portfolioPromptAssetHistoryActionExample({ canvasId, canvasMode: modeMeta.id })
      : {
        action: "create_widget",
        actionId: "render_portfolio_artifact",
        canvasId,
        canvasMode: modeMeta.id,
        classification: {
          taskFamily: "portfolio_research",
          operation: "create_widget",
          analysisKind: "allocation_snapshot",
          isMultiplePeriodComparison: false,
          isMultipleAssetComparison: false,
          comparisonAxis: "",
          primaryOutput: "allocation_chart",
          requiresMarketData: false,
          requiresBacktestExecution: false,
          confidence: "high",
        },
        periodComparison: {
          isMultiplePeriodComparison: false,
          periods: [],
          confidence: "",
          note: "",
        },
        widget: {
          title: "현재 평가금액 기준 투자 비중",
          kind: "포트폴리오 차트",
          visualType: "allocation",
          summary: "종목별 투자 비중을 원형 차트로 표시합니다.",
          dataset: [{ label: "AVGO", value: 1 }],
          chartSpec: {
            type: "allocation",
            dataset: [{ label: "AVGO", value: 1 }],
          },
          scenarioId: "portfolio_scenario_root",
          graphRole: "process_node",
          outputRole: "allocation_snapshot",
          dependsOn: [],
          derivedFrom: [],
          updatePolicy: "manual",
        },
      },
      null,
      2
    ),
    "```",
  ].filter(Boolean).join("\n");
}
