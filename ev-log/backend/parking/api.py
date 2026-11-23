"""주차 위치 API (Starlette 하위 앱, /api/parking 에 마운트).

FastAPI 메인 앱에 한 줄로 붙습니다:  app.mount("/api/parking", create_parking_app(...))

  GET    /ai-status            AI 사진 인식 사용 가능 여부
  GET    /latest               가장 최근 주차 기록 (대시보드 카드용)
  GET    /records?limit=20     주차 기록 목록
  POST   /records              주차 위치 저장
  PATCH  /records/{id}         위치 표기·메모 수정
  DELETE /records/{id}         기록 삭제 (사진 포함)
  DELETE /records              내 기록 전체 삭제
  POST   /photos               사진 업로드 + AI 인식
  GET    /photos/{id}          사진 보기 (본인 것만)
  GET    /stats                발표용 집계 (X-Admin-Token 필요)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ..core.config import Settings
from ..core.consent import ConsentStore
from ..core.db import Database
from ..core.http import ERROR_HANDLERS, read_json
from ..core.identity import get_user_id
from .photos import PhotoError, PhotoStorage, decode_image_payload, process_image
from .repository import ParkingRepository
from .vision import RateLimiter, VisionClient, VisionError

GPS_WEAK_THRESHOLD_M = 50  # 프론트와 같은 기준: 이보다 오차가 크면 '위치가 애매함'


class RecordIn(BaseModel):
    label: str = Field("", max_length=60)
    memo: str = Field("", max_length=500)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    accuracy_m: float | None = Field(None, ge=0, le=100_000)
    photo_id: str | None = Field(None, max_length=32)
    parked_at: datetime | None = None  # 오프라인 저장 후 나중에 전송될 때 실제 주차 시각

    @field_validator("label", "memo")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class RecordPatch(BaseModel):
    label: str | None = Field(None, max_length=60)
    memo: str | None = Field(None, max_length=500)


class PhotoIn(BaseModel):
    image: str = Field(min_length=16)  # data URL 또는 base64
    analyze: bool = True


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def create_parking_app(settings: Settings | None = None, *, db: Database | None = None,
                       consent: ConsentStore | None = None, vision: VisionClient | None = None) -> Starlette:
    settings = settings or Settings()
    db = db or Database(settings.database_path)
    repo = ParkingRepository(db)
    consent = consent or ConsentStore(db)
    storage = PhotoStorage(settings.photo_dir)
    vision = vision or VisionClient(
        settings.ai_provider, settings.ai_model, settings.api_key_for(settings.ai_provider), settings.ai_timeout_s
    )
    limiter = RateLimiter(settings.ai_user_hourly_limit, settings.ai_daily_limit)

    def base(request: Request) -> str:
        return request.scope.get("root_path", "").rstrip("/")

    def serialize(request: Request, rec: dict[str, Any]) -> dict[str, Any]:
        has_gps = rec["latitude"] is not None and rec["longitude"] is not None
        return {
            "id": rec["id"],
            "label": rec["label"],
            "memo": rec["memo"],
            "location": {
                "latitude": rec["latitude"],
                "longitude": rec["longitude"],
                "accuracy_m": rec["accuracy_m"],
                "source": rec["location_source"],
                "is_weak": rec["accuracy_m"] is not None and rec["accuracy_m"] > GPS_WEAK_THRESHOLD_M,
            } if has_gps else None,
            "photo": {"id": rec["photo_id"], "url": f"{base(request)}/photos/{rec['photo_id']}"}
            if rec["photo_id"] else None,
            "ai": {"suggested_label": rec["ai_label"], "accepted": rec["ai_label"] == rec["label"]}
            if rec["ai_label"] else None,
            "created_at": rec["created_at"],
            "updated_at": rec["updated_at"],
        }

    # ------------------------------------------------------------------ routes
    async def ai_status(request: Request) -> JSONResponse:
        return JSONResponse(vision.status())

    async def latest(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        rows = await run_in_threadpool(repo.list_records, user_id, 1)
        return JSONResponse({"record": serialize(request, rows[0]) if rows else None})

    async def list_records(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        try:
            limit = max(1, min(50, int(request.query_params.get("limit", "20"))))
        except ValueError:
            limit = 20
        rows = await run_in_threadpool(repo.list_records, user_id, limit)
        return JSONResponse({"records": [serialize(request, r) for r in rows]})

    async def create_record(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        body = await read_json(request, RecordIn)

        has_lat, has_lng = body.latitude is not None, body.longitude is not None
        if has_lat != has_lng:
            raise HTTPException(422, "위도와 경도는 함께 보내야 합니다.")
        if has_lat:
            await run_in_threadpool(consent.require, user_id, "location")

        ai_label = None
        if body.photo_id:
            photo = await run_in_threadpool(repo.get_photo, user_id, body.photo_id)
            if not photo:
                raise HTTPException(404, "사진을 찾을 수 없어요. 다시 찍어주세요.")
            analysis = photo.get("analysis") or {}
            if not analysis.get("is_mock"):
                ai_label = analysis.get("label")

        if not (body.label or has_lat or body.photo_id or body.memo):
            raise HTTPException(422, "층·구역, 위치, 사진, 메모 중 하나는 있어야 저장할 수 있어요.")

        label = body.label or ai_label or (
            "GPS로 저장한 위치" if has_lat else "사진으로 저장한 위치" if body.photo_id else "메모로 저장한 위치"
        )

        parked_at = None
        if body.parked_at:
            now = datetime.now(timezone.utc)
            pa = body.parked_at if body.parked_at.tzinfo else body.parked_at.replace(tzinfo=timezone.utc)
            if now - timedelta(days=7) <= pa <= now + timedelta(minutes=5):
                parked_at = _iso(pa)

        rec = await run_in_threadpool(lambda: repo.create_record(
            user_id, label=label, memo=body.memo,
            latitude=body.latitude, longitude=body.longitude,
            accuracy_m=round(body.accuracy_m, 1) if body.accuracy_m is not None else None,
            location_source="gps" if has_lat else "none",
            photo_id=body.photo_id, ai_label=ai_label, created_at=parked_at,
        ))
        return JSONResponse({"record": serialize(request, rec)}, status_code=201)

    async def patch_record(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        body = await read_json(request, RecordPatch)
        fields = {k: v.strip() for k, v in body.model_dump(exclude_none=True).items()}
        if "label" in fields and not fields["label"]:
            raise HTTPException(422, "층·구역 표기는 비울 수 없어요.")
        rec = await run_in_threadpool(repo.update_record, user_id, request.path_params["record_id"], fields)
        if not rec:
            raise HTTPException(404, "주차 기록을 찾을 수 없어요.")
        return JSONResponse({"record": serialize(request, rec)})

    async def delete_record(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        photo_id = await run_in_threadpool(repo.delete_record, user_id, request.path_params["record_id"])
        if photo_id is None:
            raise HTTPException(404, "주차 기록을 찾을 수 없어요.")
        if photo_id:
            storage.delete(photo_id)
        return JSONResponse({"deleted": True})

    async def delete_all(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        photo_ids = await run_in_threadpool(repo.delete_all, user_id)
        for pid in photo_ids:
            storage.delete(pid)
        return JSONResponse({"deleted": True, "photos_deleted": len(photo_ids)})

    async def upload_photo(request: Request) -> JSONResponse:
        user_id = get_user_id(request)
        await run_in_threadpool(consent.require, user_id, "photo_ai")
        body = await read_json(request, PhotoIn, max_bytes=settings.photo_max_bytes * 4 // 3 + 4096)
        try:
            raw = decode_image_payload(body.image, settings.photo_max_bytes)
            processed = await run_in_threadpool(process_image, raw, settings.photo_max_side)
        except PhotoError as exc:
            raise HTTPException(422, str(exc))

        analysis, ai_error = None, None
        if body.analyze:
            try:
                limiter.check(user_id)
                result = await run_in_threadpool(vision.analyze, processed.data, processed.mime)
                analysis = result.to_dict()
            except VisionError as exc:
                ai_error = exc.message

        photo_id = storage.save(processed.data)
        await run_in_threadpool(repo.add_photo, user_id, photo_id, processed.width, processed.height,
                                len(processed.data), analysis)
        # 찍고 저장하지 않은 지 하루 지난 사진 정리
        orphans = await run_in_threadpool(repo.orphan_photo_ids, user_id)
        await run_in_threadpool(repo.delete_photos, orphans)
        for pid in orphans:
            storage.delete(pid)

        return JSONResponse({
            "photo": {"id": photo_id, "url": f"{base(request)}/photos/{photo_id}",
                      "width": processed.width, "height": processed.height},
            "analysis": analysis,
            "ai": {**vision.status(), "error": ai_error},
        }, status_code=201)

    async def get_photo(request: Request) -> Response:
        user_id = get_user_id(request)
        photo_id = request.path_params["photo_id"]
        meta = await run_in_threadpool(repo.get_photo, user_id, photo_id)
        data = storage.load(photo_id) if meta else None
        if not data:
            raise HTTPException(404, "사진을 찾을 수 없어요.")
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

    async def stats(request: Request) -> JSONResponse:
        token = request.headers.get("X-Admin-Token", "")
        if not settings.admin_token or token != settings.admin_token:
            raise HTTPException(404, "Not Found")
        return JSONResponse(await run_in_threadpool(repo.stats))

    return Starlette(
        routes=[
            Route("/ai-status", ai_status, methods=["GET"]),
            Route("/latest", latest, methods=["GET"]),
            Route("/records", list_records, methods=["GET"]),
            Route("/records", create_record, methods=["POST"]),
            Route("/records", delete_all, methods=["DELETE"]),
            Route("/records/{record_id:str}", patch_record, methods=["PATCH"]),
            Route("/records/{record_id:str}", delete_record, methods=["DELETE"]),
            Route("/photos", upload_photo, methods=["POST"]),
            Route("/photos/{photo_id:str}", get_photo, methods=["GET"]),
            Route("/stats", stats, methods=["GET"]),
        ],
        exception_handlers=ERROR_HANDLERS,
    )

