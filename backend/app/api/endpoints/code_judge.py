from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.models import (
    CodeJudgeAttempt,
    CodeProblem,
    CodeProblemVersion,
    CodeSubmission,
    CourseClass,
    CourseUnitClassPlan,
    ClassGroup,
    Course,
    CourseUnit,
    User,
)
from app.schemas.code_judge import (
    CodeJudgeAttemptPage,
    CodeJudgeAttemptRead,
    CodeProblemCreate,
    CodeProblemRead,
    CodeProblemVersionCreate,
    CodeProblemVersionRead,
    CodeSubmissionCreate,
    CodeSubmissionPage,
    CodeSubmissionRead,
    CodeSubmissionSourceRead,
)
from app.services.access_control import (
    course_attached_to_class,
    get_class,
    get_course,
    lock_active_school_for_write,
    require_class_member,
    require_class_teacher_or_admin,
    require_course_collaborator_or_admin,
    require_course_visible,
    require_school_role,
    require_student_unit_published,
)
from app.services.audit import record_audit_log
from app.services.code_judge import (
    DisabledCodeRunnerAdapter,
    active_problem_version,
    create_code_submission,
    create_problem,
    create_problem_version,
)
from app.services.course_release_plans import (
    effective_unit_access,
    get_course_class_or_404,
    get_plan_for_unit,
)
from app.services.course_release_write_gate import (
    require_student_unit_open_for_write,
)
from app.services.pagination import list_legacy_scalars, paged_endpoint_url
from app.services.text import require_trimmed_text


router = APIRouter()


@router.post("/code-problems", response_model=CodeProblemRead, status_code=status.HTTP_201_CREATED)
def create_code_problem(
    payload: CodeProblemCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeProblemRead:
    course = get_course(db, payload.course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_collaborator_or_admin(
        db,
        current_user,
        course,
        {"editor", "content_editor", "assessment_editor"},
        detail="Code problem creation requires active editing collaborator role",
    )
    lock_active_school_for_write(db, course.school_id)
    unit = _course_unit_or_404(db, course, payload.course_unit_id)
    _validate_test_cases(payload.test_cases, payload.input_max_bytes, payload.output_max_bytes)
    try:
        problem, version = create_problem(
            db,
            school_id=course.school_id,
            course_id=course.id,
            unit=unit,
            title=require_trimmed_text(payload.title, "Code problem title is required"),
            statement_markdown=require_trimmed_text(payload.statement_markdown, "Code problem statement is required"),
            test_cases=[case.model_dump() for case in payload.test_cases],
            language_allowlist=list(payload.language_allowlist),
            resource_policy=payload.resource_policy.model_dump(),
            source_max_bytes=payload.source_max_bytes,
            input_max_bytes=payload.input_max_bytes,
            output_max_bytes=payload.output_max_bytes,
            created_by_user_id=current_user.id,
        )
        record_audit_log(
            db,
            actor=current_user,
            action="code_problem.create",
            resource_type="code_problem",
            resource_id=problem.id,
            school_id=course.school_id,
            event_result="success",
            request=request,
            snapshot={
                "after": {
                    "course_id": course.id,
                    "course_unit_id": unit.id,
                    "activity_key": unit.activity_key,
                    "version_id": version.id,
                    "version_number": version.version_number,
                    "spec_sha256": version.spec_sha256,
                    "language_allowlist": list(version.language_allowlist_json or []),
                }
            },
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Code problem already exists for this course unit") from exc
    return _problem_read(problem, version)


@router.post("/code-problems/{problem_id}/versions", response_model=CodeProblemVersionRead, status_code=status.HTTP_201_CREATED)
def create_code_problem_version(
    problem_id: int,
    payload: CodeProblemVersionCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeProblemVersionRead:
    problem = _problem_or_404(db, problem_id)
    course = get_course(db, problem.course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_collaborator_or_admin(
        db,
        current_user,
        course,
        {"editor", "content_editor", "assessment_editor"},
        detail="Code problem version creation requires active editing collaborator role",
    )
    lock_active_school_for_write(db, course.school_id)
    _validate_test_cases(payload.test_cases, payload.input_max_bytes, payload.output_max_bytes)
    try:
        version = create_problem_version(
            db,
            problem=problem,
            statement_markdown=require_trimmed_text(payload.statement_markdown, "Code problem statement is required"),
            test_cases=[case.model_dump() for case in payload.test_cases],
            language_allowlist=list(payload.language_allowlist),
            resource_policy=payload.resource_policy.model_dump(),
            source_max_bytes=payload.source_max_bytes,
            input_max_bytes=payload.input_max_bytes,
            output_max_bytes=payload.output_max_bytes,
            created_by_user_id=current_user.id,
        )
        record_audit_log(
            db,
            actor=current_user,
            action="code_problem.version.create",
            resource_type="code_problem_version",
            resource_id=version.id,
            school_id=course.school_id,
            event_result="success",
            request=request,
            snapshot={
                "after": {
                    "problem_id": problem.id,
                    "version_number": version.version_number,
                    "spec_sha256": version.spec_sha256,
                    "language_allowlist": list(version.language_allowlist_json or []),
                }
            },
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Code problem version was updated concurrently; retry") from exc
    return _version_read(version)


@router.get("/code-problems/by-activity", response_model=CodeProblemRead)
def read_code_problem_by_activity(
    course_id: int = Query(..., ge=1),
    activity_key: str = Query(..., min_length=1, max_length=120),
    class_id: int | None = Query(default=None, ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeProblemRead:
    problem = db.scalar(
        select(CodeProblem).where(
            CodeProblem.course_id == course_id,
            CodeProblem.activity_key == activity_key,
            CodeProblem.status == "active",
        )
    )
    if problem is None:
        raise HTTPException(status_code=404, detail="Code problem not found")
    version = _active_version_or_409(db, problem.id)
    if current_user.role == "student":
        if class_id is None:
            raise HTTPException(status_code=422, detail="class_id is required for student code problem scope")
        access = _student_problem_access(db, current_user, problem, class_id)
        if access.state == "hidden":
            raise HTTPException(status_code=403, detail="Course unit is not visible in this class")
        return _problem_read(problem, version, access.state, list(access.lock_reasons))
    course = require_course_visible(db, current_user, problem.course_id)
    if class_id is not None:
        class_group = get_class(db, class_id)
        if class_group.school_id != course.school_id or not course_attached_to_class(db, course.id, class_group.id):
            raise HTTPException(status_code=403, detail="Course is not attached to this class")
        require_class_teacher_or_admin(db, current_user, class_group, detail="Code problem requires class teacher scope")
    return _problem_read(problem, version)


@router.get("/code-problems/{problem_id}", response_model=CodeProblemRead)
def read_code_problem(
    problem_id: int,
    class_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeProblemRead:
    problem = _problem_or_404(db, problem_id)
    version = _active_version_or_409(db, problem.id)
    if current_user.role == "student":
        if class_id is None:
            raise HTTPException(status_code=422, detail="class_id is required for student code problem scope")
        access = _student_problem_access(db, current_user, problem, class_id)
        if access.state == "hidden":
            raise HTTPException(status_code=403, detail="Course unit is not visible in this class")
        return _problem_read(problem, version, access.state, list(access.lock_reasons))
    course = require_course_visible(db, current_user, problem.course_id)
    if class_id is not None:
        class_group = get_class(db, class_id)
        if class_group.school_id != course.school_id or not course_attached_to_class(db, course.id, class_group.id):
            raise HTTPException(status_code=403, detail="Course is not attached to this class")
        require_class_teacher_or_admin(db, current_user, class_group, detail="Code problem requires class teacher scope")
    return _problem_read(problem, version)


@router.post("/code-problems/{problem_id}/submissions", response_model=CodeSubmissionRead, status_code=status.HTTP_201_CREATED)
def create_student_code_submission(
    problem_id: int,
    payload: CodeSubmissionCreate,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeSubmissionRead:
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can create code submissions")
    problem = _problem_or_404(db, problem_id)
    if problem.status != "active":
        raise HTTPException(status_code=409, detail="Code problem is not active")
    problem = _require_student_problem_open_for_write(
        db,
        current_user,
        problem,
        payload.class_id,
    )
    version = _active_version_or_409(db, problem.id, locking_read=True)
    try:
        result = create_code_submission(
            db,
            problem=problem,
            version=version,
            student_id=current_user.id,
            class_id=payload.class_id,
            language=payload.language,
            source_code=payload.source_code,
            stdin=payload.stdin,
            adapter=DisabledCodeRunnerAdapter(),
        )
    except ValueError as exc:
        if str(exc) == "idempotency_conflict":
            raise HTTPException(status_code=409, detail="Submission idempotency key conflicts with different content") from exc
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record_audit_log(
        db,
        actor=current_user,
        action="code_submission.create" if result.created else "code_submission.idempotent_replay",
        resource_type="code_submission",
        resource_id=result.submission.id,
        school_id=problem.school_id,
        class_id=payload.class_id,
        event_result="success",
        request=request,
        snapshot={
            "problem_id": problem.id,
            "problem_version_id": version.id,
            "activity_key": problem.activity_key,
            "language": payload.language,
            "source_sha256": result.submission.source_sha256,
            "input_sha256": result.submission.input_sha256,
            "status": result.submission.status,
            "runner_adapter": "disabled",
        },
    )
    db.commit()
    if not result.created:
        response.status_code = status.HTTP_200_OK
    return _submission_read(result.submission, idempotent_replay=result.idempotent_replay)


@router.get("/code-submissions", response_model=CodeSubmissionPage)
def list_code_submissions(
    class_id: int | None = Query(default=None),
    course_id: int | None = Query(default=None),
    activity_key: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeSubmissionPage:
    statement = select(CodeSubmission).order_by(CodeSubmission.created_at.desc(), CodeSubmission.id.desc())
    if current_user.role == "student":
        if class_id is None:
            raise HTTPException(status_code=422, detail="class_id is required for student code submission scope")
        class_group = require_class_member(db, current_user, class_id)
        statement = (
            statement.join(
                Course,
                and_(Course.id == CodeSubmission.course_id, Course.status == "published"),
            )
            .join(
                CourseClass,
                and_(
                    CourseClass.course_id == CodeSubmission.course_id,
                    CourseClass.class_id == CodeSubmission.class_id,
                    CourseClass.status == "active",
                ),
            )
            .join(
                CourseUnitClassPlan,
                and_(
                    CourseUnitClassPlan.course_class_id == CourseClass.id,
                    CourseUnitClassPlan.course_unit_id == CodeSubmission.course_unit_id,
                    CourseUnitClassPlan.release_mode != "hidden",
                ),
            )
            .join(
                CourseUnit,
                and_(CourseUnit.id == CodeSubmission.course_unit_id, CourseUnit.status == "published"),
            )
            .where(CodeSubmission.student_id == current_user.id, CodeSubmission.class_id == class_group.id)
        )
        if course_id is not None:
            statement = statement.where(CodeSubmission.course_id == course_id)
        if activity_key is not None:
            statement = statement.where(CodeSubmission.activity_key == activity_key)
    else:
        if class_id is not None:
            class_group = get_class(db, class_id)
            require_class_teacher_or_admin(
                db,
                current_user,
                class_group,
                detail="Code submissions require class teacher scope",
            )
            statement = statement.where(CodeSubmission.class_id == class_group.id)
        elif current_user.role != "admin":
            raise HTTPException(status_code=422, detail="class_id is required for teacher code submission scope")
        if course_id is not None:
            course = get_course(db, course_id)
            if class_id is not None and not course_attached_to_class(db, course.id, class_id):
                raise HTTPException(status_code=403, detail="Course is not attached to this class")
            statement = statement.where(CodeSubmission.course_id == course.id)
        if activity_key is not None:
            statement = statement.where(CodeSubmission.activity_key == activity_key)
    total = int(db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)
    rows = list(db.scalars(statement.offset(offset).limit(limit)).all())
    next_offset = offset + len(rows)
    return CodeSubmissionPage(
        items=[_submission_read(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset if next_offset < total else None,
    )


@router.get("/code-submissions/{submission_id}", response_model=CodeSubmissionRead)
def read_code_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeSubmissionRead:
    submission = _submission_or_404(db, submission_id)
    _authorize_submission_read(db, current_user, submission, enforce_student_visibility=True)
    return _submission_read(submission)


@router.get("/code-submissions/{submission_id}/source", response_model=CodeSubmissionSourceRead)
def read_code_submission_source(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeSubmissionSourceRead:
    submission = _submission_or_404(db, submission_id)
    _authorize_submission_read(db, current_user, submission, enforce_student_visibility=True)
    return CodeSubmissionSourceRead(
        submission_id=submission.id,
        language=submission.language,
        source_code=submission.source_code,
        stdin=submission.stdin,
    )


@router.get("/code-submissions/{submission_id}/attempts", response_model=list[CodeJudgeAttemptRead], deprecated=True)
def list_code_judge_attempts(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CodeJudgeAttemptRead]:
    submission = _submission_or_404(db, submission_id)
    _authorize_submission_read(db, current_user, submission, enforce_student_visibility=True)
    attempts = list_legacy_scalars(
        db,
        select(CodeJudgeAttempt)
        .where(CodeJudgeAttempt.submission_id == submission.id)
        .order_by(CodeJudgeAttempt.attempt_number, CodeJudgeAttempt.id),
        paged_endpoint=paged_endpoint_url(
            f"/api/code-submissions/{submission_id}/attempts/page",
            limit=200,
            offset=0,
        ),
    )
    return [CodeJudgeAttemptRead.model_validate(attempt) for attempt in attempts]


@router.get("/code-submissions/{submission_id}/attempts/page", response_model=CodeJudgeAttemptPage)
def list_code_judge_attempts_page(
    submission_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CodeJudgeAttemptPage:
    submission = _submission_or_404(db, submission_id)
    _authorize_submission_read(db, current_user, submission, enforce_student_visibility=True)
    statement = (
        select(CodeJudgeAttempt)
        .where(CodeJudgeAttempt.submission_id == submission.id)
        .order_by(CodeJudgeAttempt.attempt_number, CodeJudgeAttempt.id)
    )
    total = int(db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)
    attempts = list(db.scalars(statement.offset(offset).limit(limit)).all())
    next_offset = offset + len(attempts)
    return CodeJudgeAttemptPage(
        items=[CodeJudgeAttemptRead.model_validate(attempt) for attempt in attempts],
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset if next_offset < total else None,
    )


def _student_problem_access(db: Session, student: User, problem: CodeProblem, class_id: int):
    course = require_course_visible(db, student, problem.course_id)
    class_group = require_class_member(db, student, class_id)
    if class_group.school_id != course.school_id or not course_attached_to_class(db, course.id, class_group.id):
        raise HTTPException(status_code=403, detail="Course is not attached to this class")
    unit = _course_unit_or_404(db, course, problem.course_unit_id)
    require_student_unit_published(student, unit)
    course_class = get_course_class_or_404(db, course.id, class_group.id)
    plan = get_plan_for_unit(db, course_class, unit.id)
    return effective_unit_access(
        db,
        course=course,
        class_group=class_group,
        unit=unit,
        plan=plan,
        student_id=student.id,
    )


def _require_student_problem_open_for_write(
    db: Session,
    student: User,
    problem: CodeProblem,
    class_id: int,
) -> CodeProblem:
    course = require_course_visible(db, student, problem.course_id)
    class_group = require_class_member(db, student, class_id)
    if class_group.school_id != course.school_id or not course_attached_to_class(db, course.id, class_group.id):
        raise HTTPException(status_code=403, detail="Course is not attached to this class")
    unit = _course_unit_or_404(db, course, problem.course_unit_id)
    require_student_unit_published(student, unit)
    require_student_unit_open_for_write(
        db,
        course=course,
        class_group=class_group,
        unit=unit,
        student_id=student.id,
    )
    locked_problem = db.scalar(
        select(CodeProblem)
        .where(
            CodeProblem.id == problem.id,
            CodeProblem.course_id == course.id,
            CodeProblem.course_unit_id == unit.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_problem is None:
        raise HTTPException(status_code=404, detail="Code problem not found")
    if locked_problem.status != "active":
        raise HTTPException(status_code=409, detail="Code problem is not active")
    return locked_problem


def _authorize_submission_read(
    db: Session,
    current_user: User,
    submission: CodeSubmission,
    *,
    enforce_student_visibility: bool,
) -> None:
    if current_user.role == "student":
        if submission.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="Students can only read their own code submissions")
        problem = _problem_or_404(db, submission.problem_id)
        access = _student_problem_access(db, current_user, problem, submission.class_id)
        if enforce_student_visibility and access.state == "hidden":
            raise HTTPException(status_code=403, detail="Course unit is not visible in this class")
        return
    class_group = get_class(db, submission.class_id)
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Code submission requires class teacher scope",
    )


def _problem_or_404(db: Session, problem_id: int) -> CodeProblem:
    problem = db.get(CodeProblem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="Code problem not found")
    return problem


def _submission_or_404(db: Session, submission_id: int) -> CodeSubmission:
    submission = db.get(CodeSubmission, submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail="Code submission not found")
    return submission


def _course_unit_or_404(db: Session, course: Course, unit_id: int) -> CourseUnit:
    unit = db.get(CourseUnit, unit_id)
    if unit is None or unit.course_id != course.id:
        raise HTTPException(status_code=404, detail="Course unit not found")
    return unit


def _active_version_or_409(
    db: Session,
    problem_id: int,
    *,
    locking_read: bool = False,
) -> CodeProblemVersion:
    try:
        return active_problem_version(
            db,
            problem_id,
            locking_read=locking_read,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _validate_test_cases(test_cases, input_max_bytes: int, output_max_bytes: int) -> None:
    for test_case in test_cases:
        if len(test_case.stdin.encode("utf-8")) > input_max_bytes:
            raise HTTPException(status_code=422, detail="Test input exceeds problem input limit")
        if len(test_case.expected_stdout.encode("utf-8")) > output_max_bytes:
            raise HTTPException(status_code=422, detail="Expected output exceeds problem output limit")


def _version_read(version: CodeProblemVersion) -> CodeProblemVersionRead:
    return CodeProblemVersionRead(
        id=version.id,
        problem_id=version.problem_id,
        version_number=version.version_number,
        status=version.status,
        statement_markdown=version.statement_markdown,
        language_allowlist=list(version.language_allowlist_json or []),
        resource_policy=dict(version.resource_policy_json or {}),
        source_max_bytes=version.source_max_bytes,
        input_max_bytes=version.input_max_bytes,
        output_max_bytes=version.output_max_bytes,
        spec_sha256=version.spec_sha256,
    )


def _problem_read(problem: CodeProblem, version: CodeProblemVersion, state: str | None = None, reasons: list[str] | None = None) -> CodeProblemRead:
    return CodeProblemRead(
        id=problem.id,
        school_id=problem.school_id,
        course_id=problem.course_id,
        course_unit_id=problem.course_unit_id,
        activity_key=problem.activity_key,
        title=problem.title,
        status=problem.status,
        active_version=_version_read(version),
        effective_release_state=state,
        lock_reasons=reasons or [],
    )


def _submission_read(submission: CodeSubmission, *, idempotent_replay: bool = False) -> CodeSubmissionRead:
    return CodeSubmissionRead(
        id=submission.id,
        school_id=submission.school_id,
        course_id=submission.course_id,
        class_id=submission.class_id,
        course_unit_id=submission.course_unit_id,
        activity_key=submission.activity_key,
        problem_id=submission.problem_id,
        problem_version_id=submission.problem_version_id,
        student_id=submission.student_id,
        language=submission.language,
        status=submission.status,
        result_summary=dict(submission.result_summary_json or {}),
        source_sha256=submission.source_sha256,
        created_at=submission.created_at,
        judged_at=submission.judged_at,
        idempotent_replay=idempotent_replay,
    )
