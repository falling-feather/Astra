"""Functional workflow scenarios, exercised after the complete backend slice."""
from copy import deepcopy
from uuid import uuid4

from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import CourseCandidate, CourseEnrollment, CourseRelease, CourseRevision
from test_content_platform_api import _approved_course_scope, _auth, _content


def request(client, method, path, token, data=None, status=200):
    response = client.request(method, f"/api/v2{path}", headers=_auth(token), **({"json": data} if data is not None else {}))
    assert response.status_code == status, response.text
    return response.json()


def make_course(client, scope, title="高一数学"):
    settings = {"school_id": scope["school_id"], "title": title, "summary": "共同内容，独立教学。", "academic_year": "2026—2027", "schedule_text": "周三下午", "total_hours": 24, "galaxy_key": "englab", "subject_key": "mathematics", "admission_mode": "open", "collaborator_user_ids": [scope["peer"]["id"]], "admission_class_ids": [], "level_key": None}
    return request(client, "POST", "/courses", scope["owner"]["token"], {**settings, "client_request_id": uuid4().hex}, 201)


def read_draft(client, scope, course_id):
    return request(client, "GET", f"/courses/{course_id}/draft", scope["owner"]["token"])


def unit(title, position, text):
    content = _content(text)
    content["blocks"] = [block for block in content["blocks"] if block["type"] != "media"]
    return {"title": title, "position": position, "content": content}


def save(client, scope, draft, units=None, settings=None, status=200, key=None):
    selected = units if units is not None else draft["units"]
    fields = {"id", "activity_key", "resource_version_id", "title", "position", "content"}
    return request(client, "PUT", f"/courses/{draft['course_id']}/draft", scope["owner"]["token"], {"client_request_id": key or uuid4().hex, "expected_revision": draft["revision"], "expected_state_token": draft["state_token"], "settings": settings or draft["settings"], "units": [{key: value for key, value in item.items() if key in fields} for item in selected]}, status)


def fork(client, scope, draft, title="高二数学"):
    return request(client, "POST", f"/courses/{draft['course_id']}/forks", scope["owner"]["token"], {"client_request_id": uuid4().hex, "settings": {**draft["settings"], "title": title}, "expected_source_revision": draft["revision"]}, 201)


def preview(client, scope, draft, **extra):
    payload = {"source_revision": draft["revision"], "source_state_token": draft["state_token"], **extra}
    return request(client, "POST", f"/courses/{draft['course_id']}/submission-preview", scope["owner"]["token"], payload), payload


def submit(client, scope, draft, **extra):
    shown, payload = preview(client, scope, draft, **extra)
    body = {**payload, "preview_token": shown["preview_token"], "client_request_id": uuid4().hex}
    return request(client, "POST", f"/courses/{draft['course_id']}/submissions", scope["owner"]["token"], body, 201)


def review(client, scope, items, decision="approved", status=200):
    return request(client, "POST", "/candidate-reviews", scope["admin"]["token"], {"client_request_id": uuid4().hex, "items": [{"review_item_id": item["review_item_id"], "expected_version": item["review_version"]} for item in items], "decision": decision, "note": "已核对来源、内容与影响"}, status)


def publish(client, scope, items, key=None, status=201):
    return request(client, "POST", "/publications", scope["owner"]["token"], {"client_request_id": key or uuid4().hex, "items": [{"candidate_id": item["candidate_id"], "expected_review_version": item["review_version"]} for item in items]}, status)


def test_independent_forks_keep_provenance_and_reject_stale_drafts(client):
    scope = _approved_course_scope(client, "fork_v2")
    course = make_course(client, scope)
    initial = read_draft(client, scope, course["id"])
    source = save(client, scope, initial, [unit("复数", 1, "初始说明"), unit("三角", 2, "初始关系")])
    derived = fork(client, scope, source)
    assert derived["course"]["family_id"] == course["family_id"]
    assert derived["course"]["source_revision_id"] == source["revision_id"]
    assert derived["course"]["id"] != course["id"]
    for left, right in zip(source["units"], derived["draft"]["units"]):
        assert left["id"] != right["id"] and left["activity_key"] != right["activity_key"]
        assert left["origin_key"] == right["origin_key"]
        assert set(left["block_origins"].values()) == set(right["block_origins"].values())
        assert set(left["block_origins"]).isdisjoint(right["block_origins"])
    save(client, scope, initial, [], status=409)
    db_factory = get_session_factory(get_settings().database_url)
    with db_factory() as db:
        assert db.scalar(select(func.count()).select_from(CourseEnrollment).where(CourseEnrollment.course_id == derived["course"]["id"])) == 0
    request(client, "GET", f"/courses/{course['id']}/draft", scope["student"]["token"], status=403)


def test_source_based_sync_skips_missing_and_requires_conflict_decisions(client):
    scope = _approved_course_scope(client, "sync_v2")
    course = make_course(client, scope)
    source = save(client, scope, read_draft(client, scope, course["id"]), [unit("复数", 1, "旧公式"), unit("三角", 2, "旧关系")])
    base_id = source["revision_id"]
    target = fork(client, scope, source)["draft"]
    target["units"][0]["content"]["blocks"][1]["markdown"] = "高二自行补充"
    target = save(client, scope, target, target["units"][:1])
    for item in source["units"]:
        item["content"]["blocks"][1]["markdown"] = "修正后的公共公式"
    source = save(client, scope, source)
    shown, body = preview(client, scope, source, base_revision_id=base_id, target_course_ids=[target["course_id"]])
    changes = next(item for item in shown["courses"] if item["course_id"] == target["course_id"])["changes"]
    conflict = next(item for item in changes if item["status"] == "conflict")
    assert any(item["status"] == "skipped" for item in changes)
    pending = {**body, "preview_token": shown["preview_token"], "client_request_id": uuid4().hex}
    request(client, "POST", f"/courses/{course['id']}/submissions", scope["owner"]["token"], pending, 422)
    assert read_draft(client, scope, target["course_id"])["revision"] == target["revision"]
    submitted = submit(client, scope, source, base_revision_id=base_id, target_course_ids=[target["course_id"]], conflict_choices={conflict["key"]: "replace"})
    assert len(submitted["items"]) == 2
    target_after = read_draft(client, scope, target["course_id"])
    assert target_after["settings"]["title"] == "高二数学" and len(target_after["units"]) == 1
    assert target_after["units"][0]["content"]["blocks"][1]["markdown"] == "修正后的公共公式"
    detail = request(client, "GET", f"/candidates/{submitted['items'][1]['candidate_id']}", scope["admin"]["token"])
    assert detail["impact"]["sync"]["applied_changes"] == [conflict["key"]]
    request(client, "POST", f"/courses/{course['id']}/submission-preview", scope["peer"]["token"], body, 403)


def test_mixed_reviews_publish_frozen_snapshot_and_preserve_newer_work(client):
    scope = _approved_course_scope(client, "release_v2")
    course = make_course(client, scope)
    source = save(client, scope, read_draft(client, scope, course["id"]), [unit("复数", 1, "旧公式")])
    target = fork(client, scope, source)["draft"]
    base_id = source["revision_id"]
    source["units"][0]["content"]["blocks"][1]["markdown"] = "待审核公式"
    source = save(client, scope, source)
    submitted = submit(client, scope, source, base_revision_id=base_id, target_course_ids=[target["course_id"]])
    source_item, target_item = submitted["items"]
    approved = review(client, scope, [source_item])["items"]
    rejected = review(client, scope, [target_item], "rejected")["items"]
    source["units"][0]["content"]["blocks"][1]["markdown"] = "后续未送审内容"
    working = save(client, scope, source, settings={**source["settings"], "title": "正在修改的课程名"})
    publish(client, scope, [*approved, *rejected], status=409)
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(CourseRelease).where(CourseRelease.course_id == course["id"])) == 0
    key = uuid4().hex
    published = publish(client, scope, approved, key)
    release = published["items"][0]["release"]
    assert release["title"] == "高一数学"
    assert release["units"][0]["content"]["blocks"][1]["markdown"] == "待审核公式"
    after = read_draft(client, scope, course["id"])
    assert after["state_token"] == working["state_token"] and after["revision"] == working["revision"]
    assert publish(client, scope, approved, key) == published
    receipt = request(client, "GET", f"/operations/{key}", scope["owner"]["token"])
    assert receipt["response"] == published


def test_preview_staleness_review_cas_and_pending_candidate_are_atomic(client):
    scope = _approved_course_scope(client, "stale_v2")
    course = make_course(client, scope)
    source = save(client, scope, read_draft(client, scope, course["id"]), [unit("复数", 1, "甲")])
    target = fork(client, scope, source)["draft"]
    base = source["revision_id"]
    source["units"][0]["content"]["blocks"][1]["markdown"] = "乙"
    source = save(client, scope, source)
    shown, body = preview(client, scope, source, base_revision_id=base, target_course_ids=[target["course_id"]])
    target["units"][0]["title"] = "高二复数"
    target = save(client, scope, target)
    request(client, "POST", f"/courses/{course['id']}/submissions", scope["owner"]["token"], {**body, "preview_token": shown["preview_token"], "client_request_id": uuid4().hex}, 409)
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(CourseCandidate)) == 0
    submitted = submit(client, scope, source, base_revision_id=base, target_course_ids=[target["course_id"]])
    first, second = submitted["items"]
    review(client, scope, [second])
    review(client, scope, [first, second], status=409)
    pending = request(client, "GET", f"/candidates/{first['candidate_id']}", scope["admin"]["token"])
    assert pending["status"] == "submitted" and pending["review_version"] == 1
    shown, body = preview(client, scope, source)
    assert shown["courses"][0]["pending_review_id"] == first["review_item_id"]
    request(client, "POST", f"/courses/{course['id']}/submissions", scope["owner"]["token"], {**body, "preview_token": shown["preview_token"], "client_request_id": uuid4().hex}, 409)


def test_rollback_is_a_new_review_and_legacy_publish_cannot_bypass(client):
    scope = _approved_course_scope(client, "rollback_v2")
    course = make_course(client, scope)
    source = save(client, scope, read_draft(client, scope, course["id"]), [unit("复数", 1, "初版")])
    refused = client.post(f"/api/v1/courses/{course['id']}/releases", headers=_auth(scope["owner"]["token"]), json={"expected_revision": source["revision"]})
    assert refused.status_code == 409, refused.text
    approved = review(client, scope, submit(client, scope, source)["items"])["items"]
    first = publish(client, scope, approved)["items"][0]["release"]
    current = read_draft(client, scope, course["id"])
    current["units"][0]["content"]["blocks"][1]["markdown"] = "第二版"
    current = save(client, scope, current)
    second = publish(client, scope, review(client, scope, submit(client, scope, current)["items"])["items"])["items"][0]["release"]
    current = read_draft(client, scope, course["id"])
    restored = request(client, "POST", f"/courses/{course['id']}/restore-draft", scope["owner"]["token"], {"client_request_id": uuid4().hex, "expected_revision": current["revision"], "expected_state_token": current["state_token"], "release_id": first["id"]})
    assert restored["revision"] > current["revision"]
    third = publish(client, scope, review(client, scope, submit(client, scope, restored)["items"])["items"])["items"][0]["release"]
    assert [first["release_number"], second["release_number"], third["release_number"]] == [1, 2, 3]
    assert third["units"][0]["content"]["blocks"][1]["markdown"] == "初版"
    assert first["id"] != third["id"] and first["package_sha256"] != third["package_sha256"]
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(CourseRevision).where(CourseRevision.course_id == course["id"])) >= 5


def test_media_upload_reuse_and_release_access_are_real_and_scoped(client):
    from base64 import b64decode
    from test_content_platform_api import _enroll_student
    scope = _approved_course_scope(client, "media_v2")
    course = make_course(client, scope)
    png = b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2mQAAAAASUVORK5CYII=")
    url = f"/api/v2/courses/{course['id']}/media?filename=diagram.png&client_request_id=media-upload-once"
    headers = {**_auth(scope["owner"]["token"]), "content-type": "image/png"}
    uploaded = client.post(url, headers=headers, content=png)
    assert uploaded.status_code == 201, uploaded.text
    asset = uploaded.json()
    assert client.post(url, headers=headers, content=png).json() == asset
    assert client.post(url, headers=headers, content=png + b"changed").status_code == 409
    invalid = client.post(url.replace("media-upload-once", "invalid-svg"), headers={**headers, "content-type": "image/svg+xml"}, content=b'<svg onload="alert(1)"></svg>')
    assert invalid.status_code == 422
    lesson = unit("证据与解释", 1, "观察这幅示意图。")
    lesson["content"]["blocks"].append({"blockId": "picture", "type": "media", "mediaType": "diagram", "assetKey": asset["asset_key"], "alt": "图形示例"})
    draft = save(client, scope, read_draft(client, scope, course["id"]), [lesson])
    derived = fork(client, scope, draft)["draft"]
    assets = request(client, "GET", f"/courses/{derived['course_id']}/media", scope["owner"]["token"])
    assert assets["items"][0]["asset_key"] == asset["asset_key"]
    publication = publish(client, scope, review(client, scope, submit(client, scope, derived)["items"])["items"])["items"][0]["release"]
    _enroll_student(client, student=scope["student"], teacher=scope["owner"], course_id=derived["course_id"])
    media_url = f"/api/v2/courses/{derived['course_id']}/media/{asset['asset_key']}/content?release_id={publication['id']}&unit_id={derived['units'][0]['id']}"
    visible = client.get(media_url, headers=_auth(scope["student"]["token"]))
    assert visible.status_code == 200 and visible.content == png
    assert visible.headers["cache-control"] == "no-store"
    partial = client.get(media_url, headers={**_auth(scope["student"]["token"]), "range": "bytes=0-7"})
    assert partial.status_code == 206 and partial.content == png[:8]
    assert client.get(media_url, headers=_auth(scope["outsider_student"]["token"])).status_code == 403
    assert client.get(media_url.split("?")[0], headers=_auth(scope["student"]["token"])).status_code == 403


def test_changed_questions_require_result_decision_and_unchanged_units_cannot_reset(client):
    scope = _approved_course_scope(client, "policy_v2")
    course = make_course(client, scope)
    draft = save(client, scope, read_draft(client, scope, course["id"]), [unit("第一节", 1, "甲"), unit("第二节", 2, "乙")])
    publish(client, scope, review(client, scope, submit(client, scope, draft)["items"])["items"])
    draft = read_draft(client, scope, course["id"])
    draft["units"][0]["content"]["blocks"][-1]["correctChoiceIds"] = ["kinetic"]
    draft = save(client, scope, draft)
    shown, body = preview(client, scope, draft)
    required = [item for item in shown["courses"][0]["impact"]["units"] if item["decision_required"]]
    assert [item["unit_id"] for item in required] == [draft["units"][0]["id"]]
    command = {**body, "preview_token": shown["preview_token"], "client_request_id": uuid4().hex}
    request(client, "POST", f"/courses/{course['id']}/submissions", scope["owner"]["token"], command, 422)
    choices = {str(draft["units"][0]["id"]): "keep", str(draft["units"][1]["id"]): "redo"}
    request(client, "POST", f"/courses/{course['id']}/submissions", scope["owner"]["token"], {**command, "result_policies": {str(course["id"]): choices}}, 422)
    choices.pop(str(draft["units"][1]["id"]))
    accepted = request(client, "POST", f"/courses/{course['id']}/submissions", scope["owner"]["token"], {**command, "result_policies": {str(course["id"]): choices}}, 201)
    detail = request(client, "GET", f"/candidates/{accepted['items'][0]['candidate_id']}", scope["admin"]["token"])
    assert set(detail["result_policies"].values()) == {"keep"}


def test_publication_does_not_restore_authority_revoked_after_review(client):
    scope = _approved_course_scope(client, "authority_v2")
    course = make_course(client, scope)
    draft = save(client, scope, read_draft(client, scope, course["id"]), [unit("授权边界", 1, "已审核内容")])
    approved = review(client, scope, submit(client, scope, draft)["items"])["items"]
    detail = request(client, "GET", f"/candidates/{approved[0]['candidate_id']}", scope["admin"]["token"])
    assert str(scope["peer"]["id"]) in detail["entity_labels"]["users"]
    assert detail["entity_labels"]["schools"][str(scope["school_id"])].startswith("Release School ")
    collaborators = client.get(f"/api/courses/{course['id']}/collaborators", headers=_auth(scope["owner"]["token"]))
    assert collaborators.status_code == 200, collaborators.text
    peer = next(item for item in collaborators.json() if item["user_id"] == scope["peer"]["id"])
    revoked = client.patch(f"/api/courses/{course['id']}/collaborators/{peer['id']}", headers=_auth(scope["owner"]["token"]), json={"status": "inactive"})
    assert revoked.status_code == 200, revoked.text
    publish(client, scope, approved, status=409)
    shown, _ = preview(client, scope, draft)
    change = next(item for item in shown["courses"][0]["impact"]["settings"] if item["field"] == "collaborator_authority")
    assert change["before"] == [] and change["after"] == [{"user_id": scope["peer"]["id"], "role": "editor"}]
    request(client, "GET", f"/courses/{course['id']}/draft", scope["peer"]["token"], status=403)


def test_school_teacher_forks_only_selected_published_content_without_students_or_results(client):
    from test_content_platform_api import _enroll_student, _grant_school_teacher
    from app.models import LearningActivityProjection
    scope = _approved_course_scope(client, "published_fork_v2")
    course = make_course(client, scope)
    draft = save(client, scope, read_draft(client, scope, course["id"]), [unit("已发布内容", 1, "经过学校审核的说明")])
    release = publish(client, scope, review(client, scope, submit(client, scope, draft)["items"])["items"])["items"][0]["release"]
    _enroll_student(client, student=scope["student"], teacher=scope["owner"], course_id=course["id"])
    completed = client.post(f"/api/v1/courses/{course['id']}/units/{draft['units'][0]['id']}/checkpoints/energy-conservation-check/attempts", headers=_auth(scope["student"]["token"]), json={"client_attempt_id": "source-result", "course_release_id": release["id"], "selected_choice_ids": ["mechanical"]})
    assert completed.status_code == 201, completed.text
    working = read_draft(client, scope, course["id"])
    working["units"][0]["content"]["blocks"][1]["markdown"] = "不可取用的私有新草稿"
    save(client, scope, working)
    _grant_school_teacher(scope["outsider_teacher"]["id"], scope["school_id"])
    forked = request(client, "POST", f"/courses/{course['id']}/forks", scope["outsider_teacher"]["token"], {"client_request_id": uuid4().hex, "source_release_id": release["id"], "settings": {**draft["settings"], "title": "另一教师的教学版本", "collaborator_user_ids": []}}, 201)
    assert forked["draft"]["units"][0]["content"]["blocks"][1]["markdown"] == "经过学校审核的说明"
    assert forked["course"]["creator_user_id"] == scope["outsider_teacher"]["id"]
    assert forked["course"]["source_release_id"] == release["id"]
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(CourseEnrollment).where(CourseEnrollment.course_id == course["id"])) == 1
        assert db.scalar(select(func.count()).select_from(CourseEnrollment).where(CourseEnrollment.course_id == forked["course"]["id"])) == 0
        assert db.scalar(select(func.count()).select_from(LearningActivityProjection).where(LearningActivityProjection.course_id == forked["course"]["id"])) == 0


def test_repeated_resource_references_have_independent_teaching_and_completion_instances(client):
    from test_content_platform_api import _enroll_student
    scope = _approved_course_scope(client, "resource_instances_v2")
    request(client, "POST", "/resources/install-system", scope["admin"]["token"])
    catalogue = request(client, "GET", "/resources?kind=template", scope["owner"]["token"])
    resource = next(item for item in catalogue["items"] if item["renderer"] == "data-chart-v1")
    course = make_course(client, scope)
    units = [unit("第一次比较", 1, "情境一"), unit("第二次比较", 2, "情境二")]
    for lesson in units:
        lesson["resource_version_id"] = resource["id"]
        lesson["content"]["blocks"].append({"type": "resource", "blockId": "chart", "title": "数据比较", "resourceVersionId": resource["id"], "configuration": resource["definition"]["configuration"], "instructions": "比较数据并解释"})
    draft = save(client, scope, read_draft(client, scope, course["id"]), units)
    assert len({item["activity_key"] for item in draft["units"]}) == 2
    assert len({item["resource_version_id"] for item in draft["units"]}) == 1
    release = publish(client, scope, review(client, scope, submit(client, scope, draft)["items"])["items"])["items"][0]["release"]
    _enroll_student(client, student=scope["student"], teacher=scope["owner"], course_id=course["id"])
    completed = client.post(f"/api/v1/courses/{course['id']}/units/{draft['units'][0]['id']}/checkpoints/energy-conservation-check/attempts", headers=_auth(scope["student"]["token"]), json={"client_attempt_id": "only-first-instance", "course_release_id": release["id"], "selected_choice_ids": ["mechanical"]})
    assert completed.status_code == 201, completed.text
    workbench = client.get("/api/v1/workbench", headers=_auth(scope["student"]["token"]))
    assert workbench.status_code == 200, workbench.text
    summary = next(item for item in workbench.json()["courses"]["items"] if item["course_id"] == course["id"])
    assert summary["published_unit_count"] == 2 and summary["completed_unit_count"] == 1
