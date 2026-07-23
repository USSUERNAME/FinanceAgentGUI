import React, { useMemo } from "react";
import "./portfolio.css";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import ChevronsRight from "lucide-react/dist/esm/icons/chevrons-right.js";
import PieChart from "lucide-react/dist/esm/icons/chart-pie.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import portfolioGuideAssistant from "../assets/portfolio-guide-assistant.png";
import { PortfolioEChart } from "./PortfolioEChart.jsx";

const portfolioGuideWidgets = [
  {
    title: "관심 종목 메모리",
    body: "사이드바에 말한 관심 종목, 투자 의도, 피해야 할 노출을 작업 DB로 남깁니다.",
    meta: "database · editable",
    accent: "teal",
  },
  {
    title: "yfinance 실험실",
    body: "실제 가격 히스토리로 기간, 벤치마크, 리밸런싱 가정을 바꾸며 비교합니다.",
    meta: "market data · backtest",
    accent: "blue",
  },
  {
    title: "리스크 렌즈",
    body: "상관, 집중도, 낙폭, 현금 여유를 같은 화면에서 확인하는 위젯으로 키웁니다.",
    meta: "risk budget · drawdown",
    accent: "coral",
  },
  {
    title: "투자 가설 보드",
    body: "왜 이 종목을 사려는지, 어떤 조건이면 줄일지 같은 판단 규칙을 연결합니다.",
    meta: "thesis · review",
    accent: "gold",
  },
];

const portfolioGuideAgentTurns = [
  {
    role: "user",
    text: "NVDA랑 장기채를 같이 보유하면 낙폭이 얼마나 줄어드는지 보고 싶어.",
  },
  {
    role: "agent",
    text: "관심 종목을 기억하고, yfinance 백테스트 위젯과 상관/낙폭 위젯을 캔버스에 만들겠습니다.",
  },
  {
    role: "user",
    text: "차트는 크게 보고, 가설 메모는 오른쪽 아래에 작게 둬.",
  },
];

const portfolioGuideBuildSteps = [
  "사이드바 상담에서 자료, 이미지, 파일, 붙여넣기를 받음",
  "필요한 테이블과 컬럼을 임기응변으로 설계",
  "메인 캔버스에 위젯을 만들고 크기와 위치를 조정",
  "검증된 포트폴리오 이론과 실제 시장 데이터로 다시 점검",
];

export function PortfolioGuidePage({ modes = [], principles = [], onCreateCanvas }) {
  const exampleBacktestOption = useMemo(
    () => ({
      color: ["#207a68", "#426fd6"],
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => `${Number(value).toFixed(1)}`,
      },
      grid: { left: 34, right: 16, top: 28, bottom: 28 },
      xAxis: {
        type: "category",
        data: ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월"],
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#d8e0de" } },
        axisLabel: { color: "#5f6c69", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        min: 88,
        axisLabel: { color: "#5f6c69", fontSize: 11 },
        splitLine: { lineStyle: { color: "#edf1f0" } },
      },
      series: [
        {
          name: "내 실험 포트폴리오",
          type: "line",
          smooth: true,
          symbolSize: 6,
          lineStyle: { width: 3 },
          areaStyle: { opacity: 0.1 },
          data: [100, 104, 101, 108, 112, 109, 116, 121],
        },
        {
          name: "전략 B",
          type: "line",
          smooth: true,
          symbolSize: 5,
          lineStyle: { width: 2 },
          data: [100, 102, 99, 104, 107, 108, 110, 114],
        },
      ],
    }),
    []
  );

  const exampleAllocationOption = useMemo(
    () => ({
      color: ["#207a68", "#426fd6", "#efb54e", "#e26d5a", "#7d6bb0"],
      tooltip: {
        trigger: "item",
        valueFormatter: (value) => `${value}%`,
      },
      series: [
        {
          type: "pie",
          radius: ["54%", "76%"],
          center: ["50%", "52%"],
          avoidLabelOverlap: true,
          label: {
            color: "#2f3634",
            fontSize: 11,
            formatter: "{b}\n{d}%",
          },
          labelLine: {
            length: 8,
            length2: 7,
          },
          data: [
            { name: "성장주", value: 38 },
            { name: "배당", value: 22 },
            { name: "채권", value: 18 },
            { name: "금", value: 12 },
            { name: "현금", value: 10 },
          ],
        },
      ],
    }),
    []
  );

  return (
    <section className="portfolio-guide" aria-labelledby="portfolio-guide-title">
      <div className="portfolio-guide-hero">
        <div className="portfolio-guide-hero-copy">
          <h1 id="portfolio-guide-title">포트폴리오 작업실</h1>
          <p>
            여기는 고정된 입력 폼이 아니라, 사이드바 에이전트와 함께 데이터베이스와 위젯을 만들어 가는 투자
            작업 캔버스입니다. 관심 종목, 투자 의도, 보유 파일, 백테스트 실험이 쌓일수록 화면도 같이 진화합니다.
          </p>
          <div className="portfolio-guide-actions">
            <div className="portfolio-guide-mode-actions">
              {modes.map((mode) => {
                const Icon = mode.Icon;
                return (
                  <button
                    type="button"
                    className={`portfolio-guide-primary ${mode.accentClass}`}
                    onClick={() => onCreateCanvas?.(mode.id)}
                    key={mode.id}
                  >
                    <Icon size={16} strokeWidth={2.3} />
                    <span>{mode.buttonLabel}</span>
                  </button>
                );
              })}
            </div>
            <span>
              자산 관리는 실제 투자금과 손익 추적, 전략 연구는 A/B/C 포트폴리오 비율 실험과 백테스트에 초점을 둡니다.
            </span>
          </div>
        </div>

        <div className="portfolio-guide-visual" aria-label="포트폴리오 작업실 안내 이미지">
          <img src={portfolioGuideAssistant} alt="차트 위젯을 설명하는 포트폴리오 에이전트 일러스트" />
          <div className="portfolio-guide-floating-widget">
            <strong>Agent builds widgets</strong>
            <span>watchlist · yfinance · risk lens</span>
          </div>
        </div>
      </div>

      <div className="portfolio-guide-section portfolio-guide-agent-section">
        <div className="portfolio-guide-section-heading">
          <h2>자료 입력은 사이드바 에이전트에게</h2>
          <p>
            사용자는 채팅하듯 말하고, 붙여넣고, 파일과 이미지를 건넵니다. 에이전트는 그 자료를 현재 화면의
            데이터베이스, schema 초안, 다음 위젯 후보로 바꿉니다.
          </p>
        </div>
        <div className="portfolio-guide-agent-grid">
          <div className="portfolio-guide-chat">
            {portfolioGuideAgentTurns.map((turn) => (
              <article className={`portfolio-guide-bubble is-${turn.role}`} key={turn.text}>
                <span>{turn.role === "user" ? "사용자" : "에이전트"}</span>
                <p>{turn.text}</p>
              </article>
            ))}
          </div>
          <div className="portfolio-guide-step-list">
            {portfolioGuideBuildSteps.map((step, index) => (
              <article key={step}>
                <strong>{String(index + 1).padStart(2, "0")}</strong>
                <p>{step}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="portfolio-guide-section">
        <div className="portfolio-guide-section-heading">
          <h2>위젯을 만들고, 없애고, 키웁니다</h2>
          <p>
            포트폴리오 페이지의 본체는 고정 대시보드가 아니라 조립식 작업판입니다. 에이전트에게 “이 차트 크게”,
            “가설 메모는 작게”, “이 위젯 삭제”처럼 지시할 수 있는 방향을 전제로 둡니다.
          </p>
        </div>
        <div className="portfolio-guide-widget-grid">
          {portfolioGuideWidgets.map((widget) => (
            <article className={`portfolio-guide-widget is-${widget.accent}`} key={widget.title}>
              <div>
                <span>{widget.meta}</span>
                <h3>{widget.title}</h3>
                <p>{widget.body}</p>
              </div>
              <div className="portfolio-guide-widget-controls" aria-label={`${widget.title} 위젯 조작 예시`}>
                <span><ArrowUp size={13} strokeWidth={2.2} />키우기</span>
                <span><ChevronsRight size={13} strokeWidth={2.2} />옮기기</span>
                <span><Trash2 size={13} strokeWidth={2.2} />지우기</span>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="portfolio-guide-section portfolio-guide-chart-section">
        <div className="portfolio-guide-section-heading">
          <h2>자산관리는 비중 차트에서 시작합니다</h2>
          <p>
            실제 보유 포트폴리오는 표로 입력하고, 파이차트 위젯으로 투자금이 어디에 몰려 있는지 먼저 봅니다.
            전략 연구가 수익률 선 차트 중심이라면, 자산관리는 현재 비중과 집중도 확인이 첫 화면입니다.
          </p>
        </div>
        <div className="portfolio-guide-chart-grid">
          <article className="portfolio-guide-chart-card">
            <header>
              <div>
                <h3>자산관리 파이차트</h3>
                <p>성장주, 배당, 채권, 금, 현금 비중</p>
              </div>
              <PieChart size={16} strokeWidth={2.2} />
            </header>
            <PortfolioEChart
              option={exampleAllocationOption}
              className="portfolio-guide-chart"
              ariaLabel="예시 자산군 비중 도넛 차트"
            />
          </article>
          <article className="portfolio-guide-chart-card">
            <header>
              <div>
                <h3>전략 연구 백테스트</h3>
                <p>내 실험 포트폴리오와 전략 B 비교</p>
              </div>
              <RefreshCw size={16} strokeWidth={2.2} />
            </header>
            <PortfolioEChart
              option={exampleBacktestOption}
              className="portfolio-guide-chart"
              ariaLabel="예시 백테스트 선 차트"
            />
          </article>
        </div>
      </div>

      <div className="portfolio-guide-section portfolio-guide-principle-section">
        <div className="portfolio-guide-section-heading">
          <h2>상담 기준은 검증된 이론 위에 둡니다</h2>
          <p>
            에이전트는 단순히 그럴듯한 차트를 만드는 쪽이 아니라, 분산, 상관, 리스크 예산, 비용, 행동재무 같은
            기본 원칙을 화면 설계와 질문에 계속 반영합니다.
          </p>
        </div>
        <div className="portfolio-guide-principles">
          {principles.map((item) => (
            <article key={item.title}>
              <CheckCircle2 size={15} strokeWidth={2.2} />
              <div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
