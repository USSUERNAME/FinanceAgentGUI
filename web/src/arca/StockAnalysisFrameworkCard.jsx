import React from "react";

const stageLabels = {
  business_structure: "사업 구조",
  trade_suitability: "거래 적합성",
  growth_quality: "성장의 질",
  financial_statements: "재무 3표",
  market_expectations: "시장 기대",
  valuation: "밸류에이션",
  catalyst_risk: "촉매·위험",
  technical_trade_plan: "차트·매매계획",
};

const statusLabels = {
  verified: "검증됨",
  insufficient: "자료 부족",
  accumulating: "축적 중",
  collection_failed: "수집 실패",
  stale: "갱신 필요",
};

export default function StockAnalysisFrameworkCard({ framework }) {
  if (!framework?.stages?.length) return null;
  return (
    <details className="stock-gateway-analysis-framework">
      <summary>
        <span>종목 분석 8단계</span>
        <strong>{framework.completeness?.label || "0/8"}</strong>
        <small>{framework.tradeReadiness?.reason}</small>
      </summary>
      <div>
        {framework.stages.map((stage, index) => (
          <article className={`is-${stage.status}`} key={stage.id}>
            <header>
              <span>{index + 1}</span>
              <strong>{stageLabels[stage.id] || stage.id}</strong>
              <em>{statusLabels[stage.status] || stage.status}</em>
            </header>
            <p>{stage.reason}</p>
          </article>
        ))}
      </div>
    </details>
  );
}
