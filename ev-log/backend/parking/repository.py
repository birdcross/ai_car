"""주차 기록 저장소 (SQLite)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from ..core.db import Database

SCHEMA = """
CREATE TABLE IF NOT EXISTS parking_photos (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    width         INTEGER,
    height        INTEGER,
    size_bytes    INTEGER,
    analysis_json TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parking_photos_user ON parking_photos (user_id, created_at);

CREATE TABLE IF NOT EXISTS parking_records (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    label           TEXT NOT NULL,
    memo            TEXT NOT NULL DEFAULT '',
    latitude        REAL,
    longitude       REAL,
    accuracy_m      REAL,
    location_source TEXT NOT NULL DEFAULT 'none',
    photo_id        TEXT REFERENCES parking_photos (id) ON DELETE SET NULL,
    ai_label        TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parking_records_user ON parking_records (user_id, created_at DESC);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class ParkingRepository:
    def __init__(self, db: Database):
        self.db = db
        db.ensure_schema(SCHEMA)

    # ------------------------------------------------------------ photos
    def add_photo(self, user_id: str, photo_id: str, width: int, height: int, size: int,
                  analysis: dict[str, Any] | None) -> None:
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO parking_photos (id, user_id, width, height, size_bytes, analysis_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (photo_id, user_id, width, height, size,
                 json.dumps(analysis, ensure_ascii=False) if analysis else None, _now()),
            )

    def get_photo(self, user_id: str, photo_id: str) -> dict[str, Any] | None:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM parking_photos WHERE id = ? AND user_id = ?", (photo_id, user_id)
            ).fetchone()
        if not row:
            return None
        data = dict(row)
        data["analysis"] = json.loads(data.pop("analysis_json")) if data.get("analysis_json") else None
        return data

    def orphan_photo_ids(self, user_id: str, older_than_hours: int = 24) -> list[str]:
        """기록에 연결되지 않은 채 오래된 사진(찍고 저장하지 않은 사진)."""
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=older_than_hours)).isoformat(timespec="seconds")
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT p.id FROM parking_photos p LEFT JOIN parking_records r ON r.photo_id = p.id "
                "WHERE p.user_id = ? AND r.id IS NULL AND p.created_at < ?",
                (user_id, cutoff.replace("+00:00", "Z")),
            ).fetchall()
        return [r["id"] for r in rows]

    def delete_photos(self, photo_ids: list[str]) -> None:
        if not photo_ids:
            return
        with self.db.connect() as conn:
            conn.executemany("DELETE FROM parking_photos WHERE id = ?", [(pid,) for pid in photo_ids])

    # ------------------------------------------------------------ records
    def create_record(self, user_id: str, *, label: str, memo: str, latitude: float | None,
                      longitude: float | None, accuracy_m: float | None, location_source: str,
                      photo_id: str | None, ai_label: str | None,
                      created_at: str | None = None) -> dict[str, Any]:
        record_id = uuid.uuid4().hex
        now = _now()
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO parking_records (id, user_id, label, memo, latitude, longitude, accuracy_m, "
                "location_source, photo_id, ai_label, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (record_id, user_id, label, memo, latitude, longitude, accuracy_m, location_source,
                 photo_id, ai_label, created_at or now, now),
            )
        return self.get_record(user_id, record_id)  # type: ignore[return-value]

    def get_record(self, user_id: str, record_id: str) -> dict[str, Any] | None:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM parking_records WHERE id = ? AND user_id = ?", (record_id, user_id)
            ).fetchone()
        return dict(row) if row else None

    def list_records(self, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM parking_records WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def update_record(self, user_id: str, record_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {k: v for k, v in fields.items() if k in {"label", "memo"}}
        if allowed:
            sets = ", ".join(f"{k} = ?" for k in allowed)
            with self.db.connect() as conn:
                conn.execute(
                    f"UPDATE parking_records SET {sets}, updated_at = ? WHERE id = ? AND user_id = ?",
                    (*allowed.values(), _now(), record_id, user_id),
                )
        return self.get_record(user_id, record_id)

    def delete_record(self, user_id: str, record_id: str) -> str | None:
        """기록을 지우고, 함께 지워야 할 사진 ID를 돌려줍니다."""
        record = self.get_record(user_id, record_id)
        if not record:
            return None
        with self.db.connect() as conn:
            conn.execute("DELETE FROM parking_records WHERE id = ? AND user_id = ?", (record_id, user_id))
            if record["photo_id"]:
                conn.execute("DELETE FROM parking_photos WHERE id = ? AND user_id = ?", (record["photo_id"], user_id))
        return record["photo_id"] or ""

    def delete_all(self, user_id: str) -> list[str]:
        with self.db.connect() as conn:
            photo_ids = [r["id"] for r in conn.execute(
                "SELECT id FROM parking_photos WHERE user_id = ?", (user_id,)).fetchall()]
            conn.execute("DELETE FROM parking_records WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM parking_photos WHERE user_id = ?", (user_id,))
        return photo_ids

    # ------------------------------------------------------------ 발표용 통계
    def stats(self) -> dict[str, Any]:
        with self.db.connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*)                                           AS records,
                       COUNT(DISTINCT user_id)                            AS users,
                       SUM(latitude IS NOT NULL)                          AS with_gps,
                       SUM(photo_id IS NOT NULL)                          AS with_photo,
                       SUM(ai_label IS NOT NULL)                          AS ai_suggested,
                       SUM(ai_label IS NOT NULL AND ai_label = label)     AS ai_accepted,
                       SUM(accuracy_m > 50)                               AS gps_weak,
                       ROUND(AVG(accuracy_m), 1)                          AS avg_accuracy_m
                FROM parking_records
                """
            ).fetchone()
        data = {k: (row[k] or 0) for k in row.keys()}
        data["ai_accept_rate"] = round(data["ai_accepted"] / data["ai_suggested"], 3) if data["ai_suggested"] else None
        return data
