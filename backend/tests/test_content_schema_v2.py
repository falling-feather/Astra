import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.content import ContentPage
from app.schemas.content_v2 import ContentPageV2, adapt_content_page_v1
from app.schemas.official_activity_keys import (
    OFFICIAL_ACTIVITY_COUNT,
    OFFICIAL_ACTIVITY_KEYS,
)
from app.services.content_catalog import ENERGY_CONSERVATION_PAGE


def test_content_page_v2_accepts_all_seven_approved_block_types():
    page = ContentPageV2.model_validate(_seven_block_page())

    assert page.schemaVersion == "astra-content-page-v2"
    assert [block.type for block in page.blocks] == [
        "hero",
        "learning-task",
        "rich-text",
        "media",
        "official-simulation",
        "checkpoint",
        "sources",
    ]
    assert page.model_dump(mode="json")["blocks"][2]["markdown"].startswith("## 探究")


def test_official_simulation_catalog_matches_124_protected_and_three_frozen_additions():
    baseline_path = (
        Path(__file__).resolve().parents[2]
        / "tools"
        / "quality"
        / "baselines"
        / "protected-activities-v822.json"
    )
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    expected = {item["activity_key"] for item in baseline["activities"]}
    expected.update(
        {
            "physics.double-pendulum-chaos",
            "chemistry.chromatography-separation",
            "engineering.robot-arm-ik",
        }
    )

    assert OFFICIAL_ACTIVITY_COUNT == 127
    assert len(OFFICIAL_ACTIVITY_KEYS) == OFFICIAL_ACTIVITY_COUNT
    assert OFFICIAL_ACTIVITY_KEYS == expected

    robot_arm = _seven_block_page()
    robot_arm["blocks"][4]["simulationKey"] = "engineering.robot-arm-ik"
    assert (
        ContentPageV2.model_validate(robot_arm).blocks[4].simulationKey
        == "engineering.robot-arm-ik"
    )


@pytest.mark.parametrize(
    ("block_index", "mutate", "message"),
    [
        (0, lambda block: block.pop("title"), "title"),
        (1, lambda block: block.update({"prompt": ""}), "prompt"),
        (
            2,
            lambda block: block.update({"markdown": "<script>alert(1)</script>"}),
            "raw HTML",
        ),
        (3, lambda block: block.update({"alt": None}), "alt text"),
        (
            4,
            lambda block: block.update({"simulationKey": "physics.unknown-lab"}),
            "Unregistered",
        ),
        (
            5,
            lambda block: block.update({"correctChoiceIds": ["answer-a", "answer-b"]}),
            "exactly one",
        ),
        (
            6,
            lambda block: block["items"].append(deepcopy(block["items"][0])),
            "Duplicate",
        ),
    ],
)
def test_each_v2_block_type_has_a_closed_invalid_example(block_index, mutate, message):
    payload = _seven_block_page()
    mutate(payload["blocks"][block_index])

    with pytest.raises(ValidationError, match=message):
        ContentPageV2.model_validate(payload)


def test_content_page_v2_rejects_unknown_blocks_and_script_capabilities():
    unknown = _seven_block_page()
    unknown["blocks"].append(
        {"blockId": "unknown", "type": "iframe", "src": "https://example.com"}
    )
    with pytest.raises(ValidationError):
        ContentPageV2.model_validate(unknown)

    script = _seven_block_page()
    script["blocks"][4]["scriptPath"] = "pages/physics/energy-conservation.js"
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ContentPageV2.model_validate(script)

    html = _seven_block_page()
    html["blocks"][2]["html"] = "<p>derived output must not be canonical</p>"
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ContentPageV2.model_validate(html)


def test_canonical_markdown_allows_code_discussion_but_rejects_executable_links():
    prose = _seven_block_page()
    prose["blocks"][2]["markdown"] = (
        "JavaScript: 这段正文只是在讲解语言，不是执行能力。"
    )
    assert ContentPageV2.model_validate(prose).blocks[2].type == "rich-text"

    for unsafe in [
        "[运行](javascript:alert(1))",
        "![载荷](data:text/html;base64,PHNjcmlwdD4=)",
    ]:
        payload = _seven_block_page()
        payload["blocks"][2]["markdown"] = unsafe
        with pytest.raises(ValidationError, match="dangerous URL scheme"):
            ContentPageV2.model_validate(payload)


@pytest.mark.parametrize(
    "patch",
    [
        {"responseType": "single-choice", "choices": [], "correctChoiceIds": []},
        {"responseType": "multiple-choice", "correctChoiceIds": ["missing-choice"]},
        {
            "responseType": "numeric",
            "choices": [],
            "correctChoiceIds": [],
            "numericAnswer": None,
        },
        {
            "mode": "question-set",
            "questionSetKey": "legacy-set",
            "responseType": "single-choice",
        },
    ],
)
def test_content_page_v2_rejects_inconsistent_checkpoint_contracts(patch):
    payload = _seven_block_page()
    checkpoint = payload["blocks"][5]
    checkpoint.update(patch)

    with pytest.raises(ValidationError):
        ContentPageV2.model_validate(payload)


def test_content_page_v2_rejects_duplicate_stable_ids_and_unsafe_source_urls():
    duplicate = _seven_block_page()
    duplicate["blocks"][1]["blockId"] = duplicate["blocks"][0]["blockId"]
    with pytest.raises(ValidationError, match="Duplicate V2 content blockId"):
        ContentPageV2.model_validate(duplicate)

    unsafe_source = _seven_block_page()
    unsafe_source["blocks"][6]["items"][0]["url"] = "javascript:alert(1)"
    with pytest.raises(ValidationError, match="http or https"):
        ContentPageV2.model_validate(unsafe_source)


def test_v1_energy_page_adapts_deterministically_without_script_capabilities():
    first = adapt_content_page_v1(ENERGY_CONSERVATION_PAGE)
    second = adapt_content_page_v1(ENERGY_CONSERVATION_PAGE.model_dump(mode="json"))

    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert [block.type for block in first.blocks] == [
        "hero",
        "learning-task",
        "official-simulation",
        "checkpoint",
        "sources",
    ]
    simulation = first.blocks[2]
    assert simulation.type == "official-simulation"
    assert simulation.simulationKey == "physics.energy-conservation"
    checkpoint = first.blocks[3]
    assert checkpoint.type == "checkpoint"
    assert checkpoint.mode == "question-set"
    assert checkpoint.questionSetKey == "energy-conservation"
    serialized = first.model_dump_json()
    assert "scriptPath" not in serialized
    assert "scriptSandbox" not in serialized
    assert "pages/physics/energy-conservation.js" not in serialized


def test_v1_schema_remains_readable_and_unregistered_simulation_fails_closed():
    legacy_payload = ENERGY_CONSERVATION_PAGE.model_dump(mode="json")
    assert (
        ContentPage.model_validate(legacy_payload).slug == "physics/energy-conservation"
    )

    legacy_payload["sections"][2]["experimentId"] = "unregistered-lab"
    with pytest.raises(ValidationError, match="Unregistered official simulation"):
        adapt_content_page_v1(legacy_payload)


def test_v1_adapter_preserves_supported_unicode_slugs():
    legacy_payload = ENERGY_CONSERVATION_PAGE.model_dump(mode="json")
    legacy_payload["slug"] = "物理/机械能守恒"

    assert adapt_content_page_v1(legacy_payload).slug == "物理/机械能守恒"


def _seven_block_page() -> dict:
    return {
        "schemaVersion": "astra-content-page-v2",
        "slug": "physics/energy-conservation",
        "galaxy": "englab",
        "subject": "physics",
        "title": "机械能守恒",
        "summary": "从预测、实验、解释到检查点，完成一次可追踪学习。",
        "layout": "course-page",
        "status": "draft",
        "version": "v8.1.2-draft",
        "courseUnit": {
            "courseId": "englab-physics-foundation",
            "unitId": "physics-energy-conservation",
            "order": 10,
            "title": "机械能守恒",
        },
        "blocks": [
            {
                "blockId": "energy-hero",
                "type": "hero",
                "title": "机械能守恒",
                "summary": "观察动能、势能和耗散之间的转换。",
                "badges": ["物理", "核心实验"],
            },
            {
                "blockId": "energy-task",
                "type": "learning-task",
                "title": "先预测，再验证",
                "prompt": "打开耗散后，判断机械能与总能量将怎样变化。",
                "outcomes": ["区分机械能与总能量", "用实验现象解释能量转化"],
                "steps": ["写下预测", "调整摩擦", "比较能量条", "解释差异"],
                "concepts": ["动能", "势能", "非保守力做功"],
            },
            {
                "blockId": "energy-explanation",
                "type": "rich-text",
                "title": "现象解释",
                "markdown": "## 探究\n\n机械能的变化量对应非保守力所做的功。",
            },
            {
                "blockId": "energy-diagram",
                "type": "media",
                "title": "能量关系图",
                "mediaType": "diagram",
                "assetKey": "physics.energy.energy-flow-v1",
                "alt": "势能转化为动能，并在摩擦存在时转化为内能的关系图",
                "caption": "媒体只引用平台注册资产，不接受任意远程地址。",
            },
            {
                "blockId": "energy-simulation",
                "type": "official-simulation",
                "title": "机械能守恒实验",
                "simulationKey": "physics.energy-conservation",
                "instructions": "先保持无摩擦，再逐步增加摩擦并比较能量条。",
                "fallbackMarkdown": "若设备无法运行模拟，请根据静态能量图完成趋势判断。",
            },
            {
                "blockId": "energy-checkpoint",
                "type": "checkpoint",
                "checkpointKey": "energy-loss-form",
                "title": "即时检查",
                "prompt": "存在摩擦时，减少的机械能主要转化为什么？",
                "mode": "inline",
                "responseType": "single-choice",
                "choices": [
                    {"choiceId": "answer-a", "label": "内能"},
                    {"choiceId": "answer-b", "label": "质量"},
                ],
                "correctChoiceIds": ["answer-a"],
                "maxAttempts": 3,
            },
            {
                "blockId": "energy-sources",
                "type": "sources",
                "title": "参考资料",
                "items": [
                    {
                        "sourceId": "openstax-conservation-energy",
                        "label": "OpenStax College Physics 2e",
                        "url": "https://openstax.org/books/college-physics-2e/pages/7-introduction-to-work-energy-and-energy-resources",
                        "usage": "机械能守恒概念与教学表述复核",
                    }
                ],
            },
        ],
    }
