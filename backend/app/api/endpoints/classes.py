from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.models import ClassGroup, ClassJoinRequest, ClassMembership, SchoolMembership, User
from app.models.base import utc_now
from app.schemas.school import (
    ClassCreate,
    ClassMemberBatchStatusUpdate,
    ClassJoinPayload,
    ClassJoinRequestCreate,
    ClassJoinRequestRead,
    ClassJoinRequestReview,
    ClassMemberRead,
    ClassMemberPage,
    ClassMemberStatusUpdate,
    ClassStudentBatchImport,
    ClassStudentBatchImportRead,
    ClassStudentBatchImportResult,
    ClassStudentTransfer,
    ClassStudentTransferRead,
    ClassTeacherTransfer,
    ClassTeacherTransferRead,
    ClassRead,
    MembershipRead,
)
from app.services.audit import record_audit_log
from app.services.class_join_requests import (
    apply_class_join_request_review,
    ensure_class_membership,
    ensure_school_membership,
    existing_active_class_membership,
    normalize_class_role,
    normalize_join_request_status,
    trim_optional,
)
from app.services.access_control import (
    lock_active_class_for_write,
    lock_active_classes_for_write,
    lock_active_school_for_write,
    lock_scope_eligible_user,
    require_class_teacher_or_admin,
    require_school_member,
    require_school_role,
    visible_school_ids,
)
from app.services.security_control_locks import ADMIN_AUTHORITY_LOCK, acquire_security_control_lock
from app.services.admin_common import lock_active_admin
from app.services.pagination import list_legacy_rows, paged_endpoint_url
from app.services.text import require_trimmed_text
from app.services.users import normalize_username


router = APIRouter()


def _class_member_read(membership: ClassMembership, user: User) -> ClassMemberRead:
    return ClassMemberRead(
        id=membership.id,
        class_id=membership.class_id,
        user_id=user.id,
        username=user.username,
        display_name=user.display_name,
        user_status=user.status,
        role=membership.role,
        status=membership.status,
        created_at=membership.created_at,
        updated_at=membership.updated_at,
    )


def _active_teacher_count(db: Session, class_id: int) -> int:
    return len(_active_teacher_ids(db, class_id))


def _active_teacher_ids(db: Session, class_id: int) -> set[int]:
    return set(
        db.scalars(
            select(ClassMembership.id)
            .join(User, User.id == ClassMembership.user_id)
            .where(
                ClassMembership.class_id == class_id,
                ClassMembership.role == "teacher",
                ClassMembership.status == "active",
                User.role.in_(["admin", "teacher"]),
                User.status == "active",
            )
            .with_for_update()
        ).all()
    )


@router.get("", response_model=list[ClassRead])
def list_classes(
    school_id: int | None = Query(default=None),
    mine: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ClassGroup]:
    statement = select(ClassGroup).where(ClassGroup.kind == "homeroom").order_by(ClassGroup.id)
    if school_id is not None:
        require_school_member(db, current_user, school_id)
        statement = statement.where(ClassGroup.school_id == school_id)
    elif current_user.role != "admin":
        school_ids = visible_school_ids(db, current_user.id)
        if not school_ids:
            return []
        statement = statement.where(ClassGroup.school_id.in_(school_ids))
    if mine:
        statement = (
            statement.join(ClassMembership, ClassMembership.class_id == ClassGroup.id)
            .where(
                ClassMembership.user_id == current_user.id,
                ClassMembership.status == "active",
            )
        )
        if current_user.role in {"student", "teacher"}:
            statement = statement.where(ClassMembership.role == current_user.role)
        statement = statement.distinct()
    return list(db.scalars(statement).all())


@router.post("", response_model=ClassRead, status_code=status.HTTP_201_CREATED)
def create_class(
    payload: ClassCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassGroup:
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    lock_active_school_for_write(db, payload.school_id)
    current_user = lock_scope_eligible_user(
        db,
        current_user.id,
        "teacher",
        detail="Only active admins or teachers can create classes",
        status_code=403,
    )
    require_school_role(db, current_user, payload.school_id, {"admin", "teacher"})
    name = require_trimmed_text(payload.name, "Class name is required")
    existing = db.scalar(
        select(ClassGroup).where(
            ClassGroup.school_id == payload.school_id,
            ClassGroup.name == name,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Class already exists in this school")

    class_group = ClassGroup(
        school_id=payload.school_id,
        name=name,
        kind="homeroom",
        grade=(payload.grade or "").strip() or None,
        term=(payload.term or "").strip() or None,
    )
    db.add(class_group)
    db.flush()
    ensure_school_membership(db, payload.school_id, current_user.id, "teacher")
    ensure_class_membership(db, class_group.id, current_user.id, "teacher")
    record_audit_log(
        db,
        actor=current_user,
        action="class.create",
        resource_type="class",
        resource_id=class_group.id,
        school_id=class_group.school_id,
        class_id=class_group.id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "school_id": class_group.school_id,
                "name": class_group.name,
                "kind": class_group.kind,
                "grade": class_group.grade,
                "term": class_group.term,
                "status": class_group.status,
                "creator_membership_role": "teacher",
            }
        },
    )
    db.commit()
    db.refresh(class_group)
    return class_group


@router.post("/{class_id}/join", response_model=MembershipRead, status_code=status.HTTP_201_CREATED)
def join_class(
    class_id: int,
    payload: ClassJoinPayload,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassMembership:
    role = normalize_class_role(payload.role)
    if role == "teacher":
        acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    class_group = lock_active_class_for_write(db, class_id)
    if role == "teacher":
        current_user = lock_scope_eligible_user(
            db,
            current_user.id,
            "teacher",
            detail="Only active admins or teachers can join with teacher role",
            status_code=403,
        )
    if role == "teacher" and current_user.role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Only teachers can join with teacher role")
    if role == "teacher" and current_user.role != "admin":
        require_school_role(db, current_user, class_group.school_id, {"admin", "teacher"})
        raise HTTPException(status_code=403, detail="Teacher class join requires approval")

    ensure_school_membership(db, class_group.school_id, current_user.id, role)
    membership, membership_outcome = ensure_class_membership(db, class_group.id, current_user.id, role)
    membership_changed = membership_outcome != "unchanged"
    join_request = db.scalar(
        select(ClassJoinRequest).where(
            ClassJoinRequest.class_id == class_group.id,
            ClassJoinRequest.user_id == current_user.id,
            ClassJoinRequest.role == role,
            ClassJoinRequest.status == "pending",
        )
    )
    if join_request is not None:
        join_request.status = "approved"
        join_request.reviewed_by_user_id = current_user.id
        join_request.reviewed_at = utc_now()
        join_request.review_note = "approved by legacy direct join"
        record_audit_log(
            db,
            actor=current_user,
            action="class.join.request.approve",
            resource_type="class_join_request",
            resource_id=join_request.id,
            school_id=class_group.school_id,
            class_id=class_group.id,
            event_result="success",
            request=request,
            snapshot={
                "before": {
                    "status": "pending",
                },
                "after": {
                    "class_id": join_request.class_id,
                    "user_id": join_request.user_id,
                    "role": join_request.role,
                    "status": join_request.status,
                    "reviewed_by_user_id": join_request.reviewed_by_user_id,
                    "reviewer_role": current_user.role,
                    "approval_source": "legacy_direct_join",
                    "membership_created": membership_outcome == "created",
                    "membership_restored": membership_outcome == "restored",
                    "membership_outcome": membership_outcome,
                    "membership_id": membership.id,
                },
            },
        )
    if membership_changed:
        record_audit_log(
            db,
            actor=current_user,
            action="class.join",
            resource_type="class_membership",
            resource_id=membership.id,
            school_id=class_group.school_id,
            class_id=class_group.id,
            event_result="success",
            request=request,
            snapshot={
                "after": {
                    "class_id": membership.class_id,
                    "user_id": membership.user_id,
                    "role": membership.role,
                    "status": membership.status,
                    "outcome": membership_outcome,
                }
            },
        )
    db.commit()
    db.refresh(membership)
    return membership


@router.post("/{class_id}/teachers/transfer", response_model=ClassTeacherTransferRead)
def transfer_class_teacher(
    class_id: int,
    payload: ClassTeacherTransfer,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassTeacherTransferRead:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can transfer class teacher membership")
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    class_group = lock_active_class_for_write(db, class_id)
    current_user = lock_active_admin(db, current_user.id)

    source_row = db.execute(
        select(ClassMembership, User)
        .join(User, User.id == ClassMembership.user_id)
        .where(
            ClassMembership.id == payload.source_membership_id,
            ClassMembership.class_id == class_group.id,
            ClassMembership.role == "teacher",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()
    if source_row is None:
        raise HTTPException(status_code=404, detail="Source teacher membership not found")
    source_membership, source_user = source_row
    if source_membership.status != "active":
        raise HTTPException(status_code=409, detail="Source teacher membership is not active")
    if source_membership.user_id == payload.target_user_id:
        raise HTTPException(status_code=409, detail="Target teacher is already the source teacher")

    target_user = db.scalar(
        select(User)
        .where(User.id == payload.target_user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if target_user is None:
        raise HTTPException(status_code=404, detail="Target teacher not found")
    if target_user.status != "active" or target_user.role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Target teacher must be active same-school teacher/admin")
    target_school_membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == class_group.school_id,
            SchoolMembership.user_id == target_user.id,
            SchoolMembership.role.in_(["admin", "teacher"]),
            SchoolMembership.status == "active",
        )
    )
    if target_school_membership is None:
        raise HTTPException(status_code=403, detail="Target teacher must be active same-school teacher/admin")

    target_membership = db.scalar(
        select(ClassMembership).where(
            ClassMembership.class_id == class_group.id,
            ClassMembership.user_id == target_user.id,
            ClassMembership.role == "teacher",
        )
    )
    target_before = None
    target_created = False
    if target_membership is None:
        target_membership = ClassMembership(
            class_id=class_group.id,
            user_id=target_user.id,
            role="teacher",
            status="active",
        )
        db.add(target_membership)
        db.flush()
        target_created = True
    else:
        target_before = {
            "id": target_membership.id,
            "user_id": target_membership.user_id,
            "status": target_membership.status,
        }
        target_membership.status = "active"

    source_before = {
        "id": source_membership.id,
        "user_id": source_membership.user_id,
        "status": source_membership.status,
    }
    if payload.deactivate_source:
        source_membership.status = "inactive"

    record_audit_log(
        db,
        actor=current_user,
        action="class.teacher.transfer",
        resource_type="class_membership",
        resource_id=target_membership.id,
        school_id=class_group.school_id,
        class_id=class_group.id,
        event_result="success",
        request=request,
        snapshot={
            "before": {
                "source": source_before,
                "target": target_before,
            },
            "after": {
                "source": {
                    "id": source_membership.id,
                    "user_id": source_membership.user_id,
                    "status": source_membership.status,
                },
                "target": {
                    "id": target_membership.id,
                    "user_id": target_membership.user_id,
                    "status": target_membership.status,
                    "created": target_created,
                },
                "deactivate_source": payload.deactivate_source,
                "has_note": trim_optional(payload.note) is not None,
            },
        },
    )
    db.commit()
    db.refresh(source_membership)
    db.refresh(target_membership)
    return ClassTeacherTransferRead(
        source_membership=_class_member_read(source_membership, source_user),
        target_membership=_class_member_read(target_membership, target_user),
    )


@router.post(
    "/{class_id}/students/{membership_id}/transfer",
    response_model=ClassStudentTransferRead,
)
def transfer_class_student(
    class_id: int,
    membership_id: int,
    payload: ClassStudentTransfer,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassStudentTransferRead:
    source_class = db.get(ClassGroup, class_id)
    if source_class is None:
        raise HTTPException(status_code=404, detail="Source class not found")
    require_class_teacher_or_admin(
        db,
        current_user,
        source_class,
        detail="Student transfer requires source class teacher scope",
    )
    if payload.target_class_id == source_class.id:
        raise HTTPException(status_code=409, detail="Target class must differ from source class")

    target_class = db.get(ClassGroup, payload.target_class_id)
    if target_class is None:
        raise HTTPException(status_code=404, detail="Target class not found")
    if target_class.school_id != source_class.school_id:
        raise HTTPException(status_code=422, detail="Student transfer requires classes in the same school")
    require_class_teacher_or_admin(
        db,
        current_user,
        target_class,
        detail="Student transfer requires target class teacher scope",
    )
    source_class, target_class = lock_active_classes_for_write(
        db,
        [source_class.id, target_class.id],
    )

    source_row = db.execute(
        select(ClassMembership, User)
        .join(User, User.id == ClassMembership.user_id)
        .where(
            ClassMembership.id == membership_id,
            ClassMembership.class_id == source_class.id,
            ClassMembership.role == "student",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()
    if source_row is None:
        raise HTTPException(status_code=404, detail="Source student membership not found")
    source_membership, student = source_row
    school_membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == source_class.school_id,
            SchoolMembership.user_id == student.id,
            SchoolMembership.role == "student",
            SchoolMembership.status == "active",
        )
    )
    if student.status != "active" or student.role != "student" or school_membership is None:
        raise HTTPException(status_code=409, detail="Student must have an active same-school membership")

    target_membership = db.scalar(
        select(ClassMembership).where(
            ClassMembership.class_id == target_class.id,
            ClassMembership.user_id == student.id,
            ClassMembership.role == "student",
        )
    )
    if source_membership.status != "active":
        if target_membership is not None and target_membership.status == "active":
            return ClassStudentTransferRead(
                source_membership=_class_member_read(source_membership, student),
                target_membership=_class_member_read(target_membership, student),
                applied=False,
            )
        raise HTTPException(status_code=409, detail="Source student membership is not active")

    target_before = None
    target_created = False
    if target_membership is None:
        target_membership = ClassMembership(
            class_id=target_class.id,
            user_id=student.id,
            role="student",
            status="active",
        )
        db.add(target_membership)
        db.flush()
        target_created = True
    else:
        target_before = {
            "id": target_membership.id,
            "class_id": target_membership.class_id,
            "status": target_membership.status,
        }
        target_membership.status = "active"

    source_before = {
        "id": source_membership.id,
        "class_id": source_membership.class_id,
        "status": source_membership.status,
    }
    source_membership.status = "inactive"
    record_audit_log(
        db,
        actor=current_user,
        action="class.student.transfer",
        resource_type="class_membership",
        resource_id=source_membership.id,
        school_id=source_class.school_id,
        class_id=source_class.id,
        event_result="success",
        request=request,
        snapshot={
            "before": {
                "source": source_before,
                "target": target_before,
            },
            "after": {
                "source": {
                    "id": source_membership.id,
                    "class_id": source_membership.class_id,
                    "status": source_membership.status,
                },
                "target": {
                    "id": target_membership.id,
                    "class_id": target_membership.class_id,
                    "status": target_membership.status,
                    "created": target_created,
                },
                "user_id": student.id,
                "has_note": trim_optional(payload.note) is not None,
            },
        },
    )
    db.commit()
    db.refresh(source_membership)
    db.refresh(target_membership)
    return ClassStudentTransferRead(
        source_membership=_class_member_read(source_membership, student),
        target_membership=_class_member_read(target_membership, student),
        applied=True,
    )


@router.post(
    "/{class_id}/students/batch-import",
    response_model=ClassStudentBatchImportRead,
)
def batch_import_class_students(
    class_id: int,
    payload: ClassStudentBatchImport,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassStudentBatchImportRead:
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Student batch import requires class teacher scope",
    )
    class_group = lock_active_class_for_write(db, class_group.id)

    normalized_names = [normalize_username(item.username) for item in payload.items]
    lookup_names = {name for name in normalized_names if name}
    users = list(
        db.scalars(
            select(User)
            .where(User.normalized_username.in_(lookup_names))
            .order_by(User.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    ) if lookup_names else []
    user_by_name = {user.normalized_username: user for user in users}
    user_ids = [user.id for user in users]
    eligible_user_ids = set(
        db.scalars(
            select(SchoolMembership.user_id).where(
                SchoolMembership.school_id == class_group.school_id,
                SchoolMembership.user_id.in_(user_ids),
                SchoolMembership.role == "student",
                SchoolMembership.status == "active",
            )
        ).all()
    ) if user_ids else set()
    existing_memberships = list(
        db.scalars(
            select(ClassMembership).where(
                ClassMembership.class_id == class_group.id,
                ClassMembership.user_id.in_(user_ids),
                ClassMembership.role == "student",
            )
        ).all()
    ) if user_ids else []
    membership_by_user_id = {membership.user_id: membership for membership in existing_memberships}

    seen_names: set[str] = set()
    prepared_results: list[dict] = []
    audit_items: list[dict] = []
    counts = {"created": 0, "restored": 0, "unchanged": 0, "failed": 0}
    for index, (item, normalized_name) in enumerate(zip(payload.items, normalized_names, strict=True)):
        client_ref = trim_optional(item.client_ref)
        user = user_by_name.get(normalized_name)
        error_code = None
        if not normalized_name:
            error_code = "invalid_username"
        elif normalized_name in seen_names:
            error_code = "duplicate_item"
        elif (
            user is None
            or user.status != "active"
            or user.role != "student"
            or user.id not in eligible_user_ids
        ):
            error_code = "student_not_eligible"
        seen_names.add(normalized_name)

        if error_code is not None:
            counts["failed"] += 1
            prepared_results.append(
                {
                    "username": normalized_name,
                    "client_ref": client_ref,
                    "outcome": "failed",
                    "membership": None,
                    "error_code": error_code,
                }
            )
            audit_items.append(
                {
                    "index": index,
                    "client_ref": client_ref,
                    "outcome": "failed",
                    "error_code": error_code,
                }
            )
            continue

        membership = membership_by_user_id.get(user.id)
        previous_status = membership.status if membership is not None else None
        if membership is None:
            membership = ClassMembership(
                class_id=class_group.id,
                user_id=user.id,
                role="student",
                status="active",
            )
            db.add(membership)
            membership_by_user_id[user.id] = membership
            outcome = "created"
        elif membership.status == "inactive":
            membership.status = "active"
            outcome = "restored"
        else:
            outcome = "unchanged"
        counts[outcome] += 1
        prepared_results.append(
            {
                "username": normalized_name,
                "client_ref": client_ref,
                "outcome": outcome,
                "membership": membership,
                "user": user,
                "error_code": None,
            }
        )
        audit_items.append(
            {
                "index": index,
                "client_ref": client_ref,
                "user_id": user.id,
                "outcome": outcome,
                "previous_status": previous_status,
            }
        )

    db.flush()
    for audit_item, prepared in zip(audit_items, prepared_results, strict=True):
        membership = prepared.get("membership")
        if membership is not None:
            audit_item["membership_id"] = membership.id
    record_audit_log(
        db,
        actor=current_user,
        action="class.student.batch_import",
        resource_type="class_membership_batch",
        resource_id=class_group.id,
        school_id=class_group.school_id,
        class_id=class_group.id,
        event_result="success",
        request=request,
        snapshot={
            "items": audit_items,
            "item_count": len(payload.items),
            "created_count": counts["created"],
            "restored_count": counts["restored"],
            "unchanged_count": counts["unchanged"],
            "failed_count": counts["failed"],
            "partial_failure": 0 < counts["failed"] < len(payload.items),
        },
    )
    db.commit()

    results: list[ClassStudentBatchImportResult] = []
    for prepared in prepared_results:
        membership = prepared.get("membership")
        user = prepared.get("user")
        if membership is not None:
            db.refresh(membership)
        results.append(
            ClassStudentBatchImportResult(
                username=prepared["username"],
                client_ref=prepared["client_ref"],
                outcome=prepared["outcome"],
                membership=_class_member_read(membership, user) if membership is not None else None,
                error_code=prepared["error_code"],
            )
        )
    return ClassStudentBatchImportRead(
        items=results,
        created_count=counts["created"],
        restored_count=counts["restored"],
        unchanged_count=counts["unchanged"],
        failed_count=counts["failed"],
    )


@router.get("/{class_id}/members", response_model=list[ClassMemberRead], deprecated=True)
def list_class_members(
    class_id: int,
    role: str | None = Query(default=None, max_length=32),
    status_filter: str | None = Query(default="active", alias="status", max_length=32),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ClassMemberRead]:
    statement = _class_member_statement(
        db,
        class_id=class_id,
        role=role,
        status_filter=status_filter,
        current_user=current_user,
    )
    rows = list_legacy_rows(
        db,
        statement,
        paged_endpoint=paged_endpoint_url(
            f"/api/classes/{class_id}/members/page",
            role=role,
            status=status_filter,
            limit=200,
            offset=0,
        ),
    )
    return [_class_member_read(membership, user) for membership, user in rows]


@router.get("/{class_id}/members/page", response_model=ClassMemberPage)
def list_class_members_page(
    class_id: int,
    role: str | None = Query(default=None, max_length=32),
    status_filter: str | None = Query(default="active", alias="status", max_length=32),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassMemberPage:
    statement = _class_member_statement(
        db,
        class_id=class_id,
        role=role,
        status_filter=status_filter,
        current_user=current_user,
    )
    total = int(db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)
    rows = db.execute(statement.offset(offset).limit(limit)).all()
    items = [_class_member_read(membership, user) for membership, user in rows]
    next_offset = offset + len(items)
    return ClassMemberPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset if next_offset < total else None,
    )


def _class_member_statement(
    db: Session,
    *,
    class_id: int,
    role: str | None,
    status_filter: str | None,
    current_user: User,
):
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Class members require class teacher scope",
    )

    statement = (
        select(ClassMembership, User)
        .join(User, User.id == ClassMembership.user_id)
        .where(ClassMembership.class_id == class_group.id)
        .order_by(ClassMembership.role, User.username, ClassMembership.id)
    )
    if role is not None:
        statement = statement.where(ClassMembership.role == normalize_class_role(role))
    if status_filter is not None:
        membership_status = status_filter.strip().lower()
        if membership_status not in {"active", "inactive"}:
            raise HTTPException(status_code=400, detail="Unsupported class member status")
        statement = statement.where(ClassMembership.status == membership_status)

    return statement


@router.patch("/{class_id}/members/batch-status", response_model=list[ClassMemberRead])
def batch_update_class_member_status(
    class_id: int,
    payload: ClassMemberBatchStatusUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ClassMemberRead]:
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Class member updates require class teacher scope",
    )
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    class_group = lock_active_class_for_write(db, class_id)
    current_user = lock_scope_eligible_user(
        db,
        current_user.id,
        "teacher",
        detail="Class member updates require an active teacher/admin",
        status_code=403,
    )
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Class member updates require class teacher scope",
    )

    membership_ids = [item.membership_id for item in payload.items]
    if len(set(membership_ids)) != len(membership_ids):
        raise HTTPException(status_code=422, detail="Duplicate class membership in batch")

    rows = db.execute(
        select(ClassMembership, User)
        .join(User, User.id == ClassMembership.user_id)
        .where(
            ClassMembership.class_id == class_group.id,
            ClassMembership.id.in_(membership_ids),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    row_by_id = {membership.id: (membership, user) for membership, user in rows}
    missing_ids = [membership_id for membership_id in membership_ids if membership_id not in row_by_id]
    if missing_ids:
        raise HTTPException(status_code=404, detail="Class member not found")

    item_by_id = {item.membership_id: item for item in payload.items}
    if current_user.role != "admin":
        teacher_items = [
            membership_id
            for membership_id in membership_ids
            if row_by_id[membership_id][0].role != "student"
        ]
        if teacher_items:
            raise HTTPException(status_code=403, detail="Only admins can update teacher class membership")

    next_active_teacher_ids = _active_teacher_ids(db, class_group.id)
    for membership_id in membership_ids:
        membership, user = row_by_id[membership_id]
        next_status = item_by_id[membership_id].status
        if membership.role == "teacher":
            if next_status == "active":
                if user.status != "active" or user.role not in {"admin", "teacher"}:
                    raise HTTPException(status_code=409, detail="Teacher membership user is not eligible")
                next_active_teacher_ids.add(membership.id)
            else:
                next_active_teacher_ids.discard(membership.id)
    if not next_active_teacher_ids:
        raise HTTPException(status_code=409, detail="Cannot deactivate the last active class teacher")

    before: list[dict] = []
    after: list[dict] = []
    changed_count = 0
    note_count = 0
    for membership_id in membership_ids:
        membership, _ = row_by_id[membership_id]
        item = item_by_id[membership_id]
        note = trim_optional(item.note)
        if note is not None:
            note_count += 1
        before.append(
            {
                "membership_id": membership.id,
                "user_id": membership.user_id,
                "role": membership.role,
                "status": membership.status,
            }
        )
        if membership.status != item.status:
            membership.status = item.status
            changed_count += 1
        after.append(
            {
                "membership_id": membership.id,
                "user_id": membership.user_id,
                "role": membership.role,
                "status": membership.status,
                "has_note": note is not None,
            }
        )

    if changed_count:
        record_audit_log(
            db,
            actor=current_user,
            action="class.member.status.batch_update",
            resource_type="class_membership_batch",
            resource_id=class_group.id,
            school_id=class_group.school_id,
            class_id=class_group.id,
            event_result="success",
            request=request,
            snapshot={
                "before": before,
                "after": after,
                "item_count": len(payload.items),
                "changed_count": changed_count,
                "note_count": note_count,
            },
        )
        db.commit()
        for membership_id in membership_ids:
            db.refresh(row_by_id[membership_id][0])

    return [_class_member_read(*row_by_id[membership_id]) for membership_id in membership_ids]


@router.patch("/{class_id}/members/{membership_id}", response_model=ClassMemberRead)
def update_class_member_status(
    class_id: int,
    membership_id: int,
    payload: ClassMemberStatusUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassMemberRead:
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Class member updates require class teacher scope",
    )
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    class_group = lock_active_class_for_write(db, class_id)
    current_user = lock_scope_eligible_user(
        db,
        current_user.id,
        "teacher",
        detail="Class member updates require an active teacher/admin",
        status_code=403,
    )
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Class member updates require class teacher scope",
    )

    row = db.execute(
        select(ClassMembership, User)
        .join(User, User.id == ClassMembership.user_id)
        .where(
            ClassMembership.id == membership_id,
            ClassMembership.class_id == class_group.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Class member not found")

    membership, user = row
    if membership.role != "student" and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can update teacher class membership")

    previous_status = membership.status
    note = trim_optional(payload.note)
    if previous_status != payload.status:
        if (
            membership.role == "teacher"
            and payload.status == "active"
            and (user.status != "active" or user.role not in {"admin", "teacher"})
        ):
            raise HTTPException(status_code=409, detail="Teacher membership user is not eligible")
        if membership.role == "teacher" and previous_status == "active" and payload.status == "inactive":
            if _active_teacher_count(db, class_group.id) <= 1:
                raise HTTPException(status_code=409, detail="Cannot deactivate the last active class teacher")
        membership.status = payload.status
        record_audit_log(
            db,
            actor=current_user,
            action="class.member.status.update",
            resource_type="class_membership",
            resource_id=membership.id,
            school_id=class_group.school_id,
            class_id=class_group.id,
            event_result="success",
            request=request,
            snapshot={
                "before": {
                    "class_id": membership.class_id,
                    "user_id": membership.user_id,
                    "role": membership.role,
                    "status": previous_status,
                },
                "after": {
                    "class_id": membership.class_id,
                    "user_id": membership.user_id,
                    "role": membership.role,
                    "status": membership.status,
                    "has_note": note is not None,
                },
            },
        )
        db.commit()
        db.refresh(membership)
    return _class_member_read(membership, user)


@router.post(
    "/{class_id}/join-requests",
    response_model=ClassJoinRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def create_class_join_request(
    class_id: int,
    payload: ClassJoinRequestCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassJoinRequest:
    class_group = lock_active_class_for_write(db, class_id)

    role = normalize_class_role(payload.role)
    if role == "teacher" and current_user.role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Only teachers can request teacher role")

    if existing_active_class_membership(db, class_group.id, current_user.id, role) is not None:
        raise HTTPException(status_code=409, detail="Class membership already exists")

    join_request = db.scalar(
        select(ClassJoinRequest).where(
            ClassJoinRequest.class_id == class_group.id,
            ClassJoinRequest.user_id == current_user.id,
            ClassJoinRequest.role == role,
        )
    )
    if join_request is not None:
        if join_request.status == "pending":
            return join_request
        if join_request.status == "approved":
            raise HTTPException(status_code=409, detail="Class join request already approved")
        join_request.status = "pending"
        join_request.message = trim_optional(payload.message)
        join_request.requested_by_user_id = current_user.id
        join_request.reviewed_by_user_id = None
        join_request.reviewed_at = None
        join_request.review_note = None
    else:
        join_request = ClassJoinRequest(
            school_id=class_group.school_id,
            class_id=class_group.id,
            user_id=current_user.id,
            role=role,
            status="pending",
            message=trim_optional(payload.message),
            requested_by_user_id=current_user.id,
        )
        db.add(join_request)
        db.flush()

    record_audit_log(
        db,
        actor=current_user,
        action="class.join.request.create",
        resource_type="class_join_request",
        resource_id=join_request.id,
        school_id=class_group.school_id,
        class_id=class_group.id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "class_id": join_request.class_id,
                "user_id": join_request.user_id,
                "role": join_request.role,
                "status": join_request.status,
                "has_message": join_request.message is not None,
            }
        },
    )
    db.commit()
    db.refresh(join_request)
    return join_request
@router.get("/{class_id}/join-requests", response_model=list[ClassJoinRequestRead])
def list_class_join_requests(
    class_id: int,
    status_filter: str | None = Query(default="pending", alias="status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ClassJoinRequest]:
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Class review scope requires class teacher role",
    )

    statement = (
        select(ClassJoinRequest)
        .where(ClassJoinRequest.class_id == class_group.id)
        .order_by(ClassJoinRequest.id)
    )
    if status_filter is not None:
        statement = statement.where(ClassJoinRequest.status == normalize_join_request_status(status_filter))
    return list(db.scalars(statement).all())


@router.patch("/{class_id}/join-requests/{join_request_id}", response_model=ClassJoinRequestRead)
def review_class_join_request(
    class_id: int,
    join_request_id: int,
    payload: ClassJoinRequestReview,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClassJoinRequest:
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Class review scope requires class teacher role",
    )

    join_request = db.scalar(
        select(ClassJoinRequest).where(
            ClassJoinRequest.id == join_request_id,
            ClassJoinRequest.class_id == class_group.id,
        )
    )
    if join_request is None:
        raise HTTPException(status_code=404, detail="Class join request not found")

    apply_class_join_request_review(
        db,
        join_request=join_request,
        reviewer=current_user,
        request=request,
        next_status=payload.status,
        note=payload.note,
        approval_source="class_review",
    )
    db.commit()
    db.refresh(join_request)
    return join_request
