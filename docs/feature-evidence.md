# 필수 기능 구현 및 작동 증빙

2026년 11월 25일 KST에 GitHub `main`의 `5aae145` 버전 기준으로 확인했습니다. [검증한 코드](https://github.com/birdcross/ai_car/tree/5aae145b3853948da0d073914d8c87a39d4476bd) · [Vercel 운영 사이트](https://aicar-qyat.vercel.app/) · [기능 요구사항](requirements.md#기능-요구사항)

| 기능 | 구현 위치 | 확인한 작동 결과 |
| --- | --- | --- |
| F01 이메일 계정·차량 등록 | [가입·로그인](../dist/auth.js#L122), [차량 저장](../dist/app.js#L92) | 운영에서 로그인된 계정의 차량 설정에서 저장하고, 코나 일렉트릭 2025년형이 다시 표시되는 것을 확인했습니다. 신규 가입 확인 메일 수신은 이번 검증 범위 밖입니다. |
| F02 텍스트·사진 질문 | [질문 전송](../dist/app.js#L597), [사진 형식 확인·문구 인식](../server.py#L74) | 운영에서 텍스트 질문에 응답했습니다. 합성 사진 단독 질문은 동의 전 전송이 차단됐고, 동의 후 `사진에서 읽은 내용 · CHECK TIRE PRESSURE`가 표시됐습니다. [경고등 화면](screenshots/guide.png) |
| F03 설명서 검색·답변 | [차량별 벡터 검색](../manual_rag.py#L101), [검색 근거와 답변 생성](../server.py#L98), [벡터 검색 SQL](../supabase/migrations/202611250008_manual_e5_embeddings.sql#L4) | 운영에서 `AI · 공식 설명서 벡터 검색` 배지와 코나 일렉트릭 2025년형 타이어 공기압 경고등의 공식 링크를 확인했습니다. [운영 AI HTTP 200 로그](operations-evidence.md#평가-항목-3--vercel-운영-로그) |
| F04 대화 보관·재개 | [대화 열기·삭제](../dist/app.js#L395), [브라우저 RPC 호출](../dist/app.js#L439), [DB 테이블·RLS·저장 함수](../supabase/migrations/202611250009_guide_conversations.sql#L1) | 운영에서 질문 후 새로고침해 지난 대화를 다시 열고 후속 질문을 보냈습니다. 운영 Supabase에서 대화 1행과 두 턴이 실제 적재된 것을 확인했습니다. [DB 확인 결과](#f04-대화-저장-db-증빙) |
| F05 충전 모니터링 | [조회와 수신 상태](../dist/charging-monitor.js#L220), [이상 판정](../dist/charging-monitor.js#L97), [블루링크 서버 연동](../vehicle_connect.py#L113) | 운영의 공식 샘플 모드에서 배터리 51%와 그래프를 확인했습니다. 로컬에서 모의 데이터로 판정 규칙 6건이 통과했습니다. 실차 데이터 수신은 연결 차량이 필요합니다. [테스트 출력](#f05-모니터링-테스트-출력) · [모니터링 화면](screenshots/monitor.png) |
| F06 차계부·카드 CSV | [차계부 저장](../dist/app.js#L297), [CSV 등록·중복 제외](../dist/app.js#L817), [결제 취소 차감](../dist/app.js#L647), [서버 CSV 파싱](../server.py#L186) | 격리한 로컬 브라우저로 승인·부분 취소·중복 제외를 검증했습니다. 새로고침 후에도 충전량과 정비 비고가 표시됐습니다. [테스트 출력](#f06-차계부와-csv-테스트-출력) · [차계부 화면](screenshots/ledger.png) |
| F07 주차·날짜별 주행 | [마지막 주차 주소 조회](../dist/app.js#L243), [주행 목록·경로](../dist/trips.js#L93) | 운영에서 DB에 저장된 테스트 주소가 표시됐습니다. 날짜별 예시 주행을 선택한 뒤 주차 타일 9개와 주행 타일 6개가 함께 로드됐습니다. [주차·주행 화면](screenshots/parking.png) |
| F08 CODEF 카드사 샌드박스 | [화면의 API 호출](../dist/app.js#L885), [Python API 분기](../server.py#L300), [CODEF 카드·승인 처리](../card_sandbox.py#L87) | 로컬 앱의 HTTP 경로가 실제 CODEF 샌드박스에 요청해 테스트 카드 3개와 첫 카드 승인내역 1건을 받았습니다. [HTTP 로그](#f08-codef-샌드박스-http-로그) · [카드 화면](screenshots/cards.png) |

## F01 차량 저장 확인 출력

운영에 로그인된 상태에서 차량 설정의 `저장하기`를 누른 뒤 확인한 화면 값입니다.

```text
등록 차량 링크: 코나 일렉트릭 · 2025
제조사: 현대
차종: 코나 일렉트릭
연식: 2025
```

## F04 대화 저장 DB 증빙

운영에서 `검증 F04-20261125` 테스트 질문을 전송했습니다. 답변을 받은 뒤 새로고침하고 지난 대화에서 같은 대화를 열어 `그럼 무엇을 먼저 확인하나요?`를 보냈습니다. 두 답변 모두 `AI · 공식 설명서 벡터 검색`이 표시됐습니다.

브라우저의 `saveGuideTurns()`가 Supabase RPC `save_guide_turn`을 호출합니다. 첫 요청은 `guide_conversations`에 대화를 만들고, 후속 요청은 같은 대화 행의 `turns` 배열에 새 턴을 추가합니다. 다음 쿼리는 그 테스트 대화만 집계하며 사용자 ID와 답변 원문은 출력하지 않습니다.

```sql
select count(*) as conversations,
       coalesce(sum(jsonb_array_length(turns)), 0) as stored_turns,
       coalesce(bool_and(
           turns @> '[{"question":"그럼 무엇을 먼저 확인하나요?"}]'::jsonb
       ), false) as follow_up_in_same_row,
       coalesce(bool_and(user_id is not null), false) as owner_recorded
from public.guide_conversations
where title like '검증 F04-20261125 · 코나 일렉트릭 타이어 공기압 경고등의 의미%';
```

Supabase 운영 SQL Editor 결과

```text
conversations  stored_turns  follow_up_in_same_row  owner_recorded
1              2             true                   true
```

## F05 모니터링 테스트 출력

운영에서 현대 공식 샘플 보기로 잔량 51%를 확인했습니다. 로컬 Node에서 실제 `checkChargingReading()`과 `showMissingChargingData()`를 모의 응답으로 실행했습니다.

```text
F05 monitoring rules: 6 passed (normal, interruption, invalid SOC, plug mismatch, stale, missing)
```

## F06 차계부와 CSV 테스트 출력

로컬 테스트 계정에서 승인 5,000원과 부분 취소 1,200원이 담긴 CSV를 두 번 가져왔습니다. 화면과 로그의 결과입니다.

```text
POST /api/cards HTTP 200
F06 card CSV: parsed approved=1 cancelled=1 original-linked=1
첫 가져오기: 2건 가져옴 · 중복 0건 제외
다시 가져오기: 0건 가져옴 · 중복 2건 제외
차계부에 반영된 카드 충전비 1건 · ₩3,800
새로고침 후: 17.55 kWh, QA 정비 비고 확인, 카드 충전비 ₩3,800
```

## F08 CODEF 샌드박스 HTTP 로그

테스트는 로컬 계정 인증을 고정한 뒤 앱의 HTTP API를 호출했습니다. CODEF 요청과 응답은 실제 샌드박스를 사용했습니다. 카드 목록 응답에 끝 4자리만 포함되는지, 승인내역 응답이 날짜·가맹점·금액·취소 여부로 제한되는지 검사했습니다.

```text
{"event": "http_response", "method": "POST", "route": "/api/card-sandbox", "status": 200, "elapsed_ms": 334.1}
{"event": "http_response", "method": "POST", "route": "/api/card-sandbox", "status": 200, "elapsed_ms": 399.2}
F08 CODEF: cards=3 approvals=1 card-mask=last-four-only approval-fields=date,merchant,amount,cancelled
```

운영 Vercel에서의 카드 조회는 CODEF 키 미설정으로 HTTP 503이 반환된 상태입니다. [운영 오류 로그](operations-evidence.md#평가-항목-3--vercel-운영-로그)
