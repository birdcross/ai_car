"""Starlette 하위 앱 공용 유틸: JSON 에러 응답, 요청 본문 검증."""
from __future__ import annotations

import json
from typing import TypeVar

from pydantic import BaseModel, ValidationError
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

M = TypeVar("M", bound=BaseModel)


async def _http_exception(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


async def _unhandled(request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover - 안전망
    return JSONResponse({"detail": "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}, status_code=500)


# FastAPI와 같은 {"detail": "..."} 형태로 에러를 돌려줍니다.
ERROR_HANDLERS = {HTTPException: _http_exception, Exception: _unhandled}


async def read_json(request: Request, model: type[M], max_bytes: int = 64 * 1024) -> M:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(status_code=413, detail="요청이 너무 큽니다.")
    body = await request.body()
    if len(body) > max_bytes:
        raise HTTPException(status_code=413, detail="요청이 너무 큽니다.")
    try:
        data = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="JSON 형식이 올바르지 않습니다.")
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(p) for p in first.get("loc", ())) or "body"
        raise HTTPException(status_code=422, detail=f"{field}: {first.get('msg', '값이 올바르지 않습니다.')}")
