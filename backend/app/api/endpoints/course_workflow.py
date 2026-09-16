"""v2 course workflow transport. Services own authorization and one commit per command."""
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.course_workflow import CourseCreateCommand, CourseDraftCommand, CourseDraftReadV2, CourseForkCommand, CourseForkRead, CourseRevisionRead, CourseWorkflowRead, WorkflowReceiptRead
from app.services import course_drafts_v2 as drafts
from app.services.course_workflow_support import read_operation
from app.services.content_platform import ContentPlatformError
from app.services.course_completion import CourseCompletionError
from app.core.learning_evidence_contract import LearningEvidenceError
from app.schemas import course_workflow as dto
from app.services import course_candidates as candidates, course_reviews_v2 as reviews, course_publications_v2 as publications

router = APIRouter()


@router.get("/operations/{client_request_id}", response_model=WorkflowReceiptRead)
def operation_receipt(client_request_id: str, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, read_operation, actor=actor, client_request_id=client_request_id)


def service_call(db: Session, operation: Callable[..., Any], **kwargs):
    try:
        return operation(db, **kwargs)
    except (ContentPlatformError, CourseCompletionError) as error:
        db.rollback()
        raise HTTPException(status_code=error.status_code, detail={"code": error.code, "message": error.message}) from error
    except LearningEvidenceError as error:
        db.rollback()
        raise HTTPException(status_code=error.status_code, detail={"code": error.code, "message": error.detail}) from error
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "workflow_write_conflict", "message": "数据已变化或操作已提交，请重新读取并保留原请求编号"}) from error
    except OperationalError as error:
        db.rollback()
        if "database is locked" in str(error.orig).lower() or "database table is locked" in str(error.orig).lower():
            raise HTTPException(status_code=409, detail={"code": "workflow_write_conflict", "message": "另一项写入正在提交，请保留原请求编号后重试"}) from error
        raise
    except HTTPException:
        db.rollback()
        raise


@router.get("/courses", response_model=list[CourseWorkflowRead])
def list_courses(school_id: int | None = None, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, drafts.list_courses, actor=actor, school_id=school_id)


@router.post("/courses", response_model=CourseWorkflowRead, status_code=201)
def create_course(payload: CourseCreateCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, drafts.create_course, actor=actor, payload=payload, request=request)


@router.get("/courses/{course_id}", response_model=CourseWorkflowRead)
def course(course_id: int, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, drafts.read_course, actor=actor, course_id=course_id)


@router.get("/courses/{course_id}/draft", response_model=CourseDraftReadV2)
def read_draft(course_id: int, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, drafts.read_draft, actor=actor, course_id=course_id)


@router.put("/courses/{course_id}/draft", response_model=CourseDraftReadV2)
def save_draft(course_id: int, payload: CourseDraftCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, drafts.save_draft, actor=actor, course_id=course_id, payload=payload, request=request)


@router.post("/courses/{course_id}/forks", response_model=CourseForkRead, status_code=201)
def fork_course(course_id: int, payload: CourseForkCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, drafts.fork_course, actor=actor, source_course_id=course_id, payload=payload, request=request)


@router.get("/courses/{course_id}/revisions/{revision_id}", response_model=CourseRevisionRead)
def revision(course_id: int, revision_id: int, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, drafts.read_revision, actor=actor, course_id=course_id, revision_id=revision_id)


@router.get("/courses/{course_id}/revisions", response_model=dto.CourseRevisionPageRead)
def revisions(course_id: int, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, drafts.list_revisions, actor=actor, course_id=course_id, limit=limit, offset=offset)


@router.post("/courses/{course_id}/submission-preview", response_model=dto.SubmissionPreviewRead)
def submission_preview(course_id: int, payload: dto.SubmissionPreviewCommand, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, candidates.preview_submission, actor=actor, course_id=course_id, payload=payload)


@router.post("/courses/{course_id}/submissions", response_model=dto.SubmissionReceiptRead, status_code=201)
def submit(course_id: int, payload: dto.SubmitCandidateCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, candidates.submit_candidates, actor=actor, course_id=course_id, payload=payload, request=request)


@router.get("/candidates", response_model=dto.CandidatePageRead)
def candidate_list(school_id: int | None = None, course_id: int | None = None, batch_id: int | None = None, status: str | None = None, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0), actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, reviews.list_candidates, actor=actor, school_id=school_id, course_id=course_id, batch_id=batch_id, status=status, limit=limit, offset=offset)


@router.get("/candidates/{candidate_id}", response_model=dto.CandidateDetailRead)
def candidate_detail(candidate_id: int, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, reviews.read_candidate, actor=actor, candidate_id=candidate_id)


@router.post("/candidate-reviews", response_model=dto.ReviewReceiptRead)
def candidate_review(payload: dto.ReviewCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, reviews.review_candidates, actor=actor, payload=payload, request=request)


@router.post("/candidates/{candidate_id}/withdraw", response_model=dto.CandidateActionRead)
def candidate_withdraw(candidate_id: int, payload: dto.WithdrawCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, reviews.withdraw_candidate, actor=actor, candidate_id=candidate_id, payload=payload, request=request)


@router.post("/publications", response_model=dto.PublicationReceiptRead, status_code=201)
def publish(payload: dto.PublishCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, publications.publish_candidates, actor=actor, payload=payload, request=request)


@router.post("/courses/{course_id}/restore-draft", response_model=CourseDraftReadV2)
def restore(course_id: int, payload: dto.RestoreDraftCommand, request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service_call(db, publications.restore_draft, actor=actor, course_id=course_id, payload=payload, request=request)
