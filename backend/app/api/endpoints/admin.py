from fastapi import APIRouter

from app.api.endpoints import (
    admin_catalogue,
    admin_alerts,
    admin_audit,
    admin_background_tasks,
    admin_content,
    admin_governance,
    admin_organizations,
    admin_overview,
    admin_snapshot_tasks,
    admin_users,
)


router = APIRouter()
router.include_router(admin_users.router)
router.include_router(admin_organizations.router)
router.include_router(admin_content.router)
router.include_router(admin_overview.router)
router.include_router(admin_snapshot_tasks.router)
router.include_router(admin_alerts.router)
router.include_router(admin_background_tasks.router)
router.include_router(admin_audit.router)
router.include_router(admin_governance.router)
router.include_router(admin_catalogue.router)
