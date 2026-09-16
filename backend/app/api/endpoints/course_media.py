"""Binary media transport with a streaming request limit and authorized ranges."""
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps.auth import get_current_user
from app.api.endpoints.course_workflow import service_call
from app.db.session import get_db
from app.schemas.course_media import CourseMediaPage, CourseMediaRead
from app.services import course_media as media
from app.services.course_workflow_support import authoring_course

router = APIRouter()


@router.get("/courses/{course_id}/media", response_model=CourseMediaPage)
def list_media(course_id: int, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0), actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, media.list_media, actor=actor, course_id=course_id, limit=limit, offset=offset)


@router.post("/courses/{course_id}/media", response_model=CourseMediaRead, status_code=201)
async def upload_media(course_id: int, request: Request, filename: str = Query(min_length=1, max_length=180), client_request_id: str = Query(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"), actor=Depends(get_current_user), db: Session = Depends(get_db)):
    if actor.role != "teacher":
        raise HTTPException(status_code=403, detail="素材由授课教师上传")
    await run_in_threadpool(authoring_course, db, actor, course_id)
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > media.MAX_ASSET_BYTES:
            raise HTTPException(status_code=413, detail="单个素材最多 12 MiB")
        data.extend(chunk)
    return await run_in_threadpool(service_call, db, media.upload_media, actor=actor, course_id=course_id, client_request_id=client_request_id, filename=filename, content_type=request.headers.get("content-type", ""), data=bytes(data), request=request)


@router.get("/courses/{course_id}/media/{asset_key}/content")
def media_content(course_id: int, asset_key: str, request: Request, release_id: int | None = Query(None, ge=1), unit_id: int | None = Query(None, ge=1), actor=Depends(get_current_user), db: Session = Depends(get_db)):
    asset, data = service_call(db, media.read_media_bytes, actor=actor, course_id=course_id, asset_key=asset_key, release_id=release_id, unit_id=unit_id)
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Accept-Ranges": "bytes", "Content-Disposition": f"{'attachment' if asset['media_type'] == 'document' else 'inline'}; filename*=UTF-8''{quote(asset['filename'])}"}
    status = 200
    requested_range = request.headers.get("range")
    if requested_range:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested_range)
        size = len(data)
        if len(requested_range) > 80 or not match or not any(match.groups()):
            raise HTTPException(status_code=416, detail="仅支持一个字节范围", headers={"Content-Range": f"bytes */{size}"})
        left, right = match.groups()
        start = int(left) if left else max(0, size - int(right))
        end = min(size - 1, int(right)) if left and right else size - 1
        if start > end or start >= size:
            raise HTTPException(status_code=416, detail="字节范围不可用", headers={"Content-Range": f"bytes */{size}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        data, status = data[start:end + 1], 206
    return Response(content=data, status_code=status, media_type=asset["content_type"], headers=headers)
