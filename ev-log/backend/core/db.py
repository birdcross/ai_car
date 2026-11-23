"""공용 SQLite 헬퍼.

- 기능별로 테이블 이름에 접두어를 붙입니다. (parking_*, ledger_*, ...)
- 각 기능은 앱 시작 시 `db.ensure_schema(SQL)`로 자기 테이블을 만듭니다.
- 운영 DB를 Supabase(Postgres)로 바꿀 때는 각 기능의 repository.py만 교체하면 됩니다.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class Database:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ensure_schema(self, sql: str) -> None:
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.executescript(sql)
