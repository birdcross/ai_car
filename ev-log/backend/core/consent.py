"""개인정보 수집 동의 (팀 공통).

미션의 AI 윤리 요건 "개인정보 수집 시 동의를 받고 안전하게 관리한다"를 위한 모듈입니다.
기능마다 scope를 등록해서 씁니다. 예) 주차 위치: location, photo_ai / 카드 지출: card_data

API (main.py에서 /api/consent 에 마운트)
  GET    /api/consent            내 동의 현황 + 등록된 scope 목록
  POST   /api/consent            {"scopes": ["location"]} 동의 기록
  DELETE /api/consent/{scope}    동의 철회
"""
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .db import Database
from .http import ERROR_HANDLERS, read_json
from .identity import get_user_id

# scope: (제목, 버전). 안내 문구가 바뀌면 버전을 올려 다시 동의를 받습니다.
CONSENT_SCOPES: dict[str, dict[str, str]] = {
    "location": {
        "title": "주차 위치(GPS 좌표) 저장",
        "version": "2026-11",
    },
    "photo_ai": {
        "title": "주차 사진 저장 및 AI 인식",
        "version": "2026-11",
    },
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS user_consents (
    user_id   TEXT NOT NULL,
    scope     TEXT NOT NULL,
    version   TEXT NOT NULL,
    agreed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, scope)
);
"""


class ConsentStore:
    def __init__(self, db: Database):
        self.db = db
        db.ensure_schema(SCHEMA)

    def list(self, user_id: str) -> dict[str, dict[str, str]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT scope, version, agreed_at FROM user_consents WHERE user_id = ?", (user_id,)
            ).fetchall()
        return {r["scope"]: {"version": r["version"], "agreed_at": r["agreed_at"]} for r in rows}

    def has(self, user_id: str, scope: str) -> bool:
        current = CONSENT_SCOPES.get(scope, {}).get("version")
        record = self.list(user_id).get(scope)
        return bool(record and current and record["version"] == current)

    def agree(self, user_id: str, scopes: list[str]) -> None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.db.connect() as conn:
            for scope in scopes:
                conn.execute(
                    "INSERT INTO user_consents (user_id, scope, version, agreed_at) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(user_id, scope) DO UPDATE SET version = excluded.version, agreed_at = excluded.agreed_at",
                    (user_id, scope, CONSENT_SCOPES[scope]["version"], now),
                )

    def withdraw(self, user_id: str, scope: str) -> None:
        with self.db.connect() as conn:
            conn.execute("DELETE FROM user_consents WHERE user_id = ? AND scope = ?", (user_id, scope))

    def require(self, user_id: str, scope: str) -> None:
        if not self.has(user_id, scope):
            title = CONSENT_SCOPES.get(scope, {}).get("title", scope)
            raise HTTPException(status_code=403, detail=f"'{title}'에 대한 동의가 필요합니다.")


class ConsentBody(BaseModel):
    scopes: list[str] = Field(min_length=1, max_length=10)


def create_consent_app(store: ConsentStore) -> Starlette:
    def _payload(user_id: str) -> dict:
        mine = store.list(user_id)
        return {
            "scopes": CONSENT_SCOPES,
            "consents": {
                scope: {**rec, "current": rec["version"] == CONSENT_SCOPES.get(scope, {}).get("version")}
                for scope, rec in mine.items()
            },
        }

    async def get_consents(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        return JSONResponse(await run_in_threadpool(_payload, user_id))

    async def post_consents(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        body = await read_json(request, ConsentBody)
        unknown = [s for s in body.scopes if s not in CONSENT_SCOPES]
        if unknown:
            raise HTTPException(status_code=422, detail=f"알 수 없는 동의 항목: {', '.join(unknown)}")
        await run_in_threadpool(store.agree, user_id, body.scopes)
        return JSONResponse(await run_in_threadpool(_payload, user_id))

    async def delete_consent(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        scope = request.path_params["scope"]
        if scope not in CONSENT_SCOPES:
            raise HTTPException(status_code=404, detail="알 수 없는 동의 항목입니다.")
        await run_in_threadpool(store.withdraw, user_id, scope)
        return JSONResponse(await run_in_threadpool(_payload, user_id))

    return Starlette(
        routes=[
            Route("/", get_consents, methods=["GET"]),
            Route("/", post_consents, methods=["POST"]),
            Route("/{scope}", delete_consent, methods=["DELETE"]),
        ],
        exception_handlers=ERROR_HANDLERS,
    )
