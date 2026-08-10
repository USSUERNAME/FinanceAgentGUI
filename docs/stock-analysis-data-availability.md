# 종목·시장 분석 데이터 가용성 매핑

## 결론

현재 파이프라인은 공식 공시 기반 기업분석, 가격·거래량 반응, 시장 내부 체력, 공식 경제일정의 뼈대가
있다. 반면 검증된 전체 컨센서스, 추정치 변화, 옵션 내재변동성은 없다. 없는 항목은 추정하지 않고
`자료 부족`으로 고정한다.

컨센서스 공급자는 이번 단계에서 붙이지 않는다. 별도 데이터 계약과 산출 방법을 결정하기 전까지
실적매매의 `market_expectations` 준비도는 통과시키지 않되, 리서치 신뢰등급에는 영향을 주지 않는다.

## 이미 있음 — 이름을 붙여 재배치

| 프레임워크 항목 | 현재 근거·필드 | 처리 |
|---|---|---|
| 티커와 후보 출처 | `stockCandidateVerification.js`의 후보·evidence | 기존 게이트 유지 |
| 공식 공시와 검증 사실 | SEC filing/XBRL, issuer IR, `claims` | 출처 등급을 authoritative로 명시 |
| 사업 요약 | `integratedResearch.businessSummary` | 1단계로 재배치 |
| 재무 3표와 세그먼트 | `financialComparison.rows`, `financialRows`, `segmentRows` | 4단계로 재배치 |
| 가격·거래량 | close, 1/5/20일 수익률, volume, avg_volume_20d, volume_ratio_20d | 거래 적합성·반응에 사용 |
| 밸류 화면 | `valuationScreen` | 섹터별 KPI와 연결 전에는 제한 상태 표시 |
| 촉매·위험·무효화 | catalysts, risks, counterEvidence, invalidationConditions | 7단계로 재배치 |
| 공식 일정 | `collect_official_market_calendar.py` | 시장 1단계에 표시 |
| 시장 내부 체력 | `build_us_constituent_breadth.py`, `build_us_market_internals.py` | 시장 4단계에 표시 |
| 사후 성과 | 후보 등록가와 1주·1개월·3개월 추적 | 8단계 복기와 연결 |

## 수집·계산 확장 가능

| 항목 | 방법 | 주의 | 게이트 처리 |
|---|---|---|---|
| 평균 일거래대금 | 같은 기준일의 종가 × 20일 평균 거래량 | 날짜·통화가 맞을 때만 계산 | 시뮬레이션 후 gate 후보 |
| ATR 비율 | 검증된 OHLC로 ATR/종가 계산 | 수정주가·기간을 기록 | display, 데이 horizon_gate 후보 |
| 시가총액 | 거래소 또는 라이선스 시장 데이터 | 단순 웹 스크래핑 금지 | display |
| 2년·10년·실질금리·2s10s | FRED/Fed/미 재무부 수집 확장 | 시계열 기준 시각 통일 | context |
| DXY·VIX·원자재 | FRED, Cboe, EIA 또는 라이선스 데이터 | 대체 심볼을 공식 지수로 오인 금지 | context |
| 재무 경고 조합 | 공식 재무제표에서 규칙 계산 | 계산식·기간·단위 공개 | display |
| 제품·지역·반복매출 비중 | 공시가 명시한 경우만 추출 | 미공시 값을 추정하지 않음 | display |
| 섹터 KPI | 공시가 해당 KPI를 정의·공개한 경우 | 섹터 사전은 정의만 제공, 값은 만들지 않음 | display |

## 현재 불가 — `자료 부족` 고정

| 항목 | 현재 상태 | 필요한 조건 | 판정 |
|---|---|---|---|
| 검증된 전체 EPS·매출 컨센서스 | 일부 공급자 추정치를 전체 컨센서스로 검증할 수 없음 | 기여자 범위·동결시각·산식이 명확한 licensed estimates | `insufficient` |
| 추정치 상향·하향 변화 | 동일 방법론의 시점별 스냅샷 없음 | verified_full_consensus 시계열 | `insufficient` |
| 옵션 내재변동성·예상 변동폭 | 옵션 체인과 기준시각 없음 | licensed_options_data와 계산 규칙 | `insufficient` |
| 실시간 매수·매도 스프레드 | 호가 데이터 없음 | 거래소 또는 라이선스 quote | `insufficient` |
| 검증된 유통주식수 | 후보 전체에 일관된 근거 없음 | 최신 공시·거래소 기준 데이터 | `insufficient` |
| ARR·NRR·NIM·FFO 등 업종 KPI | 기업별 공시 여부가 다름 | 해당 기업이 정의와 수치를 공시 | 미공시는 `insufficient` |

외부 공급자 추정치는 `provider estimate`로는 표시할 수 있지만 `verified_full_consensus`로 이름을
바꾸지 않는다. 옵션 가격이 없는데 역사적 변동성으로 내재변동성을 대신하지 않는다.

## 다음 의사결정

실적매매 축을 활성화하려면 컨센서스 데이터 소스를 별도 결정해야 한다. 평가 기준은 기여자 범위,
스냅샷 동결시각, 수정 이력, 재배포 권리, 티커 커버리지, 비용이다. 결정 전까지 실적매매 준비도는
`시장 기대 자료 부족`으로 표시한다.
