"""사용자 식별 (팀 공통 규칙).

로그인 기능이 생기기 전까지는 브라우저마다 만든 익명 ID를 `X-User-Id` 헤더로 보냅니다.
(프론트 `shared/api.js`가 자동으로 붙여줍니다.)
테스터 5명 이상이 같은 서버를 써도 서로의 주차 위치가 섞이지 않게 하기 위한 장치입니다.

나중에 Supabase Auth 등을 붙이면 `get_user_id()`만 토큰 검증으로 바꾸면 됩니다.
"""
from __future__ import annotations

import re

from starlette.exceptions import HTTPException
from starlette.requests import Request

USER_ID_HEADER = "X-User-Id"
_VALID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def get_user_id(request: Request) -> str:
    user_id = request.headers.get(USER_ID_HEADER, "").strip()
    if not _VALID.match(user_id):
        raise HTTPException(status_code=401, detail="사용자 ID(X-User-Id 헤더)가 없거나 형식이 올바르지 않습니다.")
    return user_id
