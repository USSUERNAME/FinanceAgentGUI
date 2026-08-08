# World Memory Collection Prompt

사용자가 `월드 메모리 업데이트 해 줘`, `월드 메모리 업데이트`, `월드 메모리 확보 작업`처럼 짧게 요청하면 아래 월드 메모리 업데이트 절차 전체를 수행한다.

`world_memory`는 raw article 전문 저장소가 아니라 summary-first memory다.

외부 세계 메모리 구축 시에는 FEED를 기본 사용한다.

- 기본 소스: `yfinance + FEED + 고신뢰 웹 검색`
- 영어권 우선 출처: `WSJ`, `FT`, `Bloomberg` (필요 시 2차 신뢰도 확장)
- 한국 소스 보강: `연합인포맥스(https://news.einfomax.co.kr)`
- FEED는 빠른 탐지 레이어로 사용하고, 저장 전에는 가능한 한 고신뢰 원출처 또는 정규 언론으로 재확인한다.
- FEED 단독 헤드라인만으로 저장하거나 결론을 내리지 않는다.

월드 메모리 업데이트 절차:

- 시작 전에 `python3 scripts/world_memory_cli.py list --days 30 --format md`, `python3 scripts/world_memory_cli.py states --status active --format md`, `python3 scripts/world_memory_cli.py taxonomy --refresh --format md`, `python3 scripts/world_memory_cli.py taxonomy --type state_key --format md`, `python3 scripts/world_memory_cli.py taxonomy --type subject --format md`를 먼저 실행해 최근 로그와 taxonomy를 확인한다.
- 업데이트 전후로 `python3 scripts/world_memory_cli.py embed-status --format md`를 확인하고, 저장 경로에서 자동 임베딩이 누락된 경우에만 `embed-build`로 보강한다.
- 한 번 실행할 때 가장 중요한 1건만 고르지 말고, 의미 있는 `brief`가 여러 개 있으면 가능한 범위에서 `3~8건` 정도 함께 적재한다.
- 같은 실행에서 동일 `subject`에 과도하게 쏠리지 않도록 하고, 같은 주체는 기본적으로 `최대 2건` 정도로 제한한다.
- `brief`는 정책 주체, 기업, 기관, 산업 동향이 균형 있게 섞이도록 우선순위를 조정한다.
- `brief-add` 또는 `brief-import`를 사용할 때는 `subjects`, `industries`, `event_kind`, `dedupe_key`, `sources`를 붙이고 derived state를 만들지 않는다.
- `brief-import`를 사용할 때는 항상 `.json` 입력만 사용하고 `.jsonl`은 사용하지 않는다.
- 현재 레짐의 상태 변화나 우세 해석 변화가 확인되면 `add`에 `--state-key`, `--state-label`, `--state-status`, `--state-bias`, `--net-effect`를 함께 사용한다.
- 같은 `state_key`의 기존 `active/watch` 상태를 명확히 대체하는 경우 `--supersedes-active`를 사용한다.
- derived state는 모든 `story`에 대해 자동 생성하지 않는다. 기본적으로 동일 story가 `issue` 기준 2건 이상 누적되었거나, 명시적 `state_key`가 있을 때만 레짐 후보로 유지한다.
- `story_family`는 부모 family를 canonical하게 유지하고, branch 분화는 `story-link` 메모 또는 `story-family-review` 제안으로 별도 관리한다.
- 기존 `story`는 사건 대상, 인과관계, 시장 전달경로가 모두 같은 후속 보도일 때만 재사용한다. 기관명이나 `Treasury`, `금리`, `제재` 같은 단어가 겹친다는 이유만으로 연결하지 않는다.
- 적합한 기존 `story`가 불명확하면 `story`, `story_thesis`, `story_checkpoint`를 비워 두고, 보고서의 변경 제안에서 의미검색과 사용자 확인을 요청한다.
- 제재·자금세탁·암호화폐 우회결제 단속은 국채 발행·재무부 바이백과 별도 전달경로다. 같은 미국 재무부가 등장해도 서로 연결하지 않는다.
- 트럼프 같은 단일 인물 헤드라인만 반복 저장하지 말고, 정책 주체, 기업, 산업 동향이 균형 있게 섞이도록 유지한다.

로그에 반드시 포함한다:

- `as_of`(KST 타임스탬프)
- `category`: `stock_bond`, `geopolitics`, `emerging`
- `region`: `US`, `KR`, `GLOBAL`
- `importance`: `high|medium|low`
- `sources`(매체명/URL/게시시각)

어닝 이벤트는 고우선순위로 취급한다.

- `event_kind/tags/title/summary`에서 어닝 신호가 감지되면 `importance`는 최소 `medium`으로 상향한다.
- 가이던스 상·하향, beat/miss, 실적 서프라이즈/쇼크 등 강한 신호는 `importance=high`로 우선 저장한다.
- `brief` 엔트리에서 어닝 신호가 있고 `category=emerging`인 경우 `category=stock_bond`로 보정해 기업 동향으로 집계한다.
