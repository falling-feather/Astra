"""Initialize the synthetic Astra local-preview demo through public HTTP APIs.

The script is intentionally an orchestration boundary.  It does not import
models, SQLAlchemy, Alembic internals, or application services and it never
writes the database except through the existing API routes.
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import getpass
from hashlib import sha256
import json
import os
import re
import secrets
import string
from typing import Any, Awaitable, Callable, Mapping
from urllib.parse import urlsplit

from httpx import ASGITransport, AsyncClient, Response

from scripts.demo_evidence_profiles import (
    DEMO_FIXTURE_PROVENANCE,
    DEMO_TEACHER_CORRECTION_REASON,
    build_demo_evidence_payload,
)
from scripts.demo_data_manifest import (
    DEMO_ADMIN_USERNAME,
    DEMO_ASSIGNMENTS,
    DEMO_CLASS_GRADE,
    DEMO_CLASS_NAME,
    DEMO_CLASS_TERM,
    DEMO_COURSES,
    DEMO_CODE_PROBLEM,
    DEMO_EVIDENCE_EVENT_TYPES,
    DEMO_OPEN_STUDENT_USERNAME,
    DEMO_PEER_TEACHER_USERNAME,
    DEMO_PENDING_TEACHER_USERNAME,
    DEMO_SCHOOL_NAME,
    DEMO_SCHOOL_REGION,
    DEMO_STUDENT_USERNAME,
    DEMO_TEACHER_USERNAME,
    DEMO_V84_ASSIGNMENTS,
    DEMO_V84_OPEN_COURSE,
    DEMO_V84_RESTRICTED_COURSE,
    COURSE_BY_KEY,
    REPRESENTATIVE_BY_COURSE,
    UNIT_BY_ACTIVITY_KEY,
)


class DemoInitializationError(RuntimeError):
    """Raised when the demo contract cannot be satisfied without guessing."""


@dataclass(frozen=True)
class Actor:
    username: str
    user_id: int
    role: str
    token: str

    @property
    def headers(self) -> dict[str, str]:
        # The API auth dependency intentionally rejects mixed channels.  The
        # empty Cookie header prevents httpx's login cookie from being reused.
        return {"Authorization": f"Bearer {self.token}", "Cookie": ""}


@dataclass(frozen=True)
class DemoContext:
    admin: Actor
    teacher: Actor
    student: Actor
    school_id: int
    class_id: int
    courses: dict[str, dict[str, Any]]
    units: dict[str, dict[str, Any]]
    plans: dict[str, dict[str, Any]]
    rules: dict[str, dict[str, Any]]


_SAFE_DETAIL_CODES = frozenset(
    {
        "admin_bootstrap_complete",
        "username_already_exists",
        "course_class_missing",
        "course_not_found",
        "forbidden",
        "not_found",
        "conflict",
        "validation_error",
        "stale_version",
    }
)
_SAFE_DETAIL_TYPES = frozenset({"about:blank", "validation_error", "conflict", "forbidden", "not_found"})


def _response_detail(response: Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return "response was not JSON"
    if not isinstance(payload, dict):
        return "JSON error payload did not contain an object"
    detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else payload
    safe_parts: list[str] = []
    code = detail.get("code") if isinstance(detail, dict) else None
    detail_type = detail.get("type") if isinstance(detail, dict) else None
    if code in _SAFE_DETAIL_CODES:
        safe_parts.append(f"code={code}")
    if detail_type in _SAFE_DETAIL_TYPES:
        safe_parts.append(f"type={detail_type}")
    # Never include message, rejected input, arbitrary locations, or unknown
    # JSON values.  A caller can still act on the HTTP status and finite codes.
    return "; ".join(safe_parts) or "API request failed"


def _has_exact_detail(response: Response, expected: str) -> bool:
    try:
        payload = response.json()
    except ValueError:
        return False
    return isinstance(payload, dict) and payload.get("detail") == expected


def _require_status(response: Response, expected: int | tuple[int, ...], operation: str) -> Any:
    expected_codes = (expected,) if isinstance(expected, int) else expected
    if response.status_code not in expected_codes:
        raise DemoInitializationError(
            f"{operation} failed with HTTP {response.status_code}: {_response_detail(response)}"
        )
    try:
        return response.json()
    except ValueError as exc:
        raise DemoInitializationError(f"{operation} returned a non-JSON response") from exc


def _is_expected_missing_attachment(response: Response) -> bool:
    return response.status_code == 403 and _has_exact_detail(response, "Course is not attached to this class")


def _password_strength() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*_-+="
    return "Astra-" + "".join(secrets.choice(alphabet) for _ in range(32))


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _stable_event_payload(event_type: str, representative: Any, activity_key: str, index: int) -> dict[str, Any]:
    profile = representative.evidence_profile
    if profile.activity_key != activity_key:
        raise DemoInitializationError(f"demo evidence profile scope drifted for {activity_key}")
    try:
        return build_demo_evidence_payload(profile, event_type, index)
    except ValueError as exc:
        raise DemoInitializationError(str(exc)) from exc


def _stable_event_time(base_time: datetime, event_type: str, index: int, attempt_count: int) -> str:
    if event_type == "started":
        offset = 1
    elif event_type == "predicted":
        offset = 2
    elif event_type == "attempted":
        offset = 2 + index
    elif event_type == "corrected":
        offset = 3 + attempt_count
    elif event_type == "explained":
        offset = 5 + attempt_count
    else:
        raise DemoInitializationError(f"unsupported demo evidence event type: {event_type}")
    return _iso(base_time + timedelta(minutes=offset))


def _expected_code_problem_spec_hash() -> str:
    canonical = {
        "statement_markdown": DEMO_CODE_PROBLEM["statement_markdown"],
        "test_spec": {"cases": list(DEMO_CODE_PROBLEM["test_cases"])},
        "language_allowlist": list(DEMO_CODE_PROBLEM["language_allowlist"]),
        "resource_policy": DEMO_CODE_PROBLEM["resource_policy"],
        "source_max_bytes": DEMO_CODE_PROBLEM["source_max_bytes"],
        "input_max_bytes": DEMO_CODE_PROBLEM["input_max_bytes"],
        "output_max_bytes": DEMO_CODE_PROBLEM["output_max_bytes"],
    }
    serialized = json.dumps(canonical, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return sha256(serialized.encode("utf-8")).hexdigest()


def _rule_signature(activities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "activity_key": item["activity_key"],
            "outcome": item.get("outcome", "completed"),
            "preset": item.get("preset"),
            "checkpoint_key": item.get("checkpoint_key"),
            "assignment_id": item.get("assignment_id"),
            "required_event_types": sorted(item.get("required_event_types", [])),
            "minimum_attempts": item.get("minimum_attempts", 0),
            "minimum_correct_attempts": item.get("minimum_correct_attempts", 0),
        }
        for item in sorted(activities, key=lambda value: value["activity_key"])
    ]


def _expected_rule_definition_sha256(activities: list[dict[str, Any]]) -> str:
    definition = {
        "schema_version": 1,
        # The API normalizes required_event_types before persisting the
        # definition; hash the same canonical shape used by the service.
        "activities": _rule_signature(activities),
    }
    serialized = json.dumps(definition, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return sha256(serialized.encode("utf-8")).hexdigest()


def _expected_rule_activities(course_key: str) -> list[dict[str, Any]]:
    representative = REPRESENTATIVE_BY_COURSE.get(course_key)
    activities = []
    for activity_key, (declared_course_key, _) in UNIT_BY_ACTIVITY_KEY.items():
        if declared_course_key != course_key:
            continue
        minimum_attempts = 1
        if representative is not None and activity_key == representative.open_unit_key:
            minimum_attempts = representative.minimum_attempts
        activities.append(
            {
                "activity_key": activity_key,
                "outcome": "completed",
                "required_event_types": [
                    event_type for event_type in DEMO_EVIDENCE_EVENT_TYPES if event_type != "attempted"
                ],
                "minimum_attempts": minimum_attempts,
                "minimum_correct_attempts": 0,
            }
        )
    return activities


def _validate_local_environment() -> None:
    if os.environ.get("ASTRA_ENVIRONMENT") != "development":
        raise DemoInitializationError("demo initialization is limited to local development")
    database_url = os.environ.get("ASTRA_DATABASE_URL", "")
    if not database_url.lower().startswith("sqlite"):
        raise DemoInitializationError("demo initialization requires a local SQLite database")
    if not os.environ.get("ASTRA_LOCAL_PREVIEW_INSTANCE_ID"):
        raise DemoInitializationError("demo initialization requires the astra-local launcher instance marker")
    origins = [item.strip() for item in os.environ.get("ASTRA_CORS_ORIGINS", "").split(",") if item.strip()]
    if len(origins) != 1 or not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}", origins[0], re.IGNORECASE):
        raise DemoInitializationError("demo initialization requires a 127.0.0.1 local-preview origin")
    parsed = urlsplit(database_url)
    sqlite_path = parsed.path.replace("\\", "/")
    if parsed.netloc or sqlite_path.startswith("//"):
        raise DemoInitializationError("demo initialization rejects UNC or remote data directories")


class DemoApi:
    def __init__(self) -> None:
        self.client: AsyncClient | None = None

    async def __aenter__(self) -> "DemoApi":
        _validate_local_environment()
        from app.main import create_app

        self.client = AsyncClient(
            transport=ASGITransport(app=create_app()),
            base_url="http://astra-local",
            timeout=30.0,
        )
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        if self.client is not None:
            await self.client.aclose()
            self.client = None

    async def request(
        self,
        method: str,
        path: str,
        *,
        actor: Actor | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> Response:
        if self.client is None:
            raise DemoInitializationError("demo API client is not open")
        headers = actor.headers if actor is not None else {"Cookie": ""}
        return await self.client.request(method, path, headers=headers, json=json_payload)

    async def get(self, path: str, actor: Actor) -> Response:
        return await self.request("GET", path, actor=actor)

    async def post(self, path: str, actor: Actor | None, payload: dict[str, Any]) -> Response:
        return await self.request("POST", path, actor=actor, json_payload=payload)

    async def patch(self, path: str, actor: Actor, payload: dict[str, Any]) -> Response:
        return await self.request("PATCH", path, actor=actor, json_payload=payload)

    async def login(self, username: str, password: str, expected_role: str, expected_display_name: str) -> Actor:
        actor = await self.login_any_role(
            username,
            password,
            allowed_roles={expected_role},
            expected_display_name=expected_display_name,
        )
        if actor.role != expected_role:
            raise DemoInitializationError(f"login {username} returned an unexpected role or token")
        return actor

    async def login_any_role(
        self,
        username: str,
        password: str,
        *,
        allowed_roles: set[str],
        expected_display_name: str,
    ) -> Actor:
        response = await self.post("/api/auth/login", None, {"username": username, "password": password})
        payload = _require_status(response, 200, f"login {username}")
        # Do not let the HttpOnly response cookie leak into later Bearer calls.
        if self.client is not None:
            self.client.cookies.clear()
        token = payload.get("access_token")
        user = payload.get("user") or {}
        role = user.get("role")
        if not isinstance(token, str) or not token or role not in allowed_roles:
            raise DemoInitializationError(f"login {username} returned an unexpected role or token")
        actor = Actor(username, int(user["id"]), str(role), token)
        me_response = await self.get("/api/users/me", actor)
        me = _require_status(me_response, 200, f"verify identity {username}")
        if (
            me.get("username") != username
            or me.get("role") != role
            or me.get("display_name") != expected_display_name
        ):
            raise DemoInitializationError(f"verified identity drifted for {username}")
        return Actor(username, int(me["id"]), str(role), token)


async def _ensure_actor(
    api: DemoApi,
    *,
    username: str,
    display_name: str,
    role: str,
    credentials: Mapping[str, str],
    prompt_password: Callable[[str], str] | None,
    display_new_credentials: bool,
    credential_banner: list[bool],
) -> Actor:
    candidate = credentials.get(username) or _password_strength()
    if role == "admin":
        response = await api.post(
            "/api/admin/bootstrap",
            None,
            {"username": username, "password": candidate, "display_name": display_name},
        )
        if response.status_code == 201:
            if display_new_credentials:
                if not credential_banner[0]:
                    print("Astra local demo credentials (shown once; synthetic only):", flush=True)
                    credential_banner[0] = True
                print(f"{username}: {candidate}", flush=True)
        elif response.status_code == 409 and _has_exact_detail(response, "Admin bootstrap is already complete"):
            candidate = _existing_password(username, credentials, prompt_password)
        else:
            raise DemoInitializationError(f"bootstrap {username} failed with HTTP {response.status_code}: {_response_detail(response)}")
    else:
        response = await api.post(
            "/api/auth/register",
            None,
            {"username": username, "password": candidate, "display_name": display_name, "role": role},
        )
        if response.status_code == 201:
            if display_new_credentials:
                if not credential_banner[0]:
                    print("Astra local demo credentials (shown once; synthetic only):", flush=True)
                    credential_banner[0] = True
                print(f"{username}: {candidate}", flush=True)
        elif response.status_code == 409 and _has_exact_detail(response, "Username already exists"):
            candidate = _existing_password(username, credentials, prompt_password)
        else:
            raise DemoInitializationError(f"register {username} failed with HTTP {response.status_code}: {_response_detail(response)}")
    return await api.login(username, candidate, role, display_name)


async def _ensure_student_origin_actor(
    api: DemoApi,
    *,
    username: str,
    display_name: str,
    credentials: Mapping[str, str],
    prompt_password: Callable[[str], str] | None,
    display_new_credentials: bool,
    credential_banner: list[bool],
) -> tuple[Actor, str]:
    """Create an application-based identity without bypassing teacher review."""

    candidate = credentials.get(username) or _password_strength()
    response = await api.post(
        "/api/auth/register",
        None,
        {
            "username": username,
            "password": candidate,
            "display_name": display_name,
            "role": "student",
        },
    )
    if response.status_code == 201:
        if display_new_credentials:
            if not credential_banner[0]:
                print("Astra local demo credentials (shown once; synthetic only):", flush=True)
                credential_banner[0] = True
            print(f"{username}: {candidate}", flush=True)
    elif response.status_code == 409 and _has_exact_detail(response, "Username already exists"):
        candidate = _existing_password(username, credentials, prompt_password)
    else:
        raise DemoInitializationError(
            f"register {username} failed with HTTP {response.status_code}: {_response_detail(response)}"
        )
    actor = await api.login_any_role(
        username,
        candidate,
        allowed_roles={"student", "teacher"},
        expected_display_name=display_name,
    )
    return actor, candidate


async def _ensure_pending_teacher_application(api: DemoApi, applicant: Actor) -> dict[str, Any]:
    if applicant.role != "student":
        raise DemoInitializationError("pending demo teacher applicant role drifted")
    current = _require_status(
        await api.get("/api/v1/teacher-applications/me", applicant),
        200,
        "read pending demo teacher application",
    )
    expected_message = "申请演示教师身份，用于管理员待办队列展示。"
    if current is None:
        current = _require_status(
            await api.post(
                "/api/v1/teacher-applications",
                applicant,
                {"message": expected_message},
            ),
            201,
            "create pending demo teacher application",
        )
    if (
        current.get("status") != "pending"
        or current.get("user_id") != applicant.user_id
        or current.get("message") != expected_message
        or current.get("applicant_role") != "student"
    ):
        raise DemoInitializationError("pending demo teacher application drifted")
    return current


async def _ensure_peer_teacher_application(
    api: DemoApi,
    *,
    actor: Actor,
    password: str,
    admin: Actor,
    display_name: str,
) -> tuple[Actor, dict[str, Any]]:
    current = _require_status(
        await api.get("/api/v1/teacher-applications/me", actor),
        200,
        "read peer demo teacher application",
    )
    expected_message = "申请成为共同授课教师。"
    if actor.role == "teacher":
        if (
            current is None
            or current.get("status") != "approved"
            or current.get("applicant_role") != "teacher"
            or current.get("message") != expected_message
        ):
            raise DemoInitializationError("peer demo teacher approval history drifted")
        return actor, current
    if actor.role != "student":
        raise DemoInitializationError("peer demo teacher role drifted")
    if current is None:
        current = _require_status(
            await api.post(
                "/api/v1/teacher-applications",
                actor,
                {"message": expected_message},
            ),
            201,
            "create peer demo teacher application",
        )
    if current.get("status") == "pending":
        current = _require_status(
            await api.patch(
                f"/api/v1/admin/teacher-applications/{current['id']}",
                admin,
                {"status": "approved", "note": "演示身份核验通过。"},
            ),
            200,
            "approve peer demo teacher application",
        )
    if current.get("status") != "approved" or current.get("applicant_role") != "teacher":
        raise DemoInitializationError("peer demo teacher application was not approved")
    promoted = await api.login(
        actor.username,
        password,
        "teacher",
        display_name,
    )
    return promoted, current


def _existing_password(
    username: str,
    credentials: Mapping[str, str],
    prompt_password: Callable[[str], str] | None,
) -> str:
    if username in credentials:
        return credentials[username]
    if prompt_password is None:
        raise DemoInitializationError(f"existing demo account {username} requires an interactive password")
    password = prompt_password(username)
    if not password:
        raise DemoInitializationError(f"empty password supplied for existing demo account {username}")
    return password


async def _ensure_school(api: DemoApi, teacher: Actor) -> int:
    response = await api.get("/api/schools", teacher)
    schools = _require_status(response, 200, "list demo schools")
    matching = [item for item in schools if item.get("name") == DEMO_SCHOOL_NAME]
    if len(matching) > 1:
        raise DemoInitializationError("demo school natural key is duplicated")
    existing = matching[0] if matching else None
    if existing is not None:
        if existing.get("region") != DEMO_SCHOOL_REGION or existing.get("status") != "active":
            raise DemoInitializationError("demo school fields drifted")
        return int(existing["id"])
    created = await api.post(
        "/api/schools",
        teacher,
        {"name": DEMO_SCHOOL_NAME, "region": DEMO_SCHOOL_REGION},
    )
    payload = _require_status(created, 201, "create demo school")
    return int(payload["id"])


async def _ensure_class(api: DemoApi, teacher: Actor, school_id: int) -> int:
    response = await api.get(f"/api/classes?school_id={school_id}", teacher)
    classes = _require_status(response, 200, "list demo classes")
    matching = [item for item in classes if item.get("name") == DEMO_CLASS_NAME]
    if len(matching) > 1:
        raise DemoInitializationError("demo class natural key is duplicated")
    existing = matching[0] if matching else None
    if existing is not None:
        if (
            existing.get("school_id") != school_id
            or existing.get("grade") != DEMO_CLASS_GRADE
            or existing.get("term") != DEMO_CLASS_TERM
            or existing.get("status") != "active"
        ):
            raise DemoInitializationError("demo class fields drifted")
        return int(existing["id"])
    created = await api.post(
        "/api/classes",
        teacher,
        {
            "school_id": school_id,
            "name": DEMO_CLASS_NAME,
            "grade": DEMO_CLASS_GRADE,
            "term": DEMO_CLASS_TERM,
        },
    )
    payload = _require_status(created, 201, "create demo class")
    return int(payload["id"])


async def _ensure_student_membership(api: DemoApi, teacher: Actor, student: Actor, class_id: int) -> None:
    response = await api.get(f"/api/classes/{class_id}/members", teacher)
    members = _require_status(response, 200, "list demo class members")
    existing = next((item for item in members if item.get("user_id") == student.user_id), None)
    if existing is not None:
        if existing.get("role") != "student" or existing.get("status") != "active":
            raise DemoInitializationError("demo student membership drifted")
        return
    joined = await api.post(f"/api/classes/{class_id}/join", student, {"role": "student"})
    _require_status(joined, 201, "join demo student to class")


async def _ensure_peer_teacher_membership(
    api: DemoApi,
    *,
    class_teacher: Actor,
    peer_teacher: Actor,
    class_id: int,
) -> dict[str, Any]:
    members = _require_status(
        await api.get(f"/api/classes/{class_id}/members", class_teacher),
        200,
        "list demo class teachers",
    )
    existing = next((item for item in members if item.get("user_id") == peer_teacher.user_id), None)
    if existing is None:
        requested = _require_status(
            await api.post(
                f"/api/classes/{class_id}/join-requests",
                peer_teacher,
                {"role": "teacher", "message": "申请加入演示班级共同授课。"},
            ),
            201,
            "request first demo school teacher membership",
        )
        if requested.get("status") == "pending":
            _require_status(
                await api.patch(
                    f"/api/classes/{class_id}/join-requests/{requested['id']}",
                    class_teacher,
                    {"status": "approved", "note": "加入共同授课团队。"},
                ),
                200,
                "approve first demo school teacher membership",
            )
        members = _require_status(
            await api.get(f"/api/classes/{class_id}/members", class_teacher),
            200,
            "verify demo class teachers",
        )
        existing = next((item for item in members if item.get("user_id") == peer_teacher.user_id), None)
    if existing is None or existing.get("role") != "teacher" or existing.get("status") != "active":
        raise DemoInitializationError("peer demo teacher membership drifted")
    return existing


async def _verify_no_homeroom(api: DemoApi, student: Actor) -> None:
    classes = _require_status(
        await api.get("/api/classes?mine=true", student),
        200,
        "verify no-homeroom demo student",
    )
    if classes:
        raise DemoInitializationError("no-homeroom demo student unexpectedly belongs to an administrative class")


def _expected_release_mode(course_key: str, activity_key: str) -> str:
    representative = REPRESENTATIVE_BY_COURSE.get(course_key)
    if representative is None or activity_key == representative.open_unit_key:
        return "open"
    if activity_key == representative.locked_unit_key:
        return "locked"
    return "hidden"


async def _preflight_existing_course(
    api: DemoApi,
    teacher: Actor,
    class_id: int,
    course: dict[str, Any],
    spec: Any,
) -> None:
    course_key = spec.course_key
    units_response = await api.get(f"/api/courses/{course['id']}/units", teacher)
    units = _require_status(units_response, 200, f"preflight units for {course_key}")
    expected_units = {unit.activity_key: unit for unit in spec.units}
    if len(units) != len(expected_units) or {item.get("activity_key") for item in units} != set(expected_units):
        raise DemoInitializationError(f"existing course units drifted for {course_key}")
    units_by_key = {item["activity_key"]: item for item in units}
    for activity_key, unit_spec in expected_units.items():
        unit = units_by_key[activity_key]
        if (
            unit.get("course_id") != course["id"]
            or unit.get("title") != unit_spec.title
            or unit.get("position") != list(expected_units).index(activity_key) + 1
            or unit.get("content_slug") != unit_spec.content_slug
            or unit.get("status") != "published"
        ):
            raise DemoInitializationError(f"existing course unit fields drifted for {activity_key}")

    plan_response = await api.get(
        f"/api/courses/{course['id']}/classes/{class_id}/release-plan",
        teacher,
    )
    plan = _require_status(plan_response, 200, f"preflight release plan for {course_key}")
    if (
        plan.get("course_id") != course["id"]
        or plan.get("class_id") != class_id
        or not isinstance(plan.get("course_class_id"), int)
        or not isinstance(plan.get("plan_version"), int)
    ):
        raise DemoInitializationError(f"existing release plan identity drifted for {course_key}")
    items = plan.get("items")
    if not isinstance(items, list) or len(items) != len(units_by_key):
        raise DemoInitializationError(f"existing release plan is incomplete for {course_key}")
    items_by_key = {item.get("activity_key"): item for item in items}
    if set(items_by_key) != set(units_by_key):
        raise DemoInitializationError(f"existing release plan activity keys drifted for {course_key}")
    for activity_key, item in items_by_key.items():
        unit = units_by_key[activity_key]
        if (
            item.get("course_unit_id") != unit["id"]
            or item.get("position") != unit["position"]
            or item.get("release_mode") != _expected_release_mode(course_key, activity_key)
        ):
            raise DemoInitializationError(f"existing release plan drifted for {course_key}")

    expected_activities = _expected_rule_activities(course_key)
    expected_signature = _rule_signature(expected_activities)
    expected_definition_sha256 = _expected_rule_definition_sha256(expected_activities)
    rules_response = await api.get(f"/api/learning-evidence/rules?course_id={course['id']}", teacher)
    rules = _require_status(rules_response, 200, f"preflight evidence rules for {course_key}")
    if not rules:
        raise DemoInitializationError(f"evidence rule is missing for existing course {course_key}")
    exact_rules = [rule for rule in rules if _rule_signature(rule.get("activities", [])) == expected_signature]
    if (
        len(rules) != 1
        or len(exact_rules) != 1
        or exact_rules[0].get("course_id") != course["id"]
        or exact_rules[0].get("schema_version") != 1
        or exact_rules[0].get("version_number") != 1
        or exact_rules[0].get("definition_sha256") != expected_definition_sha256
        or exact_rules[0].get("status") not in {"draft", "active"}
    ):
        raise DemoInitializationError(f"existing evidence rule drifted for {course_key}")
    rule = exact_rules[0]

    activation_response = await api.get(
        f"/api/learning-evidence/rules/activation?course_id={course['id']}",
        teacher,
    )
    activation = _require_status(activation_response, 200, f"preflight evidence activation for {course_key}")
    bindings = activation.get("bindings")
    active_rule = activation.get("active_rule")
    if (
        not isinstance(bindings, list)
        or len(bindings) != 1
        or not isinstance(active_rule, dict)
        or active_rule.get("id") != rule["id"]
        or active_rule.get("status") != "active"
        or active_rule.get("version_number") != rule["version_number"]
        or active_rule.get("definition_sha256") != expected_definition_sha256
        or bindings[0].get("class_id") != class_id
        or bindings[0].get("rule_id") != rule["id"]
        or bindings[0].get("rule_version") != rule["version_number"]
        or bindings[0].get("plan_version") != plan["plan_version"]
    ):
        raise DemoInitializationError(f"existing evidence rule activation or binding drifted for {course_key}")


async def _ensure_catalog(
    api: DemoApi,
    teacher: Actor,
    school_id: int,
    class_id: int,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    response = await api.get(f"/api/courses?school_id={school_id}", teacher)
    courses = _require_status(response, 200, "list demo courses")
    duplicate_course_keys = [key for key in {item.get("course_key") for item in courses} if sum(item.get("course_key") == key for item in courses) > 1]
    if duplicate_course_keys:
        raise DemoInitializationError("demo course natural keys are duplicated")
    course_by_key = {item.get("course_key"): item for item in courses}
    # Existing courses are an authoritative boundary.  Validate the complete
    # course/unit/plan/rule/activation/binding chain before creating any
    # missing catalog objects, so a partial/external course cannot cause
    # later seed writes.
    for existing in courses:
        course_key = existing.get("course_key")
        if course_key not in COURSE_BY_KEY:
            continue
        if existing.get("status") != "published":
            raise DemoInitializationError(f"demo course status drifted for {course_key}")
        await _preflight_existing_course(api, teacher, class_id, existing, COURSE_BY_KEY[course_key])
    result_courses: dict[str, dict[str, Any]] = {}
    result_units: dict[str, dict[str, Any]] = {}
    for spec in DEMO_COURSES:
        expected_status = "draft" if spec.course_key == "engineering-systems" else "published"
        course = course_by_key.get(spec.course_key)
        fresh_course = False
        if course is None:
            fresh_course = True
            created = await api.post(
                "/api/courses",
                teacher,
                {
                    "school_id": school_id,
                    "galaxy_key": spec.galaxy_key,
                    "course_key": spec.course_key,
                    "title": spec.title,
                    "summary": spec.summary,
                    "status": expected_status,
                },
            )
            course = _require_status(created, 201, f"create demo course {spec.course_key}")
        elif (
            course.get("school_id") != school_id
            or course.get("galaxy_key") != spec.galaxy_key
            or course.get("course_key") != spec.course_key
            or course.get("title") != spec.title
            or course.get("summary") != spec.summary
            or course.get("status") != "published"
        ):
            raise DemoInitializationError(f"demo course fields drifted for {spec.course_key}")
        course = {**course, "_demo_fresh": fresh_course}
        result_courses[spec.course_key] = course

        unit_response = await api.get(f"/api/courses/{course['id']}/units", teacher)
        units = _require_status(unit_response, 200, f"list units for {spec.course_key}")
        duplicate_activity_keys = [key for key in {item.get("activity_key") for item in units} if sum(item.get("activity_key") == key for item in units) > 1]
        if duplicate_activity_keys:
            raise DemoInitializationError(f"demo unit natural keys are duplicated for {spec.course_key}")
        unit_by_key = {item.get("activity_key"): item for item in units}
        for position, unit_spec in enumerate(spec.units, start=1):
            unit = unit_by_key.get(unit_spec.activity_key)
            if unit is None:
                created_unit = await api.post(
                    f"/api/courses/{course['id']}/units",
                    teacher,
                    {
                        "activity_key": unit_spec.activity_key,
                        "title": unit_spec.title,
                        "position": position,
                        "content_slug": unit_spec.content_slug,
                        "status": "published",
                    },
                )
                unit = _require_status(created_unit, 201, f"create demo unit {unit_spec.activity_key}")
            elif (
                unit.get("course_id") != course["id"]
                or unit.get("activity_key") != unit_spec.activity_key
                or unit.get("title") != unit_spec.title
                or unit.get("position") != position
                or unit.get("content_slug") != unit_spec.content_slug
                or unit.get("status") != "published"
            ):
                raise DemoInitializationError(f"demo unit fields drifted for {unit_spec.activity_key}")
            result_units[unit_spec.activity_key] = unit
    if len(result_courses) != 14 or len(result_units) != 42:
        raise DemoInitializationError("demo catalog did not produce exactly 14 courses and 42 units")
    return result_courses, result_units


async def _publish_courses(api: DemoApi, admin: Actor, teacher: Actor, school_id: int, courses: dict[str, dict[str, Any]]) -> None:
    for course_key, course in courses.items():
        if course_key == "engineering-systems":
            continue
        status = course.get("status")
        if status != "published":
            raise DemoInitializationError(f"unsupported demo course status for {course_key}: {status}")

    refreshed = _require_status(
        await api.get(f"/api/courses?school_id={school_id}", teacher),
        200,
        "verify published demo courses",
    )
    refreshed_by_key = {item.get("course_key"): item for item in refreshed}
    for course_key in courses:
        current_course = courses[course_key]
        if course_key == "engineering-systems":
            if refreshed_by_key.get(course_key, {}).get("status") not in {"draft", "published"}:
                raise DemoInitializationError("engineering-systems status drifted before ordered publish")
            courses[course_key] = {**refreshed_by_key[course_key], "_demo_fresh": current_course.get("_demo_fresh", False)}
            continue
        if refreshed_by_key.get(course_key, {}).get("status") != "published":
            raise DemoInitializationError(f"demo course {course_key} was not published")
        courses[course_key] = {**refreshed_by_key[course_key], "_demo_fresh": current_course.get("_demo_fresh", False)}


def _expected_engineering_status_snapshot(course: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": course["id"],
        "school_id": course["school_id"],
        "creator_user_id": course["creator_user_id"],
        "galaxy_key": "future-galaxy",
        "course_key": "engineering-systems",
        "title": course["title"],
        "summary": course["summary"],
    }


def _assert_engineering_status_audit(items: list[dict[str, Any]], course: dict[str, Any]) -> dict[str, Any]:
    if len(items) != 1:
        raise DemoInitializationError("engineering-systems must have exactly one status patch audit")
    snapshot = items[0].get("snapshot_json")
    expected_before = {**_expected_engineering_status_snapshot(course), "status": "draft"}
    expected_after = {**_expected_engineering_status_snapshot(course), "status": "published"}
    expected_impact = {
        "attached_class_count": 1,
        "course_unit_count": 3,
        "assignment_count": 0,
    }
    if not isinstance(snapshot, dict) or snapshot.get("before") != expected_before or snapshot.get("after") != expected_after:
        raise DemoInitializationError("engineering-systems status audit before/after drifted")
    if snapshot.get("reason") != "Publish engineering-systems after release plan and rule activation.":
        raise DemoInitializationError("engineering-systems status audit reason drifted")
    if snapshot.get("impact") != expected_impact:
        raise DemoInitializationError("engineering-systems status audit impact drifted")
    return snapshot


async def _publish_engineering_course(
    api: DemoApi,
    admin: Actor,
    teacher: Actor,
    school_id: int,
    course: dict[str, Any],
) -> dict[str, Any]:
    if course.get("status") == "published":
        audit_response = await api.get(
            f"/api/admin/audit-logs?action=course.status.patch&resource_id={course['id']}&limit=100&offset=0",
            admin,
        )
        audits = _require_status(audit_response, 200, "read engineering status audit")
        snapshot = _assert_engineering_status_audit(audits.get("items", []), course)
    elif course.get("status") == "draft":
        patched = await api.patch(
            f"/api/courses/{course['id']}/status",
            admin,
            {
                "expected_status": "draft",
                "status": "published",
                "reason": "Publish engineering-systems after release plan and rule activation.",
            },
        )
        payload = _require_status(patched, 200, "publish engineering-systems after rule activation")
        if payload.get("impact") != {
            "attached_class_count": 1,
            "course_unit_count": 3,
            "assignment_count": 0,
        }:
            raise DemoInitializationError("engineering-systems publish impact was not exact")
        audit_response = await api.get(
            f"/api/admin/audit-logs?action=course.status.patch&resource_id={course['id']}&limit=100&offset=0",
            admin,
        )
        audits = _require_status(audit_response, 200, "read engineering status audit")
        snapshot = _assert_engineering_status_audit(audits.get("items", []), course)
    else:
        raise DemoInitializationError("engineering-systems status drifted before CAS publish")

    refreshed = _require_status(
        await api.get(f"/api/courses?school_id={school_id}", teacher),
        200,
        "authoritatively reread engineering-systems after publish",
    )
    authoritative = next((item for item in refreshed if item.get("course_key") == "engineering-systems"), None)
    if authoritative is None or authoritative.get("status") != "published":
        raise DemoInitializationError("engineering-systems was not authoritatively published")
    fresh_course = course.get("_demo_fresh", False)
    course.clear()
    course.update(authoritative)
    course["_demo_fresh"] = fresh_course
    return snapshot


async def _ensure_attachment_and_plan(
    api: DemoApi,
    teacher: Actor,
    class_id: int,
    courses: dict[str, dict[str, Any]],
    units: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    plans: dict[str, dict[str, Any]] = {}
    for course_key, course in courses.items():
        plan_path = f"/api/courses/{course['id']}/classes/{class_id}/release-plan"
        plan_response = await api.get(plan_path, teacher)
        fresh_attachment = False
        if _is_expected_missing_attachment(plan_response):
            attached = await api.post(f"/api/courses/{course['id']}/classes", teacher, {"class_id": class_id})
            _require_status(attached, 201, f"attach demo course {course_key}")
            fresh_attachment = True
            plan_response = await api.get(plan_path, teacher)
        plan = _require_status(plan_response, 200, f"read release plan for {course_key}")
        if (
            plan.get("course_id") != course["id"]
            or plan.get("class_id") != class_id
            or not isinstance(plan.get("course_class_id"), int)
            or not isinstance(plan.get("plan_version"), int)
        ):
            raise DemoInitializationError(f"release plan identity drifted for {course_key}")
        items = {item["activity_key"]: item for item in plan["items"]}
        course_units = [unit for unit in units.values() if unit["course_id"] == course["id"]]
        if set(items) != {unit["activity_key"] for unit in course_units}:
            raise DemoInitializationError(f"release plan is incomplete for {course_key}")
        for activity_key, item in items.items():
            unit = units[activity_key]
            if (
                item.get("course_unit_id") != unit["id"]
                or item.get("activity_key") != activity_key
                or item.get("position") != unit["position"]
            ):
                raise DemoInitializationError(f"release plan item identity drifted for {activity_key}")

        representative = REPRESENTATIVE_BY_COURSE.get(course_key)
        desired = {
            unit["activity_key"]: (
                "open"
                if representative is None or unit["activity_key"] == representative.open_unit_key
                else "locked"
                if unit["activity_key"] == representative.locked_unit_key
                else "hidden"
            )
            for unit in course_units
        }
        current = {activity_key: item["release_mode"] for activity_key, item in items.items()}
        if current != desired:
            # Only the plan created by the attachment in this invocation may
            # transition from its known all-open fresh state.  An existing
            # plan that was edited externally is drift, never repairable seed.
            if not fresh_attachment or set(current.values()) != {"open"}:
                raise DemoInitializationError(f"release plan drifted for {course_key}")
            patch_items = [
                {"course_unit_id": units[activity_key]["id"], "release_mode": release_mode}
                for activity_key, release_mode in desired.items()
                if current[activity_key] != release_mode
            ]
            patched = await api.patch(
                plan_path,
                teacher,
                {"expected_version": plan["plan_version"], "items": patch_items, "reason": "Set the local demo release matrix."},
            )
            plan = _require_status(patched, 200, f"set release plan for {course_key}")
        plans[course_key] = plan
    return plans


async def _ensure_rules(
    api: DemoApi,
    teacher: Actor,
    class_id: int,
    courses: dict[str, dict[str, Any]],
    plans: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    rules: dict[str, dict[str, Any]] = {}
    for course_key, course in courses.items():
        expected_activities = _expected_rule_activities(course_key)
        expected_signature = _rule_signature(expected_activities)
        expected_definition_sha256 = _expected_rule_definition_sha256(expected_activities)
        response = await api.get(f"/api/learning-evidence/rules?course_id={course['id']}", teacher)
        existing = _require_status(response, 200, f"list evidence rules for {course_key}")
        exact = [rule for rule in existing if _rule_signature(rule.get("activities", [])) == expected_signature]
        if len(exact) > 1:
            raise DemoInitializationError(f"duplicate matching evidence rules for {course_key}")
        fresh_rule = bool(course.get("_demo_fresh"))
        if exact:
            rule = exact[0]
            if (
                rule.get("course_id") != course["id"]
                or rule.get("schema_version") != 1
                or rule.get("definition_sha256") != expected_definition_sha256
                or rule.get("status") not in {"draft", "active"}
            ):
                raise DemoInitializationError(f"evidence rule stable fields drifted for {course_key}")
        elif existing:
            raise DemoInitializationError(f"evidence rule definition drifted for {course_key}")
        else:
            if not fresh_rule:
                raise DemoInitializationError(f"evidence rule is missing for existing course {course_key}")
            created = await api.post(
                "/api/learning-evidence/rules",
                teacher,
                {"course_id": course["id"], "activities": expected_activities},
            )
            rule = _require_status(created, 201, f"create evidence rule for {course_key}")

        activation_response = await api.get(
            f"/api/learning-evidence/rules/activation?course_id={course['id']}",
            teacher,
        )
        activation = _require_status(activation_response, 200, f"read evidence activation for {course_key}")
        active_rule = activation.get("active_rule")
        binding_is_current = any(
            binding.get("class_id") == class_id
            and binding.get("rule_id") == rule["id"]
            and binding.get("binding_plan_version") == plans[course_key]["plan_version"]
            for binding in activation.get("bindings", [])
        )
        if active_rule is not None and _rule_signature(active_rule.get("activities", [])) != expected_signature:
            raise DemoInitializationError(f"active evidence rule drifted for {course_key}")
        if active_rule is None or active_rule.get("id") != rule["id"] or not binding_is_current:
            if not fresh_rule:
                raise DemoInitializationError(f"evidence rule activation or binding drifted for {course_key}")
            activated = await api.post(
                f"/api/learning-evidence/rules/{rule['id']}/activate",
                teacher,
                {
                    "expected_revision": activation["revision"],
                    "class_bindings": [{"class_id": class_id, "expected_plan_version": plans[course_key]["plan_version"]}],
                },
            )
            _require_status(activated, 200, f"activate evidence rule for {course_key}")
        rules[course_key] = rule
    return rules


async def _teacher_events(
    api: DemoApi,
    teacher: Actor,
    student_id: int,
    class_id: int,
    course_id: int,
    activity_key: str,
) -> list[dict[str, Any]]:
    response = await api.get(
        f"/api/learning-evidence/classes/{class_id}/courses/{course_id}/events?subject_user_id={student_id}&activity_key={activity_key}&limit=100&offset=0",
        teacher,
    )
    return _require_status(response, 200, f"read evidence events for {activity_key}")["items"]


async def _ensure_representative_evidence(
    api: DemoApi,
    teacher: Actor,
    student: Actor,
    class_id: int,
    courses: dict[str, dict[str, Any]],
    units: dict[str, dict[str, Any]],
    rules: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    evidence_summary: dict[str, dict[str, Any]] = {}
    base_time = datetime(2026, 7, 1, 9, 0, tzinfo=UTC)
    for course_key, representative in REPRESENTATIVE_BY_COURSE.items():
        course = courses[course_key]
        activity_key = representative.open_unit_key
        unit = units[activity_key]
        rule = rules[course_key]
        attempt_count = representative.minimum_attempts + 1
        event_counts = {event_type: (attempt_count if event_type == "attempted" else 1) for event_type in DEMO_EVIDENCE_EVENT_TYPES}
        payload_fingerprints: dict[str, list[str]] = {event_type: [] for event_type in DEMO_EVIDENCE_EVENT_TYPES}

        async def post_learner_event(event_type: str, index: int) -> None:
            payload = _stable_event_payload(event_type, representative, activity_key, index)
            client_event_id = f"demo:{activity_key}:{event_type}:{index}"
            created = await api.post(
                "/api/learning-evidence/events",
                student,
                {
                    "client_event_id": client_event_id,
                    "class_id": class_id,
                    "course_id": course["id"],
                    "course_unit_id": unit["id"],
                    "activity_key": activity_key,
                    "rule_version": rule["version_number"],
                    "event_type": event_type,
                    "evidence": payload,
                    "occurred_at": _stable_event_time(base_time, event_type, index, attempt_count),
                },
            )
            receipt = _require_status(created, (200, 201), f"replay {event_type} evidence for {activity_key}")
            if (
                receipt.get("client_event_id") != client_event_id
                or receipt.get("event_type") != event_type
                or receipt.get("outcome") not in {"accepted", "duplicate"}
            ):
                raise DemoInitializationError(f"evidence replay identity drifted for {client_event_id}")
            payload_fingerprints[event_type].append(
                sha256(json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
            )

        await post_learner_event("started", 1)
        await post_learner_event("predicted", 1)
        for index in range(1, attempt_count + 1):
            await post_learner_event("attempted", index)
        await post_learner_event("corrected", 1)

        events = await _teacher_events(api, teacher, student.user_id, class_id, course["id"], activity_key)
        actual_counts = {event_type: sum(item.get("event_type") == event_type for item in events) for event_type in DEMO_EVIDENCE_EVENT_TYPES}
        if any(actual_counts[event_type] != event_counts[event_type] for event_type in DEMO_EVIDENCE_EVENT_TYPES if event_type != "explained") or actual_counts["explained"] not in {0, 1}:
            raise DemoInitializationError(f"evidence fact counts drifted for {activity_key}: expected={event_counts}, actual={actual_counts}")

        attempts = sorted(
            [item for item in events if item.get("event_type") == "attempted"],
            key=lambda item: (item.get("occurred_at", ""), item.get("event_id", 0)),
        )
        corrected_attempts = [item for item in attempts if item.get("corrected_by_event_id") is not None]
        if len(corrected_attempts) > 1:
            raise DemoInitializationError(f"{activity_key} has more than one teacher correction")
        target = corrected_attempts[0] if corrected_attempts else attempts[0]
        correction = await api.post(
            f"/api/learning-evidence/events/{target['event_id']}/corrections",
            teacher,
            {
                "client_event_id": f"demo:{activity_key}:teacher-correction:1",
                "reason": DEMO_TEACHER_CORRECTION_REASON,
                "occurred_at": _iso(base_time + timedelta(minutes=4 + attempt_count)),
            },
        )
        correction_receipt = _require_status(correction, (200, 201), f"replay teacher correction for {activity_key}")
        if correction_receipt.get("client_event_id") != f"demo:{activity_key}:teacher-correction:1":
            raise DemoInitializationError(f"teacher correction identity drifted for {activity_key}")
        await post_learner_event("explained", 1)
        events = await _teacher_events(api, teacher, student.user_id, class_id, course["id"], activity_key)
        actual_counts = {event_type: sum(item.get("event_type") == event_type for item in events) for event_type in DEMO_EVIDENCE_EVENT_TYPES}
        if actual_counts != event_counts:
            raise DemoInitializationError(f"evidence fact counts drifted after explanation for {activity_key}: expected={event_counts}, actual={actual_counts}")
        attempts = sorted(
            [item for item in events if item.get("event_type") == "attempted"],
            key=lambda item: (item.get("occurred_at", ""), item.get("event_id", 0)),
        )
        target = next((item for item in attempts if item.get("corrected_by_event_id") == correction_receipt.get("event_id")), None)
        if target is None:
            raise DemoInitializationError(f"teacher correction chain did not preserve {activity_key}")

        if not all(any(item.get("event_type") == event_type for item in events) for event_type in DEMO_EVIDENCE_EVENT_TYPES):
            raise DemoInitializationError(f"five learner evidence facts were not readable for {activity_key}")
        sequence = sorted(
            [item for item in events if item.get("event_type") in DEMO_EVIDENCE_EVENT_TYPES],
            key=lambda item: (item.get("occurred_at", ""), item.get("event_id", 0)),
        )
        sequence_types = [item["event_type"] for item in sequence]
        expected_types = ["started", "predicted"] + ["attempted"] * attempt_count + ["corrected", "explained"]
        if sequence_types != expected_types:
            raise DemoInitializationError(f"evidence sequence drifted for {activity_key}")
        sequence_times = [item["occurred_at"] for item in sequence]
        if any(left >= right for left, right in zip(sequence_times, sequence_times[1:])):
            raise DemoInitializationError(f"evidence timestamps are not strictly causal for {activity_key}")
        summary_facts = {
            event_type: sorted(
                fact_key for item in events if item.get("event_type") == event_type
                for fact_key in (item.get("evidence_summary") or {}).get("facts", {})
            )
            for event_type in DEMO_EVIDENCE_EVENT_TYPES
        }

        recovery_response = await api.get(
            f"/api/learning-evidence/me/recovery?class_id={class_id}&course_id={course['id']}",
            student,
        )
        recovery = _require_status(recovery_response, 200, f"read recovery for {course_key}")
        projection = next((item for item in recovery["activities"] if item["activity_key"] == activity_key), None)
        if (
            projection is None
            or projection["status"] != "completed"
            or projection.get("attempt_count", 0) < representative.minimum_attempts
        ):
            raise DemoInitializationError(f"server did not derive completion for {activity_key}")
        aggregate_response = await api.get(
            f"/api/learning-evidence/classes/{class_id}/courses/{course['id']}/aggregate",
            teacher,
        )
        aggregate = _require_status(aggregate_response, 200, f"read aggregate for {course_key}")
        aggregate_item = next((item for item in aggregate["activities"] if item["activity_key"] == activity_key), None)
        if aggregate_item is None or aggregate_item["completed"] < 1:
            raise DemoInitializationError(f"teacher aggregate did not show completion for {activity_key}")
        evidence_summary[course_key] = {
            "activity_key": activity_key,
            "producer_mode": representative.evidence_profile.producer_mode,
            "course_fact_status": representative.evidence_profile.course_fact_status,
            "fixture_provenance": DEMO_FIXTURE_PROVENANCE,
            "status": projection["status"],
            "attempt_count": projection["attempt_count"],
            "corrected_count": projection["corrected_count"],
            "event_counts": actual_counts,
            "minimum_attempts": representative.minimum_attempts,
            "aggregate_completed": aggregate_item["completed"],
            "teacher_correction": {
                "event_id": correction_receipt.get("event_id"),
                "target_event_id": target["event_id"],
                "linked_in_teacher_readback": True,
            },
            "payload_fingerprints": payload_fingerprints,
            "summary_facts": summary_facts,
        }
    return evidence_summary


async def _ensure_assignments(
    api: DemoApi,
    teacher: Actor,
    student: Actor,
    class_id: int,
    courses: dict[str, dict[str, Any]],
    units: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for declaration in DEMO_ASSIGNMENTS:
        course_key = declaration["course_key"]
        activity_key = declaration["activity_key"]
        title = declaration["title"]
        desired = declaration["desired_status"]
        course = courses[course_key]
        response = await api.get(f"/api/courses/{course['id']}/assignments?class_id={class_id}", teacher)
        assignments = _require_status(response, 200, f"list assignments for {course_key}")
        matching_assignments = [item for item in assignments if item.get("title") == title]
        if len(matching_assignments) > 1:
            raise DemoInitializationError(f"duplicate assignment natural key for {title}")
        assignment = matching_assignments[0] if matching_assignments else None
        if assignment is None:
            created = await api.post(
                f"/api/courses/{course['id']}/units/{units[activity_key]['id']}/assignments",
                teacher,
                {
                    "title": title,
                    "description": declaration["description"],
                    "max_score": declaration["max_score"],
                    "status": declaration["status"],
                    "audience_mode": declaration["audience_mode"],
                },
            )
            assignment = _require_status(created, 201, f"create assignment {title}")
        elif any(
            assignment.get(field) != expected
            for field, expected in {
                "unit_id": units[activity_key]["id"],
                "title": title,
                "description": declaration["description"],
                "max_score": declaration["max_score"],
                "status": declaration["status"],
                "audience_mode": declaration["audience_mode"],
            }.items()
        ):
            raise DemoInitializationError(f"assignment fields drifted for {title}")

        review_response = await api.get(
            f"/api/assignments/{assignment['id']}/review?class_id={class_id}",
            student,
        )
        review = _require_status(review_response, 200, f"read student review for {title}")
        submission = review.get("submission")
        if submission is None:
            created_submission = await api.post(
                f"/api/assignments/{assignment['id']}/submissions",
                student,
                {
                    "class_id": class_id,
                    "content": {"kind": "synthetic-demo", "claim": f"review:{activity_key}"},
                },
            )
            submission = _require_status(created_submission, 201, f"create submission {title}")
        page_response = await api.get(
            f"/api/assignments/{assignment['id']}/submissions/page?class_id={class_id}&limit=100&offset=0",
            teacher,
        )
        page = _require_status(page_response, 200, f"read submissions for {title}")
        student_submissions = [item for item in page["items"] if item.get("student_id") == student.user_id]
        if len(student_submissions) != 1:
            raise DemoInitializationError(f"assignment submission duplicate/drift for {title}")
        submission = student_submissions[0]
        if submission.get("content") != {"kind": "synthetic-demo", "claim": f"review:{activity_key}"}:
            raise DemoInitializationError(f"assignment submission content drifted for {title}")
        if desired == "pending":
            if submission.get("status") != "submitted" or submission.get("feedback") is not None:
                raise DemoInitializationError(f"pending submission drifted for {title}")
        else:
            if submission.get("status") == "submitted":
                graded = await api.patch(
                    f"/api/submissions/{submission['id']}/grade",
                    teacher,
                    {"score": 88, "feedback": "Synthetic feedback: explain the observed boundary.", "status": "graded"},
                )
                submission = _require_status(graded, 200, f"grade submission {title}")
            elif submission.get("status") != "graded":
                raise DemoInitializationError(f"graded submission status drifted for {title}")
            if submission.get("score") != 88 or submission.get("feedback") != "Synthetic feedback: explain the observed boundary.":
                raise DemoInitializationError(f"graded submission fields drifted for {title}")
        result[course_key] = {
            "assignment_id": assignment["id"],
            "submission_id": submission["id"],
            "status": submission["status"],
            "score": submission.get("score"),
            "feedback": submission.get("feedback"),
        }
    return result


async def _ensure_code_runner_demo(
    api: DemoApi,
    teacher: Actor,
    student: Actor,
    class_id: int,
    courses: dict[str, dict[str, Any]],
    units: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    course = courses[DEMO_CODE_PROBLEM["course_key"]]
    activity_key = DEMO_CODE_PROBLEM["activity_key"]
    lookup_path = f"/api/code-problems/by-activity?course_id={course['id']}&activity_key={activity_key}"
    lookup = await api.get(lookup_path, teacher)
    if lookup.status_code == 404:
        created = await api.post(
            "/api/code-problems",
            teacher,
            {
                "course_id": course["id"],
                "course_unit_id": units[activity_key]["id"],
                "title": DEMO_CODE_PROBLEM["title"],
                "statement_markdown": DEMO_CODE_PROBLEM["statement_markdown"],
                "test_cases": list(DEMO_CODE_PROBLEM["test_cases"]),
                "language_allowlist": list(DEMO_CODE_PROBLEM["language_allowlist"]),
                "resource_policy": DEMO_CODE_PROBLEM["resource_policy"],
                "source_max_bytes": DEMO_CODE_PROBLEM["source_max_bytes"],
                "input_max_bytes": DEMO_CODE_PROBLEM["input_max_bytes"],
                "output_max_bytes": DEMO_CODE_PROBLEM["output_max_bytes"],
            },
        )
        problem = _require_status(created, 201, "create disabled-runner code problem")
    else:
        problem = _require_status(lookup, 200, "read disabled-runner code problem")
        active_version = problem.get("active_version") or {}
        expected_problem_fields = {
            "course_id": course["id"],
            "course_unit_id": units[activity_key]["id"],
            "title": DEMO_CODE_PROBLEM["title"],
            "status": "active",
        }
        drifted_fields = [field for field, expected in expected_problem_fields.items() if problem.get(field) != expected]
        for field, expected in {
            "statement_markdown": DEMO_CODE_PROBLEM["statement_markdown"],
            "language_allowlist": list(DEMO_CODE_PROBLEM["language_allowlist"]),
            "resource_policy": DEMO_CODE_PROBLEM["resource_policy"],
            "source_max_bytes": DEMO_CODE_PROBLEM["source_max_bytes"],
            "input_max_bytes": DEMO_CODE_PROBLEM["input_max_bytes"],
            "output_max_bytes": DEMO_CODE_PROBLEM["output_max_bytes"],
            "spec_sha256": _expected_code_problem_spec_hash(),
        }.items():
            if active_version.get(field) != expected:
                drifted_fields.append(f"active_version.{field}")
        if drifted_fields:
            raise DemoInitializationError(f"code problem fields drifted: {','.join(drifted_fields)}")
    if problem.get("status") != "active":
        raise DemoInitializationError("code problem is not active")

    submissions_response = await api.get(
        f"/api/code-submissions?class_id={class_id}&course_id={course['id']}&activity_key={activity_key}&limit=200&offset=0",
        teacher,
    )
    submissions = _require_status(submissions_response, 200, "list disabled-runner submissions")
    student_submissions = [item for item in submissions["items"] if item.get("student_id") == student.user_id]
    if len(student_submissions) > 1:
        raise DemoInitializationError("disabled-runner submission duplicate/drift")
    submission = student_submissions[0] if student_submissions else None
    if submission is None:
        created_submission = await api.post(
            f"/api/code-problems/{problem['id']}/submissions",
            student,
            {
                "class_id": class_id,
                "language": DEMO_CODE_PROBLEM["language"],
                "source_code": DEMO_CODE_PROBLEM["source_code"],
                "stdin": "",
            },
        )
        submission = _require_status(created_submission, (200, 201), "create disabled-runner submission")
    if submission.get("status") != "runner_unavailable" or submission.get("result_summary") != {"runner_state": "runner_disabled"}:
        raise DemoInitializationError("code submission did not truthfully report runner_unavailable")
    if submission.get("course_id") != course["id"] or submission.get("activity_key") != activity_key:
        raise DemoInitializationError("disabled-runner submission scope drifted")
    source = _require_status(
        await api.get(f"/api/code-submissions/{submission['id']}/source", student),
        200,
        "read disabled-runner source authorization",
    )
    if (
        source.get("submission_id") != submission["id"]
        or source.get("language") != DEMO_CODE_PROBLEM["language"]
        or source.get("source_code") != DEMO_CODE_PROBLEM["source_code"]
        or source.get("stdin") != ""
    ):
        raise DemoInitializationError("disabled-runner source readback drifted")
    return {
        "problem_id": problem["id"],
        "submission_id": submission["id"],
        "course_key": DEMO_CODE_PROBLEM["course_key"],
        "activity_key": activity_key,
        "status": submission["status"],
        "source_authorized": True,
    }


async def _verify_status_conflict_and_audit(
    api: DemoApi,
    admin: Actor,
    teacher: Actor,
    school_id: int,
    course: dict[str, Any],
    expected_snapshot: dict[str, Any],
) -> dict[str, Any]:
    stale = await api.patch(
        f"/api/courses/{course['id']}/status",
        admin,
        {"expected_status": "draft", "status": "published", "reason": "Intentional stale demo CAS probe."},
    )
    if stale.status_code != 409:
        raise DemoInitializationError(f"expected stale course status 409, got {stale.status_code}")
    audit_response = await api.get(
        f"/api/admin/audit-logs?action=course.status.patch&resource_id={course['id']}&limit=100&offset=0",
        admin,
    )
    audit = _require_status(audit_response, 200, "read course status audit")
    if (
        audit.get("total") != 1
        or not isinstance(audit.get("items"), list)
        or len(audit["items"]) != 1
        or audit["items"][0].get("snapshot_json") != expected_snapshot
    ):
        raise DemoInitializationError("course status audit changed after stale CAS probe")
    refreshed = _require_status(
        await api.get(f"/api/courses?school_id={school_id}", teacher),
        200,
        "reread course status after stale CAS probe",
    )
    authoritative = next((item for item in refreshed if item.get("course_key") == "engineering-systems"), None)
    if authoritative is None or authoritative.get("status") != "published":
        raise DemoInitializationError("engineering-systems status did not remain published after stale CAS")
    return {"stale_status": stale.status_code, "status_patch_audits": audit["total"], "audit_snapshot": expected_snapshot}


def _v84_course_payload(
    *,
    school_id: int,
    peer_teacher_id: int,
    class_id: int,
    restricted_initial: bool = False,
    restricted_final: bool = False,
) -> dict[str, Any]:
    if restricted_initial or restricted_final:
        spec = DEMO_V84_RESTRICTED_COURSE
        return {
            "school_id": school_id,
            "title": spec["initial_title"] if restricted_initial else spec["title"],
            "summary": spec["initial_summary"] if restricted_initial else spec["summary"],
            "academic_year": spec["academic_year"],
            "schedule_text": spec["initial_schedule_text"] if restricted_initial else spec["schedule_text"],
            "total_hours": spec["total_hours"],
            "galaxy_key": spec["galaxy_key"],
            "subject_key": spec["subject_key"],
            "admission_mode": spec["admission_mode"],
            "collaborator_user_ids": [peer_teacher_id],
            "admission_class_ids": [class_id],
        }
    spec = DEMO_V84_OPEN_COURSE
    return {
        "school_id": school_id,
        "title": spec["title"],
        "summary": spec["summary"],
        "academic_year": spec["academic_year"],
        "schedule_text": spec["schedule_text"],
        "total_hours": spec["total_hours"],
        "galaxy_key": spec["galaxy_key"],
        "subject_key": spec["subject_key"],
        "admission_mode": spec["admission_mode"],
        "collaborator_user_ids": [peer_teacher_id],
        "admission_class_ids": [],
    }


async def _admin_information_revisions(
    api: DemoApi,
    *,
    admin: Actor,
    school_id: int,
    status_value: str,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = _require_status(
            await api.get(
                f"/api/v1/admin/course-information-revisions?status={status_value}"
                f"&school_id={school_id}&limit=200&offset={offset}",
                admin,
            ),
            200,
            f"list {status_value} demo course revisions",
        )
        items.extend(page["items"])
        if page.get("next_offset") is None:
            return items
        offset = int(page["next_offset"])


def _validate_v84_course(
    course: dict[str, Any],
    *,
    payload: dict[str, Any],
    owner_id: int,
    peer_teacher_id: int,
    class_id: int | None,
) -> None:
    expected_fields = {
        "school_id": payload["school_id"],
        "title": payload["title"],
        "summary": payload["summary"],
        "academic_year": payload["academic_year"],
        "schedule_text": payload["schedule_text"],
        "total_hours": payload["total_hours"],
        "galaxy_key": payload["galaxy_key"],
        "subject_key": payload["subject_key"],
        "admission_mode": payload["admission_mode"],
        "status": "published",
    }
    if any(course.get(field) != expected for field, expected in expected_fields.items()):
        raise DemoInitializationError(f"V8.4 demo course fields drifted for {payload['title']}")
    teacher_ids = {item.get("user_id") for item in course.get("teachers", [])}
    if teacher_ids != {owner_id, peer_teacher_id}:
        raise DemoInitializationError(f"V8.4 demo course teachers drifted for {payload['title']}")
    admission_ids = {item.get("class_id") for item in course.get("admission_classes", [])}
    expected_admission_ids = {class_id} if class_id is not None else set()
    if admission_ids != expected_admission_ids:
        raise DemoInitializationError(f"V8.4 demo course admission classes drifted for {payload['title']}")
    if not isinstance(course.get("course_code"), str) or re.fullmatch(r"[A-HJ-NP-Z2-9]{8}", course["course_code"]) is None:
        raise DemoInitializationError(f"V8.4 demo course code drifted for {payload['title']}")


async def _ensure_open_v84_course(
    api: DemoApi,
    *,
    admin: Actor,
    owner: Actor,
    peer_teacher: Actor,
    school_id: int,
) -> dict[str, Any]:
    payload = _v84_course_payload(
        school_id=school_id,
        peer_teacher_id=peer_teacher.user_id,
        class_id=0,
    )
    visible = _require_status(
        await api.get(f"/api/v1/courses?school_id={school_id}", owner),
        200,
        "list V8.4 demo courses",
    )
    matching = [item for item in visible if item.get("title") == payload["title"]]
    if len(matching) > 1:
        raise DemoInitializationError("open V8.4 demo course natural key is duplicated")
    course = matching[0] if matching else None
    if course is None:
        course = _require_status(
            await api.post("/api/v1/courses", owner, payload),
            201,
            "create open V8.4 demo course",
        )
    revision = course["information_revision"]
    if revision["revision_number"] != 1:
        raise DemoInitializationError("open V8.4 demo course revision count drifted")
    if revision["status"] == "draft":
        course = _require_status(
            await api.post(
                f"/api/v1/courses/{course['id']}/information-revisions/{revision['id']}/submit",
                owner,
                {},
            ),
            200,
            "submit open V8.4 demo course",
        )
        revision = course["information_revision"]
    if revision["status"] == "submitted":
        _require_status(
            await api.patch(
                f"/api/v1/admin/course-information-revisions/{revision['id']}",
                admin,
                {"status": "approved", "note": "公开课程信息完整。"},
            ),
            200,
            "approve open V8.4 demo course",
        )
        course = _require_status(
            await api.get(f"/api/v1/courses/{course['id']}", owner),
            200,
            "reread open V8.4 demo course",
        )
        revision = course["information_revision"]
    if revision["status"] != "approved":
        raise DemoInitializationError("open V8.4 demo course approval drifted")
    _validate_v84_course(
        course,
        payload=payload,
        owner_id=owner.user_id,
        peer_teacher_id=peer_teacher.user_id,
        class_id=None,
    )
    approved_items = await _admin_information_revisions(
        api,
        admin=admin,
        school_id=school_id,
        status_value="approved",
    )
    approved = [
        item for item in approved_items
        if item.get("course_id") == course["id"] and item.get("revision", {}).get("id") == revision["id"]
    ]
    if len(approved) != 1 or approved[0].get("internal_class_id") is None:
        raise DemoInitializationError("open V8.4 demo course internal group drifted")
    return {**course, "_internal_class_id": int(approved[0]["internal_class_id"])}


async def _ensure_restricted_v84_course(
    api: DemoApi,
    *,
    admin: Actor,
    owner: Actor,
    peer_teacher: Actor,
    school_id: int,
    class_id: int,
) -> dict[str, Any]:
    initial_payload = _v84_course_payload(
        school_id=school_id,
        peer_teacher_id=peer_teacher.user_id,
        class_id=class_id,
        restricted_initial=True,
    )
    final_payload = _v84_course_payload(
        school_id=school_id,
        peer_teacher_id=peer_teacher.user_id,
        class_id=class_id,
        restricted_final=True,
    )
    visible = _require_status(
        await api.get(f"/api/v1/courses?school_id={school_id}", owner),
        200,
        "list restricted V8.4 demo course",
    )
    titles = {initial_payload["title"], final_payload["title"]}
    matching = [item for item in visible if item.get("title") in titles]
    if len(matching) > 1:
        raise DemoInitializationError("restricted V8.4 demo course natural key is duplicated")
    course = matching[0] if matching else None
    if course is None:
        course = _require_status(
            await api.post("/api/v1/courses", owner, initial_payload),
            201,
            "create restricted V8.4 demo course",
        )

    while True:
        revision = course["information_revision"]
        number = int(revision["revision_number"])
        status_value = revision["status"]
        if number == 1:
            if status_value == "draft":
                course = _require_status(
                    await api.post(
                        f"/api/v1/courses/{course['id']}/information-revisions/{revision['id']}/submit",
                        owner,
                        {},
                    ),
                    200,
                    "submit initial restricted V8.4 demo course",
                )
                continue
            if status_value == "submitted":
                _require_status(
                    await api.patch(
                        f"/api/v1/admin/course-information-revisions/{revision['id']}",
                        admin,
                        {"status": "rejected", "note": "请明确课程时间后重新提交。"},
                    ),
                    200,
                    "reject initial restricted V8.4 demo course",
                )
                course = _require_status(
                    await api.get(f"/api/v1/courses/{course['id']}", owner),
                    200,
                    "reread rejected restricted V8.4 demo course",
                )
                continue
            if status_value == "rejected":
                course = _require_status(
                    await api.post(
                        f"/api/v1/courses/{course['id']}/information-revisions",
                        owner,
                        final_payload,
                    ),
                    201,
                    "revise restricted V8.4 demo course",
                )
                continue
            raise DemoInitializationError("restricted V8.4 initial revision was unexpectedly approved")
        if number == 2:
            if status_value == "draft":
                course = _require_status(
                    await api.post(
                        f"/api/v1/courses/{course['id']}/information-revisions/{revision['id']}/submit",
                        peer_teacher,
                        {},
                    ),
                    200,
                    "resubmit restricted V8.4 demo course",
                )
                continue
            if status_value == "submitted":
                _require_status(
                    await api.patch(
                        f"/api/v1/admin/course-information-revisions/{revision['id']}",
                        admin,
                        {"status": "approved", "note": "课程时间已经补充。"},
                    ),
                    200,
                    "approve revised restricted V8.4 demo course",
                )
                course = _require_status(
                    await api.get(f"/api/v1/courses/{course['id']}", owner),
                    200,
                    "reread approved restricted V8.4 demo course",
                )
                continue
            if status_value == "approved":
                break
            raise DemoInitializationError("restricted V8.4 revised information was rejected")
        raise DemoInitializationError("restricted V8.4 demo course revision count drifted")

    _validate_v84_course(
        course,
        payload=final_payload,
        owner_id=owner.user_id,
        peer_teacher_id=peer_teacher.user_id,
        class_id=class_id,
    )
    rejected_items = await _admin_information_revisions(
        api,
        admin=admin,
        school_id=school_id,
        status_value="rejected",
    )
    approved_items = await _admin_information_revisions(
        api,
        admin=admin,
        school_id=school_id,
        status_value="approved",
    )
    rejected = [item for item in rejected_items if item.get("course_id") == course["id"]]
    approved = [item for item in approved_items if item.get("course_id") == course["id"]]
    if (
        len(rejected) != 1
        or rejected[0].get("revision", {}).get("revision_number") != 1
        or len(approved) != 1
        or approved[0].get("revision", {}).get("revision_number") != 2
        or approved[0].get("internal_class_id") is None
    ):
        raise DemoInitializationError("restricted V8.4 demo course review history drifted")
    return {
        **course,
        "_internal_class_id": int(approved[0]["internal_class_id"]),
        "_rejected_revision_id": int(rejected[0]["revision"]["id"]),
    }


async def _ensure_open_course_enrollment(
    api: DemoApi,
    *,
    course: dict[str, Any],
    teacher: Actor,
    student: Actor,
) -> dict[str, Any]:
    page = _require_status(
        await api.get(f"/api/v1/courses/{course['id']}/enrollments?status=all&limit=200&offset=0", teacher),
        200,
        "list open demo course enrollments",
    )
    matching = [item for item in page["items"] if item.get("student_id") == student.user_id]
    if len(matching) > 1:
        raise DemoInitializationError("open demo course enrollment is duplicated")
    enrollment = matching[0] if matching else None
    if enrollment is None:
        requests = _require_status(
            await api.get(f"/api/v1/courses/{course['id']}/join-requests?status=all&limit=200&offset=0", teacher),
            200,
            "list open demo course join requests",
        )
        matches = [item for item in requests["items"] if item.get("student_id") == student.user_id]
        if len(matches) > 1:
            raise DemoInitializationError("open demo course join request is duplicated")
        join_request = matches[0] if matches else None
        if join_request is None or join_request.get("status") == "rejected":
            join_request = _require_status(
                await api.post(
                    f"/api/v1/courses/{course['id']}/join-requests",
                    student,
                    {"message": "申请加入公开演示课程。"},
                ),
                201,
                "request open demo course",
            )
        if join_request.get("status") == "pending":
            _require_status(
                await api.patch(
                    f"/api/v1/courses/{course['id']}/join-requests/{join_request['id']}",
                    teacher,
                    {"status": "approved", "note": "公开课程申请通过。"},
                ),
                200,
                "approve open demo course request",
            )
        page = _require_status(
            await api.get(f"/api/v1/courses/{course['id']}/enrollments?status=active&limit=200&offset=0", teacher),
            200,
            "verify open demo course enrollment",
        )
        enrollment = next((item for item in page["items"] if item.get("student_id") == student.user_id), None)
    if (
        enrollment is None
        or enrollment.get("status") != "active"
        or enrollment.get("source") != "request"
        or enrollment.get("source_class_id") is not None
        or enrollment.get("source_class_name") != "未关联班级"
    ):
        raise DemoInitializationError("open demo course enrollment drifted")
    return enrollment


async def _ensure_restricted_course_enrollment(
    api: DemoApi,
    *,
    course: dict[str, Any],
    teacher: Actor,
    student: Actor,
    class_id: int,
) -> dict[str, Any]:
    page = _require_status(
        await api.get(f"/api/v1/courses/{course['id']}/enrollments?status=all&limit=200&offset=0", teacher),
        200,
        "list restricted demo course enrollments",
    )
    matching = [item for item in page["items"] if item.get("student_id") == student.user_id]
    if len(matching) > 1:
        raise DemoInitializationError("restricted demo course enrollment is duplicated")
    enrollment = matching[0] if matching else None
    if enrollment is None:
        result = _require_status(
            await api.post(
                f"/api/v1/courses/{course['id']}/enrollments/batch",
                teacher,
                {"class_id": class_id},
            ),
            200,
            "batch enroll restricted demo course",
        )
        matching_results = [item for item in result["items"] if item.get("student_id") == student.user_id]
        if len(matching_results) != 1 or matching_results[0].get("outcome") != "created":
            raise DemoInitializationError("restricted demo course batch enrollment did not create the student")
        enrollment = matching_results[0].get("enrollment")
    if (
        enrollment is None
        or enrollment.get("status") != "active"
        or enrollment.get("source") != "class_batch"
        or enrollment.get("source_class_id") != class_id
    ):
        raise DemoInitializationError("restricted demo course enrollment drifted")
    return enrollment


_V84_ACTIVITY_KEYS = (
    "physics.mechanics",
    "physics.energy-checkpoint",
    "physics.evidence-report",
)


def _v84_content_page(
    *,
    activity_key: str,
    title: str,
    position: int,
    version_marker: str,
    assignment_id: int | None,
) -> dict[str, Any]:
    completion: dict[str, Any] | None
    if activity_key == "physics.mechanics":
        completion = {"preset": "experiment_operation"}
        blocks = [
            {
                "blockId": "mechanics-hero",
                "type": "hero",
                "title": title,
                "summary": "操作正式实验并留下可回读的学习证据。",
                "badges": ["正式实验", "操作完成"],
            },
            {
                "blockId": "mechanics-reading",
                "type": "rich-text",
                "title": "本次发布说明",
                "markdown": f"{version_marker}：保持原实验交互，通过课程引用完成学习记录。",
            },
            {
                "blockId": "mechanics-simulation",
                "type": "official-simulation",
                "title": "机械运动实验",
                "simulationKey": "physics.mechanics",
                "instructions": "进入实验后完成一次有效操作，再返回课程查看进度。",
                "fallbackMarkdown": "若设备暂时无法运行实验，可稍后在桌面端继续。",
            },
        ]
    elif activity_key == "physics.energy-checkpoint":
        completion = {
            "preset": "checkpoint_passed",
            "checkpointKey": "energy-conservation-check",
        }
        blocks = [
            {
                "blockId": "energy-hero",
                "type": "hero",
                "title": title,
                "summary": "用一道即时检查确认机械能守恒条件。",
                "badges": ["即时检查", "自动判定"],
            },
            {
                "blockId": "energy-reading",
                "type": "rich-text",
                "title": "观察提示",
                "markdown": f"{version_marker}：忽略阻力时，比较动能、势能与机械能的变化。",
            },
            {
                "blockId": "energy-checkpoint",
                "type": "checkpoint",
                "checkpointKey": "energy-conservation-check",
                "title": "守恒判断",
                "prompt": "忽略阻力时，小球下落过程中保持不变的是？",
                "mode": "inline",
                "responseType": "single-choice",
                "choices": [
                    {"choiceId": "kinetic", "label": "动能"},
                    {"choiceId": "potential", "label": "重力势能"},
                    {"choiceId": "mechanical", "label": "机械能"},
                ],
                "correctChoiceIds": ["mechanical"],
                "maxAttempts": 3,
            },
        ]
    else:
        completion = (
            {"preset": "assignment_reviewed", "assignmentId": assignment_id}
            if assignment_id is not None
            else None
        )
        blocks = [
            {
                "blockId": "evidence-hero",
                "type": "hero",
                "title": title,
                "summary": "提交观察报告，由教师批改后形成学习结果。",
                "badges": ["作业提交", "教师反馈"],
            },
            {
                "blockId": "evidence-reading",
                "type": "rich-text",
                "title": "报告要求",
                "markdown": f"{version_marker}：说明能量转化现象，并给出支持结论的观察依据。",
            },
            {
                "blockId": "evidence-task",
                "type": "learning-task",
                "title": "完成证据报告",
                "prompt": "把实验观察整理为简短报告并提交。",
                "outcomes": ["描述能量转化", "引用观察证据"],
                "steps": ["回顾实验", "整理结论", "提交报告"],
                "concepts": ["机械能", "证据表达"],
            },
        ]
    course_unit: dict[str, Any] = {
        "courseId": "astra-demo-course",
        "unitId": activity_key,
        "order": position,
        "title": title,
    }
    if completion is not None:
        course_unit["completion"] = completion
    return {
        "schemaVersion": "astra-content-page-v2",
        "slug": f"demo/{activity_key.replace('.', '-')}",
        "galaxy": "englab",
        "subject": "physics",
        "title": title,
        "summary": "星序课程闭环本地演示内容。",
        "layout": "course-page",
        "status": "draft",
        "version": version_marker,
        "courseUnit": course_unit,
        "blocks": blocks,
    }


def _v84_draft_units(
    *,
    existing_units: list[dict[str, Any]],
    version_marker: str,
    assignment_id: int | None,
) -> list[dict[str, Any]]:
    existing_by_key = {item.get("activity_key"): item for item in existing_units}
    titles = ("机械运动实验", "机械能守恒检查", "机械能证据报告")
    result: list[dict[str, Any]] = []
    for position, (activity_key, title) in enumerate(zip(_V84_ACTIVITY_KEYS, titles), start=1):
        payload: dict[str, Any] = {
            "activity_key": activity_key,
            "title": title,
            "position": position,
            "content": _v84_content_page(
                activity_key=activity_key,
                title=title,
                position=position,
                version_marker=version_marker,
                assignment_id=assignment_id,
            ),
        }
        existing = existing_by_key.get(activity_key)
        if existing is not None:
            payload["id"] = existing["id"]
        result.append(payload)
    return result


def _v84_content_marker(content: dict[str, Any]) -> str:
    for block in content.get("blocks", []):
        if block.get("type") == "rich-text" and isinstance(block.get("markdown"), str):
            if "版本一" in block["markdown"]:
                return "版本一"
            if "版本二" in block["markdown"]:
                return "版本二"
    return ""


def _v84_completion(content: dict[str, Any]) -> dict[str, Any]:
    raw = (content.get("courseUnit") or {}).get("completion") or {}
    return {key: value for key, value in raw.items() if value is not None}


def _validate_v84_draft(
    draft: dict[str, Any],
    *,
    version_marker: str,
    assignment_id: int,
) -> bool:
    units = draft.get("units", [])
    if [item.get("activity_key") for item in units] != list(_V84_ACTIVITY_KEYS):
        return False
    if [item.get("position") for item in units] != [1, 2, 3]:
        return False
    expected = (
        {"preset": "experiment_operation"},
        {"preset": "checkpoint_passed", "checkpointKey": "energy-conservation-check"},
        {"preset": "assignment_reviewed", "assignmentId": assignment_id},
    )
    for unit, completion in zip(units, expected):
        content = unit.get("content") or {}
        if _v84_content_marker(content) != version_marker:
            return False
        if _v84_completion(content) != completion:
            return False
    return True


async def _replace_v84_draft(
    api: DemoApi,
    *,
    actor: Actor,
    course_id: int,
    draft: dict[str, Any],
    version_marker: str,
    assignment_id: int | None,
) -> dict[str, Any]:
    return _require_status(
        await api.patch(
            f"/api/v1/courses/{course_id}/draft",
            actor,
            {
                "expected_revision": draft["revision"],
                "units": _v84_draft_units(
                    existing_units=draft.get("units", []),
                    version_marker=version_marker,
                    assignment_id=assignment_id,
                ),
            },
        ),
        200,
        f"write {version_marker} V8.4 shared course draft",
    )


async def _ensure_v84_assignments(
    api: DemoApi,
    *,
    course_id: int,
    assignment_unit_id: int,
    teacher: Actor,
) -> dict[str, dict[str, Any]]:
    existing = _require_status(
        await api.get(f"/api/courses/{course_id}/assignments", teacher),
        200,
        "list V8.4 demo assignments",
    )
    by_title: dict[str, dict[str, Any]] = {}
    for spec in DEMO_V84_ASSIGNMENTS:
        matches = [item for item in existing if item.get("title") == spec["title"]]
        if len(matches) > 1:
            raise DemoInitializationError(f"V8.4 demo assignment duplicated: {spec['title']}")
        assignment = matches[0] if matches else None
        if assignment is None:
            assignment = _require_status(
                await api.post(
                    f"/api/courses/{course_id}/units/{assignment_unit_id}/assignments",
                    teacher,
                    {
                        "title": spec["title"],
                        "description": spec["description"],
                        "max_score": spec["max_score"],
                    },
                ),
                201,
                f"create V8.4 demo assignment {spec['title']}",
            )
            existing.append(assignment)
        if (
            assignment.get("unit_id") != assignment_unit_id
            or assignment.get("description") != spec["description"]
            or assignment.get("max_score") != spec["max_score"]
            or assignment.get("status") != "active"
            or assignment.get("audience_mode") != "all_attached_classes"
        ):
            raise DemoInitializationError(f"V8.4 demo assignment drifted: {spec['title']}")
        by_title[spec["title"]] = assignment
    return by_title


def _validate_v84_release(
    release: dict[str, Any],
    *,
    release_number: int,
    version_marker: str,
    assignment_id: int,
) -> None:
    if release.get("release_number") != release_number:
        raise DemoInitializationError("V8.4 release sequence drifted")
    units = release.get("units", [])
    if [item.get("activity_key") for item in units] != list(_V84_ACTIVITY_KEYS):
        raise DemoInitializationError("V8.4 release unit identity drifted")
    expected = (
        {"preset": "experiment_operation"},
        {"preset": "checkpoint_passed", "checkpointKey": "energy-conservation-check"},
        {"preset": "assignment_reviewed", "assignmentId": assignment_id},
    )
    for unit, completion in zip(units, expected):
        content = unit.get("content") or {}
        if _v84_content_marker(content) != version_marker:
            raise DemoInitializationError(f"V8.4 {version_marker} release content drifted")
        if _v84_completion(content) != completion:
            raise DemoInitializationError(f"V8.4 {version_marker} completion preset drifted")


async def _ensure_v84_course_content(
    api: DemoApi,
    *,
    course: dict[str, Any],
    owner: Actor,
    peer_teacher: Actor,
) -> dict[str, Any]:
    course_id = int(course["id"])
    draft = _require_status(
        await api.get(f"/api/v1/courses/{course_id}/draft", owner),
        200,
        "read V8.4 shared course draft",
    )
    if not draft.get("units"):
        draft = await _replace_v84_draft(
            api,
            actor=owner,
            course_id=course_id,
            draft=draft,
            version_marker="版本一",
            assignment_id=None,
        )
    unit_by_key = {item.get("activity_key"): item for item in draft.get("units", [])}
    if set(unit_by_key) != set(_V84_ACTIVITY_KEYS):
        raise DemoInitializationError("V8.4 shared draft unit set drifted")
    assignments = await _ensure_v84_assignments(
        api,
        course_id=course_id,
        assignment_unit_id=int(unit_by_key["physics.evidence-report"]["id"]),
        teacher=owner,
    )
    graded_assignment = assignments[DEMO_V84_ASSIGNMENTS[0]["title"]]

    releases = _require_status(
        await api.get(f"/api/v1/courses/{course_id}/releases", owner),
        200,
        "list V8.4 demo releases",
    )
    if len(releases) > 2:
        raise DemoInitializationError("V8.4 demo course has more than two releases")
    if not releases:
        if not _validate_v84_draft(
            draft,
            version_marker="版本一",
            assignment_id=int(graded_assignment["id"]),
        ):
            draft = await _replace_v84_draft(
                api,
                actor=peer_teacher,
                course_id=course_id,
                draft=draft,
                version_marker="版本一",
                assignment_id=int(graded_assignment["id"]),
            )
        _require_status(
            await api.post(
                f"/api/v1/courses/{course_id}/releases",
                owner,
                {"expected_revision": draft["revision"], "note": "课程闭环演示版本一"},
            ),
            201,
            "publish V8.4 demo release one",
        )
        releases = _require_status(
            await api.get(f"/api/v1/courses/{course_id}/releases", owner),
            200,
            "reread V8.4 release one",
        )
    if len(releases) == 1:
        _validate_v84_release(
            releases[0],
            release_number=1,
            version_marker="版本一",
            assignment_id=int(graded_assignment["id"]),
        )
        draft = _require_status(
            await api.get(f"/api/v1/courses/{course_id}/draft", peer_teacher),
            200,
            "read V8.4 version two draft",
        )
        if not _validate_v84_draft(
            draft,
            version_marker="版本二",
            assignment_id=int(graded_assignment["id"]),
        ):
            draft = await _replace_v84_draft(
                api,
                actor=peer_teacher,
                course_id=course_id,
                draft=draft,
                version_marker="版本二",
                assignment_id=int(graded_assignment["id"]),
            )
        _require_status(
            await api.post(
                f"/api/v1/courses/{course_id}/releases",
                peer_teacher,
                {"expected_revision": draft["revision"], "note": "课程闭环演示版本二"},
            ),
            201,
            "publish V8.4 demo release two",
        )
        releases = _require_status(
            await api.get(f"/api/v1/courses/{course_id}/releases", owner),
            200,
            "reread V8.4 release two",
        )
    if [item.get("release_number") for item in releases] != [2, 1]:
        raise DemoInitializationError("V8.4 demo release history drifted")
    _validate_v84_release(
        releases[0],
        release_number=2,
        version_marker="版本二",
        assignment_id=int(graded_assignment["id"]),
    )
    _validate_v84_release(
        releases[1],
        release_number=1,
        version_marker="版本一",
        assignment_id=int(graded_assignment["id"]),
    )
    if releases[0].get("completion_rule_id") != releases[1].get("completion_rule_id"):
        raise DemoInitializationError("unchanged V8.4 completion rules were not reused")
    return {
        "assignments": assignments,
        "releases": releases,
        "units": {item["activity_key"]: item for item in releases[0]["units"]},
    }


async def _ensure_v84_submissions(
    api: DemoApi,
    *,
    assignments: dict[str, dict[str, Any]],
    internal_class_id: int,
    student: Actor,
    peer_teacher: Actor,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for spec in DEMO_V84_ASSIGNMENTS:
        assignment = assignments[spec["title"]]
        review = _require_status(
            await api.get(
                f"/api/assignments/{assignment['id']}/review?class_id={internal_class_id}",
                student,
            ),
            200,
            f"read V8.4 assignment review {spec['title']}",
        )
        submission = review.get("submission")
        if submission is None:
            submission = _require_status(
                await api.post(
                    f"/api/assignments/{assignment['id']}/submissions",
                    student,
                    {
                        "class_id": internal_class_id,
                        "content": {
                            "report": "实验观察显示动能与势能相互转化，总机械能保持稳定。",
                            "fixture": "synthetic-local-demo",
                        },
                    },
                ),
                201,
                f"submit V8.4 demo assignment {spec['title']}",
            )
        if spec["desired_status"] == "graded" and submission.get("status") == "submitted":
            submission = _require_status(
                await api.patch(
                    f"/api/submissions/{submission['id']}/grade",
                    peer_teacher,
                    {
                        "score": 92,
                        "feedback": "证据完整，守恒关系表达清楚。",
                        "status": "graded",
                    },
                ),
                200,
                "grade V8.4 demo assignment",
            )
        if spec["desired_status"] == "graded":
            if (
                submission.get("status") != "graded"
                or submission.get("score") != 92
                or submission.get("feedback") != "证据完整，守恒关系表达清楚。"
                or submission.get("graded_by_user_id") != peer_teacher.user_id
            ):
                raise DemoInitializationError("graded V8.4 demo submission drifted")
        elif (
            submission.get("status") != "submitted"
            or submission.get("score") is not None
            or submission.get("feedback") is not None
        ):
            raise DemoInitializationError("pending V8.4 demo submission drifted")
        result[spec["title"]] = submission
    return result


async def _ensure_v84_learning_completion(
    api: DemoApi,
    *,
    course: dict[str, Any],
    content_state: dict[str, Any],
    internal_class_id: int,
    student: Actor,
    owner: Actor,
) -> dict[str, Any]:
    releases = content_state["releases"]
    current_release = releases[0]
    release_id = int(current_release["id"])
    units = content_state["units"]
    rules = _require_status(
        await api.get(f"/api/learning-evidence/rules?course_id={course['id']}", owner),
        200,
        "read V8.4 completion rule",
    )
    matching_rules = [item for item in rules if item.get("id") == current_release.get("completion_rule_id")]
    if len(matching_rules) != 1 or matching_rules[0].get("status") != "active":
        raise DemoInitializationError("V8.4 active completion rule drifted")
    rule = matching_rules[0]
    mechanics_unit = units["physics.mechanics"]
    runtime_payload = {
        "schema_version": "astra-learning-activity-evidence-sidecar-v1",
        "command": {
            "schema_version": "astra-learning-activity-event-v1",
            "scope": {
                "class_id": internal_class_id,
                "course_id": course["id"],
                "course_unit_id": mechanics_unit["source_course_unit_id"],
                "activity_key": mechanics_unit["activity_key"],
            },
            "run": {
                "run_id": "v84-demo-run-0001",
                "group_id": "v84-demo-group-0001",
                "sequence": 1,
            },
            "versions": {
                "manifest_version": "v84-demo-manifest",
                "content_version": "v84-demo-release-2",
                "event_schema_version": 1,
                "rule_version": rule["version_number"],
                "generation": "v84-demo-generation",
            },
            "client_event_id": "v84-demo:physics.mechanics:attempted:1",
            "event_type": "attempted",
            "evidence": {"operation": "mechanics-controlled-run"},
            "occurred_at": "2026-08-01T08:00:00.000Z",
        },
        "snapshot": {
            "state_schema_version": "v84-demo-state-v1",
            "applied_through_learner_sequence": 1,
            "data": {"stage": "attempted"},
        },
    }
    runtime_response = await api.post(
        "/api/learning-evidence/activity-runtime/events",
        student,
        runtime_payload,
    )
    if runtime_response.status_code not in {200, 201}:
        raise DemoInitializationError(
            f"append V8.4 experiment evidence failed with HTTP {runtime_response.status_code}: "
            f"{_response_detail(runtime_response)}"
        )
    runtime_receipt = runtime_response.json()
    if runtime_receipt.get("status") not in {"confirmed", "reconciled"}:
        raise DemoInitializationError("V8.4 experiment evidence receipt drifted")

    checkpoint_unit = units["physics.energy-checkpoint"]
    checkpoint = _require_status(
        await api.post(
            f"/api/v1/courses/{course['id']}/units/{checkpoint_unit['source_course_unit_id']}"
            "/checkpoints/energy-conservation-check/attempts",
            student,
            {
                "client_attempt_id": "v84-demo-checkpoint-correct-1",
                "course_release_id": release_id,
                "selected_choice_ids": ["mechanical"],
            },
        ),
        201,
        "complete V8.4 checkpoint",
    )
    if checkpoint.get("is_correct") is not True or checkpoint.get("completed") is not True:
        raise DemoInitializationError("V8.4 checkpoint completion drifted")

    recovery = _require_status(
        await api.get(
            f"/api/learning-evidence/me/recovery?class_id={internal_class_id}&course_id={course['id']}",
            student,
        ),
        200,
        "read V8.4 learning recovery",
    )
    status_by_key = {item["activity_key"]: item["status"] for item in recovery.get("activities", [])}
    if {key: status_by_key.get(key) for key in _V84_ACTIVITY_KEYS} != {
        key: "completed" for key in _V84_ACTIVITY_KEYS
    }:
        raise DemoInitializationError("V8.4 course completion recovery drifted")

    student_current = _require_status(
        await api.get(f"/api/v1/courses/{course['id']}/releases/current", student),
        200,
        "read current V8.4 student release",
    )
    if student_current.get("release", {}).get("id") != release_id:
        raise DemoInitializationError("student did not read the latest V8.4 release")
    student_checkpoint_unit = next(
        item
        for item in student_current["release"]["units"]
        if item.get("activity_key") == "physics.energy-checkpoint"
    )
    student_checkpoint = next(
        block
        for block in student_checkpoint_unit["content"]["blocks"]
        if block.get("type") == "checkpoint"
    )
    if "correctChoiceIds" in student_checkpoint:
        raise DemoInitializationError("student release exposed checkpoint answers")
    return {
        "rule_version": rule["version_number"],
        "runtime_recorded": True,
        "checkpoint_completed": True,
        "activity_statuses": {key: status_by_key[key] for key in _V84_ACTIVITY_KEYS},
        "current_release_number": student_current["release"]["release_number"],
    }


async def initialize_demo_data(
    *,
    credentials: Mapping[str, str] | None = None,
    prompt_password: Callable[[str], str] | None = None,
    display_new_credentials: bool = False,
) -> dict[str, Any]:
    """Create or verify the complete local demo and return a secret-free report."""

    if not display_new_credentials and not credentials:
        raise DemoInitializationError(
            "direct demo initialization requires credentials or explicit display_new_credentials=True"
        )
    credentials = credentials or {}
    prompt_password = prompt_password or (lambda username: getpass.getpass(f"Password for existing {username}: "))
    credential_banner = [False]
    async with DemoApi() as api:
        admin = await _ensure_actor(
            api,
            username=DEMO_ADMIN_USERNAME,
            display_name="演示管理员",
            role="admin",
            credentials=credentials,
            prompt_password=prompt_password,
            display_new_credentials=display_new_credentials,
            credential_banner=credential_banner,
        )
        teacher = await _ensure_actor(
            api,
            username=DEMO_TEACHER_USERNAME,
            display_name="演示教师",
            role="teacher",
            credentials=credentials,
            prompt_password=prompt_password,
            display_new_credentials=display_new_credentials,
            credential_banner=credential_banner,
        )
        student = await _ensure_actor(
            api,
            username=DEMO_STUDENT_USERNAME,
            display_name="演示学生",
            role="student",
            credentials=credentials,
            prompt_password=prompt_password,
            display_new_credentials=display_new_credentials,
            credential_banner=credential_banner,
        )
        school_id = await _ensure_school(api, teacher)
        class_id = await _ensure_class(api, teacher, school_id)
        await _ensure_student_membership(api, teacher, student, class_id)
        courses, units = await _ensure_catalog(api, teacher, school_id, class_id)
        await _publish_courses(api, admin, teacher, school_id, courses)
        plans = await _ensure_attachment_and_plan(api, teacher, class_id, courses, units)
        rules = await _ensure_rules(api, teacher, class_id, courses, plans)
        engineering_status_audit = await _publish_engineering_course(
            api,
            admin,
            teacher,
            school_id,
            courses["engineering-systems"],
        )
        evidence = await _ensure_representative_evidence(api, teacher, student, class_id, courses, units, rules)
        assignments = await _ensure_assignments(api, teacher, student, class_id, courses, units)
        code_runner = await _ensure_code_runner_demo(api, teacher, student, class_id, courses, units)
        status_audit = await _verify_status_conflict_and_audit(
            api,
            admin,
            teacher,
            school_id,
            courses["engineering-systems"],
            engineering_status_audit,
        )
        peer_origin, peer_password = await _ensure_student_origin_actor(
            api,
            username=DEMO_PEER_TEACHER_USERNAME,
            display_name="演示共同教师",
            credentials=credentials,
            prompt_password=prompt_password,
            display_new_credentials=display_new_credentials,
            credential_banner=credential_banner,
        )
        peer_teacher, peer_teacher_application = await _ensure_peer_teacher_application(
            api,
            actor=peer_origin,
            password=peer_password,
            admin=admin,
            display_name="演示共同教师",
        )
        pending_teacher, _pending_password = await _ensure_student_origin_actor(
            api,
            username=DEMO_PENDING_TEACHER_USERNAME,
            display_name="演示待审教师",
            credentials=credentials,
            prompt_password=prompt_password,
            display_new_credentials=display_new_credentials,
            credential_banner=credential_banner,
        )
        pending_teacher_application = await _ensure_pending_teacher_application(api, pending_teacher)
        open_student = await _ensure_actor(
            api,
            username=DEMO_OPEN_STUDENT_USERNAME,
            display_name="演示无行政班学生",
            role="student",
            credentials=credentials,
            prompt_password=prompt_password,
            display_new_credentials=display_new_credentials,
            credential_banner=credential_banner,
        )
        await _ensure_peer_teacher_membership(
            api,
            class_teacher=teacher,
            peer_teacher=peer_teacher,
            class_id=class_id,
        )
        await _verify_no_homeroom(api, open_student)
        open_course = await _ensure_open_v84_course(
            api,
            admin=admin,
            owner=teacher,
            peer_teacher=peer_teacher,
            school_id=school_id,
        )
        restricted_course = await _ensure_restricted_v84_course(
            api,
            admin=admin,
            owner=teacher,
            peer_teacher=peer_teacher,
            school_id=school_id,
            class_id=class_id,
        )
        open_enrollment = await _ensure_open_course_enrollment(
            api,
            course=open_course,
            teacher=teacher,
            student=open_student,
        )
        restricted_enrollment = await _ensure_restricted_course_enrollment(
            api,
            course=restricted_course,
            teacher=peer_teacher,
            student=student,
            class_id=class_id,
        )
        await _verify_no_homeroom(api, open_student)
        v84_content = await _ensure_v84_course_content(
            api,
            course=open_course,
            owner=teacher,
            peer_teacher=peer_teacher,
        )
        v84_submissions = await _ensure_v84_submissions(
            api,
            assignments=v84_content["assignments"],
            internal_class_id=int(open_course["_internal_class_id"]),
            student=open_student,
            peer_teacher=peer_teacher,
        )
        v84_learning = await _ensure_v84_learning_completion(
            api,
            course=open_course,
            content_state=v84_content,
            internal_class_id=int(open_course["_internal_class_id"]),
            student=open_student,
            owner=teacher,
        )

    return {
        "status": "initialized",
        "users": {
            "admin": {"username": admin.username, "id": admin.user_id},
            "teacher": {"username": teacher.username, "id": teacher.user_id},
            "student": {"username": student.username, "id": student.user_id},
            "peer_teacher": {"username": peer_teacher.username, "id": peer_teacher.user_id},
            "pending_teacher": {"username": pending_teacher.username, "id": pending_teacher.user_id},
            "open_student": {"username": open_student.username, "id": open_student.user_id},
        },
        "school_id": school_id,
        "class_id": class_id,
        "course_count": len(courses),
        "unit_count": len(units),
        "catalog": {
            course_key: {
                "galaxy_key": course["galaxy_key"],
                "course_key": course_key,
                "activity_keys": [unit.activity_key for unit in COURSE_BY_KEY[course_key].units],
                "content_slugs": [unit.content_slug for unit in COURSE_BY_KEY[course_key].units],
            }
            for course_key, course in courses.items()
        },
        "release_modes": {
            course_key: {item["activity_key"]: item["release_mode"] for item in plan["items"]}
            for course_key, plan in plans.items()
        },
        "completion_rules": {
            course_key: {
                "version_number": rule["version_number"],
                "activities": rule["activities"],
            }
            for course_key, rule in rules.items()
        },
        "representative_evidence": evidence,
        "assignments": assignments,
        "code_runner": code_runner,
        "course_status": status_audit,
        "course_loop": {
            "teacher_applications": {
                "peer": {
                    "id": peer_teacher_application["id"],
                    "status": peer_teacher_application["status"],
                    "applicant_role": peer_teacher_application["applicant_role"],
                },
                "pending": {
                    "id": pending_teacher_application["id"],
                    "status": pending_teacher_application["status"],
                    "applicant_role": pending_teacher_application["applicant_role"],
                },
            },
            "courses": {
                "open": {
                    "id": open_course["id"],
                    "course_code": open_course["course_code"],
                    "internal_class_id": open_course["_internal_class_id"],
                    "admission_mode": open_course["admission_mode"],
                    "teacher_count": len(open_course["teachers"]),
                },
                "class_restricted": {
                    "id": restricted_course["id"],
                    "course_code": restricted_course["course_code"],
                    "internal_class_id": restricted_course["_internal_class_id"],
                    "admission_mode": restricted_course["admission_mode"],
                    "teacher_count": len(restricted_course["teachers"]),
                    "rejected_revision_id": restricted_course["_rejected_revision_id"],
                },
            },
            "enrollments": {
                "open": {
                    "id": open_enrollment["id"],
                    "source": open_enrollment["source"],
                    "source_class_name": open_enrollment["source_class_name"],
                },
                "class_restricted": {
                    "id": restricted_enrollment["id"],
                    "source": restricted_enrollment["source"],
                    "source_class_id": restricted_enrollment["source_class_id"],
                },
            },
            "releases": {
                "release_numbers": [item["release_number"] for item in v84_content["releases"]],
                "current_release_id": v84_content["releases"][0]["id"],
                "completion_rule_id": v84_content["releases"][0]["completion_rule_id"],
                "presets": {
                    "physics.mechanics": "experiment_operation",
                    "physics.energy-checkpoint": "checkpoint_passed",
                    "physics.evidence-report": "assignment_reviewed",
                },
            },
            "submissions": {
                title: {
                    "id": submission["id"],
                    "status": submission["status"],
                    "score": submission.get("score"),
                    "feedback": submission.get("feedback"),
                }
                for title, submission in v84_submissions.items()
            },
            "learning": v84_learning,
        },
        "synthetic_data_notice": "本数据为合成演示证据，用于复验产品闭环，不代表真实学生学习时长、掌握程度或课堂试点。",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Initialize the Astra local-preview synthetic demo through APIs.")
    parser.add_argument("--confirm-local-preview", action="store_true")
    args = parser.parse_args(argv)
    if not args.confirm_local_preview:
        parser.error("--confirm-local-preview is required")
    try:
        report = asyncio.run(initialize_demo_data(display_new_credentials=True))
    except DemoInitializationError as exc:
        raise SystemExit(f"Demo initialization failed: {exc}") from exc
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
