from fastapi import APIRouter

from app.api.endpoints import (
    admin,
    assignment_policies,
    auth,
    classes,
    code_judge,
    content,
    courses,
    health,
    knowledge,
    learning_evidence,
    learning_events,
    points,
    progress,
    render,
    schools,
    submissions,
    users,
)


api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(schools.router, prefix="/schools", tags=["schools"])
api_router.include_router(classes.router, prefix="/classes", tags=["classes"])
api_router.include_router(code_judge.router, tags=["code-judge"])
api_router.include_router(courses.router, prefix="/courses", tags=["courses"])
api_router.include_router(assignment_policies.router, tags=["assignments"])
api_router.include_router(knowledge.router, tags=["knowledge"])
api_router.include_router(learning_evidence.router, prefix="/learning-evidence", tags=["learning-evidence"])
api_router.include_router(learning_events.router, prefix="/learning-events", tags=["learning-events"])
api_router.include_router(submissions.router, tags=["submissions"])
api_router.include_router(points.router, prefix="/points", tags=["points"])
api_router.include_router(progress.router, prefix="/progress", tags=["progress"])
api_router.include_router(content.router, prefix="/content", tags=["content"])
api_router.include_router(render.router, prefix="/render", tags=["render"])
