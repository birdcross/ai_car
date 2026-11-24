"""Hyundai and Kia account connection."""
import base64
import json
import os
import secrets
import threading
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from vehicle_oauth_store import SupabaseOAuthStore

ACCOUNT_ORIGIN = "https://prd.kr-ccapi.hyundai.com"
DATA_ORIGINS = {"dev": "https://dev.kr-ccapi.hyundai.com", "prd": ACCOUNT_ORIGIN}
BRANDS = {"hyundai": "현대 블루링크", "kia": "기아 커넥트"}
LOCK = threading.Lock()
PENDING = {}
CONNECTED = {}


def configuration(brand):
    if brand not in BRANDS:
        raise ValueError("현대 또는 기아를 선택해주세요.")
    prefix = brand.upper()
    client = os.getenv(prefix + "_CLIENT_ID")
    secret = os.getenv(prefix + "_CLIENT_SECRET")
    callback = os.getenv(prefix + "_REDIRECT_URI")
    if not all((client, secret, callback)):
        return None
    url = urlsplit(callback)
    if (not url.hostname or url.username or url.password or url.path != "/vehicle-connect/callback"
            or url.query or url.fragment
            or not (url.scheme == "https" or (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1"}))):
        raise ValueError("차량 연결 콜백 주소 설정을 확인해주세요.")
    stage = os.getenv(prefix + "_DATA_STAGE", "dev")
    if stage not in DATA_ORIGINS:
        raise ValueError("차량 데이터 환경은 dev 또는 prd로 설정해주세요.")
    return client, secret, callback, DATA_ORIGINS[stage]


def prune(now):
    for items in (PENDING, CONNECTED):
        for key in [key for key, value in items.items() if value[-1] <= now]:
            del items[key]


def provider_json(url, headers, fields=None):
    data = urlencode(fields).encode() if fields is not None else None
    request = Request(url, data=data, headers=headers)
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def handle(user_id, request):
    if not isinstance(request, dict):
        raise ValueError("차량 연결 요청 형식을 확인해주세요.")
    action, brand = request.get("action"), request.get("brand")
    if not isinstance(brand, str) or brand not in BRANDS:
        raise ValueError("현대 또는 기아를 선택해주세요.")
    key = (user_id, brand)
    config = configuration(brand)
    store = None
    if os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SECRET_KEY"):
        store = SupabaseOAuthStore(user_id, brand)
    elif config and os.getenv("VERCEL"):
        if action == "status":
            return {"configured": False, "connected": False}
        raise ValueError("배포 서버의 차량 연결 저장소 설정이 필요해요.")
    now = time.time() if store else time.monotonic()
    link = None
    if store:
        if action == "disconnect":
            store.disconnect()
            return {"connected": False}
        if config and action in {"status", "vehicles"}:
            link = store.token(now)
    else:
        with LOCK:
            prune(now)
            link = CONNECTED.get(key)
            if action == "disconnect":
                CONNECTED.pop(key, None)
                PENDING.pop(key, None)
                return {"connected": False}
    if not config:
        if action == "status":
            return {"configured": False, "connected": False}
        raise ValueError(f"{BRANDS[brand]} 개발자 프로젝트의 Client ID, Secret 및 콜백 주소가 필요해요.")
    client, secret, callback, origin = config
    if action == "status":
        return {"configured": True, "connected": bool(link)}
    if action == "start":
        state = secrets.token_urlsafe(32)
        if store:
            store.save("state", state, now + 600)
        else:
            with LOCK:
                PENDING[key] = (state, now + 600)
        params = {"client_id": client, "redirect_uri": callback, "response_type": "code", "state": state}
        return {"state": state, "url": ACCOUNT_ORIGIN + "/api/v1/user/oauth2/authorize?" + urlencode(params)}
    if action == "finish":
        state, code = request.get("state"), request.get("code")
        if (not isinstance(state, str) or len(state) != 43 or not state.isascii()
                or not all(ch.isalnum() or ch in "-_" for ch in state)
                or not isinstance(code, str) or not code or len(code) > 4096):
            raise ValueError("차량 로그인 응답을 확인해주세요.")
        if store:
            valid_state = store.consume(state, now)
        else:
            with LOCK:
                pending = PENDING.get(key)
                valid_state = pending and secrets.compare_digest(pending[0], state)
                if valid_state:
                    del PENDING[key]
        if not valid_state:
            raise ValueError("연결 요청이 만료됐어요. 차량 연결을 다시 시작해주세요.")
        basic = base64.b64encode(f"{client}:{secret}".encode()).decode()
        token = provider_json(ACCOUNT_ORIGIN + "/api/v1/user/oauth2/token", {
            "Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded",
        }, {"grant_type": "authorization_code", "code": code, "redirect_uri": callback})
        access = token["access_token"]
        expires = float(token.get("expires_in", 7200))
        if not isinstance(access, str) or not access or not 0 < expires < float("inf"):
            raise ValueError("차량 인증 응답을 확인해주세요.")
        if store:
            store.save("token", access, time.time() + expires)
        else:
            with LOCK:
                CONNECTED[key] = (access, time.monotonic() + expires)
        return {"connected": True}
    if action == "vehicles":
        if not link:
            raise ValueError("먼저 제조사 계정을 연결해주세요.")
        payload = provider_json(origin + "/api/v1/car/profile/carlist", {"Authorization": "Bearer " + link[0]})
        rows = payload.get("cars")
        if not isinstance(rows, list):
            raise ValueError("제조사 차량 목록을 확인할 수 없어요. 차량 데이터 제공 동의와 API 권한을 확인해주세요.")
        return {"vehicles": [
            {"name": row.get("carSellname") or row.get("carName") or "모델명 미제공",
             "nickname": row.get("carNickname") or ""}
            for row in rows if isinstance(row, dict) and row.get("carType") == "EV"
        ]}
    raise ValueError("지원하지 않는 차량 연결 요청입니다.")
