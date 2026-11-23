"""주차장 표기 정규화.

AI가 읽은 표지판 글자는 'B2', '지하2층', 'B2F', 'A17', 'A-17' 처럼 제각각이라
화면에 보여줄 표준 표기("지하 2층 A-17")로 맞춥니다.
"""
from __future__ import annotations

import re

_B_FLOOR = re.compile(r"^(?:B|지하)\s*(\d{1,2})\s*(?:F|층)?$", re.IGNORECASE)
_UP_FLOOR = re.compile(r"^(?:지상\s*)?(\d{1,2})\s*(?:F|층)$", re.IGNORECASE)
_MINUS_FLOOR = re.compile(r"^-\s*(\d{1,2})$")
_ROOF = re.compile(r"^(?:RF|R|옥상|루프탑)(?:\s*층)?$", re.IGNORECASE)
_ZONE_SPOT = re.compile(r"^([A-Za-z가-힣]{1,3})\s*-?\s*(\d{1,4})$")
_DIGITS = re.compile(r"\d{1,4}")
_ZONE_SUFFIX = re.compile(r"\s*(?:구역|zone|ZONE|Zone)$")


def _clean(value: object, max_len: int = 40) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip().strip("\"'")
    if not text or text.lower() in {"null", "none", "unknown", "n/a", "알 수 없음", "없음", "-"}:
        return None
    return text[:max_len]


def normalize_floor(value: object) -> str | None:
    text = _clean(value)
    if not text:
        return None
    compact = text.replace(" ", "")
    if m := _B_FLOOR.match(compact):
        return f"지하 {int(m.group(1))}층"
    if m := _MINUS_FLOOR.match(compact):
        return f"지하 {int(m.group(1))}층"
    if _ROOF.match(compact):
        return "옥상"
    if m := _UP_FLOOR.match(compact):
        return f"지상 {int(m.group(1))}층"
    return text  # 'P2', '중2층' 등 해석이 애매하면 원문 유지


def normalize_zone_spot(zone: object, spot: object) -> tuple[str | None, str | None]:
    z = _clean(zone, 12)
    s = _clean(spot, 12)
    if z:
        z = _ZONE_SUFFIX.sub("", z).strip() or None
    # zone에 'A17' 처럼 번호까지 붙어 온 경우 분리
    if z and not s and (m := _ZONE_SPOT.match(z.replace(" ", ""))):
        z, s = m.group(1), m.group(2)
    if s:
        digits = _DIGITS.search(s)
        s = digits.group(0) if digits else s
    if z and re.fullmatch(r"[a-z]{1,3}", z):
        z = z.upper()
    return z, s


def build_label(floor: str | None, zone: str | None, spot: str | None) -> str | None:
    parts: list[str] = []
    if floor:
        parts.append(floor)
    if zone and spot:
        parts.append(f"{zone}-{spot}")
    elif zone:
        parts.append(f"{zone}구역")
    elif spot:
        parts.append(f"{spot}번")
    return " ".join(parts) or None
