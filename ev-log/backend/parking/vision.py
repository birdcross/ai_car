"""주차 사진 AI 인식 (멀티모달).

사진 속 기둥·벽·바닥 표지판을 읽어 층/구역/번호를 JSON으로 받아옵니다.
- 공급자: Gemini / OpenAI / Anthropic (환경변수로 선택, SDK 없이 표준 라이브러리 HTTP 호출)
- mock: API 키 없이 로컬에서 화면 흐름을 확인하는 용도. 결과에 is_mock=True가 붙고 화면에 '데모 결과'로 표시됩니다.

설계 원칙
1. 보이는 글자만 근거로 답한다 (추측 금지, 근거 문자열 evidence 필수)
2. 번호판·사람 얼굴 등 개인정보는 읽지 않는다
3. 결과는 서버에서 다시 정규화하고, 사용자가 확인·수정한 뒤 저장한다
"""
from __future__ import annotations

import base64
import json
import logging
import re
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from threading import Lock
from typing import Any, Callable

from .normalize import _clean, build_label, normalize_floor, normalize_zone_spot

logger = logging.getLogger("evlog.parking.vision")

SYSTEM_PROMPT = """너는 주차장 사진에서 '차를 어디에 세웠는지'를 읽어내는 도우미다.
사진 속 기둥, 벽, 천장, 바닥의 표지판·페인트 글자를 읽고 아래 JSON 하나만 출력한다.

{
  "floor": "층 표기. 예: B2, 지하2층, 1F. 안 보이면 null",
  "zone": "구역 표기. 예: A, 가, 파랑. 안 보이면 null",
  "spot": "주차면/기둥 번호. 예: 17. 안 보이면 null",
  "evidence": ["판단 근거가 된, 사진에 실제로 보이는 글자 그대로. 예: 'B2 A-17'"],
  "landmarks": ["찾아갈 때 도움이 되는 주변 지형지물. 예: '엘리베이터 입구 옆', '전기차 충전기 앞'"],
  "confidence": "high | medium | low",
  "note": "사용자에게 보여줄 한 문장 요약(한국어)"
}

규칙
- 사진에 실제로 보이는 글자만 근거로 쓴다. 보이지 않으면 추측하지 말고 null.
- 층과 구역이 'B2-A17'처럼 붙어 있으면 floor="B2", zone="A", spot="17"로 나눈다.
- 글자가 흐리거나 일부만 보이면 confidence를 low로 하고 note에 다시 찍기를 권한다.
- 자동차 번호판, 사람 얼굴, 이름 등 개인정보는 절대 읽거나 적지 않는다.
- 주차장 사진이 아니면 모든 값을 null, confidence="low"로 하고 note에 이유를 적는다.
- JSON 외의 다른 글은 쓰지 않는다."""

USER_PROMPT = "이 사진에서 주차 위치(층·구역·번호)를 읽어 JSON으로 알려줘."


class VisionError(Exception):
    """사용자에게 그대로 보여줘도 되는 메시지를 담는 예외."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class ParkingVision:
    floor: str | None
    zone: str | None
    spot: str | None
    label: str | None
    evidence: list[str] = field(default_factory=list)
    landmarks: list[str] = field(default_factory=list)
    confidence: str = "low"
    note: str = ""
    provider: str = ""
    model: str = ""
    is_mock: bool = False
    ai_generated: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------- 파싱 / 정규화

def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise VisionError("AI 응답을 해석하지 못했어요. 다시 시도하거나 직접 입력해주세요.")
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise VisionError("AI 응답을 해석하지 못했어요. 다시 시도하거나 직접 입력해주세요.") from exc
    if not isinstance(data, dict):
        raise VisionError("AI 응답 형식이 올바르지 않아요.")
    return data


def _str_list(value: Any, limit: int = 4) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out = [c for v in value if (c := _clean(v, 60))]
    return out[:limit]


def parse_vision_response(text: str, provider: str, model: str, is_mock: bool = False) -> ParkingVision:
    data = _extract_json(text)
    floor = normalize_floor(data.get("floor"))
    zone, spot = normalize_zone_spot(data.get("zone"), data.get("spot"))
    confidence = str(data.get("confidence") or "low").lower()
    if confidence not in {"high", "medium", "low"}:
        confidence = "low"
    label = build_label(floor, zone, spot)
    if not label:
        confidence = "low"
    note = _clean(data.get("note"), 140) or (
        "층·구역 표지판을 찾지 못했어요. 기둥 번호가 보이게 다시 찍어주세요." if not label else ""
    )
    return ParkingVision(
        floor=floor,
        zone=zone,
        spot=spot,
        label=label,
        evidence=_str_list(data.get("evidence")),
        landmarks=_str_list(data.get("landmarks"), 3),
        confidence=confidence,
        note=note,
        provider=provider,
        model=model,
        is_mock=is_mock,
    )


# ---------------------------------------------------------------- HTTP 호출

Transport = Callable[[str, dict[str, str], dict[str, Any], int], dict[str, Any]]


def http_post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:300]
        if exc.code in (401, 403):
            raise VisionError("AI API 키가 올바르지 않거나 권한이 없어요. (서버 설정 확인 필요)", 503) from exc
        if exc.code == 429:
            raise VisionError("AI 사용량이 많아 잠시 후 다시 시도해주세요.", 429) from exc
        logger.warning("AI HTTP %s: %s", exc.code, detail)
        raise VisionError(f"AI 서비스 오류({exc.code}). 직접 입력해주세요.", 502) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise VisionError("AI 서비스에 연결하지 못했어요. 직접 입력해주세요.", 504) from exc


class VisionClient:
    """설정된 공급자로 사진을 보내고 ParkingVision을 돌려줍니다."""

    def __init__(self, provider: str, model: str, api_key: str = "", timeout: int = 25,
                 transport: Transport | None = None):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self.transport = transport or http_post_json

    @property
    def enabled(self) -> bool:
        if self.provider == "mock":
            return True
        return self.provider in {"gemini", "openai", "anthropic"} and bool(self.api_key)

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "provider": self.provider if self.enabled else None,
            "model": self.model if self.enabled else None,
            "is_mock": self.provider == "mock",
        }

    def analyze(self, image: bytes, mime: str = "image/jpeg") -> ParkingVision:
        if not self.enabled:
            raise VisionError("AI 사진 인식이 설정되지 않았어요. 위치를 직접 입력해주세요.", 503)
        if self.provider == "mock":
            return self._mock()
        b64 = base64.b64encode(image).decode("ascii")
        text = {"gemini": self._gemini, "openai": self._openai, "anthropic": self._anthropic}[self.provider](b64, mime)
        return parse_vision_response(text, self.provider, self.model)

    # --- 공급자별 요청 형식 -------------------------------------------------
    def _gemini(self, b64: str, mime: str) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [
                {"inline_data": {"mime_type": mime, "data": b64}},
                {"text": USER_PROMPT},
            ]}],
            "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": 600},
        }
        data = self.transport(url, {"x-goog-api-key": self.api_key}, payload, self.timeout)
        try:
            parts = data["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as exc:
            raise VisionError("AI가 이 사진을 분석하지 못했어요. 다른 각도로 다시 찍어주세요.") from exc

    def _openai(self, b64: str, mime: str) -> str:
        payload = {
            "model": self.model,
            "response_format": {"type": "json_object"},
            "max_completion_tokens": 600,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "text", "text": USER_PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"}},
                ]},
            ],
        }
        data = self.transport("https://api.openai.com/v1/chat/completions",
                              {"Authorization": f"Bearer {self.api_key}"}, payload, self.timeout)
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise VisionError("AI가 이 사진을 분석하지 못했어요. 다른 각도로 다시 찍어주세요.") from exc

    def _anthropic(self, b64: str, mime: str) -> str:
        payload = {
            "model": self.model,
            "max_tokens": 600,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
                {"type": "text", "text": USER_PROMPT},
            ]}],
        }
        headers = {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}
        data = self.transport("https://api.anthropic.com/v1/messages", headers, payload, self.timeout)
        try:
            return "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
        except (KeyError, TypeError) as exc:
            raise VisionError("AI가 이 사진을 분석하지 못했어요. 다른 각도로 다시 찍어주세요.") from exc

    def _mock(self) -> ParkingVision:
        sample = json.dumps({
            "floor": "B2", "zone": "A", "spot": "17",
            "evidence": ["B2", "A-17"], "landmarks": ["엘리베이터 입구 옆"],
            "confidence": "medium", "note": None,
        })
        return parse_vision_response(sample, "mock", self.model or "mock-vision", is_mock=True)


# ---------------------------------------------------------------- 사용량 제한

class RateLimiter:
    """API 비용 보호용 간단한 메모리 제한 (사용자별 시간당 + 전체 일일)."""

    def __init__(self, per_user_hour: int, global_day: int):
        self.per_user_hour = per_user_hour
        self.global_day = global_day
        self._user: dict[str, deque[float]] = defaultdict(deque)
        self._global: deque[float] = deque()
        self._lock = Lock()

    def check(self, user_id: str) -> None:
        now = time.time()
        with self._lock:
            hits = self._user[user_id]
            while hits and now - hits[0] > 3600:
                hits.popleft()
            while self._global and now - self._global[0] > 86400:
                self._global.popleft()
            if len(hits) >= self.per_user_hour:
                raise VisionError("사진 인식은 1시간에 최대 %d번까지 할 수 있어요. 직접 입력해주세요." % self.per_user_hour, 429)
            if len(self._global) >= self.global_day:
                raise VisionError("오늘 AI 인식 사용량이 모두 소진됐어요. 직접 입력해주세요.", 429)
            hits.append(now)
            self._global.append(now)
