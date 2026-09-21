"""Workflow regressions that can leave an apparently published course unusable."""
from copy import deepcopy

from test_content_platform_api import _approved_course_scope, _auth
from test_course_workflow_v2 import make_course, read_draft, request, save, unit
from test_course_release_plans import _attach, _class, _course, _login, _school, _unit


def test_parameterless_function_cannot_be_submitted_as_operation_completion(client):
    scope = _approved_course_scope(client, "qa037_empty_parameters")
    request(client, "POST", "/resources/install-system", scope["admin"]["token"])
    resource = next(row for row in request(client, "GET", "/resources?kind=template", scope["owner"]["token"])["items"] if row["resource_key"] == "template.function-graph")
    course = make_course(client, scope)
    lesson = unit("固定函数", 1, "只有图形，没有可操作参数")
    config = deepcopy(resource["definition"]["configuration"])
    config.update(formula="x*x", parameters=[])
    lesson["content"]["blocks"].append({"blockId": "fixed-graph", "type": "resource", "title": resource["title"], "resourceVersionId": resource["id"], "configuration": config, "instructions": "观察曲线"})
    lesson["content"]["courseUnit"]["completion"] = {"preset": "experiment_operation"}
    draft = save(client, scope, read_draft(client, scope, course["id"]), [lesson])
    rejected = request(client, "POST", f"/courses/{course['id']}/submission-preview", scope["owner"]["token"], {"source_revision": draft["revision"], "source_state_token": draft["state_token"]}, 422)
    assert "操作" in str(rejected["detail"])


def test_locked_assignment_lists_do_not_disclose_prompt_and_unlock_restores_it(client):
    teacher = _login(client, "qa037_assign_teacher", "teacher")
    student = _login(client, "qa037_assign_student", "student")
    school = _school(client, teacher)
    classroom = _class(client, teacher, school, "隔离验收班")
    course = _course(client, teacher, school)
    _attach(client, teacher, course, classroom)
    lesson = _unit(client, teacher, course, 1)
    joined = client.post(f"/api/classes/{classroom}/join", headers=_auth(student), json={"role": "student"})
    assert joined.status_code == 201
    created = client.post(f"/api/courses/{course}/units/{lesson}/assignments", headers=_auth(teacher), json={"title": "未开放作业", "description": "这段题目正文仅供已开放单元读取", "max_score": 100})
    assert created.status_code == 201, created.text
    prompt = created.json()["description"]
    plan_url = f"/api/courses/{course}/classes/{classroom}/release-plan"

    def change(mode):
        plan = client.get(plan_url, headers=_auth(teacher)).json()
        result = client.patch(plan_url, headers=_auth(teacher), json={"expected_version": plan["plan_version"], "items": [{"course_unit_id": lesson, "release_mode": mode}]})
        assert result.status_code == 200, result.text

    def rows():
        direct = client.get(f"/api/courses/{course}/assignments?class_id={classroom}", headers=_auth(student))
        center = client.get(f"/api/assignments/me?course_id={course}", headers=_auth(student))
        assert direct.status_code == center.status_code == 200
        return direct.json(), [item["assignment"] for item in center.json()["items"]]

    change("locked")
    for items in rows():
        assert len(items) == 1
        assert items[0]["unit_release_state"] == "locked"
        assert not items[0]["description"], "锁定状态不应泄露任务正文"
    teacher_read = client.get(f"/api/courses/{course}/assignments?class_id={classroom}", headers=_auth(teacher))
    assert teacher_read.json()[0]["description"] == prompt
    change("open")
    for items in rows():
        assert items[0]["description"] == prompt
    change("hidden")
    assert rows() == ([], [])
