import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import LearningResourceVersion
from app.services.template_expression import compile_expression, evaluate_expression
from test_content_platform_api import _approved_course_scope, _auth


def test_catalogue_installation_is_admin_only_idempotent_and_preview_does_not_create_grades(client):
    scope = _approved_course_scope(client, "resource_v2")
    admin, teacher, student = (_auth(scope[key]["token"]) for key in ("admin", "owner", "student"))
    assert client.get("/api/v2/resources", headers={"Cookie": ""}).status_code == 401
    assert client.post("/api/v2/resources/install-system", headers=teacher).status_code == 403
    assert client.get("/api/v2/resources", headers=student).json()["total"] == 0
    installed = client.post("/api/v2/resources/install-system", headers=admin)
    assert installed.status_code == 200, installed.json()
    assert installed.json() == {"installed_versions": 132, "catalogue_size": 129}
    assert client.post("/api/v2/resources/install-system", headers=admin).json()["installed_versions"] == 0
    catalogue = client.get("/api/v2/resources?kind=template", headers=teacher).json()
    assert catalogue["total"] == 2
    graph = next(item for item in catalogue["items"] if item["renderer"] == "function-graph-v1")
    config = graph["definition"]["configuration"]
    config["formula"] = "a*x^2+b"
    preview = client.post(f"/api/v2/resources/versions/{graph['id']}/preview", headers=student, json={"configuration": config})
    assert preview.status_code == 200, preview.json()
    assert preview.json()["view"]["points"][60] == {"x": 0, "y": 0}
    assert preview.json()["view"]["points"][0] == {"x": -5, "y": 25}
    assert client.get(f"/api/v2/resources/versions/{graph['id']}", headers=teacher).json() == graph
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count(LearningResourceVersion.id))) == 132
    assert client.get("/api/v1/workbench", headers=student).json()["courses"]["items"] == []


def test_admin_preview_catalogue_is_full_three_space_activity_projection(client):
    scope = _approved_course_scope(client, "admin_preview_catalogue")
    admin, student = _auth(scope["admin"]["token"]), _auth(scope["student"]["token"])
    preview = client.get("/api/admin/catalogue/preview", headers=admin)
    assert preview.status_code == 200, preview.json()
    assert preview.json()["total"] == 127
    assert {item["space_key"] for item in preview.json()["items"]} == {
        "englab",
        "code-space",
        "future-galaxy",
    }
    assert client.get("/api/admin/catalogue/preview", headers=student).status_code == 403


def test_templates_reject_capability_injection_and_dimension_mismatch(client):
    scope = _approved_course_scope(client, "template_limits")
    admin, teacher = _auth(scope["admin"]["token"]), _auth(scope["owner"]["token"])
    client.post("/api/v2/resources/install-system", headers=admin)
    items = client.get("/api/v2/resources?kind=template", headers=teacher).json()["items"]
    graph = next(item for item in items if item["renderer"] == "function-graph-v1")
    chart = next(item for item in items if item["renderer"] == "data-chart-v1")
    config = graph["definition"]["configuration"]
    for changes in ({"script": "alert(1)"}, {"formula": "x.__class__"}, {"samples": 100000}, {"x_min": 10, "x_max": 1}, {"x_min": True}):
        response = client.post(f"/api/v2/resources/versions/{graph['id']}/preview", headers=teacher, json={"configuration": {**config, **changes}})
        assert response.status_code == 422, response.json()
    config = chart["definition"]["configuration"]
    config["series"][0]["values"] = [1, 2]
    response = client.post(f"/api/v2/resources/versions/{chart['id']}/preview", headers=teacher, json={"configuration": config})
    assert response.status_code == 422
    legacy = client.get("/api/v2/resources?kind=activity&limit=1", headers=teacher).json()["items"][0]
    response = client.post(f"/api/v2/resources/versions/{legacy['id']}/preview", headers=teacher, json={"configuration": graph["definition"]["configuration"]})
    assert response.status_code == 422


def test_python_expression_semantics_match_shared_language_cases():
    cases = json.loads(Path(__file__).with_name("template-expression-cases.json").read_text(encoding="utf-8"))
    for case in cases["valid"]:
        tree = compile_expression(case["formula"], set(case["variables"]))
        actual = evaluate_expression(tree, case["variables"])
        if case["expected"] is None:
            assert actual is None, case
        else:
            assert actual == pytest.approx(case["expected"], abs=1e-12), case
    for formula in cases["invalid"]:
        with pytest.raises(ValueError):
            compile_expression(formula, {"x"})


def test_registered_frontend_bundle_joins_the_resource_catalogue_without_a_new_backend_domain(tmp_path, monkeypatch):
    from app.services import learning_resources as service
    from shutil import copyfile
    catalogue = tmp_path / "backend" / "app" / "catalogue"
    catalogue.mkdir(parents=True)
    for name in ("learning-spaces.v1.json", "system-resources.v1.json", "templates.v1.json", "resource-updates.v1.json"):
        copyfile(service.CATALOGUE_ROOT / name, catalogue / name)
    manifest = json.loads((catalogue / "learning-spaces.v1.json").read_text(encoding="utf-8"))
    manifest["spaces"].append({"key": "archives", "view": "space:archives", "title": "档案测试空间", "entry": "labs/spaces/archives/index.html", "kind": "bundle", "accent": "#c8b899"})
    (catalogue / "learning-spaces.v1.json").write_text(json.dumps(manifest), encoding="utf-8")
    bundle = tmp_path / "extensions" / "archives" / "public"
    bundle.mkdir(parents=True)
    (bundle / "index.html").write_text("<h1>Example bundle</h1>", encoding="utf-8")
    activities = {"schema_version": "astra-activities-v1", "activities": [{"key": "archives.evidence", "title": "比较材料", "subject": "history", "entry": "index.html#evidence"}]}
    (bundle / "astra-activities.json").write_text(json.dumps(activities), encoding="utf-8")
    monkeypatch.setattr(service, "CATALOGUE_ROOT", catalogue)
    descriptors = service._builtin_descriptors()
    added = next(item for item in descriptors if item["key"] == "archives.evidence")
    assert len(descriptors) == 133
    assert added["definition"]["entry"] == "labs/spaces/archives/index.html#evidence"
    assert added["capabilities"]["operation_recording"] is False
    activities["activities"][0]["entry"] = "%2e%2e/secret.html"
    (bundle / "astra-activities.json").write_text(json.dumps(activities), encoding="utf-8")
    with pytest.raises(RuntimeError, match="identity or entry"):
        service._builtin_descriptors()
