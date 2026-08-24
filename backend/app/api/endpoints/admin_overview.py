from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models import (
    AuditLog,
    Assignment,
    BugRecord,
    ClassGroup,
    ClassJoinRequest,
    ContentDraft,
    ContentPageRecord,
    ContentPageVersion,
    Course,
    LearningEvent,
    PointLedger,
    School,
    Submission,
    User,
)
from app.schemas.admin import AdminStats
from app.services.admin_common import count_rows, require_admin
from app.services.audit import record_audit_log
from app.services.backend_performance import build_backend_performance_report


router = APIRouter()


@router.get("/stats", response_model=AdminStats)
def read_admin_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminStats:
    require_admin(current_user)
    users_by_role = {
        str(role): int(count)
        for role, count in db.execute(select(User.role, func.count()).group_by(User.role)).all()
    }
    return AdminStats(
        total_users=count_rows(db, User),
        active_users=count_rows(db, User, User.status == "active"),
        users_by_role=users_by_role,
        total_schools=count_rows(db, School),
        total_classes=count_rows(db, ClassGroup, ClassGroup.kind == "homeroom"),
        pending_class_join_requests=count_rows(db, ClassJoinRequest, ClassJoinRequest.status == "pending"),
        total_content_pages=count_rows(db, ContentPageRecord),
        total_content_drafts=count_rows(db, ContentDraft),
        total_content_page_versions=count_rows(db, ContentPageVersion),
        pending_script_reviews=count_rows(db, ContentDraft, ContentDraft.script_review_status == "pending"),
        total_courses=count_rows(db, Course),
        total_assignments=count_rows(db, Assignment),
        total_learning_events=count_rows(db, LearningEvent),
        total_submissions=count_rows(db, Submission),
        total_point_ledger_entries=count_rows(db, PointLedger),
        total_bug_records=count_rows(db, BugRecord),
        open_bug_records=count_rows(db, BugRecord, BugRecord.status != "closed"),
        total_audit_logs=count_rows(db, AuditLog),
    )


@router.get("/performance/report")
def get_backend_performance_report(
    request: Request,
    include_explain: bool = Query(default=True),
    include_benchmark: bool = Query(default=True),
    require_mysql: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    require_admin(current_user)
    report = build_backend_performance_report(
        db,
        settings=get_settings(),
        include_explain=include_explain,
        include_benchmark=include_benchmark,
        require_mysql=require_mysql,
    )
    record_audit_log(
        db,
        actor=current_user,
        action="admin.performance.report",
        resource_type="backend_performance",
        event_result="success" if report["ok"] else "failure",
        failure_reason=None if report["ok"] else report["status"],
        request=request,
        snapshot={
            "status": report["status"],
            "dialect": report["dialect"],
            "require_mysql": require_mysql,
            "include_explain": include_explain,
            "include_benchmark": include_benchmark,
            "summary": report["summary"],
            "deferred_risk_codes": [item["code"] for item in report["deferred_risks"]],
            "sql_text_returned": False,
            "database_url_returned": False,
        },
    )
    db.commit()
    return report
