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
    DEMO_SCHOOL_NAME,
    DEMO_SCHOOL_REGION,
    DEMO_STUDENT_USERNAME,
    DEMO_TEACHER_USERNAME,
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
        response = await self.post("/api/auth/login", None, {"username": username, "password": password})
        payload = _require_status(response, 200, f"login {username}")
        # Do not let the HttpOnly response cookie leak into later Bearer calls.
        if self.client is not None:
            self.client.cookies.clear()
        token = payload.get("access_token")
        user = payload.get("user") or {}
        if not isinstance(token, str) or not token or user.get("role") != expected_role:
            raise DemoInitializationError(f"login {username} returned an unexpected role or token")
        me_response = await self.get("/api/users/me", Actor(username, int(user["id"]), expected_role, token))
        me = _require_status(me_response, 200, f"verify identity {username}")
        if (
            me.get("username") != username
            or me.get("role") != expected_role
            or me.get("display_name") != expected_display_name
        ):
            raise DemoInitializationError(f"verified identity drifted for {username}")
        return Actor(username, int(me["id"]), expected_role, token)


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

    return {
        "status": "initialized",
        "users": {
            "admin": {"username": admin.username, "id": admin.user_id},
            "teacher": {"username": teacher.username, "id": teacher.user_id},
            "student": {"username": student.username, "id": student.user_id},
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
