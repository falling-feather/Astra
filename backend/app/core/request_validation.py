"""Safe global rendering for request-validation failures."""

from __future__ import annotations

import math

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def register_request_validation_handler(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def request_validation_error_handler(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"detail": json_safe_validation_value(exc.errors())},
        )


def json_safe_validation_value(value):
    """Make rejected input finite and UTF-8 encodable before echoing it."""
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, str):
        return _safe_text(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, dict):
        pairs = [
            (
                _safe_text(str(key)),
                json_safe_validation_value(item),
            )
            for key, item in value.items()
        ]
        if len({key for key, _item in pairs}) != len(pairs):
            return {"__mapping_items__": [[key, item] for key, item in pairs]}
        return {key: item for key, item in pairs}
    if isinstance(value, (list, tuple)):
        return [json_safe_validation_value(item) for item in value]
    return json_safe_validation_value(str(value))


def _safe_text(value: str) -> str:
    return value.encode("utf-8", errors="backslashreplace").decode("utf-8")
