from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models import ClassGroup, School, SchoolMembership, User
from app.schemas.school import ClassRead, SchoolCreate, SchoolRead
from app.services.audit import record_audit_log
from app.services.access_control import compatible_scope_roles, lock_scope_eligible_user, require_school_member
from app.services.security_control_locks import ADMIN_AUTHORITY_LOCK, acquire_security_control_lock
from app.services.text import require_trimmed_text


router = APIRouter()


@router.get("", response_model=list[SchoolRead])
def list_schools(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[School]:
    if current_user.role == "admin":
        return list(db.scalars(select(School).order_by(School.id)).all())
    statement = (
        select(School)
        .join(SchoolMembership, SchoolMembership.school_id == School.id)
        .where(
            SchoolMembership.user_id == current_user.id,
            SchoolMembership.role.in_(compatible_scope_roles(current_user.role)),
            SchoolMembership.status == "active",
        )
        .order_by(School.id)
    )
    return list(db.scalars(statement).all())


@router.post("", response_model=SchoolRead, status_code=status.HTTP_201_CREATED)
def create_school(
    payload: SchoolCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> School:
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    current_user = lock_scope_eligible_user(
        db,
        current_user.id,
        "teacher",
        detail="Only active admins or teachers can create schools",
        status_code=403,
    )
    if current_user.role != "admin" and not get_settings().legacy_local_bootstrap_allowed:
        raise HTTPException(status_code=403, detail="学校由管理员创建，教师请申请加入已有学校的班级。")
    name = require_trimmed_text(payload.name, "School name is required")
    existing = db.scalar(select(School).where(School.name == name))
    if existing is not None:
        raise HTTPException(status_code=409, detail="School already exists")

    school = School(name=name, region=(payload.region or "").strip() or None)
    db.add(school)
    db.flush()
    owner_role = "admin" if current_user.role == "admin" else "teacher"
    db.add(SchoolMembership(school_id=school.id, user_id=current_user.id, role=owner_role))
    db.flush()
    record_audit_log(
        db,
        actor=current_user,
        action="school.create",
        resource_type="school",
        resource_id=school.id,
        school_id=school.id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "name": school.name,
                "region": school.region,
                "status": school.status,
                "creator_membership_role": owner_role,
            }
        },
    )
    db.commit()
    db.refresh(school)
    return school


@router.get("/{school_id}/classes", response_model=list[ClassRead])
def list_school_classes(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ClassGroup]:
    require_school_member(db, current_user, school_id)
    return list(
        db.scalars(
            select(ClassGroup).where(ClassGroup.school_id == school_id).order_by(ClassGroup.id)
        ).all()
    )
