"""Strict V2 course-content contract and deterministic V1 read adapter.

V2 intentionally lives beside the legacy ``ContentPage`` schema.  It does not
change the V1 persistence or render path; callers opt in explicitly and the
adapter never copies V1 script capabilities into the new content model.
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Any, Literal, Union
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.content import ContentPage

STABLE_ID_PATTERN = r"^[a-z0-9][a-z0-9._:-]*$"
SLUG_PATTERN = r"^[^\s/?#]+(?:/[^\s/?#]+)+$"

# CONTENT-010 starts with the only backend-published V1 experiment page.  New
# keys must be added through the official content inventory, never supplied by
# a page payload.  This makes an unknown simulation fail closed.
OFFICIAL_SIMULATION_KEYS = frozenset({"physics.energy-conservation"})

_RAW_HTML_PATTERN = re.compile(
    r"<!--|<\s*/?\s*[a-zA-Z][^>]*>", re.IGNORECASE | re.DOTALL
)
_DANGEROUS_MARKDOWN_LINK_PATTERN = re.compile(
    r"(?:\]\(\s*|<\s*)(?:(?:javascript|vbscript)\s*:|data\s*:\s*text/html)",
    re.IGNORECASE,
)


class StrictContentModel(BaseModel):
    """Base for closed content objects: unknown capabilities are rejected."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class HeroBlock(StrictContentModel):
    blockId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    type: Literal["hero"]
    title: str = Field(min_length=1, max_length=240)
    summary: str = Field(min_length=1, max_length=4000)
    eyebrow: str | None = Field(default=None, max_length=120)
    badges: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("badges")
    @classmethod
    def validate_badges(cls, values: list[str]) -> list[str]:
        return _validate_short_string_list("hero badges", values, max_item_length=40)


class LearningTaskBlock(StrictContentModel):
    blockId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    type: Literal["learning-task"]
    title: str = Field(min_length=1, max_length=240)
    prompt: str = Field(min_length=1, max_length=4000)
    outcomes: list[str] = Field(default_factory=list, max_length=12)
    steps: list[str] = Field(default_factory=list, max_length=20)
    concepts: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("outcomes", "steps", "concepts")
    @classmethod
    def validate_learning_lists(cls, values: list[str]) -> list[str]:
        return _validate_short_string_list(
            "learning-task list", values, max_item_length=500
        )


class RichTextBlock(StrictContentModel):
    blockId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    type: Literal["rich-text"]
    title: str | None = Field(default=None, max_length=240)
    markdown: str = Field(min_length=1, max_length=16_000)

    @field_validator("markdown")
    @classmethod
    def validate_markdown(cls, value: str) -> str:
        return _validate_canonical_markdown(value)


class MediaBlock(StrictContentModel):
    blockId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    type: Literal["media"]
    title: str | None = Field(default=None, max_length=240)
    mediaType: Literal["image", "diagram", "audio", "video", "document"]
    assetKey: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    alt: str | None = Field(default=None, max_length=500)
    caption: str | None = Field(default=None, max_length=2000)
    transcript: str | None = Field(default=None, max_length=16_000)

    @model_validator(mode="after")
    def validate_accessible_media(self) -> "MediaBlock":
        if self.mediaType in {"image", "diagram"} and not self.alt:
            raise ValueError("Image and diagram media blocks require alt text")
        return self


class OfficialSimulationBlock(StrictContentModel):
    blockId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    type: Literal["official-simulation"]
    title: str = Field(min_length=1, max_length=240)
    simulationKey: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    instructions: str = Field(min_length=1, max_length=4000)
    fallbackMarkdown: str | None = Field(default=None, max_length=16_000)

    @field_validator("simulationKey")
    @classmethod
    def validate_official_simulation(cls, value: str) -> str:
        if value not in OFFICIAL_SIMULATION_KEYS:
            raise ValueError(f"Unregistered official simulation: {value}")
        return value

    @field_validator("fallbackMarkdown")
    @classmethod
    def validate_fallback_markdown(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_canonical_markdown(value)


class CheckpointChoice(StrictContentModel):
    choiceId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=1000)


class CheckpointBlock(StrictContentModel):
    blockId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    type: Literal["checkpoint"]
    checkpointKey: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    title: str = Field(min_length=1, max_length=240)
    prompt: str = Field(min_length=1, max_length=4000)
    mode: Literal["inline", "question-set"] = "inline"
    questionSetKey: str | None = Field(
        default=None, max_length=120, pattern=STABLE_ID_PATTERN
    )
    responseType: (
        Literal["single-choice", "multiple-choice", "numeric", "short-text"] | None
    ) = None
    choices: list[CheckpointChoice] = Field(default_factory=list, max_length=12)
    correctChoiceIds: list[str] = Field(default_factory=list, max_length=12)
    numericAnswer: float | None = Field(default=None, allow_inf_nan=False)
    tolerance: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    acceptedAnswers: list[str] = Field(default_factory=list, max_length=20)
    maxAttempts: int | None = Field(default=None, ge=1, le=20)

    @model_validator(mode="after")
    def validate_checkpoint_contract(self) -> "CheckpointBlock":
        choice_ids = [choice.choiceId for choice in self.choices]
        _reject_duplicate_ids("checkpoint choiceId", choice_ids)
        _reject_duplicate_ids("checkpoint correctChoiceId", self.correctChoiceIds)

        if self.mode == "question-set":
            if not self.questionSetKey:
                raise ValueError("Question-set checkpoints require questionSetKey")
            if any(
                (
                    self.responseType is not None,
                    bool(self.choices),
                    bool(self.correctChoiceIds),
                    self.numericAnswer is not None,
                    self.tolerance is not None,
                    bool(self.acceptedAnswers),
                )
            ):
                raise ValueError("Question-set checkpoints cannot embed inline answers")
            return self

        if self.questionSetKey is not None:
            raise ValueError("Inline checkpoints cannot reference questionSetKey")
        if self.responseType is None:
            raise ValueError("Inline checkpoints require responseType")

        if self.responseType in {"single-choice", "multiple-choice"}:
            if len(self.choices) < 2:
                raise ValueError("Choice checkpoints require at least two choices")
            if not self.correctChoiceIds:
                raise ValueError("Choice checkpoints require a correct choice")
            unknown_answers = set(self.correctChoiceIds).difference(choice_ids)
            if unknown_answers:
                raise ValueError("Checkpoint answer references an unknown choice")
            if self.responseType == "single-choice" and len(self.correctChoiceIds) != 1:
                raise ValueError(
                    "Single-choice checkpoints require exactly one correct choice"
                )
            if (
                self.numericAnswer is not None
                or self.tolerance is not None
                or self.acceptedAnswers
            ):
                raise ValueError(
                    "Choice checkpoints cannot carry numeric or text answers"
                )
            return self

        if self.choices or self.correctChoiceIds:
            raise ValueError("Non-choice checkpoints cannot carry choices")
        if self.responseType == "numeric":
            if self.numericAnswer is None:
                raise ValueError("Numeric checkpoints require numericAnswer")
            if self.acceptedAnswers:
                raise ValueError("Numeric checkpoints cannot carry text answers")
            return self

        if not self.acceptedAnswers:
            raise ValueError("Short-text checkpoints require acceptedAnswers")
        _validate_short_string_list(
            "checkpoint acceptedAnswers", self.acceptedAnswers, max_item_length=500
        )
        if self.numericAnswer is not None or self.tolerance is not None:
            raise ValueError("Short-text checkpoints cannot carry numeric answers")
        return self


class SourceItem(StrictContentModel):
    sourceId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=240)
    url: str = Field(min_length=1, max_length=2048)
    usage: str | None = Field(default=None, max_length=500)

    @field_validator("url")
    @classmethod
    def validate_source_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Source URLs must use http or https")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Source URLs cannot contain credentials")
        return value


class SourcesBlock(StrictContentModel):
    blockId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    type: Literal["sources"]
    title: str = Field(min_length=1, max_length=240)
    items: list[SourceItem] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def validate_source_ids(self) -> "SourcesBlock":
        _reject_duplicate_ids("sourceId", [source.sourceId for source in self.items])
        return self


ContentBlockV2 = Annotated[
    Union[
        HeroBlock,
        LearningTaskBlock,
        RichTextBlock,
        MediaBlock,
        OfficialSimulationBlock,
        CheckpointBlock,
        SourcesBlock,
    ],
    Field(discriminator="type"),
]


class CourseUnitRefV2(StrictContentModel):
    courseId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    unitId: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    order: int = Field(ge=0, le=10_000)
    title: str = Field(min_length=1, max_length=240)


class ContentPageV2(StrictContentModel):
    schemaVersion: Literal["astra-content-page-v2"] = "astra-content-page-v2"
    slug: str = Field(min_length=1, max_length=180, pattern=SLUG_PATTERN)
    galaxy: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    subject: str = Field(min_length=1, max_length=120, pattern=STABLE_ID_PATTERN)
    title: str = Field(min_length=1, max_length=240)
    summary: str = Field(min_length=1, max_length=4000)
    layout: str = Field(
        default="course-page", min_length=1, max_length=64, pattern=STABLE_ID_PATTERN
    )
    status: Literal["draft", "published", "archived"] = "draft"
    version: str = Field(min_length=1, max_length=64)
    blocks: list[ContentBlockV2] = Field(min_length=1, max_length=200)
    courseUnit: CourseUnitRefV2 | None = None

    @model_validator(mode="after")
    def validate_page_contract(self) -> "ContentPageV2":
        _reject_duplicate_ids("blockId", [block.blockId for block in self.blocks])
        _reject_duplicate_ids(
            "checkpointKey",
            [
                block.checkpointKey
                for block in self.blocks
                if isinstance(block, CheckpointBlock)
            ],
        )
        _reject_duplicate_ids(
            "sourceId",
            [
                source.sourceId
                for block in self.blocks
                if isinstance(block, SourcesBlock)
                for source in block.items
            ],
        )
        _validate_content_v2_budget(self.model_dump(mode="json"))
        return self


def adapt_content_page_v1(page: ContentPage | dict[str, Any]) -> ContentPageV2:
    """Read a V1 page as V2 without mutating history or copying scripts."""

    legacy = page if isinstance(page, ContentPage) else ContentPage.model_validate(page)
    blocks: list[dict[str, Any]] = []
    sources_emitted = False

    for index, section in enumerate(legacy.sections):
        block_id = section.sectionId or f"legacy-{section.type}-{index + 1}"
        title = section.title or legacy.title
        summary = section.summary or legacy.summary or title
        props = section.props if isinstance(section.props, dict) else {}

        if section.type == "hero":
            block: dict[str, Any] = {
                "blockId": block_id,
                "type": "hero",
                "title": title,
                "summary": summary,
            }
            eyebrow = props.get("eyebrow")
            if isinstance(eyebrow, str) and eyebrow.strip():
                block["eyebrow"] = eyebrow
            badges = _legacy_string_list(props.get("badges"), limit=8)
            if badges:
                block["badges"] = badges
            blocks.append(block)
            continue

        if section.type == "learning-task":
            blocks.append(
                {
                    "blockId": block_id,
                    "type": "learning-task",
                    "title": title,
                    "prompt": summary,
                    "outcomes": _legacy_string_list(props.get("outcomes"), limit=12),
                    "steps": _legacy_string_list(props.get("steps"), limit=20),
                    "concepts": _legacy_string_list(props.get("concepts"), limit=20),
                }
            )
            continue

        if section.type == "experiment":
            if not section.experimentId:
                raise ValueError(
                    f"V1 experiment section {block_id} has no experimentId"
                )
            blocks.append(
                {
                    "blockId": block_id,
                    "type": "official-simulation",
                    "title": title,
                    "simulationKey": f"{legacy.subject}.{section.experimentId}",
                    "instructions": summary,
                }
            )
            continue

        if section.type == "assessment":
            if not section.questionSetId:
                raise ValueError(
                    f"V1 assessment section {block_id} has no questionSetId"
                )
            blocks.append(
                {
                    "blockId": block_id,
                    "type": "checkpoint",
                    "checkpointKey": section.questionSetId,
                    "title": title,
                    "prompt": summary,
                    "mode": "question-set",
                    "questionSetKey": section.questionSetId,
                }
            )
            continue

        if section.type == "source-list":
            source_items = _adapt_v1_sources(legacy)
            if source_items and not sources_emitted:
                blocks.append(
                    {
                        "blockId": block_id,
                        "type": "sources",
                        "title": title,
                        "items": source_items,
                    }
                )
                sources_emitted = True

    if legacy.sources and not sources_emitted:
        blocks.append(
            {
                "blockId": _available_legacy_id("legacy-page-sources", blocks),
                "type": "sources",
                "title": "参考资料",
                "items": _adapt_v1_sources(legacy),
            }
        )

    if not blocks:
        blocks.append(
            {
                "blockId": "legacy-page-hero",
                "type": "hero",
                "title": legacy.title,
                "summary": legacy.summary or legacy.title,
            }
        )

    payload: dict[str, Any] = {
        "schemaVersion": "astra-content-page-v2",
        "slug": legacy.slug,
        "galaxy": legacy.galaxy,
        "subject": legacy.subject,
        "title": legacy.title,
        "summary": legacy.summary or legacy.title,
        "layout": legacy.layout,
        "status": legacy.status,
        "version": legacy.version,
        "blocks": blocks,
    }
    if legacy.courseUnit is not None:
        payload["courseUnit"] = legacy.courseUnit.model_dump(mode="json")
    return ContentPageV2.model_validate(payload)


def _adapt_v1_sources(page: ContentPage) -> list[dict[str, str]]:
    return [
        {
            "sourceId": source.sourceId or f"legacy-source-{index + 1}",
            "label": source.label,
            "url": source.url,
        }
        for index, source in enumerate(page.sources)
    ]


def _available_legacy_id(preferred: str, blocks: list[dict[str, Any]]) -> str:
    used = {str(block.get("blockId", "")).lower() for block in blocks}
    if preferred not in used:
        return preferred
    suffix = 2
    while f"{preferred}-{suffix}" in used:
        suffix += 1
    return f"{preferred}-{suffix}"


def _legacy_string_list(value: Any, *, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [
        item.strip() for item in value[:limit] if isinstance(item, str) and item.strip()
    ]


def _validate_canonical_markdown(value: str) -> str:
    if _RAW_HTML_PATTERN.search(value):
        raise ValueError("Canonical Markdown cannot contain raw HTML")
    if _DANGEROUS_MARKDOWN_LINK_PATTERN.search(value):
        raise ValueError("Canonical Markdown contains a dangerous URL scheme")
    return value


def _validate_short_string_list(
    name: str, values: list[str], *, max_item_length: int
) -> list[str]:
    normalized: list[str] = []
    for value in values:
        item = value.strip()
        if not item:
            raise ValueError(f"{name} cannot contain blank items")
        if len(item) > max_item_length:
            raise ValueError(f"{name} item exceeds {max_item_length} characters")
        normalized.append(item)
    return normalized


def _reject_duplicate_ids(field_name: str, values: list[str]) -> None:
    seen: set[str] = set()
    for value in values:
        normalized = value.strip().lower()
        if normalized in seen:
            raise ValueError(f"Duplicate V2 content {field_name}: {value}")
        seen.add(normalized)


def _validate_content_v2_budget(payload: dict[str, Any]) -> None:
    serialized = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    if len(serialized.encode("utf-8")) > 256 * 1024:
        raise ValueError("ContentPageV2 exceeds the 256 KiB canonical JSON limit")

    node_count = 0

    def visit(value: Any, depth: int) -> None:
        nonlocal node_count
        node_count += 1
        if node_count > 10_000:
            raise ValueError("ContentPageV2 exceeds the 10000 node limit")
        if depth > 16:
            raise ValueError("ContentPageV2 exceeds the maximum nesting depth")
        if isinstance(value, dict):
            if len(value) > 128:
                raise ValueError("ContentPageV2 object exceeds the 128 field limit")
            for key, item in value.items():
                if len(str(key)) > 240:
                    raise ValueError(
                        "ContentPageV2 key exceeds the 240 character limit"
                    )
                visit(item, depth + 1)
        elif isinstance(value, list):
            if len(value) > 256:
                raise ValueError("ContentPageV2 array exceeds the 256 item limit")
            for item in value:
                visit(item, depth + 1)
        elif isinstance(value, str) and len(value) > 16_000:
            raise ValueError("ContentPageV2 string exceeds the 16000 character limit")

    visit(payload, 0)
