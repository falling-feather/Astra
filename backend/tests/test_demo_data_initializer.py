from __future__ import annotations

import asyncio
import json
from pathlib import Path
import secrets

import pytest
from httpx import Response
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.db.session import reset_database_state
from app.models.learning_evidence import (
    LearningActivityProjection,
    LearningCompletionRule,
    LearningEvidenceEvent,
    LearningResumeProjection,
    LearningRuleActivation,
    LearningRuleClassBinding,
)
from app.db.session import get_session_factory
from scripts.demo_evidence_profiles import (
    COURSE_FACT_STATUS_PRECISE,
    COURSE_FACT_STATUS_SHALLOW,
    COURSE_FACT_STATUS_UNAVAILABLE,
    DEMO_EVIDENCE_PROFILE_BY_ACTIVITY,
    DEMO_FIXTURE_PROVENANCE,
    PRODUCER_MODE_FRONTEND_PRECISE,
    PRODUCER_MODE_FRONTEND_SHALLOW,
    PRODUCER_MODE_GENERIC_FALLBACK,
    build_demo_evidence_payload,
)
from scripts.demo_data_manifest import (
    DEMO_ASSIGNMENTS,
    DEMO_CODE_PROBLEM,
    DEMO_COURSES,
    DEMO_EVIDENCE_EVENT_TYPES,
    DEMO_OPEN_STUDENT_USERNAME,
    DEMO_PEER_TEACHER_USERNAME,
    DEMO_PENDING_TEACHER_USERNAME,
    DEMO_V84_ASSIGNMENTS,
    DEMO_V84_OPEN_COURSE,
    DEMO_V84_RESTRICTED_COURSE,
    DEMO_V84_USERS,
    COURSE_BY_KEY,
    REPRESENTATIVE_BY_COURSE,
    REPRESENTATIVE_COURSES,
)
from scripts.initialize_demo_data import DemoApi, DemoInitializationError, initialize_demo_data
import scripts.initialize_demo_data as initializer_module


DEMO_PASSWORDS = {
    username: f"Astra-{secrets.token_urlsafe(32)}"
    for username in (
        "astra_demo_admin",
        "astra_demo_teacher",
        "astra_demo_student",
        DEMO_PEER_TEACHER_USERNAME,
        DEMO_PENDING_TEACHER_USERNAME,
        DEMO_OPEN_STUDENT_USERNAME,
    )
}


@pytest.fixture()
def local_demo_environment(monkeypatch):
    monkeypatch.setenv("ASTRA_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("ASTRA_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv("ASTRA_ENVIRONMENT", "development")
    monkeypatch.setenv("ASTRA_ADMIN_BOOTSTRAP_ENABLED", "true")
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "true")
    monkeypatch.setenv("ASTRA_LOCAL_PREVIEW_INSTANCE_ID", "demo-test-instance")
    monkeypatch.setenv("ASTRA_CORS_ORIGINS", "http://127.0.0.1:9001")
    get_settings.cache_clear()
    reset_database_state()
    yield
    get_settings.cache_clear()
    reset_database_state()


def test_manifest_is_complete_and_contains_no_credential_material():
    assert len(DEMO_COURSES) == 14
    assert sum(len(course.units) for course in DEMO_COURSES) == 42
    assert len(REPRESENTATIVE_COURSES) == 6
    assert DEMO_EVIDENCE_EVENT_TYPES == ("started", "predicted", "attempted", "corrected", "explained")
    assert DEMO_V84_USERS == (
        (DEMO_PEER_TEACHER_USERNAME, "演示共同教师", "teacher"),
        (DEMO_PENDING_TEACHER_USERNAME, "演示待审教师", "student"),
        (DEMO_OPEN_STUDENT_USERNAME, "演示无行政班学生", "student"),
    )
    assert DEMO_V84_OPEN_COURSE["admission_mode"] == "open"
    assert DEMO_V84_RESTRICTED_COURSE["admission_mode"] == "class_restricted"
    assert [item["desired_status"] for item in DEMO_V84_ASSIGNMENTS] == ["graded", "pending"]
    assert {
        (item["course_key"], item["activity_key"]): (
            item["title"],
            item["description"],
            item["desired_status"],
        )
        for item in DEMO_ASSIGNMENTS
    } == {
        ("physics", "physics.mechanics"): (
            "机械运动证据回顾",
            "整理本次实验的观察结论，并说明现象与判断依据。",
            "graded",
        ),
        ("humanities-futures", "humanities.claim-review"): (
            "人文观点证据辨析",
            "选择支持观点的事实依据，并说明证据与结论之间的联系。",
            "pending",
        ),
        ("control-flow", "control-flow.loop-boundary"): (
            "循环边界过程回顾",
            "记录循环结束前后的条件变化，等待教师给出针对性反馈。",
            "pending",
        ),
    }
    assert DEMO_CODE_PROBLEM["activity_key"] == "control-flow.loop-boundary"
    assert DEMO_CODE_PROBLEM["title"] == "循环边界演示题"
    control_assignment = next(item for item in DEMO_ASSIGNMENTS if item["course_key"] == "control-flow")
    assert (control_assignment["course_key"], control_assignment["activity_key"]) == (
        DEMO_CODE_PROBLEM["course_key"],
        DEMO_CODE_PROBLEM["activity_key"],
    )
    assert {
        item.course_key: (item.open_unit_key, item.locked_unit_key, item.hidden_unit_key, item.minimum_attempts)
        for item in REPRESENTATIVE_COURSES
    } == {
        "physics": ("physics.mechanics", "physics.gas-laws", "physics.thermodynamics", 2),
        "mathematics": ("mathematics.derivative-application", "mathematics.function-graph", "mathematics.calculus", 2),
        "control-flow": ("control-flow.loop-boundary", "control-flow.branch-doors", "control-flow.nested-grid", 2),
        "debugging-testing": ("debugging-testing.minimal-case", "debugging-testing.assert-boundary", "debugging-testing.trace-mismatch", 4),
        "engineering-systems": ("engineering.load-path", "engineering.member-choice", "engineering.safety-check", 3),
        "humanities-futures": ("humanities.claim-review", "humanities.context-map", "humanities.voice-shift", 2),
    }
    assert {
        activity_key: (profile.producer_mode, profile.course_fact_status)
        for activity_key, profile in DEMO_EVIDENCE_PROFILE_BY_ACTIVITY.items()
    } == {
        "physics.mechanics": (PRODUCER_MODE_FRONTEND_PRECISE, COURSE_FACT_STATUS_PRECISE),
        "control-flow.loop-boundary": (PRODUCER_MODE_FRONTEND_SHALLOW, COURSE_FACT_STATUS_SHALLOW),
        "mathematics.derivative-application": (PRODUCER_MODE_GENERIC_FALLBACK, COURSE_FACT_STATUS_UNAVAILABLE),
        "debugging-testing.minimal-case": (PRODUCER_MODE_GENERIC_FALLBACK, COURSE_FACT_STATUS_UNAVAILABLE),
        "engineering.load-path": (PRODUCER_MODE_GENERIC_FALLBACK, COURSE_FACT_STATUS_UNAVAILABLE),
        "humanities.claim-review": (PRODUCER_MODE_GENERIC_FALLBACK, COURSE_FACT_STATUS_UNAVAILABLE),
    }

    scripts_root = Path(__file__).resolve().parents[1] / "scripts"
    for filename in ("demo_data_manifest.py", "demo_evidence_profiles.py"):
        declaration_source = scripts_root.joinpath(filename).read_text(encoding="utf-8")
        assert "password" not in declaration_source.lower()
        assert "token" not in declaration_source.lower()


def test_demo_evidence_profiles_match_current_producers_and_keep_fallback_generic():
    physics = DEMO_EVIDENCE_PROFILE_BY_ACTIVITY["physics.mechanics"]
    assert build_demo_evidence_payload(physics, "started", 1) == {
        "cursor": {"surface": "englab", "stage": "entered"}
    }
    assert build_demo_evidence_payload(physics, "predicted", 1) == {
        "prediction": {
            "expects_higher_080": True,
            "expected_height_multiplier": 4,
            "reason_size": 24,
        },
        "cursor": {"stage": "prediction-recorded"},
    }
    physics_attempts = [
        build_demo_evidence_payload(physics, "attempted", index)
        for index in range(1, 4)
    ]
    assert [item["cursor"]["trial"] for item in physics_attempts] == [40, 80, 40]
    assert [item["cursor"]["preset"]["restitution"] for item in physics_attempts] == [0.40, 0.80, 0.40]
    assert {
        tuple(sorted(item["cursor"]["preset"].items()))
        for item in physics_attempts
    } == {
        (
            ("damping", 0),
            ("drop_height_px", 200),
            ("gravity_px_s2", 980),
            ("horizontal_velocity_px_s", 0),
            ("radius_px", 16),
            ("restitution", 0.40),
        ),
        (
            ("damping", 0),
            ("drop_height_px", 200),
            ("gravity_px_s2", 980),
            ("horizontal_velocity_px_s", 0),
            ("radius_px", 16),
            ("restitution", 0.80),
        ),
    }
    for item in physics_attempts:
        observation = item["cursor"]["observation"]
        assert abs(
            observation["height_ratio"]
            - round(observation["first_rebound_height_px"] / 200, 2)
        ) <= 0.01
    assert build_demo_evidence_payload(physics, "corrected", 1) == {
        "correction": {
            "height_follows_e_squared": True,
            "model_limit_acknowledged": True,
            "ratio_040": 0.16,
            "ratio_080": 0.64,
        },
        "cursor": {"stage": "after-repair"},
    }
    assert build_demo_evidence_payload(physics, "explained", 1) == {
        "artifact": {"kind": "claim-evidence-link", "value": "claim-supported"},
        "cursor": {"stage": "explained"},
    }

    control = DEMO_EVIDENCE_PROFILE_BY_ACTIVITY["control-flow.loop-boundary"]
    assert build_demo_evidence_payload(control, "started", 1) == {
        "cursor": {"surface": "code-space", "stage": "entered"}
    }
    assert build_demo_evidence_payload(control, "predicted", 1) == {
        "prediction": {"choice": "prediction-recorded"},
        "cursor": {"stage": "before-browser-precheck"},
    }
    control_attempts = [
        build_demo_evidence_payload(control, "attempted", index)
        for index in range(1, 4)
    ]
    assert control_attempts == [
        {
            "operation": "browser_precheck",
            "reported_correct": False,
            "cursor": {"runner": "runner_unavailable"},
        },
        {
            "operation": "browser_precheck",
            "reported_correct": True,
            "cursor": {"runner": "browser_precheck_finished"},
        },
        {
            "operation": "formal_oj_submission",
            "cursor": {"judge": "judge_result_received"},
        },
    ]
    assert "trace" not in json.dumps(control_attempts, sort_keys=True)
    assert build_demo_evidence_payload(control, "corrected", 1) == {
        "correction": {
            "kind": "code-revision",
            "result": "public-check-pass",
        },
        "cursor": {"stage": "after-repair"},
    }
    assert build_demo_evidence_payload(control, "explained", 1) == {
        "artifact": {"kind": "claim-evidence-link", "value": "claim-supported"},
        "cursor": {"stage": "explained"},
    }

    fallback_activity_keys = (
        "mathematics.derivative-application",
        "debugging-testing.minimal-case",
        "engineering.load-path",
        "humanities.claim-review",
    )
    fallback_payloads = {
        activity_key: {
            event_type: build_demo_evidence_payload(
                DEMO_EVIDENCE_PROFILE_BY_ACTIVITY[activity_key],
                event_type,
                1,
            )
            for event_type in DEMO_EVIDENCE_EVENT_TYPES
        }
        for activity_key in fallback_activity_keys
    }
    assert len({
        json.dumps(payloads, sort_keys=True)
        for payloads in fallback_payloads.values()
    }) == 1
    fallback_serialized = json.dumps(fallback_payloads, sort_keys=True)
    for forbidden_course_fact in (
        "slope_x0_id",
        "failure_class_id",
        "load_node_id",
        "source_id",
        "body_execution_count",
        "first_false_count",
        "output_id",
    ):
        assert forbidden_course_fact not in fallback_serialized


def _expected_seeded_learner_evidence_payloads() -> dict[str, dict]:
    expected: dict[str, dict] = {}
    for representative in REPRESENTATIVE_COURSES:
        activity_key = representative.open_unit_key
        attempt_count = representative.minimum_attempts + 1
        for event_type in DEMO_EVIDENCE_EVENT_TYPES:
            event_count = attempt_count if event_type == "attempted" else 1
            for index in range(1, event_count + 1):
                expected[f"demo:{activity_key}:{event_type}:{index}"] = build_demo_evidence_payload(
                    representative.evidence_profile,
                    event_type,
                    index,
                )
    return expected


def _read_seeded_learner_evidence_payloads() -> dict[str, dict]:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        events = db.scalars(
            select(LearningEvidenceEvent)
            .where(LearningEvidenceEvent.client_event_id.like("demo:%"))
            .order_by(LearningEvidenceEvent.client_event_id)
        ).all()
    return {
        event.client_event_id: event.evidence_json
        for event in events
        if ":teacher-correction:" not in event.client_event_id
    }


async def _read_control_flow_demo_scope(report: dict) -> dict:
    declaration = next(item for item in DEMO_ASSIGNMENTS if item["course_key"] == "control-flow")
    async with DemoApi() as api:
        teacher = await api.login(
            "astra_demo_teacher",
            DEMO_PASSWORDS["astra_demo_teacher"],
            "teacher",
            "演示教师",
        )
        admin = await api.login(
            "astra_demo_admin",
            DEMO_PASSWORDS["astra_demo_admin"],
            "admin",
            "演示管理员",
        )
        courses = initializer_module._require_status(
            await api.get(f"/api/courses?school_id={report['school_id']}", teacher),
            200,
            "read control-flow course scope",
        )
        matching_courses = [item for item in courses if item.get("course_key") == declaration["course_key"]]
        assert len(matching_courses) == 1
        course = matching_courses[0]
        units = initializer_module._require_status(
            await api.get(f"/api/courses/{course['id']}/units", teacher),
            200,
            "read control-flow units",
        )
        matching_units = [item for item in units if item.get("activity_key") == declaration["activity_key"]]
        assert len(matching_units) == 1
        unit = matching_units[0]

        assignments = initializer_module._require_status(
            await api.get(f"/api/courses/{course['id']}/assignments?class_id={report['class_id']}", teacher),
            200,
            "read control-flow assignments",
        )
        assert len(assignments) == 1
        matching_assignments = [
            item
            for item in assignments
            if (
                item.get("id") == report["assignments"]["control-flow"]["assignment_id"]
                and item.get("title") == declaration["title"]
                and item.get("unit_id") == unit["id"]
            )
        ]
        assert len(matching_assignments) == 1
        assignment = matching_assignments[0]

        submissions = initializer_module._require_status(
            await api.get(
                f"/api/assignments/{assignment['id']}/submissions/page"
                f"?class_id={report['class_id']}&limit=100&offset=0",
                teacher,
            ),
            200,
            "read control-flow assignment submissions",
        )
        assert submissions["total"] == 1
        assert submissions["items"][0]["id"] == report["assignments"]["control-flow"]["submission_id"]
        assert submissions["items"][0]["status"] == "submitted"

        problem = initializer_module._require_status(
            await api.get(
                f"/api/code-problems/by-activity?course_id={course['id']}"
                f"&activity_key={declaration['activity_key']}",
                teacher,
            ),
            200,
            "read control-flow code problem",
        )
        assert problem["id"] == report["code_runner"]["problem_id"]
        assert problem["course_id"] == course["id"]
        assert assignment["unit_id"] == problem["course_unit_id"] == unit["id"]

        code_submissions = initializer_module._require_status(
            await api.get(
                f"/api/code-submissions?class_id={report['class_id']}&course_id={course['id']}"
                f"&activity_key={declaration['activity_key']}&limit=100&offset=0",
                teacher,
            ),
            200,
            "read control-flow code submissions",
        )
        assert code_submissions["total"] == 1
        assert code_submissions["items"][0]["id"] == report["code_runner"]["submission_id"]
        assert code_submissions["items"][0]["status"] == "runner_unavailable"

        audit_items = []
        offset = 0
        while True:
            audit_page = initializer_module._require_status(
                await api.get(f"/api/admin/audit-logs?limit=100&offset={offset}", admin),
                200,
                "read initializer audit ledger",
            )
            audit_items.extend(audit_page["items"])
            if audit_page["next_offset"] is None:
                break
            offset = audit_page["next_offset"]

        return {
            "course_id": course["id"],
            "activity_key": declaration["activity_key"],
            "unit_id": unit["id"],
            "assignment_ids": [item["id"] for item in assignments],
            "assignment_submission_ids": [item["id"] for item in submissions["items"]],
            "code_problem_id": problem["id"],
            "code_submission_ids": [item["id"] for item in code_submissions["items"]],
            "non_login_audits": [
                (item["id"], item["action"], item["resource_type"], item["resource_id"])
                for item in audit_items
                if not str(item.get("action", "")).startswith("auth.")
            ],
        }


def test_fresh_demo_and_two_reruns_are_semantically_idempotent(local_demo_environment):
    first = asyncio.run(initialize_demo_data(credentials=DEMO_PASSWORDS))
    first_payloads = _read_seeded_learner_evidence_payloads()
    first_scope = asyncio.run(_read_control_flow_demo_scope(first))
    second = asyncio.run(initialize_demo_data(credentials=DEMO_PASSWORDS))
    second_payloads = _read_seeded_learner_evidence_payloads()
    second_scope = asyncio.run(_read_control_flow_demo_scope(second))
    third = asyncio.run(initialize_demo_data(credentials=DEMO_PASSWORDS))
    third_payloads = _read_seeded_learner_evidence_payloads()
    third_scope = asyncio.run(_read_control_flow_demo_scope(third))

    for report in (first, second, third):
        assert report["status"] == "initialized"
        assert report["course_count"] == 14
        assert report["unit_count"] == 42
        assert sum(len(item["activity_keys"]) for item in report["catalog"].values()) == 42
        assert {item["galaxy_key"] for item in report["catalog"].values()} == {"englab", "code-space", "future-galaxy"}
        assert sum(item["galaxy_key"] == "englab" for item in report["catalog"].values()) == 2
        assert sum(item["galaxy_key"] == "code-space" for item in report["catalog"].values()) == 6
        assert sum(item["galaxy_key"] == "future-galaxy" for item in report["catalog"].values()) == 6
        assert set(report["representative_evidence"]) == {
            "physics",
            "mathematics",
            "control-flow",
            "debugging-testing",
            "engineering-systems",
            "humanities-futures",
        }
        assert all(item["status"] == "completed" for item in report["representative_evidence"].values())
        for item in report["representative_evidence"].values():
            assert set(item["event_counts"]) == {"started", "predicted", "attempted", "corrected", "explained"}
            assert all(count >= 1 for count in item["event_counts"].values())
            assert item["event_counts"]["attempted"] == item["minimum_attempts"] + 1
            assert item["fixture_provenance"] == DEMO_FIXTURE_PROVENANCE
            assert item["teacher_correction"]["event_id"] > 0
            assert item["teacher_correction"]["target_event_id"] > 0
            assert item["teacher_correction"]["linked_in_teacher_readback"] is True
            assert "teacher_feedback" not in item
            assert item["payload_fingerprints"]["attempted"]
        assert {
            item["activity_key"]: (item["producer_mode"], item["course_fact_status"])
            for item in report["representative_evidence"].values()
        } == {
            activity_key: (profile.producer_mode, profile.course_fact_status)
            for activity_key, profile in DEMO_EVIDENCE_PROFILE_BY_ACTIVITY.items()
        }
        assert all(item["teacher_correction"]["linked_in_teacher_readback"] for item in report["representative_evidence"].values())
        assert report["release_modes"]["engineering-systems"] == {
            "engineering.load-path": "open",
            "engineering.member-choice": "locked",
            "engineering.safety-check": "hidden",
        }
        assert report["release_modes"]["mathematics"] == {
            "mathematics.function-graph": "locked",
            "mathematics.calculus": "hidden",
            "mathematics.derivative-application": "open",
        }
        assert report["assignments"]["physics"]["score"] == 88
        assert report["assignments"]["physics"]["feedback"]
        assert report["assignments"]["humanities-futures"]["status"] == "submitted"
        assert report["assignments"]["control-flow"]["status"] == "submitted"
        assert report["assignments"]["control-flow"]["score"] is None
        assert report["assignments"]["control-flow"]["feedback"] is None
        assert report["code_runner"]["status"] == "runner_unavailable"
        assert report["code_runner"]["course_key"] == "control-flow"
        assert report["code_runner"]["activity_key"] == "control-flow.loop-boundary"
        assert report["code_runner"]["source_authorized"] is True
        assert report["course_status"]["stale_status"] == 409
        assert report["course_status"]["audit_snapshot"]["impact"] == {
            "attached_class_count": 1,
            "course_unit_count": 3,
            "assignment_count": 0,
        }
        assert report["course_loop"]["teacher_applications"]["peer"]["status"] == "approved"
        assert report["course_loop"]["teacher_applications"]["peer"]["applicant_role"] == "teacher"
        assert report["course_loop"]["teacher_applications"]["pending"]["status"] == "pending"
        assert report["course_loop"]["teacher_applications"]["pending"]["applicant_role"] == "student"
        assert report["course_loop"]["courses"]["open"]["admission_mode"] == "open"
        assert report["course_loop"]["courses"]["class_restricted"]["admission_mode"] == "class_restricted"
        assert report["course_loop"]["courses"]["open"]["teacher_count"] == 2
        assert report["course_loop"]["courses"]["class_restricted"]["teacher_count"] == 2
        assert len(report["course_loop"]["courses"]["open"]["course_code"]) == 8
        assert len(report["course_loop"]["courses"]["class_restricted"]["course_code"]) == 8
        assert report["course_loop"]["enrollments"]["open"]["source"] == "request"
        assert report["course_loop"]["enrollments"]["open"]["source_class_name"] == "未关联班级"
        assert report["course_loop"]["enrollments"]["class_restricted"]["source"] == "class_batch"
        assert report["course_loop"]["releases"]["release_numbers"] == [2, 1]
        assert report["course_loop"]["releases"]["presets"] == {
            "physics.mechanics": "experiment_operation",
            "physics.energy-checkpoint": "checkpoint_passed",
            "physics.evidence-report": "assignment_reviewed",
        }
        assert report["course_loop"]["submissions"]["机械能证据报告"]["status"] == "graded"
        assert report["course_loop"]["submissions"]["机械能证据报告"]["score"] == 92
        assert report["course_loop"]["submissions"]["机械能证据报告"]["feedback"]
        assert report["course_loop"]["submissions"]["机械能拓展思考"] == {
            "id": report["course_loop"]["submissions"]["机械能拓展思考"]["id"],
            "status": "submitted",
            "score": None,
            "feedback": None,
        }
        assert report["course_loop"]["learning"]["runtime_recorded"] is True
        assert report["course_loop"]["learning"]["checkpoint_completed"] is True
        assert report["course_loop"]["learning"]["current_release_number"] == 2
        assert set(report["course_loop"]["learning"]["activity_statuses"].values()) == {"completed"}
        assert report["synthetic_data_notice"] == "本数据为合成演示证据，用于复验产品闭环，不代表真实学生学习时长、掌握程度或课堂试点。"

    assert first["users"] == second["users"] == third["users"]
    assert first["school_id"] == second["school_id"] == third["school_id"]
    assert first["class_id"] == second["class_id"] == third["class_id"]
    assert first["catalog"] == second["catalog"] == third["catalog"]
    assert first["release_modes"] == second["release_modes"] == third["release_modes"]
    assert first["completion_rules"] == second["completion_rules"] == third["completion_rules"]
    assert first["representative_evidence"] == second["representative_evidence"] == third["representative_evidence"]
    assert first["assignments"] == second["assignments"] == third["assignments"]
    assert (
        first["assignments"]["control-flow"]["assignment_id"],
        first["assignments"]["control-flow"]["submission_id"],
    ) == (
        second["assignments"]["control-flow"]["assignment_id"],
        second["assignments"]["control-flow"]["submission_id"],
    ) == (
        third["assignments"]["control-flow"]["assignment_id"],
        third["assignments"]["control-flow"]["submission_id"],
    )
    assert first["code_runner"] == second["code_runner"] == third["code_runner"]
    assert first["course_loop"] == second["course_loop"] == third["course_loop"]
    assert first_scope == second_scope == third_scope
    assert (
        first_payloads
        == second_payloads
        == third_payloads
        == _expected_seeded_learner_evidence_payloads()
    )
    assert first["course_status"]["status_patch_audits"] == second["course_status"]["status_patch_audits"]
    assert second["course_status"]["status_patch_audits"] == third["course_status"]["status_patch_audits"]


def test_initializer_rejects_mysql_and_non_local_origin(monkeypatch):
    monkeypatch.setenv("ASTRA_ENVIRONMENT", "development")
    monkeypatch.setenv("ASTRA_ADMIN_BOOTSTRAP_ENABLED", "true")
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "true")
    monkeypatch.setenv("ASTRA_LOCAL_PREVIEW_INSTANCE_ID", "demo-test-instance")
    monkeypatch.setenv("ASTRA_CORS_ORIGINS", "http://127.0.0.1:9001")
    monkeypatch.setenv("ASTRA_DATABASE_URL", "mysql+pymysql://demo:demo@localhost/astra")
    get_settings.cache_clear()
    with pytest.raises(DemoInitializationError, match="local SQLite"):
        asyncio.run(initialize_demo_data(credentials=DEMO_PASSWORDS))

    monkeypatch.setenv("ASTRA_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("ASTRA_CORS_ORIGINS", "http://192.168.1.10:9001")
    get_settings.cache_clear()
    with pytest.raises(DemoInitializationError, match="127.0.0.1"):
        asyncio.run(initialize_demo_data(credentials=DEMO_PASSWORDS))

    monkeypatch.setenv("ASTRA_CORS_ORIGINS", "http://127.0.0.1:9001")
    monkeypatch.setenv("ASTRA_DATABASE_URL", "sqlite+pysqlite:////server/share/astra.sqlite3")
    with pytest.raises(DemoInitializationError, match="UNC"):
        asyncio.run(initialize_demo_data(credentials=DEMO_PASSWORDS))

    monkeypatch.setenv("ASTRA_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("ASTRA_ENVIRONMENT", "staging")
    with pytest.raises(DemoInitializationError, match="local development"):
        asyncio.run(initialize_demo_data(credentials=DEMO_PASSWORDS))


def test_credentials_are_announced_before_later_failure_and_recover(local_demo_environment, monkeypatch, capsys):
    async def fail_after_accounts(*_args, **_kwargs):
        raise DemoInitializationError("injected post-account failure")

    with monkeypatch.context() as local:
        local.setattr(initializer_module, "_ensure_school", fail_after_accounts)
        with pytest.raises(DemoInitializationError) as failure:
            asyncio.run(initialize_demo_data(display_new_credentials=True))
    output = capsys.readouterr().out
    assert output.count("Astra local demo credentials") == 1
    announced = {}
    for line in output.splitlines():
        if ": " in line and line.split(": ", 1)[0] in DEMO_PASSWORDS:
            username, password = line.split(": ", 1)
            announced[username] = password
    assert set(announced) == {"astra_demo_admin", "astra_demo_teacher", "astra_demo_student"}
    assert all(announced.values())
    assert all(secret not in str(failure.value) for secret in announced.values())

    report = asyncio.run(initialize_demo_data(credentials={**DEMO_PASSWORDS, **announced}))
    assert all(secret not in json.dumps(report, ensure_ascii=False) for secret in announced.values())


def test_error_detail_allowlist_never_echoes_rejected_input():
    sentinel = "password-source-jwt-sentinel"
    response = Response(
        422,
        json={"detail": [{"type": "string_too_long", "loc": ["body", "password"], "msg": sentinel, "input": sentinel}]},
    )
    detail = initializer_module._response_detail(response)
    assert sentinel not in detail
    assert "input" not in detail

    secret_message = "password=VerySecret source_code=print(3) sk_live_123 JWT eyJhbGciOiJIUzI1NiJ9 PEM"
    response = Response(
        422,
        json={
            "detail": {
                "code": "validation_error",
                "type": "validation_error",
                "message": secret_message,
                "location": ["body", "source_code"],
            }
        },
    )
    detail = initializer_module._response_detail(response)
    assert detail == "code=validation_error; type=validation_error"
    assert secret_message not in detail
    assert all(fragment not in detail for fragment in ("VerySecret", "print(3)", "sk_live_123", "eyJhbGciOiJIUzI1NiJ9", "PEM"))


def test_direct_entry_requires_recoverable_credentials_before_side_effects(local_demo_environment):
    with pytest.raises(DemoInitializationError, match="credentials or explicit display_new_credentials"):
        asyncio.run(initialize_demo_data())


def _demo_actor_passwords() -> dict[str, str]:
    return DEMO_PASSWORDS


async def _seed_existing_physics_without_activation() -> dict[str, int]:
    async with DemoApi() as api:
        credential_banner = [False]
        common = {
            "credentials": DEMO_PASSWORDS,
            "prompt_password": None,
            "display_new_credentials": False,
            "credential_banner": credential_banner,
        }
        admin = await initializer_module._ensure_actor(
            api,
            username="astra_demo_admin",
            display_name="演示管理员",
            role="admin",
            **common,
        )
        teacher = await initializer_module._ensure_actor(
            api,
            username="astra_demo_teacher",
            display_name="演示教师",
            role="teacher",
            **common,
        )
        student = await initializer_module._ensure_actor(
            api,
            username="astra_demo_student",
            display_name="演示学生",
            role="student",
            **common,
        )
        school_id = await initializer_module._ensure_school(api, teacher)
        class_id = await initializer_module._ensure_class(api, teacher, school_id)
        await initializer_module._ensure_student_membership(api, teacher, student, class_id)
        spec = COURSE_BY_KEY["physics"]
        course = initializer_module._require_status(
            await api.post(
                "/api/courses",
                teacher,
                {
                    "school_id": school_id,
                    "galaxy_key": spec.galaxy_key,
                    "course_key": spec.course_key,
                    "title": spec.title,
                    "summary": spec.summary,
                    "status": "published",
                },
            ),
            201,
            "seed existing physics course",
        )
        for position, unit_spec in enumerate(spec.units, start=1):
            initializer_module._require_status(
                await api.post(
                    f"/api/courses/{course['id']}/units",
                    teacher,
                    {
                        "activity_key": unit_spec.activity_key,
                        "title": unit_spec.title,
                        "position": position,
                        "content_slug": unit_spec.content_slug,
                        "status": "published",
                    },
                ),
                201,
                f"seed existing physics unit {unit_spec.activity_key}",
            )
        attached = initializer_module._require_status(
            await api.post(f"/api/courses/{course['id']}/classes", teacher, {"class_id": class_id}),
            201,
            "attach existing physics course",
        )
        plan_path = f"/api/courses/{course['id']}/classes/{class_id}/release-plan"
        plan = initializer_module._require_status(await api.get(plan_path, teacher), 200, "read existing physics plan")
        units = initializer_module._require_status(await api.get(f"/api/courses/{course['id']}/units", teacher), 200, "read existing physics units")
        patched = await api.patch(
            plan_path,
            teacher,
            {
                "expected_version": plan["plan_version"],
                "items": [
                    {
                        "course_unit_id": unit["id"],
                        "release_mode": initializer_module._expected_release_mode("physics", unit["activity_key"]),
                    }
                    for unit in units
                ],
                "reason": "seed exact existing physics release plan",
            },
        )
        initializer_module._require_status(patched, 200, "set existing physics release plan")
        initializer_module._require_status(
            await api.post(
                "/api/learning-evidence/rules",
                teacher,
                {"course_id": course["id"], "activities": initializer_module._expected_rule_activities("physics")},
            ),
            201,
            "seed existing physics draft rule",
        )
        assert attached["course_id"] == course["id"]
        return {"school_id": school_id, "class_id": class_id, "course_id": course["id"], "admin_id": admin.user_id}


async def _read_physics_preflight_state(scope: dict[str, int]) -> dict:
    async with DemoApi() as api:
        admin = await api.login("astra_demo_admin", DEMO_PASSWORDS["astra_demo_admin"], "admin", "演示管理员")
        teacher = await api.login("astra_demo_teacher", DEMO_PASSWORDS["astra_demo_teacher"], "teacher", "演示教师")
        courses = initializer_module._require_status(
            await api.get(f"/api/courses?school_id={scope['school_id']}", teacher),
            200,
            "read partial catalog",
        )
        rules = initializer_module._require_status(
            await api.get(f"/api/learning-evidence/rules?course_id={scope['course_id']}", teacher),
            200,
            "read partial physics rules",
        )
        units = initializer_module._require_status(
            await api.get(f"/api/courses/{scope['course_id']}/units", teacher),
            200,
            "read partial physics units",
        )
        plan = initializer_module._require_status(
            await api.get(f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan", teacher),
            200,
            "read partial physics plan",
        )
        activation = initializer_module._require_status(
            await api.get(f"/api/learning-evidence/rules/activation?course_id={scope['course_id']}", teacher),
            200,
            "read partial physics activation",
        )
        audit_page = initializer_module._require_status(
            await api.get("/api/admin/audit-logs?limit=100&offset=0", admin),
            200,
            "read partial non-login audits",
        )
        non_login_audits = [item for item in audit_page["items"] if not str(item.get("action", "")).startswith("auth.")]
        audits = initializer_module._require_status(
            await api.get(
                f"/api/admin/audit-logs?action=course.status.patch&resource_id={scope['course_id']}&limit=100&offset=0",
                admin,
            ),
            200,
            "read partial course status audits",
        )
        return {
            "courses": courses,
            "units": units,
            "plan": plan,
            "rules": rules,
            "activation": activation,
            "audits": audits,
            "non_login_audits": non_login_audits,
        }


def test_existing_published_course_without_activation_fails_before_fresh_catalog_side_effects(local_demo_environment):
    scope = asyncio.run(_seed_existing_physics_without_activation())
    before = asyncio.run(_read_physics_preflight_state(scope))

    with pytest.raises(DemoInitializationError, match="existing evidence rule activation or binding drifted for physics"):
        asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))

    after = asyncio.run(_read_physics_preflight_state(scope))
    assert after == before
    assert len(after["courses"]) == 1
    assert len(after["units"]) == 3
    assert after["plan"] == before["plan"]
    assert len(after["rules"]) == 1
    assert after["activation"] == before["activation"]
    assert after["audits"] == before["audits"]
    assert after["non_login_audits"] == before["non_login_audits"]


def test_existing_release_plan_drift_is_fail_closed(local_demo_environment):
    first = asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))

    async def drift_plan() -> None:
        async with DemoApi() as api:
            teacher = await api.login(
                "astra_demo_teacher",
                DEMO_PASSWORDS["astra_demo_teacher"],
                "teacher",
                "演示教师",
            )
            courses = initializer_module._require_status(
                await api.get(f"/api/courses?school_id={first['school_id']}", teacher),
                200,
                "read demo courses for drift test",
            )
            course = next(item for item in courses if item["course_key"] == "mathematics")
            path = f"/api/courses/{course['id']}/classes/{first['class_id']}/release-plan"
            plan = initializer_module._require_status(await api.get(path, teacher), 200, "read math plan for drift test")
            drifted = await api.patch(
                path,
                teacher,
                {
                    "expected_version": plan["plan_version"],
                    "items": [{"course_unit_id": item["course_unit_id"], "release_mode": "open"} for item in plan["items"]],
                    "reason": "external drift test",
                },
            )
            initializer_module._require_status(drifted, 200, "drift math plan")
            return initializer_module._require_status(await api.get(path, teacher), 200, "read drifted math plan")

    drifted = asyncio.run(drift_plan())
    with pytest.raises(DemoInitializationError, match="release plan drifted for mathematics"):
        asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))

    async def read_plan() -> dict:
        async with DemoApi() as api:
            teacher = await api.login("astra_demo_teacher", DEMO_PASSWORDS["astra_demo_teacher"], "teacher", "演示教师")
            courses = initializer_module._require_status(await api.get(f"/api/courses?school_id={first['school_id']}", teacher), 200, "reread courses")
            course = next(item for item in courses if item["course_key"] == "mathematics")
            return initializer_module._require_status(
                await api.get(f"/api/courses/{course['id']}/classes/{first['class_id']}/release-plan", teacher),
                200,
                "reread drifted plan",
            )

    assert asyncio.run(read_plan()) == drifted


def test_existing_published_course_status_drift_is_rejected_without_patch_or_audit(local_demo_environment):
    first = asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))

    async def drift_status() -> dict:
        async with DemoApi() as api:
            admin = await api.login("astra_demo_admin", DEMO_PASSWORDS["astra_demo_admin"], "admin", "演示管理员")
            teacher = await api.login("astra_demo_teacher", DEMO_PASSWORDS["astra_demo_teacher"], "teacher", "演示教师")
            courses = initializer_module._require_status(await api.get(f"/api/courses?school_id={first['school_id']}", teacher), 200, "read courses")
            physics = next(item for item in courses if item["course_key"] == "physics")
            changed = await api.patch(
                f"/api/courses/{physics['id']}/status",
                admin,
                {"expected_status": "published", "status": "draft", "reason": "external status drift test"},
            )
            initializer_module._require_status(changed, 200, "drift physics status")
            courses_after = initializer_module._require_status(
                await api.get(f"/api/courses?school_id={first['school_id']}", teacher),
                200,
                "read drifted courses",
            )
            physics_after = next(item for item in courses_after if item["course_key"] == "physics")
            audits = initializer_module._require_status(
                await api.get(f"/api/admin/audit-logs?action=course.status.patch&resource_id={physics['id']}&limit=100&offset=0", admin),
                200,
                "read drift audit",
            )
            return {"physics": physics_after, "audits": audits}

    drifted = asyncio.run(drift_status())
    with pytest.raises(DemoInitializationError, match="demo course status drifted for physics"):
        asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))

    async def read_status() -> dict:
        async with DemoApi() as api:
            admin = await api.login("astra_demo_admin", DEMO_PASSWORDS["astra_demo_admin"], "admin", "演示管理员")
            teacher = await api.login("astra_demo_teacher", DEMO_PASSWORDS["astra_demo_teacher"], "teacher", "演示教师")
            courses = initializer_module._require_status(await api.get(f"/api/courses?school_id={first['school_id']}", teacher), 200, "reread courses")
            physics = next(item for item in courses if item["course_key"] == "physics")
            audits = initializer_module._require_status(
                await api.get(f"/api/admin/audit-logs?action=course.status.patch&resource_id={physics['id']}&limit=100&offset=0", admin),
                200,
                "reread drift audits",
            )
            return {"physics": physics, "audits": audits}

    after = asyncio.run(read_status())
    assert after == drifted
    assert after["physics"]["status"] == "draft"


def test_missing_existing_rule_and_display_name_drift_are_fail_closed(local_demo_environment):
    first = asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        rule = db.scalar(select(LearningCompletionRule).order_by(LearningCompletionRule.id))
        assert rule is not None
        rule_id = rule.id
        for model in (LearningResumeProjection, LearningActivityProjection, LearningEvidenceEvent, LearningRuleClassBinding):
            db.execute(delete(model).where(model.rule_id == rule_id))
        db.execute(delete(LearningRuleActivation).where(LearningRuleActivation.active_rule_id == rule_id))
        db.execute(delete(LearningCompletionRule).where(LearningCompletionRule.id == rule_id))
        db.commit()

    with pytest.raises(DemoInitializationError, match="evidence rule is missing for existing course"):
        asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))


def test_external_display_name_drift_is_rejected_without_repair(local_demo_environment):
    first = asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))

    async def drift_display_name() -> None:
        async with DemoApi() as api:
            admin = await api.login("astra_demo_admin", DEMO_PASSWORDS["astra_demo_admin"], "admin", "演示管理员")
            teacher_id = first["users"]["teacher"]["id"]
            response = await api.patch(
                f"/api/admin/users/{teacher_id}",
                admin,
                {"display_name": "外部漂移教师"},
            )
            initializer_module._require_status(response, 200, "drift teacher display name")

    asyncio.run(drift_display_name())
    with pytest.raises(DemoInitializationError, match="verified identity drifted"):
        asyncio.run(initialize_demo_data(credentials=_demo_actor_passwords()))
