from __future__ import annotations

import math
from typing import Any


_MAX_FACTS = 12
_MISSING = object()

_PHYSICS_ACTIVITY_KEY = "physics.mechanics"
_CONTROL_FLOW_ACTIVITY_KEY = "control-flow.loop-boundary"
_SUPPORTED_SCHEMA_VERSION = 1
_OUTER_ONLY_EVENT_TYPES = {"started", "completed", "transferred"}

_PHYSICS_PATHS_BY_EVENT_TYPE = {
    "predicted": (
        ("prediction", "expects_higher_080"),
        ("prediction", "expected_height_multiplier"),
        ("prediction", "reason_size"),
        ("cursor", "stage"),
    ),
    "attempted": (
        ("operation",),
        ("cursor", "stage"),
        ("cursor", "trial"),
        ("cursor", "preset", "restitution"),
        ("cursor", "preset", "drop_height_px"),
        ("cursor", "preset", "gravity_px_s2"),
        ("cursor", "preset", "radius_px"),
        ("cursor", "preset", "horizontal_velocity_px_s"),
        ("cursor", "preset", "damping"),
        ("cursor", "observation", "first_rebound_height_px"),
        ("cursor", "observation", "height_ratio"),
    ),
    "corrected": (
        ("correction", "height_follows_e_squared"),
        ("correction", "model_limit_acknowledged"),
        ("correction", "ratio_040"),
        ("correction", "ratio_080"),
        ("cursor", "stage"),
    ),
    "explained": (
        ("artifact", "kind"),
        ("artifact", "value"),
        ("cursor", "stage"),
    ),
}

_CONTROL_FLOW_PATHS_BY_EVENT_TYPE = {
    "predicted": (
        ("prediction", "choice"),
        ("cursor", "stage"),
    ),
    "attempted": (
        ("operation",),
        ("reported_correct",),
        ("cursor", "runner"),
        ("cursor", "judge"),
    ),
    "corrected": (
        ("correction", "kind"),
        ("correction", "result"),
        ("cursor", "stage"),
    ),
    "explained": (
        ("artifact", "kind"),
        ("artifact", "value"),
        ("cursor", "stage"),
    ),
}


class _FactBuilder:
    def __init__(self, *, truncated: bool = False):
        self.facts: dict[str, str] = {}
        self.truncated = truncated

    def reject(self) -> None:
        self.truncated = True

    def append(self, path: tuple[str, ...], label: str) -> None:
        key = ".".join(path)
        if key in self.facts:
            self.truncated = True
            return
        if len(self.facts) >= _MAX_FACTS:
            self.truncated = True
            return
        self.facts[key] = label

    def result(self) -> dict[str, Any]:
        return {"facts": self.facts, "truncated": self.truncated}


def teacher_evidence_facts(
    *,
    activity_key: str,
    event_schema_version: int,
    event_type: str,
    evidence_json: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return the bounded, course-specific facts visible to a teacher.

    The projector is intentionally pure. It only consumes the persisted event
    identity and evidence object, never reads a model, database, request, or
    course runtime.
    """

    if (
        not isinstance(activity_key, str)
        or not isinstance(event_type, str)
        or type(event_schema_version) is not int
        or event_schema_version != _SUPPORTED_SCHEMA_VERSION
        or activity_key not in {_PHYSICS_ACTIVITY_KEY, _CONTROL_FLOW_ACTIVITY_KEY}
    ):
        return {"facts": {}, "truncated": True}
    if not isinstance(evidence_json, dict):
        return {"facts": {}, "truncated": True}

    if event_type in _OUTER_ONLY_EVENT_TYPES:
        return {
            "facts": {},
            "truncated": bool(_leaf_paths(evidence_json)),
        }

    if activity_key == _PHYSICS_ACTIVITY_KEY:
        paths = _PHYSICS_PATHS_BY_EVENT_TYPE.get(event_type)
        projector = {
            "predicted": _project_physics_prediction,
            "attempted": _project_physics_attempt,
            "corrected": _project_physics_correction,
            "explained": _project_shared_explanation,
        }.get(event_type)
    else:
        paths = _CONTROL_FLOW_PATHS_BY_EVENT_TYPE.get(event_type)
        projector = {
            "predicted": _project_control_flow_prediction,
            "attempted": _project_control_flow_attempt,
            "corrected": _project_control_flow_correction,
            "explained": _project_shared_explanation,
        }.get(event_type)

    if paths is None or projector is None:
        return {"facts": {}, "truncated": True}

    observed_paths = _leaf_paths(evidence_json)
    allowed_paths = set(paths)
    builder = _FactBuilder(
        truncated=any(path not in allowed_paths for path in observed_paths)
    )
    projector(evidence_json, builder)
    return builder.result()


def _project_physics_prediction(
    evidence: dict[str, Any],
    builder: _FactBuilder,
) -> None:
    _append_bool_label(
        evidence,
        builder,
        ("prediction", "expects_higher_080"),
        {
            True: "预测 e=0.80 反弹更高",
            False: "未选择 e=0.80 反弹更高（不代表选择 e=0.40）",
        },
    )
    _append_number_label(
        evidence,
        builder,
        ("prediction", "expected_height_multiplier"),
        integer=True,
        allowed=(0, 2, 4),
        labels={
            0: "预测无法仅凭题述判断倍数",
            2: "预测约 2 倍",
            4: "预测约 4 倍",
        },
    )
    _append_number_label(
        evidence,
        builder,
        ("prediction", "reason_size"),
        integer=True,
        minimum=4,
        maximum=160,
        formatter=lambda value: f"已写预测理由（{int(value)} 字）",
    )
    _append_enum_label(
        evidence,
        builder,
        ("cursor", "stage"),
        {"prediction-recorded": "预测已记录"},
    )


def _project_physics_attempt(
    evidence: dict[str, Any],
    builder: _FactBuilder,
) -> None:
    operation = _required_enum(
        evidence,
        ("operation",),
        {"restitution_adjustment"},
    )
    stage = _required_enum(
        evidence,
        ("cursor", "stage"),
        {"after-observation"},
    )
    trial = _required_number(
        evidence,
        ("cursor", "trial"),
        integer=True,
        allowed=(40, 80),
    )
    restitution = _required_number(
        evidence,
        ("cursor", "preset", "restitution"),
        minimum=0.4,
        maximum=0.8,
        decimals=2,
        allowed=(0.4, 0.8),
    )
    drop_height = _required_number(
        evidence,
        ("cursor", "preset", "drop_height_px"),
        integer=True,
        allowed=(200,),
    )
    gravity = _required_number(
        evidence,
        ("cursor", "preset", "gravity_px_s2"),
        integer=True,
        allowed=(980,),
    )
    radius = _required_number(
        evidence,
        ("cursor", "preset", "radius_px"),
        integer=True,
        allowed=(16,),
    )
    horizontal_velocity = _required_number(
        evidence,
        ("cursor", "preset", "horizontal_velocity_px_s"),
        integer=True,
        allowed=(0,),
    )
    damping = _required_number(
        evidence,
        ("cursor", "preset", "damping"),
        minimum=0,
        maximum=0,
        allowed=(0,),
    )
    rebound_height = _required_number(
        evidence,
        ("cursor", "observation", "first_rebound_height_px"),
        minimum=0,
        maximum=200,
        decimals=1,
    )
    height_ratio = _required_number(
        evidence,
        ("cursor", "observation", "height_ratio"),
        minimum=0,
        maximum=1,
        decimals=2,
    )
    values = (
        operation,
        stage,
        trial,
        restitution,
        drop_height,
        gravity,
        radius,
        horizontal_velocity,
        damping,
        rebound_height,
        height_ratio,
    )
    if any(value is _MISSING for value in values):
        builder.reject()
        return
    if (
        (trial == 40 and not _number_equal(restitution, 0.4))
        or (trial == 80 and not _number_equal(restitution, 0.8))
        or abs(height_ratio - round(rebound_height / 200, 2)) > 0.01 + 1e-9
    ):
        builder.reject()
        return

    builder.append(("operation",), "运行恢复系数受控试验")
    builder.append(("cursor", "stage"), "第一次反弹观察已记录")
    builder.append(
        ("cursor", "trial"),
        "试验 e=0.40" if trial == 40 else "试验 e=0.80",
    )
    builder.append(
        ("cursor", "preset", "restitution"),
        f"恢复系数 e={restitution:.2f}",
    )
    builder.append(
        ("cursor", "preset", "drop_height_px"),
        "固定落高 H=200 px",
    )
    builder.append(
        ("cursor", "preset", "gravity_px_s2"),
        "固定重力 980 px/s²",
    )
    builder.append(
        ("cursor", "preset", "radius_px"),
        "固定半径 16 px",
    )
    builder.append(
        ("cursor", "preset", "horizontal_velocity_px_s"),
        "固定水平初速度 0 px/s",
    )
    builder.append(
        ("cursor", "preset", "damping"),
        "固定教学阻尼 0",
    )
    builder.append(
        ("cursor", "observation", "first_rebound_height_px"),
        f"第一次反弹高度 h={rebound_height:.1f} px",
    )
    builder.append(
        ("cursor", "observation", "height_ratio"),
        f"h/H={height_ratio:.2f}",
    )


def _project_physics_correction(
    evidence: dict[str, Any],
    builder: _FactBuilder,
) -> None:
    height_follows_e_squared = _required_bool(
        evidence,
        ("correction", "height_follows_e_squared"),
        allowed=(True,),
    )
    model_limit_acknowledged = _required_bool(
        evidence,
        ("correction", "model_limit_acknowledged"),
        allowed=(True,),
    )
    ratio_040 = _required_number(
        evidence,
        ("correction", "ratio_040"),
        minimum=0,
        maximum=1,
        decimals=2,
    )
    ratio_080 = _required_number(
        evidence,
        ("correction", "ratio_080"),
        minimum=0,
        maximum=1,
        decimals=2,
    )
    stage = _required_enum(
        evidence,
        ("cursor", "stage"),
        {"after-repair"},
    )
    values = (
        height_follows_e_squared,
        model_limit_acknowledged,
        ratio_040,
        ratio_080,
        stage,
    )
    if any(value is _MISSING for value in values) or ratio_080 <= ratio_040:
        builder.reject()
        return

    builder.append(
        ("correction", "height_follows_e_squared"),
        "已修正为 h/H≈e²",
    )
    builder.append(
        ("correction", "model_limit_acknowledged"),
        "已确认理想受控条件",
    )
    builder.append(
        ("correction", "ratio_040"),
        f"e=0.40 时 h/H={ratio_040:.2f}",
    )
    builder.append(
        ("correction", "ratio_080"),
        f"e=0.80 时 h/H={ratio_080:.2f}",
    )
    builder.append(("cursor", "stage"), "修正已记录")


def _project_control_flow_prediction(
    evidence: dict[str, Any],
    builder: _FactBuilder,
) -> None:
    _append_enum_label(
        evidence,
        builder,
        ("prediction", "choice"),
        {"prediction-recorded": "已记录预测（正文不可见）"},
    )
    _append_enum_label(
        evidence,
        builder,
        ("cursor", "stage"),
        {"before-browser-precheck": "浏览器预检前"},
    )


def _project_control_flow_attempt(
    evidence: dict[str, Any],
    builder: _FactBuilder,
) -> None:
    operation = _required_enum(
        evidence,
        ("operation",),
        {"browser_precheck", "formal_oj_submission"},
    )
    if operation is _MISSING:
        builder.reject()
        return

    reported_correct = _value_at_path(evidence, ("reported_correct",))
    runner = _value_at_path(evidence, ("cursor", "runner"))
    judge = _value_at_path(evidence, ("cursor", "judge"))

    if operation == "browser_precheck":
        if judge is not _MISSING or type(reported_correct) is not bool:
            builder.reject()
            return
        if (
            not isinstance(runner, str)
            or runner
            not in {
                "browser_precheck_finished",
                "browser_runtime_error",
                "runner_unavailable",
            }
        ):
            builder.reject()
            return
        if runner in {"browser_runtime_error", "runner_unavailable"} and reported_correct:
            builder.reject()
            return

        builder.append(("operation",), "运行浏览器预检")
        if runner == "browser_precheck_finished":
            builder.append(
                ("reported_correct",),
                (
                    "浏览器公开样例匹配"
                    if reported_correct
                    else "浏览器公开样例未匹配"
                ),
            )
        else:
            builder.reject()
        builder.append(
            ("cursor", "runner"),
            {
                "browser_precheck_finished": "浏览器预检已完成",
                "browser_runtime_error": "浏览器练习运行失败",
                "runner_unavailable": (
                    "浏览器练习运行失败（旧 producer 编码，不是正式 runner 状态）"
                ),
            }[runner],
        )
        return

    if (
        reported_correct is not _MISSING
        or runner is not _MISSING
        or not isinstance(judge, str)
        or judge not in {"judge_result_received", "judge_result_unconfirmed"}
    ):
        builder.reject()
        return
    builder.append(("operation",), "发起正式提交")
    builder.append(
        ("cursor", "judge"),
        {
            "judge_result_received": "正式提交响应已收到（结论另读）",
            "judge_result_unconfirmed": "正式提交结果尚未确认",
        }[judge],
    )


def _project_control_flow_correction(
    evidence: dict[str, Any],
    builder: _FactBuilder,
) -> None:
    _append_enum_label(
        evidence,
        builder,
        ("correction", "kind"),
        {"code-revision": "学生修改了代码"},
    )
    _append_enum_label(
        evidence,
        builder,
        ("correction", "result"),
        {
            "public-check-pass": "修订后浏览器公开样例匹配",
            "public-check-needs-review": "修订后浏览器公开样例仍需检查",
        },
    )
    _append_enum_label(
        evidence,
        builder,
        ("cursor", "stage"),
        {"after-repair": "修订后"},
    )


def _project_shared_explanation(
    evidence: dict[str, Any],
    builder: _FactBuilder,
) -> None:
    _append_enum_label(
        evidence,
        builder,
        ("artifact", "kind"),
        {"claim-evidence-link": "已提交结构化解释"},
    )
    _append_enum_label(
        evidence,
        builder,
        ("artifact", "value"),
        {
            "claim-supported": "学生选择：证据支持判断",
            "claim-needs-review": "学生选择：判断仍需复核",
        },
    )
    _append_enum_label(
        evidence,
        builder,
        ("cursor", "stage"),
        {"explained": "解释已记录"},
    )


def _append_enum_label(
    evidence: dict[str, Any],
    builder: _FactBuilder,
    path: tuple[str, ...],
    labels: dict[str, str],
) -> None:
    value = _value_at_path(evidence, path)
    if value is _MISSING:
        return
    if not isinstance(value, str) or value not in labels:
        builder.reject()
        return
    builder.append(path, labels[value])


def _append_bool_label(
    evidence: dict[str, Any],
    builder: _FactBuilder,
    path: tuple[str, ...],
    labels: dict[bool, str],
) -> None:
    value = _value_at_path(evidence, path)
    if value is _MISSING:
        return
    if type(value) is not bool or value not in labels:
        builder.reject()
        return
    builder.append(path, labels[value])


def _append_number_label(
    evidence: dict[str, Any],
    builder: _FactBuilder,
    path: tuple[str, ...],
    *,
    integer: bool = False,
    minimum: int | float | None = None,
    maximum: int | float | None = None,
    decimals: int | None = None,
    allowed: tuple[int | float, ...] | None = None,
    labels: dict[int | float, str] | None = None,
    formatter=None,
) -> None:
    value = _required_number(
        evidence,
        path,
        integer=integer,
        minimum=minimum,
        maximum=maximum,
        decimals=decimals,
        allowed=allowed,
    )
    if value is _MISSING:
        if _value_at_path(evidence, path) is not _MISSING:
            builder.reject()
        return
    if labels is not None:
        label = labels[value]
    elif formatter is not None:
        label = formatter(value)
    else:
        raise RuntimeError("Number fact requires labels or formatter")
    builder.append(path, label)


def _required_enum(
    evidence: dict[str, Any],
    path: tuple[str, ...],
    allowed: set[str],
) -> str | object:
    value = _value_at_path(evidence, path)
    if not isinstance(value, str) or value not in allowed:
        return _MISSING
    return value


def _required_bool(
    evidence: dict[str, Any],
    path: tuple[str, ...],
    *,
    allowed: tuple[bool, ...],
) -> bool | object:
    value = _value_at_path(evidence, path)
    if type(value) is not bool or value not in allowed:
        return _MISSING
    return value


def _required_number(
    evidence: dict[str, Any],
    path: tuple[str, ...],
    *,
    integer: bool = False,
    minimum: int | float | None = None,
    maximum: int | float | None = None,
    decimals: int | None = None,
    allowed: tuple[int | float, ...] | None = None,
) -> int | float | object:
    value = _value_at_path(evidence, path)
    if type(value) not in {int, float}:
        return _MISSING
    if isinstance(value, float) and not math.isfinite(value):
        return _MISSING
    if minimum is not None and value < minimum:
        return _MISSING
    if maximum is not None and value > maximum:
        return _MISSING
    if integer and value != int(value):
        return _MISSING
    if decimals is not None and abs(value - round(value, decimals)) > 1e-9:
        return _MISSING
    if allowed is not None:
        matched = next(
            (candidate for candidate in allowed if _number_equal(value, candidate)),
            _MISSING,
        )
        if matched is _MISSING:
            return _MISSING
        value = matched
    if integer:
        return int(value)
    return float(round(value, decimals)) if decimals is not None else value


def _number_equal(left: int | float, right: int | float) -> bool:
    return abs(left - right) <= 1e-9


def _value_at_path(
    evidence: dict[str, Any],
    path: tuple[str, ...],
) -> Any:
    value: Any = evidence
    for component in path:
        if not isinstance(value, dict) or component not in value:
            return _MISSING
        value = value[component]
    return value


def _leaf_paths(
    value: Any,
    path: tuple[str, ...] = (),
) -> set[tuple[str, ...]]:
    if isinstance(value, dict):
        if not value:
            return {path} if path else set()
        paths: set[tuple[str, ...]] = set()
        for key, item in value.items():
            paths.update(_leaf_paths(item, (*path, str(key))))
        return paths
    if isinstance(value, list):
        if not value:
            return {path}
        paths: set[tuple[str, ...]] = set()
        for index, item in enumerate(value):
            paths.update(_leaf_paths(item, (*path, str(index))))
        return paths
    return {path}
