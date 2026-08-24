from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.models import ClassGroup, ClassJoinRequest, School, User
from app.schemas.admin import (
    AdminClassJoinRequestPage,
    AdminClassJoinRequestRead,
    AdminClassJoinRequestReview,
    AdminClassPage,
    AdminClassStats,
    AdminClassUpdate,
    AdminSchoolPage,
    AdminSchoolStats,
    AdminSchoolUpdate,
)
from app.schemas.school import ClassRead, SchoolRead
from app.services.access_control import require_class_teacher_or_admin_by_id, require_school_teacher_or_admin
from app.services.admin_common import next_offset, require_admin, statement_count
from app.services.admin_organization_governance import update_admin_class, update_admin_school
from app.services.admin_organization_stats import build_class_stats, build_school_stats
from app.services.class_join_requests import (
    apply_class_join_request_review,
    normalize_class_role,
    normalize_join_request_status,
)


router = APIRouter()


@router.get("/schools", response_model=AdminSchoolPage)
def list_admin_schools(
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=160),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminSchoolPage:
    require_admin(current_user)
    statement = select(School).order_by(School.id)
    if status_filter is not None:
        statement = statement.where(School.status == status_filter.strip().lower())
    if q is not None and q.strip():
        pattern = f"%{q.strip()}%"
        statement = statement.where(or_(School.name.ilike(pattern), School.region.ilike(pattern)))
    total = statement_count(db, statement)
    items = list(db.scalars(statement.offset(offset).limit(limit)).all())
    return AdminSchoolPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset(total, offset, len(items)),
    )


@router.get("/schools/{school_id}", response_model=SchoolRead)
def read_admin_school(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> School:
    require_admin(current_user)
    school = db.get(School, school_id)
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")
    return school


@router.patch("/schools/{school_id}", response_model=SchoolRead)
def patch_admin_school(
    school_id: int,
    payload: AdminSchoolUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> School:
    require_admin(current_user)
    return update_admin_school(
        db,
        school_id=school_id,
        payload=payload,
        actor=current_user,
        request=request,
    )


@router.get("/schools/{school_id}/stats", response_model=AdminSchoolStats)
def read_admin_school_stats(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminSchoolStats:
    school = require_school_teacher_or_admin(db, current_user, school_id)
    return build_school_stats(db, school)


@router.get("/classes", response_model=AdminClassPage)
def list_admin_classes(
    school_id: int | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=160),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminClassPage:
    require_admin(current_user)
    statement = select(ClassGroup).where(ClassGroup.kind == "homeroom").order_by(ClassGroup.id)
    if school_id is not None:
        statement = statement.where(ClassGroup.school_id == school_id)
    if status_filter is not None:
        statement = statement.where(ClassGroup.status == status_filter.strip().lower())
    if q is not None and q.strip():
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                ClassGroup.name.ilike(pattern),
                ClassGroup.grade.ilike(pattern),
                ClassGroup.term.ilike(pattern),
            )
        )
    total = statement_count(db, statement)
    items = list(db.scalars(statement.offset(offset).limit(limit)).all())
    return AdminClassPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset(total, offset, len(items)),
    )


@router.get("/classes/{class_id}", response_model=ClassRead)
def read_admin_class(
    class_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassGroup:
    require_admin(current_user)
    class_group = db.get(ClassGroup, class_id)
    if class_group is None or class_group.kind != "homeroom":
        raise HTTPException(status_code=404, detail="Class not found")
    return class_group


@router.patch("/classes/{class_id}", response_model=ClassRead)
def patch_admin_class(
    class_id: int,
    payload: AdminClassUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassGroup:
    require_admin(current_user)
    return update_admin_class(
        db,
        class_id=class_id,
        payload=payload,
        actor=current_user,
        request=request,
    )


@router.get("/classes/{class_id}/stats", response_model=AdminClassStats)
def read_admin_class_stats(
    class_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminClassStats:
    class_group = require_class_teacher_or_admin_by_id(db, current_user, class_id)
    return build_class_stats(db, class_group)


@router.get("/class-join-requests", response_model=AdminClassJoinRequestPage)
def list_admin_class_join_requests(
    school_id: int | None = Query(default=None),
    class_id: int | None = Query(default=None),
    user_id: int | None = Query(default=None),
    role: str | None = Query(default=None),
    status_filter: str | None = Query(default="pending", alias="status"),
    q: str | None = Query(default=None, max_length=160),
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminClassJoinRequestPage:
    require_admin(current_user)
    if from_at is not None and to_at is not None and from_at > to_at:
        raise HTTPException(status_code=422, detail="from must be earlier than to")
    statement = (
        select(ClassJoinRequest, School, ClassGroup, User)
        .join(School, School.id == ClassJoinRequest.school_id)
        .join(ClassGroup, ClassGroup.id == ClassJoinRequest.class_id)
        .join(User, User.id == ClassJoinRequest.user_id)
        .order_by(ClassJoinRequest.created_at.desc(), ClassJoinRequest.id.desc())
    )
    if school_id is not None:
        statement = statement.where(ClassJoinRequest.school_id == school_id)
    if class_id is not None:
        statement = statement.where(ClassJoinRequest.class_id == class_id)
    if user_id is not None:
        statement = statement.where(ClassJoinRequest.user_id == user_id)
    if role is not None:
        statement = statement.where(ClassJoinRequest.role == normalize_class_role(role))
    if status_filter is not None:
        statement = statement.where(ClassJoinRequest.status == normalize_join_request_status(status_filter))
    if from_at is not None:
        statement = statement.where(ClassJoinRequest.created_at >= from_at)
    if to_at is not None:
        statement = statement.where(ClassJoinRequest.created_at <= to_at)
    if q is not None and q.strip():
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                School.name.ilike(pattern),
                ClassGroup.name.ilike(pattern),
                User.username.ilike(pattern),
                User.display_name.ilike(pattern),
                ClassJoinRequest.message.ilike(pattern),
            )
        )
    total = statement_count(db, statement)
    rows = db.execute(statement.offset(offset).limit(limit)).all()
    items = [
        _admin_class_join_request_read(join_request, school, class_group, user)
        for join_request, school, class_group, user in rows
    ]
    return AdminClassJoinRequestPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset(total, offset, len(items)),
    )


@router.patch("/class-join-requests/{join_request_id}", response_model=AdminClassJoinRequestRead)
def review_admin_class_join_request(
    join_request_id: int,
    payload: AdminClassJoinRequestReview,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminClassJoinRequestRead:
    require_admin(current_user)
    row = db.execute(
        select(ClassJoinRequest, School, ClassGroup, User)
        .join(School, School.id == ClassJoinRequest.school_id)
        .join(ClassGroup, ClassGroup.id == ClassJoinRequest.class_id)
        .join(User, User.id == ClassJoinRequest.user_id)
        .where(ClassJoinRequest.id == join_request_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Class join request not found")

    join_request, school, class_group, applicant = row
    apply_class_join_request_review(
        db,
        join_request=join_request,
        reviewer=current_user,
        request=request,
        next_status=payload.status,
        note=payload.note,
        approval_source="admin_queue",
    )
    db.commit()
    db.refresh(join_request)
    return _admin_class_join_request_read(join_request, school, class_group, applicant)


def _admin_class_join_request_read(
    join_request: ClassJoinRequest,
    school: School,
    class_group: ClassGroup,
    applicant: User,
) -> AdminClassJoinRequestRead:
    return AdminClassJoinRequestRead(
        id=join_request.id,
        school_id=join_request.school_id,
        school_name=school.name,
        class_id=join_request.class_id,
        class_name=class_group.name,
        user_id=join_request.user_id,
        user_username=applicant.username,
        user_display_name=applicant.display_name,
        role=join_request.role,
        status=join_request.status,
        message=join_request.message,
        requested_by_user_id=join_request.requested_by_user_id,
        reviewed_by_user_id=join_request.reviewed_by_user_id,
        reviewed_at=join_request.reviewed_at,
        review_note=join_request.review_note,
        created_at=join_request.created_at,
        updated_at=join_request.updated_at,
    )
