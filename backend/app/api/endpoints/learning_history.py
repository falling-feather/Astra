from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.api.endpoints.course_workflow import service_call
from app.db.session import get_db
from app.schemas.learning_history import ContextCheckpointAnswer, ContextCheckpointRead, LearningContextRead, LearningContextStart
from app.services import learning_assessments, learning_contexts
from app.services import learning_history_queries
from app.schemas.learning_history import LearningHistoryPage, LearningResumeRead
from app.schemas.learning_history import AssignmentAttemptCommand, AssignmentAttemptRead, AssignmentGradeCommand, AssignmentGradeRead, AssignmentHistoryRead
from app.schemas.learning_history import AssignmentOpenCommand, AssignmentWorkspaceRead
from app.services import assignment_history

router = APIRouter()


@router.post("/learning-contexts", response_model=LearningContextRead, status_code=201)
def start(payload: LearningContextStart, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, learning_contexts.start_context, actor=actor, payload=payload)


@router.get("/learning-contexts/{context_key}", response_model=LearningContextRead)
def read(context_key: str, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, learning_contexts.read_context, actor=actor, context_key=context_key)


@router.post("/learning-contexts/{context_key}/checkpoints/{checkpoint_key}", response_model=ContextCheckpointRead, status_code=201)
def checkpoint(context_key: str, checkpoint_key: str, payload: ContextCheckpointAnswer, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, learning_assessments.answer_checkpoint, actor=actor, context_key=context_key, checkpoint_key=checkpoint_key, payload=payload, request=request)


@router.get("/courses/{course_id}/learning-results", response_model=LearningHistoryPage)
def history(course_id: int, student_id: int | None = Query(None, ge=1), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0), actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, learning_history_queries.result_history, actor=actor, course_id=course_id, student_id=student_id, limit=limit, offset=offset)


@router.get("/courses/{course_id}/learning-contexts", response_model=list[LearningResumeRead])
def contexts(course_id: int, limit: int = Query(20, ge=1, le=100), actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, learning_history_queries.recent_contexts, actor=actor, course_id=course_id, limit=limit)


@router.post("/assignments/{assignment_id}/attempts", response_model=AssignmentAttemptRead, status_code=201)
def submit_assignment(assignment_id: int, payload: AssignmentAttemptCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, assignment_history.submit_attempt, actor=actor, assignment_id=assignment_id, payload=payload, request=request)


@router.post("/assignments/{assignment_id}/open", response_model=AssignmentWorkspaceRead)
def open_assignment(assignment_id: int, payload: AssignmentOpenCommand, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, assignment_history.open_assignment, actor=actor, assignment_id=assignment_id, payload=payload)


@router.post("/assignment-attempts/{attempt_id}/grades", response_model=AssignmentGradeRead, status_code=201)
def grade_assignment(attempt_id: int, payload: AssignmentGradeCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, assignment_history.grade_attempt, actor=actor, attempt_id=attempt_id, payload=payload, request=request)


@router.get("/submissions/{submission_id}/history", response_model=AssignmentHistoryRead)
def submission_history(submission_id: int, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, assignment_history.submission_history, actor=actor, submission_id=submission_id, limit=limit, offset=offset)
