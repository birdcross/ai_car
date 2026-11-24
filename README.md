# EV Log

전기차 운전자를 위한 차계부, 주차 위치 기록, 경고등 안내.

## 로컬 실행

Python 3.10 이상이 필요합니다. 별도 패키지 설치 없이 프로젝트 폴더에서 실행합니다.

```powershell
python server.py
```

브라우저에서 http://127.0.0.1:8000 을 엽니다. 기존 정적 데모에서 사용한 주소와 로컬 주소는 브라우저 저장소를 별도로 사용합니다.

- **차량 설정**에서 제조사·차종·연식을 저장합니다. 목록에 없는 전기차는 직접 입력할 수 있습니다. 차량 설정과 기록은 현재 브라우저에 저장되며 차계부와 주차 기록은 차량별로 분리되지 않습니다.
- **차계부**에 충전량과 금액을 직접 기록할 수 있습니다.
- **카드 지출**에서 샘플 가져오기를 누르면 결제 분류, 거래 ID 중복 제거, 원거래 취소를 확인할 수 있습니다. 실제 카드 API는 연동 전입니다. CSV는 UTF-8이며 거래 ID, 날짜, 가맹점, 양수 금액, 상태, 원거래 ID를 사용합니다. 샘플 거래일은 2026년 11월이므로 다른 달에는 차계부 전체 목록에서 확인하세요.
- **주차 위치**에서 층·구역 메모와 사용자 권한을 받은 위치를 저장합니다. 지도 링크를 열 때 좌표가 지도 서비스에 전달됩니다.
- **모니터링**에서 조회가 승인된 현대 전기차의 충전 상태를 확인합니다. 충전 시뮬레이션은 접힌 영역에서 따로 실행할 수 있습니다.
- **경고등 안내**는 공식 설명서의 관련 항목을 검색하고, 문구가 모호하면 추가 정보를 요청합니다. 현재 전용 설명서 검색 범위는 현대 아이오닉 6 2025년형이며 지원 항목은 파워다운, 서비스 경고등, 타이어 공기압입니다.

## 생성형 AI 연결

프로젝트 루트에서 `.env.example`을 복사해 `.env`를 만들고 `COPA_API_KEY`에 COPA 가상 키를 입력합니다. 이미 `.env`가 있으면 해당 파일만 수정합니다. `python server.py`와 `python manual_rag.py`는 이 파일을 읽으며, 배포 환경에서 설정한 환경 변수가 우선합니다. 기본 답변 모델은 `claude-haiku-4`입니다. `.env`를 수정한 뒤 서버를 다시 시작합니다. AI 요청에는 경고 문구나 첨부 사진이 전송되므로 개인정보는 제외합니다.

차계부, 카드 거래, 주차 위치는 브라우저에 저장됩니다. Python 서버는 카드 CSV를 분류하고 경고등 자료를 검색합니다. 기존 Sites 정적 배포에는 Python API가 포함되지 않습니다.

[현대차 아이오닉 6 2025 경고등 사용설명서](https://ownersmanual.hyundai.com/full_webhelp/CE1/2025/ko_KR/id23C4LH00HL7.html)

## Supabase 설명서 RAG

1. Supabase 프로젝트의 SQL Editor에서 `supabase/migrations/202611240001_manual_vectors.sql`을 한 번 실행합니다. Supabase CLI 프로젝트가 연결되어 있다면 마이그레이션으로 적용할 수도 있습니다.
2. Python 서버를 실행할 환경에 아래 환경 변수를 설정합니다. 키는 서버 환경 변수에만 보관하고 Git과 브라우저 코드에는 넣지 않습니다.

```powershell
$env:SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co'
$env:SUPABASE_SECRET_KEY = '<서버용 Supabase secret key>'
$env:EMBEDDINGS_OPENAI_API_KEY = '<벡터 검색용 별도 OpenAI 키>'
$env:COPA_API_KEY = '<COPA 가상 키>'
$env:EVLOG_MODEL = '<답변 생성에 사용할 모델 ID>'
```

3. `python manual_rag.py`로 `data/manual_chunks.json`의 샘플 설명서 조각을 1536차원으로 임베딩하고 Supabase에 적재합니다. 같은 ID로 다시 실행하면 기존 조각을 갱신합니다. 다른 차종은 같은 JSON 구조의 파일을 `python manual_rag.py 경로.json`으로 적재합니다. 각 조각에는 차종·연식, 제목, 출처 URL을 기록합니다.
4. `python server.py`를 시작합니다. 배포 서버에는 같은 환경 변수와 `EVLOG_HOST=0.0.0.0`을 설정합니다. 호스팅의 `PORT`를 사용하며, 필요하면 `EVLOG_PORT`로 지정할 수 있습니다. Supabase는 DB를 호스팅하고 이 저장소의 Python 웹 서버는 별도 호스팅에서 실행합니다.

검색은 입력을 같은 임베딩 모델로 변환하고, 선택한 제조사·차종·연식의 조각에서 코사인 유사도를 계산합니다. 최상위 근거와 원문 링크를 응답에 사용합니다. 검색할 근거가 없으면 추가 정보를 요청하고, 차종 데이터가 없으면 준비 중으로 표시합니다. 초기 유사도 기준은 0.35이며 실제 쿼리로 평가한 뒤 조정합니다.

서버용 Supabase 키가 없으면 샘플 설명서의 키워드 검색을 사용합니다. 모델 호출이 실패하면 검색된 설명서 근거를 표시합니다. Supabase 모드에서는 경고 문구를 임베딩 API로 전송하므로 개인정보를 입력하지 않도록 안내해야 합니다.

[Supabase 벡터 검색 문서](https://supabase.com/docs/guides/ai/semantic-search)


## 차량 목록과 계정

차량 설정에는 [한전 공개 CSV](https://www.data.go.kr/data/15039549/fileData.do)에서 전기차로 확인 가능한 61건을 추가했습니다. 목록에 없는 모델은 직접 등록할 수 있습니다.

Supabase에는 migration 001, 002, 003을 순서대로 적용합니다. 002는 설명서 샘플 원문 근거를, 003은 차량 카탈로그를 넣습니다. 설명서 벡터는 python manual_rag.py로 채웁니다.

Supabase Auth를 사용하려면 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 설정하고 Auth URL Configuration에 로컬 및 배포 URL을 허용합니다. 차량 저장은 로그인 후에만 가능합니다. 개인 기록은 현재 브라우저에서 계정별로 분리합니다. 게스트 기록은 게스트 영역에 남고 기기 간 동기화는 제공하지 않습니다.

## 계기판 사진 분석

경고등 화면에 JPG, PNG 또는 WebP를 첨부할 수 있습니다. 브라우저는 사진을 JPEG로 줄여 요청할 때만 전송합니다. 앱에서 사진을 저장하지 않습니다. COPA의 Claude는 사진에서 경고 문구나 이름을 추출하며, 서버는 이 내용으로 해당 차종의 설명서 근거를 검색합니다. 답변 생성에는 화면에 표시하는 설명서 근거를 전달합니다.

서버 환경 변수 COPA_API_KEY가 필요합니다. 서버는 COPA의 Anthropic Messages API를 사용합니다. 기본 모델은 claude-haiku-4이며 EVLOG_MODEL=claude-sonnet-4로 변경할 수 있습니다. 사진 모델은 EVLOG_VISION_MODEL로 별도 지정할 수 있습니다. Supabase 벡터 검색은 서버용 Supabase 키, 별도 EMBEDDINGS_OPENAI_API_KEY와 적재된 임베딩이 필요합니다.

## 현대·기아 차량 연결 개발 테스트

제조사별 개발자 프로젝트를 만든 뒤 서버의 .env에 HYUNDAI_CLIENT_ID, HYUNDAI_CLIENT_SECRET, HYUNDAI_REDIRECT_URI 또는 KIA_CLIENT_ID, KIA_CLIENT_SECRET, KIA_REDIRECT_URI를 설정합니다. 계정 API Redirect URL에는 앱의 /vehicle-connect/callback 주소 전체를 등록합니다. 예: http://127.0.0.1:8000/vehicle-connect/callback. 배포 환경에서는 HTTPS 콜백을 사용합니다. 기본 데이터 환경은 dev이며 제조사가 허용한 경우 각 브랜드의 DATA_STAGE를 prd로 설정할 수 있습니다.

본인 차량을 콘솔에서 활성화하고 제조사가 요구하는 별도 데이터 제공 동의를 완료해야 차량 목록 조회가 가능합니다. Supabase 서버 키를 설정하면 연결 상태와 만료 시간이 계정별로 Supabase에 저장됩니다. 로컬에서 서버 키를 설정하지 않으면 메모리를 사용합니다. 제조사 토큰 만료 시 다시 연결해야 합니다. 최종 주차 위치와 과거 경로를 가져오는 기능은 승인된 데이터 API의 규격 확인 후 구현합니다.

## Vercel 배포

`vercel.json`이 `dist/`를 웹 화면으로 제공하고 `/api/`와 차량 인증 콜백을 Python 함수로 연결합니다. GitHub에서 가져오는 경우 이 파일이 있는 폴더를 Root Directory로 선택합니다. Vercel CLI의 `vercel deploy --prod`로 폴더를 직접 배포할 수도 있습니다.

1. Supabase에 `202611240006_vehicle_oauth_sessions.sql`을 적용합니다.
2. Vercel의 Production 환경 변수에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `COPA_API_KEY`, `HYUNDAI_CLIENT_ID`, `HYUNDAI_CLIENT_SECRET`을 등록합니다. `HYUNDAI_REDIRECT_URI`에는 `https://<배포 도메인>/vehicle-connect/callback`을 입력합니다. 환경 변수 변경 후 재배포합니다.
3. 현대 개발자 콘솔의 계정 API Redirect URL에 위와 동일한 주소를 저장합니다. Supabase Auth의 URL Configuration에도 배포 도메인을 등록합니다. 가입 확인 메일의 기본 도착 주소로 사용하려면 Site URL을 배포 도메인으로 지정합니다.
4. HTTPS 배포 주소로 로그인한 뒤 주차 위치의 **현대 연결**을 눌러 제조사 로그인, 앱 복귀, 차량 조회 순서로 확인합니다.

## 현대 충전 상태 모니터링

Supabase SQL Editor에서 `supabase/migrations/202611240007_vehicle_charging_status.sql`을 적용한 뒤 배포합니다. 연결 데이터 제공이 승인된 현대 전기차를 모니터링 화면에서 선택합니다. 화면이 열려 있을 때 1분 간격으로 조회하며, 현대가 보낸 시각과 EV Log가 조회한 시각을 각각 표시합니다. 국내 API의 차량 전송 시각은 서울 시간으로 해석합니다.

Supabase는 계정·차량별 최신 관측값을 저장합니다. 조회 API가 제공하는 값은 배터리 잔량, 충전 여부, 플러그 상태, 목표 잔량과 남은 시간입니다. 실제 충전량이나 결제 금액은 이 응답에 포함되지 않습니다.

[현대 전기차 충전 상태 조회 규격](https://developers.hyundai.com/web/v1/hyundai/specification/data/status_evcharging)
