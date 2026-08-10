from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.learning_evidence import (
    CompletionRuleActivate,
    CompletionRuleActivationRead,
    CompletionRuleActivationStateRead,
    CompletionRuleCreate,
    CompletionRuleRead,
    DiscoverableEvidenceEventType,
    LearnerEvidenceBatchCreate,
    LearnerEvidenceEventCreate,
    LearningActivityAuthorityRead,
    LearningActivityReleaseRead,
    LearningActivityRuntimeEventCreate,
    LearningActivityRuntimeIdentity,
    LearningActivityRuntimeReceipt,
    LearningActivityRuntimeScope,
    LearningActivityServerRecoveryRead,
    LearningEvidenceBatchRead,
    LearningEvidenceReceipt,
    ProjectionRebuildRead,
    StudentLearningRecoveryRead,
    TeacherEvidenceCorrectionCreate,
    TeacherLearningAggregateRead,
    TeacherLearningEvidencePageRead,
)
from app.services import learning_activity_runtime as activity_runtime_service
from app.services import learning_evidence as learning_evidence_service


router = APIRouter()


@router.post("/rules", response_model=CompletionRuleRead, status_code=status.HTTP_201_CREATED)
def create_completion_rule(
    payload: CompletionRuleCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CompletionRuleRead:
    return _service_call(
        learning_evidence_service.create_completion_rule,
        db,
        actor=current_user,
        payload=payload,
        request=request,
    )


@router.get("/rules", response_model=list[CompletionRuleRead])
def list_completion_rules(
    course_id: int = Query(ge=1),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CompletionRuleRead]:
    return _service_call(
        learning_evidence_service.list_completion_rules,
        db,
        actor=current_user,
        course_id=course_id,
    )


@router.get(
    "/rules/activation",
    response_model=CompletionRuleActivationStateRead,
)
def get_completion_rule_activation_state(
    course_id: int = Query(ge=1),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CompletionRuleActivationStateRead:
    return _service_call(
        learning_evidence_service.get_completion_rule_activation_state,
        db,
        actor=current_user,
        course_id=course_id,
    )


@router.post(
    "/rules/{rule_id}/activate",
    response_model=CompletionRuleActivationRead,
)
def activate_completion_rule(
    rule_id: int,
    payload: CompletionRuleActivate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CompletionRuleActivationRead:
    return _service_call(
        learning_evidence_service.activate_completion_rule,
        db,
        actor=current_user,
        rule_id=rule_id,
        payload=payload,
        request=request,
    )


@router.post(
    "/events",
    response_model=LearningEvidenceReceipt,
    status_code=status.HTTP_201_CREATED,
)
def append_learner_event(
    payload: LearnerEvidenceEventCreate,
    response: Response,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningEvidenceReceipt:
    receipt = _service_call(
        learning_evidence_service.append_learner_event,
        db,
        actor=current_user,
        payload=payload,
    )
    if receipt["outcome"] == "duplicate":
        response.status_code = status.HTTP_200_OK
    return receipt


@router.post(
    "/activity-runtime/authority",
    response_model=LearningActivityAuthorityRead,
)
def learning_activity_authority(
    identity: LearningActivityRuntimeIdentity,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningActivityAuthorityRead:
    return _service_call(
        activity_runtime_service.learning_activity_authority,
        db,
        actor=current_user,
        identity=identity,
    )


@router.post(
    "/activity-runtime/release",
    response_model=LearningActivityReleaseRead,
)
def learning_activity_release(
    scope: LearningActivityRuntimeScope,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningActivityReleaseRead:
    return _service_call(
        activity_runtime_service.learning_activity_release,
        db,
        actor=current_user,
        scope=scope,
    )


@router.post(
    "/activity-runtime/events",
    response_model=LearningActivityRuntimeReceipt,
    status_code=status.HTTP_201_CREATED,
)
def append_learning_activity_event(
    payload: LearningActivityRuntimeEventCreate,
    response: Response,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningActivityRuntimeReceipt:
    receipt = _service_call(
        activity_runtime_service.append_learning_activity_event,
        db,
        actor=current_user,
        payload=payload,
    )
    if receipt["status"] == "reconciled":
        response.status_code = status.HTTP_200_OK
    return receipt


@router.post(
    "/activity-runtime/recovery",
    response_model=LearningActivityServerRecoveryRead,
)
def learning_activity_server_recovery(
    identity: LearningActivityRuntimeIdentity,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningActivityServerRecoveryRead:
    return _service_call(
        activity_runtime_service.learning_activity_server_recovery,
        db,
        actor=current_user,
        identity=identity,
    )


@router.post("/events/batch", response_model=LearningEvidenceBatchRead)
def append_learner_event_batch(
    payload: LearnerEvidenceBatchCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningEvidenceBatchRead:
    return learning_evidence_service.append_learner_event_batch(
        db,
        actor=current_user,
        payload=payload,
    )


@router.get(
    "/classes/{class_id}/courses/{course_id}/events",
    response_model=TeacherLearningEvidencePageRead,
)
def teacher_learning_evidence_events(
    class_id: int,
    course_id: int,
    subject_user_id: int = Query(ge=1),
    activity_key: str | None = Query(
        default=None,
        min_length=1,
        max_length=120,
        pattern=r"^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$",
    ),
    event_type: DiscoverableEvidenceEventType | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeacherLearningEvidencePageRead:
    return _service_call(
        learning_evidence_service.teacher_learning_evidence_events,
        db,
        actor=current_user,
        class_id=class_id,
        course_id=course_id,
        subject_user_id=subject_user_id,
        activity_key=activity_key,
        event_type=event_type,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/events/{event_id}/corrections",
    response_model=LearningEvidenceReceipt,
    status_code=status.HTTP_201_CREATED,
)
def append_teacher_correction(
    event_id: int,
    payload: TeacherEvidenceCorrectionCreate,
    request: Request,
    response: Response,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningEvidenceReceipt:
    receipt = _service_call(
        learning_evidence_service.append_teacher_correction,
        db,
        actor=current_user,
        target_event_id=event_id,
        payload=payload,
        request=request,
    )
    if receipt["outcome"] == "duplicate":
        response.status_code = status.HTTP_200_OK
    return receipt


@router.get("/me/recovery", response_model=StudentLearningRecoveryRead)
def student_learning_recovery(
    class_id: int = Query(ge=1),
    course_id: int = Query(ge=1),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StudentLearningRecoveryRead:
    return _service_call(
        learning_evidence_service.student_learning_recovery,
        db,
        actor=current_user,
        class_id=class_id,
        course_id=course_id,
    )


@router.get(
    "/classes/{class_id}/courses/{course_id}/aggregate",
    response_model=TeacherLearningAggregateRead,
)
def teacher_learning_aggregate(
    class_id: int,
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeacherLearningAggregateRead:
    return _service_call(
        learning_evidence_service.teacher_learning_aggregate,
        db,
        actor=current_user,
        class_id=class_id,
        course_id=course_id,
    )


@router.post(
    "/classes/{class_id}/courses/{course_id}/rebuild",
    response_model=ProjectionRebuildRead,
)
def rebuild_learning_projections(
    class_id: int,
    course_id: int,
    subject_user_id: int | None = Query(default=None, ge=1),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectionRebuildRead:
    return _service_call(
        learning_evidence_service.rebuild_learning_projections,
        db,
        actor=current_user,
        class_id=class_id,
        course_id=course_id,
        subject_user_id=subject_user_id,
    )


def _service_call(function, db: Session, **kwargs):
    try:
        return function(db, **kwargs)
    except learning_evidence_service.LearningEvidenceError as exc:
        db.rollback()
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.detail},
        ) from exc
