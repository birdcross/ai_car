# EV Log

전기차 운전자를 위한 차계부, 주차 위치 기록, 경고등 안내.

## 프로젝트 제출 자료

- [기획서](docs/project-plan.md)
- [기능·비기능 요구사항과 시스템 아키텍처](docs/requirements.md)
- [사용자 테스트와 개선 기록 양식](docs/user-testing.md)
- [Vercel 운영 사이트](https://aicar-qyat.vercel.app/)

필수 기술 요소는 **공식 설명서 RAG**와 **계기판 사진·텍스트 멀티모달 AI**로 구현했습니다. 계정별 대화 저장과 이어서 질문할 수 있는 기능도 제공합니다. 운영 사이트에서는 로그인 후 코나 일렉트릭 2025년형에 대한 Claude 텍스트 답변과 공식 출처를 확인했습니다. CODEF 샌드박스와 모니터링의 입력 이상은 기능 테스트 결과이며, 실사용자 피드백과 팀원별 기여 기록은 실제 확인 후 제출 자료에 추가합니다.

## 로컬 실행

Python 3.10 이상이 필요합니다. 벡터 검색을 사용할 환경에서는 `python -m pip install -r requirements.txt`로 임베딩 모델 실행에 필요한 패키지를 설치합니다.

```powershell
python server.py
```

브라우저에서 http://127.0.0.1:8000 을 엽니다. 기존 정적 데모에서 사용한 주소와 로컬 주소는 브라우저 저장소를 별도로 사용합니다.

- **차량 설정**에서 제조사·차종·연식을 저장합니다. 목록에 없는 전기차는 직접 입력할 수 있습니다. 차량 설정과 기록은 현재 브라우저에 저장되며 차계부와 주차 기록은 차량별로 분리되지 않습니다.
- **차계부**에 충전 금액·충전량 또는 정비 금액·정비 내용을 기록할 수 있습니다.
- **카드 지출**에서 카드사, 별명, 끝 4자리로 카드를 등록합니다. 등록한 카드를 고르고 결제 파일을 가져오면 충전 거래가 차계부에 반영되고, 분류가 불확실한 거래는 검토할 수 있습니다. UTF-8 CSV에 예제와 동일한 열 순서로 거래 ID, 날짜, 가맹점, 양수 금액, 상태, 원거래 ID를 입력합니다. 거래 ID는 파일과 카드 간에 고유해야 합니다. 카드 지출 화면의 접힌 도움말에서 테스트용 CSV를 내려받을 수 있습니다.
- **주차 위치**에서 층·구역 메모와 사용자 권한을 받은 위치를 저장합니다. 지도 링크를 열 때 좌표가 지도 서비스에 전달됩니다.
- **모니터링**에서 조회가 승인된 현대 전기차의 충전 상태를 확인합니다. 배터리 그림과 추이 그래프에는 이 탭에서 조회한 값을 표시합니다.
- **경고등 안내**에서 텍스트나 계기판 사진으로 질문하고 후속 질문을 이어갈 수 있습니다. 수록 연식은 아래 공식 설명서 지원 표를 참고합니다.

## 생성형 AI 연결

프로젝트 루트에서 `.env.example`을 복사해 `.env`를 만들고 `COPA_API_KEY`에 COPA 가상 키를 입력합니다. 이미 `.env`가 있으면 해당 파일만 수정합니다. `python server.py`와 `python manual_rag.py`는 이 파일을 읽으며, 배포 환경에서 설정한 환경 변수가 우선합니다. 기본 답변 모델은 `claude-haiku-4`입니다. `.env`를 수정한 뒤 서버를 다시 시작합니다. AI 요청에는 경고 문구나 첨부 사진이 전송되므로 개인정보는 제외합니다.

차계부, 카드 등록 정보와 거래, 주차 위치는 브라우저에 저장됩니다. 카드 등록 정보와 거래는 로그인 계정별 저장 영역을 사용합니다. 결제 내역은 CSV 업로드로 반영되며 카드번호 전체나 CVC는 입력하지 않습니다. Python 서버는 카드 CSV를 분류하고 경고등 자료를 검색합니다. 기존 Sites 정적 배포에는 Python API가 포함되지 않습니다.

카드사 연동 테스트는 [CODEF 공식 카드 목록 예제](https://github.com/codef-io/codef-python/blob/master/sandbox/cd/TestKR_CD_P001.py)와 [승인내역 예제](https://github.com/codef-io/codef-python/blob/master/sandbox/cd/TestKR_CD_P002.py)의 테스트 계정을 사용합니다. 서버에 `CODEF_SANDBOX_CLIENT_ID`와 `CODEF_SANDBOX_CLIENT_SECRET`을 설정한 뒤 카드 지출에서 조회할 수 있습니다. 이 모드는 테스트 카드와 마스킹된 승인 응답을 화면에 표시합니다. 실물 카드에 대한 자동 연동을 활성화하려면 운영 이용 권한과 사용자의 카드 연결 승인 절차가 필요합니다.

[현대차 아이오닉 6 2025 경고등 사용설명서](https://ownersmanual.hyundai.com/full_webhelp/CE1/2025/ko_KR/id23C4LH00HL7.html)

현대 국내 전기차 16개 차종의 공식 경고등 근거를 제공합니다. 아래 연식에서 확인된 서비스 경고등, 파워다운, 구동용 배터리 잔량, 타이어 공기압 등의 항목을 요약해 등록했습니다. 각 결과에서 현대 공식 웹 설명서의 항목 또는 PDF 페이지를 열 수 있습니다. [현대자동차 오너스 매뉴얼](https://ownersmanual.hyundai.com/main?countryCode=A99&langCode=ko_KR)

| 차종 | 경고등 설명서 연식 |
| --- | --- |
| 아이오닉 5 / 아이오닉 5 N | 2021–2027 / 2024–2026 |
| 아이오닉 6 / 아이오닉 6 N | 2023–2025 / 2025 |
| 아이오닉 9 | 2025, 2027 |
| 코나 일렉트릭 | 2018–2020, 2022–2025 |
| 캐스퍼 일렉트릭 / 스타리아 일렉트릭 | 2025–2027 / 2027 |
| 아이오닉 일렉트릭 / 블루온 | 2016–2020 / 2012 |
| 포터 II 일렉트릭 / ST1 | 2019–2026 / 2025–2026 |
| 일렉시티 / 일렉시티 이층버스 | 2020–2026 / 2021–2026 |
| 일렉시티 타운 / 카운티 일렉트릭 | 2023–2025 / 2020–2025 |

검색은 등록된 제조사·차종·연식이 모두 일치하는 범위에서 실행합니다. 기존 카탈로그의 ‘포터 EV’, ‘코나EV(~22년형)’ 같은 이름도 공식 차종명으로 인식합니다. 근거가 확인되지 않은 연식이나 경고는 AI 일반 안내로 표시됩니다.

## Supabase 설명서 RAG

1. Supabase 프로젝트에 `202611240001_manual_vectors.sql`과 `202611250008_manual_e5_embeddings.sql`을 적용합니다. 기존 운영 DB에 처음 추가할 때는 적용 여부를 확인한 뒤 새 마이그레이션만 실행합니다.
2. Python 서버를 실행할 환경에 아래 환경 변수를 설정합니다. 키는 서버 환경 변수에만 보관하고 Git과 브라우저 코드에는 넣지 않습니다.

```powershell
$env:SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co'
$env:SUPABASE_SECRET_KEY = '<서버용 Supabase secret key>'
$env:COPA_API_KEY = '<COPA 가상 키>'
$env:EVLOG_MODEL = '<답변 생성에 사용할 모델 ID>'
```

3. `python -m pip install -r requirements.txt` 후 `python manual_rag.py`를 실행합니다. `data/manual_chunks.json`에 있는 차량 설명서 발췌 요약을 `multilingual-e5-small`로 384차원 임베딩해 Supabase의 `manual_chunks.e5_embedding`에 적재합니다. 최초 실행 때 공개 모델 파일을 내려받아 캐시합니다. 같은 ID를 다시 넣으면 기존 조각을 갱신합니다. 다른 차종은 같은 JSON 구조의 파일을 `python manual_rag.py 경로.json`으로 적재합니다.
4. `python server.py`를 시작합니다. 배포 서버에는 같은 환경 변수와 `EVLOG_HOST=0.0.0.0`을 설정합니다. 호스팅의 `PORT`를 사용하며, 필요하면 `EVLOG_PORT`로 지정할 수 있습니다. Supabase는 DB를 호스팅하고 이 저장소의 Python 웹 서버는 별도 호스팅에서 실행합니다.

검색 시 질문을 같은 모델로 변환하고, 제조사·차종·연식이 일치하는 조각의 코사인 유사도를 계산합니다. 코사인 유사도가 0.83 이상인 최대 3개 조각을 Claude 프롬프트에 포함해 답변을 생성합니다. 질문 임베딩은 Python 서버에서 계산합니다.

벡터 검색 설정이나 검색 결과가 없으면 저장소에 포함한 공식 설명서 발췌에서 키워드를 찾습니다. 관련 항목이 없으면 COPA로 일반 AI 안내를 생성하고, 설명서 기반 답변은 출처를 표시합니다. 모델 호출이 실패하면 검색된 설명서 근거를 표시합니다.

[Supabase 벡터 검색 문서](https://supabase.com/docs/guides/ai/semantic-search)


## 차량 목록과 계정

차량 설정에는 [한전 공개 CSV](https://www.data.go.kr/data/15039549/fileData.do)에서 전기차로 확인 가능한 61건을 추가했습니다. 목록에 없는 모델은 직접 등록할 수 있습니다.

Supabase에는 migration 001, 002, 003을 순서대로 적용합니다. 002는 설명서 샘플 원문 근거를, 003은 차량 카탈로그를 넣습니다. 설명서 벡터는 python manual_rag.py로 채웁니다.

Supabase Auth를 사용하려면 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 설정하고 Auth URL Configuration에 로컬 및 배포 URL을 허용합니다. 차량 저장은 로그인 후에만 가능합니다. 개인 기록은 현재 브라우저에서 계정별로 분리합니다. 게스트 기록은 게스트 영역에 남고 기기 간 동기화는 제공하지 않습니다.

## 계기판 사진 분석

경고등 화면에 JPG, PNG 또는 WebP를 첨부할 수 있습니다. 사진을 첨부하면 전송 동의를 받습니다. 브라우저는 사진을 JPEG로 줄여 해당 질문에서만 전송합니다. COPA의 Claude는 사진에서 경고 문구나 이름을 추출하며, 서버는 이 내용으로 해당 차종의 설명서 근거를 검색합니다.

`202611250009_guide_conversations.sql`을 적용하면 로그인한 사용자의 질문, 답변, 출처와 사진에서 읽은 문구가 Supabase에 저장됩니다. 지난 대화를 열면 당시 등록한 차종과 연식으로 이어서 대화하며, 모델에는 최근 8개 메시지의 텍스트를 보냅니다. 첨부 사진 자체는 대화 기록에 저장하지 않습니다. Supabase RLS는 본인 계정의 기록만 조회·저장·삭제할 수 있도록 제한합니다.

서버 환경 변수 COPA_API_KEY가 필요합니다. 서버는 COPA의 Anthropic Messages API를 사용합니다. 기본 모델은 claude-haiku-4이며 EVLOG_MODEL=claude-sonnet-4로 변경할 수 있습니다. 사진 모델은 EVLOG_VISION_MODEL로 별도 지정할 수 있습니다. Supabase 벡터 검색에는 서버용 Supabase 키와 적재된 임베딩이 필요합니다.

## 현대 블루링크 차량 연결 개발 테스트

현대 개발자 프로젝트를 만든 뒤 서버의 `.env`에 `HYUNDAI_CLIENT_ID`, `HYUNDAI_CLIENT_SECRET`, `HYUNDAI_REDIRECT_URI`를 설정합니다. 계정 API Redirect URL에는 앱의 `/vehicle-connect/callback`까지 포함한 HTTPS 주소를 등록합니다. 기본 데이터 환경은 `dev`이며 현대에서 운영 권한을 승인한 경우 `HYUNDAI_DATA_STAGE=prd`로 설정할 수 있습니다.

본인 차량을 콘솔에서 활성화하고 제조사가 요구하는 별도 데이터 제공 동의를 완료해야 차량 목록 조회가 가능합니다. Supabase 서버 키를 설정하면 연결 상태와 만료 시간이 계정별로 Supabase에 저장됩니다. 로컬에서 서버 키를 설정하지 않으면 메모리를 사용합니다. 제조사 토큰 만료 시 다시 연결해야 합니다. 최종 주차 위치와 과거 경로를 가져오는 기능은 승인된 데이터 API의 규격 확인 후 구현합니다.

모니터링 화면을 보는 동안 충전 상태를 1분 간격으로 조회합니다. 같은 플러그가 연결된 채 충전 중 상태에서 충전 정지로 바뀌고 목표 잔량에 도달하지 않았다면 이상 점검 카드에 관측값과 확인 순서를 표시합니다. 차량 데이터가 오래됐거나 전송 시각·잔량·플러그 상태가 서로 맞지 않으면 데이터 확인으로 표시합니다. 범위를 벗어난 값은 배터리 그래프에 반영하지 않습니다. 점검 순서는 [현대차 공식 충전 안내](https://ownersmanual.hyundai.com/full_webhelp/NE1/2025/ko_KR/id23C1G00D030.html)를 참고했습니다.

차량 상태를 요청하는 동안 ‘실시간 점검 중’이 표시됩니다. 20초 동안 응답이 없거나 충전 상태가 비어 있으면 ‘데이터 미수신’을 표시하며, 수신했던 값과 전송 시각을 보여줍니다. 인터넷 연결이 복구되면 다시 조회합니다.

## Vercel 배포

`vercel.json`이 `dist/`를 웹 화면으로 제공하고 `/api/`와 차량 인증 콜백을 Python 함수로 연결합니다. GitHub에서 가져오는 경우 이 파일이 있는 폴더를 Root Directory로 선택합니다. Vercel CLI의 `vercel deploy --prod`로 폴더를 직접 배포할 수도 있습니다.

1. Supabase에 `202611240006_vehicle_oauth_sessions.sql`을 적용합니다.
2. Vercel의 Production 환경 변수에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `COPA_API_KEY`, `HYUNDAI_CLIENT_ID`, `HYUNDAI_CLIENT_SECRET`을 등록합니다. `HYUNDAI_REDIRECT_URI`에는 `https://<배포 도메인>/vehicle-connect/callback`을 입력합니다. 환경 변수 변경 후 재배포합니다.
3. 현대 개발자 콘솔의 계정 API Redirect URL에 위와 동일한 주소를 저장합니다. Supabase Auth의 URL Configuration에도 배포 도메인을 등록합니다. 가입 확인 메일의 기본 도착 주소로 사용하려면 Site URL을 배포 도메인으로 지정합니다.
4. HTTPS 배포 주소로 로그인한 뒤 주차 위치의 **현대 연결**을 눌러 제조사 로그인, 앱 복귀, 차량 조회 순서로 확인합니다.

## 현대 충전 상태 모니터링

Supabase SQL Editor에서 `supabase/migrations/202611240007_vehicle_charging_status.sql`을 적용한 뒤 배포합니다. 연결 데이터 제공이 승인된 현대 전기차를 모니터링 화면에서 선택합니다. 화면이 열려 있을 때 1분 간격으로 조회하며, 현대가 보낸 시각과 EV Log가 조회한 시각을 각각 표시합니다. 국내 API의 차량 전송 시각은 서울 시간으로 해석합니다.

Supabase는 계정·차량별 최신 관측값을 저장합니다. 조회 API가 제공하는 값은 배터리 잔량, 충전 여부, 플러그 상태, 목표 잔량과 남은 시간입니다. 실제 충전량이나 결제 금액은 이 응답에 포함되지 않습니다.

차량을 선택하면 주행 가능 거리, 누적 운행 거리, 전기차 배터리 잔량과 충전 상태를 함께 조회합니다. 이후에는 충전 상태만 1분마다 갱신합니다. 테스트 차량이 없으면 **현대 공식 샘플 보기**에서 각 API 규격서의 응답 예시를 확인할 수 있습니다. 샘플은 서로 다른 예시 시점의 값이며 DB에 저장하지 않습니다.

[현대 전기차 충전 상태 조회 규격](https://developers.hyundai.com/web/v1/hyundai/specification/data/status_evcharging)
