from pathlib import Path

from fastapi.testclient import TestClient

from app.local_preview import create_local_preview_app


PROJECT_ROOT = Path(__file__).resolve().parents[2]
INSTANCE_ID = "a" * 64


def test_local_preview_serves_same_origin_api_and_public_site(client, tmp_path):
    # The shared fixture proves the API configuration.  Use another application
    # with the same test environment to exercise the reviewed static surface.
    frontend = tmp_path / "frontend"
    (frontend / "assets").mkdir(parents=True)
    (frontend / "labs").mkdir()
    (frontend / "index.html").write_text('<html><head></head><body>星序<script src="/assets/portal.js"></script></body></html>', encoding="utf-8")
    (frontend / "assets" / "portal.js").write_text("/* built portal */", encoding="utf-8")
    (frontend / "labs" / "index.html").write_text("public resources", encoding="utf-8")
    with TestClient(create_local_preview_app(PROJECT_ROOT, instance_id=INSTANCE_ID, frontend_root=frontend)) as preview:
        index = preview.get("/")
        assert index.status_code == 200
        assert "星序" in index.text
        assert index.headers["cache-control"] == "no-cache"
        assert index.headers["x-astra-local-preview"] == "1"
        assert index.headers["x-astra-local-instance"] == INSTANCE_ID
        assert "ASTRA_LOCAL_PREVIEW_SAME_ORIGIN = true" in index.text
        assert "localStorage.removeItem('astra-api-base')" in index.text
        assert preview.get("/assets/portal.js").status_code == 200
        assert preview.get("/labs/index.html").text == "public resources"

        health = preview.get("/api/health")
        assert health.status_code == 200
        assert health.json()["service"] == "astra-backend"

        assert preview.get("/pages/planets/planets.css").status_code == 200
        assert preview.get("/shared/js/app-session.js").status_code == 200
        assert preview.get("/UI/favicon-32.png").status_code == 200
        optimized_background = preview.get("/UI/future-galaxy/future-galaxy-hero-sky.webp")
        assert optimized_background.status_code == 200
        assert optimized_background.headers["content-type"] == "image/webp"
        assert preview.get("/codevis/index.html").status_code == 200

        cross_port = preview.get(
            "/?backendSchema=1&apiBase=http%3A%2F%2F127.0.0.1%3A8000",
            follow_redirects=False,
        )
        assert cross_port.status_code == 307
        assert cross_port.headers["location"] == "/?backendSchema=1"
        assert cross_port.headers["x-astra-local-preview"] == "1"

        worker = preview.get("/sw.js")
        assert worker.status_code == 200
        assert worker.headers["service-worker-allowed"] == "/"
        assert worker.headers["cache-control"] == "no-cache"
        assert "registration.unregister" in worker.text


def test_local_preview_missing_frontend_reports_build_requirement(client, tmp_path):
    with TestClient(create_local_preview_app(PROJECT_ROOT, frontend_root=tmp_path / "missing")) as preview:
        response = preview.get("/")
        assert response.status_code == 503
        assert "npm --prefix qianduan run build" in response.text
        assert preview.get("/api/health").status_code == 200


def test_local_preview_does_not_expose_repository_private_roots(client):
    with TestClient(create_local_preview_app(PROJECT_ROOT, instance_id=INSTANCE_ID)) as preview:
        for path in (
            "/backend/app/main.py",
            "/doc/02-%E9%A1%B9%E7%9B%AE%E8%A7%84%E5%88%92.md",
            "/server/dev-static-server.mjs",
            "/.git/config",
            "/deploy.ps1",
            "/package-lock.json",
            "/pages/%2e%2e/backend/app/main.py",
        ):
            assert preview.get(path).status_code == 404, path
