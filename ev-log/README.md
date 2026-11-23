# EV Log — 전기차 생활 관리 서비스

충전비·정비 기록(차계부), 주차 위치, 경고등 안내, 실시간 모니터링을 한곳에서 관리하는 AI 기반 전기차 생활 관리 서비스입니다.

> 이 저장소에는 현재 **주차 위치** 기능과 팀 공용 기반(화면 틀·API 규칙·동의 관리)이 들어 있습니다.
> 다른 기능은 [팀 연동 가이드](docs/parking/팀_연동_가이드.md)의 규칙대로 추가해주세요.

## 팀원 및 역할

| 이름 | 역할 | 담당 업무 |
|------|------|-----------|
| (이름) | 주차 위치 | GPS·사진 AI 인식·메모 기반 주차 위치 기록, 공용 화면 틀/동의 모듈 |
| (이름) | 대시보드 | TODO |
| (이름) | 차계부 · 카드 지출 | TODO |
| (이름) | 경고등 안내 (Agent + RAG) | TODO |
| (이름) | 실시간 모니터링 | TODO |

## 기술 스택

| 영역 | 사용 기술 | 선택 이유 |
|------|-----------|-----------|
| Backend | FastAPI (Starlette 기반), Uvicorn | 과정에서 익힌 Python, 기능별 하위 앱으로 나눠 팀원이 독립적으로 개발 |
| DB | SQLite (`data/evlog.db`) | 설치 없이 바로 실행. 기능별 `repository.py`만 바꾸면 Supabase로 이전 가능 |
| AI (멀티모달) | Gemini / OpenAI / Claude 비전 API 중 택1 | 사진 속 주차장 표지판(층·구역) 인식. 환경변수로 공급자 교체 |
| Frontend | HTML · CSS · JavaScript (ES Modules) | 빌드 도구 없이 백엔드가 그대로 서빙 → 배포가 단순 |
| 지도 | Leaflet + OpenStreetMap | API 키 불필요, 국내 지도 앱(카카오맵)은 링크로 연결 |
| 배포 | Render (`render.yaml`) | GitHub 연결만으로 HTTPS 배포 (위치 기능은 HTTPS 필수) |

## 주차 위치 기능 요약

- **GPS 저장**: 휴대폰 위치를 여러 번 측정해 가장 정확한 값을 저장하고, 오차(±m)를 함께 보여줍니다.
- **위치가 애매할 때 사진 인식**: 오차가 50m를 넘거나 위치를 못 잡으면(지하 주차장) 사진 촬영을 권하고,
  AI가 기둥·표지판에서 층·구역·번호를 읽어 `지하 2층 A-17`처럼 정리합니다. 결과는 **AI 생성 표시**와 함께 보여주고 사용자가 확인 후 저장합니다.
- **메모**: 자유 메모(최대 500자)를 저장하고, 저장 후에도 수정할 수 있습니다.
- **돌아갈 때**: 지도·주차 사진·메모를 보고, ‘차까지 거리 보기’로 현재 위치에서의 거리·방향을 확인합니다.
- **오프라인 대응**: 지하에서 연결이 끊기면 기기에 임시 저장했다가 연결되면 자동 전송합니다.
- **개인정보**: 위치·사진 수집 전에 항목별 동의를 받고, 사진의 EXIF(촬영 위치 등)는 지운 뒤 저장합니다. 기록은 언제든 삭제할 수 있습니다.

자세한 내용: [기능 명세서](docs/parking/기능명세서.md)

## 실행 방법

요구사항: Python 3.10 이상

```bash
git clone <저장소 주소>
cd ev-log
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env        # AI 키 입력 (없으면 AI_PROVIDER=mock 으로 화면 흐름만 확인)
uvicorn backend.main:app --reload
```

브라우저에서 http://localhost:8000/parking/ 을 엽니다.
(휴대폰 GPS는 https에서만 동작하므로 휴대폰 테스트는 배포 주소에서 하세요.)

테스트:

```bash
python -m pytest -q
```

## 폴더 구조

```
backend/
  main.py              FastAPI 진입점 (팀원 라우터 추가 위치)
  app_factory.py       공용 API·정적 파일 마운트
  core/                팀 공용: 설정, DB, 사용자 ID, 동의, 에러 응답
  parking/             주차 위치 API · 사진 처리 · AI 인식
frontend/
  shared/              팀 공용: theme.css, shell.js, api.js, consent.js, ui.js
  parking/             주차 위치 페이지
docs/parking/          기능 명세서, 팀 연동 가이드
tests/                 API·AI 파싱 테스트
```

## 배포

Render에서 **New → Blueprint**로 이 저장소를 연결하면 `render.yaml` 설정대로 배포됩니다.
환경변수 `GEMINI_API_KEY`(또는 다른 공급자 키)를 대시보드에서 입력하세요.

> ⚠ Render 무료 플랜은 15분간 요청이 없으면 잠들고, 그때마다 로컬 파일(SQLite·사진)이 지워집니다.
> 실사용자 테스트 기간에는 유료 인스턴스 + 디스크를 쓰거나 DB를 Supabase로 옮겨야 기록이 유지됩니다.

## 사용자 테스트 결과

- 테스터: (N명, 구성)
- 주요 피드백 및 반영 사항: TODO
- AI 인식 정확도: `/api/parking/stats`의 `ai_accept_rate` (AI가 읽은 값을 고치지 않고 저장한 비율)

## 링크

- 배포 URL: TODO
- 발표 자료: TODO
- 시연 영상: TODO
