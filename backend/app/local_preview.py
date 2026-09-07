"""Same-origin local preview surface for the Astra website.

This module deliberately mounts only reviewed public directories.  It is a
development/acceptance entrypoint, not the staging or production service
bundle defined by ``deploy.ps1``.
"""

import mimetypes
import os
import re
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from app.main import create_app


# Windows does not consistently register WebP in the system MIME database.
# Register the reviewed browser asset type before Starlette builds a response;
# otherwise the one-click preview emits application/octet-stream.
mimetypes.add_type("image/webp", ".webp", strict=True)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_MOUNTS = (
    ("/pages", "pages"),
    ("/shared", "shared"),
    ("/UI", "UI"),
    ("/codevis", "codevis"),
)
LOCAL_PREVIEW_HEAD = """    <meta name="astra-local-preview" content="same-origin">
    <script>
        globalThis.ASTRA_LOCAL_PREVIEW_SAME_ORIGIN = true;
        try { globalThis.localStorage.removeItem('astra-api-base'); } catch (_) {}
    </script>
"""


def create_local_preview_app(
    project_root: Path | None = None,
    instance_id: str | None = None,
    frontend_root: Path | None = None,
) -> FastAPI:
    root = (project_root or PROJECT_ROOT).resolve()
    frontend = (frontend_root or root / "qianduan" / "dist").resolve()
    preview_instance_id = (
        instance_id
        or os.environ.get("ASTRA_LOCAL_PREVIEW_INSTANCE_ID")
        or "unmanaged-local-preview"
    ).strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", preview_instance_id):
        raise RuntimeError("ASTRA_LOCAL_PREVIEW_INSTANCE_ID is invalid")
    preview_headers = {
        "Cache-Control": "no-cache",
        "X-Astra-Local-Preview": "1",
        "X-Astra-Local-Instance": preview_instance_id,
    }
    application = create_app()

    @application.get("/", include_in_schema=False)
    @application.get("/index.html", include_in_schema=False)
    def local_index(request: Request) -> Response:
        index = frontend / "index.html"
        if not index.is_file():
            return HTMLResponse(
                "<h1>星序前端尚未构建</h1><p>请先运行 npm --prefix qianduan run build，再启动本地服务。</p>",
                status_code=503, headers=preview_headers,
            )
        index_source = index.read_text(encoding="utf-8")
        local_index_source = index_source.replace("</head>", f"{LOCAL_PREVIEW_HEAD}</head>", 1)
        query_items = list(request.query_params.multi_items())
        same_origin_items = [(key, value) for key, value in query_items if key != "apiBase"]
        if len(same_origin_items) != len(query_items):
            target = request.url.path
            if same_origin_items:
                target = f"{target}?{urlencode(same_origin_items)}"
            return RedirectResponse(
                target,
                status_code=307,
                headers=preview_headers,
            )
        return HTMLResponse(
            content=local_index_source,
            headers=preview_headers,
        )

    @application.get("/sw.js", include_in_schema=False)
    def local_service_worker() -> FileResponse:
        return FileResponse(
            root / "qianduan" / "public" / "sw.js",
            media_type="application/javascript",
            headers={
                "Cache-Control": "no-cache",
                "Service-Worker-Allowed": "/",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @application.get("/LICENSE.md", include_in_schema=False)
    def local_license() -> FileResponse:
        return FileResponse(root / "LICENSE.md", media_type="text/markdown")

    @application.get("/favicon.svg", include_in_schema=False)
    def local_favicon() -> FileResponse:
        return FileResponse(root / "qianduan" / "public" / "favicon.svg")

    @application.get("/favicon.ico", include_in_schema=False)
    def compatible_favicon() -> FileResponse:
        return FileResponse(root / "UI" / "favicon.ico")

    for route in ("assets", "labs"):
        directory = frontend / route
        application.mount(
            f"/{route}", StaticFiles(directory=directory, html=route == "labs", check_dir=False),
            name=f"portal-{route}",
        )

    for route, relative_directory in PUBLIC_MOUNTS:
        directory = root / relative_directory
        if not directory.is_dir():
            raise RuntimeError(f"Required public directory is missing: {relative_directory}")
        application.mount(
            route,
            StaticFiles(directory=directory, html=relative_directory == "codevis", follow_symlink=False),
            name=f"local-preview-{relative_directory.lower()}",
        )

    return application


app = create_local_preview_app()
