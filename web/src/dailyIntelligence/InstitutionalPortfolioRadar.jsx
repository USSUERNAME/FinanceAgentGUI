import React from "react";
import ArrowUpRight from "lucide-react/dist/esm/icons/arrow-up-right.js";
import Building2 from "lucide-react/dist/esm/icons/building-2.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert.js";
import TrendingDown from "lucide-react/dist/esm/icons/trending-down.js";
import TrendingUp from "lucide-react/dist/esm/icons/trending-up.js";
import "./institutional-portfolio-radar.css";

const RESEARCH_SECTOR_TO_MARKET_SECTOR = {
  semiconductors_ai_compute: "XLK",
  data_center_networking: "XLK",
  cloud_saas_cybersecurity: "XLK",
  data_center_power_cooling: "XLI",
  grid_electrification: "XLI",
  industrial_automation_robotics: "XLI",
  aerospace_defense: "XLI",
  shipbuilding_marine: "XLI",
  transportation_logistics: "XLI",
  nuclear_generation: "XLU",
  batteries_energy_storage: "XLY",
  electric_vehicles_autonomy: "XLY",
  biotech_healthcare_innovation: "XLV",
  financials_capital_markets: "XLF",
  consumer_internet_platforms: "XLC",
  energy_oil_gas: "XLE",
  metals_critical_materials: "XLB",
  construction_infrastructure: "XLI",
  reits_data_centers: "XLRE",
  renewable_energy_equipment: "XLI",
  media_gaming_entertainment: "XLC",
  consumer_brands_beauty: "XLY",
  technology_hardware_services: "XLK",
  communications_network_equipment: "XLK",
  industrials_machinery: "XLI",
  chemicals_specialty_materials: "XLB",
  consumer_staples_food_beverage: "XLP",
  consumer_discretionary_retail: "XLY",
  travel_leisure: "XLY",
  healthcare_services_medtech: "XLV",
  payments_fintech: "XLF",
  utilities_power: "XLU",
  real_estate_general: "XLRE",
};

const signalLabels = {
  accumulation_candidate: "공통 확대 관찰",
  reduction_candidate: "공통 축소 관찰",
  mixed: "방향 혼재",
};

const confidenceLabels = {
  high: "신뢰도 높음",
  medium: "신뢰도 보통",
  low: "신뢰도 낮음",
};

const moveLabels = {
  new: "신규",
  increased: "증액",
  decreased: "감액",
  exited: "청산",
};

const ownershipDirectionLabels = {
  initial_disclosure: "신규 공시",
  updated_position: "변경 공시",
  increased: "지분 증가",
  decreased: "지분 감소",
  unchanged: "수량 동일",
  below_threshold: "5% 이하",
};

function ownershipFormLabel(form = "") {
  if (form.includes("13D")) return form.endsWith("/A") ? "13D 변경" : "13D 적극적 지분";
  return form.endsWith("/A") ? "13G 변경" : "13G 주요 지분";
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (number >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(number).toLocaleString("en-US")}`;
}

function formatPct(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}%` : "-";
}

function formatSignedPct(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function formatShares(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${Math.round(number).toLocaleString("en-US")}주` : "수량 미확인";
}

function researchCandidatesForSector(stockCandidates, sectorTicker) {
  return (stockCandidates?.candidates || [])
    .filter((candidate) => candidate.sectorIds?.some(
      (sectorId) => RESEARCH_SECTOR_TO_MARKET_SECTOR[sectorId] === sectorTicker,
    ))
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, 4);
}

function EmptyRadar({ connection, busy, error, onRefresh }) {
  const needsUserAgent = connection?.reason === "user_agent_required";
  return (
    <section className="institutional-radar institutional-radar-empty">
      <div className="institutional-radar-empty-icon">
        {needsUserAgent ? <ShieldAlert size={26} /> : <Building2 size={26} />}
      </div>
      <div>
        <span>INSTITUTIONAL 13F RADAR</span>
        <h2>{needsUserAgent ? "SEC 연결 정보가 필요합니다" : "아직 수집된 13F가 없습니다"}</h2>
        <p>
          {needsUserAgent
            ? "프로젝트 루트 .env에 SEC_13F_USER_AGENT를 앱 이름과 연락 가능한 이메일 형식으로 등록하세요. 값은 화면이나 캐시에 저장되지 않습니다."
            : "SEC EDGAR에서 추적 운용사 10곳의 최근 8개 분기 공시를 수집하면 섹터와 종목 변화가 표시됩니다."}
        </p>
        {error ? <small className="institutional-radar-error">{error}</small> : null}
      </div>
      <button type="button" onClick={() => onRefresh({ refresh: true })} disabled={busy || needsUserAgent}>
        <RefreshCw size={15} className={busy ? "is-spinning" : ""} />
        {busy ? "SEC 수집 중" : "SEC 13F 수집"}
      </button>
    </section>
  );
}

export function InstitutionalPortfolioRadar({
  payload,
  busy = false,
  error = "",
  onRefresh,
  decisionChain,
  stockCandidates,
  brokerResearchDate = "",
  onTrackStock,
  trackBusy = false,
}) {
  const connection = payload?.connection || {};
  const radar = payload?.radar;
  if (!radar) {
    return (
      <EmptyRadar
        connection={connection}
        busy={busy}
        error={error}
        onRefresh={onRefresh}
      />
    );
  }

  const accumulationSectors = radar.sectorConsensus
    .filter((sector) => sector.signal === "accumulation_candidate")
    .slice(0, 4);
  const topSector = accumulationSectors[0] || radar.sectorConsensus[0] || null;
  const linkedMarketSector = decisionChain?.sectors?.find(
    (sector) => sector.ticker === topSector?.ticker,
  );
  const linkedCandidates = topSector
    ? researchCandidatesForSector(stockCandidates, topSector.ticker)
    : [];

  return (
    <section className="institutional-radar">
      <header className="institutional-radar-header">
        <div>
          <span>INSTITUTIONAL 13F RADAR</span>
          <h2>대가 포트폴리오 레이더</h2>
          <p>공시된 보유 수량 변화와 섹터 분포를 아이디어 탐색 근거로만 사용합니다.</p>
        </div>
        <div className="institutional-radar-actions">
          {connection.filingWindowActive
            ? <em>공시 집중기간 · 3시간 자동 확인</em>
            : !connection.configured
            ? <em>SEC 연결 정보 필요</em>
            : connection.stale
              ? <em>캐시 갱신 필요</em>
              : null}
          <button
            type="button"
            onClick={() => onRefresh({ refresh: true })}
            disabled={busy || !connection.configured}
          >
            <RefreshCw size={15} className={busy ? "is-spinning" : ""} />
            {busy ? "SEC 수집 중" : "공시 새로고침"}
          </button>
        </div>
      </header>

      {error ? <p className="institutional-radar-error">{error}</p> : null}

      <div className="institutional-radar-metrics">
        <article>
          <span>수집 운용사</span>
          <strong>{radar.summary.readyManagerCount}/{radar.summary.trackedManagerCount}</strong>
          <small>SEC 13F 및 정정공시 기준</small>
        </article>
        <article>
          <span>최신 기준 분기</span>
          <strong>{radar.summary.latestReportDate || "-"}</strong>
          <small>공시일과 보유 기준일 분리</small>
        </article>
        <article>
          <span>섹터 분류 커버리지</span>
          <strong>{formatPct(radar.summary.averageClassificationCoveragePct)}</strong>
          <small>미분류 종목은 억지로 추론하지 않음</small>
        </article>
        <article>
          <span>분기 이력</span>
          <strong>{radar.summary.quarterDepth}개 분기</strong>
          <small>주식 수 변화 우선 비교</small>
        </article>
        <article>
          <span>분기 중 지분 신호</span>
          <strong>{radar.summary.recentOwnershipSignalCount || 0}건</strong>
          <small>최근 240일 13D·13G</small>
        </article>
      </div>

      <div className="institutional-radar-layout">
        <div className="institutional-radar-consensus">
          <div className="institutional-radar-section-title">
            <div>
              <span>SECTOR CONSENSUS</span>
              <h3>운용사 공통 섹터 흐름</h3>
            </div>
            <small>확대 − 축소 운용사 수</small>
          </div>
          <div className="institutional-radar-sector-list">
            {radar.sectorConsensus.slice(0, 8).map((sector) => (
              <article className={`is-${sector.signal}`} key={sector.ticker}>
                <header>
                  <div>
                    <span>{sector.ticker}</span>
                    <strong>{sector.label}</strong>
                  </div>
                  <em>{signalLabels[sector.signal] || sector.signal}</em>
                </header>
                <div className="institutional-radar-sector-flow">
                  <span className="is-add"><TrendingUp size={14} /> 확대 {sector.managerAdds.length}</span>
                  <span className="is-cut"><TrendingDown size={14} /> 축소 {sector.managerCuts.length}</span>
                  <span>평균 비중 {formatPct(sector.averageWeightPct)}</span>
                </div>
                <p>{sector.interpretation}</p>
                <small>{confidenceLabels[sector.confidence] || sector.confidence}</small>
              </article>
            ))}
          </div>
        </div>

        <aside className="institutional-radar-linkage">
          <div className="institutional-radar-section-title">
            <div>
              <span>RESEARCH LINKAGE</span>
              <h3>현재 리포트와 연결</h3>
            </div>
          </div>
          {topSector ? (
            <>
              <div className="institutional-radar-linkage-lead">
                <span>{topSector.ticker} · {topSector.label}</span>
                <strong>{signalLabels[topSector.signal]}</strong>
                <p>
                  {linkedMarketSector
                    ? `오늘 시장 판단은 ${linkedMarketSector.stanceLabel || linkedMarketSector.stance}입니다. ${linkedMarketSector.reason || "추가 근거를 확인하세요."}`
                    : "오늘 시장·월드메모리 근거와의 방향 일치는 아직 확인되지 않았습니다."}
                </p>
              </div>
              <div className="institutional-radar-research-candidates">
                <strong>기존 기업분석 후보 연결</strong>
                {linkedCandidates.length ? linkedCandidates.map((candidate) => {
                  const sectorId = candidate.sectorIds.find(
                    (id) => RESEARCH_SECTOR_TO_MARKET_SECTOR[id] === topSector.ticker,
                  ) || "";
                  return (
                    <article key={candidate.ticker}>
                      <div>
                        <span>{candidate.ticker}</span>
                        <small>{candidate.companyName}</small>
                      </div>
                      <button
                        type="button"
                        disabled={trackBusy}
                        onClick={() => onTrackStock?.({
                          ticker: candidate.ticker,
                          sectorId,
                          brokerResearchDate,
                        })}
                      >
                        <Search size={13} /> 추적
                      </button>
                    </article>
                  );
                }) : (
                  <p>같은 섹터의 기존 개별주식 후보가 없습니다. 다음 후보 스크리닝에서 연결합니다.</p>
                )}
              </div>
            </>
          ) : <p>공통 섹터 흐름을 판단할 관찰 수가 부족합니다.</p>}
        </aside>
      </div>

      {radar.activitySignals?.length ? (
        <div className="institutional-radar-activity-board">
          <div className="institutional-radar-section-title">
            <div>
              <span>BETWEEN-QUARTER SIGNALS</span>
              <h3>분기 사이 대형 지분 변화</h3>
            </div>
            <small>13D·13G · 전체 리밸런싱과 구분</small>
          </div>
          <div className="institutional-radar-activity-list">
            {radar.activitySignals.slice(0, 8).map((signal) => (
              <article className={`is-${signal.direction}`} key={signal.accessionNumber}>
                <header>
                  <span>{ownershipFormLabel(signal.form)}</span>
                  <em>{ownershipDirectionLabels[signal.direction] || "방향 확인 필요"}</em>
                </header>
                <div>
                  <strong>{signal.ticker ? `${signal.ticker} · ` : ""}{signal.issuerName}</strong>
                  <small>{signal.managerName} · 공시 {signal.filingDate}</small>
                </div>
                <p>
                  {formatShares(signal.beneficialShares)}
                  {signal.classPercent > 0 ? ` · 지분 ${formatPct(signal.classPercent)}` : ""}
                  {Number.isFinite(signal.deltaSharesPct) ? ` · 이전 공시 대비 ${formatSignedPct(signal.deltaSharesPct)}` : ""}
                </p>
                <a href={signal.sourceUrl} target="_blank" rel="noreferrer">
                  SEC 원문 <ArrowUpRight size={12} />
                </a>
              </article>
            ))}
          </div>
          <p className="institutional-radar-activity-note">
            신규 13D·13G는 신규 매수와 같은 뜻이 아닙니다. 같은 운용사·종목의 이전 공시가 있을 때만 증가·감소로 판정합니다.
          </p>
        </div>
      ) : null}

      <div className="institutional-radar-managers">
        <div className="institutional-radar-section-title">
          <div>
            <span>MANAGER FILINGS</span>
            <h3>운용사별 주요 변화</h3>
          </div>
          <small>평가액 변화보다 보유 수량 변화 우선</small>
        </div>
        <div className="institutional-radar-manager-grid">
          {radar.managers.map((manager) => (
            <article className={`is-${manager.status}`} key={manager.id}>
              <header>
                <div>
                  <span>{manager.principal}</span>
                  <strong>{manager.name}</strong>
                </div>
                {manager.latest?.sourceUrl ? (
                  <a href={manager.latest.sourceUrl} target="_blank" rel="noreferrer" title="SEC 공시 열기">
                    SEC <ArrowUpRight size={12} />
                  </a>
                ) : null}
              </header>
              {manager.latest ? (
                <>
                  <div className="institutional-radar-manager-meta">
                    <span>{manager.latest.reportDate}</span>
                    {manager.latest.amendmentCount ? <span>정정 {manager.latest.amendmentCount}건 반영</span> : null}
                    <span>{formatMoney(manager.latest.totalValue)}</span>
                    <span>{manager.latest.holdingCount}종목</span>
                  </div>
                  <div className="institutional-radar-moves">
                    {manager.moves.slice(0, 3).map((move) => (
                      <p key={move.securityKey} className={`is-${move.action}`}>
                        <span>{moveLabels[move.action] || move.action}</span>
                        <strong>{move.issuer}</strong>
                        <small>{formatSignedPct(move.weightDeltaPp)}p</small>
                      </p>
                    ))}
                    {!manager.moves.length ? <p>비교 가능한 수량 변화가 없습니다.</p> : null}
                  </div>
                </>
              ) : <p>최근 13F 원문을 수집하지 못했습니다.</p>}
            </article>
          ))}
        </div>
      </div>

      {radar.candidates.length ? (
        <div className="institutional-radar-candidate-board">
          <div className="institutional-radar-section-title">
            <div>
              <span>IDEA TRIAGE</span>
              <h3>동시 확대 종목 후보</h3>
            </div>
            <small>추천이 아닌 후속 분석 대기열</small>
          </div>
          <div>
            {radar.candidates.slice(0, 10).map((candidate) => (
              <article key={`${candidate.issuer}-${candidate.sectorTicker}`}>
                <span className={`priority-${candidate.researchPriority}`}>연구 {candidate.researchPriority}</span>
                <div>
                  <strong>{candidate.issuer}</strong>
                  <small>{candidate.sectorLabel} · {candidate.managers.join(", ")}</small>
                </div>
                <p>{candidate.managerCount}개 운용사 확대 · {candidate.nextWorkflow}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="institutional-radar-footer">
        <ShieldAlert size={16} />
        <div>
          <strong>해석 제한</strong>
          <p>{radar.limitations.join(" ")}</p>
          <span>
            섹터 구성 기준 {radar.source.sectorMembershipAsOf || "미확보"} · 생성 {radar.generatedAt?.slice(0, 10)}
          </span>
        </div>
      </footer>
    </section>
  );
}
