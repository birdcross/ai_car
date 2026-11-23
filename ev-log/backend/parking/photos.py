"""주차 사진 처리 및 저장.

- 브라우저에서 1600px 이하 JPEG로 줄여서 보내지만, 서버에서도 다시 검증·재인코딩합니다.
- 재인코딩하면서 EXIF(촬영 위치·기기 정보 등 메타데이터)가 모두 제거됩니다.
- 저장소는 로컬 디스크(data/parking_photos). Supabase Storage 등으로 바꿀 때는
  PhotoStorage의 save/load/delete 세 메서드만 교체하면 됩니다.
"""
from __future__ import annotations

import base64
import binascii
import io
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 40_000_000  # 압축 폭탄 방지

_DATA_URL = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.*)$", re.DOTALL)
_ID = re.compile(r"^[a-f0-9]{32}$")


class PhotoError(ValueError):
    pass


@dataclass
class ProcessedPhoto:
    data: bytes
    width: int
    height: int
    mime: str = "image/jpeg"


def decode_image_payload(payload: str, max_bytes: int) -> bytes:
    match = _DATA_URL.match(payload.strip())
    raw_b64 = match.group(2) if match else payload.strip()
    if len(raw_b64) > max_bytes * 4 // 3 + 16:
        raise PhotoError("사진 용량이 너무 커요.")
    try:
        raw = base64.b64decode(raw_b64, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise PhotoError("사진 데이터를 읽을 수 없어요.") from exc
    if not raw:
        raise PhotoError("사진 데이터가 비어 있어요.")
    if len(raw) > max_bytes:
        raise PhotoError("사진 용량이 너무 커요.")
    return raw


def process_image(raw: bytes, max_side: int) -> ProcessedPhoto:
    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.format not in {"JPEG", "PNG", "WEBP", "MPO"}:
                raise PhotoError("JPEG, PNG, WEBP 사진만 올릴 수 있어요.")
            img = ImageOps.exif_transpose(img)  # 휴대폰 회전 정보 반영
            img = img.convert("RGB")
            img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=82, optimize=True)  # EXIF 미포함
            return ProcessedPhoto(out.getvalue(), img.width, img.height)
    except PhotoError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise PhotoError("사진 파일을 열 수 없어요. 다른 사진으로 시도해주세요.") from exc


class PhotoStorage:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, photo_id: str) -> Path:
        if not _ID.match(photo_id):
            raise PhotoError("잘못된 사진 ID입니다.")
        return self.root / f"{photo_id}.jpg"

    def save(self, data: bytes) -> str:
        photo_id = uuid.uuid4().hex
        self._path(photo_id).write_bytes(data)
        return photo_id

    def load(self, photo_id: str) -> bytes | None:
        path = self._path(photo_id)
        return path.read_bytes() if path.exists() else None

    def delete(self, photo_id: str) -> None:
        try:
            self._path(photo_id).unlink(missing_ok=True)
        except PhotoError:
            pass
