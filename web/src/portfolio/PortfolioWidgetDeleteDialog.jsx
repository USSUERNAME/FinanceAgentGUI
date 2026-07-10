import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import X from "lucide-react/dist/esm/icons/x.js";

export function PortfolioWidgetDeleteDialog({
  target,
  dependents = [],
  cascadeDependents = [],
  onCancel,
  onConfirm,
}) {
  if (!target) return null;
  const targetLabel = [target.displayId, target.title].filter(Boolean).join(" · ") || "선택한 위젯";
  const cascadeIds = new Set(cascadeDependents.map((widget) => widget.id));
  const disconnectedCount = dependents.filter((widget) => !cascadeIds.has(widget.id)).length;
  return (
    <div className="portfolio-widget-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="portfolio-widget-modal portfolio-widget-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-widget-delete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>의존성 경고</span>
            <h2 id="portfolio-widget-delete-title">위젯 삭제</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="삭제 취소">
            <X size={17} strokeWidth={2.2} />
          </button>
        </header>
        <div className="portfolio-widget-delete-warning" role="alert">
          <AlertTriangle size={18} strokeWidth={2.3} />
          <div>
            <strong>{targetLabel}</strong>
            <p>
              {cascadeDependents.length ? `종속된 평가 테이블 ${cascadeDependents.length}개도 같이 삭제됩니다.` : ""}
              {cascadeDependents.length && disconnectedCount ? " " : ""}
              {disconnectedCount
                ? `나머지 하위 위젯 ${disconnectedCount}개는 관계가 끊긴 상태로 표시됩니다.`
                : !cascadeDependents.length
                  ? "이 위젯을 참조하는 하위 위젯은 관계가 끊긴 상태로 표시되고, 다시 연결하거나 재계산해야 합니다."
                  : ""}
            </p>
          </div>
        </div>
        <ul className="portfolio-widget-delete-dependent-list">
          {dependents.map((widget) => (
            <li key={widget.id}>
              <strong>{widget.displayId || widget.id}</strong>
              <span>{widget.title}</span>
              {cascadeIds.has(widget.id) ? <em>함께 삭제</em> : null}
            </li>
          ))}
        </ul>
        <footer>
          <button type="button" onClick={onCancel}>아니오</button>
          <button className="is-danger" type="button" onClick={onConfirm}>예, 삭제</button>
        </footer>
      </section>
    </div>
  );
}
