"""Synthetic evidence profiles aligned with the current frontend producers.

The profile map is the single source of truth for demo producer mode and
course-fact availability. Payloads are deterministic fixtures for local
preview only; they are not browser captures or claims about real learners.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


PRODUCER_MODE_FRONTEND_PRECISE = "frontend_precise"
PRODUCER_MODE_FRONTEND_SHALLOW = "frontend_shallow"
PRODUCER_MODE_GENERIC_FALLBACK = "generic_lifecycle_fallback"

COURSE_FACT_STATUS_PRECISE = "precise"
COURSE_FACT_STATUS_SHALLOW = "shallow"
COURSE_FACT_STATUS_UNAVAILABLE = "unavailable"

DEMO_FIXTURE_PROVENANCE = "deterministic_synthetic_not_browser_capture"
DEMO_TEACHER_CORRECTION_REASON = "Invalidate one synthetic attempt to verify recovery."


@dataclass(frozen=True)
class DemoEvidenceProducerProfile:
    activity_key: str
    producer_mode: str
    course_fact_status: str
    surface: str | None


DEMO_EVIDENCE_PROFILES = (
    DemoEvidenceProducerProfile(
        activity_key="physics.mechanics",
        producer_mode=PRODUCER_MODE_FRONTEND_PRECISE,
        course_fact_status=COURSE_FACT_STATUS_PRECISE,
        surface="englab",
    ),
    DemoEvidenceProducerProfile(
        activity_key="control-flow.loop-boundary",
        producer_mode=PRODUCER_MODE_FRONTEND_SHALLOW,
        course_fact_status=COURSE_FACT_STATUS_SHALLOW,
        surface="code-space",
    ),
    DemoEvidenceProducerProfile(
        activity_key="mathematics.derivative-application",
        producer_mode=PRODUCER_MODE_GENERIC_FALLBACK,
        course_fact_status=COURSE_FACT_STATUS_UNAVAILABLE,
        surface=None,
    ),
    DemoEvidenceProducerProfile(
        activity_key="debugging-testing.minimal-case",
        producer_mode=PRODUCER_MODE_GENERIC_FALLBACK,
        course_fact_status=COURSE_FACT_STATUS_UNAVAILABLE,
        surface=None,
    ),
    DemoEvidenceProducerProfile(
        activity_key="engineering.load-path",
        producer_mode=PRODUCER_MODE_GENERIC_FALLBACK,
        course_fact_status=COURSE_FACT_STATUS_UNAVAILABLE,
        surface=None,
    ),
    DemoEvidenceProducerProfile(
        activity_key="humanities.claim-review",
        producer_mode=PRODUCER_MODE_GENERIC_FALLBACK,
        course_fact_status=COURSE_FACT_STATUS_UNAVAILABLE,
        surface=None,
    ),
)

DEMO_EVIDENCE_PROFILE_BY_ACTIVITY = {
    profile.activity_key: profile
    for profile in DEMO_EVIDENCE_PROFILES
}


def _shared_activity_payload(
    profile: DemoEvidenceProducerProfile,
    event_type: str,
) -> dict[str, Any]:
    if profile.surface is None:
        raise ValueError(f"{profile.activity_key} does not have a shared Activity surface")
    if event_type == "started":
        return {"cursor": {"surface": profile.surface, "stage": "entered"}}
    if event_type == "explained":
        return {
            "artifact": {
                "kind": "claim-evidence-link",
                "value": "claim-supported",
            },
            "cursor": {"stage": "explained"},
        }
    raise ValueError(f"unsupported shared Activity event type: {event_type}")


def _physics_payload(event_type: str, index: int, profile: DemoEvidenceProducerProfile) -> dict[str, Any]:
    if event_type in {"started", "explained"}:
        return _shared_activity_payload(profile, event_type)
    if event_type == "predicted":
        return {
            "prediction": {
                "expects_higher_080": True,
                "expected_height_multiplier": 4,
                "reason_size": 24,
            },
            "cursor": {"stage": "prediction-recorded"},
        }
    if event_type == "attempted":
        # The third attempt deliberately replays the existing e=.40 producer
        # shape. It preserves two valid conditions after one teacher correction
        # without inventing a third experiment.
        attempts = (
            (40, 0.40, 32.0, 0.16),
            (80, 0.80, 128.0, 0.64),
            (40, 0.40, 32.0, 0.16),
        )
        if index < 1 or index > len(attempts):
            raise ValueError("physics demo supports exactly three synthetic attempts")
        trial, restitution, rebound_height, height_ratio = attempts[index - 1]
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
    if event_type == "corrected":
        return {
            "correction": {
                "height_follows_e_squared": True,
                "model_limit_acknowledged": True,
                "ratio_040": 0.16,
                "ratio_080": 0.64,
            },
            "cursor": {"stage": "after-repair"},
        }
    raise ValueError(f"unsupported physics demo event type: {event_type}")


def _control_flow_payload(
    event_type: str,
    index: int,
    profile: DemoEvidenceProducerProfile,
) -> dict[str, Any]:
    if event_type in {"started", "explained"}:
        return _shared_activity_payload(profile, event_type)
    if event_type == "predicted":
        return {
            "prediction": {"choice": "prediction-recorded"},
            "cursor": {"stage": "before-browser-precheck"},
        }
    if event_type == "attempted":
        attempts = (
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
        )
        if index < 1 or index > len(attempts):
            raise ValueError("control-flow demo supports exactly three synthetic attempts")
        return attempts[index - 1]
    if event_type == "corrected":
        return {
            "correction": {
                "kind": "code-revision",
                "result": "public-check-pass",
            },
            "cursor": {"stage": "after-repair"},
        }
    raise ValueError(f"unsupported control-flow demo event type: {event_type}")


def _generic_lifecycle_payload(event_type: str, index: int) -> dict[str, Any]:
    if event_type == "started":
        return {"cursor": {"stage": "entered"}}
    if event_type == "predicted":
        return {
            "prediction": {"choice": "synthetic-lifecycle-recorded"},
            "cursor": {"stage": "predicted"},
        }
    if event_type == "attempted":
        return {
            "operation": "synthetic_lifecycle_attempt",
            "cursor": {
                "stage": "attempt-recorded",
                "attempt_index": index,
            },
        }
    if event_type == "corrected":
        return {
            "correction": {"kind": "synthetic-lifecycle-revision"},
            "cursor": {"stage": "corrected"},
        }
    if event_type == "explained":
        return {
            "artifact": {
                "kind": "synthetic-lifecycle-explanation",
                "status": "recorded",
            },
            "cursor": {"stage": "explained"},
        }
    raise ValueError(f"unsupported generic lifecycle event type: {event_type}")


def build_demo_evidence_payload(
    profile: DemoEvidenceProducerProfile,
    event_type: str,
    index: int,
) -> dict[str, Any]:
    """Build one deterministic payload without inferring mode from its text."""

    if index < 1:
        raise ValueError("demo evidence index must be positive")
    if profile.producer_mode == PRODUCER_MODE_FRONTEND_PRECISE:
        return _physics_payload(event_type, index, profile)
    if profile.producer_mode == PRODUCER_MODE_FRONTEND_SHALLOW:
        return _control_flow_payload(event_type, index, profile)
    if profile.producer_mode == PRODUCER_MODE_GENERIC_FALLBACK:
        return _generic_lifecycle_payload(event_type, index)
    raise ValueError(f"unsupported demo producer mode: {profile.producer_mode}")


if len(DEMO_EVIDENCE_PROFILE_BY_ACTIVITY) != len(DEMO_EVIDENCE_PROFILES):
    raise AssertionError("demo evidence activity keys must be unique")
