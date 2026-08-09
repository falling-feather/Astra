from datetime import datetime
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


CodeLanguage = Literal["javascript", "python", "c", "cpp"]
CodeSubmissionStatus = Literal[
    "queued",
    "runner_unavailable",
    "running",
    "accepted",
    "wrong_answer",
    "partial",
    "compile_error",
    "runtime_error",
    "time_limit",
    "memory_limit",
    "output_limit",
    "internal_error",
    "cancelled",
]

_LANGUAGE_ALIASES = {
    "javascript": "javascript",
    "js": "javascript",
    "node": "javascript",
    "nodejs": "javascript",
    "python": "python",
    "py": "python",
    "c": "c",
    "cpp": "cpp",
    "c++": "cpp",
    "cxx": "cpp",
}
_CLIENT_SUBMISSION_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")


def canonical_language(value: str) -> str:
    normalized = value.strip().lower().replace(" ", "")
    canonical = _LANGUAGE_ALIASES.get(normalized)
    if canonical is None:
        raise ValueError("language must be one of javascript, python, c, cpp")
    return canonical


class CodeResourcePolicy(BaseModel):
    cpu_time_ms: int = Field(default=2000, ge=50, le=10_000)
    wall_time_ms: int = Field(default=5000, ge=100, le=30_000)
    memory_kb: int = Field(default=131_072, ge=16_384, le=524_288)
    output_max_bytes: int = Field(default=65_536, ge=1024, le=1_048_576)
    process_limit: int = Field(default=1, ge=1, le=32)
    network_enabled: Literal[False] = False
    filesystem_mode: Literal["none"] = "none"


class CodeProblemTestCase(BaseModel):
    stdin: str = Field(default="", max_length=65_536)
    expected_stdout: str = Field(max_length=65_536)
    weight: int = Field(default=1, ge=1, le=1000)


class CodeProblemCreate(BaseModel):
    course_id: int
    course_unit_id: int
    title: str = Field(min_length=1, max_length=180)
    statement_markdown: str = Field(min_length=1, max_length=60_000)
    test_cases: list[CodeProblemTestCase] = Field(min_length=1, max_length=100)
    language_allowlist: list[CodeLanguage] = Field(default_factory=lambda: ["javascript", "python", "c", "cpp"])
    resource_policy: CodeResourcePolicy = Field(default_factory=CodeResourcePolicy)
    source_max_bytes: int = Field(default=65_536, ge=1, le=1_048_576)
    input_max_bytes: int = Field(default=16_384, ge=0, le=1_048_576)
    output_max_bytes: int = Field(default=65_536, ge=1024, le=1_048_576)

    @field_validator("language_allowlist")
    @classmethod
    def unique_language_allowlist(cls, values: list[str]) -> list[str]:
        if not values or len(values) != len(set(values)):
            raise ValueError("language_allowlist must contain unique supported languages")
        return values


class CodeProblemVersionCreate(BaseModel):
    statement_markdown: str = Field(min_length=1, max_length=60_000)
    test_cases: list[CodeProblemTestCase] = Field(min_length=1, max_length=100)
    language_allowlist: list[CodeLanguage] = Field(default_factory=lambda: ["javascript", "python", "c", "cpp"])
    resource_policy: CodeResourcePolicy = Field(default_factory=CodeResourcePolicy)
    source_max_bytes: int = Field(default=65_536, ge=1, le=1_048_576)
    input_max_bytes: int = Field(default=16_384, ge=0, le=1_048_576)
    output_max_bytes: int = Field(default=65_536, ge=1024, le=1_048_576)

    @field_validator("language_allowlist")
    @classmethod
    def unique_language_allowlist(cls, values: list[str]) -> list[str]:
        if not values or len(values) != len(set(values)):
            raise ValueError("language_allowlist must contain unique supported languages")
        return values


class CodeProblemVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    problem_id: int
    version_number: int
    status: str
    statement_markdown: str
    language_allowlist: list[CodeLanguage]
    resource_policy: CodeResourcePolicy
    source_max_bytes: int
    input_max_bytes: int
    output_max_bytes: int
    spec_sha256: str


class CodeProblemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    course_id: int
    course_unit_id: int
    activity_key: str
    title: str
    status: str
    active_version: CodeProblemVersionRead
    effective_release_state: Literal["hidden", "locked", "open"] | None = None
    lock_reasons: list[str] = Field(default_factory=list)


class CodeSubmissionCreate(BaseModel):
    client_submission_id: str | None = Field(default=None, min_length=8, max_length=128)
    class_id: int
    language: str = Field(min_length=1, max_length=24)
    source_code: str = Field(min_length=1, max_length=1_048_576)
    stdin: str = Field(default="", max_length=1_048_576)

    @field_validator("language")
    @classmethod
    def canonicalize_language(cls, value: str) -> str:
        return canonical_language(value)

    @field_validator("client_submission_id")
    @classmethod
    def validate_client_submission_id(cls, value: str | None) -> str | None:
        if value is not None and (
            value.startswith("legacy:") or not _CLIENT_SUBMISSION_ID_PATTERN.fullmatch(value)
        ):
            raise ValueError("client_submission_id must be an opaque stable identifier")
        return value


class CodeSubmissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    course_id: int
    class_id: int
    course_unit_id: int
    activity_key: str
    problem_id: int
    problem_version_id: int
    student_id: int
    client_submission_id: str
    language: CodeLanguage
    status: CodeSubmissionStatus
    result_summary: dict = Field(default_factory=dict)
    source_sha256: str
    created_at: datetime
    judged_at: datetime | None = None
    idempotent_replay: bool = False
    is_latest_revision: bool = Field(
        default=False,
        description="Latest revision in the same student, problem, and class scope by created_at then id.",
    )
    is_best_revision: bool = Field(
        default=False,
        description=(
            "Status-priority best revision in the same student, problem, and class scope, "
            "with created_at then id as tie-breakers; this is not the highest numeric score."
        ),
    )


class CodeSubmissionSourceRead(BaseModel):
    submission_id: int
    language: CodeLanguage
    source_code: str
    stdin: str


class CodeSubmissionPage(BaseModel):
    items: list[CodeSubmissionRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None


class CodeJudgeAttemptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submission_id: int
    attempt_number: int
    status: CodeSubmissionStatus
    adapter_name: str
    error_code: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class CodeJudgeAttemptPage(BaseModel):
    items: list[CodeJudgeAttemptRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None
