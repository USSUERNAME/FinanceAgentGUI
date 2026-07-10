import FlaskConical from "lucide-react/dist/esm/icons/flask-conical.js";
import WalletCards from "lucide-react/dist/esm/icons/wallet-cards.js";

import { normalizePortfolioCanvasMode } from "./workspaceState.js";

export const PORTFOLIO_CANVAS_MODES = {
  asset: {
    id: "asset-management",
    label: "자산 관리",
    shortLabel: "자산",
    defaultNamePrefix: "이름 없는 자산 캔버스",
    buttonLabel: "자산 관리 캔버스 생성",
    description: "실제 보유 자산, 원금, 평가금액, 손익, 업데이트 이력을 추적합니다.",
    actionGuidance: "실제 자산 데이터는 금액, 수량, 원금, 평가금액, 데이터 출처를 우선 확인하고, 새 위젯은 사용자가 캔버스의 + 버튼에서 직접 선택합니다.",
    Icon: WalletCards,
    accentClass: "is-asset",
  },
  strategy: {
    id: "strategy-research",
    label: "전략 연구",
    shortLabel: "전략",
    defaultNamePrefix: "이름 없는 전략 캔버스",
    buttonLabel: "전략 연구 캔버스 생성",
    description: "A/B/C 전략 포트폴리오의 비율, 백테스트, CSV 업로드 데이터를 실험합니다.",
    actionGuidance: "전략 연구는 실제 투자금보다 비율, 가정, 데이터 출처, 비교 조건을 우선 확인해야 합니다.",
    Icon: FlaskConical,
    accentClass: "is-strategy",
  },
};

export const portfolioCanvasModeList = [PORTFOLIO_CANVAS_MODES.asset, PORTFOLIO_CANVAS_MODES.strategy];

export function portfolioCanvasModeMeta(mode) {
  const normalized = normalizePortfolioCanvasMode(mode);
  return portfolioCanvasModeList.find((item) => item.id === normalized) || PORTFOLIO_CANVAS_MODES.asset;
}
