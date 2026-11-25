# 운영 로그 및 Python 정적 분석 증빙

## 평가 항목 3 · Vercel 운영 로그

2026년 11월 25일 KST에 Vercel Production에서 GitHub 커밋 `3d5d6b6`을 검증했습니다. [운영 서비스](https://aicar-qyat.vercel.app/) · [검증한 배포](https://vercel.com/birdcross10-9368s-projects/ai_car-qyat/9Nj1Wp6sG4RV3RJXUaPvZJAV21vq) · [Vercel Runtime Logs](https://vercel.com/birdcross10-9368s-projects/ai_car-qyat/logs)

Vercel Runtime Logs에서 확인한 요청의 시각과 애플리케이션 출력입니다.

| 시각 (KST) | 출력 | 요청 | HTTP | 처리 시간 |
| --- | --- | --- | --- | --- |
| 19:46:47.32 | stdout | GET `/api/auth-config` | 200 | 0.0 ms |
| 19:46:51.79 | stdout | GET `/api/auth-config` | 200 | 0.0 ms |
| 19:46:56.22 | stdout | GET `/api/auth-config` | 200 | 0.0 ms |
| 19:46:56.23 | stderr | POST `/api/card-sandbox` | 503 | 926.5 ms |
| 19:46:56.69 | stdout | POST `/api/guide` | 401 | 0.0 ms |
| 19:47:40.21 | stdout | POST `/api/guide` | 200 | 6938.0 ms |

CODEF 샌드박스 키가 설정되지 않은 운영 환경에서 테스트 카드 조회가 503을 반환했습니다. 비로그인 AI 요청은 401로 차단됐으며, 이어서 로그인한 계정의 질문은 200으로 처리되고 차량 설명서 벡터 검색 결과와 공식 출처가 표시됐습니다. 위 기록은 해당 시간대의 요청 결과를 보여줍니다.

실제 stderr 메시지 발췌

```json
{"event": "http_response", "method": "POST", "route": "/api/card-sandbox", "status": 503, "elapsed_ms": 926.5}
```

## 평가 항목 6 · Python 네이밍 및 Ruff

- `api/evlog.py`의 클래스는 PEP 8 CapWords 규칙을 따라 `Handler`로 선언하고, Vercel 런타임용 모듈 변수 `handler`에 연결합니다. `do_GET`, `do_POST`, `do_HEAD`는 Python 표준 HTTP 핸들러의 메서드명입니다. [Vercel Python 진입점 감지 구현](https://github.com/vercel/vercel/pull/14493/files)
- CODEF 예외 클래스에 `Error` 접미사를 적용하고, Python 모듈의 import 순서를 Ruff로 통일했습니다. 검사 규칙은 [ruff.toml](../ruff.toml)에 있습니다.

저장소 루트에서 실행

```sh
python -m pip install -r requirements-dev.txt
python -m ruff check .
```

Ruff 0.13.3 실행 결과

```text
All checks passed!
```
