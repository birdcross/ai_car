"""EV Log 공통 설정.

모든 값은 환경변수(.env)에서 읽습니다. 팀원 기능도 이 Settings 객체를 함께 사용하세요.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:  # python-dotenv가 있으면 .env 자동 로드 (없어도 동작)
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _detect_provider() -> str:
    """AI_PROVIDER가 비어 있으면 설정된 API 키를 보고 자동 선택."""
    explicit = _env("AI_PROVIDER").lower()
    if explicit:
        return explicit
    if _env("GEMINI_API_KEY"):
        return "gemini"
    if _env("OPENAI_API_KEY"):
        return "openai"
    if _env("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "none"


DEFAULT_MODELS = {
    "gemini": "gemini-3.5-flash-lite",
    "openai": "gpt-4.1-mini",
    "anthropic": "claude-haiku-5-5",
    "mock": "mock-vision",
    "none": "",
}


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR") or PROJECT_ROOT / "data"))
    database_path: Path | None = None
    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in _env("CORS_ORIGINS").split(",") if o.strip()]
    )
    admin_token: str = field(default_factory=lambda: _env("ADMIN_TOKEN"))

    # --- AI (주차 사진 인식) ---
    ai_provider: str = field(default_factory=_detect_provider)
    ai_model: str = ""
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    anthropic_api_key: str = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    ai_timeout_s: int = field(default_factory=lambda: _env_int("AI_TIMEOUT_SECONDS", 25))
    ai_user_hourly_limit: int = field(default_factory=lambda: _env_int("PARKING_AI_HOURLY_LIMIT", 20))
    ai_daily_limit: int = field(default_factory=lambda: _env_int("PARKING_AI_DAILY_LIMIT", 500))

    # --- 사진 저장 ---
    photo_max_bytes: int = field(default_factory=lambda: _env_int("PARKING_PHOTO_MAX_BYTES", 8 * 1024 * 1024))
    photo_max_side: int = field(default_factory=lambda: _env_int("PARKING_PHOTO_MAX_SIDE", 1600))

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir)
        if self.database_path is None:
            self.database_path = Path(_env("DATABASE_PATH") or self.data_dir / "evlog.db")
        if not self.ai_model:
            self.ai_model = _env("AI_MODEL") or DEFAULT_MODELS.get(self.ai_provider, "")

    @property
    def photo_dir(self) -> Path:
        return self.data_dir / "parking_photos"

    def api_key_for(self, provider: str) -> str:
        return {
            "gemini": self.gemini_api_key,
            "openai": self.openai_api_key,
            "anthropic": self.anthropic_api_key,
        }.get(provider, "")
