"""Create a visual-first Korean daily report from a reviewed source inbox."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from build_company_underwriting_drafts import underwriting_draft_hash
from approve_company_review_operating_config import operating_config_review_hash
from build_company_review_operating_review_queue import validate_company_review_operating_review_queue
from build_company_thesis_review_calendar import validate_company_thesis_review_calendar
from monitor_company_review_operations import validate_company_review_operations_monitor
from dispatch_company_review_alerts import validate_delivery_plan
from monitor_company_review_alert_followups import validate_company_review_alert_followup_monitor
from build_company_review_alert_sla_summary import validate_company_review_alert_sla_summary
from build_company_review_alert_owner_queue import validate_company_review_alert_owner_queue
from track_company_review_alert_sla_history import validate_company_review_alert_sla_trend
from validate_company_review_alert_completion_evidence import validate_completion_evidence_integrity
from build_company_review_alert_external_evidence_backlog import validate_company_review_alert_external_evidence_backlog
from build_company_review_alert_external_evidence_review_summary import validate_company_review_alert_external_evidence_review_summary
from collectors.common import ROOT, load_dotenv

REQUIRED_HEADINGS = [
    "오늘의 결론",
    "데이터 기준과 수집 상태",
    "시장 스코어보드",
    "전일 가설 점검",
    "향후 이벤트 시나리오",
    "가설 누적 성과",
    "거시 지표와 시장 맥락",
    "ETF 모니터링",
    "해외 뉴스",
    "국내 공시",
    "종목 및 공시",
    "다음 확인 항목",
    "출처 및 유의사항",
]
FINAL_MARKER = "<!-- REPORT_COMPLETE -->"
EVENT_EVIDENCE_HEADING = "핵심 사건 및 근거"
UNDERWRITING_REVIEW_HEADING = "언더라이팅 승인 검토"
OPERATING_REVIEW_HEADING = "운영 설정 승인 검토"
OPERATIONS_MONITOR_HEADING = "운영 알림 모니터"
FOLLOWUP_MONITOR_HEADING = "경고 후속조치 모니터"
SLA_SUMMARY_HEADING = "주간 운영 SLA 요약"
OWNER_QUEUE_HEADING = "운영 담당자 큐"
SLA_TREND_HEADING = "롤링 SLA 추이"
COMPLETION_EVIDENCE_HEADING = "종결 근거 상태"
EXTERNAL_EVIDENCE_BACKLOG_HEADING = "외부 근거 확인 백로그"
EXTERNAL_EVIDENCE_REVIEW_SUMMARY_HEADING = "외부 근거 검토 모니터"
THESIS_REVIEW_CALENDAR_HEADING = "회사 논리 검토 캘린더"


def _compact_review_text(value: Any) -> str:
    return " ".join(str(value or "자료 없음").split())


def _operating_duration_text(rule: Any) -> str:
    if not isinstance(rule, dict) or not rule.get("value") or not rule.get("unit"):
        return "미지정"
    units = {
        "hours": "시간",
        "calendar_days": "일",
        "weekdays_excluding_weekends_only": "영업일(주말 제외)",
    }
    value = rule["value"]
    unit = units.get(str(rule["unit"]), str(rule["unit"]))
    start = rule.get("start_condition")
    return f"{value}{unit}" + (f" · 시작 조건 {start}" if start else "")


def company_thesis_review_calendar_section(payload: dict[str, Any]) -> str:
    """Render confirmed, soft-date, and undated review work without inference."""
    lines = [f"## {THESIS_REVIEW_CALENDAR_HEADING}"]
    companies = payload.get("companies", [])
    if not companies:
        lines.extend([
            "활성 검토 일정이 없습니다. 승인된 회사 언더라이팅이 생긴 뒤에만 검토 캘린더가 열립니다.",
            "- 결정 범위: 일정 생성 없음 · 자동 회사 논리 변경 없음 · 종목 매매 및 포지션 행동 없음",
        ])
        return "\n".join(lines)

    lines.append(
        f"확정 검토 {payload.get('confirmed_review_count', 0)}건 · "
        f"예상 날짜 후보 {payload.get('soft_date_candidate_count', 0)}건 · "
        f"날짜 미정 핵심 증거 {payload.get('undated_proof_count', 0)}건"
    )
    for company in companies:
        ticker = _compact_review_text(company.get("ticker"))
        name = _compact_review_text(company.get("company_name"))
        operating_model = company.get("operating_model") or {}
        operating_config_applied = company.get("operating_config_status") == "approved_operating_config_applied"
        lines.extend([
            f"- {ticker} · {name} · {company.get('calendar_status', '자료 없음')}",
            f"  - 회사 논리 상태: {company.get('company_thesis_status', '자료 없음')}",
            f"  - 다음 검토 게이트: {_compact_review_text(company.get('next_review_gate'))}",
        ])
        if operating_config_applied:
            lines.extend([
                f"  - 운영 설정: 승인됨 · v{company.get('operating_config_version')} · "
                f"검토 주기 {_compact_review_text(operating_model.get('review_cadence'))}",
                f"  - 역할: PM {_compact_review_text(operating_model.get('pm_owner'))} · "
                f"분석 {_compact_review_text(operating_model.get('analyst_owner'))} · "
                f"증거 {_compact_review_text(operating_model.get('evidence_owner'))} · "
                f"KPI {_compact_review_text(operating_model.get('kpi_owner'))} · "
                f"모델 {_compact_review_text(operating_model.get('model_owner'))} · "
                f"결정 기록 {_compact_review_text(operating_model.get('decision_log_owner'))}",
                f"  - 내부 정기 검토: {_compact_review_text(company.get('next_scheduled_review_date'))} · "
                f"{company.get('next_scheduled_review_status', '자료 없음')}",
            ])
            triggers = operating_model.get("escalation_triggers") or []
            if triggers:
                lines.append(f"  - 상향 보고 조건: {' / '.join(str(value) for value in triggers)}")
        else:
            lines.append("  - 운영 설정: 승인된 설정 없음 · 담당자·주기·기한 자동 추정 금지")
        source_map = {
            str(source.get("source_id")): source
            for source in company.get("source_index", []) if source.get("source_id")
        }
        for index, review in enumerate(company.get("dated_reviews", []), start=1):
            source = source_map.get(str(review.get("source_id")), {})
            location = str(source.get("source_location") or "").split(" | ", 1)[0]
            source_name = _compact_review_text(source.get("source_name") or review.get("source_id"))
            source_label = f"[{source_name}]({location})" if location.startswith(("https://", "http://")) else source_name
            prep_owner = _compact_review_text(review.get("prep_owner") or "담당자 미지정")
            prep_due = _compact_review_text(review.get("prep_due_date") or "준비 마감 미지정")
            sla = _operating_duration_text(review.get("post_event_update_sla"))
            lines.extend([
                f"  - 확정 일정 {index}: {review.get('event_date')} · {review.get('event_name')} "
                f"· {review.get('time_of_day') or '시간 미정'} · {review.get('time_zone') or '시간대 미정'}",
                f"  - 확정 근거 {index}: {source_label} · source date {_compact_review_text(review.get('source_date'))}",
                f"  - 사전 준비 {index}: {' / '.join(review.get('prep_required', [])) or '자료 없음'}",
                f"  - 사후 연결 {index}: {' → '.join(review.get('post_event_handoff', [])) or '자료 없음'}",
                f"  - 담당·기한 {index}: {prep_owner} · {prep_due} · 사후 업데이트 SLA {sla}",
            ])
        for index, candidate in enumerate(company.get("soft_date_candidates", []), start=1):
            lines.append(
                f"  - 예상 날짜 후보 {index}: {candidate.get('event_date')} · 정확한 일정으로 사용 금지 "
                f"· 회사 IR 1차 확인 필요"
            )
        for index, proof in enumerate(company.get("undated_proof_queue", []), start=1):
            lines.append(
                f"  - 날짜 미정 증거 {index}: {_compact_review_text(proof.get('pillar_name'))} "
                f"· {_compact_review_text(proof.get('next_proof_point'))} · "
                f"담당 {_compact_review_text(proof.get('owner') or '미지정')} · "
                f"주기 {_compact_review_text(proof.get('review_cadence') or '미지정')}"
            )
        for index, conflict in enumerate(company.get("event_conflicts", []), start=1):
            lines.append(f"  - 일정 충돌 {index}: {_compact_review_text(conflict)}")
        lines.append(
            f"  - 운영 공백: {', '.join(company.get('missing_operating_model_fields', [])) or '없음'}"
        )
    lines.append(
        "- 결정 범위: 캘린더는 회사 논리 재검토만 예약 · 밸류에이션, 기대수익률, 매수·매도·비중 행동은 계속 별도 승인"
    )
    return "\n".join(lines)


def operating_config_approval_review_section(payload: dict[str, Any]) -> str:
    """Render review-ready operating settings without executing approval."""
    candidates = [
        row for row in payload.get("companies", [])
        if row.get("review_status") == "ready_for_user_or_pm_review"
        and row.get("draft_record") and row.get("review_hash")
    ]
    rows = [
        row for row in candidates
        if row["review_hash"] == operating_config_review_hash(row["draft_record"])
    ]
    invalid_hash_count = len(candidates) - len(rows)
    blocked = [row for row in payload.get("companies", []) if row.get("review_status") == "blocked_review_input"]
    completion_required = [
        row for row in payload.get("companies", [])
        if row.get("review_status") == "generated_requires_user_or_pm_completion"
    ]
    lines = [f"## {OPERATING_REVIEW_HEADING}"]
    if not rows:
        lines.append("승인 대기 운영 설정이 없습니다. 완성된 검토 입력이 생기면 해시와 함께 이곳에 표시됩니다.")
        for row in completion_required:
            record = row.get("draft_record") or {}
            policy = record.get("review_policy") or {}
            lines.extend([
                f"- {_compact_review_text(record.get('ticker'))} · {_compact_review_text(record.get('company_name'))} · 운영 설정 입력 필요 v{record.get('version')}",
                f"  - 입력 파일: {_compact_review_text(row.get('input_file'))}",
                f"  - 미입력 항목: {', '.join(row.get('missing_completion_fields', [])) or '자료 없음'}",
                f"  - 미승인 제안값: 주기 {_compact_review_text(policy.get('cadence'))} · "
                f"준비 {_operating_duration_text(policy.get('prep_lead_time'))} · "
                f"SLA {_operating_duration_text(policy.get('post_event_update_sla'))}",
                "  - 다음 단계: 담당자 정보를 채우면 다음 일일 실행에서 검토 해시가 생성됨",
                "  - 결정 범위: 초안은 미승인 · 캘린더 적용 없음 · 포지션 행동 승인 없음",
            ])
        if invalid_hash_count:
            lines.append(f"- 무결성 차단: 검토 해시 불일치 {invalid_hash_count}건 · 다시 생성 필요")
        for row in blocked[:5]:
            lines.append(
                f"- 입력 차단: {_compact_review_text(row.get('ticker'))} v{row.get('version') or '자료 없음'} · "
                f"{_compact_review_text(row.get('block_reason'))}"
            )
        lines.append("- 결정 범위: 자동 승인 없음 · 운영 담당과 검토 기한만 검토 · 종목 매매 및 포지션 행동 승인 없음")
        return "\n".join(lines)

    lines.append(
        f"승인 대기 {len(rows)}건입니다. 아래 해시와 운영 책임을 함께 확인해야 하며, 리포트 열람만으로는 승인되지 않습니다."
    )
    if invalid_hash_count:
        lines.append(f"무결성 검사 실패 {invalid_hash_count}건은 승인 검토에서 제외했습니다.")
    for row in rows:
        record = row["draft_record"]
        owners = record.get("owners") or {}
        policy = record.get("review_policy") or {}
        lines.extend([
            f"- {_compact_review_text(record.get('ticker'))} · {_compact_review_text(record.get('company_name'))} · 승인 전 운영 설정 v{record.get('version')}",
            f"  - 검토 해시: `{row['review_hash']}`",
            f"  - 설정 ID: {_compact_review_text(record.get('operating_config_id'))} · 적용일 {_compact_review_text(record.get('effective_from'))}",
            f"  - 의사결정 권한: {_compact_review_text(owners.get('decision_authority'))} · PM {_compact_review_text(owners.get('pm_owner'))}",
            f"  - 실행 담당: 분석 {_compact_review_text(owners.get('analyst_owner'))} · 증거 {_compact_review_text(owners.get('evidence_owner'))} · "
            f"KPI {_compact_review_text(owners.get('kpi_owner'))} · 모델 {_compact_review_text(owners.get('model_owner'))} · "
            f"기록 {_compact_review_text(owners.get('decision_log_owner'))}",
            f"  - 검토 주기: {_compact_review_text(policy.get('cadence'))} · 다음 내부 검토 {_compact_review_text(policy.get('next_scheduled_review_date'))}",
            f"  - 사전 준비: {_operating_duration_text(policy.get('prep_lead_time'))}",
            f"  - 사후 업데이트 SLA: {_operating_duration_text(policy.get('post_event_update_sla'))}",
            f"  - 상향 보고 조건: {' / '.join(str(value) for value in policy.get('escalation_triggers', [])) or '자료 없음'}",
            f"  - 승인 방법: `approve_company_review_operating_config.py` · 확인 문구 `APPROVE_COMPANY_REVIEW_OPERATIONS` · 위 해시 재확인",
            "  - 결정 범위: 회사 논리 검토 운영만 승인 · 밸류에이션·기대수익률 승인 없음 · 포지션 행동 승인 없음",
        ])
    for row in completion_required:
        record = row.get("draft_record") or {}
        lines.append(
            f"- {_compact_review_text(record.get('ticker'))} · {_compact_review_text(record.get('company_name'))} · "
            f"운영 설정 입력 필요 v{record.get('version')} · "
            f"미입력 {', '.join(row.get('missing_completion_fields', [])) or '자료 없음'}"
        )
    for row in blocked[:5]:
        lines.append(
            f"- 입력 차단: {_compact_review_text(row.get('ticker'))} v{row.get('version') or '자료 없음'} · "
            f"{_compact_review_text(row.get('block_reason'))}"
        )
    return "\n".join(lines)


def company_review_operations_monitor_section(
    payload: dict[str, Any], delivery_plan: dict[str, Any] | None = None,
) -> str:
    """Render deterministic preparation/SLA alerts and bounded delivery status."""
    status_labels = {
        "scheduled": "예정",
        "due_today_unconfirmed": "오늘 마감·완료 미확인",
        "overdue_unconfirmed": "마감 경과·완료 미확인",
        "missed_or_unconfirmed_after_event": "이벤트 경과·완료 미확인",
        "completed_on_time": "기한 내 준비 확인",
        "completed_late": "지연 준비 확인",
        "not_monitored_missing_approved_prep_rule": "승인 준비 규칙 없음",
        "clock_not_started_waiting_verified_primary_results": "검증된 1차 결과 대기",
        "sla_active": "SLA 진행 중",
        "sla_breached_update_unconfirmed": "SLA 경과·업데이트 미확인",
        "completed_within_sla": "SLA 내 업데이트 확인",
        "completed_after_sla": "SLA 경과 후 업데이트 확인",
        "not_monitored_missing_approved_sla": "승인 SLA 없음",
    }
    alert_labels = {
        "normal": "정상",
        "attention_required": "확인 필요",
        "critical_review_required": "즉시 검토 필요",
    }
    reason_labels = {
        "pre_event_preparation_due_date_missed_or_late": "사전 준비 마감 경과 또는 지연",
        "post_event_update_sla_missed_or_late": "사후 업데이트 SLA 경과 또는 지연",
        "confirmed_event_date_changed": "확정 이벤트 날짜 변경",
        "approved_kill_criterion_matched": "승인된 중단 조건 충족",
        "required_primary_evidence_unavailable_after_event": "이벤트 후 필수 1차 자료 미확보",
    }
    lines = [f"## {OPERATIONS_MONITOR_HEADING}"]
    reviews = payload.get("reviews", [])
    delivery_plan = delivery_plan or {}
    policy_label = (
        "승인 정책 적용"
        if delivery_plan.get("approved_policy_status") == "approved_policy_applied"
        else "승인 정책 없음"
    )
    delivery_label = "활성" if delivery_plan.get("delivery_enabled") else "비활성"
    delivery_summary = (
        f"- 외부 전달: {policy_label} · 발송 스위치 {delivery_label} · "
        f"후보 {delivery_plan.get('candidate_count', 0)}건 · "
        f"발송 {delivery_plan.get('sent_count', 0)}건 · 실패 {delivery_plan.get('failed_count', 0)}건 · "
        f"중복·확인·정책 차단 {delivery_plan.get('suppressed_count', 0)}건"
    )
    suppressions = delivery_plan.get("suppressions") or []
    acknowledged_count = sum(
        row.get("reason") == "acknowledged_by_user_or_pm" for row in suppressions
    )
    duplicate_count = sum(
        row.get("reason") == "exact_alert_already_sent" for row in suppressions
    )
    if suppressions:
        delivery_summary += f" · 사용자/PM 확인 {acknowledged_count}건 · 동일 경고 차단 {duplicate_count}건"
    if not reviews:
        lines.extend([
            "모니터링할 승인 운영 설정과 확정 검토 일정의 조합이 없습니다.",
            delivery_summary,
            "- 결정 범위: 회사 논리 및 포지션 행동 변경 없음",
        ])
        return "\n".join(lines)
    lines.append(
        f"검토 {payload.get('monitored_review_count', 0)}건 · 확인 필요 {payload.get('attention_count', 0)}건 · "
        f"즉시 검토 {payload.get('critical_count', 0)}건 · 기준 {_compact_review_text(payload.get('observed_at'))}"
    )
    lines.append(delivery_summary)
    for review in reviews:
        reasons = [reason_labels.get(str(value), str(value)) for value in review.get("escalation_reasons", [])]
        lines.extend([
            f"- {_compact_review_text(review.get('ticker'))} · {_compact_review_text(review.get('event_date'))} · "
            f"{alert_labels.get(str(review.get('alert_level')), _compact_review_text(review.get('alert_level')))}",
            f"  - 사전 준비: {status_labels.get(str(review.get('prep_status')), _compact_review_text(review.get('prep_status')))} · "
            f"담당 {_compact_review_text(review.get('prep_owner'))} · 마감 {_compact_review_text(review.get('prep_due_date'))} · "
            f"최초 확인 {_compact_review_text(review.get('prep_first_observed_at'))}",
            f"  - 사후 SLA: {status_labels.get(str(review.get('sla_status')), _compact_review_text(review.get('sla_status')))} · "
            f"시작 {_compact_review_text(review.get('sla_clock_started_at'))} · "
            f"마감 {_compact_review_text(review.get('sla_deadline'))} · "
            f"업데이트 확인 {_compact_review_text(review.get('formal_update_first_observed_at'))}",
            f"  - 상향 보고: {' / '.join(reasons) or '없음'} · 책임자 {_compact_review_text(review.get('escalation_owner'))}",
            f"  - 투자 판단 상태: 회사 논리 {_compact_review_text(review.get('company_thesis_status'))} · "
            "종목 판단 미완료 · 포지션 행동 wait_for_proof",
            "  - 결정 범위: 외부 전달은 승인 정책·활성 스위치·중복 및 확인 로그로 별도 통제 · 자동 매수·매도·비중 변경 없음",
        ])
    return "\n".join(lines)


def company_review_alert_followup_monitor_section(payload: dict[str, Any]) -> str:
    """Render open acknowledged-alert follow-ups without changing investment posture."""
    status_labels = {
        "acknowledged_followup_assignment_missing": "확인됨·후속조치 미지정",
        "assigned_followup_open": "후속조치 진행 중",
        "assigned_followup_overdue": "후속조치 기한 경과",
        "assigned_followup_completed": "후속조치 완료",
        "assigned_followup_completed_after_due": "후속조치 완료·기한 경과",
    }
    alert_labels = {
        "normal": "정상", "attention_required": "확인 필요",
        "critical_review_required": "즉시 검토 필요",
    }
    reason_labels = {
        "acknowledged_alert_without_followup_assignment": "확인된 경고에 담당·마감·완료 기준이 없음",
        "acknowledged_alert_followup_due_date_missed": "확인된 경고의 후속조치 마감 경과",
    }
    lines = [f"## {FOLLOWUP_MONITOR_HEADING}"]
    rows = payload.get("rows", [])
    if not rows:
        lines.extend([
            "확인된 경고가 없어 추적할 후속조치가 없습니다.",
            "- 결정 범위: 운영 인계 추적만 수행 · 외부 재알림 및 자동 매수·매도·비중 변경 없음",
        ])
        return "\n".join(lines)
    lines.append(
        f"확인 경고 {payload.get('followup_count', 0)}건 · 후속조치 미지정 {payload.get('missing_assignment_count', 0)}건 · "
        f"기한 경과 {payload.get('overdue_count', 0)}건 · 완료 {payload.get('completed_count', 0)}건 · "
        f"완료 지연 {payload.get('completed_after_due_count', 0)}건 · 기준 {_compact_review_text(payload.get('observed_at'))}"
    )
    for row in rows:
        reason = reason_labels.get(str(row.get("escalation_reason")), "없음")
        lines.extend([
            f"- {_compact_review_text(row.get('ticker'))} · {status_labels.get(str(row.get('status')), _compact_review_text(row.get('status')))} · "
            f"{alert_labels.get(str(row.get('alert_level')), _compact_review_text(row.get('alert_level')))}",
            f"  - 확인: {_compact_review_text(row.get('acknowledged_by'))} · {_compact_review_text(row.get('acknowledged_at'))} · "
            f"후속 담당 {_compact_review_text(row.get('owner'))} · 마감 {_compact_review_text(row.get('due_at'))}",
            f"  - 완료 기준: {_compact_review_text(row.get('completion_criteria'))} · 상향 사유: {reason}",
            f"  - 완료 기록: 담당 {_compact_review_text(row.get('completed_by'))} · 시각 {_compact_review_text(row.get('completed_at'))} · "
            f"결과 {_compact_review_text(row.get('completion_outcome'))} · 근거 {row.get('completion_evidence_count', 0)}건",
            "  - 결정 범위: 운영 후속조치 추적만 수행 · 외부 재알림 및 자동 매수·매도·비중 변경 없음",
        ])
    return "\n".join(lines)


def company_review_alert_sla_summary_section(payload: dict[str, Any]) -> str:
    """Render deterministic weekly operational SLA metrics without investment interpretation."""
    lines = [f"## {SLA_SUMMARY_HEADING}"]
    window = payload.get("window") or {}
    flow = payload.get("flow_counts") or {}
    backlog = payload.get("current_backlog") or {}
    metrics = payload.get("metrics") or {}
    lines.extend([
        f"기간 {window.get('start_date', '자료 없음')}~{window.get('end_date', '자료 없음')} · "
        f"확인 {flow.get('acknowledged_in_window', 0)}건 · 배정 {flow.get('assigned_in_window', 0)}건 · "
        f"종결 {flow.get('completed_in_window', 0)}건",
        f"기한 내 종결 {flow.get('completed_within_due_in_window', 0)}건 · 지연 종결 {flow.get('completed_after_due_in_window', 0)}건 · "
        f"미배정 {backlog.get('acknowledged_without_assignment', 0)}건 · 진행 중 기한 경과 {backlog.get('active_overdue_followups', 0)}건",
    ])
    if metrics.get("status") == "available":
        lines.append(
            f"- SLA 지표: 기한 내 종결률 {metrics.get('completion_within_due_rate_pct')}% · "
            f"확인→배정 중앙 {metrics.get('median_assignment_hours')}시간 · "
            f"배정→종결 중앙 {metrics.get('median_completion_hours')}시간"
        )
    else:
        lines.append(
            f"- SLA 지표: 종결 표본 {flow.get('completed_in_window', 0)}건으로 "
            f"최소 표본 {metrics.get('minimum_completion_sample', '자료 없음')}건 미만 · 비율 및 소요 시간은 표시하지 않음"
        )
    priority = payload.get("priority_followups") or []
    if priority:
        lines.append("- 우선 처리:")
        for row in priority:
            lines.append(
                f"  - {_compact_review_text(row.get('ticker'))} · {_compact_review_text(row.get('status'))} · "
                f"담당 {_compact_review_text(row.get('owner'))} · 마감 {_compact_review_text(row.get('due_at'))}"
            )
    lines.append("- 결정 범위: 운영 SLA 추적만 수행 · 외부 알림 및 자동 매수·매도·비중 변경 없음")
    return "\n".join(lines)


def company_review_alert_owner_queue_section(payload: dict[str, Any]) -> str:
    """Render a compact unresolved owner queue from deterministic operational records."""
    lines = [f"## {OWNER_QUEUE_HEADING}"]
    queue = payload.get("queue") or []
    if not queue:
        lines.extend([
            "미완료 운영 경고가 없습니다.",
            "- 결정 범위: 완료된 후속조치는 큐에서 제외 · 외부 알림 및 자동 매수·매도·비중 변경 없음",
        ])
        return "\n".join(lines)
    lines.append(
        f"미완료 {payload.get('unresolved_count', 0)}건 · 즉시 처리 {payload.get('critical_count', 0)}건 · "
        f"배정 필요 {payload.get('high_count', 0)}건 · 진행 중 {payload.get('normal_count', 0)}건 · "
        f"완료 제외 {payload.get('completed_excluded_count', 0)}건"
    )
    owners = payload.get("owner_summary") or []
    if owners:
        lines.append("- 담당자별: " + " / ".join(
            f"{_compact_review_text(row.get('owner'))} {row.get('unresolved_count', 0)}건"
            for row in owners
        ))
    causes = payload.get("root_cause_summary") or []
    if causes:
        lines.append("- 지연·미배정 사유: " + " / ".join(
            f"{_compact_review_text(row.get('root_cause'))} {row.get('count', 0)}건"
            for row in causes
        ))
    for row in queue[:10]:
        lines.append(
            f"- {_compact_review_text(row.get('ticker'))} · {_compact_review_text(row.get('priority'))} · "
            f"{_compact_review_text(row.get('queue_status'))} · 담당 {_compact_review_text(row.get('owner'))} · "
            f"마감 {_compact_review_text(row.get('due_at'))}\n"
            f"  - 다음 조치: {_compact_review_text(row.get('required_next_action'))} · 원인 {_compact_review_text(row.get('root_cause'))}"
        )
    if len(queue) > 10:
        lines.append(f"- 나머지 {len(queue) - 10}건은 구조화된 운영 큐 산출물에서 확인")
    lines.append("- 결정 범위: 운영 인계와 우선순위만 표시 · 외부 알림 및 자동 매수·매도·비중 변경 없음")
    return "\n".join(lines)


def company_review_alert_sla_trend_section(payload: dict[str, Any]) -> str:
    """Render bounded rolling-window SLA snapshots without overstating week-over-week change."""
    lines = [f"## {SLA_TREND_HEADING}"]
    points = payload.get("points") or []
    if not points:
        lines.extend([
            "누적된 SLA 스냅샷이 없습니다.",
            "- 해석 제한: 롤링 기간 스냅샷이므로 독립 주간 성과 비교를 하지 않음 · 외부 알림 및 자동 매수·매도·비중 변경 없음",
        ])
        return "\n".join(lines)
    lines.append(
        f"최근 {payload.get('point_count', 0)}개 롤링 스냅샷 · 최대 {payload.get('trend_limit', 0)}개 보관 · "
        "각 점은 서로 겹치는 최근 7일 기간이므로 독립 주간 비교가 아님"
    )
    for row in points[-4:]:
        lines.append(
            f"- {row.get('report_date')} · 기간 {row.get('window_start')}~{row.get('window_end')} · "
            f"종결 {row.get('completed_in_window', 0)}건 · 미배정 {row.get('acknowledged_without_assignment', 0)}건 · "
            f"기한 경과 {row.get('active_overdue_followups', 0)}건 · SLA 지표 {row.get('metrics_status')}"
        )
    changes = payload.get("latest_backlog_change") or {}
    if payload.get("point_count", 0) >= 2:
        lines.append(
            f"- 직전 스냅샷 대비: 미배정 {changes.get('acknowledged_without_assignment_delta'):+}건 · "
            f"기한 경과 {changes.get('active_overdue_followups_delta'):+}건"
        )
    else:
        lines.append("- 직전 비교: 스냅샷이 1개여서 변화량을 표시하지 않음")
    lines.append("- 결정 범위: 운영 백로그 추이만 표시 · 외부 알림 및 자동 매수·매도·비중 변경 없음")
    return "\n".join(lines)


def company_review_alert_completion_evidence_section(payload: dict[str, Any]) -> str:
    """Render completion-reference integrity without automated external source claims."""
    lines = [f"## {COMPLETION_EVIDENCE_HEADING}"]
    rows = payload.get("rows") or []
    if not rows:
        lines.extend([
            "점검할 종결 근거가 없습니다.",
            "- 점검 범위: 로컬 경로 존재 여부만 확인 · 외부 URL은 접속하지 않음(자동 확인 없음) · 수동 확인 기록은 운영 근거 상태만 표시 · 종결 및 투자 판단 상태 변경 없음",
        ])
        return "\n".join(lines)
    lines.append(
        f"종결 {payload.get('completion_count', 0)}건 · 로컬 참조 확인 {payload.get('local_references_available_count', 0)}건 · "
        f"수동 외부 확인 기록 {payload.get('external_references_verified_by_user_or_pm_count', 0)}건 · "
        f"외부 확인 대기 {payload.get('external_reference_verification_pending_count', 0)}건 · "
        f"참조 무결성 이슈 {payload.get('reference_integrity_issue_count', 0)}건"
    )
    for row in rows:
        if row.get("completion_status") == "local_references_available":
            continue
        notes = [
            f"{_compact_review_text(reference.get('evidence_id'))}: {_compact_review_text(reference.get('status'))}"
            for reference in row.get("references", []) if reference.get("status") != "local_reference_exists"
        ]
        lines.append(
            f"- {_compact_review_text(row.get('ticker'))} · {_compact_review_text(row.get('completion_status'))} · "
            f"{' / '.join(notes) or '자료 없음'}"
        )
    lines.append("- 점검 범위: 로컬 경로 존재 여부만 확인 · 외부 URL은 접속하지 않음(자동 확인 없음) · 수동 확인 기록은 운영 근거 상태만 표시 · 종결 및 자동 매수·매도·비중 변경 없음")
    return "\n".join(lines)


def company_review_alert_external_evidence_backlog_section(payload: dict[str, Any]) -> str:
    """Render the aging queue without assigning people or fetching external URLs."""
    lines = [f"## {EXTERNAL_EVIDENCE_BACKLOG_HEADING}"]
    rows = payload.get("queue") or []
    if not rows:
        lines.extend([
            "수동 확인 대기 중인 외부 종결 근거가 없습니다.",
            "- 점검 범위: 외부 URL은 접속하지 않음 · 확인은 사용자 또는 PM의 해시 기반 기록만 허용 · 자동 배정·알림·투자 행동 없음",
        ])
        return "\n".join(lines)
    lines.append(
        f"대기 {payload.get('pending_count', 0)}건 · 주간 수동 검토 대상 {payload.get('weekly_manual_review_due_count', 0)}건 · "
        f"검토상 제외 {payload.get('reviewed_no_longer_relevant_excluded_count', 0)}건 · "
        f"위험도 Critical {payload.get('critical_count', 0)} · High {payload.get('high_count', 0)} · Normal {payload.get('normal_count', 0)}"
    )
    for row in rows[:5]:
        lines.append(
            f"- {_compact_review_text(row.get('ticker'))} · {_compact_review_text(row.get('evidence_id'))} · "
            f"대기 {row.get('pending_age_days', 0)}일 · {_compact_review_text(row.get('queue_status'))} · 담당자 미지정"
        )
    if len(rows) > 5:
        lines.append(f"- 추가 {len(rows) - 5}건은 운영 산출물에서 확인")
    lines.append("- 결정 범위: 외부 근거 수동 확인 순서만 표시 · URL 자동 접속·자동 배정·자동 매수·매도·비중 변경 없음")
    return "\n".join(lines)


def company_review_alert_external_evidence_review_summary_section(payload: dict[str, Any]) -> str:
    """Render review throughput separately from evidence or investment conclusions."""
    lines = [f"## {EXTERNAL_EVIDENCE_REVIEW_SUMMARY_HEADING}"]
    active = payload.get("active_backlog") or {}
    flow = payload.get("review_flow") or {}
    if not active.get("pending_count") and not flow.get("recorded_in_window_count"):
        lines.extend(["최근 7일의 외부 근거 검토 기록과 활성 백로그가 없습니다.", "- 결정 범위: 운영 검토 흐름만 표시 · URL 접속·자동 알림·투자 행동 없음"])
        return "\n".join(lines)
    decisions = flow.get("decision_counts") or {}
    lines.append(
        f"활성 대기 {active.get('pending_count', 0)}건 · 주간 검토 미처리 {active.get('unreviewed_weekly_manual_review_due_count', 0)}건 · "
        f"보류 {active.get('deferred_pending_recheck_count', 0)}건 · 대체 근거 요청 {active.get('alternate_evidence_requested_count', 0)}건"
    )
    lines.append(
        f"최근 {payload.get('window', {}).get('days', 7)}일 기록 {flow.get('recorded_in_window_count', 0)}건 · "
        f"보류 {decisions.get('deferred_pending_recheck', 0)} · 대체 근거 요청 {decisions.get('alternate_evidence_requested', 0)} · "
        f"검토상 제외 {decisions.get('reference_no_longer_relevant', 0)}"
    )
    lines.append("- 결정 범위: 운영 검토 흐름만 표시 · URL 접속·자동 알림·자동 매수·매도·비중 변경 없음")
    return "\n".join(lines)


def underwriting_approval_review_section(payload: dict[str, Any]) -> str:
    """Build an immutable, source-bounded review queue outside model prose."""
    candidates = [
        row for row in payload.get("companies", [])
        if row.get("draft_status") == "ready_for_user_or_pm_review"
        and row.get("draft_record")
        and row.get("draft_hash")
    ]
    rows = [
        row for row in candidates
        if row["draft_hash"] == underwriting_draft_hash(row["draft_record"])
    ]
    invalid_hash_count = len(candidates) - len(rows)
    lines = [f"## {UNDERWRITING_REVIEW_HEADING}"]
    if not rows:
        if invalid_hash_count:
            lines.extend([
                f"승인 검토 차단: 초안 무결성 검사 실패 {invalid_hash_count}건. 초안을 다시 생성해야 합니다.",
                "- 결정 범위: 해시 불일치 초안은 표시·승인하지 않음 · 종목 매매 및 포지션 행동 승인 없음",
            ])
            return "\n".join(lines)
        lines.extend([
            "승인 대기 초안이 없습니다. 기존 승인본이 있거나 검증 가능한 기둥과 중단 조건이 아직 부족합니다.",
            "- 결정 범위: 자동 승인 없음 · 회사 논리만 검토 · 종목 매매 및 포지션 행동 승인 없음",
        ])
        return "\n".join(lines)

    lines.append(
        f"승인 대기 {len(rows)}건입니다. 아래 해시와 내용을 함께 검토해야 하며, 리포트 열람만으로는 승인되지 않습니다."
    )
    if invalid_hash_count:
        lines.append(f"무결성 검사 실패 {invalid_hash_count}건은 검토 큐에서 제외했습니다.")
    for row in rows:
        draft = row["draft_record"]
        ticker = _compact_review_text(row.get("ticker") or draft.get("ticker"))
        company_name = _compact_review_text(row.get("company_name") or draft.get("company_name"))
        lines.extend([
            f"- {ticker} · {company_name} · 승인 전 초안",
            f"  - 검토 상태: 사용자/PM 승인 대기 · 버전 {draft.get('version', '자료 없음')}",
            f"  - 초안 해시: `{row['draft_hash']}`",
            f"  - 제안 회사 논리: {_compact_review_text(draft.get('one_sentence_thesis'))}",
            "  - 변형 인식: 미확정 · 사용자/PM이 직접 작성 필요",
            f"  - 투자 기간: {_compact_review_text(draft.get('horizon'))}",
            f"  - 시장 설정: {_compact_review_text(draft.get('market_setup'))}",
        ])
        for index, pillar in enumerate(draft.get("pillars", []), start=1):
            lines.append(
                f"  - 핵심 기둥 {index}: {_compact_review_text(pillar.get('claim'))} "
                f"· 다음 증거: {_compact_review_text(pillar.get('next_proof_point'))}"
            )
        for index, criterion in enumerate(draft.get("kill_criteria", []), start=1):
            values = ", ".join(str(value) for value in criterion.get("match_values", [])) or "자료 없음"
            lines.append(
                f"  - 중단 조건 {index}: {_compact_review_text(criterion.get('claim'))} "
                f"· 판정값 {values} · 승인 상태 {criterion.get('threshold_approval_status', '자료 없음')}"
            )
        for index, source in enumerate(draft.get("source_index", []), start=1):
            name = _compact_review_text(source.get("source_name") or source.get("source_id"))
            location = str(
                source.get("source_location") or source.get("file_tab_page_url_or_location") or ""
            ).split(" | ", 1)[0]
            label = f"[{name}]({location})" if location.startswith(("https://", "http://")) else name
            lines.append(
                f"  - 근거 {index}: {label} · as of {_compact_review_text(source.get('as_of_date'))} "
                f"· 유형 {_compact_review_text(source.get('source_type'))}"
            )
        for index, gap in enumerate(draft.get("open_diligence", []), start=1):
            lines.append(f"  - 남은 실사 {index}: {_compact_review_text(gap)}")
        lines.append(
            f"  - 승인 전달값: {ticker} · 초안 해시 · 수정한 회사 논리 · 변형 인식 · 투자 기간 · 승인자 · 검토 메모"
        )
    lines.append(
        "- 결정 범위: 승인 시 회사 논리의 모니터링 기준만 활성화 · 밸류에이션, 기대수익률, 매수·매도·비중 행동은 계속 미승인"
    )
    return "\n".join(lines)


def load_items(report_date: str, inbox_files: list[str] | None) -> list[dict[str, Any]]:
    paths = [Path(value) for value in inbox_files] if inbox_files else sorted((ROOT / "workspace" / "normalized" / report_date).glob("inbox_*.json"))
    if not paths:
        raise SystemExit(f"No normalized inbox for {report_date}. Run collect_all.py first.")
    unique: dict[str, dict[str, Any]] = {}
    for path in paths:
        if not path.exists():
            raise SystemExit(f"Inbox file does not exist: {path}")
        for item in json.loads(path.read_text(encoding="utf-8")):
            unique[item["id"]] = item
    if not unique:
        raise SystemExit("The selected normalized inbox has no items.")
    return sorted(unique.values(), key=lambda item: item.get("published_at", ""), reverse=True)


def response_text(payload: dict[str, Any]) -> str:
    if payload.get("output_text"):
        return str(payload["output_text"]).strip()
    parts: list[str] = []
    for output in payload.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text":
                parts.append(content.get("text", ""))
    return "\n".join(parts).strip()


def _reader_text(value: Any, fallback: str = "자료 없음") -> str:
    return " ".join(str(value or fallback).split())


def _reader_verification_label(source: dict[str, Any]) -> str:
    role = str(source.get("source_role") or "")
    label = str(source.get("evidence_label") or "")
    if role == "origin_primary" and label == "fact_source_reported":
        return "공식 원문 본문 확인"
    if role == "origin_primary":
        return "1차 자료 링크 확인·본문 미검토"
    if label == "secondary_metadata_unverified":
        return "2차 보도·본문 미검증"
    return "검증 범위 미확인"


def _event_maps(snapshot: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    structured = snapshot.get("structured_event_evidence") or {}
    synthesis = snapshot.get("event_impact_synthesis") or {}
    structured_events = {
        str(item.get("event_id") or ""): item
        for item in structured.get("events", [])
    }
    synthesis_events = {
        str(item.get("event_id") or ""): item
        for item in synthesis.get("events", [])
    }
    return structured_events, synthesis_events


def _evidence_links(
    evidence_ids: list[str],
    ledger: dict[str, dict[str, Any]],
) -> str:
    links: list[str] = []
    for evidence_id in dict.fromkeys(str(value) for value in evidence_ids):
        source = ledger.get(evidence_id, {})
        url = str(source.get("url") or "")
        publisher = _reader_text(source.get("publisher"), "출처")
        grade = _reader_text(source.get("source_grade"), "미분류")
        label = f"{publisher}·등급 {grade}"
        links.append(f"[{label}]({url})" if url.startswith(("https://", "http://")) else f"{label}·URL 없음")
    return " / ".join(links) or "직접 연결된 근거 없음"


def validate_event_reader_gate(snapshot: dict[str, Any]) -> None:
    """Ensure every published event claim resolves to reader-visible evidence."""
    synthesis = snapshot.get("event_impact_synthesis") or {}
    if synthesis.get("synthesis_status") != "completed":
        return
    structured_events, synthesis_events = _event_maps(snapshot)
    selected_ids = {str(value) for value in synthesis.get("selected_event_ids", [])}
    if selected_ids != set(synthesis_events):
        raise ValueError("Selected event IDs and synthesized event results do not match")

    for event_id, result in synthesis_events.items():
        source_event = structured_events.get(event_id)
        if not source_event:
            raise ValueError(f"Synthesized event has no structured evidence: {event_id}")
        ledger = {
            str(item.get("evidence_id") or ""): item
            for item in source_event.get("evidence_ledger", [])
        }
        if not ledger:
            raise ValueError(f"Synthesized event has no evidence ledger: {event_id}")
        for evidence_id, source in ledger.items():
            url = str(source.get("url") or "")
            if not url.startswith(("https://", "http://")):
                raise ValueError(f"Event evidence is missing a reader URL: {event_id}/{evidence_id}")
            for field in ("source_grade", "source_role", "evidence_label"):
                if not source.get(field):
                    raise ValueError(f"Event evidence is missing {field}: {event_id}/{evidence_id}")

        references: list[str] = []
        for fact in source_event.get("facts", []):
            references.extend(fact.get("evidence_ids", []))
        for claim in source_event.get("reported_claims", []):
            references.extend(claim.get("evidence_ids", []))
        references.extend((result.get("what_is_new") or {}).get("evidence_ids", []))
        for channel in result.get("transmission_channels", []):
            references.extend(channel.get("evidence_ids", []))
            if channel.get("sector_context_status") not in {"evidence_connected", "candidate_unverified"}:
                raise ValueError(f"Event transmission is missing sector verification status: {event_id}")
        for monitor in result.get("monitoring_signals", []):
            references.extend(monitor.get("evidence_ids", []))
        unknown = set(str(value) for value in references) - set(ledger)
        if unknown:
            raise ValueError(
                f"Reader event references unknown evidence IDs: {event_id}/"
                + ", ".join(sorted(unknown))
            )
        if not result.get("priced_in_assessment"):
            raise ValueError(f"Event result is missing priced-in verification status: {event_id}")


def event_evidence_reader_section(snapshot: dict[str, Any]) -> str:
    """Render source-near event conclusions without relying on model prose."""
    synthesis = snapshot.get("event_impact_synthesis") or {}
    lines = [f"### {EVENT_EVIDENCE_HEADING}"]
    if synthesis.get("synthesis_status") != "completed":
        reason = _reader_text(synthesis.get("fallback_reason"), "검증 가능한 상위 사건 없음")
        lines.extend([
            f"- 사건 종합 상태: 미완료 ({reason})",
            "- 독자용 결론을 생성하지 않았습니다. 기사 메타데이터만으로 사실이나 시장 영향을 확정하지 않습니다.",
        ])
        return "\n".join(lines)

    structured_events, synthesis_events = _event_maps(snapshot)
    ranking = {
        str(item.get("event_id") or ""): item
        for item in synthesis.get("event_ranking", [])
    }
    for index, event_id in enumerate(synthesis.get("selected_event_ids", []), start=1):
        event_id = str(event_id)
        result = synthesis_events[event_id]
        source_event = structured_events[event_id]
        ledger = {
            str(item.get("evidence_id") or ""): item
            for item in source_event.get("evidence_ledger", [])
        }
        score = ranking.get(event_id, {})
        lines.extend([
            f"{index}. {_reader_text(source_event.get('representative_title'), event_id)}",
            f"- 검증 상태: {result.get('synthesis_status', 'limited')} · "
            f"우선순위 {score.get('priority_score', '자료 없음')}/100 · "
            f"근거 준비도 {score.get('evidence_readiness_score', '자료 없음')}/35",
            f"- 핵심 해석 [분석 가설]: {_reader_text(result.get('bottom_line'))}",
        ])
        for fact in source_event.get("facts", [])[:3]:
            lines.append(
                f"- 확인된 사실 [공식 원문]: {_reader_text(fact.get('claim'))} "
                f"({_evidence_links(fact.get('evidence_ids', []), ledger)})"
            )
        for claim in source_event.get("reported_claims", [])[:2]:
            lines.append(
                f"- 보도된 주장 [미검증]: {_reader_text(claim.get('claim'))} "
                f"({_evidence_links(claim.get('evidence_ids', []), ledger)})"
            )
        new = result.get("what_is_new") or {}
        lines.append(
            f"- 새로 달라진 점 [{new.get('status', 'baseline_unknown')}]: "
            f"{_reader_text(new.get('summary'))} "
            f"({_evidence_links(new.get('evidence_ids', []), ledger)})"
        )
        for channel in result.get("transmission_channels", [])[:4]:
            context_label = (
                "기존 근거 연결"
                if channel.get("sector_context_status") == "evidence_connected"
                else "노출 검증 전 후보"
            )
            lines.append(
                f"- 전달 경로 [가설·{context_label}]: {_reader_text(channel.get('channel'))} → "
                f"{_reader_text(channel.get('first_repricing_variable'))} → "
                f"{_reader_text(channel.get('sector_id'))} → "
                f"{_reader_text(channel.get('first_affected_line_item'))} · "
                f"{channel.get('direction', 'unclear')} · {channel.get('timing', '자료 없음')} "
                f"({_evidence_links(channel.get('evidence_ids', []), ledger)})"
            )
        priced = result.get("priced_in_assessment") or {}
        lines.append(
            f"- 가격 반영 판단 [{priced.get('status', 'not_assessable')}]: "
            f"{_reader_text(priced.get('conclusion'))}"
        )
        lines.append(f"- 반대 논리: {_reader_text(result.get('strongest_counterargument'))}")
        for monitor in result.get("monitoring_signals", [])[:3]:
            lines.append(
                f"- 확인 신호 [{monitor.get('role', 'both')}]: {_reader_text(monitor.get('signal'))} "
                f"({_evidence_links(monitor.get('evidence_ids', []), ledger)})"
            )
        lines.append(f"- 연구 대응: {result.get('action_posture', 'wait_for_proof')}")
        gaps = result.get("data_gaps", [])
        if gaps:
            lines.append("- 남은 근거 공백: " + " / ".join(_reader_text(value) for value in gaps))
        lines.append("- 원문 및 검증 범위:")
        for source in ledger.values():
            url = str(source.get("url") or "")
            publisher = _reader_text(source.get("publisher"), "출처")
            title = _reader_text(source.get("title"), "원문")
            grade = _reader_text(source.get("source_grade"), "미분류")
            published = _reader_text(source.get("published_at"), "발행시각 미확인")
            verification = _reader_verification_label(source)
            lines.append(
                f"  - [{publisher} · {title}]({url}) · 등급 {grade} · {verification} · {published}"
            )
    lines.append("- 해석 한계: 일별·5일 수익률은 사건 전후 반응이 아니라 비인과적 시장 맥락입니다.")
    return "\n".join(lines)


def _stock_metric(value: Any, suffix: str = "%") -> str:
    if not isinstance(value, (int, float)):
        return "자료 없음"
    return f"{float(value):+.2f}{suffix}"


def us_stock_analysis_reader_section(
    snapshot: dict[str, Any],
    market_analysis: dict[str, Any] | None = None,
) -> str:
    """Render verified stock cards and keep weaker candidates on a watchlist."""
    screen = snapshot.get("us_equity_candidate_screen") or {}
    analysis = (market_analysis or {}).get("analysis", market_analysis or {})
    cards = {
        str(item.get("ticker")): item
        for item in analysis.get("stock_analysis_cards", [])
        if item.get("ticker")
    }
    shortlist = [
        item for item in screen.get("deep_analysis_shortlist", [])[:3]
        if item.get("ticker")
    ]
    lines = ["### 미국 개별주 분석"]
    if not shortlist:
        lines.append(
            "- 공식 본문 사실과 최신 가격 데이터가 함께 확인된 심층 분석 후보가 없습니다."
        )
    reason_labels = {
        "material_event": "중요 공시·사건",
        "abnormal_spy_relative_move": "SPY 대비 비정상 가격 변동",
        "volume_anomaly": "20일 평균 대비 거래량 이상",
        "sector_or_stock_sector_divergence": "섹터와 종목 간 수익률 괴리",
        "five_session_relative_strength": "5거래일 상대강도 변화",
    }
    for row in shortlist:
        ticker = str(row["ticker"])
        card = cards.get(ticker)
        if not card:
            continue
        company_name = str(row.get("company_name") or ticker)
        reaction = row.get("market_reaction") or {}
        reasons = [
            reason_labels.get(str(reason), str(reason))
            for reason in row.get("selection_reasons", [])
        ]
        lines.extend([
            f"- {company_name} · {ticker} · 심층 조사 후보",
            f"  - 선정 이유 [리서치 우선순위]: {', '.join(reasons) or '자료 없음'} · "
            f"선정 점수 {row.get('selection_score', '자료 없음')}/100",
        ])
        fact_count = 0
        for event in row.get("event_evidence", [])[:2]:
            for fact in event.get("verified_facts", [])[:4]:
                if fact_count >= 4:
                    break
                url = str(fact.get("source_url") or event.get("source_url") or "")
                field = str(fact.get("field") or "공시 사실")
                value = str(fact.get("value_text") or "값 없음")
                status = str(fact.get("evidence_status") or "본문 발췌")
                fact_text = f"{field} = {value} · {status}"
                context = " ".join(str(fact.get("context") or "").split())[:180]
                if context:
                    fact_text += f" · 맥락: {context}"
                if url.startswith(("https://", "http://")):
                    fact_text = f"[{fact_text}]({url})"
                lines.append(f"  - 공식 확인 [본문 발췌 후보]: {fact_text}")
                fact_count += 1
        lines.extend([
            "  - 시장 반응 [인과 미확정]: "
            f"1일 {_stock_metric(reaction.get('return_1d_pct'))} · "
            f"5일 {_stock_metric(reaction.get('return_5d_pct'))} · "
            f"20일 {_stock_metric(reaction.get('return_20d_pct'))} · "
            f"SPY 대비 1일 {_stock_metric(reaction.get('spy_relative_1d_pct'), '%p')} · "
            f"SPY 대비 5일 {_stock_metric(reaction.get('spy_relative_5d_pct'), '%p')} · "
            f"{reaction.get('sector_etf') or '섹터 ETF 자료 없음'} 대비 1일 "
            f"{_stock_metric(reaction.get('sector_relative_1d_pct'), '%p')} · "
            f"거래량 배수 {_stock_metric(reaction.get('volume_ratio_20d'), '배')}",
            f"  - 해석 [분석 가설]: {_reader_text(card.get('market_reaction_interpretation'))}",
            f"  - 섹터 전이 [분석 가설]: {_reader_text(card.get('sector_read_through'))}",
            f"  - 확인 조건: {_reader_text(card.get('confirmation_condition'))}",
            f"  - 무효화 조건: {_reader_text(card.get('invalidation_condition'))}",
            "  - 근거 상태: 공식 본문에서 구조화된 사실 후보와 가격 반응을 함께 확인 · "
            "공시 전체 검토 및 사건-가격 인과관계는 미확정",
            "  - 연구 상태: 심층 조사 후보 · 투자 추천, 목표가격, 포지션 행동 아님",
        ])

    deep_tickers = {str(item.get("ticker")) for item in shortlist}
    watchlist = [
        item for item in screen.get("candidates", [])
        if str(item.get("ticker")) not in deep_tickers
    ][:5]
    if watchlist:
        lines.append("### 이상 움직임 관찰")
        for row in watchlist:
            reasons = [
                reason_labels.get(str(reason), str(reason))
                for reason in row.get("selection_reasons", [])
            ]
            lines.append(
                f"- {row.get('company_name') or row.get('ticker')} · {row.get('ticker')} · "
                f"선정 점수 {row.get('selection_score', '자료 없음')}/100 · "
                f"{', '.join(reasons) or '가격 이상'} · "
                f"근거 공백: {row.get('evidence_status', '공식 사실 미확인')} · 관찰만"
            )
    lines.append(
        "- 카드 해석 범위: 가격·거래량·공식 본문 발췌의 교차 확인이며 매수·매도 판단이 아닙니다."
    )
    return "\n".join(lines)


def source_section(items: list[dict[str, Any]], snapshot: dict[str, Any]) -> str:
    rows: list[str] = ["## 출처 및 유의사항"]
    seen_urls: set[str] = set()
    structured_events, _ = _event_maps(snapshot)
    for event in structured_events.values():
        for source in event.get("evidence_ledger", []):
            url = str(source.get("url") or "")
            if not url.startswith(("https://", "http://")) or url in seen_urls:
                continue
            seen_urls.add(url)
            publisher = _reader_text(source.get("publisher"), "출처")
            title = _reader_text(source.get("title"), "원문")
            grade = _reader_text(source.get("source_grade"), "미분류")
            verification = _reader_verification_label(source)
            evidence_id = _reader_text(source.get("evidence_id"), "근거 ID 없음")
            rows.append(
                f"- [{publisher} · 등급 {grade} · {verification} · {title}]({url}) "
                f"— 근거 ID `{evidence_id}`"
            )
    for item in items:
        url = str(item.get("url") or "").strip()
        canonical_url = str(item.get("canonical_url") or url).strip()
        if canonical_url in seen_urls:
            continue
        if canonical_url:
            seen_urls.add(canonical_url)
        source_id = str(item.get("source_id") or "source")
        publisher = str(item.get("publisher") or source_id)
        provenance = publisher if publisher == source_id else f"{publisher} · {source_id}"
        grade = str(item.get("source_grade") or "미분류")
        link_kind = str(item.get("source_url_kind") or "출처 링크")
        title = str(item.get("title") or "원문")[:120]
        if url.startswith(("https://", "http://")):
            rows.append(f"- [{provenance} · 등급 {grade} · {link_kind} · {title}]({url})")
        elif item.get("source_reference"):
            rows.append(
                f"- {provenance} · 등급 {grade} · 내부 참조 "
                f"`{item['source_reference']}` · 원문 URL 없음"
            )

    scoreboard = snapshot.get("market_scoreboard", {})
    fred_ids: set[str] = set()
    for key in ("vix", "vix3m"):
        metric = scoreboard.get("volatility", {}).get(key) or {}
        if metric.get("series_id"):
            fred_ids.add(metric["series_id"])
    for section, key in (("credit", "high_yield_oas"), ("rates", "nominal_10y"), ("rates", "real_10y")):
        metric = scoreboard.get(section, {}).get(key) or {}
        if metric.get("series_id"):
            fred_ids.add(metric["series_id"])
    for series_id in sorted(fred_ids):
        url = f"https://fred.stlouisfed.org/series/{series_id}"
        if url not in seen_urls:
            rows.append(f"- [FRED · 등급 A · {series_id}]({url})")
    for metric in snapshot.get("korea_market", {}).get("metrics", {}).values():
        url = str(metric.get("source_url") or "")
        if metric.get("status") not in {"available", "stale"} or not url.startswith(("https://", "http://")):
            continue
        if url in seen_urls:
            continue
        seen_urls.add(url)
        provider = str(metric.get("source_provider") or "공식 시장자료")
        metric_id = str(metric.get("metric_id") or "korea_market")
        grade = str(metric.get("source_grade") or "미분류")
        rows.append(f"- [{provider} · 등급 {grade} · {metric_id}]({url})")
    for event in snapshot.get("upcoming_events", []):
        url = str(event.get("source_url") or "")
        if url.startswith(("https://", "http://")) and url not in seen_urls:
            seen_urls.add(url)
            rows.append(f"- [일정 원자료 · {event.get('source', 'source')} · {event.get('title', '이벤트')}]({url})")
    evidence_posture = snapshot.get("source_quality", {}).get("evidence_posture", "자료 없음")
    for driver in snapshot.get("sector_drivers", {}).get("observations", []):
        url = str(driver.get("source_url") or "")
        if url.startswith(("https://", "http://")) and url not in seen_urls:
            seen_urls.add(url)
            owner = str(driver.get("source_owner") or "official source")
            evidence_type = str(driver.get("evidence_type") or "sector evidence")
            summary = str(
                driver.get("evidence_summary") or driver.get("evidence_id") or "sector driver"
            )[:120]
            rows.append(f"- [{owner} / grade A / {evidence_type} / {summary}]({url})")
    for candidate in snapshot.get("company_research_queue", {}).get("candidates", []):
        for url in candidate.get("source_urls", []):
            if str(url).startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{candidate.get('company_name', candidate.get('ticker', 'company'))} / "
                    f"{candidate.get('ticker', 'ticker')} / company research evidence]({url})"
                )
    for context in snapshot.get("company_market_context", {}).get("contexts", []):
        source = context.get("source") or {}
        url = str(source.get("source_url") or "")
        if url.startswith(("https://", "http://")) and url not in seen_urls:
            seen_urls.add(url)
            rows.append(
                f"- [Alpha Vantage / grade B / GLOBAL_QUOTE and OVERVIEW documentation]({url})"
            )
    for company in snapshot.get("company_primary_facts", {}).get("companies", []):
        for url in company.get("source_urls", []):
            if str(url).startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [SEC filing / grade A / {company.get('ticker', 'company')} reported facts]({url})"
                )
    for company in snapshot.get("company_operating_bridge", {}).get("companies", []):
        for evidence in company.get("operating_evidence", []):
            url = str(evidence.get("source_url") or "")
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [Company filing or IR / grade A / {company.get('ticker', 'company')} operating evidence]({url})"
                )
    for profile in snapshot.get("company_tearsheets", {}).get("profiles", []):
        for source in profile.get("source_index", []):
            url = str(source.get("source_location") or source.get("file_tab_page_url_or_location") or "").split(" | ", 1)[0]
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{source.get('owner_or_provider', 'Company source')} / "
                    f"{profile.get('identity', {}).get('ticker', 'company')} / tearsheet evidence]({url})"
                )
    for review in snapshot.get("company_earnings_driver_review", {}).get("reviews", []):
        for source in review.get("source_index", []):
            url = str(source.get("source_location") or "").split(" | ", 1)[0]
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{source.get('owner_or_provider', 'Company source')} / "
                    f"{review.get('ticker', 'company')} / earnings-driver evidence]({url})"
                )
    for company in snapshot.get("company_earnings_events", {}).get("companies", []):
        for source in company.get("source_index", []):
            url = str(source.get("source_location") or "")
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{source.get('owner_or_provider', 'Event source')} / "
                    f"{company.get('ticker', 'company')} / earnings event date]({url})"
                )
    for company in snapshot.get("company_earnings_reaction_context", {}).get("companies", []):
        for source in company.get("source_index", []):
            url = str(source.get("source_location") or "")
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{source.get('owner_or_provider', 'Reaction source')} / "
                    f"{company.get('ticker', 'company')} / earnings reaction context]({url})"
                )
    for company in snapshot.get("company_earnings_scenarios", {}).get("companies", []):
        for source in company.get("source_index", []):
            url = str(source.get("source_location") or "").split(" | ", 1)[0]
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{source.get('owner_or_provider', 'Scenario source')} / "
                    f"{company.get('ticker', 'company')} / earnings thesis-trigger evidence]({url})"
                )
    for company in snapshot.get("company_earnings_results", {}).get("companies", []):
        for source in company.get("source_index", []):
            url = str(source.get("source_location") or "").split(" | ", 1)[0]
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{source.get('owner_or_provider', 'Company source')} / "
                    f"{company.get('ticker', 'company')} / post-earnings primary evidence]({url})"
                )
    for review in snapshot.get("company_earnings_deep_dive", {}).get("reviews", []):
        for source in review.get("source_index", []):
            url = str(source.get("source_location") or "").split(" | ", 1)[0]
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{source.get('owner_or_provider', 'Company source')} / "
                    f"{review.get('ticker', 'company')} / post-earnings review evidence]({url})"
                )
    for update in snapshot.get("company_thesis_update", {}).get("updates", []):
        for source in update.get("source_index", []):
            url = str(source.get("source_location") or "").split(" | ", 1)[0]
            if url.startswith(("https://", "http://")) and url not in seen_urls:
                seen_urls.add(url)
                rows.append(
                    f"- [{source.get('owner_or_provider', source.get('source_name', 'Thesis source'))} / "
                    f"{update.get('ticker', 'company')} / approved thesis-update evidence]({url})"
                )
    evidence_label = {
        "research_grade": "연구용 기준 충족",
        "monitoring_only": "모니터링용",
        "insufficient": "근거 부족",
    }.get(str(evidence_posture), str(evidence_posture))
    quality = snapshot.get("source_quality", {})
    link_coverage = quality.get("link_coverage_pct")
    unique_urls = quality.get("unique_canonical_url_count")
    duplicate_urls = quality.get("duplicate_canonical_url_record_count")
    rows.extend([
        f"- 링크 계보: 연결률 {link_coverage if link_coverage is not None else '자료 없음'}% · "
        f"고유 원문 {unique_urls if unique_urls is not None else '자료 없음'}개 · "
        f"중복 레코드 {duplicate_urls if duplicate_urls is not None else '자료 없음'}개",
        "- 내부 시장 모니터링용 자료이며 매매 권유가 아닙니다.",
        "- 수치·공시·기사에 차이가 있으면 연결된 원자료가 우선합니다.",
        f"- 출처 검증 수준: {evidence_label}",
        FINAL_MARKER,
    ])
    return "\n".join(rows)


def validate_publication_gate(snapshot: dict[str, Any]) -> None:
    """Reject a report before model composition when source lineage is unsafe."""
    validate_event_reader_gate(snapshot)
    quality = snapshot.get("source_quality") or {}
    publication_allowed = quality.get("publication_allowed")
    if publication_allowed is False:
        blockers = quality.get("blockers") or {}
        detail = ", ".join(f"{key}={value}" for key, value in sorted(blockers.items()))
        raise ValueError(f"Source quality gate blocked publication: {detail or 'unknown blocker'}")
    if not quality.get("critical_source_link_complete", False):
        raise ValueError("Primary or required source records are missing original URLs")
    if not quality.get("event_source_links_complete", False):
        raise ValueError("A confirmed event is missing its primary-source URL")


def _scoreboard_value(metric: dict[str, Any] | None, suffix: str = "%") -> str:
    """Format a collected metric without exposing snapshot field names."""
    if not isinstance(metric, dict) or metric.get("value") is None:
        return "자료 없음"
    try:
        return f"{float(metric['value']):.2f}{suffix}"
    except (TypeError, ValueError):
        return "자료 없음"


def _scoreboard_change(value: Any) -> str:
    if value is None:
        return "자료 없음"
    try:
        return f"{float(value):+.2f}%p"
    except (TypeError, ValueError):
        return "자료 없음"


def deterministic_scoreboard_section(snapshot: dict[str, Any]) -> str:
    """Build the scorecard from the snapshot rather than model-rendered keys.

    The model still interprets the cross-asset data in the conclusion, but the
    compact scorecard is a direct display of source-controlled values. This
    keeps field identifiers such as ``rsp_vs_spy_5d_pct`` out of the published
    report and makes the card count/layout stable across daily runs.
    """
    scoreboard = snapshot.get("market_scoreboard") or {}
    breadth = scoreboard.get("breadth") or {}
    volatility = scoreboard.get("volatility") or {}
    credit = scoreboard.get("credit") or {}
    rates = scoreboard.get("rates") or {}

    breadth_values = []
    for label, field in (("1일", "rsp_vs_spy_1d_pct"), ("5일", "rsp_vs_spy_5d_pct"), ("20일", "rsp_vs_spy_20d_pct")):
        value = breadth.get(field)
        breadth_values.append(f"{label} {_scoreboard_change(value)}" if value is not None else f"{label} 자료 없음")

    vix = _scoreboard_value(volatility.get("vix"), "")
    vix3m = _scoreboard_value(volatility.get("vix3m"), "")
    ratio = volatility.get("vix_term_ratio")
    try:
        ratio_text = f"{float(ratio):.2f}" if ratio is not None else "자료 없음"
    except (TypeError, ValueError):
        ratio_text = "자료 없음"

    signal = scoreboard.get("rule_based_signal") or {}
    label = {
        "mild_risk_on": "완만한 위험선호",
        "selective_rotation": "선택적 순환매",
        "mixed": "혼합 신호",
        "neutral": "중립",
        "mild_risk_off": "완만한 위험회피",
    }.get(str(signal.get("label") or ""), "자료 없음")
    score = signal.get("score")
    try:
        score_text = f"점수 {int(score):+d}/±4"
    except (TypeError, ValueError):
        score_text = "점수 자료 없음"

    return "\n".join([
        "## 시장 스코어보드",
        f"- 시장 폭 · RSP/SPY 상대수익률: {' · '.join(breadth_values)}",
        f"- 변동성 · VIX: VIX {vix} · VIX3M {vix3m} · 기간비율 {ratio_text}",
        "- 신용 · 하이일드 OAS: "
        f"{_scoreboard_value(credit.get('high_yield_oas'))} · 5일 변화 {_scoreboard_change(credit.get('spread_change_5d_pct_point'))}",
        "- 금리 · 미국 10년물: "
        f"명목 {_scoreboard_value(rates.get('nominal_10y'))} · 실질 {_scoreboard_value(rates.get('real_10y'))} "
        f"· 실질금리 5일 변화 {_scoreboard_change(rates.get('real_yield_change_5d_pct_point'))}",
        f"- 모니터링 신호: {label} ({score_text}) · 규칙 기반 모니터링이며 매매 신호가 아닙니다.",
    ])


def replace_markdown_section(text: str, heading: str, section: str) -> str:
    """Replace one top-level Markdown section while preserving heading order."""
    pattern = rf"(?ms)^## {re.escape(heading)}\n.*?(?=^## |\Z)"
    updated, replacements = re.subn(pattern, section.rstrip() + "\n\n", text, count=1)
    if replacements != 1:
        raise ValueError(f"Could not replace deterministic section: {heading}")
    return updated


def finalize_brief(
    text: str, items: list[dict[str, Any]], report_date: str, snapshot: dict[str, Any],
    market_analysis: dict[str, Any] | None = None,
) -> str:
    if FINAL_MARKER not in text:
        raise ValueError("Report completion marker is missing; output may be truncated")
    if not text.startswith(f"# {report_date} 리포트"):
        text = f"# {report_date} 리포트\n\n{text}"
    missing = [heading for heading in REQUIRED_HEADINGS if f"## {heading}" not in text]
    if missing:
        raise ValueError("Report is missing required headings: " + ", ".join(missing))
    for index, heading in enumerate(REQUIRED_HEADINGS[:-1]):
        start = text.index(f"## {heading}") + len(f"## {heading}")
        next_heading = REQUIRED_HEADINGS[index + 1]
        end = text.index(f"## {next_heading}", start)
        if not text[start:end].strip():
            raise ValueError(f"Report section is empty: {heading}")
    text = replace_markdown_section(text, "시장 스코어보드", deterministic_scoreboard_section(snapshot))
    prefix = text.split("## 출처 및 유의사항", 1)[0].rstrip()
    event_heading = f"## {REQUIRED_HEADINGS[8]}"
    if event_heading not in prefix:
        raise ValueError("International news heading is missing before event evidence insertion")
    prefix = prefix.replace(
        event_heading,
        f"{event_heading}\n\n{event_evidence_reader_section(snapshot)}",
        1,
    )
    stock_heading = f"## {REQUIRED_HEADINGS[10]}"
    if stock_heading not in prefix:
        raise ValueError("Stock and filing heading is missing before stock-card insertion")
    prefix = prefix.replace(
        stock_heading,
        f"{stock_heading}\n\n"
        f"{us_stock_analysis_reader_section(snapshot, market_analysis)}",
        1,
    )
    result = f"{prefix}\n\n{source_section(items, snapshot)}\n"
    if not result.rstrip().endswith(FINAL_MARKER):
        raise ValueError("Finalized report does not end with completion marker")
    return result


def operations_report(report_date: str, snapshot: dict[str, Any]) -> str:
    """Preserve internal review, approval, and SLA state outside the PB brief."""
    sections = [
        company_thesis_review_calendar_section(
            snapshot.get("company_thesis_review_calendar") or {}
        ),
        company_review_operations_monitor_section(
            snapshot.get("company_review_operations_monitor") or {},
            snapshot.get("company_review_alert_delivery_plan") or {},
        ),
        company_review_alert_followup_monitor_section(
            snapshot.get("company_review_alert_followup_monitor") or {}
        ),
        company_review_alert_completion_evidence_section(
            snapshot.get("company_review_alert_completion_evidence_integrity") or {}
        ),
        company_review_alert_external_evidence_backlog_section(
            snapshot.get("company_review_alert_external_evidence_backlog") or {}
        ),
        company_review_alert_external_evidence_review_summary_section(
            snapshot.get("company_review_alert_external_evidence_review_summary") or {}
        ),
        company_review_alert_sla_summary_section(
            snapshot.get("company_review_alert_sla_summary") or {}
        ),
        company_review_alert_sla_trend_section(
            snapshot.get("company_review_alert_sla_trend") or {}
        ),
        company_review_alert_owner_queue_section(
            snapshot.get("company_review_alert_owner_queue") or {}
        ),
        operating_config_approval_review_section(
            snapshot.get("company_review_operating_review_queue") or {}
        ),
        underwriting_approval_review_section(
            snapshot.get("company_underwriting_drafts") or {}
        ),
    ]
    return "\n\n".join([
        f"# {report_date} 내부 운영 및 검토 로그",
        (
            "> 독자용 PB 시장 리포트와 분리된 내부 산출물입니다. "
            "승인·SLA·담당자·근거 백로그 상태만 보존하며 투자 판단을 생성하지 않습니다."
        ),
        *sections,
    ]) + "\n"


def reader_hypothesis_review(review: dict[str, Any]) -> dict[str, Any]:
    """Hide unstable hit-rate percentages until ten decisive outcomes exist."""
    bounded = dict(review)
    summary = dict(review.get("cumulative_summary") or {})
    counts = dict(summary.get("counts") or {})
    decisive = int(counts.get("hit", 0) or 0) + int(counts.get("miss", 0) or 0)
    summary["decisive_result_count"] = decisive
    summary["minimum_public_sample"] = 10
    if decisive < 10:
        summary.pop("decisive_hit_rate_pct", None)
        summary["reader_performance_status"] = "minimum_sample_not_met"
    else:
        summary["reader_performance_status"] = "available"
    bounded["cumulative_summary"] = summary
    return bounded


def _telegram_priority(record: dict[str, Any]) -> int:
    for tag in record.get("tags") or []:
        match = re.fullmatch(r"telegram_priority_(\d+)", str(tag))
        if match:
            return int(match.group(1))
    return 99


def bounded_source_records(
    records: list[dict[str, Any]],
    *,
    telegram_cluster_limit: int = 3,
    broker_report_limit: int = 5,
    broker_report_chars: int = 6_000,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Keep the full archive while bounding private and Telegram model inputs."""
    non_telegram = [
        record for record in records
        if record.get("source_type") not in {"telegram_commentary", "broker_report"}
    ]
    broker_reports = [
        record for record in records
        if record.get("source_type") == "broker_report"
    ]
    eligible_broker_reports = [
        record for record in broker_reports
        if (record.get("research_rights") or {}).get("analysis_allowed") is True
        and (record.get("research_rights") or {}).get("redistribution_allowed") is False
        and (record.get("research_rights") or {}).get("publication_policy")
        in {"private_analysis_only", "summary_and_link_only"}
    ]
    eligible_broker_reports.sort(
        key=lambda record: str(record.get("published_at") or ""),
        reverse=True,
    )
    selected_broker_reports: list[dict[str, Any]] = []
    for record in eligible_broker_reports[:max(0, broker_report_limit)]:
        bounded_record = dict(record)
        bounded_record["raw_text"] = str(record.get("raw_text") or "")[
            :max(0, broker_report_chars)
        ]
        selected_broker_reports.append(bounded_record)
    telegram = [
        record for record in records
        if record.get("source_type") == "telegram_commentary"
    ]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in telegram:
        cluster = record.get("event_cluster") or {}
        cluster_key = str(
            cluster.get("event_id")
            or record.get("id")
            or record.get("canonical_url")
            or record.get("url")
            or id(record)
        )
        grouped.setdefault(cluster_key, []).append(record)

    def representative_rank(record: dict[str, Any]) -> tuple[Any, ...]:
        cluster = record.get("event_cluster") or {}
        return (
            bool(record.get("linked_urls")),
            int(cluster.get("article_count") or 1),
            -_telegram_priority(record),
            str(record.get("published_at") or ""),
        )

    representatives = [
        max(group, key=representative_rank)
        for group in grouped.values()
    ]
    representatives.sort(key=representative_rank, reverse=True)
    selected_telegram = representatives[:max(0, telegram_cluster_limit)]
    selected_ids = {id(record) for record in selected_telegram}
    bounded = non_telegram + selected_broker_reports + [
        record for record in telegram if id(record) in selected_ids
    ]
    return bounded, {
        "archived_record_count": len(records),
        "input_record_count": len(bounded),
        "archived_broker_report_count": len(broker_reports),
        "eligible_broker_report_count": len(eligible_broker_reports),
        "selected_broker_report_count": len(selected_broker_reports),
        "broker_report_char_limit": max(0, broker_report_chars),
        "archived_telegram_record_count": len(telegram),
        "telegram_cluster_count": len(grouped),
        "selected_telegram_cluster_count": len(selected_telegram),
    }


def request_openai_json(
    request: Request,
    *,
    timeout_seconds: int,
    max_attempts: int,
    backoff_seconds: float,
) -> dict[str, Any]:
    attempts = max(1, max_attempts)
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            retryable = exc.code in {408, 409, 429} or 500 <= exc.code <= 599
            if not retryable or attempt >= attempts:
                raise
            exc.read()
            exc.close()
            retry_after = 0.0
            if exc.headers:
                try:
                    retry_after = float(exc.headers.get("Retry-After") or 0)
                except (TypeError, ValueError):
                    retry_after = 0.0
            delay = max(
                retry_after,
                backoff_seconds * (2 ** (attempt - 1)),
            )
            if delay > 0:
                time.sleep(delay)
        except (TimeoutError, URLError) as exc:
            reason = getattr(exc, "reason", None)
            is_timeout = isinstance(exc, TimeoutError) or isinstance(reason, TimeoutError)
            if not is_timeout:
                raise
            if attempt >= attempts:
                raise SystemExit(
                    "OpenAI brief request timed out "
                    f"after {attempts} attempt(s) at {timeout_seconds}s each."
                ) from exc
            if backoff_seconds > 0:
                time.sleep(backoff_seconds * (2 ** (attempt - 1)))
    raise AssertionError("unreachable")


def create_brief(
    items: list[dict[str, Any]], report_date: str,
    snapshot: dict[str, Any], market_analysis: dict[str, Any], history_review: dict[str, Any],
    sector_review: dict[str, Any], sector_radar: dict[str, Any],
    company_queue: dict[str, Any], company_market_context: dict[str, Any],
    company_valuation_expectations: dict[str, Any],
    company_primary_facts: dict[str, Any],
    company_operating_bridge: dict[str, Any],
    company_tearsheets: dict[str, Any],
    company_earnings_events: dict[str, Any],
    company_earnings_reaction_context: dict[str, Any],
    company_earnings_driver_review: dict[str, Any],
    company_earnings_scenarios: dict[str, Any],
    company_earnings_results: dict[str, Any],
    company_earnings_deep_dive: dict[str, Any],
    company_underwriting: dict[str, Any],
    company_underwriting_drafts: dict[str, Any],
    company_thesis_update: dict[str, Any],
    company_thesis_review_calendar: dict[str, Any],
    company_thesis_review: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set OPENAI_API_KEY in .env before composing a report.")
    model = os.getenv("OPENAI_BRIEF_MODEL", "gpt-5-mini").strip()
    max_output_tokens = int(os.getenv("OPENAI_BRIEF_MAX_OUTPUT_TOKENS", "8000"))
    timeout_seconds = int(os.getenv("OPENAI_BRIEF_TIMEOUT_SECONDS", "180"))
    max_attempts = int(os.getenv("OPENAI_BRIEF_MAX_ATTEMPTS", "2"))
    backoff_seconds = float(os.getenv("OPENAI_BRIEF_RETRY_BACKOFF_SECONDS", "2"))
    telegram_cluster_limit = int(os.getenv("OPENAI_BRIEF_TELEGRAM_CLUSTER_LIMIT", "3"))
    broker_report_limit = int(os.getenv("OPENAI_BRIEF_BROKER_REPORT_LIMIT", "5"))
    broker_report_chars = int(os.getenv("OPENAI_BRIEF_BROKER_REPORT_CHARS", "6000"))
    source_records, source_record_input_audit = bounded_source_records(
        list(snapshot.get("records") or items),
        telegram_cluster_limit=telegram_cluster_limit,
        broker_report_limit=broker_report_limit,
        broker_report_chars=broker_report_chars,
    )
    evidence = json.dumps({
        "source_records": source_records,
        "source_record_input_audit": source_record_input_audit,
        "data_cutoff": snapshot.get("data_cutoff"),
        "source_status": snapshot.get("source_status"),
        "source_summary": snapshot.get("source_summary"),
        "source_quality": snapshot.get("source_quality"),
        "korea_market": snapshot.get("korea_market"),
        "market_scoreboard": snapshot.get("market_scoreboard"),
        "upcoming_events": snapshot.get("upcoming_events"),
        "etf_metrics": snapshot.get("etf_metrics"),
        "etf_leadership": snapshot.get("etf_leadership"),
        "sector_evidence_connections": snapshot.get("sector_evidence_connections"),
        "sector_snapshot_summary": snapshot.get("sector_snapshot_summary"),
        "calculation_warnings": snapshot.get("calculation_warnings"),
        "market_analysis": market_analysis.get("analysis", market_analysis),
        "hypothesis_review": reader_hypothesis_review(history_review),
        "sector_thesis_review": sector_review,
        "sector_leadership_radar": sector_radar,
        "company_research_queue": company_queue,
        "company_market_context": company_market_context,
        "company_valuation_expectations": company_valuation_expectations,
        "company_primary_facts": company_primary_facts,
        "company_operating_bridge": company_operating_bridge,
        "company_tearsheets": company_tearsheets,
        "company_earnings_events": company_earnings_events,
        "company_earnings_reaction_context": company_earnings_reaction_context,
        "company_earnings_driver_review": company_earnings_driver_review,
        "company_earnings_scenarios": company_earnings_scenarios,
        "company_earnings_results": company_earnings_results,
        "company_earnings_deep_dive": company_earnings_deep_dive,
        "company_underwriting": company_underwriting,
        "company_underwriting_drafts": company_underwriting_drafts,
        "company_thesis_update": company_thesis_update,
        "company_thesis_review_calendar": company_thesis_review_calendar,
        "company_thesis_review": company_thesis_review,
    }, ensure_ascii=False, indent=2)
    instructions = f"""Create a private Korean daily market-monitoring report for a securities professional.

The report is visual-first: pre-generated charts will be placed immediately below the conclusion, macro, and ETF headings in Notion. Use only the supplied evidence bundle. Never invent facts, quotes, market prices, article view counts, ETF performance, release dates, or consensus. Do not give buy/sell advice, price targets, or a certain directional call. Keep each original source URL. Do not reproduce third-party articles, research, or images.

The supplied market_analysis is the controlling interpretation. Preserve its market-regime label, confidence, conflicts, and driver logic. Do not silently strengthen its confidence or remove a conflicting signal. The market_scoreboard is the controlling source for all numerical market observations.

Sector IDs and sector_evidence_connections are deterministic research links only. A `low` keyword candidate is not an accepted sector connection, and `needs_exposure_attribution` is not proof of revenue, orders, backlog, margin, or estimate exposure. In sector_snapshot_summary, market_confirmation_score is a price observation only. structural_driver is bounded to its cited policy, rule, forecast, roadmap, or binding commitment, and catalyst_durability measures a confirmed event window rather than expected return. Do not reuse either dimension as proof of earnings or orders. Call a sector scored or ranked only when leadership_score is non-null; otherwise describe the evidence gap and never promote it to leadership or a recommendation.

For NewsAPI and Alpha Vantage stories, translate the headline into Korean, then write: source grade, primary-source confirmation status, bounded summary, why it matters, and original URL. Grade D metadata must be described as reported metadata rather than a confirmed fact. Rank stories by relevance, freshness, and source quality based only on provided records.

Broker-report records are private, operator-authorized analysis inputs, not public source text. Under `## ETF 모니터링`, add `### 증권사 리서치` immediately before the next level-2 heading. Use at most five supplied broker reports. For each retained report show only: publisher, report date, a short paraphrased core view, what changed versus the report's stated prior view when explicitly supported, related sector or ticker, one risk or disconfirming condition, and the original publisher URL or internal source reference. Never quote the report, reproduce its table or chart, repeat a target price or buy/sell rating, or expose more source text than needed for a short independent summary. Clearly label every conclusion as `증권사 견해` rather than a verified market fact. Compare two or more reports only when they address the same topic; describe the result as a selected-report view map, not market consensus. If no rights-approved broker report is supplied, write one compact line saying that no authorized report was available.

Telegram channel posts are discovery and viewpoint leads, never primary evidence. Under `## 해외 뉴스`, add `### 텔레그램 관점 모니터` after the selected international-news groups. Use at most three Telegram-linked event clusters. Collapse posts that share the same linked source URL or event. For each retained cluster show only: a short paraphrased topic, participating channel names, `중복 통합: N건 → 1개 사건`, a bounded one-sentence difference in viewpoints when the supplied text supports it, verification status, and Telegram post links. Never quote a post, reproduce broker research, repeat a target price or buy/sell call, or describe a Telegram-only claim as fact. A channel with `publication_policy: link_only_no_republication` may contribute only its channel name, topic label, and post link. When no Telegram records passed collection and triage, write one compact line saying no eligible Telegram monitoring item was available.

For SEC filings, distinguish confirmed filing facts from monitoring implications. If evidence_scope is `filing_body_excerpt`, use filing_facts only with its exact context and label values as excerpt-verified candidates; do not reinterpret a generic dollar amount as revenue, guidance, or materiality. Mention official Exhibit evidence when filing_body.attachments supplies it. Do not imply that the entire filing was reviewed. If the supplied record is metadata-only, explicitly say that the filing body needs review rather than guessing its content.

For OpenDART records, follow evidence_scope. A `filing_body_excerpt` may support only filing_facts carrying `exact_label_value_excerpt`; preserve the supplied value_text and context, label it as an excerpt-verified candidate, and do not infer omitted terms, dilution, or full financial impact. For `filing_metadata_only`, never infer transaction terms, amounts, causes, or financial impact from the filing title. Keep the original DART filing link and clearly label any monitoring implication as interpretation.

Return Markdown only, with this exact title and exact heading order:
# {report_date} 리포트
## 오늘의 결론
- Begin with these four compact labels in this exact order: `시장 체제:`, `오늘의 결론:`, `핵심 변수:`, `최우선 리스크:`.
- Show the market-regime label, confidence percentage, and the supplied summary. `핵심 변수` must name the two most important supplied drivers, not generic themes.
- Present one to three key drivers using this exact sequence: `관측 → 해석 → 확인 조건 → 무효화 조건`.
- Include conflicting signals and the most important risk when present.

## 데이터 기준과 수집 상태
- Start with one compact status line using these labels: `생성 시각 · 가격 기준일 · 가격 지연 · 뉴스 범위`.
- State the report generation time zone, latest price as-of date, price basis, calendar_gap_days, and news scope from data_cutoff.
- When the latest price date precedes the report date, explicitly say that a weekend, holiday, or provider timing can explain the gap. Do not make the page look as if stale data were silently treated as current.
- List delayed, missing, skipped, or failed sources. Clearly distinguish an observation period from a release date; never invent a release date when it is null.

## 시장 스코어보드
- Report the supplied RSP/SPY breadth, VIX/VIX3M term ratio, high-yield spread and five-session change, nominal 10-year yield, and real 10-year yield when available.
- For a missing field, write `자료 없음` rather than inferring a value.
- End with one short sentence explaining the deterministic monitoring signal and its conflicts; it is not a trading signal.

## 전일 가설 점검
- Use only hypothesis_review.resolved_today. Show claim, metric baseline/current/change, result as 적중/실패/불명확, and the rule-based reason.
- If it is empty, write one compact sentence saying that no matured prior hypothesis is available. Do not create a retrospective judgment.

## 향후 이벤트 시나리오
- Use only market_analysis.event_scenarios and supplied upcoming_events. Show date, source, baseline, stronger/higher case, weaker/lower case, and monitoring assets.
- If consensus is absent, explicitly write `컨센서스 자료 없음`; never invent a number or event date.

## 가설 누적 성과
- Use only hypothesis_review.cumulative_summary. Show hit, miss, inconclusive, pending, and the decisive-result sample count.
- Show a hit-rate percentage only when reader_performance_status is `available`. When it is `minimum_sample_not_met`, say that the completed sample is below the 10-result publication minimum and do not calculate or display a percentage.
- State that this is process QA, not investment performance. If no decisive result exists, say `판정 표본 없음`.

## 거시 지표와 시장 맥락
- Explain the chart in two to four concise Korean bullets using only the supplied FRED observations and news themes. Name the latest observation date whenever material.
- End this section with `### 한국시장 연결`. Use only korea_market.metrics and korea_market.transmission_gate.
- Show USD/KRW, KOSPI, KOSDAQ, foreign KOSPI cash flow, and foreign KOSPI200 futures flow only when their status is `available`; preserve as_of, unit, 1D, and 5D values.
- When a Korea-market metric is `stale`, show its last as_of and age_days only as a stale reference; do not use its change values for a current directional conclusion.
- When the transmission gate is insufficient, state the available observation and the missing verification variables in one compact sentence. Do not turn U.S. ETF leadership into a Korean-market directional call.

## ETF 모니터링
- Use only etf_leadership.horizons to name the two leaders and two laggards for 1D and 5D, with supplied return_pct and vs_spy_pct values.
- Add one `관측 → 해석 → 확인 조건` sentence that connects ETF leadership to the market regime without claiming causality.
- If etf_leadership is unavailable, say `상대강도 계산 자료 없음` instead of writing generic chart-reading instructions.
- End with one compact caveat that this is a liquid, unlevered monitoring sample and not a ranking or recommendation.
- Add a compact `섹터 가설 변화` subsection using only sector_thesis_review.material_changes and priority_watchlist. Show at most five sectors and preserve each supplied transition label.
- A `market_confirmation_only` transition must never be called a strengthening company thesis. When material_changes is empty, state that no material deterministic sector-thesis transition was detected.
- Treat priority_watchlist as research prioritization only. State the supplied decision_limit and do not convert it into a security recommendation.
- Use sector_leadership_radar.funnel to distinguish `advance_to_deeper_work`, `reunderwrite`, `watchlist`, and `not_ready`. Never rename `persistent_research_candidate` as confirmed future leadership.
- If the radar reports `insufficient_history`, state the observed and required report counts. Price-only transitions cannot create an emerging candidate.
- For an advanced candidate, preserve its `why_now`, `first_rejection`, `priced_in_status`, `what_would_make_it_investable`, and `what_would_kill_it`. If priced_in_status is `data_gap`, do not imply a variant perception or attractive entry.
- Add at most five company_research_queue candidates after the sector funnel. Separate `advance_to_company_diligence`, `verified_exposure_needs_signal`, `exposure_not_proven`, and `deprioritized_or_reunderwrite` exactly as supplied.
- A `valuation_expectations_gated` company is only a deeper-diligence candidate. Show exposure proof, estimate or operating evidence, first rejection, and next workflow; never call it a buy idea. If the queue is empty, state that no sector has passed the company-mapping gate yet.
- For a matching company_market_context row, show the latest price with price_as_of and only the supplied raw valuation multiples. Always label relative valuation `unbenchmarked`; never call a company cheap, expensive, fairly valued, decision-grade, or priced-in without a peer/historical benchmark and a full expectation bar. Preserve missing liquidity, ownership, positioning, and consensus fields as evidence gaps.
- Then use only company_valuation_expectations for the bounded peer screen and estimate-revision bar. `premium_to_watchlist_peer_median`, `discount_to_watchlist_peer_median`, and `near_watchlist_peer_median` describe a small manually configured screen, not cheap/expensive/fair value. Preserve the peer count, primary metric, premium_discount_pct, price as-of, peer-selection caveat, historical-band gap, and `priced_in_status: not_established`.
- Call estimate rows `third-party forward estimates`, not consensus. Show revision direction and estimate as-of when available, and state that company-guidance comparison is not collected. Never create an implied value, price target, selected valuation range, or recommendation.
- For a matching company_primary_facts row, add at most four decision-useful reported metrics. Preserve each metric's form, filed_date, exact period_start/period_end, unit, XBRL concept, evidence label, and direct SEC filing URL. Do not call a duration fact quarterly when the supplied start/end may be year-to-date, and do not calculate growth across unmatched periods.
- Treat guidance only as an `issuer_management_claim` when body-verified primary evidence is supplied. Show guidance-versus-estimate only when `available_exact_period_and_unit`; otherwise preserve the supplied non-comparable reason. Never infer guidance from filing metadata, news, or XBRL facts.
- Use company_operating_bridge to show at most three segment or company-KPI observations per company. Preserve the definition, current/prior periods, units, comparison_status, change_pct, source URL/body location, and transmission_status. `verified_company_operating_signal_not_causal_attribution` means company evidence is consistent with the monitored exposure; it does not prove the sector theme caused the result.
- Keep reported, company-defined, and management-adjusted rows separate. Never present `management_adjusted` as GAAP or use an adjusted metric whose reconciliation is not body-verified. Surface material QA flags, especially missing segment schedules or KPI comparability, and preserve `audit_only_not_full_model_schedule`.
- Use company_tearsheets as the controlling compact issuer baseline and show at most four profiles. For each profile, write one investor-read sentence, up to five key metrics with period/unit/source posture, up to three earnings drivers, Valuation Context, one proof trigger, one falsifier, and only material evidence gaps. Translate evidence labels into Reported, Company-defined, Derived, Provider data, or Not yet sourced. Preserve price_as_of and freshness; if stale, say so.
- A tearsheet is a factual baseline, not a recommendation. Preserve `wait_for_proof`, `priced_in_status: not_established`, and `selected_valuation_range_status: not_supported`. Do not call a company cheap, expensive, fairly valued, investable, or a future winner. Do not repeat the raw queue, valuation, SEC, and operating records after the compact profile except where a source caveat is necessary.
- Use company_earnings_driver_review after each matching tearsheet. When `review_mode` is `earnings_driver_monitoring_not_pre_event_preview`, do not call it an earnings preview and do not invent an earnings date. Show the third-party estimate bar with freeze_as_of, exact period, units, and basis; keep company guidance separate as an issuer claim; then show up to three operating proof points with confirmation conditions, falsifiers, and listen-fors.
- Use company_earnings_events as the controlling source for event timing. A provider row with confidence `expected` is a soft candidate date and must not be described as confirmed. Only `confirmed_primary_exact_date` may supply an exact earnings date. Show provider/primary conflicts and let the newer body-verified company source control.
- If a matching earnings-driver review is `pre_event_preview_ready_input_pack`, call it a verified pre-event input pack, not a completed or trade-ready preview. Preserve the confirmed date, time-of-day/time-zone when supplied, source, estimate freeze, missing reaction bar, and remaining positioning gaps.
- Use company_earnings_reaction_context only as a bounded hurdle reference. Historical returns use the supplied broad close window and raw unadjusted prices; never call them isolated one-day earnings reactions. Show observation count and median absolute reaction only when supplied. Do not infer direction from EPS surprise or past returns.
- An option snapshot may be called an `event hurdle candidate` only when implied_move_status is `event_hurdle_candidate_not_forecast`. If it is `expiry_tenor_volatility_context`, state that the expiry contains substantial non-event time and never label it an earnings implied move. In either case, preserve the option as-of, expiry, source rights posture, and no-forecast limitation.
- Preserve the EPS-quality warning when the provider EPS basis is not verified. If reaction_framework says scenarios were not generated, do not create bull/base/bear cases, an implied move, a stock-reaction forecast, or a position action. End the company block with `wait_for_proof` and the specific source needed to graduate into a real pre-event preview.
- Use company_earnings_scenarios only when `scenario_gate_status` is `conditional_thesis_triggers_available`. Label its three rows as evidence cases, not forecasts: stronger_evidence, within_verified_range, and weaker_evidence. Preserve each supplied threshold, operator, period, units, estimate freeze time, source posture, operating cross-check, thesis effect, and decision limit.
- Never attach probabilities, target prices, expected returns, stock-price direction, or buy/sell/add/trim/exit/hedge actions to an earnings evidence case. Historical or option reaction hurdles remain nondirectional context. End with `wait_for_proof` and hand off only to `earnings_deep_dive_then_thesis_tracker` after source-verified results. If the scenario gate is blocked, list only the supplied gate gaps and do not invent cases.
- Use company_thesis_review as the controlling append-only company monitoring state. Keep company_thesis_status separate from security_thesis_readiness and position_action. A `pre_event_trigger_pack_ready` transition means only that the evidence gate opened; it is not thesis strengthening. Preserve `untested`, `not_decision_grade`, and `wait_for_proof` until a source-verified post-earnings deep dive supplies actuals, KPI quality, model, valuation, and portfolio context. Show material process transitions and the next review gate, not an aggregate score.
- Use company_earnings_results only as a post-earnings source input pack. Show the reported metric versus the exact pre-event trigger and the supplied comparable KPI checks only when `pack_status` is `ready_for_post_earnings_deep_dive`. Preserve period, units, accounting basis, EPS-quality status, transcript status, source IDs, and missing artifacts. A `stronger_evidence` headline case does not by itself strengthen the company thesis. Never turn this input pack into a model revision, valuation conclusion, or position action.
- Use company_earnings_deep_dive only when `review_status` is `source_verified_partial_post_earnings_deep_dive`. Separate the headline result from quality of print, EPS quality, issuer guidance, transcript limitations, model-update packet, and security context. Preserve exact periods, units, accounting basis, source IDs, price_as_of, and every blocker. `research_case_signal` describes evidence direction only; it must not change `company_thesis_status: untested`, `security_thesis_readiness: not_decision_grade`, or `position_action: wait_for_proof`. Do not infer an estimate revision, priced-in conclusion, recurring earnings quality, valuation support, or stock action when the supplied review says these are not established.
- Treat company_underwriting as user/PM-authored internal research, not a verified public fact. Only `approved_original_underwriting_available` may unlock a formal thesis comparison. Never treat a draft, placeholder, or missing underwriting record as approved.
- Do not reproduce company_underwriting_drafts in model-written sections. Code inserts a deterministic `언더라이팅 승인 검토` queue containing the exact hash, claims, rules, sources, and gaps. Never recommend approval or treat a draft threshold as inherited or approved.
- Do not reproduce company_review_operating_review_queue in model-written sections. Code inserts a deterministic `운영 설정 승인 검토` queue containing the exact immutable hash, owners, cadence, prep timing, SLA, and escalation triggers. Viewing the queue never approves it, and operating approval never authorizes a security or position action.
- Do not reproduce company_review_operations_monitor, company_review_alert_delivery_plan, company_review_alert_followup_monitor, company_review_alert_sla_summary, company_review_alert_owner_queue, company_review_alert_sla_trend, company_review_alert_completion_evidence_integrity, company_review_alert_external_evidence_backlog, or company_review_alert_external_evidence_review_summary in model-written sections. Code inserts deterministic operational monitoring with first-observed milestones, the validated delivery plan, acknowledged-alert follow-up status, completion-reference integrity, aging manual-external-evidence backlog and review throughput, weekly SLA aggregation, rolling SLA history, and an unresolved owner queue. External delivery status comes only from the delivery plan and none of these sections changes a security or position action.
- Do not reproduce company_thesis_review_calendar in model-written sections. Code inserts a deterministic `회사 논리 검토 캘린더` that keeps confirmed hard dates, expected soft dates, and undated proof points separate. Never invent prep dates, owners, SLAs, or position actions.
- Use company_thesis_update as the controlling formal company-thesis gate. Show the approved original thesis, mapped core-pillar outcomes, exact kill-criterion checks, status reason, and remaining security-decision gaps only when `update_status` is `formal_company_thesis_update_available`. A company thesis may become strengthening, intact, watch, impaired, or broken, but preserve `security_thesis_readiness: not_decision_grade` and `position_action: wait_for_proof` until model, valuation, downside, benchmark, position, and risk-budget inputs are supplied. Do not convert a broken company thesis into an automatic sell or exit action.

## 해외 뉴스
- Select at most 3 recent international-news records. Group them under one or more of these exact level-3 headings only when relevant: `### 미국 통화정책·시장`, `### 중국·글로벌 경기`, `### AI·기술 인프라`, `### 에너지·원자재`, `### 기업·개별 종목`.
- Prioritize stories with a direct one-to-three-day connection to prices, rates, volatility, commodities, earnings, regulation, or supplied monitoring assets. Down-rank general-interest or structural explainers that have no immediate market transmission path.
- Under each selected level-3 heading, number the stories consecutively. For each, use the exact labels `- 출처 등급:`, `- 1차 자료 확인:`, `- 제한된 요약:`, `- 중요한 이유:`, and `- 원문:`.
- End with `### 텔레그램 관점 모니터`. Apply the Telegram discovery-only and no-republication rules above, and keep this subsection to at most three deduplicated event clusters.

## 국내 공시
- Select at most 3 OpenDART records, prioritizing `filing_body_excerpt` and higher-signal disclosure titles. For each selected record, show company name, filing title, filing date, one short monitoring point, and the original DART URL.
- When evidence_scope is `filing_body_excerpt`, separate `본문 발췌로 확인된 사실` from `해석·추가 확인`. State that the excerpt is bounded and not a complete filing review.
- Show at most four filing_facts per disclosure. Preserve field, value_text, evidence_status, and source URL. When materiality_status is `not_computable`, do not calculate or describe dilution, market-cap impact, or transaction materiality.
- When evidence_scope is `filing_metadata_only`, explicitly state that material terms and investment implications require review of the filing body.
- Do not fill the section with metadata-only titles. If no body-verified record exists, use one compact pending-review sentence and at most one highest-priority metadata record.
- When source_summary.domestic_filing_count is zero, write only `중요 국내 공시 없음(수집 범위 기준).` and do not add a warning card or repeated caveat.

## 종목 및 공시
- Code inserts a deterministic `미국 개별주 분석` subsection from the verified
  candidate screen and schema-constrained stock cards. Do not reproduce, rank,
  or reinterpret those cards in model-written prose.
- Group relevant ticker-linked news and at most 3 SEC records. Prioritize filings with body excerpts or official Exhibit evidence, and separate confirmed facts from monitoring points.
- When source_summary.sec_filing_count is zero, use only `중요 SEC 공시 없음(수집 범위 기준).` Do not create an aside or repeat the OpenDART caveat already stated above.

## 다음 확인 항목
- 3 to 6 concrete, primary-source follow-ups.

## 출처 및 유의사항
- Write only a one-line placeholder because code will replace this section with a deterministic complete source inventory.

End the entire response with this exact marker on its own line:
{FINAL_MARKER}
"""
    body = json.dumps({
        "model": model,
        "instructions": instructions,
        "input": f"Evidence bundle for {report_date}:\n{evidence}",
        "reasoning": {"effort": "minimal"},
        "max_output_tokens": max_output_tokens,
        "store": False,
    }, ensure_ascii=False).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/responses", method="POST", data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        payload = request_openai_json(
            request,
            timeout_seconds=timeout_seconds,
            max_attempts=max_attempts,
            backoff_seconds=backoff_seconds,
        )
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"OpenAI returned HTTP {exc.code}: {detail}") from exc
    text = response_text(payload)
    if not text:
        raise SystemExit("OpenAI returned no text output.")
    if payload.get("status") == "incomplete":
        reason = (payload.get("incomplete_details") or {}).get("reason", "unknown")
        raise SystemExit(f"OpenAI returned incomplete output ({reason}). No file was written.")
    try:
        text = finalize_brief(text, items, report_date, snapshot, market_analysis)
    except ValueError as exc:
        raise SystemExit(f"OpenAI returned an incomplete report ({exc}). No file was written.") from exc
    return text, payload.get("usage", {})


def main() -> None:
    parser = argparse.ArgumentParser(description="Compose a visual-first Korean daily report from a normalized inbox.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Report date in YYYY-MM-DD (default: today)")
    parser.add_argument("--inbox-file", nargs="+", help="Use one or more newly collected inbox JSON files")
    parser.add_argument("--snapshot-file", help="Daily structured snapshot JSON")
    parser.add_argument("--analysis-file", help="Schema-constrained market analysis JSON")
    parser.add_argument("--history-review-file", help="Daily hypothesis review JSON")
    parser.add_argument("--sector-review-file", help="Daily sector thesis review JSON")
    parser.add_argument("--sector-radar-file", help="Persistence-aware sector leadership radar JSON")
    parser.add_argument("--company-queue-file", help="Evidence-gated listed-company research queue JSON")
    parser.add_argument("--company-market-context-file", help="Bounded company quote and valuation context JSON")
    parser.add_argument("--company-valuation-expectations-file", help="Screening-only peer valuation and expectations JSON")
    parser.add_argument("--company-primary-facts-file", help="SEC-reported company fact baseline and verified guidance JSON")
    parser.add_argument("--company-operating-bridge-file", help="Normalized segment and company KPI evidence bridge JSON")
    parser.add_argument("--company-tearsheets-file", help="Compact cited public-company tearsheet JSON")
    parser.add_argument("--company-earnings-events-file", help="Expected and primary-confirmed company earnings event dates JSON")
    parser.add_argument("--company-earnings-reaction-context-file", help="Historical broad-window and option-tenor earnings reaction context JSON")
    parser.add_argument("--company-earnings-driver-review-file", help="Evidence-bounded company earnings-driver monitoring JSON")
    parser.add_argument("--company-earnings-scenarios-file", help="Conditional earnings thesis-trigger table JSON")
    parser.add_argument("--company-earnings-results-file", help="Body-verified post-earnings deep-dive input pack JSON")
    parser.add_argument("--company-earnings-deep-dive-file", help="Source-verified partial post-earnings research review JSON")
    parser.add_argument("--company-underwriting-file", help="User/PM-approved original underwriting registry JSON")
    parser.add_argument("--company-underwriting-drafts-file", help="Source-bounded underwriting drafts awaiting user/PM review JSON")
    parser.add_argument("--company-review-operating-review-queue-file", help="Operating settings awaiting explicit user/PM review JSON")
    parser.add_argument("--company-review-operations-monitor-file", help="Approved preparation and post-event SLA monitoring JSON")
    parser.add_argument("--company-review-alert-delivery-plan-file", help="Approved and deduplicated external alert delivery plan JSON")
    parser.add_argument("--company-review-alert-followup-monitor-file", help="Acknowledged alert follow-up status monitor JSON")
    parser.add_argument("--company-review-alert-sla-summary-file", help="Weekly operational SLA summary JSON")
    parser.add_argument("--company-review-alert-owner-queue-file", help="Unresolved operational owner queue JSON")
    parser.add_argument("--company-review-alert-sla-trend-file", help="Append-only rolling SLA trend JSON")
    parser.add_argument("--company-review-alert-completion-evidence-file", help="Completion evidence integrity monitor JSON")
    parser.add_argument("--company-review-alert-external-evidence-backlog-file", help="Aging manual external-evidence backlog JSON")
    parser.add_argument("--company-review-alert-external-evidence-review-summary-file", help="Weekly external-evidence review monitor JSON")
    parser.add_argument("--company-thesis-update-file", help="Formal company-thesis update gate JSON")
    parser.add_argument("--company-thesis-review-calendar-file", help="Approved company-thesis review calendar JSON")
    parser.add_argument("--company-thesis-review-file", help="Append-only company thesis monitoring review JSON")
    parser.add_argument("--dry-run", action="store_true", help="Validate the input only; do not call OpenAI")
    args = parser.parse_args()
    load_dotenv()
    items = load_items(args.date, args.inbox_file)
    snapshot_path = Path(args.snapshot_file) if args.snapshot_file else ROOT / "workspace" / "snapshots" / args.date / "daily_snapshot.json"
    analysis_path = Path(args.analysis_file) if args.analysis_file else ROOT / "workspace" / "analysis" / args.date / "market_analysis.json"
    history_review_path = Path(args.history_review_file) if args.history_review_file else ROOT / "workspace" / "history" / "reviews" / f"{args.date}.json"
    sector_review_path = Path(args.sector_review_file) if args.sector_review_file else ROOT / "workspace" / "history" / "sector_reviews" / f"{args.date}.json"
    sector_radar_path = Path(args.sector_radar_file) if args.sector_radar_file else ROOT / "workspace" / "history" / "sector_radar" / f"{args.date}.json"
    company_queue_path = Path(args.company_queue_file) if args.company_queue_file else ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json"
    company_market_context_path = Path(args.company_market_context_file) if args.company_market_context_file else ROOT / "workspace" / "company_market_context" / args.date / "company_market_context.json"
    company_valuation_expectations_path = Path(args.company_valuation_expectations_file) if args.company_valuation_expectations_file else ROOT / "workspace" / "company_valuation_expectations" / args.date / "company_valuation_expectations.json"
    company_primary_facts_path = Path(args.company_primary_facts_file) if args.company_primary_facts_file else ROOT / "workspace" / "company_primary_facts" / args.date / "company_primary_facts.json"
    company_operating_bridge_path = Path(args.company_operating_bridge_file) if args.company_operating_bridge_file else ROOT / "workspace" / "company_operating_bridge" / args.date / "company_operating_bridge.json"
    company_tearsheets_path = Path(args.company_tearsheets_file) if args.company_tearsheets_file else ROOT / "workspace" / "company_tearsheets" / args.date / "company_tearsheets.json"
    company_earnings_events_path = Path(args.company_earnings_events_file) if args.company_earnings_events_file else ROOT / "workspace" / "company_earnings_events" / args.date / "company_earnings_events.json"
    company_earnings_reaction_context_path = Path(args.company_earnings_reaction_context_file) if args.company_earnings_reaction_context_file else ROOT / "workspace" / "company_earnings_reaction_context" / args.date / "company_earnings_reaction_context.json"
    company_earnings_driver_review_path = Path(args.company_earnings_driver_review_file) if args.company_earnings_driver_review_file else ROOT / "workspace" / "company_earnings_driver_review" / args.date / "company_earnings_driver_review.json"
    company_earnings_scenarios_path = Path(args.company_earnings_scenarios_file) if args.company_earnings_scenarios_file else ROOT / "workspace" / "company_earnings_scenarios" / args.date / "company_earnings_scenarios.json"
    company_earnings_results_path = Path(args.company_earnings_results_file) if args.company_earnings_results_file else ROOT / "workspace" / "company_earnings_results" / args.date / "company_earnings_results.json"
    company_earnings_deep_dive_path = Path(args.company_earnings_deep_dive_file) if args.company_earnings_deep_dive_file else ROOT / "workspace" / "company_earnings_deep_dive" / args.date / "company_earnings_deep_dive.json"
    company_underwriting_path = Path(args.company_underwriting_file) if args.company_underwriting_file else ROOT / "workspace" / "company_underwriting" / args.date / "company_underwriting.json"
    company_underwriting_drafts_path = Path(args.company_underwriting_drafts_file) if args.company_underwriting_drafts_file else ROOT / "workspace" / "company_underwriting_drafts" / args.date / "company_underwriting_drafts.json"
    company_review_operating_review_queue_path = Path(args.company_review_operating_review_queue_file) if args.company_review_operating_review_queue_file else ROOT / "workspace" / "company_review_operating_review_queue" / args.date / "company_review_operating_review_queue.json"
    company_review_operations_monitor_path = Path(args.company_review_operations_monitor_file) if args.company_review_operations_monitor_file else ROOT / "workspace" / "company_review_operations_monitor" / args.date / "company_review_operations_monitor.json"
    company_review_alert_delivery_plan_path = Path(args.company_review_alert_delivery_plan_file) if args.company_review_alert_delivery_plan_file else ROOT / "workspace" / "company_review_alert_delivery_plans" / args.date / "company_review_alert_delivery_plan.json"
    company_review_alert_followup_monitor_path = Path(args.company_review_alert_followup_monitor_file) if args.company_review_alert_followup_monitor_file else ROOT / "workspace" / "company_review_alert_followup_monitor" / args.date / "company_review_alert_followup_monitor.json"
    company_review_alert_sla_summary_path = Path(args.company_review_alert_sla_summary_file) if args.company_review_alert_sla_summary_file else ROOT / "workspace" / "company_review_alert_sla_summary" / args.date / "company_review_alert_weekly_sla_summary.json"
    company_review_alert_owner_queue_path = Path(args.company_review_alert_owner_queue_file) if args.company_review_alert_owner_queue_file else ROOT / "workspace" / "company_review_alert_owner_queue" / args.date / "company_review_alert_owner_queue.json"
    company_review_alert_sla_trend_path = Path(args.company_review_alert_sla_trend_file) if args.company_review_alert_sla_trend_file else ROOT / "workspace" / "company_review_alert_sla_trend" / args.date / "company_review_alert_sla_trend.json"
    company_review_alert_completion_evidence_path = Path(args.company_review_alert_completion_evidence_file) if args.company_review_alert_completion_evidence_file else ROOT / "workspace" / "company_review_alert_completion_evidence_integrity" / args.date / "company_review_alert_completion_evidence_integrity.json"
    company_review_alert_external_evidence_backlog_path = Path(args.company_review_alert_external_evidence_backlog_file) if args.company_review_alert_external_evidence_backlog_file else ROOT / "workspace" / "company_review_alert_external_evidence_backlog" / args.date / "company_review_alert_external_evidence_backlog.json"
    company_review_alert_external_evidence_review_summary_path = Path(args.company_review_alert_external_evidence_review_summary_file) if args.company_review_alert_external_evidence_review_summary_file else ROOT / "workspace" / "company_review_alert_external_evidence_review_summary" / args.date / "company_review_alert_external_evidence_review_summary.json"
    company_thesis_update_path = Path(args.company_thesis_update_file) if args.company_thesis_update_file else ROOT / "workspace" / "company_thesis_updates" / args.date / "company_thesis_update.json"
    company_thesis_review_calendar_path = Path(args.company_thesis_review_calendar_file) if args.company_thesis_review_calendar_file else ROOT / "workspace" / "company_thesis_review_calendar" / args.date / "company_thesis_review_calendar.json"
    company_thesis_review_path = Path(args.company_thesis_review_file) if args.company_thesis_review_file else ROOT / "workspace" / "history" / "company_thesis_reviews" / f"{args.date}.json"
    if not snapshot_path.exists():
        raise SystemExit(f"Daily snapshot does not exist: {snapshot_path}")
    if not analysis_path.exists():
        raise SystemExit(f"Market analysis does not exist: {analysis_path}")
    if not history_review_path.exists():
        raise SystemExit(f"Hypothesis review does not exist: {history_review_path}")
    if not sector_review_path.exists():
        raise SystemExit(f"Sector thesis review does not exist: {sector_review_path}")
    if not sector_radar_path.exists():
        raise SystemExit(f"Sector leadership radar does not exist: {sector_radar_path}")
    if not company_queue_path.exists():
        raise SystemExit(f"Company research queue does not exist: {company_queue_path}")
    if not company_market_context_path.exists():
        raise SystemExit(f"Company market context does not exist: {company_market_context_path}")
    if not company_valuation_expectations_path.exists():
        raise SystemExit(f"Company valuation expectations does not exist: {company_valuation_expectations_path}")
    if not company_primary_facts_path.exists():
        raise SystemExit(f"Company primary facts does not exist: {company_primary_facts_path}")
    if not company_operating_bridge_path.exists():
        raise SystemExit(f"Company operating bridge does not exist: {company_operating_bridge_path}")
    if not company_tearsheets_path.exists():
        raise SystemExit(f"Company tearsheets do not exist: {company_tearsheets_path}")
    if not company_earnings_events_path.exists():
        raise SystemExit(f"Company earnings events do not exist: {company_earnings_events_path}")
    if not company_earnings_reaction_context_path.exists():
        raise SystemExit(f"Company earnings reaction context does not exist: {company_earnings_reaction_context_path}")
    if not company_earnings_driver_review_path.exists():
        raise SystemExit(f"Company earnings driver review does not exist: {company_earnings_driver_review_path}")
    if not company_earnings_scenarios_path.exists():
        raise SystemExit(f"Company earnings scenarios does not exist: {company_earnings_scenarios_path}")
    if not company_earnings_results_path.exists():
        raise SystemExit(f"Company earnings results does not exist: {company_earnings_results_path}")
    if not company_earnings_deep_dive_path.exists():
        raise SystemExit(f"Company earnings deep dive does not exist: {company_earnings_deep_dive_path}")
    if not company_underwriting_path.exists():
        raise SystemExit(f"Company underwriting does not exist: {company_underwriting_path}")
    if not company_underwriting_drafts_path.exists():
        raise SystemExit(f"Company underwriting drafts do not exist: {company_underwriting_drafts_path}")
    if not company_review_operating_review_queue_path.exists():
        raise SystemExit(f"Company review operating queue does not exist: {company_review_operating_review_queue_path}")
    if not company_review_operations_monitor_path.exists():
        raise SystemExit(f"Company review operations monitor does not exist: {company_review_operations_monitor_path}")
    if not company_review_alert_delivery_plan_path.exists():
        raise SystemExit(f"Company review alert delivery plan does not exist: {company_review_alert_delivery_plan_path}")
    if not company_review_alert_followup_monitor_path.exists():
        raise SystemExit(f"Company review alert follow-up monitor does not exist: {company_review_alert_followup_monitor_path}")
    if not company_review_alert_sla_summary_path.exists():
        raise SystemExit(f"Company review alert SLA summary does not exist: {company_review_alert_sla_summary_path}")
    if not company_review_alert_owner_queue_path.exists():
        raise SystemExit(f"Company review alert owner queue does not exist: {company_review_alert_owner_queue_path}")
    if not company_review_alert_sla_trend_path.exists():
        raise SystemExit(f"Company review alert SLA trend does not exist: {company_review_alert_sla_trend_path}")
    if not company_review_alert_completion_evidence_path.exists():
        raise SystemExit(f"Company review alert completion evidence integrity does not exist: {company_review_alert_completion_evidence_path}")
    if not company_review_alert_external_evidence_backlog_path.exists():
        raise SystemExit(f"Company review alert external evidence backlog does not exist: {company_review_alert_external_evidence_backlog_path}")
    if not company_review_alert_external_evidence_review_summary_path.exists():
        raise SystemExit(f"Company review alert external evidence review summary does not exist: {company_review_alert_external_evidence_review_summary_path}")
    if not company_thesis_update_path.exists():
        raise SystemExit(f"Company thesis update does not exist: {company_thesis_update_path}")
    if not company_thesis_review_calendar_path.exists():
        raise SystemExit(f"Company thesis review calendar does not exist: {company_thesis_review_calendar_path}")
    if not company_thesis_review_path.exists():
        raise SystemExit(f"Company thesis review does not exist: {company_thesis_review_path}")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    market_analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    history_review = json.loads(history_review_path.read_text(encoding="utf-8"))
    sector_review = json.loads(sector_review_path.read_text(encoding="utf-8"))
    sector_radar = json.loads(sector_radar_path.read_text(encoding="utf-8"))
    company_queue = json.loads(company_queue_path.read_text(encoding="utf-8"))
    company_market_context = json.loads(company_market_context_path.read_text(encoding="utf-8"))
    company_valuation_expectations = json.loads(company_valuation_expectations_path.read_text(encoding="utf-8"))
    company_primary_facts = json.loads(company_primary_facts_path.read_text(encoding="utf-8"))
    company_operating_bridge = json.loads(company_operating_bridge_path.read_text(encoding="utf-8"))
    company_tearsheets = json.loads(company_tearsheets_path.read_text(encoding="utf-8"))
    company_earnings_events = json.loads(company_earnings_events_path.read_text(encoding="utf-8"))
    company_earnings_reaction_context = json.loads(company_earnings_reaction_context_path.read_text(encoding="utf-8"))
    company_earnings_driver_review = json.loads(company_earnings_driver_review_path.read_text(encoding="utf-8"))
    company_earnings_scenarios = json.loads(company_earnings_scenarios_path.read_text(encoding="utf-8"))
    company_earnings_results = json.loads(company_earnings_results_path.read_text(encoding="utf-8"))
    company_earnings_deep_dive = json.loads(company_earnings_deep_dive_path.read_text(encoding="utf-8"))
    company_underwriting = json.loads(company_underwriting_path.read_text(encoding="utf-8"))
    company_underwriting_drafts = json.loads(company_underwriting_drafts_path.read_text(encoding="utf-8"))
    company_review_operating_review_queue = json.loads(company_review_operating_review_queue_path.read_text(encoding="utf-8"))
    validate_company_review_operating_review_queue(company_review_operating_review_queue)
    company_review_operations_monitor = json.loads(company_review_operations_monitor_path.read_text(encoding="utf-8"))
    validate_company_review_operations_monitor(company_review_operations_monitor)
    company_review_alert_delivery_plan = json.loads(company_review_alert_delivery_plan_path.read_text(encoding="utf-8"))
    validate_delivery_plan(company_review_alert_delivery_plan)
    company_review_alert_followup_monitor = json.loads(company_review_alert_followup_monitor_path.read_text(encoding="utf-8"))
    validate_company_review_alert_followup_monitor(company_review_alert_followup_monitor)
    company_review_alert_sla_summary = json.loads(company_review_alert_sla_summary_path.read_text(encoding="utf-8"))
    validate_company_review_alert_sla_summary(company_review_alert_sla_summary)
    company_review_alert_owner_queue = json.loads(company_review_alert_owner_queue_path.read_text(encoding="utf-8"))
    validate_company_review_alert_owner_queue(company_review_alert_owner_queue)
    company_review_alert_sla_trend = json.loads(company_review_alert_sla_trend_path.read_text(encoding="utf-8"))
    validate_company_review_alert_sla_trend(company_review_alert_sla_trend)
    company_review_alert_completion_evidence_integrity = json.loads(company_review_alert_completion_evidence_path.read_text(encoding="utf-8"))
    validate_completion_evidence_integrity(company_review_alert_completion_evidence_integrity)
    company_review_alert_external_evidence_backlog = json.loads(company_review_alert_external_evidence_backlog_path.read_text(encoding="utf-8"))
    validate_company_review_alert_external_evidence_backlog(company_review_alert_external_evidence_backlog)
    company_review_alert_external_evidence_review_summary = json.loads(company_review_alert_external_evidence_review_summary_path.read_text(encoding="utf-8"))
    validate_company_review_alert_external_evidence_review_summary(company_review_alert_external_evidence_review_summary)
    company_thesis_update = json.loads(company_thesis_update_path.read_text(encoding="utf-8"))
    company_thesis_review_calendar = json.loads(company_thesis_review_calendar_path.read_text(encoding="utf-8"))
    validate_company_thesis_review_calendar(company_thesis_review_calendar)
    company_thesis_review = json.loads(company_thesis_review_path.read_text(encoding="utf-8"))
    snapshot["company_research_queue"] = company_queue
    snapshot["company_market_context"] = company_market_context
    snapshot["company_valuation_expectations"] = company_valuation_expectations
    snapshot["company_primary_facts"] = company_primary_facts
    snapshot["company_operating_bridge"] = company_operating_bridge
    snapshot["company_tearsheets"] = company_tearsheets
    snapshot["company_earnings_events"] = company_earnings_events
    snapshot["company_earnings_reaction_context"] = company_earnings_reaction_context
    snapshot["company_earnings_driver_review"] = company_earnings_driver_review
    snapshot["company_earnings_scenarios"] = company_earnings_scenarios
    snapshot["company_earnings_results"] = company_earnings_results
    snapshot["company_earnings_deep_dive"] = company_earnings_deep_dive
    snapshot["company_underwriting"] = company_underwriting
    snapshot["company_underwriting_drafts"] = company_underwriting_drafts
    snapshot["company_review_operating_review_queue"] = company_review_operating_review_queue
    snapshot["company_review_operations_monitor"] = company_review_operations_monitor
    snapshot["company_review_alert_delivery_plan"] = company_review_alert_delivery_plan
    snapshot["company_review_alert_followup_monitor"] = company_review_alert_followup_monitor
    snapshot["company_review_alert_sla_summary"] = company_review_alert_sla_summary
    snapshot["company_review_alert_owner_queue"] = company_review_alert_owner_queue
    snapshot["company_review_alert_sla_trend"] = company_review_alert_sla_trend
    snapshot["company_review_alert_completion_evidence_integrity"] = company_review_alert_completion_evidence_integrity
    snapshot["company_review_alert_external_evidence_backlog"] = company_review_alert_external_evidence_backlog
    snapshot["company_review_alert_external_evidence_review_summary"] = company_review_alert_external_evidence_review_summary
    snapshot["company_thesis_update"] = company_thesis_update
    snapshot["company_thesis_review_calendar"] = company_thesis_review_calendar
    snapshot["company_thesis_review"] = company_thesis_review
    try:
        validate_publication_gate(snapshot)
    except ValueError as exc:
        raise SystemExit(f"{exc}. No report was composed.") from exc
    print(f"Loaded {len(items)} unique source item(s) for {args.date}.")
    if args.dry_run:
        print("Dry run complete. No OpenAI request or file write.")
        return
    brief, usage = create_brief(
        items, args.date, snapshot, market_analysis, history_review, sector_review, sector_radar,
        company_queue, company_market_context, company_valuation_expectations, company_primary_facts,
        company_operating_bridge, company_tearsheets, company_earnings_events,
        company_earnings_reaction_context, company_earnings_driver_review,
        company_earnings_scenarios,
        company_earnings_results,
        company_earnings_deep_dive,
        company_underwriting,
        company_underwriting_drafts,
        company_thesis_update,
        company_thesis_review_calendar,
        company_thesis_review,
    )
    output_dir = ROOT / "workspace" / "briefs"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{args.date}_리포트.md"
    output.write_text(brief, encoding="utf-8")
    operations_output_dir = ROOT / "workspace" / "operations_reports"
    operations_output_dir.mkdir(parents=True, exist_ok=True)
    operations_output = operations_output_dir / f"{args.date}_operations.md"
    operations_output.write_text(
        operations_report(args.date, snapshot),
        encoding="utf-8",
    )
    print(f"Brief saved: {output.relative_to(ROOT)}")
    print(f"Operations report saved: {operations_output.relative_to(ROOT)}")
    print(f"Token usage: input={usage.get('input_tokens', 'n/a')}, output={usage.get('output_tokens', 'n/a')}")


if __name__ == "__main__":
    main()
