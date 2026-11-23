"""주차 위치 API 통합 테스트 (실제 서버에 HTTP 요청)."""
import base64
import io
import uuid
from pathlib import Path

import requests
from PIL import Image


def user():
    return f"test-{uuid.uuid4().hex[:12]}"


def call(server, method, path, uid=None, **kw):
    headers = kw.pop("headers", {})
    if uid:
        headers["X-User-Id"] = uid
    return requests.request(method, server["base"] + path, headers=headers, timeout=10, **kw)


def agree(server, uid, *scopes):
    r = call(server, "POST", "/api/consent/", uid, json={"scopes": list(scopes)})
    assert r.status_code == 200, r.text


def jpeg_with_gps_exif() -> str:
    img = Image.new("RGB", (2400, 1800), (40, 40, 40))
    exif = Image.Exif()
    exif[0x010F] = "TestPhone"  # Make
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2] = "N", (37.0, 30.0, 0.0)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def test_requires_user_id(server):
    assert call(server, "GET", "/api/parking/latest").status_code == 401
    assert call(server, "GET", "/api/parking/latest", "bad id!").status_code == 401


def test_static_page_served(server):
    r = requests.get(server["base"] + "/parking/", timeout=5)
    assert r.status_code == 200 and "내 차 주차 위치" in r.text


def test_label_only_record_and_latest(server):
    uid = user()
    assert call(server, "GET", "/api/parking/latest", uid).json() == {"record": None}
    assert call(server, "POST", "/api/parking/records", uid, json={}).status_code == 422

    r = call(server, "POST", "/api/parking/records", uid, json={"label": "  지하 2층 A-17 ", "memo": "엘리베이터 옆"})
    assert r.status_code == 201
    rec = r.json()["record"]
    assert rec["label"] == "지하 2층 A-17" and rec["location"] is None and rec["photo"] is None
    assert call(server, "GET", "/api/parking/latest", uid).json()["record"]["id"] == rec["id"]


def test_gps_requires_consent(server):
    uid = user()
    body = {"label": "B1", "latitude": 37.5, "longitude": 127.0, "accuracy_m": 180}
    r = call(server, "POST", "/api/parking/records", uid, json=body)
    assert r.status_code == 403 and "동의" in r.json()["detail"]

    agree(server, uid, "location")
    rec = call(server, "POST", "/api/parking/records", uid, json=body).json()["record"]
    assert rec["location"]["is_weak"] is True and rec["location"]["source"] == "gps"

    assert call(server, "POST", "/api/parking/records", uid, json={"latitude": 37.5}).status_code == 422
    assert call(server, "POST", "/api/parking/records", uid, json={"label": "x", "latitude": 99, "longitude": 1}).status_code == 422

    # 동의 철회 후에는 다시 막힘
    assert call(server, "DELETE", "/api/consent/location", uid).status_code == 200
    assert call(server, "POST", "/api/parking/records", uid, json=body).status_code == 403


def test_photo_ai_flow(server):
    uid, other = user(), user()
    image = jpeg_with_gps_exif()
    assert call(server, "POST", "/api/parking/photos", uid, json={"image": image}).status_code == 403

    agree(server, uid, "photo_ai")
    r = call(server, "POST", "/api/parking/photos", uid, json={"image": image})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["analysis"]["label"] == "지하 2층 A-17"      # 'B2' + 'A17' 정규화
    assert body["analysis"]["ai_generated"] is True
    assert body["photo"]["width"] == 1600                   # 서버에서 축소
    assert body["photo"]["url"] == f"/api/parking/photos/{body['photo']['id']}"

    # 저장된 사진에는 EXIF(위치·기기 정보)가 없어야 함
    img_resp = call(server, "GET", body["photo"]["url"], uid)
    assert img_resp.status_code == 200 and img_resp.headers["content-type"] == "image/jpeg"
    assert len(Image.open(io.BytesIO(img_resp.content)).getexif()) == 0
    # 다른 사용자는 볼 수 없음
    assert call(server, "GET", body["photo"]["url"], other).status_code == 404

    # 라벨을 비우면 AI 결과로 저장되고, 수락 여부가 기록됨
    rec = call(server, "POST", "/api/parking/records", uid, json={"photo_id": body["photo"]["id"]}).json()["record"]
    assert rec["label"] == "지하 2층 A-17"
    assert rec["ai"] == {"suggested_label": "지하 2층 A-17", "accepted": True}
    assert call(server, "POST", "/api/parking/records", other, json={"photo_id": body["photo"]["id"]}).status_code == 404

    # 사용자가 고쳐서 저장하면 accepted=False (발표용 정확도 지표)
    p2 = call(server, "POST", "/api/parking/photos", uid, json={"image": image}).json()
    rec2 = call(server, "POST", "/api/parking/records", uid,
                json={"label": "지하 2층 A-18", "photo_id": p2["photo"]["id"]}).json()["record"]
    assert rec2["ai"]["accepted"] is False

    # 기록 삭제 시 사진 파일도 삭제
    photo_file = Path(server["settings"].photo_dir) / f"{p2['photo']['id']}.jpg"
    assert photo_file.exists()
    assert call(server, "DELETE", f"/api/parking/records/{rec2['id']}", uid).status_code == 200
    assert not photo_file.exists()
    assert call(server, "DELETE", f"/api/parking/records/{rec2['id']}", uid).status_code == 404


def test_photo_without_analysis_and_invalid_image(server):
    uid = user()
    agree(server, uid, "photo_ai")
    calls_before = len(server["fake"].calls)
    r = call(server, "POST", "/api/parking/photos", uid, json={"image": jpeg_with_gps_exif(), "analyze": False})
    assert r.status_code == 201 and r.json()["analysis"] is None
    assert len(server["fake"].calls) == calls_before
    bad = "data:image/jpeg;base64," + base64.b64encode(b"not an image at all").decode()
    assert call(server, "POST", "/api/parking/photos", uid, json={"image": bad}).status_code == 422


def test_ai_rate_limit_returns_error_but_keeps_photo(server):
    uid = user()
    agree(server, uid, "photo_ai")
    image = jpeg_with_gps_exif()
    results = [call(server, "POST", "/api/parking/photos", uid, json={"image": image}).json() for _ in range(6)]
    last = results[-1]
    assert last["analysis"] is None and "1시간에 최대" in last["ai"]["error"]
    assert last["photo"]["id"]  # 사진은 저장됨


def test_patch_list_isolation_and_delete_all(server):
    uid, other = user(), user()
    ids = [call(server, "POST", "/api/parking/records", uid, json={"label": f"B{i}"}).json()["record"]["id"]
           for i in range(1, 4)]
    r = call(server, "PATCH", f"/api/parking/records/{ids[0]}", uid, json={"memo": " 흰색 SUV 옆 "})
    assert r.json()["record"]["memo"] == "흰색 SUV 옆"
    assert call(server, "PATCH", f"/api/parking/records/{ids[0]}", uid, json={"label": "  "}).status_code == 422
    assert call(server, "PATCH", f"/api/parking/records/{ids[0]}", other, json={"memo": "x"}).status_code == 404

    records = call(server, "GET", "/api/parking/records?limit=2", uid).json()["records"]
    assert [r["label"] for r in records] == ["B3", "B2"]
    assert call(server, "GET", "/api/parking/records", other).json()["records"] == []

    assert call(server, "DELETE", "/api/parking/records", uid).status_code == 200
    assert call(server, "GET", "/api/parking/records", uid).json()["records"] == []


def test_offline_parked_at(server):
    """오프라인에서 저장해 두었다가 나중에 보낸 기록은 실제 주차 시각으로 저장."""
    from datetime import datetime, timedelta, timezone
    uid = user()
    two_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).replace(microsecond=0)
    rec = call(server, "POST", "/api/parking/records", uid,
               json={"label": "B2", "parked_at": two_hours_ago.astimezone(timezone(timedelta(hours=9))).isoformat()}
               ).json()["record"]
    assert rec["created_at"] == two_hours_ago.isoformat().replace("+00:00", "Z")

    # 7일보다 오래됐거나 미래 시각이면 무시하고 현재 시각 사용
    old = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    rec2 = call(server, "POST", "/api/parking/records", uid, json={"label": "B3", "parked_at": old}).json()["record"]
    assert rec2["created_at"] > rec["created_at"]


def test_stats_requires_admin(server):
    assert call(server, "GET", "/api/parking/stats").status_code == 404
    r = call(server, "GET", "/api/parking/stats", headers={"X-Admin-Token": "admin-secret"})
    assert r.status_code == 200
    data = r.json()
    assert {"records", "users", "with_gps", "with_photo", "ai_accept_rate"} <= data.keys()
