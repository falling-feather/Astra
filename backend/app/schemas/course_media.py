from datetime import datetime
from typing import Literal
from app.schemas.content_platform import PlatformDto


class CourseMediaRead(PlatformDto):
    asset_key: str
    source_course_id: int
    filename: str
    media_type: Literal["image", "audio", "video", "document"]
    content_type: str
    size_bytes: int
    content_sha256: str
    created_at: datetime


class CourseMediaPage(PlatformDto):
    items: list[CourseMediaRead]
    total: int
    offset: int
    limit: int
    next_offset: int | None
