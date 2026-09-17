"""Translate service failures at the HTTP boundary and roll back failed commands."""
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import LearningEvidenceError
from app.services.content_platform import ContentPlatformError
from app.services.course_completion import CourseCompletionError


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
