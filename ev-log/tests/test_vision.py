"""AI 응답 해석·정규화, 공급자별 요청 형식 단위 테스트."""
import json

import pytest

from backend.parking.normalize import build_label, normalize_floor, normalize_zone_spot
from backend.parking.vision import RateLimiter, VisionClient, VisionError, parse_vision_response


@pytest.mark.parametrize("raw,expected", [
    ("B2", "지하 2층"), ("b2", "지하 2층"), ("B2F", "지하 2층"), ("지하2층", "지하 2층"), ("지하 3", "지하 3층"),
    ("-1", "지하 1층"), ("2F", "지상 2층"), ("1층", "지상 1층"), ("지상 4층", "지상 4층"),
    ("RF", "옥상"), ("옥상", "옥상"), ("P2", "P2"), (None, None), ("null", None), ("", None),
])
def test_normalize_floor(raw, expected):
    assert normalize_floor(raw) == expected


@pytest.mark.parametrize("zone,spot,expected", [
    ("A17", None, ("A", "17")), ("A-17", None, ("A", "17")), ("a", "17번", ("A", "17")),
    ("A구역", None, ("A", None)), ("가", "3", ("가", "3")), (None, "17", (None, "17")), (None, None, (None, None)),
])
def test_normalize_zone_spot(zone, spot, expected):
    assert normalize_zone_spot(zone, spot) == expected


def test_build_label():
    assert build_label("지하 2층", "A", "17") == "지하 2층 A-17"
    assert build_label("지하 2층", "A", None) == "지하 2층 A구역"
    assert build_label("지하 2층", None, "17") == "지하 2층 17번"
    assert build_label(None, "A", "17") == "A-17"
    assert build_label(None, None, None) is None


def test_parse_fenced_and_noisy_json():
    text = '결과입니다\n```json\n{"floor": "B3", "zone": "C", "spot": "05", "confidence": "HIGH", "evidence": "B3 C-05"}\n```'
    r = parse_vision_response(text, "openai", "m")
    assert r.label == "지하 3층 C-05"
    assert r.confidence == "high"
    assert r.evidence == ["B3 C-05"]
    assert r.ai_generated is True


def test_parse_nothing_found_forces_low_confidence():
    r = parse_vision_response('{"floor": null, "zone": null, "spot": null, "confidence": "high"}', "gemini", "m")
    assert r.label is None
    assert r.confidence == "low"
    assert "다시 찍어" in r.note


def test_parse_garbage_raises():
    with pytest.raises(VisionError):
        parse_vision_response("죄송하지만 분석할 수 없습니다", "gemini", "m")


def _capture(reply):
    calls = []

    def transport(url, headers, payload, timeout):
        calls.append((url, headers, payload))
        return reply

    return calls, transport


SIGN = json.dumps({"floor": "B1", "zone": "D", "spot": "12", "confidence": "medium"})


def test_gemini_request_shape():
    calls, t = _capture({"candidates": [{"content": {"parts": [{"text": SIGN}]}}]})
    r = VisionClient("gemini", "gemini-x", "k", transport=t).analyze(b"\xff\xd8jpeg")
    url, headers, payload = calls[0]
    assert url.endswith("/models/gemini-x:generateContent")
    assert headers["x-goog-api-key"] == "k"
    assert payload["generationConfig"]["responseMimeType"] == "application/json"
    assert "temperature" not in payload["generationConfig"]  # 최신 Gemini에서 지원 중단된 파라미터
    assert payload["contents"][0]["parts"][0]["inline_data"]["mime_type"] == "image/jpeg"
    assert r.label == "지하 1층 D-12" and r.provider == "gemini"


def test_openai_request_shape():
    calls, t = _capture({"choices": [{"message": {"content": SIGN}}]})
    r = VisionClient("openai", "gpt-x", "k", transport=t).analyze(b"img")
    url, headers, payload = calls[0]
    assert url == "https://api.openai.com/v1/chat/completions"
    assert headers["Authorization"] == "Bearer k"
    assert payload["response_format"] == {"type": "json_object"}
    image_part = payload["messages"][1]["content"][1]
    assert image_part["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert r.label == "지하 1층 D-12"


def test_anthropic_request_shape():
    calls, t = _capture({"content": [{"type": "text", "text": SIGN}]})
    r = VisionClient("anthropic", "claude-x", "k", transport=t).analyze(b"img")
    url, headers, payload = calls[0]
    assert url == "https://api.anthropic.com/v1/messages"
    assert headers["x-api-key"] == "k" and headers["anthropic-version"]
    assert payload["messages"][0]["content"][0]["source"]["type"] == "base64"
    assert r.label == "지하 1층 D-12"


def test_disabled_without_key():
    client = VisionClient("openai", "gpt-x", "")
    assert client.enabled is False
    with pytest.raises(VisionError) as exc:
        client.analyze(b"img")
    assert exc.value.status == 503


def test_mock_is_labeled():
    r = VisionClient("mock", "mock-vision").analyze(b"img")
    assert r.is_mock is True and r.label == "지하 2층 A-17"


def test_rate_limiter():
    rl = RateLimiter(per_user_hour=2, global_day=100)
    rl.check("u1")
    rl.check("u1")
    with pytest.raises(VisionError):
        rl.check("u1")
    rl.check("u2")  # 다른 사용자는 영향 없음
