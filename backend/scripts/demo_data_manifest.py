"""Stable, synthetic declarations for the local Astra demo.

This module deliberately contains no credentials, secrets, environment values, or
database details.  The initializer consumes these declarations through the
public HTTP contract only.
"""

from __future__ import annotations

from dataclasses import dataclass

from scripts.demo_evidence_profiles import DEMO_EVIDENCE_PROFILE_BY_ACTIVITY


@dataclass(frozen=True)
class DemoUnitSpec:
    key: str
    title: str
    content_slug: str | None = None

    @property
    def activity_key(self) -> str:
        return self.key


@dataclass(frozen=True)
class DemoCourseSpec:
    galaxy_key: str
    course_key: str
    title: str
    summary: str
    units: tuple[DemoUnitSpec, DemoUnitSpec, DemoUnitSpec]


@dataclass(frozen=True)
class RepresentativeCourseSpec:
    course_key: str
    open_unit_key: str
    locked_unit_key: str
    hidden_unit_key: str
    minimum_attempts: int

    @property
    def evidence_profile(self):
        return DEMO_EVIDENCE_PROFILE_BY_ACTIVITY[self.open_unit_key]


DEMO_ADMIN_USERNAME = "astra_demo_admin"
DEMO_TEACHER_USERNAME = "astra_demo_teacher"
DEMO_STUDENT_USERNAME = "astra_demo_student"
DEMO_PEER_TEACHER_USERNAME = "astra_demo_peer_teacher"
DEMO_PENDING_TEACHER_USERNAME = "astra_demo_pending_teacher"
DEMO_OPEN_STUDENT_USERNAME = "astra_demo_open_student"

DEMO_USERS = (
    (DEMO_ADMIN_USERNAME, "演示管理员", "admin"),
    (DEMO_TEACHER_USERNAME, "演示教师", "teacher"),
    (DEMO_STUDENT_USERNAME, "演示学生", "student"),
)

DEMO_V84_USERS = (
    (DEMO_PEER_TEACHER_USERNAME, "演示共同教师", "teacher"),
    (DEMO_PENDING_TEACHER_USERNAME, "演示待审教师", "student"),
    (DEMO_OPEN_STUDENT_USERNAME, "演示无行政班学生", "student"),
)

DEMO_SCHOOL_NAME = "星序本地演示学校"
DEMO_SCHOOL_REGION = "本地演示"
DEMO_CLASS_NAME = "星序 V8 综合演示班"
DEMO_CLASS_GRADE = "10"
DEMO_CLASS_TERM = "V8-local"

DEMO_V84_OPEN_COURSE = {
    "title": "星序机械能探究课",
    "summary": "面向公开申请学生的实验、检查点与作业闭环演示课程。",
    "academic_year": "2026—2027",
    "schedule_text": "每周三 14:00—15:40",
    "total_hours": 32,
    "galaxy_key": "englab",
    "subject_key": "physics",
    "admission_mode": "open",
}

DEMO_V84_RESTRICTED_COURSE = {
    "initial_title": "星序班级协作课（待修订）",
    "title": "星序班级协作探究课",
    "initial_summary": "等待管理员核对课程安排的班级课程。",
    "summary": "只面向指定行政班的共同授课与批量选课演示课程。",
    "academic_year": "2026—2027",
    "initial_schedule_text": "课程时间待确认",
    "schedule_text": "每周五 10:00—11:40",
    "total_hours": 24,
    "galaxy_key": "code-space",
    "subject_key": "control-flow",
    "admission_mode": "class_restricted",
}

DEMO_V84_ASSIGNMENTS = (
    {
        "title": "机械能证据报告",
        "description": "提交观察结果，教师批改后完成本单元。",
        "max_score": 100,
        "desired_status": "graded",
    },
    {
        "title": "机械能拓展思考",
        "description": "保留一份待批改提交，用于教师工作台演示。",
        "max_score": 100,
        "desired_status": "pending",
    },
)


def _course(galaxy_key: str, course_key: str, title: str, summary: str, *activity_keys: str) -> DemoCourseSpec:
    if len(activity_keys) != 3:
        raise ValueError("every demo course must declare exactly three units")
    return DemoCourseSpec(
        galaxy_key=galaxy_key,
        course_key=course_key,
        title=title,
        summary=summary,
        units=tuple(
            DemoUnitSpec(
                key=activity_key,
                title=activity_key.split(".", 1)[1].replace("-", " ").title(),
                content_slug=activity_key.replace(".", "/") if galaxy_key == "englab" else None,
            )
            for activity_key in activity_keys
        ),
    )


DEMO_COURSES = (
    _course("englab", "physics", "Physics", "Motion, matter, and evidence.", "physics.mechanics", "physics.gas-laws", "physics.thermodynamics"),
    _course("englab", "mathematics", "Mathematics", "Models, functions, and change.", "mathematics.function-graph", "mathematics.calculus", "mathematics.derivative-application"),
    _course("code-space", "program-start", "Program Start", "A small first path into code.", "program-start.first-output", "program-start.variable-box", "program-start.input-response"),
    _course("code-space", "control-flow", "Control Flow", "Branches, loops, and boundaries.", "control-flow.branch-doors", "control-flow.loop-boundary", "control-flow.nested-grid"),
    _course("code-space", "data-functions", "Data and Functions", "Transformations with explicit contracts.", "data-functions.list-snapshot", "data-functions.parameter-return", "data-functions.array-scan"),
    _course("code-space", "algorithm-thinking", "Algorithm Thinking", "Decomposition and search.", "algorithm-thinking.linear-search", "algorithm-thinking.bubble-pass", "algorithm-thinking.binary-choice"),
    _course("code-space", "debugging-testing", "Debugging and Testing", "Minimal cases and trustworthy checks.", "debugging-testing.assert-boundary", "debugging-testing.trace-mismatch", "debugging-testing.minimal-case"),
    _course("code-space", "challenge-submission", "Challenge Submission", "A bounded challenge and review loop.", "challenge-submission.multi-language-counter", "challenge-submission.public-sample", "challenge-submission.submission-record"),
    _course("future-galaxy", "earth-space", "Earth and Space", "Observations across Earth and near space.", "cosmos.day-season", "cosmos.orbital-scale", "cosmos.evidence-log"),
    _course("future-galaxy", "engineering-systems", "Engineering Systems", "Loads, choices, and safe systems.", "engineering.load-path", "engineering.member-choice", "engineering.safety-check"),
    _course("future-galaxy", "data-ai", "Data and AI", "Data quality, signal, and evaluation.", "datascience.model-fit", "datascience.outlier-test", "datascience.evidence-claim"),
    _course("future-galaxy", "information-technology", "Information Technology", "Networks, access, and digital safety.", "infotech.packet-route", "infotech.layer-contract", "infotech.fault-trace"),
    _course("future-galaxy", "materials-science", "Materials Science", "Structure, testing, and lifecycle.", "materials.grain-boundary", "materials.defect-path", "materials.process-window"),
    _course("future-galaxy", "humanities-futures", "Humanities Futures", "Claims, context, and changing voices.", "humanities.context-map", "humanities.voice-shift", "humanities.claim-review"),
)

REPRESENTATIVE_COURSES = (
    RepresentativeCourseSpec(
        "physics", "physics.mechanics", "physics.gas-laws", "physics.thermodynamics", 2,
    ),
    RepresentativeCourseSpec(
        "mathematics", "mathematics.derivative-application", "mathematics.function-graph", "mathematics.calculus", 2,
    ),
    RepresentativeCourseSpec(
        "control-flow", "control-flow.loop-boundary", "control-flow.branch-doors", "control-flow.nested-grid", 2,
    ),
    RepresentativeCourseSpec(
        "debugging-testing", "debugging-testing.minimal-case", "debugging-testing.assert-boundary", "debugging-testing.trace-mismatch", 4,
    ),
    RepresentativeCourseSpec(
        "engineering-systems", "engineering.load-path", "engineering.member-choice", "engineering.safety-check", 3,
    ),
    RepresentativeCourseSpec(
        "humanities-futures", "humanities.claim-review", "humanities.context-map", "humanities.voice-shift", 2,
    ),
)

REPRESENTATIVE_BY_COURSE = {item.course_key: item for item in REPRESENTATIVE_COURSES}
COURSE_BY_KEY = {item.course_key: item for item in DEMO_COURSES}
UNIT_BY_ACTIVITY_KEY = {
    unit.activity_key: (course.course_key, unit)
    for course in DEMO_COURSES
    for unit in course.units
}

DEMO_EVIDENCE_EVENT_TYPES = ("started", "predicted", "attempted", "corrected", "explained")
DEMO_ASSIGNMENTS = (
    {
        "course_key": "physics",
        "activity_key": "physics.mechanics",
        "title": "Physics evidence review",
        "description": "Synthetic local-preview evidence for the review loop.",
        "max_score": 100,
        "status": "active",
        "audience_mode": "all_attached_classes",
        "desired_status": "graded",
    },
    {
        "course_key": "humanities-futures",
        "activity_key": "humanities.claim-review",
        "title": "Humanities claim review",
        "description": "Synthetic local-preview evidence for the review loop.",
        "max_score": 100,
        "status": "active",
        "audience_mode": "all_attached_classes",
        "desired_status": "pending",
    },
    {
        "course_key": "control-flow",
        "activity_key": "control-flow.loop-boundary",
        "title": "Loop boundary review",
        "description": "Synthetic loop trace awaiting teacher feedback.",
        "max_score": 100,
        "status": "active",
        "audience_mode": "all_attached_classes",
        "desired_status": "pending",
    },
)
DEMO_CODE_PROBLEM = {
    "course_key": "control-flow",
    "activity_key": "control-flow.loop-boundary",
    "title": "Loop boundary demonstration",
    "statement_markdown": "Trace the final false condition for the bounded loop.",
    "test_cases": ({"stdin": "0 3\n", "expected_stdout": "3\n", "weight": 1},),
    "language": "python",
    "source_code": "print(3)",
    "language_allowlist": ("javascript", "python", "c", "cpp"),
    "resource_policy": {
        "cpu_time_ms": 500,
        "wall_time_ms": 1000,
        "memory_kb": 65536,
        "output_max_bytes": 4096,
        "process_limit": 1,
        "network_enabled": False,
        "filesystem_mode": "none",
    },
    "source_max_bytes": 128,
    "input_max_bytes": 16,
    "output_max_bytes": 4096,
}

if len(DEMO_COURSES) != 14:
    raise AssertionError("the local demo catalog must contain 14 courses")
if sum(len(course.units) for course in DEMO_COURSES) != 42:
    raise AssertionError("the local demo catalog must contain 42 units")
if len(REPRESENTATIVE_COURSES) != 6:
    raise AssertionError("the local demo catalog must contain six representative courses")
if set(DEMO_EVIDENCE_PROFILE_BY_ACTIVITY) != {
    representative.open_unit_key
    for representative in REPRESENTATIVE_COURSES
}:
    raise AssertionError("every representative course must have one evidence producer profile")
