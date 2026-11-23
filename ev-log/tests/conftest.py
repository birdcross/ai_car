"""테스트용 서버: 실제 uvicorn을 스레드로 띄우고 HTTP로 호출합니다.
AI 공급자는 가짜 HTTP 전송(fake transport)으로 바꿔 외부 API 없이 검증합니다.
"""
from __future__ import annotations

import json
import socket
import threading
import time

import pytest
import uvicorn
from starlette.applications import Starlette

from backend.app_factory import mount_frontend
from backend.core.config import Settings
from backend.core.consent import ConsentStore, create_consent_app
from backend.core.db import Database
from backend.parking import create_parking_app
from backend.parking.vision import VisionClient


class FakeGemini:
    """Gemini generateContent 응답을 흉내 냅니다."""

    def __init__(self):
        self.calls = []
        self.reply = {"floor": "B2", "zone": "A17", "spot": None, "evidence": ["B2", "A17"],
                      "landmarks": ["엘리베이터 옆"], "confidence": "high", "note": "기둥 표지판을 읽었어요."}

    def __call__(self, url, headers, payload, timeout):
        self.calls.append({"url": url, "headers": headers, "payload": payload})
        text = json.dumps(self.reply, ensure_ascii=False)
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def server(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("data")
    settings = Settings(data_dir=data_dir, admin_token="admin-secret", ai_user_hourly_limit=5)
    fake = FakeGemini()
    vision = VisionClient("gemini", "gemini-test", "test-key", transport=fake)

    db = Database(settings.database_path)
    consent = ConsentStore(db)
    app = Starlette()
    app.mount("/api/consent", create_consent_app(consent))
    app.mount("/api/parking", create_parking_app(settings, db=db, consent=consent, vision=vision))
    mount_frontend(app)

    port = _free_port()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield {"base": f"http://127.0.0.1:{port}", "settings": settings, "fake": fake}
    srv.should_exit = True
    thread.join(timeout=5)
