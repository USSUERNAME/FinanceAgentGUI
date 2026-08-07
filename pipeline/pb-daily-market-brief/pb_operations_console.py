"""Serve a localhost-only, read-only PB operations console."""

from __future__ import annotations

import argparse
import json
from datetime import date
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

from collectors.common import ROOT
from execute_research_task import (
    RECEIPT_SCHEMA_VERSION,
    list_executable_tasks,
)

MANIFEST_RELATIVE_ROOT = Path("workspace") / "operations_manifest"
REPORT_ROOTS = (
    Path("workspace") / "briefs",
    Path("workspace") / "v2_reader_reports",
    Path("workspace") / "operations_reports",
    Path("workspace") / "intelligence",
    Path("workspace") / "analysis",
    Path("workspace") / "company_earnings_deep_dive",
)

INDEX_HTML = """<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PB Market Intelligence</title>
  <style>
    :root{color-scheme:dark;--bg:#08101d;--panel:#111d30;--panel2:#0c1728;--line:#26364f;--muted:#93a4bd;--text:#edf3fb;--green:#59d39b;--yellow:#f4c95d;--red:#ff7a88;--blue:#72a7ff;--violet:#b795ff}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#15294a 0,#08101d 38%);color:var(--text);font:14px/1.55 Inter,Segoe UI,sans-serif}
    main{max-width:1360px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-end;margin-bottom:22px}
    h1{font-size:29px;margin:0 0 4px}h2{font-size:18px;margin:0 0 14px}h3{font-size:15px;margin:0}.muted{color:var(--muted)}
    select,button{background:#17263c;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:9px 12px}
    button{cursor:pointer}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.panel{background:rgba(17,29,48,.94);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 18px 40px rgba(0,0,0,.18)}
    .hero{grid-column:span 12}.third{grid-column:span 4}.half{grid-column:span 6}.full{grid-column:span 12}
    .metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.cache-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.metric{background:var(--panel2);border:1px solid #1f3048;border-radius:10px;padding:13px}.metric strong{display:block;font-size:22px;margin-top:3px}
    .status{display:inline-flex;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:700}.ready,.success,.verified,.existing_output_attached,.ok_with_filtered{background:#123d33;color:var(--green)}.review_required,.skipped_or_notice,.partial,.prepared_for_specialist,.ready_for_review{background:#493d19;color:var(--yellow)}.incomplete,.failed,.unverified,.awaiting_matching_output,.needs_evidence,.needs_korea_market_inputs,.needs_entity_mapping,.no_active_entries{background:#4a202a;color:var(--red)}
    .regime{border-left:4px solid var(--violet);padding-left:14px}.regime strong{display:block;font-size:20px;margin-bottom:4px}
    .event-list{display:grid;gap:12px}.event{background:var(--panel2);border:1px solid #20324b;border-radius:12px;padding:16px}.event-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.event-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}.event-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.event-block{border-top:1px solid var(--line);padding-top:10px}.event-block h4{font-size:12px;color:var(--muted);margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em}.event-block ul{margin:0;padding-left:18px}.event-block li+li{margin-top:5px}.wide{grid-column:1/-1}
    .task-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.task-card{background:var(--panel2);border:1px solid #20324b;border-radius:12px;padding:15px;min-width:0}.task-card h3{overflow-wrap:anywhere}.task-meta{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.task-path{display:block;overflow-wrap:anywhere;font-size:12px}.task-hash{font-family:Consolas,monospace;font-size:12px;color:var(--muted)}.receipt-note{max-width:360px;white-space:normal}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:9px 7px;vertical-align:top}th{color:var(--muted);font-size:12px}.table-scroll{max-width:100%;overflow-x:auto}.table-scroll table{width:max-content;min-width:100%}
    a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}.empty{color:var(--muted);padding:12px 0}.notice{border:1px solid #5a4820;background:#2b2515;color:#f7d982;border-radius:10px;padding:12px}
    .policy{border-left:3px solid var(--blue);padding-left:12px}.cache-panel{border-left:4px solid var(--green)}.cache-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}.error{color:var(--red);margin-bottom:12px}.section-label{grid-column:span 12;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:8px 2px -4px}
    @media(max-width:900px){main{padding:18px}.third,.half{grid-column:span 12}.metrics,.cache-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.event-grid,.task-grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body><main>
  <div class="top"><div><h1>PB Market Intelligence</h1><div class="muted">사건·검증·연속성 메모리를 함께 보는 읽기 전용 콘솔</div></div>
  <div><select id="date"></select> <button id="refresh">새로고침</button></div></div>
  <div id="error" class="error"></div><div id="app" class="grid"></div>
</main>
<script>
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const badge=(v,label)=>`<span class="status ${esc(v)}">${esc(label??v)}</span>`;
const metric=(label,value,detail="")=>`<div class="metric"><span class="muted">${esc(label)}</span><strong>${esc(value)}</strong>${detail?`<small class="muted">${esc(detail)}</small>`:""}</div>`;
const claimText=v=>typeof v==="string"?v:(v?.claim||v?.summary||v?.observation||v?.title||JSON.stringify(v));
const list=(items,empty="확인된 내용 없음")=>items?.length?`<ul>${items.map(x=>`<li>${esc(claimText(x))}</li>`).join("")}</ul>`:`<div class="empty">${esc(empty)}</div>`;
async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(await r.text());return r.json()}
async function optionalJson(url){const r=await fetch(url);if(r.status===404)return null;if(!r.ok)throw new Error(await r.text());return r.json()}
function table(headers,rows){if(!rows.length)return '<div class="empty">표시할 항목이 없습니다.</div>';return `<table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`}
const researchStatusLabel=v=>({
 existing_output_attached:"기존 분석 연결",
 prepared_for_specialist:"전문 분석 준비",
 awaiting_matching_output:"분석 결과 대기",
 completed:"실행 완료",
 validated_only:"검증만 완료",
 needs_evidence:"1차 근거 필요",
 needs_korea_market_inputs:"한국시장 데이터 필요",
 needs_entity_mapping:"상장사 매핑 필요",
 ready_for_review:"검토 준비",
 no_active_entries:"추적 항목 없음"
}[v]||v||"상태 없음");
const researchReasonLabel=v=>({
 primary_fact_not_confirmed:"공식 원문 사실 추출 미완료",
 listed_entity_not_mapped:"상장사·티커 매핑 필요",
 korea_market_inputs_incomplete:"한국시장 입력 불완전",
 active_continuity_entries_present:"연속성 항목 검토 필요",
 active_continuity_entries_absent:"추적 중인 연속성 항목 없음",
 market_analysis_missing:"시장 분석 산출물 없음",
 minimum_inputs_available:"최소 입력 확보"
}[v]||v);
const scrollTable=(headers,rows)=>`<div class="table-scroll">${table(headers,rows)}</div>`;
function researchTaskCard(x){
 const sources=x.source_paths||[];
 return `<article class="task-card">
  <h3>${esc(x.lead_workflow||"research task")}</h3>
  <div class="task-meta">${badge(x.execution_status,researchStatusLabel(x.execution_status))}${x.scope?badge("partial",x.scope):""}</div>
  ${x.event_id?`<div class="muted">사건 ID: ${esc(x.event_id)}</div>`:""}
  <div class="task-hash">입력 지문 ${esc((x.input_hash||"").slice(0,16))}</div>
  ${sources.map(path=>`<span class="task-path muted">${esc(path)}</span>`).join("")}
 </article>`;
}
function researchPackSection(p){
 if(!p)return `<div class="section-label">Research Workflow</div><section class="panel full notice">이 날짜의 Research Pack이 없습니다.</section>`;
 const s=p.summary||{}, items=p.work_items||[], blocked=p.blocked_tasks||[];
 const statusRows=blocked.map(x=>`<tr><td>${esc(x.scope||"-")}</td><td>${esc(x.lead_workflow||"-")}</td><td>${badge(x.readiness,researchStatusLabel(x.readiness))}</td><td>${esc((x.reason_codes||[]).map(researchReasonLabel).join(", ")||"-")}</td></tr>`);
 return `<div class="section-label">Research Workflow</div>
  <section class="panel hero"><h2>리서치 작업 상태</h2>
   <div class="metrics">${metric("전체 계획",s.planned_task_count||0,"라우터가 분류한 작업")}${metric("분석 가능",s.eligible_task_count||0,"근거 게이트 통과")}${metric("패킷 생성",s.work_item_count||0,"기존 결과 또는 입력 준비")}${metric("차단",s.blocked_task_count||0,"근거·데이터 보강 필요")}</div>
   <p class="muted">생성 시각 ${esc(p.generated_at||"-")} · 읽기 전용 지원 산출물</p>
  </section>
  <section class="panel full"><h2>연구 작업 팩</h2><div class="task-grid">${items.length?items.map(researchTaskCard).join(""):'<div class="empty">현재 생성된 연구 작업이 없습니다.</div>'}</div></section>
  <section class="panel full"><h2>차단 및 대기 작업</h2>${scrollTable(["범위","리서치 유형","상태","필요 조건"],statusRows)}</section>
  <section class="panel full"><div class="policy">이 화면은 기존 분석 연결 상태만 표시합니다. 모델 자동 실행, 자동 발행, 메모리 변경, 포지션 행동 권한은 없습니다.</div></section>`;
}
function researchExecutionSection(x){
 if(!x)return `<div class="section-label">Approved Execution</div><section class="panel full notice">이 날짜의 실행 추적 정보가 없습니다.</section>`;
 const s=x.summary||{}, tasks=x.executable_tasks||[], receipts=x.receipts||[];
 const receiptRows=receipts.map(r=>{
  const outputs=(r.outputs||[]).map(o=>o.available?`<a target="_blank" rel="noopener" href="/report?path=${encodeURIComponent(o.path)}">${esc(o.path)}</a>`:`<span class="muted">${esc(o.path)} (없음)</span>`).join("<br>")||"-";
  return `<tr><td>${esc(r.executed_at||"-")}</td><td>${esc(r.lead_workflow||"-")}</td><td>${esc(r.task_id||"-")}</td><td>${esc(r.requested_by||"-")}</td><td>${badge(r.outcome,researchStatusLabel(r.outcome))}</td><td class="receipt-note">${esc(r.execution_note||"-")}</td><td>${outputs}</td></tr>`;
 });
 return `<div class="section-label">Approved Execution</div>
  <section class="panel hero"><h2>승인형 전문 분석 실행 추적</h2>
   <div class="metrics">${metric("지금 실행 가능",s.executable_task_count||0,"전용 분석기와 입력 지문 일치")}${metric("실행 완료",s.completed_receipt_count||0,"성공 영수증 기준")}${metric("기존 결과 연결",s.existing_output_count||0,"재실행 불필요")}${metric("차단 작업",s.blocked_task_count||0,"근거·매핑 보강 필요")}${metric("영수증 오류",s.invalid_receipt_count||0,"수동 점검 필요")}</div>
   <p class="muted">상태 조회 전용입니다. 실제 실행은 CLI에서 작업 ID·입력 지문·실행자·사유·확인 문구를 모두 제공해야 합니다.</p>
  </section>
  <section class="panel full"><h2>실행 승인 가능한 작업</h2><div class="task-grid">${tasks.length?tasks.map(researchTaskCard).join(""):'<div class="empty">현재 승인 가능한 새 작업이 없습니다.</div>'}</div></section>
  <section class="panel full"><h2>실행 영수증</h2>${scrollTable(["실행 시각","분석기","작업 ID","실행자","결과","실행 사유","산출물"],receiptRows)}</section>
  ${s.invalid_receipt_count?`<section class="panel full notice">읽을 수 없거나 계약이 맞지 않는 실행 영수증 ${esc(s.invalid_receipt_count)}건이 있습니다. 자동으로 성공 처리하지 않았습니다.</section>`:""}`;
}
function eventCard(x){
 const v=x.verification||{}, s=x.source_summary||{};
 const verified=!!v.primary_fact_confirmed, state=verified?"verified":(v.origin_primary_source_available?"partial":"unverified");
 const stateLabel=verified?"공식 사실 확인":(v.origin_primary_source_available?"원문 확보·추출 대기":"원출처 확인 필요");
 return `<article class="event">
  <div class="event-head"><div><h3>${esc(x.title||x.event_id)}</h3><div class="event-meta">${badge(state,stateLabel)}${badge("partial",x.event_type||"분류 없음")}<span class="muted">게시물 ${esc(s.message_count||0)}건 · 출처 ${esc(s.publisher_count||0)}곳</span></div></div><strong>${esc(x.ranking?.priority_score??"-")}점</strong></div>
  <div class="event-grid">
   <div class="event-block"><h4>확인된 사실</h4>${list(x.common_facts,verified?"구조화된 사실 없음":"검증 완료 전 사실로 표시하지 않음")}</div>
   <div class="event-block"><h4>보도·채널 주장</h4>${list(x.reported_claims,"분리 저장된 주장 없음")}</div>
   <div class="event-block"><h4>고유 관점</h4>${list(x.unique_angles,"고유 관점 추출 대기")}</div>
   <div class="event-block"><h4>충돌·반대 근거</h4>${list(x.conflicting_claims,"확인된 충돌 없음")}</div>
   <div class="event-block wide"><h4>검증 상태</h4><span class="muted">클러스터 ${esc(v.cluster_status||"없음")} · 원출처 ${esc(v.resolution_status||"미확인")} · 본문 추출 ${esc(v.extraction_status||"미실행")}</span></div>
  </div>
 </article>`;
}
function render(m,i,p,x){
 const run=m.run||{}, src=m.source_status||{}, radar=m.breaking_news_radar||{}, memory=m.continuity_memory||{}, queues=m.review_queues||{};
 const brokerCache=m.broker_research_cache||{};
 const sources=src.sources||[], reports=m.report_catalog||[], qs=queues.queues||[];
 const market=i?.market||{}, events=i?.events||{}, items=events.items||[], continuity=i?.continuity||{};
 const unverified=Math.max((events.selected_count||0)-(events.verified_primary_fact_count||0),0);
 const intelligence=i?`
  <div class="section-label">Daily Intelligence</div>
  <section class="panel hero"><div class="regime"><span class="muted">시장 체제</span><strong>${esc(market.regime?.label||"판정 없음")}</strong><span>${esc(market.regime?.summary||"시장 요약이 아직 생성되지 않았습니다.")}</span></div>
  <div class="metrics" style="margin-top:16px">${metric("사건 클러스터",events.cluster_count||0,"수집 게시물을 사건 단위로 통합")}${metric("선별 사건",events.selected_count||0,"상위 8건 이내")}${metric("공식 사실 확인",events.verified_primary_fact_count||0,"원문 추출까지 완료")}${metric("검증 대기",unverified,"사실 확정에서 제외")}${metric("연속성 추적",continuity.summary?.entry_count||0,"가설·섹터·사건")}</div></section>
  ${events.fallback_reason?`<section class="panel full notice">사건 종합 제한: ${esc(events.fallback_reason)}. 검증되지 않은 사건은 관찰 대상으로만 표시됩니다.</section>`:""}
  <section class="panel full"><h2>사건 인텔리전스</h2><div class="event-list">${items.length?items.map(eventCard).join(""):'<div class="empty">선별된 사건이 없습니다.</div>'}</div></section>`:
  `<div class="section-label">Daily Intelligence</div><section class="panel full notice">이 날짜의 V2 Daily Intelligence artifact가 없습니다. 기존 운영 상태만 표시합니다.</section>`;
 const cacheState=!brokerCache.available?"incomplete":brokerCache.all_reports_reused?"ready":brokerCache.analysis_status==="complete"?"partial":"failed";
 const cacheLabel=!brokerCache.available?"분석 기록 없음":brokerCache.all_reports_reused?"전체 재사용":brokerCache.analysis_status==="complete"?"일부 신규 분석":"분석 확인 필요";
 const cachePanel=`<section class="panel hero cache-panel">
  <div class="cache-meta"><h2 style="margin:0">증권사 리서치 분석 캐시</h2>${badge(cacheState,cacheLabel)}<span class="muted">마지막 분석 ${esc(brokerCache.generated_at||"-")}</span></div>
  <div class="metrics cache-metrics">
   ${metric("구조화 리포트",brokerCache.report_count||0,"권한 검증을 통과한 문서")}
   ${metric("캐시 적중",`${brokerCache.cache_hit_count||0}/${brokerCache.report_count||0}`,"기존 분석 재사용")}
   ${metric("재분석",brokerCache.cache_miss_count||0,brokerCache.api_request_performed?"API 요청 발생":"API 요청 없음")}
   ${metric("이번 실행 토큰",brokerCache.api_total_tokens||0,brokerCache.model||"모델 정보 없음")}
  </div>
  <p class="muted" style="margin:12px 0 0">프롬프트 ${esc(brokerCache.prompt_version||"-")} · 원문 캐시 ${brokerCache.source_text_cached?"주의: 저장됨":"저장 안 함"}</p>
 </section>`;
 document.getElementById("app").innerHTML=`${intelligence}${researchPackSection(p)}${researchExecutionSection(x)}
  <div class="section-label">Operations</div>
  ${cachePanel}
  <section class="panel hero"><h2>${esc(m.report_date)} 실행 상태 ${badge(run.status)}</h2>
  <div class="metrics">${metric("실행 모드",run.mode)}${metric("재발행 가능",run.publication_eligible?"가능":"차단")}${metric("수집원",src.summary?.source_count||0)}${metric("활성 검토",queues.active_count||0)}</div></section>
  <section class="panel third"><h2>속보 레이더</h2><div class="metrics" style="grid-template-columns:1fr 1fr">${metric("비발행 후보",radar.publication_blocked_candidate_count||0)}${metric("원출처 필요",radar.requires_primary_source_count||0)}</div><p class="muted">레이더 후보는 사건 탐지에만 사용되며 검증 전 리포트 입력에서 제외됩니다.</p></section>
  <section class="panel third"><h2>발행 번들</h2><p>${badge(run.publication_eligible?"ready":"incomplete")}</p><div class="muted">${esc((m.artifacts?.publication_bundle?.missing||[]).join(", ")||"필수 산출물과 완성 마커 확인")}</div></section>
  <section class="panel third"><h2>연속성 메모리</h2><div class="metrics" style="grid-template-columns:1fr 1fr">${metric("추적 항목",memory.entry_count||0)}${metric("최근 갱신",memory.updated_report_date||"없음")}</div><p class="muted">모델 자동 수정 ${memory.automatic_model_mutation_allowed?"켜짐":"꺼짐"}</p></section>
  <section class="panel half"><h2>수집원 상태</h2>${table(["수집원","상태","건수"],sources.map(x=>`<tr><td>${esc(x.source_id)}</td><td>${badge(x.status)}</td><td>${esc(x.item_count)}</td></tr>`))}</section>
  <section class="panel half"><h2>검토 대기열</h2>${table(["대기열","활성","상태"],qs.map(x=>`<tr><td>${esc(x.queue_id)}</td><td>${esc(x.active_count)}</td><td>${x.available?badge(x.active_count?"review_required":"ready"):badge("incomplete")}</td></tr>`))}</section>
  <section class="panel full"><h2>안전 정책</h2><div class="policy">읽기 전용 · 자동 발행 없음 · 모델 메모리 자동 수정 없음<br>검증되지 않은 주장은 공식 사실과 분리</div></section>
  <section class="panel full"><h2>최근 리포트</h2>${table(["날짜","구분","리포트","크기"],reports.map(x=>`<tr><td>${esc(x.report_date)}</td><td>${esc(x.audience)}</td><td><a target="_blank" rel="noopener" href="/report?path=${encodeURIComponent(x.path)}">${esc(x.title)}</a></td><td>${esc(x.size_bytes)} B</td></tr>`))}</section>`;
}
async function load(date){try{document.getElementById("error").textContent="";const [m,i,p,x]=await Promise.all([json(`/api/manifest?date=${encodeURIComponent(date)}`),optionalJson(`/api/intelligence?date=${encodeURIComponent(date)}`),optionalJson(`/api/research-pack?date=${encodeURIComponent(date)}`),optionalJson(`/api/research-executions?date=${encodeURIComponent(date)}`)]);render(m,i,p,x)}catch(e){document.getElementById("error").textContent=e.message}}
async function init(){try{const d=await json("/api/dates");const s=document.getElementById("date");s.innerHTML=d.dates.map(x=>`<option>${esc(x)}</option>`).join("");if(d.latest){s.value=d.latest;await load(d.latest)}s.onchange=()=>load(s.value);document.getElementById("refresh").onclick=()=>load(s.value)}catch(e){document.getElementById("error").textContent=e.message}}
init();
</script></body></html>"""


def manifest_dates(root: Path = ROOT) -> list[str]:
    directory = root / MANIFEST_RELATIVE_ROOT
    result = []
    for path in directory.glob("*/operations_manifest.json"):
        try:
            date.fromisoformat(path.parent.name)
        except ValueError:
            continue
        result.append(path.parent.name)
    return sorted(set(result), reverse=True)


def load_manifest(report_date: str, root: Path = ROOT) -> dict[str, Any]:
    if report_date not in manifest_dates(root):
        raise FileNotFoundError(f"Operations manifest is unavailable for {report_date}")
    path = root / MANIFEST_RELATIVE_ROOT / report_date / "operations_manifest.json"
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict) or payload.get("schema_version") != "pb_operations_manifest.v1":
        raise ValueError("Unsupported operations manifest")
    return payload


def load_daily_intelligence(
    report_date: str,
    root: Path = ROOT,
) -> dict[str, Any]:
    try:
        date.fromisoformat(report_date)
    except ValueError as exc:
        raise FileNotFoundError("Daily Intelligence date is invalid") from exc
    path = (
        root
        / "workspace"
        / "intelligence"
        / report_date
        / "daily_intelligence.json"
    )
    if not path.is_file():
        raise FileNotFoundError(
            f"Daily Intelligence is unavailable for {report_date}"
        )
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != "daily_market_intelligence.v2"
        or payload.get("report_date") != report_date
    ):
        raise ValueError("Unsupported Daily Intelligence artifact")
    return payload


def load_research_execution_pack(
    report_date: str,
    root: Path = ROOT,
) -> dict[str, Any]:
    try:
        date.fromisoformat(report_date)
    except ValueError as exc:
        raise FileNotFoundError("Research Pack date is invalid") from exc
    path = (
        root
        / "workspace"
        / "intelligence"
        / report_date
        / "research_execution_pack.json"
    )
    if not path.is_file():
        raise FileNotFoundError(
            f"Research Pack is unavailable for {report_date}"
        )
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != "research_execution_pack.v1"
        or payload.get("report_date") != report_date
    ):
        raise ValueError("Unsupported Research Pack artifact")
    return payload


def _receipt_output(
    value: Any,
    *,
    root: Path,
) -> dict[str, Any] | None:
    candidate = str(value or "").strip().replace("\\", "/")
    if not candidate or Path(candidate).is_absolute():
        return None
    resolved = (root / candidate).resolve()
    allowed = [(root / directory).resolve() for directory in REPORT_ROOTS]
    if not any(
        resolved == directory or directory in resolved.parents
        for directory in allowed
    ):
        return None
    return {
        "path": candidate,
        "available": resolved.is_file(),
    }


def load_research_execution_status(
    report_date: str,
    root: Path = ROOT,
) -> dict[str, Any]:
    pack = load_research_execution_pack(report_date, root)
    receipt_dir = (
        root
        / "workspace"
        / "intelligence"
        / report_date
        / "execution_receipts"
    )
    receipts: list[dict[str, Any]] = []
    invalid_receipt_count = 0
    for path in sorted(receipt_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            if (
                not isinstance(payload, dict)
                or payload.get("schema_version") != RECEIPT_SCHEMA_VERSION
                or payload.get("report_date") != report_date
                or payload.get("outcome")
                not in {"completed", "validated_only"}
                or not payload.get("task_id")
                or not payload.get("input_hash")
            ):
                raise ValueError("Unsupported execution receipt")
            outputs = [
                output
                for output in (
                    _receipt_output(value, root=root)
                    for value in payload.get("expected_outputs") or []
                )
                if output is not None
            ]
            receipts.append(
                {
                    "schema_version": RECEIPT_SCHEMA_VERSION,
                    "receipt_path": path.relative_to(root).as_posix(),
                    "task_id": str(payload["task_id"]),
                    "event_id": payload.get("event_id"),
                    "scope": payload.get("scope"),
                    "lead_workflow": payload.get("lead_workflow"),
                    "input_hash": str(payload["input_hash"]),
                    "requested_by": payload.get("requested_by"),
                    "execution_note": payload.get("execution_note"),
                    "executed_at": payload.get("executed_at"),
                    "dry_run": bool(payload.get("dry_run")),
                    "outcome": payload.get("outcome"),
                    "command_count": len(
                        payload.get("command_results") or []
                    ),
                    "outputs": outputs,
                    "automatic_publication": False,
                    "automatic_memory_mutation": False,
                    "position_action_approved": False,
                }
            )
        except (OSError, ValueError, json.JSONDecodeError):
            invalid_receipt_count += 1
    receipts.sort(
        key=lambda item: str(item.get("executed_at") or ""),
        reverse=True,
    )
    executable = list_executable_tasks(
        pack,
        prior_receipts=receipts,
    )
    work_items = pack.get("work_items") or []
    return {
        "schema_version": "research_execution_status.v1",
        "report_date": report_date,
        "summary": {
            "work_item_count": len(work_items),
            "executable_task_count": len(executable),
            "completed_receipt_count": sum(
                item.get("outcome") == "completed"
                for item in receipts
            ),
            "existing_output_count": sum(
                item.get("execution_status")
                == "existing_output_attached"
                for item in work_items
            ),
            "blocked_task_count": len(pack.get("blocked_tasks") or []),
            "invalid_receipt_count": invalid_receipt_count,
        },
        "executable_tasks": executable,
        "receipts": receipts,
        "policy": {
            "read_only": True,
            "execution_endpoint_available": False,
            "automatic_publication": False,
            "automatic_memory_mutation": False,
            "position_actions_allowed": False,
        },
    }


def safe_report_path(relative: str, root: Path = ROOT) -> Path:
    candidate_text = str(relative or "").strip().replace("\\", "/")
    if not candidate_text or Path(candidate_text).is_absolute():
        raise ValueError("A relative report path is required")
    candidate = (root / candidate_text).resolve()
    allowed = [(root / directory).resolve() for directory in REPORT_ROOTS]
    if not any(candidate == directory or directory in candidate.parents for directory in allowed):
        raise PermissionError("Only reader and operations reports can be opened")
    if candidate.suffix.lower() not in {".md", ".markdown", ".txt", ".html", ".json"}:
        raise PermissionError("Unsupported report format")
    if not candidate.is_file():
        raise FileNotFoundError("Report not found")
    return candidate


class OperationsHandler(BaseHTTPRequestHandler):
    server_version = "PBOperationsConsole/1.0"
    root = ROOT

    def send_bytes(
        self,
        payload: bytes,
        *,
        content_type: str,
        status: HTTPStatus = HTTPStatus.OK,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
        self.end_headers()
        self.wfile.write(payload)

    def send_json(
        self,
        payload: dict[str, Any],
        status: HTTPStatus = HTTPStatus.OK,
    ) -> None:
        self.send_bytes(
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            content_type="application/json; charset=utf-8",
            status=status,
        )

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path == "/":
                self.send_bytes(
                    INDEX_HTML.encode("utf-8"),
                    content_type="text/html; charset=utf-8",
                )
                return
            if parsed.path == "/api/dates":
                dates = manifest_dates(self.root)
                self.send_json({"dates": dates, "latest": dates[0] if dates else None})
                return
            if parsed.path == "/api/manifest":
                dates = manifest_dates(self.root)
                report_date = (query.get("date") or [dates[0] if dates else ""])[0]
                self.send_json(load_manifest(report_date, self.root))
                return
            if parsed.path == "/api/intelligence":
                dates = manifest_dates(self.root)
                report_date = (query.get("date") or [dates[0] if dates else ""])[0]
                self.send_json(load_daily_intelligence(report_date, self.root))
                return
            if parsed.path == "/api/research-pack":
                dates = manifest_dates(self.root)
                report_date = (query.get("date") or [dates[0] if dates else ""])[0]
                self.send_json(
                    load_research_execution_pack(report_date, self.root)
                )
                return
            if parsed.path == "/api/research-executions":
                dates = manifest_dates(self.root)
                report_date = (
                    query.get("date")
                    or [dates[0] if dates else ""]
                )[0]
                self.send_json(
                    load_research_execution_status(
                        report_date,
                        self.root,
                    )
                )
                return
            if parsed.path == "/report":
                relative = (query.get("path") or [""])[0]
                report = safe_report_path(relative, self.root)
                content_type = (
                    "application/json; charset=utf-8"
                    if report.suffix.lower() == ".json"
                    else "text/plain; charset=utf-8"
                )
                self.send_bytes(report.read_bytes(), content_type=content_type)
                return
            self.send_json({"error": "not_found"}, HTTPStatus.NOT_FOUND)
        except (FileNotFoundError, ValueError, PermissionError) as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        self.send_json(
            {"error": "read_only_console"},
            HTTPStatus.METHOD_NOT_ALLOWED,
        )

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[PB console] {self.address_string()} - {format % args}")


def handler_for_root(root: Path) -> type[OperationsHandler]:
    class RootedOperationsHandler(OperationsHandler):
        pass

    RootedOperationsHandler.root = root.resolve()
    return RootedOperationsHandler


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the read-only PB operations console")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("The operations console may bind only to localhost")
    server = ThreadingHTTPServer((args.host, args.port), handler_for_root(ROOT))
    url = f"http://{args.host}:{server.server_port}"
    print(f"PB operations console: {url}")
    print("Read-only mode: no collection, publication, or investment action endpoints.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
