from contextlib import asynccontextmanager
import logging
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import get_settings
from app.core.http_requests import is_api_path, request_id_from_header
from app.core.request_validation import register_request_validation_handler
from app.db.session import get_session_factory, init_db
from app.services.content_catalog import ensure_seed_pages
from app.services.content_script_asset_scan_scheduler import scheduler_from_settings as content_script_scheduler_from_settings
from app.services.background_task_worker import worker_from_settings
from app.services.knowledge_snapshot_scheduler import scheduler_from_settings


logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    settings.validate_runtime_security()
    cors_origins = settings.cors_origin_list
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        lifespan=lifespan,
    )
    register_request_validation_handler(app)
    if settings.auto_create_tables:
        init_db(settings.database_url)
        session_factory = get_session_factory(settings.database_url)
        with session_factory() as db:
            ensure_seed_pages(db)

    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=[
                "Authorization",
                "Content-Type",
                "Accept",
                "X-Request-ID",
                "X-Device-Label",
                "X-Device-Name",
            ],
            expose_headers=["X-Request-ID", "Server-Timing"],
        )

    @app.middleware("http")
    async def attach_request_id_and_api_cache_policy(request: Request, call_next):
        request_started_at = perf_counter()
        request_id = request_id_from_header(request.headers.get("x-request-id"))
        request.state.request_id = request_id
        is_api = is_api_path(request.url.path, settings.api_prefix)
        try:
            response = await call_next(request)
        except Exception as exc:
            if not is_api:
                raise
            logger.error(
                "Unhandled API error request_id=%s path=%s error_type=%s",
                request_id,
                request.url.path,
                exc.__class__.__name__,
            )
            response = JSONResponse(
                status_code=500,
                content={"detail": "Internal server error"},
            )
            origin = request.headers.get("origin", "")
            if origin in cors_origins:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Allow-Credentials"] = "true"
                response.headers["Access-Control-Expose-Headers"] = "X-Request-ID, Server-Timing"
                response.headers["Vary"] = "Origin"
        duration_ms = (perf_counter() - request_started_at) * 1000
        response.headers["X-Request-ID"] = request_id
        if is_api:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            response.headers["Server-Timing"] = f"app;dur={duration_ms:.2f}"
            if (
                settings.performance_slow_request_logging_enabled
                and duration_ms >= settings.performance_slow_request_threshold_ms
            ):
                route = request.scope.get("route")
                route_template = getattr(route, "path", "unmatched")
                logger.warning(
                    "slow_api_request request_id=%s method=%s route=%s status=%s duration_ms=%.2f",
                    request_id,
                    request.method,
                    route_template,
                    response.status_code,
                    duration_ms,
                )
        return response
    app.include_router(api_router, prefix=settings.api_prefix)
    return app


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    scheduler = None
    content_script_scheduler = None
    background_task_worker = None
    if settings.background_task_worker_enabled:
        background_task_worker = worker_from_settings(settings)
        app.state.background_task_worker = background_task_worker
        background_task_worker.start()
    if settings.knowledge_snapshot_scheduler_enabled and not settings.background_task_worker_enabled:
        scheduler = scheduler_from_settings(settings)
        app.state.knowledge_snapshot_scheduler = scheduler
        scheduler.start()
    if settings.content_script_remote_drift_scheduler_enabled and not settings.background_task_worker_enabled:
        content_script_scheduler = content_script_scheduler_from_settings(settings)
        app.state.content_script_remote_drift_scheduler = content_script_scheduler
        content_script_scheduler.start()
    try:
        yield
    finally:
        if background_task_worker is not None:
            await background_task_worker.stop()
        if content_script_scheduler is not None:
            await content_script_scheduler.stop()
        if scheduler is not None:
            await scheduler.stop()


app = create_app()
