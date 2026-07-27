from fastapi import HTTPException
from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session

from app.models import (
    Assignment,
    ClassGroup,
    ClassMembership,
    Course,
    CourseClass,
    CourseCollaborator,
    CourseUnit,
    School,
    SchoolMembership,
    User,
)


def get_class(db: Session, class_id: int) -> ClassGroup:
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    return class_group


def get_course(db: Session, course_id: int) -> Course:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def lock_active_school_for_write(db: Session, school_id: int) -> School:
    school = db.scalar(
        select(School)
        .where(School.id == school_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")
    if school.status != "active":
        raise HTTPException(status_code=409, detail="School is not active")
    return school


def lock_course_for_write(db: Session, course_id: int) -> Course:
    """Lock a course in the global school -> course mutation order."""
    school_id = db.scalar(select(Course.school_id).where(Course.id == course_id))
    if school_id is None:
        raise HTTPException(status_code=404, detail="Course not found")
    lock_active_school_for_write(db, school_id)
    course = db.scalar(
        select(Course)
        .where(Course.id == course_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    if course.school_id != school_id:
        raise HTTPException(
            status_code=409,
            detail="Course organization changed during write",
        )
    return course


def lock_active_class_for_write(
    db: Session,
    class_id: int,
    *,
    expected_school_id: int | None = None,
) -> ClassGroup:
    school_id = expected_school_id
    if school_id is None:
        school_id = db.scalar(
            select(ClassGroup.school_id).where(ClassGroup.id == class_id)
        )
    if school_id is None:
        raise HTTPException(status_code=404, detail="Class not found")
    lock_active_school_for_write(db, school_id)
    class_group = db.scalar(
        select(ClassGroup)
        .where(ClassGroup.id == class_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if class_group.school_id != school_id:
        raise HTTPException(status_code=409, detail="Class organization changed during write")
    if class_group.status != "active":
        raise HTTPException(status_code=409, detail="Class is not active")
    return class_group


def lock_active_classes_for_write(db: Session, class_ids: list[int]) -> list[ClassGroup]:
    ordered_ids = sorted(set(class_ids))
    if not ordered_ids:
        return []
    scope_rows = db.execute(
        select(ClassGroup.id, ClassGroup.school_id).where(ClassGroup.id.in_(ordered_ids))
    ).all()
    school_by_class = {int(row.id): int(row.school_id) for row in scope_rows}
    if len(school_by_class) != len(ordered_ids):
        raise HTTPException(status_code=404, detail="Class not found")
    for school_id in sorted(set(school_by_class.values())):
        lock_active_school_for_write(db, school_id)
    locked = list(
        db.scalars(
            select(ClassGroup)
            .where(ClassGroup.id.in_(ordered_ids))
            .order_by(ClassGroup.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    )
    if len(locked) != len(ordered_ids):
        raise HTTPException(status_code=404, detail="Class not found")
    for class_group in locked:
        if class_group.school_id != school_by_class[class_group.id]:
            raise HTTPException(status_code=409, detail="Class organization changed during write")
        if class_group.status != "active":
            raise HTTPException(status_code=409, detail="Class is not active")
    by_id = {class_group.id: class_group for class_group in locked}
    return [by_id[class_id] for class_id in class_ids]


def visible_school_ids(db: Session, user_id: int) -> list[int]:
    return list(
        db.scalars(
            select(SchoolMembership.school_id)
            .join(User, User.id == SchoolMembership.user_id)
            .where(
                SchoolMembership.user_id == user_id,
                SchoolMembership.status == "active",
                User.status == "active",
                _membership_role_matches_global_role(SchoolMembership.role),
            )
        ).all()
    )


def teacher_school_ids(db: Session, user_id: int) -> list[int]:
    return list(
        db.scalars(
            select(SchoolMembership.school_id)
            .join(User, User.id == SchoolMembership.user_id)
            .where(
                SchoolMembership.user_id == user_id,
                SchoolMembership.role.in_(["admin", "teacher"]),
                SchoolMembership.status == "active",
                User.status == "active",
                User.role.in_(["admin", "teacher"]),
            )
        ).all()
    )


def visible_class_ids(db: Session, user_id: int) -> list[int]:
    return list(
        db.scalars(
            select(ClassMembership.class_id)
            .join(User, User.id == ClassMembership.user_id)
            .where(
                ClassMembership.user_id == user_id,
                ClassMembership.status == "active",
                User.status == "active",
                _membership_role_matches_global_role(ClassMembership.role),
            )
        ).all()
    )


def teacher_class_ids(db: Session, user_id: int) -> list[int]:
    return list(
        db.scalars(
            select(ClassMembership.class_id)
            .join(User, User.id == ClassMembership.user_id)
            .where(
                ClassMembership.user_id == user_id,
                ClassMembership.role == "teacher",
                ClassMembership.status == "active",
                User.status == "active",
                User.role.in_(["admin", "teacher"]),
            )
        ).all()
    )


def active_class_student_ids(db: Session, class_id: int) -> list[int]:
    return list(
        db.scalars(
            select(ClassMembership.user_id)
            .join(User, User.id == ClassMembership.user_id)
            .where(
                ClassMembership.class_id == class_id,
                ClassMembership.role == "student",
                ClassMembership.status == "active",
                User.role == "student",
                User.status == "active",
            )
        ).all()
    )


def user_assignment_class_ids(db: Session, user_id: int, class_id: int | None) -> list[int]:
    if class_id is not None:
        return [class_id]
    return visible_class_ids(db, user_id)


def active_assignment_class_ids(
    db: Session,
    user: User,
    course_id: int | None = None,
) -> list[int]:
    statement = (
        select(ClassGroup.id)
        .join(School, School.id == ClassGroup.school_id)
        .where(
            School.status == "active",
            ClassGroup.status == "active",
        )
    )
    if course_id is not None:
        statement = statement.join(CourseClass, CourseClass.class_id == ClassGroup.id).where(
            CourseClass.course_id == course_id,
            CourseClass.status == "active",
        )
    if user.role != "admin":
        statement = (
            statement.join(ClassMembership, ClassMembership.class_id == ClassGroup.id)
            .join(User, User.id == ClassMembership.user_id)
            .where(
                ClassMembership.user_id == user.id,
                ClassMembership.status == "active",
                User.status == "active",
                _membership_role_matches_global_role(ClassMembership.role),
            )
        )
    return list(db.scalars(statement.distinct().order_by(ClassGroup.id)).all())


def require_school_member(db: Session, user: User, school_id: int) -> None:
    if user.role == "admin":
        return
    membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == school_id,
            SchoolMembership.user_id == user.id,
            SchoolMembership.role.in_(compatible_scope_roles(user.role)),
            SchoolMembership.status == "active",
        )
    )
    if membership is None:
        raise HTTPException(status_code=403, detail="School is outside current user scope")


def require_school_role(
    db: Session,
    user: User,
    school_id: int,
    roles: set[str],
    *,
    detail: str = "School role is outside current user scope",
) -> None:
    if user.role == "admin":
        return
    compatible_roles = roles.intersection(compatible_scope_roles(user.role))
    if not compatible_roles:
        raise HTTPException(status_code=403, detail=detail)
    membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == school_id,
            SchoolMembership.user_id == user.id,
            SchoolMembership.role.in_(compatible_roles),
            SchoolMembership.status == "active",
        )
    )
    if membership is None:
        raise HTTPException(status_code=403, detail=detail)


def require_school_teacher_or_admin(
    db: Session,
    user: User,
    school_id: int,
    *,
    detail: str = "School statistics require school teacher scope",
) -> School:
    if user.role == "admin":
        school = db.get(School, school_id)
        if school is None:
            raise HTTPException(status_code=404, detail="School not found")
        return school
    if user.role != "teacher":
        raise HTTPException(status_code=403, detail=detail)
    school = db.scalar(
        select(School)
        .join(SchoolMembership, SchoolMembership.school_id == School.id)
        .where(
            School.id == school_id,
            SchoolMembership.user_id == user.id,
            SchoolMembership.role.in_(["admin", "teacher"]),
            SchoolMembership.status == "active",
        )
    )
    if school is None:
        raise HTTPException(status_code=403, detail=detail)
    return school


def require_class_member(db: Session, user: User, class_id: int) -> ClassGroup:
    class_group = get_class(db, class_id)
    if user.role == "admin":
        return class_group
    membership = db.scalar(
        select(ClassMembership).where(
            ClassMembership.class_id == class_id,
            ClassMembership.user_id == user.id,
            ClassMembership.role.in_(compatible_scope_roles(user.role)),
            ClassMembership.status == "active",
        )
    )
    if membership is None:
        raise HTTPException(status_code=403, detail="Class is outside current user scope")
    return class_group


def require_class_teacher_or_admin(
    db: Session,
    user: User,
    class_group: ClassGroup,
    *,
    detail: str = "Class statistics require teacher scope",
    locking_read: bool = False,
) -> None:
    if user.role == "admin":
        return
    if user.role != "teacher":
        raise HTTPException(status_code=403, detail=detail)
    statement = select(ClassMembership).where(
        ClassMembership.class_id == class_group.id,
        ClassMembership.user_id == user.id,
        ClassMembership.role == "teacher",
        ClassMembership.status == "active",
    )
    if locking_read:
        statement = statement.with_for_update()
    membership = db.scalar(statement)
    if membership is None:
        raise HTTPException(status_code=403, detail=detail)


def require_class_teacher_or_admin_by_id(
    db: Session,
    user: User,
    class_id: int,
    *,
    detail: str = "Class statistics require class teacher scope",
) -> ClassGroup:
    if user.role == "admin":
        return get_class(db, class_id)
    if user.role != "teacher":
        raise HTTPException(status_code=403, detail=detail)
    class_group = db.scalar(
        select(ClassGroup)
        .join(ClassMembership, ClassMembership.class_id == ClassGroup.id)
        .where(
            ClassGroup.id == class_id,
            ClassMembership.user_id == user.id,
            ClassMembership.role == "teacher",
            ClassMembership.status == "active",
        )
    )
    if class_group is None:
        raise HTTPException(status_code=403, detail=detail)
    return class_group


def require_course_author_or_admin(
    user: User,
    course: Course,
    *,
    detail: str = "Course author role is required",
) -> None:
    if user.role == "admin" or (user.role == "teacher" and course.creator_user_id == user.id):
        return
    raise HTTPException(status_code=403, detail=detail)


def require_course_editor_or_admin(
    db: Session,
    user: User,
    course: Course,
    *,
    detail: str = "Course editor role is required",
) -> None:
    require_course_collaborator_or_admin(
        db,
        user,
        course,
        {"editor"},
        detail=detail,
    )


def require_course_collaborator_or_admin(
    db: Session,
    user: User,
    course: Course,
    roles: set[str],
    *,
    detail: str = "Course collaborator role is required",
    locking_read: bool = False,
) -> None:
    if user.role == "admin" or (user.role == "teacher" and course.creator_user_id == user.id):
        return
    if user.role != "teacher":
        raise HTTPException(status_code=403, detail=detail)
    statement = select(CourseCollaborator).where(
        CourseCollaborator.course_id == course.id,
        CourseCollaborator.user_id == user.id,
        CourseCollaborator.role.in_(roles),
        CourseCollaborator.status == "active",
    )
    if locking_read:
        statement = statement.with_for_update()
    collaborator = db.scalar(statement)
    if collaborator is not None:
        return
    raise HTTPException(status_code=403, detail=detail)


def require_course_visible(db: Session, user: User, course_id: int) -> Course:
    course = get_course(db, course_id)
    if user.role == "admin":
        return course
    compatible_school_roles = compatible_scope_roles(user.role).intersection({"admin", "teacher"})
    school_membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == course.school_id,
            SchoolMembership.user_id == user.id,
            SchoolMembership.role.in_(compatible_school_roles),
            SchoolMembership.status == "active",
        )
    )
    if school_membership is not None:
        return course
    class_ids = visible_class_ids(db, user.id)
    if class_ids:
        course_class = db.scalar(
            select(CourseClass).where(
                CourseClass.course_id == course.id,
                CourseClass.class_id.in_(class_ids),
                CourseClass.status == "active",
            )
        )
        if course_class is not None:
            require_student_course_published(user, course)
            return course
    raise HTTPException(status_code=403, detail="Course is outside current user scope")


def require_course_scope(
    db: Session,
    user: User,
    class_group: ClassGroup | None,
    course_id: int,
) -> Course:
    course = get_course(db, course_id)
    if class_group is not None:
        if class_group.school_id != course.school_id:
            raise HTTPException(status_code=422, detail="Class does not belong to course school")
        if not course_attached_to_class(db, course.id, class_group.id):
            raise HTTPException(status_code=403, detail="Course is not attached to this class")
        require_student_course_published(user, course)
        return course
    return require_course_visible(db, user, course_id)


def course_attached_to_class(db: Session, course_id: int, class_id: int) -> bool:
    return (
        db.scalar(
            select(CourseClass).where(
                CourseClass.course_id == course_id,
                CourseClass.class_id == class_id,
                CourseClass.status == "active",
            )
        )
        is not None
    )


def require_student_course_published(user: User, course: Course) -> None:
    if user.role == "student" and course.status != "published":
        raise HTTPException(status_code=403, detail="Course is not published")


def require_student_unit_published(user: User, unit: CourseUnit) -> None:
    if user.role == "student" and unit.status != "published":
        raise HTTPException(status_code=403, detail="Course unit is not published")


def require_student_assignment_active(user: User, assignment: Assignment) -> None:
    if user.role == "student" and assignment.status != "active":
        raise HTTPException(status_code=409, detail="Assignment is not active")


def deactivate_incompatible_authority_rows(db: Session, user: User) -> dict[str, int]:
    compatible_roles = compatible_scope_roles(user.role)
    school_result = db.execute(
        update(SchoolMembership)
        .where(
            SchoolMembership.user_id == user.id,
            SchoolMembership.status == "active",
            ~SchoolMembership.role.in_(compatible_roles),
        )
        .values(status="inactive")
    )
    class_result = db.execute(
        update(ClassMembership)
        .where(
            ClassMembership.user_id == user.id,
            ClassMembership.status == "active",
            ~ClassMembership.role.in_(compatible_roles),
        )
        .values(status="inactive")
    )
    collaborator_count = 0
    if user.role not in {"admin", "teacher"}:
        collaborator_result = db.execute(
            update(CourseCollaborator)
            .where(
                CourseCollaborator.user_id == user.id,
                CourseCollaborator.status == "active",
            )
            .values(status="inactive")
        )
        collaborator_count = int(collaborator_result.rowcount or 0)
    return {
        "school_memberships": int(school_result.rowcount or 0),
        "class_memberships": int(class_result.rowcount or 0),
        "course_collaborators": collaborator_count,
    }


def lock_scope_eligible_user(
    db: Session,
    user_id: int,
    scope_role: str,
    *,
    detail: str = "Membership user is no longer eligible",
    status_code: int = 409,
) -> User:
    compatible_global_roles = {"student"} if scope_role == "student" else {"admin", "teacher"}
    user = db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or user.status != "active" or user.role not in compatible_global_roles:
        raise HTTPException(status_code=status_code, detail=detail)
    return user


def compatible_scope_roles(global_role: str) -> set[str]:
    if global_role == "student":
        return {"student"}
    if global_role == "teacher":
        return {"admin", "teacher"}
    if global_role == "admin":
        return {"admin", "teacher", "student"}
    return set()


def _membership_role_matches_global_role(role_column):
    return or_(
        and_(User.role == "student", role_column == "student"),
        and_(User.role == "teacher", role_column.in_(["admin", "teacher"])),
        and_(User.role == "admin", role_column.in_(["admin", "teacher", "student"])),
    )
