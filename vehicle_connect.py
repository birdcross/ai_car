"""Hyundai Bluelink account connection."""
import base64
import json
import os
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

from vehicle_oauth_store import SupabaseOAuthStore

ACCOUNT_ORIGIN = "https://prd.kr-ccapi.hyundai.com"
DATA_ORIGINS = {"dev": "https://dev.kr-ccapi.hyundai.com", "prd": ACCOUNT_ORIGIN}
LOCK = threading.Lock()
PENDING = {}
CONNECTED = {}
CAR_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
KOREA_TIME = timezone(timedelta(hours=9))
SUMMARY_PATHS = {"range": "/dte", "odometer": "/odometer", "battery": "/ev/battery", "charging": "/ev/charging"}


def configuration():
    client = os.getenv("HYUNDAI_CLIENT_ID")
    secret = os.getenv("HYUNDAI_CLIENT_SECRET")
    callback = os.getenv("HYUNDAI_REDIRECT_URI")
    if not all((client, secret, callback)):
        return None
    url = urlsplit(callback)
    if (not url.hostname or url.username or url.password or url.path != "/vehicle-connect/callback"
            or url.query or url.fragment
            or not (url.scheme == "https" or (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1"}))):
        raise ValueError("차량 연결 콜백 주소 설정을 확인해주세요.")
    stage = os.getenv("HYUNDAI_DATA_STAGE", "dev")
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


def car_list(origin, headers):
    rows = provider_json(origin + "/api/v1/car/profile/carlist", headers).get("cars")
    if not isinstance(rows, list):
        raise ValueError("제조사 차량 목록을 확인할 수 없어요. 차량 데이터 제공 동의와 API 권한을 확인해주세요.")
    return [row for row in rows if isinstance(row, dict) and row.get("carType") == "EV"]


class ChargingDataError(ValueError):
    """The provider returned an unusable charging observation."""


def charging_snapshot(payload):
    def number(value, upper=None):
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not 0 <= value < float("inf") or (upper is not None and value > upper)):
            raise ChargingDataError("현대 충전 상태 응답의 숫자 항목을 확인할 수 없어요.")
        return value

    def enum(value, upper):
        if type(value) is not int:
            raise ChargingDataError("현대 충전 상태 응답의 코드 항목을 확인할 수 없어요.")
        return number(value, upper)

    if not isinstance(payload, dict):
        raise ChargingDataError("현대 충전 상태 응답 형식을 확인할 수 없어요.")
    charging = payload.get("batteryCharge")
    timestamp = payload.get("timestamp")
    if not isinstance(charging, bool) or not isinstance(timestamp, str) or not re.fullmatch(r"[0-9]{14}", timestamp):
        raise ChargingDataError("현대 충전 상태 또는 차량 전송 시각을 확인할 수 없어요.")
    try:
        reported = datetime.strptime(timestamp, "%Y%m%d%H%M%S").replace(tzinfo=KOREA_TIME)
    except ValueError as error:
        raise ChargingDataError("현대 충전 상태의 차량 전송 시각이 올바르지 않아요.") from error
    target = payload.get("targetSOC")
    remaining = payload.get("remainTime")
    if any(value is not None and not isinstance(value, dict) for value in (target, remaining)):
        raise ChargingDataError("현대 충전 목표 또는 남은 시간 형식을 확인할 수 없어요.")
    target = target or {}
    remaining = remaining or {}
    plug = enum(payload.get("batteryPlugin"), 2)
    if charging and plug == 0:
        raise ChargingDataError("차량이 충전 중이라고 응답했지만 플러그 상태는 미연결로 들어왔어요.")
    message_id = payload.get("msgId")
    return {
        "battery_plugin": plug,
        "battery_charge": charging,
        "soc": number(payload.get("soc"), 100),
        "target_plug_type": enum(target["plugType"], 2) if target.get("plugType") is not None else None,
        "target_soc": number(target["targetSOClevel"], 100) if target.get("targetSOClevel") is not None else None,
        "remaining_value": number(remaining["value"]) if remaining.get("value") is not None else None,
        "remaining_unit": enum(remaining["unit"], 3) if remaining.get("unit") is not None else None,
        "vehicle_reported_at": reported.isoformat(),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "message_id": message_id[:128] if isinstance(message_id, str) else None,
    }


def handle(user_id, request):
    if not isinstance(request, dict):
        raise ValueError("차량 연결 요청 형식을 확인해주세요.")
    action, brand = request.get("action"), request.get("brand")
    if brand != "hyundai":
        raise ValueError("현대 블루링크 차량 연결만 지원해요.")
    key = (user_id, brand)
    config = configuration()
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
        if config and action in {"status", "vehicles", "monitor-vehicles", "charging", "vehicle-summary"}:
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
        raise ValueError("현대 블루링크 개발자 프로젝트의 Client ID, Secret 및 콜백 주소가 필요해요.")
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
    if action in {"vehicles", "monitor-vehicles", "charging", "vehicle-summary"}:
        if not link:
            raise ValueError("먼저 제조사 계정을 연결해주세요.")
        headers = {"Authorization": "Bearer " + link[0]}
        rows = car_list(origin, headers)
        if action in {"charging", "vehicle-summary"}:
            car_id = request.get("carId")
            if not isinstance(car_id, str) or not CAR_ID.fullmatch(car_id) or not any(row.get("carId") == car_id for row in rows):
                raise ValueError("연결된 현대 전기차를 다시 선택해주세요.")
            status_url = origin + "/api/v1/car/status/" + quote(car_id, safe="")
            if action == "charging":
                try:
                    snapshot = charging_snapshot(provider_json(status_url + SUMMARY_PATHS["charging"], headers))
                except ChargingDataError as error:
                    return {"snapshot": None, "chargingDataIssue": str(error)}
                if store:
                    store.save_charging_status(car_id, snapshot)
                return {"snapshot": snapshot}
            with ThreadPoolExecutor(max_workers=len(SUMMARY_PATHS)) as pool:
                requests = {field: pool.submit(provider_json, status_url + path, headers)
                            for field, path in SUMMARY_PATHS.items()}
                summary = {}
                charging_data_issue = None
                for field, pending in requests.items():
                    try:
                        payload = pending.result()
                        if field == "charging":
                            if isinstance(payload, dict) and "errCode" in payload:
                                raise ValueError("Vehicle charging status unavailable")
                            payload = charging_snapshot(payload)
                        elif not isinstance(payload, dict) or "errCode" in payload:
                            raise ValueError("Invalid vehicle status response")
                        summary[field] = payload
                    except ChargingDataError as error:
                        summary[field] = None
                        charging_data_issue = str(error)
                    except (OSError, ValueError, AttributeError):
                        summary[field] = None
            snapshot = summary["charging"]
            if snapshot and store:
                store.save_charging_status(car_id, snapshot)
            return {"summary": summary, "chargingDataIssue": charging_data_issue}
        return {"vehicles": [
            {"name": row.get("carSellname") or row.get("carName") or "모델명 미제공",
             "nickname": row.get("carNickname") or ""} | ({"id": row["carId"]} if action == "monitor-vehicles" else {})
            for row in rows if action == "vehicles" or (isinstance(row.get("carId"), str) and CAR_ID.fullmatch(row["carId"]))
        ]}
    raise ValueError("지원하지 않는 차량 연결 요청입니다.")
