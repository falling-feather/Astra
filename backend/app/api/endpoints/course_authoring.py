from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.course_authoring import (
    CourseAuthoringOptionsRead,
    CourseDraftCreate,
    CourseDraftRead,
    CourseInformationRevisionReview,
    CourseInformationRevisionReviewPage,
    CourseInformationRevisionReviewRead,
    CourseInformationDraftUpdate,
)
from app.schemas.course_enrollment import (
    CourseAdmissionDiscoveryRead,
    CourseClassBatchEnrollmentCreate,
    CourseClassBatchEnrollmentRead,
    CourseEnrollmentPage,
    CourseEnrollmentRead,
    CourseEnrollmentStatusPatch,
    CourseJoinRequestCreate,
    CourseJoinRequestPage,
    CourseJoinRequestRead,
    CourseJoinRequestReview,
)
from app.services import course_authoring as course_authoring_service
from app.services import course_enrollments as course_enrollment_service
from app.services import course_information_reviews as course_information_review_service

router = APIRouter()


@router.post("/courses", response_model=CourseDraftRead, status_code=status.HTTP_201_CREATED)
def create_course_draft(
    payload: CourseDraftCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.create_course_draft(
        db,
        actor=current_user,
        payload=payload,
        request=request,
    )


@router.get("/courses", response_model=list[CourseDraftRead])
def list_course_drafts(
    school_id: int | None = Query(default=None, ge=1),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    return course_authoring_service.list_visible_course_drafts(
        db,
        actor=current_user,
        school_id=school_id,
    )


@router.get("/courses/authoring-options", response_model=CourseAuthoringOptionsRead)
def get_course_authoring_options(
    school_id: int = Query(ge=1),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.get_course_authoring_options(
        db,
        actor=current_user,
        school_id=school_id,
    )


@router.get("/courses/by-code/{course_code}", response_model=CourseAdmissionDiscoveryRead)
def discover_course_by_code(
    course_code: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_enrollment_service.discover_course_by_code(
        db,
        student=current_user,
        course_code=course_code,
    )


@router.get("/courses/{course_id}", response_model=CourseDraftRead)
def get_course_draft(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.get_visible_course_draft(
        db,
        actor=current_user,
        course_id=course_id,
    )


@router.post(
    "/courses/{course_id}/join-requests",
    response_model=CourseJoinRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def create_course_join_request(
    course_id: int,
    payload: CourseJoinRequestCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_enrollment_service.create_join_request(
        db,
        actor=current_user,
        course_id=course_id,
        source_class_id=payload.source_class_id,
        message=payload.message,
        request=request,
    )


@router.get(
    "/courses/{course_id}/join-requests",
    response_model=CourseJoinRequestPage,
)
def list_course_join_requests(
    course_id: int,
    status_filter: Literal["pending", "approved", "rejected", "all"] = Query(
        default="pending",
        alias="status",
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseJoinRequestPage:
    items, total, next_page = course_enrollment_service.list_join_requests(
        db,
        actor=current_user,
        course_id=course_id,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )
    return CourseJoinRequestPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_page,
    )


@router.patch(
    "/courses/{course_id}/join-requests/{join_request_id}",
    response_model=CourseJoinRequestRead,
)
def review_course_join_request(
    course_id: int,
    join_request_id: int,
    payload: CourseJoinRequestReview,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_enrollment_service.review_join_request(
        db,
        actor=current_user,
        course_id=course_id,
        join_request_id=join_request_id,
        decision=payload.status,
        note=payload.note,
        request=request,
    )


@router.get(
    "/courses/{course_id}/enrollments",
    response_model=CourseEnrollmentPage,
)
def list_course_enrollments(
    course_id: int,
    status_filter: Literal["active", "left", "all"] = Query(
        default="active",
        alias="status",
    ),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseEnrollmentPage:
    items, total, next_page = course_enrollment_service.list_enrollments(
        db,
        actor=current_user,
        course_id=course_id,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )
    return CourseEnrollmentPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_page,
    )


@router.post(
    "/courses/{course_id}/enrollments/batch",
    response_model=CourseClassBatchEnrollmentRead,
)
def batch_enroll_course_class(
    course_id: int,
    payload: CourseClassBatchEnrollmentCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_enrollment_service.batch_enroll_class(
        db,
        actor=current_user,
        course_id=course_id,
        class_id=payload.class_id,
        request=request,
    )


@router.patch(
    "/courses/{course_id}/enrollments/{enrollment_id}",
    response_model=CourseEnrollmentRead,
)
def leave_course_enrollment(
    course_id: int,
    enrollment_id: int,
    payload: CourseEnrollmentStatusPatch,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_enrollment_service.leave_enrollment(
        db,
        actor=current_user,
        course_id=course_id,
        enrollment_id=enrollment_id,
        note=payload.note,
        request=request,
    )


@router.post(
    "/courses/{course_id}/information-revisions",
    response_model=CourseDraftRead,
    status_code=status.HTTP_201_CREATED,
)
def create_course_information_revision(
    course_id: int,
    payload: CourseDraftCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.create_information_revision(
        db,
        actor=current_user,
        course_id=course_id,
        payload=payload,
        request=request,
    )


@router.post(
    "/courses/{course_id}/information-revisions/{revision_id}/submit",
    response_model=CourseDraftRead,
)
def submit_course_information_revision(
    course_id: int,
    revision_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.submit_information_revision(
        db,
        actor=current_user,
        course_id=course_id,
        revision_id=revision_id,
        request=request,
    )


@router.patch("/courses/{course_id}/information-revisions/{revision_id}", response_model=CourseDraftRead)
def update_course_information_draft(course_id: int, revision_id: int, payload: CourseInformationDraftUpdate, request: Request, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return course_authoring_service.update_information_draft(db, actor=current_user, course_id=course_id, revision_id=revision_id, payload=payload, request=request)


@router.get(
    "/admin/course-information-revisions",
    response_model=CourseInformationRevisionReviewPage,
)
def list_admin_course_information_revisions(
    status_filter: Literal["draft", "submitted", "approved", "rejected"] | None = Query(
        default="submitted",
        alias="status",
    ),
    school_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseInformationRevisionReviewPage:
    items, total, next_page = course_information_review_service.list_information_revisions(
        db,
        admin=current_user,
        status_filter=status_filter,
        school_id=school_id,
        limit=limit,
        offset=offset,
    )
    return CourseInformationRevisionReviewPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_page,
    )


@router.patch(
    "/admin/course-information-revisions/{revision_id}",
    response_model=CourseInformationRevisionReviewRead,
)
def review_admin_course_information_revision(
    revision_id: int,
    payload: CourseInformationRevisionReview,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_information_review_service.review_information_revision(
        db,
        revision_id=revision_id,
        reviewer=current_user,
        decision=payload.status,
        note=payload.note,
        request=request,
    )
