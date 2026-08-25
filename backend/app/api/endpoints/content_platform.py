"""HTTP adapter for V8.4 shared course drafts and releases."""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.content_platform import (
    CheckpointAttemptCreate,
    CheckpointAttemptRead,
    CourseCurrentReleaseRead,
    CoursePublicationReceipt,
    CourseReleasePublish,
    CourseReleaseRead,
    CourseSharedDraftRead,
    CourseSharedDraftReplace,
)
from app.services import course_completion as completion_service
from app.services import content_platform as platform_service

router = APIRouter()


def _service_call(db: Session, operation: Callable[..., Any], **kwargs: Any) -> Any:
    try:
        return operation(db, **kwargs)
    except (
        platform_service.ContentPlatformError,
        completion_service.CourseCompletionError,
    ) as exc:
        db.rollback()
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.post(
    "/courses/{course_id}/units/{unit_id}/checkpoints/{checkpoint_key}/attempts",
    response_model=CheckpointAttemptRead,
    status_code=status.HTTP_201_CREATED,
)
def submit_checkpoint_attempt(
    course_id: int,
    unit_id: int,
    checkpoint_key: str,
    payload: CheckpointAttemptCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _service_call(
        db,
        completion_service.submit_checkpoint_attempt,
        actor=current_user,
        course_id=course_id,
        unit_id=unit_id,
        checkpoint_key=checkpoint_key,
        payload=payload,
        request=request,
    )


@router.get("/courses/{course_id}/draft", response_model=CourseSharedDraftRead)
def get_course_draft(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _service_call(
        db,
        platform_service.get_course_draft,
        actor=current_user,
        course_id=course_id,
    )


@router.patch("/courses/{course_id}/draft", response_model=CourseSharedDraftRead)
def replace_course_draft(
    course_id: int,
    payload: CourseSharedDraftReplace,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _service_call(
        db,
        platform_service.replace_course_draft,
        actor=current_user,
        course_id=course_id,
        payload=payload,
        request=request,
    )


@router.get("/courses/{course_id}/releases", response_model=list[CourseReleaseRead])
def list_course_releases(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return _service_call(
        db,
        platform_service.list_course_releases,
        actor=current_user,
        course_id=course_id,
    )


@router.post(
    "/courses/{course_id}/releases",
    response_model=CoursePublicationReceipt,
    status_code=status.HTTP_201_CREATED,
)
def create_course_release(
    course_id: int,
    payload: CourseReleasePublish,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _service_call(
        db,
        platform_service.create_course_release,
        actor=current_user,
        course_id=course_id,
        payload=payload,
        request=request,
    )


@router.get(
    "/courses/{course_id}/releases/current",
    response_model=CourseCurrentReleaseRead,
)
def get_current_course_release(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _service_call(
        db,
        platform_service.get_current_course_release,
        actor=current_user,
        course_id=course_id,
    )


@router.get(
    "/courses/{course_id}/releases/{release_id}",
    response_model=CourseReleaseRead,
)
def get_course_release(
    course_id: int,
    release_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _service_call(
        db,
        platform_service.get_course_release,
        actor=current_user,
        course_id=course_id,
        release_id=release_id,
    )
