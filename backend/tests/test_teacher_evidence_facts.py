from __future__ import annotations

from copy import deepcopy
import json

import pytest

from app.services.teacher_evidence_facts import teacher_evidence_facts


def _project(
    activity_key: str,
    event_type: str,
    evidence: dict,
    *,
    schema_version: int = 1,
) -> dict:
    return teacher_evidence_facts(
        activity_key=activity_key,
        event_schema_version=schema_version,
        event_type=event_type,
        evidence_json=evidence,
    )


def _physics_attempt(
    *,
    trial: int = 80,
    restitution: float = 0.8,
    rebound_height: float = 122.0,
    height_ratio: float = 0.61,
) -> dict:
    return {
        "operation": "restitution_adjustment",
        "cursor": {
            "stage": "after-observation",
            "trial": trial,
            "preset": {
                "restitution": restitution,
                "drop_height_px": 200,
                "gravity_px_s2": 980,
                "radius_px": 16,
                "horizontal_velocity_px_s": 0,
                "damping": 0,
            },
            "observation": {
                "first_rebound_height_px": rebound_height,
                "height_ratio": height_ratio,
            },
        },
    }


def _physics_correction() -> dict:
    return {
        "correction": {
            "height_follows_e_squared": True,
            "model_limit_acknowledged": True,
            "ratio_040": 0.17,
            "ratio_080": 0.61,
        },
        "cursor": {"stage": "after-repair"},
    }


def test_physics_current_events_project_fixed_chinese_facts_in_table_order():
    predicted = _project(
        "physics.mechanics",
        "predicted",
        {
            "prediction": {
                "expects_higher_080": True,
                "expected_height_multiplier": 4,
                "reason_size": 28,
            },
            "cursor": {"stage": "prediction-recorded"},
        },
    )
    assert predicted == {
        "facts": {
            "prediction.expects_higher_080": "预测 e=0.80 反弹更高",
            "prediction.expected_height_multiplier": "预测约 4 倍",
            "prediction.reason_size": "已写预测理由（28 字）",
            "cursor.stage": "预测已记录",
        },
        "truncated": False,
    }

    attempted = _project(
        "physics.mechanics",
        "attempted",
        _physics_attempt(),
    )
    assert attempted["truncated"] is False
    assert list(attempted["facts"]) == [
        "operation",
        "cursor.stage",
        "cursor.trial",
        "cursor.preset.restitution",
        "cursor.preset.drop_height_px",
        "cursor.preset.gravity_px_s2",
        "cursor.preset.radius_px",
        "cursor.preset.horizontal_velocity_px_s",
        "cursor.preset.damping",
        "cursor.observation.first_rebound_height_px",
        "cursor.observation.height_ratio",
    ]
    assert attempted["facts"]["cursor.preset.restitution"] == "恢复系数 e=0.80"
    assert (
        attempted["facts"]["cursor.observation.first_rebound_height_px"]
        == "第一次反弹高度 h=122.0 px"
    )
    assert attempted["facts"]["cursor.observation.height_ratio"] == "h/H=0.61"
    assert len(attempted["facts"]) == 11

    corrected = _project(
        "physics.mechanics",
        "corrected",
        _physics_correction(),
    )
    assert corrected == {
        "facts": {
            "correction.height_follows_e_squared": "已修正为 h/H≈e²",
            "correction.model_limit_acknowledged": "已确认理想受控条件",
            "correction.ratio_040": "e=0.40 时 h/H=0.17",
            "correction.ratio_080": "e=0.80 时 h/H=0.61",
            "cursor.stage": "修正已记录",
        },
        "truncated": False,
    }

    explained = _project(
        "physics.mechanics",
        "explained",
        {
            "artifact": {
                "kind": "claim-evidence-link",
                "value": "claim-supported",
            },
            "cursor": {"stage": "explained"},
        },
    )
    assert explained == {
        "facts": {
            "artifact.kind": "已提交结构化解释",
            "artifact.value": "学生选择：证据支持判断",
            "cursor.stage": "解释已记录",
        },
        "truncated": False,
    }


def test_physics_accepts_internally_consistent_observation_without_e_squared_rejudge():
    observation_080 = _project(
        "physics.mechanics",
        "attempted",
        _physics_attempt(
            trial=80,
            restitution=0.8,
            rebound_height=122.0,
            height_ratio=0.61,
        ),
    )
    observation_040 = _project(
        "physics.mechanics",
        "attempted",
        _physics_attempt(
            trial=40,
            restitution=0.4,
            rebound_height=32.0,
            height_ratio=0.16,
        ),
    )

    assert observation_080["truncated"] is False
    assert (
        observation_080["facts"]["cursor.observation.height_ratio"]
        == "h/H=0.61"
    )
    assert observation_040["truncated"] is False
    assert (
        observation_040["facts"]["cursor.observation.height_ratio"]
        == "h/H=0.16"
    )


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("cursor", "trial"), 40),
        (("cursor", "preset", "drop_height_px"), 201),
        (("cursor", "preset", "gravity_px_s2"), True),
        (("cursor", "observation", "first_rebound_height_px"), float("nan")),
        (("cursor", "observation", "first_rebound_height_px"), 200.1),
        (("cursor", "observation", "height_ratio"), 0.611),
        (("cursor", "observation", "height_ratio"), 0.59),
    ],
)
def test_physics_attempt_combination_and_numeric_failures_are_atomic(path, value):
    evidence = _physics_attempt()
    target = evidence
    for component in path[:-1]:
        target = target[component]
    target[path[-1]] = value

    summary = _project("physics.mechanics", "attempted", evidence)

    assert summary == {"facts": {}, "truncated": True}


def test_physics_attempt_missing_required_leaf_is_atomic():
    evidence = _physics_attempt()
    del evidence["cursor"]["preset"]["radius_px"]

    assert _project("physics.mechanics", "attempted", evidence) == {
        "facts": {},
        "truncated": True,
    }


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("correction", "height_follows_e_squared"), False),
        (("correction", "model_limit_acknowledged"), 1),
        (("correction", "ratio_040"), 0.611),
        (("correction", "ratio_080"), 1.01),
        (("correction", "ratio_080"), 0.16),
        (("cursor", "stage"), "student-private-stage"),
    ],
)
def test_physics_correction_combination_failures_are_atomic(path, value):
    evidence = _physics_correction()
    target = evidence
    for component in path[:-1]:
        target = target[component]
    target[path[-1]] = value

    assert _project("physics.mechanics", "corrected", evidence) == {
        "facts": {},
        "truncated": True,
    }


@pytest.mark.parametrize(
    ("reported_correct", "expected_label"),
    [
        (True, "浏览器公开样例匹配"),
        (False, "浏览器公开样例未匹配"),
    ],
)
def test_control_flow_finished_browser_precheck_projects_reported_bool(
    reported_correct,
    expected_label,
):
    summary = _project(
        "control-flow.loop-boundary",
        "attempted",
        {
            "operation": "browser_precheck",
            "reported_correct": reported_correct,
            "cursor": {"runner": "browser_precheck_finished"},
        },
    )

    assert summary == {
        "facts": {
            "operation": "运行浏览器预检",
            "reported_correct": expected_label,
            "cursor.runner": "浏览器预检已完成",
        },
        "truncated": False,
    }


@pytest.mark.parametrize(
    ("runner", "runner_label"),
    [
        ("browser_runtime_error", "浏览器练习运行失败"),
        (
            "runner_unavailable",
            "浏览器练习运行失败（旧 producer 编码，不是正式 runner 状态）",
        ),
    ],
)
def test_control_flow_runtime_failure_uses_false_only_for_shape_and_never_echoes_it(
    runner,
    runner_label,
):
    summary = _project(
        "control-flow.loop-boundary",
        "attempted",
        {
            "operation": "browser_precheck",
            "reported_correct": False,
            "cursor": {"runner": runner},
        },
    )

    assert summary == {
        "facts": {
            "operation": "运行浏览器预检",
            "cursor.runner": runner_label,
        },
        "truncated": True,
    }
    assert "未匹配" not in json.dumps(summary, ensure_ascii=False)


@pytest.mark.parametrize("runner", ["browser_runtime_error", "runner_unavailable"])
def test_control_flow_runtime_failure_with_true_is_rejected_atomically(runner):
    summary = _project(
        "control-flow.loop-boundary",
        "attempted",
        {
            "operation": "browser_precheck",
            "reported_correct": True,
            "cursor": {"runner": runner},
        },
    )

    assert summary == {"facts": {}, "truncated": True}


@pytest.mark.parametrize(
    "evidence",
    [
        {
            "operation": "browser_precheck",
            "cursor": {"runner": "browser_precheck_finished"},
        },
        {
            "operation": "browser_precheck",
            "reported_correct": 0,
            "cursor": {"runner": "browser_precheck_finished"},
        },
        {
            "operation": "browser_precheck",
            "reported_correct": False,
            "cursor": {"runner": "student-private-runner"},
        },
        {
            "operation": "browser_precheck",
            "reported_correct": False,
            "cursor": {
                "runner": "browser_precheck_finished",
                "judge": "judge_result_received",
            },
        },
    ],
)
def test_control_flow_browser_precheck_shape_failures_are_atomic(evidence):
    assert _project(
        "control-flow.loop-boundary",
        "attempted",
        evidence,
    ) == {"facts": {}, "truncated": True}


@pytest.mark.parametrize(
    ("judge", "label"),
    [
        ("judge_result_received", "正式提交响应已收到（结论另读）"),
        ("judge_result_unconfirmed", "正式提交结果尚未确认"),
    ],
)
def test_control_flow_formal_submission_only_projects_judge_receipt(judge, label):
    summary = _project(
        "control-flow.loop-boundary",
        "attempted",
        {
            "operation": "formal_oj_submission",
            "cursor": {"judge": judge},
        },
    )

    assert summary == {
        "facts": {
            "operation": "发起正式提交",
            "cursor.judge": label,
        },
        "truncated": False,
    }
    serialized = json.dumps(summary, ensure_ascii=False).lower()
    for forbidden in ("accepted", "runner", "completed"):
        assert forbidden not in serialized


def test_control_flow_formal_submission_rejects_browser_shape_atomically():
    summary = _project(
        "control-flow.loop-boundary",
        "attempted",
        {
            "operation": "formal_oj_submission",
            "reported_correct": False,
            "cursor": {
                "judge": "judge_result_received",
                "runner": "browser_precheck_finished",
            },
        },
    )

    assert summary == {"facts": {}, "truncated": True}


def test_control_flow_current_prediction_correction_and_explanation_are_bounded():
    prediction = _project(
        "control-flow.loop-boundary",
        "predicted",
        {
            "prediction": {"choice": "prediction-recorded"},
            "cursor": {"stage": "before-browser-precheck"},
        },
    )
    correction = _project(
        "control-flow.loop-boundary",
        "corrected",
        {
            "correction": {
                "kind": "code-revision",
                "result": "public-check-needs-review",
            },
            "cursor": {"stage": "after-repair"},
        },
    )
    explanation = _project(
        "control-flow.loop-boundary",
        "explained",
        {
            "artifact": {
                "kind": "claim-evidence-link",
                "value": "claim-needs-review",
            },
            "cursor": {"stage": "explained"},
        },
    )

    assert prediction["facts"] == {
        "prediction.choice": "已记录预测（正文不可见）",
        "cursor.stage": "浏览器预检前",
    }
    assert correction["facts"] == {
        "correction.kind": "学生修改了代码",
        "correction.result": "修订后浏览器公开样例仍需检查",
        "cursor.stage": "修订后",
    }
    assert explanation["facts"] == {
        "artifact.kind": "已提交结构化解释",
        "artifact.value": "学生选择：判断仍需复核",
        "cursor.stage": "解释已记录",
    }
    assert all(
        summary["truncated"] is False
        for summary in (prediction, correction, explanation)
    )


def test_control_flow_future_trace_is_never_projected_or_synthesized():
    summary = _project(
        "control-flow.loop-boundary",
        "attempted",
        {
            "operation": "browser_precheck",
            "reported_correct": True,
            "cursor": {
                "runner": "browser_precheck_finished",
                "trace": {
                    "operator_id": "lte",
                    "body_execution_count": 4,
                    "first_false_count": 4,
                    "output_id": "zero-one-two-three",
                },
            },
        },
    )

    assert summary["truncated"] is True
    assert set(summary["facts"]) == {
        "operation",
        "reported_correct",
        "cursor.runner",
    }
    serialized = json.dumps(summary, ensure_ascii=False).lower()
    for forbidden in ("operator", "body_execution", "first_false", "zero-one"):
        assert forbidden not in serialized


@pytest.mark.parametrize(
    "activity_key",
    [
        "mathematics.derivative-application",
        "debugging-testing.minimal-case",
        "engineering.load-path",
        "humanities.claim-review",
        "evidence.generic-foundation",
    ],
)
def test_unimplemented_and_unregistered_activities_have_honest_empty_fallback(
    activity_key,
):
    summary = _project(
        activity_key,
        "attempted",
        {
            "operation": "restitution_adjustment",
            "reported_correct": True,
            "cursor": {"observation": "looks-like-course-fact"},
        },
    )

    assert summary == {"facts": {}, "truncated": True}


def test_unknown_schema_event_and_outer_only_events_never_create_course_facts():
    physics = _physics_attempt()
    assert _project(
        "physics.mechanics",
        "attempted",
        physics,
        schema_version=2,
    ) == {"facts": {}, "truncated": True}
    assert _project("physics.mechanics", "unknown", physics) == {
        "facts": {},
        "truncated": True,
    }
    assert _project("physics.mechanics", "started", {}) == {
        "facts": {},
        "truncated": False,
    }
    assert _project(
        "physics.mechanics",
        "completed",
        {"source_ref": "student-private-source"},
    ) == {"facts": {}, "truncated": True}


def test_sensitive_strings_nested_raw_and_source_refs_never_echo():
    direct_source = "def solve_student_private(values): return values"
    jwt = "eyJhbGciOiJIUzI1NiJ9.student-private-signature"
    stripe_secret = "sk_live_51_student_private"
    api_key = "api-key-live-private-123456"
    pem = "-----BEGIN PRIVATE KEY----- student-private-pem"
    evidence = {
        "artifact": {
            "kind": "claim-evidence-link",
            "value": "claim-supported",
            "ref": stripe_secret,
            "source_code": direct_source,
            "nested": {
                "jwt": jwt,
                "api_key": api_key,
                "pem": pem,
            },
        },
        "cursor": {
            "stage": "explained",
            "source_ref": "student-private-source-ref",
        },
    }
    original = deepcopy(evidence)

    summary = _project("physics.mechanics", "explained", evidence)

    assert evidence == original
    assert summary["truncated"] is True
    assert summary["facts"] == {
        "artifact.kind": "已提交结构化解释",
        "artifact.value": "学生选择：证据支持判断",
        "cursor.stage": "解释已记录",
    }
    assert len(summary["facts"]) <= 12
    serialized = json.dumps(summary, ensure_ascii=False).lower()
    for forbidden in (
        "solve_student_private",
        "sk_live_",
        "eyjhb",
        "student-private-signature",
        "api-key-live",
        "begin private key",
        "student-private-pem",
        "source_ref",
        "value_type",
        "value_size",
    ):
        assert forbidden not in serialized
