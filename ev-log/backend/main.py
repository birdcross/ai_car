"""EV Log 배포용 진입점 (FastAPI).

실행:  uvicorn backend.main:app --reload
"""
from fastapi import FastAPI

from .app_factory import mount_api, mount_frontend

app = FastAPI(title="EV Log API", description="전기차 생활 관리 서비스")

# 1) 공용 + 주차 위치 API (/api/health, /api/consent, /api/parking)
mount_api(app)

# 2) 팀원 기능은 여기에 추가하세요. (mount_frontend보다 위에!)
# from .ledger.router import router as ledger_router
# app.include_router(ledger_router, prefix="/api/ledger")

# 3) 프론트엔드 정적 파일 — "/" 전체를 잡으므로 항상 마지막
mount_frontend(app)
