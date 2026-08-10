import React from "react";

export default function StockTradePlanEditor({ candidate, performance, busy, onSave }) {
  const saved = performance?.tradePlan || {};
  const [plan, setPlan] = React.useState({
    tradeHorizon: saved.tradeHorizon || "",
    thesisReason: saved.thesisReason || candidate.whyNow || "",
    entryCondition: saved.entryCondition || "",
    addCondition: saved.addCondition || "",
    exitCondition: saved.exitCondition || candidate.invalidationConditions?.[0] || "",
    maxLossPct: saved.maxLossPct ?? "",
    positionSizePct: saved.positionSizePct ?? "",
  });

  React.useEffect(() => {
    if (!performance?.tradePlan) return;
    setPlan({
      tradeHorizon: performance.tradePlan.tradeHorizon || "",
      thesisReason: performance.tradePlan.thesisReason || "",
      entryCondition: performance.tradePlan.entryCondition || "",
      addCondition: performance.tradePlan.addCondition || "",
      exitCondition: performance.tradePlan.exitCondition || "",
      maxLossPct: performance.tradePlan.maxLossPct ?? "",
      positionSizePct: performance.tradePlan.positionSizePct ?? "",
    });
  }, [performance?.tradePlan]);

  if (!performance) return null;
  const change = (field) => (event) => setPlan((current) => ({
    ...current,
    [field]: event.target.value,
  }));
  return (
    <details className="stock-gateway-trade-plan">
      <summary>
        <span>매매계획·복기</span>
        <small>{saved.readiness?.ready ? "계획 작성 완료" : "조건 입력 필요"}</small>
      </summary>
      <div>
        <label>
          <span>매매 유형</span>
          <select value={plan.tradeHorizon} onChange={change("tradeHorizon")}>
            <option value="">선택</option>
            <option value="day">데이</option>
            <option value="earnings">실적</option>
            <option value="position">포지션</option>
            <option value="long_term">장기</option>
          </select>
        </label>
        <label className="is-wide"><span>○○ 때문에 매수·관찰</span><textarea value={plan.thesisReason} onChange={change("thesisReason")} /></label>
        <label className="is-wide"><span>진입 조건</span><textarea value={plan.entryCondition} onChange={change("entryCondition")} /></label>
        <label className="is-wide"><span>△△면 추가 검토</span><textarea value={plan.addCondition} onChange={change("addCondition")} /></label>
        <label className="is-wide"><span>□□면 정리·가설 폐기</span><textarea value={plan.exitCondition} onChange={change("exitCondition")} /></label>
        <label><span>최대 손실 %</span><input type="number" min="0.1" max="100" step="0.1" value={plan.maxLossPct} onChange={change("maxLossPct")} /></label>
        <label><span>포지션 크기 %</span><input type="number" min="0.1" max="100" step="0.1" value={plan.positionSizePct} onChange={change("positionSizePct")} /></label>
        <footer>
          <p>저장 시 이후 1주·1개월·3개월 성과와 적중·무효화 복기에 이 계획이 함께 남습니다.</p>
          <button type="button" disabled={busy} onClick={() => onSave(candidate.ticker, plan)}>계획 저장</button>
        </footer>
      </div>
    </details>
  );
}
