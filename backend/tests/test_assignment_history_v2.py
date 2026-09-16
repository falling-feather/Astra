from uuid import uuid4

from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import Assignment, AssignmentAttempt, AssignmentGrade, CourseRelease, LearningResult, PointLedger, Submission
from test_content_platform_api import _approved_course_scope, _auth, _enroll_student
from test_course_workflow_v2 import make_course, read_draft, request, save, unit
from test_learning_contexts_v2 import completed, release_draft


def setup(client, suffix, preset="assignment_accepted"):
    scope = _approved_course_scope(client, suffix)
    course = make_course(client, scope)
    lesson = unit("研究报告", 1, "写下观察、证据和解释")
    lesson["content"]["courseUnit"]["completion"] = None
    draft = save(client, scope, read_draft(client, scope, course["id"]), [lesson])
    task = client.post(f"/api/courses/{course['id']}/units/{draft['units'][0]['id']}/assignments", headers=_auth(scope["owner"]["token"]), json={"title":"解释你的观察","description":"用事实支持结论","max_score":100})
    assert task.status_code == 201, task.text
    assignment = task.json()
    draft["units"][0]["content"]["courseUnit"]["completion"] = {"preset":preset,"assignmentId":assignment["id"]}
    draft = save(client, scope, draft)
    release = release_draft(client, scope, draft)
    _enroll_student(client, student=scope["student"], teacher=scope["owner"], course_id=course["id"])
    return scope, course, assignment, draft, release


def open_task(client, scope, assignment_id):
    return request(client,"POST",f"/assignments/{assignment_id}/open",scope["student"]["token"],{"client_request_id":uuid4().hex})


def submit_task(client, scope, workspace, text="我的第一稿", key=None, expected=None, status=201):
    return request(client,"POST",f"/assignments/{workspace['assignment_id']}/attempts",scope["student"]["token"],{"client_request_id":key or uuid4().hex,"context_key":workspace["context"]["context_key"],"expected_submission_revision":workspace["submission_revision"] if expected is None else expected,"content":{"answer":text}},status)


def history(client, scope, submission_id, *, teacher=False):
    return request(client,"GET",f"/submissions/{submission_id}/history",scope["owner" if teacher else "student"]["token"])


def grade(client, scope, attempt, state, *, score=80, status="graded", feedback="已核对论证", key=None, expected_grade=None, http=201, historical=False):
    old = next((item for item in state["grades"] if item["attempt_id"] == attempt["id"]),None)
    payload={"client_request_id":key or uuid4().hex,"expected_submission_revision":state["revision"],"expected_grade_revision":expected_grade if expected_grade is not None else old["revision"] if old else 0,"status":status,"score":score,"feedback":feedback,"allow_historical":historical}
    return request(client,"POST",f"/assignment-attempts/{attempt['id']}/grades",scope["owner"]["token"],payload,http)


def points(submission_id):
    with get_session_factory(get_settings().database_url)() as db:
        return db.scalar(select(func.sum(PointLedger.delta)).where(PointLedger.submission_id==submission_id)) or 0


def test_return_resubmit_regrade_keep_all_facts_and_adjust_points_once(client):
    scope, course, task, _, _ = setup(client,"assignment_cycle")
    opened = open_task(client,scope,task["id"])
    key = uuid4().hex
    first = submit_task(client,scope,opened,key=key)
    assert submit_task(client,scope,opened,key=key)==first
    returned = grade(client,scope,first,history(client,scope,first["submission_id"]),score=None,status="returned",feedback="请补充实验依据")
    assert returned["point_delta"]==0 and completed(client,scope,course["id"])==0
    reopened = open_task(client,scope,task["id"])
    assert reopened["can_submit"] and reopened["grade"]["status"]=="returned"
    second = submit_task(client,scope,reopened,"补充依据后的第二稿")
    assert second["id"]!=first["id"] and second["attempt_number"]==2
    fresh = history(client,scope,first["submission_id"])
    grade(client,scope,first,fresh,http=409)
    approved = grade(client,scope,second,fresh,score=80)
    assert approved["point_delta"]==80 and points(first["submission_id"])==80
    assert completed(client,scope,course["id"])==1
    before = history(client,scope,first["submission_id"])
    request_key=uuid4().hex
    revised = grade(client,scope,second,before,score=85,key=request_key)
    assert revised["point_delta"]==5 and points(first["submission_id"])==85
    assert grade(client,scope,second,before,score=85,key=request_key)==revised
    saved = history(client,scope,first["submission_id"])
    assert [item["content"]["answer"] for item in saved["attempts"]]==["补充依据后的第二稿","我的第一稿"]
    assert sorted((item["status"],item["score"] or 0) for item in saved["grades"])==[("graded",80),("graded",85),("returned",0)]
    grade(client,scope,second,saved,status="returned",score=None,feedback="再检查一个关键条件")
    assert completed(client,scope,course["id"])==0 and points(first["submission_id"])==0


def test_assignment_definition_and_score_limit_are_pinned_at_start(client):
    scope, course, task, _, release = setup(client,"assignment_pin")
    opened = open_task(client,scope,task["id"])
    with get_session_factory(get_settings().database_url)() as db:
        current=db.get(Assignment,task["id"])
        current.description="下一轮新要求"
        current.max_score=10
        db.commit()
    attempt=submit_task(client,scope,opened)
    assert attempt["assignment_snapshot"]["max_score"]==100
    assert attempt["assignment_snapshot"]["description"]=="用事实支持结论"
    result=grade(client,scope,attempt,history(client,scope,attempt["submission_id"]),score=90)
    assert result["max_score"]==100 and result["score"]==90
    assert attempt["course_release_id"]==release["id"]


def test_old_assignment_finishes_without_overwriting_newer_submission(client):
    scope, course, task, draft, first_release=setup(client,"assignment_late")
    old=open_task(client,scope,task["id"])
    draft=read_draft(client,scope,course["id"])
    draft["units"][0]["content"]["blocks"][1]["markdown"]="新的报告说明"
    draft=save(client,scope,draft)
    second_release=release_draft(client,scope,draft,{str(draft["units"][0]["id"]):"redo"})
    fresh=open_task(client,scope,task["id"])
    current=submit_task(client,scope,fresh,"新版回答")
    grade(client,scope,current,history(client,scope,current["submission_id"]),score=70)
    state=history(client,scope,current["submission_id"])
    old_attempt=submit_task(client,scope,old,"稍后完成的旧版回答",expected=state["revision"])
    after=history(client,scope,current["submission_id"])
    assert after["current_attempt_id"]==current["id"]
    old_grade=grade(client,scope,old_attempt,after,score=95,historical=True)
    assert old_grade["point_delta"]==0 and points(current["submission_id"])==70
    with get_session_factory(get_settings().database_url)() as db:
        head=db.get(Submission,current["submission_id"])
        assert head.content=={"answer":"新版回答"} and head.score==70
    assert old_attempt["course_release_id"]==first_release["id"] and current["course_release_id"]==second_release["id"]
    assert completed(client,scope,course["id"])==1


def test_new_release_redo_allows_new_attempt_while_keep_does_not_force_resubmit(client):
    scope, course, task, draft, first=setup(client,"assignment_redo")
    old=open_task(client,scope,task["id"])
    attempt=submit_task(client,scope,old)
    grade(client,scope,attempt,history(client,scope,attempt["submission_id"]))
    draft=read_draft(client,scope,course["id"])
    draft["units"][0]["content"]["blocks"][1]["markdown"]="只修正文案"
    release_draft(client,scope,save(client,scope,draft))
    assert not open_task(client,scope,task["id"])["can_submit"]
    assert completed(client,scope,course["id"])==1
    draft=read_draft(client,scope,course["id"])
    draft["units"][0]["content"]["blocks"][1]["markdown"]="安排一次补做"
    draft=save(client,scope,draft)
    release_draft(client,scope,draft,{str(draft["units"][0]["id"]):"redo"})
    new=open_task(client,scope,task["id"])
    assert new["can_submit"] and completed(client,scope,course["id"])==0
    next_attempt=submit_task(client,scope,new,"新版补做")
    assert next_attempt["attempt_number"]==2


def test_grading_scope_and_version_conflicts_leave_history_unchanged(client):
    scope, course, task, _, _=setup(client,"assignment_access")
    opened=open_task(client,scope,task["id"])
    attempted=submit_task(client,scope,opened)
    body={"client_request_id":uuid4().hex,"expected_submission_revision":1,"expected_grade_revision":0,"status":"graded","score":80}
    request(client,"POST",f"/assignment-attempts/{attempted['id']}/grades",scope["outsider_teacher"]["token"],body,403)
    request(client,"POST",f"/assignment-attempts/{attempted['id']}/grades",scope["student"]["token"],body,403)
    state=history(client,scope,attempted["submission_id"])
    grade(client,scope,attempted,state)
    grade(client,scope,attempted,state,score=90,http=409)
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(AssignmentGrade))==1
    request(client,"GET",f"/submissions/{attempted['submission_id']}/history",scope["outsider_student"]["token"],status=403)


def test_new_grade_facts_are_not_reimported_as_legacy_completion_after_return(client):
    scope, course, task, _, first = setup(client, "assignment_legacy_result")
    # A release published before this upgrade still uses the original projection contract.
    with get_session_factory(get_settings().database_url)() as db:
        db.execute(update(CourseRelease).where(CourseRelease.id == first["id"]).values(result_contract_version=1))
        db.commit()
    attempt = submit_task(client, scope, open_task(client, scope, task["id"]))
    grade(client, scope, attempt, history(client, scope, attempt["submission_id"]), score=80)
    grade(client, scope, attempt, history(client, scope, attempt["submission_id"]), status="returned", score=None, feedback="补充证据后重交")
    draft = read_draft(client, scope, course["id"])
    draft["units"][0]["content"]["blocks"][1]["markdown"] = "补充教学说明"
    release_draft(client, scope, save(client, scope, draft))
    assert completed(client, scope, course["id"]) == 0
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(LearningResult).where(LearningResult.provenance == "legacy-rule-fact")) == 0


def test_closed_task_can_be_read_but_not_submitted(client):
    scope, _, task, _, _ = setup(client, "assignment_closed_history")
    first = submit_task(client, scope, open_task(client, scope, task["id"]))
    with get_session_factory(get_settings().database_url)() as db:
        db.get(Assignment, task["id"]).status = "closed"
        db.commit()
    opened = open_task(client, scope, task["id"])
    assert not opened["can_submit"] and opened["attempt"]["id"] == first["id"]
    submit_task(client, scope, opened, status=409)
