from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ClassGroup, CourseClass, User
from app.services.access_control import (
    get_course, require_course_collaborator_or_admin, require_school_role,
)


def active_teaching_classes(db: Session, actor: User, course_id: int) -> list[ClassGroup]:
    course = get_course(db, course_id)
    require_school_role(db, actor, course.school_id, {"admin", "teacher"})
    require_course_collaborator_or_admin(
        db, actor, course, {"editor", "content_editor", "assessment_editor", "viewer"}
    )
    return list(db.scalars(
        select(ClassGroup)
        .join(CourseClass, CourseClass.class_id == ClassGroup.id)
        .where(CourseClass.course_id == course.id, CourseClass.status == "active")
        .order_by(ClassGroup.id)
    ).all())
