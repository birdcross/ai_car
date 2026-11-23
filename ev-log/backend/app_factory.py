"""EV Log 앱 조립.

FastAPI는 Starlette를 상속하므로, 여기 함수들은 FastAPI 앱과 Starlette 앱 모두에 그대로 쓸 수 있습니다.
(로컬 테스트는 Starlette로, 배포는 main.py의 FastAPI로 같은 코드를 실행합니다.)

순서가 중요합니다.
  1) mount_api(app)       : /api/* 하위 앱들
  2) 팀원 라우터 추가     : app.include_router(...) 또는 app.mount("/api/xxx", ...)
  3) mount_frontend(app)  : 정적 파일은 "/" 전체를 잡기 때문에 반드시 마지막
"""
from __future__ import annotations

from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse
from starlette.routing import Route
from starlette.staticfiles import StaticFiles

from .core.config import PROJECT_ROOT, Settings
from .core.consent import ConsentStore, create_consent_app
from .core.db import Database
from .parking import create_parking_app

FRONTEND_DIR = PROJECT_ROOT / "frontend"


def mount_api(app: Starlette, settings: Settings | None = None) -> Settings:
    settings = settings or Settings()
    if settings.cors_origins:  # 프론트를 Vercel 등 다른 도메인에 올릴 때만 필요
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-User-Id"],
        )

    db = Database(settings.database_path)
    consent = ConsentStore(db)

    async def health(request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    async def consent_slash(request: Request) -> RedirectResponse:
        return RedirectResponse("/api/consent/", status_code=307)  # 슬래시 없이 호출해도 동작

    app.router.routes.append(Route("/api/health", health, methods=["GET"]))
    app.router.routes.append(Route("/api/consent", consent_slash, methods=["GET", "POST"]))
    app.mount("/api/consent", create_consent_app(consent))
    app.mount("/api/parking", create_parking_app(settings, db=db, consent=consent))
    return settings


def mount_frontend(app: Starlette, frontend_dir: Path = FRONTEND_DIR) -> None:
    if not (frontend_dir / "index.html").exists():
        # 대시보드(index.html)가 아직 없으면 주차 위치 페이지로 보냅니다.
        async def to_parking(request: Request) -> RedirectResponse:
            return RedirectResponse("/parking/")

        app.router.routes.append(Route("/", to_parking, methods=["GET"]))
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


def create_local_app(settings: Settings | None = None) -> Starlette:
    """FastAPI 없이 실행하는 로컬/테스트용 앱 (동일한 하위 앱 사용)."""
    app = Starlette()
    mount_api(app, settings)
    mount_frontend(app)
    return app
