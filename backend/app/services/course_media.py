"""Bounded media storage; no external URL proxy and no anonymous byte access."""
from hashlib import sha256

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Course, CourseMediaAsset, CourseMediaGrant, CourseRelease, CourseReleaseUnit, User
from app.core.learning_evidence_contract import as_utc
from app.schemas.course_media import CourseMediaRead
from app.services import content_platform
from app.services.audit import record_audit_log
from app.services.course_workflow_support import authoring_course

MAX_ASSET_BYTES = 12 * 1024 * 1024
MAX_COURSE_UPLOAD_BYTES = 100 * 1024 * 1024


def identify_media(data: bytes, declared: str) -> tuple[str, str]:
    signatures = [
        (data.startswith(b"\x89PNG\r\n\x1a\n"), "image/png", "image"),
        (data.startswith(b"\xff\xd8\xff"), "image/jpeg", "image"),
        (data.startswith((b"GIF87a", b"GIF89a")), "image/gif", "image"),
        (data.startswith(b"RIFF") and data[8:12] == b"WEBP", "image/webp", "image"),
        (data.startswith(b"RIFF") and data[8:12] == b"WAVE", "audio/wav", "audio"),
        (data.startswith(b"OggS"), "audio/ogg", "audio"),
        (data.startswith(b"ID3") or len(data) > 1 and data[0] == 255 and data[1] & 0xE0 == 0xE0, "audio/mpeg", "audio"),
        (data[4:8] == b"ftyp", "video/mp4", "video"),
        (data.startswith(b"\x1a\x45\xdf\xa3"), "video/webm", "video"),
        (data.startswith(b"%PDF-"), "application/pdf", "document"),
    ]
    for match, mime, kind in signatures:
        if match and declared.lower().split(";")[0].strip() == mime:
            return mime, kind
    raise HTTPException(status_code=422, detail="请上传 PNG/JPEG/GIF/WebP、MP3/WAV/OGG、MP4/WebM 或 PDF；文件类型须与内容一致")


def media_read(asset: CourseMediaAsset) -> dict:
    values = {key: getattr(asset, key) for key in CourseMediaRead.model_fields}
    values["created_at"] = as_utc(asset.created_at)
    return CourseMediaRead.model_validate(values).model_dump(mode="json")


def media_snapshot(asset: CourseMediaAsset) -> dict:
    return {"asset_key": asset.asset_key, "content_sha256": asset.content_sha256, "content_type": asset.content_type, "size_bytes": asset.size_bytes, "media_type": asset.media_type, "source_course_id": asset.source_course_id}


def _grant(db: Session, actor: User, course: Course, asset: CourseMediaAsset) -> None:
    existing = db.scalar(select(CourseMediaGrant.id).where(CourseMediaGrant.course_id == course.id, CourseMediaGrant.asset_id == asset.id))
    if existing is None:
        db.add(CourseMediaGrant(course_id=course.id, asset_id=asset.id, granted_by_user_id=actor.id))
        db.flush()


def upload_media(db: Session, *, actor: User, course_id: int, client_request_id: str, filename: str, content_type: str, data: bytes, request: Request | None = None) -> dict:
    course = authoring_course(db, actor, course_id, write=True)
    if not data or len(data) > MAX_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="单个素材须为 1 字节至 12 MiB")
    if not filename.strip() or any(ch in filename for ch in '\\/:\r\n\x00') or len(filename) > 180:
        raise HTTPException(status_code=422, detail="文件名无效")
    mime, kind = identify_media(data, content_type)
    digest = sha256(data).hexdigest()
    existing = db.scalar(select(CourseMediaAsset).where(CourseMediaAsset.created_by_user_id == actor.id, CourseMediaAsset.client_request_id == client_request_id))
    if existing:
        if (existing.source_course_id, existing.filename, existing.content_type, existing.content_sha256) != (course_id, filename, mime, digest):
            raise HTTPException(status_code=409, detail="该上传编号已用于不同文件")
        return media_read(existing)
    used = db.scalar(select(func.sum(CourseMediaAsset.size_bytes)).where(CourseMediaAsset.source_course_id == course_id)) or 0
    if used + len(data) > MAX_COURSE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="本课程素材已达到 100 MiB 上限")
    asset = CourseMediaAsset(school_id=course.school_id, source_course_id=course_id, created_by_user_id=actor.id, client_request_id=client_request_id, filename=filename, media_type=kind, content_type=mime, content_sha256=digest, size_bytes=len(data), content_bytes=data)
    db.add(asset)
    db.flush()
    _grant(db, actor, course, asset)
    record_audit_log(db, actor=actor, action="course.media.upload", resource_type="course_media_asset", resource_id=asset.id, school_id=course.school_id, request=request, event_result="success", snapshot=media_snapshot(asset))
    response = media_read(asset)
    db.commit()
    return response


def list_media(db: Session, *, actor: User, course_id: int, limit: int, offset: int) -> dict:
    authoring_course(db, actor, course_id)
    statement = select(CourseMediaAsset).join(CourseMediaGrant, CourseMediaGrant.asset_id == CourseMediaAsset.id).where(CourseMediaGrant.course_id == course_id)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    items = [media_read(asset) for asset in db.scalars(statement.order_by(CourseMediaAsset.id.desc()).offset(offset).limit(limit))]
    return {"items": items, "total": total, "offset": offset, "limit": limit, "next_offset": offset + len(items) if offset + len(items) < total else None}


def reference_media(db: Session, course: Course, key: str, media_type: str, *, actor: User | None = None) -> CourseMediaAsset:
    asset = db.scalar(select(CourseMediaAsset).where(CourseMediaAsset.asset_key == key, CourseMediaAsset.school_id == course.school_id))
    if asset is None:
        raise HTTPException(status_code=422, detail="素材未登记或不属于本校，请先上传实际文件")
    if ("image" if media_type == "diagram" else media_type) != asset.media_type:
        raise HTTPException(status_code=422, detail="内容中的素材类型与实际文件不一致")
    grant = db.scalar(select(CourseMediaGrant.id).where(CourseMediaGrant.asset_id == asset.id, CourseMediaGrant.course_id == course.id))
    if grant is None:
        if actor is None:
            raise HTTPException(status_code=403, detail="当前课程没有此素材的取用记录")
        # A fork/sync may reuse material from a source the actor can actually edit.
        # Published school sources receive grants in the authorized fork operation.
        authoring_course(db, actor, asset.source_course_id)
        _grant(db, actor, course, asset)
    return asset


def grant_fork_media(db: Session, actor: User, source: Course, target: Course, snapshot: dict) -> None:
    for unit in snapshot["units"]:
        for block in (unit.get("content") or {}).get("blocks", []):
            if block["type"] == "media":
                asset = reference_media(db, source, block["assetKey"], block["mediaType"])
                _grant(db, actor, target, asset)


def read_media_bytes(db: Session, *, actor: User, course_id: int, asset_key: str, release_id: int | None, unit_id: int | None) -> tuple[dict, bytes]:
    if actor.role == "student":
        if release_id is None or unit_id is None:
            raise HTTPException(status_code=403, detail="请从已加入课程的学习版本访问素材")
        release = content_platform.get_course_release(db, actor=actor, course_id=course_id, release_id=release_id)
        unit = next((item for item in release["units"] if item["source_course_unit_id"] == unit_id and item["access_state"] == "open"), None)
        if unit is None or not any(block.get("assetKey") == asset_key for block in unit["content"].get("blocks", []) if block["type"] == "media"):
            raise HTTPException(status_code=403, detail="该版本或单元未向你开放此素材")
        course = db.get(Course, course_id)
    else:
        course = authoring_course(db, actor, course_id)
    asset = db.scalar(select(CourseMediaAsset).join(CourseMediaGrant, CourseMediaGrant.asset_id == CourseMediaAsset.id).where(CourseMediaGrant.course_id == course.id, CourseMediaAsset.asset_key == asset_key))
    if asset is None:
        raise HTTPException(status_code=404, detail="素材不存在")
    return media_read(asset), asset.content_bytes
