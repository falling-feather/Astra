"""Small transport helpers shared by the application factory."""

import re
from uuid import uuid4


def request_id_from_header(value: str | None) -> str:
    request_id = (value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", request_id):
        return uuid4().hex
    return request_id


def is_api_path(path: str, api_prefix: str) -> bool:
    prefix = api_prefix.rstrip("/") or "/api"
    return path == prefix or path.startswith(f"{prefix}/")
